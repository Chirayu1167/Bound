from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any
from datetime import datetime
import json


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
VALID_AGENT_DOMAINS = ("FOOD", "TRAVEL", "SHOPPING", "BILLS", "OTHER")


class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, example="Shopping Agent")
    description: Optional[str] = Field(None, example="Handles grocery purchases")
    domain: Optional[str] = Field(None, example="FOOD")

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

    @field_validator("domain", mode="before")
    @classmethod
    def normalize_domain(cls, v: Any):
        if v is None or (isinstance(v, str) and not v.strip()):
            return "OTHER"
        norm = str(v).strip().upper()
        if norm not in VALID_AGENT_DOMAINS:
            raise ValueError(f"domain must be one of {VALID_AGENT_DOMAINS}")
        return norm


class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: str
    domain: str = "OTHER"
    is_task_agent: bool = False
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
# Tasks + Approvals — Phase 2
# ---------------------------------------------------------------------------
TASK_TTL_HOURS = 6

VALID_TASK_STATUSES = ("PENDING", "APPROVED", "NEEDS_REVIEW", "COMPLETED", "CANCELLED", "EXPIRED")
VALID_APPROVAL_STATUSES = ("PENDING", "APPROVED", "DENIED", "EXPIRED")


def _strip_non_empty(v: Any, field_name: str) -> Any:
    if isinstance(v, str):
        v = v.strip()
        if not v:
            raise ValueError(f"{field_name} must not be empty or whitespace only")
    return v


class TaskAuthorizeRequest(BaseModel):
    domain_agent_id: str = Field(..., example="shopping-agent")
    purpose: str = Field(..., min_length=1, max_length=200, example="Dinner")
    requested_amount: float = Field(..., gt=0, example=800)
    category: str = Field(..., min_length=1, max_length=100, example="Grocery")
    merchant: str = Field(..., min_length=1, max_length=200, example="Swiggy")
    currency: Optional[str] = Field("INR", example="INR")
    idempotency_key: Optional[str] = Field(None, example="task-idem-123")

    @field_validator("purpose", "category", "merchant", mode="before")
    @classmethod
    def check_text_fields(cls, v: Any):
        return _strip_non_empty(v, "field")

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


class ApprovalResponse(BaseModel):
    id: str
    task_id: str
    transaction_id: Optional[str] = None
    amount: float
    reason: str
    risk_level: Optional[str] = None
    status: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TaskResponse(BaseModel):
    id: str
    domain_agent_id: str
    task_agent_id: Optional[str] = None
    purpose: str
    requested_amount: float
    task_limit: float
    category: str
    merchant: str
    status: str
    delegation_id: Optional[str] = None
    transaction_id: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    # Engine outcome for this task (ALLOW = approved, VERIFY = needs review)
    decision: Optional[str] = None
    reason: Optional[str] = None
    authorization_status: Optional[str] = None
    risk_score: Optional[int] = None
    risk_level: Optional[str] = None

    class Config:
        from_attributes = True


class TaskAuthorizeResponse(BaseModel):
    task: TaskResponse
    approval: Optional[ApprovalResponse] = None
    # Plaintext one-time token — returned EXACTLY ONCE at creation when an
    # approval is required. Never stored, never returned again.
    approval_token: Optional[str] = None


class ApprovalResolveRequest(BaseModel):
    token: str = Field(..., min_length=1, example="opaque-token")
    action: str = Field(..., example="approve")

    @field_validator("action", mode="before")
    @classmethod
    def check_action(cls, v: Any):
        norm = str(v).strip().lower() if isinstance(v, str) else v
        if norm not in ("approve", "deny"):
            raise ValueError("action must be 'approve' or 'deny'")
        return norm


# ---------------------------------------------------------------------------
# Mock payments — Phase 3 (simulated execution for APPROVED tasks only)
# ---------------------------------------------------------------------------
VALID_MOCK_PAYMENT_STATUSES = ("CREATED", "PROCESSING", "SUCCEEDED", "FAILED")
VALID_MOCK_PAYMENT_METHODS = ("Demo Balance",)


