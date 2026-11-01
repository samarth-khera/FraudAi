"""Fund tracing: loops through the investigated account, cross-links between the two halves of the trace, branch
endings, history reuse and the investigation digest."""

from __future__ import annotations

import copy
import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.api.v2.dynamic_schemas import DynamicInvestigationRequest, EndingReason  # noqa: E402
from app.db.v2.ingestion import ingest_v2_dataset  # noqa: E402
from app.db.v2.models import AccountModel, TransactionModel  # noqa: E402
from app.db.v2.session import get_v2_engine, init_v2_db  # noqa: E402
from app.intelligence import ledger  # noqa: E402
from app.intelligence import models as mdl  # noqa: E402
from app.intelligence.datasets import DatasetRegistry  # noqa: E402
from app.intelligence.engine import ENDINGS, DynamicInvestigation  # noqa: E402
from app.services.v2.graph_tracer import LOOP_MIN_ACCOUNTS, ForensicGraphTracer  # noqa: E402

from ml.forensics.generator import ForensicLedgerConfig, ForensicScenarioGenerator  # noqa: E402

T0 = datetime(2026, 2, 1, 9, 0, 0)
NO_CLAIMS = ("recovered", "frozen", "lost")


# ---------------------------------------------------------------- a hand-built ledger
class Book:
    def __init__(self, s: Session):
        self.s, self.n, self.bal = s, 0, {}

    def acc(self, *ids, balance=1_000_000.0):
        for a in ids:
            self.bal[a] = balance
            self.s.add(AccountModel(account_id=a, customer_name=f"N {a}", customer_type="retail", kyc_tier="tier_2_verified",
                                    phone_number="+91 90000 00000", email=f"{a.lower()}@example.bank", upi_id=f"{a.lower()}@ok",
                                    tax_identifier="PANTEST000", initial_balance=balance, current_balance=balance,
                                    account_opened_at=T0 - timedelta(days=400), status="active", scenario_id=None,
                                    ground_truth_label="legitimate_retail"))

    def tx(self, minutes, origin, dest, amount, channel="UPI") -> TransactionModel:
        self.n += 1
        ob, db_ = self.bal[origin], self.bal[dest]
        self.bal[origin], self.bal[dest] = ob - amount, db_ + amount
        t = TransactionModel(transaction_id=f"TX-{self.n:04d}", timestamp=T0 + timedelta(minutes=minutes), origin_account_id=origin,
                             destination_account_id=dest, amount=amount, currency="INR", channel=channel, status="COMPLETED",
                             origin_balance_before=ob, origin_balance_after=ob - amount, dest_balance_before=db_,
                             dest_balance_after=db_ + amount, scenario_id=None, scenario_tag="normal", is_suspicious_scenario=False)
        self.s.add(t)
        return t


@pytest.fixture
def session(tmp_path):
    engine = get_v2_engine(f"sqlite:///{tmp_path / 'trace.db'}")
    init_v2_db(engine)
    with Session(engine) as s:
        yield s
    engine.dispose()


def trace(s, root, down, up, **kw):
    s.commit()
    kw.setdefault("max_depth", 3)
    kw.setdefault("max_nodes", 200)
    return ForensicGraphTracer.trace_from_seeds(s, root, down, up, **kw)


def branches(flow, max_depth=3, max_nodes=200):
    return DynamicInvestigation._branches(flow, SimpleNamespace(max_depth=max_depth, max_nodes=max_nodes, onward_window_hours=72.0), None)


def check_invariants(flow, br, max_depth=3, max_nodes=200):
    ids = [e.txn.transaction_id for e in flow.edges]
    assert len(ids) == len(set(ids)), "a transfer was added twice"
    assert {t for b in br for t in b["transaction_ids"]} == set(ids), "branches must hold exactly the traced transfers"
    assert len(flow.node_hops) <= max_nodes and flow.max_depth_reached <= max_depth
    for b in br:
        assert b["ending"]["reason"] in EndingReason.__args__ and b["ending"]["reason"] in ENDINGS
        assert len(b["accounts"]) == len(b["transaction_ids"]) + 1 == len(b["amounts"]) + 1
        assert not any(w in b["ending"]["detail"].lower() for w in NO_CLAIMS)


