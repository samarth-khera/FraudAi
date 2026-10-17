"""Tests for validation, features/leakage, splitting, thresholds, metrics, save/load."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from ml.config import EXCLUDED_COLUMNS, TARGET
from ml.data_validation import (
    DataValidationError, check_header, load_modelling_frame, profile_csv, validate_frame,
    validation_issues,
)
from ml.evaluation import compute_metrics, select_threshold
from ml.features import (
    build_pipeline, engineer_features, feature_schema, model_feature_names, raw_columns,
)
from ml.inference import FraudModel
from ml.splitting import chronological_split
from ml.train import default_specs, save_artifacts, train_and_evaluate


# ---------------- data validation ----------------
def test_missing_file(tmp_path):
    with pytest.raises(DataValidationError, match="not found"):
        check_header(tmp_path / "nope.csv")


def test_missing_columns(tmp_path):
    p = tmp_path / "x.csv"
    p.write_text("step,type\n1,PAYMENT\n")
    with pytest.raises(DataValidationError, match="Missing required columns"):
        check_header(p)


def test_profile_csv_counts(tmp_path, frame):
    p = tmp_path / "ok.csv"
    frame.to_csv(p, index=False)
    prof = profile_csv(p, chunksize=500)
    assert prof["rows"] == len(frame)
    assert prof["class_distribution"]["fraud_1"] == int(frame[TARGET].sum())
    assert prof["fraud_prevalence"] == pytest.approx(frame[TARGET].mean())
    assert prof["duplicate_rows"] == 0
    assert prof["step"]["max"] == frame["step"].max()
    errors, _ = validation_issues(prof)
    assert errors == []


def test_profile_detects_duplicates_and_bad_target(tmp_path, frame):
    dup = pd.concat([frame, frame.iloc[:5]])
    p = tmp_path / "dup.csv"
    dup.to_csv(p, index=False)
    assert profile_csv(p, chunksize=700)["duplicate_rows"] == 5
    bad = frame.copy()
    bad.loc[0, TARGET] = 2
    p2 = tmp_path / "bad.csv"
    bad.to_csv(p2, index=False)
    with pytest.raises(DataValidationError, match="outside"):
        profile_csv(p2)


def test_non_numeric_amount_rejected(tmp_path, frame):
    f = frame.copy()
    f["amount"] = f["amount"].astype(object)
    f.loc[0, "amount"] = "abc"
    p = tmp_path / "t.csv"
    f.to_csv(p, index=False)
    with pytest.raises(DataValidationError):
        profile_csv(p)


def test_validate_frame_errors(frame):
    validate_frame(frame)
    with pytest.raises(DataValidationError):
        validate_frame(frame.iloc[0:0])
    with pytest.raises(DataValidationError, match="Missing values"):
        f = frame.copy()
        f.loc[0, "amount"] = np.nan
        validate_frame(f)
    with pytest.raises(DataValidationError, match="Unexpected"):
        f = frame.copy()
        f.loc[0, "type"] = "WIRE"
        validate_frame(f)
    with pytest.raises(DataValidationError, match="No fraud"):
        f = frame.copy()
        f[TARGET] = 0
        validate_frame(f)


def test_load_modelling_frame_excludes_ids_and_flag(tmp_path, frame):
    p = tmp_path / "ok.csv"
    frame.to_csv(p, index=False)
    df = load_modelling_frame(p, raw_columns("with_post_balance"))
    assert not {"nameOrig", "nameDest", "isFlaggedFraud"} & set(df.columns)
    assert TARGET in df.columns
    assert len(df) == len(frame)


# ---------------- features / leakage ----------------
@pytest.mark.parametrize("fs", ["pre_transaction", "with_post_balance"])
def test_excluded_columns_never_features(frame, fs):
    X = engineer_features(frame, fs)
    assert not set(EXCLUDED_COLUMNS) & set(X.columns)
    assert list(X.columns) == model_feature_names(fs)
    assert not set(EXCLUDED_COLUMNS) & set(raw_columns(fs))


def test_pre_transaction_has_no_post_balance_features(frame):
    X = engineer_features(frame, "pre_transaction")
    assert not {"newbalanceOrig", "newbalanceDest", "error_balance_orig", "error_balance_dest"} & set(X.columns)
    # Pre-transaction features must work even when post-balance columns are absent.
    engineer_features(frame.drop(columns=["newbalanceOrig", "newbalanceDest"]), "pre_transaction")


def test_features_ignore_label_and_ids(frame):
    other = frame.copy()
    other[TARGET] = 1 - other[TARGET]
    other["isFlaggedFraud"] = 1
    other["nameOrig"] = "Z"
    pd.testing.assert_frame_equal(engineer_features(frame), engineer_features(other))


def test_missing_input_column_raises(frame):
    with pytest.raises(ValueError, match="missing required"):
        engineer_features(frame.drop(columns=["amount"]))


def test_unknown_feature_set():
    with pytest.raises(ValueError):
        raw_columns("everything")


def test_feature_schema_lists_exclusions():
    s = feature_schema("pre_transaction")
    assert set(s["excluded_columns"]) == set(EXCLUDED_COLUMNS)
    assert "isFlaggedFraud" in s["excluded_columns"]


def test_hour_of_day_derivation(frame):
    X = engineer_features(frame)
    assert X["hour_of_day"].between(0, 23).all()
    assert X.loc[frame["step"] == 1, "hour_of_day"].eq(0).all()
    assert X.loc[frame["step"] == 25, "hour_of_day"].eq(0).all()


# ---------------- chronological split ----------------
def test_split_is_chronological_and_disjoint(frame):
    tr, va, te, info = chronological_split(frame)
    assert tr["step"].max() < va["step"].min() <= va["step"].max() < te["step"].min()
    assert len(tr) + len(va) + len(te) == len(frame)
    assert info.train_max_step == tr["step"].max() and info.val_max_step == va["step"].max()
    assert 0.65 < len(tr) / len(frame) < 0.75


def test_split_not_random_on_shuffled_input(frame):
    shuffled = frame.sample(frac=1, random_state=1)
    tr, va, te, _ = chronological_split(shuffled)
    assert tr["step"].max() < va["step"].min() and va["step"].max() < te["step"].min()


def test_split_errors(frame):
    with pytest.raises(ValueError):
        chronological_split(frame, 0.9, 0.2)
    with pytest.raises(ValueError, match="distinct steps"):
        chronological_split(frame.assign(step=1))
    nofraud_tail = frame.copy()
    nofraud_tail.loc[nofraud_tail["step"] > 34, TARGET] = 0
    with pytest.raises(ValueError, match="no fraud"):
        chronological_split(nofraud_tail)


# ---------------- metrics & thresholds ----------------
def test_metrics_known_values():
    y = np.array([1, 1, 0, 0, 0, 0, 1, 0])
    s = np.array([0.9, 0.4, 0.8, 0.1, 0.2, 0.3, 0.7, 0.05])
    m = compute_metrics(y, s, 0.5)
    assert m["confusion_matrix"] == {"tn": 4, "fp": 1, "fn": 1, "tp": 2}
    assert m["precision"] == pytest.approx(2 / 3) and m["recall"] == pytest.approx(2 / 3)
    assert m["f1"] == pytest.approx(2 / 3)
    assert m["false_positive_rate"] == pytest.approx(1 / 5)
    assert m["fraud_prevalence"] == pytest.approx(3 / 8)
    assert m["roc_auc"] is not None and m["pr_auc"] is not None


def test_metrics_single_class_auc_undefined():
    m = compute_metrics(np.zeros(5), np.linspace(0, 1, 5), 0.5)
    assert m["roc_auc"] is None and m["pr_auc"] is None
    assert m["recall"] == 0.0


def test_metrics_input_validation():
    with pytest.raises(ValueError):
        compute_metrics([0, 1], [0.1], 0.5)


def test_threshold_max_f1_perfect_separation():
    y = np.array([0, 0, 0, 1, 1])
    s = np.array([0.1, 0.2, 0.3, 0.8, 0.9])
    t = select_threshold(y, s)
    assert t["validation_f1"] == pytest.approx(1.0)
    assert 0.3 < t["threshold"] <= 0.8


def test_threshold_min_precision_strategy():
    y = np.array([0, 0, 1, 0, 1, 1, 0, 1])
    s = np.array([0.1, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    t = select_threshold(y, s, "max_recall_at_min_precision", min_precision=0.75)
    assert t["validation_precision"] >= 0.75
    unattainable = select_threshold(y, s, "max_recall_at_min_precision", min_precision=1.01)
    assert unattainable["note"] is not None


def test_threshold_requires_both_classes_and_valid_strategy():
    with pytest.raises(ValueError):
        select_threshold(np.zeros(4), np.arange(4) / 4)
    with pytest.raises(ValueError):
        select_threshold(np.array([0, 1]), np.array([0.1, 0.9]), "bogus")


def test_threshold_uses_only_given_data():
    """Threshold must be a pure function of the validation arrays passed in."""
    y = np.array([0, 1, 0, 1, 0, 1])
    s = np.array([0.2, 0.9, 0.4, 0.7, 0.1, 0.6])
    assert select_threshold(y, s) == select_threshold(y.copy(), s.copy())


# ---------------- end-to-end on tiny frame + save/load ----------------
@pytest.fixture(scope="module")
def tiny_run():
    from ml.tests.conftest import make_frame
    df = make_frame(n_steps=60, per_step=120, seed=3)
    return df, train_and_evaluate(df, default_specs(fast=True), log=lambda m: None)


def test_end_to_end_results_structure(tiny_run):
    _, run = tiny_run
    assert run["selected_model"] in run["results"]
    assert not run["results"][run["selected_model"]]["feature_set"] == "with_post_balance"
    assert run["results"]["dummy_prior"]["threshold_selection"]["strategy"] == "fixed_0.5_baseline"
    for r in run["results"].values():
        assert set(r) >= {"validation", "test", "threshold_selection"}
        cm = r["test"]["confusion_matrix"]
        assert sum(cm.values()) == r["test"]["n"]


def test_save_load_prediction_consistency(tiny_run, tmp_path):
    df, run = tiny_run
    info = {"path": "synthetic-unit-test", "sha256": "n/a", "rows": len(df),
            "fraud_rows": int(df[TARGET].sum()), "fraud_prevalence": float(df[TARGET].mean())}
    save_artifacts(run, info, tmp_path / "art", tmp_path / "rep")
    for f in ["pipeline.joblib", "feature_schema.json", "threshold.json", "metrics.json", "model_card.md"]:
        assert (tmp_path / "art" / f).is_file()
    assert (tmp_path / "rep" / "metrics.json").is_file()

    model = FraudModel.load(tmp_path / "art")
    sample = df.sample(300, random_state=0)
    original = run["pipelines"][run["selected_model"]].predict_proba(sample)[:, 1]
    np.testing.assert_allclose(model.predict_proba(sample), original, rtol=0, atol=1e-12)
    expected_flags = (original >= run["results"][run["selected_model"]]["threshold_selection"]["threshold"]).astype(int)
    np.testing.assert_array_equal(model.predict(sample), expected_flags)
    assert json.loads((tmp_path / "art" / "threshold.json").read_text())["selected_model"] == run["selected_model"]


def test_inference_input_validation(tiny_run, tmp_path):
    df, run = tiny_run
    save_artifacts(run, {"path": "x", "sha256": "n/a", "rows": 1, "fraud_rows": 1, "fraud_prevalence": 0.1},
                   tmp_path / "a", tmp_path / "r")
    model = FraudModel.load(tmp_path / "a")
    with pytest.raises(ValueError, match="missing required"):
        model.predict_proba(df.drop(columns=["amount"]).head(3))
    with pytest.raises(ValueError, match="Unknown transaction types"):
        model.predict_proba(df.head(3).assign(type="WIRE"))
    with pytest.raises(FileNotFoundError):
        FraudModel.load(tmp_path / "empty")


def test_model_trained_on_train_only(tiny_run):
    """Scale-pos-weight comes from train counts, proving imbalance handling uses train only."""
    df, run = tiny_run
    tr, _, _, info = chronological_split(df)
    expected = (len(tr) - tr[TARGET].sum()) / tr[TARGET].sum()
    assert run["scale_pos_weight_train"] == pytest.approx(expected)
    assert run["split"]["train_rows"] == info.train_rows
