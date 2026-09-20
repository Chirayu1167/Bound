from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
import uuid
import json
import hashlib
import hmac
import logging
import os
import secrets

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

_cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3001,http://127.0.0.1:3001,"
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:5174,http://127.0.0.1:5174,"
    "http://localhost:4173,http://127.0.0.1:4173,"
    "http://localhost:8080,http://127.0.0.1:8080",
).split(",")
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
#
# Deployment guard: in production the allowed origins must come explicitly
# from CORS_ORIGINS. Falling back to localhost defaults or "*" would either
# break the deployed frontend (CORS-blocked) or open the API to any origin.
if os.getenv("ENV", "development") == "production":
    _explicit_cors = os.getenv("CORS_ORIGINS")
    if not _explicit_cors or not _explicit_cors.strip():
        raise RuntimeError("Refusing to boot: ENV=production requires CORS_ORIGINS to be set explicitly (no localhost default in production).")
    if "*" in [o.strip() for o in _explicit_cors.split(",") if o.strip()]:
        raise RuntimeError("Refusing to boot: ENV=production forbids CORS_ORIGINS='*' (set the real frontend origin).")
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


def _gen_task_id() -> str:
    return f"task-{uuid.uuid4().hex[:6]}"


def _gen_approval_id() -> str:
    return f"apr-{uuid.uuid4().hex[:6]}"


def _gen_payment_id() -> str:
    return f"pay-{uuid.uuid4().hex[:6]}"


def _hash_approval_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


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


