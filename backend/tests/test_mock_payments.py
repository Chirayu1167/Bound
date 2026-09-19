"""
Mock-payment tests for Bound — Phase 3.

Simulated execution for APPROVED tasks only. The UI can never mark a
payment successful: only these endpoints transition payment status, gated
on task APPROVED + fresh + domain agent ACTIVE, re-validated at execute.

Reuses the isolated in-memory client/engine from test_security_adversarial
(same app object — a second dependency override would be order-dependent).

Run with: pytest backend/tests/test_mock_payments.py -v
"""
from datetime import datetime, timedelta, timezone

from backend.tests.test_security_adversarial import (
    client,
    _clear_db,
    TestingSessionLocal,
)
from backend.tests.test_tasks_approvals import (
    _seed_domain,
    _task,
    _force_expire_task,
    _get_task,
)
from backend import models


def _approved_task(agent_id, amount=500, merchant="Swiggy"):
    r = _task(agent_id, amount, merchant=merchant)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["task"]["status"] == "APPROVED", body
    return body["task"]


def _review_task(agent_id, amount=4500, merchant="UnknownPlace"):
    r = _task(agent_id, amount, merchant=merchant)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["task"]["status"] == "NEEDS_REVIEW", body
    return body


def _pay(task_id, method="Demo Balance", note=None):
    body = {"task_id": task_id, "payment_method": method}
    if note is not None:
        body["note"] = note
    return client.post("/mock-payments/create", json=body)


def _execute(payment_id, simulate_failure=False):
    return client.post(f"/mock-payments/{payment_id}/execute", json={"simulate_failure": simulate_failure})


