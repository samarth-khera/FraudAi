"""Loads and scores the v3 models from text artifacts (no pickles): XGBoost native JSON or logistic coefficients,
an optional monotone calibration map, the validation-chosen threshold and the training feature ranges used to detect
inputs outside the training distribution.

Artifacts live in ml/artifacts/v3/<name>/ and are produced only by the offline pipeline (ml/forensics/*). Serving never
trains. A missing or unreadable artifact raises ModelArtifactUnavailable and the report says the model is unavailable.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

ARTIFACT_ROOT = Path(__file__).resolve().parents[3] / "ml" / "artifacts" / "v3"


class ModelArtifactUnavailable(Exception):
    pass


@dataclass
class ScoringModel:
    name: str
    meta: dict
    features: list[str]
    _booster: object = None
    _coef: Optional[np.ndarray] = None
    _intercept: float = 0.0
    _impute: Optional[np.ndarray] = None
    _mean: Optional[np.ndarray] = None
    _scale: Optional[np.ndarray] = None
    _indicators: Optional[list[int]] = None

    @property
    def version(self) -> str:
        return self.meta["model_version"]

    @property
    def threshold(self) -> float:
        return float(self.meta["threshold"]["value"])

    def raw_scores(self, X: pd.DataFrame) -> np.ndarray:
        X = X[self.features].astype(float)
        if self._booster is not None:
            import xgboost as xgb

            return self._booster.predict(xgb.DMatrix(X.to_numpy(), feature_names=self.features, missing=np.nan))
        v = X.to_numpy()
        miss = np.isnan(v)
        v = np.where(miss, self._impute, v)
        if self._indicators:
            v = np.hstack([v, miss[:, self._indicators].astype(float)])
        z = (v - self._mean) / self._scale
        return 1.0 / (1.0 + np.exp(-(z @ self._coef + self._intercept)))

    def calibrated(self, raw: np.ndarray) -> Optional[np.ndarray]:
        cal = self.meta.get("calibration") or {}
        if cal.get("method") == "isotonic":
            return np.interp(raw, cal["x"], cal["y"])
        if cal.get("method") == "sigmoid":
            return 1.0 / (1.0 + np.exp(cal["a"] * raw + cal["b"]))
        return None

    def score(self, X: pd.DataFrame) -> pd.DataFrame:
        raw = self.raw_scores(X)
        cal = self.calibrated(raw)
        out = pd.DataFrame({"model_score": raw}, index=X.index)
        out["calibrated_probability"] = cal if cal is not None else np.nan
        decision = cal if (cal is not None and self.meta["threshold"].get("on") == "calibrated") else raw
        out["above_threshold"] = decision >= self.threshold
        out["outside_training_range"] = self.out_of_range(X)
        return out

    def out_of_range(self, X: pd.DataFrame) -> np.ndarray:
        """Number of features outside the [0.5th, 99.5th] percentile range seen in training (NaN never counts).

        The bounds are inclusive with a relative tolerance of RANGE_TOLERANCE: a value one floating-point step beyond a
        stored bound (e.g. log1p(2) computed as 1.0986122886681096 against a stored 1.0986122886681098) is the same
        number computed on another platform, not an out-of-range input (QA-09)."""
        rng = self.meta.get("training_ranges") or {}
        n = np.zeros(len(X), dtype=int)
        for f, (lo, hi) in rng.items():
            if f in X:
                v = X[f].to_numpy(dtype=float)
                tol_lo = RANGE_TOLERANCE * max(1.0, abs(float(lo)))
                tol_hi = RANGE_TOLERANCE * max(1.0, abs(float(hi)))
                n += ((v < lo - tol_lo) | (v > hi + tol_hi)).astype(int)
        return n


# Relative tolerance for the training-range check: far below any real difference in these features (counts, logs of
# counts, ratios), far above floating-point noise between platforms (about 1e-16 relative).
RANGE_TOLERANCE = 1e-9

_cache: dict[str, ScoringModel] = {}
_lock = threading.Lock()


def load(name: str, root: Path = ARTIFACT_ROOT) -> ScoringModel:
    key = f"{root}/{name}"
    with _lock:
        if key in _cache:
            return _cache[key]
        d = root / name
        try:
            meta = json.loads((d / "metadata.json").read_text())
        except (OSError, ValueError) as exc:
            raise ModelArtifactUnavailable(f"{name}: metadata not readable ({type(exc).__name__})") from exc
        m = ScoringModel(name=name, meta=meta, features=meta["features"])
        try:
            if meta["format"] == "xgboost_json":
                import xgboost as xgb

                b = xgb.Booster()
                b.load_model(str(d / "model.json"))
                m._booster = b
            elif meta["format"] == "logistic_json":
                p = json.loads((d / "model.json").read_text())
                m._coef, m._intercept = np.array(p["coef"]), float(p["intercept"])
                m._impute, m._mean, m._scale = np.array(p["impute"]), np.array(p["mean"]), np.array(p["scale"])
                m._indicators = p.get("indicator_columns") or []
            else:
                raise ModelArtifactUnavailable(f"{name}: unknown format {meta['format']}")
        except ModelArtifactUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 - surface as unavailable, never crash an investigation
            raise ModelArtifactUnavailable(f"{name}: model file not loadable ({type(exc).__name__})") from exc
        _cache[key] = m
        return m


def clear_cache() -> None:
    with _lock:
        _cache.clear()
