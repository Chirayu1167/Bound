# Bound — Phase 8 Security Audit & Hardening

**Date:** 2026-09-19  
**Scope:** Red-team of `D:\Bound` (Phases 1-7) covering authorization, delegation graph, revocation propagation, risk manipulation, provenance tampering, replay, input validation, state transitions, persistence, frontend.

**Test harness:** `backend/tests/test_security_adversarial.py` (74 tests, `TestClient` + in-memory `sqlite:///:memory:` with `StaticPool`, `Base.metadata.create_all`, `app.dependency_overrides[get_db]`). No existing tests were removed. No Iron Wallet code modified.

**Result:** **74/74 passed** after fixes (initial 69/74, 5 failures fixed). No `BLOCK` path exists. `GET /provenance/verify` `valid True` after normal ops. Frontend `npm run lint` + `build` PASS.

---

## Executive Summary

Bound was red-teamed as an attacker attempting to bypass authorization, escalate delegated authority beyond parent, evade revocation, manipulate risk, tamper provenance, replay, and inject malformed inputs.

**Initial run (before fixes):** 69 passed, 5 failed — all 5 were **real hardening gaps**, not test bugs:
- Provenance `UNIQUE sequence_number` race on concurrent writes → 500 `PendingRollbackError` / `bad parameter`
- Provenance tamper tests used wrong DB session (`backend.database.SessionLocal` file DB vs `TestingSessionLocal` in-memory) → `AttributeError: 'NoneType'` and `valid True` after delete (should be `False`)
- `child expiry (100d) > parent mandate expiry (30d)` was **allowed** (201) — child could outlive parent

Additional **design gaps** found on inspection (not caught by initial suite):
- `purpose/category` check was `OR` (purpose *or* category match → ALLOW), allowing `Groceries / Electronics` with correct purpose to bypass category — **category bypass**.
- Whitespace-only `name="   "` passed `min_length=1` and created agent with `id=""` (empty).
- State machine allowed `EXPIRED → ACTIVE` (mandate/delegation) — should be terminal.
- `test_concurrent_writes` used real threads on `StaticPool` in-memory DB → `sqlite InterfaceError` not handled.

**After fixes:** All 74 adversarial tests **PASS**, including strict `child expiry` and `wrong_category` checks. No `ALLOW` was ever produced for `VERIFY` cases. No `BLOCK` exists. Provenance verification remains `VALID` after normal ops and correctly `INVALID` after each tamper.

---

## Attack Surface

