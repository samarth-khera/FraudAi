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


# ------------------------------------------------------------------------------
# 5. ML Models Schemas
# ------------------------------------------------------------------------------

class FeatureContribution(BaseModel):
    feature_name: str
    feature_value: float
    contribution_score: float = Field(..., description="TreeSHAP local attribution contribution")
    impact_direction: str = Field(..., description="'increases_risk' or 'decreases_risk'")


class AccountMLAssessmentResponse(BaseModel):
    account_id: str
    risk_score: float = Field(..., ge=0.0, le=100.0, description="Calibrated ML risk score (0-100)")
    risk_level: str = Field(..., description="'low', 'elevated', 'high', or 'critical'")
    predicted_probability: float = Field(..., ge=0.0, le=1.0, description="Model output probability of suspicious role")
    predicted_class: str = Field(..., description="'suspicious' or 'legitimate'")
    model_version: str
    model_type: str
    top_contributions: list[FeatureContribution] = Field(..., description="Top genuine TreeSHAP feature contributors")
    observable_features: dict[str, float] = Field(..., description="Raw observable feature values used for inference")
    disclaimer: str = Field(..., description="Mandatory synthetic evaluation disclaimer and non-punitive guardrail")


class SingleModelInfo(BaseModel):
    available: bool
    version: Optional[str] = None
    model_type: Optional[str] = None
    features_count: Optional[int] = None
    trained_at: Optional[str] = None
    test_metrics: Optional[dict[str, Any]] = None
    limitations: Optional[str] = None


class ModelStatusResponse(BaseModel):
    account_model: SingleModelInfo
    paysim_benchmark: SingleModelInfo
    overall_status: str
    inference_ready: bool
    disclaimer: str


# ------------------------------------------------------------------------------
# 6. Live Analysis & Recommendation Schemas
# ------------------------------------------------------------------------------

class RecommendedAction(BaseModel):
    action_id: str
    title: str
    priority: str = Field(..., description="'high_priority', 'recommended', 'routine', or 'more_evidence_needed'")
    action_type: str = Field(..., description="Action classification identifier")
    rationale: str = Field(..., description="Plain-English explanation of why this action is recommended")
    supporting_evidence: str = Field(..., description="Observed transaction, signal, or ratio supporting this action")
    suggested_records: str = Field(..., description="Additional institutional or external records that would clarify the case")
    remaining_uncertainty: str = Field(..., description="Blind spots or missing context that prevent conclusive assessment")


class LedgerSnapshotInfo(BaseModel):
    transactions_examined: int
    latest_transaction_timestamp: Optional[str] = None
    first_transaction_timestamp: Optional[str] = None
    total_received: float
    total_sent: float
    current_balance: float


class ModelDivergenceInfo(BaseModel):
    divergence_detected: bool
    ml_score: float
    rule_score: float
    score_delta: float
    interpretation: str
    suggested_focus: str


class AccountLiveAnalysisResponse(BaseModel):
    analysis_id: str
    account_id: str
    analyzed_at: str
    model_version: str
    ledger_snapshot: LedgerSnapshotInfo
    rule_assessment: AccountAssessmentResponse
    ml_assessment: AccountMLAssessmentResponse
    divergence: ModelDivergenceInfo
    recommended_actions: list[RecommendedAction]
    evidence_gaps: list[str]
    human_review_recommended: bool
    disclaimer: str

