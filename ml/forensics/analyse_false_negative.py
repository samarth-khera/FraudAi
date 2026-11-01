"""Why scenario 4's victim transfer was missed, and what the alternative threshold would cost. Analysis only.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.analyse_false_negative

Case: served forensic ledger (data/v3_forensic_scenarios.db, generator seed 303), victim FS-03BDFF00 of
SC-MULTI-VICTIM-0041, scenario transfer TX-303-0064858. It scored below the transaction model's validation-selected
threshold, so the model did not flag it.

What this script does (and does not do)
* Nothing here changes a model, a threshold, a rule or a served artifact. The served threshold stays the one chosen on
  the validation split (lowest validation threshold with precision >= 50%).
* (1) Recomputes the transfer's point-in-time features exactly as the engine does (engine step 3: the account's and its
  counterparties' histories -> features.transaction_features), scores them with the served model and breaks the score
  down with TreeSHAP (explain.contributions). Compared with the median flagged victim transfer.
* (2) Re-runs the fixed rules (investigation.compute_flags) and shows each rule's condition for this transfer, then
  runs the engine as served to show what seeded the trace.
* (3) Threshold trade-off. Every operating-point figure used for a choice is on the VALIDATION split (train ledger days
  84-101). Cold-ledger and served-ledger figures are POST-HOC: computed after the fact, for information only, and not
  used to select anything. The served ledger engine re-run with a lowered threshold is a post-hoc counterfactual too.
* (4) How often the failure mode happens: victim transfers missed on the cold ledger (post-hoc) and on validation.

Ground truth (data/v3_forensic/*/transactions.csv, scenarios.csv) is read here, by the evaluator, only to label and
group rows. It is never passed to backend inference code. All data is synthetic; nothing here measures real-world
accuracy. Writes ml/reports/scenario4_false_negative.json.
"""

from __future__ import annotations

import atexit
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


def _isolate_case_database() -> None:
    """Point the app's case database at a throwaway file so the engine run never writes into backend/fraudshield.db."""
    if "app.db.session" in sys.modules:
        return
    fd, path = tempfile.mkstemp(prefix="fraudshield_fn_", suffix=".db")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    atexit.register(lambda: os.path.exists(path) and os.remove(path))


_isolate_case_database()

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import xgboost as xgb  # noqa: E402
from sqlalchemy import or_, select  # noqa: E402

from app.db.v2.models import TransactionModel  # noqa: E402
from backend.app.intelligence import engine as engine_module  # noqa: E402
from app.intelligence import explain, ledger  # noqa: E402
from app.intelligence import models as mdl  # noqa: E402
from backend.app.intelligence.datasets import DatasetRegistry  # noqa: E402
from app.intelligence.features import TXN_FEATURES, transaction_features  # noqa: E402
from app.intelligence.schema import validate_transactions  # noqa: E402
from app.services.v2 import investigation as inv  # noqa: E402
from ml.forensics.adapters import forensic_frame  # noqa: E402
from ml.forensics.evaluate_investigations import run as run_engine  # noqa: E402
from ml.forensics.evaluation import pick_threshold  # noqa: E402
from ml.forensics.generator import LEDGERS  # noqa: E402

TX_ID = "TX-303-0064858"
VICTIM = "FS-03BDFF00"
SCENARIO = "SC-MULTI-VICTIM-0041"
DB_FILE = ROOT / "data" / "v3_forensic_scenarios.db"
GT = ROOT / "data" / "v3_forensic"
ARTIFACT = ROOT / "ml" / "artifacts" / "v3" / "transaction_model"
REPORT = ROOT / "ml" / "reports" / "scenario4_false_negative.json"
TRAIN_END_DAY, VAL_END_DAY = 84, 102  # as ml/forensics/train_transaction_model.py
KEY_FEATURES = ["log_amount", "amount_to_sender_balance", "s_history_days", "s_prior_out_n", "s_prior_in_n",
                "s_amount_vs_prior_max", "s_amount_z", "s_distinct_recipients", "s_hours_since_last_out",
                "s_in_24h_to_amount", "s_minutes_since_last_in", "first_time_pair", "pair_prior_n", "r_prior_in_n",
                "r_prior_out_n", "r_history_days", "r_distinct_senders", "r_in_n_24h", "r_balance_before_log",
                "hour_sin", "hour_cos"]


def r6(x) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 6)


