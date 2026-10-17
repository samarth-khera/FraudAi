"""Central configuration for the FraudShield AI ML pipeline."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DATA_PATH = REPO_ROOT / "data" / "raw" / "PS_20174392719_1491204439457_log.csv"
ARTIFACT_DIR = REPO_ROOT / "ml" / "artifacts" / "model_v1"
REPORT_DIR = REPO_ROOT / "ml" / "reports"

RANDOM_SEED = 42

TARGET = "isFraud"

# Required CSV columns and the dtype we parse them as.
REQUIRED_COLUMNS: dict[str, str] = {
    "step": "int32",
    "type": "string",
    "amount": "float64",
    "nameOrig": "string",
    "oldbalanceOrg": "float64",
    "newbalanceOrig": "float64",
    "nameDest": "string",
    "oldbalanceDest": "float64",
    "newbalanceDest": "float64",
    "isFraud": "int8",
    "isFlaggedFraud": "int8",
}

EXPECTED_TYPES = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]

# Columns that must never be model inputs, with the reason (documented in the model card).
EXCLUDED_COLUMNS: dict[str, str] = {
    "isFraud": "Target label.",
    "isFlaggedFraud": "Output of the simulator's own rule-based flagging; it is derived "
                      "from the fraud process and would leak the label.",
    "nameOrig": "Raw account ID: high-cardinality identifier, memorises accounts rather than "
                "generalising; excluded from the initial tabular model.",
    "nameDest": "Raw account ID: same reason as nameOrig.",
}

RAW_FEATURE_COLUMNS_PRE = ["step", "type", "amount", "oldbalanceOrg", "oldbalanceDest"]
RAW_FEATURE_COLUMNS_POST = RAW_FEATURE_COLUMNS_PRE + ["newbalanceOrig", "newbalanceDest"]

# Chronological split fractions (by row share, cut on whole `step` boundaries).
TRAIN_FRACTION = 0.70
VAL_FRACTION = 0.15  # remainder is the held-out test set
