# Bound — Agent Payment Security

Cryptographically enforced permission contracts and zero-latency enclave authorization for AI agents.

Bound gives every AI agent a **mandate** (what it may spend, where, and how much), supports **delegation chains** (parent → child with strictly narrower authority), evaluates every payment through a **deterministic authorization engine + risk engine**, and records everything in a **tamper-evident provenance chain**.

> **Status: production-hardened demo (Phases 1–10 complete).**
> Frontend talks to a real FastAPI + SQLite backend. 74/74 adversarial security tests pass. No `BLOCK` path — decisions are only `ALLOW` / `VERIFY`.

---

## Features

- **Agents** — register, revoke / restore (`ACTIVE ↔ REVOKED`), rotate keys (UI).
- **Mandates** — per-agent spending contract: `purpose + merchant_category + max_amount + expiry`. Revocation is instant and enforced on next authorization.
- **Delegations** — `parent_agent → child_agent` under a parent mandate. Enforces `child ⊆ parent` (amount, scope, expiry). Full chain walk with cycle detection and depth guard (>10).
- **Deterministic authorization** — 7-step hard boundary (agent → mandate → expiry → amount → purpose/category). Risk can never grant authority.
- **Deterministic risk engine** (no ML) — 12 fraud rules + baseline stats + merchant reputation + keyword detector. Score 0–100 (`LOW 0–29 / MEDIUM 30–59 / HIGH 60–100`). `MEDIUM/HIGH` escalates `ALLOW → VERIFY`, never the reverse.
- **Provenance ledger** — append-only, SHA256 hash-chained (`PAYMENT_REQUESTED → AUTHORIZATION_DECIDED → PAYMENT_COMPLETED` per payment, plus lifecycle events). `GET /provenance/verify` detects modify / delete / reorder / duplicate.
- **Merchant reputation** — report / query / flagged list with 24h reporter dedup and `clean → flagged → high_risk` tiers.
- **Idempotency** — `Idempotency-Key` header (or `idempotency_key` body). Same key + same payload → cached response, no new TX. Same key + different payload → `409`.
- **Hardening** — strict Pydantic validation, state-machine transitions, per-agent + per-IP rate limiting, CORS from env, `/docs` hidden in production, global 500 handler without stack leaks.
- **Dashboard UI** — Overview, Agents, Mandates, Delegations, Payment Verification (3-column `AUTHORIZATION | RISK | FINAL`), Security Audit (provenance + risk summary), Security Intercept demo, panic revoke-all, command palette (`Ctrl/Cmd+K`).

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite 6 + TypeScript 5 + Tailwind CSS v4 (`@tailwindcss/vite`) + Material Symbols |
| Backend | Python 3.11+ (tested 3.13) + FastAPI 0.115 + SQLAlchemy 2 + Pydantic 2 + Uvicorn |
| Store | SQLite (`backend/bound.db`, WAL + `foreign_keys=ON`) + `backend/data/merchant_registry.json` |
| Tests | `pytest` (74 adversarial tests) + `tsc --noEmit` + `vite build` |

---

## Quick Start

**Prerequisites:** Node.js 18+, Python 3.11+

### 1. Backend → http://localhost:4000

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 4000 --reload
# → http://localhost:4000/health  {"status":"ok"}
# → http://localhost:4000/docs    (hidden when ENV=production)
```

First run auto-seeds SQLite (`backend/bound.db`, gitignored):

- Agents: `shopping-agent`, `travel-agent`, `payment-agent` (delegated child)
- Mandates: `mnd-4091` Groceries ₹2,000 · Grocery · ACTIVE, `mnd-1108` Flights
- Delegation: `del-1001` shopping → payment, ₹1,000 Groceries
- 5 transactions + 21 provenance events (`GET /provenance/verify` → `valid:true`)

### 2. Frontend → http://localhost:3000

```bash
# from repo root
npm install
cp .env.example .env   # or: echo "VITE_API_URL=http://localhost:4000" > .env
npm run dev      # → http://localhost:3000
npm run build
npm run preview
npm run lint     # tsc --noEmit
```

> Backend mounts every route at both `/` and `/api/`, so both `VITE_API_URL=http://localhost:4000` and `.../api` work.

