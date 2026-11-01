"""Fast subset of the independent fund-tracing verification (ml/forensics/verify_tracing.py).

Runs the engine the way the API does on one planted loop (its victim and the loop member the victim paid), one
look-alike hub and one ordinary account, at max_depth 3..5 (max_nodes 200, and 10 for the victim), and checks every
reported amount, branch ending, cycle and limit against direct SQL on the served ledger. Skips cleanly when the ledger
or its evaluation-only ground truth (used here only to pick the accounts) is absent.

    PYTHONPATH=.:backend backend/.venv/bin/python -m pytest ml/tests/test_tracing_verification.py -q
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "v3_forensic_scenarios.db"
GT = ROOT / "data" / "v3_forensic" / "demo"

pytestmark = pytest.mark.skipif(
    not DB.exists() or not all((GT / f).exists() for f in ("accounts.csv", "roles.csv", "scenarios.csv", "transactions.csv")),
    reason="served forensic ledger (data/v3_forensic_scenarios.db) or data/v3_forensic/demo ground truth not present",
)


@pytest.fixture(scope="module")
def result():
    from ml.forensics import verify_tracing as vt

    loops = vt.circular_loops()
    lp = loops[0]
    sel = vt.select_cases()
    cases = {"victim": [lp["victim"]], "loop_member": [lp["loop_path"][0]],
             "lookalike": sel["lookalike_hubs"][:1], "ordinary": sel["ordinary"][:1]}
    r = vt.verify(cases, grid_subset=[lp["victim"]], det_subset=[lp["victim"], sel["ordinary"][0]],
                  depths=(3, 4, 5), node_limits=(10, 200), progress=False)
    r["loop"] = lp
    return r


def _failures(r: dict, *names: str) -> dict:
    return {n: r["checks"][n]["violations"][:5] for n in names if r["checks"][n]["failed"]}


def test_engine_ran_every_request(result):
    assert result["errors"] == []
    assert result["runs"] == result["plan"]


def test_amounts_reconcile_with_ledger(result):
    names = ("a1_trace_edges_match_ledger", "a2_branch_steps_match_ledger", "a3_every_transaction_dict_matches_ledger",
             "a4_trace_edges_unique", "a5_received_traced_rule", "a6_sent_traced_rule", "a7_forwarded_bounds_ordered",
             "a8_exposure_recomputed_from_ledger", "a9_exposure_received_equals_graph_received", "a10_totals_equal_edge_sums",
             "a12_graph_relationship_counts", "a13_other_sender_transfer_matches_ledger")
    assert all(result["checks"][n]["checked"] for n in names[:8] + names[9:10])
    assert _failures(result, *names) == {}


def test_every_seed_listed_is_in_the_trace(result):
    """A transfer named as a trace seed must be in the trace (or the response must not name it as traced)."""
    assert _failures(result, "a11_seeds_are_traced") == {}


def test_branch_endings_hold_against_ledger(result):
    names = ("b1_ending_condition_holds", "b2_max_depth_only_at_max_depth", "b4_no_forbidden_claims", "b5_every_leaf_has_one_branch")
    assert result["checks"]["b1_ending_condition_holds"]["checked"] > 0
    assert _failures(result, *names) == {}


def test_maximum_depth_ending_only_where_money_could_continue(result):
    """Owner rule: 'maximum_depth_reached' only where the account has a further transfer in the window; the depth-limit
    note must count only those accounts."""
    assert _failures(result, "b3_max_depth_has_onward_transfers", "b6_depth_note_counts_accounts_with_onward") == {}


def test_cycles(result):
    names = ("c1_cycle_edges_consistent_with_ledger", "c2_no_missed_same_path_cycle", "c3_in_cycle_accounts_on_real_loop",
             "c4_circular_loops_detected")
    assert _failures(result, *names) == {}
    lp = result["loop"]
    # The planted loop closes at hop 1 + len(loop) from its victim: required (and found) at depth 5, not at depth 3.
    rows = {(r["root"], r["max_depth"], r["max_nodes"]): r for r in result["circular_loop_runs"] if r["scenario_id"] == lp["scenario_id"]}
    deep = rows[(lp["victim"], 5, 200)]
    if deep["seeded"]:
        assert deep["expected_detected"] and deep["detected"] and all(deep["members_in_cycle"].values())
    assert not rows[(lp["victim"], 3, 200)]["closing_transfers"]


def test_limits_monotonic_deterministic_and_branches_separate(result):
    names = ("d1_hop_within_max_depth", "d2_nodes_within_max_nodes", "d3_depth_monotonic", "d4_deterministic",
             "d5_branches_are_valid_chains")
    assert all(result["checks"][n]["checked"] for n in names)
    assert _failures(result, *names) == {}
