"""
Task + Approval tests for Bound — Phase 2.

Covers (mirroring the Phase 2 spec):
- TASK AUTHORIZATION (within/over/wrong-category/revoked/expired/limits)
- TASK DELEGATION (child<=parent, TTL clamp, revocation, single-use, expiry)
- APPROVALS (create/resolve/replay/cross-task/expiry/deny/mandate-unchanged)
- CANCELLATION (stops task, invalidates approval, preserves history)
- RISK mapping (pure mapping unit tests + reachable end-to-end rows)
- DOMAIN field (Part A fixes)

Reuses the isolated in-memory client/engine from test_security_adversarial
(same app object — a second dependency override would be order-dependent).

Run with: pytest backend/tests/test_tasks_approvals.py -v
"""
from datetime import datetime, timedelta, timezone

from backend.tests.test_security_adversarial import (
    client,
    _clear_db,
    TestingSessionLocal,
)
from backend import models
from backend.main import _map_task_outcome


def _seed_domain(
    name="Food Agent",
    domain="FOOD",
    cap=1000,
    category="Grocery",
    purpose="Food orders",
    mandate_expires_at=None,
):
    """Fresh DB + one domain agent + one standing mandate."""
    _clear_db()
    r = client.post("/agents", json={"name": name, "description": "test domain", "domain": domain})
    assert r.status_code == 201, r.text
    agent = r.json()
    body = {
        "agent_id": agent["id"],
        "purpose": purpose,
        "max_amount": cap,
        "merchant_category": category,
    }
    if mandate_expires_at:
        body["expires_at"] = mandate_expires_at
    r = client.post("/mandates", json=body)
    assert r.status_code == 201, r.text
    return agent, r.json()


def _task(agent_id, amount, category="Grocery", purpose="Food", merchant="Swiggy", key=None):
    body = {
        "domain_agent_id": agent_id,
        "purpose": purpose,
        "requested_amount": amount,
        "category": category,
        "merchant": merchant,
    }
    if key:
        body["idempotency_key"] = key
    return client.post("/tasks/authorize", json=body)


def _force_expire_task(task_id):
    db = TestingSessionLocal()
    try:
        t = db.query(models.Task).filter(models.Task.id == task_id).first()
        assert t is not None
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        t.expires_at = past
        ap = db.query(models.Approval).filter(models.Approval.task_id == task_id).first()
        if ap is not None:
            ap.expires_at = past
        db.commit()
    finally:
        db.close()


