"""Regression tests for the account-model audit (docs/ACCOUNT_MODEL_AUDIT.md)."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# The account model is served by the backend; resolve its modules the same way the training scripts do.
_BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import average_precision_score, precision_score, recall_score

from app.services.v2.feature_builder import FEATURE_NAMES
from app.services.v2.ml_service import V2MLInferenceService
from ml.v2.account_model_eval import (
    NEW_ARTIFACT_DIR,
    assign_splits,
    family_of,
    metrics_at,
    select_threshold,
)
from ml.v2.scenario_bank import (
    POSITIVE_LABELS,
    UNSEEN_FAMILIES,
    ScenarioBankConfig,
    ScenarioBankGenerator,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
ACTIVE_META = NEW_ARTIFACT_DIR / "metadata.json"
needs_active_model = pytest.mark.skipif(
    not (NEW_ARTIFACT_DIR / "model.joblib").exists(), reason="active account model binary not built"
)


# ---------------------------------------------------------------- schema and leakage
def test_active_artifact_is_the_served_artifact():
    assert V2MLInferenceService.ACCOUNT_ARTIFACTS_DIR.resolve() == NEW_ARTIFACT_DIR.resolve()


def test_feature_schema_matches_serving_builder():
    schema = json.loads((NEW_ARTIFACT_DIR / "feature_schema.json").read_text())
    assert schema["features"] == FEATURE_NAMES
    meta = json.loads(ACTIVE_META.read_text())
    assert meta["features"] == FEATURE_NAMES


@needs_active_model
def test_model_input_order_matches_feature_builder():
    import joblib

    model = joblib.load(NEW_ARTIFACT_DIR / "model.joblib")
    assert list(model.get_booster().feature_names) == FEATURE_NAMES


def test_ground_truth_and_identity_fields_are_not_features():
    forbidden = {
        "ground_truth_label", "scenario_id", "scenario_tag", "is_suspicious_scenario", "account_id",
        "customer_name", "phone_number", "email", "upi_id", "tax_identifier", "baseline_rule_score",
    }
    assert not forbidden & set(FEATURE_NAMES)


# ---------------------------------------------------------------- scenario-bank generator
SMALL = dict(
    num_accounts=3000,
    num_transactions=40000,
    instances={
        "app_layering": 3, "fan_out_dispersal": 2, "structuring": 2, "dormant_awakening": 3,
        "cyclic_roundtrip": 2, "slow_layering": 2, "salary_quick_payment": 5, "student_fee_payment": 3,
        "legit_dormant_reactivation": 3, "merchant_sweep": 2,
    },
)


@pytest.fixture(scope="module")
def small_bank():
    gen = ScenarioBankGenerator(ScenarioBankConfig(seed=11, **SMALL))
    accounts, txns = gen.generate()
    return gen, accounts, txns


def test_generator_labels_are_scoped_to_one_scenario(small_bank):
    gen, accounts, txns = small_bank
    by_id = {a.account_id: a for a in accounts}
    for a in accounts:
        if a.ground_truth_label in POSITIVE_LABELS:
            assert a.scenario_id and a.scenario_id.startswith("SC-")
    seen: dict[str, set[str]] = {}
    for t in txns:
        if not t.scenario_id:
            continue
        for acc in (t.origin_account_id, t.destination_account_id):
            if acc in gen.sink_ids or acc in {x for p in gen._counterparties.values() for x in p}:
                continue
            seen.setdefault(acc, set()).add(t.scenario_id)
    assert all(len(v) == 1 for v in seen.values()), "an account plays a role in two scenario instances"
    assert all(by_id[s].ground_truth_label == "unlabeled" for s in gen.sink_ids)


def test_generator_does_not_plant_balance_artifacts(small_bank):
    gen, accounts, _ = small_bank
    positives = {a.account_id for a in accounts if a.ground_truth_label in POSITIVE_LABELS}
    assert not positives & set(gen.topped_up), "a positive account's opening balance was altered"


def test_dormant_accounts_are_quiet_before_awakening(small_bank):
    gen, _, txns = small_bank
    for acc, awake in gen.quiet_until.items():
        before = [t for t in txns if acc in (t.origin_account_id, t.destination_account_id) and t.timestamp < awake.isoformat()]
        assert not before, f"{acc} has activity before it awakens"


def test_generator_is_deterministic():
    def digest(seed: int) -> str:
        _, accs, txns = (lambda g: (g, *g.generate()))(ScenarioBankGenerator(ScenarioBankConfig(seed=seed, **SMALL)))
        h = hashlib.sha256()
        for t in txns:
            h.update(f"{t.timestamp}|{t.origin_account_id}|{t.destination_account_id}|{t.amount}".encode())
        for a in accs:
            h.update(f"{a.account_id}|{a.ground_truth_label}|{a.scenario_id}".encode())
        return h.hexdigest()

    assert digest(5) == digest(5)
    assert digest(5) != digest(6)


# ---------------------------------------------------------------- splits, thresholds, metrics
def _frame(rows):
    df = pd.DataFrame(rows, columns=["account_id", "scenario_id"])
    df["family"] = df["scenario_id"].map(family_of)
    return df


def test_split_keeps_each_scenario_instance_together_and_unseen_families_in_test():
    rows = []
    for fam in ("APP-LAYERING", "FAN-OUT-DISPERSAL", "CYCLIC-ROUNDTRIP", "SLOW-LAYERING", "STRUCTURING"):
        for i in range(30):
            for j in range(4):
                rows.append((f"A-{fam}-{i}-{j}", f"SC-{fam}-{i:03d}"))
    rows += [(f"N-{i}", None) for i in range(500)]
    df = _frame(rows)
    df["split"] = assign_splits(df)
    assert df.groupby("scenario_id")["split"].nunique().max() == 1
    assert set(df[df.family.isin(UNSEEN_FAMILIES)].split) == {"test"}
    assert {"train", "validation", "test"} <= set(df[df.family == "app_layering"].split)
    df2 = _frame(rows)
    assert (assign_splits(df2) == df["split"]).all(), "split must be deterministic"


def test_select_threshold_maximises_f2_on_the_data_it_is_given():
    y = np.array([1, 1, 1, 0, 0, 0, 0, 0])
    s = np.array([0.9, 0.6, 0.2, 0.7, 0.3, 0.1, 0.05, 0.01])
    t = select_threshold(y, s)
    # F2 at 0.2: P=3/5, R=1 -> 0.882; at 0.6: P=2/3, R=2/3 -> 0.667; at 0.9: P=1, R=1/3 -> 0.385
    assert t == pytest.approx(0.2)


@needs_active_model
def test_stored_threshold_comes_from_validation_only():
    cache = REPO_ROOT / "data" / "v2_model_eval" / "features.pkl"
    if not cache.exists():
        pytest.skip("scenario-bank feature cache not built")
    import joblib
    from ml.v2.account_model_eval import prepare

    df = prepare(pd.read_pickle(cache))
    va = df[df.split == "validation"]
    model = joblib.load(NEW_ARTIFACT_DIR / "model.joblib")
    recomputed = select_threshold(va.target.to_numpy(), model.predict_proba(va[FEATURE_NAMES])[:, 1])
    meta = json.loads(ACTIVE_META.read_text())
    assert recomputed == pytest.approx(meta["decision_threshold"], abs=1e-4)


def test_metrics_match_sklearn_and_confusion_matrix_is_consistent():
    rng = np.random.default_rng(3)
    y = rng.integers(0, 2, 200)
    s = np.clip(y * 0.4 + rng.random(200) * 0.6, 0, 1)
    m = metrics_at(y, s, 0.5)
    (tn, fp), (fn, tp) = m["confusion_matrix"]
    assert tn + fp == m["negatives"] and fn + tp == m["positives"]
    assert m["precision"] == pytest.approx(precision_score(y, s >= 0.5), abs=1e-4)
    assert m["recall"] == pytest.approx(recall_score(y, s >= 0.5), abs=1e-4)
    assert m["pr_auc"] == pytest.approx(average_precision_score(y, s), abs=1e-4)


def test_metadata_counts_are_consistent():
    meta = json.loads(ACTIVE_META.read_text())
    split = meta["scenario_split_strategy"]
    m = meta["ml_evaluation_metrics"]
    assert m["positives"] == split["test_suspicious_count"]
    assert m["negatives"] == split["test_normal_count"]
    assert m["true_positives"] + m["false_negatives"] == m["positives"]
    assert m["threshold"] == pytest.approx(meta["decision_threshold"], abs=1e-4)
    assert "not a verified probability" in meta["score_semantics"]


# ---------------------------------------------------------------- serving semantics
def test_risk_levels_are_anchored_to_the_threshold():
    lvl = V2MLInferenceService.risk_level_for
    assert lvl(0.10, 0.175) == "low"
    assert lvl(0.20, 0.175) == "elevated"
    assert lvl(0.60, 0.175) == "high"
    assert lvl(0.95, 0.175) == "critical"
    # With the historical 0.5 threshold, nothing below 0.5 can be above "low".
    assert lvl(0.45, 0.5) == "low" and lvl(0.55, 0.5) == "high"


def test_threshold_falls_back_when_metadata_is_missing(monkeypatch):
    monkeypatch.setattr(V2MLInferenceService, "_account_metadata", {})
    assert V2MLInferenceService.decision_threshold() == 0.5
    monkeypatch.setattr(V2MLInferenceService, "_account_metadata", {"decision_threshold": 7})
    assert V2MLInferenceService.decision_threshold() == 0.5


@needs_active_model
@pytest.mark.skipif(not (REPO_ROOT / "data" / "v2_fraudshield.db").exists(), reason="demo ledger not present")
def test_fs2001_scores_have_consistent_semantics():
    """Not a tuning target: documents current behaviour on the sample case accounts."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    with Session(create_engine(f"sqlite:///{REPO_ROOT / 'data' / 'v2_fraudshield.db'}")) as db:
        out = {a: V2MLInferenceService.assess_account(db, a) for a in ("ACC-000001", "ACC-000003")}
    thr = V2MLInferenceService.decision_threshold()
    for a in out.values():
        assert 0.0 <= a.risk_score <= 100.0
        assert a.predicted_class == ("suspicious" if a.predicted_probability >= thr else "legitimate")
        assert a.risk_level == V2MLInferenceService.risk_level_for(a.predicted_probability, thr)
        assert a.top_contributions, "TreeSHAP explanation must be present"
    # The reporting customer is not flagged; the first receiver is.
    assert out["ACC-000001"].predicted_class == "legitimate"
    assert out["ACC-000003"].predicted_class == "suspicious"


# ---------------------------------------------------------------- PaySim separation
def test_account_model_and_paysim_benchmark_are_separate():
    paysim_dir = REPO_ROOT / "ml" / "artifacts" / "v2" / "paysim_benchmark"
    assert paysim_dir.resolve() != NEW_ARTIFACT_DIR.resolve()
    paysim_features = json.loads((paysim_dir / "feature_schema.json").read_text())
    names = paysim_features.get("features", paysim_features)
    assert not set(names) & set(FEATURE_NAMES) - {"amount"}
    meta = json.loads(ACTIVE_META.read_text())
    assert "PaySim" not in meta["dataset_source"]
