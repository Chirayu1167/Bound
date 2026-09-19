"""
fraud_rules.py — Generic deterministic rules for Bound (adapted from Iron)

Only generic/adaptable rules that make sense for AI-agent payments.
Each rule is immutable, explainable, and has stable id.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Optional

class PatternCategory(str, Enum):
    AMOUNT = "AMOUNT"
    RECIPIENT = "RECIPIENT"
    TIMING = "TIMING"
    VELOCITY = "VELOCITY"
    BALANCE = "BALANCE"
    BEHAVIOURAL = "BEHAVIOURAL"

class Severity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

@dataclass(frozen=True)
class FraudRule:
    id: str
    name: str
    category: PatternCategory
    severity: Severity
    base_weight: float
    description: str
    user_message: str
    amount_multiplier: Optional[float] = None
    balance_drain_pct: Optional[float] = None
    velocity_count: Optional[int] = None
    velocity_window_min: Optional[int] = None
    hour_start: Optional[int] = None
    hour_end: Optional[int] = None
    round_amount_min: Optional[float] = None

# Generic subset (12 rules) — only those that are not UPI-specific
ALL_RULES: list[FraudRule] = [
    FraudRule(
        id="HIGH_AMOUNT", name="High Amount",
        category=PatternCategory.AMOUNT, severity=Severity.MEDIUM, base_weight=10.0, amount_multiplier=2.5,
        description="Amount exceeds 2.5× the agent's historical average.",
        user_message="Amount is significantly above this agent's typical spending.",
    ),
    FraudRule(
        id="EXTREME_AMOUNT", name="Extreme Amount",
        category=PatternCategory.AMOUNT, severity=Severity.HIGH, base_weight=18.0, amount_multiplier=6.0,
        description="Amount exceeds 6× the agent's average — rare even for legitimate high-value payments.",
        user_message="This amount is far outside the agent's normal transaction range.",
    ),
    FraudRule(
        id="ROUND_AMOUNT_LARGE", name="Suspiciously Round Amount",
        category=PatternCategory.AMOUNT, severity=Severity.LOW, base_weight=5.0, round_amount_min=10_000.0,
        description="Large round-number amounts (₹10k / ₹50k / ₹1L) are commonly dictated by scam instructions.",
        user_message="Large round-number payment — commonly seen in scam requests.",
    ),
    FraudRule(
        id="NEW_MERCHANT", name="New Merchant",
        category=PatternCategory.RECIPIENT, severity=Severity.MEDIUM, base_weight=12.0,
        description="Merchant has never been paid by this agent.",
        user_message="This merchant has never been paid by this agent before.",
    ),
    FraudRule(
        id="REPORTED_MERCHANT", name="Reported Merchant",
        category=PatternCategory.RECIPIENT, severity=Severity.CRITICAL, base_weight=25.0,
        description="Merchant has ≥1 fraud report from Bound network.",
        user_message="This merchant has been flagged by the network for suspicious activity.",
    ),
    FraudRule(
        id="HIGH_RISK_MERCHANT", name="High-Risk Merchant",
        category=PatternCategory.RECIPIENT, severity=Severity.CRITICAL, base_weight=28.0,
        description="Merchant has 3+ fraud reports — strongly correlated with fraud.",
        user_message="Multiple reports flag this merchant as high-risk.",
    ),
    FraudRule(
        id="ODD_HOUR", name="Odd Hour",
        category=PatternCategory.TIMING, severity=Severity.HIGH, base_weight=14.0, hour_start=1, hour_end=5,
        description="Transaction between 1–5 AM — prime takeover window.",
        user_message="Transaction at an unusual hour (1–5 AM).",
    ),
    FraudRule(
        id="LATE_NIGHT", name="Late Night",
        category=PatternCategory.TIMING, severity=Severity.LOW, base_weight=5.0, hour_start=23, hour_end=1,
        description="Transaction after 11 PM. Mild alone; amplified with other signals.",
        user_message="Transaction after 11 PM — slightly outside normal hours.",
    ),
    FraudRule(
        id="HIGH_VELOCITY_5M", name="Rapid Transactions (5 min)",
        category=PatternCategory.VELOCITY, severity=Severity.HIGH, base_weight=16.0, velocity_count=3, velocity_window_min=5,
        description="3+ transactions in <5 minutes — automated attack signature.",
        user_message="Multiple transactions in a very short time — possible automated activity.",
    ),
    FraudRule(
        id="HIGH_VELOCITY_1H", name="High Volume (1 hour)",
        category=PatternCategory.VELOCITY, severity=Severity.MEDIUM, base_weight=10.0, velocity_count=6, velocity_window_min=60,
        description="6+ transactions within one hour.",
        user_message="Unusually high number of transactions in the past hour.",
    ),
    FraudRule(
        id="RECIPIENT_SWITCHING", name="Rapid Merchant Switching",
        category=PatternCategory.VELOCITY, severity=Severity.HIGH, base_weight=15.0, velocity_count=3, velocity_window_min=30,
        description="3+ different merchants in 30 min — drain pattern.",
        user_message="Paying multiple different merchants in quick succession.",
    ),
    FraudRule(
        id="BALANCE_DRAIN_HIGH", name="High Effective-Limit Drain",
        category=PatternCategory.BALANCE, severity=Severity.MEDIUM, base_weight=10.0, balance_drain_pct=0.40,
        description="Transaction consumes 40–69% of effective authorization limit.",
        user_message="This payment uses a large portion of its authorized limit.",
    ),
    FraudRule(
        id="BALANCE_DRAIN_CRITICAL", name="Critical Limit Drain",
        category=PatternCategory.BALANCE, severity=Severity.CRITICAL, base_weight=22.0, balance_drain_pct=0.70,
        description="Transaction would consume 70%+ of effective limit — drain signature.",
        user_message="This payment would drain most of its authorized limit in one transaction.",
    ),
    FraudRule(
        id="SEQUENTIAL_AMOUNTS", name="Sequential Amount Pattern",
        category=PatternCategory.BEHAVIOURAL, severity=Severity.HIGH, base_weight=16.0,
        description="Recent transactions show incrementing amounts — testing technique.",
        user_message="Recent transactions follow a suspicious incremental pattern.",
    ),
]

RULES_BY_ID: dict[str, FraudRule] = {r.id: r for r in ALL_RULES}
