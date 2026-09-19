"""
baseline.py — Historical baseline for Bound (adapted from Iron ml_pipeline/features.py)

Pure Python, no numpy required. Computes per-agent baseline from recent transactions.
Used by risk engine for z-score, p95/p99, hour_freq, etc.
"""
from __future__ import annotations
import math
import statistics
from datetime import datetime, timezone
from typing import List, Dict, Any
from collections import Counter

COLD_START_THRESHOLD = 5

def _parse_hour(ts) -> int | None:
    try:
        # Handle datetime object or ISO string
        if isinstance(ts, datetime):
            dt = ts
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.hour
        # String ISO8601
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.hour
    except Exception:
        return None

def compute_baseline(history: List[Dict[str, Any]] | List[Any]) -> Dict[str, Any]:
    """
    history: list of Transaction objects or dicts with amount, timestamp, merchant, merchant_category
    Returns baseline dict with:
      history_count, cold_start,
      amount_mean, median, std, p95, p99, min, max,
      hour_freq, peak_hours, weekend_ratio,
      merchant_freq, merchant_set,
      velocity stats not needed here (computed separately)
    """
    # Normalize history to dicts with amount, timestamp, merchant, category
    normalized = []
    for h in history:
        if isinstance(h, dict):
            normalized.append(h)
        else:
            # SQLAlchemy model
            try:
                normalized.append({
                    "amount": float(getattr(h, "amount", 0)),
                    "timestamp": getattr(h, "created_at", None),
                    "merchant": getattr(h, "merchant", ""),
                    "merchant_category": getattr(h, "merchant_category", ""),
                })
            except Exception:
                continue

    history_count = len(normalized)
    cold_start = history_count < COLD_START_THRESHOLD

    baseline: Dict[str, Any] = {
        "history_count": history_count,
        "cold_start": cold_start,
    }

    amounts = []
    for h in normalized:
        try:
            amounts.append(float(h.get("amount", 0)))
        except Exception:
            continue

    if amounts:
        # Use statistics module to avoid numpy dependency
        try:
            mean = statistics.mean(amounts)
            median = statistics.median(amounts)
            # stdev requires at least 2 values
            if len(amounts) >= 2:
                stdev = statistics.stdev(amounts)
            else:
                stdev = amounts[0] * 0.5 if amounts[0] else 500.0
            if stdev < 1:
                stdev = max(mean * 0.3, 100.0)
            # p95/p99 via quantiles (statistics.quantiles) - n=20 for p95
            # Fallback to simple percentile via sorted
            sorted_amounts = sorted(amounts)
            # Simple percentile via linear interpolation
            def percentile(p):
                k = (len(sorted_amounts) - 1) * p / 100
                f = math.floor(k)
                c = math.ceil(k)
                if f == c:
                    return sorted_amounts[int(k)]
                d0 = sorted_amounts[int(f)] * (c - k)
                d1 = sorted_amounts[int(c)] * (k - f)
                return d0 + d1
            p95 = percentile(95) if len(amounts) >= 2 else mean * 1.8
            p99 = percentile(99) if len(amounts) >= 2 else mean * 2.5
            baseline["amount_mean"] = float(mean)
            baseline["amount_median"] = float(median)
            baseline["amount_std"] = float(stdev)
            baseline["amount_p95"] = float(p95)
            baseline["amount_p99"] = float(p99)
            baseline["amount_min"] = float(min(amounts))
            baseline["amount_max"] = float(max(amounts))
        except Exception:
            baseline["amount_mean"] = float(sum(amounts) / len(amounts)) if amounts else None
            baseline["amount_median"] = float(sorted(amounts)[len(amounts)//2]) if amounts else None
            baseline["amount_std"] = None
            baseline["amount_p95"] = None
            baseline["amount_p99"] = None
    else:
        baseline["amount_mean"] = None
        baseline["amount_median"] = None
        baseline["amount_std"] = None
        baseline["amount_p95"] = None
        baseline["amount_p99"] = None
        baseline["amount_min"] = None
        baseline["amount_max"] = None

    # Hour frequency
    hours = []
    weekend_cnt = 0
    for h in normalized:
        ts = h.get("timestamp")
        hour = _parse_hour(ts)
        if hour is not None:
            hours.append(hour)
            # Determine weekend via timestamp if available
            try:
                dt = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                # Use isoweekday: 6,7 weekend
                if dt.weekday() >= 5:
                    weekend_cnt += 1
            except Exception:
                pass

    if hours:
        cnt = Counter(hours)
        total = len(hours)
        baseline["hour_freq"] = {h: c / total for h, c in cnt.items()}
        baseline["peak_hours"] = set([h for h, _ in cnt.most_common(3)])
        baseline["weekend_ratio"] = float(weekend_cnt / total) if total else 0.3
    else:
        baseline["hour_freq"] = {}
        baseline["peak_hours"] = set()
        baseline["weekend_ratio"] = 0.3

    # Merchant frequency
    merchants = [h.get("merchant", "").strip().lower() for h in normalized if h.get("merchant")]
    merchant_set = set(merchants)
    merchant_freq = {}
    if merchants:
        cnt = Counter(merchants)
        merchant_freq = {k: v / len(merchants) for k, v in cnt.items()}
    baseline["merchant_freq"] = merchant_freq
    baseline["merchant_set"] = merchant_set

    # Category frequency (for category anomaly)
    categories = [h.get("merchant_category", "").strip().lower() for h in normalized if h.get("merchant_category")]
    cat_freq = {}
    if categories:
        cnt = Counter(categories)
        cat_freq = {k: v / len(categories) for k, v in cnt.items()}
    baseline["category_freq"] = cat_freq
    baseline["category_set"] = set(categories)

    return baseline
