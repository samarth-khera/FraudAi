"""Tests for Phase 4 persistent database, case management, and audit trail."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.routes import get_db, get_repository
from app.db.models import AccountModel, AuditEventModel, Base, FraudCaseModel, TransactionModel
from app.db.seed import seed_demo_data
from app.db.session import get_db as prod_get_db
from app.main import create_app
from app.models.domain import EvidenceQuality, InvestigationStatus, ReviewState
from app.repositories.sql_case_repository import SqlCaseRepository


@pytest.fixture
def test_db():
    """Provides a fresh isolated SQLite database for testing."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    db_url = f"sqlite:///{db_path}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Seed initial demo data
    with TestingSessionLocal() as session:
        seed_demo_data(session)

    yield TestingSessionLocal, engine

    engine.dispose()
    if os.path.exists(db_path):
        os.remove(db_path)


@pytest.fixture
def db_client(test_db):
    """Provides a TestClient connected to the isolated test database."""
    TestingSessionLocal, _ = test_db
    app = create_app()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    def override_get_repository():
        session = TestingSessionLocal()
        try:
            yield SqlCaseRepository(session)
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_repository] = override_get_repository
    app.dependency_overrides[prod_get_db] = override_get_db

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_alembic_migrations():
    """Verify that Alembic migrations run cleanly against a fresh SQLite database."""
    backend_dir = Path(__file__).resolve().parent.parent
    ini_path = backend_dir / "alembic.ini"
    assert ini_path.exists(), f"alembic.ini not found at {ini_path}"

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        migration_db_path = tmp.name

    try:
        migration_url = f"sqlite:///{migration_db_path}"
        cfg = Config(str(ini_path))
        cfg.set_main_option("sqlalchemy.url", migration_url)
        # Run upgrade head
        command.upgrade(cfg, "head")

        # Verify tables exist
        engine = create_engine(migration_url)
        with engine.connect() as conn:
            from sqlalchemy import inspect
            inspector = inspect(conn)
            table_names = inspector.get_table_names()
            assert "fraud_cases" in table_names
            assert "accounts" in table_names
            assert "transactions" in table_names
            assert "account_review_statuses" in table_names
            assert "audit_events" in table_names
            assert "case_trace_paths" in table_names
        engine.dispose()
    finally:
        if os.path.exists(migration_db_path):
            os.remove(migration_db_path)


def test_alembic_migrations_use_database_url_env(monkeypatch):
    """`alembic upgrade head` as documented (no URL in alembic.ini) must read DATABASE_URL."""
    backend_dir = Path(__file__).resolve().parent.parent
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        migration_db_path = tmp.name
    try:
        migration_url = f"sqlite:///{migration_db_path}"
        monkeypatch.setenv("DATABASE_URL", migration_url)
        command.upgrade(Config(str(backend_dir / "alembic.ini")), "head")
        from sqlalchemy import inspect

        engine = create_engine(migration_url)
        with engine.connect() as conn:
            assert "fraud_cases" in inspect(conn).get_table_names()
        engine.dispose()
    finally:
        if os.path.exists(migration_db_path):
            os.remove(migration_db_path)


def test_idempotent_seed_data(test_db):
    """Calling seed_demo_data multiple times must not duplicate cases, transactions, or accounts."""
    TestingSessionLocal, _ = test_db
    with TestingSessionLocal() as session:
        # Seed twice more
        seed_demo_data(session)
        seed_demo_data(session)

        cases = session.scalars(select(FraudCaseModel)).all()
        assert len(cases) == 1
        assert cases[0].case_id == "FS-1042"

        txs = session.scalars(select(TransactionModel)).all()
        assert len(txs) == 7

        accounts = session.scalars(select(AccountModel)).all()
        assert len(accounts) == 8


