"""Dynamic fraud intelligence: data layer, leakage safety, models, tracing, roles, restriction safety and the API."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.v2.ingestion import ingest_v2_dataset  # noqa: E402
from app.db.v2.models import AccountModel, TransactionModel  # noqa: E402
from app.db.v2.session import get_v2_db, get_v2_engine, get_v2_sessionmaker  # noqa: E402
from app.intelligence import models as mdl  # noqa: E402
from app.intelligence import roles  # noqa: E402
from app.intelligence.datasets import DATASETS, DatasetRegistry, get_dataset_registry  # noqa: E402
from app.intelligence.engine import DynamicInvestigation  # noqa: E402
from app.intelligence.features import (  # noqa: E402
    ACCOUNT_FEATURES, FORBIDDEN_INPUTS, GRAPH_FEATURES, MIN_ACCOUNT_TRANSACTIONS, TXN_FEATURES, account_features,
    graph_features, transaction_features,
)
from app.intelligence.schema import NORMALIZED_COLUMNS, validate_transactions  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.v2 import ai_analyst  # noqa: E402

from ml.forensics.adapters import forensic_frame  # noqa: E402
from ml.forensics.generator import ForensicLedgerConfig, ForensicScenarioGenerator  # noqa: E402

INTEL = ROOT / "backend" / "app" / "intelligence"
GROUND_TRUTH_FIELDS = ("ground_truth_label", "scenario_tag", "is_suspicious_scenario", "scenario_id")
SMALL = ForensicLedgerConfig(seed=4242, num_people=700, num_merchants=60, num_employers=8, days=75, include_held_out=True,
                             instances={"direct": 3, "chain": 3, "multi_hop": 3, "split": 3, "consolidation": 2, "circular": 2,
                                        "multi_victim": 2, "takeover": 3, "lookalike": 2})


def models_present() -> bool:
    try:
        mdl.load("transaction_model")
        mdl.load("account_model")
        return True
    except mdl.ModelArtifactUnavailable:
        return False


needs_models = pytest.mark.skipif(not models_present(), reason="v3 model artifacts not built")


# ---------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def small_ledger():
    return ForensicScenarioGenerator(SMALL).generate()


@pytest.fixture(scope="module")
def frame(small_ledger):
    return forensic_frame(small_ledger)


@pytest.fixture(scope="module")
def forensic_db(small_ledger, tmp_path_factory):
    d = tmp_path_factory.mktemp("forensic")
    paths = small_ledger.write(str(d / "csv"))
    url = f"sqlite:///{d / 'forensic.db'}"
    engine = get_v2_engine(url)
    res = ingest_v2_dataset(engine, paths["accounts"], paths["transactions"], replace=True)
    assert not res.errors
    engine.dispose()
    return url


@pytest.fixture
def client(forensic_db):
    app = create_app()
    registry = DatasetRegistry(forensic_db)
    app.dependency_overrides[get_dataset_registry] = lambda: registry
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def investigate(client, account_id, **kw):
    return client.post("/api/v2/dynamic-investigations", json={"account_id": account_id, "dataset_id": "forensic-scenarios", **kw})


def first_role(ledger, role, pattern=None):
    r = ledger.roles[(ledger.roles.role == role) & ledger.roles.materialised]
    if pattern:
        r = r[r.scenario_id.map(ledger.scenarios.set_index("scenario_id")["pattern"]) == pattern]
    return r.account_id.iloc[0]


# ---------------------------------------------------------------- data layer
def test_validation_rejects_bad_rows_and_counts_warnings(frame):
    df = frame.head(50).copy()
    bad = pd.concat([df.iloc[[0]], df.iloc[[1]]], ignore_index=True)
    bad.loc[1, "transaction_id"] = bad.loc[0, "transaction_id"]  # duplicate id
    extra = df.iloc[2:8].copy().reset_index(drop=True)
    extra["timestamp"] = extra["timestamp"].astype(object)
    extra.loc[0, "timestamp"] = "not a date"
    extra.loc[1, "amount"] = -5
    extra.loc[2, "sender_account_id"] = None
    extra.loc[3, "transaction_type"] = "TELEPORT"
    extra.loc[4, "receiver_account_id"] = extra.loc[4, "sender_account_id"]  # self transfer -> warning only
    extra.loc[5, "sender_balance_before"] = extra.loc[5, "amount"] / 2  # contradictory balance -> warning only
    ok, rep = validate_transactions(pd.concat([bad, extra], ignore_index=True))
    assert rep.errors == {"duplicate_transaction_id": 2, "invalid_timestamp": 1, "invalid_amount": 1, "missing_sender": 1,
                          "unexpected_transaction_type": 1}
    assert rep.warnings["self_transfer"] == 1 and rep.warnings["sender_balance_below_amount"] >= 1
    assert len(ok) == rep.rows_valid == 2


def test_validation_rejects_unknown_account_references_and_missing_columns(frame):
    df = frame.head(10)
    _, rep = validate_transactions(df, known_accounts=set(df.sender_account_id))
    assert rep.errors.get("unknown_account_reference", 0) > 0
    with pytest.raises(ValueError):
        validate_transactions(df.drop(columns=["channel"]))


def test_generator_is_deterministic_and_never_overwrites_balances(small_ledger):
    again = ForensicScenarioGenerator(SMALL).generate()
    assert small_ledger.transactions.equals(again.transactions) and small_ledger.roles.equals(again.roles)
    tx = small_ledger.transactions
    assert (tx.amount > 0).all() and (tx.origin_balance_before >= tx.amount - 1e-6).all()
    assert (tx.origin_account_id != tx.destination_account_id).all()
    assert set(small_ledger.roles.role) <= set(roles_doc := __import__("ml.forensics.generator", fromlist=["ROLE_DEFINITIONS"]).ROLE_DEFINITIONS)
    assert roles_doc  # every role used has a written definition


# ---------------------------------------------------------------- leakage
def test_identifiers_labels_and_post_event_fields_are_never_model_inputs():
    for feats in (TXN_FEATURES, ACCOUNT_FEATURES, GRAPH_FEATURES):
        assert not set(feats) & FORBIDDEN_INPUTS
    if models_present():
        for name in ("transaction_model", "account_model"):
            assert not set(mdl.load(name).features) & FORBIDDEN_INPUTS


def test_inference_code_never_reads_ground_truth():
    for name in ("engine.py", "roles.py", "ledger.py", "explain.py", "models.py", "datasets.py"):
        src = (INTEL / name).read_text()
        for field in GROUND_TRUTH_FIELDS:
            assert field not in src, f"{name} references {field}"
    src = (INTEL / "features.py").read_text()
    body = src.split("FORBIDDEN_INPUTS = {")[1].split("}", 1)[1]  # everything after the deny-list itself
    for field in GROUND_TRUTH_FIELDS:
        assert field not in body


def test_features_do_not_change_when_account_ids_are_relabelled(frame):
    ids = pd.unique(pd.concat([frame.sender_account_id, frame.receiver_account_id]))
    rng = np.random.default_rng(1)
    mapping = dict(zip(ids, [f"ZZ-{i:07d}" for i in rng.permutation(len(ids))]))
    other = frame.assign(sender_account_id=frame.sender_account_id.map(mapping), receiver_account_id=frame.receiver_account_id.map(mapping),
                         transaction_id="T" + frame.transaction_id.str[::-1])
    a, b = transaction_features(frame), transaction_features(other)
    assert np.allclose(a.to_numpy(), b.to_numpy(), equal_nan=True)
    accs = list(ids[:40])
    fa = account_features(frame, accs).join(graph_features(frame, accs))
    fb = account_features(other, [mapping[x] for x in accs]).join(graph_features(other, [mapping[x] for x in accs]))
    assert np.allclose(fa.to_numpy(), fb.to_numpy(), equal_nan=True)
    if models_present():
        m = mdl.load("transaction_model")
        assert np.allclose(m.raw_scores(a), m.raw_scores(b))


def test_adding_or_changing_future_transactions_does_not_change_earlier_predictions(frame):
    cut = frame.timestamp.quantile(0.6)
    past = frame[frame.timestamp <= cut]
    future = frame[frame.timestamp > cut].copy()
    future["amount"] = future["amount"] * 7.0  # change the future drastically
    before = transaction_features(past)
    after = transaction_features(pd.concat([past, future], ignore_index=True)).iloc[: len(past)]
    assert np.allclose(before.to_numpy(), after.to_numpy(), equal_nan=True)
    accs = list(pd.unique(past.sender_account_id)[:30])
    ab = account_features(past, accs, as_of=cut).join(graph_features(past, accs, as_of=cut))
    aa = account_features(frame, accs, as_of=cut).join(graph_features(frame, accs, as_of=cut))
    assert np.allclose(ab.to_numpy(), aa.to_numpy(), equal_nan=True)


def test_party_history_extract_gives_the_same_features_as_the_whole_ledger(frame):
    targets = frame.index[np.random.default_rng(3).choice(len(frame), 150, replace=False)]
    parties = set(frame.loc[targets, "sender_account_id"]) | set(frame.loc[targets, "receiver_account_id"])
    sub = frame[frame.sender_account_id.isin(parties) | frame.receiver_account_id.isin(parties)]
    assert np.allclose(transaction_features(frame).loc[targets].to_numpy(), transaction_features(sub, targets).to_numpy(), equal_nan=True)


def test_historical_features_are_computed_from_strictly_earlier_records():
    t0 = pd.Timestamp("2026-01-01 10:00")
    rows = [("T1", 0, "A", "B", 1000.0), ("T2", 10, "A", "C", 2000.0), ("T3", 20, "A", "B", 500.0),
            ("T4", 20, "D", "A", 9000.0), ("T5", 30, "A", "E", 8000.0)]
    df = pd.DataFrame([{"transaction_id": i, "timestamp": t0 + pd.Timedelta(minutes=m), "sender_account_id": s, "receiver_account_id": r,
                        "amount": a, "currency": "INR", "transaction_type": "TRANSFER", "channel": "UPI", "transaction_status": "COMPLETED",
                        "sender_balance_before": 10_000.0, "receiver_balance_before": 100.0, "source_dataset": "t", "source_record_id": i}
                       for i, m, s, r, a in rows])[NORMALIZED_COLUMNS]
    f = transaction_features(df).set_index(df.transaction_id)
    assert np.expm1(f.at["T1", "s_prior_out_n"]) == pytest.approx(0) and f.at["T1", "first_time_pair"] == 1
    assert np.expm1(f.at["T3", "s_prior_out_n"]) == pytest.approx(2) and f.at["T3", "first_time_pair"] == 0
    assert f.at["T3", "s_out_n_1h"] == 2 and np.expm1(f.at["T3", "s_distinct_recipients"]) == pytest.approx(2)
    # T4 has the same timestamp as T3: neither sees the other.
    assert f.at["T3", "s_in_24h_to_amount"] == 0
    assert f.at["T5", "s_in_24h_to_amount"] == pytest.approx(9000 / 8000)
    assert f.at["T5", "s_amount_vs_prior_max"] == pytest.approx(8000 / 2000)
    assert np.expm1(f.at["T5", "s_minutes_since_last_in"]) == pytest.approx(10)
    assert np.isnan(f.at["T1", "s_amount_vs_prior_max"])  # no history -> missing, not invented


# ---------------------------------------------------------------- model artifacts
@needs_models
def test_model_artifacts_load_and_record_their_provenance():
    for name in ("transaction_model", "account_model"):
        m = mdl.load(name)
        meta = m.meta
        for key in ("model_version", "feature_schema_version", "generator_version", "environment", "calibration", "threshold",
                    "metrics", "params", "training_ranges"):
            assert key in meta, f"{name} lacks {key}"
        assert meta["threshold"]["chosen_on"] == "validation split"
        assert meta["calibration"]["fitted_on"].startswith("validation")
        assert meta["environment"]["seed"] and meta["environment"]["trained_at"]
        assert "validation" in meta["metrics"] and any("cold" in k for k in meta["metrics"])
        assert meta["format"] in ("xgboost_json", "logistic_json")  # text artifacts, no pickles


@needs_models
def test_calibration_maps_are_monotone_and_bounded():
    for name in ("transaction_model", "account_model"):
        m = mdl.load(name)
        grid = np.linspace(0, 1, 201)
        c = m.calibrated(grid)
        assert c is not None and (np.diff(c) >= -1e-12).all() and c.min() >= 0 and c.max() <= 1


def test_training_is_deterministic():
    from ml.forensics.modeling import fit_xgb

    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(600, 4)), columns=list("abcd"))
    y = (X.a + rng.normal(scale=0.5, size=600) > 1).astype(int).to_numpy()
    p = {"max_depth": 3, "min_child_weight": 1, "lambda": 1, "alpha": 0, "scale_pos_weight": 2}
    a = fit_xgb(X[:400], y[:400], X[400:], y[400:], p, list("abcd")).predict(X)
    b = fit_xgb(X[:400], y[:400], X[400:], y[400:], p, list("abcd")).predict(X)
    assert np.array_equal(a, b)


def test_undersampling_touches_only_the_training_split():
    from ml.forensics.modeling import undersample

    X = pd.DataFrame({"a": np.arange(1000)})
    y = (np.arange(1000) % 50 == 0).astype(int)
    Xs, ys = undersample(X, y, 5)
    assert ys.sum() == y.sum() and (ys == 0).sum() == 5 * y.sum() and len(X) == 1000


# ---------------------------------------------------------------- roles (pure rules)
def ev(**kw):
    base = dict(account_id="X", position="downstream", hop=1, n_transactions=40, history_days=120.0)
    return roles.AccountEvidence(**{**base, **kw})


SCORED_HIGH = {"status": "scored", "above_threshold": True}
SCORED_LOW = {"status": "scored", "above_threshold": False}


def test_receiving_money_alone_never_makes_an_account_suspicious():
    e = ev(received_traced=50_000, forwarded_min=0, forwarded_max=1_000, account_model=SCORED_LOW)
    r = roles.assess(e)
    assert r.role_candidate == "no_suspicious_linkage_observed"
    assert roles.restriction(e, r, [])["state"] == "no_restriction_recommendation"
    young = ev(received_traced=50_000, forwarded_max=0, history_days=5, n_transactions=6, account_model=SCORED_LOW)
    assert roles.assess(young).role_candidate not in ("potential_intermediary", "potentially_suspicious_account")


def test_pass_through_is_an_intermediary_candidate_with_its_innocent_explanations():
    e = ev(received_traced=50_000, onward_within_24h=46_000, onward_delay_minutes=20, onward_destinations=2, sent_traced=46_000,
           account_model=SCORED_HIGH, model_flagged_onward_ids=["T9"], forwarded_min=40_000, forwarded_max=46_000)
    r = roles.assess(e)
    assert r.role_candidate == "potential_intermediary" and r.evidence_strength == "strong"
    rec = roles.restriction(e, r, ["T9"])
    assert rec["state"] == "consider_temporary_restriction_review"
    assert rec["innocent_explanations"] and rec["human_review_required"] and rec["automatic_action_taken"] is False


def test_restriction_review_needs_two_independent_kinds_of_evidence():
    e = ev(received_traced=50_000, onward_within_24h=46_000, onward_delay_minutes=20, onward_destinations=2, sent_traced=46_000,
           account_model=SCORED_LOW, forwarded_min=40_000, forwarded_max=46_000)
    r = roles.assess(e)
    assert r.role_candidate == "potential_intermediary" and r.categories == ["ONWARD"]
    assert roles.restriction(e, r, [])["state"] == "additional_verification_recommended"


def test_secondary_victim_is_protected_from_restriction():
    e = ev(received_traced=50_000, onward_within_24h=48_000, onward_delay_minutes=15, onward_destinations=1, sent_traced=90_000,
           balance_before_receipt=60_000, lowest_balance_in_window=5_000, forwarded_min=45_000, forwarded_max=50_000,
           account_model=SCORED_HIGH, model_flagged_onward_ids=["T1"])
    r = roles.assess(e)
    assert r.role_candidate == "potential_secondary_victim" and r.may_be_victim
    rec = roles.restriction(e, r, [])
    assert rec["state"] == "urgent_manual_review_recommended" and rec["may_be_victim"] and "penalty" in rec["victim_note"]


def test_investigated_victim_and_unfunded_flags():
    victim = ev(position="investigated", hop=0, flagged_out_ids=["T1"], flagged_out_unfunded_ids=["T1"],
                deviation=["Largest flagged transfer is more than twice its largest earlier one."])
    r = roles.assess(victim)
    assert r.role_candidate == "potential_victim" and r.may_be_victim
    assert roles.restriction(victim, r, [])["state"] == "urgent_manual_review_recommended"
    forwarder = ev(position="investigated", hop=0, flagged_out_ids=["T1", "T2"], flagged_out_unfunded_ids=[])
    assert roles.assess(forwarder).role_candidate == "potential_intermediary"
    quiet = ev(position="investigated", hop=0)
    assert roles.assess(quiet).role_candidate == "no_suspicious_activity_observed"
    short = ev(position="investigated", hop=0, n_transactions=3)
    r = roles.assess(short)
    assert r.assessment_status == "insufficient_evidence"
    assert roles.restriction(short, r, [])["state"] == "insufficient_evidence_to_recommend"


def test_business_accounts_carry_contradictory_evidence_and_cash_points_are_not_people():
    e = ev(received_traced=50_000, onward_within_24h=46_000, onward_destinations=3, business_account=True)
    assert any("business" in c for c in roles.assess(e).contradictory)
    cash = ev(cash_endpoint=True, traced_paths_in=3)
    r = roles.assess(cash)
    assert r.role_candidate == "cash_withdrawal_point"
    assert roles.restriction(cash, r, [])["state"] == "no_restriction_recommendation"


# ---------------------------------------------------------------- end to end on a synthetic ledger
@needs_models
def test_unknown_account_is_not_found_and_nothing_is_invented(client):
    r = investigate(client, "FS-00000000")
    assert r.status_code == 404 and r.json()["error"]["code"] == "account_not_found"
    assert "selected synthetic dataset" in r.json()["error"]["message"]
    assert client.get("/api/v2/datasets/forensic-scenarios/accounts/FS-00000000").status_code == 404


@needs_models
def test_insufficient_history_abstains(client, forensic_db):
    S = get_v2_sessionmaker(get_v2_engine(forensic_db))
    with S() as db:
        tx = pd.DataFrame(db.execute(select(TransactionModel.origin_account_id, TransactionModel.destination_account_id)).all())
    counts = pd.concat([tx.iloc[:, 0], tx.iloc[:, 1]]).value_counts()
    low = counts[counts < MIN_ACCOUNT_TRANSACTIONS].index[0]
    look = client.get(f"/api/v2/datasets/forensic-scenarios/accounts/{low}").json()
    assert look["history_sufficient"] is False
    d = investigate(client, low).json()
    root = next(a for a in d["role_assessments"] if a["account_id"] == low)
    assert d["victim_assessment"]["status"] == "insufficient_evidence"
    assert root["account_model"]["status"] == "insufficient_history" and root["account_model"].get("model_score") is None


@needs_models
def test_unseen_account_with_history_gets_a_behavioural_prediction(client, small_ledger):
    # This ledger's seed is not one the models were trained on: none of its IDs occur in training.
    victim = first_role(small_ledger, "victim", "direct")
    d = investigate(client, victim).json()
    root = next(a for a in d["role_assessments"] if a["account_id"] == victim)
    assert root["account_model"]["status"] == "scored" and 0 <= root["account_model"]["calibrated_probability"] <= 1
    assert d["transaction_scoring"]["scored"] > 0


@needs_models
def test_victim_scenarios_are_detected_and_the_report_is_consistent(client, small_ledger):
    detected = 0
    victims = small_ledger.roles[(small_ledger.roles.role == "victim") & small_ledger.roles.materialised].drop_duplicates("scenario_id")
    for acc in victims.account_id:
        r = investigate(client, acc)
        assert r.status_code == 200, r.text
        d = r.json()
        detected += d["victim_assessment"]["status"] in ("potential_victim", "suspicious_activity_victim_status_unconfirmed")
        ids = {e["transaction_id"] for e in d["investigation"]["trace"]["edges"]}
        # Branches rearrange returned transfers only: none invented, none dropped.
        on_branches = [t for b in d["fund_trace"]["branches"] for t in b["transaction_ids"]]
        assert set(on_branches) == ids
        for a in d["role_assessments"]:
            if a["role_candidate"] in ("potential_intermediary", "potentially_suspicious_account"):
                assert len([c for c in a["evidence_categories"] if c != "NEW_RECORDS"]) >= 1
            if a["restriction"]["state"] == "consider_temporary_restriction_review":
                assert len(set(a["evidence_categories"]) - {"NEW_RECORDS"}) >= 2 and not a["may_be_victim"]
            assert a["restriction"]["automatic_action_taken"] is False
        assert d["automatic_actions_taken"] == []
    assert detected / len(victims) >= 0.6


@needs_models
def test_report_is_deterministic_and_ignores_ground_truth(client, forensic_db, small_ledger):
    victim = first_role(small_ledger, "victim", "chain")
    a = investigate(client, victim).json()
    S = get_v2_sessionmaker(get_v2_engine(forensic_db))
    with S() as db:
        before = db.execute(select(AccountModel.account_id, AccountModel.ground_truth_label, AccountModel.scenario_id)).all()
        db.execute(update(AccountModel).values(ground_truth_label="ordinary", scenario_id="X"))
        db.execute(update(TransactionModel).values(scenario_tag="normal", is_suspicious_scenario=False, scenario_id="X"))
        db.commit()
    try:
        b = investigate(client, victim).json()
    finally:
        with S() as db:
            for acc, label, sid in before:
                db.execute(update(AccountModel).where(AccountModel.account_id == acc).values(ground_truth_label=label, scenario_id=sid))
            db.commit()
    assert a["investigation_digest"] == b["investigation_digest"]
    dumped = json.dumps(a)
    assert "ground_truth" not in dumped and "scenario_tag" not in dumped


@needs_models
def test_investigation_writes_nothing_and_is_labelled_synthetic(client, forensic_db, small_ledger):
    S = get_v2_sessionmaker(get_v2_engine(forensic_db))

    def digest():
        with S() as db:
            rows = [a.to_dict() for a in db.scalars(select(AccountModel).order_by(AccountModel.account_id))]
            rows += [t.to_dict() for t in db.scalars(select(TransactionModel).order_by(TransactionModel.transaction_id))]
        return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()

    before = digest()
    d = investigate(client, first_role(small_ledger, "victim", "split")).json()
    assert digest() == before
    assert d["dataset"]["source"]["is_synthetic"] is True and d["dataset"]["source"]["real_bank_data"] is False
    assert "Synthetic" in d["synthetic_data_notice"]
    # The analyst is off in tests, so the report says so instead of deferring to an explanation that cannot come.
    assert d["investigation"]["ai_analysis"]["state"] == "disabled"


@needs_models
def test_dynamic_explanation_uses_the_same_report_and_ai_failure_never_breaks_it(client, small_ledger, monkeypatch):
    victim = first_role(small_ledger, "victim", "direct")
    report = investigate(client, victim).json()

    class Boom:
        name = "boom"

        async def generate(self, **_):
            raise RuntimeError("provider down")

    monkeypatch.setattr(ai_analyst, "_gemini_module", lambda: SimpleNamespace(GeminiProvider=lambda *a, **k: Boom()))
    monkeypatch.setenv("GEMINI_ANALYST_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    ex = client.post("/api/v2/dynamic-investigations/explanation", json={"account_id": victim, "dataset_id": "forensic-scenarios"})
    assert ex.status_code == 200
    assert ex.json()["report_digest"] == report["investigation"]["report_digest"]
    assert ex.json()["ai_analysis"]["state"] in ("unavailable", "not_configured", "completed")
    again = investigate(client, victim).json()
    assert again["investigation_digest"] == report["investigation_digest"]


@needs_models
def test_separate_ai_is_deferred_only_when_an_explanation_can_be_produced(client, small_ledger, monkeypatch):
    victim = first_role(small_ledger, "victim", "direct")
    assert investigate(client, victim).json()["investigation"]["ai_analysis"]["state"] == "disabled"
    monkeypatch.setenv("GEMINI_ANALYST_ENABLED", "true")
    assert investigate(client, victim).json()["investigation"]["ai_analysis"]["state"] == "not_configured"
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    assert investigate(client, victim).json()["investigation"]["ai_analysis"]["state"] == "deferred"


def test_dynamic_explanation_is_not_recomputed_when_the_analyst_cannot_run(client, small_ledger, monkeypatch):
    def recompute(*_a, **_k):
        raise AssertionError("the investigation must not be recomputed when nothing can be explained")

    monkeypatch.setattr(DynamicInvestigation, "compute", recompute)
    body = {"account_id": first_role(small_ledger, "victim", "direct"), "dataset_id": "forensic-scenarios"}
    r = client.post("/api/v2/dynamic-investigations/explanation", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["ai_analysis"]["state"] == "disabled" and r.json()["ai_analysis"]["report"] is None
    monkeypatch.setenv("GEMINI_ANALYST_ENABLED", "true")
    r = client.post("/api/v2/dynamic-investigations/explanation", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["ai_analysis"]["state"] == "not_configured"


def test_dataset_account_lookup_says_whether_the_models_count_as_evidence(client, forensic_db, small_ledger):
    acc = first_role(small_ledger, "victim", "direct")
    d = client.get(f"/api/v2/datasets/forensic-scenarios/accounts/{acc}").json()
    assert d["models_validated"] is True and d["model_note"] == DATASETS["forensic-scenarios"].model_note
    # The demo-ledger answer comes from its own spec (served here from the same file, only the dataset id differs).
    S = get_v2_sessionmaker(get_v2_engine(forensic_db))

    def demo_db():
        with S() as db:
            yield db

    client.app.dependency_overrides[get_v2_db] = demo_db
    try:
        demo = client.get(f"/api/v2/datasets/demo-ledger/accounts/{acc}").json()
    finally:
        client.app.dependency_overrides.pop(get_v2_db)
    assert demo["models_validated"] is False and demo["model_note"] == DATASETS["demo-ledger"].model_note


def test_datasets_are_listed_and_an_unbuilt_dataset_is_reported(tmp_path):
    app = create_app()
    registry = DatasetRegistry(f"sqlite:///{tmp_path / 'missing.db'}")
    app.dependency_overrides[get_dataset_registry] = lambda: registry
    with TestClient(app) as c:
        listed = {d["dataset_id"]: d for d in c.get("/api/v2/datasets").json()}
        assert listed["forensic-scenarios"]["available"] is False and "not been built" in listed["forensic-scenarios"]["unavailable_reason"]
        r = c.post("/api/v2/dynamic-investigations", json={"account_id": "FS-1", "dataset_id": "forensic-scenarios"})
        assert r.status_code == 503 and r.json()["error"]["code"] == "dataset_unavailable"
        bad = c.post("/api/v2/dynamic-investigations", json={"account_id": "FS-1", "dataset_id": "real-bank"})
        assert bad.status_code == 422


def test_no_route_can_freeze_or_modify_an_account():
    app = create_app()
    for route in app.routes:
        path = getattr(route, "path", "")
        assert not any(w in path.lower() for w in ("freeze", "block", "restrict", "suspend")), path
        if path.startswith("/api/v2/dynamic") or path.startswith("/api/v2/datasets"):
            assert getattr(route, "methods", set()) <= {"GET", "POST", "HEAD"}


# ---------------------------------------------------------------- model support state (final review)
def test_dataset_support_state_matches_the_distribution_report():
    import json as _json
    from app.intelligence.datasets import DATASETS
    rep = Path(__file__).resolve().parents[2] / "ml" / "reports" / "distribution_shift.json"
    if not rep.exists():
        pytest.skip("distribution_shift.json not generated")
    d = _json.loads(rep.read_text())["datasets"]
    names = {"demo-ledger": "demo-ledger (FraudShield generator, seed 42)",
             "forensic-scenarios": "forensic-scenarios (served, seed 303)"}
    for ds, name in names.items():
        for m in ("transaction_model", "account_model"):
            got, want = DATASETS[ds].distribution_check[m], d[name][m]
            assert got["in_distribution"] == want["in_distribution"]
            assert got["behaviour_inputs_psi_over_0_25"] == want["behaviour_inputs_psi_over_0_25"]
            assert got["behaviour_inputs"] == want["behaviour_inputs"]
    assert DATASETS["demo-ledger"].model_support == "unsupported_distribution_shift"
    assert DATASETS["forensic-scenarios"].model_support == "validated_in_distribution"


def test_unchecked_or_shifted_datasets_never_use_models_as_evidence():
    from app.intelligence.datasets import DatasetSpec
    assert DatasetSpec("x", "t", "d", "n").model_support == "unsupported_not_checked"
    assert DatasetSpec("x", "t", "d", "n", models_validated=True).model_support == "unsupported_not_checked"
    shifted = {"transaction_model": {"in_distribution": True}, "account_model": {"in_distribution": False}}
    assert DatasetSpec("x", "t", "d", "n", models_validated=True, distribution_check=shifted).model_support == \
        "unsupported_distribution_shift"
