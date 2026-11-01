"""Fast subset of the end-to-end scenario demonstration (ml/forensics/demonstrate_scenarios.py).

Runs scenarios 7 (unknown account), 8 (insufficient history), the ID-overlap part of 9 and 5 (innocent counterparty,
one example) against the served forensic ledger. Skips cleanly when the ledger or its ground-truth CSVs are absent.

    PYTHONPATH=.:backend backend/.venv/bin/python -m pytest ml/tests/test_scenario_demonstration.py -q
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# Imported first: it points the app's case database at a throwaway file before any app module opens it.
from ml.forensics import demonstrate_scenarios as demo_module

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "v3_forensic_scenarios.db"
GT = ROOT / "data" / "v3_forensic" / "demo"
TRAIN = ROOT / "data" / "v3_forensic" / "train"

pytestmark = pytest.mark.skipif(
    not DB.exists() or not all((GT / f).exists() for f in ("accounts.csv", "roles.csv", "scenarios.csv", "transactions.csv")),
    reason="served forensic ledger (data/v3_forensic_scenarios.db) or data/v3_forensic/demo ground truth not present",
)


@pytest.fixture(scope="module")
def demo():
    return demo_module


@pytest.fixture(scope="module")
def gt(demo):
    return demo.GroundTruth(GT)


@pytest.fixture(scope="module")
def registry():
    from app.intelligence.datasets import DatasetRegistry
    return DatasetRegistry(f"sqlite:///{DB}")


@pytest.fixture(scope="module")
def client(demo):
    return demo.http_client(DB)


def _models_present() -> bool:
    from app.intelligence import models as mdl
    try:
        mdl.load("transaction_model")
        mdl.load("account_model")
        return True
    except mdl.ModelArtifactUnavailable:
        return False


def test_selection_is_deterministic_and_never_hard_coded(demo, gt):
    assert demo.select_direct(gt) == demo.select_direct(demo.GroundTruth(GT))
    assert demo.select_ordinary(gt, 5) == sorted(demo.select_ordinary(gt, 5))
    # No concrete account ID in the source other than FS-00000000, the documented starting point of the unknown-ID search.
    assert set(re.findall(r"FS-[0-9A-F]{8}", Path(demo.__file__).read_text())) <= {"FS-00000000"}


def test_scenario_7_unknown_account_is_404_account_not_found(demo, gt, client):
    r = demo.s7_unknown(client, gt)
    assert r["outcome"] == "pass", r["checks"]
    assert r["http"]["status_code"] == 404
    assert r["http"]["body"]["error"]["code"] == "account_not_found"


@pytest.mark.skipif(not _models_present(), reason="v3 model artifacts not built")
def test_scenario_8_insufficient_history_abstains(demo, gt, client):
    r = demo.s8_low_history(client, gt)
    assert r["outcome"] == "pass", r["checks"]
    assert r["engine"]["victim_assessment_status"] == "insufficient_evidence"
    assert r["engine"]["account_model_result"]["status"] == "insufficient_history"
    assert r["engine"]["account_model_result"].get("model_score") is None


@pytest.mark.skipif(not (TRAIN / "accounts.csv").exists() or not (TRAIN / "transactions.csv").exists(),
                    reason="training ledger CSVs not present")
def test_scenario_9_investigated_ids_never_occur_in_training(demo, gt):
    roots = {demo.select_direct(gt)[1], demo.select_multi_hop(gt)[1], demo.select_split(gt)[1],
             demo.select_multi_victim(gt)[1], demo.innocent_candidates(gt)[0][2], demo.secondary_candidates(gt)[0][2]}
    train = demo.training_ids()
    assert len(train) > 1000
    assert not roots & train
    assert not set(gt.accounts.account_id) & train
    assert demo.artifact_id_mentions()["account_id_strings_found"] == 0


@pytest.mark.skipif(not _models_present(), reason="v3 model artifacts not built")
def test_scenario_5_innocent_counterparty_is_not_labelled_suspicious(demo, gt, registry):
    r = demo.s5_innocent(registry, gt, aggregate=False)
    assert r["checks"]["innocent_counterparty_appears"], r["uncertain_or_missed"]
    assert r["innocent_assessment"]["role"] not in demo.FLAGGING_ROLES
    assert r["innocent_assessment"]["restriction"] != demo.STRONGEST_RESTRICTION
    assert r["engine"]["automatic_actions_taken"] == []
    assert r["outcome"] == "pass", r["checks"]


def test_scenario_6_criteria_old_exact_name_and_new_victim_not_intermediary(demo):
    # Old criterion: exact role name only.
    assert demo.s6_exact_role("potential_secondary_victim")
    assert not demo.s6_exact_role("suspicious_activity_victim_unconfirmed")
    # New criterion: a victim-class role, never an intermediary/suspicious role.
    assert demo.s6_victim_not_intermediary("potential_secondary_victim", True)
    assert demo.s6_victim_not_intermediary("suspicious_activity_victim_unconfirmed", True)
    assert not demo.s6_victim_not_intermediary("suspicious_activity_victim_unconfirmed", False)
    for role in ("potential_intermediary", "potentially_suspicious_account", "unknown_role", "no_suspicious_linkage_observed", None):
        assert not demo.s6_victim_not_intermediary(role, True)
    # The change is disclosed as made after observing the result, and the reason names the observed example.
    assert demo.S6_CRITERION_CHANGE["changed_after_observing_result"] is True
    reason = demo.s6_change_reason("FS-ABCDEF01", "suspicious_activity_victim_unconfirmed", True)
    assert "AFTER observing the result" in reason and "FS-ABCDEF01" in reason and "balance-based attribution" in reason


def test_scenario_6_is_scored_with_the_original_criterion_only(demo):
    # Owner decision (final review): a criterion revised after seeing its result must never turn a fail into a pass.
    assert demo.S6_CRITERION_CHANGE["scored_criterion"].startswith("old_criterion")
    assert demo.S6_CRITERION_CHANGE["new_criterion_status"].startswith("exploratory")
    import inspect
    src = inspect.getsource(demo.s6_secondary)
    assert '"labelled_potential_secondary_victim (original criterion)": exact' in src
    assert '"distinguished_from_intermediary": distinguished' not in src