def _get_task(task_id):
    r = client.get(f"/tasks/{task_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _get_delegation(delegation_id):
    r = client.get("/delegations")
    assert r.status_code == 200
    matches = [d for d in r.json() if d["id"] == delegation_id]
    assert len(matches) == 1
    return matches[0]


def _get_agent(agent_id):
    for a in client.get("/agents").json():
        if a["id"] == agent_id:
            return a
    raise AssertionError(f"agent {agent_id} not found")


# ---------------------------------------------------------------------------
# 1. TASK AUTHORIZATION
# ---------------------------------------------------------------------------
class TestTaskAuthorization:
    def test_valid_task_within_mandate_approved(self):
        agent, mandate = _seed_domain()
        r = _task(agent["id"], 800)
        assert r.status_code == 200, r.text
        body = r.json()
        task = body["task"]
        assert task["status"] == "APPROVED"
        assert task["decision"] == "ALLOW"
        assert task["task_limit"] == 800
        assert task["task_limit"] <= mandate["max_amount"]
        assert task["delegation_id"] is not None
        assert task["task_agent_id"] is not None
        assert task["transaction_id"] is not None
        assert body["approval"] is None
        assert body["approval_token"] is None

    def test_task_over_mandate_needs_review_with_approval(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 4500)
        assert r.status_code == 200, r.text
        body = r.json()
        task = body["task"]
        assert task["status"] == "NEEDS_REVIEW"
        assert task["decision"] == "VERIFY"
        # No authority granted beyond the parent: no delegation, no task agent.
        assert task["delegation_id"] is None
        assert task["task_agent_id"] is None
        assert task["task_limit"] == 0
        assert body["approval"] is not None
        assert body["approval"]["status"] == "PENDING"
        assert body["approval"]["amount"] == 4500
        assert body["approval_token"], "one-time token must be returned exactly once"
        assert "token_hash" not in body["approval"]
        assert "approval_token" not in (body["approval"] or {})

    def test_task_wrong_category_needs_review(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 500, category="Electronics", purpose="Electronics", merchant="TechStore")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["task"]["status"] == "NEEDS_REVIEW"
        assert body["task"]["decision"] == "VERIFY"
        assert body["approval"] is not None

    def test_task_at_exact_cap_approved(self):
        agent, _mandate = _seed_domain(cap=1000)
        r = _task(agent["id"], 1000)
        assert r.status_code == 200, r.text
        assert r.json()["task"]["status"] == "APPROVED"

    def test_revoked_domain_agent_needs_review_without_approval(self):
        agent, _mandate = _seed_domain()
        r = client.patch(f"/agents/{agent['id']}", json={"status": "REVOKED"})
        assert r.status_code == 200
        r = _task(agent["id"], 100)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["task"]["status"] == "NEEDS_REVIEW"
        # Revocation must not be approvable: no approval, no token, ever.
        assert body["approval"] is None
        assert body["approval_token"] is None

    def test_unknown_domain_agent_404(self):
        _clear_db()
        r = _task("no-such-agent", 100)
        assert r.status_code == 404

    def test_task_agent_cannot_own_tasks(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 100)
        task_agent_id = r.json()["task"]["task_agent_id"]
        assert task_agent_id
        r2 = _task(task_agent_id, 50)
        assert r2.status_code == 400

    def test_task_validation(self):
        agent, _mandate = _seed_domain()
        assert _task(agent["id"], 0).status_code == 422
        assert _task(agent["id"], -5).status_code == 422
        r = client.post(
            "/tasks/authorize",
            json={"domain_agent_id": agent["id"], "purpose": "Food", "requested_amount": 100, "category": "Grocery", "merchant": "   "},
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# 2. TASK DELEGATION (reuses the existing engine)
# ---------------------------------------------------------------------------
class TestTaskDelegation:
    def test_task_child_within_parent(self):
        agent, mandate = _seed_domain(cap=1000)
        r = _task(agent["id"], 800)
        deleg_id = r.json()["task"]["delegation_id"]
        d = _get_delegation(deleg_id)
        assert d["delegated_amount_limit"] == 800
        assert d["delegated_amount_limit"] <= mandate["max_amount"]
        assert d["parent_agent_id"] == agent["id"]
        assert d["parent_mandate_id"] == mandate["id"]

    def test_single_use_machinery_revoked_after_authorize(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 200)
        body = r.json()
        assert body["task"]["status"] == "APPROVED"
        d = _get_delegation(body["task"]["delegation_id"])
        assert d["status"] == "REVOKED"
        ta = _get_agent(body["task"]["task_agent_id"])
        assert ta["status"] == "REVOKED"
        assert ta["is_task_agent"] is True
        # Reuse is impossible: the chain is dead.
        r2 = client.post(
            "/payments/authorize",
            json={"agent_id": body["task"]["task_agent_id"], "amount": 50, "merchant": "Swiggy", "merchant_category": "Grocery", "purpose": "Food"},
        )
        assert r2.status_code == 200
        assert r2.json()["decision"] == "VERIFY"

    def test_task_child_cannot_outlive_parent(self):
        soon = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        agent, mandate = _seed_domain(mandate_expires_at=soon)
        r = _task(agent["id"], 100)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["task"]["status"] == "APPROVED"
        d = _get_delegation(body["task"]["delegation_id"])
        assert d["expires_at"] is not None
        assert d["expires_at"] <= mandate["expires_at"]

    def test_manual_delegation_revocation_still_propagates(self):
        # The task layer reuses this engine path; prove it end to end.
        _clear_db()
        a = client.post("/agents", json={"name": "A", "description": "t"}).json()
        b = client.post("/agents", json={"name": "B", "description": "t"}).json()
        m = client.post("/mandates", json={"agent_id": a["id"], "purpose": "Food orders", "max_amount": 1000, "merchant_category": "Grocery"}).json()
        d = client.post("/delegations", json={
            "parent_agent_id": a["id"], "child_agent_id": b["id"], "parent_mandate_id": m["id"],
            "delegated_amount_limit": 500, "purpose": "Food", "merchant_category": "Grocery",
        }).json()
        assert d["status"] == "ACTIVE"
        client.patch(f"/agents/{a['id']}", json={"status": "REVOKED"})
        r = client.post("/payments/authorize", json={
            "agent_id": b["id"], "amount": 100, "merchant": "Swiggy", "merchant_category": "Grocery", "purpose": "Food",
        })
        assert r.json()["decision"] == "VERIFY"

    def test_expired_task_authority_cannot_authorize(self):
        agent, _mandate = _seed_domain()
        # Within-mandate task, then expire its delegation directly in the DB.
        r = _task(agent["id"], 100, purpose="Food")
        assert r.json()["task"]["status"] == "APPROVED"
        # Machinery is single-use revoked already; revocation is terminal too:
        # even re-activating the mandate cannot resurrect the task delegation.
        db = TestingSessionLocal()
        try:
            d = db.query(models.Delegation).filter(models.Delegation.id == r.json()["task"]["delegation_id"]).first()
            assert d.status == "REVOKED"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# 3. APPROVALS
# ---------------------------------------------------------------------------
class TestApprovals:
    def _needs_review_task(self, amount=4500):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], amount)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["task"]["status"] == "NEEDS_REVIEW"
        return agent, body

    def test_approve_once_does_not_widen_mandate(self):
        agent, body = self._needs_review_task(4500)
        approval = body["approval"]
        token = body["approval_token"]
        r = client.post(f"/approvals/{approval['id']}/resolve", json={"token": token, "action": "approve"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "APPROVED"
        task = _get_task(body["task"]["id"])
        assert task["status"] == "APPROVED"
        # Standing mandate byte-identical.
        mandates = [m for m in client.get("/mandates").json() if m["agent_id"] == agent["id"]]
        assert len(mandates) == 1
        assert mandates[0]["max_amount"] == 1000
        # The NEXT identical request still needs review — nothing widened.
        r2 = _task(agent["id"], 4500)
        assert r2.json()["task"]["status"] == "NEEDS_REVIEW"
        assert r2.json()["approval"] is not None

    def test_approval_token_cannot_be_replayed(self):
        _agent, body = self._needs_review_task()
        approval = body["approval"]
        token = body["approval_token"]
        assert client.post(f"/approvals/{approval['id']}/resolve", json={"token": token, "action": "approve"}).status_code == 200
        r = client.post(f"/approvals/{approval['id']}/resolve", json={"token": token, "action": "approve"})
        assert r.status_code == 409

    def test_approval_token_wrong_token_rejected(self):
        _agent, body = self._needs_review_task()
        r = client.post(f"/approvals/{body['approval']['id']}/resolve", json={"token": "wrong-token", "action": "approve"})
        assert r.status_code == 403
        # Still pending afterwards.
        assert client.get("/approvals?status=PENDING").json()

    def test_approval_for_task_a_cannot_authorize_task_b(self):
        agent, _mandate = _seed_domain()
        b1 = _task(agent["id"], 4500, merchant="ShopA").json()
        b2 = _task(agent["id"], 4600, merchant="ShopB").json()
        r = client.post(f"/approvals/{b2['approval']['id']}/resolve", json={"token": b1["approval_token"], "action": "approve"})
        assert r.status_code == 403
        assert _get_task(b2["task"]["id"])["status"] == "NEEDS_REVIEW"

    def test_expired_approval_cannot_authorize(self):
        _agent, body = self._needs_review_task()
        _force_expire_task(body["task"]["id"])
        r = client.post(f"/approvals/{body['approval']['id']}/resolve", json={"token": body["approval_token"], "action": "approve"})
        assert r.status_code == 410
        assert _get_task(body["task"]["id"])["status"] == "EXPIRED"

    def test_denied_approval_cancels_task_and_cannot_be_reused(self):
        _agent, body = self._needs_review_task()
        approval = body["approval"]
        token = body["approval_token"]
        r = client.post(f"/approvals/{approval['id']}/resolve", json={"token": token, "action": "deny"})
        assert r.status_code == 200
        assert r.json()["status"] == "DENIED"
        assert _get_task(body["task"]["id"])["status"] == "CANCELLED"
        r2 = client.post(f"/approvals/{approval['id']}/resolve", json={"token": token, "action": "approve"})
        assert r2.status_code == 409

    def test_resolve_after_agent_revoked_fails(self):
        agent, body = self._needs_review_task()
        client.patch(f"/agents/{agent['id']}", json={"status": "REVOKED"})
        r = client.post(f"/approvals/{body['approval']['id']}/resolve", json={"token": body["approval_token"], "action": "approve"})
        assert r.status_code == 409
        assert _get_task(body["task"]["id"])["status"] == "NEEDS_REVIEW"

    def test_unknown_approval_404(self):
        r = client.post("/approvals/apr-doesnotexist/resolve", json={"token": "x", "action": "approve"})
        assert r.status_code == 404

    def test_token_hash_never_exposed(self):
        _agent, body = self._needs_review_task()
        assert "token_hash" not in body["approval"]
        for a in client.get("/approvals").json():
            assert "token_hash" not in a
            assert "approval_token" not in a


# ---------------------------------------------------------------------------
# 4. CANCELLATION
# ---------------------------------------------------------------------------
class TestCancellation:
    def test_cancel_needs_review_task(self):
        _agent, body = self._needs_review_task_inner(3000)
        task_id = body["task"]["id"]
        r = client.post(f"/tasks/{task_id}/cancel")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "CANCELLED"

    def _needs_review_task_inner(self, amount):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], amount)
        assert r.json()["task"]["status"] == "NEEDS_REVIEW"
        return agent, r.json()

    def test_cancel_invalidates_pending_approval(self):
        _agent, body = self._needs_review_task_inner(3000)
        client.post(f"/tasks/{body['task']['id']}/cancel")
        r = client.post(
            f"/approvals/{body['approval']['id']}/resolve",
            json={"token": body["approval_token"], "action": "approve"},
        )
        assert r.status_code == 409

    def test_cancel_approved_task_rejected(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 100)
        assert r.json()["task"]["status"] == "APPROVED"
        r2 = client.post(f"/tasks/{r.json()['task']['id']}/cancel")
        assert r2.status_code == 409

    def test_cancel_preserves_history(self):
        _agent, body = self._needs_review_task_inner(3000)
        task_id = body["task"]["id"]
        tx_id = body["task"]["transaction_id"]
        client.post(f"/tasks/{task_id}/cancel")
        # Records remain queryable.
        assert _get_task(task_id)["status"] == "CANCELLED"
        txs = [t for t in client.get("/transactions").json() if t["id"] == tx_id]
        assert len(txs) == 1
        types = [e["event_type"] for e in client.get("/provenance?limit=200").json()]
        assert "TASK_CREATED" in types
        assert "TASK_CANCELLED" in types
        # Chain still verifies after all task/approval transitions.
        assert client.get("/provenance/verify").json()["valid"] is True

    def test_cancel_unknown_task_404(self):
        _clear_db()
        assert client.post("/tasks/task-nope/cancel").status_code == 404


