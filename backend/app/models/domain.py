"""Core domain models for FraudShield AI.

Design rules enforced by the shape of these models:

* Transaction fraud indicators, fund exposure, evidence quality and account
  review status are four *separate* concepts, each with its own type.
* There is deliberately NO guilty/innocent/scammer field anywhere. Being
  connected to a reported fraud is not a finding about an account owner.
* All data in this phase is synthetic.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any, Optional

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

# Money is held as Decimal internally and emitted as a JSON number.
Money = Annotated[
    Decimal,
    PlainSerializer(lambda v: float(v), return_type=float, when_used="json"),
]


class TransactionType(str, Enum):
    UPI = "UPI"
    IMPS = "IMPS"
    NEFT = "NEFT"
    RTGS = "RTGS"
    ATM_CASH_OUT = "ATM_CASH_OUT"
    OTHER = "OTHER"


class InvestigationStatus(str, Enum):
    OPEN = "open"
    UNDER_INVESTIGATION = "under_investigation"
    CLOSED = "closed"


class AccountRole(str, Enum):
    """Neutral structural role in a case. Not a verdict about the owner."""

    REPORTING_VICTIM = "reporting_victim"
    REPORTED_INITIAL_RECEIVER = "reported_initial_receiver"
    INTERMEDIATE_RECIPIENT = "intermediate_recipient"
    RECIPIENT = "recipient"
    UNKNOWN = "unknown"


class ReviewState(str, Enum):
    """Human review workflow state. Never set automatically by the tracer."""

    NOT_REVIEWED = "not_reviewed"
    REPORTING_VICTIM = "reporting_victim"
    UNDER_INVESTIGATION = "under_investigation"
    UNDER_REVIEW = "under_review"
    REVIEW_COMPLETED = "review_completed"


class EvidenceQuality(str, Enum):
    """How strong the available evidence is. Separate from fund exposure."""

    NOT_ASSESSED = "not_assessed"
    GRAPH_CONNECTION_ONLY = "graph_connection_only"
    SYNTHETIC_ASSUMPTION = "synthetic_assumption"
    CORROBORATED = "corroborated"


class AttributionBasis(str, Enum):
    SYNTHETIC_SCENARIO_ASSUMPTION = "synthetic_scenario_assumption"


# --------------------------------------------------------------------------
# Transactions
# --------------------------------------------------------------------------
class CaseLinkage(BaseModel):
    """Known link between a transaction and a case (e.g. the reported origin)."""

    case_id: str
    linkage_type: str = Field(description="e.g. 'reported_origin'")


class SyntheticLineage(BaseModel):
    """Explicit, scenario-assumed fund lineage for a transaction.

    This is an assumption of the synthetic test case, NOT proof of real-world
    money ownership.
    """

    case_id: str
    attributed_amount: Money = Field(
        ge=0, description="Portion of this transaction assumed to derive from the case."
    )
    basis: AttributionBasis = AttributionBasis.SYNTHETIC_SCENARIO_ASSUMPTION
    note: Optional[str] = None


class Transaction(BaseModel):
    model_config = ConfigDict(frozen=True)

    transaction_id: str
    timestamp: datetime
    sender_account_id: str
    receiver_account_id: str
    amount: Money = Field(gt=0)
    currency: str = "INR"
    transaction_type: TransactionType
    case_linkage: Optional[CaseLinkage] = None
    synthetic_lineage_metadata: Optional[SyntheticLineage] = None


class TransactionFraudIndicator(BaseModel):
    """A fraud signal on a single transaction (Phase 2+ will populate this).

    Kept separate from fund exposure. Phase 1 generates none: no model exists.
    """

    transaction_id: str
    indicator_code: str
    source: str
    description: Optional[str] = None


# --------------------------------------------------------------------------
# Accounts, cases, review status
# --------------------------------------------------------------------------
class Account(BaseModel):
    account_id: str
    label: str
    role: AccountRole
    is_synthetic: bool = True


class AccountReviewStatus(BaseModel):
    """Review workflow + evidence quality for an account within a case.

    ``automated_action_taken`` is always ``none`` in this system: accounts are
    never frozen or unfrozen automatically.
    """

    account_id: str
    case_id: str
    review_state: ReviewState
    evidence_quality: EvidenceQuality = EvidenceQuality.NOT_ASSESSED
    notes: Optional[str] = None
    reviewer_id: Optional[str] = None
    decision_reasons: list[str] = Field(default_factory=list)
    supporting_transaction_ids: list[str] = Field(default_factory=list)
    additional_info_needed: bool = False
    automated_action_taken: str = "none"



class AuditEvent(BaseModel):
    """Append-only record of an investigation action."""

    event_id: Optional[int] = None
    case_id: str
    timestamp: datetime
    action: str
    performed_by: str
    entity_type: str
    entity_id: str
    details: Optional[dict[str, Any]] = None


class FraudCase(BaseModel):
    case_id: str
    reported_origin_transaction_id: str
    reported_amount: Money = Field(gt=0)
    currency: str = "INR"
    reported_at: datetime
    investigation_status: InvestigationStatus
    description: str


# --------------------------------------------------------------------------
# Trace path
# --------------------------------------------------------------------------
class PathTermination(str, Enum):
    END_OF_RECORDS = "end_of_records"
    DEPTH_LIMIT = "depth_limit"
    CYCLE_DETECTED = "cycle_detected"


class FundTracePath(BaseModel):
    """One root-to-leaf chain of transactions starting at the origin transaction.

    ``transaction_amounts`` are observed values of each leg. They must never be
    summed to estimate a fraud total: the same funds move once per hop.
    """

    path_id: str
    account_ids: list[str]
    transaction_ids: list[str]
    transaction_amounts: list[Money]
    hop_count: int = Field(description="Downstream hops after the origin transaction.")
    started_at: datetime
    ended_at: datetime
    terminal_account_id: str
    termination_reason: PathTermination
    max_attributable_amount: Optional[Money] = Field(
        default=None,
        description="Smallest assumed attributed amount along the path (upper bound "
        "on funds that could have travelled the whole path). Null if any leg lacks lineage.",
    )
    attribution_status: str = Field(description="'explicit' or 'uncertain'.")