class MockPaymentCreate(BaseModel):
    task_id: str = Field(..., min_length=1, example="task-abc123")
    payment_method: str = Field("Demo Balance", example="Demo Balance")
    note: Optional[str] = Field(None, max_length=200, example="Dinner")

    @field_validator("payment_method", mode="before")
    @classmethod
    def check_method(cls, v: Any):
        norm = str(v).strip() if isinstance(v, str) else v
        if norm not in VALID_MOCK_PAYMENT_METHODS:
            raise ValueError(f"payment_method must be one of {VALID_MOCK_PAYMENT_METHODS}")
        return norm


class MockPaymentExecute(BaseModel):
    # Demo-harness control for exercising the failure path in tests/demos.
    # The UI never sends this; production behavior is always success.
    simulate_failure: bool = Field(False, example=False)
    # Final order amount actually charged. Optional — defaults to the task's
    # authorized ceiling. The backend rejects (no debit, no completion) any
    # value above the ceiling; the frontend must never enforce this itself.
    actual_amount: Optional[float] = Field(None, example=445)
    # Short order summary shown on orders/receipts (e.g. "Paneer Biryani + Coke").
    item_summary: Optional[str] = Field(None, max_length=200, example="Paneer Biryani + Coke")

    @field_validator("actual_amount", mode="before")
    @classmethod
    def check_actual_amount(cls, v: Any):
        if v is None:
            return None
        try:
            amount = float(v)
        except (TypeError, ValueError):
            raise ValueError("actual_amount must be a number")
        if not amount > 0:
            raise ValueError("actual_amount must be greater than zero")
        if amount > 10_000_000:
            raise ValueError("actual_amount is unrealistically large")
        return round(amount, 2)

    @field_validator("item_summary", mode="before")
    @classmethod
    def check_item_summary(cls, v: Any):
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("item_summary must be text")
        v = v.strip()
        return v[:200] if v else None


class MockPaymentResponse(BaseModel):
    id: str
    task_id: str
    transaction_id: Optional[str] = None
    merchant: str
    amount: float
    currency: str
    status: str
    payment_method: str
    note: Optional[str] = None
    failure_reason: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    # Demo-wallet balance after this payment debited, None until SUCCEEDED.
    wallet_balance_after: Optional[float] = None
    # Final amount actually charged (None until execution resolves it).
    actual_amount: Optional[float] = None
    # Authorization ceiling this charge was validated against.
    authorized_amount: Optional[float] = None
    # User-supplied order summary, if any.
    item_summary: Optional[str] = None

    class Config:
        from_attributes = True


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


# ---------------------------------------------------------------------------
# AI intent assist — optional Groq layer (suggestion only, never authority)
# ---------------------------------------------------------------------------
class AiInterpretRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500, example="Order me dinner under ₹800")

    @field_validator("text", mode="before")
    @classmethod
    def check_text(cls, v: Any):
        return _strip_non_empty(v, "text")


class AiInterpretResponse(BaseModel):
    domain: Optional[str] = None
    purpose: Optional[str] = None
    budget: Optional[float] = None
    merchant: Optional[str] = None
    category: Optional[str] = None
    explanation: Optional[str] = None
    groq: bool = False
    signals: Optional[list] = None


# ---------------------------------------------------------------------------
# Demo wallet — backend-owned simulated funds (NOT a bank account)
# ---------------------------------------------------------------------------
class WalletResponse(BaseModel):
    balance: float
    currency: str
    total_credited: float
    total_debited: float
    transaction_count: int
    updated_at: Optional[datetime] = None


class WalletTransactionResponse(BaseModel):
    id: str
    direction: str
    kind: str
    amount: float
    currency: str
    balance_after: float
    merchant: Optional[str] = None
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    payment_id: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class WalletTopupRequest(BaseModel):
    amount: float = Field(..., gt=0, le=100000, example=5000)

    @field_validator("amount", mode="before")
    @classmethod
    def check_topup_amount(cls, v: Any):
        try:
            amount = float(v)
        except (TypeError, ValueError):
            raise ValueError("amount must be a number")
        if not (0 < amount <= 100000):
            raise ValueError("amount must be between 1 and 100000")
        return round(amount, 2)


class DemoResetResponse(BaseModel):
    reset: bool
    deleted: dict
    wallet: WalletResponse
