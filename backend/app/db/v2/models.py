"""SQLAlchemy ORM models for FraudShield AI V2.

Defines Accounts, Transactions, and Scenario metadata with rigorous constraints,
foreign keys, and high-performance indexes for forensic lookup and fund-tracing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
)
from sqlalchemy.orm import relationship

try:
    from app.db.v2.session import Base
except ModuleNotFoundError:
    from backend.app.db.v2.session import Base


class AccountModel(Base):
    """Core customer and business account entity in the V2 ledger."""

    __tablename__ = "accounts"

    account_id = Column(String(32), primary_key=True, index=True)
    customer_name = Column(String(128), nullable=False, index=True)
    customer_type = Column(String(32), nullable=False, index=True)
    kyc_tier = Column(String(32), nullable=False, index=True)
    phone_number = Column(String(32), nullable=False, index=True)
    email = Column(String(128), nullable=False, index=True)
    upi_id = Column(String(128), nullable=False, index=True)
    tax_identifier = Column(String(32), nullable=False, index=True)
    initial_balance = Column(Float, nullable=False)
    current_balance = Column(Float, nullable=False)
    account_opened_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(32), nullable=False, default="active", index=True)

    # --------------------------------------------------------------------------
    # Scenario & Evaluation Ground Truth Metadata
    # Strictly separated from runtime model feature inputs to prevent leakage!
    # --------------------------------------------------------------------------
    scenario_id = Column(String(64), nullable=True, index=True)
    ground_truth_label = Column(String(64), nullable=False, index=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    outgoing_transactions = relationship(
        "TransactionModel",
        foreign_keys="TransactionModel.origin_account_id",
        back_populates="origin_account",
        lazy="dynamic",
    )
    incoming_transactions = relationship(
        "TransactionModel",
        foreign_keys="TransactionModel.destination_account_id",
        back_populates="destination_account",
        lazy="dynamic",
    )

    __table_args__ = (
        CheckConstraint("initial_balance >= 0", name="chk_acc_initial_balance_non_neg"),
        CheckConstraint("current_balance >= 0", name="chk_acc_current_balance_non_neg"),
        {"extend_existing": True},
    )

    def __repr__(self) -> str:
        return f"<Account {self.account_id} ({self.customer_name}) [{self.customer_type}]>"

    def to_dict(self, include_ground_truth: bool = True) -> dict:
        """Serializes account entity to dictionary with optional ground-truth isolation."""
        data = {
            "account_id": self.account_id,
            "customer_name": self.customer_name,
            "customer_type": self.customer_type,
            "kyc_tier": self.kyc_tier,
            "phone_number": self.phone_number,
            "email": self.email,
            "upi_id": self.upi_id,
            "tax_identifier": self.tax_identifier,
            "initial_balance": self.initial_balance,
            "current_balance": self.current_balance,
            "account_opened_at": self.account_opened_at.isoformat() if self.account_opened_at else None,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_ground_truth:
            data["scenario_id"] = self.scenario_id
            data["ground_truth_label"] = self.ground_truth_label
        return data


class TransactionModel(Base):
    """Core transaction and double-entry ledger movement entity in V2."""

    __tablename__ = "transactions"

    transaction_id = Column(String(32), primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    origin_account_id = Column(
        String(32),
        ForeignKey("accounts.account_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    destination_account_id = Column(
        String(32),
        ForeignKey("accounts.account_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    amount = Column(Float, nullable=False)
    currency = Column(String(8), nullable=False, default="INR")
    channel = Column(String(32), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="COMPLETED", index=True)

    origin_balance_before = Column(Float, nullable=False)
    origin_balance_after = Column(Float, nullable=False)
    dest_balance_before = Column(Float, nullable=False)
    dest_balance_after = Column(Float, nullable=False)

    # --------------------------------------------------------------------------
    # Scenario & Evaluation Ground Truth Metadata
    # Strictly separated from runtime model feature inputs to prevent leakage!
    # --------------------------------------------------------------------------
    scenario_id = Column(String(64), nullable=True, index=True)
    scenario_tag = Column(String(64), nullable=False, index=True)
    is_suspicious_scenario = Column(Boolean, nullable=False, default=False, index=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    origin_account = relationship(
        "AccountModel",
        foreign_keys=[origin_account_id],
        back_populates="outgoing_transactions",
    )
    destination_account = relationship(
        "AccountModel",
        foreign_keys=[destination_account_id],
        back_populates="incoming_transactions",
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_txn_amount_positive"),
        CheckConstraint("origin_balance_before >= 0", name="chk_txn_origin_before_non_neg"),
        CheckConstraint("origin_balance_after >= 0", name="chk_txn_origin_after_non_neg"),
        CheckConstraint("dest_balance_before >= 0", name="chk_txn_dest_before_non_neg"),
        CheckConstraint("dest_balance_after >= 0", name="chk_txn_dest_after_non_neg"),
        Index("idx_txn_origin_timestamp", "origin_account_id", "timestamp"),
        Index("idx_txn_dest_timestamp", "destination_account_id", "timestamp"),
        Index("idx_txn_scenario", "scenario_id", "is_suspicious_scenario"),
        {"extend_existing": True},
    )

    def __repr__(self) -> str:
        return f"<Transaction {self.transaction_id}: {self.origin_account_id} -> {self.destination_account_id} ({self.amount} {self.currency})>"

    def to_dict(self, include_ground_truth: bool = True) -> dict:
        """Serializes transaction entity to dictionary with optional ground-truth isolation."""
        data = {
            "transaction_id": self.transaction_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "origin_account_id": self.origin_account_id,
            "destination_account_id": self.destination_account_id,
            "amount": self.amount,
            "currency": self.currency,
            "channel": self.channel,
            "status": self.status,
            "origin_balance_before": self.origin_balance_before,
            "origin_balance_after": self.origin_balance_after,
            "dest_balance_before": self.dest_balance_before,
            "dest_balance_after": self.dest_balance_after,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_ground_truth:
            data["scenario_id"] = self.scenario_id
            data["scenario_tag"] = self.scenario_tag
            data["is_suspicious_scenario"] = self.is_suspicious_scenario
        return data