# ---------------------------------------------------------------------------
# 5. RISK mapping (unit) + reachable end-to-end rows
# ---------------------------------------------------------------------------
class TestRiskMapping:
    def test_mapping_allow_low_approved(self):
        assert _map_task_outcome("ALLOW", "LOW") == ("APPROVED", False)

    def test_mapping_allow_medium_needs_review(self):
        assert _map_task_outcome("ALLOW", "MEDIUM") == ("NEEDS_REVIEW", True)

    def test_mapping_allow_high_needs_review(self):
        assert _map_task_outcome("ALLOW", "HIGH") == ("NEEDS_REVIEW", True)

    def test_mapping_verify_low_needs_review(self):
        assert _map_task_outcome("VERIFY", "LOW") == ("NEEDS_REVIEW", True)

    def test_mapping_verify_high_needs_review(self):
        assert _map_task_outcome("VERIFY", "HIGH") == ("NEEDS_REVIEW", True)

    def test_mapping_none_risk_defaults_low(self):
        assert _map_task_outcome("ALLOW", None) == ("APPROVED", False)

    def test_e2e_allow_low_approved(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 100)
        body = r.json()
        assert body["task"]["status"] == "APPROVED"
        assert body["task"]["risk_level"] == "LOW"

    def test_e2e_verify_needs_review(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 2100)
        body = r.json()
        assert body["task"]["status"] == "NEEDS_REVIEW"
        assert body["task"]["decision"] == "VERIFY"
        # Risk never grants: whatever the level, the outcome stays review.
        assert body["approval"] is not None


