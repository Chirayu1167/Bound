from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text, Integer
from sqlalchemy.sql import func
from backend.database import Base
import uuid
from datetime import datetime


def gen_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="ACTIVE")  # ACTIVE | REVOKED
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
