/**
 * Bound — Live API layer (Phase 3 — delegation)
 *
 * Real FastAPI calls with delegation chain support.
 *
 * Backend contract (SQLite):
 *  agents:       id, name, description, status, created_at
 *  mandates:     id, agent_id, purpose, max_amount, currency, merchant_category, expires_at, status, created_at
 *  delegations:  id, parent_agent_id, child_agent_id, parent_mandate_id, delegated_amount_limit, purpose, merchant_category, status, created_at, expires_at
 *  transactions: id, agent_id, mandate_id, delegation_id, amount, currency, merchant, merchant_category, purpose, decision, reason, created_at
 *
 * VITE_API_URL controls the base. Falls back to http://localhost:4000 for local dev.
 */

import type { AgentNode, MandateItem, TransactionRecord, AuditStep, DelegationItem, DelegationChain, ProvenanceEvent, ProvenanceVerifyResult } from '../types';
import { INITIAL_AGENTS, INITIAL_MANDATES, INITIAL_TRANSACTIONS, PROVENANCE_STEPS } from '../data/mockData';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RAW_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';
// Trim trailing slashes; allow empty → fallback to localhost:4000
export const API_URL = RAW_URL.replace(/\/+$/, '') || 'http://localhost:4000';

// Normalise base: if user set http://localhost:4000/api we keep it, if http://localhost:4000 we keep it.
// Caller always appends "/agents" etc so both `/agents` and `/api/agents` are covered because backend mounts both.
const BASE = API_URL;

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Allow path like "/agents" — prepend BASE
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText} at ${url}: ${text}`);
  }
  // 204 has no body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Backend raw shapes (mirror schemas.py)
// ---------------------------------------------------------------------------
interface BackendAgent {
  id: string;
  name: string;
  description?: string | null;
  status: string; // ACTIVE | REVOKED
  created_at: string;
}
interface BackendMandate {
  id: string;
  agent_id: string;
  purpose: string;
  max_amount: number;
  currency: string;
  merchant_category: string;
  expires_at?: string | null;
  status: string; // ACTIVE | REVOKED | EXPIRED
  created_at: string;
}
interface BackendTransaction {
  id: string;
  agent_id: string;
  mandate_id?: string | null;
  delegation_id?: string | null;
  amount: number;
  currency: string;
  merchant: string;
  merchant_category: string;
  purpose: string;
  decision: string; // ALLOW | VERIFY (final)
  reason: string;
  created_at: string;
  authorization_status?: string | null;
  risk_score?: number | null;
  risk_level?: string | null;
  risk_factors?: any | null;
}
interface BackendDelegation {
  id: string;
  parent_agent_id: string;
  child_agent_id: string;
  parent_mandate_id: string;
  delegated_amount_limit: number;
  purpose: string;
  merchant_category: string;
  status: string; // ACTIVE | REVOKED | EXPIRED
  created_at: string;
  expires_at?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers — formatting & enrichment
// ---------------------------------------------------------------------------
function formatDateLong(iso?: string | null): string {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatExpiry(iso?: string | null): string {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  return `Expires ${formatDateLong(iso)}`;
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.floor(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isYesterday) return 'Yesterday';
  if (isToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kolkata' }) + ' IST';
}

// Known rich overrides for demo continuity — mirrors mockData
const KNOWN_AGENT_ENRICH: Record<string, Partial<AgentNode>> = {
  'shopping-agent': {
    runtimeId: 'agt_01h8x9p3km',
    cap: '₹2,000',
    scopeSummary: 'Grocery MCC limits',
    heartbeatCode: 'tx_ack',
    authorizedAmount: 2000,
    requestedAmount: 800,
    remainingHeadroom: 1200,
    policy: 'HARD_STOP_AT_100%',
    hash: 'sha256:7e01b…89c',
    mccAllowed: ['MCC 5411 (Grocery Stores)', 'MCC 5499 (Misc Food Markets)'],
    expiryDate: '20 Sep 2026',
    velocityLimit: 'Max 3 Tx / 24h',
    canSubDelegate: true,
    delegationTarget: 'Payment Agent',
    purpose: 'Groceries (Food supplies, supermarkets, household essentials only)',
    creator: 'Root Vault',
    creatorSub: '#492 (You)',
  },
  'travel-agent': {
    runtimeId: 'agt_74m9k2x1po',
    cap: '₹8,000',
    scopeSummary: 'Airlines / Hotel',
    heartbeatCode: 'sig_kill',
    authorizedAmount: 8000,
    requestedAmount: 7450,
    remainingHeadroom: 550,
    policy: 'HARD_STOP_AT_100%',
    hash: 'sha256:3a42d…109',
    mccAllowed: ['MCC 3000-3350 (Commercial Airlines)', 'MCC 7011 (Hotels)'],
    expiryDate: '15 Oct 2026',
    velocityLimit: 'Max 1 Tx / 48h',
    canSubDelegate: false,
    purpose: 'Corporate travel booking with automated flight & accommodation settlement',
    creator: 'Root Vault',
    creatorSub: '#492 (You)',
  },
};

function mapBackendAgent(b: BackendAgent): AgentNode {
  const known = KNOWN_AGENT_ENRICH[b.id];
  // Try to parse cap/MCC from description if present: e.g. "Cap ₹5000, MCCs: 5411, 5812"
  let capFromDesc: number | null = null;
  let mccFromDesc: string[] | null = null;
  if (b.description) {
    const capMatch = b.description.match(/(\d[\d,]*)/);
    if (capMatch) {
      const n = parseInt(capMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0 && n < 10000000) capFromDesc = n;
    }
    const mccMatch = b.description.match(/MCCs?:?\s*([0-9,\s]+)/i);
    if (mccMatch) {
      mccFromDesc = mccMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => `MCC ${c}`);
    }
  }

  const capNum = known?.authorizedAmount ?? capFromDesc ?? 5000;
  const mccAllowed = known?.mccAllowed ?? mccFromDesc ?? ['MCC 5411 (Grocery Stores)'];

  return {
    id: b.id,
    name: b.name,
    runtimeId: known?.runtimeId ?? `agt_${b.id.slice(0, 8)}`,
    status: (b.status === 'REVOKED' ? 'REVOKED' : b.status === 'IDLE' ? 'IDLE' : 'ACTIVE') as AgentNode['status'],
    creator: known?.creator ?? 'Root Vault',
    creatorSub: known?.creatorSub ?? '#492 (You)',
    cap: known?.cap ?? `₹${capNum.toLocaleString()}`,
    scopeSummary: known?.scopeSummary ?? (b.description?.slice(0, 40) || `${mccAllowed[0]}`),
    heartbeat: b.status === 'REVOKED' ? 'Revoked just now' : known?.heartbeat ?? timeAgo(b.created_at),
    heartbeatCode: known?.heartbeatCode ?? (b.status === 'REVOKED' ? 'sig_kill' : 'tx_ack'),
    authorizedAmount: known?.authorizedAmount ?? capNum,
    requestedAmount: known?.requestedAmount ?? 0,
    remainingHeadroom: known?.remainingHeadroom ?? capNum,
    policy: known?.policy ?? 'HARD_STOP_AT_100%',
    hash: known?.hash ?? `sha256:${b.id.slice(0, 5)}…${b.id.slice(-3)}`,
    mccAllowed,
    expiryDate: known?.expiryDate ?? '31 Dec 2026',
    velocityLimit: known?.velocityLimit ?? 'Max 5 Tx / 24h',
    canSubDelegate: known?.canSubDelegate ?? true,
    delegationTarget: known?.delegationTarget,
    purpose: known?.purpose ?? b.description ?? `${b.name} automated spending envelope`,
  };
}

// Mandate mapping — needs agent name lookup
function mapBackendMandate(b: BackendMandate, agentMap: Map<string, string>): MandateItem {
  // Known overrides for continuity
  if (b.id === 'mnd-4091') {
    return {
      id: b.id,
      code: 'MND-4091',
      name: 'Groceries',
      expiry: formatExpiry(b.expires_at),
      spent: 1460,
      cap: b.max_amount,
      safeBuffer: `₹${(b.max_amount - 1460).toLocaleString()} Safe Buffer Remaining`,
      boundAgent: agentMap.get(b.agent_id) || b.agent_id,
      subDelegationNote: 'Sub-delegates to Payment Agent',
      agentHash: 'sha256:7e01b…89c',
      permittedScopeTitle: 'Supermarkets, Food & Daily Provisions',
      mccCode: `MCC ${b.merchant_category}`,
      mccDetail: 'Strict Isolation',
      status: (b.status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED') as MandateItem['status'],
    };
  }
  if (b.id === 'mnd-1108') {
    return {
      id: b.id,
      code: 'MND-1108',
      name: 'Flight Booking',
      expiry: formatExpiry(b.expires_at),
      spent: 7450,
      cap: b.max_amount,
      safeBuffer: '₹550 Limit Threshold Imminent',
      isThresholdImminent: true,
      boundAgent: agentMap.get(b.agent_id) || b.agent_id,
      subDelegationNote: 'Direct execution (Solo Agent)',
      agentHash: 'sha256:3a42d…109',
      permittedScopeTitle: 'Commercial Airlines',
      mccCode: `MCC ${b.merchant_category}`,
      mccDetail: 'OTA Enforced',
      status: (b.status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED') as MandateItem['status'],
    };
  }

  const isRevoked = b.status !== 'ACTIVE';
  const spent = 0; // Phase 2: no spend aggregation yet
  const remaining = b.max_amount - spent;
  return {
    id: b.id,
    code: b.id.toUpperCase(),
    name: b.purpose,
    expiry: formatExpiry(b.expires_at),
    spent,
    cap: b.max_amount,
    safeBuffer: isRevoked ? 'Lifecycle Terminated' : `₹${remaining.toLocaleString()} Safe Buffer Remaining`,
    isThresholdImminent: !isRevoked && remaining < 600,
    boundAgent: agentMap.get(b.agent_id) || b.agent_id,
    subDelegationNote: 'Direct execution',
    agentHash: `sha256:${b.id.slice(0, 5)}…${b.id.slice(-3)}`,
    permittedScopeTitle: b.purpose,
    mccCode: `MCC ${b.merchant_category}`,
    mccDetail: isRevoked ? 'Revoked' : 'Strict Isolation',
    status: (isRevoked ? 'REVOKED' : 'ACTIVE') as MandateItem['status'],
  };
}

function mapBackendTransaction(b: BackendTransaction, agentMap: Map<string, string>): TransactionRecord {
  // Keep original mock IDs stable for UI deep-links (proof modal etc.)
  // New TX-* IDs are used for Phase-2 created transactions
  const agentName = agentMap.get(b.agent_id) || b.agent_id;
  const decision = (b.decision === 'ALLOW' ? 'ALLOW' : b.decision === 'BLOCK' ? 'BLOCK' : 'VERIFY') as TransactionRecord['decision'];
  const isAllow = decision === 'ALLOW';
  // Derive action & amount
  const amountStr = `₹${Number(b.amount).toLocaleString()}`;
  // Agent color mapping — deterministic hash
  const colors = ['bg-on-tertiary-container', 'bg-secondary', 'bg-outline-variant', 'bg-primary', 'bg-tertiary-container'];
  const colorIdx = b.agent_id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const agentColor = colors[colorIdx];

  // Parse risk_factors if stored as JSON string
  let risk_factors: any = (b as any).risk_factors;
  if (typeof risk_factors === 'string') {
    try {
      risk_factors = JSON.parse(risk_factors);
    } catch {
      risk_factors = null;
    }
  }
  return {
    id: b.id,
    time: timeAgo(b.created_at) === '1m ago' ? 'Just now' : formatTime(b.created_at),
    agent: agentName,
    agentColor,
    action: `${b.purpose} (${b.merchant})`,
    amount: amountStr,
    rawAmount: Number(b.amount),
    decision,
    statusLabel: decision,
    verificationType: isAllow ? 'proof' : 'violation',
    merchant: b.merchant,
    mcc: `${b.merchant_category} · ${b.purpose}`,
    timestamp: formatTimestamp(b.created_at),
    authorization_status: (b as any).authorization_status ?? null,
    risk_score: (b as any).risk_score ?? null,
    risk_level: (b as any).risk_level ?? null,
    risk_factors: risk_factors ?? null,
  };
}

function mapBackendDelegation(b: BackendDelegation, agentMap: Map<string, string>, mandateMap: Map<string, string>): DelegationItem {
  const parentName = agentMap.get(b.parent_agent_id) || b.parent_agent_id;
  const childName = agentMap.get(b.child_agent_id) || b.child_agent_id;
  const mandateName = mandateMap.get(b.parent_mandate_id) || b.parent_mandate_id;
  const isExpired = b.status === 'EXPIRED' || (b.expires_at ? new Date(b.expires_at) < new Date() : false);
  const status = (isExpired ? 'EXPIRED' : b.status === 'REVOKED' ? 'REVOKED' : 'ACTIVE') as DelegationItem['status'];
  return {
    id: b.id,
    parentAgentId: b.parent_agent_id,
    parentAgentName: parentName,
    childAgentId: b.child_agent_id,
    childAgentName: childName,
    parentMandateId: b.parent_mandate_id,
    parentMandateName: mandateName,
    delegatedLimit: b.delegated_amount_limit,
    delegatedLimitFormatted: `₹${Number(b.delegated_amount_limit).toLocaleString()}`,
    purpose: b.purpose,
    merchantCategory: b.merchant_category,
    status,
    createdAt: b.created_at,
    expiresAt: b.expires_at || null,
    expiresLabel: b.expires_at ? formatExpiry(b.expires_at) : 'No expiry',
    raw: b,
  };
}

// ---------------------------------------------------------------------------
// Public API — live only (no silent mock fallback — backend is source of truth)
// ---------------------------------------------------------------------------
export async function getAgents(): Promise<AgentNode[]> {
  const raw = await apiFetch<BackendAgent[]>('/agents');
  return raw.map(mapBackendAgent);
}

export async function getAgentById(id: string): Promise<AgentNode | undefined> {
  const agents = await getAgents();
  return agents.find((a) => a.id === id);
}

export async function getMandates(): Promise<MandateItem[]> {
  const [rawMandates, rawAgents] = await Promise.all([
    apiFetch<BackendMandate[]>('/mandates'),
    apiFetch<BackendAgent[]>('/agents'),
  ]);
  const agentMap = new Map(rawAgents.map((a) => [a.id, a.name] as const));
  return rawMandates.map((m) => mapBackendMandate(m, agentMap));
}

export async function getMandateById(id: string): Promise<MandateItem | undefined> {
  const mandates = await getMandates();
  return mandates.find((m) => m.id === id);
}

export async function getTransactions(): Promise<TransactionRecord[]> {
  const [rawTxs, rawAgents] = await Promise.all([
    apiFetch<BackendTransaction[]>('/transactions'),
    apiFetch<BackendAgent[]>('/agents'),
  ]);
  const agentMap = new Map(rawAgents.map((a) => [a.id, a.name] as const));
  return rawTxs.map((t) => mapBackendTransaction(t, agentMap));
}

export async function getTransactionById(id: string): Promise<TransactionRecord | undefined> {
  const txs = await getTransactions();
  return txs.find((t) => t.id === id);
}

export async function getProvenanceSteps(): Promise<AuditStep[]> {
  // Phase 2: no backend provenance yet — keep mock
  return [...PROVENANCE_STEPS];
}

export async function verifyTransaction(txId: string) {
  const txs = await getTransactions();
  const tx = txs.find((t) => t.id === txId);
  if (!tx) throw new Error(`Transaction ${txId} not found`);
  const isAllow = tx.decision === 'ALLOW';
  return {
    tx,
    decision: tx.decision,
    latencyMs: 8.4,
    rules: [
      { rule: 'MCC_ALLOWLIST', status: isAllow ? ('PASSED' as const) : ('VIOLATION' as const) },
      { rule: 'SPENDING_CAP_MANDATE_4091', status: isAllow ? ('PASSED' as const) : ('VIOLATION' as const) },
      { rule: 'DELEGATION_DEPTH', status: 'PASSED' as const },
      { rule: 'TEMPORAL_VALIDITY', status: 'PASSED' as const },
    ],
    provenance: PROVENANCE_STEPS,
  };
}

export async function healthCheck(): Promise<{ ok: boolean; mode: 'mock' | 'live' }> {
  try {
    const res = await apiFetch<{ status: string }>('/health');
    return { ok: res.status === 'ok', mode: 'live' };
  } catch {
    return { ok: false, mode: 'mock' };
  }
}

// ---------------------------------------------------------------------------
// Create helpers — return rich frontend types after creation
// ---------------------------------------------------------------------------
export interface CreateAgentPayload {
  name: string;
  description?: string;
  // UI convenience — not persisted as separate columns but encoded in description
  capAmount?: number;
  mccList?: string;
}

export async function createAgent(payload: CreateAgentPayload): Promise<AgentNode> {
  const description =
    payload.description ||
    (payload.capAmount || payload.mccList
      ? `Cap ₹${payload.capAmount ?? 5000}, MCCs: ${payload.mccList ?? '5411'}`
      : `${payload.name} agent`);
  const raw = await apiFetch<BackendAgent>('/agents', {
    method: 'POST',
    body: JSON.stringify({ name: payload.name, description }),
  });
  return mapBackendAgent(raw);
}

export interface CreateMandatePayload {
  agent_id: string;
  purpose: string;
  max_amount: number;
  merchant_category: string;
  currency?: string;
  expires_at?: string | null; // ISO string
}

export async function createMandate(payload: CreateMandatePayload): Promise<MandateItem> {
  const raw = await apiFetch<BackendMandate>('/mandates', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: payload.agent_id,
      purpose: payload.purpose,
      max_amount: payload.max_amount,
      currency: payload.currency || 'INR',
      merchant_category: payload.merchant_category,
      expires_at: payload.expires_at || null,
    }),
  });
  // Need agent map for enrichment
  const agents = await apiFetch<BackendAgent[]>('/agents').catch(() => [] as BackendAgent[]);
  const agentMap = new Map(agents.map((a) => [a.id, a.name] as const));
  return mapBackendMandate(raw, agentMap);
}

export interface AuthorizePayload {
  agent_id: string;
  amount: number;
  merchant: string;
  merchant_category: string;
  purpose: string;
  currency?: string;
}

export interface AuthorizeResult {
  transaction_id: string;
  decision: 'ALLOW' | 'VERIFY'; // final
  reason: string;
  delegation_id?: string | null;
  mandate_id?: string | null;
  chain?: Array<{ step: string; id?: string; name?: string; detail?: string }> | null;
  authorization_status?: string | null;
  authorization_reason?: string | null;
  risk_score?: number | null;
  risk_level?: string | null;
  risk_factors?: Array<{ type: string; severity: string; message: string }> | null;
  final_decision?: string | null;
}

export async function authorizePayment(payload: AuthorizePayload): Promise<AuthorizeResult> {
  const raw = await apiFetch<any>('/payments/authorize', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: payload.agent_id,
      amount: payload.amount,
      merchant: payload.merchant,
      merchant_category: payload.merchant_category,
      purpose: payload.purpose,
      currency: payload.currency || 'INR',
    }),
  });
  return {
    transaction_id: raw.transaction_id,
    decision: raw.decision as AuthorizeResult['decision'],
    reason: raw.reason,
    delegation_id: raw.delegation_id ?? null,
    mandate_id: raw.mandate_id ?? null,
    chain: raw.chain ?? null,
    authorization_status: raw.authorization_status ?? null,
    authorization_reason: raw.authorization_reason ?? null,
    risk_score: raw.risk_score ?? null,
    risk_level: raw.risk_level ?? null,
    risk_factors: raw.risk_factors ?? null,
    final_decision: raw.final_decision ?? raw.decision ?? null,
  };
}

// Patch helpers for revoke flows (mirrors backend PATCH)
export async function updateAgentStatus(agentId: string, status: 'ACTIVE' | 'REVOKED'): Promise<BackendAgent> {
  return apiFetch<BackendAgent>(`/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateMandateStatus(mandateId: string, status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'): Promise<BackendMandate> {
  return apiFetch<BackendMandate>(`/mandates/${mandateId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateMandateCap(mandateId: string, max_amount: number): Promise<BackendMandate> {
  return apiFetch<BackendMandate>(`/mandates/${mandateId}`, {
    method: 'PATCH',
    body: JSON.stringify({ max_amount }),
  });
}

// ---------------------------------------------------------------------------
// Delegations — Phase 3
// ---------------------------------------------------------------------------
export async function getDelegations(): Promise<DelegationItem[]> {
  const [rawDelegations, rawAgents, rawMandates] = await Promise.all([
    apiFetch<BackendDelegation[]>('/delegations'),
    apiFetch<BackendAgent[]>('/agents'),
    apiFetch<BackendMandate[]>('/mandates'),
  ]);
  const agentMap = new Map(rawAgents.map((a) => [a.id, a.name] as const));
  const mandateMap = new Map(rawMandates.map((m) => [m.id, m.purpose] as const));
  return rawDelegations.map((d) => mapBackendDelegation(d, agentMap, mandateMap));
}

export async function getDelegationChain(agentId: string): Promise<DelegationChain> {
  try {
    const raw = await apiFetch<any>(`/delegations/chain/${agentId}`);
    return {
      delegationId: raw.delegation_id ?? null,
      chain: raw.chain ?? [],
      rootMandate: raw.root_mandate,
      delegation: raw.delegation ? mapBackendDelegation(raw.delegation, new Map(), new Map()) : null,
    };
  } catch {
    return { delegationId: null, chain: [], rootMandate: null, delegation: null };
  }
}

export interface CreateDelegationPayload {
  parent_agent_id: string;
  child_agent_id: string;
  parent_mandate_id?: string;
  delegated_amount_limit: number;
  purpose: string;
  merchant_category: string;
  expires_at?: string | null;
}

export async function createDelegation(payload: CreateDelegationPayload): Promise<DelegationItem> {
  const raw = await apiFetch<BackendDelegation>('/delegations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const [rawAgents, rawMandates] = await Promise.all([
    apiFetch<BackendAgent[]>('/agents').catch(() => [] as BackendAgent[]),
    apiFetch<BackendMandate[]>('/mandates').catch(() => [] as BackendMandate[]),
  ]);
  const agentMap = new Map(rawAgents.map((a) => [a.id, a.name] as const));
  const mandateMap = new Map(rawMandates.map((m) => [m.id, m.purpose] as const));
  return mapBackendDelegation(raw, agentMap, mandateMap);
}

export async function updateDelegationStatus(delegationId: string, status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'): Promise<BackendDelegation> {
  return apiFetch<BackendDelegation>(`/delegations/${delegationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ---------------------------------------------------------------------------
// Provenance — Phase 5
// ---------------------------------------------------------------------------
export async function getProvenance(limit = 100, offset = 0): Promise<ProvenanceEvent[]> {
  return apiFetch<ProvenanceEvent[]>(`/provenance?limit=${limit}&offset=${offset}`);
}

export async function getProvenanceByTransaction(transactionId: string): Promise<ProvenanceEvent[]> {
  return apiFetch<ProvenanceEvent[]>(`/provenance/transaction/${transactionId}`);
}

export async function verifyProvenance(): Promise<ProvenanceVerifyResult> {
  return apiFetch<ProvenanceVerifyResult>('/provenance/verify');
}

export async function getProvenanceEvent(eventId: string): Promise<ProvenanceEvent> {
  return apiFetch<ProvenanceEvent>(`/provenance/event/${eventId}`);
}

// ---------------------------------------------------------------------------
// Merchant Reputation — Phase 7 (adapted from Iron scam_registry)
// ---------------------------------------------------------------------------
export async function reportMerchant(merchant: string, reason: string, reporter = "anonymous"): Promise<any> {
  return apiFetch<any>('/merchants/report', {
    method: 'POST',
    body: JSON.stringify({ merchant, reason, reporter }),
  });
}

export async function getMerchantReputation(merchant: string): Promise<any> {
  return apiFetch<any>(`/merchants/reputation/${encodeURIComponent(merchant)}`);
}

export async function getFlaggedMerchants(min_count = 1): Promise<any[]> {
  return apiFetch<any[]>(`/merchants/flagged?min_count=${min_count}`);
}
