"""Regression tests for the simplified investigation product.

Covers:
1. FS-2001 is a faithful copy of V2 ledger records, derived without ground-truth labels.
2. Case/account dataset separation (no fabricated FS-1042 <-> ACC-000001 link).
3. Case overview fields (account dataset, recorded decisions).
4. Viewing a case does not flood the audit trail.
5. Model status reports real readiness and a reason when degraded.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes import get_db, get_repository
from app.data.case_sources import CASE_LEDGER, V2_SYNTHETIC_LEDGER, account_dataset_for
from app.db.models import Base
from app.db.seed import V2_SAMPLE_FIXTURE_PATH, seed_all_demo_data
from app.db.session import get_db as prod_get_db
from app.main import create_app
from app.repositories.sql_case_repository import SqlCaseRepository
from app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService

REPO_ROOT = Path(__file__).resolve().parents[2]
V2_DB = REPO_ROOT / "data" / "v2_fraudshield.db"
needs_v2_db = pytest.mark.skipif(not V2_DB.is_file(), reason="V2 synthetic ledger database not present")


@pytest.fixture
def case_client():
    """Isolated client with both sample cases seeded into a temporary database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    with TestingSession() as s:
        seed_all_demo_data(s)

    app = create_app()

    def override_get_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    def override_get_repo():
        s = TestingSession()
        try:
            yield SqlCaseRepository(s)
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[prod_get_db] = override_get_db
    app.dependency_overrides[get_repository] = override_get_repo
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    engine.dispose()
    if os.path.exists(db_path):
        os.remove(db_path)


# ------------------------------------------------------------------------------
# 1. FS-2001 provenance
# ------------------------------------------------------------------------------
@needs_v2_db
def test_fs2001_transactions_match_v2_ledger_exactly():
    fixture = json.loads(V2_SAMPLE_FIXTURE_PATH.read_text())
    con = sqlite3.connect(V2_DB)
    for t in fixture["transactions"]:
        row = con.execute(
            "SELECT origin_account_id, destination_account_id, amount, channel, timestamp "
            "FROM transactions WHERE transaction_id = ?",
            (t["transaction_id"],),
        ).fetchone()
        assert row is not None, t["transaction_id"]
        assert row[0] == t["sender_account_id"]
        assert row[1] == t["receiver_account_id"]
        assert row[2] == t["amount"]
        assert row[3] == t["transaction_type"]
        assert row[4].replace(" ", "T").startswith(t["timestamp"])
    for a in fixture["accounts"]:
        assert con.execute("SELECT 1 FROM accounts WHERE account_id = ?", (a["account_id"],)).fetchone()


