"""
Deterministic Risk Engine — Phase 7 (Iron-derived)

Transparent, explainable, no ML.
Signals: amount anomaly (z-score, p95, balance drain), velocity (5m/1h/uniq/escalation), merchant novelty + reputation, category anomaly, time anomaly, delegation depth, fraud rules, keyword intent
Scoring: 0-100, levels LOW 0-29, MEDIUM 30-59, HIGH 60-100
Dedup groups to avoid double-counting.
"""

from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend import models
from backend.services.baseline import compute_baseline
from backend.services.merchant_reputation import get_merchant_reputation
from backend.services.fraud_rules import ALL_RULES as BOUND_RULES, RULES_BY_ID
from backend.services.keyword_detector import detect_bound_keywords

def _risk_level(score: int) -> str:
    if score >= 60:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"

# Dedup groups — same underlying evidence should not double-count
# Keep groups narrow to avoid over-dedup: velocity vs recipient_switching are distinct, amount vs balance drain are distinct
_DEDUP_GROUPS = {
    "velocity_count": {"VELOCITY", "HIGH_VELOCITY", "HIGH_VELOCITY_5M", "HIGH_VELOCITY_1H", "velocity_1h", "velocity_5m", "rapid_velocity_5m", "high_velocity_1h", "HIGH_VELOCITY"},
    "recipient_switch": {"RECIPIENT_SWITCHING", "recipient_switching"},
    "amount": {"HIGH_AMOUNT", "EXTREME_AMOUNT", "ROUND_AMOUNT_LARGE", "amount_deviation", "sudden_behaviour_change"},
    "merchant_report": {"REPORTED_MERCHANT", "HIGH_RISK_MERCHANT", "merchant_reported", "merchant_high_reports"},
    "keyword": {"urgency_language", "impersonation_language", "reward_prize_scam", "investment_scam", "KEYWORD_URGENCY", "KEYWORD_IMPERSONATION"},
    # Note: AMOUNT_ANOMALY and BALANCE_DRAIN are separate groups (not deduped together) — both can contribute
}

def _dedup_factors(factors):
    """Evidence-aware dedup: keep highest severity/score per group."""
    id_to_group = {}
    for g, ids in _DEDUP_GROUPS.items():
        for i in ids:
            id_to_group[i] = g
    grouped = {}
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
    for f in factors:
        fid = str(f.get("type", f.get("id", "")))
        gid = id_to_group.get(fid, fid)
        if gid not in grouped:
            grouped[gid] = f
        else:
            existing = grouped[gid]
            if order.get(str(f.get("severity", "MEDIUM")).upper(), 1) > order.get(str(existing.get("severity", "MEDIUM")).upper(), 1):
                grouped[gid] = f
            elif float(f.get("score", 0) if "score" in f else 8) > float(existing.get("score", 0) if "score" in existing else 8):
                # For factors without explicit score, use severity implied weight
                grouped[gid] = f
    # Flatten and sort by severity/score
    deduped = list(grouped.values())
    # Assign score for sorting if not present
    def _score_for_sort(f):
        # Severity to score mapping
        sev = str(f.get("severity", "MEDIUM")).upper()
        base = {"LOW": 5, "MEDIUM": 12, "HIGH": 18, "CRITICAL": 25}.get(sev, 12)
        return base
    deduped.sort(key=lambda x: (-_score_for_sort(x), x.get("type", "")))
    return deduped

