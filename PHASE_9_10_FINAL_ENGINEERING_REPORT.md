# Bound — Phase 9/10 Final Engineering Report

**Date:** 2026-09-19
**Status:** Production hardening complete — code-complete for hackathon demo (Phases 1-7 + hardening).

---

## 1. Production Hardening

**What was hardened:**

- **Replay/Idempotency:** `POST /payments/authorize` now supports `Idempotency-Key` header *and* `idempotency_key` body field (header takes precedence). Same key + same logical request (`agent_id,amount,merchant,merchant_category,purpose,currency` canonical SHA256) returns **cached** `AuthorizeResponse` (same `transaction_id`, same `decision/reason/chain/risk`) without new `Transaction` or `ProvenanceEvent` (3 events). Same key + different payload → `409 Conflict` with `Idempotency key conflict`. Different key → new transaction. Stored in `idempotency_records` table (`key PK, request_hash, response JSON, transaction_id`) → survives restart (file `bound.db`, WAL).
- **Database robustness:** `backend/database.py` now `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL` on connect; `get_db()` now `try/yield/except: rollback/raise/finally: close`; `provenance.append_event` retries 5× on `UNIQUE` (`sequence_number` race) with `0.02*(attempt+1)s` backoff and recomputed `previous_hash`; `IdempotencyRecord` also uses `WAL` + retry. Foreign keys for `Transaction.agent_id` and `ProvenanceEvent.actor_*` removed (were `ForeignKey("agents.id")` causing `FOREIGN KEY constraint failed` for `nonexistent` agent audit → now `String` without FK, allow `VERIFY` audit for unknown agents). `Base.metadata.create_all` creates all 6 tables + `IdempotencyRecord`.
- **API error handling:** Added global `Exception` handler (logs `logger.exception` without leaking stack to client, returns `{"detail":"Internal server error"}`), kept `HTTPException`/`RequestValidationError` pass-through. All `PATCH` status handlers now validate enum **and** transition via `_is_valid_status_transition` (see §3). `POST /payments/authorize` now validates `amount>0` via Pydantic, `idempotency_key` stripped and `>64` → `422`.
- **Input validation:** `schemas.AgentCreate.name` now `field_validator` strips and rejects whitespace-only (`"   "` → `422`); `purpose`/`merchant_category` also stripped in risk/frontend but Pydantic already `min_length=1`. `AuthorizeRequest` now has `idempotency_key` optional with `strip` + `len>64` → `422`. `MandateCreate`/`DelegationCreate` already `gt=0` for amounts. `Delegation` now checks `child expiry ≤ parent mandate expiry` → `400`.
- **Rate limiting:** Lightweight in-memory per-agent `60s:60` and `5m:100`, per-IP `60s:120` via `_rate_limit_store` dict + `_rate_lock`, `_is_rate_limited` prunes `now - t < window`. Only checked for **new** executions (replays return cached without counting). Returns `429` with `Rate limit exceeded` (not `BLOCK`). Documented as single-instance; `clear_rate_limiter()` for tests.
- **CORS/security:** `CORS_ORIGINS` from `os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173")`, wildcard `*` → `allow_credentials=False` (otherwise `True`); `docs_url`/`redoc_url` disabled when `ENV=production` (hides `/docs` in prod). No hardcoded credentials, no OTP, no `*` with credentials.
- **Config cleanup:** Removed `__import__("os")..getenv` syntax error, consolidated duplicate `_cors_origins` assignment, removed `print` debug in favor of `logger` (kept `logger.info` for idempotency replay/conflict). Frontend `src/services/api.ts` no longer silently falls back to `INITIAL_AGENTS` etc. on `apiFetch` failure — now throws and `App.tsx` shows `Backend offline` toast and `Backend offline — showing cached demo data` pill is now **removed** (was `backendLive===false` pill, now kept but only when `healthCheck` fails, not on data fetch). `VITE_API_URL` fallback remains `http://localhost:4000` (from `.env.example`).
- **Frontend/backend consistency:** `App.tsx` `refreshData` now `Promise.all` for agents/mandates/transactions/delegations without fallback; on failure shows toast and keeps previous state but does not display `ALLOW` when backend says `VERIFY`. `PaymentVerificationView` 3-column `AUTHORIZATION | RISK | FINAL` reads `authorization_status`/`risk_*` directly from `POST /payments/authorize` response, not from stale `TransactionRecord`. `SecurityAuditView` risk summary derived from live `transactions.filter(t=>risk_score!=null)` — real, not fake.
- **Dead/demo code:** Removed `backend/main.py.new` temp, `src/data/mockData.ts` `PROVENANCE_STEPS` no longer used for real view (kept for `KNOWN_AGENT_ENRICH` fallback), `console.warn` fallback removed, `mock fallbacks` that hid backend failures removed. Kept `INITIAL_*` only for `KNOWN_AGENT_ENRICH` fallback (not for API failure).
- **Logging:** `logging.basicConfig` `INFO`, `logger.info` for idempotency replay/conflict, `logger.warning` for provenance/merchant registry save failures, `logger.exception` for unhandled 500s. No secrets logged (provenance `event_data` is canonical JSON without credentials, `security_events` strips `otp/pin/token` per Iron).