@needs_v2_db
def test_fs2001_fixture_is_reproducible_by_label_free_rule():
    spec = importlib.util.spec_from_file_location("build_case", REPO_ROOT / "scripts" / "build_v2_sample_case.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.build() == json.loads(V2_SAMPLE_FIXTURE_PATH.read_text())
    # The builder must never read ground-truth columns.
    source = (REPO_ROOT / "scripts" / "build_v2_sample_case.py").read_text()
    for column in ("scenario_tag", "ground_truth_label", "is_suspicious_scenario"):
        assert f"SELECT {column}" not in source and f", {column}" not in source


def test_fs2001_roles_are_structural_not_verdicts():
    fixture = json.loads(V2_SAMPLE_FIXTURE_PATH.read_text())
    roles = {a["role"] for a in fixture["accounts"]}
    assert roles <= {"reporting_victim", "reported_initial_receiver", "intermediate_recipient", "recipient"}
    text = json.dumps(fixture).lower()
    for word in ("mule", "fraudster", "scammer", "cashout_terminal"):
        assert word not in text


# ------------------------------------------------------------------------------
# 2. Dataset separation
# ------------------------------------------------------------------------------
def test_case_dataset_registry():
    assert account_dataset_for("FS-1042") == CASE_LEDGER
    assert account_dataset_for("FS-2001") == V2_SYNTHETIC_LEDGER
    assert account_dataset_for("FS-UNKNOWN") == CASE_LEDGER


def test_v2_account_cannot_be_reviewed_under_unrelated_case(case_client):
    r = case_client.put(
        "/api/cases/FS-1042/accounts/ACC-000001/review",
        json={"review_state": "review_completed", "reviewer_id": "tester"},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] in {"account_not_found", "account_not_in_case_scope"}


def test_fs1042_account_cannot_be_reviewed_under_fs2001(case_client):
    r = case_client.put(
        "/api/cases/FS-2001/accounts/A100/review",
        json={"review_state": "under_review", "reviewer_id": "tester"},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "account_not_in_case_scope"


# ------------------------------------------------------------------------------
# 3. Case overview + review persistence
# ------------------------------------------------------------------------------
def test_case_overview_counts_only_recorded_decisions(case_client):
    before = case_client.get("/api/cases/FS-2001").json()
    assert before["account_dataset"] == V2_SYNTHETIC_LEDGER
    assert before["review_progress"] == {"accounts_in_case": 6, "decisions_recorded": 0, "last_decision_at": None}

    r = case_client.put(
        "/api/cases/FS-2001/accounts/ACC-000003/review",
        json={
            "review_state": "under_investigation",
            "evidence_quality": "graph_connection_only",
            "reviewer_id": "analyst_1",
            "notes": "Forwarded 245,000 within 10 minutes.",
            "supporting_transaction_ids": ["TXN-0062200", "TXN-0062205"],
        },
    )
    assert r.status_code == 200

    after = case_client.get("/api/cases/FS-2001").json()
    assert after["review_progress"]["decisions_recorded"] == 1
    assert after["review_progress"]["last_decision_at"] is not None

    assessment = case_client.get("/api/cases/FS-2001/accounts/ACC-000003/assessment").json()
    assert assessment["review_status"]["review_state"] == "under_investigation"
    assert assessment["review_status"]["reviewer_id"] == "analyst_1"

    events = case_client.get("/api/cases/FS-2001/audit-trail").json()["events"]
    review_events = [e for e in events if e["action"] == "account_review_recorded"]
    assert len(review_events) == 1
    details = review_events[0]["details"]
    assert details["account_id"] == "ACC-000003"
    assert details["new_review_state"] == "under_investigation"
    # No API key configured in tests: identity is client-asserted, and must say so.
    assert details["reviewer_identity_verified"] is False


def test_fs2001_trace_keeps_reported_loss_separate_from_movement(case_client):
    s = case_client.get("/api/cases/FS-2001/trace").json()["summary"]
    assert s["reported_amount"] == 250000
    assert s["gross_observed_transaction_value"] == 736000
    assert s["traced_transaction_count"] == 5


# ------------------------------------------------------------------------------
# 4. Audit noise
# ------------------------------------------------------------------------------
def test_repeated_case_views_do_not_add_audit_events(case_client):
    case_client.get("/api/cases/FS-1042/graph")
    first = case_client.get("/api/cases/FS-1042/audit-trail").json()["count"]
    for _ in range(3):
        case_client.get("/api/cases/FS-1042/graph")
        case_client.get("/api/cases/FS-1042/trace")
    assert case_client.get("/api/cases/FS-1042/audit-trail").json()["count"] == first


# ------------------------------------------------------------------------------
# 5. Model status
# ------------------------------------------------------------------------------
def test_model_status_ready_when_model_loads(case_client):
    body = case_client.get("/api/v2/models/status").json()
    if not body["account_model"]["available"]:
        pytest.skip("account model artifact not present")
    assert body["inference_ready"] is True
    assert body["overall_status"] == "healthy"


def test_model_status_reports_load_failure_without_claiming_healthy(case_client):
    with patch.object(
        V2MLInferenceService,
        "load_account_model",
        side_effect=ModelUnavailableException("The account risk model file exists but could not be loaded."),
    ):
        body = case_client.get("/api/v2/models/status").json()
    if not body["account_model"]["available"]:
        pytest.skip("account model artifact not present")
    assert body["inference_ready"] is False
    assert body["overall_status"] != "healthy"
    assert "could not be loaded" in body["status_detail"]


def test_missing_model_message_hides_server_paths(tmp_path):
    original_dir, original_model = V2MLInferenceService.ACCOUNT_ARTIFACTS_DIR, V2MLInferenceService._account_model
    try:
        V2MLInferenceService.ACCOUNT_ARTIFACTS_DIR = tmp_path
        V2MLInferenceService._account_model = None
        with pytest.raises(ModelUnavailableException) as exc:
            V2MLInferenceService.load_account_model()
        assert str(tmp_path) not in str(exc.value)
        status = V2MLInferenceService.get_model_status()
        assert status.inference_ready is False
        assert status.overall_status == "degraded_missing_account_model"
        assert str(tmp_path) not in (status.status_detail or "")
    finally:
        V2MLInferenceService.ACCOUNT_ARTIFACTS_DIR = original_dir
        V2MLInferenceService._account_model = original_model
