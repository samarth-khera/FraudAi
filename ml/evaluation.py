"""Metrics and validation-only threshold selection."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)


def compute_metrics(y_true, scores, threshold: float) -> dict[str, Any]:
    """All metrics are computed from the given labels/scores; nothing is hardcoded.

    ROC-AUC / PR-AUC are None when only one class is present (undefined).
    """
    y = np.asarray(y_true).astype(int)
    s = np.asarray(scores, dtype=float)
    if y.shape != s.shape or y.size == 0:
        raise ValueError("y_true and scores must be non-empty and the same length.")
    pred = (s >= threshold).astype(int)
    tn, fp, fn, tp = (int(v) for v in confusion_matrix(y, pred, labels=[0, 1]).ravel())
    two_classes = len(np.unique(y)) == 2
    return {
        "n": int(y.size),
        "n_fraud": int(y.sum()),
        "fraud_prevalence": float(y.mean()),
        "threshold": float(threshold),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "pr_auc": float(average_precision_score(y, s)) if two_classes else None,
        "roc_auc": float(roc_auc_score(y, s)) if two_classes else None,
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "false_positive_rate": float(fp / (fp + tn)) if (fp + tn) else None,
        "flagged_rate": float(pred.mean()),
    }


def select_threshold(
    y_true,
    scores,
    strategy: str = "max_f1",
    min_precision: Optional[float] = None,
) -> dict[str, Any]:
    """Pick a decision threshold from (validation) labels and scores only.

    strategy:
      * ``max_f1``: threshold maximising F1.
      * ``max_recall_at_min_precision``: highest recall subject to precision >= min_precision
        (falls back to max_f1 if unattainable, and says so).
    Callers must pass VALIDATION data. The test set must never reach this function.
    """
    y = np.asarray(y_true).astype(int)
    s = np.asarray(scores, dtype=float)
    if y.sum() == 0 or y.sum() == y.size:
        raise ValueError("Threshold selection needs both classes in the validation labels.")
    prec, rec, thr = precision_recall_curve(y, s)
    prec, rec = prec[:-1], rec[:-1]  # align with thr
    f1 = np.where(prec + rec > 0, 2 * prec * rec / np.maximum(prec + rec, 1e-12), 0.0)

    note = None
    if strategy == "max_f1":
        idx = int(np.argmax(f1))
    elif strategy == "max_recall_at_min_precision":
        if min_precision is None:
            raise ValueError("min_precision is required for this strategy.")
        ok = np.where(prec >= min_precision)[0]
        if ok.size:
            idx = int(ok[np.argmax(rec[ok])])
        else:
            idx = int(np.argmax(f1))
            note = f"precision >= {min_precision} unattainable on validation; fell back to max_f1."
    else:
        raise ValueError(f"Unknown strategy {strategy!r}")
    return {
        "threshold": float(thr[idx]), "strategy": strategy, "min_precision": min_precision,
        "validation_precision": float(prec[idx]), "validation_recall": float(rec[idx]),
        "validation_f1": float(f1[idx]), "note": note,
    }
