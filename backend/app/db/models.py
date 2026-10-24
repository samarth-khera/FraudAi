"""SQLAlchemy ORM models for FraudShield AI.

Defines tables for fraud cases, accounts, transactions, account review statuses,
trace path records, and append-only audit events.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class FraudCaseModel(Base):
    __tablename__ = "fraud_cases"

    case_id: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)
    reported_origin_transaction_id: Mapped[str] = mapped_column(String(50), nullable=False)
    reported_amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)
    reported_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    investigation_status: Mapped[str] = mapped_column(String(30), default="open", nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    review_statuses: Mapped[list["AccountReviewStatusModel"]] = relationship(
        "AccountReviewStatusModel", back_populates="case", cascade="all, delete-orphan"
    )
    audit_events: Mapped[list["AuditEventModel"]] = relationship(
        "AuditEventModel", back_populates="case", cascade="save-update, merge"
    )
    trace_paths: Mapped[list["CaseTracePathModel"]] = relationship(
        "CaseTracePathModel", back_populates="case", cascade="all, delete-orphan"
    )


class AccountModel(Base):
    __tablename__ = "accounts"

    account_id: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="unknown", nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


class TransactionModel(Base):
    __tablename__ = "transactions"

    transaction_id: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    sender_account_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("accounts.account_id"), nullable=False, index=True
    )
    receiver_account_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("accounts.account_id"), nullable=False, index=True
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Optional case linkage
    case_linkage_case_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    case_linkage_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Optional synthetic lineage metadata
    synthetic_lineage_case_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    synthetic_lineage_attributed_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    synthetic_lineage_basis: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    synthetic_lineage_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


class AccountReviewStatusModel(Base):
    __tablename__ = "account_review_statuses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("fraud_cases.case_id"), nullable=False, index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("accounts.account_id"), nullable=False, index=True
    )
    review_state: Mapped[str] = mapped_column(String(50), default="not_reviewed", nullable=False)
    evidence_quality: Mapped[str] = mapped_column(
        String(50), default="not_assessed", nullable=False
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    automated_action_taken: Mapped[str] = mapped_column(String(50), default="none", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    case: Mapped["FraudCaseModel"] = relationship("FraudCaseModel", back_populates="review_statuses")

    __table_args__ = (
        UniqueConstraint("case_id", "account_id", name="uq_case_account_review"),
    )


class AuditEventModel(Base):
    """Append-only audit events recording all state-changing actions."""

    __tablename__ = "audit_events"

    event_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("fraud_cases.case_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    performed_by: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(100), nullable=False)
    details_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    case: Mapped["FraudCaseModel"] = relationship("FraudCaseModel", back_populates="audit_events")

    @property
    def details(self) -> Optional[dict[str, Any]]:
        if self.details_json:
            try:
                return json.loads(self.details_json)
            except Exception:
                return {"raw": self.details_json}
        return None

    @details.setter
    def details(self, val: Optional[dict[str, Any]]) -> None:
        self.details_json = json.dumps(val) if val is not None else None


class CaseTracePathModel(Base):
    """Persisted trace path metadata generated by the tracing engine."""

    __tablename__ = "case_trace_paths"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("fraud_cases.case_id"), nullable=False, index=True
    )
    path_id: Mapped[str] = mapped_column(String(50), nullable=False)
    account_ids_json: Mapped[str] = mapped_column(Text, nullable=False)
    transaction_ids_json: Mapped[str] = mapped_column(Text, nullable=False)
    transaction_amounts_json: Mapped[str] = mapped_column(Text, nullable=False)
    hop_count: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    terminal_account_id: Mapped[str] = mapped_column(String(50), nullable=False)
    termination_reason: Mapped[str] = mapped_column(String(50), nullable=False)
    max_attributable_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    attribution_status: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    case: Mapped["FraudCaseModel"] = relationship("FraudCaseModel", back_populates="trace_paths")
