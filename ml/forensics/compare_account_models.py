"""Champion/challenger analysis of the account model on the CURRENT (corrected) labels.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.compare_account_models

Champion  = ml/artifacts/v3/account_model            (v3-account-1.0.0, the served model)
Challenger = ml/artifacts/v3/account_model_challenger (v3-account-1.1.0, not served)

Both frozen models are scored on identical rows, built exactly as train_account_model.py builds them (Ledger,
snapshot(), usable rows, split_groups()): the validation split of the training ledger, the cold ledger (disjoint
accounts) and the served demo ledger, at the as_of snapshot days (30/60/90 and each ledger's last day) and pooled.
Each model is applied at its OWN threshold, the one stored in its artifact (chosen on its own validation split).
Nothing here is fitted on, selected on or tuned to the cold or demo ledgers.

Analysis-only variants (never written to any artifact, never served) are labelled as such:
* alternative thresholds for the challenger, every one selected on VALIDATION rows only and then reported on cold/demo;
* refits of the challenger's configuration on the TRAIN split only (group k-fold within train, learning curve) to
  explain the train-validation gap. They reuse the challenger's hyper-parameters with a fixed number of trees (the
  artifact's), so validation does not steer them either.

Ground truth (roles, ground_truth_label) is read here, by the evaluator; backend/app inference code never sees it.
Writes ml/reports/account_model_champion_challenger.json. The decision to promote stays with the owner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import average_precision_score

from backend.app.intelligence import models as served
from backend.app.intelligence.features import GRAPH_FEATURES
from ml.forensics import train_account_model as tam
from ml.forensics.evaluation import bootstrap_pr_auc, ece, pick_threshold, reliability
from ml.forensics.generator import SUSPICIOUS_ROLES
from ml.forensics.modeling import SEED, environment, group_folds

ART = Path("ml/artifacts/v3")
CHAMPION, CHALLENGER = "account_model", "account_model_challenger"
CHAMPION_REPORT = Path("ml/reports/account_model_v3.json")
CHALLENGER_REPORT = Path("ml/reports/account_model_v3_challenger.json")
OUT = Path("ml/reports/account_model_champion_challenger.json")

CI_MIN_POSITIVES = 10          # bootstrap interval only when the cohort has at least this many positive rows ...
CI_MIN_POSITIVE_GROUPS = 5     # ... spread over at least this many scenario instances
LONG_HISTORY_DAYS = 90.0
AGE_FEATURES = ["history_days", "active_days_log"]
ROLE_GROUPS = ("intermediary", "attacker_controlled", "victim", "innocent_counterparty", "lookalike_legitimate",
               "merchant_or_employer", "ordinary", "unmaterialised_scenario_role")
BAND_NAMES = [b[2] for b in tam.HISTORY_BANDS]
PROTECTED_GROUPS = ("victim", "innocent_counterparty", "lookalike_legitimate", "ordinary", "unmaterialised_scenario_role")
LC_FRACTIONS = (0.25, 0.5, 0.75, 1.0)


# ---------------------------------------------------------------------------------------------- helpers
def _r(x, k=4):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), k)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def role_group(role: pd.Series) -> np.ndarray:
    r = role.astype(str)
    out = np.where(r.str.startswith("not_materialised:"), "unmaterialised_scenario_role",
          np.where(r.isin(["merchant", "employer"]), "merchant_or_employer", r))
    return out


def ap(y, p) -> float | None:
    y = np.asarray(y).astype(int)
    return float(average_precision_score(y, p)) if 0 < y.sum() < len(y) else None


def block(y, p, thr, groups=None, ci=True) -> dict:
    """Confusion matrix, precision, recall, FPR, PR-AUC (+ scenario-grouped bootstrap CI), Brier, ECE, reliability."""
    y, p = np.asarray(y).astype(int), np.asarray(p, float)
    pred = p >= thr
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    fn, tn = int((~pred & (y == 1)).sum()), int((~pred & (y == 0)).sum())
    pos, neg = tp + fn, fp + tn
    out = {"n": int(len(y)), "positives": pos, "negatives": neg,
           "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
           "precision": _r(tp / (tp + fp)) if tp + fp else None, "recall": _r(tp / pos) if pos else None,
           "false_positive_rate": _r(fp / neg) if neg else None, "flag_rate": _r((tp + fp) / len(y)) if len(y) else None,
           "pr_auc": _r(ap(y, p)), "pr_auc_95ci_bootstrap_by_scenario": None,
           "brier": _r(np.mean((np.clip(p, 0, 1) - y) ** 2), 6) if len(y) else None,
           "ece": _r(ece(y, np.clip(p, 0, 1)), 5) if len(y) else None,
           "reliability_10_bins": [[b["n"], b["mean_score"], b["observed_rate"]] for b in reliability(y, np.clip(p, 0, 1))] if len(y) else []}
    if ci and groups is not None and 0 < pos < len(y):
        g = np.asarray(groups)
        npg = len(set(g[y == 1]))
        if pos >= CI_MIN_POSITIVES and npg >= CI_MIN_POSITIVE_GROUPS:
            out["pr_auc_95ci_bootstrap_by_scenario"] = bootstrap_pr_auc(y, p, g)
        else:
            out["pr_auc_95ci_bootstrap_by_scenario"] = f"not computed: {pos} positive rows in {npg} scenario instances"
    return out


def cohorts(T: pd.DataFrame, p: np.ndarray, thr: float) -> dict:
    y, g = T["y"].to_numpy(), T["group"].to_numpy()
    out = {}
    for name, keys, order in (("history_days", tam.history_band(T["history_days"].to_numpy()), BAND_NAMES),
                              ("true_role_group", role_group(T["role"]), list(ROLE_GROUPS)),
                              ("customer_type_evaluation_slice_only", T["customer_type"].astype(str).to_numpy(),
                               sorted(T["customer_type"].astype(str).unique()))):
        out[name] = {k: block(y[keys == k], p[keys == k], thr, g[keys == k]) for k in order if (keys == k).any()}
    return out


def contribs(m: served.ScoringModel, T: pd.DataFrame) -> pd.DataFrame:
    d = xgb.DMatrix(T[m.features].to_numpy(float), feature_names=m.features, missing=np.nan)
    return pd.DataFrame(m._booster.predict(d, pred_contribs=True), columns=m.features + ["bias"], index=T.index)


def contrib_groups(c: pd.DataFrame, feats: list[str]) -> pd.DataFrame:
    age = [f for f in AGE_FEATURES if f in feats]
    graph = [f for f in GRAPH_FEATURES if f in feats]
    beh = [f for f in feats if f not in age and f not in graph]
    return pd.DataFrame({"account_age": c[age].sum(1) if age else 0.0, "graph": c[graph].sum(1) if graph else 0.0,
                         "behaviour": c[beh].sum(1), "bias": c["bias"]}, index=c.index)


def lowest_threshold_with_precision(y, p, target=tam.PRECISION_TARGET) -> float | None:
    """Tie-aware variant of pick_threshold (analysis only): the lowest DISTINCT score t such that the rows actually
    flagged by `p >= t` have precision >= target. Ties are kept together, as they are when the threshold is applied."""
    y, p = np.asarray(y).astype(int), np.asarray(p, float)
    vals = np.unique(p)[::-1]
    tp = np.array([(y[p >= v]).sum() for v in vals])
    k = np.array([(p >= v).sum() for v in vals])
    ok = np.where(tp / k >= target)[0]
    return float(vals[ok[np.argmax(tp[ok])]]) if len(ok) else None


def threshold_at_fpr(y, p, max_fpr: float) -> float:
    """Lowest distinct score whose false-positive rate (ties kept together) is <= max_fpr."""
    y, p = np.asarray(y).astype(int), np.asarray(p, float)
    neg = max((y == 0).sum(), 1)
    for v in np.unique(p):
        if ((p >= v) & (y == 0)).sum() / neg <= max_fpr:
            return float(v)
    return float(p.max()) + 1e-9


def short_rates(y, p, thr, roles=None) -> dict:
    y, p = np.asarray(y).astype(int), np.asarray(p, float)
    pred = p >= thr
    pos, neg = int(y.sum()), int((y == 0).sum())
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    out = {"n": int(len(y)), "positives": pos, "tp": tp, "fp": fp, "flagged": int(pred.sum()),
           "precision": _r(tp / pred.sum()) if pred.sum() else None, "recall": _r(tp / pos) if pos else None,
           "false_positive_rate": _r(fp / neg) if neg else None}
    if roles is not None:
        rg = role_group(pd.Series(np.asarray(roles)))
        out["ordinary_flag_rate"] = _r(pred[rg == "ordinary"].mean()) if (rg == "ordinary").any() else None
        out["flag_rate_by_negative_role_group"] = {k: _r(pred[rg == k].mean()) for k in PROTECTED_GROUPS if (rg == k).any()}
    return out


# ---------------------------------------------------------------------------------------------- data
def load_tables(cache: Path | None) -> dict:
    """Snapshot tables of the three ledgers (built by train_account_model.Ledger) plus evaluation-only columns."""
    tabs = {}
    for name in ("train", "cold", "demo"):
        f = cache / f"{name}.pkl" if cache else None
        if f is not None and f.exists():
            tabs[name] = pd.read_pickle(f)
            continue
        L = tam.Ledger(name)
        T = L.snapshots()
        acc = L.L.accounts.set_index("account_id")
        T["customer_type"] = T["account_id"].map(acc["customer_type"])
        T["ground_truth_label"] = T["account_id"].map(L.base_label)
        T["ledger_days"] = L.days
        tx = L.L.transactions[L.L.transactions.scenario_id.notna()]
        pairs = set(zip(tx.origin_account_id, tx.scenario_id)) | set(zip(tx.destination_account_id, tx.scenario_id))
        r = L.L.roles[L.L.roles.role.isin(SUSPICIOUS_ROLES)]
        T["old_rule_any_own_scenario_transfer"] = T["account_id"].isin(
            {a for a, s in zip(r.account_id, r.scenario_id) if (a, s) in pairs})
        tabs[name] = T
        if f is not None:
            f.parent.mkdir(parents=True, exist_ok=True)
            T.to_pickle(f)
    return tabs


# ---------------------------------------------------------------------------------------------- sections
def provenance_check(TA: pd.DataFrame, champ: served.ScoringModel, cold: pd.DataFrame, demo: pd.DataFrame) -> dict:
    """Rebuild the champion's training rows from its report and check they reproduce its recorded counts and PR-AUC."""
    rep = json.loads(CHAMPION_REPORT.read_text()) if CHAMPION_REPORT.exists() else {}
    days = int(TA["ledger_days"].iloc[0])
    E = TA[(TA.as_of_day == days) & (TA.n_transactions >= tam.MIN_ACCOUNT_TRANSACTIONS)
           & (TA.ground_truth_label != "secondary_victim")].reset_index(drop=True)
    val = tam.split_groups(E["group"])
    rules = {"accounts.ground_truth_label in suspicious roles (planned role)": E.ground_truth_label.isin(SUSPICIOUS_ROLES),
             "suspicious role with any transfer of its own scenario": E.old_rule_any_own_scenario_transfer,
             "current corrected materialised rule (y)": E.y.astype(bool)}
    counts = {k: {"train_rows": int((~val).sum()), "train_positives": int(v[~val].sum()),
                  "validation_rows": int(val.sum()), "validation_positives": int(v[val].sum())} for k, v in rules.items()}
    y_old = rules["accounts.ground_truth_label in suspicious roles (planned role)"].to_numpy().astype(int)
    p = champ.calibrated(champ.raw_scores(E))
    reported = {k: rep.get("splits", {}).get(k) for k in ("train", "validation")}
    out = {"reported_in_" + CHAMPION_REPORT.name: {
               **{k: v for k, v in reported.items()},
               "train_pr_auc": rep.get("results", {}).get("train", {}).get("pr_auc"),
               "validation_pr_auc": rep.get("results", {}).get("validation", {}).get("pr_auc"),
               "cold_ledger_test": {k: rep.get("results", {}).get("cold_ledger_test", {}).get(k) for k in ("n", "positives")},
               "served_demo_ledger": {k: rep.get("results", {}).get("served_demo_ledger", {}).get(k) for k in ("n", "positives")}},
           "rebuilt_rows": "training ledger (seed 101), as_of = ledger end only, >= 5 transactions, accounts whose "
                           "ground_truth_label is secondary_victim removed, split_groups() hash split",
           "positives_under_candidate_label_rules": counts,
           "reproduced_with_planned_role_labels": {"train_pr_auc": _r(ap(y_old[~val], p[~val])),
                                                   "validation_pr_auc": _r(ap(y_old[val], p[val]))}}
    for nm, T in (("cold_ledger_test", cold), ("served_demo_ledger", demo)):
        d = int(T["ledger_days"].iloc[0])
        S = T[(T.as_of_day == d) & (T.n_transactions >= tam.MIN_ACCOUNT_TRANSACTIONS) & (T.ground_truth_label != "secondary_victim")]
        out["reproduced_with_planned_role_labels"][nm] = {"n": int(len(S)), "positives": int(S.ground_truth_label.isin(SUSPICIOUS_ROLES).sum())}
    match = counts["accounts.ground_truth_label in suspicious roles (planned role)"]
    out["matches_report"] = bool(reported.get("train") and match["train_rows"] == reported["train"]["accounts"]
                                 and match["train_positives"] == reported["train"]["positives"]
                                 and match["validation_rows"] == reported["validation"]["accounts"]
                                 and match["validation_positives"] == reported["validation"]["positives"]
                                 and out["reproduced_with_planned_role_labels"]["train_pr_auc"] == rep["results"]["train"]["pr_auc"]
                                 and out["reproduced_with_planned_role_labels"]["validation_pr_auc"] == rep["results"]["validation"]["pr_auc"])
    out["reading"] = ("The champion's recorded counts and PR-AUC are reproduced only by the planned-role labels "
                      "(accounts.ground_truth_label), i.e. a suspicious role counted as positive even when none of its "
                      "scenario transfers happened. The 'any transfer of its own scenario' rule gives fewer positives "
                      "and does not reproduce them.")
    return out


