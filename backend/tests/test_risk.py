"""Tests for POST /api/risk/score. Uses a tiny model trained on a generated frame in a temp dir
(unit-test fixture only); the real, git-ignored artifact is not required."""

from __future__ import annotations

import json
import shutil

import pytest
from fastapi.testclient import TestClient

import app.services.risk_scoring as rs  # noqa: E402  (adds repo root to sys.path for `ml`)
from app.api.risk import RiskExplainResponse, RiskScoreResponse
from app.main import create_app
from app.services.risk_scoring import RiskScoringService, get_risk_service

from ml.inference import FraudModel
from ml.tests.conftest import make_frame
from ml.train import default_specs, save_artifacts, train_and_evaluate

VALID = {"step": 12, "type": "TRANSFER", "amount": 250000.0, "oldbalanceOrg": 250000.0, "oldbalanceDest": 0.0}
SAFE = {"step": 12, "type": "PAYMENT", "amount": 10.0, "oldbalanceOrg": 90000.0, "oldbalanceDest": 0.0}


@pytest.fixture(scope="session")
def artifact_dir(tmp_path_factory):
    df = make_frame(n_steps=60, per_step=120, seed=3)
    run = train_and_evaluate(df, default_specs(fast=True), log=lambda m: None)
    d = tmp_path_factory.mktemp("models") / "model_test"
    save_artifacts(run, {"path": "unit-test", "sha256": "n/a", "rows": len(df), "fraud_rows": 1,
                         "fraud_prevalence": 0.1}, d, d.parent / "reports")
    return d


def make_client(service: RiskScoringService) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_risk_service] = lambda: service
    return TestClient(app)


@pytest.fixture
def risk_client(artifact_dir):
    return make_client(RiskScoringService(artifact_dir))


def copy_artifacts(src, dst):
    shutil.copytree(src, dst)
    return dst


# ---------------- predictions ----------------
def test_schema_matches_request_contract(artifact_dir):
    schema = json.loads((artifact_dir / "feature_schema.json").read_text())
    assert schema["feature_set"] == "pre_transaction"
    assert set(schema["required_input_columns"]) == rs.REQUEST_FIELDS
    assert not rs.FORBIDDEN_FEATURES & set(schema["engineered_model_features"])


def test_score_response_and_consistency_with_ml_inference(risk_client, artifact_dir):
    r = risk_client.post("/api/risk/score", json=VALID)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"risk_score", "threshold", "review_recommended", "model_version", "feature_set",
                         "decision_support_only", "automated_action_taken", "disclaimer"}
    assert 0 <= body["risk_score"] <= 1
    assert body["decision_support_only"] is True and body["automated_action_taken"] == "none"
    assert body["feature_set"] == "pre_transaction"
    assert body["model_version"].startswith("model_test:")
    assert "guilt" in body["disclaimer"].lower() and "frozen" in body["disclaimer"].lower()
    import pandas as pd
    direct = FraudModel.load(artifact_dir).predict_proba(pd.DataFrame([VALID]))[0]
    assert body["risk_score"] == pytest.approx(direct, abs=1e-12)
    RiskScoreResponse(**body)


def test_no_guilt_fields_in_response(risk_client):
    keys = set(risk_client.post("/api/risk/score", json=VALID).json())
    assert not keys & {"is_fraud", "is_scammer", "guilty", "innocent", "freeze_account"}


# ---------------- threshold behaviour ----------------
def test_threshold_controls_review_recommendation(artifact_dir, tmp_path):
    lo = copy_artifacts(artifact_dir, tmp_path / "lo")
    hi = copy_artifacts(artifact_dir, tmp_path / "hi")
    for d, t in ((lo, 1e-12), (hi, 1.0)):
        p = d / "threshold.json"
        data = json.loads(p.read_text())
        data["threshold"] = t
        p.write_text(json.dumps(data))
    low = make_client(RiskScoringService(lo)).post("/api/risk/score", json=SAFE).json()
    high = make_client(RiskScoringService(hi)).post("/api/risk/score", json=VALID).json()
    assert low["threshold"] == 1e-12 and low["review_recommended"] is (low["risk_score"] >= 1e-12)
    assert low["review_recommended"] is True
    assert high["threshold"] == 1.0 and high["review_recommended"] is (high["risk_score"] >= 1.0)


def test_review_recommended_equals_score_ge_threshold(risk_client):
    for payload in (VALID, SAFE):
        b = risk_client.post("/api/risk/score", json=payload).json()
        assert b["review_recommended"] == (b["risk_score"] >= b["threshold"])


