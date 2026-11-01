"""Candidate models, imbalance handling, calibration and export shared by the v3 training scripts.

Rules: everything is fitted on the training split only; hyperparameters, early stopping, calibration and the threshold
use the validation split only; test splits are scored once, after every choice is fixed.
"""

from __future__ import annotations

import json
import platform
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SEED = 20261031


@dataclass
class Fitted:
    family: str
    params: dict
    model: object
    features: list[str]
    train_seconds: float
    best_iteration: int | None = None

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        X = X[self.features]
        if self.family == "xgboost":
            return self.model.predict(xgb.DMatrix(X.to_numpy(dtype=float), feature_names=self.features, missing=np.nan),
                                      iteration_range=(0, (self.best_iteration or 0) + 1))
        return self.model.predict_proba(X.to_numpy(dtype=float))[:, 1]


def undersample(X: pd.DataFrame, y: np.ndarray, ratio: float, seed: int = SEED) -> tuple[pd.DataFrame, np.ndarray]:
    """Random undersampling of negatives to ``ratio`` negatives per positive. Training split only."""
    rng = np.random.default_rng(seed)
    pos, neg = np.where(y == 1)[0], np.where(y == 0)[0]
    keep = np.concatenate([pos, rng.choice(neg, min(len(neg), int(len(pos) * ratio)), replace=False)])
    keep.sort()
    return X.iloc[keep], y[keep]


def fit_logistic(X, y, C: float, features) -> Fitted:
    t0 = time.perf_counter()
    pipe = Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)), ("scale", StandardScaler()),
                     ("lr", LogisticRegression(C=C, class_weight="balanced", max_iter=3000, random_state=SEED))])
    pipe.fit(X[features].to_numpy(dtype=float), y)
    return Fitted("logistic_regression", {"C": C, "class_weight": "balanced"}, pipe, features, time.perf_counter() - t0)


def fit_forest(X, y, depth, leaf, features) -> Fitted:
    t0 = time.perf_counter()
    pipe = Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)),
                     ("rf", RandomForestClassifier(n_estimators=300, max_depth=depth, min_samples_leaf=leaf, max_features="sqrt",
                                                   class_weight="balanced_subsample", n_jobs=-1, random_state=SEED))])
    pipe.fit(X[features].to_numpy(dtype=float), y)
    return Fitted("random_forest", {"n_estimators": 300, "max_depth": depth, "min_samples_leaf": leaf,
                                    "class_weight": "balanced_subsample"}, pipe, features, time.perf_counter() - t0)


def fit_xgb(X, y, Xv, yv, params: dict, features, rounds: int = 2000) -> Fitted:
    t0 = time.perf_counter()
    p = {"objective": "binary:logistic", "eval_metric": "aucpr", "eta": 0.05, "subsample": 0.8, "colsample_bytree": 0.8,
         "tree_method": "hist", "seed": SEED, "nthread": 4, **params}
    dtr = xgb.DMatrix(X[features].to_numpy(dtype=float), label=y, feature_names=features, missing=np.nan)
    dva = xgb.DMatrix(Xv[features].to_numpy(dtype=float), label=yv, feature_names=features, missing=np.nan)
    b = xgb.train(p, dtr, rounds, evals=[(dva, "validation")], early_stopping_rounds=60, verbose_eval=False)
    return Fitted("xgboost", p, b, features, time.perf_counter() - t0, best_iteration=b.best_iteration)


def pr_auc(y, p) -> float:
    return float(average_precision_score(y, p)) if 0 < np.sum(y) < len(y) else float("nan")


def quick(y, p) -> dict:
    return {"pr_auc": round(pr_auc(y, p), 4), "roc_auc": round(float(roc_auc_score(y, p)), 4) if 0 < np.sum(y) < len(y) else None}


def group_folds(groups: np.ndarray, k: int = 5, seed: int = SEED) -> list[np.ndarray]:
    """Row indices of k folds that keep every group (e.g. a scenario instance with all of its account snapshots)
    inside one fold. Groups are assigned to folds in a seeded random order, never in file/index order."""
    uniq, codes = np.unique(np.asarray(groups).astype(str), return_inverse=True)
    fold_of_group = np.random.default_rng(seed).permutation(len(uniq)) % k
    fold = fold_of_group[codes]
    return [np.where(fold == i)[0] for i in range(k)]


