"""Account-role correction and the investigator report (2026-11-02).

Regression examples from the served forensic ledger (data/v3_forensic_scenarios.db, generator seed 303), scenario
SC-SPLIT-0025: FS-7B7C13AB paid 52,000 to FS-EAAA344C, which passed 45,121 of it on within 43 minutes to two new
recipients (both then withdrew cash). FS-EAAA344C already held 50,336 of its own, and the investigated-account rules
read "its own balance could have paid" as "its own money left", so investigating it directly called it a potential
victim while the same account reached from the victim's investigation was a potential intermediary.

These accounts are regression examples, not shortcuts: the engine never sees an ID list or ground truth. Ground truth
is read here, by the test, only to confirm what the scenario says (the ``accounts.ground_truth_label`` column, which no
inference code selects). The rule itself is also tested on synthetic records without those IDs.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.api.v2.dynamic_schemas import DynamicInvestigationRequest, InvestigatorReport  # noqa: E402
from app.intelligence import models as mdl  # noqa: E402
from app.intelligence import report as rpt  # noqa: E402
from app.intelligence import roles  # noqa: E402
from app.intelligence.datasets import DatasetRegistry  # noqa: E402
from app.intelligence.engine import DynamicInvestigation  # noqa: E402

SERVED_DB = ROOT / "data" / "v3_forensic_scenarios.db"
VICTIM, MULE = "FS-7B7C13AB", "FS-EAAA344C"
INNOCENT = "FS-D466702E"           # innocent counterparty of the same scenario (paid 3,500 at a card terminal)
RECIPIENTS = ("FS-CE13E4F4", "FS-5635F5AF")  # the two accounts FS-EAAA344C paid; both withdrew cash afterwards
VICTIM_CLASS = set(roles.VICTIM_ROLES)
SUSPICION = set(roles.INTERMEDIARY_ROLES)
REVIEW = "consider_temporary_restriction_review"
NOTICE = ("Recommendation only. No account restriction, freeze or hold has been executed. Authorized institutional "
          "approval and applicable procedures are required.")


def _ready() -> bool:
    if not SERVED_DB.exists():
        return False
    try:
        mdl.load("transaction_model")
        mdl.load("account_model")
        return True
    except mdl.ModelArtifactUnavailable:
        return False


served = pytest.mark.skipif(not _ready(), reason="served forensic ledger or the v3 models are absent")


def _compute(db_path: Path, account_id: str) -> dict:
    req = DynamicInvestigationRequest(account_id=account_id, dataset_id="forensic-scenarios")
    out, _, _ = DynamicInvestigation.compute(DatasetRegistry(f"sqlite:///{db_path}"), None, req)
    return out


@pytest.fixture(scope="module")
def runs():
    return {a: _compute(SERVED_DB, a) for a in (VICTIM, MULE)}


def truth(account_id: str) -> tuple[str, str]:
    """Evaluation-only ground truth, read by this test (never by the engine)."""
    with sqlite3.connect(SERVED_DB) as c:
        return c.execute("select ground_truth_label, scenario_id from accounts where account_id = ?", (account_id,)).fetchone()


def role(out: dict, account_id: str) -> dict:
    return next(a for a in out["role_assessments"] if a["account_id"] == account_id)


def rec(out: dict, account_id: str) -> dict:
    return next(r for r in out["investigator_report"]["recommendations"] if r["account_id"] == account_id)


# ---------------------------------------------------------------- 1-3: both accounts investigated individually
@served
def test_known_victim_is_assessed_as_a_potential_victim(runs):
    assert truth(VICTIM) == ("victim", "SC-SPLIT-0025")
    out = runs[VICTIM]
    r = role(out, VICTIM)
    assert r["role_candidate"] == "potential_victim" and r["may_be_victim"] is True
    assert out["victim_assessment"]["status"] == "potential_victim"
    assert r["restriction"]["state"] == "urgent_manual_review_recommended"  # protective urgency, never a penalty
    # Its own evidence: the 52,000 left without any money it had just received to cover it, unlike its history.
    victim_side = [i["text"] for i in r["evidence_items"] if i["side"] == "victim"]
    assert any("not funded by money it had just received" in t for t in victim_side)
    assert any("more than twice its largest earlier one" in t for t in victim_side)
    rp = rec(out, VICTIM)
    assert rp["track"] == "protective" and rp["level"] == 3 and rp["action_executed"] is False


@served
def test_known_intermediary_is_not_presented_as_a_victim(runs):
    assert truth(MULE) == ("intermediary", "SC-SPLIT-0025")
    out = runs[MULE]
    r = role(out, MULE)
    assert r["role_candidate"] == "potential_intermediary"
    assert r["may_be_victim"] is False and out["victim_assessment"]["status"] != "potential_victim"
    assert {"ACCOUNT_MODEL", "FUNDED_FORWARD"} <= set(r["evidence_categories"])
    ff = next(i["text"] for i in r["evidence_items"] if i["category"] == "FUNDED_FORWARD")
    assert "TX-303-0046124" in ff and "own earlier balance was not drawn down" in ff
    # Two independent kinds of evidence (a recorded fact and a model output): urgent review, not restriction review.
    assert r["restriction"]["state"] == "urgent_manual_review_recommended"
    rp = rec(out, MULE)
    assert rp["track"] == "suspicion" and rp["level"] == 3 and rp["action_executed"] is False
    assert out["investigator_report"]["executive_summary"]["leaning"] == "intermediary"


# ---------------------------------------------------------------- 4-5: connected views, and consistency
@served
def test_each_account_appears_as_a_connected_account_of_the_other(runs):
    mule_seen = role(runs[VICTIM], MULE)
    assert mule_seen["graph_relationship"]["position"] == "downstream" and mule_seen["graph_relationship"]["hop"] == 1
    victim_seen = role(runs[MULE], VICTIM)
    assert victim_seen["graph_relationship"]["position"] == "upstream" and victim_seen["graph_relationship"]["hop"] == 1
    assert mule_seen["role_candidate"] in SUSPICION
    assert victim_seen["role_candidate"] == "potential_victim"


@served
def test_root_and_connected_views_agree_for_both_accounts(runs):
    def side(role_candidate: str) -> str:
        return "victim" if role_candidate in VICTIM_CLASS else "suspicion" if role_candidate in SUSPICION else "other"

    for account, root_run, other_run in ((VICTIM, runs[VICTIM], runs[MULE]), (MULE, runs[MULE], runs[VICTIM])):
        as_root, as_connected = role(root_run, account), role(other_run, account)
        assert side(as_root["role_candidate"]) == side(as_connected["role_candidate"]) != "other"
        assert as_root["restriction"]["state"] == as_connected["restriction"]["state"]
        assert rec(root_run, account)["level"] == rec(other_run, account)["level"]


# ---------------------------------------------------------------- 6-7: protection and abstention
@served
def test_innocent_counterparty_stays_protected(runs):
    assert truth(INNOCENT)[0] == "innocent_counterparty"
    # Reached from the victim's investigation (its card payment came from the traced account); the intermediary's own
    # investigation does not trace that unflagged payment, so the account is not part of that trace at all.
    assert any(a["account_id"] == INNOCENT for a in runs[VICTIM]["role_assessments"])
    for out in runs.values():
        if not any(a["account_id"] == INNOCENT for a in out["role_assessments"]):
            continue
        r = role(out, INNOCENT)
        assert r["role_candidate"] == "no_suspicious_linkage_observed"
        assert r["restriction"]["state"] == "no_restriction_recommendation"
        assert rec(out, INNOCENT)["level"] == 1


@served
def test_low_history_account_abstains():
    with sqlite3.connect(SERVED_DB) as c:
        thin = c.execute("""select a from (select origin_account_id a from transactions union all
                            select destination_account_id from transactions) group by a having count(*) between 1 and 4
                            order by a limit 1""").fetchone()[0]
    out = _compute(SERVED_DB, thin)
    r = role(out, thin)
    assert r["role_candidate"] == "unknown_role" and r["assessment_status"] == "insufficient_evidence"
    assert out["investigator_report"]["executive_summary"]["review_level"] == 1
    assert out["investigator_report"]["executive_summary"]["leaning"] == "undetermined"


# ---------------------------------------------------------------- 8: unsupported dataset
def test_models_stay_reference_only_on_an_unsupported_dataset():
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app.main import create_app

    if not (ROOT / "data" / "v2_fraudshield.db").exists():
        pytest.skip("demo ledger not built")
    with TestClient(create_app()) as c:
        res = c.post("/api/v2/dynamic-investigations", json={"account_id": "ACC-000001"})
    if res.status_code == 503:
        pytest.skip("demo ledger unavailable")
    assert res.status_code == 200, res.text
    out = res.json()
    rep = out["investigator_report"]
    assert out["model_validation"]["validated_for_this_dataset"] is False
    assert rep["risk_assessment"]["model_support"]["validated_for_this_dataset"] is False
    assert rep["risk_assessment"]["transaction_model"]["used_as_evidence"] is False
    assert rep["chronology"]["model_evidence_use"] == "reference_only"
    for a in out["role_assessments"]:
        assert not {"ACCOUNT_MODEL", "TXN_MODEL"} & set(a["evidence_categories"])
    assert any("reference only" in x.lower() for x in rep["findings"]["model_output_only"])


# ---------------------------------------------------------------- 9-10: no leakage, no ID exceptions
@served
def test_scrambled_ground_truth_changes_nothing(runs, tmp_path):
    db = tmp_path / SERVED_DB.name  # same file name: the source label is part of the digest
    shutil.copy(SERVED_DB, db)
    with sqlite3.connect(db) as c:
        c.execute("update accounts set ground_truth_label = 'victim', scenario_id = 'SC-SCRAMBLED'")
        c.execute("update transactions set scenario_tag = 'scrambled', scenario_id = null, "
                  "is_suspicious_scenario = 1 - is_suspicious_scenario")
    for account, original in runs.items():
        again = _compute(db, account)
        assert again["investigation_digest"] == original["investigation_digest"]
        assert again["investigator_report"] == original["investigator_report"]


def test_no_account_id_or_scenario_name_appears_in_inference_code():
    # FS-1A2B3C4D is the documented format example in the dataset description ("Account IDs look like ..."): it names
    # no account. Every other account or scenario identifier in application code would be an ID-specific exception.
    ids = re.compile(r"FS-[0-9A-F]{8}|SC-[A-Z\-]+-\d{4}")
    for path in (ROOT / "backend" / "app").rglob("*.py"):
        found = set(ids.findall(path.read_text())) - {"FS-1A2B3C4D"}
        assert not found, f"{path} names a specific account or scenario: {sorted(found)}"


def test_the_rule_works_on_records_without_those_ids():
    """The pass-through rule on synthetic records with neutral IDs (no ledger, no ground truth)."""
    def rows(*r):
        return pd.DataFrame(r, columns=["transaction_id", "timestamp", "sender_account_id", "receiver_account_id", "amount",
                                        "sender_balance_before", "receiver_balance_before", "channel"]).assign(
            timestamp=lambda d: pd.to_datetime(d.timestamp))

    holder = "A"
    # Own savings 50,000; 52,000 arrives from a new payer; 45,000 leaves within the hour; its balance never falls.
    L = rows(("t0", "2026-01-01 10:00", "S", holder, 5_000.0, 90_000.0, 45_000.0, "UPI"),
             ("t1", "2026-02-01 20:00", "P", holder, 52_000.0, 80_000.0, 50_000.0, "UPI"),
             ("t2", "2026-02-01 20:40", holder, "R1", 41_000.0, 102_000.0, 1_000.0, "UPI"),
             ("t3", "2026-02-01 20:45", holder, "R2", 4_000.0, 61_000.0, 1_000.0, "UPI"))
    matched: list[str] = []
    unfunded, _ = DynamicInvestigation._unfunded(holder, ["t2", "t3"], L, {}, matched)
    assert unfunded == [] and sorted(matched) == ["t2", "t3"]
    # Same records, but only 9,000 of the 52,000 leaves: spending part of a payment is not passing it on.
    small = L[L.transaction_id != "t2"].copy()
    small.loc[small.transaction_id == "t3", ["amount", "sender_balance_before"]] = [9_000.0, 102_000.0]
    matched = []
    unfunded, _ = DynamicInvestigation._unfunded(holder, ["t3"], small, {}, matched)
    assert unfunded == ["t3"] and matched == []
    # No inflow at all: its own money left (the victim reading is unchanged).
    own = rows(("v1", "2026-02-01 20:00", holder, "R1", 30_000.0, 50_000.0, 1_000.0, "UPI"))
    unfunded, _ = DynamicInvestigation._unfunded(holder, ["v1"], own, {}, [])
    assert unfunded == ["v1"]
    # Forwarded the 52,000, then its own savings were drained too (a secondary victim): the drain is its own money.
    drained = rows(("t1", "2026-02-01 20:00", "P", holder, 52_000.0, 80_000.0, 50_000.0, "UPI"),
                   ("t2", "2026-02-01 20:40", holder, "R1", 50_000.0, 102_000.0, 1_000.0, "UPI"),
                   ("t4", "2026-02-01 21:30", holder, "C", 40_000.0, 52_000.0, 1_000.0, "IMPS"))
    matched = []
    unfunded, _ = DynamicInvestigation._unfunded(holder, ["t2", "t4"], drained, {}, matched)
    assert matched == ["t2"] and unfunded == ["t4"]


# ---------------------------------------------------------------- 11-13: recommendations
@served
def test_downstream_recipients_get_independent_recommendations(runs):
    rp = runs[MULE]["investigator_report"]
    rows = {r["account_id"]: r for r in rp["recommendations"]}
    downstream = [a["account_id"] for a in runs[MULE]["role_assessments"] if a["graph_relationship"]["position"] == "downstream"]
    assert set(downstream) <= set(rows) and len(downstream) >= 5
    assert len({rows[a]["level"] for a in downstream}) >= 2           # not one verdict for every recipient
    assert sum(rows[a]["level"] >= 3 for a in downstream) == 0         # no recipient is escalated for receiving money
    for a in RECIPIENTS:
        assert rows[a]["level"] <= 2 and rows[a]["account_id"] == a and rows[a]["reason"]
    connected = {c["account_id"] for c in rp["connected_accounts"]}
    assert connected == {a["account_id"] for a in runs[MULE]["role_assessments"]} - {MULE}


def test_a_model_score_alone_never_raises_a_level_above_two():
    ra = {"account_id": "X", "role_candidate": "potential_intermediary", "assessment_status": "assessed", "may_be_victim": False,
          "evidence_categories": ["ACCOUNT_MODEL", "TXN_MODEL"],
          "evidence_items": [{"category": "ACCOUNT_MODEL", "kind": "model", "side": "suspicion", "text": "model a"},
                             {"category": "TXN_MODEL", "kind": "model", "side": "suspicion", "text": "model b"}],
          "restriction": {"state": "consider_temporary_restriction_review"}}
    p = rpt.priority(ra)
    assert p["level"] == 2 and p["model_only"] and p["capped"]
    ra["evidence_items"].append({"category": "ONWARD", "kind": "observed", "side": "suspicion", "text": "fact"})
    assert rpt.priority(ra)["level"] == 4


@served
def test_no_recommendation_rests_on_model_output_alone(runs):
    for out in runs.values():
        for r in out["investigator_report"]["recommendations"]:
            if r["model_only"]:
                assert r["level"] <= 2
            if r["level"] >= 3 and r["track"] == "suspicion":
                ra = role(out, r["account_id"])
                assert any(i["kind"] == "observed" and i["side"] != "context" for i in ra["evidence_items"])


@served
def test_nothing_is_ever_executed(runs):
    from app.main import create_app

    for out in runs.values():
        assert out["automatic_actions_taken"] == []
        assert all(a["restriction"]["automatic_action_taken"] is False for a in out["role_assessments"])
        assert all(r["action_executed"] is False for r in out["investigator_report"]["recommendations"])
        assert all(r["level"] < 4 or r["track"] == "suspicion" for r in out["investigator_report"]["recommendations"])
    writes = [(r.path, sorted(r.methods)) for r in create_app().routes
              if getattr(r, "methods", None) and set(r.methods) & {"POST", "PUT", "PATCH", "DELETE"}
              and re.search(r"freeze|hold|block|restrict|suspend", r.path, re.I)]
    assert writes == []


# ---------------------------------------------------------------- 14-15: report matches the response; amounts
@served
def test_report_sections_match_the_api_response(runs):
    for root, out in runs.items():
        rp = out["investigator_report"]
        InvestigatorReport.model_validate(rp)
        r = role(out, root)
        es = rp["executive_summary"]
        assert (es["account_id"], es["candidate_role"], es["headline"]) == (root, r["role_candidate"], r["headline"])
        assert es["dataset_id"] == out["dataset"]["dataset_id"] == "forensic-scenarios"
        assert {x["account_id"] for x in rp["recommendations"]} == {a["account_id"] for a in out["role_assessments"]}
        for x in rp["recommendations"]:
            ra = role(out, x["account_id"])
            assert (x["role_candidate"], x["restriction_state"]) == (ra["role_candidate"], ra["restriction"]["state"])
        assert [b["branch_id"] for b in rp["fund_flow"]["branches"]] == [b["branch_id"] for b in out["fund_trace"]["branches"]]
        assert [b["ending_reason"] for b in rp["fund_flow"]["branches"]] == [b["ending"]["reason"] for b in out["fund_trace"]["branches"]]
        flagged_rows = {x["transaction_id"] for x in rp["chronology"]["rows"] if x["flagged"]}
        assert flagged_rows == {t["transaction_id"] for t in out["suspicious_transactions"]
                                if root in (t["sender_account_id"], t["receiver_account_id"])}
        assert rp["risk_assessment"]["contradictory_evidence"] == r["contradictory_evidence"]
        assert rp["generator"]["language_model_used"] is False and rp["generator"]["kind"] == "deterministic"


@served
def test_amounts_are_attributed_per_hop_and_never_added_across_hops(runs):
    out = runs[MULE]
    flow = out["investigator_report"]["fund_flow"]
    edges = out["investigation"]["trace"]["edges"] if "investigation" in out else None
    assert flow["flagged_outgoing_total"] == pytest.approx(41_621.41 + 3_500.0)  # the two flagged transfers out of FS-EAAA344C
    first = {f["account_id"]: f["amount"] for f in flow["first_recipients"]}
    assert first == {"FS-CE13E4F4": 41_621.41, "FS-5635F5AF": 3_500.0}
    for h in flow["hops"]:
        assert h["transfers"] >= 1 and h["total"] > 0
    assert "not added together" in flow["amount_note"] and "not a loss figure" in flow["amount_note"]
    for a in flow["attribution"]:
        if a["received_traced"] is not None and a["forwarded_at_most"] is not None:
            assert a["kept_at_least"] == pytest.approx(a["received_traced"] - a["forwarded_at_most"])
            assert a["forwarded_at_least"] <= a["forwarded_at_most"] <= a["received_traced"] + 1e-6
    assert edges is None  # the engine's own output (not the API wrapper) carries the report
    assert not any(k for k in flow if "grand" in k or "stolen" in k or "loss" in k)


# ---------------------------------------------------------------- 16-18: Gemini off; contradictions; wording
def test_report_is_built_with_the_ai_analyst_disabled(monkeypatch, tmp_path):
    pytest.importorskip("fastapi")
    if not _ready():
        pytest.skip("served forensic ledger or the v3 models are absent")
    from fastapi.testclient import TestClient
    from app.intelligence.datasets import get_dataset_registry
    from app.main import create_app
    from app.services.v2 import ai_analyst

    monkeypatch.setenv("GEMINI_ANALYST_ENABLED", "false")
    monkeypatch.delenv("GEMINI_ANALYST_PRODUCTION_APPROVED", raising=False)

    async def no_call(*a, **k):  # any attempt to reach the AI analyst fails the test
        raise AssertionError("the AI analyst must not be called to build the report")

    monkeypatch.setattr(ai_analyst, "analyze", no_call)
    app = create_app()
    registry = DatasetRegistry(f"sqlite:///{SERVED_DB}")
    app.dependency_overrides[get_dataset_registry] = lambda: registry
    with TestClient(app) as c:
        res = c.post("/api/v2/dynamic-investigations", json={"account_id": MULE, "dataset_id": "forensic-scenarios"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["investigation"]["ai_analysis"]["state"] in ("disabled", "not_configured")
    assert body["investigator_report"]["generator"] == {"kind": "deterministic", "language_model_used": False,
                                                        "description": rpt.GENERATOR["description"]}
    assert body["investigator_report"]["executive_summary"]["candidate_role"] == "potential_intermediary"


@served
def test_missing_data_and_contradictory_evidence_are_shown(runs):
    victim = role(runs[VICTIM], VICTIM)
    counter = [c for c in victim["contradictory_evidence"] if c.startswith(roles.COUNTER_PREFIX)]
    assert counter and "model output" in counter[0] and "account behaviour model" in counter[0]
    model_item = next(i for i in victim["evidence_items"] if i["category"] == "ACCOUNT_MODEL")
    assert model_item["side"] == "suspicion"  # shown, but never as support for the victim role
    rv = runs[VICTIM]["investigator_report"]
    assert all(e["kind"] != "model" for e in rv["risk_assessment"]["victim_side_evidence"])
    assert any(e["kind"] == "model" for e in rv["risk_assessment"]["suspicion_side_evidence"])
    mule = role(runs[MULE], MULE)
    assert any(c.startswith("Established records") for c in mule["contradictory_evidence"])
    for out in runs.values():
        rp = out["investigator_report"]
        assert rp["risk_assessment"]["missing_information"]
        assert any("authorised or knew" in u for u in rp["findings"]["unknown"])
        assert rp["findings"]["records_to_obtain"]


@served
def test_report_never_claims_a_hold_was_executed(runs):
    executed = re.compile(r"\b(has been|was|were|have been)\s+(frozen|restricted|blocked|held|suspended)\b|hold (was|has been) placed"
                          r"|account (is|was) frozen", re.I)
    for out in runs.values():
        rp = out["investigator_report"]
        assert rp["notice"] == NOTICE
        text = json.dumps(rp).replace(NOTICE, "")
        assert not executed.search(text), executed.search(text)
        assert any("never restricts, freezes or holds" in s for s in rp["safeguards"])
