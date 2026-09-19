# Bound — Phase 7 Iron Wallet Audit

**Date:** 2025-09-19  
**Scope:** Audit `D:\Iron_Wallet` for reusable fraud/risk intelligence for `D:\Bound` Phase 6 Risk layer. No code copied, no modifications.

---

## 1. Iron Architecture Summary

**IronWallet** (`otp_server.py` FastAPI 4.0, SQLite `data/iron.db`, WAL, `iron_store.py`) is a full-stack **wallet demo** whose core principle is **never block** — `HIGH_RISK` only triggers OTP → `PROCEEDED_AFTER_OTP`. Architecture:

```
index.html (React SPA, Babel in-browser, no build) + js/* 
        │ fetch / WebSocket
        ▼
otp_server.py (sole authority) ── iron_store.py (users, txs, risk_events, baselines, scam_registry.json)
  ├─ ml_pipeline/ — IFScorer (31-vector, scaler, user_profiles, score_bounds) → models/isolation_forest.joblib (65 MB)
  ├─ fraud_engine/ — deterministic 19 rules, 5 categories (A. Recipient, B. Transaction, C. Scam language, D. Network/Device, E. Account behaviour), keyword_detector (social engineering), pattern_matcher, fraud_scorer
  ├─ risk_engine/ — Unified RiskEngine: behavior 0.35 / fraud 0.40 / recipient 0.15 / context 0.10, evidence-aware weighted (0.6+0.4*confidence), dedup groups (velocity/amount/device/location/report), boost/dampen, iron_tier SAFE(0-69)/CAUTION(70-84)/HIGH_RISK(85-100), binary fraud, explanation (7A–7G)
  ├─ risk_engine/recipient.py — personal familiarity (NEW/FAMILIAR/FREQUENT) + global scam_registry reputation (CLEAN/FLAGGED/HIGH_RISK), recency, report_count
  ├─ scam_registry.py — JSON `data/scam_registry.json`, normalized 10-digit phone or lowercased UPI, tiers clean/flagged(1)/high_risk(3+)/network_blocked(5+), 24h dedup, cache TTL 30s, atomic tmp write
  └─ ai_investigator/ — grounded prompts, never invents score
```

**Data flow** `POST /risk/assess` or `POST /transactions/prepare` → `_compute_unified_risk`:
1. `_build_behavior_result` → `IFScorer.score_with_history(txn, history)` → `behavior_score + confidence + signals`
2. `_build_fraud_result` → `run_fraud_intelligence_deterministic(..., behavior_score)` → `fraud_score` (+ confidence, recipient, velocity, device/location, account behaviour)
3. `_build_recipient_profile` → `get_recipient_intelligence_api` → `risk_score + familiarity + reputation`
4. `_build_context` → device/location familiarity, velocity
5. `RiskEngine.assess(behavior,fraud,recipient,context)` → `score 0-100 + tier + confidence + deduped signals + components + explanation + audit`

Thresholds centralized in `risk_engine/thresholds.py` (`RISK_TIRESHOLDS`, `RISK_WEIGHTS`, `iron_tier`, `risk_level`). Frontend `js/constants.js` mirrors tiers but backend is authority.

**Benchmarks:** deterministic datasets `generate_benchmark_*.py` seed 42, 10–30 history per user, 15 seeded users (`js/constants.js`, `iron_store.seed_users_if_needed`), suites `benchmark_binary_500` 300 DEV/100 VAL/100 FINAL → **tier ~74-78%**, **binary ~87-88%** (VAL 83.8% tier), latency ~36ms avg (TestClient, in-process).

**Security:** OTP `secrets.randbelow` 120s/30s cooldown/5/5m, Bearer `secrets.token_urlsafe` 24h, `security_events` strips `otp/pin/token`, static allowlist blocks `.py/.joblib/.db`, no `payment_blocked` event.

---

## 2. Reusable Components

