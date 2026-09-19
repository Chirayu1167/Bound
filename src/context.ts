/**
 * Bound — Session context awareness (Phase 5).
 *
 * Deterministic, explainable, frontend-only. No LLM, no embeddings, no
 * persistence (in-memory React state only — nothing sensitive in storage).
 *
 * CORE INVARIANT: context can suggest, authority decides.
 * Everything here produces PROPOSALS shown to the user or prefilled into
 * the TaskCard form. Nothing here authorizes anything: the TaskCard still
 * requires an explicit "Check with Bound" click, and the backend engine
 * (mandate / delegation / risk) decides from its own inputs only. History
 * is never sent to any authorize endpoint as authority.
 *
 * Layers:
 *  1. SessionContext — this conversation's working memory (last request,
 *     last task, last payment). Replaced as new requests arrive.
 *  2. detectReference — deterministic phrase matching on the raw text.
 *     Explicit amounts/merchants in the text always win over references.
 *  3. Resolution helpers — pure functions over REAL recorded transactions.
 *     "Usual" requires >= 2 approved data points, else null (never invented).
 */

import type { DomainId } from './domains';
import type { TransactionRecord } from './types';

export interface SessionContext {
  domainId: DomainId | null;
  purpose: string | null;
  merchant: string | null;
  /** Last explicitly stated or confirmed amount (never inferred silently). */
  amount: number | null;
  category: string | null;
  agentId: string | null;
  lastTaskStatus: string | null;
  lastPaymentAt: number | null;
  updatedAt: number;
}

export const emptySession: SessionContext = {
  domainId: null,
  purpose: null,
  merchant: null,
  amount: null,
  category: null,
  agentId: null,
  lastTaskStatus: null,
  lastPaymentAt: null,
  updatedAt: 0,
};

export type ReferenceKind =
  | 'spending-query'
  | 'usual-budget'
  | 'last-transaction'
  | 'same-merchant'
  | 'cheaper'
  | 'none';

function hasWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function hasAnyWord(text: string, phrases: string[]): boolean {
  return phrases.some((p) => hasWord(text, p));
}

const SPENDING_QUERY_PHRASES = [
  'what did i spend',
  'how much did i spend',
  'how much have i spent',
  'recent dinners',
  'recent orders',
  'recent payments',
  'recent spending',
  'spending history',
  'show spending',
  'show my spending',
  'my spending',
];

const USUAL_BUDGET_PHRASES = [
  'same as usual',
  'like usual',
  'usual budget',
  'my usual',
  'normal amount',
  'usual amount',
  'same budget',
  'use my usual',
];

const LAST_TX_PHRASES = [
  'same as last time',
  'same thing as last',
  'like yesterday',
  'same as yesterday',
  'make it like yesterday',
  'that one',
  'the previous one',
  'previous one',
  'last time',
  'last order',
  'repeat that',
  'repeat it',
  'again like last',
];

const SAME_MERCHANT_PHRASES = [
  'same place',
  'same merchant',
  'same restaurant',
  'same shop',
  'same store',
];

const CHEAPER_PHRASES = ['cheaper', 'spend less', 'cut back', 'lower amount', 'less than that'];

/**
 * Classify what kind of contextual reference (if any) the text makes.
 * Explicit values in the text suppress budget references: "₹800, same as
 * last time" keeps the explicit ₹800 (merchant may still be borrowed only
 * when the text names no merchant — handled by the caller).
 */
export function detectReference(text: string, hasExplicitAmount: boolean): ReferenceKind {
  const t = (text || '').trim();
  if (!t) return 'none';
  if (hasAnyWord(t, SPENDING_QUERY_PHRASES)) return 'spending-query';
  if (hasAnyWord(t, LAST_TX_PHRASES)) return 'last-transaction';
  if (!hasExplicitAmount) {
    if (hasAnyWord(t, USUAL_BUDGET_PHRASES)) return 'usual-budget';
    if (hasAnyWord(t, CHEAPER_PHRASES)) return 'cheaper';
  }
  if (hasAnyWord(t, SAME_MERCHANT_PHRASES)) return 'same-merchant';
  return 'none';
}

export interface DomainHistory {
  /** Approved transactions in the domain's categories, newest first. */
  approved: TransactionRecord[];
  /** Most recent approved transaction, if any. */
  last: TransactionRecord | null;
}

/** Real approved history for a domain's categories, newest first. */
export function historyForDomain(
  transactions: TransactionRecord[],
  categories: string[]
): DomainHistory {
  const cats = categories.map((c) => c.toLowerCase());
  const approved = transactions
    .filter(
      (t) =>
        t.decision === 'ALLOW' &&
        cats.some((c) => (t.merchant_category || '').toLowerCase().includes(c))
    )
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { approved, last: approved[0] || null };
}

/** Median of approved amounts, or null when there is no history. */
export function medianApproved(history: DomainHistory): number | null {
  if (history.approved.length === 0) return null;
  const sorted = history.approved
    .map((t) => t.rawAmount)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

export function formatINR(n: number): string {
  return `₹${Math.round(n).toLocaleString()}`;
}
