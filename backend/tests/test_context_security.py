"""
Context-security tests for Bound — Phase 5.

The Phase 5 context layer lives entirely in the frontend (proposals that
prefill a form). These tests pin down the backend invariants that make that
safe — i.e. that no amount of history, prior approval, or "usual spend" can
ever raise authority:

- history above mandate  -> Needs Review (history is not permission)
- prior one-time approval -> does not bless a repeat (no blanket grant)
- task_limit            -> never exceeds the mandate cap
- revoked agent + history -> Needs Review with no approval path
- category mismatch + history -> VERIFY
- risk/history signals  -> can only escalate to review, never grant ALLOW

Reuses the isolated in-memory client/engine from test_security_adversarial
(same app object — a second dependency override would be order-dependent).

Run with: pytest backend/tests/test_context_security.py -v
"""
from backend.tests.test_security_adversarial import (
    client,
    _clear_db,
)
from backend.tests.test_tasks_approvals import _seed_domain, _task


def _direct_payment(agent_id, amount, merchant="Swiggy", category="Grocery", purpose="Food"):
    """Record history straight through the engine (no task machinery)."""
    r = client.post(
        "/payments/authorize",
        json={
            "agent_id": agent_id,
            "amount": amount,
            "merchant": merchant,
            "merchant_category": category,
            "purpose": purpose,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _approve_once(task_body):
    approval = task_body["approval"]
    assert approval is not None, "expected a pending approval"
    token = task_body["approval_token"]
    assert token, "one-time token must be returned exactly once"
    r = client.post(
        f"/approvals/{approval['id']}/resolve",
        json={"token": token, "action": "approve"},
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestHistoryIsNotPermission:
    def test_history_above_mandate_still_needs_review(self):
        agent, _mandate = _seed_domain(cap=1000)
        # Build real approved history: usual spend lands around 600-700.
        assert _direct_payment(agent["id"], 600)["decision"] == "ALLOW"
        assert _direct_payment(agent["id"], 700, merchant="FreshMart")["decision"] == "ALLOW"
        # A "usual" amount above the mandate cap must still need review.
        r = _task(agent["id"], 1500)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["task"]["status"] == "NEEDS_REVIEW"
        assert body["task"]["decision"] == "VERIFY"
        assert body["approval"] is not None

    def test_task_limit_never_exceeds_mandate(self):
        agent, mandate = _seed_domain(cap=1000)
        assert _direct_payment(agent["id"], 600)["decision"] == "ALLOW"
        assert _direct_payment(agent["id"], 700, merchant="FreshMart")["decision"] == "ALLOW"
        body = _task(agent["id"], 1500).json()
        assert body["task"]["task_limit"] <= mandate["max_amount"]

    def test_prior_approval_does_not_bless_repeat(self):
        agent, mandate = _seed_domain(cap=1000)
        first = _task(agent["id"], 1500).json()
        assert first["task"]["status"] == "NEEDS_REVIEW"
        _approve_once(first)
        # The repeat — same amount, same merchant, richer history — still reviews.
        second = _task(agent["id"], 1500).json()
        assert second["task"]["status"] == "NEEDS_REVIEW"
        assert second["task"]["decision"] == "VERIFY"
        assert second["approval"] is not None
        # And the standing mandate is byte-identical.
        current = [m for m in client.get("/mandates").json() if m["id"] == mandate["id"]][0]
        assert current["max_amount"] == mandate["max_amount"]

    def test_revoked_agent_with_history_has_no_approval_path(self):
        agent, _mandate = _seed_domain(cap=1000)
        assert _direct_payment(agent["id"], 600)["decision"] == "ALLOW"
        assert _direct_payment(agent["id"], 700, merchant="FreshMart")["decision"] == "ALLOW"
        r = client.patch(f"/agents/{agent['id']}", json={"status": "REVOKED"})
        assert r.status_code == 200
        body = _task(agent["id"], 650).json()
        assert body["task"]["status"] == "NEEDS_REVIEW"
        assert body["approval"] is None
        assert body["approval_token"] is None

    def test_category_mismatch_with_history_still_verify(self):
        agent, _mandate = _seed_domain(cap=1000)
        assert _direct_payment(agent["id"], 600)["decision"] == "ALLOW"
        assert _direct_payment(agent["id"], 700, merchant="FreshMart")["decision"] == "ALLOW"
        body = _task(agent["id"], 650, category="Electronics", purpose="Electronics", merchant="TechStore").json()
        assert body["task"]["decision"] == "VERIFY"
        assert body["task"]["status"] == "NEEDS_REVIEW"

    def test_history_signals_never_grant_authority(self):
        agent, _mandate = _seed_domain(cap=1000)
        assert _direct_payment(agent["id"], 600)["decision"] == "ALLOW"
        assert _direct_payment(agent["id"], 700, merchant="FreshMart")["decision"] == "ALLOW"
        # In-cap amount near the historical mean: the auth layer must say
        # ALLOW no matter what risk/history signals exist. (The final
        # decision may still escalate to VERIFY for review — that is
        # risk doing its job, not granting.)
        body = _task(agent["id"], 650, merchant="Swiggy").json()
        assert body["task"]["authorization_status"] == "ALLOW"
        # Control: over-cap with identical history is VERIFY at the auth layer.
        over = _task(agent["id"], 1500, merchant="Swiggy").json()
        assert over["task"]["authorization_status"] == "VERIFY"
