"""Pydantic schemas for case management, reviews, and audit trails."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.domain import (
    AccountReviewStatus,
    AccountRole,
    EvidenceQuality,
    FundTracePath,
    InvestigationStatus,
    Money,
    ReviewState,
    Transaction,
)
from app.schemas.trace import TracedTransaction, TraceWarning


class CaseCreateRequest(BaseModel):
    case_id: str = Field(min_length=1, max_length=50, description="Unique case identifier.")
    reported_origin_transaction_id: str = Field(min_length=1, max_length=50)
    reported_amount: Money = Field(gt=0, description="Reported fraud amount.")
    currency: str = Field(default="INR", max_length=10)
    reported_at: Optional[datetime] = None
    investigation_status: InvestigationStatus = InvestigationStatus.UNDER_INVESTIGATION
    description: str = Field(min_length=1, description="Summary description of the reported case.")
    created_by: str = Field(default="analyst_placeholder", description="Reviewer/system creating the case.")


class CaseUpdateRequest(BaseModel):
    description: Optional[str] = Field(default=None, min_length=1)
    investigation_status: Optional[InvestigationStatus] = None
    updated_by: str = Field(default="analyst_placeholder", description="Reviewer identity.")


class AccountReviewUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_state: ReviewState
    evidence_quality: EvidenceQuality = EvidenceQuality.NOT_ASSESSED
    notes: Optional[str] = None
    reviewer_id: str = Field(default="analyst_placeholder", min_length=1, max_length=100, description="Reviewer identity.")
    decision_reasons: list[str] = Field(
        default_factory=list,
        description="Structured reasons for the human review decision.",
    )
    supporting_transaction_ids: list[str] = Field(
        default_factory=list,
        description="Transaction IDs cited by the reviewer in support of this assessment.",
    )
    additional_info_needed: bool = Field(
        default=False,
        description="Whether additional external verification (e.g. KYC, invoice, bank statement) is still needed.",
    )


class CaseTransactionsAddRequest(BaseModel):
    transactions: list[Transaction] = Field(min_length=1)
    added_by: str = Field(default="system", description="Reviewer/system identity adding transactions.")


class AuditEventResponse(BaseModel):
    event_id: Optional[int] = None
    case_id: str
    timestamp: datetime
    action: str
    performed_by: str
    entity_type: str
    entity_id: str
    details: Optional[dict[str, Any]] = None


class AuditTrailResponse(BaseModel):
    case_id: str
    count: int
    events: list[AuditEventResponse]


class AuditSummaryMetrics(BaseModel):
    total_events: int
    review_decisions_count: int
    case_status_changes_count: int
    trace_events_count: int
    most_recent_timestamp: Optional[datetime] = None
    earliest_timestamp: Optional[datetime] = None
    distinct_cases_count: int
    distinct_actors_count: int


class AuditIntegrityStatus(BaseModel):
    storage_backend: str = "SQLite Relational (audit_events)"
    append_only_enforced: bool = True
    cryptographic_signatures: bool = False
    server_timestamps: bool = True
    last_verified_at: datetime
    integrity_disclosure: str = (
        "Application-enforced append-only audit trail in SQLite. "
        "Server-generated UTC timestamps. No cryptographic hash-chaining or WORM hardware."
    )


class GlobalAuditResponse(BaseModel):
    total_count: int
    filtered_count: int
    skip: int
    limit: int
    events: list[AuditEventResponse]
    summary: AuditSummaryMetrics
    integrity_status: AuditIntegrityStatus


# --------------------------------------------------------------------------
# Evidence-Aware Downstream Account Assessment Schemas
# --------------------------------------------------------------------------
class AccountGraphPosition(BaseModel):
    account_id: str
    label: str
    role: AccountRole
    is_synthetic: bool = True
    in_traced_network: bool
    connection_type: str = Field(
        description="'reporting_victim', 'origin_receiver', 'direct', 'indirect', or 'not_in_downstream_trace'."
    )
    hop_count: Optional[int] = Field(
        default=None,
        description="Minimum downstream hops from the initial receiver (0 = initial receiver, null if origin sender or untraceable).",
    )
    upstream_account_ids: list[str] = Field(default_factory=list)
    downstream_account_ids: list[str] = Field(default_factory=list)
    path_ids: list[str] = Field(default_factory=list)
    first_received_at: Optional[datetime] = None
    last_observed_activity_at: Optional[datetime] = None


class AccountObservedMovement(BaseModel):
    """Gross observed ledger transfers involving this account. Kept strictly separate from traceable exposure."""

    observed_inbound_value: Money = Field(description="Gross sum of traced inbound transactions to this account.")
    observed_outbound_value: Money = Field(description="Gross sum of traced outbound transactions from this account.")
    traced_inbound_count: int
    traced_outbound_count: int
    traced_inbound_transactions: list[TracedTransaction] = Field(default_factory=list)
    traced_outbound_transactions: list[TracedTransaction] = Field(default_factory=list)
    other_observed_inbound_count: int = Field(
        default=0,
        description="Non-downstream inbound transactions present in the dataset (e.g. prior to origin timestamp).",
    )
    other_observed_outbound_count: int = Field(
        default=0,
        description="Non-downstream outbound transactions present in the dataset.",
    )
    movement_note: str


class AccountTraceableExposure(BaseModel):
    """Lineage-bounded fund exposure. Never sums downstream hops to inflate stolen totals."""

    reported_case_amount: Money
    case_traceable_amount: Money
    gross_network_observed_value: Money
    attributed_inbound_amount: Optional[Money] = None
    attributed_outbound_amount: Optional[Money] = None
    attributed_unforwarded_amount: Optional[Money] = None
    attribution_status: str = Field(
        description="'explicit', 'uncertain_missing_lineage', 'ambiguous_over_attribution', 'not_applicable_origin_sender', or 'no_traced_exposure'."
    )
    attribution_basis: Optional[str] = None
    attribution_assumptions: list[str] = Field(default_factory=list)
    double_counting_safeguard: str


class AccountSignal(BaseModel):
    """Observed structural or timing pattern. Describes ledger mechanics only, never criminal intent."""

    code: str
    title: str
    description: str
    related_transaction_ids: list[str] = Field(default_factory=list)
    interpretation_note: str


class AccountSupportingEvidence(BaseModel):
    evidence_type: str
    summary: str
    related_transaction_ids: list[str] = Field(default_factory=list)


class AccountEvidenceAssessment(BaseModel):
    """Explicit assessment of evidence availability, uncertainty, and missing lineage."""

    evidence_sufficiency: str = Field(
        description="'insufficient_evidence', 'graph_connection_only', 'scenario_lineage_assumed', or 'human_review_corroborated'."
    )
    supporting_evidence: list[AccountSupportingEvidence] = Field(default_factory=list)
    evidence_gaps: list[str] = Field(default_factory=list)
    uncertainty_factors: list[str] = Field(default_factory=list)
    verification_guidance: list[str] = Field(default_factory=list)
    recommended_review_state: ReviewState
    recommendation_rationale: str


class AccountAssessmentResponse(BaseModel):
    """Complete evidence-aware assessment for a single account in a case.

    Strictly separates:
    1. Transaction fraud-risk score context (`transaction_risk_separation_note`)
    2. Observed transaction movement (`observed_movement`)
    3. Traceable fund exposure (`traceable_exposure`)
    4. Evidence quality & uncertainty (`evidence_assessment`)
    5. Account review status (`review_status`)
    6. Human investigation outcome & audit trail (`audit_history`)
    """

    case_id: str
    account_id: str
    graph_position: AccountGraphPosition
    observed_movement: AccountObservedMovement
    traceable_exposure: AccountTraceableExposure
    observed_signals: list[AccountSignal] = Field(default_factory=list)
    paths_involving_account: list[FundTracePath] = Field(default_factory=list)
    evidence_assessment: AccountEvidenceAssessment
    review_status: AccountReviewStatus
    audit_history: list[AuditEventResponse] = Field(default_factory=list)
    warnings: list[TraceWarning] = Field(default_factory=list)
    transaction_risk_separation_note: str
    automated_action_taken: str = "none"
    decision_support_only: bool = True
    disclaimer: str


class CaseAccountAssessmentsResponse(BaseModel):
    case_id: str
    count: int
    assessments: list[AccountAssessmentResponse]
    disclaimer: str

