"""The AI explanation of a dynamic investigation is built from the dynamic output, and the V2 demo-ledger account model
stays out of other datasets. Gemini is never called: a fake provider stands in for it."""

from __future__ import annotations

import asyncio
import copy
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.api.v2.investigation_schemas import InvestigationRequest
from app.db.v2.session import get_v2_engine, get_v2_sessionmaker
from app.intelligence import engine
from app.intelligence.datasets import DatasetRegistry
from app.services.v2 import ai_analyst
from app.services.v2.ai_analyst import AnalystConfig, build_payload
from app.services.v2.gemini_provider import ProviderOutput
from app.services.v2.investigation import InvestigationService
from app.services.v2.ml_service import V2MLInferenceService
from tests.test_v3_dynamic_intelligence import (  # noqa: F401 - pytest fixtures
    client, first_role, forensic_db, investigate, needs_models, small_ledger,
)

FIXTURE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "test" / "fixtures" / "dynamic.json"
REAL_ID = re.compile(r"\b(?:FS|TX|ACC|TXN)-[A-Za-z0-9]")


def cfg(**over) -> AnalystConfig:
    base = dict(enabled=True, api_key_present=True, model="gemini-test-model", timeout_seconds=5, max_output_tokens=2048,
                thinking_level="low", privacy_policy="synthetic_only")
    return AnalystConfig(**{**base, **over})


def payload_of(call) -> dict:
    return json.loads(call["contents"].split("<investigation_data>\n")[1].split("\n</investigation_data>")[0])


class FakeProvider:
    name = "fake-gemini"

    def __init__(self, reply):
        self.reply, self.calls = reply, []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return ProviderOutput(text=self.reply(kwargs), finish_reason="STOP", blocked=False)


def cited_reply(call) -> str:
    """A valid answer that cites only IDs from the dynamic sections it was shown."""
    p = payload_of(call)
    acc = p["accounts"][0]["id"]
    t = p["flagged_transfers"][0]["id"] if p["flagged_transfers"] else None
    ids = [acc] + ([t] if t else [])
    return json.dumps({
        "summary": f"{acc} is assessed as {p['accounts'][0]['role_candidate'].replace('_', ' ')}.",
        "key_observations": [{"text": f"{acc} has a role assessment.", "basis": "observed", "evidence_ids": ids}],
        "evidence_references": ids,
        "reasoning_and_limitations": ["The ledger does not show intent."],
        "recommended_manual_checks": [{"text": f"Verify {acc} through an authorised process.", "evidence_ids": [acc]}],
        "confidence_note": "Device and login records are not in the ledger.",
    })


@pytest.fixture(scope="module")
def dyn_fixture() -> dict:
    return json.loads(FIXTURE.read_text())


# ---------------------------------------------------------------- AI payload from the dynamic output
def test_dynamic_payload_carries_role_engine_output_not_the_trace_reports(dyn_fixture):
    d = copy.deepcopy(dyn_fixture)
    ref = d["role_assessments"][1]
    ref["account_model"] = {**ref["account_model"], "status": "reference_only"}
    payload, ps, allowed = build_payload(d["investigation"], d)
    accounts = {ps.reverse[a["id"]]: a for a in payload["accounts"]}
    for ra in d["role_assessments"][: ai_analyst.MAX_ACCOUNTS]:
        a = accounts[ra["account_id"]]
        assert a["role_candidate"] == ra["role_candidate"] and a["restriction_state"] == ra["restriction"]["state"]
        assert len(a["evidence"]) == min(8, len(ra["evidence_items"]))
        assert len(a["contradictory_evidence"]) == min(6, len(ra["contradictory_evidence"]))
        assert "role_label" not in a and "model_score_pct" not in a and "model_suggests_review" not in a
        # Only a validated (status 'scored') account model is sent; a reference-only score is not.
        assert (a["account_model"] is not None) == (ra["account_model"]["status"] == "scored")
    assert accounts[ref["account_id"]]["account_model"] is None
    assert [ps.reverse[t["id"]] for t in payload["flagged_transfers"]] == [t["transaction_id"] for t in d["suspicious_transactions"][:20]]
    assert payload["investigation_assessment"]["restriction_state"] == d["restriction_recommendation"]["state"]
    assert all(f["kind"] != "model" for f in payload["findings"]), "the trace report's own model statements are not sent"
    assert "model_review_threshold_pct" not in payload["scope"]
    # Pseudonymisation is as strict as before: no real account or transfer ID anywhere in what is sent.
    text = json.dumps(payload)
    assert not REAL_ID.search(text), REAL_ID.search(text)
    assert allowed and all(tok in ps.reverse or tok.startswith("F-") for tok in allowed)


def test_dynamic_explanation_is_grounded_in_what_was_sent(dyn_fixture):
    d = dyn_fixture
    fake = FakeProvider(cited_reply)
    ai = asyncio.run(ai_analyst.analyze(d["investigation"], fake, cfg(), dynamic=d))
    assert len(fake.calls) == 1 and ai["state"] == "completed"
    assert ai["report"]["key_observations"][0]["evidence_ids"][0] == d["role_assessments"][0]["account_id"]

    def unknown_id(call) -> str:
        r = json.loads(cited_reply(call))
        r["key_observations"][0]["evidence_ids"] = ["PA-999"]
        return json.dumps(r)

    ai = asyncio.run(ai_analyst.analyze(d["investigation"], FakeProvider(unknown_id), cfg(), dynamic=d))
    assert ai["state"] == "unavailable" and ai["unavailable_reason"] == "invalid_output"


