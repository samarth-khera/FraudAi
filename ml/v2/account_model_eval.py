"""Scenario-grouped evaluation and retraining of the V2 account-behaviour model.

Pipeline (run from the repository root):

    PYTHONPATH=backend:. backend/.venv/bin/python -m ml.v2.scenario_bank        # build data/v2_model_eval
    PYTHONPATH=backend:. backend/.venv/bin/python -m ml.v2.account_model_eval   # evaluate + write artifacts

Methodology:

* Features come from ``AccountFeatureBuilder`` (the serving code), so training and inference match.
* Split is by scenario instance: every account of one planted scenario lands in the same split. Seen
  families are split 60/20/20 into train/validation/test; the unseen families (cyclic round-tripping,
  slow layering) appear in test only. Ordinary accounts are split 60/20/20 by account.
* Model choice and the operating threshold are made on validation only. The threshold maximises F2
  (recall counts twice as much as precision) because every flag goes to a human reviewer and nothing is
  automated. The test split is scored once, after all choices are fixed.
* The existing v2-account-1.0.0 artifact and the rule baseline are scored on the same test accounts.
"""

from __future__ import annotations

import hashlib
import json
import random
import time
from pathlib import Path
from typing import Any, Callable, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
import xgboost as xgb

try:
    from app.services.v2.feature_builder import FEATURE_NAMES
except ModuleNotFoundError:  # pragma: no cover
    from backend.app.services.v2.feature_builder import FEATURE_NAMES

from ml.v2.scenario_bank import EXCLUDED_LABELS, POSITIVE_LABELS, SEEN_FAMILIES, UNSEEN_FAMILIES

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = REPO_ROOT / "data" / "v2_model_eval"
EVAL_DB = EVAL_DIR / "v2_model_eval.db"
DEMO_DB = REPO_ROOT / "data" / "v2_fraudshield.db"
OLD_ARTIFACT_DIR = REPO_ROOT / "ml" / "artifacts" / "v2" / "account_model"
NEW_ARTIFACT_DIR = REPO_ROOT / "ml" / "artifacts" / "v2" / "account_model_v2"
REPORT_PATH = REPO_ROOT / "ml" / "reports" / "account_model_v2_evaluation.json"

NEW_VERSION = "v2-account-2.0.0"
SPLIT_SEED = 7
SPLIT_FRACTIONS = (0.6, 0.2, 0.2)
FAMILY_PREFIX = {
    "SC-APP-LAYERING": "app_layering",
    "SC-SLOW-LAYERING": "slow_layering",
    "SC-FAN-OUT-DISPERSAL": "fan_out_dispersal",
    "SC-STRUCTURING": "structuring",
    "SC-DORMANT-AWAKENING": "dormant_awakening",
    "SC-CYCLIC-ROUNDTRIP": "cyclic_roundtrip",
    "HN-SALARY-QUICK-PAYMENT": "salary_quick_payment",
    "HN-STUDENT-FEE-PAYMENT": "student_fee_payment",
    "HN-LEGIT-DORMANT-REACTIVATION": "legit_dormant_reactivation",
    "HN-MERCHANT-SWEEP": "merchant_sweep",
}


# ---------------------------------------------------------------------------- data
def family_of(scenario_id: Optional[str]) -> str:
    if not isinstance(scenario_id, str) or not scenario_id:
        return "ordinary"
    return FAMILY_PREFIX.get(scenario_id.rsplit("-", 1)[0], "unknown")


def label_target(label: str) -> int:
    return 1 if label in POSITIVE_LABELS else 0


def _stable_unit(key: str, seed: int) -> float:
    """Deterministic pseudo-random number in [0, 1) for a key, independent of row order."""
    h = hashlib.sha256(f"{seed}:{key}".encode()).hexdigest()
    return int(h[:12], 16) / float(16**12)


def assign_splits(df: pd.DataFrame, seed: int = SPLIT_SEED) -> pd.Series:
    """Scenario-grouped split. Every account of a scenario instance shares one split."""
    train_cut, val_cut = SPLIT_FRACTIONS[0], SPLIT_FRACTIONS[0] + SPLIT_FRACTIONS[1]

    def split_for(row) -> str:
        fam = row["family"]
        if fam in UNSEEN_FAMILIES:
            return "test"
        key = row["scenario_id"] if isinstance(row["scenario_id"], str) and row["scenario_id"] else row["account_id"]
        u = _stable_unit(key, seed)
        return "train" if u < train_cut else ("validation" if u < val_cut else "test")

    return df.apply(split_for, axis=1)


