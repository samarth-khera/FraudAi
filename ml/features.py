"""Feature definitions and sklearn preprocessing pipeline.

Two feature sets are defined because of an availability-at-prediction-time question:

* ``pre_transaction`` (primary / deployable candidate): uses only information that is
  plausibly known BEFORE the transaction settles: step (hour of day), type, amount and
  the *old* balances of the sender and receiver.
* ``with_post_balance`` (comparison only): additionally uses ``newbalanceOrig`` /
  ``newbalanceDest`` and the balance-error features derived from them. These are
  recorded AFTER the transaction executes; in PaySim they also encode simulator
  mechanics (e.g. fraud drains the origin account), so results are likely optimistic
  and the set may be unavailable in a real-time scoring path. It must not be deployed
  unless the production system can supply those fields at decision time.

Raw account IDs and ``isFlaggedFraud`` are never features.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler

from ml.config import (
    EXCLUDED_COLUMNS,
    EXPECTED_TYPES,
    RAW_FEATURE_COLUMNS_POST,
    RAW_FEATURE_COLUMNS_PRE,
)

FEATURE_SETS = ("pre_transaction", "with_post_balance")

CATEGORICAL = ["type"]
NUMERIC_PRE = [
    "amount", "oldbalanceOrg", "oldbalanceDest", "hour_of_day",
    "amount_to_old_balance_orig", "orig_balance_zero", "dest_balance_zero",
]
NUMERIC_POST = NUMERIC_PRE + [
    "newbalanceOrig", "newbalanceDest", "error_balance_orig", "error_balance_dest",
]


def raw_columns(feature_set: str) -> list[str]:
    _check_set(feature_set)
    return list(RAW_FEATURE_COLUMNS_PRE if feature_set == "pre_transaction" else RAW_FEATURE_COLUMNS_POST)


def numeric_columns(feature_set: str) -> list[str]:
    _check_set(feature_set)
    return list(NUMERIC_PRE if feature_set == "pre_transaction" else NUMERIC_POST)


def model_feature_names(feature_set: str) -> list[str]:
    return CATEGORICAL + numeric_columns(feature_set)


def _check_set(feature_set: str) -> None:
    if feature_set not in FEATURE_SETS:
        raise ValueError(f"Unknown feature_set {feature_set!r}; choose from {FEATURE_SETS}")


def engineer_features(df: pd.DataFrame, feature_set: str = "pre_transaction") -> pd.DataFrame:
    """Select raw columns and derive features. Pure function of the row's own fields.

    Only the columns in ``raw_columns(feature_set)`` are read, so ID columns, the target
    and ``isFlaggedFraud`` cannot leak in even if present on the input frame.
    """
    cols = raw_columns(feature_set)
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"Input is missing required columns: {missing}")

    out = pd.DataFrame(index=df.index)
    out["type"] = df["type"].astype("object")
    amount = df["amount"].astype("float32")
    old_o = df["oldbalanceOrg"].astype("float32")
    old_d = df["oldbalanceDest"].astype("float32")
    out["amount"] = amount
    out["oldbalanceOrg"] = old_o
    out["oldbalanceDest"] = old_d
    out["hour_of_day"] = ((df["step"].astype("int64") - 1) % 24).astype("float32")
    out["amount_to_old_balance_orig"] = (amount / old_o.where(old_o > 0, np.nan)).fillna(0).astype("float32")
    out["orig_balance_zero"] = (old_o == 0).astype("float32")
    out["dest_balance_zero"] = (old_d == 0).astype("float32")
    if feature_set == "with_post_balance":
        new_o = df["newbalanceOrig"].astype("float32")
        new_d = df["newbalanceDest"].astype("float32")
        out["newbalanceOrig"] = new_o
        out["newbalanceDest"] = new_d
        out["error_balance_orig"] = (new_o + amount - old_o).astype("float32")
        out["error_balance_dest"] = (old_d + amount - new_d).astype("float32")
    return out[model_feature_names(feature_set)]


def build_pipeline(estimator: Any, feature_set: str = "pre_transaction", scale: bool = False) -> Pipeline:
    """features -> encode/scale -> estimator. The whole object is what gets saved."""
    _check_set(feature_set)
    numeric = StandardScaler() if scale else "passthrough"
    prep = ColumnTransformer(
        [
            ("cat", OneHotEncoder(categories=[EXPECTED_TYPES], handle_unknown="ignore",
                                  sparse_output=False, dtype=np.float32), CATEGORICAL),
            ("num", numeric, numeric_columns(feature_set)),
        ],
        verbose_feature_names_out=False,
    )
    return Pipeline([
        ("features", FunctionTransformer(engineer_features, kw_args={"feature_set": feature_set})),
        ("prep", prep),
        ("model", estimator),
    ])


def feature_schema(feature_set: str) -> dict[str, Any]:
    """JSON-serialisable description of inputs, features and exclusions."""
    _check_set(feature_set)
    return {
        "feature_set": feature_set,
        "required_input_columns": raw_columns(feature_set),
        "engineered_model_features": model_feature_names(feature_set),
        "categorical_features": CATEGORICAL,
        "known_transaction_types": EXPECTED_TYPES,
        "excluded_columns": EXCLUDED_COLUMNS,
        "availability_note": (
            "All inputs are plausibly available before the transaction settles (to be confirmed "
            "against the production payment flow)."
            if feature_set == "pre_transaction" else
            "Includes post-transaction balances: availability at prediction time must be confirmed; "
            "do NOT deploy unless the real-time path can provide them."
        ),
    }