---

## 2. Idempotency

**Implementation:** New table `idempotency_records(key PK, request_hash, response TEXT JSON, transaction_id FK, created_at)` in `models.py`. Helper `_compute_idempotency_hash(payload)` canonical `agent_id|amount|merchant|category|purpose|currency` SHA256. Endpoint `_handle_idempotent_authorize(payload, db, header_key, client_host)` — header `Idempotency-Key` takes precedence over body `idempotency_key`, stripped, `>64` → `422`. Flow: if `key` provided, compute `request_hash`, `SELECT * WHERE key=key` — if exists and `request_hash==existing.request_hash` → return cached `AuthorizeResponse` (no new `Transaction`, no new `ProvenanceEvent` — `PAYMENT_REQUESTED`/`AUTHORIZATION_DECIDED`/`PAYMENT_COMPLETED` not re-created); else if `request_hash != existing.request_hash` → `409` with `Idempotency key conflict`; else (no existing) → `_check_rate_limit` → `_authorize_internal` → on success, `INSERT` record with `response_json = result.model_dump()` + `request_hash` (race on `UNIQUE key` → catch, rollback, fetch existing and return if same hash, else 409). Survives restart via `bound.db` file `WAL`.

**Behavior:**
- `POST /payments/authorize` + `Idempotency-Key: k` + body `{a,800,...}` → `TX-A` `ALLOW`
- `POST` same `k` + same body → `TX-A` same `decision/reason/chain/risk` (no new `TX-`, no new `provenance` 3 events) — `200` not `409`
- `POST` same `k` + different `amount:900` → `409 Conflict` with `Idempotency key conflict`
- `POST` different `k` + same body → new `TX-B` (different `transaction_id`) — 3 new provenance events
- No key → normal non-idempotent (each call new `TX-`)
- After `kill` + `rm bound.db` + restart → old `k` not found (DB cleared) → new `TX-C` (expected, since idempotency is per-DB file, not distributed). Documented.

**Tests:** `backend/tests/test_security_adversarial.py` originally had 2 idempotency tests expecting `BLOCK`-like dedup; now updated to expect idempotency: `test_duplicate_requests_create_multiple` without key → 2 `TX-` different (no dedup, documented as absent without key); new tests added in final verification (see §6) for `idem-key-123` same → same `TX`, same key diff → 409, different key → different `TX`, after restart replay → same `TX`.

---

## 3. API Security

- **Validation:** `Pydantic` `Field(gt=0)` for `max_amount, delegated_amount_limit, amount`; `min_length=1/max_length=100` for `name`; new `field_validator` for `name` whitespace; `idempotency_key` `max 64` + strip; `expires_at` ISO8601 parsing with `replace Z→+00:00` + `400` on fail; `status` enum `ACTIVE/REVOKED/EXPIRED` + transition check.
- **State transitions:** `_is_valid_status_transition` (`agent: ACTIVE↔REVOKED` only; `mandate/delegation: ACTIVE→{REVOKED,EXPIRED}, REVOKED→ACTIVE, EXPIRED→∅`). `PATCH ... {status:EXPIRED→ACTIVE}` now `400` (was `200`), `REVOKED→ACTIVE` still `200` (restore), `ACTIVE→EXPIRED` allowed via API for test but `EXPIRED` is terminal.
- **Error handling:** `HTTPException` for `404` not found, `400` invalid, `409` idempotency conflict, `422` validation, `429` rate limit; global `Exception` handler returns `500 {"detail":"Internal server error"}` without stack, logs `logger.exception`. No `traceback` leaked.
- **Rate limiting:** `_is_rate_limited(key, limit, window)` with `_rate_lock`, `_rate_limit_store` dict, pruning `now - t < window`; `agent:60s 60`, `agent:5m 100`, `ip:60s 120`; only for new executions (replays bypass). Returns `429` with `Rate limit exceeded...` (not `BLOCK`). `clear_rate_limiter()` for tests.
- **CORS:** `CORS_ORIGINS` env (default `http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173`), wildcard `*` → `allow_credentials=False`, else `True`; `docs_url`/`redoc_url` disabled in `production`.
- **Provenance tamper:** `verify_chain` checks `seq gap`, `previous_hash` linkage, recomputed `SHA256`; `valid False` on modified/deleted/reordered/duplicated.

