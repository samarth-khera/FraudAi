"""Load a saved fraud model and score transactions without retraining."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.config import ARTIFACT_DIR


class FraudModel:
    """Wrapper around the saved sklearn pipeline, feature schema and threshold.

    Output is a risk *score* and a threshold-based *review flag*. It is decision support
    for human review only: it never freezes accounts and is not evidence of guilt.
    """

    def __init__(self, pipeline: Any, schema: dict[str, Any], threshold: float, meta: dict[str, Any]):
        self.pipeline = pipeline
        self.schema = schema
        self.threshold = float(threshold)
        self.meta = meta

    @classmethod
    def load(cls, artifact_dir: Path = ARTIFACT_DIR) -> "FraudModel":
        d = Path(artifact_dir)
        for name in ("pipeline.joblib", "feature_schema.json", "threshold.json"):
            if not (d / name).is_file():
                raise FileNotFoundError(f"Missing artifact {name} in {d}. Run `python -m ml.train` first.")
        return cls(
            joblib.load(d / "pipeline.joblib"),
            json.loads((d / "feature_schema.json").read_text()),
            json.loads((d / "threshold.json").read_text())["threshold"],
            json.loads((d / "threshold.json").read_text()),
        )

    def _validate(self, df: pd.DataFrame) -> pd.DataFrame:
        req = self.schema["required_input_columns"]
        missing = [c for c in req if c not in df.columns]
        if missing:
            raise ValueError(f"Input is missing required columns: {missing}")
        sub = df[req]
        if sub.isna().any().any():
            raise ValueError("Input contains missing values in required columns.")
        unknown = set(sub["type"].astype(str)) - set(self.schema["known_transaction_types"])
        if unknown:
            raise ValueError(f"Unknown transaction types: {sorted(unknown)}")
        return sub

    def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
        """Fraud-class score in [0, 1] for each row."""
        return self.pipeline.predict_proba(self._validate(df))[:, 1]

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        """1 if score >= saved threshold (flag for human review), else 0."""
        return (self.predict_proba(df) >= self.threshold).astype(int)