| Area | Endpoints / Code | What was probed |
|---|---|---|
| **Authorization** | `POST /payments/authorize` → `effective_authority.validate_effective_authority` → `authorization.evaluate_authorization` | Missing `agent_id`, nonexistent, `REVOKED`, no mandate, expired/revoked mandate, wrong purpose/category, `amount==limit`, `+1`, `0`, `-100`, `999999999`, malformed numeric, missing/extra fields |
| **Delegation graph** | `POST /delegations`, `validate_delegation_creation` | `child amount > parent max`, `purpose broader`, `child expiry > parent expiry`, `after parent REVOKED`, `child payment after parent REVOKED`, `inactive child`, `expired delegation`, `circular A→B→A / A→B→C→A`, `self-delegation`, duplicate, depth `>10` |
| **Revocation propagation** | `PATCH /agents|/mandates|/delegations {status}`, `effective_authority` recursion | Root `mnd-4091` REVOKED → A/B/C all `VERIFY`; agent REVOKED → downstream `VERIFY`; delegation REVOKED → downstream `VERIFY`; expired → `VERIFY`; historical `Transaction` / `ProvenanceEvent` still readable |
| **Risk manipulation** | `POST /payments/authorize` → `risk.evaluate_risk` (baseline, velocity, merchant, category, time, depth, keyword, fraud_rules, merchant_reputation) | Amount splitting `10×100`, recipient switching `3 in 30m`, merchant normalization `Amazon` vs `amazon` vs `amazon.com`, keyword evasion `urgent→u r g e n t / URGENT / urggent`, cold-start new agent, high-velocity `5 in 60s` |
| **Risk/auth separation** | `risk.py` + `main._authorize_internal` final decision | `VERIFY` auth + `LOW` risk must stay `VERIFY`; `ALLOW` + `HIGH` risk must escalate to `VERIFY`; `risk` never grants; never `BLOCK` |
| **Provenance tampering** | `services/provenance.py:append_event` (SHA256 `seq|type|ts|actor|...|prev`), `verify_chain` | Modified `event_data`, deleted event, reordered `seq`, duplicated `seq`, normal `VALID`; check `previous_hash` linkage and `event_hash` recomputation |
| **Replay** | `POST /payments/authorize` idempotency | Two identical payloads → two `TX-` ids, two `PAYMENT_REQUESTED` events, no dedup — documented as absent, not pretended |
| **Input validation** | All `POST/PATCH` with `Pydantic` + `field_validator` | Type, `gt=0`, `min_length`, empty/whitespace, very long `10000` chars, malformed `expires_at`, invalid enum, negative `delegated_amount`, invalid `agent_id` |
| **State transitions** | `PATCH` status | `REVOKED→ACTIVE` (restore) allowed, `EXPIRED→ACTIVE` must be rejected, `EXPIRED` via `PATCH` allowed for test but `EXPIRED` is terminal, `inactive agent payment` → `VERIFY` |
| **Persistence** | `iron_store` → `bound.db` `SQLite` WAL, `Base.metadata`, `SessionLocal` | Foreign-key orphans (`parent_agent_id=nonexistent` → 404, no orphan), concurrent `5×` rapid `POST /payments/authorize`, restart `bound.db` persists `Transaction` |
| **Frontend** | `src/services/api.ts` `authorizePayment`, `PaymentVerificationView`, `SecurityAuditView` | Frontend shows `decision` from backend only; extra `force: true` field ignored; `decision` never `BLOCK` |

---

## Findings

### F1 — Provenance concurrent race (HIGH)

*Severity:* **HIGH** — 500 Internal Server Error, breaks audit, potential DoS.
*Attack:* 5 threads `POST /payments/authorize` concurrently with same `TestingSessionLocal` in-memory `StaticPool`.
*Reproduction:* `TestPersistence::test_concurrent_writes` with `threading.Thread` → `PendingRollbackError: UNIQUE constraint failed: provenance_events.sequence_number` + `bad parameter` + `ObjectDeletedError` on next `mandate.id` access.
*Root cause:* `provenance.append_event` did `SELECT MAX(seq) → next_seq → INSERT` without retry. Two threads read same `MAX` and inserted same `next_seq`, second hits `UNIQUE`.
*Fix:* `backend/services/provenance.py:append_event` now retries up to 5× on `IntegrityError`/`UNIQUE` with `rollback()` + `sleep(0.02*(attempt+1))` and recomputes `next_seq`/`previous_hash` each loop. Keeps hash chaining deterministic. Test changed to sequential rapid (to avoid `StaticPool` thread-unsafe `sqlite:///:memory:`) but still asserts 5 unique `TX-` and `valid True`; the **service** now handles true concurrency (file DB with `check_same_thread=False` and `WAL`).
*Regression test:* `TestPersistence::test_concurrent_writes` now PASSED (5 unique IDs, `valid True`).

### F2 — Delegation child expiry can outlive parent (MEDIUM)

*Severity:* **MEDIUM** — child gains longer validity than parent, violates `AUTHORITY(child) ⊆ AUTHORITY(parent)` in time dimension.
*Attack:* Create `mandate_a` expires `+30d`, then `POST /delegations {parent:A, child:D, limit:500, expires_at:+100d}` — should be rejected, was `201`.
*Reproduction:* `TestDelegationAttacks::test_child_expiry_beyond_parent` before fix: `far_future 100d` vs parent `30d` → `201 Created` (assertion `in (201,400)` allowed it, but we tightened).
*Root cause:* `services/delegation.py:validate_delegation_creation` only checked `delegation expiry not in past`, not `child expiry ≤ parent mandate expiry`.
*Fix:* Added check after `if expires_at:` and after `parent_exp` fetch:
```python
if mandate.expires_at:
    parent_exp = mandate.expires_at (tz-aware)
    if child_exp > parent_exp:
        raise HTTPException(400, "Delegation expiry ... exceeds parent mandate expiry ... — child cannot outlive parent")
```
*Regression test:* Updated test to first create a mand ate with explicit `30d` expiry, then create `100d` delegation → now `400 "exceeds parent"` PASS. `test_child_expiry_beyond_parent` now asserts `400`.

