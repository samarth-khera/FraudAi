"""Training pipeline: validate -> chronological split -> fit -> select threshold -> evaluate -> save.

Usage (from repo root):
    python -m ml.train [--data PATH] [--artifact-dir DIR] [--report-dir DIR]

Rules enforced here:
* Fit on TRAIN only. Early stopping, model selection and the decision threshold use
  VALIDATION only. The TEST set is scored once, after everything is frozen.
* The deployable candidate must use the ``pre_transaction`` feature set; the
  ``with_post_balance`` model is reported only as a leakage-risk comparison.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from ml.config import (
    ARTIFACT_DIR, RANDOM_SEED, RAW_DATA_PATH, REPORT_DIR, TARGET,
)
from ml.data_validation import (
    DataValidationError, file_sha256, load_modelling_frame, validate_frame,
)
from ml.evaluation import compute_metrics, select_threshold
from ml.features import build_pipeline, feature_schema, raw_columns
from ml.model_card import render_model_card
from ml.splitting import chronological_split

try:  # XGBoost is optional; fall back to scikit-learn's HistGradientBoosting.
    from xgboost import XGBClassifier
    HAVE_XGB = True
except Exception:  # pragma: no cover - depends on environment
    HAVE_XGB = False


@dataclass
class ModelSpec:
    name: str
    feature_set: str
    build: Callable[[float], Any]      # takes scale_pos_weight, returns estimator
    scale: bool = False
    tune_threshold: bool = True        # False for the dummy baseline (fixed 0.5)
    uses_eval_set: bool = False
    candidate_for_deployment: bool = True
    description: str = ""


def default_specs(fast: bool = False) -> list[ModelSpec]:
    """Model line-up. ``fast`` shrinks the boosters (used by unit tests only)."""
    n_est = 20 if fast else 500
    specs = [
        ModelSpec("dummy_prior", "pre_transaction",
                  lambda spw: DummyClassifier(strategy="prior"),
                  tune_threshold=False, candidate_for_deployment=False,
                  description="Predicts the training prevalence for every row; threshold fixed at 0.5."),
        ModelSpec("logistic_regression", "pre_transaction",
                  lambda spw: LogisticRegression(class_weight="balanced", max_iter=300,
                                                 random_state=RANDOM_SEED),
                  scale=True,
                  description="Scaled features, class_weight='balanced'."),
    ]
    if HAVE_XGB:
        def xgb(spw: float) -> Any:
            return XGBClassifier(
                n_estimators=n_est, learning_rate=0.1, max_depth=6, subsample=0.8,
                colsample_bytree=0.8, tree_method="hist", scale_pos_weight=spw,
                eval_metric="aucpr", early_stopping_rounds=30, n_jobs=-1,
                random_state=RANDOM_SEED)
        desc = "XGBoost (hist), scale_pos_weight=neg/pos on train, early stopping on validation PR-AUC."
        specs.append(ModelSpec("xgboost", "pre_transaction", xgb, uses_eval_set=True, description=desc))
        specs.append(ModelSpec("xgboost_with_post_balance", "with_post_balance", xgb, uses_eval_set=True,
                               candidate_for_deployment=False,
                               description="COMPARISON ONLY: also uses post-transaction balances. " + desc))
    else:
        from sklearn.ensemble import HistGradientBoostingClassifier
        specs.append(ModelSpec(
            "hist_gradient_boosting", "pre_transaction",
            lambda spw: HistGradientBoostingClassifier(class_weight="balanced", random_state=RANDOM_SEED),
            description="scikit-learn fallback because XGBoost is not installed."))
    return specs


def fit_pipeline(spec: ModelSpec, train: pd.DataFrame, val: pd.DataFrame, spw: float) -> Pipeline:
    """Fit preprocessing + estimator on TRAIN; validation is used only for early stopping."""
    pipe = build_pipeline(spec.build(spw), spec.feature_set, scale=spec.scale)
    pre = Pipeline(pipe.steps[:-1])           # shares the same estimator objects as `pipe`
    Xt = pre.fit_transform(train, train[TARGET])
    est = pipe.steps[-1][1]
    if spec.uses_eval_set:
        Xv = pre.transform(val)
        est.fit(Xt, train[TARGET].to_numpy(), eval_set=[(Xv, val[TARGET].to_numpy())], verbose=False)
    else:
        est.fit(Xt, train[TARGET].to_numpy())
    return pipe


def score(pipe: Pipeline, df: pd.DataFrame, batch: int = 1_000_000) -> np.ndarray:
    out = np.empty(len(df), dtype=np.float64)
    for i in range(0, len(df), batch):
        out[i:i + batch] = pipe.predict_proba(df.iloc[i:i + batch])[:, 1]
    return out


def train_and_evaluate(
    df: pd.DataFrame,
    specs: Optional[list[ModelSpec]] = None,
    log: Callable[[str], None] = print,
) -> dict[str, Any]:
    """Run the full experiment on a loaded frame. Returns results + fitted pipelines."""
    validate_frame(df, required=raw_columns("with_post_balance") + [TARGET])
    train, val, test, split = chronological_split(df)
    log(f"Split by step: train<= {split.train_max_step} ({split.train_rows:,} rows, {split.train_fraud:,} fraud) | "
        f"val<= {split.val_max_step} ({split.val_rows:,}, {split.val_fraud:,}) | "
        f"test ({split.test_rows:,}, {split.test_fraud:,})")

    pos = int(train[TARGET].sum())
    spw = float((len(train) - pos) / pos)
    specs = specs or default_specs()
    yv, yt = val[TARGET].to_numpy(), test[TARGET].to_numpy()

    results: dict[str, Any] = {}
    pipelines: dict[str, Pipeline] = {}
    for spec in specs:
        t0 = time.time()
        log(f"[{spec.name}] fitting ({spec.feature_set}) ...")
        pipe = fit_pipeline(spec, train, val, spw)
        fit_s = time.time() - t0
        sv = score(pipe, val)
        if spec.tune_threshold:
            thr = select_threshold(yv, sv, strategy="max_f1")
        else:
            thr = {"threshold": 0.5, "strategy": "fixed_0.5_baseline", "min_precision": None, "note":
                   "Baseline is not tuned."}
        # Test is scored only now, with the already-frozen threshold.
        st = score(pipe, test)
        entry = {
            "feature_set": spec.feature_set,
            "description": spec.description,
            "candidate_for_deployment": spec.candidate_for_deployment,
            "fit_seconds": round(fit_s, 1),
            "threshold_selection": thr,
            "validation": compute_metrics(yv, sv, thr["threshold"]),
            "test": compute_metrics(yt, st, thr["threshold"]),
        }
        if spec.uses_eval_set and hasattr(pipe.steps[-1][1], "best_iteration"):
            entry["best_iteration"] = int(pipe.steps[-1][1].best_iteration)
        results[spec.name] = entry
        pipelines[spec.name] = pipe
        log(f"[{spec.name}] val PR-AUC={entry['validation']['pr_auc']:.4f} thr={thr['threshold']:.4f} | "
            f"test P={entry['test']['precision']:.4f} R={entry['test']['recall']:.4f} "
            f"F1={entry['test']['f1']:.4f} ({fit_s:.0f}s)")

    # Select deployable model on VALIDATION PR-AUC only.
    cands = [n for n, r in results.items() if r["candidate_for_deployment"]]
    if not cands:
        raise RuntimeError("No deployable candidate models were trained.")
    selected = max(cands, key=lambda n: results[n]["validation"]["pr_auc"])
    return {"split": asdict(split), "scale_pos_weight_train": spw, "results": results,
            "selected_model": selected, "pipelines": pipelines}


def save_artifacts(run: dict[str, Any], dataset_info: dict[str, Any], artifact_dir: Path,
                   report_dir: Path) -> dict[str, str]:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    sel = run["selected_model"]
    sel_res = run["results"][sel]
    fs = sel_res["feature_set"]

    joblib.dump(run["pipelines"][sel], artifact_dir / "pipeline.joblib", compress=3)
    schema = feature_schema(fs)
    (artifact_dir / "feature_schema.json").write_text(json.dumps(schema, indent=2))
    thr = {**sel_res["threshold_selection"], "selected_model": sel,
           "fitted_on": "validation set (chronological)", "feature_set": fs}
    (artifact_dir / "threshold.json").write_text(json.dumps(thr, indent=2))

    metrics = {
        "dataset": dataset_info, "split": run["split"],
        "scale_pos_weight_train": run["scale_pos_weight_train"],
        "selected_model": sel, "models": run["results"],
        "note": "All values computed by ml/train.py from the real dataset. Test metrics were "
                "computed once with thresholds frozen from validation.",
    }
    text = json.dumps(metrics, indent=2)
    (artifact_dir / "metrics.json").write_text(text)
    (report_dir / "metrics.json").write_text(text)
    card = render_model_card(metrics, schema)
    (artifact_dir / "model_card.md").write_text(card)
    (report_dir / "model_card.md").write_text(card)
    return {"artifact_dir": str(artifact_dir), "report_dir": str(report_dir)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=RAW_DATA_PATH)
    ap.add_argument("--artifact-dir", type=Path, default=ARTIFACT_DIR)
    ap.add_argument("--report-dir", type=Path, default=REPORT_DIR)
    args = ap.parse_args(argv)

    try:
        print(f"Loading {args.data} ...")
        df = load_modelling_frame(args.data, raw_columns("with_post_balance"))
        print(f"Loaded {len(df):,} rows, {df.memory_usage(deep=True).sum() / 1e6:.0f} MB in memory")
        run = train_and_evaluate(df)
    except (DataValidationError, ValueError, RuntimeError) as exc:
        print(f"TRAINING STOPPED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    dataset_info = {"path": str(args.data), "sha256": file_sha256(args.data), "rows": int(len(df)),
                    "fraud_rows": int(df[TARGET].sum()), "fraud_prevalence": float(df[TARGET].mean())}
    paths = save_artifacts(run, dataset_info, args.artifact_dir, args.report_dir)
    print(f"Selected model: {run['selected_model']}")
    print(f"Saved: {paths}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
