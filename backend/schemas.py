from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any
from datetime import datetime
import json


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, example="Shopping Agent")
    description: Optional[str] = Field(None, example="Handles grocery purchases")

    @field_validator("name", mode="before")
    @classmethod
    def check_name_not_whitespace(cls, v: Any):
        if isinstance(v, str) and not v.strip():
            raise ValueError("name must not be empty or whitespace only")
        return v

    @field_validator("name", mode="after")
    @classmethod
    def strip_name(cls, v: str):
        return v.strip() if isinstance(v, str) else v


class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Mandates
# ---------------------------------------------------------------------------
class MandateCreate(BaseModel):
    agent_id: str = Field(..., example="shopping-agent")
    purpose: str = Field(..., example="Groceries")
    max_amount: float = Field(..., gt=0, example=2000)
    currency: str = Field("INR", example="INR")
    merchant_category: str = Field(..., example="Grocery")
    expires_at: Optional[datetime] = Field(None, example="2026-09-20T00:00:00Z")
    # optional status override (defaults to ACTIVE)
    status: Optional[str] = Field(None, example="ACTIVE")


class MandateResponse(BaseModel):
    id: str
    agent_id: str
    purpose: str
    max_amount: float
    currency: str
    merchant_category: str
    expires_at: Optional[datetime] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Delegations
# ---------------------------------------------------------------------------
class DelegationCreate(BaseModel):
    parent_agent_id: str = Field(..., example="shopping-agent")
    child_agent_id: str = Field(..., example="payment-agent")
    parent_mandate_id: Optional[str] = Field(None, example="mnd-4091")
    delegated_amount_limit: float = Field(..., gt=0, example=1000)
    purpose: str = Field(..., example="Groceries")
    merchant_category: str = Field(..., example="Grocery")
    expires_at: Optional[datetime] = Field(None, example="2026-10-20T00:00:00Z")


class DelegationResponse(BaseModel):
    id: str
    parent_agent_id: str
    child_agent_id: str
    parent_mandate_id: str
    delegated_amount_limit: float
    purpose: str
    merchant_category: str
    status: str
    created_at: datetime
    expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DelegationChainItem(BaseModel):
    step: str  # User | Root Mandate | Agent A | Agent B
    id: Optional[str] = None
    name: Optional[str] = None
    detail: Optional[str] = None


class DelegationChainResponse(BaseModel):
    delegation_id: Optional[str] = None
    chain: list[DelegationChainItem]
    root_mandate: Optional[MandateResponse] = None
    delegation: Optional[DelegationResponse] = None


# ---------------------------------------------------------------------------
# Risk
# ---------------------------------------------------------------------------
class RiskFactor(BaseModel):
    type: str
    severity: str  # LOW | MEDIUM | HIGH
    message: str


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
class TransactionResponse(BaseModel):
    id: str
    agent_id: str
    mandate_id: Optional[str] = None
    delegation_id: Optional[str] = None
    amount: float
    currency: str
    merchant: str
    merchant_category: str
    purpose: str
    decision: str
    reason: str
    created_at: datetime
    authorization_status: Optional[str] = None
    risk_score: Optional[int] = None
    risk_level: Optional[str] = None
    risk_factors: Optional[list[RiskFactor]] = None

    class Config:
        from_attributes = True

    @field_validator("risk_factors", mode="before")
    @classmethod
    def parse_risk_factors(cls, v: Any):
        if v is None:
            return None
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
                return None
            except:
                return None
        return v


class AuthorizeRequest(BaseModel):
    agent_id: str = Field(..., example="shopping-agent")
    amount: float = Field(..., gt=0, example=800)
    merchant: str = Field(..., example="ABC Supermarket")
    merchant_category: str = Field(..., example="Grocery")
    purpose: str = Field(..., example="Groceries")
    currency: Optional[str] = Field("INR", example="INR")
    idempotency_key: Optional[str] = Field(None, example="idem-123", description="Client-provided idempotency key")

    @field_validator("idempotency_key", mode="before")
    @classmethod
    def strip_idempotency_key(cls, v: Any):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return None
            if len(v) > 64:
                raise ValueError("idempotency_key must be <= 64 characters")
        return v


class AuthorizeResponse(BaseModel):
    transaction_id: str
    decision: str  # final decision (ALLOW/VERIFY) — kept for compat
    reason: str
    delegation_id: Optional[str] = None
    chain: Optional[list[DelegationChainItem]] = None
    mandate_id: Optional[str] = None
    # Phase 6 — risk + authorization separation
    authorization_status: Optional[str] = None  # ALLOW | VERIFY (auth layer)
    authorization_reason: Optional[str] = None
    risk_score: Optional[int] = None
    risk_level: Optional[str] = None
    risk_factors: Optional[list[RiskFactor]] = None
    final_decision: Optional[str] = None


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------
class ProvenanceEventResponse(BaseModel):
    id: str
    sequence_number: int
    event_type: str
    timestamp: datetime
    actor_agent_id: Optional[str] = None
    parent_agent_id: Optional[str] = None
    mandate_id: Optional[str] = None
    delegation_id: Optional[str] = None
    transaction_id: Optional[str] = None
    decision: Optional[str] = None
    reason: Optional[str] = None
    event_data: Optional[str] = None
    previous_hash: Optional[str] = None
    event_hash: str

    class Config:
        from_attributes = True


class ProvenanceVerifyResponse(BaseModel):
    valid: bool
    events_checked: int
    first_event: Optional[str] = None
    last_event: Optional[str] = None
    first_hash: Optional[str] = None
    last_hash: Optional[str] = None
    message: Optional[str] = None
    broken_event_id: Optional[str] = None
    reason: Optional[str] = None
    expected_previous: Optional[str] = None
    actual_previous: Optional[str] = None
    expected_hash: Optional[str] = None
    actual_hash: Optional[str] = None


# ---------------------------------------------------------------------------
# Merchant Reputation — Phase 7 (adapted from Iron scam_registry)
# ---------------------------------------------------------------------------
class MerchantReportRequest(BaseModel):
    merchant: str = Field(..., example="BadMerchant")
    reason: str = Field("Reported via Bound", example="Suspicious merchant")
    reporter: str = Field("anonymous", example="tester")


class MerchantReputationResponse(BaseModel):
    merchant: str
    known: bool
    reported: bool
    report_count: int
    reputation: str
    confidence: float
    recency_days: Optional[int] = None
    evidence: Optional[dict] = None
    tier: str
    signals: Optional[list] = None
