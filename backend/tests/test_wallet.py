"""
Wallet tests for Bound — demo wallet invariants.

The wallet is backend-owned simulated funds (NOT a bank account). Every
number the UI shows comes from GET /wallet or the ledger; the frontend
never hardcodes a balance.

Invariants pinned here:
- Fresh DB starts at the configured initial balance with one INITIAL credit.
- Successful payment execution debits exactly once (balance + ledger agree).
- Insufficient balance rejects with 409 and debits nothing.
- Replay/re-execute rejects with 409 and never double-debits.
- Failed (simulated) payments do not debit.
- Top-up credits bounded amounts and rejects the rest.
- /demo/reset is 403 unless ALLOW_DEMO_RESET=true.

Reuses the isolated in-memory client/engine from test_security_adversarial.
Run with: pytest backend/tests/test_wallet.py -v
"""
import os

from backend.tests.test_security_adversarial import client, _clear_db
from backend.tests.test_tasks_approvals import _seed_domain, _task
from backend.tests.test_mock_payments import _approved_task


def _wallet():
    r = client.get("/wallet")
    assert r.status_code == 200, r.text
    return r.json()


def _ledger():
    r = client.get("/wallet/transactions?limit=200")
    assert r.status_code == 200, r.text
    return r.json()


def _pay_and_execute(task_id):
    r = client.post("/mock-payments/create", json={"task_id": task_id, "payment_method": "Demo Balance"})
    assert r.status_code == 201, r.text
    pay = r.json()
    r = client.post(f"/mock-payments/{pay['id']}/execute", json={"simulate_failure": False})
    assert r.status_code == 200, r.text
    return r.json()


class TestWalletBasics:
    def test_fresh_wallet_has_initial_with_ledger_row(self):
        _clear_db()
        w = _wallet()
        assert w["balance"] == 10000.0
        assert w["total_credited"] == 10000.0
        assert w["total_debited"] == 0.0
        rows = _ledger()
        assert len(rows) == 1
        assert rows[0]["direction"] == "CREDIT" and rows[0]["kind"] == "INITIAL"
        assert rows[0]["balance_after"] == 10000.0

    def test_topup_credits_and_rejects_bounds(self):
        _clear_db()
        r = client.post("/wallet/topup", json={"amount": 2500})
        assert r.status_code == 200, r.text
        assert r.json()["balance"] == 12500.0
        for bad in (0, -5, 100001, "lots"):
            r = client.post("/wallet/topup", json={"amount": bad})
            assert r.status_code == 422, (bad, r.text)
        assert _wallet()["balance"] == 12500.0