def test_create_case_success_and_duplicate(db_client):
    """POST /api/cases should create a new case, and reject duplicate case IDs with 409."""
    payload = {
        "case_id": "FS-2001",
        "reported_origin_transaction_id": "TX_ORIG_001",
        "reported_amount": 75000.0,
        "currency": "INR",
        "reported_at": "2026-02-01T10:00:00Z",
        "investigation_status": "open",
        "description": "UPI fraudulent transfer report",
        "created_by": "officer_123",
    }

    # 1. Successful creation
    res = db_client.post("/api/cases", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["case_id"] == "FS-2001"
    assert data["investigation_status"] == "open"
    assert float(data["reported_amount"]) == 75000.0

    # 2. Duplicate creation rejected with 409
    res_dup = db_client.post("/api/cases", json=payload)
    assert res_dup.status_code == 409
    err = res_dup.json()["error"]
    assert "already exists" in err["message"] or "DUPLICATE" in err.get("code", "").upper()


def test_get_case_and_transactions(db_client):
    """GET /api/cases/{case_id} returns case details and GET /api/cases/{case_id}/transactions returns transactions."""
    # Existing demo case
    res = db_client.get("/api/cases/FS-1042")
    assert res.status_code == 200
    data = res.json()
    assert data["case_id"] == "FS-1042"
    assert float(data["reported_amount"]) == 50000.0
    assert data["investigation_status"] == "under_investigation"

    # Get transactions for FS-1042
    tx_res = db_client.get("/api/cases/FS-1042/transactions")
    assert tx_res.status_code == 200
    tx_data = tx_res.json()
    assert tx_data["count"] == 7
    assert len(tx_data["transactions"]) == 7

    # Nonexistent case returns 404
    res_404 = db_client.get("/api/cases/FS-9999")
    assert res_404.status_code == 404
    assert res_404.json()["error"]["code"] == "case_not_found"


def test_list_cases_pagination(db_client):
    """GET /api/cases supports pagination parameters (skip, limit)."""
    # Create two additional cases
    for cid in ["FS-3001", "FS-3002"]:
        res_post = db_client.post(
            "/api/cases",
            json={
                "case_id": cid,
                "reported_origin_transaction_id": f"TX_{cid}",
                "reported_amount": 25000.0,
                "currency": "INR",
                "reported_at": "2026-02-05T12:00:00Z",
                "investigation_status": "open",
                "description": f"Test case {cid}",
            },
        )
        assert res_post.status_code == 201

    # Total should now be 3 (FS-1042 + 2 new)
    res_all = db_client.get("/api/cases?skip=0&limit=10")
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["total"] == 3
    assert len(data_all["cases"]) == 3

    # Limit 1, skip 1
    res_page = db_client.get("/api/cases?skip=1&limit=1")
    assert res_page.status_code == 200
    data_page = res_page.json()
    assert data_page["total"] == 3
    assert len(data_page["cases"]) == 1
    assert data_page["skip"] == 1
    assert data_page["limit"] == 1


def test_patch_case_metadata_and_audit(db_client):
    """PATCH /api/cases/{case_id} updates permitted metadata and creates audit events."""
    patch_payload = {
        "investigation_status": "closed",
        "description": "Updated case description after initial triage",
        "updated_by": "analyst_bob",
    }
    res = db_client.patch("/api/cases/FS-1042", json=patch_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["investigation_status"] == "closed"
    assert data["description"] == "Updated case description after initial triage"

    # Verify audit event was logged
    audit_res = db_client.get("/api/cases/FS-1042/audit-trail")
    assert audit_res.status_code == 200
    audit_data = audit_res.json()
    actions = [e["action"] for e in audit_data["events"]]
    assert "case_metadata_updated" in actions


def test_add_transactions_and_duplicate_conflict(db_client):
    """POST /api/cases/{case_id}/transactions adds transactions and prevents conflicting duplicates."""
    # Create an isolated case first
    db_client.post(
        "/api/cases",
        json={
            "case_id": "FS-4001",
            "reported_origin_transaction_id": "TX_4001_ORIG",
            "reported_amount": 50000.0,
            "currency": "INR",
            "reported_at": "2026-02-10T10:00:00Z",
            "investigation_status": "open",
            "description": "Case 4001",
        },
    )

    tx_payload = {
        "transactions": [
            {
                "transaction_id": "TX_4001_A",
                "timestamp": "2026-02-10T10:05:00Z",
                "sender_account_id": "ACC_SENDER_1",
                "receiver_account_id": "ACC_MID_1",
                "amount": 25000.0,
                "currency": "INR",
                "transaction_type": "UPI",
            },
            {
                "transaction_id": "TX_4001_B",
                "timestamp": "2026-02-10T10:15:00Z",
                "sender_account_id": "ACC_MID_1",
                "receiver_account_id": "ACC_END_1",
                "amount": 20000.0,
                "currency": "INR",
                "transaction_type": "IMPS",
            },
        ],
        "added_by": "ingestion_worker",
    }

    res = db_client.post("/api/cases/FS-4001/transactions", json=tx_payload)
    assert res.status_code == 201
    added_txs = res.json()
    assert len(added_txs) == 2

    # Conflicting duplicate: same ID but different amount or sender
    conflict_payload = {
        "transactions": [
            {
                "transaction_id": "TX_4001_A",
                "timestamp": "2026-02-10T10:05:00Z",
                "sender_account_id": "DIFFERENT_SENDER",
                "receiver_account_id": "ACC_MID_1",
                "amount": 99999.0,
                "currency": "INR",
                "transaction_type": "UPI",
            }
        ],
        "added_by": "ingestion_worker",
    }
    res_conflict = db_client.post("/api/cases/FS-4001/transactions", json=conflict_payload)
    assert res_conflict.status_code == 409
    assert res_conflict.json()["error"]["code"] == "duplicate_transaction_conflicting"


def test_account_review_decision_and_audit(db_client):
    """PUT /api/cases/{case_id}/accounts/{account_id}/review records decision and append-only audit."""
    review_payload = {
        "review_state": "under_review",
        "evidence_quality": "not_assessed",
        "reviewer_id": "investigator_alice",
        "notes": "Account received downstream funds; KYC verified.",
    }
    res = db_client.put(
        "/api/cases/FS-1042/accounts/A100/review", json=review_payload
    )
    assert res.status_code == 200
    data = res.json()
    assert data["account_id"] == "A100"
    assert data["review_state"] == "under_review"
    assert data["reviewer_id"] == "investigator_alice"
    assert data["notes"] == "Account received downstream funds; KYC verified."

    # Update review status to review_completed
    clear_payload = {
        "review_state": "review_completed",
        "evidence_quality": "corroborated",
        "reviewer_id": "lead_investigator_bob",
        "notes": "Confirmed innocent merchant payment with valid invoice.",
    }
    res_clear = db_client.put(
        "/api/cases/FS-1042/accounts/A100/review", json=clear_payload
    )
    assert res_clear.status_code == 200
    assert res_clear.json()["review_state"] == "review_completed"

    # Audit trail verification
    audit_res = db_client.get("/api/cases/FS-1042/audit-trail")
    assert audit_res.status_code == 200
    audit_data = audit_res.json()
    review_events = [e for e in audit_data["events"] if e["action"] == "account_review_recorded"]
    assert len(review_events) == 2
    assert review_events[0]["performed_by"] == "investigator_alice"
    assert review_events[1]["performed_by"] == "lead_investigator_bob"
    assert review_events[0]["details"]["new_review_state"] == "under_review"
    assert review_events[1]["details"]["new_review_state"] == "review_completed"


def test_invalid_requests_validation(db_client):
    """Validation errors return 422 Unprocessable Entity."""
    # Invalid investigation status
    res = db_client.post(
        "/api/cases",
        json={
            "case_id": "FS-INVALID",
            "reported_origin_transaction_id": "TX_001",
            "reported_amount": 100.0,
            "description": "Invalid status test",
            "investigation_status": "TOTALLY_INVALID_STATUS",
        },
    )
    assert res.status_code == 422

    # Negative reported amount
    res_neg = db_client.post(
        "/api/cases",
        json={
            "case_id": "FS-INVALID-2",
            "reported_origin_transaction_id": "TX_002",
            "reported_amount": -500.0,
            "description": "Negative amount test",
        },
    )
    assert res_neg.status_code == 422

    # Empty transaction batch
    res_empty_tx = db_client.post(
        "/api/cases/FS-1042/transactions", json={"transactions": []}
    )
    assert res_empty_tx.status_code == 422


def test_trace_persists_trace_paths(db_client):
    """Calling /api/cases/{case_id}/trace computes downstream trace and saves trace paths & audit."""
    res = db_client.get("/api/cases/FS-1042/trace")
    assert res.status_code == 200
    data = res.json()
    assert data["case_id"] == "FS-1042"
    assert len(data["paths"]) > 0

    # Verify audit trail recorded trace_paths_persisted
    audit_res = db_client.get("/api/cases/FS-1042/audit-trail")
    assert audit_res.status_code == 200
    actions = [e["action"] for e in audit_res.json()["events"]]
    assert "trace_paths_persisted" in actions


def test_database_isolation():
    """Ensure two separate test database connections do not leak state between each other."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f1, tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f2:
        path1, path2 = f1.name, f2.name

    try:
        e1 = create_engine(f"sqlite:///{path1}")
        e2 = create_engine(f"sqlite:///{path2}")
        Base.metadata.create_all(bind=e1)
        Base.metadata.create_all(bind=e2)

        S1 = sessionmaker(bind=e1)
        S2 = sessionmaker(bind=e2)

        with S1() as s1:
            s1.add(
                FraudCaseModel(
                    case_id="ISOLATED-1",
                    reported_origin_transaction_id="TX1",
                    reported_amount=100.0,
                    description="Case isolated",
                )
            )
            s1.commit()

        with S2() as s2:
            case_in_s2 = s2.scalar(
                select(FraudCaseModel).where(FraudCaseModel.case_id == "ISOLATED-1")
            )
            assert case_in_s2 is None

        e1.dispose()
        e2.dispose()
    finally:
        for p in (path1, path2):
            if os.path.exists(p):
                os.remove(p)