def by_reason(br, reason):
    return [b for b in br if b["ending"]["reason"] == reason]


# ---------------------------------------------------------------- loops through the investigated account
def test_four_account_loop_through_the_root_is_a_cycle_and_marks_every_member(session):
    B = Book(session)
    B.acc("R", "A", "B", "C", "Z")
    out = B.tx(0, "R", "A", 12_000)
    ab = B.tx(20, "A", "B", 11_000)
    bc = B.tx(60, "B", "C", 10_500)
    back = B.tx(90, "C", "R", 10_000)
    B.tx(70, "B", "Z", 300)  # an ordinary side payment, not part of the loop
    flow = trace(session, "R", [out], [back])
    br = branches(flow)
    check_invariants(flow, br)

    cyc = by_reason(br, "cycle_detected")
    assert len(cyc) == 1 and cyc[0]["direction"] == "upstream" and cyc[0]["transaction_ids"] == [back.transaction_id, bc.transaction_id]
    assert "loop of payments through the investigated account" in cyc[0]["ending"]["detail"]
    assert flow.cycle_members == {"R", "A", "B", "C"}
    assert DynamicInvestigation._cycle_members(flow) == {"R", "A", "B", "C"}
    assert "Z" not in flow.cycle_members
    # The downstream half reaches the same closing transfer: one edge, shown as a cross-link ending, never added twice.
    joins = by_reason(br, "joins_opposite_direction_trace")
    assert [b["transaction_ids"] for b in joins] == [[out.transaction_id, ab.transaction_id, bc.transaction_id]]
    assert joins[0]["accounts"] == ["R", "A", "B", "C"]
    assert cyc[0]["branch_id"] in joins[0]["ending"]["detail"] and "closes a loop" in joins[0]["ending"]["detail"]
    assert [e.txn.transaction_id for e in flow.edges].count(bc.transaction_id) == 1
    assert flow.cross_links == [(ab.transaction_id, bc.transaction_id, "downstream")]


def test_loop_seen_from_a_member_whose_payer_starts_the_loop(session):
    # P pays R, R pays Q, Q pays S, S pays P: time runs forward from P, so the loop is real even though the money
    # does not come back to R itself.
    B = Book(session)
    B.acc("P", "R", "Q", "S")
    p_r = B.tx(0, "P", "R", 9_000)
    r_q = B.tx(25, "R", "Q", 8_800)
    B.tx(80, "Q", "S", 8_500)
    B.tx(90, "S", "P", 8_000)
    flow = trace(session, "R", [r_q], [p_r])
    br = branches(flow)
    check_invariants(flow, br)
    assert len(by_reason(br, "cycle_detected")) == 1
    assert flow.cycle_members == {"P", "R", "Q", "S"}


def test_meeting_without_a_time_ordered_loop_is_only_a_join(session):
    # Same accounts, but R pays Q five days after P paid R: outside the window, so no loop is claimed.
    B = Book(session)
    B.acc("P", "R", "Q", "S")
    p_r = B.tx(0, "P", "R", 9_000)
    r_q = B.tx(5 * 24 * 60, "R", "Q", 8_800)
    B.tx(5 * 24 * 60 + 60, "Q", "S", 8_500)
    B.tx(5 * 24 * 60 + 90, "S", "P", 8_000)
    flow = trace(session, "R", [r_q], [p_r])
    br = branches(flow)
    check_invariants(flow, br)
    assert not by_reason(br, "cycle_detected") and not flow.cycle_members
    join = by_reason(br, "joins_opposite_direction_trace")
    assert len(join) == 1 and "does not form a loop" in join[0]["ending"]["detail"]
    assert not by_reason(br, "already_examined_on_another_branch")


def test_two_accounts_paying_each_other_is_a_cycle_ending_but_not_loop_evidence(session):
    B = Book(session)
    B.acc("R", "X")
    out = B.tx(0, "R", "X", 2_500)
    back = B.tx(180, "X", "R", 4_600)
    flow = trace(session, "R", [out], [back])
    br = branches(flow)
    check_invariants(flow, br)
    assert by_reason(br, "cycle_detected")
    assert LOOP_MIN_ACCOUNTS == 3 and flow.cycle_members == set()
    assert DynamicInvestigation._cycle_members(flow) == set()


