"""Engine tests: FS-1042 scenario and edge cases."""

from __future__ import annotations

from decimal import Decimal

from app.services.tracer import trace_case
from tests.conftest import make_case, tx


def run(repo, **kw):
    case = repo.get_case("FS-1042")
    return trace_case(case, repo.get_transactions(), repo.get_accounts(),
                      repo.get_review_statuses("FS-1042"), **kw)


def accts(result):
    return {a.account_id: a for a in result.linked_accounts}


# ---- full scenario -------------------------------------------------------
def test_fs1042_full_scenario(repo):
    r = run(repo)
    a = accts(r)
    assert set(a) == {"A100", "B200", "C300", "D400", "E500", "F600", "G700"}
    assert [t.transaction_id for t in r.traced_transactions] == [f"T00{i}" for i in range(1, 8)]
    paths = {tuple(p.transaction_ids) for p in r.paths}
    assert paths == {("T001", "T002", "T003", "T005"), ("T001", "T002", "T003", "T006"),
                     ("T001", "T002", "T004", "T007")}
    assert r.summary.traceable_amount == 50000
    assert r.summary.located_amount == 50000
    assert r.summary.unlocated_amount == 0
    assert not r.summary.truncated and not r.summary.cycles_detected


def test_direct_and_indirect_connections(repo):
    a = accts(run(repo))
    assert a["A100"].connection_type == "origin_receiver" and a["A100"].hop_count == 0
    assert a["B200"].connection_type == "direct" and a["B200"].hop_count == 1
    for acct, hop in [("C300", 2), ("D400", 2), ("E500", 3), ("F600", 3), ("G700", 3)]:
        assert a[acct].connection_type == "indirect" and a[acct].hop_count == hop


def test_branching(repo):
    r = run(repo)
    assert accts(r)["B200"].outbound_transaction_ids == ["T003", "T004"]
    assert accts(r)["C300"].outbound_transaction_ids == ["T005", "T006"]
    assert len(r.paths) == 3


def test_chronology(repo):
    r = run(repo)
    ts = [t.timestamp for t in r.traced_transactions]
    assert ts == sorted(ts)
    for p in r.paths:
        legs = [next(t for t in r.traced_transactions if t.transaction_id == i) for i in p.transaction_ids]
        assert [l.timestamp for l in legs] == sorted(l.timestamp for l in legs)


def test_out_of_order_transaction_not_downstream():
    # T002 happens BEFORE the money arrives at A100 -> cannot be downstream.
    txs = [tx("T001", 10, "V", "A", 100, 100), tx("T002", 5, "A", "B", 100, 100)]
    r = trace_case(make_case(amount=100), txs)
    assert {a.account_id for a in r.linked_accounts} == {"A"}


def test_unrelated_account_excluded(repo):
    extra = repo.get_transactions() + [
        tx("X001", 1, "Z900", "Y800", 7000),
        tx("X002", 100, "Z900", "A100", 10),  # inbound to chain, not downstream
    ]
    r = trace_case(repo.get_case("FS-1042"), extra, repo.get_accounts())
    ids = {a.account_id for a in r.linked_accounts}
    assert "Z900" not in ids and "Y800" not in ids
    assert "X001" not in {t.transaction_id for t in r.traced_transactions}


def test_no_double_counting(repo):
    r = run(repo)
    # Gross movement is 175,000 but the reported amount is 50,000.
    assert r.summary.gross_observed_transaction_value == 175000
    assert r.summary.traceable_amount == 50000
    assert r.summary.located_amount <= r.summary.reported_amount
    assert sum(a.exposure.attributed_unforwarded_amount for a in r.linked_accounts) == 50000
    c = accts(r)["C300"].exposure
    assert c.attributed_inbound_amount == 30000 and c.attributed_unforwarded_amount == 15000


def test_unobserved_money_not_treated_as_spent(repo):
    c = accts(run(repo))["C300"].exposure
    # C300 forwarded 15,000 of 30,000; remaining 15,000 reported as not observed leaving.
    assert c.attributed_unforwarded_amount == 15000


def test_review_status_separate_and_no_automation(repo):
    for a in run(repo).linked_accounts:
        assert a.review.automated_action_taken == "none"
        assert a.review.review_state.value in {"under_investigation", "under_review"}
    import json

    def keys(o):
        if isinstance(o, dict):
            for k, v in o.items():
                yield k
                yield from keys(v)
        elif isinstance(o, list):
            for v in o:
                yield from keys(v)

    forbidden = {"guilty", "innocent", "is_scammer", "is_fraudster", "label_guilty"}
    assert not forbidden & set(keys(json.loads(run(repo).model_dump_json())))


# ---- empty / missing -----------------------------------------------------
def test_empty_transactions_raises_missing_origin():
    import pytest
    from app.services.tracer import TraceError
    with pytest.raises(TraceError) as e:
        trace_case(make_case(), [])
    assert e.value.code == "origin_transaction_unavailable"