class TestWalletDebit:
    def test_success_debits_once_and_ledger_agrees(self):
        agent, _m = _seed_domain(cap=2000)
        before = _wallet()["balance"]
        task = _approved_task(agent["id"], 800, merchant="Swiggy")
        done = _pay_and_execute(task["id"])
        assert done["status"] == "SUCCEEDED"
        assert done["wallet_balance_after"] == before - 800
        w = _wallet()
        assert w["balance"] == before - 800
        assert w["total_debited"] == 800.0
        debits = [e for e in _ledger() if e["direction"] == "DEBIT"]
        assert len(debits) == 1
        assert debits[0]["balance_after"] == before - 800
        assert debits[0]["payment_id"] == done["id"]

    def test_insufficient_balance_rejects_without_debit(self):
        agent, _m = _seed_domain(cap=1000)
        # Over the mandate cap so the task needs one-time approval; the wallet
        # (10000) still cannot cover 12000, so execution must 409.
        r = _task(agent["id"], 12000, merchant="BigStore")
        body = r.json()
        assert body["task"]["status"] == "NEEDS_REVIEW", body
        tok = body["approval_token"]
        ap = body["approval"]["id"]
        r = client.post(f"/approvals/{ap}/resolve", json={"token": tok, "action": "approve"})
        assert r.status_code == 200, r.text
        r = client.post("/mock-payments/create", json={"task_id": body["task"]["id"], "payment_method": "Demo Balance"})
        assert r.status_code == 201, r.text
        pay_id = r.json()["id"]
        before = _wallet()
        r = client.post(f"/mock-payments/{pay_id}/execute", json={"simulate_failure": False})
        assert r.status_code == 409, r.text
        assert "INSUFFICIENT WALLET BALANCE" in r.json()["detail"]
        after = _wallet()
        assert after["balance"] == before["balance"]
        assert after["total_debited"] == before["total_debited"]
        # Payment stays retryable (CREATED), task stays APPROVED.
        r = client.get(f"/mock-payments/{pay_id}")
        assert r.json()["status"] == "CREATED"

    def test_replay_never_double_debits(self):
        agent, _m = _seed_domain(cap=2000)
        task = _approved_task(agent["id"], 500, merchant="Swiggy")
        done = _pay_and_execute(task["id"])
        first_balance = _wallet()["balance"]
        r = client.post(f"/mock-payments/{done['id']}/execute", json={"simulate_failure": False})
        assert r.status_code == 409, r.text
        assert _wallet()["balance"] == first_balance
        assert len([e for e in _ledger() if e["direction"] == "DEBIT"]) == 1

    def test_simulated_failure_does_not_debit(self):
        agent, _m = _seed_domain(cap=2000)
        task = _approved_task(agent["id"], 400, merchant="Swiggy")
        r = client.post("/mock-payments/create", json={"task_id": task["id"], "payment_method": "Demo Balance"})
        pay_id = r.json()["id"]
        before = _wallet()["balance"]
        r = client.post(f"/mock-payments/{pay_id}/execute", json={"simulate_failure": True})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "FAILED"
        assert _wallet()["balance"] == before
        assert len([e for e in _ledger() if e["direction"] == "DEBIT"]) == 0