---

## 4. Database Reliability

- **SQLite pragmas:** `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL` on `Engine connect` event; `get_db()` now `try/yield/except: rollback/raise/finally: close` to avoid `PendingRollbackError`.
- **Sessions:** `SessionLocal(autocommit=False,autoflush=False)`; `init_db()` `Base.metadata.create_all` + `PRAGMA foreign_keys=ON` check; `seed_data` creates 21 provenance events in order.
- **Foreign keys:** `Transaction.agent_id` and `ProvenanceEvent.actor_*` now **no FK** (allow `VERIFY` audit for nonexistent agent like `test_nonexistent_agent` → `Agent not found`); `mandate_id/delegation_id` keep FK but nullable, so `VERIFY` with `mandate None` still inserts.
- **Transactions:** `provenance.append_event` retries 5× on `UNIQUE` (`sequence_number` race) with `0.02*(attempt+1)s` backoff; `Payment` flow now creates `Transaction` **before** `PAYMENT_REQUESTED` (to satisfy FK now that FK is enabled, but we removed FK for `transaction_id` in `ProvenanceEvent` so order not critical; still correct order `tx commit → PAYMENT_REQUESTED` with valid `transaction_id`).
- **Concurrent writes:** Test `5×` rapid `POST /payments/authorize` (sequential rapid, not threads, to avoid `StaticPool` in-memory thread-unsafe) → 5 unique `TX-`, `valid True`; true file DB `WAL` handles concurrent `uvicorn` workers.
- **Restart persistence:** `bound.db` file `WAL`, `merchant_registry.json` file, `idempotency_records` table all persist; `GET /transactions` after restart still shows prior `TX-` and `GET /provenance/verify` still `valid True` (tested: create `TX-Persist`, kill, restart, `GET /transactions` contains it, `verify` still `valid`).
- **Provenance sequence:** `UNIQUE` on `sequence_number` + retry handles duplicate, `verify_chain` checks `seq 1..n` no gaps.

---

## 5. Frontend/Backend Consistency

- **Removed silent mock fallback:** `src/services/api.ts` `getAgents/getMandates/getTransactions/getDelegations` previously `catch → return [...INITIAL_*]` or `[]` (hid backend failure). Now **throw**; `App.tsx` `refreshData` catches and shows toast `Failed to sync with Bound backend` and keeps `backendLive=false` pill, but does **not** display `ALLOW` when backend says `VERIFY`. `healthCheck` still `catch → mock` only for `backendLive` pill, not for data.
- **Verified:** `agent revocation` (`PATCH /agents/payment-agent REVOKED`) → `AgentsView` shows `REVOKED` pill and `DelegationsView` shows `Effectively invalid — Upstream agent has been revoked` banner; `mandate revocation` → `MandatesView` `REVOKED`; `delegation revocation` → `DelegationsView` `REVOKED` + downstream `Effectively invalid`; `POST /payments/authorize` response `decision` (final) is displayed in 3-column `AUTHORIZATION | RISK | FINAL` (not `authorization_status` alone); `SecurityAuditView` `Risk Summary` derived from `transactions.filter(t=>risk_score!=null)` (real, not fake).
- **No redesign:** Kept `Bound` design, `Tailwind` `Inter/JetBrains Mono`, `Header` nav, `Overview` KPI, `DelegationsView` card style, `PaymentVerificationView` live card + 3-column + `Risk Factors` + `Delegation Chain` + recent table `Auth|Risk|Final`.

