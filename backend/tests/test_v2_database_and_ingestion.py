"""Automated tests for FraudShield AI V2 Database Schema, ORM, and Ingestion Pipeline."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

try:
    from app.db.v2.ingestion import (
        DataIngestionError,
        IngestionResult,
        ingest_v2_dataset,
    )
    from app.db.v2.models import AccountModel, TransactionModel
    from app.db.v2.session import (
        get_v2_engine,
        init_v2_db,
        validate_not_v1_database,
    )
except ModuleNotFoundError:
    from backend.app.db.v2.ingestion import (
        DataIngestionError,
        IngestionResult,
        ingest_v2_dataset,
    )
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.db.v2.session import (
        get_v2_engine,
        init_v2_db,
        validate_not_v1_database,
    )


@pytest.fixture
def tmp_engine(tmp_path: Path):
    """Provides a fresh, isolated temporary V2 SQLite database engine."""
    db_file = tmp_path / "test_v2.db"
    engine = get_v2_engine(f"sqlite:///{db_file}")
    init_v2_db(engine)
    return engine


@pytest.fixture
def sample_csv_fixtures(tmp_path: Path):
    """Generates small, valid synthetic CSV fixtures for ingestion tests."""
    acc_path = tmp_path / "accounts.csv"
    txn_path = tmp_path / "transactions.csv"

    with open(acc_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "account_id", "customer_name", "customer_type", "kyc_tier", "phone_number",
            "email", "upi_id", "tax_identifier", "initial_balance", "current_balance",
            "account_opened_at", "status", "scenario_id", "ground_truth_label",
        ])
        writer.writerow([
            "ACC-000001", "Aditi Sharma", "retail", "tier_2_verified", "+91 98765 00001",
            "aditi@example.bank", "aditi@okbank", "SYNTH00001P", 100000.0, 75000.0,
            "2025-10-01T00:00:00+00:00", "active", "SCENARIO-APP-001", "compromised_victim",
        ])
        writer.writerow([
            "ACC-000002", "Rahul Verma", "retail", "tier_2_verified", "+91 98765 00002",
            "rahul@example.bank", "rahul@okbank", "SYNTH00002P", 5000.0, 30000.0,
            "2025-11-01T00:00:00+00:00", "active", "SCENARIO-APP-001", "mule_first_hop",
        ])

    with open(txn_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "transaction_id", "timestamp", "origin_account_id", "destination_account_id",
            "amount", "currency", "channel", "status", "origin_balance_before",
            "origin_balance_after", "dest_balance_before", "dest_balance_after",
            "scenario_id", "scenario_tag", "is_suspicious_scenario",
        ])
        writer.writerow([
            "TXN-0000001", "2026-01-01T10:00:00+00:00", "ACC-000001", "ACC-000002",
            25000.0, "INR", "UPI", "COMPLETED", 100000.0, 75000.0, 5000.0, 30000.0,
            "SCENARIO-APP-001", "app_scam_hop1", "True",
        ])

    return acc_path, txn_path


def test_schema_creation_and_constraints(tmp_engine):
    """Verify tables are created and check constraints are enforced."""
    with Session(tmp_engine) as session:
        # Negative balance constraint
        invalid_account = AccountModel(
            account_id="ACC-INVALID-1",
            customer_name="Test",
            customer_type="retail",
            kyc_tier="tier_1_basic",
            phone_number="123",
            email="test@test.com",
            upi_id="test@upi",
            tax_identifier="TAX1",
            initial_balance=-50.0,  # Negative!
            current_balance=0.0,
            account_opened_at=datetime.now(timezone.utc),
            status="active",
            ground_truth_label="normal",
        )
        session.add(invalid_account)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        # Non-positive transaction amount constraint
        acc = AccountModel(
            account_id="ACC-0001",
            customer_name="Sender",
            customer_type="retail",
            kyc_tier="tier_2_verified",
            phone_number="123",
            email="s@test.com",
            upi_id="s@upi",
            tax_identifier="TAX1",
            initial_balance=1000.0,
            current_balance=1000.0,
            account_opened_at=datetime.now(timezone.utc),
            status="active",
            ground_truth_label="normal",
        )
        session.add(acc)
        session.commit()

        invalid_txn = TransactionModel(
            transaction_id="TXN-INVALID-1",
            timestamp=datetime.now(timezone.utc),
            origin_account_id="ACC-0001",
            destination_account_id="ACC-0001",
            amount=-100.0,  # Invalid!
            currency="INR",
            channel="UPI",
            status="COMPLETED",
            origin_balance_before=1000.0,
            origin_balance_after=1100.0,
            dest_balance_before=1000.0,
            dest_balance_after=1100.0,
            scenario_tag="test",
            is_suspicious_scenario=False,
        )
        session.add(invalid_txn)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_foreign_key_integrity(tmp_engine):
    """Verify foreign key constraint prevents transactions with non-existent accounts."""
    with Session(tmp_engine) as session:
        orphan_txn = TransactionModel(
            transaction_id="TXN-ORPHAN-1",
            timestamp=datetime.now(timezone.utc),
            origin_account_id="ACC-GHOST-SENDER",
            destination_account_id="ACC-GHOST-RECEIVER",
            amount=500.0,
            currency="INR",
            channel="UPI",
            status="COMPLETED",
            origin_balance_before=1000.0,
            origin_balance_after=500.0,
            dest_balance_before=0.0,
            dest_balance_after=500.0,
            scenario_tag="test",
            is_suspicious_scenario=False,
        )
        session.add(orphan_txn)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_account_history_queries(tmp_engine):
    """Verify ORM relationships and chronological ledger queries."""
    with Session(tmp_engine) as session:
        a1 = AccountModel(
            account_id="ACC-A",
            customer_name="Alice",
            customer_type="retail",
            kyc_tier="tier_2_verified",
            phone_number="111",
            email="a@test.com",
            upi_id="a@upi",
            tax_identifier="PANA",
            initial_balance=5000.0,
            current_balance=2000.0,
            account_opened_at=datetime.now(timezone.utc),
            status="active",
            ground_truth_label="normal",
        )
        a2 = AccountModel(
            account_id="ACC-B",
            customer_name="Bob",
            customer_type="retail",
            kyc_tier="tier_2_verified",
            phone_number="222",
            email="b@test.com",
            upi_id="b@upi",
            tax_identifier="PANB",
            initial_balance=1000.0,
            current_balance=4000.0,
            account_opened_at=datetime.now(timezone.utc),
            status="active",
            ground_truth_label="normal",
        )
        session.add_all([a1, a2])
        session.commit()

        t1 = TransactionModel(
            transaction_id="TXN-1",
            timestamp=datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc),
            origin_account_id="ACC-A",
            destination_account_id="ACC-B",
            amount=1000.0,
            currency="INR",
            channel="UPI",
            status="COMPLETED",
            origin_balance_before=5000.0,
            origin_balance_after=4000.0,
            dest_balance_before=1000.0,
            dest_balance_after=2000.0,
            scenario_tag="baseline",
            is_suspicious_scenario=False,
        )
        t2 = TransactionModel(
            transaction_id="TXN-2",
            timestamp=datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc),
            origin_account_id="ACC-A",
            destination_account_id="ACC-B",
            amount=2000.0,
            currency="INR",
            channel="UPI",
            status="COMPLETED",
            origin_balance_before=4000.0,
            origin_balance_after=2000.0,
            dest_balance_before=2000.0,
            dest_balance_after=4000.0,
            scenario_tag="baseline",
            is_suspicious_scenario=False,
        )
        session.add_all([t1, t2])
        session.commit()

        # Query account history
        fetched_a1 = session.scalar(select(AccountModel).where(AccountModel.account_id == "ACC-A"))
        assert fetched_a1 is not None
        out_txns = list(fetched_a1.outgoing_transactions.order_by(TransactionModel.timestamp))
        assert len(out_txns) == 2
        assert out_txns[0].transaction_id == "TXN-1"
        assert out_txns[1].transaction_id == "TXN-2"


def test_ingestion_pipeline_success(tmp_engine, sample_csv_fixtures):
    """Verify clean ingestion of sample CSV fixtures."""
    acc_path, txn_path = sample_csv_fixtures
    result = ingest_v2_dataset(tmp_engine, acc_path, txn_path)

    assert result.is_success
    assert result.accounts_imported == 2
    assert result.transactions_imported == 1

    with Session(tmp_engine) as session:
        acc_cnt = session.scalar(select(func.count(AccountModel.account_id)))
        txn_cnt = session.scalar(select(func.count(TransactionModel.transaction_id)))
        assert acc_cnt == 2
        assert txn_cnt == 1

        acc1 = session.scalar(select(AccountModel).where(AccountModel.account_id == "ACC-000001"))
        assert acc1.customer_name == "Aditi Sharma"
        assert acc1.ground_truth_label == "compromised_victim"


def test_ingestion_duplicate_id_rollback(tmp_engine, tmp_path: Path):
    """Verify duplicate IDs trigger transaction rollback leaving database completely clean."""
    bad_acc_path = tmp_path / "bad_accounts.csv"
    dummy_txn_path = tmp_path / "empty_txns.csv"

    with open(bad_acc_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["account_id", "customer_name", "customer_type", "kyc_tier", "phone_number",
                         "email", "upi_id", "tax_identifier", "initial_balance", "current_balance",
                         "account_opened_at", "status", "scenario_id", "ground_truth_label"])
        writer.writerow(["ACC-DUP", "User 1", "retail", "tier_1_basic", "1", "e1", "u1", "t1", 100, 100, "2026-01-01T00:00:00+00:00", "active", "", "normal"])
        writer.writerow(["ACC-DUP", "User 2", "retail", "tier_1_basic", "2", "e2", "u2", "t2", 100, 100, "2026-01-01T00:00:00+00:00", "active", "", "normal"])

    with open(dummy_txn_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["transaction_id", "timestamp", "origin_account_id", "destination_account_id",
                         "amount", "currency", "channel", "status", "origin_balance_before",
                         "origin_balance_after", "dest_balance_before", "dest_balance_after",
                         "scenario_id", "scenario_tag", "is_suspicious_scenario"])

    with pytest.raises(DataIngestionError, match="Duplicate account_id"):
        ingest_v2_dataset(tmp_engine, bad_acc_path, dummy_txn_path)

    # Verify rollback
    with Session(tmp_engine) as session:
        count = session.scalar(select(func.count(AccountModel.account_id)))
        assert count == 0


def test_ingestion_unknown_account_reference_rollback(tmp_engine, tmp_path: Path):
    """Verify transaction with unknown counterparty triggers complete rollback."""
    acc_path = tmp_path / "acc.csv"
    bad_txn_path = tmp_path / "bad_txn.csv"

    with open(acc_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["account_id", "customer_name", "customer_type", "kyc_tier", "phone_number",
                         "email", "upi_id", "tax_identifier", "initial_balance", "current_balance",
                         "account_opened_at", "status", "scenario_id", "ground_truth_label"])
        writer.writerow(["ACC-1", "User 1", "retail", "tier_1_basic", "1", "e1", "u1", "t1", 1000, 1000, "2026-01-01T00:00:00+00:00", "active", "", "normal"])

    with open(bad_txn_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["transaction_id", "timestamp", "origin_account_id", "destination_account_id",
                         "amount", "currency", "channel", "status", "origin_balance_before",
                         "origin_balance_after", "dest_balance_before", "dest_balance_after",
                         "scenario_id", "scenario_tag", "is_suspicious_scenario"])
        # Dest account ACC-UNKNOWN does not exist!
        writer.writerow(["TXN-1", "2026-01-01T10:00:00+00:00", "ACC-1", "ACC-UNKNOWN", 100, "INR", "UPI", "COMPLETED", 1000, 900, 0, 100, "", "test", "False"])

    with pytest.raises(DataIngestionError, match="unknown destination_account_id"):
        ingest_v2_dataset(tmp_engine, acc_path, bad_txn_path)

    with Session(tmp_engine) as session:
        txn_count = session.scalar(select(func.count(TransactionModel.transaction_id)))
        acc_count = session.scalar(select(func.count(AccountModel.account_id)))
        assert txn_count == 0
        assert acc_count == 0


def test_ingestion_repeat_and_replace_behavior(tmp_engine, sample_csv_fixtures):
    """Verify rerun protection and explicit replace flag."""
    acc_path, txn_path = sample_csv_fixtures

    # First import
    res1 = ingest_v2_dataset(tmp_engine, acc_path, txn_path)
    assert res1.accounts_imported == 2

    # Second import without replace must fail safely
    with pytest.raises(DataIngestionError, match="already contains"):
        ingest_v2_dataset(tmp_engine, acc_path, txn_path, replace=False)

    # Third import with replace=True succeeds
    res2 = ingest_v2_dataset(tmp_engine, acc_path, txn_path, replace=True)
    assert res2.accounts_imported == 2
    assert res2.transactions_imported == 1


def test_safety_guard_prevents_v1_wipe():
    """Verify safety guard protects the legacy V1 database."""
    with pytest.raises(ValueError, match="Safety Violation"):
        validate_not_v1_database("fraudshield.db")

    with pytest.raises(ValueError, match="Safety Violation"):
        validate_not_v1_database("sqlite:///backend/fraudshield.db")

    with pytest.raises(ValueError, match="Safety Violation"):
        validate_not_v1_database("/path/to/backend/fraudshield.db")

    # Allowed: V2 database files
    validate_not_v1_database("sqlite:///data/v2_fraudshield.db")
    validate_not_v1_database("/path/to/data/v2_fraudshield.db")
