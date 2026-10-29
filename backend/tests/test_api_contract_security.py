"""API contract clarity, write access, reviewer identity and audit integrity."""

from __future__ import annotations

import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes import get_db, get_repository
from app.db.models import AccountReviewStatusModel, AuditEventModel, Base
from app.db.seed import seed_all_demo_data
from app.db.session import get_db as prod_get_db
from app.main import create_app
from app.repositories.sql_case_repository import SqlCaseRepository
from app.services.v2.live_analysis import compare_review_suggestions
from app.services.v2.ml_service import V2MLInferenceService

REVIEW_URL = "/api/cases/FS-2001/accounts/ACC-000003/review"
REVIEW_BODY = {"review_state": "under_review", "reviewer_id": "analyst_1", "notes": "Checking statements."}


@pytest.fixture
def isolated(monkeypatch):
    """Client on a temporary case database with no API key and development mode, plus a session factory."""
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    monkeypatch.delenv("FRAUDSHIELD_API_KEY", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        path = tmp.name
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    with Session() as s:
        seed_all_demo_data(s)
    app = create_app()

    def db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def repo():
        s = Session()
        try:
            yield SqlCaseRepository(s)
        finally:
            s.close()

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[prod_get_db] = db
    app.dependency_overrides[get_repository] = repo
    with TestClient(app) as client:
        yield client, Session
    app.dependency_overrides.clear()
    engine.dispose()
    os.remove(path)


def review_events(Session):
    with Session() as s:
        return [e for e in s.query(AuditEventModel).filter_by(action="account_review_recorded").all()]


# ---------------------------------------------------------------- review comparison semantics
@pytest.mark.parametrize(
    "model_class, rule_level, rapid, expected",
    [
        ("suspicious", "low", False, (True, False, True, ["model_at_or_above_threshold"])),
        ("legitimate", "high", False, (False, True, True, ["rules_high_or_above"])),
        ("suspicious", "critical", False, (True, True, False, ["model_at_or_above_threshold", "rules_high_or_above"])),
        ("legitimate", "elevated", False, (False, False, False, [])),
        ("legitimate", "elevated", True, (False, False, False, ["rapid_pass_through_observed"])),
    ],
)
def test_review_comparison_uses_each_checks_own_review_point(model_class, rule_level, rapid, expected):
    r = compare_review_suggestions(model_class, rule_level, rapid)
    assert (r["model_suggests_review"], r["rule_suggests_review"], r["checks_disagree"], r["human_review_basis"]) == expected


def test_numeric_closeness_does_not_create_or_hide_disagreement():
    # A model score of 60% and 60 rule points are "close" numerically but disagree if only one crosses its point.
    assert compare_review_suggestions("legitimate", "high", False)["checks_disagree"] is True
    # Far-apart numbers can still agree: both checks suggest review.
    assert compare_review_suggestions("suspicious", "critical", False)["checks_disagree"] is False


def test_threshold_boundary_comes_from_model_metadata(monkeypatch):
    monkeypatch.setattr(V2MLInferenceService, "_account_metadata", {"decision_threshold": 0.1752})
    assert V2MLInferenceService.classify(0.1751) == ("legitimate", "low")
    assert V2MLInferenceService.classify(0.1752) == ("suspicious", "elevated")
    assert V2MLInferenceService.classify(0.1753) == ("suspicious", "elevated")
    assert V2MLInferenceService.classify(0.71) == ("suspicious", "high")
    monkeypatch.setattr(V2MLInferenceService, "_account_metadata", {"decision_threshold": 0.3})
    assert V2MLInferenceService.classify(0.25) == ("legitimate", "low")


def test_openapi_marks_legacy_fields_deprecated(isolated):
    client, _ = isolated
    props = client.get("/openapi.json").json()["components"]["schemas"]["ModelDivergenceInfo"]["properties"]
    assert props["score_delta"].get("deprecated") is True
    assert props["divergence_detected"].get("deprecated") is True
    for field in ("model_suggests_review", "rule_suggests_review", "checks_disagree", "model_review_threshold"):
        assert field in props


# ---------------------------------------------------------------- write access modes
def test_local_mode_allows_writes_but_records_an_unauthenticated_self_reported_name(isolated):
    client, Session = isolated
    assert client.get("/health").json()["write_access"] == "open_local_development"
    assert client.put(REVIEW_URL, json=REVIEW_BODY).status_code == 200
    d = review_events(Session)[-1].details
    assert d["reviewer_name_source"] == "self_reported"
    assert d["reviewer_identity_verified"] is False
    assert d["request_authenticated"] is False
    assert d["auth_method"] == "local_development"


def test_api_key_mode_requires_the_key_and_still_does_not_verify_the_name(isolated, monkeypatch):
    client, Session = isolated
    monkeypatch.setenv("ADMIN_API_KEY", "test-key-123")
    assert client.get("/health").json()["write_access"] == "api_key_required"

    missing = client.put(REVIEW_URL, json=REVIEW_BODY)
    wrong = client.put(REVIEW_URL, json=REVIEW_BODY, headers={"X-API-Key": "nope"})
    assert missing.status_code == wrong.status_code == 401
    assert missing.json()["error"]["code"] == "unauthorized"
    assert review_events(Session) == [], "a rejected write must not leave an audit entry"

    ok = client.put(REVIEW_URL, json=REVIEW_BODY, headers={"X-API-Key": "test-key-123"})
    bearer = client.put(REVIEW_URL, json={**REVIEW_BODY, "reviewer_id": "someone else"},
                        headers={"Authorization": "Bearer test-key-123"})
    assert ok.status_code == bearer.status_code == 200
    events = review_events(Session)
    assert len(events) == 2
    for e in events:
        assert e.details["request_authenticated"] is True
        assert e.details["auth_method"] == "api_key"
        # Holding the key does not prove who typed the name.
        assert e.details["reviewer_identity_verified"] is False
        assert e.details["reviewer_name_source"] == "self_reported"
    # Read endpoints stay readable without a key.
    assert client.get("/api/cases/FS-2001/audit-trail").status_code == 200


def test_production_without_key_refuses_writes_instead_of_failing_open(isolated, monkeypatch):
    client, Session = isolated
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert client.get("/health").json()["write_access"] == "disabled_no_key_configured"
    r = client.put(REVIEW_URL, json=REVIEW_BODY)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "write_access_not_configured"
    assert client.patch("/api/cases/FS-2001", json={"investigation_status": "closed"}).status_code == 503
    assert review_events(Session) == []


@pytest.mark.parametrize("name", ["system_seeder", " System_Seeder ", "tracer_service", "api_key_admin", "local_dev_user"])
def test_callers_cannot_record_actions_as_the_application(isolated, name):
    client, Session = isolated
    r = client.put(REVIEW_URL, json={**REVIEW_BODY, "reviewer_id": name})
    assert r.status_code == 422
    assert client.patch("/api/cases/FS-2001", json={"investigation_status": "closed", "updated_by": name}).status_code == 422
    assert review_events(Session) == []


def test_failed_review_write_leaves_no_audit_entry_or_review(isolated):
    client, Session = isolated
    r = client.put("/api/cases/FS-2001/accounts/A100/review", json=REVIEW_BODY)
    assert r.status_code == 404
    assert review_events(Session) == []
    with Session() as s:
        assert s.query(AccountReviewStatusModel).filter_by(case_id="FS-2001", account_id="A100").count() == 0


def test_successful_review_persists_with_matching_audit_entry(isolated):
    client, Session = isolated
    r = client.put(REVIEW_URL, json={**REVIEW_BODY, "review_state": "under_investigation"})
    assert r.status_code == 200
    assessment = client.get("/api/cases/FS-2001/accounts/ACC-000003/assessment").json()
    assert assessment["review_status"]["review_state"] == "under_investigation"
    events = review_events(Session)
    assert len(events) == 1 and events[0].details["new_review_state"] == "under_investigation"
    assert events[0].performed_by == "analyst_1"


# ---------------------------------------------------------------- CORS
def _preflight(client, origin):
    return client.options(REVIEW_URL, headers={"Origin": origin, "Access-Control-Request-Method": "PUT",
                                                 "Access-Control-Request-Headers": "content-type,x-api-key"})


def test_cors_allows_only_configured_origins(monkeypatch):
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    client = TestClient(create_app())
    ok = _preflight(client, "http://localhost:5173")
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "x-api-key" in ok.headers.get("access-control-allow-headers", "").lower()
    assert "x-reviewer-id" not in ok.headers.get("access-control-allow-headers", "").lower()
    bad = _preflight(client, "https://evil.example")
    assert bad.headers.get("access-control-allow-origin") is None


def test_cors_wildcard_never_allows_credentials(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    client = TestClient(create_app())
    r = client.get("/health", headers={"Origin": "https://anywhere.example"})
    assert r.headers.get("access-control-allow-origin") == "*"
    assert r.headers.get("access-control-allow-credentials") is None