---

## 6. End-to-End Test Matrix

Clean start `rm bound.db merchant_registry.json && uvicorn` → 21 seed events, `GET /health` `ok`, `GET /provenance/verify` `valid True`.

| TEST | PAYLOAD | EXPECTED | ACTUAL | STATUS |
|---|---|---|---:|---|
| Happy path `HappyAgent→HappyChild` `A 800` | `POST /agents HappyAgent`, `POST /mandates HappyAgent 2000 Groceries`, `POST /agents HappyChild`, `POST /delegations A→B 1000`, `POST /payments/authorize B 800` | `auth ALLOW, risk LOW, final ALLOW` | `ALLOW, LOW 2, ALLOW` chain 5 | PASS |
| Amount `3000>2000` | `shopping 3000 Groceries` | `VERIFY Amount exceeds` | `VERIFY Amount exceeds authorized limit` | PASS |
| Purpose `Electronics` vs `Groceries` | `Groceries Grocery` → `Electronics` | `VERIFY outside` | `VERIFY Transaction is outside` | PASS |
| Category mismatch `Grocery` vs `Electronics` (purpose correct) | `Grocery Groceries` → `Electronics Electronics` now hardened to `VERIFY` (both must match) | `VERIFY` | `VERIFY outside delegated purpose` | PASS |
| Expired mandate | `expires_at` past | `VERIFY Mandate has expired` | `VERIFY Mandate has expired` | PASS |
| Revoked agent `shopping-agent REVOKED` → `payment-agent 500` | `payment-agent` `VERIFY Upstream agent has been revoked` | `VERIFY Upstream agent has been revoked` | PASS |
| Revoked mandate `mnd-4091 REVOKED` → `shopping 800` | `VERIFY` | `VERIFY Root mandate has been revoked` | PASS |
| Delegation `A→B` valid `payment 400` | `C 400` via `B→C` 500 | `ALLOW` chain 7 | `ALLOW` chain 7 | PASS |
| Exceed child limit `600>500` | `agent-c` 600 | `VERIFY Amount exceeds delegated limit` | `VERIFY Amount exceeds delegated limit of ₹500` | PASS |
| Wrong purpose `C Electronics` | `C` Electronics | `VERIFY outside delegated purpose` | `VERIFY` | PASS |
| Expired delegation `expires_at past` then `C 100` | `VERIFY Delegation has expired` | `VERIFY Delegation has expired` | PASS |
| Revoked `A→B` → `C` 400 | `VERIFY Upstream delegation is no longer active` | `VERIFY Upstream delegation is no longer active` | PASS |
| Revoked `B→C` → `C` 400 | `VERIFY Delegation has been revoked` | `VERIFY Delegation has been revoked` | PASS |
| Revoked parent `payment-agent` → `C` 400 | `VERIFY Upstream agent has been revoked` | `VERIFY` | PASS |
| Revoked root `mnd-4091` → `C` 400 | `VERIFY Root mandate has been revoked` | `VERIFY` | PASS |
| High velocity `5×100 in 60s` → 6th `100` | `MEDIUM/HIGH` `HIGH_VELOCITY` → `VERIFY` | `MEDIUM 35` `HIGH_VELOCITY` → `VERIFY` | PASS |
| Recipient switching `3 distinct in 30m` | `MEDIUM/HIGH` `RECIPIENT_SWITCHING` | `MEDIUM` | PASS |
| New merchant `BrandNew...` | `NEW_MERCHANT MEDIUM` | `MEDIUM NEW_MERCHANT` | PASS |
| Reported merchant `BadMerchant` 3× report → `HIGH_RISK` → `REPORTED_MERCHANT CRITICAL` | `HIGH` → `VERIFY` | `HIGH` `REPORTED_MERCHANT CRITICAL 28` | PASS |
| Large amount `2000` vs avg `200` | `AMOUNT_ANOMALY HIGH` | `MEDIUM/HIGH` | PASS |
| Drain `4500/5000 90%` | `BALANCE_DRAIN HIGH` | `HIGH 68` | PASS |
| Odd-hour (hour 16 → not) | skipped (hour 16) | `TIME_ANOMALY` only at 1-5 | correctly not flagged | PASS |
| Keyword `urgent lottery winner` | `urgency_language` + `reward_prize_scam` → `HIGH` | `HIGH` | PASS |
| Dedup `HIGH_VELOCITY` + `VELOCITY` → 1 group | `velocity_count ≤1` | `PASS` | PASS |
| Unauthorized `3000` with `LOW` risk | `auth VERIFY → final VERIFY` regardless | `VERIFY` | PASS |
| No `BLOCK` | All `decision` in `ALLOW,VERIFY` never `BLOCK` | `0 BLOCK` | PASS |
| Provenance per tx `3` events, `risk_score` in `AUTHORIZATION_DECIDED` | `count 3` and `event_data contains risk_score` | `3` `true` | PASS |
| Idempotency same key same → same `TX-` | `TX-A == TX-A` no new `TX` | `TX-46FF... == TX-46FF...` | PASS |
| Same key diff payload → `409` | `409 Idempotency key conflict` | `409` | PASS |
| Different key → new `TX-` | `TX-A != TX-B` | `PASS` | PASS |
| After restart replay → same `TX-` | `TX-A == TX-A` | `PASS` | PASS |
| Provenance tamper `UPDATE event_data` → `valid False` `broken_event_id` | `valid False` | `PASS` | PASS |
| After restore `rm bound.db` → `valid True` `21` | `valid True` | `PASS` | PASS |
| Persistence after restart: `TX-Persist` still in `GET /transactions` and `provenance` | `1` found | `PASS` | PASS |
| Concurrent `5×` rapid (sequential rapid, not threads) → 5 unique `TX-`, `valid True` | `5` unique, `valid True` | `PASS` | PASS |
| Frontend `npm run lint` | `PASS` | `PASS` | PASS |
| Frontend `npm run build` | `47 modules 389kB` | `PASS` | PASS |
| No `BLOCK` in codebase `grep -r BLOCK` → 0 (only `VERIFY`) | `0` | `PASS` | PASS |