def test_same_direction_loop_still_marks_only_its_members(session):
    B = Book(session)
    B.acc("R", "M1", "M2", "M3")
    d = B.tx(0, "R", "M1", 50_000)
    B.tx(10, "M1", "M2", 40_000)
    B.tx(20, "M2", "M3", 30_000)
    B.tx(30, "M3", "M1", 20_000)
    flow = trace(session, "R", [d], [], max_depth=4)
    br = branches(flow, max_depth=4)
    check_invariants(flow, br, max_depth=4)
    assert by_reason(br, "cycle_detected")[0]["ending"]["detail"] == ENDINGS["cycle_detected"]
    assert flow.cycle_members == {"M1", "M2", "M3"}


# ---------------------------------------------------------------- endings
def test_cash_withdrawals_end_as_cash_even_when_the_cash_point_is_already_in_the_trace(session):
    B = Book(session)
    B.acc("R", "A", "C", "ATM")
    a = B.tx(0, "R", "A", 20_000)
    c = B.tx(5, "R", "C", 20_000)
    B.tx(30, "A", "ATM", 19_000, "ATM_CASH_OUT")
    B.tx(40, "C", "ATM", 19_000, "ATM_CASH_OUT")  # reaches ATM a second time: a convergence
    flow = trace(session, "R", [a, c], [])
    br = branches(flow)
    check_invariants(flow, br)
    assert any(e.converges for e in flow.edges)
    assert [b["ending"]["reason"] for b in br] == ["cash_withdrawal_recorded", "cash_withdrawal_recorded"]


def test_parallel_splits_stay_separate_and_the_trace_is_bounded(session):
    B = Book(session)
    names = ["R"] + [f"N{i}" for i in range(12)]
    B.acc(*names)
    seed = B.tx(0, "R", "N0", 100_000)
    B.tx(5, "N0", "N1", 30_000)
    B.tx(6, "N0", "N2", 30_000)
    m = 10
    for i in range(1, 12):  # a dense web with loops among the recipients
        for j in range(1, 12):
            if i != j:
                m += 1
                B.tx(m, f"N{i}", f"N{j}", 100 + i + j)
    flow = trace(session, "R", [seed], [], max_depth=3, max_nodes=6, max_edges_per_account=4)
    br = branches(flow, max_depth=3, max_nodes=6)
    check_invariants(flow, br, max_depth=3, max_nodes=6)
    firsts = {tuple(b["transaction_ids"][:2]) for b in br}
    assert len(firsts) >= 2  # N0 -> N1 and N0 -> N2 are separate branches
    assert any("account limit" in n for n in flow.truncation_notes)


# ---------------------------------------------------------------- history reuse
def test_history_reuse_gives_the_same_frame_as_a_fresh_read(session):
    B = Book(session)
    B.acc("H", "S1", "S2", "X")
    for i in range(20):
        B.tx(i, "X", "H", 100 + i)
    B.tx(30, "S1", "H", 5_000)
    B.tx(31, "S2", "H", 6_000)
    B.tx(32, "S1", "X", 50)
    session.commit()
    loaded = ledger.account_history(session, ["H", "X"], "t")
    fresh = ledger.account_history(session, ["S1", "S2", "H"], "t")
    reused = ledger.account_history(session, ["S1", "S2", "H"], "t", loaded=loaded, loaded_ids={"H", "X"})
    pd.testing.assert_frame_equal(fresh, reused)


# ---------------------------------------------------------------- end to end on a small generated ledger
def models_present() -> bool:
    try:
        mdl.load("transaction_model")
        mdl.load("account_model")
        return True
    except mdl.ModelArtifactUnavailable:
        return False


SMALL = ForensicLedgerConfig(seed=777, num_people=400, num_merchants=40, num_employers=6, days=60,
                             instances={"direct": 1, "chain": 1, "multi_hop": 0, "split": 0, "consolidation": 0, "circular": 2,
                                        "multi_victim": 0, "takeover": 0, "lookalike": 0})


