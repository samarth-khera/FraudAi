"""Independent verification of the dynamic investigation's fund tracing against the ledger it reads.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.verify_tracing            # full grid, writes the report
    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.verify_tracing --quick    # small subset, no report

The engine is run exactly as the API runs it (DatasetRegistry + DynamicInvestigation.compute with
DynamicInvestigationRequest(dataset_id="forensic-scenarios"), via the same call as ml/forensics/evaluate_investigations.run)
and every amount, ending, cycle and limit it reports is checked against direct SQL on data/v3_forensic_scenarios.db
(opened read-only). Nothing in the engine is reused to compute the expected values: transfers, timestamps, balances and
onward/earlier transfers come from SQL; the rules the engine documents are re-implemented here.

Ground truth (data/v3_forensic/demo/*.csv) is read only here, by the verifier, to SELECT accounts (scenario victims,
circular-scenario members, look-alike hubs, ordinary accounts) and to know which transfers form each planted loop. It is
never passed to the engine.

Accounts run: every materialised scenario victim, every SC-CIRCULAR member, every look-alike hub and 60 deterministic
ordinary accounts, each at max_depth 1..6 (max_nodes 200); a deterministic subset also at max_nodes 10 and 50, and a
determinism subset is run twice. Writes ml/reports/tracing_verification.json. All data is synthetic.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

DB_FILE = ROOT / "data" / "v3_forensic_scenarios.db"
GT_DIR = ROOT / "data" / "v3_forensic" / "demo"
REPORT = ROOT / "ml" / "reports" / "tracing_verification.json"
DATASET_ID = "forensic-scenarios"
DEPTHS = (1, 2, 3, 4, 5, 6)
NODE_LIMITS = (10, 50, 200)
ORDINARY_SAMPLE = 60
ORDINARY_SEED = 303
MAX_EDGES_PER_ACCOUNT = 10  # documented per-account cap of the tracer (investigation.MAX_EDGES_PER_ACCOUNT)
LOOP_MIN_ACCOUNTS = 3       # documented minimum loop size for in_cycle (graph_tracer.LOOP_MIN_ACCOUNTS)
TOL = 0.011                 # amounts are reported rounded to 2 decimals
FORBIDDEN = re.compile(r"\b(recover\w*|frozen|freez\w*|lost|loss)\b", re.I)

ENGINE_RULES = {
    "received_traced_amount": "Investigated account: always 0. Every other account: sum of traced transfers INTO it whose "
                              "direction is 'downstream' and that are not loop-closing (is_cycle) transfers.",
    "sent_traced_amount": "Sum of ALL traced transfers OUT of the account, whatever their direction, loop-closing ones included.",
    "forwarded_at_least/forwarded_at_most": "Copied from investigation.exposure.per_account (downstream accounts only, first "
                                            "60): over [first traced downstream non-loop receipt, +onward_window_hours], "
                                            "ordered by (timestamp, transaction_id): traced += receipt; traced = min(traced, "
                                            "balance_after); forwarded_min = received - traced, forwarded_max = min(received, "
                                            "outgoing in window). 'received' counts only traced receipts inside that window.",
    "observed_downstream_total": "Sum of distinct traced downstream transfers (each transfer once).",
    "traced_outgoing_total": "Sum of the downstream seed transfers selected for tracing.",
    "is_cycle": "Far party already on the edge's own path back to the root, or first reached from the opposite side of "
                "the root with timing that lets money run round: upstream edge: follows(intro(far), edge) or "
                "follows(own_seed, other_seed); downstream edge: follows(edge, intro(far)) or follows(other_seed, own_seed); "
                "follows(r, p) = r.ts <= p.ts <= r.ts + window.",
    "in_cycle": f"Account on a closed loop of at least {LOOP_MIN_ACCOUNTS} distinct accounts formed by traced transfers.",
    "endings_order": "cycle, cash withdrawal (downstream ATM_CASH_OUT), convergence (opposite side -> joins_opposite, same "
                     "side -> already_examined), hop >= max_depth, node limit, per-account cap, nothing in window.",
}


# ----------------------------------------------------------------------------------------------------------- ledger (SQL)
def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "")).replace(tzinfo=None)


def _sqlts(d: datetime) -> str:
    return d.strftime("%Y-%m-%d %H:%M:%S.%f")


class Ledger:
    """Direct, read-only SQL on the served ledger. The engine is never consulted for these facts."""

    COLS = ("transaction_id, timestamp, origin_account_id, destination_account_id, amount, channel, "
            "origin_balance_before, origin_balance_after, dest_balance_before, dest_balance_after")

    def __init__(self, path: Path = DB_FILE):
        self.con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.con.row_factory = sqlite3.Row
        self._tx: dict[str, Optional[dict]] = {}
        self._acc: dict[str, bool] = {}

    def _row(self, r) -> dict:
        d = dict(r)
        d["ts"] = _dt(d["timestamp"])
        return d

    def tx(self, tid: str) -> Optional[dict]:
        if tid not in self._tx:
            r = self.con.execute(f"SELECT {self.COLS} FROM transactions WHERE transaction_id = ?", (tid,)).fetchone()
            self._tx[tid] = self._row(r) if r else None
        return self._tx[tid]

    def account_exists(self, a: str) -> bool:
        if a not in self._acc:
            self._acc[a] = self.con.execute("SELECT 1 FROM accounts WHERE account_id = ?", (a,)).fetchone() is not None
        return self._acc[a]

    def outgoing(self, a: str, lo: datetime, hi: datetime, exclude: str) -> list[dict]:
        rows = self.con.execute(f"SELECT {self.COLS} FROM transactions WHERE origin_account_id = ? AND timestamp >= ? "
                                "AND timestamp <= ? AND transaction_id <> ?", (a, _sqlts(lo), _sqlts(hi), exclude)).fetchall()
        return [self._row(r) for r in rows]

    def incoming(self, a: str, lo: datetime, hi: datetime, exclude: str) -> list[dict]:
        rows = self.con.execute(f"SELECT {self.COLS} FROM transactions WHERE destination_account_id = ? AND timestamp >= ? "
                                "AND timestamp <= ? AND transaction_id <> ?", (a, _sqlts(lo), _sqlts(hi), exclude)).fetchall()
        return [self._row(r) for r in rows]

    def account_rows(self, a: str, lo: datetime, hi: datetime) -> list[dict]:
        rows = self.con.execute(f"SELECT {self.COLS} FROM transactions WHERE (origin_account_id = ? OR destination_account_id = ?) "
                                "AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC, transaction_id ASC",
                                (a, a, _sqlts(lo), _sqlts(hi))).fetchall()
        return [self._row(r) for r in rows]


# ------------------------------------------------------------------------------------------------------------- checks
class Checks:
    def __init__(self, descriptions: dict[str, str]):
        self.desc = descriptions
        self.n: Counter = Counter()
        self.bad: dict[str, list[dict]] = defaultdict(list)

    def check(self, name: str, ok: bool, **violation: Any) -> bool:
        assert name in self.desc, name
        self.n[name] += 1
        if not ok:
            self.bad[name].append(violation)
        return ok

    def summary(self) -> dict:
        out = {}
        for name, d in self.desc.items():
            v = self.bad.get(name, [])
            out[name] = {"description": d, "checked": int(self.n[name]), "passed": int(self.n[name] - len(v)),
                         "failed": len(v), "violations": v}
        return out


CHECKS = {
    # (a) amount reconciliation
    "a1_trace_edges_match_ledger": "Every investigation.trace.edges transfer exists in the ledger with identical timestamp, "
                                   "sender, receiver, amount, channel and balances.",
    "a2_branch_steps_match_ledger": "Every fund_trace.branches step exists in the ledger; its amount equals the ledger amount, its "
                                    "accounts list follows the ledger's sender/receiver.",
    "a3_every_transaction_dict_matches_ledger": "Every object anywhere in the response that names a transaction_id and an amount "
                                                "matches the ledger (amount, timestamp, sender, receiver).",
    "a4_trace_edges_unique": "No transfer appears twice in investigation.trace.edges.",
    "a5_received_traced_rule": "graph_relationship.received_traced_amount equals the engine's stated rule recomputed from the "
                               "ledger amounts of the traced transfers.",
    "a6_sent_traced_rule": "graph_relationship.sent_traced_amount equals the engine's stated rule recomputed from ledger amounts.",
    "a7_forwarded_bounds_ordered": "0 <= forwarded_at_least <= forwarded_at_most <= received_traced_amount.",
    "a8_exposure_recomputed_from_ledger": "exposure.per_account traced_in/outgoing/forwarded_min/forwarded_max/lowest balance "
                                          "equal an independent SQL recomputation of the documented balance rule.",
    "a9_exposure_received_equals_graph_received": "exposure traced_in_amount (all traced receipts, per-window rule) equals graph_relationship."
                                                  "received_traced_amount, so the forwarded range describes all traced money "
                                                  "the account received.",
    "a10_totals_equal_edge_sums": "observed_downstream_total = sum of distinct downstream edges; traced_outgoing_total = sum of "
                                  "downstream seeds; flagged_outgoing_total <= traced_outgoing_total when flagged; fund_trace."
                                  "transactions = distinct edges = union of branch transfers; fund_trace.accounts = nodes; "
                                  "cycles_detected = loop-closing edges.",
    "a11_seeds_are_traced": "Every downstream/upstream seed transfer (counted in traced_outgoing_total) is in the trace.",
    "a12_graph_relationship_counts": "onward_destinations, traced_paths_in and hop in graph_relationship follow their stated "
                                     "rules over the traced transfers.",
    "a13_other_sender_transfer_matches_ledger": "For accounts added as other senders, sent_traced_amount equals their flagged "
                                                "transfer in the ledger, received_traced_amount is 0, and that transfer pays "
                                                "an account in the trace.",
    # (b) branch endings
    "b1_ending_condition_holds": "Each ending reason's condition holds against the ledger (see per-reason rules in the report).",
    "b2_max_depth_only_at_max_depth": "maximum_depth_reached only on a branch whose last hop == max_depth.",
    "b3_max_depth_has_onward_transfers": "maximum_depth_reached only where the last account actually has a further qualifying "
                                         "transfer in the window (owner rule).",
    "b4_no_forbidden_claims": "No ending (reason or detail) claims money was recovered, frozen or lost.",
    "b5_every_leaf_has_one_branch": "Every traced transfer with no traced continuation ends exactly one branch; every loop-"
                                    "closing transfer ends a branch with cycle_detected or a cross-side join.",
    "b6_depth_note_counts_accounts_with_onward": "The 'depth limit reached; K account(s) not followed further' note counts "
                                                 "only accounts that have a further transfer in the window.",
    "b7_per_account_cap_shown_on_branches": "An account whose transfers were cut to the 10 largest (truncation note) has at "
                                            "least one branch through it ending 'per_account_limit_applied', and it really had "
                                            "more than 10 qualifying transfers.",
    # (c) cycles
    "c1_cycle_edges_consistent_with_ledger": "Every is_cycle transfer closes a loop under the documented rule, recomputed "
                                             "from ledger timestamps (own-path or opposite-side timing).",
    "c2_no_missed_same_path_cycle": "No non-cycle transfer reaches an account already on its own branch path.",
    "c3_in_cycle_accounts_on_real_loop": f"Every in_cycle account lies on a directed loop of >= {LOOP_MIN_ACCOUNTS} distinct "
                                         "accounts formed by traced transfers.",
    "c4_circular_loops_detected": "Every SC-CIRCULAR loop that lies within max_depth of the investigated account (given the "
                                  "engine's own seeds) is closed by an is_cycle transfer and all its members carry in_cycle.",
    # (d) limits, determinism, branch structure
    "d1_hop_within_max_depth": "No edge or node hop exceeds max_depth; fund_trace.max_depth_reached <= max_depth.",
    "d2_nodes_within_max_nodes": "fund_trace.accounts <= max_nodes.",
    "d3_depth_monotonic": "Raising max_depth (same max_nodes) never removes or alters an earlier traced transfer.",
    "d4_deterministic": "Identical requests give the same investigation_digest and identical fund_trace.",
    "d5_branches_are_valid_chains": "Each branch is a separate time-ordered chain of ledger transfers (parent links, 72 h "
                                    "window, connected accounts), amounts are per transfer (never merged), no two branches "
                                    "are identical, and branches cover exactly the traced transfers.",
}


# What a failure of each check means in the engine (cause located by reading the code; never edited here). The report
# attaches the first recorded violation of each failing check as its concrete reproduction.
DEFECT_NOTES = {
    "b3_max_depth_has_onward_transfers":
        "engine.py DynamicInvestigation._branches.ending() returns 'maximum_depth_reached' whenever e.hop >= max_depth "
        "(after cycle/cash/convergence) without asking whether the last account has any qualifying transfer in the "
        "window, so a branch whose money simply stopped is reported as cut short by the depth limit.",
    "b6_depth_note_counts_accounts_with_onward":
        "graph_tracer.trace_from_seeds builds the depth note from every non-loop, non-convergent edge at hop == max_depth "
        "('K account(s) at that depth were not followed further'), including accounts with nothing further to follow.",
    "b7_per_account_cap_shown_on_branches":
        "The 'per_account_limit_applied' ending is unreachable: _branches() only uses it for a leaf whose ending starts "
        "with 'no_' and whose far account was capped, but a capped account's found transfers always become children, "
        "cross-links or node-limit drops, so that leaf never exists. The cap is disclosed only in truncation_notes; "
        "no branch through the capped account says that some of its transfers were not followed.",
    "a9_exposure_received_equals_graph_received":
        "investigation.py exposure lines count only traced receipts inside [first traced receipt, +onward_window_hours]; "
        "graph_relationship.received_traced_amount (engine._evidence) counts every traced downstream non-loop receipt. "
        "When a later traced receipt (e.g. a convergent transfer days later) falls outside that window, the forwarded "
        "range (forwarded_at_least/at_most) describes only part of the money the same response says was received.",
    "a11_seeds_are_traced":
        "Seeds are added in timestamp order and the node limit drops later ones, so investigation.trace.*_seed_transaction_ids "
        "can name transfers that are not in the trace (and a larger seed can be dropped while a smaller, earlier one is "
        "kept). Only upstream seeds were affected in this grid; traced_outgoing_total uses downstream seeds and stayed "
        "exact. The node-limit truncation note does disclose that transfers were not added.",
}


# --------------------------------------------------------------------------------------------------- case selection
def select_cases(gt_dir: Path = GT_DIR, n_ordinary: int = ORDINARY_SAMPLE) -> dict[str, list[str]]:
    roles = pd.read_csv(gt_dir / "roles.csv")
    roles = roles[roles.materialised]
    scen = pd.read_csv(gt_dir / "scenarios.csv").set_index("scenario_id")
    accounts = pd.read_csv(gt_dir / "accounts.csv")
    tx = pd.read_csv(gt_dir / "transactions.csv", usecols=["origin_account_id", "destination_account_id"])
    n_tx = pd.concat([tx.origin_account_id, tx.destination_account_id]).value_counts()
    pat = roles.scenario_id.map(scen.pattern)
    victims = sorted(set(roles[roles.role == "victim"].account_id))
    circular = sorted(set(roles[pat == "circular"].account_id))
    lookalike = sorted(set(roles[roles.role == "lookalike_legitimate"].account_id))
    ordinary = accounts[(accounts.ground_truth_label == "ordinary") & accounts.account_id.map(n_tx).fillna(0).ge(5)]
    pool = np.array(sorted(ordinary.account_id))
    rng = np.random.default_rng(ORDINARY_SEED)
    ordinary_ids = sorted(rng.choice(pool, min(n_ordinary, len(pool)), replace=False).tolist())
    return {"victim_roots": victims, "circular_members": circular, "lookalike_hubs": lookalike, "ordinary": ordinary_ids}


def circular_loops(gt_dir: Path = GT_DIR) -> list[dict]:
    """Each planted loop: its members (in order) and its transfers, from the evaluation-only ground truth."""
    roles = pd.read_csv(gt_dir / "roles.csv")
    roles = roles[roles.materialised]
    tx = pd.read_csv(gt_dir / "transactions.csv")
    out = []
    for sid, g in roles[roles.scenario_id.str.startswith("SC-CIRCULAR")].groupby("scenario_id"):
        members = set(g[g.role_detail == "loop member"].account_id)
        victim = g[g.role == "victim"].account_id.iloc[0]
        t = tx[tx.scenario_id == sid].sort_values("timestamp")
        loop_tx = t[t.origin_account_id.isin(members) & t.destination_account_id.isin(members)]
        entry = t[(t.origin_account_id == victim) & t.destination_account_id.isin(members)]
        out.append({"scenario_id": sid, "victim": victim, "members": sorted(members),
                    "entry_transfer": entry.transaction_id.iloc[0] if len(entry) else None,
                    "loop_transfers": loop_tx.transaction_id.tolist(),
                    "loop_path": [loop_tx.origin_account_id.iloc[0]] + loop_tx.destination_account_id.tolist()})
    return out


# ----------------------------------------------------------------------------------------------------- engine call
def make_registry():
    from backend.app.intelligence.datasets import DatasetRegistry
    return DatasetRegistry(f"sqlite:///{DB_FILE}")


def run_engine(registry, account_id: str, max_depth: int = 3, max_nodes: int = 200) -> dict:
    """Same path as the API and evaluate_investigations.run, with the trace limits set."""
    from backend.app.api.v2.dynamic_schemas import DynamicInvestigationRequest
    from backend.app.intelligence.engine import DynamicInvestigation
    req = DynamicInvestigationRequest(account_id=account_id, dataset_id=DATASET_ID, max_depth=max_depth, max_nodes=max_nodes)
    out, base, _ = DynamicInvestigation.compute(registry, None, req)
    out["investigation"] = {**base, "ai_analysis": {"state": "disabled"}}
    out["_request"] = {"account_id": account_id, "max_depth": max_depth, "max_nodes": max_nodes,
                       "onward_window_hours": req.onward_window_hours}
    return out


# --------------------------------------------------------------------------------------------------- verification
NODE_DIR = {"investigated_account": "root", "direct_recipient": "downstream", "onward_recipient": "downstream",
            "direct_sender": "upstream", "upstream_sender": "upstream"}


def _far(e: dict) -> str:
    return e["destination_account_id"] if e["direction"] == "downstream" else e["origin_account_id"]


def _iter_tx_dicts(obj, path=""):
    if isinstance(obj, dict):
        if "transaction_id" in obj and "amount" in obj and isinstance(obj.get("amount"), (int, float)):
            yield path, obj
        for k, v in obj.items():
            yield from _iter_tx_dicts(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _iter_tx_dicts(v, f"{path}[{i}]")


def _sccs(nodes: set[str], adj: dict[str, set[str]]) -> dict[str, int]:
    """Tarjan: account -> size of its strongly connected component."""
    index, low, on, stack, size_of = {}, {}, set(), [], {}
    counter = [0]

    def strong(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on.add(v)
        for w in adj.get(v, ()):
            if w not in index:
                strong(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop()
                on.discard(w)
                comp.append(w)
                if w == v:
                    break
            for w in comp:
                size_of[w] = len(comp)

    sys.setrecursionlimit(10000)
    for v in sorted(nodes):
        if v not in index:
            strong(v)
    return size_of


def verify_run(out: dict, L: Ledger, C: Checks, loops: list[dict]) -> dict:
    """Checks one engine response. Returns a compact edge signature for the cross-run checks."""
    rq = out["_request"]
    root, D, N = rq["account_id"], rq["max_depth"], rq["max_nodes"]
    W = timedelta(hours=rq["onward_window_hours"])
    key = f"{root}@d{D}n{N}"
    inv = out["investigation"]
    tr = inv["trace"]
    edges = tr["edges"]
    E = {e["transaction_id"]: e for e in edges}
    ft = out["fund_trace"]
    branches = ft["branches"]
    node_dir = {n["account_id"]: NODE_DIR.get(n["graph_role"], "?") for n in tr["nodes"]}
    node_hop = {n["account_id"]: n["hop_distance"] for n in tr["nodes"]}
    lt = {tid: L.tx(tid) for tid in E}

    # ---------------- (a) ledger identity of every reported transfer
    for e in edges:
        r = lt[e["transaction_id"]]
        ok = r is not None and _dt(e["timestamp"]) == r["ts"] and e["origin_account_id"] == r["origin_account_id"] \
            and e["destination_account_id"] == r["destination_account_id"] and abs(e["amount"] - r["amount"]) < TOL \
            and e["channel"] == r["channel"] and all(abs(e[c] - r[c]) < TOL for c in (
                "origin_balance_before", "origin_balance_after", "dest_balance_before", "dest_balance_after"))
        C.check("a1_trace_edges_match_ledger", ok, run=key, transaction_id=e["transaction_id"],
                reported={k: e[k] for k in ("timestamp", "origin_account_id", "destination_account_id", "amount")},
                ledger=None if r is None else {k: r[k] for k in ("timestamp", "origin_account_id", "destination_account_id", "amount")})
    ids = [e["transaction_id"] for e in edges]
    C.check("a4_trace_edges_unique", len(ids) == len(set(ids)), run=key,
            duplicates=sorted(t for t, c in Counter(ids).items() if c > 1))

    seen_dicts = 0
    for path, d in _iter_tx_dicts({k: v for k, v in out.items() if k != "_request"}):
        r = L.tx(d["transaction_id"])
        s = d.get("sender_account_id", d.get("origin_account_id"))
        rcv = d.get("receiver_account_id", d.get("destination_account_id"))
        ok = r is not None and abs(float(d["amount"]) - r["amount"]) < TOL \
            and (s is None or s == r["origin_account_id"]) and (rcv is None or rcv == r["destination_account_id"]) \
            and ("timestamp" not in d or _dt(d["timestamp"]) == r["ts"])
        seen_dicts += 1
        C.check("a3_every_transaction_dict_matches_ledger", ok, run=key, path=path, transaction_id=d["transaction_id"],
                reported_amount=d["amount"], ledger_amount=None if r is None else r["amount"])

    # ---------------- (d5) branch structure + (a2) branch amounts
    children = defaultdict(list)
    for e in edges:
        children[e["parent_transaction_id"]].append(e["transaction_id"])
    sigs = Counter()
    covered: set[str] = set()
    leaf_branch = Counter()     # non-cross branch endings per last transfer
    cross_branches = 0
    for b in branches:
        tids, accs, amts, bd = b["transaction_ids"], b["accounts"], b["amounts"], b["direction"]
        sigs[tuple(tids)] += 1
        covered |= set(tids)
        problems = []
        if not tids or len(accs) != len(tids) + 1 or len(amts) != len(tids):
            problems.append("length mismatch")
        if accs and accs[0] != root:
            problems.append("does not start at the investigated account")
        cross = b["ending"]["reason"] == "joins_opposite_direction_trace" and len(tids) >= 1 and tids[-1] in E \
            and E[tids[-1]]["direction"] != bd
        for i, tid in enumerate(tids):
            r, e = L.tx(tid), E.get(tid)
            if r is None or e is None:
                problems.append(f"{tid} not in ledger/trace")
                continue
            C.check("a2_branch_steps_match_ledger", abs(amts[i] - r["amount"]) < TOL and (
                accs[i + 1] == (r["destination_account_id"] if bd == "downstream" else r["origin_account_id"])
                and accs[i] == (r["origin_account_id"] if bd == "downstream" else r["destination_account_id"])),
                run=key, branch=b["branch_id"], transaction_id=tid, reported_amount=amts[i], ledger_amount=r["amount"],
                accounts=accs[i:i + 2])
            last_cross = cross and i == len(tids) - 1
            if i == 0:
                if e["parent_transaction_id"] is not None or e["hop"] != 1 or root not in (r["origin_account_id"], r["destination_account_id"]):
                    problems.append(f"first step {tid} is not a hop-1 transfer of the investigated account")
                continue
            p = L.tx(tids[i - 1])
            if not last_cross and e["parent_transaction_id"] != tids[i - 1]:
                problems.append(f"{tid} parent is {e['parent_transaction_id']}, branch has {tids[i - 1]}")
            if bd == "downstream":
                if not (p["destination_account_id"] == r["origin_account_id"] and p["ts"] <= r["ts"] <= p["ts"] + W):
                    problems.append(f"{tids[i - 1]}->{tid} not a connected onward transfer within the window")
            else:
                if not (p["origin_account_id"] == r["destination_account_id"] and p["ts"] - W <= r["ts"] <= p["ts"]):
                    problems.append(f"{tids[i - 1]}->{tid} not a connected earlier transfer within the window")
        if cross:
            cross_branches += 1
        elif tids:
            leaf_branch[tids[-1]] += 1
        C.check("d5_branches_are_valid_chains", not problems, run=key, branch=b["branch_id"], problems=problems)
    dup = [list(t) for t, c in sigs.items() if c > 1]
    C.check("d5_branches_are_valid_chains", not dup, run=key, branch="*", problems=[f"identical branches: {dup}"])
    C.check("d5_branches_are_valid_chains", covered == set(E), run=key, branch="*",
            problems=[f"traced but on no branch: {sorted(set(E) - covered)}", f"on a branch but not traced: {sorted(covered - set(E))}"])
    cross_parents = {b["transaction_ids"][-2] for b in branches if b["ending"]["reason"] == "joins_opposite_direction_trace"
                     and len(b["transaction_ids"]) >= 2 and b["transaction_ids"][-1] in E
                     and E[b["transaction_ids"][-1]]["direction"] != b["direction"]}
    for e in edges:
        tid = e["transaction_id"]
        if children.get(tid) or tid in cross_parents:
            continue
        C.check("b5_every_leaf_has_one_branch", leaf_branch[tid] == 1, run=key, transaction_id=tid,
                branches_ending_here=leaf_branch[tid])
    for e in edges:
        if e["is_cycle"]:
            ends = [b["ending"]["reason"] for b in branches if b["transaction_ids"] and b["transaction_ids"][-1] == e["transaction_id"]]
            C.check("b5_every_leaf_has_one_branch", any(x in ("cycle_detected", "joins_opposite_direction_trace") for x in ends),
                    run=key, transaction_id=e["transaction_id"], branches_ending_here=ends, note="loop-closing transfer")

    # ---------------- intro edges and chain seeds (for the cycle rule)
    intro = {}
    for e in edges:
        if not e["is_cycle"] and not e["converges"]:
            intro[_far(e)] = e

    def seed(e: dict) -> dict:
        guard = 0
        while e["parent_transaction_id"] and guard < 100:
            e = E[e["parent_transaction_id"]]
            guard += 1
        return e

    def follows(rid: str, pid: str) -> bool:
        r, p = L.tx(rid), L.tx(pid)
        return r["ts"] <= p["ts"] <= r["ts"] + W

    def own_path(e: dict) -> list[str]:
        accs = []
        x = e
        while x is not None:
            accs.append(_far(x))
            x = E.get(x["parent_transaction_id"]) if x["parent_transaction_id"] else None
        return [root] + accs[::-1]  # [root, ..., far(e)]

    def opposite_rule(e: dict) -> Optional[bool]:
        far = _far(e)
        first = intro.get(far)
        if first is None or first["direction"] == e["direction"]:
            return None
        own_seed, other_seed = seed(e), seed(first)
        if e["direction"] == "upstream":
            return follows(first["transaction_id"], e["transaction_id"]) or follows(own_seed["transaction_id"], other_seed["transaction_id"])
        return follows(e["transaction_id"], first["transaction_id"]) or follows(other_seed["transaction_id"], own_seed["transaction_id"])

    # ---------------- (c1/c2) cycle edges
    for e in edges:
        path_before = own_path(e)[:-1]
        far = _far(e)
        if e["is_cycle"]:
            same = far in path_before
            opp = opposite_rule(e) if not same else None
            C.check("c1_cycle_edges_consistent_with_ledger", same or opp is True, run=key, transaction_id=e["transaction_id"],
                    far_account=far, own_path=path_before, opposite_side_rule=opp)
        else:
            C.check("c2_no_missed_same_path_cycle", far not in path_before, run=key, transaction_id=e["transaction_id"],
                    far_account=far, own_path=path_before)

    # ---------------- (b) endings
    def onward(far: str, e: dict) -> list[dict]:
        r = L.tx(e["transaction_id"])
        if e["direction"] == "downstream":
            return L.outgoing(far, r["ts"], r["ts"] + W, r["transaction_id"])
        return L.incoming(far, r["ts"] - W, r["ts"], r["transaction_id"])

    nodes = set(node_dir)
    for b in branches:
        reason, detail = b["ending"]["reason"], b["ending"]["detail"]
        C.check("b4_no_forbidden_claims", not FORBIDDEN.search(reason + " " + detail), run=key, branch=b["branch_id"], detail=detail)
        tid = b["transaction_ids"][-1]
        e, r, bd = E[tid], L.tx(tid), b["direction"]
        far = b["accounts"][-1]
        ok, why = True, ""
        if reason == "cycle_detected":
            same = far in b["accounts"][:-1]
            ok = e["is_cycle"] and e["direction"] == bd and (same or opposite_rule(e) is True)
            why = "is_cycle transfer closing a loop (own path or opposite-side timing)"
        elif reason == "cash_withdrawal_recorded":
            ok = bd == "downstream" and r["channel"] == "ATM_CASH_OUT" and not e["is_cycle"]
            why = "downstream ATM_CASH_OUT transfer in the ledger"
        elif reason == "joins_opposite_direction_trace":
            if e["direction"] != bd:
                ok = any(o["direction"] == e["direction"] and tid in o["transaction_ids"] for o in branches)
                why = "cross-side transfer already on an opposite-direction branch"
            else:
                ok = e["converges"] and far != root and node_dir.get(far) not in (bd, "root") and opposite_rule(e) is False
                why = "converging transfer to an account first reached on the other side; timing forms no loop"
        elif reason == "already_examined_on_another_branch":
            first = intro.get(far)
            ok = e["converges"] and node_dir.get(far) == bd and far not in b["accounts"][:-1] and first is not None \
                and first["transaction_id"] != tid and any(first["transaction_id"] in o["transaction_ids"] for o in branches if o is not b)
            why = "converging transfer to an account reached on another same-side branch"
        elif reason == "maximum_depth_reached":
            C.check("b2_max_depth_only_at_max_depth", e["hop"] == D, run=key, branch=b["branch_id"], transaction_id=tid,
                    hop=e["hop"], max_depth=D)
            nxt = onward(far, e)
            C.check("b3_max_depth_has_onward_transfers", len(nxt) > 0, run=key, branch=b["branch_id"], transaction_id=tid,
                    account=far, hop=e["hop"], max_depth=D, direction=bd)
            ok = e["hop"] == D and not e["is_cycle"] and not e["converges"]
            why = "hop == max_depth, not a loop or convergence"
        elif reason == "maximum_node_limit_reached":
            nxt = onward(far, e)
            ok = ft["accounts"] >= N and any((x["destination_account_id"] if bd == "downstream" else x["origin_account_id"]) not in nodes for x in nxt)
            why = "account limit reached and a further transfer to an account outside the trace exists"
        elif reason == "per_account_limit_applied":
            ok = len(onward(far, e)) > MAX_EDGES_PER_ACCOUNT
            why = f"more than {MAX_EDGES_PER_ACCOUNT} qualifying transfers in the window"
        elif reason in ("no_further_transaction_in_window", "no_earlier_transaction_in_window"):
            nxt = onward(far, e)
            # Valid at any hop, including hop == max_depth: when the last-hop account has no qualifying transfer the
            # truthful ending is "no further transaction", not "maximum depth reached" (that is what b3 enforces).
            ok = (reason.startswith("no_further") == (bd == "downstream")) and len(nxt) == 0 \
                and not e["is_cycle"] and not e["converges"]
            why = f"no qualifying transfer in the window (found {[x['transaction_id'] for x in nxt][:10]})"
        elif reason == "incomplete_or_missing_data":
            ok = not L.account_exists(far)
            why = "account absent from the ledger"
        else:
            ok, why = False, "unknown ending reason"
        C.check("b1_ending_condition_holds", ok, run=key, branch=b["branch_id"], reason=reason, transaction_id=tid,
                account=far, hop=e["hop"], rule=why)

    frontier = [e for e in edges if e["hop"] == D and not e["is_cycle"] and not e["converges"]]
    note = next((n for n in ft["truncation_notes"] if n.startswith("The depth limit")), None)
    if note:
        with_onward = [e["transaction_id"] for e in frontier if onward(_far(e), e)]
        k = int(re.search(r"; (\d+) account", note).group(1))
        C.check("b6_depth_note_counts_accounts_with_onward", k == len(with_onward), run=key, note_count=k,
                frontier_accounts_with_onward_transfers=len(with_onward), frontier_accounts=len(frontier))

    cap_note = next((n for n in ft["truncation_notes"] if "largest were followed" in n), None)
    if cap_note:
        for c in [x.strip("…") for x in re.search(r"\(([^)]*)\)\.?$", cap_note).group(1).split(", ")]:
            first = intro.get(c)
            n_q = len(onward(c, first)) if first else None
            through = [b for b in branches if c in b["accounts"][1:]]
            C.check("b7_per_account_cap_shown_on_branches",
                    any(b["ending"]["reason"] == "per_account_limit_applied" for b in through) and (n_q or 0) > MAX_EDGES_PER_ACCOUNT,
                    run=key, account=c, ledger_qualifying_transfers=n_q, branches_through_account=len(through),
                    endings=dict(Counter(b["ending"]["reason"] for b in through)))

    # ---------------- (a) graph relationship amounts
    ins, outs = defaultdict(list), defaultdict(list)
    for e in edges:
        ins[e["destination_account_id"]].append(e)
        outs[e["origin_account_id"]].append(e)
    exp = {x["account_id"]: x for x in inv["exposure"]["per_account"]}
    for a in out["role_assessments"]:
        acc, g = a["account_id"], a["graph_relationship"]
        if g["position"] == "other_sender":
            t = a.get("other_sender_transaction") or {}
            r = L.tx(t.get("transaction_id", "")) if t else None
            C.check("a13_other_sender_transfer_matches_ledger",
                    r is not None and r["origin_account_id"] == acc and abs(g["sent_traced_amount"] - r["amount"]) < TOL
                    and not g["received_traced_amount"] and r["destination_account_id"] in nodes,
                    run=key, account=acc, transaction_id=t.get("transaction_id"), reported=g["sent_traced_amount"],
                    ledger=None if r is None else r["amount"])
            continue
        if acc == root:
            exp_recv = 0.0
        else:
            exp_recv = round(sum(L.tx(e["transaction_id"])["amount"] for e in ins[acc] if e["direction"] == "downstream" and not e["is_cycle"]), 2)
        exp_sent = round(sum(L.tx(e["transaction_id"])["amount"] for e in outs[acc]), 2)
        C.check("a5_received_traced_rule", abs(g["received_traced_amount"] - exp_recv) < TOL, run=key, account=acc,
                reported=g["received_traced_amount"], expected=exp_recv)
        C.check("a6_sent_traced_rule", abs(g["sent_traced_amount"] - exp_sent) < TOL, run=key, account=acc,
                reported=g["sent_traced_amount"], expected=exp_sent)
        lo, hi = g["forwarded_at_least"], g["forwarded_at_most"]
        if lo is not None or hi is not None:
            ok = lo is not None and hi is not None and -TOL < lo <= hi + TOL and hi <= g["received_traced_amount"] + TOL
            C.check("a7_forwarded_bounds_ordered", ok, run=key, account=acc, forwarded_at_least=lo, forwarded_at_most=hi,
                    received=g["received_traced_amount"])
        if acc in exp:
            C.check("a9_exposure_received_equals_graph_received", abs(exp[acc]["traced_in_amount"] - g["received_traced_amount"]) < TOL,
                    run=key, account=acc, exposure_traced_in=exp[acc]["traced_in_amount"], graph_received=g["received_traced_amount"])
            C.check("a7_forwarded_bounds_ordered", (lo, hi) == (exp[acc]["forwarded_min"], exp[acc]["forwarded_max"]),
                    run=key, account=acc, note="graph_relationship forwarded range differs from exposure line",
                    graph=(lo, hi), exposure=(exp[acc]["forwarded_min"], exp[acc]["forwarded_max"]))
        if acc != root:
            onward_d = len({e["destination_account_id"] for e in outs[acc] if e["direction"] == "downstream" and e["hop"] > 1})
            paths_in = len({e["origin_account_id"] for e in ins[acc] if not e["is_cycle"]})
            ok = g["onward_destinations"] == onward_d and g["traced_paths_in"] == paths_in and g["hop"] == node_hop.get(acc)
            C.check("a12_graph_relationship_counts", ok, run=key, account=acc,
                    reported=(g["onward_destinations"], g["traced_paths_in"], g["hop"]), expected=(onward_d, paths_in, node_hop.get(acc)))

    # ---------------- (a8) exposure recomputed from SQL
    for acc, x in exp.items():
        receipts = [e for e in ins[acc] if e["direction"] == "downstream" and not e["is_cycle"]]
        rid = {e["transaction_id"] for e in receipts}
        if not receipts:
            C.check("a8_exposure_recomputed_from_ledger", False, run=key, account=acc, problem="exposure line without traced receipt")
            continue
        # Documented rule (investigation.py): every traced receipt is covered; receipts are grouped into non-overlapping
        # windows, each opening at the earliest receipt not yet covered and lasting onward_window_hours; the balance
        # rule runs per window and the results add up. Recomputed here independently from SQL rows.
        order = sorted(rid, key=lambda t: (L.tx(t)["ts"], t))
        groups: list[list[str]] = []
        for t in order:
            if groups and L.tx(t)["ts"] <= L.tx(groups[-1][0])["ts"] + W:
                groups[-1].append(t)
            else:
                groups.append([t])
        received = outgoing = f_min = f_max = 0.0
        lowest = None
        for g in groups:
            first, gid = L.tx(g[0])["ts"], set(g)
            traced = w_received = w_outgoing = 0.0
            for t in L.account_rows(acc, first, first + W):
                is_dest = t["destination_account_id"] == acc
                bal = t["dest_balance_after"] if is_dest else t["origin_balance_after"]
                if t["transaction_id"] in gid:
                    traced += t["amount"]
                    w_received += t["amount"]
                if not is_dest:
                    w_outgoing += t["amount"]
                traced = min(traced, bal)
                lowest = bal if lowest is None else min(lowest, bal)
            w_max = min(w_received, w_outgoing)
            f_max += w_max
            f_min += min(max(0.0, w_received - traced), w_max)
            received += w_received
            outgoing += w_outgoing
        want = {"traced_in_amount": round(received, 2), "outgoing_in_window": round(outgoing, 2),
                "forwarded_min": round(f_min, 2), "forwarded_max": round(f_max, 2),
                "lowest_balance_in_window": round(lowest, 2) if lowest is not None else None}
        diff = {k: (x[k], v) for k, v in want.items() if (v is None) != (x[k] is None) or (v is not None and abs(x[k] - v) > TOL)}
        C.check("a8_exposure_recomputed_from_ledger", not diff, run=key, account=acc, differences=diff)

    # ---------------- (a10/a11) totals
    ex = inv["exposure"]
    down_sum = round(sum(L.tx(t)["amount"] for t, e in E.items() if e["direction"] == "downstream"), 2)
    seeds_d, seeds_u = tr["downstream_seed_transaction_ids"], tr["upstream_seed_transaction_ids"]
    seed_sum = round(sum(L.tx(t)["amount"] for t in seeds_d), 2)
    probs = []
    if abs(ex["observed_downstream_total"] - down_sum) > TOL:
        probs.append(f"observed_downstream_total {ex['observed_downstream_total']} != {down_sum}")
    if abs(ex["traced_outgoing_total"] - seed_sum) > TOL:
        probs.append(f"traced_outgoing_total {ex['traced_outgoing_total']} != {seed_sum}")
    if ex["flagged_outgoing_total"] > 0 and abs(ex["flagged_outgoing_total"] - seed_sum) > TOL:
        probs.append(f"flagged_outgoing_total {ex['flagged_outgoing_total']} != downstream seeds {seed_sum}")
    branch_sum = sum(sum(b["amounts"]) for b in branches if b["direction"] == "downstream")
    for name in ("observed_downstream_total", "traced_outgoing_total", "flagged_outgoing_total"):
        if abs(branch_sum - down_sum) > TOL and abs(ex[name] - branch_sum) < TOL:
            probs.append(f"{name} equals the double-counted sum over branches")
    if not (ft["transactions"] == len(E) == len(covered)):
        probs.append(f"fund_trace.transactions {ft['transactions']} vs edges {len(E)} vs branch union {len(covered)}")
    if ft["accounts"] != len(tr["nodes"]):
        probs.append(f"fund_trace.accounts {ft['accounts']} != nodes {len(tr['nodes'])}")
    if tr["cycles_detected"] != sum(1 for e in edges if e["is_cycle"]):
        probs.append("cycles_detected != loop-closing edges")
    C.check("a10_totals_equal_edge_sums", not probs, run=key, problems=probs)
    miss_d = [t for t in seeds_d if t not in E]
    miss_u = [t for t in seeds_u if t not in E]
    C.check("a11_seeds_are_traced", not miss_d and not miss_u, run=key, untraced_downstream_seeds=miss_d,
            untraced_upstream_seeds=miss_u, untraced_amount=round(sum(L.tx(t)["amount"] for t in miss_d + miss_u), 2),
            accounts_in_trace=ft["accounts"], max_nodes=N,
            node_limit_note=next((n for n in ft["truncation_notes"] if n.startswith("The account limit")), None))

    # ---------------- (c3) in_cycle accounts lie on a real loop of traced transfers
    adj = defaultdict(set)
    for e in edges:
        adj[e["origin_account_id"]].add(e["destination_account_id"])
    scc = _sccs(set(adj) | {d for v in adj.values() for d in v}, adj)
    in_cycle = sorted(a["account_id"] for a in out["role_assessments"] if a["graph_relationship"]["in_cycle"])
    for a in in_cycle:
        C.check("c3_in_cycle_accounts_on_real_loop", scc.get(a, 1) >= LOOP_MIN_ACCOUNTS, run=key, account=a,
                component_size=scc.get(a, 1))

    # ---------------- (d1/d2)
    hops = [e["hop"] for e in edges] + [n["hop_distance"] for n in tr["nodes"]]
    C.check("d1_hop_within_max_depth", max(hops, default=0) <= D and ft["max_depth_reached"] <= D, run=key,
            max_hop=max(hops, default=0), max_depth=D)
    C.check("d2_nodes_within_max_nodes", ft["accounts"] <= N and len(tr["nodes"]) <= N, run=key, accounts=ft["accounts"], max_nodes=N)

    # ---------------- (c4) planted loops
    loop_rows = []
    for lp in loops:
        if root not in set(lp["members"]) | {lp["victim"]}:
            continue
        lt_ids = lp["loop_transfers"]
        present = [t for t in lt_ids if t in E]
        closing = [t for t in present if E[t]["is_cycle"]]
        cross_close = [b["branch_id"] for b in branches if b["ending"]["reason"] == "joins_opposite_direction_trace"
                       and b["transaction_ids"][-1] in lt_ids and "loop" in b["ending"]["detail"]]
        flags = {a["account_id"]: a["graph_relationship"]["in_cycle"] for a in out["role_assessments"]}
        members_flagged = {m: flags.get(m) for m in lp["members"]}
        # Independent expectation, from the ledger and the engine's own seeds (not its trace):
        if root == lp["victim"]:
            seeded = lp["entry_transfer"] in seeds_d
            need = 1 + len(lt_ids)  # entry + every loop transfer (the last one closes the loop)
        else:
            out_t = next((t for t in lt_ids if L.tx(t)["origin_account_id"] == root), None)
            seeded = out_t in seeds_d
            need = len(lt_ids)      # root's own loop transfer is hop 1; the transfer back into root is hop len(loop)
        # every consecutive pair of loop transfers is within the onward window (else it is not one traceable loop)
        chain = ([lp["entry_transfer"]] if root == lp["victim"] else []) + lt_ids
        timely = all(L.tx(a)["ts"] <= L.tx(b)["ts"] <= L.tx(a)["ts"] + W for a, b in zip(chain, chain[1:]))
        expected = bool(seeded and timely and D >= need and N >= 200)
        detected = bool((closing or cross_close) and len(present) == len(lt_ids))
        all_flag = all(members_flagged.values())
        row = {"scenario_id": lp["scenario_id"], "root": root, "root_role": "victim" if root == lp["victim"] else "loop_member",
               "max_depth": D, "max_nodes": N, "seeded": seeded, "loop_closes_at_hop": need, "within_depth": D >= need,
               "expected_detected": expected, "loop_transfers_traced": f"{len(present)}/{len(lt_ids)}",
               "closing_transfers": closing, "cross_side_closures": cross_close, "detected": detected,
               "members_in_cycle": members_flagged}
        loop_rows.append(row)
        if expected:
            C.check("c4_circular_loops_detected", detected and all_flag, run=key, scenario_id=lp["scenario_id"],
                    loop_transfers_traced=row["loop_transfers_traced"], closing=closing, members_in_cycle=members_flagged)
        elif detected:  # detected without being required: the members must still all carry in_cycle
            C.check("c4_circular_loops_detected", all_flag, run=key, scenario_id=lp["scenario_id"],
                    note="loop traced at lower depth than the single-direction bound", members_in_cycle=members_flagged)

    sig = {e["transaction_id"]: (e["hop"], e["direction"], e["parent_transaction_id"], e["is_cycle"], e["converges"]) for e in edges}
    return {"key": key, "edges": sig, "digest": out["investigation_digest"],
            "fund_trace": hashlib.sha256(json.dumps(ft, sort_keys=True, default=str).encode()).hexdigest()[:16],
            "loops": loop_rows, "in_cycle": in_cycle, "accounts": ft["accounts"], "endings": Counter(b["ending"]["reason"] for b in branches)}


# --------------------------------------------------------------------------------------------------------- driver
def verify(cases: dict[str, list[str]], grid_subset: list[str], det_subset: list[str], depths=DEPTHS,
           node_limits=NODE_LIMITS, progress: bool = True) -> dict:
    L = Ledger()
    C = Checks(CHECKS)
    loops = circular_loops()
    reg = make_registry()
    accounts = sorted(set().union(*cases.values()))
    plan = [(a, d, 200) for a in accounts for d in depths]
    plan += [(a, d, n) for a in grid_subset for n in node_limits if n != 200 for d in depths]
    res: dict[tuple, dict] = {}
    seconds = []
    endings = Counter()
    errors = []
    t_all = time.perf_counter()
    for i, (a, d, n) in enumerate(plan):
        t0 = time.perf_counter()
        try:
            out = run_engine(reg, a, d, n)
        except Exception as exc:  # an engine error is a finding, not a crash of the verifier
            errors.append({"run": f"{a}@d{d}n{n}", "error": repr(exc)})
            continue
        seconds.append(time.perf_counter() - t0)
        res[(a, d, n)] = verify_run(out, L, C, loops)
        endings.update(res[(a, d, n)]["endings"])
        if progress and (i + 1) % 100 == 0:
            print(f"{i + 1}/{len(plan)} runs, {time.perf_counter() - t_all:.0f}s", flush=True)

    # (d3) depth monotonicity
    for a in accounts:
        for n in node_limits:
            for d in depths[:-1]:
                lo, hi = res.get((a, d, n)), res.get((a, d + 1, n))
                if lo is None or hi is None:
                    continue
                gone = sorted(t for t in lo["edges"] if t not in hi["edges"])
                changed = sorted(t for t in lo["edges"] if t in hi["edges"] and lo["edges"][t] != hi["edges"][t])
                C.check("d3_depth_monotonic", not gone and not changed, run=f"{a}@n{n} d{d}->d{d + 1}", removed=gone,
                        changed={t: (lo["edges"][t], hi["edges"][t]) for t in changed})
    # node-limit monotonicity (informational: not a documented guarantee)
    node_mono = []
    for a in grid_subset:
        for d in depths:
            for n1, n2 in zip(node_limits, node_limits[1:]):
                lo, hi = res.get((a, d, n1)), res.get((a, d, n2))
                if lo and hi:
                    gone = sorted(t for t in lo["edges"] if t not in hi["edges"])
                    if gone:
                        node_mono.append({"run": f"{a}@d{d} n{n1}->n{n2}", "removed": gone})
    # (d4) determinism
    for a in det_subset:
        for d, n in ((3, 200), (6, 50), (2, 10)):
            first = res.get((a, d, n))
            if first is None:
                continue
            again = verify_run(run_engine(reg, a, d, n), Ledger(), Checks(CHECKS), loops)
            C.check("d4_deterministic", again["digest"] == first["digest"] and again["fund_trace"] == first["fund_trace"]
                    and again["edges"] == first["edges"], run=f"{a}@d{d}n{n}", digest=(first["digest"], again["digest"]))

    loop_rows = [r for v in res.values() for r in v["loops"]]
    circ_members = {m for lp in loops for m in lp["members"]}
    in_cycle_outside = sorted({(a, k) for k, v in res.items() for a in v["in_cycle"] if a not in circ_members})
    return {
        "checks": C.summary(), "errors": errors, "runs": len(res), "plan": len(plan),
        "seconds_per_run": {"median": round(float(np.median(seconds)), 3) if seconds else None,
                            "p95": round(float(np.quantile(seconds, 0.95)), 3) if seconds else None},
        "ending_reason_counts": dict(endings),
        "circular_loops": loops, "circular_loop_runs": loop_rows,
        "in_cycle_accounts_outside_planted_loops": {
            "distinct_accounts": len({a for a, _ in in_cycle_outside}),
            "account_runs": [{"account_id": a, "run": f"{k[0]}@d{k[1]}n{k[2]}"} for a, k in in_cycle_outside],
        },
        "node_limit_monotonicity_informational": {"violations": len(node_mono), "examples": node_mono},
    }


def main(quick: bool = False) -> dict:
    cases = select_cases()
    accounts = sorted(set().union(*cases.values()))
    # Deterministic subsets: every circular member, every 5th remaining account (sorted), every look-alike hub.
    rest = [a for a in accounts if a not in set(cases["circular_members"])]
    grid_subset = sorted(set(cases["circular_members"]) | set(rest[::5]) | set(cases["lookalike_hubs"]))
    det_subset = sorted(set(cases["circular_members"][:6]) | set(rest[::15]))
    if quick:
        cases = {k: v[:2] for k, v in cases.items()}
        grid_subset, det_subset = grid_subset[:2], det_subset[:1]
    t0 = time.perf_counter()
    r = verify(cases, grid_subset, det_subset)
    checks = r["checks"]
    report = {
        "purpose": "Independent verification of fund tracing (amount reconciliation, branch endings, cycles, depth/node "
                   "limits) against direct SQL on the served synthetic ledger. Synthetic data only; no accuracy claims.",
        "database": str(DB_FILE.relative_to(ROOT)),
        "generated_by": "ml/forensics/verify_tracing.py",
        "engine_called_as": "DynamicInvestigation.compute(DatasetRegistry, None, DynamicInvestigationRequest(dataset_id="
                            "'forensic-scenarios', max_depth=d, max_nodes=n))",
        "ground_truth_use": "data/v3_forensic/demo/{roles,scenarios,accounts,transactions}.csv read by this verifier only, "
                            "to select accounts and identify the planted loop transfers; never passed to the engine.",
        "cases": {k: len(v) for k, v in cases.items()}, "distinct_accounts": len(accounts),
        "grid": {"all_accounts": {"max_depth": list(DEPTHS), "max_nodes": [200]},
                 "subset": {"accounts": len(grid_subset), "max_depth": list(DEPTHS), "max_nodes": list(NODE_LIMITS)},
                 "determinism_subset": {"accounts": len(det_subset), "requests": ["d3/n200", "d6/n50", "d2/n10"]}},
        "engine_rules_verified_against": ENGINE_RULES,
        "result": {k: {"checked": v["checked"], "passed": v["passed"], "failed": v["failed"]} for k, v in checks.items()},
        "all_passed": all(v["failed"] == 0 for v in checks.values()) and not r["errors"],
        "defects": [{"check": k, "failed": v["failed"], "of": v["checked"],
                     "explanation": DEFECT_NOTES.get(k, "No explanation recorded; see the violations."),
                     "reproduction": {"call": "run_engine(make_registry(), account_id, max_depth, max_nodes) (run = "
                                              "'<account>@d<max_depth>n<max_nodes>')", "first_violation": v["violations"][0]}}
                    for k, v in checks.items() if v["failed"]],
        "seconds_total": round(time.perf_counter() - t0, 1),
        **r,
    }
    if not quick:
        REPORT.write_text(json.dumps(report, indent=1, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    rep = main(quick=a.quick)
    print(json.dumps({"runs": rep["runs"], "errors": rep["errors"][:5], "result": rep["result"],
                      "ending_reason_counts": rep["ending_reason_counts"], "seconds_total": rep["seconds_total"]}, indent=1))