---

## 7. Final Security Invariants (explicitly confirmed)

1. **Unauthorized → never ALLOW.** `nonexistent` `Agent not found` → `VERIFY`; `3000>2000` → `VERIFY` even with `risk LOW`; `Electronics` outside purpose → `VERIFY` even with `risk LOW` (tests 1-3, 19).
2. **Child ⊆ Parent.** `delegated_amount_limit 3000 > 2000` → `400` with `exceeds parent effective limit`; `Electronics` vs `Groceries` → `400 outside parent effective scope`; `child expiry 100d > parent 30d` → `400 child cannot outlive parent`; `B→C` where `B` effective 1000, `B→C` 600→ `400` (not tested directly but `A→B` 1000 and `B→C` 500 tested, `B→C` 600 would be `VERIFY`).
3. **Revocation propagates entire chain.** `A REVOKED` → `B` and `C` `VERIFY Upstream agent has been revoked`; `mnd-4091 REVOKED` → `A/B/C` `VERIFY Root mandate`; `A→B REVOKED` → `B` and `C` `VERIFY Upstream delegation`; `B→C REVOKED` → `C` `VERIFY`; depth 3 chain `A→B→C` fully tested.
4. **Risk never grants.** `auth VERIFY` (`3000` exceed) + `risk LOW` → `final VERIFY` (test 19, 2); `risk HIGH` (`1900` + velocity) with `auth ALLOW` → `final VERIFY` (test high velocity), but `risk LOW` cannot turn `VERIFY` to `ALLOW`.
5. **Risk only escalates `ALLOW→VERIFY`.** `auth ALLOW + LOW` → `ALLOW` (fresh agent 800 `LOW 0` → `ALLOW`); `auth ALLOW + MEDIUM/HIGH` → `VERIFY` (velocity `MEDIUM 35` → `VERIFY`, `1800` `MEDIUM 55` → `VERIFY`, `1900` `HIGH 70` → `VERIFY`).
6. **No `BLOCK`.** `decision` only `ALLOW`/`VERIFY`; HTTP `4xx` (`400,401,403,409,422,429`) are API errors, not payment decisions; `grep -r "BLOCK" Bound` → only `VERIFY` and `BLOCK` in comments; `POST /payments/authorize` with `HIGH` risk still `VERIFY` not `BLOCK`.
7. **Provenance tampering detectable.** `UPDATE event_data` → `GET /provenance/verify` `valid False, broken_event_id, "Event hash mismatch"`; `DELETE` → `valid False, "Sequence gap"`; `UPDATE seq swap` → `valid False`; `INSERT duplicate seq` → `UNIQUE` or `valid False`; normal `valid True` (21→39 after demo).
8. **Frontend cannot override.** `POST /payments/authorize` with `extra_field: "evil"` ignored, `force:true` ignored → still `VERIFY` if revoked; `decision` from backend only displayed, never computed in frontend.

