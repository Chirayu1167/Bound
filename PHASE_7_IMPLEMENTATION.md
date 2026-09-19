# Bound — Phase 7 Implementation

**Date:** 2026-09-19
**Status:** Implemented and verified — deterministic risk intelligence from Iron, no ML, no BLOCK.

---

## 1. Files created / modified

**New backend services (Iron-adapted, deterministic):**
- `backend/services/baseline.py` (~120L) — `compute_baseline(history)` → `{mean/median/std/p95/p99/min/max, hour_freq/peak_hours/weekend_ratio, merchant_freq/set, category_freq/set}`. Pure `statistics`+`math`, `COLD_START_THRESHOLD=5`, no `numpy` required.
- `backend/services/merchant_reputation.py` (~210L) — `data/merchant_registry.json` (atomic tmp write), `_normalize_merchant(lower)`, `report_merchant` (24h dedup per reporter+merchant, tiers `clean/flagged(1)/high_risk(3)`), `get_merchant_reputation` (+confidence, recency, `reputation`/`tier`/`signals`), 30s cache, `get_all_flagged`, `get_stats`. Generic, no UPI phone `-10` logic.
- `backend/services/fraud_rules.py` (~110L) — `FraudRule(id, category, severity, base_weight, thresholds)` + `ALL_RULES` **12 generic** subset: `HIGH_AMOUNT(2.5×)`, `EXTREME_AMOUNT(6×)`, `ROUND_AMOUNT_LARGE(10k)`, `NEW_MERCHANT`, `REPORTED_MERCHANT`, `HIGH_RISK_MERCHANT`, `ODD_HOUR(1-5)`, `LATE_NIGHT`, `HIGH_VELOCITY_5M(3/5m)`, `HIGH_VELOCITY_1H(6/1h)`, `RECIPIENT_SWITCHING(3/30m)`, `BALANCE_DRAIN_HIGH(40%)`, `BALANCE_DRAIN_CRITICAL(70%)`, `SEQUENTIAL_AMOUNTS`; `RULES_BY_ID`. Excludes UPI-specific `OFF_NETWORK`, `is_p2p`, `payment_method`, `LOCATION_ANOMALY`.
- `backend/services/keyword_detector.py` (~150L) — trimmed to 4 generic categories: `URGENCY_TERMS`, `IMPERSONATION_TERMS` (generic authority), `REWARD_TERMS`, `INVESTMENT_TERMS` (dropped `OTP/ACCOUNT_THREAT/LOAN/REMOTE_ACCESS/UPI`). Levenshtein `>3→99` kept, `detect_bound_keywords(purpose,merchant)` → signals `urgency_language`, `impersonation_language`, `reward_prize_scam`, `investment_scam` with `CATEGORY_WEIGHTS`.

**Modified backend:**
- `backend/services/risk.py` — upgraded from 6 simple signals to **Iron-derived deterministic engine**: imports `baseline`, `merchant_reputation`, `fraud_rules`, `keyword_detector`; helper `_amount_anomaly_signals` (z-score, p95/p99, balance drain), `_velocity_signals` (prospective `+1` for `cnt_5m/cnt_1h`, `uniq_30m`, escalation), merchant novelty + global reputation, category, time (odd hour), keyword, delegation depth; **dedup** `_DEDUP_GROUPS` narrow (velocity_count vs recipient_switch separate, amount vs balance drain separate) keeps highest severity/score per group; scoring preserved `LOW 0-29/MEDIUM 30-59/HIGH 60-100`, max 100.
- `backend/models.py` — added `Transaction.authorization_status, risk_score, risk_level, risk_factors(Text JSON)` (Phase 6 already had these; kept)
- `backend/schemas.py` — `RiskFactor`, `TransactionResponse` + risk fields + `field_validator` JSON parse, `AuthorizeResponse` extended with `authorization_status, authorization_reason, risk_score/level/factors, final_decision`, `MerchantReportRequest`, `MerchantReputationResponse`
- `backend/main.py` v0.6.0→v0.7.0 — added `from backend.services import risk`, new `_authorize_internal` flow `effective→auth→risk→final` (auth `VERIFY` → final `VERIFY`; `ALLOW+LOW→ALLOW`, `ALLOW+MEDIUM/HIGH→VERIFY`), store `risk_*` on `Transaction`, provenance `AUTHORIZATION_DECIDED` now includes `risk_score/level/factors, authorization_status, final_decision`; added `POST /merchants/report`, `GET /merchants/reputation/{merchant}`, `GET /merchants/flagged` (both `/` and `/api/`), plus provenance already in Phase 5.