@pytest.fixture(scope="module")
def small(tmp_path_factory):
    lg = ForensicScenarioGenerator(SMALL).generate()
    d = tmp_path_factory.mktemp("trace_e2e")
    paths = lg.write(str(d / "csv"))
    url = f"sqlite:///{d / 'f.db'}"
    engine = get_v2_engine(url)
    assert not ingest_v2_dataset(engine, paths["accounts"], paths["transactions"], replace=True).errors
    engine.dispose()
    return lg, DatasetRegistry(url)


def run(registry, account):
    out, base, _ = DynamicInvestigation.compute(registry, None, DynamicInvestigationRequest(account_id=account, dataset_id="forensic-scenarios"))
    return out, base


@pytest.mark.skipif(not models_present(), reason="v3 model artifacts not built")
def test_circular_scenario_loop_members_are_found_in_a_cycle(small):
    lg, registry = small
    # Ground truth is used here only to choose which accounts to investigate and to check the answer.
    loop = lg.roles[(lg.roles.role_detail == "loop member") & lg.roles.materialised]
    assert len(loop)
    found = 0
    for sid, grp in loop.groupby("scenario_id"):
        members = set(grp.account_id)
        out, base = run(registry, grp.account_id.iloc[0])
        on_loop = {a["account_id"] for a in out["role_assessments"] if a["graph_relationship"]["in_cycle"]}
        if by_reason(out["fund_trace"]["branches"], "cycle_detected"):
            found += 1
            assert grp.account_id.iloc[0] in on_loop and on_loop <= members
            assert base["trace"]["cycles_detected"] >= 1
        ids = {e["transaction_id"] for e in base["trace"]["edges"]}
        assert {t for b in out["fund_trace"]["branches"] for t in b["transaction_ids"]} == ids
    assert found == loop.scenario_id.nunique()


@pytest.mark.skipif(not models_present(), reason="v3 model artifacts not built")
def test_digest_covers_every_deterministic_section(small):
    lg, registry = small
    victim = lg.roles[(lg.roles.role == "victim") & lg.roles.materialised].account_id.iloc[0]
    out, base = run(registry, victim)
    again, _ = run(registry, victim)
    assert out["investigation_digest"] == again["investigation_digest"]
    assert out["investigation_digest"] == DynamicInvestigation.digest(out, base)
    ref = out["investigation_digest"]
    for key in out:
        changed = copy.deepcopy(out)
        changed[key] = {"changed": True}
        same = DynamicInvestigation.digest(changed, base) == ref
        assert same == (key in DynamicInvestigation.DIGEST_EXCLUDED), key
    # When the ledger was read or its file written does not change the digest; what it holds does.
    src = copy.deepcopy(out)
    src["dataset"]["source"]["queried_at"] = "2099-01-01T00:00:00+00:00"
    src["dataset"]["source"]["snapshot_built_at"] = "2099-01-01T00:00:00+00:00"
    assert DynamicInvestigation.digest(src, base) == ref
    src["dataset"]["source"]["transactions_count"] += 1
    assert DynamicInvestigation.digest(src, base) != ref
    nested = copy.deepcopy(out)
    nested["network_findings"] = nested["network_findings"] + ["x"]
    assert DynamicInvestigation.digest(nested, base) != ref
    assert DynamicInvestigation.digest(out, {**base, "report_digest": "other"}) != ref


