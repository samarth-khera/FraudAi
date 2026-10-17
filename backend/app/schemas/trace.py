"""Result/response schemas for the tracing engine and API.

Observed ledger values (``amount``, ``observed_*``) are kept apart from
assumed fund attribution (``attributed_*``). Neither is a fraud total or a
statement about anyone's intent.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.domain import (
    AccountRole,
    AttributionBasis,
    EvidenceQuality,
    FraudCase,
    FundTracePath,
    Money,
    ReviewState,
    TransactionType,
)

DISCLAIMER = (
    "Synthetic demonstration data. A transaction graph alone does not establish "
    "criminal involvement; receiving funds linked to a reported fraud does not make "
    "an account owner a scammer. Attribution figures are scenario assumptions, not "
    "proof of money ownership."
)


class TraceWarning(BaseModel):
    code: str
    message: str
    transaction_id: Optional[str] = None
    account_id: Optional[str] = None


class TracedTransaction(BaseModel):
    transaction_id: str
    timestamp: datetime
    sender_account_id: str
    receiver_account_id: str
    amount: Money = Field(description="Observed transaction value.")
    currency: str
    transaction_type: TransactionType
    hop_count: int = Field(description="Shortest downstream hop index (origin = 0).")
    attributed_amount: Optional[Money] = Field(
        default=None, description="Assumed case-derived portion; null if unknown."
    )
    attribution_basis: Optional[AttributionBasis] = None
    attribution_note: Optional[str] = None
    is_cycle_closing: bool = False


class ExposureInfo(BaseModel):
    """Fund exposure only. Says nothing about intent or guilt."""

    observed_inbound_value: Money = Field(description="Sum of observed inbound txns (ledger value).")
    observed_outbound_value: Money
    attributed_inbound_amount: Optional[Money] = None
    attributed_outbound_amount: Optional[Money] = None
    attributed_unforwarded_amount: Optional[Money] = Field(
        default=None,
        description="Attributed inbound minus attributed outbound observed in the records. "
        "Not claimed as spent, kept or hidden: it is simply not observed leaving.",
    )
    attribution_status: str = Field(
        description="'explicit', 'uncertain_missing_lineage' or 'ambiguous_over_attribution'."
    )


class ReviewInfo(BaseModel):
    review_state: ReviewState
    evidence_quality: EvidenceQuality
    notes: Optional[str] = None
    automated_action_taken: str = "none"


class AccountTraceInfo(BaseModel):
    account_id: str
    label: Optional[str] = None
    role: AccountRole
    connection_type: str = Field(description="'origin_receiver', 'direct' or 'indirect'.")
    hop_count: int = Field(description="Downstream hops from the initial receiver (0 = initial receiver).")
    first_received_at: datetime
    inbound_transaction_ids: list[str]
    outbound_transaction_ids: list[str]
    path_ids: list[str]
    exposure: ExposureInfo
    review: ReviewInfo
    is_synthetic: bool = True


class TraceSummary(BaseModel):
    reported_amount: Money
    currency: str
    traceable_amount: Money = Field(
        description="Reported amount assumed (by lineage) to have reached the initial receiver."
    )
    located_amount: Money = Field(
        description="Sum of attributed unforwarded amounts over accounts with explicit lineage."
    )
    unlocated_amount: Money = Field(description="traceable_amount - located_amount, floored at 0.")
    gross_observed_transaction_value: Money = Field(
        description="Sum of distinct observed transaction values across all hops. "
        "NOT the fraud amount: the same funds move once per hop."
    )
    linked_account_count: int
    traced_transaction_count: int
    path_count: int
    max_depth: int
    truncated: bool
    cycles_detected: bool
    uncertain_account_ids: list[str]


class TraceResult(BaseModel):
    case_id: str
    origin_transaction_id: str
    summary: TraceSummary
    linked_accounts: list[AccountTraceInfo]
    traced_transactions: list[TracedTransaction]
    paths: list[FundTracePath]
    warnings: list[TraceWarning]
    disclaimer: str = DISCLAIMER


# ---- Graph (frontend-friendly) -------------------------------------------
class GraphNode(BaseModel):
    id: str
    label: str
    role: AccountRole
    hop_count: Optional[int] = None
    review_state: ReviewState
    evidence_quality: EvidenceQuality
    attributed_unforwarded_amount: Optional[Money] = None
    attribution_status: Optional[str] = None
    is_synthetic: bool = True


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    amount: Money
    currency: str
    transaction_type: TransactionType
    timestamp: datetime
    hop_count: int
    attributed_amount: Optional[Money] = None
    attribution_basis: Optional[AttributionBasis] = None
    is_cycle_closing: bool = False


class GraphResponse(BaseModel):
    case_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    meta: dict[str, Any]
    disclaimer: str = DISCLAIMER


# ---- Other API responses -------------------------------------------------
class HealthResponse(BaseModel):
    status: str
    service: str
    phase: str
    synthetic_data: bool = True


class CaseListResponse(BaseModel):
    count: int
    cases: list[FraudCase]


class TransactionListResponse(BaseModel):
    case_id: str
    count: int
    transactions: list[TracedTransaction]
    warnings: list[TraceWarning]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Optional[Any] = None


class ErrorResponse(BaseModel):
    error: ErrorBody