**Frontend (minimal, no redesign):**
- `src/types.ts` — `RiskFactor`, `TransactionRecord` + `authorization_status/risk_*`
- `src/services/api.ts` — `BackendTransaction` + risk fields, `AuthorizeResult` + risk, `mapBackendTransaction` parses `risk_factors` JSON, `reportMerchant`, `getMerchantReputation`, `getFlaggedMerchants`
- `src/views/PaymentVerificationView.tsx` — rebuilt live card to show **3-column** `AUTHORIZATION | RISK (score/100 bar) | FINAL DECISION`, `Risk Factors` list with `HIGH/MEDIUM/LOW` pills, delegation chain, recent Tx table now `Auth | Risk | Final` columns, quick tests expanded: `₹800→ALLOW LOW`, `₹1.8k→ALLOW but HIGH (amount anomaly)`, `Generate velocity (5×100→100→VERIFY)`, `New merchant`, `Electronics cat anomaly`, `payment-agent` delegation, `urgent lottery winner` keyword.
- `src/views/SecurityAuditView.tsx` — added **Risk Summary** card after provenance verify: `Risk Evaluations` (count `risk_score!=null`), `High` 60-100, `Medium` 30-59, `Verification Interventions` (`decision VERIFY && authorization ALLOW` = risk escalations), derived from live `transactions`.

**No new dependencies** (still `fastapi, sqlalchemy, pydantic, uvicorn`; `baseline` uses `statistics`, not `numpy`; no `sklearn`).

---

## 2. Iron components successfully integrated

| Iron source | Bound adaptation | Type |
|---|---|---|
| `fraud_engine/intelligence.py:detect_velocity_signals` (cnt_5m/1h/uniq_30m, prospective +1, burst) | Extended `risk.py: _velocity_signals` to include `uniq_30m` and `amount_escalation_burst` as `RECIPIENT_SWITCHING` + `SEQUENTIAL_AMOUNTS` | Generic |
| `ml_pipeline/features.py:compute_baseline_from_history` (mean/median/std/p95/p99, cold_start <5, hour_freq, merchant_freq) | `services/baseline.py:compute_baseline` pure python `statistics` → used in `_amount_anomaly_signals` (z-score, p95/p99) and time/category familiarity | Adaptable |
| `risk_engine/recipient.py` + `scam_registry.py` (personal familiarity NEW/FAMILIAR/FREQUENT, global report_count tiers, 24h dedup, cache) | `services/merchant_reputation.py` with `merchant.lower()` (no phone), `data/merchant_registry.json`, same dedup/cache/tier logic | Adaptable |
| `fraud_engine/fraud_rules.py` (19 rules) → 12 generic subset + `pattern_matcher` thresholds | `services/fraud_rules.py` with `HIGH/EXTREME_AMOUNT`, `NEW/REPORTED_MERCHANT`, `ODD_HOUR`, `HIGH_VELOCITY_5M/1H`, `RECIPIENT_SWITCHING`, `BALANCE_DRAIN` (vs `effective_limit`), `SEQUENTIAL_AMOUNTS` | Generic (12) |
| `fraud_engine/keyword_detector.py` (8 categories, Levenshtein) | `services/keyword_detector.py` trimmed to 4 generic (urgency, impersonation, reward, investment), kept `CATEGORY_WEIGHTS` and fuzzy, applied to `purpose`+`merchant` only, capped keyword total to not dominate | Adaptable |
| `risk_engine/engine.py:_dedup_signals` (groups velocity/amount/device/report, keep highest severity) + `explanation` ranking | `services/risk.py:_DEDUP_GROUPS` narrow (velocity_count vs recipient_switch separate, amount vs balance drain separate) + contribution ranking, `build_explanation` style via `severity`/`score` sorting | Generic |
| `risk_engine/thresholds.py` (weights, tiers) | Kept Bound thresholds `LOW 0-29/MEDIUM 30-59/HIGH 60-100` (not Iron `70/85`), preserved `ALLOW/VERIFY` escalation | Generic |

---

## 3. Risk signals now available (Phase 7, deterministic, 0-100)

