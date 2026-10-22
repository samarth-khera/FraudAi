"""Tests for FraudShield AI V2 Live Analysis Endpoint & Recommendation Synthesis."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

try:
    from app.db.v2.models import AccountModel, TransactionModel
    from app.db.v2.session import get_v2_db, get_v2_engine, init_v2_db
    from app.main import app
    from app.services.v2.live_analysis import AccountLiveAnalysisService
except ModuleNotFoundError:
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.db.v2.session import get_v2_db, get_v2_engine, init_v2_db
    from backend.app.main import app
    from backend.app.services.v2.live_analysis import AccountLiveAnalysisService


@pytest.fixture
def test_v2_db(tmp_path: Path):
    """Sets up an isolated V2 test database populated with forensic test scenarios."""
    db_file = tmp_path / "test_v2_live.db"
    engine = get_v2_engine(f"sqlite:///{db_file}")
    init_v2_db(engine)

    with Session(engine) as session:
        t0 = datetime(2026, 1, 10, 10, 0, 0, tzinfo=timezone.utc)

        # 1. Accounts
        victim = AccountModel(
            account_id="ACC-VICTIM",
            customer_name="Victim Customer",
            customer_type="retail",
            kyc_tier="tier_2_verified",
            phone_number="+91 90000 00001",
            email="victim@example.bank",
            upi_id="victim@okbank",
            tax_identifier="PANVIC001",
            initial_balance=300000.0,
            current_balance=50000.0,
            account_opened_at=t0 - timedelta(days=180),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="compromised_victim",
        )
        mule = AccountModel(
            account_id="ACC-MULE-1",
            customer_name="First Hop Mule",
            customer_type="retail",
            kyc_tier="tier_1_basic",
            phone_number="+91 90000 00002",
            email="mule1@example.bank",
            upi_id="mule1@okbank",
            tax_identifier="PANMUL001",
            initial_balance=1000.0,
            current_balance=251000.0,
            account_opened_at=t0 - timedelta(days=90),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="intermediate_mule",
        )
        merchant = AccountModel(
            account_id="ACC-MERCHANT-1",
            customer_name="Merchant POS",
            customer_type="sme",
            kyc_tier="tier_2_verified",
            phone_number="+91 90000 00003",
            email="merchant@example.bank",
            upi_id="merchant@okbank",
            tax_identifier="PANMER001",
            initial_balance=10000.0,
            current_balance=14500.0,
            account_opened_at=t0 - timedelta(days=200),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="legitimate_customer",
        )
        session.add_all([victim, mule, merchant])
        session.commit()

        # 2. Add normal activity + one large outlier debit for victim
        for i in range(1, 10):
            session.add(
                TransactionModel(
                    transaction_id=f"TXN-NORM-{i:03d}",
                    timestamp=t0 + timedelta(days=i),
                    origin_account_id="ACC-VICTIM",
                    destination_account_id="ACC-MERCHANT-1",
                    amount=500.0,
                    currency="INR",
                    channel="CARD_POS",
                    status="SETTLED",
                    origin_balance_before=300000.0 - (i - 1) * 500.0,
                    origin_balance_after=300000.0 - i * 500.0,
                    dest_balance_before=10000.0 + (i - 1) * 500.0,
                    dest_balance_after=10000.0 + i * 500.0,
                    scenario_id="SCENARIO-APP-001",
                    scenario_tag="normal_pos",
                    is_suspicious_scenario=False,
                )
            )

        # Unauthorized large drain
        drain_txn = TransactionModel(
            transaction_id="TXN-DRAIN-001",
            timestamp=t0 + timedelta(days=15),
            origin_account_id="ACC-VICTIM",
            destination_account_id="ACC-MULE-1",
            amount=250000.0,
            currency="INR",
            channel="IMPS",
            status="SETTLED",
            origin_balance_before=295500.0,
            origin_balance_after=45500.0,
            dest_balance_before=1000.0,
            dest_balance_after=251000.0,
            scenario_id="SCENARIO-APP-001",
            scenario_tag="victim_drain",
            is_suspicious_scenario=True,
        )
        session.add(drain_txn)
        session.commit()

    return engine


@pytest.fixture
def client(test_v2_db):
    """Provides a TestClient with database session override."""
    def override_get_v2_db():
        with Session(test_v2_db) as session:
            yield session

    app.dependency_overrides[get_v2_db] = override_get_v2_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_live_analysis_orchestration(client: TestClient):
    """Verifies that POST /accounts/{account_id}/analyze computes fresh live results."""
    resp = client.post("/api/v2/accounts/ACC-VICTIM/analyze")
    assert resp.status_code == 200
    data = resp.json()

    assert data["account_id"] == "ACC-VICTIM"
    assert data["analysis_id"].startswith("RUN-")
    assert "analyzed_at" in data
    assert data["model_version"] == "v2-account-1.0.0"

    # Ledger snapshot verification
    snapshot = data["ledger_snapshot"]
    assert snapshot["transactions_examined"] == 10
    assert snapshot["total_sent"] == 254500.0
    assert snapshot["current_balance"] == 50000.0

    # Rule and ML assessments
    rule = data["rule_assessment"]
    assert rule["account_id"] == "ACC-VICTIM"
    assert rule["risk_score"] >= 0.0
    assert rule["signals"]["max_amount"] == 250000.0

    ml = data["ml_assessment"]
    assert ml["account_id"] == "ACC-VICTIM"
    assert "risk_score" in ml
    assert "top_contributions" in ml
    assert len(ml["top_contributions"]) > 0

    # Divergence
    div = data["divergence"]
    assert "divergence_detected" in div
    assert "interpretation" in div
    assert "suggested_focus" in div

    # Recommendations
    recs = data["recommended_actions"]
    assert len(recs) >= 1
    for rec in recs:
        assert "action_id" in rec
        assert "title" in rec
        assert "priority" in rec
        assert "rationale" in rec
        assert "supporting_evidence" in rec
        assert "suggested_records" in rec
        assert "remaining_uncertainty" in rec

    # Non-punitive guardrail
    assert "punitive" in data["disclaimer"].lower() or "freezing" in data["disclaimer"].lower()


def test_live_analysis_unknown_account_404(client: TestClient):
    """Verifies 404 response for unknown account."""
    resp = client.post("/api/v2/accounts/ACC-NONEXISTENT/analyze")
    assert resp.status_code == 404
    data = resp.json()
    assert data["error"]["code"] == "account_not_found"


def test_live_analysis_dynamic_update_on_new_ledger_record(test_v2_db, client: TestClient):
    """Verifies that inserting a new transaction dynamically updates snapshot and feature analysis."""
    # First analysis: 10 transactions
    resp1 = client.post("/api/v2/accounts/ACC-VICTIM/analyze")
    assert resp1.status_code == 200
    assert resp1.json()["ledger_snapshot"]["transactions_examined"] == 10

    # Add 1 new transaction directly to the database
    with Session(test_v2_db) as session:
        new_txn = TransactionModel(
            transaction_id="TXN-NEW-999",
            timestamp=datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc),
            origin_account_id="ACC-VICTIM",
            destination_account_id="ACC-MERCHANT-1",
            amount=1500.0,
            currency="INR",
            channel="UPI",
            status="SETTLED",
            origin_balance_before=50000.0,
            origin_balance_after=48500.0,
            dest_balance_before=14500.0,
            dest_balance_after=16000.0,
            scenario_id="SCENARIO-APP-001",
            scenario_tag="pos_payment",
            is_suspicious_scenario=False,
        )
        session.add(new_txn)
        session.commit()

    # Second analysis: should now examine 11 transactions with updated total_sent
    resp2 = client.post("/api/v2/accounts/ACC-VICTIM/analyze")
    assert resp2.status_code == 200
    snapshot2 = resp2.json()["ledger_snapshot"]
    assert snapshot2["transactions_examined"] == 11
    assert snapshot2["total_sent"] == 256000.0
    assert resp2.json()["analysis_id"] != resp1.json()["analysis_id"]