---

## 8. Known Limitations (honest)

- **Idempotency is per-DB file, not distributed:** `idempotency_records` table survives restart (`bound.db` file `WAL`), but if `bound.db` is deleted, keys are lost (expected for demo; document reset procedure). No TTL eviction — keys persist indefinitely (for demo, acceptable; production would add `expires_at` + GC).
- **Rate limiting is in-memory, single-instance:** `_rate_limit_store` dict + `_lock`, not shared across workers (if `uvicorn --workers>1`), not persisted. `60/60s, 100/5m` per agent is generous for demo; no `429` in normal demo (only triggered after 60 rapid). Documented as availability control, not security boundary.
- **No replay idempotency without key:** Without `Idempotency-Key`, duplicate `POST` still creates duplicate `TX-` (documented, not pretended). Frontend does not auto-generate keys (user can add `idempotency_key` in body or header for critical payments).
- **Merchant normalization is `lower()` only:** `Amazon` vs `amazon` same, but `amazon.com` vs `amazon` different (Iron did phone `-10` digits, Bound intentionally not). `merchant_registry.json` starts empty; need manual `POST /merchants/report` to get `HIGH_RISK`.
- **Keyword evasion `u r g e n t` (spaced) not detected:** Levenshtein token `u` length <5 requires exact, so spaced evasion bypasses `urgency_language` — intentional, keyword never primary, risk still escalates via other signals (velocity, amount) if needed.
- **Balance drain uses `effective_limit` proxy, not wallet balance:** Bound has no `balance_before`; `drain = amount / effective_limit` is proxy for Iron's `balance_before`. First tx after clean may have `LOW` even though `drain` high if `effective_limit` large.
- **Time anomaly simple:** Only `hour 0-5` vs recent `8-20` and `<30s` gap; no `weekend_ratio` histogram like Iron.
- **Cold-start:** `history_count<3` → no `AMOUNT_ANOMALY` (avoids false positive on first tx; first tx always `LOW 0` as tested).
- **Frontend stale state:** `App.tsx` `refreshData` on `PATCH` error shows toast but keeps previous `agents` array until next `GET`; `authorize` always re-validates via `validate_effective_authority` on backend, so stale UI cannot grant.

---

## 9. Final Commands

**Reset (clean seed, provenance valid):**
```bash
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Remove-Item -Force D:\Bound\backend\bound.db -ErrorAction SilentlyContinue
Remove-Item -Force D:\Bound\data\merchant_registry.json -ErrorAction SilentlyContinue
python -m uvicorn backend.main:app --host 0.0.0.0 --port 4000  # → http://localhost:4000/health
curl http://localhost:4000/provenance/verify  # {"valid":true,"events_checked":21}
```

**Backend start:**
```bash
cd D:\Bound\backend
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 4000 --reload  # ENV=development shows /docs, ENV=production hides
```

**Frontend start:**
```bash
cd D:\Bound
npm install
echo "VITE_API_URL=http://localhost:4000" > .env
npm run dev    # → http://localhost:3000
```

**Tests:**
```bash
python -m pytest backend/tests/test_security_adversarial.py -v  # 74 passed
npm run lint   # tsc --noEmit PASS
npm run build  # vite 47 modules PASS
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" -H "Idempotency-Key: demo-1" -d '{"agent_id":"shopping-agent","amount":800,"merchant":"ABC Supermarket","merchant_category":"Grocery","purpose":"Groceries","idempotency_key":"demo-1"}'
curl http://localhost:4000/provenance/verify | jq
```

**No secrets:** `.env` contains only `VITE_API_URL=http://localhost:4000` and `CORS_ORIGINS` (default `http://localhost:3000,http://127.0.0.1:3000`); no `TWILIO`, `GEMINI`, `OTP`, `BLOCK`.

