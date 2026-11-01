"""Model A: transaction-level risk at decision time, trained on the forensic scenario ledgers.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.train_transaction_model

Splits
* Ledger "train" (seed 101): days 0-83 train, 84-101 validation, 102-119 temporal test. Features for every row use
  each party's full earlier history, which is available at decision time whatever the split.
* Ledger "cold" (seed 202): a different population with disjoint account IDs and three held-out scenario variants.
  Scored once, after every choice is fixed. It is the cold-account test.
* Ledger "demo" (seed 303): the ledger served by the app, also unseen; reported once as a served-data check.

Selection uses validation PR-AUC only. The threshold is the lowest validation threshold with precision >= 50%.
It is stored exactly in metadata threshold.value (threshold.display_value is the 6-decimal rounding, display only).
Bootstrap intervals on test splits resample whole scenario instances (a scenario's transfers are not independent).
s_history_days / r_history_days are left out of the training-range check (modeling.RANGE_CHECK_EXCLUDED).
Results go to ml/reports/transaction_model_v3.json; the selected model to ml/artifacts/v3/transaction_model/.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.intelligence import models as served
from backend.app.intelligence.features import FEATURE_SCHEMA_VERSION, FORBIDDEN_INPUTS, TXN_FEATURES, transaction_features
from backend.app.intelligence.schema import validate_transactions
from ml.forensics.adapters import forensic_frame
from ml.forensics.evaluation import bootstrap_pr_auc, metrics, pick_threshold, reliability, threshold_record
from ml.forensics.generator import GENERATOR_VERSION, HELD_OUT_VARIANTS, LEDGERS, generate_ledger
from ml.forensics.modeling import (
    RANGE_CHECK_EXCLUDED, SEED, choose_calibration, environment, export, feature_importance, fit_forest, fit_logistic,
    fit_xgb, quick, training_ranges, undersample,
)

OUT = Path("ml/artifacts/v3/transaction_model")
REPORT = Path("ml/reports/transaction_model_v3.json")
TRAIN_END_DAY, VAL_END_DAY = 84, 102
PRECISION_TARGET = 0.5


def load(name: str):
    L = generate_ledger(name)
    df, rep = validate_transactions(forensic_frame(L))
    X = transaction_features(df)
    return L, df.reset_index(drop=True), X.reset_index(drop=True), rep


def leakage_audit(X: pd.DataFrame, y: np.ndarray) -> dict:
    from sklearn.metrics import roc_auc_score

    bad = sorted(set(X.columns) & FORBIDDEN_INPUTS)
    single = {}
    for c in X.columns:
        v = X[c].fillna(X[c].median() if X[c].notna().any() else 0).to_numpy()
        if np.unique(v).size > 1:
            a = roc_auc_score(y, v)
            single[c] = round(max(a, 1 - a), 4)
    top = dict(sorted(single.items(), key=lambda kv: -kv[1])[:8])
    return {"forbidden_columns_in_features": bad, "single_feature_roc_auc_top": top,
            "proxy_alert": [c for c, a in single.items() if a >= 0.98],
            "note": "A single feature separating the classes almost perfectly would suggest a label proxy. "
                    "None is >= 0.98 unless listed in proxy_alert."}


def segments(df: pd.DataFrame, X: pd.DataFrame, y, p, thr, accounts: pd.DataFrame) -> dict:
    ctype = df["sender_account_id"].map(accounts.set_index("account_id")["customer_type"])
    hist = np.expm1(X["s_prior_out_n"].to_numpy())
    hour = pd.to_datetime(df["timestamp"]).dt.hour.to_numpy()
    slices = {
        "channel": df["channel"].to_numpy(),
        "sender_prior_outgoing": np.where(hist == 0, "none", np.where(hist < 5, "1-4", "5+")),
        "amount_band": pd.cut(df["amount"], [0, 5000, 25000, 100000, np.inf], labels=["<5k", "5k-25k", "25k-100k", ">=100k"]).astype(str).to_numpy(),
        "sender_customer_type (slice only, not a feature)": ctype.fillna("unknown").to_numpy(),
        "time_of_day": np.where(hour < 5, "00-05", "05-24"),
    }
    out = {}
    for name, s in slices.items():
        rows = {}
        for v in pd.unique(s):
            m = s == v
            yy, pp = y[m], p[m]
            pred = pp >= thr
            tp, fp = int((pred & (yy == 1)).sum()), int((pred & (yy == 0)).sum())
            rows[str(v)] = {"n": int(m.sum()), "positives": int(yy.sum()), "flagged": int(pred.sum()),
                            "recall": round(tp / yy.sum(), 4) if yy.sum() else None,
                            "precision": round(tp / pred.sum(), 4) if pred.sum() else None,
                            "false_positive_rate": round(fp / max((yy == 0).sum(), 1), 6)}
        out[name] = rows
    return out


def errors(df: pd.DataFrame, y, p, thr, ledger) -> dict:
    tags = ledger.transactions.set_index("transaction_id")["scenario_tag"]
    t = df["transaction_id"].map(tags).fillna("unknown").to_numpy()
    pred = p >= thr
    scen = ledger.scenarios.set_index("scenario_id") if len(ledger.scenarios) else None
    fn_mask = (~pred) & (y == 1)
    fn_pattern = df.loc[fn_mask, "scenario_id"].map(scen["pattern"]) if scen is not None else pd.Series(dtype=str)
    pos_pattern = df.loc[y == 1, "scenario_id"].map(scen["pattern"]) if scen is not None else pd.Series(dtype=str)
    return {
        "false_positives_by_ordinary_activity": pd.Series(t[pred & (y == 0)]).value_counts().to_dict(),
        "false_negatives_by_scenario_step": pd.Series(t[fn_mask]).value_counts().to_dict(),
        "recall_by_pattern": {k: round(1 - fn_pattern.value_counts().get(k, 0) / v, 4) for k, v in pos_pattern.value_counts().items()},
    }


def variant_split(df: pd.DataFrame, ledger) -> np.ndarray:
    held = ledger.scenarios.set_index("scenario_id")["held_out"]
    return df["scenario_id"].map(held).fillna(False).astype(bool).to_numpy()


def main() -> dict:
    t_start = time.perf_counter()
    report: dict = {"model": "transaction_model", "feature_schema_version": FEATURE_SCHEMA_VERSION,
                    "generator_version": GENERATOR_VERSION, "environment": environment()}
    LA, A, XA, repA = load("train")
    LB, B, XB, repB = load("cold")
    LC, C, XC, repC = load("demo")
    report["validation"] = {"train_ledger": repA.as_dict(), "cold_ledger": repB.as_dict(), "demo_ledger": repC.as_dict()}

    day = (A["timestamp"] - A["timestamp"].min()).dt.days.to_numpy()
    tr, va, te = day < TRAIN_END_DAY, (day >= TRAIN_END_DAY) & (day < VAL_END_DAY), day >= VAL_END_DAY
    yA, yB, yC = A["label"].to_numpy(), B["label"].to_numpy(), C["label"].to_numpy()
    accounts_train = set(A.loc[tr, "sender_account_id"]) | set(A.loc[tr, "receiver_account_id"])
    accounts_cold = set(B["sender_account_id"]) | set(B["receiver_account_id"])
    first_seen_test = ~A.loc[te, "sender_account_id"].isin(accounts_train).to_numpy()
    report["splits"] = {
        "temporal": {k: {"rows": int(m.sum()), "positives": int(yA[m].sum()),
                         "days": f"{d[0]}-{d[1]}"} for k, m, d in (("train", tr, (0, TRAIN_END_DAY - 1)),
                                                                   ("validation", va, (TRAIN_END_DAY, VAL_END_DAY - 1)),
                                                                   ("test", te, (VAL_END_DAY, LEDGERS["train"].days - 1)))},
        "cold_ledger": {"rows": len(B), "positives": int(yB.sum()), "accounts": len(accounts_cold),
                        "accounts_shared_with_training_ledger": len(accounts_cold & (set(A["sender_account_id"]) | set(A["receiver_account_id"]))),
                        "held_out_variants": HELD_OUT_VARIANTS},
        "temporal_test_rows_with_sender_unseen_in_training_period": int(first_seen_test.sum()),
        "scenario_instances_with_positives": {k: int(A.loc[m & (yA == 1), "scenario_id"].nunique()) for k, m in
                                              (("train", tr), ("validation", va), ("test", te))},
        "cold_ledger_scenario_instances_with_positives": int(B.loc[yB == 1, "scenario_id"].nunique()),
    }
    report["leakage_audit"] = leakage_audit(XA[tr], yA[tr])
    assert not report["leakage_audit"]["forbidden_columns_in_features"], "identifier or label columns in features"

    feats = TXN_FEATURES
    Xtr, Xva = XA[tr], XA[va]
    ytr, yva = yA[tr], yA[va]
    spw = float((ytr == 0).sum() / max(ytr.sum(), 1))
    candidates = []
    for C_ in (0.01, 0.1, 1.0):
        candidates.append(fit_logistic(Xtr, ytr, C_, feats))
    for depth, leaf in ((8, 20), (14, 5), (None, 10)):
        candidates.append(fit_forest(Xtr, ytr, depth, leaf, feats))
    grid = [{"max_depth": d, "min_child_weight": m, "lambda": l, "alpha": a, "scale_pos_weight": round(np.sqrt(spw), 2)}
            for d in (3, 5) for m in (1, 10) for l, a in ((1, 0), (10, 1))]
    for g in grid:
        candidates.append(fit_xgb(Xtr, ytr, Xva, yva, g, feats))
    rows = []
    for c in candidates:
        ptr, pva = c.predict(Xtr), c.predict(Xva)
        rows.append({"family": c.family, "params": {k: v for k, v in c.params.items() if k not in ("objective", "eval_metric", "nthread", "tree_method", "seed")},
                     "best_iteration": c.best_iteration, "train": quick(ytr, ptr), "validation": quick(yva, pva),
                     "train_seconds": round(c.train_seconds, 1)})
    report["candidates"] = rows
    best_i = int(np.nanargmax([r["validation"]["pr_auc"] for r in rows]))
    best = candidates[best_i]

    # Imbalance strategies, compared on validation for the selected family/config only.
    imb = []
    if best.family == "xgboost":
        base = {k: v for k, v in best.params.items() if k in ("max_depth", "min_child_weight", "lambda", "alpha")}
        for label, extra, Xs, ys in (
            ("no reweighting", {"scale_pos_weight": 1.0}, Xtr, ytr),
            ("scale_pos_weight = sqrt(neg/pos)", {"scale_pos_weight": round(np.sqrt(spw), 2)}, Xtr, ytr),
            ("scale_pos_weight = neg/pos", {"scale_pos_weight": round(spw, 1)}, Xtr, ytr),
            ("random undersampling 20:1 (train only)", {"scale_pos_weight": 1.0}, *undersample(Xtr, ytr, 20)),
        ):
            f = fit_xgb(Xs, ys, Xva, yva, {**base, **extra}, feats)
            imb.append({"strategy": label, "validation": quick(yva, f.predict(Xva)), "fitted": f})
        best_imb = max(imb, key=lambda r: r["validation"]["pr_auc"])
        best = best_imb["fitted"]
    report["imbalance_comparison"] = [{k: v for k, v in r.items() if k != "fitted"} for r in imb]
    report["imbalance_note"] = ("SMOTE was not used: most features are counts, flags and one-hot channels, so "
                                "interpolated synthetic rows would not be valid transactions. Resampling, when compared, "
                                "was applied to the training split only; validation and test keep their real prevalence.")
    report["selected"] = {"family": best.family, "params": {k: v for k, v in best.params.items() if k not in ("nthread", "tree_method")},
                          "best_iteration": best.best_iteration, "selection_rule": "highest validation PR-AUC"}

    # Learning curve (selected configuration, stratified subsamples of the training split).
    lc = []
    rng = np.random.default_rng(SEED)
    for frac in (0.1, 0.25, 0.5, 1.0):
        pos, neg = np.where(ytr == 1)[0], np.where(ytr == 0)[0]
        idx = np.sort(np.concatenate([rng.choice(pos, max(1, int(len(pos) * frac)), replace=False),
                                      rng.choice(neg, int(len(neg) * frac), replace=False)]))
        if best.family == "xgboost":
            f = fit_xgb(Xtr.iloc[idx], ytr[idx], Xva, yva, {k: best.params[k] for k in ("max_depth", "min_child_weight", "lambda", "alpha", "scale_pos_weight")}, feats)
        elif best.family == "random_forest":
            f = fit_forest(Xtr.iloc[idx], ytr[idx], best.params["max_depth"], best.params["min_samples_leaf"], feats)
        else:
            f = fit_logistic(Xtr.iloc[idx], ytr[idx], best.params["C"], feats)
        lc.append({"train_fraction": frac, "train_positives": int(ytr[idx].sum()),
                   "train_pr_auc": quick(ytr[idx], f.predict(Xtr.iloc[idx]))["pr_auc"], "validation_pr_auc": quick(yva, f.predict(Xva))["pr_auc"]})
    report["learning_curve"] = lc

    # Calibration and threshold: validation only.
    raw_va = best.predict(Xva)
    cal = choose_calibration(yva, raw_va, A.loc[va, "timestamp"].to_numpy().astype("int64"))
    tmp_meta = {"model_version": "tmp", "threshold": {"value": 0.5, "on": "calibrated"}, "calibration": cal, "features": feats}
    cal_va = served.ScoringModel("tmp", tmp_meta, feats).calibrated(raw_va)
    thr, rule = pick_threshold(yva, cal_va, PRECISION_TARGET)

    meta = {
        "model_version": "v3-transaction-1.0.0", "model": "transaction_model", "family": best.family,
        "feature_schema_version": FEATURE_SCHEMA_VERSION, "generator_version": GENERATOR_VERSION,
        "dataset": {"source": "forensic-scenarios (synthetic, this repository)", "train_ledger_seed": LEDGERS["train"].seed,
                    "train_days": f"0-{TRAIN_END_DAY - 1}", "validation_days": f"{TRAIN_END_DAY}-{VAL_END_DAY - 1}"},
        "label_definition": "Transfer is a step of a planted scenario flow (victim transfer, forwarding, cash-out, takeover "
                            "transfer, secondary-victim drain). Incidental purchases from scam money are not positives.",
        "decision_time": "Uses only the two parties' transfers strictly before the transfer's timestamp.",
        "calibration": cal,
        "threshold": threshold_record(thr, rule, yva, cal_va),  # exact float; see evaluation.threshold_record
        "training_ranges": training_ranges(Xtr, feats),
        "training_ranges_excluded": {f: why for f, why in RANGE_CHECK_EXCLUDED.items() if f in feats},
        "environment": environment(), "params": report["selected"]["params"],
    }
    tmp = served.ScoringModel("tmp", {**meta, "features": feats}, feats)
    tmp._booster = best.model if best.family == "xgboost" else None

    def scores(X):
        r = best.predict(X)
        return r, tmp.calibrated(r)

    out = {}
    for split, X, y, extra in (("train", Xtr, ytr, None), ("validation", Xva, yva, None), ("temporal_test", XA[te], yA[te], A[te]),
                               ("cold_ledger_test", XB, yB, B), ("served_demo_ledger", XC, yC, C)):
        raw, calp = scores(X)
        m = metrics(y, calp, thr, split)
        m["raw_score_pr_auc"] = quick(y, raw)["pr_auc"]
        out[split] = m
    report["results"] = out
    raw_te, cal_te = scores(XA[te])
    # Rows of one scenario instance are not independent: resample whole instances (other rows stay single groups).
    te_groups = A.loc[te, "scenario_id"].fillna(A.loc[te, "transaction_id"]).to_numpy()
    report["results"]["temporal_test"]["pr_auc_95ci_bootstrap_by_scenario"] = bootstrap_pr_auc(yA[te], cal_te, groups=te_groups)
    report["results"]["temporal_test"]["scenario_instances_with_positives"] = int(A.loc[te & (yA == 1), "scenario_id"].nunique())
    report["results"]["temporal_test_cold_senders"] = metrics(yA[te][first_seen_test], cal_te[first_seen_test], thr,
                                                              "temporal test, senders with no training-period records")
    raw_b, cal_b = scores(XB)
    held = variant_split(B, LB)
    report["results"]["cold_ledger_test"]["pr_auc_95ci_bootstrap_by_scenario"] = bootstrap_pr_auc(
        yB, cal_b, groups=B["scenario_id"].fillna(B["transaction_id"]).to_numpy())
    report["results"]["cold_seen_variants"] = metrics(yB[~held], cal_b[~held], thr, "cold ledger, seen variants + ordinary")
    report["results"]["cold_held_out_variants_recall"] = {
        v: round(float((cal_b[(B["scenario_id"].map(LB.scenarios.set_index("scenario_id")["pattern"] + ":" + LB.scenarios.set_index("scenario_id")["variant"]) == v).to_numpy() & (yB == 1)] >= thr).mean()), 4)
        for v in HELD_OUT_VARIANTS}
    report["calibration_curve_cold"] = reliability(yB, cal_b)
    report["segments_cold"] = segments(B, XB, yB, cal_b, thr, LB.accounts)
    report["errors_cold"] = errors(B, yB, cal_b, thr, LB)
    report["errors_temporal_test"] = errors(A[te], yA[te], cal_te, thr, LA)
    report["feature_importance"] = feature_importance(best)

    # Ablations on validation: how much rests on balance-drain and channel information.
    abl = {}
    for name, drop in (("without amount_to_sender_balance", ["amount_to_sender_balance"]),
                       ("without channel one-hots", [f for f in feats if f.startswith("ch_")]),
                       ("without time-of-day", ["hour_sin", "hour_cos", "is_weekend"])):
        keep = [f for f in feats if f not in drop]
        if best.family == "xgboost":
            f = fit_xgb(Xtr, ytr, Xva, yva, {k: best.params[k] for k in ("max_depth", "min_child_weight", "lambda", "alpha", "scale_pos_weight")}, keep)
            abl[name] = quick(yva, f.predict(Xva))
    report["ablation_validation"] = abl

    # Overfitting / underfitting reading
    g = out["train"]["pr_auc"] - out["validation"]["pr_auc"]
    report["fit_diagnosis"] = {
        "train_minus_validation_pr_auc": round(g, 4),
        "validation_minus_temporal_test_pr_auc": round(out["validation"]["pr_auc"] - out["temporal_test"]["pr_auc"], 4),
        "reading": ("Training PR-AUC well above validation indicates overfitting" if g > 0.15 else
                    "Train and validation PR-AUC are close; no strong overfitting signal") +
                   "; see learning_curve for whether more data still helps (underfitting would show low train PR-AUC).",
    }

    meta["metrics"] = {k: {kk: v[kk] for kk in ("n", "positives", "precision", "recall", "pr_auc", "roc_auc", "brier", "ece", "confusion_matrix")}
                       for k, v in out.items() if isinstance(v, dict) and "n" in v}
    meta["feature_importance"] = report["feature_importance"]
    exported = export(best, OUT, meta)
    served.clear_cache()
    loaded = served.load("transaction_model", OUT.parent)
    t0 = time.perf_counter()
    chk = loaded.score(XB.iloc[:5000])
    report["artifact"] = {
        "path": str(OUT), "format": exported["format"],
        "size_bytes": sum(p.stat().st_size for p in OUT.iterdir()),
        "reload_matches_training_scores": bool(np.allclose(chk["model_score"].to_numpy(), scores(XB.iloc[:5000])[0], atol=1e-6)),
        "inference_ms_per_1000_rows": round((time.perf_counter() - t0) * 1000 / 5, 2),
    }
    report["runtime_seconds"] = round(time.perf_counter() - t_start, 1)
    REPORT.write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    r = main()
    print(json.dumps({k: r[k] for k in ("selected", "results", "artifact", "fit_diagnosis")}, indent=1, default=str)[:6000])