# ---------------------------------------------------------------------------
# 6. DOMAIN field (Part A)
# ---------------------------------------------------------------------------
class TestAgentDomain:
    def test_create_agent_with_domain(self):
        _clear_db()
        r = client.post("/agents", json={"name": "Food Agent", "description": "t", "domain": "food"})
        assert r.status_code == 201
        assert r.json()["domain"] == "FOOD"
        assert r.json()["is_task_agent"] is False

    def test_create_agent_invalid_domain_rejected(self):
        _clear_db()
        r = client.post("/agents", json={"name": "X", "domain": "SPACE"})
        assert r.status_code == 422

    def test_create_agent_default_domain_other(self):
        _clear_db()
        r = client.post("/agents", json={"name": "Plain Agent"})
        assert r.status_code == 201
        assert r.json()["domain"] == "OTHER"

    def test_patch_agent_domain(self):
        _clear_db()
        a = client.post("/agents", json={"name": "Y"}).json()
        r = client.patch(f"/agents/{a['id']}", json={"domain": "travel"})
        assert r.status_code == 200
        assert r.json()["domain"] == "TRAVEL"
        r = client.patch(f"/agents/{a['id']}", json={"domain": "NOPE"})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# 7. TASK PROVENANCE chain readability
# ---------------------------------------------------------------------------
class TestTaskProvenance:
    def test_task_chain_events_present_and_valid(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 4500)
        body = r.json()
        tx_id = body["task"]["transaction_id"]
        tx_events = [e["event_type"] for e in client.get(f"/provenance/transaction/{tx_id}").json()]
        assert "PAYMENT_REQUESTED" in tx_events
        assert "AUTHORIZATION_DECIDED" in tx_events
        assert "APPROVAL_REQUESTED" in tx_events
        all_types = [e["event_type"] for e in client.get("/provenance?limit=200").json()]
        assert "TASK_CREATED" in all_types
        assert client.get("/provenance/verify").json()["valid"] is True

    def test_approval_grant_recorded_without_new_payment_claim(self):
        agent2, _m2 = _seed_domain(name="Food Agent 2")
        r = _task(agent2["id"], 4500)
        body = r.json()
        tx_id = body["task"]["transaction_id"]
        n_before = len(client.get("/transactions").json())
        client.post(f"/approvals/{body['approval']['id']}/resolve", json={"token": body["approval_token"], "action": "approve"})
        # No new transaction invented by the approval itself.
        assert len(client.get("/transactions").json()) == n_before
        tx_events = [e["event_type"] for e in client.get(f"/provenance/transaction/{tx_id}").json()]
        assert "APPROVAL_GRANTED" in tx_events
        assert "PAYMENT_COMPLETED" in tx_events  # from the original engine run, unchanged

    def test_task_idempotency(self):
        agent, _mandate = _seed_domain()
        b1 = _task(agent["id"], 500, key="idem-task-1").json()
        b2 = _task(agent["id"], 500, key="idem-task-1").json()
        assert b1["task"]["id"] == b2["task"]["id"]
        assert len(client.get("/tasks").json()) == 1
        r = client.post(
            "/tasks/authorize",
            json={"domain_agent_id": agent["id"], "purpose": "Food", "requested_amount": 600,
                  "category": "Grocery", "merchant": "Swiggy", "idempotency_key": "idem-task-1"},
        )
        assert r.status_code == 409