# ---------------------------------------------------------------- depth limit, per-account cap, seeds, exposure windows
def test_depth_limit_ending_only_where_the_account_has_a_further_transfer(session):
    # Downstream at max_depth 2: B pays on within the window (cut short by the limit); D pays nothing in the window
    # (it pays only four days later), so its branch ends truthfully with no further transfer.
    B = Book(session)
    B.acc("R", "A", "B", "C", "D", "E", "F", "U1", "U2", "U3")
    ra = B.tx(0, "R", "A", 9_000)
    ab = B.tx(30, "A", "B", 8_000)
    B.tx(90, "B", "E", 7_000)
    rc = B.tx(5, "R", "C", 6_000)
    cd = B.tx(40, "C", "D", 5_000)
    B.tx(4 * 24 * 60, "D", "F", 4_000)  # outside 72 h of D receiving cd
    # Upstream at max_depth 2: U2 received from U3 before paying U1 (cut short); U1's other payer chain stops.
    u2u1 = B.tx(-60, "U2", "U1", 3_000)
    B.tx(-120, "U3", "U2", 3_100)
    u1r = B.tx(-30, "U1", "R", 2_900)
    flow = trace(session, "R", [ra, rc], [u1r], max_depth=2)
    br = branches(flow, max_depth=2)
    check_invariants(flow, br, max_depth=2)

    assert flow.onward_beyond_depth == {ab.transaction_id: True, cd.transaction_id: False, u2u1.transaction_id: True}
    end = {tuple(b["transaction_ids"]): b["ending"]["reason"] for b in br}
    assert end[(ra.transaction_id, ab.transaction_id)] == "maximum_depth_reached"
    assert end[(rc.transaction_id, cd.transaction_id)] == "no_further_transaction_in_window"
    assert end[(u1r.transaction_id, u2u1.transaction_id)] == "maximum_depth_reached"
    assert ENDINGS["maximum_depth_reached"].startswith("Maximum depth reached")
    note = [n for n in flow.truncation_notes if n.startswith("The depth limit")]
    assert note == ["The depth limit of 2 hop(s) was reached; 2 account(s) at that depth have further transfers in the "
                    "window that were not followed."]


def test_depth_limit_with_nothing_further_is_not_reported_as_cut_short(session):
    B = Book(session)
    B.acc("R", "A", "B", "P")
    ra = B.tx(0, "R", "A", 9_000)
    ab = B.tx(30, "A", "B", 8_000)
    pr = B.tx(-10, "P", "R", 1_000)  # P received nothing before paying R: upstream also ends with nothing earlier
    flow = trace(session, "R", [ra], [pr], max_depth=2)
    br = branches(flow, max_depth=2)
    check_invariants(flow, br, max_depth=2)
    assert flow.onward_beyond_depth == {ab.transaction_id: False}
    assert not by_reason(br, "maximum_depth_reached")
    assert [b["ending"]["reason"] for b in br] == ["no_further_transaction_in_window", "no_earlier_transaction_in_window"]
    assert not any(n.startswith("The depth limit") for n in flow.truncation_notes)


def test_per_account_cap_is_shown_on_a_branch_through_the_capped_account(session):
    B = Book(session)
    names = ["R", "H"] + [f"N{i}" for i in range(13)]
    B.acc(*names)
    rh = B.tx(0, "R", "H", 100_000)
    for i in range(13):
        B.tx(10 + i, "H", f"N{i}", 1_000 + 100 * i)
    flow = trace(session, "R", [rh], [], max_depth=3, max_edges_per_account=10)
    br = branches(flow)
    check_invariants(flow, br)
    x = flow.expansions["H"]
    assert x["capped"] and x["found"] == 10 and x["qualifying"] == 13 and x["anchor"] == rh.transaction_id
    assert len(flow.edges) == 11  # the seed and H's 10 largest transfers; nothing invented for the other 3
    cap = by_reason(br, "per_account_limit_applied")
    assert len(cap) == 1 and cap[0]["transaction_ids"] == [rh.transaction_id] and cap[0]["accounts"] == ["R", "H"]
    assert "H made 13 transfers" in cap[0]["ending"]["detail"] and "only the 10 largest were followed" in cap[0]["ending"]["detail"]
    assert "other 3 were not traced" in cap[0]["ending"]["detail"]
    # The followed transfers keep their own branches (H's recipients paid nothing further).
    assert len(by_reason(br, "no_further_transaction_in_window")) == 10
    assert any("only the 10 largest were followed" in n for n in flow.truncation_notes)


def test_seeds_kept_out_by_the_account_limit_are_not_listed_as_traced(session):
    B = Book(session)
    B.acc("R", "A", "B", "C", "D")
    seeds = [B.tx(i, "R", x, 1_000 * (i + 1)) for i, x in enumerate(["A", "B", "C", "D"])]
    flow = trace(session, "R", seeds, [], max_nodes=3)
    br = branches(flow, max_nodes=3)
    check_invariants(flow, br, max_nodes=3)
    traced = {e.txn.transaction_id for e in flow.edges}
    assert traced == {seeds[0].transaction_id, seeds[1].transaction_id}
    assert flow.untraced_seeds == [seeds[2].transaction_id, seeds[3].transaction_id]
    assert any("could not be traced because the account limit of 3" in n and seeds[3].transaction_id in n
               for n in flow.truncation_notes)


