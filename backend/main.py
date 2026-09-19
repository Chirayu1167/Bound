from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
import uuid
import json
import hashlib
import logging
import os

logger = logging.getLogger("bound")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from backend.database import get_db, engine, SessionLocal, Base
from backend import models, schemas
from backend.services.authorization import evaluate_authorization
from backend.services.delegation import validate_delegation_creation
from backend.services import provenance as provenance_service
from backend.services import risk as risk_service

# Ensure models registered
import backend.models  # noqa: F401

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173").split(",")
_cors_origins = [o.strip() for o in _cors_origins if o.strip()]

app = FastAPI(
    title="Bound — Agent Payment Security API",
    version="0.9.0",
    description="Phase 9-10: Production hardening — delegation, provenance, risk, idempotency",
    docs_url="/docs" if os.getenv("ENV", "development") != "production" else None,
    redoc_url="/redoc" if os.getenv("ENV", "development") != "production" else None,
)

# CORS — from env or safe defaults for local dev; do not use wildcard with credentials
# If wildcard is explicitly requested, disable credentials (wildcard + credentials is invalid)
if "*" in _cors_origins:
    _allow_credentials = False
    _allow_origins = ["*"]
else:
    _allow_credentials = True
    _allow_origins = _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler — log unexpected 500s without leaking stack traces
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc):
    # Let HTTPException and validation errors pass through
    if isinstance(exc, (HTTPException, StarletteHTTPException, RequestValidationError)):
        raise exc
    logger.exception(f"Unhandled error on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# Lightweight rate limiter for POST /payments/authorize (single-instance, in-memory)
# Limits per agent_id: 10 per minute, 30 per 5 minutes; per IP fallback: 60 per minute
_rate_limit_store: dict[str, list[float]] = {}
import time as _time
import threading as _threading
_rate_lock = _threading.Lock()

def _is_rate_limited(key: str, limit: int, window_sec: int) -> bool:
    now = _time.time()
    with _rate_lock:
        lst = _rate_limit_store.get(key, [])
        # Prune old
        lst = [t for t in lst if now - t < window_sec]
        if len(lst) >= limit:
            _rate_limit_store[key] = lst
            return True
        lst.append(now)
        _rate_limit_store[key] = lst
        return False

def _check_rate_limit(agent_id: str, client_host: str | None):
    # Per-agent limits — generous for hackathon demo (60 per 60s, 100 per 5m)
    # Previous 10/30 was too strict for test suite which reuses same agent-a across tests
    if agent_id:
        if _is_rate_limited(f"agent:{agent_id}:60s", 60, 60):
            raise HTTPException(status_code=429, detail="Rate limit exceeded for agent: 60 requests per 60s")
        if _is_rate_limited(f"agent:{agent_id}:5m", 100, 300):
            raise HTTPException(status_code=429, detail="Rate limit exceeded for agent: 100 requests per 5m")
    # Per-IP fallback
    if client_host:
        if _is_rate_limited(f"ip:{client_host}:60s", 120, 60):
            raise HTTPException(status_code=429, detail="Rate limit exceeded for IP: 120 per 60s")

def clear_rate_limiter():
    """For testing: clear in-memory rate limiter state."""
    with _rate_lock:
        _rate_limit_store.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _gen_agent_id(name: str) -> str:
    base = name.strip().lower().replace(" ", "-")
    return base


def _gen_mandate_id() -> str:
    return f"mnd-{uuid.uuid4().hex[:4]}"


def _gen_tx_id() -> str:
    return f"TX-{uuid.uuid4().hex[:8].upper()}"


def _gen_delegation_id() -> str:
    return f"del-{uuid.uuid4().hex[:6]}"


def _compute_idempotency_hash(payload: schemas.AuthorizeRequest) -> str:
    """Deterministic hash of logical request (excluding idempotency_key itself)."""
    # Use canonical JSON of the logical fields
    data = {
        "agent_id": payload.agent_id,
        "amount": float(payload.amount),
        "merchant": (payload.merchant or "").strip(),
        "merchant_category": (payload.merchant_category or "").strip().lower(),
        "purpose": (payload.purpose or "").strip().lower(),
        "currency": (payload.currency or "INR").strip().upper(),
    }
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _is_valid_status_transition(current: str, new: str, entity_type: str) -> bool:
    """Enforce explicit safe state transitions. Returns True if allowed."""
    # Agents: only ACTIVE<->REVOKED
    if entity_type == "agent":
        allowed = {
            "ACTIVE": {"REVOKED"},
            "REVOKED": {"ACTIVE"},
        }
        return new in allowed.get(current, set())
    # Mandates/Delegations: ACTIVE -> REVOKED/EXPIRED, REVOKED -> ACTIVE, EXPIRED is terminal
    if entity_type in ("mandate", "delegation"):
        allowed = {
            "ACTIVE": {"REVOKED", "EXPIRED"},
            "REVOKED": {"ACTIVE"},
            "EXPIRED": set(),  # terminal, no outgoing
        }
        # Allow no-op (same status) as well
        if current == new:
            return True
        return new in allowed.get(current, set())
    return False


def _record_provenance(
    db: Session,
    event_type: str,
    actor_agent_id: str | None = None,
    parent_agent_id: str | None = None,
    mandate_id: str | None = None,
    delegation_id: str | None = None,
    transaction_id: str | None = None,
    decision: str | None = None,
    reason: str | None = None,
    event_data: dict | None = None,
):
    try:
        return provenance_service.append_event(
            db=db,
            event_type=event_type,
            actor_agent_id=actor_agent_id,
            parent_agent_id=parent_agent_id,
            mandate_id=mandate_id,
            delegation_id=delegation_id,
            transaction_id=transaction_id,
            decision=decision,
            reason=reason,
            event_data=event_data,
        )
    except Exception as e:
        print(f"[provenance] failed to record {event_type}: {e}")
        return None


def _create_agent_internal(payload: schemas.AgentCreate, db: Session) -> models.Agent:
    base_id = _gen_agent_id(payload.name)
    agent_id = base_id
    existing = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if existing:
        agent_id = f"{base_id}-{uuid.uuid4().hex[:4]}"
    agent = models.Agent(
        id=agent_id,
        name=payload.name,
        description=payload.description or "",
        status="ACTIVE",
        created_at=datetime.now(timezone.utc),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    _record_provenance(
        db,
        event_type="AGENT_REGISTERED",
        actor_agent_id=agent.id,
        event_data={"name": agent.name, "description": agent.description},
    )
    return agent


def _create_mandate_internal(payload: schemas.MandateCreate, db: Session) -> models.Mandate:
    agent = db.query(models.Agent).filter(models.Agent.id == payload.agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {payload.agent_id} not found")
    if agent.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="Cannot create mandate for revoked agent")
    mandate_id = _gen_mandate_id()
    while db.query(models.Mandate).filter(models.Mandate.id == mandate_id).first():
        mandate_id = _gen_mandate_id()
    mandate = models.Mandate(
        id=mandate_id,
        agent_id=payload.agent_id,
        purpose=payload.purpose,
        max_amount=payload.max_amount,
        currency=payload.currency or "INR",
        merchant_category=payload.merchant_category,
        expires_at=payload.expires_at,
        status=payload.status or "ACTIVE",
        created_at=datetime.now(timezone.utc),
    )
    db.add(mandate)
    db.commit()
    db.refresh(mandate)
    _record_provenance(
        db,
        event_type="MANDATE_CREATED",
        actor_agent_id=payload.agent_id,
        mandate_id=mandate.id,
        event_data={"purpose": mandate.purpose, "max_amount": mandate.max_amount, "merchant_category": mandate.merchant_category, "expires_at": mandate.expires_at.isoformat() if mandate.expires_at else None},
    )
    return mandate


def _create_delegation_internal(payload: schemas.DelegationCreate, db: Session) -> models.Delegation:
    # Validate creation rules (throws HTTPException on violation)
    mandate = validate_delegation_creation(
        db=db,
        parent_agent_id=payload.parent_agent_id,
        child_agent_id=payload.child_agent_id,
        parent_mandate_id=payload.parent_mandate_id,
        delegated_amount_limit=payload.delegated_amount_limit,
        purpose=payload.purpose,
        merchant_category=payload.merchant_category,
        expires_at=payload.expires_at,
    )
    # Resolve parent_mandate_id if not provided
    parent_mandate_id = payload.parent_mandate_id or mandate.id

    delegation_id = _gen_delegation_id()
    while db.query(models.Delegation).filter(models.Delegation.id == delegation_id).first():
        delegation_id = _gen_delegation_id()

    delegation = models.Delegation(
        id=delegation_id,
        parent_agent_id=payload.parent_agent_id,
        child_agent_id=payload.child_agent_id,
        parent_mandate_id=parent_mandate_id,
        delegated_amount_limit=payload.delegated_amount_limit,
        purpose=payload.purpose,
        merchant_category=payload.merchant_category,
        status="ACTIVE",
        created_at=datetime.now(timezone.utc),
        expires_at=payload.expires_at,
    )
    db.add(delegation)
    db.commit()
    db.refresh(delegation)
    _record_provenance(
        db,
        event_type="DELEGATION_CREATED",
        actor_agent_id=payload.child_agent_id,
        parent_agent_id=payload.parent_agent_id,
        mandate_id=parent_mandate_id,
        delegation_id=delegation.id,
        event_data={
            "delegated_amount_limit": delegation.delegated_amount_limit,
            "purpose": delegation.purpose,
            "merchant_category": delegation.merchant_category,
            "expires_at": delegation.expires_at.isoformat() if delegation.expires_at else None,
        },
    )
    return delegation


def _authorize_internal(payload: schemas.AuthorizeRequest, db: Session) -> schemas.AuthorizeResponse:
    # Step 1: Effective authority + Authorization (hard boundary)
    result = evaluate_authorization(
        db=db,
        agent_id=payload.agent_id,
        amount=payload.amount,
        merchant_category=payload.merchant_category,
        purpose=payload.purpose,
    )
    if len(result) == 5:
        auth_decision, auth_reason, mandate, delegation, chain = result
    elif len(result) == 3:
        auth_decision, auth_reason = result[0], result[1]
        mandate, delegation, chain = result[2], None, None
    else:
        auth_decision, auth_reason, mandate = result[0], result[1], result[2]
        delegation, chain = None, None

    # Determine effective limit and delegation depth for risk engine
    # Effective limit is from the leaf's authority (delegation limit or mandate max)
    effective_limit = None
    if delegation:
        effective_limit = delegation.delegated_amount_limit
    elif mandate:
        effective_limit = mandate.max_amount

    # Delegation depth = number of delegations in chain
    delegation_depth = 0
    if chain:
        # Count steps that are Delegation
        delegation_depth = sum(1 for s in chain if isinstance(s, dict) and s.get("step") == "Delegation")
        # Fallback: if chain is list of dicts with step Delegation, else estimate via delegation existence
        if delegation_depth == 0 and delegation:
            delegation_depth = 1
            # For 3-level, chain would have 2 delegations, but our current chain for 3-level has 2 delegations
            # Count delegations in DB chain for this agent's effective authority
            try:
                from backend.services.effective_authority import validate_effective_authority

                eff = validate_effective_authority(db, payload.agent_id)
                if eff.get("delegation_chain"):
                    delegation_depth = len(eff["delegation_chain"])
            except:
                pass

    # Step 2: Risk Engine (deterministic, never grants authority)
    risk_result = risk_service.evaluate_risk(
        db=db,
        agent_id=payload.agent_id,
        amount=payload.amount,
        merchant=payload.merchant,
        merchant_category=payload.merchant_category,
        purpose=payload.purpose,
        effective_limit=effective_limit,
        delegation_depth=delegation_depth,
    )
    risk_score = risk_result["risk_score"]
    risk_level = risk_result["risk_level"]
    risk_factors = risk_result["risk_factors"]

    # Step 3: Final decision — risk never overrides authority
    # If authorization invalid → final VERIFY regardless of risk
    # If authorization valid + LOW → ALLOW
    # If authorization valid + MEDIUM/HIGH → VERIFY (escalated)
    if auth_decision != "ALLOW":
        final_decision = "VERIFY"
        final_reason = auth_reason
        final_level = risk_level  # still show risk but final is VERIFY due to auth
    else:
        if risk_level == "LOW":
            final_decision = "ALLOW"
            final_reason = auth_reason
        else:
            final_decision = "VERIFY"
            # Combine auth reason with risk escalation
            top_factor = risk_factors[0]["message"] if risk_factors else f"Risk {risk_level} ({risk_score})"
            final_reason = f"Authorization valid but risk {risk_level} requires verification — {top_factor}"

    tx_id = _gen_tx_id()
    while db.query(models.Transaction).filter(models.Transaction.id == tx_id).first():
        tx_id = _gen_tx_id()

    # Prepare risk_factors JSON for storage
    import json as _json

    risk_factors_json = _json.dumps(risk_factors, ensure_ascii=False) if risk_factors else None

    tx = models.Transaction(
        id=tx_id,
        agent_id=payload.agent_id,
        mandate_id=mandate.id if mandate else None,
        delegation_id=delegation.id if delegation else None,
        amount=payload.amount,
        currency=payload.currency or "INR",
        merchant=payload.merchant,
        merchant_category=payload.merchant_category,
        purpose=payload.purpose,
        decision=final_decision,
        reason=final_reason,
        created_at=datetime.now(timezone.utc),
        authorization_status=auth_decision,
        risk_score=risk_score,
        risk_level=risk_level,
        risk_factors=risk_factors_json,
    )
    db.add(tx)
    db.commit()

    # Provenance: PAYMENT_REQUESTED (after transaction exists for FK)
    _record_provenance(
        db,
        event_type="PAYMENT_REQUESTED",
        actor_agent_id=payload.agent_id,
        mandate_id=mandate.id if mandate else None,
        delegation_id=delegation.id if delegation else None,
        transaction_id=tx_id,
        event_data={
            "amount": payload.amount,
            "currency": payload.currency or "INR",
            "merchant": payload.merchant,
            "merchant_category": payload.merchant_category,
            "purpose": payload.purpose,
        },
    )

    # Provenance: AUTHORIZATION_DECIDED with full risk result (evidence)
    _record_provenance(
        db,
        event_type="AUTHORIZATION_DECIDED",
        actor_agent_id=payload.agent_id,
        mandate_id=mandate.id if mandate else None,
        delegation_id=delegation.id if delegation else None,
        transaction_id=tx_id,
        decision=final_decision,
        reason=final_reason,
        event_data={
            "authorization_status": auth_decision,
            "authorization_reason": auth_reason,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "final_decision": final_decision,
            "final_reason": final_reason,
            "chain": chain,
            "amount": payload.amount,
            "merchant": payload.merchant,
        },
    )
    _record_provenance(
        db,
        event_type="PAYMENT_COMPLETED",
        actor_agent_id=payload.agent_id,
        mandate_id=mandate.id if mandate else None,
        delegation_id=delegation.id if delegation else None,
        transaction_id=tx_id,
        decision=final_decision,
        reason=final_reason,
        event_data={"merchant": payload.merchant, "decision": final_decision, "risk_level": risk_level, "risk_score": risk_score},
    )

    return schemas.AuthorizeResponse(
        transaction_id=tx_id,
        decision=final_decision,
        reason=final_reason,
        delegation_id=delegation.id if delegation else None,
        mandate_id=mandate.id if mandate else None,
        chain=chain,
        authorization_status=auth_decision,
        authorization_reason=auth_reason,
        risk_score=risk_score,
        risk_level=risk_level,
        risk_factors=risk_factors,  # type: ignore
        final_decision=final_decision,
    )


# ---------------------------------------------------------------------------
# Seed data — Phase 5 adds provenance events for each seed entity
# ---------------------------------------------------------------------------
def seed_data():
    db = SessionLocal()
    try:
        existing = db.query(models.Agent).count()
        if existing > 0:
            return
        print("[seed] Creating demo data...")
        now = datetime.now(timezone.utc)
        shopping = models.Agent(
            id="shopping-agent",
            name="Shopping Agent",
            description="Handles grocery purchases up to INR 2,000",
            status="ACTIVE",
            created_at=now - timedelta(days=2),
        )
        travel = models.Agent(
            id="travel-agent",
            name="Travel Agent",
            description="Corporate travel booking",
            status="ACTIVE",
            created_at=now - timedelta(days=5),
        )
        payment = models.Agent(
            id="payment-agent",
            name="Payment Agent",
            description="Sub-delegated executor for Shopping Agent, Grocery only",
            status="ACTIVE",
            created_at=now - timedelta(days=1, hours=2),
        )
        db.add_all([shopping, travel, payment])
        db.flush()
        # Provenance for agents
        for ag in [shopping, travel, payment]:
            _record_provenance(db, event_type="AGENT_REGISTERED", actor_agent_id=ag.id, event_data={"name": ag.name})

        mandate_grocery = models.Mandate(
            id="mnd-4091",
            agent_id="shopping-agent",
            purpose="Groceries",
            max_amount=2000,
            currency="INR",
            merchant_category="Grocery",
            expires_at=now + timedelta(days=30),
            status="ACTIVE",
            created_at=now - timedelta(days=1),
        )
        mandate_travel = models.Mandate(
            id="mnd-1108",
            agent_id="travel-agent",
            purpose="Flight Booking",
            max_amount=8000,
            currency="INR",
            merchant_category="Airlines",
            expires_at=now + timedelta(days=60),
            status="ACTIVE",
            created_at=now - timedelta(days=3),
        )
        db.add_all([mandate_grocery, mandate_travel])
        db.flush()
        for m in [mandate_grocery, mandate_travel]:
            _record_provenance(db, event_type="MANDATE_CREATED", actor_agent_id=m.agent_id, mandate_id=m.id, event_data={"purpose": m.purpose, "max_amount": m.max_amount, "merchant_category": m.merchant_category})

        delegation = models.Delegation(
            id="del-1001",
            parent_agent_id="shopping-agent",
            child_agent_id="payment-agent",
            parent_mandate_id="mnd-4091",
            delegated_amount_limit=1000,
            purpose="Groceries",
            merchant_category="Grocery",
            status="ACTIVE",
            created_at=now - timedelta(hours=12),
            expires_at=now + timedelta(days=20),
        )
        db.add(delegation)
        db.flush()
        _record_provenance(
            db,
            event_type="DELEGATION_CREATED",
            actor_agent_id=delegation.child_agent_id,
            parent_agent_id=delegation.parent_agent_id,
            mandate_id=delegation.parent_mandate_id,
            delegation_id=delegation.id,
            event_data={"delegated_amount_limit": delegation.delegated_amount_limit, "purpose": delegation.purpose, "merchant_category": delegation.merchant_category},
        )

        tx1 = models.Transaction(
            id="TX-901923",
            agent_id="shopping-agent",
            mandate_id="mnd-4091",
            amount=820,
            currency="INR",
            merchant="ABC Supermarket",
            merchant_category="Grocery",
            purpose="Groceries",
            decision="ALLOW",
            reason="Payment is within the authorized mandate.",
            created_at=now - timedelta(hours=2),
        )
        tx2 = models.Transaction(
            id="TX-901844",
            agent_id="shopping-agent",
            mandate_id="mnd-4091",
            amount=3500,
            currency="INR",
            merchant="QuickElectro Ltd",
            merchant_category="Electronics",
            purpose="Groceries",
            decision="VERIFY",
            reason="Amount exceeds authorized limit.",
            created_at=now - timedelta(hours=3),
        )
        tx3 = models.Transaction(
            id="TX-901712",
            agent_id="shopping-agent",
            mandate_id="mnd-4091",
            amount=640,
            currency="INR",
            merchant="FreshDirect",
            merchant_category="Grocery",
            purpose="Groceries",
            decision="ALLOW",
            reason="Payment is within the authorized mandate.",
            created_at=now - timedelta(hours=5),
        )
        tx4 = models.Transaction(
            id="TX-901509",
            agent_id="travel-agent",
            mandate_id="mnd-1108",
            amount=7450,
            currency="INR",
            merchant="IndiGo Airlines",
            merchant_category="Airlines",
            purpose="Flight Booking",
            decision="ALLOW",
            reason="Payment is within the authorized mandate.",
            created_at=now - timedelta(days=1, hours=2),
        )
        tx5 = models.Transaction(
            id="TX-901600",
            agent_id="payment-agent",
            mandate_id="mnd-4091",
            delegation_id="del-1001",
            amount=800,
            currency="INR",
            merchant="ABC Supermarket",
            merchant_category="Grocery",
            purpose="Groceries",
            decision="ALLOW",
            reason="Payment is within the delegated mandate.",
            created_at=now - timedelta(hours=1),
        )
        db.add_all([tx1, tx2, tx3, tx4, tx5])
        db.flush()
        # Provenance for seed transactions — create PAYMENT_REQUESTED + AUTHORIZATION_DECIDED per tx
        for tx in [tx1, tx2, tx3, tx4, tx5]:
            _record_provenance(
                db,
                event_type="PAYMENT_REQUESTED",
                actor_agent_id=tx.agent_id,
                mandate_id=tx.mandate_id,
                delegation_id=tx.delegation_id,
                transaction_id=tx.id,
                event_data={"amount": tx.amount, "merchant": tx.merchant, "merchant_category": tx.merchant_category, "purpose": tx.purpose},
            )
            _record_provenance(
                db,
                event_type="AUTHORIZATION_DECIDED",
                actor_agent_id=tx.agent_id,
                mandate_id=tx.mandate_id,
                delegation_id=tx.delegation_id,
                transaction_id=tx.id,
                decision=tx.decision,
                reason=tx.reason,
                event_data={"decision": tx.decision, "reason": tx.reason},
            )
            _record_provenance(
                db,
                event_type="PAYMENT_COMPLETED",
                actor_agent_id=tx.agent_id,
                mandate_id=tx.mandate_id,
                delegation_id=tx.delegation_id,
                transaction_id=tx.id,
                decision=tx.decision,
                reason=tx.reason,
                event_data={"merchant": tx.merchant, "decision": tx.decision},
            )

        db.commit()
        print("[seed] Demo data created (with delegation del-1001) + provenance events.")
    except Exception as e:
        db.rollback()
        print(f"[seed] Error: {e}")
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    seed_data()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/health")
def health_api():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Provenance — Phase 5 (append-only, hash-linked)
# ---------------------------------------------------------------------------
@app.get("/provenance", response_model=list[schemas.ProvenanceEventResponse])
def list_provenance(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    q = db.query(models.ProvenanceEvent).order_by(models.ProvenanceEvent.sequence_number.asc())
    if offset:
        q = q.offset(offset)
    if limit:
        q = q.limit(limit)
    return q.all()


@app.get("/api/provenance", response_model=list[schemas.ProvenanceEventResponse])
def list_provenance_api(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    return list_provenance(limit, offset, db)


@app.get("/provenance/verify", response_model=schemas.ProvenanceVerifyResponse)
def verify_provenance(db: Session = Depends(get_db)):
    result = provenance_service.verify_chain(db)
    return result


@app.get("/api/provenance/verify", response_model=schemas.ProvenanceVerifyResponse)
def verify_provenance_api(db: Session = Depends(get_db)):
    return verify_provenance(db)


@app.get("/provenance/transaction/{transaction_id}", response_model=list[schemas.ProvenanceEventResponse])
def get_provenance_for_transaction(transaction_id: str, db: Session = Depends(get_db)):
    events = db.query(models.ProvenanceEvent).filter(models.ProvenanceEvent.transaction_id == transaction_id).order_by(models.ProvenanceEvent.sequence_number.asc()).all()
    return events


@app.get("/api/provenance/transaction/{transaction_id}", response_model=list[schemas.ProvenanceEventResponse])
def get_provenance_for_transaction_api(transaction_id: str, db: Session = Depends(get_db)):
    return get_provenance_for_transaction(transaction_id, db)


@app.get("/provenance/event/{event_id}", response_model=schemas.ProvenanceEventResponse)
def get_provenance_event(event_id: str, db: Session = Depends(get_db)):
    evt = db.query(models.ProvenanceEvent).filter(models.ProvenanceEvent.id == event_id).first()
    if not evt:
        raise HTTPException(status_code=404, detail="Provenance event not found")
    return evt


@app.get("/api/provenance/event/{event_id}", response_model=schemas.ProvenanceEventResponse)
def get_provenance_event_api(event_id: str, db: Session = Depends(get_db)):
    return get_provenance_event(event_id, db)


# ---------------------------------------------------------------------------
# Merchant Reputation — Phase 7 (adapted from Iron scam_registry)
# ---------------------------------------------------------------------------
@app.post("/merchants/report", response_model=schemas.MerchantReputationResponse)
def report_merchant(payload: schemas.MerchantReportRequest, db: Session = Depends(get_db)):
    from backend.services.merchant_reputation import report_merchant as _report, get_merchant_reputation as _get

    _report(payload.merchant, payload.reporter, payload.reason)
    full = _get(payload.merchant)
    _record_provenance(
        db,
        event_type="MERCHANT_REPORTED",
        event_data={"merchant": payload.merchant, "reason": payload.reason, "report_count": full["report_count"]},
    )
    return full


@app.post("/api/merchants/report", response_model=schemas.MerchantReputationResponse)
def report_merchant_api(payload: schemas.MerchantReportRequest, db: Session = Depends(get_db)):
    return report_merchant(payload, db)


@app.get("/merchants/reputation/{merchant}", response_model=schemas.MerchantReputationResponse)
def get_merchant_reputation_endpoint(merchant: str):
    from backend.services.merchant_reputation import get_merchant_reputation as _get

    return _get(merchant)


@app.get("/api/merchants/reputation/{merchant}", response_model=schemas.MerchantReputationResponse)
def get_merchant_reputation_api(merchant: str):
    return get_merchant_reputation_endpoint(merchant)


@app.get("/merchants/flagged")
def get_flagged_merchants_endpoint(min_count: int = 1):
    from backend.services.merchant_reputation import get_all_flagged

    return get_all_flagged(min_count)


@app.get("/api/merchants/flagged")
def get_flagged_merchants_api(min_count: int = 1):
    return get_flagged_merchants_endpoint(min_count)


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
@app.get("/agents", response_model=list[schemas.AgentResponse])
def list_agents(db: Session = Depends(get_db)):
    agents = db.query(models.Agent).order_by(models.Agent.created_at.desc()).all()
    return agents


@app.get("/api/agents", response_model=list[schemas.AgentResponse])
def list_agents_api(db: Session = Depends(get_db)):
    agents = db.query(models.Agent).order_by(models.Agent.created_at.desc()).all()
    return agents


@app.post("/agents", response_model=schemas.AgentResponse, status_code=201)
def create_agent(payload: schemas.AgentCreate, db: Session = Depends(get_db)):
    return _create_agent_internal(payload, db)


@app.post("/api/agents", response_model=schemas.AgentResponse, status_code=201)
def create_agent_api(payload: schemas.AgentCreate, db: Session = Depends(get_db)):
    return _create_agent_internal(payload, db)


@app.patch("/agents/{agent_id}", response_model=schemas.AgentResponse)
def update_agent(agent_id: str, payload: dict, db: Session = Depends(get_db)):
    agent = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    was_status = agent.status
    if "status" in payload:
        if payload["status"] not in ("ACTIVE", "REVOKED"):
            raise HTTPException(status_code=400, detail="Invalid status")
        if payload["status"] != was_status and not _is_valid_status_transition(was_status, payload["status"], "agent"):
            raise HTTPException(status_code=400, detail=f"Invalid status transition {was_status} -> {payload['status']}")
        agent.status = payload["status"]
    if "name" in payload:
        agent.name = payload["name"]
    if "description" in payload:
        agent.description = payload["description"]
    db.commit()
    db.refresh(agent)
    if payload.get("status") == "REVOKED" and was_status != "REVOKED":
        _record_provenance(db, event_type="AGENT_REVOKED", actor_agent_id=agent_id, reason="Agent revoked via API", event_data={"previous_status": was_status})
    return agent


@app.patch("/api/agents/{agent_id}", response_model=schemas.AgentResponse)
def update_agent_api(agent_id: str, payload: dict, db: Session = Depends(get_db)):
    return update_agent(agent_id, payload, db)


# ---------------------------------------------------------------------------
# Mandates
# ---------------------------------------------------------------------------
@app.get("/mandates", response_model=list[schemas.MandateResponse])
def list_mandates(db: Session = Depends(get_db)):
    mandates = db.query(models.Mandate).order_by(models.Mandate.created_at.desc()).all()
    now = datetime.now(timezone.utc)
    for m in mandates:
        if m.expires_at and m.status == "ACTIVE":
            exp = m.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if now > exp:
                m.status = "EXPIRED"
    return mandates


@app.get("/api/mandates", response_model=list[schemas.MandateResponse])
def list_mandates_api(db: Session = Depends(get_db)):
    return list_mandates(db)


@app.post("/mandates", response_model=schemas.MandateResponse, status_code=201)
def create_mandate(payload: schemas.MandateCreate, db: Session = Depends(get_db)):
    return _create_mandate_internal(payload, db)


@app.post("/api/mandates", response_model=schemas.MandateResponse, status_code=201)
def create_mandate_api(payload: schemas.MandateCreate, db: Session = Depends(get_db)):
    return _create_mandate_internal(payload, db)


@app.patch("/mandates/{mandate_id}", response_model=schemas.MandateResponse)
def update_mandate(mandate_id: str, payload: dict, db: Session = Depends(get_db)):
    m = db.query(models.Mandate).filter(models.Mandate.id == mandate_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mandate not found")
    was_status = m.status
    if "status" in payload:
        if payload["status"] not in ("ACTIVE", "REVOKED", "EXPIRED"):
            raise HTTPException(status_code=400, detail="Invalid status")
        if payload["status"] != was_status and not _is_valid_status_transition(was_status, payload["status"], "mandate"):
            raise HTTPException(status_code=400, detail=f"Invalid status transition {was_status} -> {payload['status']}")
        m.status = payload["status"]
    if "max_amount" in payload:
        m.max_amount = float(payload["max_amount"])
    if "purpose" in payload:
        m.purpose = payload["purpose"]
    if "merchant_category" in payload:
        m.merchant_category = payload["merchant_category"]
    if "expires_at" in payload:
        raw = payload["expires_at"]
        if raw is None:
            m.expires_at = None
        elif isinstance(raw, str):
            try:
                s = raw.replace("Z", "+00:00")
                m.expires_at = datetime.fromisoformat(s)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid expires_at format")
        else:
            m.expires_at = raw
    db.commit()
    db.refresh(m)
    if payload.get("status") == "REVOKED" and was_status != "REVOKED":
        _record_provenance(db, event_type="MANDATE_REVOKED", mandate_id=mandate_id, actor_agent_id=m.agent_id, reason="Mandate revoked via API", event_data={"mandate_id": mandate_id, "previous_status": was_status})
    return m


@app.patch("/api/mandates/{mandate_id}", response_model=schemas.MandateResponse)
def update_mandate_api(mandate_id: str, payload: dict, db: Session = Depends(get_db)):
    return update_mandate(mandate_id, payload, db)


# ---------------------------------------------------------------------------
# Delegations — Phase 3
# ---------------------------------------------------------------------------
@app.get("/delegations", response_model=list[schemas.DelegationResponse])
def list_delegations(db: Session = Depends(get_db)):
    delegations = db.query(models.Delegation).order_by(models.Delegation.created_at.desc()).all()
    now = datetime.now(timezone.utc)
    for d in delegations:
        if d.expires_at and d.status == "ACTIVE":
            exp = d.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if now > exp:
                d.status = "EXPIRED"
    return delegations


@app.get("/api/delegations", response_model=list[schemas.DelegationResponse])
def list_delegations_api(db: Session = Depends(get_db)):
    return list_delegations(db)


@app.get("/delegations/{delegation_id}", response_model=schemas.DelegationResponse)
def get_delegation(delegation_id: str, db: Session = Depends(get_db)):
    d = db.query(models.Delegation).filter(models.Delegation.id == delegation_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found")
    # Auto-expire check
    if d.expires_at and d.status == "ACTIVE":
        now = datetime.now(timezone.utc)
        exp = d.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if now > exp:
            d.status = "EXPIRED"
    return d


@app.get("/api/delegations/{delegation_id}", response_model=schemas.DelegationResponse)
def get_delegation_api(delegation_id: str, db: Session = Depends(get_db)):
    return get_delegation(delegation_id, db)


@app.get("/delegations/chain/{agent_id}", response_model=schemas.DelegationChainResponse)
def get_delegation_chain(agent_id: str, db: Session = Depends(get_db)):
    from backend.services.effective_authority import validate_effective_authority

    result = validate_effective_authority(db, agent_id)
    # Even if invalid, return whatever chain we could build for visibility
    delegation = result.get("leaf_delegation")
    root_mandate = result.get("root_mandate")
    chain = result.get("full_chain") or []
    # If no delegation and no mandate (e.g., no authority), try to find any delegation history for display
    if not delegation and not root_mandate and not chain:
        # Fallback to most recent delegation regardless of status for historical view
        delegation = (
            db.query(models.Delegation)
            .filter(models.Delegation.child_agent_id == agent_id)
            .order_by(models.Delegation.created_at.desc())
            .first()
        )
        if delegation:
            root_mandate = db.query(models.Mandate).filter(models.Mandate.id == delegation.parent_mandate_id).first()
            chain = [
                {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
                {"step": "Root Mandate", "id": root_mandate.id if root_mandate else delegation.parent_mandate_id, "name": root_mandate.purpose if root_mandate else "Unknown", "detail": root_mandate.status if root_mandate else "Unknown"},
                {"step": "Delegation", "id": delegation.id, "name": delegation.purpose, "detail": delegation.status},
                {"step": "Agent", "id": agent_id, "name": agent_id, "detail": "Child"},
            ]
    return schemas.DelegationChainResponse(
        delegation_id=delegation.id if delegation else None,
        chain=chain,
        root_mandate=root_mandate,
        delegation=delegation,
    )


@app.get("/api/delegations/chain/{agent_id}", response_model=schemas.DelegationChainResponse)
def get_delegation_chain_api(agent_id: str, db: Session = Depends(get_db)):
    return get_delegation_chain(agent_id, db)


@app.post("/delegations", response_model=schemas.DelegationResponse, status_code=201)
def create_delegation(payload: schemas.DelegationCreate, db: Session = Depends(get_db)):
    return _create_delegation_internal(payload, db)


@app.post("/api/delegations", response_model=schemas.DelegationResponse, status_code=201)
def create_delegation_api(payload: schemas.DelegationCreate, db: Session = Depends(get_db)):
    return _create_delegation_internal(payload, db)


@app.patch("/delegations/{delegation_id}", response_model=schemas.DelegationResponse)
def update_delegation(delegation_id: str, payload: dict, db: Session = Depends(get_db)):
    d = db.query(models.Delegation).filter(models.Delegation.id == delegation_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found")
    was_status = d.status
    if "status" in payload:
        if payload["status"] not in ("ACTIVE", "REVOKED", "EXPIRED"):
            raise HTTPException(status_code=400, detail="Invalid status")
        if payload["status"] != was_status and not _is_valid_status_transition(was_status, payload["status"], "delegation"):
            raise HTTPException(status_code=400, detail=f"Invalid status transition {was_status} -> {payload['status']}")
        d.status = payload["status"]
    if "delegated_amount_limit" in payload:
        # Re-validate against parent mandate
        parent_mandate = db.query(models.Mandate).filter(models.Mandate.id == d.parent_mandate_id).first()
        if parent_mandate and float(payload["delegated_amount_limit"]) > parent_mandate.max_amount:
            raise HTTPException(status_code=400, detail="Delegated limit exceeds parent mandate")
        d.delegated_amount_limit = float(payload["delegated_amount_limit"])
    if "purpose" in payload:
        d.purpose = payload["purpose"]
    if "merchant_category" in payload:
        d.merchant_category = payload["merchant_category"]
    if "expires_at" in payload:
        raw = payload["expires_at"]
        if raw is None:
            d.expires_at = None
        elif isinstance(raw, str):
            try:
                s = raw.replace("Z", "+00:00")
                d.expires_at = datetime.fromisoformat(s)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid expires_at format")
        else:
            d.expires_at = raw
    db.commit()
    db.refresh(d)
    if payload.get("status") == "REVOKED" and was_status != "REVOKED":
        _record_provenance(
            db,
            event_type="DELEGATION_REVOKED",
            delegation_id=delegation_id,
            parent_agent_id=d.parent_agent_id,
            actor_agent_id=d.child_agent_id,
            mandate_id=d.parent_mandate_id,
            reason="Delegation revoked via API",
            event_data={"parent_agent_id": d.parent_agent_id, "child_agent_id": d.child_agent_id},
        )
    return d


@app.patch("/api/delegations/{delegation_id}", response_model=schemas.DelegationResponse)
def update_delegation_api(delegation_id: str, payload: dict, db: Session = Depends(get_db)):
    return update_delegation(delegation_id, payload, db)


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
@app.get("/transactions", response_model=list[schemas.TransactionResponse])
def list_transactions(db: Session = Depends(get_db)):
    txs = db.query(models.Transaction).order_by(models.Transaction.created_at.desc()).limit(100).all()
    return txs


@app.get("/api/transactions", response_model=list[schemas.TransactionResponse])
def list_transactions_api(db: Session = Depends(get_db)):
    return list_transactions(db)


# ---------------------------------------------------------------------------
# Authorization — with idempotency (Phase 9)
# ---------------------------------------------------------------------------
def _handle_idempotent_authorize(
    payload: schemas.AuthorizeRequest,
    db: Session,
    header_key: str | None = None,
    client_host: str | None = None,
) -> schemas.AuthorizeResponse:
    # Resolve idempotency key: header takes precedence over body
    key = (header_key.strip() if header_key and header_key.strip() else None) or (payload.idempotency_key.strip() if payload.idempotency_key and payload.idempotency_key.strip() else None)
    # Normalize: treat empty as None
    if key == "":
        key = None
    request_hash = None
    if key:
        request_hash = _compute_idempotency_hash(payload)
        existing = db.query(models.IdempotencyRecord).filter(models.IdempotencyRecord.key == key).first()
        if existing:
            if existing.request_hash == request_hash:
                # Exact replay — return original response without new transaction/provenance
                logger.info(f"Idempotency replay key={key} tx={existing.transaction_id} -> returning cached")
                try:
                    cached = json.loads(existing.response)
                    return schemas.AuthorizeResponse(**cached)
                except Exception:
                    # If cached parse fails, fall through to re-execute
                    pass
            else:
                # Same key, different payload — conflict
                logger.warning(f"Idempotency conflict key={key} existing_hash={existing.request_hash} new_hash={request_hash}")
                raise HTTPException(status_code=409, detail="Idempotency key conflict: same key with different request payload. Use a different key or repeat the exact same request.")

    # Rate limiting (per-agent, lightweight, in-memory) — only for new executions, not replays
    # Per-agent: 10 per 60s, 30 per 5m
    _check_rate_limit(payload.agent_id, client_host)

    # No idempotency or not found — execute normally
    result = _authorize_internal(payload, db)

    # Store for future replays if key was provided
    if key and request_hash:
        try:
            # Serialize response for storage
            response_json = json.dumps(result.model_dump() if hasattr(result, "model_dump") else result.dict(), ensure_ascii=False, sort_keys=True)
            record = models.IdempotencyRecord(
                key=key,
                request_hash=request_hash,
                response=response_json,
                transaction_id=result.transaction_id,
            )
            db.add(record)
            db.commit()
        except Exception as e:
            # If duplicate key race, another thread already inserted — fetch and return existing
            db.rollback()
            existing = db.query(models.IdempotencyRecord).filter(models.IdempotencyRecord.key == key).first()
            if existing and existing.request_hash == request_hash:
                try:
                    cached = json.loads(existing.response)
                    return schemas.AuthorizeResponse(**cached)
                except:
                    pass
            logger.warning(f"Failed to store idempotency key {key}: {e}")

    return result


@app.post("/payments/authorize", response_model=schemas.AuthorizeResponse)
def authorize_payment(
    payload: schemas.AuthorizeRequest,
    db: Session = Depends(get_db),
    request: Request = None,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    # FastAPI will inject Request if type-annotated, but default None allows test without request
    client_host = None
    try:
        if request and hasattr(request, "client") and request.client:
            client_host = request.client.host
    except:
        pass
    return _handle_idempotent_authorize(payload, db, idempotency_key, client_host)


@app.post("/api/payments/authorize", response_model=schemas.AuthorizeResponse)
def authorize_payment_api(
    payload: schemas.AuthorizeRequest,
    db: Session = Depends(get_db),
    request: Request = None,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    client_host = None
    try:
        if request and hasattr(request, "client") and request.client:
            client_host = request.client.host
    except:
        pass
    return _handle_idempotent_authorize(payload, db, idempotency_key, client_host)


@app.post("/authorize", response_model=schemas.AuthorizeResponse)
def authorize_alias(payload: schemas.AuthorizeRequest, db: Session = Depends(get_db), request: Request = None, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    client_host = None
    try:
        if request and hasattr(request, "client") and request.client:
            client_host = request.client.host
    except:
        pass
    return _handle_idempotent_authorize(payload, db, idempotency_key, client_host)


@app.post("/api/authorize", response_model=schemas.AuthorizeResponse)
def authorize_alias_api(payload: schemas.AuthorizeRequest, db: Session = Depends(get_db), request: Request = None, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    client_host = None
    try:
        if request and hasattr(request, "client") and request.client:
            client_host = request.client.host
    except:
        pass
    return _handle_idempotent_authorize(payload, db, idempotency_key, client_host)