### 3. Reset (clean seed)

```powershell
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Remove-Item -Force backend\bound.db -ErrorAction SilentlyContinue
Remove-Item -Force backend\data\merchant_registry.json -ErrorAction SilentlyContinue
python -m uvicorn backend.main:app --host 0.0.0.0 --port 4000
curl http://localhost:4000/provenance/verify
```

---

## Project Structure

```
Bound/
  backend/
    main.py                  # FastAPI app, routes, seed, idempotency, rate limit
    database.py              # SQLAlchemy engine (SQLite WAL), session
    models.py                # Agent / Mandate / Delegation / Transaction / ProvenanceEvent / IdempotencyRecord
    schemas.py               # Pydantic contracts
    services/
      authorization.py       # 7-step hard authorization boundary
      effective_authority.py # delegation chain walk, revocation propagation
      delegation.py          # child ⊆ parent creation rules
      risk.py                # deterministic risk engine (orchestrator)
      baseline.py            # mean/median/std/p95/p99, merchant/category/hour stats
      fraud_rules.py         # 12 generic rules
      keyword_detector.py    # urgency / impersonation / reward / investment (fuzzy)
      merchant_reputation.py # JSON registry, 24h dedup, tiers, cache
      provenance.py          # append_event (retry) + verify_chain (SHA256)
    tests/
      test_security_adversarial.py  # 74 red-team tests
  src/
    App.tsx                  # live data load, mutations, panic, toasts
    types.ts                 # AgentNode, MandateItem, TransactionRecord, DelegationItem, RiskFactor…
    services/api.ts          # fetch layer + backend→frontend mappers
    views/                   # Overview, Agents, Mandates, Delegations, PaymentVerification, SecurityAudit, SecurityViolation
    components/              # Header, Footer, ProofModal, PanicModal, Create*Modal, CommandPalette…
    data/mockData.ts         # display enrichments only (no silent API fallback)
  .env.example               # VITE_API_URL + CORS_ORIGINS
  vite.config.ts / tsconfig.json / package.json
```

---

## API Reference