def evaluation(views: dict, models: dict) -> dict:
    out = {}
    for ds, vs in views.items():
        out[ds] = {}
        for vname, T in vs.items():
            entry = {"rows": int(len(T)), "positives": int(T.y.sum()), "accounts": int(T.account_id.nunique()),
                     "as_of_days": sorted(int(d) for d in T.as_of_day.unique())}
            for mname, (m, p) in models.items():
                pv = p[ds][vname]
                entry[mname] = {"threshold": round(m.threshold, 6), "overall": block(T.y, pv, m.threshold, T.group),
                                "cohorts": cohorts(T, pv, m.threshold)}
            out[ds][vname] = entry
    return out


def long_history_fp_analysis(views, P, champ, chall, va_pooled) -> dict:
    """(a) why the challenger flags more long-history negatives (cold ledger end ordinary 9.5% -> 12.0%)."""
    out: dict = {}
    end = {ds: [k for k in vs if k.startswith("ledger_end")][0] for ds, vs in views.items()}

    # A1. reproduce + is it already visible on validation? FPR / ordinary flag rate by as_of day and by history band.
    trend = {}
    for ds, vs in views.items():
        trend[ds] = {}
        for vname, T in vs.items():
            if vname == "all_snapshots_pooled":
                continue
            row = {}
            for mn, m in (("champion", champ), ("challenger", chall)):
                row[mn] = short_rates(T.y, P[mn][ds][vname], m.threshold, T.role)
            trend[ds][vname] = row
    out["fpr_by_as_of_day"] = trend
    band = {}
    for ds in views:
        T = views[ds]["all_snapshots_pooled"]
        b = tam.history_band(T.history_days.to_numpy())
        band[ds] = {k: {mn: short_rates(T.y[b == k], P[mn][ds]["all_snapshots_pooled"][b == k], m.threshold, T.role[b == k])
                        for mn, m in (("champion", champ), ("challenger", chall))} for k in BAND_NAMES}
    out["fpr_by_history_band_all_snapshots"] = band

    # A2. threshold-selection hypothesis.
    V = va_pooled
    b = tam.history_band(V.history_days.to_numpy())
    comp = {k: {"rows": int((b == k).sum()), "share_of_rows": _r((b == k).mean()), "positives": int(V.y[b == k].sum()),
                "prevalence": _r(V.y[b == k].mean())} for k in BAND_NAMES}
    pv = P["challenger"]["validation"]["all_snapshots_pooled"]
    prec_band = {k: short_rates(V.y[b == k], pv[b == k], chall.threshold) for k in BAND_NAMES}
    raw = {mn: {ds: {vn: m.raw_scores(T) for vn, T in vs.items()} for ds, vs in views.items()}
           for mn, m in (("champion", champ), ("challenger", chall))}
    VE = views["validation"][end["validation"]]
    alt = {}
    candidates = {
        "deployed (pick_threshold on pooled validation, calibrated scores)": ("cal", chall.threshold),
        "pick_threshold on validation ledger-end rows only (calibrated)": ("cal", pick_threshold(VE.y, P["challenger"]["validation"][end["validation"]])[0]),
        "tie-aware precision>=0.5 on pooled validation (calibrated)": ("cal", lowest_threshold_with_precision(V.y, pv)),
        "tie-aware precision>=0.5 on validation ledger-end rows (calibrated)": ("cal", lowest_threshold_with_precision(VE.y, P["challenger"]["validation"][end["validation"]])),
        "pick_threshold on pooled validation, raw (pre-calibration, no ties)": ("raw", pick_threshold(V.y, raw["challenger"]["validation"]["all_snapshots_pooled"])[0]),
        "pick_threshold on validation ledger-end rows, raw (no ties)": ("raw", pick_threshold(VE.y, raw["challenger"]["validation"][end["validation"]])[0]),
        "matched to champion's validation ledger-end FPR (raw scores)": ("raw", threshold_at_fpr(
            VE.y, raw["challenger"]["validation"][end["validation"]],
            short_rates(VE.y, P["champion"]["validation"][end["validation"]], champ.threshold)["false_positive_rate"])),
    }
    for name, (space, thr) in candidates.items():
        res = {"score": "calibrated" if space == "cal" else "raw", "threshold": _r(thr, 6)}
        for ds, vn in (("validation", "all_snapshots_pooled"), ("validation", end["validation"]), ("cold", end["cold"]),
                       ("demo", end["demo"]), ("cold", "all_snapshots_pooled")):
            T = views[ds][vn]
            s = P["challenger"][ds][vn] if space == "cal" else raw["challenger"][ds][vn]
            r = short_rates(T.y, s, thr, T.role)
            lh = (T.history_days >= LONG_HISTORY_DAYS).to_numpy()
            r["fpr_history_ge_90d"] = short_rates(T.y[lh], s[lh], thr)["false_positive_rate"]
            if vn == "all_snapshots_pooled":
                hb = tam.history_band(T.history_days.to_numpy())
                r["fpr_by_history_band"] = {k: short_rates(T.y[hb == k], s[hb == k], thr)["false_positive_rate"] for k in BAND_NAMES}
            res[f"{ds}:{vn}"] = r
        alt[name] = res
    champ_ref = {f"{ds}:{vn}": {**short_rates(views[ds][vn].y, P["champion"][ds][vn], champ.threshold, views[ds][vn].role)}
                 for ds, vn in (("validation", "all_snapshots_pooled"), ("validation", end["validation"]), ("cold", end["cold"]),
                                ("demo", end["demo"]), ("cold", "all_snapshots_pooled"))}
    out["threshold_selection"] = {
        "pooled_validation_rows_by_history_band": comp,
        "challenger_on_pooled_validation_at_deployed_threshold_by_band": prec_band,
        "realised_validation_precision_at_deployed_threshold": {
            "champion (its own old-label ledger-end validation, as reported)": json.loads(CHAMPION_REPORT.read_text())["results"]["validation"]["precision"] if CHAMPION_REPORT.exists() else None,
            "challenger (pooled validation, current labels)": short_rates(V.y, pv, chall.threshold)["precision"],
            "target": tam.PRECISION_TARGET},
        "challenger_alternative_thresholds_analysis_only_not_deployed": alt,
        "champion_at_its_deployed_threshold_for_reference": champ_ref,
        "note": "Every alternative threshold is selected on validation rows only; cold/demo figures are reported, not used."}

    # A3. isotonic plateau at the threshold.
    x, yv = np.array(chall.meta["calibration"]["x"]), np.array(chall.meta["calibration"]["y"])
    on_thr = np.where(np.isclose(yv, chall.threshold, atol=5e-7))[0]
    lo, hi = float(x[on_thr.min()]), float(x[on_thr.max()])
    nxt = yv[yv > yv[on_thr[0]] + 1e-12]
    plat = {"calibration_method": chall.meta["calibration"]["method"], "distinct_calibrated_values_in_map": int(len(np.unique(yv))),
            "threshold": chall.threshold, "plateau_raw_score_interval": [_r(lo, 6), _r(hi, 6)],
            "plateau_calibrated_value": _r(float(yv[on_thr[0]]), 6), "next_calibrated_value_above": _r(float(nxt.min()), 6) if len(nxt) else None}
    rows = {}
    for ds, vn in (("validation", "all_snapshots_pooled"), ("validation", end["validation"]), ("cold", end["cold"]), ("demo", end["demo"])):
        T, s = views[ds][vn], P["challenger"][ds][vn]
        on = np.isclose(s, chall.threshold, atol=5e-7)
        above = s > chall.threshold + 5e-7
        rows[f"{ds}:{vn}"] = {"flagged_total": int((s >= chall.threshold).sum()), "flagged_on_plateau": int(on.sum()),
                              "plateau_tp": int((on & (T.y == 1)).sum()), "plateau_fp": int((on & (T.y == 0)).sum()),
                              "plateau_precision": _r(T.y[on].mean()) if on.any() else None,
                              "plateau_rows_history_ge_90d": int((on & (T.history_days >= LONG_HISTORY_DAYS)).sum()),
                              "fp_total": int(((s >= chall.threshold) & (T.y == 0)).sum()),
                              "if_only_rows_above_plateau_were_flagged": short_rates(T.y, above.astype(float), 0.5, T.role),
                              "pr_auc_calibrated": _r(ap(T.y, s)), "pr_auc_raw": _r(ap(T.y, raw["challenger"][ds][vn]))}
    # How the tie produced a threshold whose realised precision is below the target.
    order = np.argsort(-pv, kind="mergesort")
    ys, ps = V.y.to_numpy()[order], pv[order]
    cum = np.cumsum(ys) / np.arange(1, len(ys) + 1)
    i_last = int(np.where(ps >= chall.threshold)[0].max())
    i_first = int(np.where(np.isclose(ps, chall.threshold, atol=5e-7))[0].min())
    plat["pick_threshold_tie_mechanism"] = {
        "pooled_validation_rows_ranked_above_plateau": i_first,
        "cumulative_precision_entering_plateau": _r(cum[i_first]),
        "plateau_rows_in_pooled_validation": i_last - i_first + 1,
        "realised_precision_with_whole_plateau_flagged": _r(cum[i_last]),
        "reading": "recall_at_precision() walks rows one by one in score order and stops inside the tied block of rows "
                   "where cumulative precision is still >= 0.5; applying `score >= threshold` then flags the whole tied "
                   "block, so the realised validation precision falls below the 0.5 target. Sigmoid calibration (the "
                   "champion) has no ties, so its realised precision met the target."}
    plat["by_split"] = rows
    out["isotonic_plateau_at_threshold"] = plat

    # A4. feature contributions (TreeSHAP, log-odds) for long-history negatives; feature drift with history.
    fc = {}
    for ds in ("validation", "cold"):
        T = views[ds]["all_snapshots_pooled"]
        o = (T.role == "ordinary").to_numpy()
        cg = contrib_groups(contribs(chall, T), chall.features)
        cgc = contrib_groups(contribs(champ, T), champ.features)
        fc[ds] = {"challenger_mean_contribution_ordinary_by_as_of_day": {str(int(d)): {k: _r(v, 3) for k, v in cg[o & (T.as_of_day == d).to_numpy()].mean().items()}
                                                                         for d in sorted(T.as_of_day.unique())},
                  "champion_mean_contribution_ordinary_by_as_of_day": {str(int(d)): {k: _r(v, 3) for k, v in cgc[o & (T.as_of_day == d).to_numpy()].mean().items()}
                                                                       for d in sorted(T.as_of_day.unique())}}
    TE = views["cold"][end["cold"]]
    pc, pn = P["challenger"]["cold"][end["cold"]], P["champion"]["cold"][end["cold"]]
    fch, fcm = pc >= chall.threshold, pn >= champ.threshold
    neg_lh = ((TE.y == 0) & (TE.history_days >= LONG_HISTORY_DAYS)).to_numpy()
    c_all = contribs(chall, TE)
    sets = {"challenger_fp_long_history": neg_lh & fch, "challenger_tn_long_history": neg_lh & ~fch,
            "fp_challenger_only": neg_lh & fch & ~fcm, "fp_both_models": neg_lh & fch & fcm, "fp_champion_only": neg_lh & ~fch & fcm}
    top = {}
    for k, msk in sets.items():
        c = c_all[msk]
        g = contrib_groups(c, chall.features).mean()
        top[k] = {"rows": int(msk.sum()), "mean_by_group": {kk: _r(v, 3) for kk, v in g.items()},
                  "top_features_mean_contribution": {f: _r(v, 3) for f, v in c.drop(columns="bias").mean().sort_values(ascending=False).head(8).items()}}
    fc["cold_ledger_end_long_history_negatives_challenger"] = top
    # Counterfactual attribution: remove a group's contribution from the margin and re-apply calibration + threshold.
    margin = c_all.sum(1).to_numpy()
    grp = contrib_groups(c_all, chall.features)
    cf = {}
    for k in ("account_age", "graph"):
        s = chall.calibrated(1 / (1 + np.exp(-(margin - grp[k].to_numpy()))))
        cf[f"without_{k}_contribution"] = short_rates(TE.y, s, chall.threshold, TE.role)
    cf["as_scored"] = short_rates(TE.y, pc, chall.threshold, TE.role)
    cf["reading"] = ("Attribution diagnostic only (not a model): the margin minus one feature group's TreeSHAP "
                     "contribution, calibrated and thresholded as deployed.")
    fc["cold_ledger_end_counterfactual_attribution"] = cf
    drift = {}
    feats = GRAPH_FEATURES + ["sender_forwarders_share", "pass_through_1h", "total_in_log", "distinct_senders_log", "history_days"]
    feats = list(dict.fromkeys(feats))
    for ds in ("validation", "cold"):
        T = views[ds]["all_snapshots_pooled"]
        o = T[T.role == "ordinary"]
        drift[ds] = {f: {str(int(d)): _r(o.loc[o.as_of_day == d, f].mean(), 3) for d in sorted(o.as_of_day.unique())} for f in feats}
    VE_o = views["validation"][end["validation"]].query("role == 'ordinary'")
    CE_o = TE.query("role == 'ordinary'")
    drift["validation_end_vs_cold_end_ordinary_standardised_mean_difference"] = {
        f: _r((CE_o[f].mean() - VE_o[f].mean()) / (np.sqrt((CE_o[f].var() + VE_o[f].var()) / 2) or 1), 3) for f in chall.features}
    fc["ordinary_feature_means_by_as_of_day"] = drift
    out["feature_contributions_and_drift"] = fc

    # A5. label correction effect: same rows, old (planned-role) labels vs current labels.
    lab = {}
    for ds, vn in (("validation", end["validation"]), ("cold", end["cold"]), ("demo", end["demo"])):
        T = views[ds][vn]
        y_old = T.ground_truth_label.isin(SUSPICIOUS_ROLES).astype(int).to_numpy()
        lab[f"{ds}:{vn}"] = {"rows_positive_under_old_negative_under_current": int(((y_old == 1) & (T.y == 0)).sum()),
                             "rows_negative_under_old_positive_under_current": int(((y_old == 0) & (T.y == 1)).sum()),
                             **{mn: {"current_labels": short_rates(T.y, P[mn][ds][vn], m.threshold, T.role),
                                     "old_planned_role_labels": short_rates(y_old, P[mn][ds][vn], m.threshold, T.role)}
                                for mn, m in (("champion", champ), ("challenger", chall))}}
    lab["reading"] = ("Ordinary accounts are negatives under both label sets, so their flag rate cannot move with the "
                      "label correction; only the FPR denominator and the unmaterialised-role rows change.")
    out["label_correction_effect"] = lab

    # A6. FP composition (role group, customer type) and overlap between the two models.
    compo = {}
    for ds, vn in (("validation", end["validation"]), ("cold", end["cold"]), ("demo", end["demo"])):
        T = views[ds][vn]
        fch = P["challenger"][ds][vn] >= chall.threshold
        fcm = P["champion"][ds][vn] >= champ.threshold
        neg = (T.y == 0).to_numpy()
        rg, ct = role_group(T.role), T.customer_type.astype(str).to_numpy()
        hb = tam.history_band(T.history_days.to_numpy())
        def tab(mask):
            return {"total": int(mask.sum()),
                    "by_role_group": {k: int((mask & (rg == k)).sum()) for k in ROLE_GROUPS if (mask & (rg == k)).any()},
                    "by_customer_type": {k: int((mask & (ct == k)).sum()) for k in sorted(set(ct)) if (mask & (ct == k)).any()},
                    "by_history_band": {k: int((mask & (hb == k)).sum()) for k in BAND_NAMES if (mask & (hb == k)).any()}}
        negs_by_ct = {k: int((neg & (ct == k)).sum()) for k in sorted(set(ct))}
        compo[f"{ds}:{vn}"] = {"champion_fp": tab(neg & fcm), "challenger_fp": tab(neg & fch),
                               "fp_both": tab(neg & fcm & fch), "fp_challenger_only": tab(neg & fch & ~fcm),
                               "fp_champion_only": tab(neg & fcm & ~fch), "negatives_by_customer_type": negs_by_ct}
    out["false_positive_composition"] = compo
    return out