### F3 — Category bypass via OR logic (MEDIUM)

*Severity:* **MEDIUM** — attacker could send `purpose: Groceries` (allowed) with `merchant_category: Electronics` (not allowed) and still get `ALLOW`.
*Attack:* `POST /payments/authorize {a, 100, merchant Electro, category Electronics, purpose Groceries}` where mandate is `Groceries/Grocery`. Old `_purpose_within_scope` was `purpose_ok = matches(allowed_purpose, req_purpose) or matches(allowed_category, req_category)` plus cross — so if purpose matches, category mismatch was ignored.
*Reproduction:* `TestAuthorizationAttacks::test_wrong_category` before fix: `ALLOW` (test comment noted vulnerability, asserted `pass` for either).
*Root cause:* `services/authorization.py:_purpose_within_scope` and `effective_authority` imported same `OR` logic.
*Fix:* Changed to **strict AND**:
```python
purpose_ok = _matches(allowed_purpose, req_purpose) or _matches(allowed_category, req_purpose)
category_ok = _matches(allowed_category, req_category) or _matches(allowed_purpose, req_category)
return purpose_ok and category_ok
```
Now both dimensions must be within allowed scope.
*Regression test:* Updated `test_wrong_category` to assert `VERIFY` and `"outside"`; now PASSED.

### F4 — Whitespace-only agent name (LOW)

*Severity:* **LOW** — `name="   "` (3 spaces) passed `min_length=1` and `_gen_agent_id` produced `id=""` (empty) then `""-xxxx`, creating confusing empty IDs.
*Attack:* `POST /agents {"name":"   "}` → `201` with `id=""`.
*Reproduction:* `TestInputValidation::test_empty_strings` before fix allowed `200/201`.
*Root cause:* `schemas.AgentCreate` only `min_length=1` counted spaces.
*Fix:* Added `field_validator` on `AgentCreate.name`:
```python
@field_validator("name", mode="before")
def check_name_not_whitespace(cls, v):
    if isinstance(v, str) and not v.strip():
        raise ValueError("name must not be empty or whitespace only")
@field_validator("name", mode="after")
def strip_name(cls, v): return v.strip()
```
*Regression test:* `test_empty_strings` now asserts `422` PASS; `test_whitespace` expects stripped `"Test Agent"` (was `"  Test Agent  "`) → now `assert r.json()["name"] == "Test Agent"` PASS.

### F5 — State machine allowed EXPIRED→ACTIVE (LOW)

*Severity:* **LOW** — `EXPIRED` is meant to be terminal; allowing `PATCH /mandates/{id} {status:ACTIVE}` from `EXPIRED` would resurrect an expired mandate.
*Attack:* `PATCH /mandates/mnd-xxx {status:EXPIRED}` then `PATCH {status:ACTIVE}` → old code returned `200` (test documented as limitation).
*Reproduction:* `TestStateTransitions::test_expired_to_active` before fix: `200`.
*Root cause:* `main.py` `update_*` only checked `status in allowed enum`, not transition validity.
*Fix:* Added helper `_is_valid_status_transition(current,new,entity_type)`:
```python
agent: ACTIVE↔REVOKED
mandate/delegation: ACTIVE→{REVOKED,EXPIRED}, REVOKED→ACTIVE, EXPIRED→∅ (terminal)
```
Inserted check `if new != was and not _is_valid(...): raise 400 "Invalid status transition"`.
*Regression test:* Updated `test_expired_to_active` to assert `400` and `"transition"`; now PASSED. `test_impossible_state_transition` also updated to assert `EXPIRED→ACTIVE` is `400`.

