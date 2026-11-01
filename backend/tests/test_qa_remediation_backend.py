"""QA remediation (2026-11-02): QA-06 (flag counts never mix the two checks), QA-07 (model status names the v3 models
that investigations use), QA-08 (sample accounts: cached, ground-truth free), QA-09 (training-range check tolerates
floating-point noise), QA-10 (UPI IDs masked), QA-15 (security headers, also on unhandled 500s) and QA-16 (the dataset
list carries each dataset's model support state)."""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.api.v2 import dynamic_routes
from app.intelligence.datasets import DATASETS
from app.intelligence.models import ScoringModel
from app.main import create_app
from app.services.v2.account_service import _mask_upi
from tests.test_v2_investigation import ledger  # noqa: F401 - pytest fixture
from tests.test_v3_dynamic_intelligence import (  # noqa: F401 - pytest fixtures
    client, first_role, forensic_db, investigate, needs_models, small_ledger,
)


# ---------------------------------------------------------------- QA-03 (role engine; rules designed on the train ledger)
from app.intelligence import roles  # noqa: E402


def _sender(**kw):
    base = dict(account_id="S", position="other_sender", hop=None, n_transactions=40, history_days=120.0,
                flagged_out_ids=["T1"], flagged_out_unfunded_ids=["T1"], deviation=["1 flagged transfer(s) went to account(s) it had never paid before."],
                paid_account_id="HUB", paid_account_role="potential_intermediary", recent_inflow_share=0.0, balance_share=0.8)
    return roles.AccountEvidence(**{**base, **kw})


def test_other_sender_is_a_potential_victim_only_when_it_lost_its_own_money():
    assert roles.assess(_sender()).role_candidate == "potential_victim"
    # Passing on money that had just arrived (the 49 intermediaries on the train ledger) ...
    passing_on = roles.assess(_sender(recent_inflow_share=1.1))
    assert passing_on.role_candidate == "unknown_role" and "passing money on" in passing_on.uncertainty_reason
    # ... or a payment that took a small part of the balance (the FS-7305E412 shape: 30%) is not called a victim.
    small = roles.assess(_sender(balance_share=0.30))
    assert small.role_candidate == "unknown_role" and "less than 50% of its balance" in small.uncertainty_reason
    assert roles.assess(_sender(balance_share=None)).role_candidate == "unknown_role", "unknown balance: no victim label"
    for r in (passing_on, small):
        assert not r.may_be_victim and r.evidence_strength == "none"


def test_investigated_forwarder_with_one_kind_of_evidence_abstains():
    e = roles.AccountEvidence(account_id="R", position="investigated", hop=0, n_transactions=40, history_days=120.0,
                              flagged_out_ids=["T1"], flagged_out_unfunded_ids=[])
    r = roles.assess(e)
    assert r.role_candidate == "unknown_role" and r.categories == ["FUNDED_FORWARD"]
    assert any("paid out of money received in the previous 24 h" in x for x in r.supporting), "the observation stays visible"
    assert roles.restriction(e, r, [])["state"] == "insufficient_evidence_to_recommend"


def test_a_sentence_about_a_model_flag_is_labelled_a_model_output_not_a_recorded_fact():
    from app.intelligence import engine

    assert engine.MODEL_SENTENCE.search("Its own transfer T1 is flagged by the transaction model.")
    assert engine.MODEL_SENTENCE.search("The account behaviour model scores it below its review threshold")
    assert not engine.MODEL_SENTENCE.search("Paid out 46,000 within 24 h of receiving 50,000.")


@needs_models
def test_no_model_statement_is_shown_as_a_recorded_fact(client, small_ledger):  # noqa: F811
    for pattern in ("multi_victim", "direct", "consolidation"):
        try:
            root = first_role(small_ledger, "victim", pattern)
        except IndexError:
            continue
        for a in investigate(client, root).json()["role_assessments"]:
            for item in a["evidence_items"]:
                if "transaction model" in item["text"] or "behaviour model" in item["text"]:
                    assert item["kind"] == "model", item