def choose_calibration(y_val: np.ndarray, raw_val: np.ndarray, time_order: np.ndarray | None = None,
                       groups: np.ndarray | None = None, k: int = 5) -> dict:
    """Compares isotonic and sigmoid maps by cross-fitting on the validation split, then refits the better one on all
    validation rows. Returns the JSON-serialisable map plus the cross-fitted Brier scores.

    * ``time_order`` (transactions): 2 folds, the earlier and the later half of the validation period, each used once
      to fit and once to score.
    * ``groups`` (accounts): k folds with whole groups (scenario instances) kept together and groups assigned to folds
      in a seeded random order; each fold is scored by a map fitted on the other k-1 folds."""
    if groups is not None:
        folds = group_folds(groups, k)
        pairs = [(np.concatenate([f for j, f in enumerate(folds) if j != i]), folds[i]) for i in range(k)]
        scheme = f"{k}-fold cross-fit over validation groups (seeded random group order)"
    else:
        order = np.argsort(time_order, kind="mergesort")
        halves = [order[: len(order) // 2], order[len(order) // 2:]]
        pairs = [(halves[0], halves[1]), (halves[1], halves[0])]
        scheme = "2-fold cross-fit over the earlier and later halves of the validation period"
    scores = {"uncalibrated": [], "isotonic": [], "sigmoid": []}
    for tr, te in pairs:
        if y_val[tr].sum() == 0 or y_val[te].sum() == 0:
            continue
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(raw_val[tr], y_val[tr])
        sig = LogisticRegression(C=1e6).fit(raw_val[tr].reshape(-1, 1), y_val[tr])
        scores["uncalibrated"].append(brier_score_loss(y_val[te], raw_val[te]))
        scores["isotonic"].append(brier_score_loss(y_val[te], iso.predict(raw_val[te])))
        scores["sigmoid"].append(brier_score_loss(y_val[te], sig.predict_proba(raw_val[te].reshape(-1, 1))[:, 1]))
    mean = {k: float(np.mean(v)) if v else float("nan") for k, v in scores.items()}
    best = min(("isotonic", "sigmoid"), key=lambda k: mean[k])
    if best == "isotonic":
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(raw_val, y_val)
        cal = {"method": "isotonic", "x": [float(v) for v in iso.X_thresholds_], "y": [float(v) for v in iso.y_thresholds_]}
    else:
        sig = LogisticRegression(C=1e6).fit(raw_val.reshape(-1, 1), y_val)
        cal = {"method": "sigmoid", "a": float(-sig.coef_[0][0]), "b": float(-sig.intercept_[0])}
    cal["cross_fitted_brier_on_validation"] = {name: round(v, 6) for name, v in mean.items()}
    cal["cross_fit"] = scheme
    cal["fitted_on"] = "validation split (all rows)"
    return cal


# Features that measure time since an account's first record. For an established account they grow with calendar
# position (one more day per day), so a model trained on an earlier window sees smaller values than live data later in
# the ledger. They are left out of the range check: otherwise "outside the training range" would fire on most rows near
# the end of a ledger (it tracked the calendar date, not unusual behaviour). Capping them instead would change model
# inputs and the feature schema; leaving them out changes no score. The model itself still uses them.
RANGE_CHECK_EXCLUDED = {
    "s_history_days": "days since the sender's first record; grows with calendar position",
    "r_history_days": "days since the receiver's first record; grows with calendar position",
    "history_days": "days since the account's first record; grows with calendar position",
}


def training_ranges(X: pd.DataFrame, features: list[str]) -> dict:
    """[0.5th, 99.5th] percentile of each non-binary training feature, except RANGE_CHECK_EXCLUDED."""
    out = {}
    for f in features:
        if f in RANGE_CHECK_EXCLUDED:
            continue
        v = X[f].dropna()
        if len(v) and v.nunique() > 2:
            out[f] = [float(v.quantile(0.005)), float(v.quantile(0.995))]
    return out


def export(fitted: Fitted, out_dir: Path, meta: dict) -> dict:
    """Writes model.json (XGBoost native JSON or logistic coefficients) and metadata.json. No pickles."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if fitted.family == "xgboost":
        b = fitted.model
        if fitted.best_iteration is not None:
            b = b[: fitted.best_iteration + 1]
        b.save_model(str(out_dir / "model.json"))
        fmt = "xgboost_json"
    elif fitted.family == "logistic_regression":
        imp, sc, lr = fitted.model.named_steps["impute"], fitted.model.named_steps["scale"], fitted.model.named_steps["lr"]
        ind = imp.indicator_.features_.tolist() if imp.indicator_ is not None else []
        (out_dir / "model.json").write_text(json.dumps({
            "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]), "impute": imp.statistics_.tolist(),
            "indicator_columns": ind, "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist()}))
        fmt = "logistic_json"
    else:
        raise ValueError(f"{fitted.family} has no text export; it cannot be promoted without one")
    meta = {"format": fmt, "features": fitted.features, **meta}
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2, default=str))
    return meta


def environment() -> dict:
    return {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__, "xgboost": xgb.__version__, "platform": platform.platform(terse=True),
            "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "seed": SEED}


def feature_importance(fitted: Fitted, top: int = 15) -> dict:
    if fitted.family == "xgboost":
        g = fitted.model.get_score(importance_type="total_gain")
        tot = sum(g.values()) or 1.0
        return {k: round(v / tot, 4) for k, v in sorted(g.items(), key=lambda kv: -kv[1])[:top]}
    if fitted.family == "random_forest":
        imp = fitted.model.named_steps["rf"].feature_importances_[: len(fitted.features)]
        s = pd.Series(imp, index=fitted.features).sort_values(ascending=False)[:top]
        return {k: round(float(v), 4) for k, v in s.items()}
    lr = fitted.model.named_steps["lr"]
    s = pd.Series(lr.coef_[0][: len(fitted.features)], index=fitted.features)
    return {k: round(float(s[k]), 4) for k in s.abs().sort_values(ascending=False).index[:top]}
