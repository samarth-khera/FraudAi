"""Comprehensive test suite for FraudShield AI V2 Machine Learning Models.

Validates:
- Feature builder consistency and zero feature leakage.
- PaySim transaction-level benchmark artifacts and metrics.
- Account-behaviour model artifacts, metrics, and scenario-aware splits.
- REST API endpoints: GET /api/v2/models/status and GET /api/v2/accounts/{id}/ml-assessment.
- TreeSHAP local explainability.
- Missing model / unavailable artifact handling (HTTP 503).
- Unknown account handling (HTTP 404).
- Clear separation between baseline rule scores and ML model probabilities.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

# Tests run from the repository root or backend/; resolve data and artifacts from the repo.
REPO_ROOT = Path(__file__).resolve().parents[2]

try:
    from app.db.v2.models import AccountModel
    from app.main import app
    from app.services.v2.feature_builder import AccountFeatureBuilder, FEATURE_NAMES
    from app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService
except ModuleNotFoundError:
    from backend.app.db.v2.models import AccountModel
    from backend.app.main import app
    from backend.app.services.v2.feature_builder import AccountFeatureBuilder, FEATURE_NAMES
    from backend.app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def db_session():
    engine = create_engine(f"sqlite:///{REPO_ROOT / 'data' / 'v2_fraudshield.db'}")
    with Session(engine) as session:
        yield session


# ------------------------------------------------------------------------------
# 1. Feature Builder & Leakage Tests
# ------------------------------------------------------------------------------

def test_feature_builder_feature_order_and_types(db_session: Session):
    """Verifies that extracted features match the schema exactly with valid float types."""
    features = AccountFeatureBuilder.extract_features(db_session, "ACC-000001")
    assert features is not None
    assert len(features) == len(FEATURE_NAMES)

    # Check every feature in the contract is present and is a finite float
    for name in FEATURE_NAMES:
        assert name in features, f"Missing feature: {name}"
        val = features[name]
        assert isinstance(val, (float, int)), f"Feature {name} has invalid type: {type(val)}"
        assert not np.isnan(val), f"Feature {name} is NaN"
        assert not np.isinf(val), f"Feature {name} is infinite"

    # Test DataFrame & vector converters
    vec = AccountFeatureBuilder.to_feature_vector(features)
    assert vec.shape == (1, len(FEATURE_NAMES))
    assert vec.dtype == np.float32

    df = AccountFeatureBuilder.to_dataframe(features)
    assert list(df.columns) == FEATURE_NAMES
    assert len(df) == 1


def test_feature_builder_leakage_safeguards(db_session: Session):
    """Verifies that ground truth, scenario tags, and PII are strictly absent."""
    features = AccountFeatureBuilder.extract_features(db_session, "ACC-000001")
    assert features is not None

    prohibited_fields = [
        "ground_truth_label",
        "scenario_id",
        "scenario_tag",
        "is_suspicious_scenario",
        "account_id",
        "customer_name",
        "phone_number",
        "email",
        "upi_id",
        "tax_identifier",
        "is_fraud",
        "label",
    ]

    for prohibited in prohibited_fields:
        assert prohibited not in features, f"Leakage detected: {prohibited} present in features!"


# ------------------------------------------------------------------------------
# 2. PaySim Benchmark Artifacts & Metrics Tests
# ------------------------------------------------------------------------------

def test_paysim_benchmark_artifacts_and_metrics():
    """Verifies PaySim benchmark artifacts, feature schema, and held-out test evaluation."""
    artifacts_dir = REPO_ROOT / "ml/artifacts/v2/paysim_benchmark"
    model_path = artifacts_dir / "model.joblib"
    schema_path = artifacts_dir / "feature_schema.json"
    meta_path = artifacts_dir / "metadata.json"

    assert model_path.exists(), "PaySim model.joblib does not exist"
    assert schema_path.exists(), "PaySim feature_schema.json does not exist"
    assert meta_path.exists(), "PaySim metadata.json does not exist"

    # Verify model loadable
    model = joblib.load(model_path)
    assert hasattr(model, "predict_proba")

    # Verify metadata
    with open(meta_path) as f:
        meta = json.load(f)

    assert meta["model_version"] == "v2-benchmark-1.0.0"
    metrics = meta["held_out_test_metrics"]
    assert metrics["precision"] > 0.90
    assert metrics["recall"] > 0.90
    assert metrics["roc_auc"] > 0.95
    assert metrics["pr_auc"] > 0.90
    assert "chronological_split" in meta
    assert meta["domain_constraints"] is not None


# ------------------------------------------------------------------------------
# 3. Account-Behaviour Model Artifacts & Metrics Tests
# ------------------------------------------------------------------------------

def test_account_model_artifacts_and_metrics():
    """Verifies V2 account model artifacts, scenario separation, and metrics."""
    artifacts_dir = REPO_ROOT / "ml/artifacts/v2/account_model"
    model_path = artifacts_dir / "model.joblib"
    schema_path = artifacts_dir / "feature_schema.json"
    meta_path = artifacts_dir / "metadata.json"

    assert model_path.exists(), "Account model.joblib does not exist"
    assert schema_path.exists(), "Account feature_schema.json does not exist"
    assert meta_path.exists(), "Account metadata.json does not exist"

    # Verify model loadable
    model = joblib.load(model_path)
    assert hasattr(model, "predict_proba")

    with open(meta_path) as f:
        meta = json.load(f)

    assert meta["model_version"] == "v2-account-1.0.0"
    metrics = meta["ml_evaluation_metrics"]
    assert metrics["roc_auc"] > 0.95
    assert metrics["false_positives"] <= 10  # Low false positives on 2,000 held-out accounts

    # Verify scenario split strategy
    scenario_info = meta["scenario_split_strategy"]
    assert "SCENARIO-APP-001" in scenario_info["held_out_test_scenarios"]
    assert "SCENARIO-DORMANT-005" in scenario_info["held_out_test_scenarios"]

    # Verify baseline comparison is documented
    assert "baseline_comparison" in meta
    assert meta["baseline_comparison"]["baseline_name"] == "Phase 3 Deterministic Rule Assessor"


# ------------------------------------------------------------------------------
# 4. API Endpoint Integration Tests
# ------------------------------------------------------------------------------

def test_api_v2_models_status(client: TestClient):
    """Tests GET /api/v2/models/status returns 200 with healthy status and metadata."""
    resp = client.get("/api/v2/models/status")
    assert resp.status_code == 200
    data = resp.json()

    assert data["overall_status"] == "healthy"
    assert data["inference_ready"] is True
    assert data["account_model"]["available"] is True
    assert data["account_model"]["version"] == "v2-account-1.0.0"
    assert data["paysim_benchmark"]["available"] is True
    assert "disclaimer" in data


def test_api_v2_account_ml_assessment_known_account(client: TestClient):
    """Tests GET /api/v2/accounts/{account_id}/ml-assessment returns valid predictions and TreeSHAP."""
    resp = client.get("/api/v2/accounts/ACC-000001/ml-assessment")
    assert resp.status_code == 200
    data = resp.json()

    assert data["account_id"] == "ACC-000001"
    assert 0.0 <= data["risk_score"] <= 100.0
    assert 0.0 <= data["predicted_probability"] <= 1.0
    assert data["risk_level"] in ["low", "elevated", "high", "critical"]
    assert data["predicted_class"] in ["suspicious", "legitimate"]
    assert len(data["observable_features"]) == len(FEATURE_NAMES)

    # Check TreeSHAP local contributions
    assert len(data["top_contributions"]) > 0
    top = data["top_contributions"][0]
    assert "feature_name" in top
    assert "contribution_score" in top
    assert top["impact_direction"] in ["increases_risk", "decreases_risk"]


def test_api_v2_account_ml_assessment_unknown_account(client: TestClient):
    """Tests GET /api/v2/accounts/{id}/ml-assessment returns 404 for non-existent accounts."""
    resp = client.get("/api/v2/accounts/ACC-NONEXISTENT/ml-assessment")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "account_not_found"


def test_api_v2_account_ml_assessment_model_unavailable(client: TestClient):
    """Tests that a clean HTTP 503 is returned if the model binary cannot be loaded."""
    with patch.object(V2MLInferenceService, "load_account_model", side_effect=ModelUnavailableException("Model missing test")):
        resp = client.get("/api/v2/accounts/ACC-000001/ml-assessment")
        assert resp.status_code == 503
        body = resp.json()
        assert body["error"]["code"] == "model_unavailable"


def test_separation_of_ml_and_rule_baseline(client: TestClient):
    """Verifies that the ML assessment and rule-based baseline are separate and distinct."""
    # 1. Rule baseline
    resp_rule = client.get("/api/v2/accounts/ACC-000001/assessment")
    assert resp_rule.status_code == 200
    rule_data = resp_rule.json()

    # 2. ML assessment
    resp_ml = client.get("/api/v2/accounts/ACC-000001/ml-assessment")
    assert resp_ml.status_code == 200
    ml_data = resp_ml.json()

    # Verify they have distinct schemas and distinct explanatory mechanisms
    assert "signals" in rule_data
    assert "reason_codes" in rule_data
    assert "top_contributions" in ml_data
    assert "predicted_probability" in ml_data
    assert rule_data["account_id"] == ml_data["account_id"] == "ACC-000001"