| # | Component | Source file | What it does | Why useful for Bound | Class | Integration approach |
|---|---|---|---|---|---:|---|
| 1 | **Velocity engine** | `fraud_engine/intelligence.py:detect_velocity_signals` + `fraud_engine/fraud_rules.py:HIGH_VELOCITY_5M/1H, RECIPIENT_SWITCHING` | Counts `cnt_5m/cnt_1h/cnt_24h`, `uniq_30m` from persisted history `[:50]`; prospective `+1` for current tx; thresholds `3+ in 5m HIGH`, `6+ in 1h MEDIUM`, `3+ unique recipients/30m HIGH`, escalation burst `amount_escalation_burst` | Bound currently counts only `60s/5m` for same agent; Iron adds `unique recipients` + `escalation` + prospective logic. Directly maps to `payment-agent` rapid delegation abuse. | **GENERIC** | Extend `Bound risk.py:B` to import `uniq_30m` + `escalation` signals. Reuse thresholds verbatim; no UPI dependency. Add `risk_factors` `RECIPIENT_SWITCHING`. Keep deterministic. |
| 2 | **Amount anomaly (z-score, percentile, balance)** | `ml_pipeline/features.py:compute_baseline_from_history` + `fraud_engine/intelligence.py:detect_account_behaviour_signals` + `fraud_rules: HIGH_AMOUNT/EXTREME_AMOUNT/BALANCE_DRAIN*` | Personalized mean/median/std/p95/p99 from `history[10-30]`, `z=(amt-mean)/std`, `vs_avg`, `balance_drop_pct=amt/balance_before`, `amount_percentile`; thresholds `>2.5× avg MEDIUM`, `>6× HIGH` | Bound uses simple `ratio vs avg` (2.5/2.0/1.5/1.2). Iron’s `z-score` + `p95/p99` is more robust to variance, and `balance_drop` is generic for agent wallet/budget. | **GENERIC** | Adapt `Bound risk.py:A` to compute `mean/median/std/p95` (already have `amounts` array) via `numpy`, replace fixed `2.5` with `z>=3` HIGH, `z>=2` MEDIUM, plus `balance_drop` if `effective_limit` known: `drain = amount / effective_limit`. Keep Bound’s “do not flag close to limit” — only flag when `z` high, not when `amount/limit ~0.9`. |
| 3 | **Recipient / merchant intelligence** | `risk_engine/recipient.py:get_recipient_profile` + `scam_registry.py` | Personal: `transaction_count`, `first/last_seen`, `total/avg/median`, `familiarity NEW/FAMILIAR(1-4)/FREQUENT(5+)`; Global: `report_count`, `reputation CLEAN/FLAGGED/HIGH_RISK`, `recency_days`, `confidence`; cache 30s, atomic tmp write, 24h dedup (`reporter+recipient` per day), normalized 10-digit or lowercased UPI | Bound currently only checks `merchant not in last 10 → MEDIUM`. Iron provides **two-layer** intelligence: personal familiarity (useful for `merchant` novelty) + **network-wide** reputation (adaptable to `merchant_category` or counterparty `agent` reputation). For Bound, `merchant` = counterparty agent/merchant name; global registry can be repurposed as `merchant_reputation.json` or agent reputation store. | **ADAPTABLE** | Port `recipient.py` without `iron_store` dependency: replace `iron_store.get_transactions_for_user` with `Bound Transaction` query by `agent_id` (already done in `risk.py`). Keep `familiarity` tiers. Adapt `scam_registry` → `bound_merchant_registry.json` (same `_normalize_recipient` but for `merchant.lower()`). Do **not** copy UPI phone logic (`-10` digits) — keep merchant lowercased only. Expose `get_merchant_intelligence(agent_id, merchant)` in `Bound services/merchant_reputation.py` (new). |
| 4 | **Device / network context** | `fraud_engine/intelligence.py:detect_device_location_signals` + `risk_engine/engine.py` context handling | `device_familiarity <0.5 → HIGH 18`, `location_familiarity <0.5 → HIGH 15`; context score derived from familiarity; `iron_store` baselines (`device/location` profile) | Bound has no device concept, but **agent instance / API key / IP** can be treated as device. Delegated agents (`payment-agent`) could have `device_familiarity` = whether `child_agent` has been seen before for that `parent`. Useful for `A→B→C` where `C` is new device. | **ADAPTABLE** | Map `device_familiarity` → `agent_instance_familiarity`: if `child_agent_id` never delegated before by `parent`, add `+8` LOW. Keep `location` out unless Bound adds geo. Do not require Twilio/device baselines. Keep weight low (10%) to avoid over-penalizing new delegations. |
| 5 | **Deterministic fraud rules (19 rules, 8 categories)** | `fraud_engine/fraud_rules.py:ALL_RULES` + `pattern_matcher.py` + `fraud_scorer.py` | Single source of truth, 19 immutable `FraudRule(id, category, severity, base_weight, thresholds)`: `HIGH_AMOUNT (2.5×)`, `EXTREME_AMOUNT (6×)`, `NEW_RECIPIENT`, `REPORTED_RECIPIENT`, `ODD_HOUR (1-5) HIGH`, `HIGH_VELOCITY_5M (3/5m)`, `RECIPIENT_SWITCHING`, `BALANCE_DRAIN`, `NEW_DEVICE`, `SEQUENTIAL_AMOUNTS`, `URGENCY_LANGUAGE`, etc. `compute_fraud_score` logistic `100/(1+exp(-0.06*(raw-40)))` + behavior prior ±10 | Bound currently has no rule catalog; Iron’s catalog is **explainable** and **centralized** — adding one rule = one entry, no other file edit. Categories `AMOUNT/TIMING/VELOCITY/BALANCE` are generic; `RECIPIENT/DEVICE/LOCATION` need adaptation; `URGENCY_LANGUAGE` is UPI-scam-specific but could be repurposed for `purpose`/`note` with agent-relevant terms. | **GENERIC** (12/19) + **ADAPTABLE** (4/19) + **UPI-SPECIFIC** (3/19) — see table below. Integrate by creating `Bound fraud_rules.py` with **generic subset** (see §3) and reusing `pattern_matcher` logic (threshold checks, not UPI regex). Keep `fraud_scorer` logistic for consistent 0-100. |
| 6 | **Scam language / social engineering** | `fraud_engine/keyword_detector.py:detect_social_engineering` (8 categories: urgency, OTP, impersonation, account_threat, reward, investment, loan, remote_access), Levenshtein early-exit >3 →99, fuzzy token-level | Scans `note+upi+recipient` for 60+ terms; returns `urgency_language HIGH 16`, `otp_request HIGH 20`, `impersonation MEDIUM 18`, etc. `CATEGORY_WEIGHTS` documented. | Bound `purpose` field (e.g., `Groceries`) is not free-form scam language, but `merchant` notes could contain `urgent`, `KYC`, `lottery` if agent is tricked. Useful as **low-weight** signal for delegated payments where `purpose` is agent-generated. | **ADAPTABLE** | Copy `keyword_detector.py` but **trim** to Bound-relevant terms: keep `urgency`, `impersonation` (RBI/Govt → generic `authority impersonation`), `investment`, `reward`; drop `OTP`/`KYC`/`UPI handle` unless Bound adds human notes. Map to `risk_factors` `SOCIAL_ENGINEERING` with `+8-12` not `+20`. Keep Levenshtein for robustness. |
| 7 | **Risk scoring & explanation** | `risk_engine/engine.py:RiskEngine.assess` + `explanation.py:build_explanation` + `thresholds.py` | Evidence-aware weighted `effective_weight = base_weight * (0.6+0.4*confidence)`, `final = sum(score*eff_w)/sum(eff_w)` → `iron_tier` (0-69 SAFE/70-84 CAUTION/85-100 HIGH_RISK) + boost/dampen (single weak -12%, multi-strong +8), binary `is_fraudulent` separate, explanation `summary + top 3-5 reasons (contribution, severity, evidence) + confidence_explanation + breakdown` | Bound currently simple sum `0-100` with fixed caps (30+25+15+15+10+5) and `LOW/MEDIUM/HIGH` (0-29/30-59/60-100) with no deduplication, no confidence, and `risk_factors` raw. Iron’s **dedup** (`_dedup_signals` groups velocity/amount/device/report) prevents double-count, and **explanation** provides human titles (`TITLE_MAP`) and rank by `contribution`. | **GENERIC** | Adopt `_dedup_signals` groups (velocity, amount, device, location, recipient_report) and `build_explanation` pattern for Bound: keep Bound’s `0-100` and `LOW/MEDIUM/HIGH` but add `confidence` and `contribution` per factor. Do not copy Iron tiers (70/85) — keep Bound’s `30/60` for `VERIFY` escalation. Keep `RiskEngine.assess` shape but simplify weights to Bound’s `0.35/0.40/0.15/0.10` → Bound’s `amount 0.25 / velocity 0.30 / merchant 0.15 / category 0.15 / time 0.10 / depth 0.05` (already sum 1.0). |
| 8 | **Feature engineering (31-vector)** | `ml_pipeline/features.py:FEATURE_ORDER` + `generate_feature_vector` + `compute_baseline_from_history` (cold_start <5) | Explicit 31 features: `amount, hour, is_weekend, merchant_frequency, recipient_frequency, days_since, device/location familiarity, account_age, zscore, vs_avg/median, percentile, balance_drop, hour_sin/cos, day_sin/cos, is_rare, is_night, is_peak, hour_freq, category_familiarity, velocity_1h/24h, amount_velocity, weekend_deviation, merch_encoded, payment_method_encoded, is_p2p`; baseline `mean/median/std/p95/p99/weekend_ratio/peak_hours/recipient_freq/velocity` from history `[:50]` | Bound currently computes `avg` only for amount anomaly. Iron’s `baseline` (mean/median/std/p95/p99) + `hour_freq/weekend_ratio` + `recipient_freq/last_seen` is **more robust** and already history-aware (`COLD_START_THRESHOLD=5`). Useful for `time anomaly` and `category familiarity` improvements. | **ADAPTABLE** | Extract `compute_baseline_from_history` (history → baseline) into `Bound services/baseline.py` without `numpy` heavy dependency? Keep `numpy` but use only `mean/median/std` parts. Map `merchant_category` to `category_familiarity` (Iron’s `cat_freq`), `hour` to `hour_freq`. Do not copy `is_p2p`, `payment_method_encoded`, `merchant_category_encoded` (UPI-specific). Keep 31-vector **only if** ML is adopted (see §4). |