def _fit(X: pd.DataFrame, y, feats, params, rounds) -> xgb.Booster:
    p = {"objective": "binary:logistic", "eval_metric": "aucpr", "eta": 0.05, "subsample": 0.8, "colsample_bytree": 0.8,
         "tree_method": "hist", "seed": SEED, "nthread": 4, **params}
    return xgb.train(p, xgb.DMatrix(X[feats].to_numpy(float), label=np.asarray(y), feature_names=feats, missing=np.nan),
                     rounds, verbose_eval=False)


def _pred(b, X, feats):
    return b.predict(xgb.DMatrix(X[feats].to_numpy(float), feature_names=feats, missing=np.nan))


def gap_analysis(tr: pd.DataFrame, va: pd.DataFrame, champ, chall, days: int) -> dict:
    """(b) the train-validation PR-AUC gap (champion 0.125 as reported, challenger 0.159 as reported)."""
    out: dict = {}
    rc = json.loads(CHAMPION_REPORT.read_text()) if CHAMPION_REPORT.exists() else {}
    rh = json.loads(CHALLENGER_REPORT.read_text()) if CHALLENGER_REPORT.exists() else {}
    out["as_reported"] = {
        "champion": {"train_pr_auc": rc.get("results", {}).get("train", {}).get("pr_auc"),
                     "validation_pr_auc": rc.get("results", {}).get("validation", {}).get("pr_auc"),
                     "gap": rc.get("fit_diagnosis", {}).get("train_minus_validation_pr_auc"),
                     "rows": "ledger-end snapshot only, old planned-role labels"},
        "challenger": {"train_pr_auc": rh.get("results", {}).get("train", {}).get("pr_auc"),
                       "validation_pr_auc": rh.get("results", {}).get("validation", {}).get("pr_auc"),
                       "gap": rh.get("fit_diagnosis", {}).get("train_minus_validation_pr_auc"),
                       "rows": "all snapshots (30/60/90/120) pooled, current labels"},
        "reading": "The two reported gaps are measured on different rows (one snapshot vs four pooled snapshots, "
                   "prevalence 7.4% vs 3.6%) and different labels, so they are not directly comparable."}
    like = {}
    for mn, m in (("champion", champ), ("challenger", chall)):
        r = {}
        for name, sel in (("ledger_end", lambda T: T[T.as_of_day == days]), ("all_snapshots_pooled", lambda T: T)) + tuple(
                (f"as_of_day_{d}", (lambda d: lambda T: T[T.as_of_day == d])(d)) for d in tam.SNAPSHOT_DAYS):
            a, b = sel(tr), sel(va)
            pa, pb = ap(a.y, m.calibrated(m.raw_scores(a))), ap(b.y, m.calibrated(m.raw_scores(b)))
            r[name] = {"train_pr_auc": _r(pa), "validation_pr_auc": _r(pb), "gap": _r(pa - pb) if pa is not None and pb is not None else None,
                       "train_rows": int(len(a)), "validation_rows": int(len(b))}
        like[mn] = r
    like["note"] = ("Current labels on identical rows. The champion was fitted on the ledger-end train rows only (with the "
                    "old labels); earlier snapshots of train accounts were never in its fit.")
    out["like_for_like_current_labels"] = like

    # One snapshot per account, near-duplicates.
    one = tr.groupby("account_id", sort=False).sample(n=1, random_state=SEED)
    one_v = va.groupby("account_id", sort=False).sample(n=1, random_state=SEED)
    pch = lambda T: chall.calibrated(chall.raw_scores(T))  # noqa: E731
    pr = lambda T: chall.raw_scores(T)  # noqa: E731
    out["challenger_train_pr_auc_by_row_selection"] = {
        "all_snapshots": {"train": _r(ap(tr.y, pch(tr))), "validation": _r(ap(va.y, pch(va)))},
        "one_random_snapshot_per_account": {"train": _r(ap(one.y, pch(one))), "validation": _r(ap(one_v.y, pch(one_v))),
                                            "train_rows": int(len(one))},
        "all_snapshots_raw_scores_no_isotonic_ties": {"train": _r(ap(tr.y, pr(tr))), "validation": _r(ap(va.y, pr(va)))}}
    feats = chall.features
    S = tr.sort_values(["account_id", "as_of_day"])
    X = S[feats].to_numpy(float)
    same_acc = (S.account_id.to_numpy()[1:] == S.account_id.to_numpy()[:-1])
    eq = np.all((X[1:] == X[:-1]) | (np.isnan(X[1:]) & np.isnan(X[:-1])), axis=1) & same_acc
    nonage = [i for i, f in enumerate(feats) if f not in AGE_FEATURES]
    eq_nonage = np.all((X[1:, nonage] == X[:-1, nonage]) | (np.isnan(X[1:, nonage]) & np.isnan(X[:-1, nonage])), axis=1) & same_acc
    ypos = S.y.to_numpy()
    rows_per = tr.groupby("account_id").size()
    pos_rows_per = tr[tr.y == 1].groupby("account_id").size()
    out["near_duplicate_snapshots_in_train"] = {
        "train_rows": int(len(tr)), "train_accounts": int(tr.account_id.nunique()),
        "mean_rows_per_account": _r(rows_per.mean(), 2),
        "positive_rows": int(tr.y.sum()), "positive_accounts": int(pos_rows_per.size),
        "mean_positive_rows_per_positive_account": _r(pos_rows_per.mean(), 2),
        "consecutive_snapshot_pairs_same_account": int(same_acc.sum()),
        "pairs_identical_on_all_features": int(eq.sum()),
        "pairs_identical_except_account_age_features": int(eq_nonage.sum()),
        "positive_pairs_identical_except_account_age_features": int((eq_nonage & (ypos[1:] == 1) & (ypos[:-1] == 1)).sum()),
        "positive_pairs_total": int((same_acc & (ypos[1:] == 1) & (ypos[:-1] == 1)).sum())}

    # Refits on the train split only (analysis; fixed tree counts from the artifacts, no early stopping on validation).
    cp = {k: v for k, v in chall.meta["params"].items() if k not in ("objective", "eval_metric", "eta", "subsample", "colsample_bytree", "seed")}
    mp = {k: v for k, v in champ.meta["params"].items() if k not in ("objective", "eval_metric", "eta", "subsample", "colsample_bytree", "seed")}
    n_ch, n_cm = chall._booster.num_boosted_rounds(), champ._booster.num_boosted_rounds()
    b0 = _fit(tr, tr.y, feats, cp, n_ch)
    out["refit_reproduces_challenger_artifact"] = {
        "max_abs_raw_score_difference_on_validation": float(np.max(np.abs(_pred(b0, va, feats) - chall.raw_scores(va)))),
        "trees": n_ch}
    tr_end, va_end = tr[tr.as_of_day == days], va[va.as_of_day == days]
    one_idx = one.index
    variants = {
        "challenger_config": (tr, cp, feats, n_ch),
        "challenger_config_min_child_weight_5": (tr, {**cp, "min_child_weight": 5}, feats, n_ch),
        "challenger_config_one_random_snapshot_per_account": (tr.loc[one_idx], cp, feats, n_ch),
        "challenger_config_min_child_weight_5_one_snapshot_per_account": (tr.loc[one_idx], {**cp, "min_child_weight": 5}, feats, n_ch),
        "challenger_config_ledger_end_rows_only": (tr_end, cp, feats, n_ch),
        "champion_config_current_labels_ledger_end_rows_only": (tr_end, mp, champ.features, n_cm),
    }
    ref = {}
    for name, (D, params, fs, rounds) in variants.items():
        D = D.reset_index(drop=True)
        b = b0 if name == "challenger_config" else _fit(D, D.y, fs, params, rounds)
        oof = np.zeros(len(D))
        for f in group_folds(D["group"].to_numpy(), k=5):
            rest = np.setdiff1d(np.arange(len(D)), f)
            oof[f] = _pred(_fit(D.iloc[rest], D.y.iloc[rest], fs, params, rounds), D.iloc[f], fs)
        tr_in = _r(ap(D.y, _pred(b, D, fs)))
        ref[name] = {"train_rows": int(len(D)), "train_positives": int(D.y.sum()), "trees": rounds,
                     "min_child_weight": params.get("min_child_weight"),
                     "train_in_sample_pr_auc": tr_in, "train_group_5fold_out_of_fold_pr_auc": _r(ap(D.y, oof)),
                     "validation_pr_auc_all_snapshots": _r(ap(va.y, _pred(b, va, fs))),
                     "validation_pr_auc_ledger_end": _r(ap(va_end.y, _pred(b, va_end, fs))),
                     "in_sample_minus_out_of_fold": _r(tr_in - ap(D.y, oof))}
    ref["note"] = ("Raw (uncalibrated) scores. Folds keep scenario instances together (modeling.group_folds). Validation "
                   "is reported, never used to choose anything here.")
    out["refits_train_split_only_analysis"] = ref

    # Learning curve: challenger configuration on growing subsets of train groups.
    groups = tr["group"].unique()
    perm = np.random.default_rng(SEED).permutation(groups)
    lc = {}
    for frac in LC_FRACTIONS:
        keep = set(perm[: int(round(frac * len(groups)))])
        D = tr[tr.group.isin(keep)].reset_index(drop=True)
        b = b0 if frac == 1.0 else _fit(D, D.y, feats, cp, n_ch)
        lc[str(frac)] = {"train_rows": int(len(D)), "train_positives": int(D.y.sum()),
                         "train_in_sample_pr_auc": _r(ap(D.y, _pred(b, D, feats))),
                         "validation_pr_auc_all_snapshots": _r(ap(va.y, _pred(b, va, feats))),
                         "validation_pr_auc_ledger_end": _r(ap(va_end.y, _pred(b, va_end, feats)))}
    out["learning_curve_challenger_config"] = lc
    return out


