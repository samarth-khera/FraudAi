"""Request/response contract for user-triggered investigations (POST /api/v2/investigations)."""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

try:
    from app.api.v2.schemas import AccountAssessmentResponse, AccountMLAssessmentResponse
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import AccountAssessmentResponse, AccountMLAssessmentResponse

AccountRole = Literal[
    "victim_candidate",
    "possible_intermediary",
    "recipient_under_review",
    "sender_under_review",
    "insufficient_evidence",
    "not_analyzed",
]
FindingKind = Literal["observed", "rule", "model", "limitation"]


class InvestigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_id: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-\.]+$",
                            description="Account to investigate, as entered by the investigator")
    start_date: Optional[date] = Field(None, description="Only the account's own transfers on or after this date seed the trace")
    end_date: Optional[date] = Field(None, description="Only the account's own transfers on or before this date seed the trace")
    max_depth: int = Field(3, ge=1, le=6, description="Maximum hops followed from the account in each direction")
    max_nodes: int = Field(200, ge=2, le=200, description="Maximum accounts in the traced graph")
    onward_window_hours: float = Field(72.0, ge=1.0, le=720.0,
                                       description="How long after receiving funds an account's transfers are followed")
    trace_scope: Literal["flagged", "all"] = Field(
        "flagged", description="'flagged': trace the account's transfers flagged as unusual (largest ones if none are); 'all': every transfer in range")
    max_accounts_analyzed: int = Field(25, ge=1, le=60, description="Accounts given a full individual assessment")
    ai_explanation: Literal["inline", "separate"] = Field(
        "inline", description="'inline': wait for the AI analyst in this response. 'separate': return the report now "
                              "with ai_analysis.state 'deferred'; get the explanation from POST /api/v2/investigations/explanation")

    @model_validator(mode="after")
    def _range(self) -> "InvestigationRequest":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class DataSourceInfo(BaseModel):
    source_kind: str
    source_name: str
    is_synthetic: bool
    real_bank_data: bool
    authorization_reference: Optional[str]
    database_backend: str
    database_label: str
    accounts_count: int
    transactions_count: int
    earliest_transaction_at: Optional[str]
    data_as_of: Optional[str]
    snapshot_built_at: Optional[str]
    queried_at: str
    freshness_note: str
    disclosure: str


class TransferFlag(BaseModel):
    code: str = Field(..., description="Rule identifier, e.g. AMOUNT_ABOVE_OWN_HISTORY")
    explanation: str


class ObservedTransfer(BaseModel):
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


class TraceEdge(ObservedTransfer):
    direction: Literal["downstream", "upstream"] = Field(..., description="Relative to the investigated account")
    hop: int = Field(..., ge=1, description="Hops from the investigated account")
    evidence_type: Literal["observed_direct", "inferred_related"] = Field(
        ..., description="'observed_direct': the investigated account is a party. 'inferred_related': an observed "
                         "transfer linked only by timing after (or before) a traced transfer; not proven to carry the same funds")
    parent_transaction_id: Optional[str] = Field(None, description="Traced transfer this one was followed from")
    minutes_from_parent: Optional[float] = None
    is_cycle: bool = Field(..., description="Funds return to an account already on this path")
    converges: bool = Field(..., description="Reaches an account already in the graph by another path")
    flags: list[TransferFlag] = Field(default_factory=list)


class TraceNode(BaseModel):
    account_id: str
    customer_name: str
    customer_type: str
    kyc_tier: str
    account_status: str
    current_balance: float
    hop_distance: int
    graph_role: Literal["investigated_account", "direct_recipient", "onward_recipient", "direct_sender", "upstream_sender"]
    is_root: bool


class TraceSummary(BaseModel):
    nodes: list[TraceNode]
    edges: list[TraceEdge]
    downstream_seed_transaction_ids: list[str]
    upstream_seed_transaction_ids: list[str]
    seed_selection: str = Field(..., description="Why these transfers were traced")
    max_depth_reached: int
    cycles_detected: int
    is_truncated: bool
    truncation_notes: list[str]
    transactions_read: int = Field(..., description="Ledger rows read by trace queries")


class CounterpartySummary(BaseModel):
    account_id: str
    transfers: int
    total_amount: float
    first_at: str
    last_at: str


class VictimOverview(BaseModel):
    account_id: str
    customer_name: str
    customer_type: str
    kyc_tier: str
    account_status: str
    account_opened_at: str
    current_balance: float
    period_start: Optional[str]
    period_end: Optional[str]
    transactions_in_period: int
    transactions_all_time: int
    incoming_count: int
    incoming_total: float
    outgoing_count: int
    outgoing_total: float
    median_outgoing_amount: Optional[float]
    largest_earlier_outgoing_before_first_flag: Optional[float]
    first_transaction_at: Optional[str]
    last_transaction_at: Optional[str]
    top_senders: list[CounterpartySummary]
    top_recipients: list[CounterpartySummary]
    flagged_transfers: list[TraceEdge] = Field(..., description="The account's own transfers flagged as unusual, with reasons")


class ExposureLine(BaseModel):
    account_id: str
    hop: int
    traced_in_amount: float = Field(..., description="Sum of traced transfers into this account")
    outgoing_in_window: float = Field(..., description="All this account's transfers out within the onward window")
    forwarded_min: float = Field(..., description="Lowest-intermediate-balance lower bound on traced funds that moved on")
    forwarded_max: float = Field(..., description="Upper bound: traced funds cannot exceed what was received or what left")
    lowest_balance_in_window: Optional[float]


