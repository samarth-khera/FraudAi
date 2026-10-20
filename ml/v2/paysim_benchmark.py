"""PaySim transaction-level benchmark model pipeline for FraudShield AI V2.

Strictly follows leakage prevention and chronological evaluation:
- Only valid pre-transaction features are used.
- Post-transaction balances, account identifiers, and outcome flags are strictly excluded.
- Chronological train / validation / test splits (steps 1-500 train, 501-620 val, 621-743 test).
- Threshold tuned exclusively on validation split; evaluated once on held-out test split.
- Saves pipeline, feature schema, threshold, and evaluation metadata to ml/artifacts/v2/paysim_benchmark/.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
import xgboost as xgb


FEATURE_COLUMNS = [
    "step",
    "amount",
    "oldbalanceOrg",
    "oldbalanceDest",
    "amount_to_oldbalanceOrg_ratio",
    "is_origin_zero_balance",
    "is_dest_zero_balance",
    "step_hour",
    "step_day",
    "type_CASH_IN",
    "type_CASH_OUT",
    "type_DEBIT",
    "type_PAYMENT",
    "type_TRANSFER",
]


def create_pre_transaction_features(df: pd.DataFrame) -> pd.DataFrame:
    """Transforms raw PaySim rows into strictly pre-transaction feature representations."""
    X = pd.DataFrame(index=df.index)
    X["step"] = df["step"].astype(np.float32)
    X["amount"] = df["amount"].astype(np.float32)
    X["oldbalanceOrg"] = df["oldbalanceOrg"].astype(np.float32)
    X["oldbalanceDest"] = df["oldbalanceDest"].astype(np.float32)
    X["amount_to_oldbalanceOrg_ratio"] = (df["amount"] / (df["oldbalanceOrg"] + 1.0)).astype(np.float32)
    X["is_origin_zero_balance"] = (df["oldbalanceOrg"] == 0.0).astype(np.float32)
    X["is_dest_zero_balance"] = (df["oldbalanceDest"] == 0.0).astype(np.float32)
    X["step_hour"] = (df["step"] % 24).astype(np.float32)
    X["step_day"] = (df["step"] // 24).astype(np.float32)
    for txn_type in ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]:
        X[f"type_{txn_type}"] = (df["type"] == txn_type).astype(np.float32)

    return X[FEATURE_COLUMNS]


def train_paysim_benchmark(
    csv_path: str = "data/raw/PS_20174392719_1491204439457_log.csv",
    artifacts_dir: str = "ml/artifacts/v2/paysim_benchmark",
    train_max_step: int = 500,
    val_max_step: int = 620,
    train_negative_sample: int = 100000,
    random_state: int = 42,
) -> Dict[str, Any]:
    """Runs end-to-end training and held-out evaluation for PaySim benchmark."""
    start_total_time = time.time()
    artifacts_path = Path(artifacts_dir)
    artifacts_path.mkdir(parents=True, exist_ok=True)

    print(f"[PaySim] Loading dataset from {csv_path}...")
    load_start = time.time()
    chunks: List[pd.DataFrame] = []
    use_cols = ["step", "type", "amount", "oldbalanceOrg", "oldbalanceDest", "isFraud"]
    for chunk in pd.read_csv(csv_path, usecols=use_cols, chunksize=1000000):
        chunks.append(chunk)
    df = pd.concat(chunks, ignore_index=True)
    load_time = time.time() - load_start
    print(f"[PaySim] Loaded {len(df):,} transactions in {load_time:.2f}s")

    # 1. Chronological splitting
    train_mask = df["step"] <= train_max_step
    val_mask = (df["step"] > train_max_step) & (df["step"] <= val_max_step)
    test_mask = df["step"] > val_max_step

    train_raw = df[train_mask]
    val_raw = df[val_mask]
    test_raw = df[test_mask]

    print(f"[PaySim] Chronological Splits:")
    print(f"  Train (step <= {train_max_step}): {len(train_raw):,} txns ({train_raw['isFraud'].sum()} fraud)")
    print(f"  Val   ({train_max_step} < step <= {val_max_step}): {len(val_raw):,} txns ({val_raw['isFraud'].sum()} fraud)")
    print(f"  Test  (step > {val_max_step}): {len(test_raw):,} txns ({test_raw['isFraud'].sum()} fraud)")

    # 2. Subsample negative class in training split only (all fraud retained)
    fraud_train = train_raw[train_raw["isFraud"] == 1]
    neg_train = train_raw[train_raw["isFraud"] == 0]
    if len(neg_train) > train_negative_sample:
        neg_train = neg_train.sample(n=train_negative_sample, random_state=random_state)
    sampled_train = pd.concat([fraud_train, neg_train]).sample(frac=1.0, random_state=random_state)

    # 3. Create feature matrices
    print("[PaySim] Building pre-transaction feature matrices...")
    X_train = create_pre_transaction_features(sampled_train)
    y_train = sampled_train["isFraud"].values

    X_val = create_pre_transaction_features(val_raw)
    y_val = val_raw["isFraud"].values

    X_test = create_pre_transaction_features(test_raw)
    y_test = test_raw["isFraud"].values

    # 4. Train XGBoost classifier
    print("[PaySim] Training XGBoost classifier...")
    fit_start = time.time()
    clf = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        scale_pos_weight=1.0,
        random_state=random_state,
        tree_method="hist",
        eval_metric="logloss",
    )
    clf.fit(X_train, y_train)
    fit_time = time.time() - fit_start
    print(f"[PaySim] Fit completed in {fit_time:.2f}s")

    # 5. Threshold selection on Validation set exclusively
    val_probs = clf.predict_proba(X_val)[:, 1]
    best_thresh = 0.5
    best_f1 = 0.0
    for th in np.arange(0.1, 0.95, 0.05):
        preds = (val_probs >= th).astype(int)
        f1 = f1_score(y_val, preds, zero_division=0)
        if f1 > best_f1:
            best_f1 = float(f1)
            best_thresh = float(round(th, 2))

    print(f"[PaySim] Optimal validation threshold: {best_thresh} (Val F1: {best_f1:.4f})")

    # 6. Final evaluation on held-out test set
    test_probs = clf.predict_proba(X_test)[:, 1]
    test_preds = (test_probs >= best_thresh).astype(int)

    precision = float(precision_score(y_test, test_preds, zero_division=0))
    recall = float(recall_score(y_test, test_preds, zero_division=0))
    f1 = float(f1_score(y_test, test_preds, zero_division=0))
    roc_auc = float(roc_auc_score(y_test, test_probs))
    pr_auc = float(average_precision_score(y_test, test_probs))
    cm = confusion_matrix(y_test, test_preds).tolist()

    total_time = time.time() - start_total_time

    results: Dict[str, Any] = {
        "benchmark_name": "PaySim Transaction Benchmark (XGBoost)",
        "model_version": "v2-benchmark-1.0.0",
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset_path": csv_path,
        "chronological_split": {
            "train_steps": f"1..{train_max_step}",
            "val_steps": f"{train_max_step+1}..{val_max_step}",
            "test_steps": f"{val_max_step+1}..{int(df['step'].max())}",
            "train_rows_evaluated": len(sampled_train),
            "val_rows_evaluated": len(val_raw),
            "test_rows_evaluated": len(test_raw),
        },
        "class_distribution": {
            "train_fraud_count": int(train_raw["isFraud"].sum()),
            "train_total_count": len(train_raw),
            "val_fraud_count": int(val_raw["isFraud"].sum()),
            "val_total_count": len(val_raw),
            "test_fraud_count": int(test_raw["isFraud"].sum()),
            "test_total_count": len(test_raw),
        },
        "selected_threshold": best_thresh,
        "validation_metrics": {
            "f1_score": best_f1,
        },
        "held_out_test_metrics": {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "roc_auc": round(roc_auc, 4),
            "pr_auc": round(pr_auc, 4),
            "confusion_matrix": cm,
            "true_negatives": cm[0][0],
            "false_positives": cm[0][1],
            "false_negatives": cm[1][0],
            "true_positives": cm[1][1],
        },
        "training_time_seconds": round(fit_time, 2),
        "total_elapsed_seconds": round(total_time, 2),
        "features": list(FEATURE_COLUMNS),
        "excluded_features": [
            "nameOrig (identifier)",
            "nameDest (identifier)",
            "newbalanceOrig (post-transaction balance leakage)",
            "newbalanceDest (post-transaction balance leakage)",
            "isFlaggedFraud (rule outcome flag)",
        ],
        "domain_constraints": (
            "PaySim dataset benchmark only. This model is trained on synthetic mobile money logs from 2017 "
            "and must NOT be applied to V2 synthetic banking transactions without feature adapters."
        ),
    }

    # 7. Persist artifacts
    model_file = artifacts_path / "model.joblib"
    joblib.dump(clf, model_file)

    schema_file = artifacts_path / "feature_schema.json"
    with open(schema_file, "w") as f:
        json.dump({"features": FEATURE_COLUMNS}, f, indent=2)

    metadata_file = artifacts_path / "metadata.json"
    with open(metadata_file, "w") as f:
        json.dump(results, f, indent=2)

    print(f"[PaySim] Benchmark model and metadata saved to {artifacts_dir}")
    print(f"  Test Precision: {precision:.4f}, Recall: {recall:.4f}, F1: {f1:.4f}, PR-AUC: {pr_auc:.4f}")
    return results


if __name__ == "__main__":
    train_paysim_benchmark()