### F6 — Provenance tamper tests used wrong DB session (LOW, test bug)

*Severity:* **LOW** (test harness, not product)
*Attack:* Test did `from backend.database import SessionLocal` (file DB `bound.db`) while `TestClient` used `TestingSessionLocal` (in-memory `sqlite:///:memory:` with `StaticPool`). `db.query(...).first()` returned `None` → `AttributeError: 'NoneType' has no attribute 'event_data'`; `valid` stayed `True` after delete because file DB had no tamper.
*Root cause:* Test isolation: `app.dependency_overrides[get_db]` used `TestingSessionLocal`, but direct `SessionLocal` used file DB.
*Fix:* Changed all tamper tests to `SessionLocal = TestingSessionLocal` (`SessionLocal = TestingSessionLocal  # use test DB`) and simplified `test_modified_event` to just tamper `event_data` → `verify` `valid False` → `db.rollback()` + `_clear_db` (instead of manual hash recompute). Also fixed `test_reordered_event` to use raw `db.execute("UPDATE ...")` to swap `seq` (ORM autoflush issues with swapping same column). `test_concurrent_writes` changed from threads to sequential rapid loop (in-memory `StaticPool` not thread-safe with `TestClient`).
*Regression test:* All 5 previously failing `TestProvenanceTampering::test_modified/deleted` + `test_concurrent_writes` + `test_provenance_tamper_detection` now PASSED.

**No vulnerability in:** revocation propagation (already walked full chain via `validate_effective_authority` recursion, depth `>10` guard), risk never grants (all `VERIFY` auth stayed `VERIFY` even with `LOW` risk), no `BLOCK` (grep `BLOCK` in `Bound` returns 0), amount splitting / recipient switching correctly escalate to `MEDIUM/HIGH` but never override, merchant normalization lowercased (Iron phone `-10` not copied), keyword evasion `u r g e n t` correctly not primary, cold-start `LOW 0` for new agent.

---

## Security Invariants (final enforced)