# ---------------------------------------------------------------- QA-06
@needs_models
def test_suspicious_and_rule_only_transfers_are_counted_apart(client, small_ledger):  # noqa: F811
    for pattern in ("direct", "mule_chain", "split"):
        try:
            victim = first_role(small_ledger, "victim", pattern)
        except IndexError:
            continue
        out = investigate(client, victim).json()
        assert out["transaction_scoring"]["model_used_as_evidence"] is True
        susp = {t["transaction_id"] for t in out["suspicious_transactions"]}
        rule_only = {t["transaction_id"] for t in out["uncorroborated_rule_flags"]}
        assert not susp & rule_only, "a transfer is in only one of the two lists"
        assert all(t["model_flag"] for t in out["suspicious_transactions"]), "with a validated model the list holds model flags only"
        assert all(t["rule_flags"] and not t["model_flag"] for t in out["uncorroborated_rule_flags"])


# ---------------------------------------------------------------- QA-07
def test_model_status_names_the_v3_models_used_by_investigations():
    c = TestClient(create_app())
    body = c.get("/api/v2/models/status").json()
    im = body["investigation_models"]
    assert im is not None and im["used_by"].startswith("Investigate page")
    assert "Accounts tool" in body["account_model_scope"]
    if im["ready"]:
        assert im["transaction_model"]["model_version"].startswith("v3-transaction")
        assert im["account_model"]["model_version"].startswith("v3-account")
        assert body["account_model"]["version"] != im["account_model"]["model_version"]
    assert {d["dataset_id"]: d["model_support"] for d in im["datasets"]} == {k: v.model_support for k, v in DATASETS.items()}


# ---------------------------------------------------------------- QA-08
def test_sample_accounts_are_cached_per_ledger_and_never_read_ground_truth(client, forensic_db):  # noqa: F811
    dynamic_routes._sample_cache.clear()
    from sqlalchemy.engine import Engine

    statements: list[str] = []

    def capture(conn, cursor, statement, *_):
        statements.append(statement.lower())

    engine = Engine  # every engine: whichever one the registry opened
    event.listen(engine, "before_cursor_execute", capture)
    try:
        t0 = time.perf_counter()
        first = client.get("/api/v2/datasets/forensic-scenarios/sample-accounts")
        cold = time.perf_counter() - t0
        n_cold = len(statements)
        t0 = time.perf_counter()
        second = client.get("/api/v2/datasets/forensic-scenarios/sample-accounts")
        warm = time.perf_counter() - t0
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert first.status_code == second.status_code == 200 and first.json() == second.json()
    assert len(first.json()["accounts"]) <= dynamic_routes.SAMPLE_COUNT
    assert n_cold > 1 and len(statements) - n_cold == 1, "a cached answer costs one indexed lookup (the snapshot key)"
    assert warm < cold
    for sql in statements:
        for forbidden in ("scenario", "ground_truth", "is_suspicious", "label"):
            assert forbidden not in sql, (forbidden, sql[:200])


def test_sample_rule_keeps_only_established_accounts_paying_from_their_own_money(client, forensic_db, small_ledger):  # noqa: F811
    dynamic_routes._sample_cache.clear()
    accounts = [a["account_id"] for a in client.get("/api/v2/datasets/forensic-scenarios/sample-accounts").json()["accounts"]]
    tx = small_ledger.transactions
    ts = pd.to_datetime(tx.timestamp)
    for a in accounts:
        mine = tx[(tx.origin_account_id == a) & (tx.amount >= 10_000) & (tx.origin_balance_before > 0)
                  & (tx.amount >= 0.5 * tx.origin_balance_before)]
        big = mine.loc[mine.amount.idxmax()]
        t = pd.to_datetime(big.timestamp)
        before = tx[((tx.origin_account_id == a) | (tx.destination_account_id == a)) & (ts < t)]
        assert len(before) >= 10 and (t - pd.to_datetime(before.timestamp).min()).days >= 30
        recent_in = tx[(tx.destination_account_id == a) & (ts < t) & (ts >= t - pd.Timedelta(hours=24))].amount.sum()
        assert recent_in < 0.7 * big.amount


