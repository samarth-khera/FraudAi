"""Model A on PaySim: a source-specific evaluation of the same point-in-time feature code on a public dataset.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.paysim_transaction_model

PaySim is not served by the app and its model is never applied to FraudShield ledgers: its transaction types,
balances and label definition differ (docs/DYNAMIC_INTELLIGENCE.md). What this measures:
* how the decision-time features behave on independent synthetic data with real class imbalance (0.13%),
* how much PaySim's fraud label rests on one simulator mechanic (fraud transfers empty the sender's balance),
* that PaySim cannot support per-sender history (99.85% of senders appear once).

Split: chronological by whole steps (hours), cut at 70% / 85% of rows. Only TRANSFER and CASH_OUT rows are scored,
because PaySim has no fraud label on any other type (a model would learn the type, not behaviour); every row still
contributes history. isFlaggedFraud and post-transaction balances are never features. No resampling of validation or
test. Imbalance handling, training split only: logistic regression and the random forest are fitted on a 20:1
undersample of the training split (20 negatives per positive) and are also class-weighted (class_weight "balanced" /
"balanced_subsample"); XGBoost is fitted on the full training split with scale_pos_weight = sqrt(neg/pos).

is_weekend is not used: PaySim's ``step`` is an hour index with no calendar date, so "weekend" would only reflect the
arbitrary base date chosen in the adapter (adapters.PAYSIM_BASE), not behaviour. Channel one-hots are not used either
(PaySim has no channel), nor the types that never carry a fraud label.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.intelligence.features import FORBIDDEN_INPUTS, TXN_FEATURES, transaction_features
from backend.app.intelligence.schema import validate_transactions
from ml.forensics.adapters import PAYSIM_FILE, paysim, sha256
from ml.forensics.evaluation import metrics, pick_threshold, reliability
from ml.forensics.modeling import environment, feature_importance, fit_forest, fit_logistic, fit_xgb, quick, undersample

REPORT = Path("ml/reports/paysim_transaction_model.json")
EXCLUDED_FEATURES = {
    "type_PAYMENT": "never fraud-labelled in PaySim; not scored", "type_CASH_IN": "never fraud-labelled in PaySim; not scored",
    "type_DEBIT": "never fraud-labelled in PaySim; not scored",
    "is_weekend": "PaySim steps have no calendar date; weekday would come from the adapter's arbitrary base date",
}


def main() -> dict:
    t0 = time.perf_counter()
    rep: dict = {"dataset": {"name": "PaySim (Kaggle ealaxi/paysim1)", "license": "CC BY-SA 4.0",
                             "file": str(PAYSIM_FILE), "sha256": sha256(PAYSIM_FILE)}, "environment": environment()}
    df = paysim()
    norm_cols = [c for c in df.columns if c not in ("label", "source_flag", "post_sender_balance", "step")]
    _, vrep = validate_transactions(df[norm_cols])
    rep["validation"] = vrep.as_dict()
    s = df["sender_account_id"].value_counts()
    rep["account_history_profile"] = {
        "senders": int(len(s)), "senders_appearing_once_share": round(float((s == 1).mean()), 5),
        "receivers": int(df["receiver_account_id"].nunique()),
        "fraud_rows_where_amount_equals_sender_balance": round(float(np.isclose(df.loc[df.label == 1, "amount"], df.loc[df.label == 1, "sender_balance_before"]).mean()), 4),
        "non_fraud_rows_where_amount_equals_sender_balance": round(float(np.isclose(df.loc[df.label == 0, "amount"], df.loc[df.label == 0, "sender_balance_before"]).mean()), 6),
        "fraud_by_type": df.groupby("transaction_type")["label"].sum().astype(int).to_dict(),
    }
    X = transaction_features(df[norm_cols])
    assert not (set(X.columns) & FORBIDDEN_INPUTS)
    scored = df["transaction_type"].isin(["TRANSFER", "CASH_OUT"]).to_numpy()
    step = df["step"].to_numpy()
    cum = np.cumsum(np.bincount(step)) / len(step)
    s_tr, s_va = int(np.searchsorted(cum, 0.70)), int(np.searchsorted(cum, 0.85))
    tr, va, te = scored & (step <= s_tr), scored & (step > s_tr) & (step <= s_va), scored & (step > s_va)
    y = df["label"].to_numpy()
    rep["splits"] = {n: {"steps": st, "rows": int(m.sum()), "positives": int(y[m].sum()), "prevalence": round(float(y[m].mean()), 5)}
                     for n, m, st in (("train", tr, f"1-{s_tr}"), ("validation", va, f"{s_tr + 1}-{s_va}"), ("test", te, f"{s_va + 1}-743"))}
    rx_tr = set(df.loc[tr, "receiver_account_id"])
    rep["splits"]["test_senders_seen_in_train"] = int(df.loc[te, "sender_account_id"].isin(set(df.loc[tr, "sender_account_id"])).sum())
    rep["splits"]["test_receivers_seen_in_train_share"] = round(float(df.loc[te, "receiver_account_id"].isin(rx_tr).mean()), 4)

    feats_all = [f for f in TXN_FEATURES if not f.startswith("ch_") and f not in EXCLUDED_FEATURES]
    rep["excluded_features"] = {"channel one-hots": "PaySim has no channel", **EXCLUDED_FEATURES}
    feats_no_drain = [f for f in feats_all if f not in ("amount_to_sender_balance", "sender_balance_missing")]
    Xtr, Xva, Xte, ytr, yva, yte = X[tr], X[va], X[te], y[tr], y[va], y[te]
    spw = float((ytr == 0).sum() / ytr.sum())
    out = {}
    for name, feats in (("decision_time_features", feats_all), ("without_balance_drain_ratio", feats_no_drain)):
        Xu, yu = undersample(Xtr, ytr, 20)
        cands = [fit_logistic(Xu, yu, 0.1, feats), fit_forest(Xu, yu, 12, 5, feats),
                 fit_xgb(Xtr, ytr, Xva, yva, {"max_depth": 5, "min_child_weight": 5, "lambda": 5, "alpha": 1,
                                              "scale_pos_weight": round(np.sqrt(spw), 2)}, feats)]
        rows = [{"family": c.family, "train_rows": int(len(yu) if c.family != "xgboost" else len(ytr)),
                 "imbalance": ("full training split, scale_pos_weight" if c.family == "xgboost"
                               else "20:1 undersampled training split + class weights"),
                 "validation": quick(yva, c.predict(Xva)), "train": quick(yu if c.family != "xgboost" else ytr, c.predict(Xu if c.family != "xgboost" else Xtr))}
                for c in cands]
        bi = int(np.argmax([r["validation"]["pr_auc"] for r in rows]))
        best = cands[bi]
        pva = best.predict(Xva)
        thr, rule = pick_threshold(yva, pva, 0.5)
        pte = best.predict(Xte)
        out[name] = {"candidates": rows, "selected": best.family, "threshold": {"value": thr, "rule": rule, "on": "uncalibrated score"},
                     "validation": metrics(yva, pva, thr, "validation"), "test": metrics(yte, pte, thr, "test (scored once)"),
                     "calibration_curve_test": reliability(yte, pte), "feature_importance": feature_importance(best)}
    rep["results"] = out
    rep["reading"] = ("PaySim fraud is generated by emptying the sender's balance, so the balance-drain ratio nearly "
                      "determines the label; the second feature set shows performance without it. Near-perfect PaySim "
                      "scores describe the simulator, not real-world detection.")
    rep["runtime_seconds"] = round(time.perf_counter() - t0, 1)
    REPORT.write_text(json.dumps(rep, indent=2, default=str))
    return rep


if __name__ == "__main__":  # pragma: no cover
    r = main()
    print(json.dumps({k: r[k] for k in ("account_history_profile", "splits")}, indent=1))
    for k, v in r["results"].items():
        print(k, v["selected"], {kk: v["test"][kk] for kk in ("precision", "recall", "pr_auc", "roc_auc", "confusion_matrix", "positives")})