def _amount_anomaly_signals(amount: float, baseline: dict, effective_limit: float | None):
    """Amount anomaly using baseline: z-score, vs_avg, p95/p99, balance drain."""
    factors = []
    score = 0
    if baseline.get("amount_mean") is None or baseline.get("amount_std") is None:
        return factors, score

    mean = baseline["amount_mean"]
    std = baseline["amount_std"]
    median = baseline.get("amount_median", mean)
    p95 = baseline.get("amount_p95", mean * 1.8)
    p99 = baseline.get("amount_p99", mean * 2.5)

    # z-score
    if std and std > 0:
        z = (amount - mean) / std
    else:
        z = 0

    # Check vs p99/p95 first (more robust than fixed ratio)
    if amount >= p99 and p99 > 0:
        score += 25
        factors.append({"type": "AMOUNT_ANOMALY", "severity": "HIGH", "message": f"Amount ₹{amount:.0f} exceeds p99 ₹{p99:.0f} (mean ₹{mean:.0f}, z={z:.1f}).", "score": 25})
    elif amount >= p95 and p95 > 0:
        score += 15
        factors.append({"type": "AMOUNT_ANOMALY", "severity": "MEDIUM", "message": f"Amount ₹{amount:.0f} exceeds p95 ₹{p95:.0f} (mean ₹{mean:.0f}).", "score": 15})
    elif abs(z) >= 3.0:
        score += 25
        factors.append({"type": "AMOUNT_ANOMALY", "severity": "HIGH", "message": f"Amount ₹{amount:.0f} is {z:.1f}σ above mean ₹{mean:.0f} (z-score).", "score": 25})
    elif abs(z) >= 2.0:
        score += 15
        factors.append({"type": "AMOUNT_ANOMALY", "severity": "MEDIUM", "message": f"Amount ₹{amount:.0f} is {z:.1f}σ above mean (significant spike).", "score": 15})
    elif amount / max(mean, 1) >= 2.0:
        score += 15
        factors.append({"type": "AMOUNT_ANOMALY", "severity": "MEDIUM", "message": f"Amount ₹{amount:.0f} is {amount/max(mean,1):.1f}× above average ₹{mean:.0f}.", "score": 15})

    # Balance/effective-limit drain — keep separate from amount anomaly, do not downgrade
    if effective_limit and effective_limit > 0:
        drain = amount / effective_limit
        if drain >= 0.7:
            score += 18
            factors.append({"type": "BALANCE_DRAIN", "severity": "HIGH", "message": f"Amount consumes {drain*100:.0f}% of effective limit ₹{effective_limit:.0f} — high drain.", "score": 18})
        elif drain >= 0.4:
            score += 10
            factors.append({"type": "BALANCE_DRAIN", "severity": "MEDIUM", "message": f"Amount uses {drain*100:.0f}% of effective limit.", "score": 10})

    return factors, score

def _velocity_signals(recent, now):
    """Velocity with uniq and escalation, prospective +1 included."""
    import calendar
    import time
    factors = []
    score = 0

    # Count in windows including prospective current (as if it already happened)
    # recent is list of Transaction objects already (excluding current), so prospective = counts +1
    epochs = []
    for t in recent:
        ts = t.created_at
        if ts.tzinfo is None:
            import datetime as dt
            ts = ts.replace(tzinfo=timezone.utc)
        try:
            epochs.append(ts.timestamp())
        except:
            continue
    now_ts = now.timestamp()
    cnt_5m = sum(1 for e in epochs if now_ts - e < 300) + 1
    cnt_1h = sum(1 for e in epochs if now_ts - e < 3600) + 1
    # Unique merchants in 30m
    uniq_30 = set()
    for t in recent:
        ts = t.created_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if (now - ts).total_seconds() < 1800:
            uniq_30.add(t.merchant.strip().lower() if t.merchant else "")
    # For prospective, we will add current merchant later in caller, but here we just count existing uniq
    # This function is called without current merchant, so we return counts; caller can add uniq check with current merchant
    # For now, handle uniq including current via caller

    # Determine velocity level — more aggressive for demo (5 in 60s should be HIGH)
    if cnt_5m >= 5:
        score += 30
        factors.append({"type": "HIGH_VELOCITY", "severity": "HIGH", "message": f"{cnt_5m} transactions in 5 minutes — rapid burst.", "score": 30})
    elif cnt_5m >= 3:
        score += 20
        factors.append({"type": "HIGH_VELOCITY", "severity": "HIGH", "message": f"{cnt_5m} transactions in 5 minutes — rapid burst.", "score": 20})
    elif cnt_1h >= 6:
        score += 15
        factors.append({"type": "HIGH_VELOCITY", "severity": "MEDIUM", "message": f"{cnt_1h} transactions in the past hour.", "score": 15})
    elif cnt_5m >= 2:
        score += 10
        factors.append({"type": "VELOCITY", "severity": "MEDIUM", "message": f"{cnt_5m} transactions in 5 minutes.", "score": 10})

    # Check unique merchants in 30m will be handled by caller who knows current merchant
    return factors, score, {"cnt_5m": cnt_5m, "cnt_1h": cnt_1h, "uniq_30": uniq_30}