def _report(session, root, **kw):
    from app.api.v2.investigation_schemas import InvestigationRequest
    from app.services.v2.investigation import InvestigationService
    session.commit()
    source = DatasetRegistry(str(session.get_bind().url)).describe("forensic-scenarios", session)
    req = InvestigationRequest(account_id=root, trace_scope="all", ai_explanation="separate", **kw)
    base, _, flow = InvestigationService.compute_with_trace(session, req, source=source, use_v2_model=False)
    return base, flow


def test_report_seed_lists_hold_only_traced_seeds(session):
    B = Book(session)
    B.acc("R", "A", "B", "C", "D")
    seeds = [B.tx(i, "R", x, 1_000 * (i + 1)) for i, x in enumerate(["A", "B", "C", "D"])]
    base, flow = _report(session, "R", max_nodes=3)
    tr = base["trace"]
    traced = {e["transaction_id"] for e in tr["edges"]}
    assert set(tr["downstream_seed_transaction_ids"]) <= traced and len(tr["downstream_seed_transaction_ids"]) == 2
    assert tr["untraced_seed_transaction_ids"] == sorted(flow.untraced_seeds) and len(flow.untraced_seeds) == 2
    assert not set(tr["untraced_seed_transaction_ids"]) & traced
    by_id = {t.transaction_id: t.amount for t in seeds}
    assert base["exposure"]["traced_outgoing_total"] == round(sum(by_id[t] for t in tr["downstream_seed_transaction_ids"]), 2)


def test_forwarded_range_covers_every_traced_receipt(session):
    # A receives 10,000 twice, three weeks apart, and passes 9,000 on within hours each time. The forwarded range must
    # describe both receipts (20,000 received), not only the first 72 h.
    B = Book(session)
    B.acc("R", "Z1", "Z2", balance=1_000_000.0)
    B.acc("A", balance=0.0)
    B.tx(0, "R", "A", 10_000)
    B.tx(120, "A", "Z1", 9_000)
    B.tx(21 * 24 * 60, "R", "A", 10_000)
    B.tx(21 * 24 * 60 + 60, "A", "Z2", 9_000)
    base, flow = _report(session, "R", max_depth=2)
    line = next(x for x in base["exposure"]["per_account"] if x["account_id"] == "A")
    received = sum(e.txn.amount for e in flow.edges if e.direction == "downstream" and not e.is_cycle
                   and e.txn.destination_account_id == "A")
    assert received == 20_000 and line["traced_in_amount"] == 20_000
    assert line["outgoing_in_window"] == 18_000
    # Window 1: balance 0 -> 10,000 -> 1,000, so 9,000 moved on. Window 2: 1,000 -> 11,000 -> 2,000; the rule keeps the
    # traced 10,000 in the account until the balance falls below it, so at least 8,000 of it moved on. The old
    # first-window-only range was 9,000..9,000 of a stated 20,000 received.
    assert line["forwarded_min"] == 17_000 and line["forwarded_max"] == 18_000
    assert 0 <= line["forwarded_min"] <= line["forwarded_max"] <= line["traced_in_amount"]


def test_forwarded_range_single_window_is_unchanged(session):
    # Both receipts inside one window: exactly the single-window balance rule (traced money assumed to stay until the
    # balance falls below it).
    B = Book(session)
    B.acc("R", "Z1", balance=1_000_000.0)
    B.acc("A", balance=500.0)
    B.tx(0, "R", "A", 4_000)
    B.tx(60, "R", "A", 6_000)
    B.tx(120, "A", "Z1", 7_000)
    base, _ = _report(session, "R", max_depth=2)
    line = next(x for x in base["exposure"]["per_account"] if x["account_id"] == "A")
    # balance 500 -> 4,500 -> 10,500 -> 3,500: traced 10,000 falls to 3,500, so at least 6,500 moved on, at most 7,000.
    assert line["traced_in_amount"] == 10_000 and line["outgoing_in_window"] == 7_000
    assert line["forwarded_min"] == 6_500 and line["forwarded_max"] == 7_000
    assert line["lowest_balance_in_window"] == 3_500