**Rule-level classification for `fraud_rules.py` (19 rules):**

| Rule ID | Category | Weight | Bound class | Reason |
|---|---|---|---:|---|
| `HIGH_AMOUNT` (2.5× avg) | AMOUNT | 10 MEDIUM | **GENERIC** | Direct map to Bound amount anomaly |
| `EXTREME_AMOUNT` (6×) | AMOUNT | 18 HIGH | **GENERIC** | Same |
| `ROUND_AMOUNT_LARGE` (₹10k/50k) | AMOUNT | 5 LOW | **GENERIC** | Useful for large delegated caps |
| `NEW_RECIPIENT` | RECIPIENT | 12 MEDIUM | **ADAPTABLE** | Merchant novelty in Bound already; keep but rename `NEW_MERCHANT` |
| `RARE_RECIPIENT` (60d) | RECIPIENT | 6 LOW | **ADAPTABLE** | Same |
| `REPORTED_RECIPIENT` (≥1) | RECIPIENT | 25 CRITICAL | **ADAPTABLE** | Global merchant reputation — needs `merchant_registry` |
| `HIGH_RISK_RECIPIENT` (≥3) | RECIPIENT | 25 CRITICAL | **ADAPTABLE** | Same |
| `OFF_NETWORK_RECIPIENT` | RECIPIENT | 8 MEDIUM | **UPI-SPECIFIC** | UPI ID not in Iron network — no Bound equivalent |
| `ODD_HOUR` (1-5) | TIMING | 14 HIGH | **GENERIC** | Bound already has time anomaly 0-5, keep |
| `LATE_NIGHT` (23-1) | TIMING | 5 LOW | **GENERIC** | Same |
| `HIGH_VELOCITY_5M` (3/5m) | VELOCITY | 16 HIGH | **GENERIC** | Bound has 5/60s — align to 3/5m |
| `HIGH_VELOCITY_1H` (6/1h) | VELOCITY | 10 MEDIUM | **GENERIC** | Same |
| `RECIPIENT_SWITCHING` (3 recipients/30m) | VELOCITY | 15 HIGH | **GENERIC** | Bound `uniq_30m` — already identified as gap |
| `BALANCE_DRAIN_HIGH` (40% balance) | BALANCE | 10 MEDIUM | **ADAPTABLE** | Bound has `effective_limit`; map to `amount/effective_limit` |
| `BALANCE_DRAIN_CRITICAL` (70%) | BALANCE | 22 CRITICAL | **ADAPTABLE** | Same |
| `NEW_DEVICE` | DEVICE | 18 HIGH | **ADAPTABLE** | Map to `new delegated agent instance` — low weight |
| `LOCATION_ANOMALY` | LOCATION | 15 HIGH | **UPI-SPECIFIC** | Requires geo/IP; Bound has no location yet |
| `SEQUENTIAL_AMOUNTS` | BEHAVIOURAL | 16 HIGH | **GENERIC** | Incrementing burst — useful for agent testing loops |
| `URGENCY_LANGUAGE` etc. (6 keyword rules) | BEHAVIOURAL | 8-22 | **UPI-SPECIFIC** | Indian scam language (KYC, lottery, RBI) — keep only `urgency` generic |