def load_features(db_path: Path, cache: Optional[Path] = None) -> pd.DataFrame:
    """Features (serving builder) + rule score + labels for every account in a V2-schema database."""
    if cache and cache.exists() and cache.stat().st_mtime > db_path.stat().st_mtime:
        return pd.read_pickle(cache)
    from ml.v2.train_account_model import build_account_dataset

    df = build_account_dataset(f"sqlite:///{db_path}")
    if cache:
        df.to_pickle(cache)
    return df


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    out = df[~df["ground_truth_label"].isin(EXCLUDED_LABELS)].copy()
    out["target"] = out["ground_truth_label"].map(label_target)
    out["family"] = out["scenario_id"].map(family_of)
    out["split"] = assign_splits(out)
    return out.reset_index(drop=True)


# ---------------------------------------------------------------------------- metrics
def select_threshold(y: np.ndarray, scores: np.ndarray, beta: float = 2.0) -> float:
    """Threshold maximising F-beta on the given (validation) data. Ties go to the higher threshold."""
    best_t, best_f = 0.5, -1.0
    for t in np.unique(np.round(scores, 6)):
        pred = scores >= t
        tp = int((pred & (y == 1)).sum())
        fp = int((pred & (y == 0)).sum())
        fn = int((~pred & (y == 1)).sum())
        if tp == 0:
            continue
        p, r = tp / (tp + fp), tp / (tp + fn)
        f = (1 + beta**2) * p * r / (beta**2 * p + r)
        if f > best_f + 1e-12 or (abs(f - best_f) <= 1e-12 and t > best_t):
            best_t, best_f = float(t), f
    return best_t


def metrics_at(y: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    pred = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    two_classes = len(np.unique(y)) == 2
    return {
        "threshold": round(float(threshold), 4),
        "positives": int(y.sum()),
        "negatives": int(len(y) - y.sum()),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "roc_auc": round(float(roc_auc_score(y, scores)), 4) if two_classes else None,
        "pr_auc": round(float(average_precision_score(y, scores)), 4) if two_classes else None,
        "confusion_matrix": [[int(tn), int(fp)], [int(fn), int(tp)]],
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
        "false_positive_rate": round(fp / (fp + tn), 4) if fp + tn else 0.0,
    }


def bootstrap_ci(y: np.ndarray, scores: np.ndarray, threshold: float, clusters: np.ndarray,
                 n: int = 1000, seed: int = 0) -> dict[str, list[float]]:
    """95% percentile bootstrap intervals, resampling whole clusters (a scenario instance or a single
    ordinary account), because accounts from one scenario are not independent."""
    rng = np.random.default_rng(seed)
    uniq, inverse = np.unique(clusters, return_inverse=True)
    members = [np.flatnonzero(inverse == k) for k in range(len(uniq))]
    rec, prec, ap = [], [], []
    for _ in range(n):
        s = np.concatenate([members[k] for k in rng.integers(0, len(uniq), size=len(uniq))])
        ys, ss = y[s], scores[s]
        if ys.sum() == 0 or ys.sum() == len(ys):
            continue
        pred = ss >= threshold
        tp = (pred & (ys == 1)).sum()
        rec.append(tp / ys.sum())
        prec.append(tp / pred.sum() if pred.sum() else 0.0)
        ap.append(average_precision_score(ys, ss))
    q = lambda v: [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)]
    return {"recall": q(rec), "precision": q(prec), "pr_auc": q(ap), "resampling_unit": "scenario instance or ordinary account"}


def cluster_ids(d: pd.DataFrame) -> np.ndarray:
    return np.where(d["scenario_id"].fillna("").astype(str) != "", d["scenario_id"].fillna("").astype(str), d["account_id"])


def breakdown(df: pd.DataFrame, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    """Recall per positive family and flag rate per negative group (victims, look-alikes, ordinary)."""
    d = df.assign(score=scores, flagged=scores >= threshold)
    out: dict[str, Any] = {}
    for fam, g in d[d.target == 1].groupby("family"):
        out[fam] = {"positives": len(g), "detected": int(g.flagged.sum()), "recall": round(float(g.flagged.mean()), 4)}
    neg = d[d.target == 0]
    neg_group = np.where(neg.ground_truth_label == "compromised_victim", "victims", neg.family)
    for grp, g in neg.groupby(neg_group):
        out[f"negatives:{grp}"] = {"accounts": len(g), "flagged": int(g.flagged.sum()), "flag_rate": round(float(g.flagged.mean()), 4)}
    return out


# ---------------------------------------------------------------------------- models
def xgb_candidates(n_pos: int, n_neg: int) -> list[tuple[str, Callable[[], Any]]]:
    spw = n_neg / max(1, n_pos)
    grid = []
    for depth in (3, 4, 6):
        for n_est in (200, 400):
            for w in (1.0, round(spw ** 0.5, 2)):
                grid.append((f"xgb_d{depth}_n{n_est}_w{w}", lambda d=depth, n=n_est, w=w: xgb.XGBClassifier(
                    n_estimators=n, max_depth=d, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
                    min_child_weight=2, scale_pos_weight=w, random_state=42, n_jobs=4, eval_metric="logloss")))
    return grid


def logistic_baseline() -> Any:
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000))


