"""
merchant_reputation.py — Generic merchant reputation for Bound

Adapted from Iron's scam_registry.py but for merchants (not UPI phones).
Concepts: NEW / FAMILIAR / FREQUENT / REPORTED, tiers CLEAN/FLAGGED/HIGH_RISK

Storage: JSON data/merchant_registry.json (single file, like Iron), atomic tmp write,
24h dedup per (reporter, merchant), 30s in-memory cache, normalized merchant key.

No second database, no UPI logic.
"""

from __future__ import annotations
import json
import os
import time
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional

DB_PATH = Path(__file__).parent.parent / "data" / "merchant_registry.json"

# Ensure data dir exists
try:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# Simple in-memory cache
_cache: Dict[str, Dict[str, Any]] = {}
_cache_ts: Dict[str, float] = {}
_cache_ttl = 30.0
_data_mtime_cache = 0.0

def _normalize_merchant(merchant: str) -> str:
    """Generic normalization: lowercased, stripped. No phone digit logic."""
    return (merchant or "").strip().lower()

def _load() -> Dict[str, Any]:
    if not DB_PATH.exists():
        return {}
    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        import logging
        logging.getLogger("bound.merchant_reputation").warning("merchant_registry.json corrupted (%s)", e)
        return {}
    except Exception as e:
        import logging
        logging.getLogger("bound.merchant_reputation").warning("Failed to load merchant_registry.json: %s", e)
        return {}

def _save(data: Dict[str, Any]) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=str(DB_PATH.parent), prefix=".merchant_tmp_")
    try:
        with open(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, DB_PATH)
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

def _tier(count: int) -> str:
    # Generic tiers: 1 flagged, 3+ high_risk
    if count >= 3:
        return "high_risk"
    if count >= 1:
        return "flagged"
    return "clean"

def _is_cache_valid(key: str) -> bool:
    ts = _cache_ts.get(key, 0)
    if time.time() - ts > _cache_ttl:
        return False
    try:
        mtime = os.path.getmtime(DB_PATH) if DB_PATH.exists() else 0
        global _data_mtime_cache
        if mtime > _data_mtime_cache:
            _cache.clear()
            _cache_ts.clear()
            _data_mtime_cache = mtime
            return False
    except Exception:
        pass
    return key in _cache

def _set_cache(key: str, data: Dict[str, Any]):
    _cache[key] = data
    _cache_ts[key] = time.time()
    try:
        global _data_mtime_cache
        if DB_PATH.exists():
            _data_mtime_cache = os.path.getmtime(DB_PATH)
    except Exception:
        pass

def _invalidate_cache(key: str | None = None):
    if key:
        _cache.pop(key, None)
        _cache_ts.pop(key, None)
    else:
        _cache.clear()
        _cache_ts.clear()

_orig_save = _save
def _save_with_invalidate(data: Dict[str, Any]) -> None:
    _orig_save(data)
    _invalidate_cache()

_save = _save_with_invalidate  # type: ignore

def report_merchant(merchant: str, reporter: str, reason: str, amount: float = 0.0) -> Dict[str, Any]:
    if not merchant or not merchant.strip():
        return {"merchant": merchant, "report_count": 0, "tier": "clean", "deduplicated": False, "error": "Merchant cannot be empty"}
    key = _normalize_merchant(merchant)
    reporter = (reporter or "").strip() or "anonymous"
    data = _load()
    entry = data.get(key, {"reports": [], "report_count": 0, "first_reported": time.time()})
    cutoff = time.time() - 86400
    already = any(r["reporter"] == reporter and r["time"] > cutoff for r in entry["reports"])
    if not already:
        entry["reports"].append({"reporter": reporter, "reason": reason, "amount": amount, "time": time.time()})
        entry["report_count"] = len(entry["reports"])
    entry["tier"] = _tier(entry["report_count"])
    entry["last_reported"] = time.time()
    data[key] = entry
    _save(data)
    return {"merchant": key, "report_count": entry["report_count"], "tier": entry["tier"], "deduplicated": already}