def test_origin_with_no_downstream():
    r = trace_case(make_case(amount=100), [tx("T001", 0, "V", "A", 100, 100)])
    assert len(r.paths) == 1 and r.paths[0].termination_reason.value == "end_of_records"
    assert r.summary.located_amount == 100


# ---- cycles & depth ------------------------------------------------------
def test_cycle_handled():
    txs = [tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "B", 100, 100),
           tx("T003", 2, "B", "C", 100, 100), tx("T004", 3, "C", "A", 100, 100),
           tx("T005", 4, "A", "B", 100, 100)]
    r = trace_case(make_case(amount=100), txs)
    assert r.summary.cycles_detected
    assert any(p.termination_reason.value == "cycle_detected" for p in r.paths)
    assert any(t.is_cycle_closing for t in r.traced_transactions)
    assert any(w.code == "cycle_detected" for w in r.warnings)


def test_return_to_victim_is_cycle():
    txs = [tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "V", 100, 100)]
    r = trace_case(make_case(amount=100), txs)
    assert r.summary.cycles_detected
    assert "V" not in {a.account_id for a in r.linked_accounts}


def test_depth_limit(repo):
    r = run(repo, max_depth=1)
    assert {a.account_id for a in r.linked_accounts} == {"A100", "B200"}
    assert r.summary.truncated
    assert r.paths[0].termination_reason.value == "depth_limit"
    r0 = run(repo, max_depth=0)
    assert {a.account_id for a in r0.linked_accounts} == {"A100"}


def test_long_chain_terminates():
    txs = [tx("T001", 0, "V", "N0", 10, 10)] + [
        tx(f"T{i + 2:03d}", i + 1, f"N{i}", f"N{i + 1}", 10, 10) for i in range(200)]
    r = trace_case(make_case(amount=10), txs, max_depth=5)
    assert r.summary.truncated and len(r.linked_accounts) == 6


# ---- duplicates ----------------------------------------------------------
def test_identical_duplicate_ids_deduplicated():
    t1 = tx("T001", 0, "V", "A", 100, 100)
    r = trace_case(make_case(amount=100), [t1, t1, tx("T002", 1, "A", "B", 100, 100)])
    assert r.summary.traced_transaction_count == 2
    assert any(w.code == "duplicate_transaction_identical" for w in r.warnings)


def test_conflicting_duplicates_quarantined():
    txs = [tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "B", 100, 100),
           tx("T002", 1, "A", "C", 100, 100)]
    r = trace_case(make_case(amount=100), txs)
    assert {a.account_id for a in r.linked_accounts} == {"A"}
    assert any(w.code == "duplicate_transaction_conflicting" for w in r.warnings)


def test_conflicting_duplicate_origin_fails():
    import pytest
    from app.services.tracer import TraceError
    with pytest.raises(TraceError):
        trace_case(make_case(), [tx("T001", 0, "V", "A", 100), tx("T001", 0, "V", "B", 100)])


# ---- ambiguity -----------------------------------------------------------
def test_missing_lineage_is_uncertain_not_zero():
    txs = [tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "B", 100)]  # no lineage on T002
    r = trace_case(make_case(amount=100), txs)
    a = accts(r)
    assert a["B"].exposure.attribution_status == "uncertain_missing_lineage"
    assert a["B"].exposure.attributed_unforwarded_amount is None
    assert "B" in r.summary.uncertain_account_ids
    assert r.summary.located_amount == 0 and r.summary.unlocated_amount == 100
    assert r.paths[0].attribution_status == "uncertain"
    assert r.paths[0].max_attributable_amount is None


def test_over_attribution_ambiguous():
    # A receives 40 attributed but forwards 60 attributed.
    txs = [tx("T001", 0, "V", "A", 100, 40), tx("T002", 1, "A", "B", 60, 60)]
    r = trace_case(make_case(amount=100), txs)
    assert accts(r)["A"].exposure.attribution_status == "ambiguous_over_attribution"
    assert accts(r)["A"].exposure.attributed_unforwarded_amount is None


def test_lineage_exceeding_amount_is_uncertain():
    txs = [tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "B", 50, 80)]
    r = trace_case(make_case(amount=100), txs)
    assert any(w.code == "lineage_exceeds_transaction_amount" for w in r.warnings)
    assert accts(r)["B"].exposure.attribution_status == "uncertain_missing_lineage"


def test_lineage_for_other_case_ignored():
    txs = [tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "B", 100, 100, case_id="OTHER")]
    r = trace_case(make_case(amount=100), txs)
    assert accts(r)["B"].exposure.attributed_inbound_amount is None


def test_traceable_capped_at_reported_amount():
    r = trace_case(make_case(amount=100), [tx("T001", 0, "V", "A", 500, 500)])
    assert r.summary.traceable_amount == Decimal(100)
