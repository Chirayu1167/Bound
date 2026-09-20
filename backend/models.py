from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text, Integer, Boolean
from sqlalchemy.sql import func
from backend.database import Base
import uuid
from datetime import datetime


def gen_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# Explicit user-facing domains. Stored on the agent so domain resolution never
# has to guess from names/purposes/categories (Phase 1 inference is retired).
# OTHER = unclassified or internal machinery (e.g. delegated executors).
VALID_DOMAINS = ("FOOD", "TRAVEL", "SHOPPING", "OTHER")


class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="ACTIVE")  # ACTIVE | REVOKED
    domain = Column(String, nullable=False, default="OTHER")  # FOOD | TRAVEL | SHOPPING | OTHER
    is_task_agent = Column(Boolean, nullable=False, default=False)  # True = ephemeral task machinery, hidden from user agent lists
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Mandate(Base):
    __tablename__ = "mandates"

    id = Column(String, primary_key=True, index=True)
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False, index=True)
    purpose = Column(String, nullable=False)  # e.g. Groceries
    max_amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    merchant_category = Column(String, nullable=False)  # e.g. Grocery
    expires_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="ACTIVE")  # ACTIVE | REVOKED | EXPIRED
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Delegation(Base):
    __tablename__ = "delegations"

    id = Column(String, primary_key=True, index=True)  # del-xxx
    parent_agent_id = Column(String, ForeignKey("agents.id"), nullable=False, index=True)
    child_agent_id = Column(String, ForeignKey("agents.id"), nullable=False, index=True)
    parent_mandate_id = Column(String, ForeignKey("mandates.id"), nullable=False, index=True)
    delegated_amount_limit = Column(Float, nullable=False)
    purpose = Column(String, nullable=False)  # e.g. Groceries
    merchant_category = Column(String, nullable=False)  # e.g. Grocery
    status = Column(String, nullable=False, default="ACTIVE")  # ACTIVE | REVOKED | EXPIRED
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String, primary_key=True, index=True)  # TX-xxx
    agent_id = Column(String, nullable=False, index=True)  # No FK — must allow nonexistent for audit (VERIFY)
    mandate_id = Column(String, ForeignKey("mandates.id"), nullable=True, index=True)
    delegation_id = Column(String, ForeignKey("delegations.id"), nullable=True, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    merchant = Column(String, nullable=False)
    merchant_category = Column(String, nullable=False)
    purpose = Column(String, nullable=False)
    decision = Column(String, nullable=False)  # ALLOW | VERIFY (final)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Risk fields — Phase 6 (deterministic, stored with transaction)
    authorization_status = Column(String, nullable=True)  # ALLOW | VERIFY (auth layer)
    risk_score = Column(Integer, nullable=True)
    risk_level = Column(String, nullable=True)  # LOW | MEDIUM | HIGH
    risk_factors = Column(Text, nullable=True)  # JSON array string


class ProvenanceEvent(Base):
    __tablename__ = "provenance_events"

    id = Column(String, primary_key=True, index=True)  # evt-xxx
    sequence_number = Column(Integer, nullable=False, unique=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    actor_agent_id = Column(String, nullable=True, index=True)  # No FK — allow nonexistent for audit
    parent_agent_id = Column(String, nullable=True, index=True)
    mandate_id = Column(String, nullable=True, index=True)
    delegation_id = Column(String, nullable=True, index=True)
    transaction_id = Column(String, nullable=True, index=True)
    decision = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    event_data = Column(Text, nullable=True)  # JSON string (canonical)
    previous_hash = Column(String, nullable=True)
    event_hash = Column(String, nullable=False, unique=True, index=True)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    key = Column(String, primary_key=True, index=True)
    request_hash = Column(String, nullable=False)
    response = Column(Text, nullable=False)  # JSON of AuthorizeResponse
    transaction_id = Column(String, ForeignKey("transactions.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Task(Base):
    """Phase 2 — one user request handled by a persistent domain agent.

    A task never grants authority by itself: the task_limit is enforced to be
    within the domain agent's effective authority at creation, and any payment
    still goes through the standard authorization + risk engine. COMPLETED is
    reserved for a future execution phase and is never written in Phase 2
    (there is no external payment execution yet).
    """

    __tablename__ = "tasks"

    id = Column(String, primary_key=True, index=True)  # task-xxx
    domain_agent_id = Column(String, ForeignKey("agents.id"), nullable=False, index=True)
    task_agent_id = Column(String, ForeignKey("agents.id"), nullable=True, index=True)
    purpose = Column(String, nullable=False)
    requested_amount = Column(Float, nullable=False)
    task_limit = Column(Float, nullable=False)  # <= domain agent effective authority
    category = Column(String, nullable=False)
    merchant = Column(String, nullable=False)
    status = Column(String, nullable=False, default="PENDING")  # PENDING | APPROVED | NEEDS_REVIEW | COMPLETED | CANCELLED | EXPIRED
    delegation_id = Column(String, ForeignKey("delegations.id"), nullable=True, index=True)
    transaction_id = Column(String, ForeignKey("transactions.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)


class Approval(Base):
    """Phase 2 — one-time user decision for a NEEDS_REVIEW task.

    The token is single-use, scope-bound (exact task + amount), and expiring.
    Resolving an approval NEVER modifies the standing mandate — it only
    flips this task's outcome. Only the SHA256 hash is stored; the plaintext
    token is returned exactly once at creation.
    """

    __tablename__ = "approvals"

    id = Column(String, primary_key=True, index=True)  # apr-xxx
    task_id = Column(String, ForeignKey("tasks.id"), nullable=False, unique=True, index=True)
    transaction_id = Column(String, ForeignKey("transactions.id"), nullable=True, index=True)
    amount = Column(Float, nullable=False)
    reason = Column(Text, nullable=False)
    risk_level = Column(String, nullable=True)
    token_hash = Column(String, nullable=False)
    status = Column(String, nullable=False, default="PENDING")  # PENDING | APPROVED | DENIED | EXPIRED
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class MockPayment(Base):
    """Phase 3 — simulated payment execution for an APPROVED task.

    Demo harness only: no funds move. One payment row per task (unique
    task_id) so duplicates are impossible at the DB level. Execution is
    gated on the task being APPROVED, fresh, and the domain agent ACTIVE —
    re-validated at execute time, not just at creation. Amount/merchant are
    snapshotted server-side from the task; the client can never set them.
    """

    __tablename__ = "mock_payments"

    id = Column(String, primary_key=True, index=True)  # pay-xxx
    task_id = Column(String, ForeignKey("tasks.id"), nullable=False, unique=True, index=True)
    transaction_id = Column(String, ForeignKey("transactions.id"), nullable=True, index=True)
    merchant = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    status = Column(String, nullable=False, default="CREATED")  # CREATED | PROCESSING | SUCCEEDED | FAILED
    payment_method = Column(String, nullable=False, default="Demo Balance")
    note = Column(Text, nullable=True)
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class Wallet(Base):
    """Demo wallet — backend-owned simulated funds (NOT a bank account).

    Singleton row (id "demo"). The frontend must never hardcode the balance;
    every number comes from GET /wallet. Payments debit atomically inside
    execute_mock_payment; top-ups credit via POST /wallet/topup.
    """

    __tablename__ = "wallet"

    id = Column(String, primary_key=True, index=True)  # always "demo"
    balance = Column(Float, nullable=False, default=10000)
    currency = Column(String, nullable=False, default="INR")
    total_credited = Column(Float, nullable=False, default=0)
    total_debited = Column(Float, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class WalletTransaction(Base):
    """Append-only demo-wallet ledger. Every debit/credit writes exactly one
    row with the resulting balance_after, so history and balance always agree.
    """

    __tablename__ = "wallet_transactions"

    id = Column(String, primary_key=True, index=True)  # wtx-xxx
    direction = Column(String, nullable=False, index=True)  # DEBIT | CREDIT
    kind = Column(String, nullable=False, default="PAYMENT")  # PAYMENT | TOPUP | INITIAL
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    balance_after = Column(Float, nullable=False)
    merchant = Column(String, nullable=True)
    agent_id = Column(String, nullable=True, index=True)  # No FK — allow revoked/missing for audit
    task_id = Column(String, ForeignKey("tasks.id"), nullable=True, index=True)
    payment_id = Column(String, ForeignKey("mock_payments.id"), nullable=True, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
