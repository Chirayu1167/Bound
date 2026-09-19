"""
Delegation validation — Phase 4 with effective authority.

Implements creation checks using effective authority (walks full chain):
1. Parent exists and ACTIVE (via effective authority)
2. Child exists and ACTIVE
3. Parent has active valid mandate (effective)
4. Delegated amount <= parent's effective remaining/authorized amount
5. Delegated purpose/category within parent's effective authorized purpose
6. Delegation not expired
7. Child must not gain broader authority than parent (AUTHORITY(child) ⊆ AUTHORITY(parent))
"""
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from fastapi import HTTPException
from backend import models


def _normalize(s: str) -> str:
    return (s or "").strip().lower()


def _matches(allowed: str, requested: str) -> bool:
    if not allowed or not requested:
        return False
    allowed = _normalize(allowed)
    requested = _normalize(requested)
    if allowed == requested:
        return True
    if allowed in requested or requested in allowed:
        return True
    allowed_tokens = set(allowed.split())
    req_tokens = set(requested.split())
    if allowed_tokens & req_tokens:
        return True
    return False


def _is_within_parent_scope(parent_purpose: str, parent_category: str, child_purpose: str, child_category: str) -> bool:
    purpose_ok = _matches(parent_purpose, child_purpose) or _matches(parent_category, child_purpose) or _matches(parent_purpose, child_category)
    category_ok = _matches(parent_category, child_category) or _matches(parent_purpose, child_category) or _matches(parent_category, child_purpose)
    return purpose_ok and category_ok if (purpose_ok or category_ok) else False


def validate_delegation_creation(
    db: Session,
    parent_agent_id: str,
    child_agent_id: str,
    parent_mandate_id: str | None,
    delegated_amount_limit: float,
    purpose: str,
    merchant_category: str,
    expires_at: datetime | None,
):
    # 1 & 2: basic existence and ACTIVE (will also be checked via effective authority, but we do explicit)
    parent = db.query(models.Agent).filter(models.Agent.id == parent_agent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail=f"Parent agent {parent_agent_id} not found")
    if parent.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="Parent agent is not ACTIVE")

    child = db.query(models.Agent).filter(models.Agent.id == child_agent_id).first()
    if not child:
        raise HTTPException(status_code=404, detail=f"Child agent {child_agent_id} not found")
    if child.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="Child agent is not ACTIVE")

    if parent_agent_id == child_agent_id:
        raise HTTPException(status_code=400, detail="Parent and child cannot be the same agent")

    # 3: Parent effective authority must be valid
    from backend.services.effective_authority import validate_effective_authority

    parent_eff = validate_effective_authority(db, parent_agent_id)
    if not parent_eff["valid"]:
        raise HTTPException(status_code=400, detail=f"Parent effective authority invalid: {parent_eff['reason']}")

    # Effective root mandate and limits
    effective_mandate = parent_eff["root_mandate"]
    effective_limit = parent_eff["effective_limit"]
    effective_purpose = parent_eff["effective_purpose"]
    effective_category = parent_eff["effective_merchant_category"]

    if not effective_mandate:
        raise HTTPException(status_code=400, detail="Parent has no effective mandate")

    # If parent_mandate_id was explicitly provided, verify it matches effective root
    if parent_mandate_id:
        if parent_mandate_id != effective_mandate.id:
            raise HTTPException(
                status_code=400,
                detail=f"Parent mandate {parent_mandate_id} does not match parent's effective root mandate {effective_mandate.id}",
            )
    else:
        # Use effective root for delegation record
        parent_mandate_id = effective_mandate.id

    # Also double-check the explicit mandate if provided is still ACTIVE/not expired
    # (effective check already did, but we keep for clarity)
    mandate = db.query(models.Mandate).filter(models.Mandate.id == parent_mandate_id).first()
    if not mandate:
        raise HTTPException(status_code=404, detail=f"Parent mandate {parent_mandate_id} not found")
    if mandate.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="Parent mandate is not ACTIVE")
    if mandate.expires_at:
        now = datetime.now(timezone.utc)
        exp = mandate.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if now > exp:
            raise HTTPException(status_code=400, detail="Parent mandate has expired")

    # 4. Delegated amount <= parent's effective authorized amount
    if delegated_amount_limit > effective_limit:
        raise HTTPException(
            status_code=400,
            detail=f"Delegated limit ₹{delegated_amount_limit} exceeds parent effective limit ₹{effective_limit}. AUTHORITY(child) must be ⊆ AUTHORITY(parent).",
        )
    if delegated_amount_limit <= 0:
        raise HTTPException(status_code=400, detail="Delegated amount must be > 0")

    # 5 & 7. Purpose/category subset check against parent's effective scope
    if not _is_within_parent_scope(effective_purpose, effective_category, purpose, merchant_category):
        raise HTTPException(
            status_code=400,
            detail=f"Delegated purpose/category '{purpose}/{merchant_category}' is outside parent effective scope '{effective_purpose}/{effective_category}'.",
        )

    # 6. Delegation not expired
    if expires_at:
        now = datetime.now(timezone.utc)
        exp = expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if now >= exp:
            raise HTTPException(status_code=400, detail="Delegation expiry is in the past")
        # Child expiry must not exceed parent mandate expiry (if parent has expiry)
        if mandate.expires_at:
            parent_exp = mandate.expires_at
            if parent_exp.tzinfo is None:
                parent_exp = parent_exp.replace(tzinfo=timezone.utc)
            child_exp = exp
            if child_exp > parent_exp:
                raise HTTPException(
                    status_code=400,
                    detail=f"Delegation expiry {child_exp.isoformat()} exceeds parent mandate expiry {parent_exp.isoformat()} — child cannot outlive parent",
                )

    return mandate