# ---------------------------------------------------------------------------------------------- main
def main(cache: Path | None = None, out_path: Path = OUT) -> dict:
    t0 = time.perf_counter()
    served.clear_cache()
    champ, chall = served.load(CHAMPION, ART), served.load(CHALLENGER, ART)
    tabs = load_tables(cache)
    TA = tabs["train"]
    TAu = TA[TA.usable].reset_index(drop=True)
    val = tam.split_groups(TAu["group"])          # exactly as train_account_model.main()
    tr, va = TAu[~val].reset_index(drop=True), TAu[val].reset_index(drop=True)
    days = {k: int(t["ledger_days"].iloc[0]) for k, t in tabs.items()}

    views: dict = {"validation": {}, "cold": {}, "demo": {}}
    for ds, T in (("validation", va), ("cold", tabs["cold"]), ("demo", tabs["demo"])):
        T = T[T.usable].reset_index(drop=True)
        dd = days["train" if ds == "validation" else ds]
        for d in sorted(T.as_of_day.unique()):
            key = f"ledger_end_day_{d}" if d == dd else f"as_of_day_{d}"
            views[ds][key] = T[T.as_of_day == d].reset_index(drop=True)
        views[ds]["all_snapshots_pooled"] = T
    P = {mn: {ds: {vn: m.calibrated(m.raw_scores(T)) for vn, T in vs.items()} for ds, vs in views.items()}
         for mn, m in (("champion", champ), ("challenger", chall))}

    def describe(m, name):
        d = ART / name
        return {"model_version": m.version, "path": str(d), "served": name == CHAMPION, "family": m.meta.get("family"),
                "feature_set": m.meta.get("feature_set"), "features": len(m.features),
                "uses_account_age_features": sorted(set(AGE_FEATURES) & set(m.features)),
                "uses_graph_features": sorted(set(GRAPH_FEATURES) & set(m.features)),
                "trees": int(m._booster.num_boosted_rounds()), "params": m.meta.get("params"),
                "calibration": m.meta["calibration"]["method"], "threshold": m.threshold,
                "threshold_rule": m.meta["threshold"].get("rule"), "threshold_chosen_on": m.meta["threshold"].get("chosen_on"),
                "label_definition_at_training": m.meta.get("label_definition"),
                "model_json_sha256": sha256(d / "model.json")}

    report = {
        "report": "account model champion/challenger analysis", "environment": environment(),
        "decision": "stays with the owner; nothing in this report changes which model is served",
        "models": {"champion": describe(champ, CHAMPION), "challenger": describe(chall, CHALLENGER)},
        "method": {
            "labels": tam.LABEL_DEFINITION + " Both models are scored on these current labels.",
            "rows": "train_account_model.Ledger snapshots, usable rows only (>= 5 transactions by as_of, not secondary "
                    "victim, not in-progress); validation = split_groups() on the training ledger exactly as in "
                    "train_account_model.main(); cold and demo ledgers in full.",
            "as_of_days": {"validation": sorted(int(d) for d in va.as_of_day.unique()),
                           "cold": sorted(int(d) for d in views["cold"]["all_snapshots_pooled"].as_of_day.unique()),
                           "demo": sorted(int(d) for d in views["demo"]["all_snapshots_pooled"].as_of_day.unique())},
            "thresholds": "each model at the threshold stored in its artifact (champion 0.052098, chosen on its own "
                          "old-label ledger-end validation; challenger 0.057471, chosen on pooled-snapshot validation); "
                          "applied to calibrated scores as served",
            "metrics": "precision/recall/FPR at the threshold; PR-AUC = average precision; 95% CI = 300 bootstrap "
                       "resamples of whole scenario instances (ordinary accounts are their own group), computed when a "
                       f"cohort has >= {CI_MIN_POSITIVES} positive rows in >= {CI_MIN_POSITIVE_GROUPS} instances; Brier; "
                       "ECE and the reliability table use 10 equal-count bins (evaluation.ece / evaluation.reliability); "
                       "reliability rows are [n, mean_score, observed_rate].",
            "cohorts": {"history_days": BAND_NAMES, "true_role_group": list(ROLE_GROUPS),
                        "customer_type_evaluation_slice_only": "accounts.customer_type; an evaluation slice, never a model input",
                        "unmaterialised_scenario_role": "planned scenario role whose defining transfers had not happened by as_of"},
            "test_sets": "Both models are frozen; cold and demo are scored here with no choice depending on them. These "
                         "ledgers were already scored by each model's own training report; this is a re-scoring on the "
                         "current labels, not a new selection.",
            "ground_truth": "read by this evaluator only; backend/app inference never reads it"},
        "provenance_check_champion": provenance_check(TA, champ, tabs["cold"], tabs["demo"]),
        "evaluation": evaluation(views, {"champion": (champ, P["champion"]), "challenger": (chall, P["challenger"])}),
    }
    report["analysis_a_long_history_false_positives"] = long_history_fp_analysis(views, P, champ, chall, va)
    report["analysis_b_train_validation_gap"] = gap_analysis(tr, va, champ, chall, days["train"])
    report["conclusion"] = conclusion(report)
    report["runtime_seconds"] = round(time.perf_counter() - t0, 1)
    out_path.write_text(json.dumps(report, indent=1, default=str))
    return report


