/**
 * Bound — Lightweight deterministic intent layer (Phase 1 product shell).
 *
 * Converts a natural-language request like "Order me dinner under ₹800"
 * into a structured draft the UI can display:
 *
 *   Domain: Food / Purpose: Dinner / Maximum: ₹800
 *
 * This is deliberately NOT an LLM agent and NOT a merchant integration.
 * Parsing is keyword/regex based, fully deterministic, and honest about
 * what it did not understand (see `notes`). The parsed intent NEVER
 * authorizes anything — it only pre-fills a task draft whose outcome is
 * decided later by the real backend authorization engine.
 *
 * Phase 2 will replace/augment this with real NLU + persistent memory.
 */

import type { DomainId } from './domains';

export interface ParsedIntent {
  kind: 'request' | 'cancel' | 'unknown';
  rawText: string;
  domainId: DomainId | null;
  /** Plain-language purpose, e.g. "Dinner", "Flight booking". */
  purpose: string | null;
  /** Maximum amount stated by the user in INR, if any. */
  budget: number | null;
  /** Plain-language notes about what was (not) understood. Shown in UI. */
  notes: string[];
}

const CANCEL_WORDS = ['cancel', 'stop', 'forget it', 'never mind', "don't", 'do not'];
const ORDER_WORDS = ['order', 'buy', 'book', 'request', 'anything', 'it', 'that'];

const DOMAIN_KEYWORDS: Record<DomainId, string[]> = {
  food: [
    'dinner', 'lunch', 'breakfast', 'brunch', 'meal', 'food', 'groceries', 'grocery',
    'supermarket', 'restaurant', 'swiggy', 'zomato', 'pizza', 'burger', 'sushi',
    'coffee', 'chai', 'snack', 'snacks', 'tiffin', 'biryani', 'thali', 'dessert',
    'bakery', 'fruit', 'vegetable', 'veg', 'non-veg', 'thali',
  ],
  travel: [
    'flight', 'flights', 'hotel', 'hotels', 'taxi', 'cab', 'uber', 'ola', 'train',
    'travel', 'trip', 'airlines', 'airline', 'airport', 'holiday', 'vacation',
    'book a flight', 'book flight',
  ],
  shopping: [
    'buy', 'purchase', 'shoes', 'shirt', 'clothes', 'clothing', 'electronics',
    'phone', 'laptop', 'headphones', 'earbuds', 'watch', 'bag', 'dress', 'jeans',
    'shopping', 'amazon', 'flipkart',
  ],
  bills: [
    'bill', 'bills', 'billing', 'utility', 'utilities', 'electricity', 'power',
    'water', 'gas', 'cylinder', 'recharge', 'prepaid', 'postpaid', 'broadband',
    'wifi', 'dth', 'subscription', 'subscriptions', 'bescom', 'bwssb',
  ],
};

/** Maps a matched trigger word to a display purpose. */
const PURPOSE_MAP: Array<{ words: string[]; purpose: string }> = [
  { words: ['dinner'], purpose: 'Dinner' },
  { words: ['lunch'], purpose: 'Lunch' },
  { words: ['breakfast'], purpose: 'Breakfast' },
  { words: ['brunch'], purpose: 'Brunch' },
  { words: ['groceries', 'grocery', 'supermarket'], purpose: 'Groceries' },
  { words: ['flight', 'flights'], purpose: 'Flight booking' },
  { words: ['hotel', 'hotels'], purpose: 'Hotel booking' },
  { words: ['taxi', 'cab', 'uber', 'ola'], purpose: 'Ride' },
  { words: ['train'], purpose: 'Train booking' },
  { words: ['bill', 'bills', 'electricity', 'recharge', 'subscription', 'subscriptions'], purpose: 'Bill payment' },
];

export const DOMAIN_DEFAULT_PURPOSE: Record<DomainId, string> = {
  food: 'Food order',
  travel: 'Travel booking',
  shopping: 'Shopping order',
  bills: 'Bill payment',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract the first stated amount in INR, preferring qualified ("under ₹800") matches. */
function extractBudget(text: string): number | null {
  const normalized = text.toLowerCase().replace(/₹/g, ' rs ');
  const amount = '(\\d[\\d,]*(?:\\.\\d{1,2})?)';
  const patterns = [
    new RegExp(`(?:under|below|up\\s*to|within|max|maximum|less than|budget(?: of)?|around|about|for)\\s*(?:rs\\.?|inr)?\\s*${amount}`),
    new RegExp(`(?:rs\\.?|inr)\\s*${amount}`),
    new RegExp(`${amount}\\s*(?:rs\\.?|inr|rupees?|bucks?)`),
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m) {
      const value = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0 && value <= 10000000) {
        return Math.round(value * 100) / 100;
      }
    }
  }
  return null;
}

function countHits(text: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i');
    if (re.test(text)) hits += 1;
  }
  return hits;
}

function derivePurpose(text: string, domainId: DomainId | null): string | null {
  for (const entry of PURPOSE_MAP) {
    for (const w of entry.words) {
      if (new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i').test(text)) return entry.purpose;
    }
  }
  if (domainId) return DOMAIN_DEFAULT_PURPOSE[domainId];
  return null;
}

function isCancel(text: string): boolean {
  const lower = text.toLowerCase();
  const hasCancel = CANCEL_WORDS.some((w) => lower.includes(w));
  const hasOrder = ORDER_WORDS.some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
  return hasCancel && hasOrder;
}

export function parseRequest(rawText: string): ParsedIntent {
  const text = rawText.trim();
  if (!text) {
    return { kind: 'unknown', rawText, domainId: null, purpose: null, budget: null, notes: [] };
  }
  if (isCancel(text)) {
    return { kind: 'cancel', rawText, domainId: null, purpose: null, budget: null, notes: [] };
  }

  const scores: Record<DomainId, number> = {
    food: countHits(text, DOMAIN_KEYWORDS.food),
    travel: countHits(text, DOMAIN_KEYWORDS.travel),
    shopping: countHits(text, DOMAIN_KEYWORDS.shopping),
    bills: countHits(text, DOMAIN_KEYWORDS.bills),
  };
  const ranked = (Object.keys(scores) as DomainId[]).sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0];
  const domainId: DomainId | null = scores[top] > 0 && scores[top] !== scores[ranked[1]] ? top : null;

  const budget = extractBudget(text);
  const purpose = derivePurpose(text, domainId);
  const notes: string[] = [];
  if (!domainId) {
    const contenders = ranked.filter((d) => scores[d] > 0);
    const label = (d: DomainId) => d.charAt(0).toUpperCase() + d.slice(1);
    notes.push(
      contenders.length > 1
        ? `This could be ${contenders.map(label).join(' or ')} — pick one below.`
        : 'Could not tell which area this is for — pick one below.'
    );
  }
  if (budget === null) {
    notes.push('No budget stated — you can set the amount when you check it with Bound.');
  }

  if (!domainId && budget === null && !purpose) {
    return { kind: 'unknown', rawText, domainId, purpose, budget, notes };
  }
  return { kind: 'request', rawText, domainId, purpose, budget, notes };
}