def test_v2_payload_is_unchanged_without_dynamic_output(dyn_fixture):
    base = dyn_fixture["investigation"]
    payload, _, _ = build_payload(base)
    assert "role_label" in payload["accounts"][0] and "investigation_assessment" not in payload


# ---------------------------------------------------------------- precheck
def test_precheck_catches_settings_the_model_does_not_accept():
    ai = ai_analyst.precheck(None, None, cfg(model="gemini-3.8-flash", thinking_level="minimal"))
    assert (ai["state"], ai["unavailable_reason"]) == ("unavailable", "invalid_configuration")
    assert ai_analyst.precheck(None, None, cfg()) is None


@needs_models
def test_invalid_settings_are_reported_on_the_report_instead_of_deferred(client, small_ledger, monkeypatch):
    monkeypatch.setenv("GEMINI_ANALYST_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "minimal")
    ai = investigate(client, first_role(small_ledger, "victim", "direct")).json()["investigation"]["ai_analysis"]
    assert (ai["state"], ai["unavailable_reason"]) == ("unavailable", "invalid_configuration")


def test_explanation_of_an_unknown_account_is_a_404_even_with_the_analyst_off(client):
    r = client.post("/api/v2/dynamic-investigations/explanation", json={"account_id": "FS-NOT-THERE", "dataset_id": "forensic-scenarios"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "account_not_found"


@needs_models
def test_dynamic_explanation_endpoint_sends_the_dynamic_output(client, small_ledger, monkeypatch):
    victim = first_role(small_ledger, "victim", "direct")
    report = investigate(client, victim).json()
    fake = FakeProvider(cited_reply)
    monkeypatch.setattr(ai_analyst, "_gemini_module", lambda: SimpleNamespace(GeminiProvider=lambda *a, **k: fake))
    monkeypatch.setenv("GEMINI_ANALYST_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    ex = client.post("/api/v2/dynamic-investigations/explanation", json={"account_id": victim, "dataset_id": "forensic-scenarios"}).json()
    assert ex["report_digest"] == report["investigation"]["report_digest"]
    assert ex["ai_analysis"]["state"] == "completed", ex["ai_analysis"]
    sent = payload_of(fake.calls[0])
    assert {a["role_candidate"] for a in sent["accounts"]} <= {r["role_candidate"] for r in report["role_assessments"]}
    assert len(sent["flagged_transfers"]) == min(20, len(report["suspicious_transactions"]))
    assert not REAL_ID.search(fake.calls[0]["contents"])


# ---------------------------------------------------------------- the V2 account model stays on the demo ledger
def test_trace_report_without_the_v2_model_has_no_v2_scores(forensic_db, small_ledger, monkeypatch):
    def never(*_a, **_k):
        raise AssertionError("the V2 account model must not run")

    monkeypatch.setattr(V2MLInferenceService, "assess_account", never)
    S = get_v2_sessionmaker(get_v2_engine(forensic_db))
    with S() as db:
        source = DatasetRegistry(forensic_db).describe("forensic-scenarios", db)
        req = InvestigationRequest(account_id=first_role(small_ledger, "victim", "direct"), ai_explanation="separate")
        base, _, _ = InvestigationService.compute_with_trace(db, req, source=source, use_v2_model=False)
    assert base["model_available"] is False and "not used on this dataset" in base["model_unavailable_reason"]
    assert base["model_review_threshold"] is None
    assert all(a["model_assessment"] is None and a["checks_disagree"] is None for a in base["accounts"])
    assert not [f for f in base["findings"] if f["kind"] == "model"]
    assert not any("could not run" in f["statement"] for f in base["findings"])


@needs_models
def test_forensic_dynamic_report_drops_v2_model_output_and_superseded_recommendations(client, small_ledger):
    d = investigate(client, first_role(small_ledger, "victim", "split")).json()
    base = d["investigation"]
    assert all(a["model_assessment"] is None for a in base["accounts"])
    assert not [f for f in base["findings"] if f["kind"] == "model"]
    assessed = {r["account_id"] for r in d["role_assessments"]}
    assert not [r for r in base["recommendations"] if r["action"] in engine.SUPERSEDED_ACTIONS and r["account_id"] in assessed]
    claims = [c["text"] for s in base["evidence_summary"] for c in s["claims"]]
    for acc in assessed:
        assert not any(t.startswith((f"Consider escalating {acc} ", f"Review {acc}: its checks suggest review")) for t in claims)


def test_superseded_recommendations_are_dropped_only_for_assessed_accounts():
    base = {
        "recommendations": [
            {"recommendation_id": "R-001", "action": "consider_escalation", "account_id": "A", "statement": "Escalate A."},
            {"recommendation_id": "R-002", "action": "further_review", "account_id": "B", "statement": "Review B."},
            {"recommendation_id": "R-003", "action": "contact_account_holder", "account_id": "A", "statement": "Contact A."},
            {"recommendation_id": "R-004", "action": "obtain_records", "account_id": None, "statement": "Obtain records."},
        ],
        "evidence_summary": [{"question": "q", "claims": [{"kind": "interpretation", "text": t, "refs": []}
                                                         for t in ("Escalate A.", "Review B.", "Contact A.", "Obtain records.")]}],
    }
    engine.drop_superseded_recommendations(base, {"A"})
    assert [r["recommendation_id"] for r in base["recommendations"]] == ["R-002", "R-003", "R-004"]
    assert [c["text"] for c in base["evidence_summary"][0]["claims"]] == ["Review B.", "Contact A.", "Obtain records."]