# ---------------------------------------------------------------------------- run
def run(write_artifacts: bool = True) -> dict[str, Any]:
    t0 = time.time()
    random.seed(0)
    np.random.seed(0)
    df = prepare(load_features(EVAL_DB, EVAL_DIR / "features.pkl"))
    groups_meta = json.loads((EVAL_DIR / "groups.json").read_text())
    tr, va, te = (df[df.split == s] for s in ("train", "validation", "test"))
    X = lambda d: d[FEATURE_NAMES]
    y = lambda d: d["target"].to_numpy()

    split_summary = {
        s: {
            "accounts": int(len(d)),
            "positives": int(d.target.sum()),
            "negatives": int(len(d) - d.target.sum()),
            "scenario_instances": int(d[d.family.isin(SEEN_FAMILIES + UNSEEN_FAMILIES)].scenario_id.nunique()),
            "positives_by_family": {k: int(v) for k, v in d[d.target == 1].family.value_counts().sort_index().items()},
        }
        for s, d in (("train", tr), ("validation", va), ("test", te))
    }

    # 1. Model selection on validation only.
    candidates = []
    for name, make in xgb_candidates(int(tr.target.sum()), int(len(tr) - tr.target.sum())):
        m = make().fit(X(tr), y(tr))
        candidates.append((name, average_precision_score(y(va), m.predict_proba(X(va))[:, 1]), m))
    candidates.sort(key=lambda c: -c[1])
    best_name, best_val_ap, best = candidates[0]
    logit = logistic_baseline().fit(X(tr), y(tr))

    # 2. Thresholds on validation only.
    models = {
        "new_xgboost": lambda d: best.predict_proba(X(d))[:, 1],
        "logistic_regression": lambda d: logit.predict_proba(X(d))[:, 1],
        "rule_baseline": lambda d: d["baseline_rule_score"].to_numpy() / 100.0,
    }
    old = joblib.load(OLD_ARTIFACT_DIR / "model.joblib")
    models["previous_model_v2_account_1_0_0"] = lambda d: old.predict_proba(X(d))[:, 1]
    thresholds = {name: select_threshold(y(va), f(va)) for name, f in models.items()}

    # 3. Locked test: scored once with the fixed choices.
    results: dict[str, Any] = {}
    for name, f in models.items():
        s_val, s_test = f(va), f(te)
        entry = {
            "validation_threshold_f2": round(thresholds[name], 4),
            "validation": metrics_at(y(va), s_val, thresholds[name]),
            "test": metrics_at(y(te), s_test, thresholds[name]),
            "test_ci95": bootstrap_ci(y(te), s_test, thresholds[name], cluster_ids(te)),
            "test_breakdown": breakdown(te, s_test, thresholds[name]),
        }
        if name == "previous_model_v2_account_1_0_0":
            entry["test_at_original_threshold_0_5"] = metrics_at(y(te), s_test, 0.5)
            entry["test_breakdown_at_original_threshold_0_5"] = breakdown(te, s_test, 0.5)
        if name == "rule_baseline":
            entry["test_at_documented_threshold_50"] = metrics_at(y(te), s_test, 0.5)
        results[name] = entry
    seen_te = te[~te.family.isin(UNSEEN_FAMILIES)]
    unseen_te = te[(te.target == 0) | te.family.isin(UNSEEN_FAMILIES)]
    for name, f in models.items():
        results[name]["test_seen_families"] = metrics_at(y(seen_te), f(seen_te), thresholds[name])
        results[name]["test_unseen_families"] = metrics_at(y(unseen_te), f(unseen_te), thresholds[name])
    best_test = models["new_xgboost"](te)
    results["new_xgboost"]["brier_score_test"] = round(float(brier_score_loss(y(te), best_test)), 4)

    # 4. Errors to inspect (account IDs refer to the scenario-bank ledger, not the demo ledger).
    te_scored = te.assign(score=best_test)
    thr = thresholds["new_xgboost"]
    fn = te_scored[(te_scored.target == 1) & (te_scored.score < thr)].sort_values("score")
    fp = te_scored[(te_scored.target == 0) & (te_scored.score >= thr)].sort_values("score", ascending=False)
    cols = ["account_id", "family", "ground_truth_label", "score", "rapid_pass_through", "max_amount", "flow_through_ratio"]
    examples = {
        "false_negatives": fn[cols].head(10).round(4).to_dict("records"),
        "false_positives": fp[cols].head(10).round(4).to_dict("records"),
    }

    # 5. External check on the demo ledger (never used for any choice).
    demo = pd.read_pickle(EVAL_DIR / "demo_features.pkl") if (EVAL_DIR / "demo_features.pkl").exists() else None
    if demo is None and DEMO_DB.exists():
        demo = load_features(DEMO_DB, EVAL_DIR / "demo_features.pkl")
    external = None
    demo_ledger_eval = None
    if demo is not None:
        ids = ["ACC-000001", "ACC-000003", "ACC-000002", "ACC-000005", "ACC-000032"]
        rows = demo[demo.account_id.isin(ids)].set_index("account_id").loc[ids]
        # Whole-ledger check. cashout_terminal labels sit on busy ordinary merchants (a demo-generator
        # label defect, see docs/ACCOUNT_MODEL_AUDIT.md), so they are excluded rather than counted.
        dl = demo[demo.ground_truth_label != "cashout_terminal"]
        dl_y = dl.ground_truth_label.isin(POSITIVE_LABELS).astype(int).to_numpy()
        thr_new = thresholds["new_xgboost"]
        demo_ledger_eval = {
            "note": "Demo ledger (data/v2_fraudshield.db); never used for training, selection or thresholds.",
            "excluded_cashout_terminal_accounts": int((demo.ground_truth_label == "cashout_terminal").sum()),
            "new_model": metrics_at(dl_y, best.predict_proba(dl[FEATURE_NAMES])[:, 1], thr_new),
            "previous_model_at_0_5": metrics_at(dl_y, old.predict_proba(dl[FEATURE_NAMES])[:, 1], 0.5),
            "rule_baseline_at_validation_threshold": metrics_at(dl_y, dl["baseline_rule_score"].to_numpy() / 100.0, thresholds["rule_baseline"]),
        }
        external = {
            acc: {
                "demo_ledger_label": rows.loc[acc, "ground_truth_label"],
                "previous_model": round(float(old.predict_proba(rows.loc[[acc], FEATURE_NAMES])[0, 1]), 4),
                "new_model": round(float(best.predict_proba(rows.loc[[acc], FEATURE_NAMES])[0, 1]), 4),
                "rule_score": float(rows.loc[acc, "baseline_rule_score"]),
            }
            for acc in ids
        }

    importances = pd.Series(best.feature_importances_, index=FEATURE_NAMES).sort_values(ascending=False)
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": {
            "source": "Scenario-bank synthetic ledger (ml/v2/scenario_bank.py)",
            "seed": groups_meta["seed"],
            "accounts_evaluated": int(len(df)),
            "excluded_external_sinks": groups_meta["sink_ids"],
            "positive_definition": sorted(POSITIVE_LABELS),
            "split_seed": SPLIT_SEED,
            "split_fractions": SPLIT_FRACTIONS,
            "unseen_test_only_families": list(UNSEEN_FAMILIES),
        },
        "splits": split_summary,
        "model_selection": {
            "criterion": "validation PR-AUC",
            "selected": best_name,
            "validation_pr_auc": round(float(best_val_ap), 4),
            "candidates": [{"name": n, "validation_pr_auc": round(float(a), 4)} for n, a, _ in candidates],
            "threshold_rule": "maximise F2 on validation (recall weighted twice precision); test not used",
        },
        "results": results,
        "error_examples": examples,
        "external_demo_ledger_check": external,
        "external_demo_ledger_evaluation": demo_ledger_eval,
        "top_feature_importances": {k: round(float(v), 4) for k, v in importances.head(10).items()},
        "elapsed_seconds": round(time.time() - t0, 1),
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str) + "\n")

    if write_artifacts:
        write_model_artifacts(best, best_name, thresholds["new_xgboost"], report)
    return report


