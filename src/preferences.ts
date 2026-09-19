/**
 * Bound — Preference/memory architecture (Phase 1: schema + honest derived stats).
 *
 * IMPORTANT INVARIANT: Preferences ≠ Permission.
 * Preferences may inform agent behavior and risk detection. They MUST NEVER
 * increase authorization limits. A user who usually spends ₹500 on food must
 * still get Needs Review (or denial) on a ₹5,000 order unless their standing
 * mandate actually allows it. The backend authorization path already enforces
 * this by never reading preferences; this module documents where the future
 * preference layer will live so nobody wires it into authorization by mistake.
 *
 * PHASE 1 SCOPE: only the TypeScript schema below (proposed, not persisted)
 * plus ONE live helper — `usualSpendRange` — which computes a "usual spend"
 * display from REAL recorded transactions. It is display-only context for
 * approval cards ("Your usual food spend is ₹X–₹Y"); it is never sent to
 * `/payments/authorize` and cannot authorize anything.
 *
 * PHASE 2 (documented, not built): backend `preferences` table
 * (user-owned: diet, addresses, favorites, per-domain usuals), editable
 * Preferences UI, baseline snapshots feeding the risk engine as signals only.
 */

import type { TransactionRecord } from './types';
import type { DomainId } from './domains';

/** PROPOSED Phase-2 schema — not persisted anywhere in Phase 1. */
export interface UserProfile {
  dietaryPreference?: string; // e.g. "vegetarian"
  homeAddress?: string;
  workAddress?: string;
  preferredPaymentRef?: string; // reference label only, never credentials
}

/** PROPOSED Phase-2 schema — not persisted anywhere in Phase 1. */
export interface DomainMemory {
  domainId: DomainId;
  favoriteMerchants: string[];
  usualRangeLow: number | null;
  usualRangeHigh: number | null;
  notes: string[];
}

export interface UsualSpend {
  low: number;
  high: number;
  median: number;
  count: number;
}

/**
 * Compute a "usual spend" range from REAL recorded APPROVED transactions in
 * the given merchant categories. Returns null when there are fewer than 2
 * data points — the UI must then omit the line (never invent it).
 */
export function usualSpendRange(
  transactions: TransactionRecord[],
  categories: string[]
): UsualSpend | null {
  const cats = categories.map((c) => c.toLowerCase());
  const amounts = transactions
    .filter(
      (t) =>
        t.decision === 'ALLOW' &&
        cats.some((c) => (t.merchant_category || '').toLowerCase().includes(c))
    )
    .map((t) => t.rawAmount)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (amounts.length < 2) return null;
  const median = amounts[Math.floor(amounts.length / 2)];
  return { low: amounts[0], high: amounts[amounts.length - 1], median, count: amounts.length };
}

export function formatUsualSpend(u: UsualSpend): string {
  return `₹${Math.round(u.low).toLocaleString()}–₹${Math.round(u.high).toLocaleString()}`;
}

/**
 * Merchants the user has actually paid, most recent first (deduplicated).
 * Real history only — feeds the merchant datalist so users pick real places
 * instead of inventing names. Display aid, never authorization input.
 */
export function usualMerchants(transactions: TransactionRecord[], categories: string[], limit = 8): string[] {
  const cats = categories.map((c) => c.toLowerCase());
  const seen: string[] = [];
  const sorted = transactions.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const t of sorted) {
    const name = (t.merchant || '').trim();
    if (!name || seen.includes(name)) continue;
    if (cats.length > 0 && !cats.some((c) => (t.merchant_category || '').toLowerCase().includes(c))) continue;
    seen.push(name);
    if (seen.length >= limit) break;
  }
  return seen;
}