---

## 3. Components NOT to Integrate

**Must remain out (UPI-specific, blocking, or duplicate):**

- **UPI-specific workflows:** `OFF_NETWORK_RECIPIENT`, `is_p2p`, `payment_method_encoded` (UPI/Debit/Credit), `UPI handle` structural checks (`detect_upi_structural_risk` — `suspicious_upi_handle`, `impersonation_upi` with `@paytm/@phonepe`), phone `-10` digit normalization, `is_salary_period`, `BALANCE_DRAIN` using `balance_before` (Bound has `effective_limit`, not wallet balance). **Why:** Bound protects `merchant`/`category`/`amount`, not phone/UPI.
- **OTP/Twilio:** `POST /send-otp`, `verify-otp`, `secrets.randbelow`, `TWILIO` env, `otp_server.py` auth (`secrets.token_urlsafe`, `sessions` table), `iron_store` `sessions`, `transaction_reports`, `security_events` OTP events. **Why:** Bound Phase 4 has no auth yet (explicit constraint); OTP would add external infra and `BLOCK`.
- **Payment-blocking logic:** Iron never blocks but has `HIGH_RISK→OTP→PROCEEDED_AFTER_OTP` and `risk_engine` `requires_otp` flag. Bound must stay `ALLOW`/`VERIFY` — risk only escalates, never blocks. **Why:** violates *Risk must NEVER grant authority, never BLOCK*.
- **Demo/admin bypasses:** `phone 1234567890 Admin OTP 000000` always succeeds, `js/constants.js` 15 seeded demo users, `iron_store.seed_users_if_needed`. **Why:** demo scaffolding, not real intelligence.
- **Duplicated authorization systems:** Iron has no `effective_authority`/`mandate`/`delegation` chain — it uses `balance` + `recipient` checks. Do not copy its `POST /transactions/prepare` balance logic.
- **Duplicated databases/APIs:** `iron.db` (`users`, `risk_events`, `baselines`, `scam_registry.json` separate file, `models/*.joblib`). Bound already has `bound.db` with `agents/mandates/delegations/transactions/provenance_events`. Do not merge `scam_registry.json` as-is; create `merchant_reputation` inside Bound's SQLite if needed.
- **Unnecessary frontend code:** `index.html` 7400-line SPA, `js/*` (`fraud-engine.js`, `geo-device.js`, `AI Investigator`, `Simulator`, `Protection Center`), `babel.min.js`, `react*.min.js`. **Why:** Bound has React 19 + Vite; copying would redesign UI (forbidden).
- **Anything that conflicts with `AUTHORIZATION + RISK → FINAL`:** Iron's `requires_otp` tier `SAFE/CAUTION/HIGH_RISK` (70/85 thresholds) vs Bound's `LOW/MEDIUM/HIGH` (30/60) + `ALLOW→VERIFY` escalation. Do not overwrite Bound's thresholds.
- **Slightly out-of-scope:** `LOCATION_ANOMALY` (needs geo), `LOAN`/`REMOTE_ACCESS` keyword sub-types (too India-loan specific), `is_salary_period` (requires payroll calendar).