class ExposureEstimate(BaseModel):
    flagged_outgoing_total: float = Field(..., description="The account's own outgoing transfers flagged as unusual")
    traced_outgoing_total: float = Field(..., description="The account's own outgoing transfers used as trace seeds")
    observed_downstream_total: float = Field(..., description="Sum of every traced downstream transfer; counts the same money repeatedly")
    per_account: list[ExposureLine]
    method: str
    limitations: list[str]


class EvidenceRefs(BaseModel):
    transaction_ids: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)


class Finding(BaseModel):
    finding_id: str
    kind: FindingKind = Field(..., description="observed = ledger fact; rule = fixed-rule result; model = ML inference; limitation = what is unknown")
    subject_account_id: Optional[str]
    statement: str
    evidence: EvidenceRefs


class AccountFinding(BaseModel):
    account_id: str
    customer_name: str
    customer_type: str
    kyc_tier: str
    graph_role: str
    hop_distance: int
    role_assessment: AccountRole
    role_basis: list[str] = Field(..., description="Observed facts that support the role label")
    analyzed: bool
    not_analyzed_reason: Optional[str] = None
    rule_assessment: Optional[AccountAssessmentResponse] = None
    model_assessment: Optional[AccountMLAssessmentResponse] = None
    model_unavailable_reason: Optional[str] = None
    model_suggests_review: Optional[bool] = None
    rule_suggests_review: Optional[bool] = None
    checks_disagree: Optional[bool] = None
    disagreement_note: Optional[str] = None
    traced_in_amount: float
    traced_out_amount: float
    evidence_transaction_ids: list[str]
    alternative_explanations: list[str]
    missing_evidence: list[str]
    next_steps: list[str]


class AnalystClaim(BaseModel):
    text: str
    kind: Literal["observed", "rule", "model", "interpretation", "limitation"]
    refs: list[str]


class AnalystSection(BaseModel):
    question: str
    claims: list[AnalystClaim]


AIState = Literal["completed", "disabled", "not_configured", "skipped_privacy_policy", "unavailable", "deferred"]
ObservationBasis = Literal["observed", "rule", "model", "hypothesis", "limitation"]


class AIObservation(BaseModel):
    text: str
    basis: ObservationBasis = Field(..., description="'hypothesis' and 'limitation' are not claims of fact")
    evidence_ids: list[str] = Field(..., description="Transaction, account or finding IDs from this report")


class AIManualCheck(BaseModel):
    text: str
    evidence_ids: list[str]


class AIReport(BaseModel):
    """Validated AI explanation. Every ID in it exists in this investigation; scores and amounts are not changed."""

    summary: str
    key_observations: list[AIObservation]
    evidence_references: list[str]
    reasoning_and_limitations: list[str]
    recommended_manual_checks: list[AIManualCheck]
    confidence_note: str = Field(..., description="Completeness of the evidence; not a probability of guilt")


class AIAnalysis(BaseModel):
    state: AIState = Field(
        ..., description="completed: a Gemini response was received and passed validation. disabled: turned off by "
                         "configuration. not_configured: no API key. skipped_privacy_policy: the data source is not "
                         "verified synthetic and no opt-in is configured. unavailable: timeout, quota, provider or "
                         "validation failure. deferred: requested separately (ai_explanation='separate').")
    status: Literal["generated", "not_configured", "failed", "rejected"] = Field(
        ..., deprecated=True, description="Legacy summary of `state` kept for existing clients.")
    provider: Optional[str]
    model: Optional[str] = None
    message: str
    unavailable_reason: Optional[str] = Field(
        None, description="When state is 'unavailable': timeout, rate_limited, auth_failed, request_rejected, "
                          "model_not_found, service_unavailable (provider overloaded or down, HTTP 503), upstream_error, blocked, empty_output, truncated_output, malformed_output, "
                          "invalid_output, policy_violation or invalid_configuration")
    privacy_policy: Optional[str] = None
    pseudonymized: bool = False
    report: Optional[AIReport] = None
    sections: list[AnalystSection] = Field(default_factory=list, description="Legacy view of report.key_observations")
    rejected_claims: int = Field(0, description="AI statements or references dropped because they cited unknown IDs or broke policy")
    latency_ms: Optional[int] = None


class Recommendation(BaseModel):
    recommendation_id: str
    account_id: Optional[str]
    action: Literal["further_review", "enhanced_monitoring", "consider_escalation", "obtain_records", "contact_account_holder"]
    statement: str
    evidence: EvidenceRefs
    uncertainty: str


class InvestigationResponse(BaseModel):
    investigation_id: str
    started_at: str
    completed_at: str
    duration_ms: int
    request: InvestigationRequest
    data_source: DataSourceInfo
    model_version: Optional[str]
    model_review_threshold: Optional[float]
    model_available: bool
    model_unavailable_reason: Optional[str]
    victim: VictimOverview
    trace: TraceSummary
    accounts: list[AccountFinding]
    findings: list[Finding]
    exposure: ExposureEstimate
    evidence_summary: list[AnalystSection] = Field(..., description="Generated by fixed templates from the findings, not by AI")
    ai_analysis: AIAnalysis
    recommendations: list[Recommendation]
    unknowns: list[str]
    records_to_request: list[str]
    ledger_rows_read: int = Field(..., description="Transaction rows read from the ledger for this investigation")
    report_digest: str = Field(..., description="Digest of the deterministic report; the separate explanation carries the "
                                                "same value when it explains an identical report")
    persisted: bool = Field(False, description="Always false: investigations are computed on request and not stored")
    disclaimer: str


class InvestigationExplanationResponse(BaseModel):
    """POST /api/v2/investigations/explanation: the AI analyst for a report the server recomputed itself."""

    account_id: str
    report_digest: str = Field(..., description="Digest of the report that was explained; show the explanation only "
                                                "next to a report with the same digest")
    data_as_of: Optional[str]
    duration_ms: int
    ai_analysis: AIAnalysis
