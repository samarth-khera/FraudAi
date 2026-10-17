"""Pydantic schemas for case management, reviews, and audit trails."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.domain import (
    EvidenceQuality,
    InvestigationStatus,
    Money,
    ReviewState,
    Transaction,
)


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
    review_state: ReviewState
    evidence_quality: EvidenceQuality = EvidenceQuality.NOT_ASSESSED
    notes: Optional[str] = None
    reviewer_id: str = Field(default="analyst_placeholder", description="Reviewer identity.")


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
