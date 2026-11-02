"""Contract for POST /api/v2/dynamic-investigations (model-driven investigation of one account in a chosen dataset)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

try:
    from app.api.v2.investigation_schemas import DataSourceInfo, InvestigationResponse, TransferFlag
except ModuleNotFoundError:
    from backend.app.api.v2.investigation_schemas import DataSourceInfo, InvestigationResponse, TransferFlag

DatasetId = Literal["demo-ledger", "forensic-scenarios"]
RoleCandidate = Literal[
    "potential_victim", "suspicious_activity_victim_unconfirmed", "potential_secondary_victim", "potential_intermediary",
    "potentially_suspicious_account", "no_suspicious_linkage_observed", "no_suspicious_activity_observed", "unknown_role",
    "cash_withdrawal_point",
]
RestrictionState = Literal[
    "no_restriction_recommendation", "additional_verification_recommended", "urgent_manual_review_recommended",
    "consider_temporary_restriction_review", "insufficient_evidence_to_recommend",
]
EndingReason = Literal[
    "cycle_detected", "already_examined_on_another_branch", "maximum_depth_reached", "maximum_node_limit_reached",
    "per_account_limit_applied", "cash_withdrawal_recorded", "no_further_transaction_in_window",
    "no_earlier_transaction_in_window", "incomplete_or_missing_data", "joins_opposite_direction_trace",
]


class DynamicInvestigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_id: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-\.]+$",
                            description="Account to investigate; looked up only inside the chosen dataset")
    dataset_id: DatasetId = Field("demo-ledger", description="Which synthetic ledger to search (GET /api/v2/datasets)")
    max_depth: int = Field(3, ge=1, le=6)
    max_nodes: int = Field(200, ge=2, le=200)
    onward_window_hours: float = Field(72.0, ge=1.0, le=720.0)
    max_accounts_analyzed: int = Field(25, ge=1, le=60)
    ai_explanation: Literal["inline", "separate"] = Field(
        "separate", description="'separate' (default): ai_analysis is 'deferred' when the AI analyst can produce an "
                                "explanation (fetch it from POST /api/v2/dynamic-investigations/explanation); otherwise it "
                                "carries the analyst's state, e.g. 'disabled' or 'not_configured'")


class DatasetSummary(BaseModel):
    dataset_id: DatasetId
    title: str
    description: str
    evaluation_labels_note: str
    model_support: Literal["validated_in_distribution", "unsupported_distribution_shift", "unsupported_not_checked"] = Field(
        ..., description="Whether the v3 models' outputs count as evidence on this dataset (validated_in_distribution) or "
                         "are reference only; known before any account is chosen")
    model_note: str = ""
    available: bool
    unavailable_reason: Optional[str] = None
    source: Optional[DataSourceInfo] = None


class DatasetInfo(BaseModel):
    dataset_id: DatasetId
    title: str
    description: str
    evaluation_labels_note: str
    source: DataSourceInfo


class ModelFactor(BaseModel):
    feature: str
    label: str = Field(..., description="Observed value in words")
    value: Optional[float]
    contribution: float = Field(..., description="Contribution to the model score (log-odds); not a cause")


class TransactionAssessment(BaseModel):
    transaction_id: str
    timestamp: str
    sender_account_id: str
    receiver_account_id: str
    amount: float
    currency: Optional[str]
    transaction_type: str
    channel: Optional[str]
    model_score: Optional[float] = Field(None, description="Raw transaction-model output")
    calibrated_probability: Optional[float] = Field(None, description="Validation-calibrated rate; not a probability of fraud by a person")
    model_flag: bool
    risk_category: Literal["high", "elevated", "low", "not_scored"]
    model_factors: list[ModelFactor]
    outside_training_range: bool
    rule_flags: list[TransferFlag]
    evidence_use: Literal["evidence", "reference_only"] = Field(
        "evidence", description="'reference_only': the model is not validated on this dataset; the score is shown but not used")


class AccountModelResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    status: Literal["scored", "reference_only", "insufficient_history", "not_analyzed", "model_unavailable"]
    model_version: Optional[str] = None
    model_score: Optional[float] = None
    calibrated_probability: Optional[float] = None
    above_threshold: Optional[bool] = None
    threshold: Optional[float] = None
    outside_training_range: Optional[bool] = None
    factors: list[ModelFactor] = Field(default_factory=list)
    n_transactions: Optional[int] = None
    reason: Optional[str] = None


class Restriction(BaseModel):
    account_id: str
    state: RestrictionState
    label: str
    rationale: str
    supporting_evidence: list[str]
    relevant_transaction_ids: list[str]
    may_be_victim: bool
    victim_note: Optional[str]
    innocent_explanations: list[str]
    verification_needed: list[str]
    missing_information: list[str]
    funds_may_still_be_held: Optional[bool]
    human_review_required: Literal[True]
    automatic_action_taken: Literal[False]


class GraphRelationship(BaseModel):
    position: Literal["investigated", "downstream", "upstream", "other_sender"]
    hop: Optional[int]
    introduced_by_transaction_id: Optional[str]
    received_traced_amount: float
    sent_traced_amount: float
    forwarded_at_least: Optional[float]
    forwarded_at_most: Optional[float]
    onward_delay_minutes: Optional[float]
    onward_destinations: int
    traced_paths_in: int
    in_cycle: bool
    paid_suspicious_account: Optional[str]


class QA(BaseModel):
    q: str
    a: str


class EvidenceItem(BaseModel):
    category: str
    kind: Literal["observed", "model", "rule"] = Field(..., description="Recorded fact, model output or fixed rule")
    text: str
    side: Optional[Literal["victim", "suspicion", "context"]] = Field(
        None, description="Which way it points: towards a victim (its own money left), towards passing money on or collecting "
                          "it, or context only (what it received, how new its records are). Display only")


class RoleAssessment(BaseModel):
    account_id: str
    role_candidate: RoleCandidate
    role_label: str
    assessment_status: Literal["assessed", "insufficient_evidence", "not_analyzed"]
    headline: str
    supporting_evidence: list[str]
    evidence_items: list[EvidenceItem]
    contradictory_evidence: list[str]
    evidence_categories: list[str]
    evidence_strength: Literal["none", "weak", "moderate", "strong"]
    relevant_transaction_ids: list[str]
    graph_relationship: GraphRelationship
    account_model: AccountModelResult
    account_model_calibrated_probability: Optional[float]
    data_coverage: dict
    uncertainty_reason: Optional[str]
    recommended_next_check: str
    questions: list[QA]
    may_be_victim: bool
    restriction: Restriction
    other_sender_transaction: Optional[TransactionAssessment] = None


class BranchEnding(BaseModel):
    reason: EndingReason
    detail: str


class FundBranch(BaseModel):
    branch_id: str
    direction: Literal["downstream", "upstream"]
    transaction_ids: list[str]
    accounts: list[str]
    amounts: list[float]
    ending: BranchEnding


class FundTrace(BaseModel):
    branches: list[FundBranch]
    transactions: int
    accounts: int
    max_depth_reached: int
    truncation_notes: list[str]


class VictimAssessment(BaseModel):
    account_id: str
    status: Literal["potential_victim", "suspicious_activity_victim_status_unconfirmed", "no_suspicious_activity_observed", "insufficient_evidence"]
    label: str
    headline: str
    role_candidate: RoleCandidate
    evidence: list[str]
    contradictory_evidence: list[str]
    uncertainty_reason: Optional[str]


class ProcessingStep(BaseModel):
    step: str
    label: str
    duration_ms: int
    detail: str


class AffectedAccounts(BaseModel):
    potential_victims: list[str]
    potential_secondary_victims: list[str]
    potential_intermediaries: list[str]
    suspicious_accounts: list[str]
    ordinary_counterparties: list[str]
    unknown_roles: list[str]
    cash_withdrawal_points: list[str]


class ClosestUnflaggedTransfer(BaseModel):
    transaction_id: str
    timestamp: str
    receiver_account_id: str
    amount: float
    transaction_type: str
    channel: Optional[str]
    calibrated_probability: float
    model_score: Optional[float] = None
    threshold: float = Field(..., description="The transaction model's review threshold on the calibrated score")
    share_of_threshold: Optional[float] = Field(None, description="calibrated_probability / threshold (below 1: not flagged)")
    evidence_use: Literal["evidence", "reference_only"] = "evidence"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


ReviewTrack = Literal["protective", "suspicion", "routine"]


class ReportEvidence(_Strict):
    kind: Literal["observed", "model", "rule"]
    text: str


class ReportSummary(_Strict):
    account_id: str
    dataset_id: str
    dataset_title: str
    data_as_of: Optional[str]
    synthetic: bool
    candidate_role: RoleCandidate
    candidate_role_label: str
    assessment_status: str
    headline: str
    review_level: int = Field(..., ge=1, le=4)
    review_level_label: str
    review_track: ReviewTrack
    leaning: Literal["victim", "intermediary", "suspicious_account", "none", "undetermined"]
    leaning_text: str
    main_reasons: list[ReportEvidence]
    evidence_strength: str
    uncertainty: list[str]


class ReportFlaggedTransfer(_Strict):
    transaction_id: str
    timestamp: str
    direction: Literal["outgoing", "incoming"]
    counterparty: str
    amount: float
    calibrated_probability: Optional[float]
    factors: list[str]


class ReportTransactionModel(_Strict):
    available: bool
    version: Optional[str]
    threshold: Optional[float]
    used_as_evidence: bool
    scored_on_account: Optional[int]
    flagged_on_account: Optional[int]
    flagged_transfers: list[ReportFlaggedTransfer]


class ReportFactor(_Strict):
    label: str
    contribution: float


class ReportAccountModel(_Strict):
    available: bool
    version: Optional[str]
    status: Optional[str]
    calibrated_probability: Optional[float]
    threshold: Optional[float]
    above_threshold: Optional[bool]
    factors: list[ReportFactor]
    positive_target: str


class ReportRuleFlag(_Strict):
    transaction_id: str
    code: str
    explanation: str


class ReportRules(_Strict):
    flags_on_account: list[ReportRuleFlag]
    uncorroborated: list[str]
    role_rule: str


class ReportModelSupport(_Strict):
    state: str
    validated_for_this_dataset: bool
    note: str


class ReportRisk(_Strict):
    transaction_model: ReportTransactionModel
    account_model: ReportAccountModel
    rules: ReportRules
    model_support: ReportModelSupport
    evidence_strength: str
    victim_side_evidence: list[ReportEvidence]
    suspicion_side_evidence: list[ReportEvidence]
    context: list[ReportEvidence]
    contradictory_evidence: list[str]
    innocent_explanations: list[str]
    missing_information: list[str]
    score_note: str


class ChronologyRow(_Strict):
    transaction_id: str
    timestamp: str
    direction: Literal["outgoing", "incoming"]
    counterparty: str
    amount: float
    channel: Optional[str]
    balance_before: Optional[float]
    balance_after: Optional[float]
    model_flag: bool
    calibrated_probability: Optional[float]
    evidence_use: Optional[Literal["evidence", "reference_only"]]
    rule_flags: list[str]
    flagged: bool
    traced: bool
    branch_ids: list[str]
    selected_because: list[str]


class ReportChronology(_Strict):
    rows: list[ChronologyRow]
    window_note: str
    omitted: int
    model_threshold: Optional[float]
    model_evidence_use: Literal["evidence", "reference_only"]


class FlowTransfer(_Strict):
    account_id: str
    transaction_id: str
    amount: float
    timestamp: str
    channel: Optional[str]


class EarliestSource(_Strict):
    account_id: str
    branch_id: str
    hops_before: int


class HopSummary(_Strict):
    direction: Literal["downstream", "upstream"]
    hop: int
    transfers: int
    total: float
    accounts: list[str]


class Attribution(_Strict):
    account_id: str
    hop: Optional[int]
    role_label: Optional[str]
    received_traced: Optional[float]
    forwarded_at_least: Optional[float]
    forwarded_at_most: Optional[float]
    kept_at_least: Optional[float]
    cash_withdrawn: float


class ReportBranch(_Strict):
    branch_id: str
    direction: Literal["downstream", "upstream"]
    accounts: list[str]
    amounts: list[float]
    transaction_ids: list[str]
    ending_reason: EndingReason
    ending_detail: str


class Convergence(_Strict):
    transaction_id: str
    from_account: str
    to_account: str
    amount: float


class CashEnding(_Strict):
    account_id: str
    cash_point: str
    transaction_id: str
    amount: float
    timestamp: str


class Untraced(_Strict):
    branch_id: str
    account_id: str
    last_amount: Optional[float]
    reason: EndingReason
    detail: str


class ReportFundFlow(_Strict):
    investigated_account: str
    flagged_outgoing_total: Optional[float]
    traced_outgoing_total: Optional[float]
    sources: list[FlowTransfer]
    earliest_sources: list[EarliestSource]
    first_recipients: list[FlowTransfer]
    hops: list[HopSummary]
    recipients: list[str]
    attribution: list[Attribution]
    branches: list[ReportBranch]
    cycles: list[ReportBranch]
    convergence: list[Convergence]
    reached_by_several_paths: list[str]
    cash_endings: list[CashEnding]
    untraced: list[Untraced]
    truncation_notes: list[str]
    method: Optional[str]
    amount_note: str


class ConnectedAccountRow(_Strict):
    account_id: str
    role_candidate: RoleCandidate
    role_label: str
    assessment_status: str
    position: str
    hop: Optional[int]
    flow_role: str = Field(..., description="Its position in this flow (what it received and sent here)")
    behaviour: str = Field(..., description="Its independently assessed behaviour (account model, its own flagged transfers)")
    evidence: list[ReportEvidence]
    evidence_strength: str
    level: int = Field(..., ge=1, le=4)
    level_label: str
    track: ReviewTrack
    recommended_action: str
    next_check: str
    may_be_victim: bool


class AccountRecommendation(_Strict):
    account_id: str
    role_candidate: RoleCandidate
    role_label: str
    level: int = Field(..., ge=1, le=4)
    level_label: str
    track: ReviewTrack
    model_only: bool = Field(..., description="Only model output points to it; such an account is never above level 2")
    action: str
    reason: str
    supporting_evidence: list[ReportEvidence]
    contradictory_evidence: list[str]
    innocent_explanations: list[str]
    verify_before_action: list[str]
    authorised_by: str
    victim_note: Optional[str]
    restriction_state: RestrictionState
    restriction_label: str
    action_executed: Literal[False] = Field(False, description="Always false: a recommendation is never executed")


class ReportFindings(_Strict):
    recorded_evidence: list[str]
    model_output_only: list[str]
    unknown: list[str]
    urgent_review: list[str]
    enhanced_verification: list[str]
    protective_verification: list[str]
    no_action: list[str]
    records_to_obtain: list[str]


class ReportGenerator(_Strict):
    kind: Literal["deterministic"]
    language_model_used: Literal[False]
    description: str


class InvestigatorReport(_Strict):
    report_version: str
    generator: ReportGenerator
    notice: str
    executive_summary: ReportSummary
    risk_assessment: ReportRisk
    chronology: ReportChronology
    fund_flow: ReportFundFlow
    connected_accounts: list[ConnectedAccountRow]
    recommendations: list[AccountRecommendation]
    findings: ReportFindings
    safeguards: list[str]


class DynamicInvestigationResponse(BaseModel):
    investigation_id: str
    engine_version: str
    started_at: str
    completed_at: str
    duration_ms: int
    investigation_digest: str = Field(..., description="Digest of every deterministic section; same ledger + settings -> same digest")
    dataset: DatasetInfo
    account_summary: dict
    victim_assessment: VictimAssessment
    suspicious_transactions: list[TransactionAssessment]
    uncorroborated_rule_flags: list[TransactionAssessment] = Field(
        ..., description="Transfers the fixed rules flag but the validated transaction model does not; shown, not used as evidence")
    transaction_scores: list[TransactionAssessment] = Field(..., description="Every traced transfer that was scored, flagged or not")
    transaction_scoring: dict
    closest_unflagged_transfers: Optional[list[ClosestUnflaggedTransfer]] = Field(
        None, description="The investigated account's own outgoing transfers the transaction model did NOT flag, highest "
                          "calibrated score first (at most 3), with the threshold they fell short of. Context only: never a "
                          "flag, never a trace seed, never evidence")
    fund_trace: FundTrace
    affected_accounts: AffectedAccounts
    role_assessments: list[RoleAssessment]
    network_findings: list[str]
    restriction_recommendation: Restriction
    data_coverage: dict
    model_validation: dict = Field(..., description="Whether the models' outputs count as evidence on this dataset, and why")
    model_metadata: dict
    limitations: list[str]
    processing_steps: list[ProcessingStep]
    synthetic_data_notice: str
    automatic_actions_taken: list[str] = Field(..., max_length=0, description="Always empty: nothing is ever done to an account")
    investigator_report: Optional[InvestigatorReport] = Field(
        None, description="Evidence-grounded report assembled by fixed code from the sections above (no language model). "
                          "Recommendations only: nothing is executed. Absent from servers older than this field")
    investigation: InvestigationResponse = Field(..., description="The underlying trace report (same contract as POST /investigations)")