| Signal | Iron origin | Scoring | Example message | When triggers |
|---|---|---:|---|---|
| **AMOUNT_ANOMALY** | `z-score`, `p95/p99` | HIGH 25 / MEDIUM 15 | `Amount ₹1800 exceeds p99 ₹500 (mean ₹200, z=5.2)` | `≥p99` or `z≥3` or `≥2.5× avg` |
| **BALANCE_DRAIN** | `effective_limit` drain | HIGH 18 (≥70%) / MEDIUM 10 (≥40%) | `Amount consumes 90% of effective limit ₹5000` | `amount/effective_limit ≥0.7` |
| **HIGH_VELOCITY** | `cnt_5m` prospective | HIGH 30 (≥5/5m) / HIGH 20 (≥3/5m) / MEDIUM 15 (≥6/1h) | `5 transactions in 5 minutes — rapid burst` | `cnt_5m+1 ≥3` |
| **RECIPIENT_SWITCHING** | `uniq_30m` | HIGH 15 / MEDIUM 8 | `Paying 3 different merchants in 30m — switching pattern` | `uniq_30m ≥3` with velocity |
| **SEQUENTIAL_AMOUNTS** | `recent_amounts` escalating | MEDIUM 12 | `Amounts escalating: 200→300→500 — testing pattern` | `amt ≥ prev*1.3` for 3 steps & `>500` |
| **NEW_MERCHANT** | `merchant not in last 10` | MEDIUM 12 | `Merchant 'X' is new — not seen in last 5 merchants` | `merchant_norm not in recent_merchants` |
| **REPORTED_MERCHANT** | `merchant_registry` | HIGH 18 (1 report) / CRITICAL 28 (≥3) | `Merchant 'BadMerchant' has 3 fraud reports (high-risk)` | `report_count ≥1` |
| **CATEGORY_ANOMALY** | `category history` | MEDIUM 15 | `Category 'Electronics' differs from recent (Groceries)` | `cat not in last 5` |
| **ODD_HOUR / TIME_ANOMALY** | `hour 1-5` vs `peak_hours` | MEDIUM 10 / LOW 5 | `Unusual hour 2:00 — recent were daytime` / `Transaction only 5s after previous` | `hour 0-5` and recent `8-20` or `<30s` gap |
| **KEYWORD** | `urgency/reward/investment` | 8-15 (capped) | `Urgency/pressure language: urgent` / `Prize/reward lure` | `purpose`/`merchant` contains term (fuzzy) |
| **DELEGATION_DEPTH** | `delegation_chain len` | LOW 2 (depth1) / 5 (depth≥2) | `Delegation depth 2 — slight elevated context` | `depth 1/2+` |
| **ROUND_AMOUNT_LARGE** | `≥10k and %1000==0` | LOW 5 | `Large round amount ₹10000 — commonly seen in scam requests` | `amount≥10000 and round` |

All produce `RiskFactor{type, severity, message, score}` and are deduplicated per group before summing.

---

## 4. Changes to scoring / deduplication

- **Baseline:** Previously `ratio vs avg` only (2.5/2.0/1.5). Now `compute_baseline` gives `mean/median/std/p95/p99` via `statistics`; `z-score` and `p99/p95` are primary, `ratio` fallback. Handles `cold_start` (<3 history → no amount anomaly) safely with `statistics` without `numpy`.
- **Velocity:** Previously `60s:6→30,5→30,3→15,2→5` plus `5m:10→30,≥5→15`. Now prospective `+1`, adds `uniq_30m` and `escalation` as separate factors, but **dedup** ensures `HIGH_VELOCITY` and `VELOCITY` same group → keep highest, while `RECIPIENT_SWITCHING` is **separate** group (not deduped with velocity) to allow both to contribute when truly distinct (e.g., 5× same merchant → only velocity; 3× different merchants → velocity + switching).
- **Merchant:** Previously `MERCHANT_NOVELTY 15` for `not in last 10`. Now split into `NEW_MERCHANT` (personal, 12) + `REPORTED_MERCHANT` (global, 18/28) — separate groups `merchant_report` vs `NEW_MERCHANT`? Actually `NEW_MERCHANT` vs `REPORTED` are separate groups per audit, but we keep them separate from velocity, so both can contribute (e.g., new + reported → `MEDIUM` + `CRITICAL` → escalates to `HIGH`).
- **Category/time/keyword:** Previously simple; now baseline-aware `hour_freq` and keyword fuzzy, but capped so keyword total ≤15 to not dominate.
- **Balance drain:** Previously not present; now `BALANCE_DRAIN` `10/18` based on `amount/effective_limit`, kept separate from `AMOUNT_ANOMALY` group (not deduped) so both can contribute when amount is both anomalous and draining.
- **Dedup:** Previously none beyond implicit. Now `_DEDUP_GROUPS` narrow: `velocity_count` (all velocity variants together), `recipient_switch` separate, `amount` (HIGH/EXTREME/ROUND), `merchant_report` (NEW vs REPORTED separate? Actually we keep `NEW_MERCHANT` separate from `REPORTED_MERCHANT` — they are different groups, so both can contribute), `keyword` group. Ensures `HIGH_VELOCITY` and `VELOCITY_5M` don't double count, but `HIGH_VELOCITY` and `RECIPIENT_SWITCHING` do stack (they are different evidence).

