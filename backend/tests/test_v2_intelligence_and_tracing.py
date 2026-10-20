"""Comprehensive tests for FraudShield AI V2 Account Intelligence, Tracing & Risk Assessment."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    from app.db.v2.models import AccountModel, TransactionModel
    from app.db.v2.session import get_v2_db, get_v2_engine, init_v2_db
    from app.main import app
except ModuleNotFoundError:
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.db.v2.session import get_v2_db, get_v2_engine, init_v2_db
    from backend.app.main import app


@pytest.fixture
def test_v2_db(tmp_path: Path):
    """Sets up an isolated V2 test database populated with forensic test scenarios."""
    db_file = tmp_path / "test_v2_forensics.db"
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
            current_balance=100000.0,
            account_opened_at=t0 - timedelta(days=180),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="compromised_victim",
        )
        mule1 = AccountModel(
            account_id="ACC-MULE-1",
            customer_name="First Hop Mule",
            customer_type="retail",
            kyc_tier="tier_1_basic",
            phone_number="+91 90000 00002",
            email="mule1@example.bank",
            upi_id="mule1@okbank",
            tax_identifier="PANMUL001",
            initial_balance=500.0,
            current_balance=10500.0,
            account_opened_at=t0 - timedelta(days=90),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="mule_first_hop",
        )
        mule2 = AccountModel(
            account_id="ACC-MULE-2",
            customer_name="Intermediate Mule",
            customer_type="student",
            kyc_tier="tier_1_basic",
            phone_number="+91 90000 00003",
            email="mule2@example.bank",
            upi_id="mule2@okbank",
            tax_identifier="PANMUL002",
            initial_balance=200.0,
            current_balance=200.0,
            account_opened_at=t0 - timedelta(days=45),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="mule_intermediate",
        )
        cashout = AccountModel(
            account_id="ACC-CASHOUT",
            customer_name="ATM Terminal Sink",
            customer_type="merchant",
            kyc_tier="tier_2_verified",
            phone_number="+91 90000 00004",
            email="cashout@example.bank",
            upi_id="cashout@okbank",
            tax_identifier="PANCAS001",
            initial_balance=10000.0,
            current_balance=198000.0,
            account_opened_at=t0 - timedelta(days=365),
            status="active",
            scenario_id="SCENARIO-APP-001",
            ground_truth_label="cashout_terminal",
        )
        normal = AccountModel(
            account_id="ACC-NORMAL",
            customer_name="Innocent Merchant",
            customer_type="retail",
            kyc_tier="tier_2_verified",
            phone_number="+91 90000 00005",
            email="normal@example.bank",
            upi_id="normal@okbank",
            tax_identifier="PANNOR001",
            initial_balance=50000.0,
            current_balance=52500.0,
            account_opened_at=t0 - timedelta(days=200),
            status="active",
            scenario_id=None,
            ground_truth_label="legitimate_merchant",
        )
        dormant = AccountModel(
            account_id="ACC-DORMANT",
            customer_name="Dormant Sleeper",
            customer_type="retail",
            kyc_tier="tier_1_basic",
            phone_number="+91 90000 00006",
            email="dormant@example.bank",
            upi_id="dormant@okbank",
            tax_identifier="PANDOR001",
            initial_balance=50.0,
            current_balance=100050.0,
            account_opened_at=t0 - timedelta(days=120),
            status="dormant",
            scenario_id="SCENARIO-DORMANT-005",
            ground_truth_label="dormant_awakened_mule",
        )
        cyc_a = AccountModel(
            account_id="ACC-CYC-A",
            customer_name="Shell Entity Alpha",
            customer_type="corporate",
            kyc_tier="tier_2_verified",
            phone_number="+91 90000 00007",
            email="cyca@example.bank",
            upi_id="cyca@okbank",
            tax_identifier="PANCYC001",
            initial_balance=100000.0,
            current_balance=100000.0,
            account_opened_at=t0 - timedelta(days=100),
            status="active",
            scenario_id="SCENARIO-CYCLE-004",
            ground_truth_label="shell_roundtripper",
        )
        cyc_b = AccountModel(
            account_id="ACC-CYC-B",
            customer_name="Shell Entity Beta",
            customer_type="corporate",
            kyc_tier="tier_2_verified",
            phone_number="+91 90000 00008",
            email="cycb@example.bank",
            upi_id="cycb@okbank",
            tax_identifier="PANCYC002",
            initial_balance=100000.0,
            current_balance=100000.0,
            account_opened_at=t0 - timedelta(days=100),
            status="active",
            scenario_id="SCENARIO-CYCLE-004",
            ground_truth_label="shell_roundtripper",
        )

        session.add_all([victim, mule1, mule2, cashout, normal, dormant, cyc_a, cyc_b])
        session.flush()

        # 2. Transactions
        # Scenario 1: APP Scam multi-hop
        # Hop 1: Victim -> Mule 1 (200,000)
        t_hop1 = t0
        session.add(
            TransactionModel(
                transaction_id="TX-001",
                timestamp=t_hop1,
                origin_account_id="ACC-VICTIM",
                destination_account_id="ACC-MULE-1",
                amount=200000.0,
                currency="INR",
                channel="IMPS",
                status="COMPLETED",
                origin_balance_before=300000.0,
                origin_balance_after=100000.0,
                dest_balance_before=500.0,
                dest_balance_after=200500.0,
                scenario_id="SCENARIO-APP-001",
                scenario_tag="app_hop1",
                is_suspicious_scenario=True,
            )
        )
        # Hop 2: Mule 1 -> Mule 2 (190,000 after 8 minutes - rapid pass-through!)
        t_hop2 = t_hop1 + timedelta(minutes=8)
        session.add(
            TransactionModel(
                transaction_id="TX-002",
                timestamp=t_hop2,
                origin_account_id="ACC-MULE-1",
                destination_account_id="ACC-MULE-2",
                amount=190000.0,
                currency="INR",
                channel="UPI",
                status="COMPLETED",
                origin_balance_before=200500.0,
                origin_balance_after=10500.0,
                dest_balance_before=200.0,
                dest_balance_after=190200.0,
                scenario_id="SCENARIO-APP-001",
                scenario_tag="app_hop2",
                is_suspicious_scenario=True,
            )
        )
        # Hop 3: Mule 2 -> Cashout Terminal (188,000 after 12 minutes)
        t_hop3 = t_hop2 + timedelta(minutes=12)
        session.add(
            TransactionModel(
                transaction_id="TX-003",
                timestamp=t_hop3,
                origin_account_id="ACC-MULE-2",
                destination_account_id="ACC-CASHOUT",
                amount=188000.0,
                currency="INR",
                channel="ATM_CASH_OUT",
                status="COMPLETED",
                origin_balance_before=190200.0,
                origin_balance_after=2200.0,
                dest_balance_before=10000.0,
                dest_balance_after=198000.0,
                scenario_id="SCENARIO-APP-001",
                scenario_tag="app_hop3",
                is_suspicious_scenario=True,
            )
        )
        # Mule 2 also buys lunch for 200 INR from ACC-NORMAL (innocent merchant)
        session.add(
            TransactionModel(
                transaction_id="TX-004",
                timestamp=t_hop3 + timedelta(minutes=5),
                origin_account_id="ACC-MULE-2",
                destination_account_id="ACC-NORMAL",
                amount=200.0,
                currency="INR",
                channel="UPI",
                status="COMPLETED",
                origin_balance_before=2200.0,
                origin_balance_after=2000.0,
                dest_balance_before=50000.0,
                dest_balance_after=50200.0,
                scenario_id=None,
                scenario_tag="merchant_lunch",
                is_suspicious_scenario=False,
            )
        )
        # Regular customer spends 2300 INR at ACC-NORMAL
        session.add(
            TransactionModel(
                transaction_id="TX-005",
                timestamp=t_hop3 + timedelta(hours=2),
                origin_account_id="ACC-VICTIM",
                destination_account_id="ACC-NORMAL",
                amount=2300.0,
                currency="INR",
                channel="CARD_POS",
                status="COMPLETED",
                origin_balance_before=100000.0,
                origin_balance_after=97700.0,
                dest_balance_before=50200.0,
                dest_balance_after=52500.0,
                scenario_id=None,
                scenario_tag="retail_shopping",
                is_suspicious_scenario=False,
            )
        )

        # Dormant awakening scenario
        session.add(
            TransactionModel(
                transaction_id="TX-006",
                timestamp=t0 + timedelta(days=65),
                origin_account_id="ACC-VICTIM",
                destination_account_id="ACC-DORMANT",
                amount=100000.0,
                currency="INR",
                channel="RTGS",
                status="COMPLETED",
                origin_balance_before=97700.0,
                origin_balance_after=97700.0,
                dest_balance_before=50.0,
                dest_balance_after=100050.0,
                scenario_id="SCENARIO-DORMANT-005",
                scenario_tag="dormant_deposit",
                is_suspicious_scenario=True,
            )
        )

        # Cycle scenario: A -> B then B -> A
        session.add(
            TransactionModel(
                transaction_id="TX-007",
                timestamp=t0 + timedelta(days=20),
                origin_account_id="ACC-CYC-A",
                destination_account_id="ACC-CYC-B",
                amount=50000.0,
                currency="INR",
                channel="RTGS",
                status="COMPLETED",
                origin_balance_before=100000.0,
                origin_balance_after=50000.0,
                dest_balance_before=100000.0,
                dest_balance_after=150000.0,
                scenario_id="SCENARIO-CYCLE-004",
                scenario_tag="cycle_leg_1",
                is_suspicious_scenario=True,
            )
        )
        session.add(
            TransactionModel(
                transaction_id="TX-008",
                timestamp=t0 + timedelta(days=20, hours=2),
                origin_account_id="ACC-CYC-B",
                destination_account_id="ACC-CYC-A",
                amount=50000.0,
                currency="INR",
                channel="RTGS",
                status="COMPLETED",
                origin_balance_before=150000.0,
                origin_balance_after=100000.0,
                dest_balance_before=50000.0,
                dest_balance_after=100000.0,
                scenario_id="SCENARIO-CYCLE-004",
                scenario_tag="cycle_leg_2",
                is_suspicious_scenario=True,
            )
        )

        session.commit()

    # Override get_v2_db dependency for FastAPI testing
    def override_get_v2_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_v2_db] = override_get_v2_db
    yield engine
    app.dependency_overrides.clear()


@pytest.fixture
def client(test_v2_db):
    return TestClient(app)


# ------------------------------------------------------------------------------
# Test 1: Account 360° Profile API
# ------------------------------------------------------------------------------

def test_get_account_profile_success(client):
    """Verify account profile returns metadata and correctly aggregated ledger metrics."""
    res = client.get("/api/v2/accounts/ACC-VICTIM")
    assert res.status_code == 200
    data = res.json()

    assert data["account_id"] == "ACC-VICTIM"
    assert data["customer_name"] == "Victim Customer"
    assert data["customer_type"] == "retail"
    assert data["kyc_tier"] == "tier_2_verified"

    metrics = data["metrics"]
    assert metrics["total_outgoing_txns"] == 3  # TX-001 (200k), TX-005 (2.3k), TX-006 (100k)
    assert metrics["total_incoming_txns"] == 0
    assert metrics["total_outgoing_amount"] == 302300.0
    assert metrics["net_flow"] == -302300.0
    assert metrics["unique_counterparties"] == 3  # MULE-1, NORMAL, DORMANT


def test_get_account_profile_not_found(client):
    """Verify unknown account ID returns clean HTTP 404."""
    res = client.get("/api/v2/accounts/ACC-NONEXISTENT-999")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "account_not_found"


# ------------------------------------------------------------------------------
# Test 2: Account Transaction Ledger API
# ------------------------------------------------------------------------------

def test_get_account_transactions_filters_and_pagination(client):
    """Verify pagination, filtering by direction, and chronological sorting."""
    # Outbound only
    res_out = client.get("/api/v2/accounts/ACC-VICTIM/transactions?direction=outbound&order=asc")
    assert res_out.status_code == 200
    data_out = res_out.json()
    assert data_out["total"] == 3
    assert len(data_out["transactions"]) == 3
    assert data_out["transactions"][0]["direction"] == "outbound"
    assert data_out["transactions"][0]["transaction_id"] == "TX-001"

    # Inbound only for MULE-1
    res_in = client.get("/api/v2/accounts/ACC-MULE-1/transactions?direction=inbound")
    assert res_in.status_code == 200
    data_in = res_in.json()
    assert data_in["total"] == 1
    assert data_in["transactions"][0]["direction"] == "inbound"
    assert data_in["transactions"][0]["counterparty_account_id"] == "ACC-VICTIM"

    # Limit and offset pagination
    res_pag = client.get("/api/v2/accounts/ACC-VICTIM/transactions?limit=2&offset=1&order=asc")
    assert res_pag.status_code == 200
    data_pag = res_pag.json()
    assert len(data_pag["transactions"]) == 2
    assert data_pag["transactions"][0]["transaction_id"] == "TX-005"


# ------------------------------------------------------------------------------
# Test 3: Multi-Hop Forensic Graph Tracing API
# ------------------------------------------------------------------------------

def test_trace_outgoing_multi_hop_and_exposure_guardrails(client):
    """Verify multi-hop traversal, branching, and exposure upper-bound non-double-counting."""
    res = client.get("/api/v2/trace?account_id=ACC-VICTIM&direction=outgoing&max_depth=3")
    assert res.status_code == 200
    data = res.json()

    assert data["root_account_id"] == "ACC-VICTIM"
    assert data["max_depth_reached"] >= 3

    node_ids = {n["account_id"] for n in data["nodes"]}
    assert {"ACC-VICTIM", "ACC-MULE-1", "ACC-MULE-2", "ACC-CASHOUT"}.issubset(node_ids)

    # Verify observed transfers vs attributed exposure
    # Observed total = sum of all edges in graph (TX-001: 200k, TX-002: 190k, TX-003: 188k, TX-004: 200, etc.)
    assert data["observed_total_transferred"] > 300000.0

    # CRITICAL TEST: Attributed exposure upper bound MUST NOT double-count downstream hops!
    # Initial outflow from root was 302,300.0 (sum of hop-1 outgoing transfers from ACC-VICTIM)
    assert data["attributed_exposure_upper_bound"] == 302300.0
    assert "never be summed as additional stolen funds" in data["attribution_disclaimer"]


def test_trace_cycle_detection(client):
    """Verify cyclic round-tripping triggers is_cycle=True without infinite looping."""
    res = client.get("/api/v2/trace?account_id=ACC-CYC-A&direction=outgoing&max_depth=4")
    assert res.status_code == 200
    data = res.json()

    cycle_edges = [e for e in data["edges"] if e["is_cycle"]]
    assert len(cycle_edges) >= 1, "Expected cycle edge to be detected"
    assert cycle_edges[0]["destination_account_id"] == "ACC-CYC-A"


def test_trace_limits_and_truncation(client):
    """Verify traversal limits stop gracefully and provide clear truncation explanation."""
    # Max depth = 1
    res = client.get("/api/v2/trace?account_id=ACC-VICTIM&direction=outgoing&max_depth=1")
    assert res.status_code == 200
    data = res.json()
    assert data["max_depth_reached"] <= 1
    assert data["is_truncated"] is True
    assert "max_depth limit of 1" in data["truncation_reason"]

    # Max nodes = 2
    res_nodes = client.get("/api/v2/trace?account_id=ACC-VICTIM&direction=outgoing&max_nodes=2")
    assert res_nodes.status_code == 200
    data_nodes = res_nodes.json()
    assert data_nodes["total_nodes"] == 2
    assert data_nodes["is_truncated"] is True
    assert "max_nodes limit of 2" in data_nodes["truncation_reason"]


# ------------------------------------------------------------------------------
# Test 4: Account-Level Behavioral Risk Assessment API
# ------------------------------------------------------------------------------

def test_risk_assessment_rapid_pass_through_mule(client):
    """Verify rapid pass-through mule account triggers high behavioral risk signals."""
    res = client.get("/api/v2/accounts/ACC-MULE-1/assessment")
    assert res.status_code == 200
    data = res.json()

    assert data["account_id"] == "ACC-MULE-1"
    assert data["signals"]["rapid_pass_through"] is True
    assert data["signals"]["flow_through_ratio"] >= 0.90
    assert data["risk_score"] >= 60.0
    assert data["risk_level"] in ("high", "critical")

    # Check reason codes
    reason_text = " ".join(data["reason_codes"])
    assert "RAPID_PASS_THROUGH" in reason_text
    assert "HIGH_FLOW_THROUGH" in reason_text


def test_risk_assessment_innocent_connected_account(client):
    """Verify innocent merchant connected to mule is NOT automatically classified as fraudulent."""
    res = client.get("/api/v2/accounts/ACC-NORMAL/assessment")
    assert res.status_code == 200
    data = res.json()

    assert data["account_id"] == "ACC-NORMAL"
    assert data["signals"]["rapid_pass_through"] is False
    # Normal account with small payments should receive low risk
    assert data["risk_score"] <= 35.0
    assert data["risk_level"] in ("low", "elevated")


def test_risk_assessment_ground_truth_isolation(client, test_v2_db):
    """Verify ground truth labels never influence computed behavioral risk scores."""
    # Record initial assessment for ACC-MULE-1
    res1 = client.get("/api/v2/accounts/ACC-MULE-1/assessment")
    score1 = res1.json()["risk_score"]

    # Alter ground truth label in database to 'legitimate_retail'
    with Session(test_v2_db) as session:
        acc = session.scalar(select(AccountModel).where(AccountModel.account_id == "ACC-MULE-1"))
        acc.ground_truth_label = "legitimate_retail"
        acc.scenario_id = None
        session.commit()

    # Re-evaluate
    res2 = client.get("/api/v2/accounts/ACC-MULE-1/assessment")
    score2 = res2.json()["risk_score"]

    # Score MUST be identical because ground truth labels are strictly ignored!
    assert score1 == score2, "Ground truth label contaminated risk score computation!"


def test_risk_assessment_dormant_awakening(client):
    """Verify dormant account with sudden large transfer detects dormancy awakening."""
    res = client.get("/api/v2/accounts/ACC-DORMANT/assessment")
    assert res.status_code == 200
    data = res.json()

    assert data["signals"]["dormant_awakening_detected"] is True
    assert any("DORMANT_ACCOUNT_AWAKENED" in r for r in data["reason_codes"])
