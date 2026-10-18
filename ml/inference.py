"""Load a saved fraud model and score transactions without retraining."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.config import ARTIFACT_DIR

try:
    import xgboost as xgb
except Exception:  # pragma: no cover
    xgb = None  # type: ignore[assignment]


FEATURE_LABELS: dict[str, str] = {
    "type": "Transaction Type (One-Hot Encoded)",
    "amount": "Transaction Amount",
    "oldbalanceOrg": "Origin Balance Before Transaction",
    "oldbalanceDest": "Destination Balance Before Transaction",
    "hour_of_day": "Hour of Day (Derived from Step)",
    "amount_to_old_balance_orig": "Amount-to-Origin-Balance Ratio",
    "orig_balance_zero": "Origin Balance Is Zero Indicator",
    "dest_balance_zero": "Destination Balance Is Zero Indicator",
}

REPRESENTATION_NOTES = (
    "Categorical feature 'type' is one-hot encoded into 5 binary indicators "
    "(type_CASH_IN, type_CASH_OUT, type_DEBIT, type_PAYMENT, type_TRANSFER). "
    "Because SHAP / log-odds contributions are additive on the raw margin (log-odds) scale, "
    "the contribution reported for 'type' in feature_contributions is the exact sum of its "
    "5 one-hot indicator contributions, while encoded_contributions lists all 12 preprocessed "
    "columns individually. Numerical features (amount, oldbalanceOrg, oldbalanceDest) and "
    "derived pre-transaction features (hour_of_day, amount_to_old_balance_orig, "
    "orig_balance_zero, dest_balance_zero) are represented directly."
)

EXPLANATION_LIMITATIONS = [
    "Contributions are measured in log-odds (raw margin) units where base_value + sum(contributions) = raw_margin and sigmoid(raw_margin) = risk_score.",
    "Feature contributions describe how the trained model arrived at its statistical score; they do not establish real-world causation or criminal intent.",
    "Post-transaction balance columns and account identifiers are excluded from the model and therefore never appear in explanations.",
]


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

    def explain(self, df: pd.DataFrame) -> list[dict[str, Any]]:
        """Compute local feature contributions for each validated input row.

        Uses the exact same input validation and preprocessing steps (`features` -> `prep`)
        as `predict_proba`. Contributions are returned on the model's additive log-odds
        (raw margin) scale so that `base_value + sum(contributions) == raw_margin` and
        `sigmoid(raw_margin) == risk_score`.
        """
        sub = self._validate(df)
        if not hasattr(self.pipeline, "named_steps"):
            raise ValueError("Saved pipeline does not expose named_steps for explanation.")
        steps = self.pipeline.named_steps
        if "features" not in steps or "prep" not in steps or "model" not in steps:
            raise ValueError("Saved pipeline is missing expected ('features', 'prep', 'model') steps.")

        X_eng: pd.DataFrame = steps["features"].transform(sub)
        prep = steps["prep"]
        X_prep = np.asarray(prep.transform(X_eng), dtype=np.float32)
        encoded_names = [str(n) for n in prep.get_feature_names_out()]
        est = steps["model"]

        probs = np.asarray(self.pipeline.predict_proba(sub)[:, 1], dtype=np.float64)

        if hasattr(est, "get_booster") and xgb is not None:
            booster = est.get_booster()
            best_it = getattr(est, "best_iteration", None)
            it_range = (0, int(best_it) + 1) if best_it is not None else (0, 0)
            dmat = xgb.DMatrix(X_prep, feature_names=encoded_names)
            raw_contribs = np.asarray(
                booster.predict(dmat, pred_contribs=True, iteration_range=it_range),
                dtype=np.float64,
            )
            feature_matrix = raw_contribs[:, :-1]
            base_values = raw_contribs[:, -1]
            method = "TreeSHAP (XGBoost pred_contribs, log-odds scale)"
        elif hasattr(est, "coef_") and hasattr(est, "intercept_"):
            coef = np.asarray(est.coef_[0], dtype=np.float64)
            intercept = float(np.asarray(est.intercept_)[0])
            feature_matrix = X_prep.astype(np.float64) * coef
            base_values = np.full(len(sub), intercept, dtype=np.float64)
            method = "Linear Log-Odds Decomposition (exact)"
        else:
            raise ValueError(f"Estimator {type(est).__name__} does not support local feature explanations.")

        engineered_cols = list(self.schema.get("engineered_model_features", X_eng.columns))
        cat_cols = set(self.schema.get("categorical_features", ["type"]))

        explanations: list[dict[str, Any]] = []
        for idx in range(len(sub)):
            row_enc_contribs = feature_matrix[idx]
            base_val = float(base_values[idx])
            raw_margin = float(base_val + np.sum(row_enc_contribs))
            prob = float(probs[idx])

            encoded_list: list[dict[str, Any]] = []
            enc_map: dict[str, float] = {}
            for name, val, c_val in zip(encoded_names, X_prep[idx], row_enc_contribs):
                fc = float(c_val)
                enc_map[name] = fc
                encoded_list.append({
                    "feature": name,
                    "encoded_value": float(val),
                    "contribution": fc,
                })

            eng_row = X_eng.iloc[idx]
            feature_list: list[dict[str, Any]] = []
            for feat in engineered_cols:
                if feat in cat_cols:
                    prefix = f"{feat}_"
                    c_sum = sum(v for k, v in enc_map.items() if k.startswith(prefix))
                    raw_val: Any = str(eng_row[feat])
                    encoding_kind = "one_hot_summed"
                else:
                    c_sum = float(enc_map.get(feat, 0.0))
                    raw_val = float(eng_row[feat])
                    encoding_kind = "numeric"

                if c_sum > 1e-9:
                    direction = "increases_risk"
                elif c_sum < -1e-9:
                    direction = "decreases_risk"
                else:
                    direction = "neutral"

                feature_list.append({
                    "feature": feat,
                    "label": FEATURE_LABELS.get(feat, feat),
                    "value": raw_val,
                    "contribution": float(c_sum),
                    "direction": direction,
                    "encoding": encoding_kind,
                })

            # Sort engineered features by magnitude of impact (largest absolute contribution first)
            feature_list.sort(key=lambda item: abs(item["contribution"]), reverse=True)

            explanations.append({
                "risk_score": prob,
                "threshold": self.threshold,
                "review_recommended": bool(prob >= self.threshold),
                "explanation_method": method,
                "prediction_scale": "log_odds",
                "base_value": base_val,
                "raw_margin": raw_margin,
                "feature_contributions": feature_list,
                "encoded_contributions": encoded_list,
                "representation_notes": REPRESENTATION_NOTES,
                "limitations": list(EXPLANATION_LIMITATIONS),
            })

        return explanations

