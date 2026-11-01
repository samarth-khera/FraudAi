"""v3 training pipeline: point-in-time account labels, leakage guards, calibration cross-fit, range check, reports.

    PYTHONPATH=.:backend backend/.venv/bin/python -m pytest ml/tests/test_v3_training.py -q
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backend.app.intelligence import models as mdl
from backend.app.intelligence.features import (
    ACCOUNT_FEATURES, FORBIDDEN_INPUTS, GRAPH_FEATURES, TXN_FEATURES, account_features, graph_features,
)
from ml.forensics import train_account_model as tam
from ml.forensics.generator import LEDGERS, SUSPICIOUS_ROLES, ForensicLedgerConfig
from ml.forensics.modeling import RANGE_CHECK_EXCLUDED, choose_calibration, group_folds, training_ranges

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "ml" / "artifacts" / "v3"
REPORTS = ROOT / "ml" / "reports"
SMALL = ForensicLedgerConfig(seed=4242, num_people=700, num_merchants=60, num_employers=8, days=75, include_held_out=True,
                             instances={"direct": 3, "chain": 4, "multi_hop": 4, "split": 3, "consolidation": 2, "circular": 2,
                                        "multi_victim": 2, "takeover": 3, "lookalike": 2})


@pytest.fixture(scope="module")
def small():
    LEDGERS["unit-small"] = SMALL
    try:
        yield tam.Ledger("unit-small")
    finally:
        LEDGERS.pop("unit-small", None)


def _scenario_events(L, cut: pd.Timestamp):
    tx = L.transactions[L.transactions.scenario_id.notna()].copy()
    tx["ts"] = pd.to_datetime(tx["timestamp"], utc=True).dt.tz_localize(None)
    tx = tx[tx.ts <= cut]
    return set(zip(tx.origin_account_id, tx.scenario_id)), set(zip(tx.destination_account_id, tx.scenario_id))


# ------------------------------------------------------------------ point-in-time labels
def test_snapshot_positives_need_their_defining_transfers_by_as_of(small):
    roles = small.L.roles
    for day in small.snapshot_days():
        cut = small.as_of(day)
        sent, recv = _scenario_events(small.L, cut)
        snap = small.snapshot(day).set_index("account_id")
        for acc in snap.index[snap.y == 1]:
            rr = roles[(roles.account_id == acc) & roles.role.isin(SUSPICIOUS_ROLES)]
            ok = False
            for r in rr.itertuples():
                k = (acc, r.scenario_id)
                ok |= (k in recv and k in sent) if r.role == "intermediary" else (k in recv)
            assert ok, f"{acc} is positive at day {day} without its defining transfers"


def test_receiving_scenario_money_alone_never_makes_a_positive(small):
    roles = small.L.roles
    for day in small.snapshot_days():
        sent, recv = _scenario_events(small.L, small.as_of(day))
        snap = small.snapshot(day).set_index("account_id")
        inter = roles[roles.role == "intermediary"]
        only_recv = {r.account_id for r in inter.itertuples() if (r.account_id, r.scenario_id) in recv
                     and (r.account_id, r.scenario_id) not in sent}
        collectors = set(roles.loc[roles.role == "attacker_controlled", "account_id"])
        for acc in only_recv - collectors:
            other = roles[(roles.account_id == acc) & (roles.role == "intermediary")]
            if all((acc, s) not in sent for s in other.scenario_id):
                assert snap.at[acc, "y"] == 0


def test_ledger_end_labels_match_the_generator_materialised_rule(small):
    end = small.snapshot(small.days).set_index("account_id")
    r = small.L.roles
    expected = set(r.loc[r.role.isin(SUSPICIOUS_ROLES) & r.materialised, "account_id"])
    assert set(end.index[end.y == 1]) == expected & set(end.index)
    unmat = set(r.loc[r.role.isin(SUSPICIOUS_ROLES) & ~r.materialised, "account_id"]) - expected
    assert all(end.at[a, "y"] == 0 for a in unmat & set(end.index))


def test_snapshot_features_use_only_records_up_to_as_of(small):
    day = 40
    cut = small.as_of(day)
    accs = small.accs[:60]
    past = small.df[small.df.timestamp <= cut]
    future = small.df[small.df.timestamp > cut].assign(amount=lambda d: d.amount * 9.0)
    a = small.snapshot(day).set_index("account_id").loc[accs, ACCOUNT_FEATURES + GRAPH_FEATURES]
    b = account_features(past, accs, cut).join(graph_features(past, accs, cut))[ACCOUNT_FEATURES + GRAPH_FEATURES]
    c = account_features(pd.concat([past, future]), accs, cut).join(graph_features(pd.concat([past, future]), accs, cut))
    assert np.allclose(a.to_numpy(float), b.to_numpy(float), equal_nan=True)
    assert np.allclose(b.to_numpy(float), c[ACCOUNT_FEATURES + GRAPH_FEATURES].to_numpy(float), equal_nan=True)


def test_snapshots_of_one_scenario_stay_in_one_split(small):
    T = small.snapshots()
    val = tam.split_groups(T["group"])
    per_group = pd.Series(val).groupby(T["group"].to_numpy()).nunique()
    assert (per_group == 1).all()


# ------------------------------------------------------------------ calibration / ranges
def test_group_folds_keep_groups_together_and_do_not_follow_index_order():
    groups = np.repeat([f"g{i:03d}" for i in range(100)], 3)
    folds = group_folds(groups, k=5)
    assert sorted(np.concatenate(folds).tolist()) == list(range(len(groups)))
    for f in folds:
        assert not set(groups[f]) & set(groups[np.setdiff1d(np.arange(len(groups)), f)])
    first_fold_groups = sorted(set(groups[folds[0]]))
    assert first_fold_groups != sorted(set(groups))[: len(first_fold_groups)]  # not the first block in file order
    assert all((a == b).all() for a, b in zip(folds, group_folds(groups, k=5)))  # seeded


def test_grouped_calibration_is_monotone_and_records_its_cross_fit():
    rng = np.random.default_rng(0)
    raw = rng.random(2000)
    y = (rng.random(2000) < raw ** 3).astype(int)
    cal = choose_calibration(y, raw, groups=np.repeat(np.arange(400), 5))
    assert "group" in cal["cross_fit"] and cal["fitted_on"].startswith("validation")
    m = mdl.ScoringModel("t", {"model_version": "t", "threshold": {"value": 0.5}, "calibration": cal}, [])
    c = m.calibrated(np.linspace(0, 1, 101))
    assert (np.diff(c) >= -1e-12).all()


def test_calendar_growing_features_are_not_range_checked():
    X = pd.DataFrame({f: np.linspace(0, 100, 50) for f in ("s_history_days", "r_history_days", "history_days", "log_amount")})
    r = training_ranges(X, list(X.columns))
    assert set(r) == {"log_amount"}
    assert {"s_history_days", "r_history_days", "history_days"} <= set(RANGE_CHECK_EXCLUDED)


# ------------------------------------------------------------------ leakage guards
def test_forbidden_inputs_cover_adapter_and_generator_field_names():
    for name in ("source_flag", "post_sender_balance", "step", "fraudStep", "role", "role_detail", "pattern", "variant",
                 "held_out", "materialised", "is_fraud", "isFraud", "isFlaggedFraud"):
        assert name in FORBIDDEN_INPUTS, name


def _artifact_dirs():
    return sorted(p for p in ART.iterdir() if (p / "metadata.json").exists()) if ART.exists() else []


@pytest.mark.skipif(not _artifact_dirs(), reason="no v3 model artifacts")
def test_every_artifact_feature_is_allow_listed_and_none_is_forbidden():
    allowed = {"transaction_model": set(TXN_FEATURES), "account_model": set(ACCOUNT_FEATURES) | set(GRAPH_FEATURES)}
    for d in _artifact_dirs():
        meta = json.loads((d / "metadata.json").read_text())
        feats = meta["features"]
        assert feats and len(feats) == len(set(feats))
        assert set(feats) <= allowed[meta["model"]], f"{d.name}: features outside the allow-list"
        assert not set(feats) & FORBIDDEN_INPUTS, f"{d.name}: forbidden input"
        assert set(meta.get("training_ranges", {})) <= set(feats)


CHAMPION, CHALLENGER = ART / "account_model", ART / "account_model_challenger"


@pytest.mark.skipif(not (CHAMPION / "metadata.json").exists(), reason="no account model artifact")
def test_artifacts_do_not_range_check_calendar_features():
    for d in ("transaction_model", "account_model", "account_model_challenger"):
        if (ART / d / "metadata.json").exists():
            meta = json.loads((ART / d / "metadata.json").read_text())
            assert not set(meta["training_ranges"]) & set(RANGE_CHECK_EXCLUDED), d


@pytest.mark.skipif(not (CHALLENGER / "metadata.json").exists(), reason="no challenger artifact")
def test_challenger_records_point_in_time_provenance_and_the_corrected_materialised_rule():
    ds = json.loads((CHALLENGER / "metadata.json").read_text())["dataset"]
    for key in ("source", "train_ledger_seed", "split", "as_of_days", "excluded", "label_definition", "materialised_rule"):
        assert key in ds, key
    assert "received AND sent" in ds["materialised_rule"]
    assert set(tam.SNAPSHOT_DAYS) <= set(ds["as_of_days"])  # multi-snapshot (point-in-time) training


@pytest.mark.skipif(not (CHAMPION / "metadata.json").exists(), reason="no account model artifact")
def test_champion_is_the_served_account_model_and_records_its_provenance():
    from backend.app.intelligence import engine

    champ = json.loads((CHAMPION / "metadata.json").read_text())
    mdl.clear_cache()
    _, served_account_model, status = engine._load_models()
    assert status["account_model"] is None and served_account_model is not None
    assert served_account_model.version == champ["model_version"]
    if (CHALLENGER / "metadata.json").exists():
        chall = json.loads((CHALLENGER / "metadata.json").read_text())
        assert chall["model_version"] != champ["model_version"], "the challenger must not be the served model"
    ds = champ["dataset"]
    for key in ("source", "train_ledger_seed", "split", "as_of_days", "excluded", "label_definition", "materialised_rule"):
        assert ds.get(key), key
    assert ds["train_ledger_seed"] == LEDGERS["train"].seed
    assert (ds["train_rows"], ds["train_positives"]) == (champ["metrics"]["train"]["n"], champ["metrics"]["train"]["positives"])
    assert (ds["validation_rows"], ds["validation_positives"]) == (champ["metrics"]["validation"]["n"], champ["metrics"]["validation"]["positives"])
    if champ["model_version"] == "v3-account-1.0.0":  # trained before the label correction: provenance must say so
        assert ds["as_of_days"] == [ds["ledger_days"]]
        assert ds["materialised_rule"].startswith("not applied")


def test_training_script_writes_the_challenger_and_promotes_only_on_request():
    import inspect

    assert tam.CHALLENGER == Path("ml/artifacts/v3/account_model_challenger")
    assert tam.SERVED == Path("ml/artifacts/v3/account_model")
    assert tam.REPORT != Path("ml/reports/account_model_v3.json")  # the champion's report is kept
    assert inspect.signature(tam.main).parameters["promote"].default is False


# ------------------------------------------------------------------ reports
@pytest.mark.skipif(not (REPORTS / "account_model_v3_challenger.json").exists(), reason="challenger report not generated")
def test_challenger_report_has_temporal_test_history_strata_matched_baseline_and_promotion():
    r = json.loads((REPORTS / "account_model_v3_challenger.json").read_text())
    assert r["model_version"] == json.loads((CHALLENGER / "metadata.json").read_text())["model_version"]
    tt = r["results"]["temporal_test"]
    assert tt["n"] > 0 and tt["positives"] > 0 and tt["scenario_instances_with_positives"] > 0
    assert len(tt["pr_auc_95ci_bootstrap_by_scenario"]) == 2
    assert r["temporal_test"]["design"]["cutoff_day"] == tam.TEMPORAL_CUTOFF_DAY
    for split in ("validation", "cold_ledger_snapshots", "cold_ledger_test", "temporal_test"):
        bands = r["results"][split]["by_history_days"]
        assert bands and all("false_positive_rate" in v for v in bands.values())
    assert set(r["results"]["validation"]["by_as_of_day"]) >= {str(d) for d in tam.SNAPSHOT_DAYS}
    pre = r["as_of_before_scenario"]["new_model"]
    assert "matched_ordinary_flag_rate_same_dates" in pre
    assert r["promotion"]["decided_on"] == "validation split only" and isinstance(r["promotion"]["promoted"], bool)
    assert "validation_at_ledger_end" in r["comparison_with_previous_model"]  # compared with the served champion


CC = REPORTS / "account_model_champion_challenger.json"


@pytest.mark.skipif(not CC.exists(), reason="champion/challenger report not generated")
def test_champion_challenger_report_scores_the_current_artifacts_per_cohort():
    r = json.loads(CC.read_text())
    import hashlib

    for role, d in (("champion", CHAMPION), ("challenger", CHALLENGER)):
        m = r["models"][role]
        assert m["model_json_sha256"] == hashlib.sha256((d / "model.json").read_bytes()).hexdigest(), role
        assert m["threshold"] == json.loads((d / "metadata.json").read_text())["threshold"]["value"]
    assert r["models"]["champion"]["served"] is True and r["models"]["challenger"]["served"] is False
    assert r["provenance_check_champion"]["matches_report"] is True
    for ds in ("validation", "cold", "demo"):
        views = r["evaluation"][ds]
        assert any(k.startswith("ledger_end") for k in views) and "all_snapshots_pooled" in views
        for v in views.values():
            for role in ("champion", "challenger"):
                o = v[role]["overall"]
                assert set(o["confusion_matrix"]) == {"tp", "fp", "tn", "fn"} and sum(o["confusion_matrix"].values()) == v["rows"]
                for k in ("precision", "recall", "false_positive_rate", "pr_auc", "brier", "ece", "reliability_10_bins"):
                    assert k in o
                assert set(v[role]["cohorts"]) == {"history_days", "true_role_group", "customer_type_evaluation_slice_only"}


@pytest.mark.skipif(not (REPORTS / "transaction_model_v3.json").exists(), reason="transaction report not generated")
def test_transaction_temporal_ci_resamples_scenarios():
    r = json.loads((REPORTS / "transaction_model_v3.json").read_text())
    t = r["results"]["temporal_test"]
    assert "pr_auc_95ci_bootstrap_by_scenario" in t and t["scenario_instances_with_positives"] > 0
    assert "pr_auc_95ci_bootstrap" not in t  # the old row-level interval is gone


def test_paysim_model_does_not_use_the_invented_weekday():
    from ml.forensics import paysim_transaction_model as ps

    assert "is_weekend" in ps.EXCLUDED_FEATURES
    assert "undersample" in ps.__doc__ and "logistic regression and the random forest" in ps.__doc__
    rep = REPORTS / "paysim_transaction_model.json"
    if rep.exists():
        r = json.loads(rep.read_text())
        if "excluded_features" in r:  # regenerated with this code
            for v in r["results"].values():
                assert "is_weekend" not in v["feature_importance"]


# ------------------------------------------------------------------ stored thresholds (exact, validation-selected)
def test_threshold_record_stores_the_exact_selected_score():
    from ml.forensics.evaluation import threshold_record

    sel = 0.001301623065955937  # rounds UP to 0.001302: the rounded value would drop the row scored exactly sel
    rec = threshold_record(sel, "lowest validation threshold with precision >= 50%")
    assert rec["value"] == sel and json.loads(json.dumps(rec))["value"] == sel
    assert rec["display_value"] == 0.001302 and rec["on"] == "calibrated" and rec["chosen_on"] == "validation split"
    p = np.array([0.4, sel, 0.0009])
    assert (p >= rec["value"]).sum() == 2 and (p >= rec["display_value"]).sum() == 1


def test_training_scripts_store_the_exact_threshold_not_a_rounding():
    import inspect

    from ml.forensics import train_transaction_model as ttm

    for mod in (ttm, tam):
        src = inspect.getsource(mod)
        assert '"threshold": threshold_record(thr, rule' in src, mod.__name__
        assert '"threshold": {"value": round(' not in src, mod.__name__


def test_precision_at_threshold_counts_every_row_tied_at_the_threshold():
    from ml.forensics.evaluation import pick_threshold, precision_at_threshold

    # 4 positives above a plateau of 6 tied rows (1 positive): walking row by row, pick_threshold can stop inside the
    # plateau, but `score >= threshold` flags all of it. precision_at_threshold reports what is actually flagged.
    y = np.array([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    p = np.array([0.9, 0.8, 0.7, 0.6] + [0.3] * 6 + [0.1, 0.05])
    thr, _ = pick_threshold(y, p, 0.5)
    r = precision_at_threshold(y, p, thr)
    assert r["flagged"] == int((p >= thr).sum()) and r["tied_at_threshold"] == int((p == thr).sum())
    assert r["tp"] + r["fn"] == y.sum() and r["fp"] + r["tn"] == (y == 0).sum()
    assert r["precision"] == r["tp"] / r["flagged"]


def _thr_block(d: str) -> dict:
    return json.loads((ART / d / "metadata.json").read_text())["threshold"]


@pytest.fixture(scope="module")
def txn_validation():
    from ml.forensics import train_transaction_model as ttm

    _, A, XA, _ = ttm.load("train")
    day = (A["timestamp"] - A["timestamp"].min()).dt.days.to_numpy()
    va = (day >= ttm.TRAIN_END_DAY) & (day < ttm.VAL_END_DAY)  # exactly as train_transaction_model.main()
    mdl.clear_cache()
    m = mdl.load("transaction_model", ART)
    return m, XA[va], A["label"].to_numpy()[va]


@pytest.fixture(scope="module")
def account_validation():
    """Validation rows of both account models, rebuilt as their training runs built them. Features are computed for the
    validation accounts only (identical values to the whole-ledger snapshot; features depend on the ledger, not on
    which accounts are requested)."""
    LA = tam.Ledger("train")
    val_acc = [a for a, v in zip(LA.accs, tam.split_groups(LA.group.reindex(LA.accs))) if v]
    T = pd.concat([LA.snapshot(d, val_acc) for d in LA.snapshot_days()], ignore_index=True)
    # Challenger (train_account_model.main): usable rows of every snapshot, current labels.
    chall = T[T.usable].reset_index(drop=True)
    # Champion (v3-account-1.0.0): ledger-end rows, >= MIN_ACCOUNT_TRANSACTIONS, secondary victims removed, planned-role
    # labels - the rows that reproduce its recorded counts (see compare_account_models.provenance_check).
    E = T.assign(planned=T.account_id.map(LA.base_label))
    E = E[(E.as_of_day == LA.days) & (E.n_transactions >= tam.MIN_ACCOUNT_TRANSACTIONS)
          & (E.planned != "secondary_victim")].reset_index(drop=True)
    E["y"] = E.planned.isin(SUSPICIOUS_ROLES).astype(int)
    return {"account_model": E, "account_model_challenger": chall}


def _check_stored_threshold(m, y, p, report_cm):
    from ml.forensics.evaluation import pick_threshold, precision_at_threshold

    blk = m.meta["threshold"]
    sel, rule = pick_threshold(y, p, 0.5)
    assert rule == blk["rule"]
    assert blk["value"] == sel, f"{m.name}: stored {blk['value']!r} != recomputed {sel!r}"
    assert round(sel, 6) == blk["display_value"]
    r = precision_at_threshold(y, p, m.threshold)
    counts = {k: r[k] for k in ("tn", "fp", "fn", "tp")}
    assert counts == report_cm == m.meta["metrics"]["validation"]["confusion_matrix"], m.name
    rec = blk["validation_at_value_ties_counted"]
    assert {k: rec[k] for k in ("tn", "fp", "fn", "tp")} == counts and rec["rows_tied_at_value"] == r["tied_at_threshold"]
    assert rec["precision"] == round(r["precision"], 4)
    return r


@pytest.mark.skipif(not (ART / "transaction_model" / "metadata.json").exists(), reason="no transaction model artifact")
def test_transaction_threshold_is_the_exact_validation_selection_and_reproduces_the_report(txn_validation):
    m, X, y = txn_validation
    p = m.calibrated(m.raw_scores(X))
    rep = json.loads((REPORTS / "transaction_model_v3.json").read_text())["results"]["validation"]
    r = _check_stored_threshold(m, y, p, rep["confusion_matrix"])
    assert (r["tp"], r["fn"]) == (286, 11)  # the documented counts; the old rounded 0.001302 gave 285 / 12
    assert int(m.score(X)["above_threshold"].sum()) == r["flagged"]  # the served comparison flags the same rows
    assert r["precision"] >= 0.5 and r["tied_at_threshold"] == 1  # no tie at the selected score


@pytest.mark.skipif(not (CHAMPION / "metadata.json").exists(), reason="no account model artifact")
def test_champion_threshold_is_the_exact_validation_selection_and_reproduces_the_report(account_validation):
    mdl.clear_cache()
    m = mdl.load("account_model", ART)
    E = account_validation["account_model"]
    rep = json.loads((REPORTS / "account_model_v3.json").read_text())["results"]["validation"]
    assert (len(E), int(E.y.sum())) == (rep["n"], rep["positives"])
    r = _check_stored_threshold(m, E.y.to_numpy(), m.calibrated(m.raw_scores(E)), rep["confusion_matrix"])
    assert int(m.score(E)["above_threshold"].sum()) == r["flagged"]
    assert r["precision"] >= 0.5 and r["tied_at_threshold"] == 1  # the tie issue does not affect the champion


@pytest.mark.skipif(not (CHALLENGER / "metadata.json").exists(), reason="no challenger artifact")
def test_challenger_threshold_is_the_exact_validation_selection_and_reproduces_the_report(account_validation):
    mdl.clear_cache()
    m = mdl.load("account_model_challenger", ART)
    V = account_validation["account_model_challenger"]
    rep = json.loads((REPORTS / "account_model_v3_challenger.json").read_text())["results"]["validation"]
    assert (len(V), int(V.y.sum())) == (rep["n"], rep["positives"])
    r = _check_stored_threshold(m, V.y.to_numpy(), m.calibrated(m.raw_scores(V)), rep["confusion_matrix"])
    assert int(m.score(V)["above_threshold"].sum()) == r["flagged"]
    # Known, documented issue (not served): the selection stopped inside an isotonic plateau, so realised validation
    # precision is below the 50% target. The metadata must say so whenever that is the case.
    if r["precision"] < 0.5:
        assert "known_issue" in m.meta["threshold"]
