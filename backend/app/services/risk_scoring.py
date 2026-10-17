"""Risk-scoring service: loads the saved ML model ONCE and scores single transactions.

* Never trains at startup; it only loads artifacts produced by ``python -m ml.train``.
* Reuses ``ml.inference.FraudModel`` (and thus the exact saved preprocessing pipeline).
* Refuses to serve a model that uses post-transaction features or whose saved feature
  schema does not match the API request contract (no defaults, no model substitution).
* Output is decision support for human review only. No account action is ever taken.
"""

from __future__ import annotations

import logging
import math
import os
import sys
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import pandas as pd

# The ML package lives at the repository root, outside backend/.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ml.config import ARTIFACT_DIR  # noqa: E402
from ml.inference import FraudModel  # noqa: E402

logger = logging.getLogger("fraudshield.risk")

MODEL_DIR_ENV = "FRAUDSHIELD_MODEL_DIR"

# Inputs the API accepts; must equal the saved schema's required_input_columns.
REQUEST_FIELDS = {"step", "type", "amount", "oldbalanceOrg", "oldbalanceDest"}
FORBIDDEN_FEATURES = {"newbalanceOrig", "newbalanceDest", "error_balance_orig", "error_balance_dest",
                      "isFraud", "isFlaggedFraud", "nameOrig", "nameDest"}

DISCLAIMER = (
    "Decision support only. This score is a statistical risk signal for human review, not a "
    "finding of guilt or innocence. No account is frozen, unfrozen or otherwise acted on "
    "automatically. Model trained on synthetic PaySim data."
)


class ModelUnavailableError(Exception):
    """Artifacts are missing, invalid, or incompatible with the API contract."""


class RiskScoringService:
    def __init__(self, artifact_dir: Optional[Path] = None) -> None:
        self._dir = Path(artifact_dir) if artifact_dir else Path(os.environ.get(MODEL_DIR_ENV, ARTIFACT_DIR))
        self._model: Optional[FraudModel] = None
        self._error: Optional[str] = None
        self._attempted = False
        self._lock = threading.Lock()
        self.load_count = 0  # how many times artifacts were actually read

    # ---- loading -------------------------------------------------------
    def load(self) -> None:
        """Load artifacts once. Subsequent calls are no-ops (success or failure is cached)."""
        with self._lock:
            if self._attempted:
                return
            self._attempted = True
            self.load_count += 1
            try:
                model = FraudModel.load(self._dir)
                self._check_compatible(model)
                self._model = model
            except Exception as exc:  # any failure -> unavailable; details stay server-side
                self._error = type(exc).__name__
                logger.error("Risk model unavailable (%s: %s)", type(exc).__name__, exc)

    @staticmethod
    def _check_compatible(model: FraudModel) -> None:
        schema = model.schema
        if schema.get("feature_set") != "pre_transaction":
            raise ModelUnavailableError("feature set is not pre_transaction")
        if set(schema.get("required_input_columns", [])) != REQUEST_FIELDS:
            raise ModelUnavailableError("saved schema does not match the API request contract")
        used = set(schema.get("engineered_model_features", [])) | set(schema["required_input_columns"])
        if used & FORBIDDEN_FEATURES:
            raise ModelUnavailableError("model uses forbidden/post-transaction features")
        t = model.threshold
        if not isinstance(t, float) or not math.isfinite(t) or not 0.0 < t <= 1.0:
            raise ModelUnavailableError("invalid threshold")
        if not hasattr(model.pipeline, "predict_proba"):
            raise ModelUnavailableError("pipeline cannot predict probabilities")

    @property
    def available(self) -> bool:
        self.load()
        return self._model is not None

    # ---- scoring -------------------------------------------------------
    def score(self, transaction: dict[str, Any]) -> dict[str, Any]:
        self.load()
        if self._model is None:
            raise ModelUnavailableError("model not loaded")
        model = self._model
        frame = pd.DataFrame([{k: transaction[k] for k in sorted(REQUEST_FIELDS)}])
        score = float(model.predict_proba(frame)[0])
        if not math.isfinite(score):
            raise ModelUnavailableError("model produced a non-finite score")
        return {
            "risk_score": score,
            "threshold": model.threshold,
            "review_recommended": bool(score >= model.threshold),
            "model_version": f"{self._dir.name}:{model.meta.get('selected_model', 'unknown')}",
            "feature_set": model.schema["feature_set"],
            "decision_support_only": True,
            "automated_action_taken": "none",
            "disclaimer": DISCLAIMER,
        }


@lru_cache(maxsize=1)
def get_risk_service() -> RiskScoringService:
    """Process-wide singleton (overridable in tests via FastAPI dependency_overrides)."""
    return RiskScoringService()
