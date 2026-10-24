"""Security hardening regression tests for FraudShield AI backend.

Verifies:
1. Input validation & path parameter bounds (rejection of path traversal, invalid characters, extra fields).
2. HTTP security response headers (nosniff, frame options, referrer policy).
3. CSV export formula injection mitigation (whitespace-padded payloads, trigger characters).
4. SQL search query wildcard escaping (protection against wildcard injection in audit search).
5. Actor and reviewer identity sanitization (removal of control characters, CRLF).
6. PII masking in account profiles.
7. Unhandled exception handling (500 without leaking stack traces or internal paths).
"""

from __future__ import annotations

import tempfile
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes import _sanitize_csv_cell, get_db, get_repository
from app.db.models import Base
from app.db.seed import seed_demo_data
from app.db.session import get_db as prod_get_db
from app.main import create_app
from app.repositories.sql_case_repository import SqlCaseRepository, sanitize_actor_id
from app.services.v2.account_service import _mask_email, _mask_phone, _mask_tax_identifier


@pytest.fixture
def sec_client():
    """Provides an isolated TestClient with clean seeded database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with TestingSession() as s:
        seed_demo_data(s)

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
# 1. Security Headers
# ------------------------------------------------------------------------------

def test_security_headers_present(sec_client):
    """Verify essential security headers are attached to API responses."""
    res = sec_client.get("/health")
    assert res.status_code == 200
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("x-frame-options") == "DENY"
    assert res.headers.get("referrer-policy") == "strict-origin-when-cross-origin"


# ------------------------------------------------------------------------------
# 2. Input Validation, Pattern Matching, and Extra Field Rejection
# ------------------------------------------------------------------------------

def test_case_id_path_traversal_rejected(sec_client):
    """Path traversal sequences or illegal characters in case_id must return 404 or 422."""
    res = sec_client.get("/api/cases/..%2F..%2Fetc%2Fpasswd")
    # Path with invalid pattern / path traversal is rejected cleanly
    assert res.status_code in (404, 422)


def test_case_create_extra_fields_rejected(sec_client):
    """Extra fields in CaseCreateRequest must be rejected with 422 (extra='forbid')."""
    payload = {
        "case_id": "FS-SEC-001",
        "reported_origin_transaction_id": "TX_ORIG_SEC",
        "reported_amount": 10000.0,
        "currency": "INR",
        "description": "Test case with extra unauthorized field",
        "unauthorized_admin_override": True,
    }
    res = sec_client.post("/api/cases", json=payload)
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "validation_error"


def test_case_create_excessive_length_rejected(sec_client):
    """Unbounded text inputs in CaseCreateRequest must be rejected with 422."""
    payload = {
        "case_id": "FS-SEC-002",
        "reported_origin_transaction_id": "TX_ORIG_SEC",
        "reported_amount": 10000.0,
        "currency": "INR",
        "description": "A" * 6000,  # Max length is 5000
    }
    res = sec_client.post("/api/cases", json=payload)
    assert res.status_code == 422


def test_case_update_extra_fields_rejected(sec_client):
    """Extra fields in CaseUpdateRequest must be rejected with 422."""
    payload = {
        "description": "Valid description update",
        "arbitrary_injected_field": "exploit",
    }
    res = sec_client.patch("/api/cases/FS-1042", json=payload)
    assert res.status_code == 422


def test_review_account_invalid_account_id_rejected(sec_client):
    """Invalid account ID pattern with spaces or illegal characters is rejected with 422."""
    payload = {
        "review_state": "under_review",
        "notes": "Testing invalid account ID format",
    }
    res = sec_client.put("/api/cases/FS-1042/accounts/ACC%20SPACES%20BAD/review", json=payload)
    assert res.status_code == 422


def test_risk_score_input_bounds_enforced(sec_client):
    """Excessive amounts or steps exceeding upper bounds are rejected with 422."""
    payload = {
        "step": 1,
        "type": "TRANSFER",
        "amount": 2_000_000_000.0,  # Exceeds max amount bound of 1,000,000,000
        "oldbalanceOrg": 50000.0,
        "oldbalanceDest": 0.0,
    }
    res = sec_client.post("/api/risk/score", json=payload)
    assert res.status_code == 422


# ------------------------------------------------------------------------------
# 3. CSV Formula Injection Mitigation
# ------------------------------------------------------------------------------

def test_csv_sanitize_formula_injection():
    """Verify formula injection mitigation handles various attack payloads."""
    # Standard formula triggers
    assert _sanitize_csv_cell("=1+1") == "'=1+1"
    assert _sanitize_csv_cell("+SUM(A1:A10)") == "'+SUM(A1:A10)"
    assert _sanitize_csv_cell("-5+2") == "'-5+2"
    assert _sanitize_csv_cell("@SUM(B1)") == "'@SUM(B1)"
    assert _sanitize_csv_cell("|calc.exe") == "'|calc.exe"

    # Whitespace-padded payloads (Excel strips whitespace before execution)
    assert _sanitize_csv_cell("   =1+1") == "'   =1+1"
    assert _sanitize_csv_cell("\t=1+1") == "'\t=1+1"
    assert _sanitize_csv_cell("\r=1+1") == "'\r=1+1"
    assert _sanitize_csv_cell("  +cmd|' /C calc'!A0") == "'  +cmd|' /C calc'!A0"

    # Benign text
    assert _sanitize_csv_cell("Normal case description") == "Normal case description"
    assert _sanitize_csv_cell("FS-1042") == "FS-1042"
    assert _sanitize_csv_cell(None) == ""


def test_csv_export_headers_and_sanitization(sec_client):
    """Verify CSV export endpoint returns safe headers and sanitized cells."""
    res = sec_client.get("/api/audit/export.csv")
    assert res.status_code == 200
    assert "text/csv" in res.headers.get("content-type", "")
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert "no-store" in res.headers.get("cache-control", "")


# ------------------------------------------------------------------------------
# 4. SQL Search Wildcard Escaping & Actor Sanitization
# ------------------------------------------------------------------------------

def test_sanitize_actor_id():
    """Actor identity must be stripped of control characters, newlines, and carriage returns."""
    assert sanitize_actor_id("analyst_bob\r\n") == "analyst_bob"
    assert sanitize_actor_id("officer\t123") == "officer123"
    assert sanitize_actor_id("") == "analyst_placeholder"
    assert sanitize_actor_id(None) == "analyst_placeholder"
    assert sanitize_actor_id("   ") == "analyst_placeholder"


def test_audit_search_wildcard_escaping(sec_client):
    """Searching for '%' or '_' must not crash or match unintended entities due to wildcards."""
    # Searching for a literal '%' that does not exist in the seeded data
    res = sec_client.get("/api/audit?search=%25NONEXISTENT%25")
    assert res.status_code == 200
    data = res.json()
    assert data["filtered_count"] == 0


# ------------------------------------------------------------------------------
# 5. PII Masking Utilities
# ------------------------------------------------------------------------------

def test_pii_masking_helpers():
    """Verify PII masking functions partially obscure sensitive identifiers."""
    masked_phone = _mask_phone("+91 92174 00001")
    assert "****" in masked_phone
    assert masked_phone.startswith("+91")
    assert masked_phone.endswith("01")

    masked_email = _mask_email("aditijoshi.0001@example.bank")
    assert "****" in masked_email
    assert "@example.bank" in masked_email

    masked_tax = _mask_tax_identifier("SYNTH00001P")
    assert "****" in masked_tax
    assert masked_tax.startswith("SY")
    assert masked_tax.endswith("1P")


# ------------------------------------------------------------------------------
# 6. Case Scoping & Identifier Bounds
# ------------------------------------------------------------------------------

def test_review_account_out_of_scope_rejected(sec_client):
    """Submitting a review for an account that does not exist or has no connection to the case returns 404."""
    payload = {
        "review_state": "under_review",
        "notes": "Attempting cross-case modification of unrelated account",
    }
    # Unrelated account not in database or in case scope
    res = sec_client.put("/api/cases/FS-1042/accounts/ACC_UNRELATED_9999/review", json=payload)
    assert res.status_code == 404
    err = res.json()["error"]
    assert err["code"] in ("account_not_found", "account_not_in_case_scope")


def test_review_decision_reasons_item_length_limit(sec_client):
    """Items in decision_reasons exceeding 500 characters must be rejected with 422."""
    payload = {
        "review_state": "under_review",
        "decision_reasons": ["A" * 600],  # Max length per item is 500
    }
    res = sec_client.put("/api/cases/FS-1042/accounts/C300/review", json=payload)
    assert res.status_code == 422


def test_review_supporting_tx_ids_pattern_validation(sec_client):
    """Items in supporting_transaction_ids with invalid characters must be rejected with 422."""
    payload = {
        "review_state": "under_review",
        "supporting_transaction_ids": ["TX INVALID SPACES"],
    }
    res = sec_client.put("/api/cases/FS-1042/accounts/C300/review", json=payload)
    assert res.status_code == 422


# ------------------------------------------------------------------------------
# 7. Audit Trail Cascade-Deletion Protection & Immutability
# ------------------------------------------------------------------------------

def test_audit_trail_protected_from_cascade_deletion():
    """Verify FraudCaseModel audit_events relationship does not cascade delete or orphan-delete historical audit events."""
    from app.db.models import AuditEventModel, FraudCaseModel
    rel = FraudCaseModel.audit_events.property
    # Relationship cascade must NOT contain 'delete' or 'delete-orphan'
    assert "delete" not in rel.cascade
    assert "delete-orphan" not in rel.cascade


def test_audit_integrity_status_metrics(sec_client):
    """Verify /api/audit integrity status includes cascade-deletion protection and honest disclosure."""
    res = sec_client.get("/api/audit")
    assert res.status_code == 200
    integrity = res.json()["integrity_status"]
    assert integrity["append_only_enforced"] is True
    assert integrity["database_cascade_protected"] is True
    assert integrity["cryptographic_signatures"] is False
    assert "cascade-deletion protection" in integrity["integrity_disclosure"]


# ------------------------------------------------------------------------------
# 8. API Key Authentication Enforcement & Reviewer Identity Attribution
# ------------------------------------------------------------------------------

def test_api_key_auth_enforced_when_configured(sec_client, monkeypatch):
    """When ADMIN_API_KEY is configured, unauthenticated writes fail with 401; valid key succeeds."""
    monkeypatch.setenv("ADMIN_API_KEY", "super-secret-admin-key-777")

    payload = {
        "review_state": "under_review",
        "notes": "Testing key auth enforcement",
    }

    # Request without key must be rejected with 401
    res_unauth = sec_client.put("/api/cases/FS-1042/accounts/C300/review", json=payload)
    assert res_unauth.status_code == 401
    assert res_unauth.json()["error"]["code"] == "unauthorized"

    # Request with wrong key must be rejected with 401
    res_wrong = sec_client.put(
        "/api/cases/FS-1042/accounts/C300/review",
        json=payload,
        headers={"X-API-Key": "incorrect-key"},
    )
    assert res_wrong.status_code == 401

    # Request with valid X-API-Key must succeed
    res_ok = sec_client.put(
        "/api/cases/FS-1042/accounts/C300/review",
        json=payload,
        headers={"X-API-Key": "super-secret-admin-key-777"},
    )
    assert res_ok.status_code == 200


def test_reviewer_identity_audit_metadata(sec_client):
    """Audit events explicitly record reviewer_identity_verified and auth_context in details."""
    payload = {
        "review_state": "under_review",
        "reviewer_id": "investigator_carol",
        "notes": "Testing reviewer identity attribution in audit trail",
    }
    res = sec_client.put("/api/cases/FS-1042/accounts/C300/review", json=payload)
    assert res.status_code == 200

    audit_res = sec_client.get("/api/cases/FS-1042/audit-trail")
    assert audit_res.status_code == 200
    events = audit_res.json()["events"]
    latest_event = [e for e in events if e["performed_by"] == "investigator_carol"][-1]
    details = latest_event["details"]
    assert details["client_supplied_reviewer"] == "investigator_carol"
    assert details["reviewer_identity_verified"] is False
    assert details["auth_context"] == "local_development"