# ---------------------------------------------------------------------------
# Happy path + lifecycle
# ---------------------------------------------------------------------------
class TestMockPaymentLifecycle:
    def test_approved_task_payment_succeeds(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 742, merchant="Pizza House")
        r = _pay(task["id"], note="Friday dinner")
        assert r.status_code == 201, r.text
        pay = r.json()
        assert pay["status"] == "CREATED"
        assert pay["task_id"] == task["id"]
        assert pay["transaction_id"] == task["transaction_id"]
        assert pay["merchant"] == "Pizza House"
        assert pay["amount"] == 742
        assert pay["payment_method"] == "Demo Balance"
        assert pay["note"] == "Friday dinner"
        assert pay["completed_at"] is None

        r = _execute(pay["id"])
        assert r.status_code == 200, r.text
        done = r.json()
        assert done["status"] == "SUCCEEDED"
        assert done["completed_at"] is not None
        assert _get_task(task["id"])["status"] == "COMPLETED"

    def test_payment_completion_updates_task(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        assert _get_task(task["id"])["status"] == "APPROVED"
        _execute(pay_id)
        assert _get_task(task["id"])["status"] == "COMPLETED"

    def test_unknown_task_create_404(self):
        _clear_db()
        assert _pay("task-nope").status_code == 404

    def test_unknown_payment_get_404(self):
        _clear_db()
        assert client.get("/mock-payments/pay-nope").status_code == 404
        assert client.post("/mock-payments/pay-nope/execute", json={"simulate_failure": False}).status_code == 404

    def test_bad_payment_method_rejected(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        assert _pay(task["id"], method="Real Card").status_code == 422

    def test_get_filters(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        assert client.get(f"/mock-payments/{pay_id}").status_code == 200
        assert len(client.get(f"/mock-payments?task_id={task['id']}").json()) == 1
        assert len(client.get("/mock-payments?status=CREATED").json()) == 1
        assert client.get("/mock-payments?status=NOPE").status_code == 400


# ---------------------------------------------------------------------------
# Authorization gates (the payment UI can never bypass these)
# ---------------------------------------------------------------------------
class TestMockPaymentGates:
    def test_unapproved_task_cannot_create(self):
        agent, _mandate = _seed_domain()
        body = _review_task(agent["id"])
        assert _pay(body["task"]["id"]).status_code == 409

    def test_wrong_category_task_cannot_create(self):
        agent, _mandate = _seed_domain()
        r = _task(agent["id"], 500, category="Electronics", purpose="Electronics", merchant="TechStore")
        assert r.json()["task"]["status"] == "NEEDS_REVIEW"
        assert _pay(r.json()["task"]["id"]).status_code == 409

    def test_revoked_agent_blocks_create_and_execute(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        client.patch(f"/agents/{agent['id']}", json={"status": "REVOKED"})
        # Execute re-validates: revoked after creation still cannot pay.
        assert _execute(pay_id).status_code == 409
        # And no new payment can be created for a revoked agent's task either.
        agent2, _m2 = _seed_domain(name="Food Agent 2")
        task3 = _approved_task(agent2["id"], 50)
        client.patch(f"/agents/{agent2['id']}", json={"status": "REVOKED"})
        assert _pay(task3["id"]).status_code == 409

    def test_expired_task_cannot_create(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        _force_expire_task(task["id"])
        r = _pay(task["id"])
        assert r.status_code == 410
        assert _get_task(task["id"])["status"] == "EXPIRED"

    def test_expired_task_cannot_execute(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        _force_expire_task(task["id"])
        assert _execute(pay_id).status_code == 410

    def test_cancelled_task_cannot_create(self):
        agent, _mandate = _seed_domain()
        body = _review_task(agent["id"], amount=3000)
        client.post(f"/tasks/{body['task']['id']}/cancel")
        assert _pay(body["task"]["id"]).status_code == 409

    def test_amount_merchant_binding_enforced_at_execute(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        # Tamper with the task after payment creation (simulates a confused/
        # malicious client trying to redirect the payment).
        db = TestingSessionLocal()
        try:
            t = db.query(models.Task).filter(models.Task.id == task["id"]).first()
            t.requested_amount = 9999.0
            db.commit()
        finally:
            db.close()
        assert _execute(pay_id).status_code == 409


# ---------------------------------------------------------------------------
# Approval → payment (risky-but-authorized scenario B)
# ---------------------------------------------------------------------------
class TestApprovalToPayment:
    def test_approve_once_then_pay(self):
        agent, mandate = _seed_domain()
        before = [m for m in client.get("/mandates").json() if m["id"] == mandate["id"]][0]["max_amount"]
        body = _review_task(agent["id"], amount=4500)
        r = client.post(
            f"/approvals/{body['approval']['id']}/resolve",
            json={"token": body["approval_token"], "action": "approve"},
        )
        assert r.status_code == 200
        pay = _pay(body["task"]["id"]).json()
        done = _execute(pay["id"]).json()
        assert done["status"] == "SUCCEEDED"
        assert _get_task(body["task"]["id"])["status"] == "COMPLETED"
        after = [m for m in client.get("/mandates").json() if m["id"] == mandate["id"]][0]["max_amount"]
        assert after == before == 1000

    def test_denied_task_cannot_pay(self):
        agent, _mandate = _seed_domain()
        body = _review_task(agent["id"])
        client.post(
            f"/approvals/{body['approval']['id']}/resolve",
            json={"token": body["approval_token"], "action": "deny"},
        )
        assert _pay(body["task"]["id"]).status_code == 409


# ---------------------------------------------------------------------------
# Duplicates, replay, failure
# ---------------------------------------------------------------------------
class TestDuplicatesAndFailure:
    def test_duplicate_create_rejected(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        assert _pay(task["id"]).status_code == 201
        assert _pay(task["id"]).status_code == 409
        rows = client.get(f"/mock-payments?task_id={task['id']}").json()
        assert len(rows) == 1

    def test_duplicate_execute_rejected(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        assert _execute(pay_id).json()["status"] == "SUCCEEDED"
        assert _execute(pay_id).status_code == 409
        rows = [p for p in client.get("/mock-payments").json() if p["status"] == "SUCCEEDED"]
        assert len(rows) == 1

    def test_failed_payment_does_not_complete_task(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        failed = _execute(pay_id, simulate_failure=True).json()
        assert failed["status"] == "FAILED"
        assert failed["failure_reason"]
        assert failed["completed_at"] is None
        assert _get_task(task["id"])["status"] == "APPROVED"
        # Retry on the same row is safe and never double-pays.
        retried = _execute(pay_id).json()
        assert retried["status"] == "SUCCEEDED"
        assert _get_task(task["id"])["status"] == "COMPLETED"
        assert len(client.get(f"/mock-payments?task_id={task['id']}").json()) == 1

    def test_completed_task_cannot_cancel(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        _execute(_pay(task["id"]).json()["id"])
        assert client.post(f"/tasks/{task['id']}/cancel").status_code == 409


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------
class TestMockPaymentProvenance:
    def test_payment_events_present_and_chain_valid(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 742, merchant="Pizza House")
        pay_id = _pay(task["id"], note="Friday dinner").json()["id"]
        _execute(pay_id)
        tx_events = [e["event_type"] for e in client.get(f"/provenance/transaction/{task['transaction_id']}").json()]
        for expected in ("MOCK_PAYMENT_CREATED", "MOCK_PAYMENT_PROCESSING", "MOCK_PAYMENT_SUCCEEDED"):
            assert expected in tx_events, tx_events
        assert client.get("/provenance/verify").json()["valid"] is True

    def test_failed_payment_event_present(self):
        agent, _mandate = _seed_domain()
        task = _approved_task(agent["id"], 100)
        pay_id = _pay(task["id"]).json()["id"]
        _execute(pay_id, simulate_failure=True)
        tx = _get_task(task["id"])["transaction_id"]
        tx_events = [e["event_type"] for e in client.get(f"/provenance/transaction/{tx}").json()]
        assert "MOCK_PAYMENT_FAILED" in tx_events
        assert "MOCK_PAYMENT_SUCCEEDED" not in tx_events

    def test_mandate_unchanged_after_full_payment_flow(self):
        agent, mandate = _seed_domain(cap=1000)
        task = _approved_task(agent["id"], 800)
        _execute(_pay(task["id"]).json()["id"])
        after = [m for m in client.get("/mandates").json() if m["id"] == mandate["id"]][0]
        assert after["max_amount"] == 1000
        assert after["status"] == "ACTIVE"
