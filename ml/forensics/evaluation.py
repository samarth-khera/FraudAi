"""Metrics for rare-event detection. Every figure is reported with its split name and positive/negative counts."""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, roc_auc_score


def ece(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    """Expected calibration error over equal-count bins (equal-width bins are empty for rare positives)."""
    if len(y) == 0:
        return float("nan")
    order = np.argsort(p)
    err = 0.0
    for chunk in np.array_split(order, bins):
        if len(chunk):
            err += len(chunk) / len(y) * abs(y[chunk].mean() - p[chunk].mean())
    return float(err)


def reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    order = np.argsort(p)
    out = []
    for chunk in np.array_split(order, bins):
        if len(chunk):
            out.append({"n": int(len(chunk)), "mean_score": round(float(p[chunk].mean()), 4),
                        "observed_rate": round(float(y[chunk].mean()), 4)})
    return out


def recall_at_precision(y: np.ndarray, p: np.ndarray, target: float) -> dict:
    """Highest recall reachable while precision >= target (and the score threshold where it happens)."""
    order = np.argsort(-p, kind="mergesort")
    ys, ps = y[order], p[order]
    tp = np.cumsum(ys)
    k = np.arange(1, len(ys) + 1)
    prec = tp / k
    ok = np.where(prec >= target)[0]
    if not len(ok) or ys.sum() == 0:
        return {"precision_target": target, "recall": 0.0, "threshold": None}
    i = ok[np.argmax(tp[ok])]
    return {"precision_target": target, "recall": round(float(tp[i] / ys.sum()), 4), "threshold": float(ps[i])}


def metrics(y, p, threshold: float, split: str, ks=(50, 100, 500)) -> dict:
    y, p = np.asarray(y).astype(int), np.asarray(p, dtype=float)
    pred = (p >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / pos if pos else 0.0
    order = np.argsort(-p, kind="mergesort")
    out = {
        "split": split, "n": int(len(y)), "positives": pos, "negatives": neg, "prevalence": round(pos / max(len(y), 1), 5),
        "threshold": round(float(threshold), 6),
        "precision": round(float(prec), 4), "recall": round(float(rec), 4),
        "f1": round(float(2 * prec * rec / (prec + rec)) if prec + rec else 0.0, 4),
        "false_positive_rate": round(float(fp / neg) if neg else 0.0, 6),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "pr_auc": round(float(average_precision_score(y, p)), 4) if 0 < pos < len(y) else None,
        "roc_auc": round(float(roc_auc_score(y, p)), 4) if 0 < pos < len(y) else None,
        "brier": round(float(brier_score_loss(y, np.clip(p, 0, 1))), 6),
        "ece": round(ece(y, np.clip(p, 0, 1)), 5),
        "precision_at_k": {str(k): round(float(y[order[:k]].mean()), 4) for k in ks if k <= len(y)},
        "recall_at_precision": [recall_at_precision(y, p, t) for t in (0.5, 0.8, 0.9)],
    }
    return out


def pick_threshold(y, p, min_precision: float = 0.5) -> tuple[float, str]:
    """Validation-only operating point: the lowest threshold that keeps precision >= min_precision (most recall at
    that review workload). Falls back to the F1-optimal threshold when the target is unreachable.

    Known limitation (reported, not changed here, so the served thresholds stay as selected): recall_at_precision walks
    rows one at a time in score order, so when many validation rows share the selected score (e.g. an isotonic
    plateau) it can stop INSIDE that tied block. Applying ``score >= threshold`` then flags the whole block, and the
    realised precision can fall below min_precision. Check the realised value with precision_at_threshold()."""
    y, p = np.asarray(y).astype(int), np.asarray(p, dtype=float)
    r = recall_at_precision(y, p, min_precision)
    if r["threshold"] is not None and r["recall"] > 0:
        return float(r["threshold"]), f"lowest validation threshold with precision >= {min_precision:.0%}"
    best, best_f1 = 0.5, -1.0
    for t in np.unique(np.quantile(p, np.linspace(0.5, 0.9999, 400))):
        pred = p >= t
        tp = (pred & (y == 1)).sum()
        if pred.sum() == 0:
            continue
        pr, rc = tp / pred.sum(), tp / max(y.sum(), 1)
        f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0
        if f1 > best_f1:
            best, best_f1 = float(t), f1
    return best, "F1-optimal validation threshold (precision target unreachable)"


def precision_at_threshold(y, p, threshold: float) -> dict:
    """Counts and precision exactly as the threshold is applied when serving (``p >= threshold``), so every row tied
    at the threshold is counted together. ``tied_at_threshold`` is the number of rows whose score equals it."""
    y, p = np.asarray(y).astype(int), np.asarray(p, dtype=float)
    thr = float(threshold)
    pred = p >= thr
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    fn, tn = int((~pred & (y == 1)).sum()), int((~pred & (y == 0)).sum())
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "flagged": tp + fp, "tied_at_threshold": int((p == thr).sum()),
            "precision": tp / (tp + fp) if tp + fp else None}


def threshold_record(threshold: float, rule: str, y_val=None, p_val=None, on: str = "calibrated",
                     chosen_on: str = "validation split") -> dict:
    """The metadata.json threshold block. ``value`` is the EXACT selected score (a JSON float round-trips exactly), so
    the served comparison ``score >= value`` reproduces the validation counts; rounding it (e.g. to 6 decimals) can move
    it above the selected row's score and drop that row. ``display_value`` is the 6-decimal rounding, for display only.
    With the validation labels/scores it was chosen on, the realised validation counts (ties counted) are recorded too."""
    thr = float(threshold)
    out = {"value": thr, "display_value": round(thr, 6), "on": on, "rule": rule, "chosen_on": chosen_on}
    if y_val is not None and p_val is not None:
        v = precision_at_threshold(y_val, p_val, thr)
        out["validation_at_value_ties_counted"] = {k: v[k] for k in ("tp", "fp", "fn", "tn")} | {
            "rows_tied_at_value": v["tied_at_threshold"],
            "precision": round(v["precision"], 4) if v["precision"] is not None else None}
    return out


def bootstrap_pr_auc(y, p, groups=None, n: int = 300, seed: int = 0) -> list[float]:
    """95% interval for PR-AUC. Resamples whole groups (scenario instances) when given, else rows. A resample is
    expressed as per-row weights (how often the row's group was drawn), which is exact and linear in the row count."""
    y, p = np.asarray(y).astype(int), np.asarray(p, dtype=float)
    rng = np.random.default_rng(seed)
    codes = np.arange(len(y)) if groups is None else np.unique(np.asarray(groups).astype(str), return_inverse=True)[1]
    k = codes.max() + 1 if len(codes) else 0
    vals = []
    for _ in range(n):
        w = np.bincount(rng.integers(0, k, k), minlength=k)[codes]
        m = w > 0
        if 0 < (y[m] * w[m]).sum() < w[m].sum() and (y[m] == 0).any():
            vals.append(average_precision_score(y[m], p[m], sample_weight=w[m]))
    return [round(float(np.quantile(vals, 0.025)), 4), round(float(np.quantile(vals, 0.975)), 4)] if vals else [None, None]