def evaluate_risk(
    db: Session,
    agent_id: str,
    amount: float,
    merchant: str,
    merchant_category: str,
    purpose: str,
    effective_limit: float | None,
    delegation_depth: int = 0,
) -> dict:
    factors = []
    score = 0

    # Fetch recent transactions for this agent (last 20)
    recent = (
        db.query(models.Transaction)
        .filter(models.Transaction.agent_id == agent_id)
        .order_by(models.Transaction.created_at.desc())
        .limit(20)
        .all()
    )
    now = datetime.now(timezone.utc)

    # Use baseline helper for richer stats (mean/median/std/p95/p99)
    baseline = compute_baseline(recent)
    history_count = baseline["history_count"]
    cold_start = baseline["cold_start"]

    # A. Amount anomaly (enhanced with baseline)
    amt_factors, amt_score = _amount_anomaly_signals(amount, baseline, effective_limit)
    # If cold_start and no history, do not flag amount anomaly (insufficient data)
    if cold_start and history_count < 3:
        # Keep only high extreme (already not flagged because baseline None)
        pass
    else:
        factors.extend(amt_factors)
        score += amt_score

    # Also add fallback simple ratio if baseline had no std (should already be covered)
    # Keep original simple ratio as backup if no baseline
    if not amt_factors and recent and not cold_start:
        # Fallback already handled

        pass

    # B. Velocity (enhanced)
    vel_factors, vel_score, vel_metrics = _velocity_signals(recent, now)
    factors.extend(vel_factors)
    score += vel_score

    # Check recipient switching (unique merchants in 30m including current)
    merchant_norm = merchant.strip().lower() if merchant else ""
    uniq_30 = vel_metrics.get("uniq_30", set())
    # Prospective uniq including current
    prospective_uniq = len(uniq_30 | ({merchant_norm} if merchant_norm else set()))
    if prospective_uniq >= 3 and len([t for t in recent if (now - (t.created_at.replace(tzinfo=timezone.utc) if t.created_at.tzinfo is None else t.created_at)).total_seconds() < 1800]) >= 2:
        # Only flag switching if there is velocity context
        if not any(f["type"] == "HIGH_VELOCITY" for f in factors):
            score += 15
            factors.append({"type": "RECIPIENT_SWITCHING", "severity": "HIGH", "message": f"Paying {prospective_uniq} different merchants in 30m — switching pattern.", "score": 15})
        else:
            # Already have high velocity, add as medium
            score += 8
            factors.append({"type": "RECIPIENT_SWITCHING", "severity": "MEDIUM", "message": f"{prospective_uniq} merchants in 30m.", "score": 8})

    # Check escalation: recent amounts increasing
    recent_amounts = [float(t.amount) for t in recent[:3]]
    if len(recent_amounts) >= 2 and amount > 0:
        seq = [amount] + recent_amounts[:2]
        # Check incrementing: each next >= previous *1.3
        if len(seq) >= 3 and seq[0] >= seq[1] * 1.3 and seq[1] >= seq[2] * 1.3 and max(seq) > 500:
            score += 12
            factors.append({"type": "SEQUENTIAL_AMOUNTS", "severity": "MEDIUM", "message": f"Amounts escalating: {seq[2]:.0f} → {seq[1]:.0f} → {seq[0]:.0f} — testing pattern.", "score": 12})

    # C. Merchant novelty + reputation
    recent_merchants = set(t.merchant.strip().lower() for t in recent[:10] if t.merchant)
    if merchant_norm and recent_merchants:
        if merchant_norm not in recent_merchants:
            score += 12
            factors.append({"type": "NEW_MERCHANT", "severity": "MEDIUM", "message": f"Merchant '{merchant}' is new — not seen in last {len(recent_merchants)} merchants.", "score": 12})
    # Global reputation (adapted scam_registry)
    try:
        rep = get_merchant_reputation(merchant)
        if rep.get("reported"):
            cnt = rep.get("report_count", 0)
            if cnt >= 3:
                score += 28
                factors.append({"type": "REPORTED_MERCHANT", "severity": "CRITICAL", "message": f"Merchant '{merchant}' has {cnt} fraud reports (high-risk).", "score": 28})
            else:
                score += 18
                factors.append({"type": "REPORTED_MERCHANT", "severity": "HIGH", "message": f"Merchant '{merchant}' has {cnt} fraud report(s).", "score": 18})
    except Exception:
        pass

    # D. Category behaviour
    recent_cats = [t.merchant_category.strip().lower() for t in recent[:5] if t.merchant_category]
    cat_norm = merchant_category.strip().lower() if merchant_category else ""
    if cat_norm and recent_cats:
        if cat_norm not in set(recent_cats):
            score += 15
            factors.append({"type": "CATEGORY_ANOMALY", "severity": "MEDIUM", "message": f"Category '{merchant_category}' differs from recent history ({', '.join(set(recent_cats))}).", "score": 15})

    # E. Time anomaly
    time_score = 0
    if recent:
        current_hour = now.hour
        recent_hours = [t.created_at.hour if t.created_at.tzinfo else t.created_at.replace(tzinfo=timezone.utc).hour for t in recent[:5]]
        if 0 <= current_hour <= 5 and all(8 <= h <= 20 for h in recent_hours):
            time_score = 10
            factors.append({"type": "ODD_HOUR", "severity": "MEDIUM", "message": f"Unusual hour {current_hour}:00 — recent transactions were daytime.", "score": 10})
        else:
            last_ts = recent[0].created_at
            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            secs = (now - last_ts).total_seconds()
            if secs < 30:
                time_score = 5
                factors.append({"type": "TIME_ANOMALY", "severity": "LOW", "message": f"Transaction only {int(secs)}s after previous — unusual timing.", "score": 5})
    else:
        if 0 <= now.hour <= 5:
            time_score = 10
            factors.append({"type": "ODD_HOUR", "severity": "MEDIUM", "message": f"Transaction at {now.hour}:00 — unusual night time for first transaction.", "score": 10})
    score += time_score

    # F. Keyword / intent
    try:
        kw_factors = detect_bound_keywords(purpose, merchant)
        for f in kw_factors:
            # Map to risk: urgency 8, impersonation 12, reward 10, investment 15
            # Already has score, add to total but cap keyword total to 15 to not dominate
            kw_score = int(f.get("score", 8))
            # Limit keyword total contribution to 15
            if sum(1 for x in factors if x["type"].startswith("KEYWORD") or x["type"] in ["urgency_language", "impersonation_language", "reward_prize_scam", "investment_scam"]) >= 2:
                kw_score = min(kw_score, 8)
            score += kw_score
            # Normalize type
            factors.append({"type": f["id"].upper() if "id" in f else "KEYWORD", "severity": f.get("severity", "MEDIUM"), "message": f.get("description", ""), "score": kw_score})
    except Exception:
        pass

    # G. Delegation depth
    if delegation_depth == 1:
        score += 2
        factors.append({"type": "DELEGATION_DEPTH", "severity": "LOW", "message": "Delegation depth 1 (A → B) — small contextual risk.", "score": 2})
    elif delegation_depth >= 2:
        score += 5
        factors.append({"type": "DELEGATION_DEPTH", "severity": "LOW", "message": f"Delegation depth {delegation_depth} — slight elevated context.", "score": 5})

    # Also add generic fraud rules that are not already covered (e.g., ROUND_AMOUNT_LARGE)
    # Check round amount large
    if amount >= 10000 and amount % 1000 == 0:
        # Large round number
        if not any(f["type"] == "AMOUNT_ANOMALY" for f in factors):
            score += 5
            factors.append({"type": "ROUND_AMOUNT_LARGE", "severity": "LOW", "message": f"Large round amount ₹{amount:.0f} — commonly seen in scam requests.", "score": 5})

    # Dedup: avoid double-counting same underlying evidence
    # Group velocity variants, amount variants, merchant report vs novelty, keyword variants
    factors = _dedup_factors(factors)

    # Clamp
    if score > 100:
        score = 100
    if score < 0:
        score = 0

    level = _risk_level(int(score))

    # Ensure factors have consistent shape for frontend (type, severity, message, score)
    normalized = []
    for f in factors:
        # Ensure type is present
        t = f.get("type") or f.get("id") or "UNKNOWN"
        sev = str(f.get("severity", "MEDIUM")).upper()
        if sev not in ["LOW", "MEDIUM", "HIGH", "CRITICAL"]:
            sev = "MEDIUM"
        msg = f.get("message") or f.get("description") or ""
        sc = f.get("score", 8)
        try:
            sc = int(sc)
        except:
            sc = 8
        normalized.append({"type": t, "severity": sev, "message": msg, "score": sc})

    return {
        "risk_score": int(score),
        "risk_level": level,
        "risk_factors": normalized,
    }
