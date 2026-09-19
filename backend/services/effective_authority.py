"""
Effective authority validation — Phase 4 revocation propagation.

Walks delegation chain and verifies every upstream link.

Chain example for 3 levels:
User → Root Mandate (mnd-4091) → Agent A (shopping-agent) → Delegation A→B → Agent B (payment-agent) → Delegation B→C → Agent C

Each step must be ACTIVE and not expired.
"""

from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend import models


def _is_expired(expires_at) -> bool:
    if not expires_at:
        return False
    now = datetime.now(timezone.utc)
    exp = expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return now > exp


def validate_effective_authority(db: Session, agent_id: str, visited=None, depth=0):
    """
    Recursively validates the effective authority for an agent.

    Returns dict:
      valid: bool
      reason: str (if invalid)
      root_mandate: Mandate | None
      leaf_delegation: Delegation | None (the delegation that directly authorizes this agent, if delegated)
      delegation_chain: list[Delegation] ordered from root to leaf
      agent_chain: list[Agent] ordered from root agent to leaf
      full_chain: list[dict] for API response (User → Root → ... → Agent)
      effective_limit: float (for delegated: leaf delegation limit, for direct: mandate max)
      effective_purpose: str
      effective_merchant_category: str
    """
    if visited is None:
        visited = set()
    if depth > 10:
        return {
            "valid": False,
            "reason": "Delegation chain too deep (possible cycle)",
            "root_mandate": None,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [],
            "full_chain": [],
            "effective_limit": None,
            "effective_purpose": None,
            "effective_merchant_category": None,
        }
    if agent_id in visited:
        return {
            "valid": False,
            "reason": "Circular delegation detected",
            "root_mandate": None,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [],
            "full_chain": [],
            "effective_limit": None,
            "effective_purpose": None,
            "effective_merchant_category": None,
        }
    visited.add(agent_id)

    agent = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if not agent:
        return {
            "valid": False,
            "reason": "Agent not found.",
            "root_mandate": None,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [],
            "full_chain": [],
            "effective_limit": None,
            "effective_purpose": None,
            "effective_merchant_category": None,
        }
    if agent.status != "ACTIVE":
        return {
            "valid": False,
            "reason": "Agent authority has been revoked.",
            "root_mandate": None,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [agent],
            "full_chain": [{"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"}, {"step": "Agent", "id": agent.id, "name": agent.name, "detail": "REVOKED"}],
            "effective_limit": None,
            "effective_purpose": None,
            "effective_merchant_category": None,
        }

    # Look for most recent delegation where this agent is child (regardless of status)
    delegation = (
        db.query(models.Delegation)
        .filter(models.Delegation.child_agent_id == agent_id)
        .order_by(models.Delegation.created_at.desc())
        .first()
    )

    if delegation:
        # If delegation exists, it's the sole authority for this child (no fallback to direct mandate)
        # Check its status
        if delegation.status == "REVOKED":
            return {
                "valid": False,
                "reason": "Delegation has been revoked.",
                "root_mandate": None,
                "leaf_delegation": delegation,
                "delegation_chain": [delegation],
                "agent_chain": [agent],
                "full_chain": [
                    {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
                    {"step": "Delegation", "id": delegation.id, "name": f"{delegation.purpose} ₹{delegation.delegated_amount_limit}", "detail": "REVOKED"},
                    {"step": "Agent", "id": agent.id, "name": agent.name, "detail": "Delegated child"},
                ],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }
        if delegation.status == "EXPIRED" or _is_expired(delegation.expires_at):
            return {
                "valid": False,
                "reason": "Delegation has expired.",
                "root_mandate": None,
                "leaf_delegation": delegation,
                "delegation_chain": [delegation],
                "agent_chain": [agent],
                "full_chain": [
                    {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
                    {"step": "Delegation", "id": delegation.id, "name": f"{delegation.purpose} ₹{delegation.delegated_amount_limit}", "detail": "EXPIRED"},
                    {"step": "Agent", "id": agent.id, "name": agent.name, "detail": "Delegated child"},
                ],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }
        if delegation.status != "ACTIVE":
            return {
                "valid": False,
                "reason": f"Delegation is {delegation.status}.",
                "root_mandate": None,
                "leaf_delegation": delegation,
                "delegation_chain": [delegation],
                "agent_chain": [agent],
                "full_chain": [],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }

        # Delegation is ACTIVE and not expired — must validate parent's effective authority
        # First, check that parent mandate still exists and is ACTIVE/not expired
        root_mandate = db.query(models.Mandate).filter(models.Mandate.id == delegation.parent_mandate_id).first()
        if not root_mandate:
            return {
                "valid": False,
                "reason": "Root mandate for delegation not found.",
                "root_mandate": None,
                "leaf_delegation": delegation,
                "delegation_chain": [delegation],
                "agent_chain": [agent],
                "full_chain": [{"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"}, {"step": "Delegation", "id": delegation.id, "name": delegation.purpose, "detail": "Parent mandate missing"}],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }
        if root_mandate.status != "ACTIVE":
            # Distinguish revoked vs expired
            if root_mandate.status == "REVOKED":
                reason = "Root mandate has been revoked."
            elif root_mandate.status == "EXPIRED" or _is_expired(root_mandate.expires_at):
                reason = "Root mandate has expired."
            else:
                reason = f"Root mandate is {root_mandate.status}."
            return {
                "valid": False,
                "reason": reason,
                "root_mandate": root_mandate,
                "leaf_delegation": delegation,
                "delegation_chain": [delegation],
                "agent_chain": [agent],
                "full_chain": [
                    {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
                    {"step": "Root Mandate", "id": root_mandate.id, "name": root_mandate.purpose, "detail": f"{root_mandate.status}"},
                    {"step": "Delegation", "id": delegation.id, "name": delegation.purpose, "detail": delegation.status},
                ],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }
        if _is_expired(root_mandate.expires_at):
            return {
                "valid": False,
                "reason": "Root mandate has expired.",
                "root_mandate": root_mandate,
                "leaf_delegation": delegation,
                "delegation_chain": [delegation],
                "agent_chain": [agent],
                "full_chain": [],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }

        # Recursively validate parent agent's effective authority
        parent_result = validate_effective_authority(db, delegation.parent_agent_id, visited.copy(), depth + 1)
        if not parent_result["valid"]:
            # Upstream invalid — propagate with context
            upstream_reason = parent_result["reason"]
            # Map to more specific upstream messages
            if "revoked" in upstream_reason.lower():
                if "agent" in upstream_reason.lower():
                    reason = f"Upstream agent authority has been revoked ({delegation.parent_agent_id})."
                elif "mandate" in upstream_reason.lower():
                    reason = f"Upstream mandate has been revoked ({delegation.parent_mandate_id})."
                elif "delegation" in upstream_reason.lower():
                    reason = f"Upstream delegation is no longer active ({delegation.parent_agent_id} → {agent_id})."
                else:
                    reason = f"Upstream authority has been revoked: {upstream_reason}"
            elif "expired" in upstream_reason.lower():
                reason = f"Upstream authority has expired: {upstream_reason}"
            else:
                reason = f"Upstream authority invalid: {upstream_reason}"

            # Build chain that includes parent chain + this delegation + this agent
            parent_chain = parent_result.get("full_chain", [])
            # If parent chain is empty, construct minimal
            if not parent_chain:
                parent_chain = [
                    {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
                    {"step": "Root Mandate", "id": root_mandate.id, "name": root_mandate.purpose, "detail": root_mandate.status},
                ]
            full_chain = parent_chain + [
                {"step": "Delegation", "id": delegation.id, "name": f"{delegation.purpose} ₹{delegation.delegated_amount_limit}", "detail": delegation.status},
                {"step": "Agent", "id": agent.id, "name": agent.name, "detail": agent.status},
            ]
            return {
                "valid": False,
                "reason": reason,
                "root_mandate": root_mandate,
                "leaf_delegation": delegation,
                "delegation_chain": parent_result.get("delegation_chain", []) + [delegation],
                "agent_chain": parent_result.get("agent_chain", []) + [agent],
                "full_chain": full_chain,
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }

        # Parent is valid — now ensure delegation is within parent's effective authority
        parent_effective_limit = parent_result["effective_limit"]
        parent_effective_purpose = parent_result["effective_purpose"]
        parent_effective_category = parent_result["effective_merchant_category"]
        # For direct parent (like A), effective limit is mandate max (2000)
        # For delegated parent (like B), effective limit is delegation limit (1000)
        # Delegated child limit must be ≤ parent effective limit
        if delegation.delegated_amount_limit > parent_effective_limit:
            return {
                "valid": False,
                "reason": f"Delegated limit ₹{delegation.delegated_amount_limit} exceeds upstream authority ₹{parent_effective_limit}.",
                "root_mandate": root_mandate,
                "leaf_delegation": delegation,
                "delegation_chain": parent_result["delegation_chain"] + [delegation],
                "agent_chain": parent_result["agent_chain"] + [agent],
                "full_chain": parent_result["full_chain"] + [
                    {"step": "Delegation", "id": delegation.id, "name": delegation.purpose, "detail": "Exceeds parent"},
                    {"step": "Agent", "id": agent.id, "name": agent.name, "detail": "Child"},
                ],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }

        # Purpose must be within parent's effective purpose (defense in depth)
        # Use same matching logic as before
        from backend.services.authorization import _purpose_within_scope
        if not _purpose_within_scope(parent_effective_purpose, parent_effective_category, delegation.purpose, delegation.merchant_category):
            return {
                "valid": False,
                "reason": f"Delegation purpose '{delegation.purpose}/{delegation.merchant_category}' exceeds upstream scope '{parent_effective_purpose}/{parent_effective_category}'.",
                "root_mandate": root_mandate,
                "leaf_delegation": delegation,
                "delegation_chain": parent_result["delegation_chain"] + [delegation],
                "agent_chain": parent_result["agent_chain"] + [agent],
                "full_chain": parent_result["full_chain"] + [
                    {"step": "Delegation", "id": delegation.id, "name": delegation.purpose, "detail": "Scope exceeds parent"},
                ],
                "effective_limit": delegation.delegated_amount_limit,
                "effective_purpose": delegation.purpose,
                "effective_merchant_category": delegation.merchant_category,
            }

        # All upstream valid — build full chain
        # Parent result already has full_chain from User to parent agent
        # We need to append this delegation and this agent
        full_chain = list(parent_result["full_chain"])
        # Parent chain already ends with parent agent; we add delegation then child agent
        # Avoid duplicating parent agent if already there
        full_chain.append({"step": "Delegation", "id": delegation.id, "name": f"{delegation.purpose} ₹{delegation.delegated_amount_limit}", "detail": delegation.status})
        full_chain.append({"step": "Agent", "id": agent.id, "name": agent.name, "detail": agent.status})

        return {
            "valid": True,
            "reason": "Delegated chain valid",
            "root_mandate": root_mandate,
            "leaf_delegation": delegation,
            "delegation_chain": parent_result["delegation_chain"] + [delegation],
            "agent_chain": parent_result["agent_chain"] + [agent],
            "full_chain": full_chain,
            "effective_limit": delegation.delegated_amount_limit,
            "effective_purpose": delegation.purpose,
            "effective_merchant_category": delegation.merchant_category,
        }

    # No delegation — check direct mandate
    mandates = (
        db.query(models.Mandate)
        .filter(models.Mandate.agent_id == agent_id)
        .filter(models.Mandate.status == "ACTIVE")
        .order_by(models.Mandate.created_at.desc())
        .all()
    )
    if not mandates:
        return {
            "valid": False,
            "reason": "No active mandate found for this agent.",
            "root_mandate": None,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [agent],
            "full_chain": [
                {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
                {"step": "Agent", "id": agent.id, "name": agent.name, "detail": "No mandate"},
            ],
            "effective_limit": None,
            "effective_purpose": None,
            "effective_merchant_category": None,
        }

    mandate = mandates[0]
    if mandate.status != "ACTIVE":
        return {
            "valid": False,
            "reason": "Mandate is not active.",
            "root_mandate": mandate,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [agent],
            "full_chain": [],
            "effective_limit": mandate.max_amount,
            "effective_purpose": mandate.purpose,
            "effective_merchant_category": mandate.merchant_category,
        }
    if _is_expired(mandate.expires_at):
        return {
            "valid": False,
            "reason": "Mandate has expired.",
            "root_mandate": mandate,
            "leaf_delegation": None,
            "delegation_chain": [],
            "agent_chain": [agent],
            "full_chain": [],
            "effective_limit": mandate.max_amount,
            "effective_purpose": mandate.purpose,
            "effective_merchant_category": mandate.merchant_category,
        }

    # Direct mandate valid
    return {
        "valid": True,
        "reason": "Direct mandate valid",
        "root_mandate": mandate,
        "leaf_delegation": None,
        "delegation_chain": [],
        "agent_chain": [agent],
        "full_chain": [
            {"step": "User", "name": "Vault #492 (You)", "detail": "Human principal"},
            {"step": "Root Mandate", "id": mandate.id, "name": mandate.purpose, "detail": f"₹{mandate.max_amount} {mandate.merchant_category}"},
            {"step": "Agent", "id": agent.id, "name": agent.name, "detail": agent.status},
        ],
        "effective_limit": mandate.max_amount,
        "effective_purpose": mandate.purpose,
        "effective_merchant_category": mandate.merchant_category,
    }