# ---------------- validation ----------------
@pytest.mark.parametrize("mutate", [
    lambda p: p.pop("amount"),
    lambda p: p.pop("type"),
    lambda p: p.update(newbalanceOrig=0.0),                # post-transaction field must be rejected
    lambda p: p.update(nameOrig="C123"),
    lambda p: p.update(isFlaggedFraud=0),
    lambda p: p.update(type="WIRE"),
    lambda p: p.update(amount="100"),                       # strings are not coerced
    lambda p: p.update(amount=-1),
    lambda p: p.update(oldbalanceOrg=-5),
    lambda p: p.update(step=0),
    lambda p: p.update(step=1.5),
    lambda p: p.update(step=True),
    lambda p: p.update(amount=None),
])
def test_invalid_requests_rejected(risk_client, mutate):
    payload = dict(VALID)
    mutate(payload)
    r = risk_client.post("/api/risk/score", json=payload)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_values_rejected(risk_client, literal):
    raw = ('{"step": 1, "type": "TRANSFER", "amount": %s, "oldbalanceOrg": 1.0, "oldbalanceDest": 0.0}' % literal)
    r = risk_client.post("/api/risk/score", content=raw, headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_malformed_body_rejected(risk_client):
    r = risk_client.post("/api/risk/score", content="not json", headers={"content-type": "application/json"})
    assert r.status_code == 422


# ---------------- artifact failures ----------------
def _assert_clean_503(r):
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "model_unavailable"
    text = r.text
    for leak in ("Traceback", "/Users", "joblib", ".json", "FileNotFound"):
        assert leak not in text


def test_missing_artifacts_503(tmp_path):
    _assert_clean_503(make_client(RiskScoringService(tmp_path / "nothing")).post("/api/risk/score", json=VALID))


def test_corrupt_pipeline_503(artifact_dir, tmp_path):
    d = copy_artifacts(artifact_dir, tmp_path / "bad")
    (d / "pipeline.joblib").write_bytes(b"not a pickle")
    _assert_clean_503(make_client(RiskScoringService(d)).post("/api/risk/score", json=VALID))


def test_corrupt_schema_503(artifact_dir, tmp_path):
    d = copy_artifacts(artifact_dir, tmp_path / "bad2")
    (d / "feature_schema.json").write_text("{broken")
    _assert_clean_503(make_client(RiskScoringService(d)).post("/api/risk/score", json=VALID))


def test_post_balance_model_refused(artifact_dir, tmp_path):
    d = copy_artifacts(artifact_dir, tmp_path / "post")
    p = d / "feature_schema.json"
    s = json.loads(p.read_text())
    s["feature_set"] = "with_post_balance"
    p.write_text(json.dumps(s))
    svc = RiskScoringService(d)
    _assert_clean_503(make_client(svc).post("/api/risk/score", json=VALID))
    assert svc.available is False


def test_schema_contract_mismatch_refused(artifact_dir, tmp_path):
    d = copy_artifacts(artifact_dir, tmp_path / "mismatch")
    p = d / "feature_schema.json"
    s = json.loads(p.read_text())
    s["required_input_columns"] = s["required_input_columns"] + ["newbalanceOrig"]
    p.write_text(json.dumps(s))
    _assert_clean_503(make_client(RiskScoringService(d)).post("/api/risk/score", json=VALID))


def test_invalid_threshold_refused(artifact_dir, tmp_path):
    d = copy_artifacts(artifact_dir, tmp_path / "thr")
    p = d / "threshold.json"
    t = json.loads(p.read_text())
    t["threshold"] = 7.0
    p.write_text(json.dumps(t))
    _assert_clean_503(make_client(RiskScoringService(d)).post("/api/risk/score", json=VALID))


def test_failed_load_not_retried_and_other_endpoints_still_work(tmp_path):
    svc = RiskScoringService(tmp_path / "nothing")
    c = make_client(svc)
    for _ in range(3):
        assert c.post("/api/risk/score", json=VALID).status_code == 503
    assert svc.load_count == 1
    assert c.get("/health").status_code == 200
    assert c.get("/api/cases/FS-1042/trace").status_code == 200


# ---------------- one-time loading ----------------
def test_model_loaded_once(artifact_dir, monkeypatch):
    calls = {"n": 0}
    original = FraudModel.load.__func__

    def counting(cls, d):
        calls["n"] += 1
        return original(cls, d)

    monkeypatch.setattr(FraudModel, "load", classmethod(counting))
    svc = RiskScoringService(artifact_dir)
    c = make_client(svc)
    for _ in range(5):
        assert c.post("/api/risk/score", json=VALID).status_code == 200
    assert calls["n"] == 1 and svc.load_count == 1


def test_startup_lifespan_loads_model_without_training(artifact_dir, monkeypatch):
    svc = RiskScoringService(artifact_dir)
    monkeypatch.setattr("app.main.get_risk_service", lambda: svc)
    import ml.train
    monkeypatch.setattr(ml.train, "train_and_evaluate",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not train")))
    app = create_app()
    app.dependency_overrides[get_risk_service] = lambda: svc
    with TestClient(app) as c:
        assert svc.load_count == 1 and svc._model is not None  # loaded at startup, before any request
        assert c.post("/api/risk/score", json=VALID).status_code == 200
    assert svc.load_count == 1


# ---------------- existing endpoints preserved ----------------
def test_existing_endpoints_unchanged(risk_client):
    assert risk_client.get("/health").json()["phase"] == "1-synthetic"
    assert risk_client.get("/api/cases").json()["count"] == 1
    t = risk_client.get("/api/cases/FS-1042/trace").json()
    assert t["summary"]["traceable_amount"] == 50000 and len(t["paths"]) == 3
    assert len(risk_client.get("/api/cases/FS-1042/graph").json()["edges"]) == 7
    assert risk_client.get("/api/cases/NOPE").status_code == 404


# ---------------- explainability API (POST /api/risk/explain) ----------------
def test_explain_response_and_score_consistency(risk_client):
    score_res = risk_client.post("/api/risk/score", json=VALID).json()
    r = risk_client.post("/api/risk/explain", json=VALID)
    assert r.status_code == 200
    body = r.json()
    RiskExplainResponse(**body)

    assert body["risk_score"] == pytest.approx(score_res["risk_score"], abs=1e-12)
    assert body["threshold"] == score_res["threshold"]
    assert body["review_recommended"] == score_res["review_recommended"]
    assert body["model_version"] == score_res["model_version"]
    assert body["feature_set"] == "pre_transaction"
    assert body["prediction_scale"] == "log_odds"
    assert body["decision_support_only"] is True
    assert body["automated_action_taken"] == "none"
    assert "guilt" in body["disclaimer"].lower() and "frozen" in body["disclaimer"].lower()
    assert len(body["feature_contributions"]) == 8
    assert len(body["encoded_contributions"]) == 12
    assert len(body["limitations"]) >= 2
    assert "one-hot" in body["representation_notes"].lower()


def test_explain_contributions_match_log_odds_and_differ_across_inputs(risk_client):
    import math
    b_valid = risk_client.post("/api/risk/explain", json=VALID).json()
    b_safe = risk_client.post("/api/risk/explain", json=SAFE).json()

    for b in (b_valid, b_safe):
        feat_sum = sum(c["contribution"] for c in b["feature_contributions"])
        enc_sum = sum(c["contribution"] for c in b["encoded_contributions"])
        assert b["base_value"] + feat_sum == pytest.approx(b["raw_margin"], abs=1e-5)
        assert b["base_value"] + enc_sum == pytest.approx(b["raw_margin"], abs=1e-5)
        sig = 1.0 / (1.0 + math.exp(-b["raw_margin"]))
        assert sig == pytest.approx(b["risk_score"], abs=1e-5)

    map_valid = {c["feature"]: c["contribution"] for c in b_valid["feature_contributions"]}
    map_safe = {c["feature"]: c["contribution"] for c in b_safe["feature_contributions"]}
    assert map_valid != map_safe


def test_explain_no_guilt_or_post_balance_fields(risk_client):
    body = risk_client.post("/api/risk/explain", json=VALID).json()
    assert not set(body) & {"is_fraud", "is_scammer", "guilty", "innocent", "freeze_account"}
    feats = {c["feature"] for c in body["feature_contributions"]}
    encs = {c["feature"] for c in body["encoded_contributions"]}
    assert not (feats & rs.FORBIDDEN_FEATURES)
    assert not (encs & rs.FORBIDDEN_FEATURES)


@pytest.mark.parametrize("mutate", [
    lambda p: p.pop("amount"),
    lambda p: p.pop("type"),
    lambda p: p.update(newbalanceOrig=0.0),
    lambda p: p.update(nameOrig="C123"),
    lambda p: p.update(isFlaggedFraud=0),
    lambda p: p.update(type="WIRE"),
    lambda p: p.update(amount="100"),
    lambda p: p.update(amount=-1),
    lambda p: p.update(oldbalanceOrg=-5),
    lambda p: p.update(step=0),
    lambda p: p.update(step=1.5),
    lambda p: p.update(step=True),
    lambda p: p.update(amount=None),
])
def test_explain_invalid_requests_rejected(risk_client, mutate):
    payload = dict(VALID)
    mutate(payload)
    r = risk_client.post("/api/risk/explain", json=payload)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_explain_non_finite_values_rejected(risk_client, literal):
    raw = ('{"step": 1, "type": "TRANSFER", "amount": %s, "oldbalanceOrg": 1.0, "oldbalanceDest": 0.0}' % literal)
    r = risk_client.post("/api/risk/explain", content=raw, headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_explain_missing_and_corrupt_artifacts_503(artifact_dir, tmp_path):
    _assert_clean_503(make_client(RiskScoringService(tmp_path / "nothing")).post("/api/risk/explain", json=VALID))
    d = copy_artifacts(artifact_dir, tmp_path / "bad_explain")
    (d / "pipeline.joblib").write_bytes(b"corrupt")
    _assert_clean_503(make_client(RiskScoringService(d)).post("/api/risk/explain", json=VALID))


def test_score_and_explain_share_single_model_load(artifact_dir):
    svc = RiskScoringService(artifact_dir)
    c = make_client(svc)
    assert c.post("/api/risk/score", json=VALID).status_code == 200
    assert c.post("/api/risk/explain", json=VALID).status_code == 200
    assert c.post("/api/risk/explain", json=SAFE).status_code == 200
    assert svc.load_count == 1