def operational_notes(report: dict[str, Any]) -> Optional[dict[str, Any]]:
    """How the model behaves on the app's own (demo) ledger, where suspicious accounts are much rarer."""
    ev = report.get("external_demo_ledger_evaluation")
    if not ev:
        return None
    m = ev["new_model"]
    return {
        "demo_ledger_ordinary_accounts": m["negatives"],
        "demo_ledger_flag_rate_ordinary": m["false_positive_rate"],
        "demo_ledger_positive_accounts": m["positives"],
        "demo_ledger_positives_flagged": m["true_positives"],
        "demo_ledger_precision": m["precision"],
        "note": (
            "On the app's own ledger suspicious accounts are rare (about 0.3%), so most flags are false alarms. "
            "No synthetic scenario places a corporate account, so the model has no evidence about corporate accounts."
        ),
    }


def write_model_artifacts(model: Any, name: str, threshold: float, report: dict[str, Any]) -> None:
    """Writes the new artifact in the layout ml_service.get_model_status already reads."""
    NEW_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, NEW_ARTIFACT_DIR / "model.joblib")
    (NEW_ARTIFACT_DIR / "feature_schema.json").write_text(json.dumps({"features": FEATURE_NAMES}, indent=2) + "\n")
    r = report["results"]["new_xgboost"]
    test = r["test"]
    splits = report["splits"]
    metadata = {
        "model_name": "FraudShield V2 Account-Behaviour Classifier",
        "model_type": "XGBClassifier (Tabular Gradient Boosting)",
        "model_version": NEW_VERSION,
        "previous_version": "v2-account-1.0.0",
        "trained_at": report["generated_at"],
        "dataset_source": "Scenario-bank synthetic ledger (ml/v2/scenario_bank.py, seed %s)" % report["dataset"]["seed"],
        "training_configuration": {"selected_candidate": name, "params": model.get_params()},
        "decision_threshold": round(float(threshold), 4),
        "threshold_selection": report["model_selection"]["threshold_rule"],
        "scenario_split_strategy": {
            "strategy": "Scenario-instance grouped train/validation/test; two families test-only",
            "held_out_test_scenarios": list(UNSEEN_FAMILIES),
            "train_accounts_count": splits["train"]["accounts"],
            "validation_accounts_count": splits["validation"]["accounts"],
            "test_accounts_count": splits["test"]["accounts"],
            "train_suspicious_count": splits["train"]["positives"],
            "validation_suspicious_count": splits["validation"]["positives"],
            "test_suspicious_count": splits["test"]["positives"],
            "test_normal_count": splits["test"]["negatives"],
        },
        "ml_evaluation_metrics": {**test, "ci95": r["test_ci95"]},
        "metrics_by_family": r["test_breakdown"],
        "seen_vs_unseen": {"seen": r["test_seen_families"], "unseen": r["test_unseen_families"]},
        "baseline_comparison": {
            "baseline_name": "Deterministic rule assessor (threshold chosen on validation)",
            "threshold": report["results"]["rule_baseline"]["validation_threshold_f2"] * 100,
            **{k: report["results"]["rule_baseline"]["test"][k] for k in ("precision", "recall", "f1_score", "pr_auc", "roc_auc", "confusion_matrix")},
            "comparison_notes": "Both scored on the same locked test accounts with thresholds chosen on validation.",
        },
        "score_semantics": (
            "Model output is an uncalibrated score between 0 and 1 learned from synthetic labels, shown as a percentage. "
            "It is not a verified probability that an account is fraudulent."
        ),
        "operational_notes": operational_notes(report),
        "top_feature_importances": report["top_feature_importances"],
        "features": list(FEATURE_NAMES),
        "leakage_protections": [
            "ground_truth_label, scenario_id, scenario_tag and is_suspicious_scenario are never model inputs.",
            "PII (names, phone, email, upi_id, tax_id) is never a model input.",
            "Scenario accounts keep their generated opening balance; amounts are derived from funds actually received.",
            "Every account of a scenario instance is in exactly one split; two scenario families are test-only.",
            "Model choice and threshold use validation data only; the test split is scored once.",
        ],
        "evaluation_report": "ml/reports/account_model_v2_evaluation.json",
        "disclaimer": (
            "Decision support only. Trained and evaluated exclusively on synthetic scenarios. A high score is not "
            "proof of wrongdoing and a low score does not clear an account."
        ),
    }
    (NEW_ARTIFACT_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2, default=str) + "\n")


if __name__ == "__main__":
    rep = run()
    for name, r in rep["results"].items():
        t = r["test"]
        print(f"{name:34s} thr={r['validation_threshold_f2']:.3f}  test P={t['precision']:.3f} R={t['recall']:.3f} "
              f"F1={t['f1_score']:.3f} PR-AUC={t['pr_auc']} ROC={t['roc_auc']}  cm={t['confusion_matrix']}")
