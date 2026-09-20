/**
 * Bound — Live API layer.
 *
 * Backend contract (SQLite):
 *  agents:       id, name, description, status, created_at
 *  mandates:     id, agent_id, purpose, max_amount, currency, merchant_category, expires_at, status, created_at
 *  delegations:  id, parent_agent_id, child_agent_id, parent_mandate_id, delegated_amount_limit, purpose, merchant_category, status, created_at, expires_at
 *  transactions: id, agent_id, mandate_id, delegation_id, amount, currency, merchant, merchant_category, purpose, decision, reason, created_at
 *
 * VITE_API_URL controls the base. In local development (page served from
 * localhost) it falls back to http://localhost:4000. In production it must
 * be baked in at build time — there is intentionally no localhost fallback,
 * so a missing VITE_API_URL fails loudly instead of silently hitting localhost.
 */

import type { AgentNode, MandateItem, TransactionRecord, DelegationItem, DelegationChain, ProvenanceEvent, ProvenanceVerifyResult, TaskItem, ApprovalItem, MockPaymentItem } from '../types';

const RAW_URL = ((import.meta.env.VITE_API_URL as string | undefined) || '').trim();

function resolveApiUrl(): string {
  const cleaned = RAW_URL.replace(/\/+$/, '');
  if (cleaned) return cleaned;
  // Local-dev fallback only when the page itself runs on localhost.
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.localhost')) {
      return 'http://localhost:4000';
    }
    console.error('[api] VITE_API_URL is not configured — rebuild with VITE_API_URL set to the public backend URL.');
    return '';
  }
  return 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();