All paths exist at both `/` and `/api/` prefixes. JSON unless noted.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{"status":"ok"}` |
| GET | `/agents` | List agents |
| POST | `/agents` | `{"name","description?"}` → Agent (whitespace names rejected `422`) |
| PATCH | `/agents/{id}` | `{"status":"ACTIVE"\|"REVOKED"}` (transition-checked) |
| GET | `/mandates` | List mandates (auto-marks `EXPIRED`) |
| POST | `/mandates` | `{"agent_id","purpose","max_amount>0","merchant_category","currency?","expires_at?"}` |
| PATCH | `/mandates/{id}` | `{"status","max_amount","purpose","merchant_category","expires_at"}` |
| GET | `/delegations` | List delegations |
| GET | `/delegations/{id}` | Single delegation |
| GET | `/delegations/chain/{agent_id}` | Effective authority + full chain |
| POST | `/delegations` | `{"parent_agent_id","child_agent_id","parent_mandate_id?","delegated_amount_limit>0","purpose","merchant_category","expires_at?"}` — rejects `child > parent`, out-of-scope, `child expiry > parent expiry` with `400` |
| PATCH | `/delegations/{id}` | Status / limit / scope update (transition-checked) |
| GET | `/transactions` | Last 100 transactions (with `authorization_status`, `risk_*`) |
| POST | `/payments/authorize` | **Core engine** (also `/authorize` alias). Supports `Idempotency-Key` header |
| GET | `/provenance?limit=&offset=` | Hash-chained audit events |
| GET | `/provenance/verify` | `{"valid","events_checked","broken_event_id?","message"}` |
| GET | `/provenance/transaction/{tx}` | Events for one transaction |
| GET | `/provenance/event/{id}` | Single event |
| POST | `/merchants/report` | `{"merchant","reason","reporter"}` → reputation (24h dedup) |
| GET | `/merchants/reputation/{m}` | Reputation + tier + confidence |
| GET | `/merchants/flagged?min_count=1` | Flagged merchants |

### POST /payments/authorize

Request:

```json
{
  "agent_id": "shopping-agent",
  "amount": 800,
  "merchant": "ABC Supermarket",
  "merchant_category": "Grocery",
  "purpose": "Groceries"
}
```

Response (backward-compatible + risk fields):

```json
{
  "transaction_id": "TX-A1B2C3D4",
  "decision": "ALLOW",
  "reason": "Payment is within the authorized mandate.",
  "mandate_id": "mnd-4091",
  "delegation_id": null,
  "chain": [ { "step": "User" }, { "step": "Root Mandate" }, { "step": "Agent" } ],
  "authorization_status": "ALLOW",
  "authorization_reason": "Payment is within the authorized mandate.",
  "risk_score": 2,
  "risk_level": "LOW",
  "risk_factors": [],
  "final_decision": "ALLOW"
}
```

**Authorization checks (in order, any fail → `VERIFY`):**

1. Agent exists? else `Agent not found.`
2. Agent `ACTIVE`? else `Agent authority has been revoked.`
3. Has `ACTIVE` mandate (or valid delegation chain)? else `No active mandate…` / `Upstream … revoked`
4. Mandate/delegation not expired? else `… has expired.`
5. `amount ≤ effective_limit`? else `Amount exceeds authorized/delegated limit.`
6. **Both** purpose **and** category within scope? else `Transaction is outside the authorized purpose.`
7. Else `ALLOW`.

**Final decision matrix:**

| Authorization | Risk | Final |
|---|---|---|
| `VERIFY` | any | `VERIFY` (risk never grants) |
| `ALLOW` | `LOW` (0–29) | `ALLOW` |
| `ALLOW` | `MEDIUM` (30–59) / `HIGH` (60–100) | `VERIFY` (escalated) |

**Risk signals** (each → `RiskFactor{type, severity, message, score}`): `AMOUNT_ANOMALY`, `BALANCE_DRAIN` (vs effective limit), `HIGH_VELOCITY` (5m/1h, prospective +1), `RECIPIENT_SWITCHING`, `SEQUENTIAL_AMOUNTS`, `NEW_MERCHANT`, `REPORTED_MERCHANT` (18 / 28 critical), `CATEGORY_ANOMALY`, `ODD_HOUR` / `TIME_ANOMALY`, keyword (`urgency/impersonation/reward/investment`, fuzzy Levenshtein, capped), `DELEGATION_DEPTH`, `ROUND_AMOUNT_LARGE`. Deduped per group, summed, capped at 100.

**Idempotency / rate limit:**

- Header `Idempotency-Key: <≤64 chars>` takes precedence over body `idempotency_key`. Same key + same logical payload → cached response (same `transaction_id`, no new rows). Same key + different payload → `409 Idempotency key conflict`. Persisted in `idempotency_records` (survives restart, lost if DB deleted).
- Per-agent `60/60s` + `100/5m`, per-IP `120/60s` → `429` (new executions only; replays bypass). In-memory, single-instance.

---

## Environment

| Var | Where | Default | Notes |
|---|---|---|---|
| `VITE_API_URL` | frontend `.env` | `http://localhost:4000` | `…/api` suffix also accepted |
| `CORS_ORIGINS` | backend env | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173` | `*` disables credentials |
| `ENV` | backend env | `development` | `production` hides `/docs` + `/redoc` |

No secrets, no OTP/Twilio/Gemini keys. `.env` is gitignored; copy from `.env.example`.

---

## Tests & Verification

```bash
python -m pytest backend/tests/test_security_adversarial.py -v  # 74 passed
npm run lint    # tsc --noEmit
npm run build   # vite build (~47 modules)
curl http://localhost:4000/provenance/verify
```

Adversarial suite covers: authorization bypass, delegation escalation / cycles / self-delegation / depth, revocation propagation (agent / mandate / delegation → downstream), risk manipulation (splitting, switching, normalization, keyword evasion, cold-start, velocity), risk/auth separation + `no BLOCK`, provenance tamper (modify/delete/reorder/duplicate + valid-after-normal), replay, input validation, state transitions, persistence (orphans, rapid 5×, restart), frontend override (`force:true` ignored).

**Demo curls:**

```bash
# ALLOW
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" \
  -d '{"agent_id":"shopping-agent","amount":800,"merchant":"ABC Supermarket","merchant_category":"Grocery","purpose":"Groceries"}'

