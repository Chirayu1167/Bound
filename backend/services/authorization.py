"""
Deterministic authorization engine — Phase 4 with revocation propagation.

Delegates effective authority validation to effective_authority service,
which walks the full delegation chain and ensures every upstream link is valid.

Supports both direct and multi-level delegated authority:
User → Root Mandate → Agent A → Delegation A→B → Agent B → Delegation B→C → Agent C
"""

from sqlalchemy.orm import Session
from backend.services.effective_authority import validate_effective_authority


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


def _purpose_within_scope(allowed_purpose: str, allowed_category: str, req_purpose: str, req_category: str) -> bool:
    # Hardened: both purpose and category must be within allowed scope (with cross-match fallback, but both required)
    # Prevents bypass where purpose matches but category is wrong (or vice versa)
    purpose_ok = _matches(allowed_purpose, req_purpose) or _matches(allowed_category, req_purpose)
    category_ok = _matches(allowed_category, req_category) or _matches(allowed_purpose, req_category)
    return purpose_ok and category_ok


def evaluate_authorization(
    db: Session,
    agent_id: str,
    amount: float,
    merchant_category: str,
    purpose: str,
):
    """
    Centralized effective-authority validation.

    Returns: (decision, reason, mandate, delegation, chain)
    - decision: "ALLOW" | "VERIFY"
    - mandate: root Mandate if applicable
    - delegation: leaf Delegation if delegated, else None
    - chain: full chain for API response
    """
    result = validate_effective_authority(db, agent_id)

    if not result["valid"]:
        # Upstream revoked/expired/missing — propagate reason
        # Preserve whatever chain information is available for debugging
        return (
            "VERIFY",
            result["reason"],
            result["root_mandate"],
            result["leaf_delegation"],
            result["full_chain"] if result["full_chain"] else None,
        )

    # Authority is structurally valid — now check amount and purpose against effective scope
    effective_limit = result["effective_limit"]
    effective_purpose = result["effective_purpose"]
    effective_category = result["effective_merchant_category"]
    root_mandate = result["root_mandate"]
    leaf_delegation = result["leaf_delegation"]
    chain = result["full_chain"]

    # Amount check
    if effective_limit is not None and amount > effective_limit:
        if leaf_delegation:
            reason = f"Amount exceeds delegated limit of ₹{effective_limit}."
        else:
            reason = "Amount exceeds authorized limit."
        return "VERIFY", reason, root_mandate, leaf_delegation, chain

    # Purpose/category check
    if not _purpose_within_scope(effective_purpose, effective_category, purpose, merchant_category):
        if leaf_delegation:
            reason = "Transaction is outside the delegated purpose."
        else:
            reason = "Transaction is outside the authorized purpose."
        return "VERIFY", reason, root_mandate, leaf_delegation, chain

    # All checks passed
    if leaf_delegation:
        reason = "Payment is within the delegated mandate."
    else:
        reason = "Payment is within the authorized mandate."

    return "ALLOW", reason, root_mandate, leaf_delegation, chain


# Backward compat for delegation service import
# Some modules import _purpose_within_scope from authorization
__all__ = ["evaluate_authorization", "_purpose_within_scope", "_matches", "_normalize"]