# ---------------------------------------------------------------- data (evaluator side)
def load_ledger(name: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Ground-truth CSV -> (normalized frame with label/scenario_id/scenario_tag/pattern/variant, features, scenarios)."""
    raw = pd.read_csv(GT / name / "transactions.csv", dtype={"scenario_id": "string", "scenario_tag": "string"})
    raw["is_suspicious_scenario"] = raw["is_suspicious_scenario"].astype(str).str.lower().eq("true")
    raw["timestamp"] = pd.to_datetime(raw["timestamp"], format="ISO8601", utc=True)
    df = forensic_frame(SimpleNamespace(transactions=raw, config=SimpleNamespace(seed=LEDGERS[name].seed)))
    df, _ = validate_transactions(df)
    df = df.reset_index(drop=True)
    tags = raw.set_index("transaction_id")["scenario_tag"]
    scen = pd.read_csv(GT / name / "scenarios.csv").set_index("scenario_id")
    df["scenario_tag"] = df["transaction_id"].map(tags).fillna("unknown").astype(str)
    df["pattern"] = df["scenario_id"].map(scen["pattern"])
    df["variant"] = df["scenario_id"].map(scen["variant"])
    X = transaction_features(df).reset_index(drop=True)
    return df, X, scen


def counts_at(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    pred = p >= thr
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    fn, neg = int(((~pred) & (y == 1)).sum()), int((y == 0).sum())
    return {"threshold": r6(thr), "flagged": int(pred.sum()), "tp": tp, "fp": fp, "fn": fn,
            "precision": round(tp / (tp + fp), 4) if tp + fp else None, "recall": round(tp / max(tp + fn, 1), 4),
            "false_positive_rate": round(fp / max(neg, 1), 6)}


def profile(X: pd.DataFrame) -> dict:
    """Median (and 25th/75th percentile) of the key features, decoded where a log1p count is easier to read."""
    out = {"n": int(len(X))}
    if not len(X):
        return out
    for f in KEY_FEATURES:
        v = X[f].dropna()
        out[f] = None if not len(v) else {"median": r6(v.median()), "p25": r6(v.quantile(0.25)), "p75": r6(v.quantile(0.75))}
    return out


# ---------------------------------------------------------------- (1) the transfer itself
def served_features(reg: DatasetRegistry) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Engine step 3, verbatim: the account's history plus its counterparties' histories, then point-in-time features."""
    db = reg.open("forensic-scenarios")
    try:
        ds = reg.describe("forensic-scenarios", db)["source_kind"]
        root_hist = ledger.account_history(db, [VICTIM], ds)
        local = ledger.account_history(db, {VICTIM} | ledger.counterparties(root_hist, [VICTIM]), ds)
        root_rows = local.index[(local.sender_account_id == VICTIM) | (local.receiver_account_id == VICTIM)]
        return local, transaction_features(local, root_rows)
    finally:
        db.close()


def bias_and_margin(tm: mdl.ScoringModel, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    c = tm._booster.predict(xgb.DMatrix(X[tm.features].astype(float).to_numpy(), feature_names=tm.features, missing=np.nan),
                            pred_contribs=True)
    return c[:, -1], c.sum(axis=1)


def raw_needed(tm: mdl.ScoringModel, thr: float) -> float:
    """Uncalibrated model probability whose sigmoid-calibrated value equals thr (calibrated = 1/(1+exp(a*raw+b)))."""
    a, b = tm.meta["calibration"]["a"], tm.meta["calibration"]["b"]
    return (math.log(1.0 / thr - 1.0) - b) / a


def logit(p: float) -> float:
    return math.log(p / (1.0 - p))


# ---------------------------------------------------------------- (2) rules
def rule_check(reg: DatasetRegistry) -> dict:
    db = reg.open("forensic-scenarios")
    try:
        hist = db.scalars(select(TransactionModel).where(or_(TransactionModel.origin_account_id == VICTIM,
                                                             TransactionModel.destination_account_id == VICTIM))
                          .order_by(TransactionModel.timestamp.asc(), TransactionModel.transaction_id.asc())).all()
        flags = inv.compute_flags(VICTIM, list(hist))
        out = [t for t in hist if t.origin_account_id == VICTIM]
        inc = [t for t in hist if t.destination_account_id == VICTIM]
        t = next(x for x in hist if x.transaction_id == TX_ID)
        prior_out = [o for o in out if (o.timestamp, o.transaction_id) < (t.timestamp, t.transaction_id)]
        prev_max = max((o.amount for o in prior_out), default=0.0)
        first_time_out, seen = [], set()
        for o in out:
            if o.destination_account_id not in seen:
                first_time_out.append(o)
            seen.add(o.destination_account_id)
        is_first = any(o.transaction_id == TX_ID for o in first_time_out)
        burst_groups = []
        for i, s in enumerate(first_time_out):
            g = [o for o in first_time_out[i:] if o.timestamp <= s.timestamp + inv.BURST_WINDOW]
            if any(o.transaction_id == TX_ID for o in g):
                burst_groups.append({"transfers": len(g), "total": round(sum(o.amount for o in g), 2)})
        recent_in = [i for i in inc if t.timestamp - inv.FORWARD_WINDOW <= i.timestamp <= t.timestamp]
        checks = {
            "AMOUNT_ABOVE_OWN_HISTORY": {
                "rule": f"earlier outgoing transfers >= {inv.MIN_HISTORY} AND amount > {inv.ABOVE_HISTORY_MULTIPLE}x the largest "
                        f"earlier one AND amount >= {inv.ABOVE_HISTORY_MIN_AMOUNT:,.0f}",
                "earlier_outgoing": len(prior_out), "largest_earlier": round(prev_max, 2),
                "amount_vs_largest_earlier": round(t.amount / prev_max, 3) if prev_max else None, "amount": round(t.amount, 2),
                "fails_on": [c for c, ok in (("history", len(prior_out) >= inv.MIN_HISTORY),
                                             ("multiple", t.amount > inv.ABOVE_HISTORY_MULTIPLE * prev_max),
                                             ("min_amount", t.amount >= inv.ABOVE_HISTORY_MIN_AMOUNT)) if not ok]},
            "BALANCE_DRAIN": {
                "rule": f"amount >= {inv.DRAIN_MIN_AMOUNT:,.0f} AND amount >= {inv.DRAIN_SHARE:.0%} of the balance before",
                "amount": round(t.amount, 2), "balance_before": round(t.origin_balance_before, 2),
                "share_of_balance": round(t.amount / t.origin_balance_before, 4),
                "fails_on": [c for c, ok in (("min_amount", t.amount >= inv.DRAIN_MIN_AMOUNT),
                                             ("share", t.amount >= inv.DRAIN_SHARE * t.origin_balance_before)) if not ok]},
            "BURST_TO_NEW_RECIPIENTS": {
                "rule": f">= {inv.BURST_MIN_TRANSFERS} first-time-recipient transfers within 60 min totalling >= {inv.BURST_MIN_TOTAL:,.0f}",
                "first_time_recipient": is_first, "groups_containing_it": burst_groups,
                "fails_on": ["count_and_total"] if not any(g["transfers"] >= inv.BURST_MIN_TRANSFERS and g["total"] >= inv.BURST_MIN_TOTAL
                                                           for g in burst_groups) else []},
            "FORWARDS_RECENT_INFLOW": {
                "rule": f"sent within 30 min after an inflow >= {inv.FORWARD_MIN_INFLOW:,.0f}, onward >= {inv.FORWARD_SHARE:.0%} of it",
                "inflows_in_previous_30_min": [{"transaction_id": i.transaction_id, "amount": round(i.amount, 2)} for i in recent_in],
                "fails_on": [] if any(i.amount >= inv.FORWARD_MIN_INFLOW for i in recent_in) else ["no_qualifying_inflow"]},
        }
        fired = {k: sorted(f["code"] for f in v) for k, v in flags.items()}
        largest5 = [o.transaction_id for o in sorted(out, key=lambda o: -o.amount)[:inv.FALLBACK_SEEDS]]
        return {"transfer": {"timestamp": t.timestamp.isoformat(), "amount": round(t.amount, 2), "channel": t.channel,
                             "receiver": t.destination_account_id, "sender_balance_before": round(t.origin_balance_before, 2)},
                "checks": checks, "rules_fired_on_this_transfer": fired.get(TX_ID, []),
                "rules_fired_on_the_account": fired,
                "largest_outgoing_transfers_fallback_seeds": largest5,
                "transfer_in_fallback_seeds": TX_ID in largest5,
                "outgoing_transfers": len(out), "incoming_transfers": len(inc)}
    finally:
        db.close()


def engine_summary(out: dict) -> dict:
    tr = out["investigation"]["trace"]
    return {"victim_assessment_status": out["victim_assessment"]["status"],
            "suspicious_transactions": [d["transaction_id"] for d in out["suspicious_transactions"]],
            "uncorroborated_rule_flags": [{"transaction_id": d["transaction_id"], "amount": d["amount"], "receiver": d["receiver_account_id"],
                                           "rules": [f["code"] for f in d["rule_flags"]]} for d in out["uncorroborated_rule_flags"]],
            "seed_selection": tr.get("seed_selection"), "downstream_seeds": tr.get("downstream_seed_transaction_ids"),
            "upstream_seeds": tr.get("upstream_seed_transaction_ids"),
            "traced_accounts": [n["account_id"] for n in tr["nodes"]],
            "roles": {a["account_id"]: a["role_candidate"] for a in out["role_assessments"]},
            "role_details": {a["account_id"]: {"role": a["role_candidate"], "status": a["assessment_status"], "headline": a["headline"],
                                               "categories": a["evidence_categories"], "uncertainty": a["uncertainty_reason"],
                                               "account_model": {k: a["account_model"].get(k) for k in ("status", "calibrated_probability",
                                                                                                       "above_threshold", "n_transactions")}}
                             for a in out["role_assessments"] if a["account_id"] != VICTIM},
            "affected_account_groups": {k: v for k, v in out["affected_accounts"].items() if isinstance(v, list)}
            if isinstance(out.get("affected_accounts"), dict) else out.get("affected_accounts"),
            "closest_unflagged_transfers": out.get("closest_unflagged_transfers"),
            "automatic_actions_taken": out.get("automatic_actions_taken")}


# ---------------------------------------------------------------- main
def main() -> dict:
    t0 = time.perf_counter()
    reg = DatasetRegistry(f"sqlite:///{DB_FILE}")
    tm = mdl.load("transaction_model", ARTIFACT.parent)
    thr = float(tm.threshold)
    rep: dict = {
        "purpose": "Diagnose the scenario 4 false negative without changing the served threshold. Analysis only.",
        "case": {"ledger": "served forensic ledger, seed 303 (data/v3_forensic_scenarios.db)", "victim": VICTIM,
                 "scenario_id": SCENARIO, "transfer": TX_ID},
        "model": {"version": tm.version, "threshold": thr, "threshold_rule": tm.meta["threshold"]["rule"],
                  "threshold_chosen_on": tm.meta["threshold"]["chosen_on"], "calibration": tm.meta["calibration"]["method"]},
        "labelling": {"selection_basis": "validation split only (train ledger days 84-101)",
                      "post_hoc": "Everything under 'post_hoc_*' keys was computed after the threshold was fixed, for "
                                  "information only. None of it was used to choose or change anything."},
    }

    # ---- (1) features, score, TreeSHAP
    local, Xr = served_features(reg)
    i_tx = local.index[local.transaction_id == TX_ID][0]
    x = Xr.loc[[i_tx]]
    s = tm.score(x).iloc[0]
    contrib = explain.contributions(tm, x)[0]
    bias, margin = bias_and_margin(tm, x)
    p_cal = float(s["calibrated_probability"])
    need_raw = raw_needed(tm, thr)
    rng_out = {f: {"value": r6(x[f].iloc[0]), "training_range": lo_hi} for f, lo_hi in (tm.meta.get("training_ranges") or {}).items()
               if not pd.isna(x[f].iloc[0]) and not (lo_hi[0] <= float(x[f].iloc[0]) <= lo_hi[1])}

    demo, XD, scen_demo = load_ledger("demo")
    j = demo.index[demo.transaction_id == TX_ID][0]
    same = np.allclose(XD.loc[j, TXN_FEATURES].to_numpy(dtype=float), x[TXN_FEATURES].to_numpy(dtype=float)[0], equal_nan=True)
    sD = tm.score(XD)
    pD = sD["calibrated_probability"].to_numpy()
    yD = demo["label"].to_numpy()
    cD = explain.contributions(tm, XD)

    # Training data the model learned from (train split only) and validation (selection split).
    A, XA, scen_train = load_ledger("train")
    day = (A["timestamp"] - A["timestamp"].min()).dt.days.to_numpy()
    tr, va = day < TRAIN_END_DAY, (day >= TRAIN_END_DAY) & (day < VAL_END_DAY)
    sA = tm.score(XA)
    pA = sA["calibrated_probability"].to_numpy()
    yA = A["label"].to_numpy()

    vt_demo = (demo["scenario_tag"] == "victim_transfer").to_numpy()
    flagged_vt = vt_demo & (pD >= thr)
    mv_flagged_vt = flagged_vt & (demo["pattern"] == "multi_victim").to_numpy()
    feat_rows = []
    for k, f in enumerate(tm.features):
        v = x[f].iloc[0]
        med_c = float(np.median(cD[flagged_vt, k])) if flagged_vt.any() else None
        med_v = XD.loc[flagged_vt, f].median()
        tr_vt = XA.loc[tr & (A["scenario_tag"] == "victim_transfer").to_numpy(), f].dropna()
        feat_rows.append({"feature": f, "value": r6(v), "contribution": r6(contrib[k]),
                          "median_flagged_victim_transfer_value": r6(med_v), "median_flagged_victim_transfer_contribution": r6(med_c),
                          "contribution_minus_flagged_median": r6(contrib[k] - med_c) if med_c is not None else None,
                          "percentile_among_training_victim_transfers": None if pd.isna(v) or not len(tr_vt)
                          else round(float((tr_vt < v).mean() + 0.5 * (tr_vt == v).mean()) * 100, 1),
                          "label": None if pd.isna(v) else (explain.LABELS.get(f, lambda _: None)(float(v)))})
    by_gap = sorted([r for r in feat_rows if r["contribution_minus_flagged_median"] is not None],
                    key=lambda r: r["contribution_minus_flagged_median"])
    tr_vt_mask = tr & (A["scenario_tag"] == "victim_transfer").to_numpy()
    rep["part1_transfer"] = {
        "served_path_features_equal_full_ledger_features": bool(same),
        "scenario_variant": {"pattern": scen_demo.at[SCENARIO, "pattern"], "variant": scen_demo.at[SCENARIO, "variant"],
                             "held_out": bool(scen_demo.at[SCENARIO, "held_out"])},
        "score": {"model_score_raw": r6(s["model_score"]), "calibrated": r6(p_cal), "threshold": thr,
                  "share_of_threshold": round(p_cal / thr, 4), "above_threshold": bool(s["above_threshold"]),
                  "outside_training_range_count": int(s["outside_training_range"]),
                  "raw_score_needed_for_threshold": r6(need_raw),
                  "log_odds": r6(margin[0]), "log_odds_needed": r6(logit(need_raw)),
                  "log_odds_short_by": r6(logit(need_raw) - margin[0]), "treeshap_bias": r6(bias[0])},
        "features_outside_training_range": rng_out,
        "excluded_from_range_check": {f: {"value": r6(x[f].iloc[0]),
                                          "train_split_p0.5_p99.5": [r6(XA.loc[tr, f].quantile(0.005)), r6(XA.loc[tr, f].quantile(0.995))]}
                                      for f in ("s_history_days", "r_history_days")},
        "top_negative_contributions": [r for r in sorted(feat_rows, key=lambda r: r["contribution"] or 0)[:8]],
        "top_positive_contributions": [r for r in sorted(feat_rows, key=lambda r: -(r["contribution"] or 0))[:6]],
        "largest_shortfalls_vs_median_flagged_victim_transfer": by_gap[:8],
        "comparison_population": f"served-ledger victim transfers the model flagged (n={int(flagged_vt.sum())}; "
                                 f"{int(mv_flagged_vt.sum())} of them multi_victim)",
        "profiles": {"this_transfer": {f: r6(x[f].iloc[0]) for f in KEY_FEATURES},
                     "served_flagged_victim_transfers": profile(XD[flagged_vt]),
                     "served_flagged_multi_victim_victim_transfers": profile(XD[mv_flagged_vt]),
                     "train_split_victim_transfers": profile(XA[tr_vt_mask])},
        "all_features": feat_rows,
    }

    # ---- (2) rules and what seeded the trace (engine as served)
    rep["part2_rules"] = rule_check(reg)
    served_out = run_engine(reg, VICTIM)
    rep["part2_rules"]["engine_as_served"] = engine_summary(served_out)

    # ---- (3) threshold trade-off: validation for any choice
    alt = p_cal  # highest threshold at which this transfer would have been flagged
    yv, pv = yA[va], pA[va]
    sel, sel_rule = pick_threshold(yv, pv, 0.5)  # the training script's own rule, re-applied to the same frozen scores
    grid = [thr, sel] + [float(t) for t in np.linspace(sel, alt, 6)[1:-1]] + [alt]
    cur_v = counts_at(yv, pv, thr)
    sel_v = counts_at(yv, pv, sel)
    val_rows = []
    for t in grid:
        c = counts_at(yv, pv, t)
        c["extra_fp_vs_served"], c["extra_tp_vs_served"] = c["fp"] - cur_v["fp"], c["tp"] - cur_v["tp"]
        c["extra_fp_vs_selected"], c["extra_tp_vs_selected"] = c["fp"] - sel_v["fp"], c["tp"] - sel_v["tp"]
        val_rows.append(c)
    order = np.sort(np.unique(pv[(pv < sel)]))[::-1][:1]
    meta_cm = tm.meta["metrics"]["validation"]["confusion_matrix"]
    rounding_gap = (pv >= sel) & (pv < thr)
    rep["part3_threshold"] = {
        "validation": {
            "rows": int(va.sum()), "positives": int(yv.sum()),
            "selected_threshold_unrounded": sel, "selection_rule": sel_rule,
            "served_threshold_rounded": thr,
            "metadata_confusion_matrix": meta_cm,
            "served_threshold_reproduces_metadata_confusion_matrix": {"tn": int(((pv < thr) & (yv == 0)).sum()), "fp": cur_v["fp"],
                                                                      "fn": cur_v["fn"], "tp": cur_v["tp"]} == meta_cm,
            "unrounded_threshold_reproduces_metadata_confusion_matrix": {"tn": int(((pv < sel) & (yv == 0)).sum()), "fp": sel_v["fp"],
                                                                         "fn": sel_v["fn"], "tp": sel_v["tp"]} == meta_cm,
            "rows_between_unrounded_and_served_threshold": {"positives": int((rounding_gap & (yv == 1)).sum()),
                                                            "negatives": int((rounding_gap & (yv == 0)).sum()),
                                                            "scores": [repr(float(v)) for v in pv[rounding_gap]]},
            "operating_points": val_rows,
            "next_lower_validation_score_below_selected": r6(order[0]) if len(order) else None,
            "precision_at_next_lower_score": counts_at(yv, pv, float(order[0]))["precision"] if len(order) else None,
            "validation_positives_in_[alt,selected)": int(((pv >= alt) & (pv < sel) & (yv == 1)).sum()),
            "validation_negatives_in_[alt,selected)": int(((pv >= alt) & (pv < sel) & (yv == 0)).sum()),
            "note": "The selected threshold is the lowest validation threshold with precision >= 50%; every lower threshold has "
                    "validation precision below 50% by construction. metadata.json stores it rounded to 6 decimals.",
        }
    }

    # Post-hoc (not used for selection): cold ledger and served ledger.
    B, XB, scen_cold = load_ledger("cold")
    pB = tm.score(XB)["calibrated_probability"].to_numpy()
    yB = B["label"].to_numpy()
    cold_cur, cold_alt = counts_at(yB, pB, thr), counts_at(yB, pB, alt)
    between_b = (pB >= alt) & (pB < thr)
    vt_b = (B["scenario_tag"] == "victim_transfer").to_numpy()
    rep["part3_threshold"]["post_hoc_cold_ledger"] = {
        "label": "POST-HOC, information only, not used for selection; cold ledger was scored once for the report and is "
                 "re-scored here with the same frozen model.",
        "at_current": cold_cur, "at_alternative": cold_alt,
        "extra_false_positives": cold_alt["fp"] - cold_cur["fp"], "extra_true_positives": cold_alt["tp"] - cold_cur["tp"],
        "recall_gained": round(cold_alt["recall"] - cold_cur["recall"], 4),
        "false_positive_rate_change": r6(cold_alt["false_positive_rate"] - cold_cur["false_positive_rate"]),
        "victim_transfer_recall": {"current": round(float((pB[vt_b] >= thr).mean()), 4), "alternative": round(float((pB[vt_b] >= alt).mean()), 4),
                                   "n": int(vt_b.sum())},
        "between_thresholds_by_step": B.loc[between_b & (yB == 1), "scenario_tag"].value_counts().to_dict(),
        "between_thresholds_ordinary_by_activity": B.loc[between_b & (yB == 0), "scenario_tag"].value_counts().head(10).to_dict(),
    }
    between_d = (pD >= alt) & (pD < thr)
    demo_cur, demo_alt = counts_at(yD, pD, thr), counts_at(yD, pD, alt)
    rep["part3_threshold"]["post_hoc_served_ledger"] = {
        "label": "POST-HOC, information only, not used for selection.",
        "at_current": demo_cur, "at_alternative": demo_alt,
        "transfers_between_thresholds": int(between_d.sum()),
        "scenario_transfers_between_thresholds": int((between_d & (yD == 1)).sum()),
        "multi_victim_scenario_transfers_between_thresholds": int((between_d & (yD == 1) & (demo["pattern"] == "multi_victim").to_numpy()).sum()),
        "ordinary_transfers_between_thresholds": int((between_d & (yD == 0)).sum()),
        "scenario_transfers_between": demo.loc[between_d & (yD == 1), ["transaction_id", "scenario_id", "pattern", "variant", "scenario_tag", "amount"]]
        .assign(calibrated=pD[between_d & (yD == 1)].round(6)).to_dict("records"),
        "ordinary_between_by_activity": demo.loc[between_d & (yD == 0), "scenario_tag"].value_counts().to_dict(),
        "multi_victim_victim_transfers": demo.loc[vt_demo & (demo["pattern"] == "multi_victim").to_numpy(), ["transaction_id", "scenario_id", "amount"]]
        .assign(calibrated=pD[vt_demo & (demo["pattern"] == "multi_victim").to_numpy()].round(6),
                flagged=pD[vt_demo & (demo["pattern"] == "multi_victim").to_numpy()] >= thr).to_dict("records"),
    }

    # Post-hoc engine counterfactual: the same investigation with the threshold lowered in memory to this transfer's score.
    etm = engine_module.mdl.load("transaction_model")
    saved = dict(etm.meta["threshold"])
    try:
        etm.meta["threshold"] = {**saved, "value": alt}
        cf = engine_summary(run_engine(reg, VICTIM))
    finally:
        etm.meta["threshold"] = saved
    others = sorted(pd.read_csv(GT / "demo" / "roles.csv").query("scenario_id == @SCENARIO and role == 'victim' and materialised")
                    .account_id.pipe(lambda s: s[s != VICTIM]))
    cf["other_scenario_victims"] = others
    cf["other_scenario_victims_surfaced"] = {a: cf["roles"].get(a) for a in others}
    rep["part3_threshold"]["post_hoc_engine_counterfactual"] = {
        "label": "POST-HOC counterfactual on the served ledger with the threshold lowered in memory to this transfer's score; "
                 "the artifact and the served threshold are unchanged. The lower threshold also applies to the other-sender "
                 "search inside the engine.",
        "threshold_used": r6(alt), **cf}
    assert etm.meta["threshold"]["value"] == thr

    # ---- (4) how often: missed victim transfers (cold post-hoc; validation)
    def fn_breakdown(df: pd.DataFrame, X: pd.DataFrame, p: np.ndarray, mask: np.ndarray) -> dict:
        vt = mask & (df["scenario_tag"] == "victim_transfer").to_numpy()
        fn, tp = vt & (p < thr), vt & (p >= thr)
        key = (df["pattern"].astype(str) + ":" + df["variant"].astype(str)).to_numpy()
        by = {}
        for k in sorted(set(key[vt])):
            m = key == k
            by[k] = {"victim_transfers": int((vt & m).sum()), "missed": int((fn & m).sum()),
                     "miss_rate": round(float((fn & m).sum() / max((vt & m).sum(), 1)), 4)}
        bal = (df["amount"] / df["sender_balance_before"]).to_numpy()
        prof_fn, prof_tp = profile(X[fn]), profile(X[tp])
        return {"victim_transfers": int(vt.sum()), "missed": int(fn.sum()), "miss_rate": round(float(fn.sum() / max(vt.sum(), 1)), 4),
                "by_pattern_variant": by,
                "missed_amount_median": r6(np.median(df.loc[fn, "amount"])) if fn.any() else None,
                "detected_amount_median": r6(np.median(df.loc[tp, "amount"])) if tp.any() else None,
                "missed_under_10k": int((fn & (df["amount"] < 10_000).to_numpy()).sum()),
                "missed_share_of_balance_median": r6(np.median(bal[fn])) if fn.any() else None,
                "missed_scores_within_alt_band": int((fn & (p >= alt)).sum()),
                "missed_scores_quantiles": [r6(q) for q in np.quantile(p[fn], [0.1, 0.5, 0.9])] if fn.any() else None,
                "feature_profile_missed": prof_fn, "feature_profile_detected": prof_tp,
                "all_scenario_steps_missed_by_step": df.loc[mask & (df["label"] == 1).to_numpy() & (p < thr), "scenario_tag"].value_counts().to_dict()}

    rep["part4_frequency"] = {
        "validation": fn_breakdown(A, XA, pA, va),
        "post_hoc_cold_ledger": {"label": "POST-HOC, information only.", **fn_breakdown(B, XB, pB, np.ones(len(B), bool))},
        "post_hoc_served_ledger": {"label": "POST-HOC, information only.", **fn_breakdown(demo, XD, pD, np.ones(len(demo), bool))},
    }
    p1, v, cb = rep["part1_transfer"], rep["part3_threshold"]["validation"], rep["part3_threshold"]["post_hoc_cold_ledger"]
    alt_row = v["operating_points"][-1]
    rep["summary"] = {
        "cause": (f"Not a held-out or out-of-range input (variant {p1['scenario_variant']['variant']}, 0 features outside the training "
                  f"range). The model saw a small transfer ({rep['part2_rules']['transfer']['amount']:,.2f}) that was not large for this "
                  "sender (smaller than its earlier maximum, +2.3 SD) into a receiver that already had many outgoing transfers, "
                  f"at midday. Log-odds {p1['score']['log_odds']} vs {p1['score']['log_odds_needed']} needed "
                  f"(short by {p1['score']['log_odds_short_by']})."),
        "rules": "No fixed rule can fire: every rule has a minimum amount of 10,000 or 25,000, or needs a burst/recent inflow. "
                 "An uncorroborated AMOUNT_ABOVE_OWN_HISTORY flag on a 10,795.53 merchant payment was the only trace seed and "
                 "pre-empted the 'five largest outgoing' fallback, in which this transfer ranks second.",
        "threshold": (f"On validation, moving from the selected threshold {v['selected_threshold_unrounded']:.7f} to "
                      f"{alt_row['threshold']} adds {alt_row['extra_fp_vs_selected']} false positives and "
                      f"{alt_row['extra_tp_vs_selected']} true positives; precision falls to {alt_row['precision']} (below the 50% target). "
                      f"Post-hoc cold ledger: +{cb['extra_false_positives']} FP, +{cb['extra_true_positives']} TP, recall "
                      f"+{cb['recall_gained']}. Post-hoc engine counterfactual: the victim is flagged but none of the 3 other victims is "
                      "surfaced (the intermediary is assessed unknown_role)."),
        "served_threshold_rounding": "metadata.json stores the selected threshold rounded up to 6 decimals; at the rounded value one "
                                     "validation positive (the one at exactly the selected score) falls below it, so served validation "
                                     "counts are tp 285 / fn 12 instead of the documented 286 / 11. Cold, temporal and served-ledger "
                                     "figures are unaffected. Reported only; nothing changed.",
    }
    rep["recommendation"] = [
        "Keep the validation-selected threshold. The alternative fails the documented precision target on validation and "
        "gains no validation positives; it would not have surfaced the other victims in this case either.",
        "Closest-unflagged context panel: TX-303-0064858 is already the first entry (75.1% of the threshold) in the served "
        "report; it is context, never a flag or a trace seed.",
        "Analyst-initiated trace from a chosen transfer (not available on the dynamic endpoint today; it would be a product "
        "change): labelled as analyst-selected, never as a model flag, and no automatic action.",
        "Seed selection (owner decision, not changed): where the model is validated, a rule flag the model does not corroborate "
        "still replaces the five-largest fallback seeds.",
        "Cross-case linkage: of the other victims' transfers into the same receiver, the model flags "
        + ", ".join(f"{d['transaction_id']} ({d['calibrated']:.4f})" for d in rep["part3_threshold"]["post_hoc_served_ledger"]["multi_victim_victim_transfers"]
                    if d["scenario_id"] == SCENARIO and d["transaction_id"] != TX_ID and d["flagged"])
        + "; investigating either of those victims reaches the shared receiver.",
        "Any model-side change (e.g. receiver-side features for many first-time senders paying large shares of their balance) "
        "must be trained and selected on train/validation only and scored once on the test ledgers.",
    ]
    rep["runtime_seconds"] = round(time.perf_counter() - t0, 1)
    return rep


if __name__ == "__main__":  # pragma: no cover
    r = main()
    REPORT.write_text(json.dumps(r, indent=2, default=str))
    print(json.dumps({k: r[k] for k in ("part1_transfer",)}, default=str)[:3000])