class TestFinalAmount:
    def _new_payment(self, ceiling, merchant="Swiggy"):
        agent, _m = _seed_domain(cap=ceiling)
        task = _approved_task(agent["id"], ceiling, merchant=merchant)
        r = client.post("/mock-payments/create", json={"task_id": task["id"], "payment_method": "Demo Balance"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def test_final_below_ceiling_debits_actual(self):
        pay_id = self._new_payment(500)
        before = _wallet()["balance"]
        r = client.post(f"/mock-payments/{pay_id}/execute",
                        json={"simulate_failure": False, "actual_amount": 445,
                              "item_summary": "Paneer Biryani + Coke"})
        assert r.status_code == 200, r.text
        done = r.json()
        assert done["status"] == "SUCCEEDED"
        assert done["amount"] == 445.0
        assert done["actual_amount"] == 445.0
        assert done["authorized_amount"] == 500.0
        assert done["item_summary"] == "Paneer Biryani + Coke"
        assert done["wallet_balance_after"] == before - 445
        assert _wallet()["balance"] == before - 445
        debits = [e for e in _ledger() if e["direction"] == "DEBIT"]
        assert len(debits) == 1 and debits[0]["amount"] == 445.0

    def test_final_equal_to_ceiling_succeeds(self):
        pay_id = self._new_payment(500)
        before = _wallet()["balance"]
        r = client.post(f"/mock-payments/{pay_id}/execute",
                        json={"simulate_failure": False, "actual_amount": 500})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "SUCCEEDED"
        assert _wallet()["balance"] == before - 500

    def test_final_above_ceiling_fails_without_debit_or_completion(self):
        pay_id = self._new_payment(500)
        before = _wallet()
        r = client.post(f"/mock-payments/{pay_id}/execute",
                        json={"simulate_failure": False, "actual_amount": 530})
        assert r.status_code == 200, r.text
        failed = r.json()
        assert failed["status"] == "FAILED"
        assert "exceeds your" in failed["failure_reason"] and "530" in failed["failure_reason"]
        after = _wallet()
        assert after["balance"] == before["balance"]
        assert after["total_debited"] == before["total_debited"]
        assert len([e for e in _ledger() if e["direction"] == "DEBIT"]) == 0
        # Task stays APPROVED for its ceiling; correcting the actual retries cleanly.
        r = client.post(f"/mock-payments/{pay_id}/execute",
                        json={"simulate_failure": False, "actual_amount": 500})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "SUCCEEDED"
        assert _wallet()["balance"] == before["balance"] - 500

    def test_invalid_actual_rejected(self):
        pay_id = self._new_payment(500)
        for bad in (0, -10, 50_000_000, "lots"):
            r = client.post(f"/mock-payments/{pay_id}/execute",
                            json={"simulate_failure": False, "actual_amount": bad})
            assert r.status_code == 422, (bad, r.text)
        assert _wallet()["balance"] == 10000.0


class TestDemoReset:
    def test_reset_disabled_by_default(self):
        _clear_db()
        os.environ.pop("ALLOW_DEMO_RESET", None)
        r = client.post("/demo/reset")
        assert r.status_code == 403, r.text
        # Nothing wiped.
        assert _wallet()["balance"] == 10000.0

    def test_reset_enabled_wipes_and_restarts(self):
        agent, _m = _seed_domain(cap=2000)
        task = _approved_task(agent["id"], 300, merchant="Swiggy")
        _pay_and_execute(task["id"])
        os.environ["ALLOW_DEMO_RESET"] = "true"
        try:
            r = client.post("/demo/reset")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["reset"] is True
            assert body["wallet"]["balance"] == 10000.0
            assert body["wallet"]["total_debited"] == 0.0
            assert client.get("/agents").json() == []
            assert client.get("/transactions").json() == []
            assert _ledger()[0]["kind"] == "INITIAL"
        finally:
            os.environ.pop("ALLOW_DEMO_RESET", None)


class TestDemoSeedAgents:
    def test_guard_disabled_by_default(self):
        _clear_db()
        os.environ.pop("ALLOW_DEMO_RESET", None)
        r = client.post("/demo/seed-agents")
        assert r.status_code == 403, r.text
        assert client.get("/agents").json() == []

    def test_seeds_four_agents_idempotent(self):
        _clear_db()
        os.environ["ALLOW_DEMO_RESET"] = "true"
        try:
            r = client.post("/demo/seed-agents")
            assert r.status_code == 200, r.text
            body = r.json()
            assert len(body["seeded"]) == 4, body
            agents = {a["domain"]: a for a in client.get("/agents").json() if not a.get("is_task_agent")}
            assert set(agents) == {"FOOD", "TRAVEL", "SHOPPING", "BILLS"}, agents.keys()
            mandates = client.get("/mandates").json()
            caps = {m["agent_id"]: m["max_amount"] for m in mandates if m["status"] == "ACTIVE"}
            assert caps[agents["FOOD"]["id"]] == 1000.0
            assert caps[agents["TRAVEL"]["id"]] == 15000.0
            assert caps[agents["SHOPPING"]["id"]] == 5000.0
            assert caps[agents["BILLS"]["id"]] == 5000.0
            # Second call creates nothing.
            r = client.post("/demo/seed-agents")
            assert r.status_code == 200, r.text
            assert r.json()["seeded"] == [] and len(r.json()["existing"]) == 4
            # No transactions/tasks/payments were invented.
            assert client.get("/transactions").json() == []
            assert client.get("/tasks").json() == []
            assert _wallet()["balance"] == 10000.0
        finally:
            os.environ.pop("ALLOW_DEMO_RESET", None)

    def test_bills_domain_accepted(self):
        _clear_db()
        r = client.post("/agents", json={"name": "Bills Agent", "description": "t", "domain": "BILLS"})
        assert r.status_code == 201, r.text
        assert r.json()["domain"] == "BILLS"