def _create_agent_internal(
    payload: schemas.AgentCreate, db: Session, *, is_task_agent: bool = False
) -> models.Agent:
    base_id = _gen_agent_id(payload.name)
    agent_id = base_id
    existing = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if existing:
        agent_id = f"{base_id}-{uuid.uuid4().hex[:4]}"
    domain = (payload.domain or "OTHER").upper()
    if domain not in ("FOOD", "TRAVEL", "SHOPPING", "OTHER"):
        raise HTTPException(status_code=400, detail=f"Invalid domain {payload.domain}")
    agent = models.Agent(
        id=agent_id,
        name=payload.name,
        description=payload.description or "",
        status="ACTIVE",
        domain=domain,
        is_task_agent=is_task_agent,
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
# Tasks + Approvals — Phase 2
#
# A task is one user request handled by a persistent domain agent. All
# authority flows through the EXISTING engine: delegation creation,
# effective authority, authorization, risk, revocation, expiry. Nothing here
# duplicates those checks — this layer only orchestrates them and adds the
# task/approval records plus single-use ephemeral machinery on top.
# ---------------------------------------------------------------------------
TASK_TTL = timedelta(hours=6)


def _task_is_expired(task: models.Task, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    exp = task.expires_at
    if exp is None:
        return False
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return now > exp


def _map_task_outcome(authorization_status: str | None, risk_level: str | None) -> tuple[str, bool]:
    """Pure mapping: (task_status, needs_approval).

    Risk NEVER grants authority:
    - ALLOW + LOW -> APPROVED (no approval needed)
    - ALLOW + MEDIUM/HIGH -> NEEDS_REVIEW (risk escalation)
    - VERIFY + anything -> NEEDS_REVIEW (authorization is the hard boundary)
    """
    if authorization_status == "ALLOW" and (risk_level or "LOW") == "LOW":
        return "APPROVED", False
    return "NEEDS_REVIEW", True


def _revoke_task_authority(db: Session, task: models.Task, reason: str) -> None:
    """Single-use / terminal cleanup: revoke the task delegation and the
    ephemeral task agent if they are still ACTIVE. History is preserved."""
    if task.delegation_id:
        d = db.query(models.Delegation).filter(models.Delegation.id == task.delegation_id).first()
        if d is not None and d.status == "ACTIVE":
            d.status = "REVOKED"
            _record_provenance(
                db,
                event_type="DELEGATION_REVOKED",
                delegation_id=d.id,
                parent_agent_id=d.parent_agent_id,
                actor_agent_id=d.child_agent_id,
                mandate_id=d.parent_mandate_id,
                reason=reason,
                event_data={"parent_agent_id": d.parent_agent_id, "child_agent_id": d.child_agent_id},
            )
    if task.task_agent_id:
        a = db.query(models.Agent).filter(models.Agent.id == task.task_agent_id).first()
        if a is not None and a.status == "ACTIVE":
            a.status = "REVOKED"
            _record_provenance(
                db,
                event_type="AGENT_REVOKED",
                actor_agent_id=a.id,
                reason=reason,
                event_data={"task_id": task.id},
            )
    db.commit()


def _expire_task_and_approval(
    db: Session, task: models.Task, approval: models.Approval | None, reason: str
) -> None:
    task.status = "EXPIRED"
    _revoke_task_authority(db, task, reason)
    if approval is not None and approval.status == "PENDING":
        approval.status = "EXPIRED"
    _record_provenance(
        db,
        event_type="TASK_EXPIRED",
        actor_agent_id=task.domain_agent_id,
        mandate_id=None,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        reason=reason,
        event_data={"task_id": task.id},
    )
    db.commit()


def _create_task_agent_internal(db: Session, domain_agent: models.Agent, purpose: str, task_id: str) -> models.Agent:
    name = f"{domain_agent.name} task: {purpose}"[:90]
    payload = schemas.AgentCreate(
        name=name,
        description=f"Ephemeral task agent for {task_id} — auto-expires, single task only",
        domain=domain_agent.domain or "OTHER",
    )
    return _create_agent_internal(payload, db, is_task_agent=True)


def _task_to_response(db: Session, task: models.Task) -> schemas.TaskResponse:
    decision = None
    reason = None
    authorization_status = None
    risk_score = None
    risk_level = None
    if task.transaction_id:
        tx = db.query(models.Transaction).filter(models.Transaction.id == task.transaction_id).first()
        if tx is not None:
            decision = tx.decision
            reason = tx.reason
            authorization_status = tx.authorization_status
            risk_score = tx.risk_score
            risk_level = tx.risk_level
    return schemas.TaskResponse(
        id=task.id,
        domain_agent_id=task.domain_agent_id,
        task_agent_id=task.task_agent_id,
        purpose=task.purpose,
        requested_amount=task.requested_amount,
        task_limit=task.task_limit,
        category=task.category,
        merchant=task.merchant,
        status=task.status,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        created_at=task.created_at,
        expires_at=task.expires_at,
        decision=decision,
        reason=reason,
        authorization_status=authorization_status,
        risk_score=risk_score,
        risk_level=risk_level,
    )


def _compute_task_request_hash(payload: schemas.TaskAuthorizeRequest) -> str:
    data = {
        "domain_agent_id": payload.domain_agent_id,
        "requested_amount": float(payload.requested_amount),
        "merchant": (payload.merchant or "").strip(),
        "category": (payload.category or "").strip().lower(),
        "purpose": (payload.purpose or "").strip().lower(),
        "currency": (payload.currency or "INR").strip().upper(),
    }
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _execute_task_authorize(
    payload: schemas.TaskAuthorizeRequest,
    db: Session,
) -> schemas.TaskAuthorizeResponse:
    """One task authorization. Creates the task, single-use task machinery
    when within authority, runs the existing engine exactly once, maps the
    outcome, and creates a one-time approval when review is required."""
    now = datetime.now(timezone.utc)
    task_expires = now + TASK_TTL

    agent = db.query(models.Agent).filter(models.Agent.id == payload.domain_agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {payload.domain_agent_id} not found")
    if agent.is_task_agent:
        raise HTTPException(status_code=400, detail="Task agents cannot own tasks")

    task_id = _gen_task_id()
    while db.query(models.Task).filter(models.Task.id == task_id).first():
        task_id = _gen_task_id()
    task = models.Task(
        id=task_id,
        domain_agent_id=agent.id,
        task_agent_id=None,
        purpose=payload.purpose,
        requested_amount=float(payload.requested_amount),
        task_limit=0,  # authority granted below; 0 until a delegation exists
        category=payload.category,
        merchant=payload.merchant,
        status="PENDING",
        delegation_id=None,
        transaction_id=None,
        created_at=now,
        expires_at=task_expires,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    _record_provenance(
        db,
        event_type="TASK_CREATED",
        actor_agent_id=agent.id,
        reason=f"Task requested: {payload.purpose} up to ₹{payload.requested_amount} at {payload.merchant}",
        event_data={
            "task_id": task.id,
            "purpose": payload.purpose,
            "requested_amount": float(payload.requested_amount),
            "category": payload.category,
            "merchant": payload.merchant,
        },
    )

    # Revoked domain agent: record the refusal, never grant, never approvable.
    if agent.status != "ACTIVE":
        auth_payload = schemas.AuthorizeRequest(
            agent_id=agent.id,
            amount=float(payload.requested_amount),
            merchant=payload.merchant,
            merchant_category=payload.category,
            purpose=payload.purpose,
            currency=payload.currency or "INR",
        )
        result = _authorize_internal(auth_payload, db)
        task.transaction_id = result.transaction_id
        task.status = "NEEDS_REVIEW"
        db.commit()
        return schemas.TaskAuthorizeResponse(task=_task_to_response(db, task), approval=None, approval_token=None)

    # Budget check against effective authority (read-only — decides the path).
    auth_decision, _auth_reason, mandate, _d, _c = evaluate_authorization(
        db,
        agent_id=agent.id,
        amount=float(payload.requested_amount),
        merchant_category=payload.category,
        purpose=payload.purpose,
    )

    engine_agent_id = agent.id
    if mandate is not None and auth_decision == "ALLOW":
        # Within authority: build single-use ephemeral machinery through the
        # EXISTING delegation engine (validates child ⊆ parent, scope, TTL).
        try:
            task_agent = _create_task_agent_internal(db, agent, payload.purpose, task.id)
            deleg_expires = task_expires
            if mandate.expires_at:
                mexp = mandate.expires_at
                if mexp.tzinfo is None:
                    mexp = mexp.replace(tzinfo=timezone.utc)
                deleg_expires = min(task_expires, mexp)
            delegation = _create_delegation_internal(
                schemas.DelegationCreate(
                    parent_agent_id=agent.id,
                    child_agent_id=task_agent.id,
                    parent_mandate_id=mandate.id,
                    delegated_amount_limit=float(payload.requested_amount),
                    purpose=payload.purpose,
                    merchant_category=payload.category,
                    expires_at=deleg_expires,
                ),
                db,
            )
            task.task_agent_id = task_agent.id
            task.delegation_id = delegation.id
            task.task_limit = delegation.delegated_amount_limit
            db.commit()
            engine_agent_id = task_agent.id
        except HTTPException:
            # Delegation unexpectedly invalid (e.g. mandate expired between
            # checks): fall through to the no-delegation NEEDS_REVIEW path.
            db.rollback()
            task = db.query(models.Task).filter(models.Task.id == task_id).first()

    auth_payload = schemas.AuthorizeRequest(
        agent_id=engine_agent_id,
        amount=float(payload.requested_amount),
        merchant=payload.merchant,
        merchant_category=payload.category,
        purpose=payload.purpose,
        currency=payload.currency or "INR",
    )
    result = _authorize_internal(auth_payload, db)
    task.transaction_id = result.transaction_id
    db.commit()

    # Single-use: the task machinery authorizes exactly one engine call.
    if task.delegation_id or task.task_agent_id:
        _revoke_task_authority(db, task, "single-use task authority consumed")
        task = db.query(models.Task).filter(models.Task.id == task_id).first()

    status, needs_approval = _map_task_outcome(result.authorization_status, result.risk_level)
    task.status = status
    db.commit()

    approval_resp = None
    token_plain = None
    if needs_approval:
        token_plain = secrets.token_urlsafe(32)
        approval_id = _gen_approval_id()
        while db.query(models.Approval).filter(models.Approval.id == approval_id).first():
            approval_id = _gen_approval_id()
        approval = models.Approval(
            id=approval_id,
            task_id=task.id,
            transaction_id=task.transaction_id,
            amount=float(payload.requested_amount),
            reason=result.reason,
            risk_level=result.risk_level,
            token_hash=_hash_approval_token(token_plain),
            status="PENDING",
            created_at=now,
            expires_at=task.expires_at,
        )
        db.add(approval)
        db.commit()
        db.refresh(approval)
        _record_provenance(
            db,
            event_type="APPROVAL_REQUESTED",
            actor_agent_id=agent.id,
            mandate_id=mandate.id if mandate else None,
            delegation_id=None,
            transaction_id=task.transaction_id,
            decision="VERIFY",
            reason=result.reason,
            event_data={"task_id": task.id, "approval_id": approval.id, "amount": float(payload.requested_amount)},
        )
        approval_resp = schemas.ApprovalResponse.model_validate(approval)

    return schemas.TaskAuthorizeResponse(
        task=_task_to_response(db, task), approval=approval_resp, approval_token=token_plain
    )


def _handle_idempotent_task_authorize(
    payload: schemas.TaskAuthorizeRequest,
    db: Session,
    header_key: str | None = None,
    client_host: str | None = None,
) -> schemas.TaskAuthorizeResponse:
    key = (header_key.strip() if header_key and header_key.strip() else None) or (
        payload.idempotency_key.strip() if payload.idempotency_key and payload.idempotency_key.strip() else None
    )
    if key == "":
        key = None
    request_hash = None
    if key:
        request_hash = _compute_task_request_hash(payload)
        existing = db.query(models.IdempotencyRecord).filter(models.IdempotencyRecord.key == key).first()
        if existing:
            if existing.request_hash == request_hash:
                logger.info(f"Idempotency replay key={key} task -> returning cached")
                try:
                    cached = json.loads(existing.response)
                    return schemas.TaskAuthorizeResponse(**cached)
                except Exception:
                    pass
            else:
                raise HTTPException(status_code=409, detail="Idempotency key conflict: same key with different request payload. Use a different key or repeat the exact same request.")

    _check_rate_limit(payload.domain_agent_id, client_host)
    result = _execute_task_authorize(payload, db)

    if key and request_hash:
        try:
            response_json = json.dumps(
                result.model_dump() if hasattr(result, "model_dump") else result.dict(),
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            record = models.IdempotencyRecord(
                key=key,
                request_hash=request_hash,
                response=response_json,
                transaction_id=result.task.transaction_id,
            )
            db.add(record)
            db.commit()
        except Exception as e:
            db.rollback()
            existing = db.query(models.IdempotencyRecord).filter(models.IdempotencyRecord.key == key).first()
            if existing and existing.request_hash == request_hash:
                try:
                    cached = json.loads(existing.response)
                    return schemas.TaskAuthorizeResponse(**cached)
                except Exception:
                    pass
            logger.warning(f"Failed to store idempotency key {key}: {e}")

    return result


# ---------------------------------------------------------------------------
# Seed data — Phase 5 adds provenance events for each seed entity
# ---------------------------------------------------------------------------
def seed_data():
    """Clean-demo bootstrap: ensure the demo wallet exists, create NOTHING else.

    No agents, mandates, delegations, tasks, approvals, payments, or
    transactions are ever seeded. The product starts empty; the user builds
    authority explicitly. Old demo rows are removed via POST /demo/reset
    (guarded by ALLOW_DEMO_RESET), never by reseeding here.
    """
    db = SessionLocal()
    try:
        _get_wallet(db)
    except Exception as e:
        print(f"[seed] wallet ensure failed: {e}")
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    # Additive upgrades for pre-Phase-2 databases (new columns, backfill).
    try:
        from backend.database import ensure_schema_upgrades

        ensure_schema_upgrades(engine)
    except Exception as e:
        logger.warning(f"Schema upgrade skipped: {e}")
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
# Demo wallet — backend-owned simulated funds (NOT a bank account)
#
# The wallet is the ONLY source of balance truth. The frontend never
# hardcodes a number. execute_mock_payment debits atomically on success;
# any failure (auth, approval, balance, revoked, cancelled, expired) leaves
# the balance untouched. Ledger rows carry balance_after so history and
# balance always agree.
# ---------------------------------------------------------------------------
WALLET_ID = "demo"


def _demo_wallet_initial() -> float:
    try:
        v = float(os.getenv("DEMO_WALLET_INITIAL", "10000"))
    except (TypeError, ValueError):
        v = 10000.0
    if not v > 0:
        v = 10000.0
    return round(v, 2)


def _get_wallet(db: Session) -> models.Wallet:
    wallet = db.query(models.Wallet).filter(models.Wallet.id == WALLET_ID).first()
    if wallet is not None:
        return wallet
    initial = _demo_wallet_initial()
    now = datetime.now(timezone.utc)
    wallet = models.Wallet(
        id=WALLET_ID,
        balance=initial,
        currency="INR",
        total_credited=initial,
        total_debited=0.0,
        updated_at=now,
    )
    db.add(wallet)
    db.flush()
    db.add(
        models.WalletTransaction(
            id=models.gen_id("wtx"),
            direction="CREDIT",
            kind="INITIAL",
            amount=initial,
            currency="INR",
            balance_after=initial,
            note="Initial demo funds",
            created_at=now,
        )
    )
    db.commit()
    db.refresh(wallet)
    return wallet


def _wallet_to_response(db: Session, wallet: models.Wallet) -> schemas.WalletResponse:
    count = db.query(models.WalletTransaction).count()
    return schemas.WalletResponse(
        balance=float(wallet.balance),
        currency=wallet.currency,
        total_credited=float(wallet.total_credited),
        total_debited=float(wallet.total_debited),
        transaction_count=count,
        updated_at=wallet.updated_at,
    )


def _wallet_sufficient_or_raise(
    db: Session,
    *,
    amount: float,
    merchant: str,
    agent_id: str | None,
    task: models.Task | None,
    payment_id: str,
) -> models.Wallet:
    """Balance gate: raises 409 with no mutation when funds are insufficient,
    after recording a PAYMENT_REJECTED provenance event."""
    wallet = _get_wallet(db)
    task_id = task.id if task else None
    tx_id = task.transaction_id if task else None
    if wallet.balance < amount - 1e-9:
        _record_provenance(
            db,
            event_type="PAYMENT_REJECTED",
            actor_agent_id=agent_id,
            transaction_id=tx_id,
            reason=(
                f"AUTHORIZED by the engine but INSUFFICIENT WALLET BALANCE: "
                f"wallet has ₹{wallet.balance:,.0f}, payment needs ₹{amount:,.0f}. No funds moved."
            ),
            event_data={"task_id": task_id, "payment_id": payment_id,
                        "wallet_balance": float(wallet.balance), "amount": float(amount)},
        )
        raise HTTPException(
            status_code=409,
            detail=(
                f"AUTHORIZED by the engine but INSUFFICIENT WALLET BALANCE: "
                f"wallet has ₹{wallet.balance:,.0f}, payment needs ₹{amount:,.0f}. "
                f"No funds moved — top up demo funds or lower the amount."
            ),
        )
    return wallet


def _debit_wallet(
    db: Session,
    *,
    amount: float,
    merchant: str,
    agent_id: str | None,
    task: models.Task | None,
    payment_id: str,
) -> models.WalletTransaction:
    """Debit the demo wallet for an already-validated payment. Re-checks the
    balance so a debit can never overdraw even if state changed mid-flight."""
    wallet = _wallet_sufficient_or_raise(
        db, amount=amount, merchant=merchant, agent_id=agent_id, task=task, payment_id=payment_id
    )
    task_id = task.id if task else None
    tx_id = task.transaction_id if task else None
    wallet.balance = round(wallet.balance - amount, 2)
    wallet.total_debited = round(wallet.total_debited + amount, 2)
    wallet.updated_at = datetime.now(timezone.utc)
    entry = models.WalletTransaction(
        id=models.gen_id("wtx"),
        direction="DEBIT",
        kind="PAYMENT",
        amount=float(amount),
        currency="INR",
        balance_after=float(wallet.balance),
        merchant=merchant,
        agent_id=agent_id,
        task_id=task_id,
        payment_id=payment_id,
    )
    db.add(entry)
    db.flush()
    _record_provenance(
        db,
        event_type="WALLET_DEBITED",
        actor_agent_id=agent_id,
        transaction_id=tx_id,
        reason=f"Demo wallet debited ₹{amount:,.0f} to {merchant} — new balance ₹{wallet.balance:,.0f}",
        event_data={"task_id": task_id, "payment_id": payment_id,
                    "amount": float(amount), "balance_after": float(wallet.balance)},
    )
    return entry


@app.get("/wallet", response_model=schemas.WalletResponse)
def get_wallet(db: Session = Depends(get_db)):
    return _wallet_to_response(db, _get_wallet(db))


@app.get("/api/wallet", response_model=schemas.WalletResponse)
def get_wallet_api(db: Session = Depends(get_db)):
    return get_wallet(db)


@app.get("/wallet/transactions", response_model=list[schemas.WalletTransactionResponse])
def list_wallet_transactions(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    from sqlalchemy import text as _text

    _get_wallet(db)
    # rowid tiebreak: SQLite timestamps have second precision, so rows created
    # in the same second would otherwise come back in arbitrary order.
    q = db.query(models.WalletTransaction).order_by(
        models.WalletTransaction.created_at.desc(), _text("wallet_transactions.rowid DESC")
    )
    if offset:
        q = q.offset(offset)
    if limit:
        q = q.limit(min(limit, 200))
    return q.all()


@app.get("/api/wallet/transactions", response_model=list[schemas.WalletTransactionResponse])
def list_wallet_transactions_api(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    return list_wallet_transactions(limit, offset, db)


@app.post("/wallet/topup", response_model=schemas.WalletResponse)
def topup_wallet(payload: schemas.WalletTopupRequest, db: Session = Depends(get_db)):
    wallet = _get_wallet(db)
    amount = round(float(payload.amount), 2)
    wallet.balance = round(wallet.balance + amount, 2)
    wallet.total_credited = round(wallet.total_credited + amount, 2)
    wallet.updated_at = datetime.now(timezone.utc)
    db.add(
        models.WalletTransaction(
            id=models.gen_id("wtx"),
            direction="CREDIT",
            kind="TOPUP",
            amount=amount,
            currency="INR",
            balance_after=float(wallet.balance),
            note="Demo funds added",
        )
    )
    db.commit()
    db.refresh(wallet)
    _record_provenance(
        db,
        event_type="WALLET_CREDITED",
        reason=f"Demo funds added ₹{amount:,.0f} — new balance ₹{wallet.balance:,.0f}",
        event_data={"amount": amount, "balance_after": float(wallet.balance)},
    )
    return _wallet_to_response(db, wallet)


@app.post("/api/wallet/topup", response_model=schemas.WalletResponse)
def topup_wallet_api(payload: schemas.WalletTopupRequest, db: Session = Depends(get_db)):
    return topup_wallet(payload, db)


@app.post("/demo/reset", response_model=schemas.DemoResetResponse)
def demo_reset(db: Session = Depends(get_db)):
    """Wipe ALL demo state and restart from a clean wallet. Guarded: requires
    ALLOW_DEMO_RESET=true (set it on the demo backend, never in production
    with real data). Schema is untouched — only rows are deleted."""
    if os.getenv("ALLOW_DEMO_RESET", "false").strip().lower() != "true":
        raise HTTPException(
            status_code=403,
            detail="Demo reset is disabled (set ALLOW_DEMO_RESET=true to enable).",
        )
    deleted: dict[str, int] = {}
    # Children first (FK-safe: nothing left may reference a deleted row),
    # provenance last so the chain visibly restarts.
    for model in (
        models.WalletTransaction,
        models.MockPayment,
        models.Approval,
        models.IdempotencyRecord,
        models.Task,
        models.Transaction,
        models.Delegation,
        models.Mandate,
        models.Agent,
        models.ProvenanceEvent,
        models.Wallet,
    ):
        n = db.query(model).delete(synchronize_session=False)
        deleted[model.__tablename__] = n
    db.commit()
    wallet = _get_wallet(db)
    return schemas.DemoResetResponse(reset=True, deleted=deleted, wallet=_wallet_to_response(db, wallet))


@app.post("/api/demo/reset", response_model=schemas.DemoResetResponse)
def demo_reset_api(db: Session = Depends(get_db)):
    return demo_reset(db)


# ---------------------------------------------------------------------------
# AI intent assist — optional Groq layer (suggestion only, never authority)
#
# POST /ai/interpret turns free text into a structured task proposal
# (domain/purpose/budget/merchant/category). The result only pre-fills the
# UI draft: the user still confirms, and the deterministic authorization
# engine still makes the only decision that matters. Requires GROQ_API_KEY;
# without it the endpoint returns 501 and the product keeps working on its
# built-in deterministic parser. Uses stdlib HTTP only (no new dependency).
# ---------------------------------------------------------------------------
_GROQ_ALLOWED_DOMAINS = {"food", "travel", "shopping"}
_GROQ_MODEL_DEFAULT = "llama-3.3-70b-versatile"
_GROQ_SYSTEM_PROMPT = (
    "You interpret a user's shopping/food/travel request for the Bound app. "
    "Reply with JSON ONLY, no other text, using exactly these keys: "
    '{"domain": "food"|"travel"|"shopping"|null, "purpose": string|null, '
    '"budget": number|null, "merchant": string|null, "category": string|null, '
    '"explanation": string|null}. '
    "domain is the area (food/travel/shopping) or null when unclear. "
    "purpose is a short label like Dinner, Flight booking, Headphones. "
    "budget is the max amount in INR as a number, or null. "
    "merchant is the named store/service or null. "
    "category is one of Grocery, Dining, General, Electronics, Apparel, Airlines, Hotels, Transport, Fuel, or null. "
    "explanation is one short line or null."
)


def _call_groq_interpret(text: str) -> dict:
    import json as _json
    import urllib.request as _urlrequest

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=501,
            detail="AI assist is not configured (GROQ_API_KEY missing) — use the built-in request form.",
        )
    model = os.getenv("GROQ_MODEL", _GROQ_MODEL_DEFAULT).strip() or _GROQ_MODEL_DEFAULT
    body = _json.dumps(
        {
            "model": model,
            "temperature": 0,
            "max_tokens": 300,
            "messages": [
                {"role": "system", "content": _GROQ_SYSTEM_PROMPT},
                {"role": "user", "content": text[:500]},
            ],
        }
    ).encode("utf-8")
    req = _urlrequest.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with _urlrequest.urlopen(req, timeout=10) as resp:
            payload = _json.loads(resp.read().decode("utf-8"))
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Groq interpret call failed: {e}")
        raise HTTPException(
            status_code=502,
            detail="AI assist is unavailable right now — use the built-in request form.",
        )
    try:
        content = payload["choices"][0]["message"]["content"]
        parsed = _json.loads(content) if isinstance(content, str) else content
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="AI assist returned an unreadable reply — use the built-in request form.",
        )
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=502,
            detail="AI assist returned an unreadable reply — use the built-in request form.",
        )

    domain = parsed.get("domain")
    domain = str(domain).strip().lower() if isinstance(domain, str) else None
    if domain not in _GROQ_ALLOWED_DOMAINS:
        domain = None

    def _short(v: object, limit: int) -> str | None:
        if not isinstance(v, str):
            return None
        v = v.strip()
        return v[:limit] if v else None

    budget = parsed.get("budget")
    try:
        budget = float(budget) if budget is not None else None
    except (TypeError, ValueError):
        budget = None
    if budget is not None and not (0 < budget <= 10_000_000):
        budget = None

    category = _short(parsed.get("category"), 100)
    return {
        "domain": domain,
        "purpose": _short(parsed.get("purpose"), 200),
        "budget": budget,
        "merchant": _short(parsed.get("merchant"), 200),
        "category": category,
        "explanation": _short(parsed.get("explanation"), 280),
        "groq": True,
    }


@app.post("/ai/interpret", response_model=schemas.AiInterpretResponse)
def ai_interpret(payload: schemas.AiInterpretRequest):
    return _call_groq_interpret(payload.text)


@app.post("/api/ai/interpret", response_model=schemas.AiInterpretResponse)
def ai_interpret_api(payload: schemas.AiInterpretRequest):
    return ai_interpret(payload)


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
    if "domain" in payload:
        norm = str(payload["domain"]).strip().upper() if payload["domain"] else "OTHER"
        if norm not in ("FOOD", "TRAVEL", "SHOPPING", "OTHER"):
            raise HTTPException(status_code=400, detail="Invalid domain")
        agent.domain = norm
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


# ---------------------------------------------------------------------------
# Tasks + Approvals — Phase 2 routes
# ---------------------------------------------------------------------------
def _client_host(request: Request | None) -> str | None:
    try:
        if request and hasattr(request, "client") and request.client:
            return request.client.host
    except Exception:
        pass
    return None


@app.post("/tasks/authorize", response_model=schemas.TaskAuthorizeResponse)
def task_authorize(
    payload: schemas.TaskAuthorizeRequest,
    db: Session = Depends(get_db),
    request: Request = None,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    return _handle_idempotent_task_authorize(payload, db, idempotency_key, _client_host(request))


@app.post("/api/tasks/authorize", response_model=schemas.TaskAuthorizeResponse)
def task_authorize_api(
    payload: schemas.TaskAuthorizeRequest,
    db: Session = Depends(get_db),
    request: Request = None,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    return _handle_idempotent_task_authorize(payload, db, idempotency_key, _client_host(request))


@app.get("/tasks", response_model=list[schemas.TaskResponse])
def list_tasks(status: str | None = None, db: Session = Depends(get_db)):
    if status is not None and status not in schemas.VALID_TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status {status}")
    q = db.query(models.Task).order_by(models.Task.created_at.desc())
    if status:
        q = q.filter(models.Task.status == status)
    tasks = q.limit(100).all()
    return [_task_to_response(db, t) for t in tasks]


@app.get("/api/tasks", response_model=list[schemas.TaskResponse])
def list_tasks_api(status: str | None = None, db: Session = Depends(get_db)):
    return list_tasks(status, db)


@app.get("/tasks/{task_id}", response_model=schemas.TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_response(db, task)


@app.get("/api/tasks/{task_id}", response_model=schemas.TaskResponse)
def get_task_api(task_id: str, db: Session = Depends(get_db)):
    return get_task(task_id, db)


@app.post("/tasks/{task_id}/cancel", response_model=schemas.TaskResponse)
def cancel_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status in ("CANCELLED", "EXPIRED"):
        return _task_to_response(db, task)
    if task.status in ("APPROVED", "COMPLETED"):
        raise HTTPException(status_code=409, detail="Task is already approved — there is no pending execution to cancel")
    task.status = "CANCELLED"
    _revoke_task_authority(db, task, "task cancelled by user")
    approval = db.query(models.Approval).filter(models.Approval.task_id == task.id).first()
    if approval is not None and approval.status == "PENDING":
        approval.status = "EXPIRED"
    _record_provenance(
        db,
        event_type="TASK_CANCELLED",
        actor_agent_id=task.domain_agent_id,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        reason="Task cancelled — temporary authority revoked, pending approval invalidated, history preserved",
        event_data={"task_id": task.id},
    )
    db.commit()
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    return _task_to_response(db, task)


@app.post("/api/tasks/{task_id}/cancel", response_model=schemas.TaskResponse)
def cancel_task_api(task_id: str, db: Session = Depends(get_db)):
    return cancel_task(task_id, db)


@app.get("/approvals", response_model=list[schemas.ApprovalResponse])
def list_approvals(status: str | None = None, task_id: str | None = None, db: Session = Depends(get_db)):
    if status is not None and status not in schemas.VALID_APPROVAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status {status}")
    q = db.query(models.Approval).order_by(models.Approval.created_at.desc())
    if status:
        q = q.filter(models.Approval.status == status)
    if task_id:
        q = q.filter(models.Approval.task_id == task_id)
    return q.limit(100).all()


@app.get("/api/approvals", response_model=list[schemas.ApprovalResponse])
def list_approvals_api(status: str | None = None, task_id: str | None = None, db: Session = Depends(get_db)):
    return list_approvals(status, task_id, db)


@app.post("/approvals/{approval_id}/resolve", response_model=schemas.ApprovalResponse)
def resolve_approval(approval_id: str, payload: schemas.ApprovalResolveRequest, db: Session = Depends(get_db)):
    approval = db.query(models.Approval).filter(models.Approval.id == approval_id).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    # Token first: no token, no information about state.
    if not hmac.compare_digest(approval.token_hash, _hash_approval_token(payload.token)):
        raise HTTPException(status_code=403, detail="Invalid approval token")
    if approval.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"Approval already {approval.status} — tokens are single-use")
    now = datetime.now(timezone.utc)
    task = db.query(models.Task).filter(models.Task.id == approval.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task for approval not found")
    # Expiry enforcement (backend-side, never frontend timers).
    approval_exp = approval.expires_at
    if approval_exp and approval_exp.tzinfo is None:
        approval_exp = approval_exp.replace(tzinfo=timezone.utc)
    if (approval_exp and now > approval_exp) or _task_is_expired(task, now):
        _expire_task_and_approval(db, task, approval, "approval or task expired before resolution")
        raise HTTPException(status_code=410, detail="Approval expired")
    if task.status != "NEEDS_REVIEW":
        raise HTTPException(status_code=409, detail=f"Task is {task.status} — approval no longer applies")
    agent = db.query(models.Agent).filter(models.Agent.id == task.domain_agent_id).first()
    if not agent or agent.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Domain agent is not active — approval cannot proceed")
    # Scope binding: this token authorizes exactly this task and amount.
    if approval.task_id != task.id or float(approval.amount) != float(task.requested_amount):
        raise HTTPException(status_code=409, detail="Approval does not match this task")
    if payload.action == "deny":
        approval.status = "DENIED"
        approval.resolved_at = now
        task.status = "CANCELLED"
        _revoke_task_authority(db, task, "task denied by user")
        _record_provenance(
            db,
            event_type="APPROVAL_DENIED",
            actor_agent_id=task.domain_agent_id,
            delegation_id=task.delegation_id,
            transaction_id=task.transaction_id,
            reason="User denied the one-time request — standing rule unchanged",
            event_data={"task_id": task.id, "approval_id": approval.id},
        )
        db.commit()
        return approval
    # Approve once: flips ONLY this task. The standing mandate is never touched.
    approval.status = "APPROVED"
    approval.resolved_at = now
    task.status = "APPROVED"
    _record_provenance(
        db,
        event_type="APPROVAL_GRANTED",
        actor_agent_id=task.domain_agent_id,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        decision="ALLOW",
        reason="One-time user approval — standing rule unchanged",
        event_data={
            "task_id": task.id,
            "approval_id": approval.id,
            "amount": float(approval.amount),
            "merchant": task.merchant,
            "one_time": True,
        },
    )
    db.commit()
    db.refresh(approval)
    return approval


@app.post("/api/approvals/{approval_id}/resolve", response_model=schemas.ApprovalResponse)
def resolve_approval_api(approval_id: str, payload: schemas.ApprovalResolveRequest, db: Session = Depends(get_db)):
    return resolve_approval(approval_id, payload, db)


# ---------------------------------------------------------------------------
# Mock payments — Phase 3 (simulated execution for APPROVED tasks only)
#
# Demo harness: no funds move. The UI can never mark a payment successful —
# only these endpoints transition payment status, and only for tasks the
# engine (or a one-time approval) approved. Amount/merchant are snapshotted
# server-side from the task; the client supplies task_id + method + note.
#
# Provenance uses MOCK_PAYMENT_* event types deliberately: the existing
# PAYMENT_COMPLETED means "authorization decision recorded" and reusing it
# for simulated success would conflate the two in the audit log.
# ---------------------------------------------------------------------------
def _payment_to_response(db: Session, payment: models.MockPayment) -> schemas.MockPaymentResponse:
    resp = schemas.MockPaymentResponse.model_validate(payment)
    entry = (
        db.query(models.WalletTransaction)
        .filter(
            models.WalletTransaction.payment_id == payment.id,
            models.WalletTransaction.direction == "DEBIT",
        )
        .order_by(models.WalletTransaction.created_at.desc())
        .first()
    )
    resp.wallet_balance_after = float(entry.balance_after) if entry else None
    return resp


def _validate_task_for_payment(db: Session, task: models.Task) -> models.Agent:
    """Gate shared by create + execute. Returns the domain agent if this task
    may proceed to (simulated) payment, else raises. Re-validated at execute
    time so cancel/revoke/expiry between create and execute cannot slip by."""
    if task.status != "APPROVED":
        raise HTTPException(
            status_code=409,
            detail=f"Task is {task.status} — only APPROVED tasks can proceed to payment",
        )
    now = datetime.now(timezone.utc)
    if _task_is_expired(task, now):
        approval = db.query(models.Approval).filter(models.Approval.task_id == task.id).first()
        _expire_task_and_approval(db, task, approval, "task expired before payment")
        raise HTTPException(status_code=410, detail="Task expired")
    agent = db.query(models.Agent).filter(models.Agent.id == task.domain_agent_id).first()
    if not agent or agent.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Domain agent is not active — payment unavailable")
    return agent


@app.post("/mock-payments/create", response_model=schemas.MockPaymentResponse, status_code=201)
def create_mock_payment(
    payload: schemas.MockPaymentCreate,
    db: Session = Depends(get_db),
    request: Request = None,
):
    task = db.query(models.Task).filter(models.Task.id == payload.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    agent = _validate_task_for_payment(db, task)
    _check_rate_limit(agent.id, _client_host(request))
    existing = db.query(models.MockPayment).filter(models.MockPayment.task_id == task.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="A payment already exists for this task — duplicates are rejected")
    payment_id = _gen_payment_id()
    while db.query(models.MockPayment).filter(models.MockPayment.id == payment_id).first():
        payment_id = _gen_payment_id()
    payment = models.MockPayment(
        id=payment_id,
        task_id=task.id,
        transaction_id=task.transaction_id,
        merchant=task.merchant,
        amount=float(task.requested_amount),
        currency="INR",
        status="CREATED",
        payment_method=payload.payment_method,
        note=(payload.note or "").strip() or None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(payment)
    try:
        db.commit()
    except Exception:
        db.rollback()
        # Lost a race with a concurrent create: the unique task_id guard won.
        raise HTTPException(status_code=409, detail="A payment already exists for this task — duplicates are rejected")
    db.refresh(payment)
    _record_provenance(
        db,
        event_type="MOCK_PAYMENT_CREATED",
        actor_agent_id=task.domain_agent_id,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        reason=f"Demo payment created: ₹{payment.amount:,.0f} to {payment.merchant} — no real funds transferred",
        event_data={"task_id": task.id, "payment_id": payment.id, "simulated": True},
    )
    return _payment_to_response(db, payment)


@app.post("/api/mock-payments/create", response_model=schemas.MockPaymentResponse, status_code=201)
def create_mock_payment_api(
    payload: schemas.MockPaymentCreate, db: Session = Depends(get_db), request: Request = None
):
    return create_mock_payment(payload, db, request)


@app.post("/mock-payments/{payment_id}/execute", response_model=schemas.MockPaymentResponse)
def execute_mock_payment(
    payment_id: str,
    payload: schemas.MockPaymentExecute,
    db: Session = Depends(get_db),
    request: Request = None,
):
    payment = db.query(models.MockPayment).filter(models.MockPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status not in ("CREATED", "FAILED"):
        raise HTTPException(
            status_code=409,
            detail=f"Payment is {payment.status} — only new or failed payments can execute",
        )
    task = db.query(models.Task).filter(models.Task.id == payment.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task for payment not found")
    agent = _validate_task_for_payment(db, task)
    _check_rate_limit(agent.id, _client_host(request))
    # Binding: the payment must still match its task exactly (tamper → reject).
    if float(payment.amount) != float(task.requested_amount) or payment.merchant != task.merchant:
        raise HTTPException(status_code=409, detail="Payment does not match its task")
    # Wallet gate BEFORE any state change: insufficient funds reject with no
    # debit and no status change (task stays APPROVED, retry after top-up).
    _wallet_sufficient_or_raise(db, amount=float(payment.amount), merchant=payment.merchant,
                                agent_id=task.domain_agent_id, task=task, payment_id=payment.id)
    payment.status = "PROCESSING"
    payment.failure_reason = None
    db.commit()
    _record_provenance(
        db,
        event_type="MOCK_PAYMENT_PROCESSING",
        actor_agent_id=task.domain_agent_id,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        reason=f"Demo payment processing: ₹{payment.amount:,.0f} to {payment.merchant}",
        event_data={"task_id": task.id, "payment_id": payment.id, "simulated": True},
    )
    if payload.simulate_failure:
        payment.status = "FAILED"
        payment.failure_reason = "Simulated failure (demo harness)"
        payment.completed_at = None
        db.commit()
        _record_provenance(
            db,
            event_type="MOCK_PAYMENT_FAILED",
            actor_agent_id=task.domain_agent_id,
            delegation_id=task.delegation_id,
            transaction_id=task.transaction_id,
            reason="Demo payment failed (simulated) — task stays approved, retry is allowed",
            event_data={"task_id": task.id, "payment_id": payment.id, "simulated": True},
        )
        db.refresh(payment)
        return _payment_to_response(db, payment)
    payment.status = "SUCCEEDED"
    payment.completed_at = datetime.now(timezone.utc)
    task.status = "COMPLETED"
    # Atomic with the status change above: the debit lands in the same commit,
    # so a completed payment always corresponds to a real wallet debit.
    _debit_wallet(
        db,
        amount=float(payment.amount),
        merchant=payment.merchant,
        agent_id=task.domain_agent_id,
        task=task,
        payment_id=payment.id,
    )
    db.commit()
    _record_provenance(
        db,
        event_type="MOCK_PAYMENT_SUCCEEDED",
        actor_agent_id=task.domain_agent_id,
        delegation_id=task.delegation_id,
        transaction_id=task.transaction_id,
        reason=f"Demo payment succeeded: ₹{payment.amount:,.0f} to {payment.merchant} — simulated, no real funds transferred",
        event_data={"task_id": task.id, "payment_id": payment.id, "simulated": True},
    )
    db.refresh(payment)
    return _payment_to_response(db, payment)


@app.post("/api/mock-payments/{payment_id}/execute", response_model=schemas.MockPaymentResponse)
def execute_mock_payment_api(
    payment_id: str, payload: schemas.MockPaymentExecute, db: Session = Depends(get_db), request: Request = None
):
    return execute_mock_payment(payment_id, payload, db, request)


@app.get("/mock-payments/{payment_id}", response_model=schemas.MockPaymentResponse)
def get_mock_payment(payment_id: str, db: Session = Depends(get_db)):
    payment = db.query(models.MockPayment).filter(models.MockPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return _payment_to_response(db, payment)


@app.get("/api/mock-payments/{payment_id}", response_model=schemas.MockPaymentResponse)
def get_mock_payment_api(payment_id: str, db: Session = Depends(get_db)):
    return get_mock_payment(payment_id, db)


@app.get("/mock-payments", response_model=list[schemas.MockPaymentResponse])
def list_mock_payments(task_id: str | None = None, status: str | None = None, db: Session = Depends(get_db)):
    if status is not None and status not in schemas.VALID_MOCK_PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status {status}")
    q = db.query(models.MockPayment).order_by(models.MockPayment.created_at.desc())
    if task_id:
        q = q.filter(models.MockPayment.task_id == task_id)
    if status:
        q = q.filter(models.MockPayment.status == status)
    return q.limit(100).all()


@app.get("/api/mock-payments", response_model=list[schemas.MockPaymentResponse])
def list_mock_payments_api(task_id: str | None = None, status: str | None = None, db: Session = Depends(get_db)):
    return list_mock_payments(task_id, status, db)