const BASE = API_URL;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText} at ${url}: ${text}`);
  }
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
  status: string;
  domain?: string | null;
  is_task_agent?: boolean | null;
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
  status: string;
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
  decision: string;
  reason: string;
  created_at: string;
  authorization_status?: string | null;
  risk_score?: number | null;
  risk_level?: string | null;
  risk_factors?: unknown;
}
interface BackendDelegation {
  id: string;
  parent_agent_id: string;
  child_agent_id: string;
  parent_mandate_id: string;
  delegated_amount_limit: number;
  purpose: string;
  merchant_category: string;
  status: string;
  created_at: string;
  expires_at?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers — formatting only (no invented data)
// ---------------------------------------------------------------------------
function formatDateLong(iso?: string | null): string {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'No expiry';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatExpiry(iso?: string | null): string {
  if (!iso) return 'No expiry';
  return `Until ${formatDateLong(iso)}`;
}
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function mapBackendAgent(b: BackendAgent): AgentNode {
  const d = (b.domain || 'OTHER').toUpperCase();
  return {
    id: b.id,
    name: b.name,
    description: b.description || '',
    status: (b.status === 'REVOKED' ? 'REVOKED' : 'ACTIVE') as AgentNode['status'],
    domain: (d === 'FOOD' || d === 'TRAVEL' || d === 'SHOPPING' ? d : 'OTHER') as AgentNode['domain'],
    is_task_agent: b.is_task_agent === true,
    created_at: b.created_at,
  };
}

function mapBackendMandate(b: BackendMandate, agentMap: Map<string, string>): MandateItem {
  const agentName = agentMap.get(b.agent_id) || b.agent_id;
  const status = (b.status === 'REVOKED' ? 'REVOKED' : b.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE') as MandateItem['status'];
  return {
    id: b.id,
    code: b.id.toUpperCase(),
    agent_id: b.agent_id,
    agentName,
    purpose: b.purpose,
    max_amount: b.max_amount,
    cap: b.max_amount,
    merchant_category: b.merchant_category,
    status,
    created_at: b.created_at,
    expires_at: b.expires_at || null,
    expiresLabel: formatExpiry(b.expires_at),
    name: b.purpose,
    boundAgent: agentName,
    expiry: formatExpiry(b.expires_at),
  };
}

function parseRiskFactors(raw: unknown): TransactionRecord['risk_factors'] {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw
      .filter((f) => f && typeof f === 'object')
      .map((f) => {
        const o = f as Record<string, unknown>;
        const sev = String(o.severity || 'MEDIUM').toUpperCase();
        return {
          type: String(o.type || 'RISK'),
          severity: (sev === 'HIGH' ? 'HIGH' : sev === 'LOW' ? 'LOW' : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
          message: String(o.message || ''),
        };
      });
  }
  if (typeof raw === 'string') {
    try {
      return parseRiskFactors(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return null;
}

function mapBackendTransaction(b: BackendTransaction, agentMap: Map<string, string>): TransactionRecord {
  const agentName = agentMap.get(b.agent_id) || b.agent_id;
  const decision = (b.decision === 'ALLOW' ? 'ALLOW' : 'VERIFY') as TransactionRecord['decision'];
  const amountStr = `₹${Number(b.amount).toLocaleString()}`;
  return {
    id: b.id,
    agent_id: b.agent_id,
    agent: agentName,
    amount: amountStr,
    rawAmount: Number(b.amount),
    decision,
    reason: b.reason || '',
    merchant: b.merchant,
    merchant_category: b.merchant_category,
    purpose: b.purpose,
    mandate_id: b.mandate_id ?? null,
    delegation_id: b.delegation_id ?? null,
    created_at: b.created_at,
    time: timeAgo(b.created_at),
    timestamp: formatTimestamp(b.created_at),
    authorization_status: b.authorization_status ?? null,
    risk_score: b.risk_score ?? null,
    risk_level: b.risk_level ?? null,
    risk_factors: parseRiskFactors(b.risk_factors),
    action: `${b.purpose} (${b.merchant})`,
    mcc: b.merchant_category,
    statusLabel: decision,
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
// Public API
// ---------------------------------------------------------------------------
export async function getAgents(): Promise<AgentNode[]> {
  const raw = await apiFetch<BackendAgent[]>('/agents');
  return raw.map(mapBackendAgent);
}

export async function getMandates(): Promise<MandateItem[]> {
  const [rawMandates, rawAgents] = await Promise.all([
    apiFetch<BackendMandate[]>('/mandates'),
    apiFetch<BackendAgent[]>('/agents'),
  ]);
  const agentMap = new Map(rawAgents.map((a) => [a.id, a.name] as const));
  return rawMandates.map((m) => mapBackendMandate(m, agentMap));
}

export async function getTransactions(): Promise<TransactionRecord[]> {
  const [rawTxs, rawAgents] = await Promise.all([
    apiFetch<BackendTransaction[]>('/transactions'),
    apiFetch<BackendAgent[]>('/agents'),
  ]);
  const agentMap = new Map(rawAgents.map((a) => [a.id, a.name] as const));
  return rawTxs.map((t) => mapBackendTransaction(t, agentMap));
}

export async function healthCheck(): Promise<{ ok: boolean; mode: 'mock' | 'live' }> {
  try {
    const res = await apiFetch<{ status?: unknown }>('/health');
    // HTTP 200 alone is not enough — validate the health payload.
    // Accept case/whitespace variants of {"status":"ok"}; anything else is Offline.
    const status = String(res?.status ?? '').trim().toLowerCase();
    const ok = status === 'ok';
    return { ok, mode: 'live' };
  } catch {
    return { ok: false, mode: 'mock' };
  }
}

export interface CreateAgentPayload {
  name: string;
  description?: string;
  domain?: string;
}

export async function createAgent(payload: CreateAgentPayload): Promise<AgentNode> {
  const raw = await apiFetch<BackendAgent>('/agents', {
    method: 'POST',
    body: JSON.stringify({ name: payload.name, description: payload.description || '', domain: payload.domain || 'OTHER' }),
  });
  return mapBackendAgent(raw);
}

export interface CreateMandatePayload {
  agent_id: string;
  purpose: string;
  max_amount: number;
  merchant_category: string;
  currency?: string;
  expires_at?: string | null;
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
  decision: 'ALLOW' | 'VERIFY';
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
  const raw = await apiFetch<Record<string, unknown>>('/payments/authorize', {
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
    transaction_id: String(raw.transaction_id),
    decision: raw.decision as AuthorizeResult['decision'],
    reason: String(raw.reason || ''),
    delegation_id: (raw.delegation_id as string | null) ?? null,
    mandate_id: (raw.mandate_id as string | null) ?? null,
    chain: (raw.chain as AuthorizeResult['chain']) ?? null,
    authorization_status: (raw.authorization_status as string | null) ?? null,
    authorization_reason: (raw.authorization_reason as string | null) ?? null,
    risk_score: (raw.risk_score as number | null) ?? null,
    risk_level: (raw.risk_level as string | null) ?? null,
    risk_factors: (raw.risk_factors as AuthorizeResult['risk_factors']) ?? null,
    final_decision: ((raw.final_decision ?? raw.decision) as string | null) ?? null,
  };
}

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
// Delegations
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
    const raw = await apiFetch<{ delegation_id?: string | null; chain?: DelegationChain['chain']; root_mandate?: unknown; delegation?: BackendDelegation | null }>('/delegations/chain/' + encodeURIComponent(agentId));
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
// Provenance
// ---------------------------------------------------------------------------
export async function getProvenance(limit = 100, offset = 0): Promise<ProvenanceEvent[]> {
  return apiFetch<ProvenanceEvent[]>(`/provenance?limit=${limit}&offset=${offset}`);
}

export async function getProvenanceByTransaction(transactionId: string): Promise<ProvenanceEvent[]> {
  return apiFetch<ProvenanceEvent[]>(`/provenance/transaction/${encodeURIComponent(transactionId)}`);
}

export async function verifyProvenance(): Promise<ProvenanceVerifyResult> {
  return apiFetch<ProvenanceVerifyResult>('/provenance/verify');
}

// ---------------------------------------------------------------------------
// Tasks + Approvals — Phase 2
// ---------------------------------------------------------------------------
export interface TaskAuthorizePayload {
  domain_agent_id: string;
  purpose: string;
  requested_amount: number;
  category: string;
  merchant: string;
  currency?: string;
  idempotency_key?: string;
}

export interface TaskAuthorizeResult {
  task: TaskItem;
  approval: ApprovalItem | null;
  /** Plaintext one-time token — returned exactly once, only with a new approval. */
  approval_token: string | null;
}

export async function authorizeTask(payload: TaskAuthorizePayload): Promise<TaskAuthorizeResult> {
  return apiFetch<TaskAuthorizeResult>('/tasks/authorize', {
    method: 'POST',
    body: JSON.stringify({
      domain_agent_id: payload.domain_agent_id,
      purpose: payload.purpose,
      requested_amount: payload.requested_amount,
      category: payload.category,
      merchant: payload.merchant,
      currency: payload.currency || 'INR',
      idempotency_key: payload.idempotency_key || null,
    }),
  });
}

export async function getTasks(status?: string): Promise<TaskItem[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<TaskItem[]>(`/tasks${q}`);
}

export async function getTask(taskId: string): Promise<TaskItem> {
  return apiFetch<TaskItem>(`/tasks/${encodeURIComponent(taskId)}`);
}

export async function cancelTask(taskId: string): Promise<TaskItem> {
  return apiFetch<TaskItem>(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
}

export async function getApprovals(status?: string, taskId?: string): Promise<ApprovalItem[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (taskId) params.set('task_id', taskId);
  const q = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<ApprovalItem[]>(`/approvals${q}`);
}

export async function resolveApproval(approvalId: string, token: string, action: 'approve' | 'deny'): Promise<ApprovalItem> {
  return apiFetch<ApprovalItem>(`/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ token, action }),
  });
}

