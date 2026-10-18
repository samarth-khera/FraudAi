"""Tests for Phase 6 Part 2: Evidence-aware downstream account assessment & protection."""

from __future__ import annotations

import json
import os
import tempfile
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes import get_db, get_repository
from app.db.models import Base
from app.db.seed import seed_demo_data
from app.db.session import get_db as prod_get_db
from app.main import create_app
from app.models.domain import Account, AccountRole, EvidenceQuality, ReviewState
from app.repositories.case_repository import InMemoryCaseRepository
from app.repositories.sql_case_repository import SqlCaseRepository
from app.services.account_assessment import assess_all_case_accounts, assess_case_account
from tests.conftest import make_case, tx


@pytest.fixture
def isolated_db_client():
    """TestClient backed by a fresh SQLite database seeded with FS-1042."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with SessionTesting() as s:
        seed_demo_data(s)

    app = create_app()

    def override_get_db():
        s = SessionTesting()
        try:
            yield s
        finally:
            s.close()

    def override_get_repo():
        s = SessionTesting()
        try:
            yield SqlCaseRepository(s)
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[prod_get_db] = override_get_db
    app.dependency_overrides[get_repository] = override_get_repo

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
    engine.dispose()
    if os.path.exists(db_path):
        os.remove(db_path)


def _all_json_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _all_json_keys(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from _all_json_keys(item)


def test_fs1042_multi_hop_branching_and_no_double_counting(isolated_db_client):
    """Verify multi-hop positions, branching signals, and anti-double-counting on FS-1042."""
    res_all = isolated_db_client.get("/api/cases/FS-1042/accounts")
    assert res_all.status_code == 200
    body = res_all.json()
    assert body["case_id"] == "FS-1042"
    assert body["count"] == 8  # V001 + 7 downstream recipients

    by_id = {a["account_id"]: a for a in body["assessments"]}
    assert set(by_id) == {"V001", "A100", "B200", "C300", "D400", "E500", "F600", "G700"}

    # Origin victim V001
    v001 = by_id["V001"]
    assert v001["graph_position"]["connection_type"] == "reporting_victim"
    assert v001["graph_position"]["hop_count"] is None
    assert v001["observed_movement"]["observed_outbound_value"] == 50000
    assert v001["traceable_exposure"]["attribution_status"] == "not_applicable_origin_sender"

    # Initial receiver A100 (hop 0, rapid pass-through T001 -> T002 in 2 minutes, 100% forwarded)
    a100 = by_id["A100"]
    assert a100["graph_position"]["connection_type"] == "origin_receiver"
    assert a100["graph_position"]["hop_count"] == 0
    assert a100["observed_movement"]["observed_inbound_value"] == 50000
    assert a100["observed_movement"]["observed_outbound_value"] == 50000
    assert a100["traceable_exposure"]["attributed_unforwarded_amount"] == 0
    a100_signals = {s["code"] for s in a100["observed_signals"]}
    assert "rapid_pass_through" in a100_signals
    assert "full_inbound_forwarding" in a100_signals

    # Intermediate branching account B200 (hop 1, splits into T003 and T004 within 6-8 minutes)
    b200 = by_id["B200"]
    assert b200["graph_position"]["connection_type"] == "direct"
    assert b200["graph_position"]["hop_count"] == 1
    assert b200["graph_position"]["downstream_account_ids"] == ["C300", "D400"]
    b200_signals = {s["code"] for s in b200["observed_signals"]}
    assert "multi_branch_splitting" in b200_signals
    assert "rapid_pass_through" in b200_signals
    assert "full_inbound_forwarding" in b200_signals

    # C300 (hop 2, receives 30,000, forwards 15,000 across T005 & T006, 15,000 unforwarded)
    c300 = by_id["C300"]
    assert c300["graph_position"]["connection_type"] == "indirect"
    assert c300["graph_position"]["hop_count"] == 2
    assert c300["observed_movement"]["observed_inbound_value"] == 30000
    assert c300["observed_movement"]["observed_outbound_value"] == 15000
    assert c300["traceable_exposure"]["attributed_inbound_amount"] == 30000
    assert c300["traceable_exposure"]["attributed_outbound_amount"] == 15000
    assert c300["traceable_exposure"]["attributed_unforwarded_amount"] == 15000
    c300_signals = {s["code"] for s in c300["observed_signals"]}
    assert "unforwarded_attributed_balance" in c300_signals
    assert "multi_branch_splitting" in c300_signals

    # Anti-double-counting check across all downstream recipients
    downstream_unfwd = [
        a["traceable_exposure"]["attributed_unforwarded_amount"]
        for aid, a in by_id.items()
        if aid != "V001"
    ]
    assert sum(downstream_unfwd) == 50000
    assert c300["traceable_exposure"]["gross_network_observed_value"] == 175000
    assert c300["traceable_exposure"]["case_traceable_amount"] == 50000
    assert "never adds downstream hop amounts" in c300["traceable_exposure"]["double_counting_safeguard"]


def test_incomplete_lineage_and_insufficient_evidence(custom_client):
    """When downstream legs lack lineage metadata, assessment reports insufficient_evidence and null exposure."""
    txs = [
        tx("T001", 0, "V", "A", 10000, 10000),
        tx("T002", 5, "A", "B", 10000, None),  # missing lineage on T002
        tx("T003", 20, "B", "C", 4000, None),
    ]
    c = custom_client(txs, make_case(amount=10000))

    res_b = c.get("/api/cases/FS-TEST/accounts/B/assessment")
    assert res_b.status_code == 200
    b = res_b.json()

    # Observed movement is known (10,000 in, 4,000 out), but traceable exposure is uncertain (None)
    assert b["observed_movement"]["observed_inbound_value"] == 10000
    assert b["observed_movement"]["observed_outbound_value"] == 4000
    assert b["traceable_exposure"]["attribution_status"] == "uncertain_missing_lineage"
    assert b["traceable_exposure"]["attributed_inbound_amount"] is None
    assert b["traceable_exposure"]["attributed_outbound_amount"] is None
    assert b["traceable_exposure"]["attributed_unforwarded_amount"] is None

    # Evidence assessment must explicitly flag insufficient_evidence and missing lineage gap
    ev = b["evidence_assessment"]
    assert ev["evidence_sufficiency"] == "insufficient_evidence"
    assert any("T002" in gap and "T003" in gap for gap in ev["evidence_gaps"])
    assert any("lack explicit case attribution" in u for u in ev["uncertainty_factors"])


def test_missing_upstream_or_non_downstream_commingled_transactions():
    """Accounts with out-of-order / pre-origin or non-downstream transactions report commingling gaps."""
    case = make_case(amount=10000)
    txs = [
        tx("T_PRE", -30, "EXTERNAL_EMPLOYER", "A", 50000, None),  # Prior salary deposit before origin
        tx("T001", 0, "V", "A", 10000, 10000),
        tx("T002", 10, "A", "B", 10000, 10000),
        tx("T_UNREL", 15, "X_UNRELATED", "Y_UNRELATED", 2000, None),
    ]
    a_assess = assess_case_account(case, "A", txs)
    assert a_assess.observed_movement.traced_inbound_count == 1
    assert a_assess.observed_movement.other_observed_inbound_count == 1
    assert any("outside the traced downstream chain" in gap for gap in a_assess.evidence_assessment.evidence_gaps)

    # Account X_UNRELATED has transactions in store but no path from origin
    x_assess = assess_case_account(case, "X_UNRELATED", txs)
    assert x_assess.graph_position.in_traced_network is False
    assert x_assess.graph_position.connection_type == "not_in_downstream_trace"
    assert x_assess.traceable_exposure.attribution_status == "no_traced_exposure"
    assert x_assess.evidence_assessment.evidence_sufficiency == "insufficient_evidence"


def test_no_guilt_or_innocence_labels_and_separation_of_concepts(isolated_db_client):
    """Verify no forbidden guilt/innocence keys exist and the 6 core concepts are separated."""
    res = isolated_db_client.get("/api/cases/FS-1042/accounts/C300/assessment")
    assert res.status_code == 200
    body = res.json()

    # Check separation of the 6 core concepts at top level
    required_sections = {
        "graph_position",
        "observed_movement",
        "traceable_exposure",
        "evidence_assessment",
        "review_status",
        "audit_history",
        "transaction_risk_separation_note",
    }
    assert required_sections <= set(body.keys())
    assert body["automated_action_taken"] == "none"
    assert body["decision_support_only"] is True

    forbidden_keys = {
        "guilty",
        "innocent",
        "is_scammer",
        "is_fraudster",
        "label_guilty",
        "innocence_probability",
        "guilt_probability",
        "freeze_account",
    }
    assert not (forbidden_keys & set(_all_json_keys(body)))


def test_human_review_workflow_persists_reasons_transactions_and_audit(isolated_db_client):
    """Recording a human review updates review status, assessment sufficiency, and append-only audit trail."""
    review_req = {
        "review_state": "review_completed",
        "evidence_quality": "corroborated",
        "reviewer_id": "senior_analyst_meera",
        "notes": "Verified GST invoice #INV-8821 for electronics shipment matching 15,000 INR retained balance.",
        "decision_reasons": [
            "Verified commercial invoice matching unforwarded balance",
            "Confirmed merchant KYC and historical settlement pattern",
        ],
        "supporting_transaction_ids": ["T003", "T005", "T006"],
        "additional_info_needed": False,
    }

    put_res = isolated_db_client.put("/api/cases/FS-1042/accounts/C300/review", json=review_req)
    assert put_res.status_code == 200
    put_body = put_res.json()
    assert put_body["review_state"] == "review_completed"
    assert put_body["evidence_quality"] == "corroborated"
    assert put_body["reviewer_id"] == "senior_analyst_meera"
    assert put_body["decision_reasons"] == review_req["decision_reasons"]
    assert put_body["supporting_transaction_ids"] == ["T003", "T005", "T006"]
    assert put_body["additional_info_needed"] is False
    assert put_body["automated_action_taken"] == "none"

    # Fetch assessment for C300 and verify persisted review & audit history
    assess_res = isolated_db_client.get("/api/cases/FS-1042/accounts/C300/assessment")
    assert assess_res.status_code == 200
    assess = assess_res.json()

    assert assess["review_status"]["review_state"] == "review_completed"
    assert assess["review_status"]["evidence_quality"] == "corroborated"
    assert assess["review_status"]["decision_reasons"] == review_req["decision_reasons"]
    assert assess["review_status"]["supporting_transaction_ids"] == ["T003", "T005", "T006"]
    assert assess["evidence_assessment"]["evidence_sufficiency"] == "human_review_corroborated"

    # Verify audit history on the account assessment
    assert len(assess["audit_history"]) == 1
    ev = assess["audit_history"][0]
    assert ev["action"] == "account_review_recorded"
    assert ev["performed_by"] == "senior_analyst_meera"
    assert ev["details"]["decision_reasons"] == review_req["decision_reasons"]
    assert ev["details"]["supporting_transaction_ids"] == ["T003", "T005", "T006"]
    assert ev["details"]["additional_info_needed"] is False


def test_account_assessment_404_on_unknown_case_or_account(isolated_db_client):
    r1 = isolated_db_client.get("/api/cases/NO_SUCH_CASE/accounts/A100/assessment")
    assert r1.status_code == 404
    assert r1.json()["error"]["code"] == "case_not_found"

    r2 = isolated_db_client.get("/api/cases/FS-1042/accounts/NO_SUCH_ACCOUNT/assessment")
    assert r2.status_code == 404
    assert r2.json()["error"]["code"] == "account_not_found"