def conclusion(r: dict) -> dict:
    """Findings assembled from the measured numbers above (every figure is a key elsewhere in this report)."""
    ev = r["evaluation"]
    end = {ds: [k for k in ev[ds] if k.startswith("ledger_end")][0] for ds in ev}
    ve, ce, de = end["validation"], end["cold"], end["demo"]
    g = lambda ds, vn, m, k: ev[ds][vn][m]["overall"][k]  # noqa: E731
    a = r["analysis_a_long_history_false_positives"]
    ts = a["threshold_selection"]
    alt = ts["challenger_alternative_thresholds_analysis_only_not_deployed"]
    plat = a["isotonic_plateau_at_threshold"]
    pc = plat["by_split"][f"cold:{ce}"]
    fc = a["feature_contributions_and_drift"]
    b = r["analysis_b_train_validation_gap"]
    rf = b["refits_train_split_only_analysis"]
    lk = b["like_for_like_current_labels"]
    lc = b["learning_curve_challenger_config"]
    nd = b["near_duplicate_snapshots_in_train"]
    lab = a["label_correction_effect"][f"cold:{ce}"]
    comp = a["false_positive_composition"][f"cold:{ce}"]
    ta = alt["tie-aware precision>=0.5 on pooled validation (calibrated)"]
    eo = alt["pick_threshold on validation ledger-end rows only (calibrated)"]
    rw = alt["pick_threshold on pooled validation, raw (pre-calibration, no ties)"]
    mt = alt["matched to champion's validation ledger-end FPR (raw scores)"]
    cref = ts["champion_at_its_deployed_threshold_for_reference"][f"cold:{ce}"]
    days = sorted(fc["cold"]["challenger_mean_contribution_ordinary_by_as_of_day"], key=int)
    c0, c1 = (fc["cold"]["challenger_mean_contribution_ordinary_by_as_of_day"][d] for d in (days[0], days[-1]))
    cf = fc["cold_ledger_end_counterfactual_attribution"]
    lh = fc["cold_ledger_end_long_history_negatives_challenger"]
    shares = [v["share_of_rows"] for v in ts["pooled_validation_rows_by_history_band"].values()]
    fpr_day = {m: [a["fpr_by_as_of_day"]["cold"][k][m]["false_positive_rate"] for k in a["fpr_by_as_of_day"]["cold"]]
               for m in ("champion", "challenger")}
    return {
        "headline_current_labels_ledger_end": {
            f"{ds}:{vn}": {m: {k: g(ds, vn, m, k) for k in ("pr_auc", "pr_auc_95ci_bootstrap_by_scenario", "precision", "recall",
                                                            "false_positive_rate", "brier", "ece")}
                           for m in ("champion", "challenger")}
            for ds, vn in (("validation", ve), ("cold", ce), ("demo", de))},
        "a_long_history_false_positives": {
            "not_cold_specific": (
                f"Validation already shows it: ledger-end FPR champion {g('validation', ve, 'champion', 'false_positive_rate')} vs "
                f"challenger {g('validation', ve, 'challenger', 'false_positive_rate')}; cold {g('cold', ce, 'champion', 'false_positive_rate')} vs "
                f"{g('cold', ce, 'challenger', 'false_positive_rate')}. Validation and cold feature distributions of ordinary accounts "
                f"at the ledger end are close (ordinary_feature_means_by_as_of_day). The promotion rule did not look at long-history FPR."),
            "H1_pooled_threshold_dominated_by_short_history: not supported": (
                f"Pooled validation rows are split evenly across history bands (shares {shares}). Re-selecting with the same "
                f"rule on validation ledger-end rows only gives the same threshold ({eo['threshold']}), because of H2."),
            "H2_isotonic_step_at_threshold: supported, main cause": (
                f"The threshold equals the isotonic plateau for raw scores {plat['plateau_raw_score_interval']}. On cold at the ledger end "
                f"{pc['flagged_on_plateau']} of {pc['flagged_total']} flags lie on that plateau: {pc['plateau_fp']} of the {pc['fp_total']} false "
                f"positives, at plateau precision {pc['plateau_precision']}. pick_threshold()/recall_at_precision() stops inside the tied "
                f"block, so the realised pooled-validation precision at the deployed threshold is "
                f"{ts['realised_validation_precision_at_deployed_threshold']['challenger (pooled validation, current labels)']}, not >= 0.5. "
                f"Analysis only (chosen on validation): a tie-aware threshold ({ta['threshold']}) gives cold ledger-end FPR "
                f"{ta[f'cold:{ce}']['false_positive_rate']} / recall {ta[f'cold:{ce}']['recall']} (champion {cref['false_positive_rate']} / "
                f"{cref['recall']}); the same rule on raw scores ({rw['threshold']}) gives {rw[f'cold:{ce}']['false_positive_rate']} / "
                f"{rw[f'cold:{ce}']['recall']}; matched to the champion's validation ledger-end FPR (raw) gives "
                f"{mt[f'cold:{ce}']['false_positive_rate']} / {mt[f'cold:{ce}']['recall']}."),
            "H3_features_drift_with_history: supported as a residual slope, not the main cause": (
                f"Cold FPR by as_of day {list(a['fpr_by_as_of_day']['cold'])}: champion {fpr_day['champion']}, challenger "
                f"{fpr_day['challenger']}. For ordinary accounts the challenger's mean TreeSHAP contribution moves from day {days[0]} to "
                f"day {days[-1]}: behaviour {c0['behaviour']} -> {c1['behaviour']}, graph {c0['graph']} -> {c1['graph']}, account age "
                f"{c0['account_age']} -> {c1['account_age']} (log-odds). Long-history false positives that only the challenger flags "
                f"carry graph contribution {lh['fp_challenger_only']['mean_by_group']['graph']} vs {lh['challenger_tn_long_history']['mean_by_group']['graph']} "
                f"for long-history true negatives, led by sender_forwarders_share. Removing the graph contribution would raise the "
                f"cold ledger-end FPR to {cf['without_graph_contribution']['false_positive_rate']} and removing the account-age contribution "
                f"to {cf['without_account_age_contribution']['false_positive_rate']} (as scored {cf['as_scored']['false_positive_rate']}): "
                f"neither feature group adds false positives overall. Even with the tie-aware threshold the challenger's cold FPR still "
                f"rises with history ({ta['cold:all_snapshots_pooled']['fpr_by_history_band']})."),
            "H4_label_correction: not a cause": (
                f"Ordinary accounts are negatives under both label sets; ordinary flag rates are identical under old and current labels "
                f"(challenger {lab['challenger']['old_planned_role_labels']['ordinary_flag_rate']}, champion "
                f"{lab['champion']['old_planned_role_labels']['ordinary_flag_rate']}). Cold ledger-end FPR under old labels: champion "
                f"{lab['champion']['old_planned_role_labels']['false_positive_rate']}, challenger {lab['challenger']['old_planned_role_labels']['false_positive_rate']}."),
            "false_positive_composition": (
                f"Cold ledger end: challenger FPs {comp['challenger_fp']['by_role_group']} by role, {comp['challenger_fp']['by_customer_type']} "
                f"by customer type, {comp['challenger_fp']['by_history_band']} by history; champion FPs {comp['champion_fp']['by_role_group']}. "
                f"FPs flagged only by the challenger: {comp['fp_challenger_only']['total']} ({comp['fp_challenger_only']['by_history_band']}). "
                f"At the deployed thresholds the challenger flags more victims and innocent counterparties at the ledger end "
                f"(see evaluation.cold.{ce}.*.cohorts.true_role_group); with the tie-aware threshold: "
                f"{ta[f'cold:{ce}']['flag_rate_by_negative_role_group']}."),
        },
        "b_train_validation_gap": {
            "reported_gaps_are_not_like_for_like": b["as_reported"]["reading"],
            "like_for_like_ledger_end_current_labels": (
                f"champion {lk['champion']['ledger_end']['gap']} vs challenger {lk['challenger']['ledger_end']['gap']}; pooled snapshots "
                f"champion {lk['champion']['all_snapshots_pooled']['gap']} vs challenger {lk['challenger']['all_snapshots_pooled']['gap']}. "
                f"The challenger's train PR-AUC is ~1.0 at every as_of day; its validation PR-AUC is lowest at day 30 "
                f"({lk['challenger']['as_of_day_30']['validation_pr_auc']}), which is what widens the pooled gap."),
            "H_min_child_weight_1_with_near_duplicate_snapshots: not supported": (
                f"{nd['pairs_identical_on_all_features']} of {nd['consecutive_snapshot_pairs_same_account']} consecutive snapshot pairs are "
                f"identical ({nd['pairs_identical_except_account_age_features']} identical apart from account age). min_child_weight=5 "
                f"changes in-sample/out-of-fold PR-AUC from {rf['challenger_config']['train_in_sample_pr_auc']}/"
                f"{rf['challenger_config']['train_group_5fold_out_of_fold_pr_auc']} to "
                f"{rf['challenger_config_min_child_weight_5']['train_in_sample_pr_auc']}/{rf['challenger_config_min_child_weight_5']['train_group_5fold_out_of_fold_pr_auc']}; "
                f"one snapshot per account: in-sample {rf['challenger_config_one_random_snapshot_per_account']['train_in_sample_pr_auc']}, "
                f"and the frozen challenger's train PR-AUC on one snapshot per account is "
                f"{b['challenger_train_pr_auc_by_row_selection']['one_random_snapshot_per_account']['train']}."),
            "what_the_gap_is": (
                f"In-sample saturation of {rf['challenger_config']['trees']} depth-4 trees, not leakage: group 5-fold out-of-fold PR-AUC "
                f"inside train is {rf['challenger_config']['train_group_5fold_out_of_fold_pr_auc']}, close to validation "
                f"{rf['challenger_config']['validation_pr_auc_all_snapshots']} (raw scores). The champion's configuration refitted on "
                f"current labels shows the same pattern ({rf['champion_config_current_labels_ledger_end_rows_only']['in_sample_minus_out_of_fold']} "
                f"in-sample minus out-of-fold). Isotonic ties also cost pooled validation PR-AUC "
                f"{b['challenger_train_pr_auc_by_row_selection']['all_snapshots_raw_scores_no_isotonic_ties']['validation']} (raw) -> "
                f"{b['challenger_train_pr_auc_by_row_selection']['all_snapshots']['validation']} (calibrated)."),
            "learning_curve": (
                "validation PR-AUC (pooled) by share of train groups: "
                + ", ".join(f"{k}: {v['validation_pr_auc_all_snapshots']}" for k, v in lc.items())
                + "; still rising, so more training scenarios should help more than regularisation."),
        },
        "recommendation_for_the_owner": [
            "Keep v3-account-1.0.0 served. Do not promote the v3-account-1.1.0 artifact as it is: its stored threshold violates its own "
            "precision >= 0.5 rule on validation because of the isotonic tie, and at that threshold it flags more long-history "
            "ordinary accounts, victims and innocent counterparties than the champion at the ledger end.",
            "On ranking at the ledger end the two are close on validation and cold (PR-AUC intervals overlap; at the champion's "
            "validation FPR the challenger's cold recall is slightly lower and its cold FPR lower, see the 'matched' analysis "
            "threshold), better on the demo ledger, and better calibrated (Brier, ECE). Its clear gain is on short histories and "
            "earlier snapshots (fpr_by_history_band_all_snapshots, fpr_by_as_of_day), which the champion never saw in training "
            "(ledger-end rows only) and where the champion flags about a third of negatives under 30 days of history.",
            "Conditions for replacement: (1) threshold selection that keeps tied scores together (or selection on raw scores), chosen on "
            "validation only; (2) a promotion rule that also requires validation FPR on >= 90-day histories and the flag rates of "
            "victims and innocent counterparties to be no worse than the champion's; (3) because this report has now shown cold/demo "
            "results for the analysis thresholds, confirmation on a fresh ledger (new seed) that no choice has seen, scored once.",
            "Worth testing next, on train/validation only: a feature set with graph features but without account-age features, and "
            "more training scenario instances (the learning curve has not flattened). The residual rise of FPR with history length "
            "should be tracked as its own validation metric.",
        ],
    }


if __name__ == "__main__":  # pragma: no cover
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--cache", type=Path, default=None, help="optional directory to cache snapshot tables (development)")
    ap_.add_argument("--out", type=Path, default=OUT)
    a_ = ap_.parse_args()
    rep = main(a_.cache, a_.out)
    print(json.dumps(rep["conclusion"], indent=1, default=str)[:6000])
    print("runtime", rep["runtime_seconds"])