// ---------------------------------------------------------------------------
// Mock payments — Phase 3 (simulated execution for APPROVED tasks only)
// ---------------------------------------------------------------------------
export async function createMockPayment(taskId: string, paymentMethod = 'Demo Balance', note?: string): Promise<MockPaymentItem> {
  return apiFetch<MockPaymentItem>('/mock-payments/create', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, payment_method: paymentMethod, note: note || null }),
  });
}

export async function executeMockPayment(
  paymentId: string,
  simulateFailure = false,
  actualAmount?: number | null,
  itemSummary?: string | null,
): Promise<MockPaymentItem> {
  return apiFetch<MockPaymentItem>(`/mock-payments/${encodeURIComponent(paymentId)}/execute`, {
    method: 'POST',
    body: JSON.stringify({
      simulate_failure: simulateFailure,
      ...(actualAmount != null ? { actual_amount: actualAmount } : {}),
      ...(itemSummary ? { item_summary: itemSummary } : {}),
    }),
  });
}

export async function getMockPayment(paymentId: string): Promise<MockPaymentItem> {
  return apiFetch<MockPaymentItem>(`/mock-payments/${encodeURIComponent(paymentId)}`);
}

export async function getMockPayments(taskId?: string): Promise<MockPaymentItem[]> {
  const q = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  return apiFetch<MockPaymentItem[]>(`/mock-payments${q}`);
}

// ---------------------------------------------------------------------------
// Demo wallet — backend-owned simulated funds (never hardcoded in UI)
// ---------------------------------------------------------------------------
export interface WalletInfo {
  balance: number;
  currency: string;
  total_credited: number;
  total_debited: number;
  transaction_count: number;
  updated_at: string | null;
}

export interface WalletTx {
  id: string;
  direction: 'DEBIT' | 'CREDIT';
  kind: string;
  amount: number;
  currency: string;
  balance_after: number;
  merchant: string | null;
  agent_id: string | null;
  task_id: string | null;
  payment_id: string | null;
  note: string | null;
  created_at: string;
}

export async function getWallet(): Promise<WalletInfo> {
  return apiFetch<WalletInfo>('/wallet');
}

export async function getWalletTransactions(limit = 50): Promise<WalletTx[]> {
  return apiFetch<WalletTx[]>(`/wallet/transactions?limit=${limit}`);
}

export async function topupWallet(amount: number): Promise<WalletInfo> {
  return apiFetch<WalletInfo>('/wallet/topup', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

// ---------------------------------------------------------------------------
// Optional LLM intent assist — Groq behind the backend (key never in browser)
// ---------------------------------------------------------------------------
export interface InterpretResult {
  domain: 'food' | 'travel' | 'shopping' | 'bills' | null;
  purpose: string | null;
  budget: number | null;
  merchant: string | null;
  category: string | null;
  explanation: string | null;
  /** True when Groq produced this; false means deterministic fallback. */
  groq: boolean;
}

/**
 * Ask the backend to interpret free text with Groq. The backend returns 501
 * when GROQ_API_KEY is unset — like any other failure, the caller must fall
 * back to the local deterministic parser. The result only pre-fills a draft;
 * it never authorizes anything.
 */
export async function interpretRequest(text: string, timeoutMs = 6000): Promise<InterpretResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await apiFetch<InterpretResult>('/ai/interpret', {
      method: 'POST',
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
