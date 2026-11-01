"""Models B and C: account behaviour risk, with and without graph (network) features.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.train_account_model

Target (per account and as_of date): by that date the account had been used to receive and pass on scenario money
(intermediary: it had both received and sent money of its scenario) or to collect it (attacker_controlled: it had
received money of its scenario). This is the generator's "materialised" rule evaluated at the as_of date, so an
account is never a positive merely for receiving money, and a suspicious role whose defining transfers never happened
is a negative ("not_materialised:<role>"), not a positive. Victims, innocent counterparties, look-alikes and ordinary
accounts are negatives. Excluded from fitting and metrics (counted, flag rates reported separately):
* secondary victims (exploited and forwarding at the same time);
* "in progress" snapshots: some scenario transfer of a suspicious role had happened but the defining set had not
  (e.g. received, not yet sent) - neither label is right at that instant;
* accounts with fewer than MIN_ACCOUNT_TRANSACTIONS records by as_of (the served model abstains).

Snapshots: every account is described at several as_of dates (SNAPSHOT_DAYS and the ledger's last day) using only its
records up to that date (features.account_features / graph_features filter on timestamp <= as_of). This trains and
evaluates the model on short histories as well as long ones; served investigations see both.

Splits
* Training ledger: accounts split 75/25 into train/validation by scenario instance (all accounts of one instance and
  all of their snapshots stay together) and by account for ordinary accounts. Family, feature set, early stopping,
  calibration and threshold use validation only.
* Temporal (out-of-time) test, training ledger: a separate fit using only snapshots up to day TEMPORAL_CUTOFF_DAY of
  scenario instances that ended before it (plus ordinary accounts), the same selection procedure on its own
  validation part, then scored once as of the ledger end on instances that started after the cutoff plus held-out
  ordinary accounts.
* Cold ledger (disjoint IDs, held-out variants) and the served demo ledger: scored once.

Output: the new model is ALWAYS written as the challenger, ml/artifacts/v3/account_model_challenger/, with its report at
ml/reports/account_model_v3_challenger.json. The served model (champion) at ml/artifacts/v3/account_model/ is never
overwritten by a default run. The promotion rule is still evaluated against the served champion on the same, current
labels and reported: validation PR-AUC at the ledger end not lower than the champion's by more than
PROMOTION_MAX_PR_AUC_DROP, and validation false-positive rate on short histories (< SHORT_HISTORY_DAYS days of records)
lower. Only with the explicit --promote flag (off by default) AND a passing rule is the champion copied to
account_model_previous/ (for rollback) and the new model also written to account_model/. Promotion is the owner's call.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.intelligence import models as served
from backend.app.intelligence.features import (
    ACCOUNT_FEATURES, FEATURE_SCHEMA_VERSION, FORBIDDEN_INPUTS, GRAPH_FEATURES, MIN_ACCOUNT_TRANSACTIONS, account_features,
    graph_features,
)
from backend.app.intelligence.schema import validate_transactions
from ml.forensics.adapters import forensic_frame
from ml.forensics.evaluation import bootstrap_pr_auc, metrics, pick_threshold, reliability, threshold_record
from ml.forensics.generator import GENERATOR_VERSION, HELD_OUT_VARIANTS, LEDGERS, SUSPICIOUS_ROLES, generate_ledger
from ml.forensics.modeling import (
    RANGE_CHECK_EXCLUDED, SEED, choose_calibration, environment, export, feature_importance, fit_forest, fit_logistic,
    fit_xgb, quick, training_ranges,
)

SERVED = Path("ml/artifacts/v3/account_model")              # the champion; written only with --promote
CHALLENGER = Path("ml/artifacts/v3/account_model_challenger")  # default output of every run
PREVIOUS = Path("ml/artifacts/v3/account_model_previous")      # champion copy kept for rollback when promoting
REPORT = Path("ml/reports/account_model_v3_challenger.json")    # the champion's own report (account_model_v3.json) is kept
MODEL_VERSION = "v3-account-1.1.0"
PRECISION_TARGET = 0.5
MIN_GAIN = 0.01
VAL_FRAC = 0.25
SNAPSHOT_DAYS = (30, 60, 90)  # plus each ledger's last day
TEMPORAL_CUTOFF_DAY = 84
PRE_SCENARIO_GRID_DAYS = 7
PRE_SCENARIO_ORDINARY_SAMPLE = 600
HISTORY_BANDS = ((0.0, 30.0, "<30 days"), (30.0, 60.0, "30-60 days"), (60.0, 90.0, "60-90 days"), (90.0, np.inf, ">=90 days"))
SHORT_HISTORY_DAYS = 60.0
PROMOTION_MAX_PR_AUC_DROP = 0.01
NO_AGE = [f for f in ACCOUNT_FEATURES if f not in ("history_days", "active_days_log")]
ROLE_PRIORITY = ("innocent_counterparty", "victim", "secondary_victim", "intermediary", "attacker_controlled")
IN_PROGRESS_ROLES = ("intermediary", "attacker_controlled", "secondary_victim")
LABEL_DEFINITION = (
    f"positive at an as_of date if the account held a role in {SUSPICIOUS_ROLES} that had materialised by that date: "
    "intermediary = it had received AND sent money of its scenario; attacker_controlled = it had received money of its "
    "scenario (the generator's corrected 'materialised' rule, evaluated at as_of). Unmaterialised suspicious roles, "
    "victims, innocent counterparties, look-alikes and ordinary accounts are negatives.")


# ---------------------------------------------------------------------------------------------- data
def _secs(ts) -> np.ndarray:
    return pd.to_datetime(pd.Series(ts)).astype("datetime64[s]").astype(np.int64).to_numpy().astype(float)


def role_times(L) -> pd.DataFrame:
    """Each (account, scenario, role) with the time its role materialised (NaN = never) and the time of its first
    scenario transfer. Mirrors generator.materialised(), evaluated in time; checked against it."""
    tx = L.transactions[L.transactions.scenario_id.notna()]
    t = _secs(pd.to_datetime(tx["timestamp"], utc=True).dt.tz_localize(None))
    ev = pd.DataFrame({"o": tx["origin_account_id"].to_numpy(), "d": tx["destination_account_id"].to_numpy(),
                       "s": tx["scenario_id"].to_numpy(), "tag": tx["scenario_tag"].to_numpy(), "t": t})
    sent = ev.groupby(["o", "s"])["t"].min()
    recv = ev.groupby(["d", "s"])["t"].min()
    drain = ev[ev.tag == "secondary_victim_drain"].groupby(["o", "s"])["t"].min()
    r = L.roles[["account_id", "scenario_id", "role"]].copy()
    key = pd.MultiIndex.from_frame(r[["account_id", "scenario_id"]])
    s, rc, dr = (x.reindex(key).to_numpy(dtype=float) for x in (sent, recv, drain))
    role = r["role"].to_numpy()
    mat = np.where(role == "intermediary", np.maximum(s, rc),
          np.where(role == "victim", s,
          np.where(role == "secondary_victim", np.maximum(s, dr),
          np.where(np.isin(role, ["attacker_controlled", "innocent_counterparty"]), rc, np.fmin(s, rc)))))
    r["mat_time"], r["first_touch"] = mat, np.fmin(s, rc)
    assert (np.isfinite(mat) == L.roles["materialised"].to_numpy(dtype=bool)).all(), "role timing disagrees with generator"
    return r


class Ledger:
    """One generated ledger with cached point-in-time account snapshots."""

    def __init__(self, name: str):
        self.name = name
        self.L = generate_ledger(name)
        self.df, self.rep = validate_transactions(forensic_frame(self.L))
        self.start = pd.Timestamp(self.L.config.start).tz_convert(None)
        self.days = int(self.L.config.days)
        acc = self.L.accounts
        self.accs = acc.loc[acc.ground_truth_label != "cash_network", "account_id"].tolist()
        a = acc.set_index("account_id").reindex(self.accs)
        self.base_label = a["ground_truth_label"].fillna("ordinary")
        self.group = a["scenario_id"].fillna(pd.Series(self.accs, index=self.accs))
        held = self.L.scenarios.set_index("scenario_id")
        self.variant = self.group.map(lambda g: f"{held.at[g, 'pattern']}:{held.at[g, 'variant']}" if g in held.index else "")
        self.roles = role_times(self.L)
        self._feat: dict[int, pd.DataFrame] = {}

    def as_of(self, day: int) -> pd.Timestamp:
        return self.start + pd.Timedelta(days=int(day))

    def snapshot_days(self) -> list[int]:
        return sorted({d for d in SNAPSHOT_DAYS if d < self.days} | {self.days})

    def features(self, day: int, accs: list[str] | None = None) -> pd.DataFrame:
        if accs is None:
            if day not in self._feat:
                self._feat[day] = self._compute(day, self.accs)
            return self._feat[day]
        return self._compute(day, accs)

    def _compute(self, day: int, accs: list[str]) -> pd.DataFrame:
        t = self.as_of(day)
        return account_features(self.df, accs, t).join(graph_features(self.df, accs, t))

    def snapshot(self, day: int, accs: list[str] | None = None) -> pd.DataFrame:
        """Rows for ``accs`` (default: all) as of ``day`` with point-in-time labels and features."""
        accs = self.accs if accs is None else list(dict.fromkeys(accs))
        cut = float(_secs([self.as_of(day)])[0])
        role = self.base_label.reindex(accs).copy()
        scen = role.isin(ROLE_PRIORITY)
        role[scen] = "not_materialised:" + role[scen]
        r = self.roles[self.roles.account_id.isin(set(accs))]
        done = r[r.mat_time <= cut]
        for name in ROLE_PRIORITY:
            role.loc[role.index.isin(done.loc[done.role == name, "account_id"])] = name
        y = role.isin(SUSPICIOUS_ROLES)
        # Started but not yet complete; a role that never completes (e.g. only ever received) is a plain negative.
        pending = r[r.role.isin(IN_PROGRESS_ROLES) & (r.first_touch <= cut) & (r.mat_time > cut)]
        in_prog = role.index.isin(pending.account_id) & ~y.to_numpy() & (role != "secondary_victim").to_numpy()
        f = self.features(day, None if accs is self.accs else accs).reindex(accs)
        t = pd.DataFrame({"account_id": accs, "as_of_day": day, "role": role.to_numpy(), "group": self.group.reindex(accs).to_numpy(),
                          "variant": self.variant.reindex(accs).to_numpy(), "in_progress": in_prog, "y": y.astype(int).to_numpy()})
        t = pd.concat([t, f.reset_index(drop=True)], axis=1)
        t["usable"] = (t["n_transactions"] >= MIN_ACCOUNT_TRANSACTIONS) & (t["role"] != "secondary_victim") & ~t["in_progress"]
        return t

    def snapshots(self, days=None, accs=None) -> pd.DataFrame:
        """Whole-ledger snapshots (features cached per day), optionally restricted to ``accs``."""
        keep = None if accs is None else set(accs)
        parts = [self.snapshot(d) for d in (days or self.snapshot_days())]
        return pd.concat([t if keep is None else t[t.account_id.isin(keep)] for t in parts], ignore_index=True)


def group_hash(groups: pd.Series) -> np.ndarray:
    return groups.map(lambda g: int(hashlib.sha256(f"{SEED}:{g}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF).to_numpy()


def split_groups(groups: pd.Series, frac_val: float = VAL_FRAC) -> np.ndarray:
    return group_hash(groups) < frac_val


def history_band(h: np.ndarray) -> np.ndarray:
    out = np.full(len(h), "", dtype=object)
    for lo, hi, name in HISTORY_BANDS:
        out[(h >= lo) & (h < hi)] = name
    return out


# ---------------------------------------------------------------------------------------------- evaluation
def _rates(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    pred = p >= thr
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    pos, neg = int(y.sum()), int((y == 0).sum())
    return {"n": int(len(y)), "positives": pos, "negatives": neg, "flagged": int(pred.sum()), "tp": tp, "fp": fp,
            "precision": round(tp / pred.sum(), 4) if pred.sum() else None, "recall": round(tp / pos, 4) if pos else None,
            "false_positive_rate": round(fp / neg, 4) if neg else None,
            "pr_auc": quick(y, p)["pr_auc"] if 0 < pos < len(y) else None}


def strata(y, p, thr, keys) -> dict:
    y, p, keys = np.asarray(y).astype(int), np.asarray(p, float), np.asarray(keys)
    names = [b[2] for b in HISTORY_BANDS]
    order = names if set(keys) <= set(names) else sorted(set(keys), key=lambda k: (len(str(k)), str(k)))
    return {str(k): _rates(y[keys == k], p[keys == k], thr) for k in order if (keys == k).any()}


def evaluate(T: pd.DataFrame, p: np.ndarray, thr: float, split: str, ci: bool = True) -> dict:
    """Metrics on usable rows of a snapshot table, with history-length and as_of strata and role flag rates."""
    y = T["y"].to_numpy()
    m = metrics(y, p, thr, split, ks=(25, 50, 100))
    if ci:
        m["pr_auc_95ci_bootstrap_by_scenario"] = bootstrap_pr_auc(y, p, T["group"].to_numpy())
        m["scenario_instances_with_positives"] = int(T.loc[T.y == 1, "group"].nunique())
    m["accounts"] = int(T["account_id"].nunique())
    m["by_history_days"] = strata(y, p, thr, history_band(T["history_days"].to_numpy()))
    if T["as_of_day"].nunique() > 1:
        m["by_as_of_day"] = strata(y, p, thr, T["as_of_day"].astype(str).to_numpy())
    flags = pd.Series(p >= thr, index=T.index)
    by_role = T.assign(flag=flags).groupby("role")["flag"].agg(["count", "mean"])
    m["flag_rate_by_role"] = {r: {"rows": int(c), "flag_rate": round(float(v), 4)} for r, (c, v) in by_role.iterrows()}
    return m


def excluded_counts(T: pd.DataFrame, score) -> dict:
    """What evaluate() does not see, and how the model treats it (reported, never in the metrics)."""
    few = T["n_transactions"] < MIN_ACCOUNT_TRANSACTIONS
    out = {"abstained_insufficient_history": int(few.sum()), "abstained_positives": int((few & (T.y == 1)).sum())}
    for name, mask in (("secondary_victims", (T.role == "secondary_victim") & ~few), ("in_progress", T.in_progress & ~few)):
        out[f"{name}_rows"] = int(mask.sum())
        if mask.any():
            p, thr = score(T[mask])
            out[f"{name}_flag_rate"] = round(float((p >= thr).mean()), 4)
    return out


# ---------------------------------------------------------------------------------------------- selection
def select(tr_t: pd.DataFrame, va_t: pd.DataFrame) -> dict:
    """The selection procedure: candidates per feature set fitted on train, compared on validation PR-AUC; simplest set
    unless a richer one gains >= MIN_GAIN; calibration (grouped cross-fit) and threshold on validation."""
    ytr, yva = tr_t.y.to_numpy(), va_t.y.to_numpy()
    spw = float((ytr == 0).sum() / max(ytr.sum(), 1))
    families = {}
    sets = (("behaviour_without_account_age", NO_AGE), ("behaviour_only", ACCOUNT_FEATURES),
            ("behaviour_plus_graph", ACCOUNT_FEATURES + GRAPH_FEATURES))
    for fs_name, feats in sets:
        assert not set(feats) & FORBIDDEN_INPUTS
        cands = [fit_logistic(tr_t, ytr, c, feats) for c in (0.03, 0.3, 3.0)]
        cands += [fit_forest(tr_t, ytr, d, l, feats) for d, l in ((6, 10), (12, 3))]
        cands += [fit_xgb(tr_t, ytr, va_t, yva, {"max_depth": d, "min_child_weight": m, "lambda": l, "alpha": 0.5,
                                                   "scale_pos_weight": round(np.sqrt(spw), 2)}, feats)
                  for d in (3, 4) for m in (1, 5) for l in (1, 10)]
        rows = [{"family": c.family, "params": {k: v for k, v in c.params.items() if k not in ("objective", "eval_metric", "nthread", "tree_method", "seed")},
                 "train": quick(ytr, c.predict(tr_t)), "validation": quick(yva, c.predict(va_t)), "best_iteration": c.best_iteration}
                for c in cands]
        exportable = [i for i, c in enumerate(cands) if c.family != "random_forest"]
        bi = max(exportable, key=lambda i: rows[i]["validation"]["pr_auc"])
        families[fs_name] = {"candidates": rows, "best": cands[bi], "best_row": rows[bi],
                             "best_any_family": max(rows, key=lambda r: r["validation"]["pr_auc"])}
    vpr = {k: families[k]["best_row"]["validation"]["pr_auc"] for k, _ in sets}
    chosen = sets[0][0]
    for k, _ in sets[1:]:
        if vpr[k] - vpr[chosen] >= MIN_GAIN:
            chosen = k
    best = families[chosen]["best"]
    raw_va = best.predict(va_t)
    cal = choose_calibration(yva, raw_va, groups=va_t["group"].to_numpy())
    scorer = served.ScoringModel("tmp", {"model_version": "tmp", "threshold": {"value": 0.5, "on": "calibrated"}, "calibration": cal}, best.features)
    thr, rule = pick_threshold(yva, scorer.calibrated(raw_va), PRECISION_TARGET)
    return {"families": families, "chosen_set": chosen, "vpr": vpr, "best": best, "cal": cal, "thr": thr, "rule": rule,
            "prob": lambda X: scorer.calibrated(best.predict(X))}


# ---------------------------------------------------------------------------------------------- experiments
def temporal_test(LA: Ledger) -> dict:
    """Out-of-time test on the training ledger (see module docstring)."""
    cut_day = TEMPORAL_CUTOFF_DAY
    cut = float(_secs([LA.as_of(cut_day)])[0])
    tx = LA.L.transactions[LA.L.transactions.scenario_id.notna()]
    t = _secs(pd.to_datetime(tx["timestamp"], utc=True).dt.tz_localize(None))
    span = pd.DataFrame({"s": tx["scenario_id"].to_numpy(), "t": t}).groupby("s")["t"].agg(["min", "max"])
    links = pd.concat([LA.roles[["account_id", "scenario_id"]],
                       LA.L.accounts.loc[LA.L.accounts.scenario_id.notna(), ["account_id", "scenario_id"]]]).drop_duplicates()
    links = links[links.account_id.isin(set(LA.accs))]
    links["group"] = links.account_id.map(LA.group)
    gspan = links.join(span, on="scenario_id").groupby("group").agg(first=("min", "min"), last=("max", "max"))
    groups = LA.group
    h = pd.Series(group_hash(groups), index=groups.index)
    is_scen = groups.isin(gspan.index)
    first, last = groups.map(gspan["first"]), groups.map(gspan["last"])
    pre = is_scen & (last < cut)
    post = is_scen & (first >= cut)
    no_tx = is_scen & first.isna()
    ordinary = ~is_scen
    role = {"fit": (pre & (h >= VAL_FRAC)) | (ordinary & (h >= 2 * VAL_FRAC)),
            "validation": (pre & (h < VAL_FRAC)) | (ordinary & (h < VAL_FRAC)),
            "test": post | (ordinary & (h >= VAL_FRAC) & (h < 2 * VAL_FRAC))}
    fit_days = [d for d in SNAPSHOT_DAYS if d < cut_day] + [cut_day]
    tr = LA.snapshots(fit_days, groups.index[role["fit"]].tolist())
    va = LA.snapshots(fit_days, groups.index[role["validation"]].tolist())
    te = LA.snapshots([LA.days], groups.index[role["test"]].tolist())
    tr_u, va_u, te_u = tr[tr.usable], va[va.usable], te[te.usable]
    assert tr_u.as_of_day.max() <= cut_day and va_u.as_of_day.max() <= cut_day
    sel = select(tr_u.reset_index(drop=True), va_u.reset_index(drop=True))
    p_te = sel["prob"](te_u)
    res = evaluate(te_u, p_te, sel["thr"], f"temporal test: instances starting on/after day {cut_day}, scored as of day {LA.days}")
    excl = excluded_counts(te, lambda X: (sel["prob"](X), sel["thr"]))
    return {
        "design": {"cutoff_day": cut_day, "fit_and_validation_as_of_days": fit_days, "test_as_of_day": LA.days,
                   "fit_validation_groups": "scenario instances whose last transfer is before the cutoff, split 75/25 by "
                                            "instance, plus ordinary accounts (hash buckets 0.5-1.0 fit, 0-0.25 validation)",
                   "test_groups": "scenario instances whose first transfer is on/after the cutoff plus ordinary accounts in "
                                  "hash bucket 0.25-0.5 (never used for fitting or selection)",
                   "excluded_instances_straddling_cutoff": int(groups[is_scen & ~pre & ~post & ~no_tx].nunique()),
                   "excluded_instances_without_transfers": int(groups[no_tx].nunique())},
        "splits": {k: {"rows": int(len(v)), "accounts": int(v.account_id.nunique()), "positives": int(v.y.sum()),
                       "scenario_instances_with_positives": int(v.loc[v.y == 1, "group"].nunique())}
                   for k, v in (("fit", tr_u), ("validation", va_u), ("test", te_u))},
        "selected": {"feature_set": sel["chosen_set"], "family": sel["best"].family, "validation_pr_auc_by_feature_set": sel["vpr"],
                     "calibration": sel["cal"]["method"], "threshold": round(sel["thr"], 6)},
        "validation": evaluate(va_u, sel["prob"](va_u), sel["thr"], "temporal validation (pre-cutoff)", ci=False),
        "test": {**res, **excl},
    }


def pre_scenario_check(LB: Ledger, new_prob, new_thr, old) -> dict:
    """Cold-ledger accounts that later became suspicious, scored as of a date >= 1 day before their scenario began,
    next to a matched baseline: a fixed sample of ordinary accounts scored as of exactly the same dates."""
    tx = LB.L.transactions[LB.L.transactions.scenario_id.notna()]
    t = pd.to_datetime(tx["timestamp"], utc=True).dt.tz_localize(None)
    first = pd.Series(t.to_numpy(), index=tx["scenario_id"].to_numpy()).groupby(level=0).min()
    end = LB.snapshot(LB.days)
    pos = end[end.usable & (end.y == 1) & end.group.isin(first.index)]
    gday = ((pos.group.map(first) - pd.Timedelta(days=1) - LB.start).dt.days // PRE_SCENARIO_GRID_DAYS) * PRE_SCENARIO_GRID_DAYS
    pos = pos.assign(pre_day=gday.to_numpy())
    pos = pos[pos.pre_day >= PRE_SCENARIO_GRID_DAYS]
    ordinary = [a for a in LB.accs if LB.base_label[a] == "ordinary"]
    sample = list(np.random.default_rng(SEED).choice(ordinary, min(PRE_SCENARIO_ORDINARY_SAMPLE, len(ordinary)), replace=False))
    rows = []
    for d, g in pos.groupby("pre_day"):
        snap = LB.snapshot(int(d), g.account_id.tolist() + sample)
        snap = snap[snap.n_transactions >= MIN_ACCOUNT_TRANSACTIONS]
        snap = snap.assign(kind=np.where(snap.account_id.isin(set(g.account_id)), "later_suspicious", "ordinary"),
                           weight_day=int(d))
        rows.append(snap)
    S = pd.concat(rows, ignore_index=True)
    # An account with a role in an earlier scenario can already be a positive (or in progress) at that date: dropped.
    dropped = int(((S.kind == "later_suspicious") & ((S.y == 1) | S.in_progress)).sum())
    S = S[(S.kind == "ordinary") | ((S.y == 0) & ~S.in_progress)]
    later = S[S.kind == "later_suspicious"]
    out = {"design": f"as_of = the {PRE_SCENARIO_GRID_DAYS}-day grid date at least 1 day before the scenario's first "
                     f"transfer; ordinary baseline = {len(sample)} seeded ordinary cold accounts at the same dates "
                     "(accounts with < 5 records by then abstain)",
           "later_suspicious_scored": int(len(later)), "dropped_already_positive_from_another_scenario": dropped,
           "as_of_day_median": float(later.as_of_day.median()) if len(later) else None}
    for name, prob, thr in (("new_model", new_prob, new_thr), ("previous_model", *old)):
        if prob is None:
            continue
        flag = prob(S) >= thr
        S_ = S.assign(flag=flag, band=history_band(S.history_days.to_numpy()))
        lat, ordn = S_[S_.kind == "later_suspicious"], S_[S_.kind == "ordinary"]
        per_day = ordn.groupby("as_of_day")["flag"].mean()
        matched = float(lat.as_of_day.map(per_day).mean()) if len(lat) else None
        by_band = {}
        for b in [x[2] for x in HISTORY_BANDS]:
            lb, ob = lat[lat.band == b], ordn[ordn.band == b]
            if len(lb) or len(ob):
                by_band[b] = {"later_suspicious_n": int(len(lb)), "later_suspicious_flag_rate": round(float(lb.flag.mean()), 4) if len(lb) else None,
                              "ordinary_n": int(len(ob)), "ordinary_flag_rate": round(float(ob.flag.mean()), 4) if len(ob) else None}
        out[name] = {"flag_rate_before_scenario": round(float(lat.flag.mean()), 4) if len(lat) else None,
                     "matched_ordinary_flag_rate_same_dates": round(matched, 4) if matched is not None else None,
                     "ordinary_flag_rate_by_as_of_day": {str(k): round(float(v), 4) for k, v in per_day.items()},
                     "by_history_days": by_band}
    out["reading"] = ("Scores use only records up to as_of. A before-scenario flag rate close to the matched ordinary rate means "
                      "the model flags these accounts no more than ordinary accounts at the same date (no foresight); a "
                      "much higher rate would mean they already looked unusual before acting.")
    return out


# ---------------------------------------------------------------------------------------------- main
def main(promote: bool = False) -> dict:
    t_start = time.perf_counter()
    report: dict = {"model": "account_model", "model_version": MODEL_VERSION, "feature_schema_version": FEATURE_SCHEMA_VERSION,
                    "generator_version": GENERATOR_VERSION, "environment": environment(), "target": LABEL_DEFINITION,
                    "abstention": f"fewer than {MIN_ACCOUNT_TRANSACTIONS} transactions by as_of"}
    LA, LB, LC = Ledger("train"), Ledger("cold"), Ledger("demo")
    TA = LA.snapshots()
    TAu = TA[TA.usable].reset_index(drop=True)
    val = split_groups(TAu["group"])
    tr_t, va_t = TAu[~val].reset_index(drop=True), TAu[val].reset_index(drop=True)
    report["snapshots"] = {"as_of_days": {"train": LA.snapshot_days(), "cold": LB.snapshot_days(), "demo": LC.snapshot_days()},
                           "history_bands_days": [b[2] for b in HISTORY_BANDS],
                           "reading": "Each row is one account as of one date; an account contributes one row per as_of date "
                                      "at which it has >= 5 records. All rows of an account and of its scenario instance "
                                      "are in the same split."}
    report["splits"] = {
        "train": {"rows": len(tr_t), "accounts": int(tr_t.account_id.nunique()), "positives": int(tr_t.y.sum()),
                  "positive_accounts": int(tr_t.loc[tr_t.y == 1, "account_id"].nunique())},
        "validation": {"rows": len(va_t), "accounts": int(va_t.account_id.nunique()), "positives": int(va_t.y.sum()),
                       "positive_accounts": int(va_t.loc[va_t.y == 1, "account_id"].nunique())},
        "groups_in_both_train_and_validation": int(len(set(tr_t.group) & set(va_t.group))),
        "cold_ledger_accounts_shared_with_training_ledger": int(len(set(LB.accs) & set(LA.accs))),
        "held_out_variants": HELD_OUT_VARIANTS,
        "excluded_from_training_ledger": excluded_counts(TA, lambda X: (np.zeros(len(X)), 1.0)),
    }
    for k in ("secondary_victims_flag_rate", "in_progress_flag_rate"):
        report["splits"]["excluded_from_training_ledger"].pop(k, None)

    sel = select(tr_t, va_t)
    best, cal, thr, rule, prob = sel["best"], sel["cal"], sel["thr"], sel["rule"], sel["prob"]
    feats = best.features
    assert set(feats) <= set(ACCOUNT_FEATURES + GRAPH_FEATURES) and not set(feats) & FORBIDDEN_INPUTS
    report["feature_sets"] = {k: {"candidates": v["candidates"], "best_exportable": v["best_row"],
                                  "best_including_random_forest": v["best_any_family"]} for k, v in sel["families"].items()}
    report["selected"] = {"feature_set": sel["chosen_set"], "validation_pr_auc_by_feature_set": sel["vpr"],
                          "validation_pr_auc_gain_from_graph_features": round(sel["vpr"]["behaviour_plus_graph"] - sel["vpr"]["behaviour_only"], 4),
                          "rule": f"simplest set unless a richer one gains >= {MIN_GAIN} validation PR-AUC; account-age features "
                                  "are excluded by default because they can flag new accounts before they do anything",
                          "family": best.family, "params": {k: v for k, v in best.params.items() if k not in ("nthread", "tree_method")},
                          "selection_rule": "highest validation PR-AUC (all snapshots) among exportable models (logistic regression, XGBoost)"}

    # Test ledgers: every snapshot, and the ledger-end snapshot alone (comparable with earlier reports).
    TB, TC = LB.snapshots(), LC.snapshots()
    TBu, TCu = TB[TB.usable].reset_index(drop=True), TC[TC.usable].reset_index(drop=True)
    TBe, TCe = TBu[TBu.as_of_day == LB.days].reset_index(drop=True), TCu[TCu.as_of_day == LC.days].reset_index(drop=True)
    va_e = va_t[va_t.as_of_day == LA.days].reset_index(drop=True)
    res = {"train": evaluate(tr_t, prob(tr_t), thr, "train (all snapshots)", ci=False),
           "validation": evaluate(va_t, prob(va_t), thr, "validation (all snapshots)"),
           "validation_at_ledger_end": evaluate(va_e, prob(va_e), thr, f"validation, as of day {LA.days}"),
           "cold_ledger_test": evaluate(TBe, prob(TBe), thr, f"cold ledger (disjoint accounts), as of day {LB.days}"),
           "cold_ledger_snapshots": evaluate(TBu, prob(TBu), thr, "cold ledger, all snapshots"),
           "served_demo_ledger": evaluate(TCe, prob(TCe), thr, f"served demo ledger, as of day {LC.days}"),
           "served_demo_ledger_snapshots": evaluate(TCu, prob(TCu), thr, "served demo ledger, all snapshots")}
    res["cold_ledger_test"].update(excluded_counts(TB[TB.as_of_day == LB.days], lambda X: (prob(X), thr)))
    pB, yb = prob(TBe), TBe.y.to_numpy()
    hv = TBe.variant.isin(HELD_OUT_VARIANTS).to_numpy()
    res["cold_held_out_variant_positive_recall"] = {
        v: round(float((pB[(TBe.variant == v).to_numpy() & (yb == 1)] >= thr).mean()), 4)
        if ((TBe.variant == v).to_numpy() & (yb == 1)).any() else None for v in HELD_OUT_VARIANTS}
    res["cold_seen_variants"] = metrics(yb[~hv], pB[~hv], thr, "cold ledger excluding held-out variant accounts")
    res["temporal_test"] = None  # filled below
    report["results"] = res
    report["calibration_curve_cold"] = reliability(yb, pB)

    tt = temporal_test(LA)
    res["temporal_test"] = tt["test"]
    report["temporal_test"] = {k: v for k, v in tt.items() if k != "test"}

    # The served champion on the same, current labels.
    old = None
    if (SERVED / "metadata.json").exists():
        served.clear_cache()
        om = served.load(SERVED.name, SERVED.parent)
        old = (lambda X: om.calibrated(om.raw_scores(X)), om.threshold)
    report["as_of_before_scenario"] = pre_scenario_check(LB, prob, thr, old or (None, None))

    comparison, rule_passed, why = {}, True, "no served model to compare with"
    if old is not None:
        oprob, othr = old
        short = lambda T: T[T.history_days < SHORT_HISTORY_DAYS]  # noqa: E731
        for name, T in (("validation_at_ledger_end", va_e), ("validation_all_snapshots", va_t),
                        (f"validation_history_lt_{int(SHORT_HISTORY_DAYS)}d", short(va_t)),
                        ("cold_ledger_at_ledger_end", TBe), ("cold_ledger_all_snapshots", TBu),
                        (f"cold_history_lt_{int(SHORT_HISTORY_DAYS)}d", short(TBu)), ("served_demo_ledger_at_end", TCe)):
            comparison[name] = {"previous": {**_rates(T.y.to_numpy(), oprob(T), othr), "threshold": round(othr, 6)},
                                "new": {**_rates(T.y.to_numpy(), prob(T), thr), "threshold": round(thr, 6)}}
        comparison["previous_model"] = {"model_version": om.version, "features": len(om.features), "family": om.meta.get("family"),
                                        "path": str(SERVED), "role": "served champion",
                                        "labels_it_was_trained_on": (om.meta.get("dataset") or {}).get("label_definition")
                                        or om.meta.get("label_definition")}
        ve, vs = comparison["validation_at_ledger_end"], comparison[f"validation_history_lt_{int(SHORT_HISTORY_DAYS)}d"]
        pr_ok = ve["new"]["pr_auc"] >= ve["previous"]["pr_auc"] - PROMOTION_MAX_PR_AUC_DROP
        fpr_ok = vs["new"]["false_positive_rate"] < vs["previous"]["false_positive_rate"]
        rule_passed = bool(pr_ok and fpr_ok)
        why = (f"validation PR-AUC at ledger end new {ve['new']['pr_auc']} vs previous {ve['previous']['pr_auc']} "
               f"({'within' if pr_ok else 'more than'} {PROMOTION_MAX_PR_AUC_DROP} below allowed); validation FPR with < "
               f"{int(SHORT_HISTORY_DAYS)} days of history new {vs['new']['false_positive_rate']} vs previous "
               f"{vs['previous']['false_positive_rate']} ({'lower' if fpr_ok else 'not lower'})")
    report["comparison_with_previous_model"] = comparison
    promoted = bool(promote and rule_passed)
    report["promotion"] = {"promoted": promoted, "rule_passed": rule_passed, "promote_flag": bool(promote), "reason": why,
                           "rule": f"promote only if validation PR-AUC at ledger end is not lower than the previous model's by more "
                                   f"than {PROMOTION_MAX_PR_AUC_DROP} AND validation false-positive rate on accounts with < "
                                   f"{int(SHORT_HISTORY_DAYS)} days of records is lower; both on the current labels",
                           "decided_on": "validation split only", "previous_kept_at": str(PREVIOUS),
                           "default": "written as the challenger only; the served model changes only with --promote and a passing rule"}

    report["feature_importance"] = feature_importance(best)
    report["fit_diagnosis"] = {"train_minus_validation_pr_auc": round(res["train"]["pr_auc"] - res["validation"]["pr_auc"], 4),
                               "validation_minus_cold_pr_auc": round(res["validation_at_ledger_end"]["pr_auc"] - res["cold_ledger_test"]["pr_auc"], 4),
                               "validation_minus_temporal_test_pr_auc": round(tt["validation"]["pr_auc"] - tt["test"]["pr_auc"], 4)}

    meta = {"model_version": MODEL_VERSION, "model": "account_model", "family": best.family, "feature_set": sel["chosen_set"],
            "feature_schema_version": FEATURE_SCHEMA_VERSION, "generator_version": GENERATOR_VERSION,
            "label_definition": LABEL_DEFINITION, "abstain_below_transactions": MIN_ACCOUNT_TRANSACTIONS,
            "dataset": {"source": "forensic-scenarios (synthetic, this repository)", "train_ledger_seed": LEDGERS["train"].seed,
                        "ledger_days": LA.days, "as_of_days": LA.snapshot_days(),
                        "as_of_rule": "features use only the account's (and its counterparties') records with timestamp <= as_of",
                        "split": f"sha256('{SEED}:' + scenario instance or account id) < {VAL_FRAC} -> validation; all "
                                 "snapshots of an account and of its scenario instance stay in one split",
                        "excluded": ["secondary_victim", f"< {MIN_ACCOUNT_TRANSACTIONS} transactions by as_of",
                                     "in-progress suspicious roles (some but not all defining transfers by as_of)", "cash_network"],
                        "label_definition": LABEL_DEFINITION,
                        "materialised_rule": "intermediary: received AND sent scenario money; attacker_controlled / innocent "
                                             "counterparty: received it; victim: sent it; secondary victim: its drain transfer "
                                             "exists; evaluated at each as_of date",
                        "train_rows": len(tr_t), "train_positives": int(tr_t.y.sum()),
                        "validation_rows": len(va_t), "validation_positives": int(va_t.y.sum())},
            "calibration": cal, "threshold": threshold_record(thr, rule, va_t.y.to_numpy(), prob(va_t)),  # exact float; see evaluation.threshold_record
            "training_ranges": training_ranges(tr_t, feats),
            "training_ranges_excluded": {f: why_ for f, why_ in RANGE_CHECK_EXCLUDED.items() if f in feats},
            "environment": environment(), "params": report["selected"]["params"],
            "metrics": {k: {kk: v.get(kk) for kk in ("n", "positives", "precision", "recall", "pr_auc", "roc_auc", "brier", "ece", "confusion_matrix")}
                        for k, v in res.items() if isinstance(v, dict) and "pr_auc" in v},
            "feature_importance": report["feature_importance"],
            "promotion": report["promotion"]}
    export(best, CHALLENGER, meta)
    target = CHALLENGER
    if promoted:
        if (SERVED / "metadata.json").exists():
            if PREVIOUS.exists():
                shutil.rmtree(PREVIOUS)
            shutil.copytree(SERVED, PREVIOUS)
        export(best, SERVED, meta)
        target = SERVED
    served.clear_cache()
    loaded = served.load(target.name, target.parent)
    report["artifact"] = {"path": str(target), "challenger_path": str(CHALLENGER), "served_path": str(SERVED),
                          "size_bytes": sum(p.stat().st_size for p in target.iterdir()),
                          "reload_matches_training_scores": bool(np.allclose(loaded.raw_scores(TBe.iloc[:500]), best.predict(TBe.iloc[:500]), atol=1e-6))}
    report["runtime_seconds"] = round(time.perf_counter() - t_start, 1)
    REPORT.write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--promote", action="store_true", default=False,
                    help="also replace the served model (champion) if the promotion rule passes; off by default")
    r = main(promote=ap.parse_args().promote)
    keys = ("model_version", "splits", "selected", "promotion", "fit_diagnosis")
    print(json.dumps({k: r[k] for k in keys}, indent=1, default=str)[:5000])
    for k, v in r["results"].items():
        if isinstance(v, dict) and "pr_auc" in v:
            print(k, {kk: v.get(kk) for kk in ("n", "positives", "precision", "recall", "false_positive_rate", "pr_auc", "pr_auc_95ci_bootstrap_by_scenario")})
