"""Pydantic request and response schemas for FraudShield AI V2 APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ------------------------------------------------------------------------------
# 1. Account Profile Schemas
# ------------------------------------------------------------------------------

class AccountSummaryMetrics(BaseModel):
    total_incoming_txns: int = Field(..., description="Total count of incoming credits")
    total_outgoing_txns: int = Field(..., description="Total count of outgoing debits")
    total_incoming_amount: float = Field(..., description="Total aggregate currency credited")
    total_outgoing_amount: float = Field(..., description="Total aggregate currency debited")
    net_flow: float = Field(..., description="Net flow (incoming minus outgoing)")
    unique_counterparties: int = Field(..., description="Number of distinct counterparties transacted with")
    first_activity_at: Optional[str] = Field(None, description="Timestamp of first observed transaction")
    last_activity_at: Optional[str] = Field(None, description="Timestamp of most recent observed transaction")


class AccountProfileResponse(BaseModel):
    account_id: str
    customer_name: str
    customer_type: str
    kyc_tier: str
    phone_number: str
    email: str
    upi_id: str
    tax_identifier: str
    initial_balance: float
    current_balance: float
    account_opened_at: str
    status: str
    metrics: AccountSummaryMetrics


# ------------------------------------------------------------------------------
# 2. Transaction List Schemas
# ------------------------------------------------------------------------------

class TransactionItem(BaseModel):
    transaction_id: str
    timestamp: str
    origin_account_id: str
    destination_account_id: str
    amount: float
    currency: str
    channel: str
    status: str
    origin_balance_before: float
    origin_balance_after: float
    dest_balance_before: float
    dest_balance_after: float
    direction: str = Field(..., description="'inbound' or 'outbound' relative to the queried account")
    counterparty_account_id: str


class AccountTransactionsResponse(BaseModel):
    account_id: str
    total: int
    limit: int
    offset: int
    transactions: list[TransactionItem]


# ------------------------------------------------------------------------------
# 3. Risk Assessment Schemas
# ------------------------------------------------------------------------------

class RiskSignalValues(BaseModel):
    total_transactions: int
    velocity_24h_count: int
    velocity_7d_count: int
    velocity_30d_count: int
    flow_through_ratio: float
    rapid_pass_through: bool
    median_dwell_minutes: Optional[float]
    max_amount: float
    avg_amount: float
    amount_spike_ratio: float
    unique_counterparties: int
    counterparty_diversity_ratio: float
    fan_in_ratio: float
    fan_out_ratio: float
    dormancy_gap_days: Optional[float]
    dormant_awakening_detected: bool
    cycle_detected: bool


class AccountAssessmentResponse(BaseModel):
    account_id: str
    risk_score: float = Field(..., ge=0.0, le=100.0, description="Advisory behavioral risk score (0-100)")
    risk_level: str = Field(..., description="'low', 'elevated', 'high', or 'critical'")
    signals: RiskSignalValues
    reason_codes: list[str] = Field(..., description="Explainable natural-language contributing factors")
    evidence_gaps: list[str] = Field(..., description="Known data omissions and institutional blind spots")
    uncertainty_rating: str = Field(..., description="'low', 'medium', or 'high'")
    recommendation: str = Field(..., description="Advisory compliance review recommendation")
    disclaimer: str = Field(..., description="Regulatory guardrail notification")


# ------------------------------------------------------------------------------
# 4. Forensic Graph & Fund Tracing Schemas
# ------------------------------------------------------------------------------

class GraphNode(BaseModel):
    account_id: str
    customer_name: str
    customer_type: str
    kyc_tier: str
    current_balance: float
    hop_distance: int
    is_root: bool


class GraphEdge(BaseModel):
    transaction_id: str
    origin_account_id: str
    destination_account_id: str
    amount: float
    currency: str
    channel: str
    timestamp: str
    hop: int
    is_cycle: bool


class TraceGraphResponse(BaseModel):
    root_account_id: str
    direction: str
    max_depth_configured: int
    max_depth_reached: int
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    total_nodes: int
    total_edges: int
    is_truncated: bool
    truncation_reason: Optional[str]
    observed_total_transferred: float
    attributed_exposure_upper_bound: float
    attribution_status: str
    attribution_disclaimer: str