---

## 4. Isolation Forest Assessment

**Verdict: EXCLUDE — do not integrate the existing model as-is; consider later as *optional* anomaly signal *after* deterministic signals are proven, with retraining on Bound data.**

**Technical reasons:**

1. **Trained on synthetic demo data, not agent payments.** Model artifacts (`models/isolation_forest.joblib` 65 MB, `scaler.joblib`, `user_profiles.joblib` 3 KB, `score_bounds.joblib`) were trained on *generated* `iron_store` histories for 15 synthetic users (`js/constants.js`, `iron_store.seed_users_if_needed`) with `history 10-30` per user, seeded via `generate_benchmark_*.py` seed `42`. No real agent payment distribution. For Bound, agent amounts are `₹800-2000` Groceries vs Iron's human UPI `₹100-5000` mixed categories (Food, Grocery, Transfer). Feature distributions (`amount_mean 1000`, `hour_freq` peak 9-18) will not match agent delegation bursts.

2. **Feature engineering is UPI-phony for Bound.** 31-vector includes `is_p2p`, `payment_method_encoded` (UPI/Debit...), `merchant_category_encoded` with `CAT_ORDER` (`Food Delivery`, `Grocery`, `Transfer`…), `account_age_days`, `balance_drop_pct` (`amount/balance_before`), `is_salary_period`. Bound has no `balance_before`, no `payment_method`, no `salary` concept, and `merchant_category` is `Grocery` vs Iron's 12 categories — many features would be default-filled (`0.5` or `null`), reducing signal.

3. **Artifacts exist but are fragile.** `models/isolation_forest.joblib` (65 MB, Git LFS), `scaler.joblib` (31 features), `user_profiles.joblib` (per-user stats), `score_bounds.joblib` (lo/hi for 0-100 mapping) **do exist** and `IFScorer.load()` validates `n_features_in_ ==31` and `sklearn 1.8.0`. However, they are **pinned to `scikit-learn==1.8.0`** (`requirements.txt`) — Bound uses no ML deps yet; adding `scikit-learn 1.8 + numpy 2 + joblib` adds ~120 MB and version lock, plus `Git LFS` requirement. Inference is **not deterministic across sklearn minor versions** (different `decision_function` after 1.8.1 could shift scores).