Scoring preserved `0-100`, `LOW/MEDIUM/HIGH` 30/60 thresholds, max 100, same `ALLOW` if `LOW` else `VERIFY` escalation.

---

## 5. API compatibility

`POST /payments/authorize` **compatible** — still `transaction_id, decision(final), reason, chain, mandate_id, delegation_id` plus **new** `authorization_status, authorization_reason, risk_score, risk_level, risk_factors, final_decision` (all optional, backward compat). Old frontend ignoring new fields still shows `decision`.

`GET /transactions` now includes `authorization_status, risk_score/level/factors` per transaction (parsed via `field_validator` from JSON string). Old `decision` remains final.

New endpoints (optional, not breaking): `POST /merchants/report` `{merchant,reason,reporter}`, `GET /merchants/reputation/{merchant}`, `GET /merchants/flagged?min_count=1` — all at both `/` and `/api/` prefixes, like Iron.

No second authorization endpoint, no second risk endpoint, no `BLOCK`.

---

## 6. Tests performed and results (after clean DB 21→39 events, `npm run lint`/`build` PASS, `GET /provenance/verify` valid True)

**Existing behavior (Phase 2-5 still pass):**
1. Normal `shopping` 800 Groceries → `auth ALLOW, risk LOW 0, final ALLOW` PASS
2. Unauthorized `3000` (>2000) → `auth VERIFY, final VERIFY` PASS
3. Wrong purpose `Electronics` → `auth VERIFY, final VERIFY` PASS
4. Revoked `payment-agent` → `payment-agent` 500 → `VERIFY Upstream agent has been revoked` PASS
5. Revoked `mnd-4091` → `shopping` 800 → `VERIFY Root mandate has been revoked` PASS
6. Revoked `del-1001` → `payment-agent` 500 → `VERIFY Upstream delegation` PASS
7. Deep `A→B→C` (`agent-c` 400 via `del-...` 500) → `ALLOW` chain 7 PASS
8. `GET /provenance/verify` → `valid True` after normal ops PASS

**New risk intelligence (Iron-derived):**
9. High velocity: 5×100 in 60s → 6th `100` → `risk MEDIUM/HIGH` with `HIGH_VELOCITY` + `TIME_ANOMALY` → `ALLOW→VERIFY` PASS (now 30 for 5/5m → MEDIUM 35)
10. Recipient switching: 3 distinct merchants in 30m → `RECIPIENT_SWITCHING HIGH` → `MEDIUM/HIGH` PASS
11. New merchant `BrandNewMerchantXYZ12345` → `NEW_MERCHANT MEDIUM 12` PASS
12. Reported merchant: `POST /merchants/report` `BadMerchantXYZ2` ×3 (different reporters) → `GET /merchants/reputation` `HIGH_RISK` → `payment-agent` 800 to `BadMerchantXYZ2` → `REPORTED_MERCHANT CRITICAL 28` → `HIGH` PASS; same reporter dedup within 24h → count stays 3 PASS
13. Large amount anomaly: fresh agent avg 200 → 2000 (10×) → `AMOUNT_ANOMALY HIGH 25` + `z` → `HIGH` PASS
14. Effective-limit drain: `AmountTestAgent` limit 5000 → 4500 (90%) → `BALANCE_DRAIN HIGH 18` + `AMOUNT_ANOMALY` → `HIGH 68` PASS
15. Odd-hour: skipped (hour 16 daytime) — time anomaly correctly not flagged when hour is day, but `ODD_HOUR` would trigger at 1-5 (tested via code path, not live hour) — logic verified via unit logic
16. Keyword: `purpose="urgent lottery winner"` → `urgency_language` + `reward_prize_scam` → `HIGH` PASS; `investment` `crypto double profit` → `investment_scam HIGH` PASS
17. Dedup: velocity burst that would trigger both `HIGH_VELOCITY` and `VELOCITY` → deduped to 1 `velocity_count` group (count 1) PASS, while `HIGH_VELOCITY` + `RECIPIENT_SWITCHING` remain separate (2 groups) PASS
18. Explanations: every `risk_factors` has `type, severity, message, score` → UI renders `HIGH Unusual amount` etc. PASS

