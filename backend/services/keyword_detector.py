"""
keyword_detector.py — Trimmed generic intent detection for Bound

Adapted from Iron's keyword_detector.py but only generic categories:
- urgency
- impersonation (generic authority, not RBI-specific)
- reward / prize
- investment / scam language

Applied to purpose + merchant fields (agent-generated text).
No India/UPI-specific vocabulary (no OTP, KYC, UPI handle).
Levenshtein early-exit >3 → 99 kept for robustness.
"""

from __future__ import annotations
import re
from typing import Dict, Any, List

URGENCY_TERMS = {
    "urgent", "urgency", "immediately", "asap", "emergency", "hurry", "quick", "fast",
    "instant", "right now", "do it now", "act now", "limited", "deadline", "expire", "expiring",
    "today only", "last chance", "don't wait", "running out", "time sensitive",
}

IMPERSONATION_TERMS = {
    "government", "authority", "official", "police", "enforcement", "support", "helpdesk",
    "customer care", "customer support", "refund department", "admin", "security team",
    "compliance", "audit", "legal", "verification team",
}

REWARD_TERMS = {
    "prize", "winner", "lottery", "lucky draw", "cashback", "reward", "gift", "bonus",
    "won", "winning", "jackpot", "selected", "chosen", "congratulations",
}

INVESTMENT_TERMS = {
    "invest", "investment", "profit", "double", "triple", "crypto", "bitcoin", "trading",
    "forex", "stock", "dividend", "scheme", "guaranteed return", "earn daily", "passive income",
}

CATEGORY_WEIGHTS = {
    "urgency": 8,
    "impersonation": 12,
    "reward": 10,
    "investment": 15,
}

def _levenshtein(a: str, b: str) -> int:
    if abs(len(a) - len(b)) > 3:
        return 99
    m, n = len(a), len(b)
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cur[j] = prev[j-1] if a[i-1] == b[j-1] else 1 + min(prev[j], cur[j-1], prev[j-1])
        prev = cur
        if min(prev) > 3:
            return 99
    return prev[n]

def _normalize_text(text: str) -> str:
    return (text or "").lower().strip()

def _tokenize(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", _normalize_text(text))

def _fuzzy_contains(text: str, term: str) -> bool:
    text_n = _normalize_text(text)
    term_n = _normalize_text(term)
    if term_n in text_n:
        return True
    if " " not in term_n:
        if len(term_n) < 5:
            return False
        for tok in _tokenize(text_n):
            if tok == term_n:
                return True
            if len(tok) >= 5 and _levenshtein(tok, term_n) <= 2:
                return True
    else:
        parts = term_n.split()
        if any(len(p) < 3 for p in parts):
            return False
        tokens = _tokenize(text_n)
        for i in range(len(tokens) - len(parts) + 1):
            ok = True
            for k, part in enumerate(parts):
                tok = tokens[i+k]
                if tok == part:
                    continue
                if len(part) >= 5 and len(tok) >=5 and _levenshtein(tok, part) <=2:
                    continue
                ok = False
                break
            if ok:
                return True
    return False

def detect_bound_keywords(purpose: str | None, merchant: str | None, note: str | None = None) -> List[Dict[str, Any]]:
    """
    Scan Bound textual fields for suspicious intent.
    Returns structured signals (deterministic, low weight).
    """
    text = f"{purpose or ''} {merchant or ''} {note or ''}"
    text_n = _normalize_text(text)
    if not text_n:
        return []

    signals: List[Dict[str, Any]] = []

    def add(sig_id: str, category: str, severity: str, score: int, hits: List[str], desc: str):
        if not hits:
            return
        if any(s["id"] == sig_id for s in signals):
            return
        signals.append({
            "id": sig_id,
            "category": category,
            "severity": severity,
            "score": score,
            "evidence": {"matched_terms": hits[:5], "text_snippet": text[:80]},
            "description": desc,
            "source": "keyword_detector",
        })

    hits = [t for t in URGENCY_TERMS if _fuzzy_contains(text, t)]
    if hits:
        sev = "HIGH" if len(hits) >= 2 else "MEDIUM"
        score = 12 if len(hits) >= 2 else 8
        add("urgency_language", "KEYWORD", sev, score, hits, f"Urgency/pressure language: {', '.join(hits[:3])}")

    hits = [t for t in IMPERSONATION_TERMS if _fuzzy_contains(text, t)]
    if hits:
        sev = "HIGH" if len(hits) >= 2 else "MEDIUM"
        add("impersonation_language", "KEYWORD", sev, 12, hits, f"Authority impersonation: {', '.join(hits[:3])}")

    hits = [t for t in REWARD_TERMS if _fuzzy_contains(text, t)]
    if hits:
        sev = "HIGH" if len(hits) >= 2 else "MEDIUM"
        score = 12 if sev == "MEDIUM" else 16
        add("reward_prize_scam", "KEYWORD", sev, score, hits, f"Prize/reward lure: {', '.join(hits[:2])}")

    hits = [t for t in INVESTMENT_TERMS if _fuzzy_contains(text, t)]
    if hits:
        add("investment_scam", "KEYWORD", "HIGH", 15, hits, f"Investment promise: {', '.join(hits[:2])}")

    return signals