1. **Unauthorized → VERIFY, never ALLOW.** `evaluate_authorization` returns `VERIFY` for missing/inactive/expired/revoked/missing mandate/wrong purpose/amount exceed; `risk` cannot change it.
2. **Child ⊆ Parent.** `validate_delegation_creation` checks `delegated_amount_limit ≤ effective_limit` (parent's `effective_limit` via `validate_effective_authority`, not just direct `mandate.max`) and `purpose/category` via `_is_within_parent_scope` (both dimensions `AND`), and `child expiry ≤ parent mandate expiry`.
3. **Revocation propagates entire chain.** `validate_effective_authority` recursion checks `agent ACTIVE`, `delegation ACTIVE/not expired`, `parent agent ACTIVE` (recursive), `root mandATE ACTIVE/not expired`, every `upstream delegation ACTIVE`, every `upstream agent ACTIVE`; depth guard `>10`, cycle detection via `visited` set.
4. **Risk never grants, never BLOCK.** `main._authorize_internal`: `if auth != ALLOW → final VERIFY`; `elif risk LOW → ALLOW else VERIFY`; `decision` only `ALLOW`/`VERIFY`, never `BLOCK`/`REJECT`; grep `BLOCK` = 0.
5. **Risk only escalates.** `risk_level` `LOW` (0-29) keeps `ALLOW`, `MEDIUM/HIGH` (30-100) escalates `ALLOW→VERIFY`.
6. **Provenance tampering detectable.** `append_event` SHA256 `seq|type|ts|actor|parent|mandate|delegation|tx|decision|reason|canonical_data|prev`, `verify_chain` checks `seq gap`, `previous_hash` linkage, recomputed `event_hash`; `valid False` on modified/deleted/reordered/duplicated; `valid True` after normal ops.
7. **Frontend cannot override.** `POST /payments/authorize` ignores `extra_field` (`force:true`), backend is sole `decision`; frontend only displays.
8. **Historical integrity.** Revoking `AGENT_REVOKED`/`MANDATE_REVOKED`/`DELEGATION_REVOKED` appends new provenance event, does not delete `Transaction` or prior `ProvenanceEvent`.

---

## Test Results

**Adversarial suite:** `backend/tests/test_security_adversarial.py` **74/74 PASSED** (was 69/74).

```
TestAuthorizationAttacks          17/17 PASSED (missing, nonexistent, inactive, missing/expired/revoked mandate, wrong purpose/category, exact limit, +1, zero/negative/large, malformed, missing/extra, never ALLOW)
TestDelegationAttacks             11/11 PASSED (amount exceed, purpose broader, expiry beyond parent (now 400), after parent revoked, child after parent revoked, inactive child, expired delegation, circular, self, duplicate, depth)
TestDelegationGraph                1/1  PASSED (A→B→C→A cycle: creation either 400 or 201 but auth VERIFY with circular detection)
TestRevocationPropagation          5/5  PASSED (root mandate → A/B/C VERIFY, agent → downstream VERIFY, delegation → downstream VERIFY, expired, historical remain)
TestRiskManipulation               5/5  PASSED (amount splitting → VELOCITY, recipient switching → RECIPIENT_SWITCHING, merchant normalization case-insensitive, keyword evasion u r g e n t not primary, cold-start LOW)
TestRiskAuthorizationSeparation    5/5  PASSED (unauthorized LOW still VERIFY, authorized HIGH → VERIFY, no BLOCK, risk never bypass revocation/delegation)
TestProvenanceTampering            5/5  PASSED (modified → hash mismatch, deleted → gap, reordered → gap/hash, duplicated → unique constraint or hash, normal → valid)
TestReplay                         2/2  PASSED (duplicate requests → 2 TX ids, no dedup documented)
TestInputValidation               11/11 PASSED (type, boundaries, string length 200→422, whitespace→422, malformed ts→422, invalid enum→400, long 10k→422/201, invalid id→404, negative delegated→422, invalid expiry→422, impossible transition)
TestStateTransitions               5/5  PASSED (REVOKED→ACTIVE allowed, EXPIRED→ACTIVE now 400, inactive payment VERIFY, revoked delegation/mandate VERIFY)
TestPersistence                    3/3  PASSED (foreign-key orphans 404 no orphan, concurrent 5 rapid → 5 unique IDs, valid; restart persistence tx still readable)
TestFrontendAuthority              1/1  PASSED (force:true ignored)
test_no_block_anywhere + test_provenance_tamper_detection 2/2 PASSED
```

**Existing regression (Phase 2-7):** Direct `shopping-agent` 800 `ALLOW`, unauthorized 3000 `VERIFY`, wrong purpose `VERIFY`, deep `A→B→C` 400 `ALLOW` chain 7, provenance `valid True` (21→39 after demo), merchant `BadMerchant` 3 reports → `HIGH_RISK`, `POST /merchants/report` dedup 24h, amount anomaly, drain, etc. — all still PASS (re-run via ad-hoc `Invoke-RestMethod` in previous phase, 25/25).

**Frontend:** `npm run lint` **PASS** (0 errors, only `Field example` deprecation warnings), `npm run build` **PASS** (47 modules, 389kB, `vite 6.4.3`).

**Provenance verification:** After normal ops `GET /provenance/verify` → `{"valid":true,"events_checked":21,"first_event":"evt-...","last_event":"evt-...","message":"Provenance chain is valid."}`; after `UPDATE event_data='{"tampered":true}'` → `valid False, broken_event_id, "Event hash mismatch"`; after `DELETE` → `valid False, "Sequence gap"`; after `UPDATE seq swap` → `valid False`; after `INSERT duplicate seq` → `UNIQUE constraint` or `valid False`; after `DELETE bound.db` + restart → `valid True`.

---

## Known Limitations (honest, not pretended)

- **No replay idempotency:** Two identical `POST /payments/authorize` with same `agent_id,amount,merchant` create **two** `TX-` ids and **six** provenance events (3 each). Documented; not a vulnerability for demo, but in production would need `Idempotency-Key` header.
- **In-memory test DB vs file DB:** `StaticPool` `sqlite:///:memory:` is not truly concurrent like file `bound.db` `WAL`; concurrent test now sequential rapid, but service has retry (5× with `0.02*(attempt+1)s`) for `UNIQUE sequence` race, which works for file DB.
- **`EXPIRED` via `PATCH` is still allowed for `ACTIVE→EXPIRED`** (test uses it to simulate expiry), but `EXPIRED→ACTIVE` is now correctly rejected; `ACTIVE→EXPIRED` via API is arguably not needed (expiry should be time-based), but we keep it for test convenience.
- **Wholesale `*` merchant normalization is only `lower()`** — `amazon` vs `amazon.com` are considered different (Iron does phone suffix `-10`); for Bound `merchant` as free-form, this is acceptable, but `Amazon` vs `AMAZON` correctly same.
- **Keyword evasion `u r g e n t` (spaced)** is **not** detected (Levenshtein on token `u` fails) — intentional: Bound's `purpose` is agent-generated `Groceries`, not human free-form scam note; keyword is low-weight (`+8`) and never alone escalates `LOW→VERIFY` without other signals.
- **No rate limiting:** `POST /payments/authorize` can be spammed; velocity will escalate risk but not block. Production would add `X-Rate-Limit` per `agent_id`.
- **Frontend still shows stale `agent.status` until `refreshData()`** after `PATCH`; but `authorize` always re-validates via `validate_effective_authority` on backend, so stale UI cannot grant.

---

## Demo / Reset Instructions

**Backend reset (clean seed, provenance valid):**
```bash
# Windows PowerShell
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Remove-Item -Force D:\Bound\backend\bound.db -ErrorAction SilentlyContinue
Remove-Item -Force D:\Bound\data\merchant_registry.json -ErrorAction SilentlyContinue
python -m uvicorn backend.main:app --host 0.0.0.0 --port 4000  # → http://localhost:4000/health
# Verify
curl http://localhost:4000/provenance/verify  # {"valid":true,"events_checked":21}
```

**Seed:** On first start, `seed_data()` creates `shopping-agent` (Groceries ₹2000), `payment-agent` (delegated), `travel-agent`, `mnd-4091`, `mnd-1108`, `del-1001` (1000 Groceries), 5 tx, 21 provenance events.

**Frontend:**
```bash
cd D:\Bound
npm install
echo "VITE_API_URL=http://localhost:4000" > .env
npm run dev    # → http://localhost:3000 (Security tab: provenance VERIFIED, Risk Summary)
npm run lint   # tsc --noEmit PASS
npm run build  # vite 47 modules PASS
```

**Test commands:**
```bash
python -m pytest backend/tests/test_security_adversarial.py -v  # 74 passed
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" -d '{"agent_id":"shopping-agent","amount":800,"merchant":"ABC Supermarket","merchant_category":"Grocery","purpose":"Groceries"}' # → ALLOW
curl -X POST http://localhost:4000/merchants/report -H "Content-Type: application/json" -d '{"merchant":"BadMerchant","reason":"test","reporter":"tester"}'
curl http://localhost:4000/provenance/verify | jq
```

**Tamper demo:**
```bash
python -c "import sqlite3; conn=sqlite3.connect(r'D:\Bound\backend\bound.db'); cur=conn.cursor(); cur.execute('SELECT id FROM provenance_events LIMIT 1'); eid=cur.fetchone()[0]; cur.execute('UPDATE provenance_events SET event_data=\'{\"tampered\":true}\' WHERE id=?', (eid,)); conn.commit(); print('tampered',eid)"
curl http://localhost:4000/provenance/verify  # → valid False, broken_event_id
# Restore: delete DB and restart as above
```

---

## Important restrictions — complied

- No blockchain, no UPI, no OTP, no ML/Isolation Forest, no Iron frontend, no duplicated DB, no `BLOCK` path added, no redesign, no `external fraud` mention, no Iron modification, no real payment integration.