**Critical invariants (must never break):**
19. Risk never grants: `shopping 3000` `auth VERIFY` + `risk LOW` → `final VERIFY` PASS
20. Delegation constraints: `agent-c` 600 >500 `auth VERIFY` + `risk LOW` → `final VERIFY` PASS
21. Revocation bypass: revoked `A` → `C` 400 → `VERIFY` regardless of `LOW` risk PASS
22. No `BLOCK`: `grep -r "BLOCK"` in `Bound` → 0, all `decision` are `ALLOW`/`VERIFY` PASS
23. `ALLOW` only when `auth ALLOW` **and** `risk LOW` → fresh `AllowTestAgent` 800 `auth ALLOW, risk LOW 0` → `ALLOW` PASS; same agent `1900` `auth ALLOW, risk HIGH 70` → `VERIFY` PASS
24. Provenance contains risk: `GET /provenance/transaction/{tx}` `event_data` has `risk_score`/`risk_level`/`risk_factors` PASS; `AUTHORIZATION_DECIDED` includes `chain`
25. `GET /provenance/verify` → `valid True` after normal ops (checked 39 after demo) PASS

Also `npm run lint` PASS, `npm run build` 47 modules 389kB PASS.

---

## 7. Known limitations

- **No real merchant network yet:** `merchant_registry.json` starts empty; `reported` only after manual `POST /merchants/report`. In production, seed with known bad merchants or import `Iron` `scam_registry.json` (not done to avoid UPI phone normalization).
- **Baseline cold start:** `history_count <3` → no `AMOUNT_ANOMALY` (avoids false positives); first real tx after clean DB is always `LOW 0` (as tested with fresh agent).
- **Time anomaly is simple:** Only `hour 0-5 vs recent day 8-20` and `<30s` gap; no `weekend_ratio`/`peak_hours` histogram like Iron (kept simple per audit).
- **Keyword is low weight:** Capped so `urgency` alone cannot push `LOW→HIGH`; needs combination (e.g., `urgency` + `velocity` → `MEDIUM`). Prevents `purpose="urgent"` alone from blocking.
- **Balance drain uses `effective_limit`**, not wallet `balance_before` (Bound has no balance); `drain = amount / effective_limit` is proxy for Iron's `balance_before`.
- **No `numpy`:** Uses `statistics` for `mean/median/std/p95/p99`; `p95` via sorted + linear interpolation, not `numpy.percentile` (avoid dep).
- **Merchant normalization is `lower()` only** (no phone `-10` digit logic); `Groceries` vs `grocery` still matches via `_matches` lowercasing, but `ABC Supermarket` vs `abc supermarket` considered same (desired for Bound).
- **Dedup is narrow:** `HIGH_VELOCITY` and `RECIPIENT_SWITCHING` are separate groups (intentionally, to allow both to contribute for true switching attacks); if they should be grouped per Iron, adjust `_DEDUP_GROUPS`.
- **Seed transactions have `risk_score=NULL`** (created before risk layer); only new `POST /payments/authorize` have risk. Risk summary counts only `risk_score!=null` (6 demo tx → 3 HIGH, 2 MEDIUM, etc.).

---

## 8. Future ML integration notes (per audit, not implemented)

Isolation Forest remains **excluded**. Artifacts exist (`isolation_forest.joblib` 65 MB, `scaler`, `user_profiles`) but are UPI-synthetic (15 users, 31 features including `is_p2p`, `payment_method`, `balance_drop`, `is_salary`). For Bound, would need retraining on **agent-centric** history (`amount, hour, merchant, category, velocity, delegation_depth` only) with `Bound Transaction` as training set, per-agent `mean/std` (not phone `U001`), and `cold_start` handling. If added later, keep behind `RISK_ML_ENABLED=false`, max contribution `+10` via `effective_weight` (so deterministic `VERIFY` not overridden), and store as `models/bound_iforest.joblib` (not `isolation_forest.joblib`), with `sklearn` version pinned and `Git LFS` avoided.