# VERIFY — amount
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" \
  -d '{"agent_id":"shopping-agent","amount":3000,"merchant":"ABC Supermarket","merchant_category":"Grocery","purpose":"Groceries"}'

# VERIFY — category (strict AND: purpose ok but category wrong still fails)
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" \
  -d '{"agent_id":"shopping-agent","amount":500,"merchant":"QuickElectro Ltd","merchant_category":"Electronics","purpose":"Groceries"}'

# Revoke → VERIFY → restore
curl -X PATCH http://localhost:4000/agents/shopping-agent -H "Content-Type: application/json" -d '{"status":"REVOKED"}'
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" \
  -d '{"agent_id":"shopping-agent","amount":500,"merchant":"ABC Supermarket","merchant_category":"Grocery","purpose":"Groceries"}'
curl -X PATCH http://localhost:4000/agents/shopping-agent -H "Content-Type: application/json" -d '{"status":"ACTIVE"}'

# Idempotency: same key+payload → same TX; same key+different payload → 409
curl -X POST http://localhost:4000/payments/authorize -H "Content-Type: application/json" -H "Idempotency-Key: demo-1" \
  -d '{"agent_id":"shopping-agent","amount":800,"merchant":"ABC Supermarket","merchant_category":"Grocery","purpose":"Groceries"}'

# Merchant reputation + risk escalation
curl -X POST http://localhost:4000/merchants/report -H "Content-Type: application/json" \
  -d '{"merchant":"BadMerchant","reason":"test","reporter":"tester"}'
curl http://localhost:4000/merchants/reputation/BadMerchant
```

---

## Security Invariants (enforced, tested)

1. Unauthorized → `VERIFY`, never `ALLOW`.
2. `Child ⊆ Parent` — amount, scope (purpose AND category), and expiry.
3. Revocation propagates the entire chain (agent / mandate / delegation, any depth).
4. Risk never grants; it only escalates `ALLOW → VERIFY`.
5. No `BLOCK` — decisions are `ALLOW`/`VERIFY` only (HTTP `4xx/5xx` are API errors, not decisions).
6. Provenance tampering is detectable (`valid:false` + `broken_event_id`).
7. Frontend cannot override — backend `decision` is the sole authority; extra fields ignored.

---

## Known Limitations (honest)

- Idempotency is per-DB-file (lost on `bound.db` delete), no TTL eviction.
- Rate limiter is in-memory, single-instance (not shared across workers).
- Without `Idempotency-Key`, duplicate POSTs create duplicate TXs (by design).
- Merchant normalization is `lower()` only (`amazon.com` ≠ `amazon`); registry starts empty until `POST /merchants/report`.
- Keyword detector misses spaced evasion (`u r g e n t`) by design — keyword is low-weight, never sole escalator.
- Balance drain uses `effective_limit` proxy (no wallet balance); amount anomaly needs ≥3 history events (cold-start safe).
- Time anomaly is simple (hour 0–5 vs daytime + <30s gap); no weekend histograms.
- `ACTIVE → EXPIRED` via PATCH is allowed for test convenience; `EXPIRED` is otherwise terminal (`EXPIRED → ACTIVE` → `400`).

---

## Docs

Phase reports at repo root (`PHASE_7_IMPLEMENTATION.md`, `PHASE_8_SECURITY_AUDIT.md`, `PHASE_9_10_FINAL_ENGINEERING_REPORT.md`) detail the risk engine, red-team findings/fixes, and production hardening. OpenAPI is served at `/docs` in development.