def get_merchant_reputation(merchant: str) -> Dict[str, Any]:
    norm = _normalize_merchant(merchant) if merchant and merchant.strip() else ""
    if not norm:
        return {
            "merchant": merchant, "known": False, "reported": False, "report_count": 0,
            "reputation": "CLEAN", "confidence": 0.92, "recency_days": None,
            "evidence": {"report_count": 0}, "tier": "clean", "signals": []
        }
    if _is_cache_valid(norm):
        return dict(_cache[norm])

    # Load
    report_count = 0
    tier = "clean"
    reasons: List[str] = []
    first = None
    last = None
    entry = None
    try:
        data = _load()
        entry = data.get(norm)
        if entry:
            report_count = int(entry.get("report_count", 0))
            tier = entry.get("tier", _tier(report_count))
            reasons = list({r["reason"] for r in entry.get("reports", [])})
            first = entry.get("first_reported")
            last = entry.get("last_reported")
    except Exception:
        pass

    reported = report_count >= 1
    known = report_count >= 1
    if tier == "high_risk":
        reputation = "HIGH_RISK"
    elif tier == "flagged":
        reputation = "FLAGGED"
    else:
        reputation = "CLEAN"

    if report_count == 0:
        confidence = 0.92
    elif report_count >= 3:
        confidence = 0.85 if tier == "high_risk" else 0.70
    else:
        confidence = 0.70

    recency_days = None
    if last:
        try:
            recency_days = int((time.time() - float(last)) / 86400)
            if recency_days <= 2 and report_count >= 1:
                confidence = min(0.98, confidence + 0.08)
            elif recency_days > 180 and report_count <= 1:
                confidence = max(0.5, confidence - 0.1)
        except Exception:
            pass

    evidence = {"report_count": report_count, "reasons": reasons, "first_reported": first, "last_reported": last, "tier": tier}
    signals = []
    if reported:
        signals.append({
            "id": "merchant_reported" if report_count < 3 else "merchant_high_reports",
            "category": "RECIPIENT",
            "severity": "HIGH" if report_count < 3 else "CRITICAL",
            "score": 12 if report_count == 1 else 30,
            "evidence": {"report_count": report_count, "tier": tier},
            "description": f"Merchant '{merchant}' has {report_count} fraud report(s)" + (f" — last reported {recency_days} days ago" if recency_days is not None else ""),
            "source": "merchant_reputation",
        })

    result = {
        "merchant": norm,
        "known": known,
        "reported": reported,
        "report_count": report_count,
        "reputation": reputation,
        "confidence": round(float(confidence), 2),
        "recency_days": recency_days,
        "evidence": evidence,
        "tier": tier,
        "signals": signals,
        "reasons": reasons,
    }
    _set_cache(norm, result)
    return dict(result)

def get_merchant_risk(merchant: str) -> Dict[str, Any]:
    """Legacy alias for compatibility."""
    rep = get_merchant_reputation(merchant)
    return {
        "merchant": rep["merchant"],
        "report_count": rep["report_count"],
        "tier": rep["tier"],
        "reasons": rep["evidence"].get("reasons", []),
        "first_reported": rep["evidence"].get("first_reported"),
        "last_reported": rep["evidence"].get("last_reported"),
    }

def get_all_flagged(min_count: int = 1):
    data = _load()
    results = []
    for merchant, entry in data.items():
        if entry["report_count"] >= min_count:
            reasons = list({r["reason"] for r in entry["reports"]})
            results.append({
                "merchant": merchant,
                "report_count": entry["report_count"],
                "tier": entry.get("tier", _tier(entry["report_count"])),
                "reasons": reasons,
                "first_reported": entry.get("first_reported"),
                "last_reported": entry.get("last_reported"),
            })
    results.sort(key=lambda r: -r["report_count"])
    return results

def get_stats() -> Dict[str, Any]:
    data = _load()
    total = len(data)
    total_reports = sum(e["report_count"] for e in data.values())
    high = sum(1 for e in data.values() if e["report_count"] >= 3)
    return {"total_flagged_merchants": total, "total_reports": total_reports, "high_risk_count": high}