4. **Inference is deterministic per model version but not reproducible without retraining.** Given same `txn + history`, `IFScorer.score_with_history` is deterministic (same `generate_feature_vector` → scaler → `decision_function` → `hi-lo` mapping). But `score` depends on `user_profiles` (per-user mean/std) which are **synthetic** (from Iron's 15 users, mapped via `PHONE_TO_PROFILE` `U001..U004`). For Bound's `shopping-agent` (no phone), `profile` fallback is empty → `cold_start=True`, `confidence 0.25-0.35`, `history_count<5` dampens score. This is **not meaningful** for agent payments.

5. **Confidence and history handling is UPI-tuned.** `IFScorer._compute_confidence` (`base 0.25 + history/30*0.45 + profile 0.15 + completeness 0.10`, `cold_start *0.65`) and `_build_explanations` (`z-score ≥3 HIGH`, `velocity_1h ≥6 HIGH`) are tuned for human UPI bursts (5 in 60s is attack). For agents, `5 in 60s` may be **legitimate** (batch grocery orders), so thresholds would need retuning.

6. **Benchmarks are synthetic and not transferable.** `benchmark_binary_500` (300 DEV/100 VAL/100 FINAL) **tier ~74-78%**, **binary ~87-88%** on *generated* cases with 5 categories mixed; `BENCHMARK_300` etc. are not agent payments. No evidence the model generalizes to `Agent B → Groceries` vs `Electronics`.

7. **Better deterministic signals already cover 80% of value.** Bound's current `risk.py` already implements `velocity (30)`, `amount anomaly (25)`, `merchant novelty (15)`, `category anomaly (15)`, `time (10)`, `delegation depth (5)` — these overlap with Iron's `fraud_rules` + `velocity` + `amount_zscore`. Adding IF would duplicate but with **higher cost and lower explainability** (IF is black-box vs Iron's `fraud_rules` already explainable).

**Recommendation:** **EXCLUDE now.** Prefer **reusable deterministic intelligence** (velocity, z-score, recipient reputation, keyword, device). If ML is later desired, **replace** (do not integrate as-is) with a **new Isolation Forest retrained on Bound's own `Transaction` history** (agent-centric, not UPI), with **agent-agnostic features** (drop `is_p2p`, `payment_method`, `is_salary`, `balance_drop`; keep `amount_zscore, vs_avg/median, percentile, hour_sin/cos, day_sin/cos, velocity_1h/24h, category_familiarity, merchant_frequency, delegation_depth`), and store as `models/bound_iforest.joblib` with `Bound` profiles (per-agent). Keep it **optional** behind `RISK_ML_ENABLED=false` and ensure it only contributes `+10` max via `effective_weight` so it cannot override deterministic `VERIFY`.

---

## 5. Proposed Bound Risk Architecture (after Iron integration)

Keep `AUTHORIZATION` and `ALLOW/VERIFY` semantics, extend `Risk` to be evidence-aware:

```
Payment Request {agent_id, amount, merchant, merchant_category, purpose}
      ↓
Effective Authority (existing, unchanged)
  validate_effective_authority(agent) → root_mandate, delegation_chain, effective_limit/purpose
      ↓
Authorization (existing, unchanged)
  evaluate_authorization → auth_decision (ALLOW/VERIFY) + reason + chain
      ↓
Risk Intelligence (deterministic, expanded with Iron-derived signals)
  ├── Bound-native (keep)
  │     ├─ Amount anomaly (ratio vs avg) → KEEP, enhance with z-score/p95 (adapt from Iron)
  │     ├─ Velocity (60s/5m counts) → KEEP, add uniq_30m + escalation (from Iron)
  │     ├─ Merchant novelty (last 10) → KEEP
  │     ├─ Category anomaly (last 5) → KEEP
  │     ├─ Time anomaly (hour) → KEEP, add weekend_ratio/peak_hours baseline
  │     └─ Delegation depth (0/1/2) → KEEP
  ├── Iron-derived (new, generic/adaptable)
  │     ├─ Recipient/Merchant reputation (personal familiarity + global merchant_registry.json, 24h dedup, report_count tiers CLEAN/FLAGGED/HIGH_RISK) ← from recipient.py + scam_registry.py (adapt UPI phone → merchant lowercased)
  │     ├─ Deterministic fraud rules subset (12/19 generic: HIGH_AMOUNT/EXTREME_AMOUNT/ROUND_AMOUNT, NEW/RARE/REPORTED recipient, ODD_HOUR, VELOCITY_5M/1H, BALANCE_DRAIN→effective_limit drain, SEQUENTIAL_AMOUNTS) ← from fraud_rules.py + fraud_scorer logistic
  │     ├─ Social engineering (urgency/impersonation) trimmed to Bound purpose/merchant note ← from keyword_detector.py (keep only urgency/impersonation, drop OTP/KYC/UPI handle)
  │     └─ Feature baseline (mean/median/std/p95/p99, hour_freq, recipient_freq, velocity) ← from features.py compute_baseline_from_history (without 31-vector)
  └── optional ML (future, not now)
        └─ Isolation Forest retrained on Bound (if ever) → contributes ≤10 points, behind flag, evidence-aware weight

      ↓ evidence-aware weighted scoring (keep Bound 0.25/0.30/0.15/0.15/0.10/0.05, or rebalance to 0.30/0.25/0.20/0.15/0.05/0.05 after adding recipient)
          + dedup groups (velocity, amount, device, recipient_report) ← from Iron risk_engine/engine.py _dedup_signals
          + explanation (title, severity, description, evidence, contribution) ← from explanation.py

      ↓
Final Decision (unchanged)
  auth != ALLOW → VERIFY
  else risk LOW (0-29) → ALLOW
  else risk MEDIUM/HIGH (30-100) → VERIFY (escalated, never BLOCK)
      ↓
Transaction (persist final + auth + risk_score/level/factors)
      ↓
Provenance (append AUTHORIZATION_DECIDED with authorization_status, risk_*, final_decision, chain)
      ↓
API Response {decision(final), authorization_status, risk_score/level/factors, chain, reason}
```

**Keep stable:** `POST /payments/authorize` response shape (`decision` = final, `authorization_status`, `risk_*`, `chain`), `Transaction {decision, authorization_status, risk_*}` (already added Phase 6), `GET /provenance/verify` (hash chain unchanged), thresholds `LOW 0-29/MEDIUM 30-59/HIGH 60-100` (Bound) — do not switch to Iron `70/85`.

---

## 6. Recommended File Changes (do NOT implement yet)

**Backend — new files:**
- `backend/services/merchant_reputation.py` *(new, ~180L, adapt `scam_registry.py`)* — JSON `data/merchant_registry.json`, `_normalize_merchant(merchant.lower())`, `report_merchant(merchant, reporter, reason)`, `get_merchant_reputation(merchant)` → `report_count, reputation, recency, signals`, atomic tmp write, 24h dedup, 30s cache, tier `clean/flagged(1)/high_risk(3)`, no UPI. Generic.
- `backend/services/fraud_rules.py` *(new, ~120L, adapt `fraud_engine/fraud_rules.py`)* — subset `BOUND_RULES: HIGH_AMOUNT(2.5×), EXTREME_AMOUNT(6×), ROUND_AMOUNT_LARGE, NEW_MERCHANT, REPORTED_MERCHANT, ODD_HOUR(1-5), HIGH_VELOCITY_5M(3/5m), HIGH_VELOCITY_1H(6/1h), RECIPIENT_SWITCHING(3/30m), BALANCE_DRAIN(40%/70% vs effective_limit), SEQUENTIAL_AMOUNTS`. Keep `ALL_RULES`, `RULES_BY_ID`, `Severity`, `PatternCategory`.
- `backend/services/keyword_detector.py` *(new, ~150L, trimmed `fraud_engine/keyword_detector.py`)* — keep `URGENCY_TERMS`, `IMPERSONATION_TERMS`, `REWARD_TERMS`, `INVESTMENT_TERMS` (4/8 categories), drop `OTP/ACCOUNT_THREAT/LOAN/REMOTE_ACCESS/UPI`. Keep Levenshtein `>3→99`. Export `detect_bound_keywords(purpose, merchant)` → signals `urgency_language`, `impersonation_language`.
- `backend/services/baseline.py` *(new, ~120L, adapt `ml_pipeline/features.py:compute_baseline_from_history`)* — `compute_baseline(history: Transaction[]) → {amount_mean/median/std/p95/p99, weekend_ratio, peak_hours, merchant_freq, recipient_set, velocity}` without `numpy` heavy `31-vector`; keep `COLD_START_THRESHOLD=5`, use `statistics` or `numpy` if already present, else pure python.

**Backend — modify:**
- `backend/services/risk.py` — keep `evaluate_risk` signature, **import** `merchant_reputation.get_merchant_reputation`, `fraud_rules.match_bound_rules`, `keyword_detector.detect_bound_keywords`, `baseline.compute_baseline`. Extend `evaluate_risk` to (a) call `baseline` for `zscore/p95`, (b) add `MERCHANT_REPUTATION` signal (`report_count≥1 → HIGH 18, ≥3 → CRITICAL 28`), (c) add `BALANCE_DRAIN` via `amount/effective_limit`, (d) add `SEQUENTIAL_AMOUNTS` via `recent_amounts` incrementing, (e) add `KEYWORD` signals, (f) deduplicate via `_dedup_signals` (copy from `risk_engine/engine.py` but Bound's 6 groups). Keep scoring caps `100` and `risk_level` thresholds `30/60`. Do **not** change `authorization` import.
- `backend/models.py` — *optional* if merchant registry is SQLite instead of JSON: add `MerchantReputation(merchant PK, report_count, tier, first/last_reported)` — but prefer JSON file `data/merchant_registry.json` to avoid migration, like Iron.
- `backend/schemas.py` — add `MerchantReportRequest(merchant, reason)` and `MerchantReputationResponse` if exposing `POST /merchants/report` + `GET /merchants/check`; otherwise no schema change needed for risk (already has `RiskFactor`, `risk_score/level/factors`).
- `backend/main.py` — add **only** `POST /merchants/report` + `GET /merchants/reputation/{merchant}` (adapt `scam_registry` endpoints) if merchant reputation is desired; keep `POST /payments/authorize` unchanged (risk already extended). No change to `effective_authority` or `provenance` hash.
- `requirements.txt` — **no new deps** for deterministic path (keep `fastapi, sqlalchemy, pydantic, uvicorn`). If `baseline` uses `numpy`, add `numpy>=1.26` (already via Iron but Bound currently has no `numpy`; can avoid by using `statistics`).

**Frontend — new/modify (minimal):**
- `src/services/api.ts` — add `reportMerchant(merchant, reason)`, `getMerchantReputation(merchant)` wrappers for `POST /merchants/report` (only if merchant registry added); otherwise no change (risk already fetched via `authorizePayment`).
- `src/views/PaymentVerificationView.tsx` — keep existing 3-column `AUTHORIZATION | RISK | FINAL`; no redesign, just ensure `risk_factors` now may include `MERCHANT_REPUTATION` and `KEYWORD` types (render generically via `f.type` already).
- `src/views/SecurityAuditView.tsx` — keep risk summary card, but extend `Risk Summary` to also show `Merchant Reputation` flagged count if `merchant_registry` added: `High-risk merchants ≥3 reports` (query `GET /merchants/flagged`).

**Do NOT touch:**
- `backend/services/effective_authority.py`, `authorization.py`, `provenance.py` (hash chain), `backend/models.py` core tables (`agents/mandates/delegations/transactions` already have risk columns), `backend/main.py` `POST /payments/authorize` `ALLOW/VERIFY` semantics, `frontend` design, `vite.config.ts`, `Bound` `bound.db`.

---

## 7. Test Plan

**Must not break:**

1. **Authorization** — Direct `shopping-agent` 800 Groceries → `ALLOW`; `payment-agent` 800 via `del-1001` → `ALLOW`; unauthorized `1500` → `VERIFY` (risk LOW still `VERIFY`).
2. **Delegation** — `A→B` 1000 within 2000 Groceries → `ALLOW` create; `B→C` 500 → `ALLOW` create; `C` 400 via `B→C` → `ALLOW` with chain 7.
3. **Revocation propagation** — Revoke `A` → `C` `VERIFY Upstream agent has been revoked`; revoke `mnd-4091` → `C` `VERIFY Root mandate has been revoked`; revoke `A→B` → `C` `VERIFY Upstream delegation`; restore each → `ALLOW` again (same as Phase 4 suite, 12 cases).
4. **Provenance** — `GET /provenance/verify` `valid True` after normal ops; tamper `UPDATE event_data` → `valid False, broken_event_id, hash mismatch` → delete `bound.db` + restart → `valid True` again; historical `GET /provenance/transaction/{tx}` still 3 events after revoke.
5. **Existing Phase 6 risk behavior** — Fresh agent `800` → `LOW 0 ALLOW`; `5×100 in 60s` → 6th `MEDIUM/HIGH VERIFY`; `new merchant` → `MERCHANT_NOVELTY MEDIUM`; `category anomaly` `Electronics` after Groceries → `CATEGORY_ANOMALY MEDIUM`; `amount anomaly` `1800` vs avg ~300 → `AMOUNT_ANOMALY HIGH`; `deep delegation` depth2 → `DELEGATION_DEPTH LOW +5` → still `LOW` unless other signals; `HIGH` risk `1900` + velocity + novel → `ALLOW auth → VERIFY final`.
6. **ALLOW/VERIFY semantics** — No code path produces `BLOCK`/`FROZEN`/`NETWORK_BLOCKED`; `decision` is only `ALLOW` or `VERIFY`; `risk` never grants `ALLOW` when `authorization_status=VERIFY` (test: `payment-agent` 1500 `auth VERIFY` + `risk LOW` → `final VERIFY`).
7. **Deterministic risk** — Same `agent_id, amount, merchant, category, purpose, effective_limit, delegation_depth` + identical history (no new tx between calls) → same `risk_score/level/factors`. Test via `risk_service.evaluate_risk` called twice without persisting second tx.

**Also explicitly test no `BLOCK`:**

- Grep `decision.*BLOCK`, `BLOCK`, `FROZEN`, `requires_otp`, `HIGH_RISK.*OTP`, `PROCEEDED_AFTER_OTP` — must return 0 in `Bound` (Iron has `requires_otp` but Bound must not). `POST /payments/authorize` with `HIGH` risk should still return `decision: "VERIFY"` not `"BLOCK"`.

**New deterministic risk tests (after Iron-derived signals added):**

8. **Merchant reputation** — Report `BadMerchant` 3× via `POST /merchants/report` (different reporters, 24h dedup), then `payment-agent` 800 to `BadMerchant` → `risk_factors` includes `MERCHANT_REPUTATION HIGH/CRITICAL` with `report_count 3`, `risk_level` escalates `LOW→MEDIUM/HIGH`, `final VERIFY` even though `auth ALLOW`; `GET /merchants/reputation/BadMerchant` → `HIGH_RISK`. Report same merchant same reporter within 24h → `deduplicated True`, count unchanged.
9. **Keyword** — `purpose` or `merchant` with `urgent lottery winner` → `KEYWORD urgency_language MEDIUM`, `reward_prize_scam HIGH`; `investment` with `crypto double profit` → `investment_scam HIGH`.
10. **Amount z-score** — History `avg 800, std 100`, new `2500` → `z≈17 → HIGH` (Iron uses `z>=3 HIGH`), Bound should map to `AMOUNT_ANOMALY HIGH 25` (existing) but now also `BALANCE_DRAIN` if `amount/effective_limit >0.7` → `CRITICAL 22`.
11. **Sequential amounts** — 3 tx amounts `100→150→230` (incrementing) + current `350` → `SEQUENTIAL_AMOUNTS HIGH 16` (Iron's burst) → escalates.
12. **Dedup** — Send tx that triggers both `amount_deviation` and `HIGH_AMOUNT` (same amount anomaly) → `risk_factors` should dedup to one `amount` group (keep highest severity), not double-count (+25+18). Verify via `risk_score` not inflated.

**Provenance with risk:** `AUTHORIZATION_DECIDED` `event_data` must still contain `risk_score/level/factors` and `verify` stays `valid True` after each new type.

**Frontend:** `npm run lint` (no `any` without type), `npm run build` (47 modules, ~380kB), Security tab shows `Risk Evaluations: X, High Y, Medium Z, Interventions N` derived from `transactions` `risk_level` (real, not fake), Payment Verification shows `AUTHORIZATION | RISK | FINAL` with new factor types (`MERCHANT_REPUTATION`, `KEYWORD`, `BALANCE_DRAIN`) rendered generically.

**Manual tamper:** `UPDATE provenance_events SET event_data='{"tampered":true}' WHERE sequence_number=1` → `GET /provenance/verify` `valid False` → delete `bound.db` → `valid True` (as before).

