/**
 * Bound — Persistent domain agents (Phase 2).
 *
 * A "domain" is a long-lived area of user spending (Food, Travel, Shopping).
 * Each domain resolves to ONE real backend agent via its EXPLICIT backend
 * `domain` field (FOOD / TRAVEL / SHOPPING / OTHER). Keyword inference is
 * retired: it must never decide which agent has authority. Keywords survive
 * only in the intent parser, which guesses what the user MEANT — never who
 * may spend.
 *
 * Centralized domain ↔ category mapping (single source of truth for the UI):
 *
 *   FOOD      → Grocery, Dining
 *   TRAVEL    → Airlines, Hotels, Transport
 *   SHOPPING  → General, Electronics, Apparel
 *
 * Backend authorization still strictly requires purpose AND category to
 * satisfy the mandate — this mapping only guides setup defaults and display.
 * A Grocery-only rule requested for Electronics still returns VERIFY.
 */

import type { AgentNode, MandateItem } from './types';

export type DomainId = 'food' | 'travel' | 'shopping' | 'bills';

export const DOMAIN_CATEGORIES: Record<DomainId, string[]> = {
  food: ['Grocery', 'Dining'],
  travel: ['Airlines', 'Hotels', 'Transport'],
  shopping: ['General', 'Electronics', 'Apparel'],
  bills: ['Utilities', 'Subscriptions', 'Bills'],
};

export interface DomainDef {
  id: DomainId;
  label: string;
  /** Short user-facing noun, e.g. "Food Agent". */
  agentLabel: string;
  icon: string;
  /** Unit word for displaying a per-transaction cap honestly. */
  unitWord: 'order' | 'booking' | 'payment';
  /** Suggested values for the explicit setup flow (user confirms/edits). */
  suggestedAgentName: string;
  suggestedPurpose: string;
  suggestedCap: number;
  /** Categories this domain covers (subset of DOMAIN_CATEGORIES[id]).
   *  The user explicitly picks one during setup — never assumed. */
  categories: string[];
}

export const DOMAINS: DomainDef[] = [
  {
    id: 'food',
    label: 'Food',
    agentLabel: 'Food Agent',
    icon: '🍴',
    unitWord: 'order',
    suggestedAgentName: 'Food Agent',
    // Worded to overlap the requests users actually make ("dinner",
    // "groceries"): the backend matches purpose by shared wording, so the
    // rule states the wording it covers instead of surprising the user.
    suggestedPurpose: 'Food, dinner and groceries',
    suggestedCap: 1000,
    categories: DOMAIN_CATEGORIES.food,
  },
  {
    id: 'travel',
    label: 'Travel',
    agentLabel: 'Travel Agent',
    icon: '✈️',
    unitWord: 'booking',
    suggestedAgentName: 'Travel Agent',
    suggestedPurpose: 'Flights, hotels and travel',
    suggestedCap: 15000,
    categories: DOMAIN_CATEGORIES.travel,
  },
  {
    id: 'shopping',
    label: 'Shopping',
    agentLabel: 'Shopping Agent',
    icon: '🛍',
    unitWord: 'order',
    suggestedAgentName: 'Shopping Agent',
    suggestedPurpose: 'Shopping, electronics and apparel',
    suggestedCap: 5000,
    categories: DOMAIN_CATEGORIES.shopping,
  },
  {
    id: 'bills',
    label: 'Bills',
    agentLabel: 'Bills Agent',
    icon: '🧾',
    unitWord: 'payment',
    suggestedAgentName: 'Bills Agent',
    suggestedPurpose: 'Utilities, subscriptions and bills',
    suggestedCap: 5000,
    categories: DOMAIN_CATEGORIES.bills,
  },
];

export interface DomainResolution {
  domain: DomainDef;
  agent: AgentNode;
  mandate: MandateItem;
}

/**
 * Resolve a domain to a real backend agent + standing mandate using the
 * EXPLICIT backend domain field. Task agents are never eligible. The mandate
 * is the agent's most recently created ACTIVE one. Returns null when nothing
 * matches — the domain is "not set up".
 */
export function resolveDomainAgent(
  domainId: DomainId,
  agents: AgentNode[],
  mandates: MandateItem[]
): DomainResolution | null {
  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) return null;
  const want = domainId.toUpperCase();
  const agent = agents.find((a) => a.domain === want && a.status === 'ACTIVE' && !a.is_task_agent);
  if (!agent) return null;
  const mandate =
    mandates
      .filter((m) => m.agent_id === agent.id && m.status === 'ACTIVE')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
  if (!mandate) return null;
  return { domain, agent, mandate };
}

/** Plain-language summary of a standing rule, e.g. "₹2,000 per order". */
export function ruleSummary(mandate: MandateItem, domain: DomainDef): string {
  return `₹${mandate.max_amount.toLocaleString()} per ${domain.unitWord}`;
}

/** "Food · Grocery" style scope line distinguishing domain from category. */
export function scopeLine(domain: DomainDef, category: string): string {
  return `${domain.label} · ${category}`;
}

// ---------------------------------------------------------------------------
// Display-only wording check.
//
// Ports the backend's matching idea (shared wording between rule and
// request) for one purpose: warning the user BEFORE the check that their
// request is worded differently from the rule, so VERIFY is not a surprise.
// This NEVER authorizes anything — the backend engine alone decides.
// ---------------------------------------------------------------------------
function normalizeWord(s: string): string {
  return (s || '').trim().toLowerCase();
}

function wordsOverlap(a: string, b: string): boolean {
  const x = normalizeWord(a);
  const y = normalizeWord(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const xt = new Set(x.split(/\s+/));
  for (const t of y.split(/\s+/)) {
    if (xt.has(t)) return true;
  }
  return false;
}

/** True when the request purpose shares wording with the rule's purpose or category. */
export function purposeOverlapsRule(rulePurpose: string, ruleCategory: string, requestPurpose: string): boolean {
  return wordsOverlap(rulePurpose, requestPurpose) || wordsOverlap(ruleCategory, requestPurpose);
}
