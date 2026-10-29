"""Inference service for FraudShield AI V2 Machine Learning models.

Loads trained XGBoost artifacts, manages model status, extracts runtime features,
and computes calibrated risk probabilities with native TreeSHAP local explanations.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session
import xgboost as xgb

try:
    from app.api.v2.schemas import (
        AccountMLAssessmentResponse,
        FeatureContribution,
        ModelStatusResponse,
        SingleModelInfo,
    )
    from app.services.v2.feature_builder import AccountFeatureBuilder, FEATURE_NAMES
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import (
        AccountMLAssessmentResponse,
        FeatureContribution,
        ModelStatusResponse,
        SingleModelInfo,
    )
    from backend.app.services.v2.feature_builder import AccountFeatureBuilder, FEATURE_NAMES


class ModelUnavailableException(Exception):
    """Raised when the requested V2 ML model artifact is missing or unreadable."""
    pass


logger = logging.getLogger("fraudshield.v2.ml")

_REPO_ROOT = Path(__file__).resolve().parents[4]


class V2MLInferenceService:
    """Manages V2 model lifecycle, status checks, and local explainability."""

    _account_model: Optional[Any] = None
    _account_metadata: Optional[Dict[str, Any]] = None
    _paysim_metadata: Optional[Dict[str, Any]] = None

    # Active account model. v2-account-1.0.0 remains in ml/artifacts/v2/account_model for comparison;
    # see docs/ACCOUNT_MODEL_AUDIT.md for why it was replaced.
    ACCOUNT_ARTIFACTS_DIR = _REPO_ROOT / "ml/artifacts/v2/account_model_v2"
    DEFAULT_THRESHOLD = 0.5
    PAYSIM_ARTIFACTS_DIR = _REPO_ROOT / "ml/artifacts/v2/paysim_benchmark"

    @classmethod
    def load_account_model(cls) -> Any:
        """Loads and caches the V2 account model artifact."""
        if cls._account_model is not None:
            return cls._account_model

        model_path = cls.ACCOUNT_ARTIFACTS_DIR / "model.joblib"
        if not model_path.exists():
            logger.error("V2 account model binary not found at %s", model_path)
            raise ModelUnavailableException(
                "The account risk model file is missing on the server. Run the account model training pipeline."
            )

        try:
            cls._account_model = joblib.load(model_path)
            meta_path = cls.ACCOUNT_ARTIFACTS_DIR / "metadata.json"
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    cls._account_metadata = json.load(f)
            return cls._account_model
        except Exception as e:
            logger.error("Failed to load V2 account model from %s: %s", model_path, e, exc_info=True)
            raise ModelUnavailableException(
                "The account risk model file exists but could not be loaded. Check the server logs."
            )

    @classmethod
    def get_model_status(cls) -> ModelStatusResponse:
        """Inspects artifact directories and returns the health and version status of both V2 models."""
        # 1. Account model status
        acc_model_path = cls.ACCOUNT_ARTIFACTS_DIR / "model.joblib"
        acc_meta_path = cls.ACCOUNT_ARTIFACTS_DIR / "metadata.json"
        acc_available = acc_model_path.exists()
        acc_meta: Dict[str, Any] = {}
        if acc_meta_path.exists():
            try:
                with open(acc_meta_path, "r") as f:
                    acc_meta = json.load(f)
            except Exception:
                pass

        account_info = SingleModelInfo(
            available=acc_available,
            version=acc_meta.get("model_version", "v2-account-1.0.0" if acc_available else None),
            model_type=acc_meta.get("model_type", "XGBClassifier (Gradient Boosting)" if acc_available else None),
            features_count=len(acc_meta.get("features", [])) if acc_meta else (len(FEATURE_NAMES) if acc_available else None),
            trained_at=acc_meta.get("trained_at"),
            test_metrics=acc_meta.get("ml_evaluation_metrics"),
            limitations=(
                "Trained on synthetic banking network scenarios. Provides advisory decision-support only. "
                "Downstream attribution must be verified by a human analyst."
            ),
            feature_importances=acc_meta.get("top_feature_importances"),
            dataset_info={
                "source": acc_meta.get("dataset_source", "V2 Synthetic Banking Ledger (SQLite)"),
                "strategy": acc_meta.get("scenario_split_strategy", {}).get("strategy"),
                "train_accounts_count": acc_meta.get("scenario_split_strategy", {}).get("train_accounts_count"),
                "test_accounts_count": acc_meta.get("scenario_split_strategy", {}).get("test_accounts_count"),
                "test_suspicious_count": acc_meta.get("scenario_split_strategy", {}).get("test_suspicious_count"),
                "test_normal_count": acc_meta.get("scenario_split_strategy", {}).get("test_normal_count"),
                "validation_suspicious_count": acc_meta.get("scenario_split_strategy", {}).get("validation_suspicious_count"),
                "train_suspicious_count": acc_meta.get("scenario_split_strategy", {}).get("train_suspicious_count"),
                "held_out_test_scenarios": acc_meta.get("scenario_split_strategy", {}).get("held_out_test_scenarios"),
            } if acc_meta else None,
            baseline_comparison=acc_meta.get("baseline_comparison"),
            leakage_protections=acc_meta.get("leakage_protections"),
            features=acc_meta.get("features", FEATURE_NAMES) if acc_available else None,
            decision_threshold=acc_meta.get("decision_threshold") if acc_meta else None,
            score_semantics=acc_meta.get("score_semantics") if acc_meta else None,
            operational_notes=acc_meta.get("operational_notes") if acc_meta else None,
        )

        # 2. PaySim benchmark status
        paysim_model_path = cls.PAYSIM_ARTIFACTS_DIR / "model.joblib"
        paysim_meta_path = cls.PAYSIM_ARTIFACTS_DIR / "metadata.json"
        paysim_available = paysim_model_path.exists()
        paysim_meta: Dict[str, Any] = {}
        if paysim_meta_path.exists():
            try:
                with open(paysim_meta_path, "r") as f:
                    paysim_meta = json.load(f)
            except Exception:
                pass

        paysim_info = SingleModelInfo(
            available=paysim_available,
            version=paysim_meta.get("model_version", "v2-benchmark-1.0.0" if paysim_available else None),
            model_type=paysim_meta.get("benchmark_name", "PaySim Transaction Benchmark (XGBoost)" if paysim_available else None),
            features_count=len(paysim_meta.get("features", [])) if paysim_meta else None,
            trained_at=paysim_meta.get("trained_at"),
            test_metrics=paysim_meta.get("held_out_test_metrics"),
            limitations=paysim_meta.get("domain_constraints"),
            feature_importances=paysim_meta.get("top_feature_importances"),
            dataset_info={
                "source": "PaySim Academic Mobile Money Simulation (Kaggle)",
                "dataset_path": paysim_meta.get("dataset_path"),
                "chronological_split": paysim_meta.get("chronological_split"),
                "class_distribution": paysim_meta.get("class_distribution"),
            } if paysim_meta else None,
            baseline_comparison=None,
            leakage_protections=paysim_meta.get("excluded_features"),
            features=paysim_meta.get("features"),
            decision_threshold=paysim_meta.get("selected_threshold") if paysim_meta else None,
        )

        # Report readiness from an actual load attempt, not just file presence.
        status_detail: Optional[str] = None
        inference_ready = False
        if acc_available:
            try:
                cls.load_account_model()
                inference_ready = True
            except ModelUnavailableException as e:
                status_detail = str(e)
        else:
            status_detail = "The account risk model file is missing on the server."

        if inference_ready:
            overall = "healthy"
        elif acc_available:
            overall = "degraded_account_model_load_failed"
        else:
            overall = "degraded_missing_account_model"
        if inference_ready and not paysim_available:
            status_detail = "Account model ready. The PaySim benchmark artifact is missing, so its metrics are unavailable."

        return ModelStatusResponse(
            account_model=account_info,
            paysim_benchmark=paysim_info,
            overall_status=overall,
            inference_ready=inference_ready,
            status_detail=status_detail,
            disclaimer=(
                "Models serve strictly as decision support. Performance metrics reflect synthetic held-out evaluation "
                "and do not guarantee real-world banking accuracy. Automated freezing or punitive actions are strictly prohibited."
            ),
        )

    @classmethod
    def decision_threshold(cls) -> float:
        """Review threshold stored with the active model (selected on validation data)."""
        meta = cls._account_metadata or {}
        value = meta.get("decision_threshold")
        return float(value) if isinstance(value, (int, float)) and 0.0 < value < 1.0 else cls.DEFAULT_THRESHOLD

    @classmethod
    def classify(cls, score: float) -> Tuple[str, str]:
        """(predicted_class, risk_level) for a 0-1 model score using the served threshold.

        "suspicious" means "at or above the review threshold", not a finding.
        """
        threshold = cls.decision_threshold()
        predicted_class = "suspicious" if score >= threshold else "legitimate"
        return predicted_class, cls.risk_level_for(score, threshold)

    @staticmethod
    def risk_level_for(score: float, threshold: float) -> str:
        """Levels are anchored to the review threshold: anything below it is "low"."""
        if score < threshold:
            return "low"
        if score < max(0.5, threshold):
            return "elevated"
        if score < 0.8:
            return "high"
        return "critical"

    @classmethod
    def assess_account(
        cls, db: Session, account_id: str, rule_assessment: Any = None, account: Any = None
    ) -> Optional[AccountMLAssessmentResponse]:
        """Calculates ML model risk assessment with local TreeSHAP explanations.

        Callers that already computed the account's rule assessment (and loaded its row) can pass both to avoid
        recomputing the same signals; the features are identical either way.
        """
        # 1. Extract observable features
        if rule_assessment is not None and account is not None:
            features = AccountFeatureBuilder.features_from_assessment(account, rule_assessment)
        else:
            features = AccountFeatureBuilder.extract_features(db, account_id)
        if features is None:
            return None

        # 2. Ensure model is loaded
        model = cls.load_account_model()

        # 3. Predict probability
        df_row = AccountFeatureBuilder.to_dataframe(features)
        probs = model.predict_proba(df_row)[0]
        prob_suspicious = float(probs[1])

        risk_score = round(prob_suspicious * 100.0, 1)
        predicted_class, risk_level = cls.classify(prob_suspicious)

        # 4. Compute genuine TreeSHAP local contributions
        top_contributions: List[FeatureContribution] = []
        try:
            booster = model.get_booster()
            dmat = xgb.DMatrix(df_row)
            # pred_contribs returns [SHAP_f0, SHAP_f1, ..., bias]
            contribs = booster.predict(dmat, pred_contribs=True)[0]
            feature_contribs = contribs[:-1]  # Exclude bias term

            # Rank by absolute impact
            ranked_indices = np.argsort(np.abs(feature_contribs))[::-1]

            for idx in ranked_indices[:6]:
                f_name = FEATURE_NAMES[idx]
                f_val = float(features[f_name])
                c_val = float(feature_contribs[idx])
                if abs(c_val) < 1e-4:
                    continue
                impact = "increases_risk" if c_val > 0 else "decreases_risk"
                top_contributions.append(
                    FeatureContribution(
                        feature_name=f_name,
                        feature_value=f_val,
                        contribution_score=round(c_val, 4),
                        impact_direction=impact,
                    )
                )
        except Exception:
            # Fallback if booster contribs not available
            top_contributions = []

        version = "v2-account-1.0.0"
        if cls._account_metadata and "model_version" in cls._account_metadata:
            version = cls._account_metadata["model_version"]

        return AccountMLAssessmentResponse(
            account_id=account_id,
            risk_score=risk_score,
            risk_level=risk_level,
            predicted_probability=round(prob_suspicious, 4),
            predicted_class=predicted_class,
            model_version=version,
            model_type="XGBClassifier",
            top_contributions=top_contributions,
            observable_features=features,
            disclaimer=(
                "Decision support only. Model trained exclusively on synthetic financial network scenarios. "
                "High model risk scores do NOT constitute legal proof of guilt or real-world fraud accuracy. "
                "Automated account freezing, denial of service, or punitive action is strictly prohibited."
            ),
        )