# ---------------------------------------------------------------- QA-09
def test_training_range_check_tolerates_one_floating_point_step():
    bound = 1.0986122886681098
    m = ScoringModel(name="t", meta={"training_ranges": {"f": [0.0, bound]}}, features=["f"])
    X = pd.DataFrame({"f": [np.nextafter(bound, 0), bound, np.nextafter(bound, 2), bound + 1e-6, -1e-6, -1e-12, np.nan]})
    assert m.out_of_range(X).tolist() == [0, 0, 0, 1, 1, 0, 0]


# ---------------------------------------------------------------- QA-10
def test_upi_ids_are_masked_like_email_addresses(ledger):  # noqa: F811
    client, _, _ = ledger
    body = client.get("/api/v2/accounts/ACC-VIC").json()
    assert body["upi_id"] != "acc-vic@ok" and body["upi_id"].endswith("@ok") and "*" in body["upi_id"]
    assert _mask_upi("aditijoshi0001@okhdfcbank") == "a******1@okhdfcbank"
    assert _mask_upi("no-handle") == "****" and _mask_upi(None) == ""


# ---------------------------------------------------------------- QA-12
def test_rule_signal_amounts_are_shown_in_rupees_with_indian_grouping(ledger):  # noqa: F811
    from app.services.v2.formatting import inr
    from app.services.v2.risk_assessment import AccountRiskAssessor

    assert inr(250000) == "₹2,50,000" and inr(78673.99) == "₹78,673.99" and inr(-1234.5) == "-₹1,234.50"
    _, S, _ = ledger
    with S() as db:
        codes = AccountRiskAssessor.assess_account(db, "ACC-VIC").reason_codes
    spike = [c for c in codes if c.startswith("UNUSUAL_AMOUNT_SPIKE")]
    assert spike, codes
    assert "₹2,50,000" in spike[0] and "250000.00" not in spike[0]


# ---------------------------------------------------------------- QA-15
@pytest.fixture
def boom_client(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://frontend.example")
    app = create_app()
    r = APIRouter()

    @r.get("/api/qa15-boom")
    def boom():
        raise RuntimeError("qa15-internal-detail")

    app.include_router(r)
    return TestClient(app, raise_server_exceptions=False)


def test_unhandled_errors_keep_security_and_cors_headers(boom_client):
    r = boom_client.get("/api/qa15-boom", headers={"Origin": "https://frontend.example"})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_server_error"
    assert "qa15-internal-detail" not in r.text
    assert r.headers["access-control-allow-origin"] == "https://frontend.example"
    for h in ("x-content-type-options", "x-frame-options", "content-security-policy", "strict-transport-security"):
        assert h in r.headers, h


def test_api_security_headers(boom_client, monkeypatch):
    r = boom_client.get("/health")
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    assert r.headers["strict-transport-security"].startswith("max-age=")
    assert r.headers["x-xss-protection"] == "0"
    monkeypatch.setenv("ENVIRONMENT", "development")
    dev = TestClient(create_app()).get("/health")
    assert "strict-transport-security" not in dev.headers, "HSTS only in production"


def test_frontend_headers_are_configured_for_vercel():
    import json
    from pathlib import Path

    cfg = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "vercel.json").read_text())
    headers = {h["key"]: h["value"] for block in cfg["headers"] for h in block["headers"]}
    for key in ("Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
        assert key in headers
    csp = headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "unsafe-eval" not in csp
    assert "https://*.onrender.com" in csp, "the API origin must stay reachable"


# ---------------------------------------------------------------- QA-16
def test_dataset_list_states_model_support_before_any_account_is_chosen(client):  # noqa: F811
    body = client.get("/api/v2/datasets").json()
    got = {d["dataset_id"]: d["model_support"] for d in body}
    assert got == {"demo-ledger": "unsupported_distribution_shift", "forensic-scenarios": "validated_in_distribution"}
    assert all(d["model_note"] for d in body)
