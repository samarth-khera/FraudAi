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
    investigation: InvestigationResponse = Field(..., description="The underlying trace report (same contract as POST /investigations)")
