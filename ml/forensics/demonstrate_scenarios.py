"""End-to-end scenario demonstration of the dynamic investigation engine on the served forensic ledger.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.demonstrate_scenarios

Runs ten required scenarios against data/v3_forensic_scenarios.db (the "demo" forensic ledger, generator seed 303),
through the same path the API uses (DatasetRegistry + DynamicInvestigation.compute, via evaluate_investigations.run),
and through the HTTP API (FastAPI TestClient) for the unknown-account and insufficient-history cases so the status
codes are checked.

Ground truth (data/v3_forensic/demo/*.csv) is read here, by the evaluator, for two purposes only: to SELECT example
accounts deterministically (sorted, first qualifying; no hard-coded IDs) and to SCORE the engine's output afterwards.
It is never passed to the engine: the engine receives an account ID and a dataset ID, nothing else.

Writes ml/reports/scenario_demonstration.json and docs/SCENARIO_DEMONSTRATION.md. All data is synthetic; nothing here
measures real-world accuracy.
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import re
import sys
import tempfile
import time
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


def _isolate_case_database() -> None:
    """The app's case database (audit events, reviews) is created and seeded when the app is built. Point it at a
    throwaway file before anything imports it, so this demonstration never writes into backend/fraudshield.db."""
    if "app.db.session" in sys.modules:
        return
    fd, path = tempfile.mkstemp(prefix="fraudshield_demo_", suffix=".db")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    atexit.register(lambda: os.path.exists(path) and os.remove(path))


_isolate_case_database()

import pandas as pd  # noqa: E402

from ml.forensics.evaluate_investigations import FLAGGING_ROLES, build, run  # noqa: E402

LEDGER = "demo"
GT_DIR = ROOT / "data" / "v3_forensic" / LEDGER
TRAIN_DIR = ROOT / "data" / "v3_forensic" / "train"
DB_FILE = ROOT / "data" / "v3_forensic_scenarios.db"
REPORT = ROOT / "ml" / "reports" / "scenario_demonstration.json"
DOC = ROOT / "docs" / "SCENARIO_DEMONSTRATION.md"
ARTIFACTS = ROOT / "ml" / "artifacts" / "v3"
DEFAULT_MAX_DEPTH = 3  # DynamicInvestigationRequest default; used only to choose reachable examples from ground truth
ESTABLISHED_TXNS = 10
ID_RE = re.compile(r"FS-[0-9A-F]{8}")

VICTIM_STATUSES = {"potential_victim", "suspicious_activity_victim_status_unconfirmed"}
MAY_BE_VICTIM_ROLES = {"potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed"}
PROTECTED_TRUTH = {"victim", "secondary_victim", "innocent_counterparty", "ordinary", "merchant", "employer",
                   "lookalike_legitimate"}
STRONGEST_RESTRICTION = "consider_temporary_restriction_review"

# Scenario 6 criterion. The owner's requirement is that the system "distinguishes potential victim status from
# intermediary status". The first version of this check demanded the exact role name 'potential_secondary_victim'.
# It was changed AFTER observing the result: the engine now labels the first selected secondary victim
# 'suspicious_activity_victim_unconfirmed' (may_be_victim true), because its balance-based attribution cannot show
# that the traced money itself moved on, so neither "passed traced money on" (secondary victim) nor "intermediary" is
# supported. Owner decision (final review): a criterion changed after seeing its result must not turn a fail into a
# pass. The scenario's pass/fail therefore uses the ORIGINAL, pre-registered criterion (exact role). The revised
# criterion is reported only as a separate exploratory metric, and validated on the untouched hold-out ledger
# (ml/forensics/holdout_evaluation.py), never counted as a pass here.
S6_EXACT_ROLE = "potential_secondary_victim"
S6_VICTIM_CLASS_ROLES = {"potential_secondary_victim", "suspicious_activity_victim_unconfirmed"}
S6_CRITERION_CHANGE = {
    "old_criterion": "role_candidate == 'potential_secondary_victim' (exact role name)",
    "new_criterion": "role_candidate is victim-class (potential_secondary_victim, or suspicious_activity_victim_unconfirmed with "
                     "may_be_victim true) AND role_candidate is not potential_intermediary / potentially_suspicious_account",
    "changed_after_observing_result": True,
    "scored_criterion": "old_criterion (original, pre-registered)",
    "new_criterion_status": "exploratory only; not used for pass/fail",
}


def s6_change_reason(account: str, role: Optional[str], may_be_victim: bool) -> str:
    """Reason text for the criterion change, filled with the observed example (no account ID is hard-coded here)."""
    why = ("The owner's requirement is that the system distinguishes potential victim status from intermediary status, not that "
           "it uses one particular role name. The criterion was changed AFTER observing the result: ")
    if role == "suspicious_activity_victim_unconfirmed":
        why += (f"the engine now labels {account} as an unconfirmed victim (suspicious_activity_victim_unconfirmed, may_be_victim "
                f"{str(bool(may_be_victim)).lower()}) because its balance-based attribution cannot show that the traced money itself "
                "moved on, so the 'passed traced money on' part of the secondary-victim rule is not supported. ")
    else:
        why += f"the engine labelled {account} as {role} (may_be_victim {str(bool(may_be_victim)).lower()}). "
    return why + ("The scenario is scored with the ORIGINAL criterion; the revised one is an exploratory metric only, "
                  "validated separately on the untouched hold-out ledger.")


def s6_exact_role(role: Optional[str]) -> bool:
    """Old scenario-6 criterion: the exact role name."""
    return role == S6_EXACT_ROLE


def s6_victim_not_intermediary(role: Optional[str], may_be_victim: bool) -> bool:
    """New scenario-6 criterion: a victim-class role, never an intermediary/suspicious role."""
    if role is None or role in FLAGGING_ROLES:
        return False
    return role == "potential_secondary_victim" or (role == "suspicious_activity_victim_unconfirmed" and bool(may_be_victim))


# ---------------------------------------------------------------- ground truth (evaluator side only)
class GroundTruth:
    """Ground-truth tables. Used to choose examples and to score the output; never handed to the engine."""

    def __init__(self, gt_dir: Path = GT_DIR):
        self.roles = pd.read_csv(gt_dir / "roles.csv")
        self.mat = self.roles[self.roles.materialised].copy()
        self.scen = pd.read_csv(gt_dir / "scenarios.csv").set_index("scenario_id")
        self.accounts = pd.read_csv(gt_dir / "accounts.csv", usecols=["account_id", "ground_truth_label", "customer_type"])
        self.tx = pd.read_csv(gt_dir / "transactions.csv",
                              usecols=["transaction_id", "timestamp", "origin_account_id", "destination_account_id", "amount",
                                       "channel", "scenario_id", "scenario_tag"])
        self.n_tx = pd.concat([self.tx.origin_account_id, self.tx.destination_account_id]).value_counts()
        self.label = self.accounts.set_index("account_id")["ground_truth_label"]
        self.mat["pattern"] = self.mat.scenario_id.map(self.scen["pattern"])
        self.mat["variant"] = self.mat.scenario_id.map(self.scen["variant"])

    def members(self, sid: str) -> pd.DataFrame:
        return self.mat[self.mat.scenario_id == sid]

    def role_in(self, sid: Optional[str], acc: str) -> str:
        """Ground-truth role of ``acc`` relative to scenario ``sid``."""
        r = self.mat[self.mat.account_id == acc]
        if len(r):
            if sid is not None and (r.scenario_id == sid).any():
                return str(r[r.scenario_id == sid].role.iloc[0])
            return f"{r.role.iloc[0]} (other scenario {r.scenario_id.iloc[0]})"
        return str(self.label.get(acc, "not_in_accounts_csv"))

    def scenario_edges(self, sid: str) -> pd.DataFrame:
        return self.tx[self.tx.scenario_id == sid]

    def hops_from(self, sid: str, start: str) -> dict[str, int]:
        """Shortest hop distance from ``start`` along this scenario's own recorded transfers (ground truth)."""
        e = self.scenario_edges(sid)
        nxt: dict[str, set] = {}
        for o, d in zip(e.origin_account_id, e.destination_account_id):
            nxt.setdefault(o, set()).add(d)
        dist, q = {start: 0}, deque([start])
        while q:
            a = q.popleft()
            for b in sorted(nxt.get(a, ())):
                if b not in dist:
                    dist[b] = dist[a] + 1
                    q.append(b)
        return dist

    def first_victim(self, sid: str) -> Optional[str]:
        v = self.members(sid)
        v = sorted(v[v.role == "victim"].account_id)
        return v[0] if v else None


# ---------------------------------------------------------------- engine output helpers
def investigate(registry, account_id: str) -> tuple[dict, float]:
    t0 = time.perf_counter()
    out = run(registry, account_id)
    return out, round(time.perf_counter() - t0, 3)


def downstream(out: dict) -> list[dict]:
    return [b for b in out["fund_trace"]["branches"] if b["direction"] == "downstream"]


def max_hops(out: dict) -> int:
    return max((len(b["transaction_ids"]) for b in downstream(out)), default=0)


def trace_accounts(out: dict) -> set[str]:
    s = set()
    for b in out["fund_trace"]["branches"]:
        s.update(b["accounts"])
    s.update(a["account_id"] for a in out["role_assessments"])
    return s


def traced_txn_ids(out: dict) -> set[str]:
    s = {t for b in out["fund_trace"]["branches"] for t in b["transaction_ids"]}
    s.update(a["other_sender_transaction"]["transaction_id"] for a in out["role_assessments"] if a.get("other_sender_transaction"))
    return s


def role_of(out: dict, acc: str) -> Optional[dict]:
    return next((a for a in out["role_assessments"] if a["account_id"] == acc), None)


def model_status(out: dict, root: str) -> dict:
    mm = out["model_metadata"]
    r = role_of(out, root) or {}
    am = r.get("account_model", {})
    return {
        "transaction_model_available": mm["transaction_model"]["available"],
        "transaction_model_version": mm["transaction_model"].get("model_version"),
        "account_model_available": mm["account_model"]["available"],
        "account_model_version": mm["account_model"].get("model_version"),
        "models_used_as_evidence": out["model_validation"]["validated_for_this_dataset"],
        "investigated_account_model_status": am.get("status"),
        "investigated_account_calibrated_probability": am.get("calibrated_probability"),
        "investigated_account_above_threshold": am.get("above_threshold"),
        "transfers_scored": out["transaction_scoring"]["scored"],
        "transfers_flagged_by_model": out["transaction_scoring"]["flagged_by_model"],
        "accounts_where_account_model_abstained": out["data_coverage"]["accounts_with_insufficient_history"],
    }


def compact_branch(b: dict) -> dict:
    return {"branch_id": b["branch_id"], "direction": b["direction"], "hops": len(b["transaction_ids"]), "accounts": b["accounts"],
            "transaction_ids": b["transaction_ids"], "amounts": b["amounts"], "ending": b["ending"]["reason"]}


def compact_txn(d: dict) -> dict:
    return {k: d.get(k) for k in ("transaction_id", "timestamp", "sender_account_id", "receiver_account_id", "amount",
                                  "channel", "model_score", "calibrated_probability", "risk_category")} | {
        "rule_flags": [f["code"] for f in d.get("rule_flags", [])],
        "top_model_factors": [f["label"] for f in d.get("model_factors", [])[:3]]}


def connected(out: dict, gt: GroundTruth, sid: Optional[str], root: str) -> list[dict]:
    rows = []
    for a in out["role_assessments"]:
        if a["account_id"] == root:
            continue
        rows.append({"account_id": a["account_id"], "true_role": gt.role_in(sid, a["account_id"]),
                     "engine_role": a["role_candidate"], "restriction": a["restriction"]["state"],
                     "position": a["graph_relationship"]["position"], "hop": a["graph_relationship"]["hop"],
                     "evidence_strength": a["evidence_strength"], "headline": a["headline"],
                     "contradictory_evidence": a["contradictory_evidence"][:2], "uncertainty_reason": a["uncertainty_reason"],
                     **attribution_fields(a)})
    return rows


def attribution_fields(a: dict) -> dict:
    g = a["graph_relationship"]
    return {"evidence_categories": a["evidence_categories"], "received_traced": g["received_traced_amount"],
            "sent_traced": g["sent_traced_amount"], "forwarded_at_least": g["forwarded_at_least"],
            "forwarded_at_most": g["forwarded_at_most"]}


OUTFLOW_RATIO = 2.0


def attribution_conflict(r: dict) -> bool:
    """ONWARD (pass-through) evidence counted for an account whose traced onward transfers are at least twice the traced
    money it received, while the engine's own balance-based attribution cannot show any of that money moving on
    (lower bound 0): the onward transfers are then mostly the account's own funds, not a pass-through."""
    rec = r.get("received_traced") or 0
    return ("ONWARD" in (r.get("evidence_categories") or []) and rec > 0 and (r.get("sent_traced") or 0) >= OUTFLOW_RATIO * rec
            and r.get("forwarded_at_least") is not None and r["forwarded_at_least"] <= 0)


def safety_violations(rows: list[dict]) -> list[str]:
    out = []
    for r in rows:
        base = r["true_role"].split(" (")[0]
        if base in PROTECTED_TRUTH and r["restriction"] == STRONGEST_RESTRICTION:
            out.append(f"{r['account_id']} (true role {r['true_role']}) received '{STRONGEST_RESTRICTION}'.")
        if base == "innocent_counterparty" and r["engine_role"] in FLAGGING_ROLES:
            out.append(f"{r['account_id']} (innocent counterparty) was labelled {r['engine_role']}.")
        if base in ("victim", "secondary_victim") and r["engine_role"] in FLAGGING_ROLES:
            out.append(f"{r['account_id']} (true role {r['true_role']}) was labelled {r['engine_role']}.")
    return out


def false_flags(rows: list[dict]) -> list[str]:
    """Connected accounts that play no part in this scenario (ordinary, merchant, innocent, another scenario's account)
    but were given a scenario-like role. Reported as mislabels; restriction reviews on them are safety violations."""
    out = []
    for r in rows:
        other = "(other scenario" in r["true_role"]
        base = r["true_role"].split(" (")[0]
        if (base in PROTECTED_TRUTH - {"victim", "secondary_victim"} or other) and \
                r["engine_role"] in FLAGGING_ROLES | {"potential_victim", "potential_secondary_victim"}:
            out.append(f"Mislabel: {r['account_id']} (true {r['true_role']}) assessed {r['engine_role']} with restriction "
                       f"{r['restriction']}: {r['headline']}")
    return out


def missed_scenario_members(out: dict, gt: GroundTruth, sid: str, root: str) -> list[str]:
    """Scenario accounts (ground truth) the engine did not reach, or reached but described as having no role."""
    notes = []
    seen = trace_accounts(out)
    for _, m in gt.members(sid).sort_values("account_id").iterrows():
        a = m.account_id
        if a == root:
            continue
        if a not in seen:
            notes.append(f"{a} ({m.role}) was not reached by the trace.")
            continue
        r = role_of(out, a)
        if r and m.role in ("intermediary", "attacker_controlled") and r["role_candidate"] not in FLAGGING_ROLES:
            notes.append(f"{a} ({m.role}) was reached but assessed as {r['role_candidate']} ({r['headline']}).")
    return notes


def engine_summary(out: dict, root: str, seconds: float) -> dict:
    va = out["victim_assessment"]
    return {
        "investigation_seconds": seconds,
        "victim_assessment_status": va["status"], "victim_assessment_label": va["label"], "headline": va["headline"],
        "contradictory_evidence": va["contradictory_evidence"], "uncertainty_reason": va["uncertainty_reason"],
        "suspicious_transaction_count": len(out["suspicious_transactions"]),
        "suspicious_transactions": [compact_txn(d) for d in out["suspicious_transactions"]],
        "uncorroborated_rule_flags": len(out["uncorroborated_rule_flags"]),
        "branch_count": len(out["fund_trace"]["branches"]),
        "downstream_branch_count": len(downstream(out)),
        "max_hops": max_hops(out),
        "branch_endings": dict(Counter(b["ending"]["reason"] for b in out["fund_trace"]["branches"])),
        "branches": [compact_branch(b) for b in out["fund_trace"]["branches"]],
        "accounts_in_trace": out["fund_trace"]["accounts"],
        "affected_accounts": out["affected_accounts"],
        "investigated_account_restriction": out["restriction_recommendation"]["state"],
        "automatic_actions_taken": out["automatic_actions_taken"],
        "synthetic_data_notice": out["synthetic_data_notice"],
        "models": model_status(out, root),
    }


def verdict(checks: dict[str, bool]) -> str:
    return "pass" if all(checks.values()) else "fail"


def scenario_record(n: int, name: str, expected: str, selection: str, chosen: list[str], sid: Optional[str],
                    truth: str, engine: Optional[dict], conn: list[dict], checks: dict[str, bool], notes: list[str], **extra) -> dict:
    def truth_key(t: str) -> str:
        return ("other-scenario " + t.split(" (")[0]) if "(other scenario" in t else t
    roles_vs_truth = dict(Counter(f"{truth_key(c['true_role'])} -> {c['engine_role']}" for c in conn))
    restr = dict(Counter(c["restriction"] for c in conn))
    return {"scenario": n, "name": name, "expected_behaviour": expected, "selection_rule": selection, "chosen_accounts": chosen,
            "scenario_id": sid, "pattern": (None if sid is None else None), "ground_truth_role": truth, "engine": engine,
            "connected_accounts": conn, "connected_roles_vs_truth": roles_vs_truth, "connected_restriction_states": restr,
            "safety_violations": safety_violations(conn), "checks": checks, "outcome": verdict(checks),
            "uncertain_or_missed": notes + false_flags(conn), **extra}


# ---------------------------------------------------------------- selection (ground truth, deterministic)
def select_direct(gt: GroundTruth) -> tuple[str, str]:
    for sid in sorted(gt.mat[gt.mat.pattern == "direct"].scenario_id.unique()):
        v, m = gt.first_victim(sid), gt.members(sid)
        if v and (m.role == "attacker_controlled").any() and (gt.scenario_edges(sid).origin_account_id == v).any():
            return sid, v
    raise LookupError("no direct scenario with a materialised victim and attacker")


def gt_chain(gt: GroundTruth, sid: str) -> list[str]:
    m = gt.members(sid)
    hops = m[m.role_detail.fillna("").str.startswith("hop ")].copy()
    hops["k"] = hops.role_detail.str.slice(4).astype(int)
    chain = [gt.first_victim(sid)] + list(hops.sort_values("k").account_id)
    att = sorted(m[m.role == "attacker_controlled"].account_id)
    return chain + att[:1]


def select_multi_hop(gt: GroundTruth) -> tuple[str, str]:
    for sid in sorted(gt.mat[(gt.mat.pattern == "multi_hop") & (gt.mat.variant == "standard")].scenario_id.unique()):
        v = gt.first_victim(sid)
        if v and len(gt_chain(gt, sid)) >= 4:  # victim + >= 2 mules + destination all materialised
            return sid, v
    raise LookupError("no multi_hop scenario with a complete materialised chain")


def select_split(gt: GroundTruth) -> tuple[str, str, str, list[str]]:
    for sid in sorted(gt.mat[gt.mat.pattern == "split"].scenario_id.unique()):
        m = gt.members(sid)
        hub = m[m.role_detail == "receives and splits"].account_id
        legs = sorted(m[m.role_detail.fillna("").str.startswith("branch ")].account_id)
        v = gt.first_victim(sid)
        if v and len(hub) and len(legs) >= 2:
            return sid, v, hub.iloc[0], legs
    raise LookupError("no split scenario with a materialised hub and >= 2 branches")


def select_multi_victim(gt: GroundTruth) -> tuple[str, str, list[str]]:
    for sid in sorted(gt.mat[gt.mat.pattern == "multi_victim"].scenario_id.unique()):
        m = gt.members(sid)
        vs = sorted(m[m.role == "victim"].account_id)
        if len(vs) >= 2:
            return sid, vs[0], vs[1:]
    raise LookupError("no multi_victim scenario with >= 2 materialised victims")


def innocent_candidates(gt: GroundTruth) -> list[tuple[str, str, str, int]]:
    """(scenario, innocent account, victim to investigate, ground-truth hop distance) within the default trace depth."""
    out = []
    inn = gt.mat[gt.mat.role == "innocent_counterparty"].sort_values(["scenario_id", "account_id"])
    for sid, acc in zip(inn.scenario_id, inn.account_id):
        v = gt.first_victim(sid)
        if not v:
            continue
        d = gt.hops_from(sid, v).get(acc)
        if d is not None and d <= DEFAULT_MAX_DEPTH:
            out.append((sid, acc, v, d))
    return out


def secondary_candidates(gt: GroundTruth, drained: bool = True) -> list[tuple[str, str, str]]:
    """Materialised secondary victims. With ``drained`` (default) only those whose defining transfer - their own savings
    drained to the network (scenario_tag 'secondary_victim_drain') - exists in the ledger; with drained=False only those
    WITHOUT it. The generator marks a secondary victim materialised when it sent any scenario transfer, so one whose
    drain leg was skipped (unfundable) is labelled secondary_victim while the ledger shows a plain intermediary."""
    tx = gt.tx[gt.tx.scenario_tag == "secondary_victim_drain"]
    has = set(zip(tx.origin_account_id, tx.scenario_id))
    sv = gt.mat[gt.mat.role == "secondary_victim"].sort_values(["scenario_id", "account_id"])
    return [(sid, a, gt.first_victim(sid)) for sid, a in zip(sv.scenario_id, sv.account_id)
            if gt.first_victim(sid) and ((a, sid) in has) == drained]


def select_low_history(gt: GroundTruth, min_txns: int) -> str:
    low = gt.n_tx[(gt.n_tx >= 1) & (gt.n_tx < min_txns)]
    low = low[low.index.isin(set(gt.accounts.account_id))]
    if low.empty:
        raise LookupError("no account with 1..min_txns-1 transfers")
    return sorted(low.items(), key=lambda kv: (kv[1], kv[0]))[0][0]


def select_unknown_id(gt: GroundTruth) -> str:
    known = set(gt.accounts.account_id)
    i = 0
    while f"FS-{i:08X}" in known:
        i += 1
    return f"FS-{i:08X}"


def select_ordinary(gt: GroundTruth, n: int) -> list[str]:
    in_roles = set(gt.roles.account_id)
    a = gt.accounts[(gt.accounts.ground_truth_label == "ordinary") & ~gt.accounts.account_id.isin(in_roles)]
    a = a[a.account_id.map(gt.n_tx).fillna(0) >= ESTABLISHED_TXNS]
    return sorted(a.account_id)[:n]


def training_ids() -> set[str]:
    ids = set(pd.read_csv(TRAIN_DIR / "accounts.csv", usecols=["account_id"]).account_id)
    t = pd.read_csv(TRAIN_DIR / "transactions.csv", usecols=["origin_account_id", "destination_account_id"])
    return ids | set(t.origin_account_id) | set(t.destination_account_id)


def artifact_id_mentions() -> dict:
    hits, files = 0, 0
    for f in sorted(ARTIFACTS.rglob("*")):
        if f.is_file():
            files += 1
            hits += len(ID_RE.findall(f.read_bytes().decode("utf-8", "ignore")))
    return {"artifact_files_scanned": files, "account_id_strings_found": hits}


# ---------------------------------------------------------------- HTTP client (scenarios 7 and 8)
def http_client(db_file: Path = DB_FILE):
    """TestClient on the real app, with the forensic registry pointed at the served ledger. The case database is
    pointed at a throwaway file at import time (_isolate_case_database)."""
    from fastapi.testclient import TestClient

    from app.intelligence.datasets import DatasetRegistry, get_dataset_registry
    from app.main import create_app

    app = create_app()
    registry = DatasetRegistry(f"sqlite:///{db_file}")
    app.dependency_overrides[get_dataset_registry] = lambda: registry
    return TestClient(app)


# ---------------------------------------------------------------- the ten scenarios
def s1_direct(reg, gt: GroundTruth) -> dict:
    sid, v = select_direct(gt)
    att = sorted(gt.members(sid).query("role == 'attacker_controlled'").account_id)
    out, sec = investigate(reg, v)
    eng, conn = engine_summary(out, v, sec), connected(out, gt, sid, v)
    gt_sent = gt.scenario_edges(sid).query("origin_account_id == @v")
    sus = {d["transaction_id"] for d in out["suspicious_transactions"]}
    to_att = [d for d in out["suspicious_transactions"] if d["sender_account_id"] == v and d["receiver_account_id"] in att]
    checks = {
        "status_flags_suspicious_activity": eng["victim_assessment_status"] in VICTIM_STATUSES,
        "suspicious_transfer_to_destination_identified": bool(to_att),
        "destination_traced": bool(set(att) & trace_accounts(out)),
        "no_safety_violation": not safety_violations(conn),
    }
    notes = missed_scenario_members(out, gt, sid, v)
    missed = sorted(set(gt_sent.transaction_id) - sus)
    if missed:
        notes.append(f"Scenario transfer(s) from the victim not flagged as suspicious: {', '.join(missed)}.")
    if eng["victim_assessment_status"] != "potential_victim":
        notes.append(f"Victim status is {eng['victim_assessment_status']}, not potential_victim.")
    return scenario_record(1, "Direct victim -> attacker transfer",
                           "Victim's transfer to the attacker-controlled account is flagged and the destination is traced.",
                           "First direct scenario (sorted by scenario_id) with a materialised victim and attacker; its first victim.",
                           [v], sid, "victim", eng, conn, checks, notes, destination_accounts=att,
                           ground_truth_victim_transfers=gt_sent[["transaction_id", "destination_account_id", "amount"]].to_dict("records"),
                           victim_transfers_flagged=f"{len(set(gt_sent.transaction_id) & sus)}/{len(gt_sent)}")


def s2_multi_hop(reg, gt: GroundTruth) -> dict:
    sid, v = select_multi_hop(gt)
    chain = gt_chain(gt, sid)
    out, sec = investigate(reg, v)
    eng, conn = engine_summary(out, v, sec), connected(out, gt, sid, v)
    followed, best = 0, None
    for b in downstream(out):
        k = 0
        while k + 1 < len(b["accounts"]) and k + 1 < len(chain) and b["accounts"][k + 1] == chain[k + 1]:
            k += 1
        if k > followed:
            followed, best = k, b
    scored = {d["transaction_id"]: d for d in out["transaction_scores"]}
    explained = []
    if best:
        for i, tid in enumerate(best["transaction_ids"][:followed]):
            a = role_of(out, best["accounts"][i + 1])
            explained.append({"transaction_id": tid, "from": best["accounts"][i], "to": best["accounts"][i + 1],
                              "amount": best["amounts"][i], "model_score": scored.get(tid, {}).get("model_score"),
                              "calibrated_probability": scored.get(tid, {}).get("calibrated_probability"),
                              "receiver_engine_role": a["role_candidate"] if a else None,
                              "receiver_true_role": gt.role_in(sid, best["accounts"][i + 1]),
                              "receiver_headline": a["headline"] if a else None})
    checks = {
        "status_flags_suspicious_activity": eng["victim_assessment_status"] in VICTIM_STATUSES,
        "branch_with_at_least_2_hops": eng["max_hops"] >= 2,
        "ground_truth_chain_followed_at_least_2_hops": followed >= 2,
        "each_followed_movement_scored_and_explained": bool(explained) and all(
            e["model_score"] is not None and e["receiver_headline"] for e in explained),
        "no_safety_violation": not safety_violations(conn),
    }
    notes = missed_scenario_members(out, gt, sid, v)
    if followed < len(chain) - 1:
        notes.append(f"The trace followed {followed} of the {len(chain) - 1} ground-truth hops "
                     f"(request max_depth={DEFAULT_MAX_DEPTH}); the remainder is beyond the trace or diverged.")
    return scenario_record(2, "Multi-hop chain", "Victim -> intermediary -> ... -> destination followed for >= 2 hops, each movement explained.",
                           "First multi_hop:standard scenario (sorted) whose victim, >= 2 mules and destination are materialised; its victim.",
                           [v], sid, "victim", eng, conn, checks, notes, ground_truth_chain=chain,
                           ground_truth_hops_followed=followed, followed_branch=compact_branch(best) if best else None,
                           movements_explained=explained)


def s3_split(reg, gt: GroundTruth) -> dict:
    sid, v, hub, legs = select_split(gt)
    out, sec = investigate(reg, v)
    eng, conn = engine_summary(out, v, sec), connected(out, gt, sid, v)
    through = [b for b in downstream(out) if hub in b["accounts"][:-1]]
    nxt = sorted({b["accounts"][b["accounts"].index(hub) + 1] for b in through})
    merged = [b["branch_id"] for b in downstream(out) if len(set(b["accounts"]) & set(legs)) >= 2]
    checks = {
        "status_flags_suspicious_activity": eng["victim_assessment_status"] in VICTIM_STATUSES,
        "split_account_traced": hub in trace_accounts(out),
        "at_least_2_branches_from_split_account": len(nxt) >= 2,
        "parallel_branches_not_merged": not merged,
        "no_safety_violation": not safety_violations(conn),
    }
    notes = missed_scenario_members(out, gt, sid, v)
    missing_legs = sorted(set(legs) - set(nxt))
    if missing_legs:
        notes.append(f"Ground-truth split leg(s) not shown as a branch from {hub}: {', '.join(missing_legs)}.")
    return scenario_record(3, "Split transfer", "One account distributes to several destinations; each destination is a separate branch.",
                           "First split scenario (sorted) with a materialised splitting account and >= 2 legs; its victim.",
                           [v], sid, "victim", eng, conn, checks, notes, split_account=hub, split_account_true_role=gt.role_in(sid, hub),
                           split_account_engine_role=(role_of(out, hub) or {}).get("role_candidate"),
                           ground_truth_split_legs=legs, branches_from_split_account=len(through), distinct_next_accounts=nxt,
                           ground_truth_legs_shown=f"{len(set(legs) & set(nxt))}/{len(legs)}", merged_branches=merged)


def s4_multi_victim(reg, gt: GroundTruth) -> dict:
    sid, v, others = select_multi_victim(gt)
    out, sec = investigate(reg, v)
    eng, conn = engine_summary(out, v, sec), connected(out, gt, sid, v)
    found = {c["account_id"]: c["engine_role"] for c in conn if c["account_id"] in others}
    found_as_victim = sorted(a for a, r in found.items() if r in MAY_BE_VICTIM_ROLES)
    checks = {
        "status_flags_suspicious_activity": eng["victim_assessment_status"] in VICTIM_STATUSES,
        "more_than_one_connected_account_assessed_separately": len(conn) > 1,
        "other_affected_sender_found": bool(found_as_victim),
        "no_safety_violation": not safety_violations(conn),
    }
    notes = missed_scenario_members(out, gt, sid, v)
    for a in others:
        if a not in found:
            notes.append(f"Other victim {a} was not surfaced.")
        elif a not in found_as_victim:
            notes.append(f"Other victim {a} was surfaced but labelled {found[a]}.")
    sc = score_transfers(reg, v, list(gt.scenario_edges(sid).query("origin_account_id == @v").transaction_id))
    for tid, x in sc.items():
        if not x["above_threshold"]:
            notes.append(f"The victim's scenario transfer {tid} ({_m(x['amount'])} INR, {x['share_of_balance']:.0%} of its balance) "
                         f"scored calibrated {x['calibrated_probability']:.6f} against the transaction model's threshold "
                         f"{x['threshold']:.6f}: not flagged, so nothing seeded the trace.")
    rows = []
    for asid in sorted(gt.mat[gt.mat.pattern.isin(["multi_victim", "consolidation"])].scenario_id.unique()):
        vs = sorted(gt.members(asid).query("role == 'victim'").account_id)
        if len(vs) < 2:
            continue
        for a in vs:
            o, _ = investigate(reg, a)
            others_found = [c for c in vs if c != a and (role_of(o, c) or {}).get("role_candidate") in MAY_BE_VICTIM_ROLES]
            rows.append({"scenario_id": asid, "victim": a, "status": o["victim_assessment"]["status"],
                         "other_victims": len(vs) - 1, "other_victims_found": len(others_found)})
    agg = {"investigations": len(rows), "scenarios": len({r_["scenario_id"] for r_ in rows}),
           "detected": sum(r_["status"] in VICTIM_STATUSES for r_ in rows),
           "with_at_least_one_other_victim_found": sum(r_["other_victims_found"] > 0 for r_ in rows),
           "other_victims_found": sum(r_["other_victims_found"] for r_ in rows),
           "other_victims_total": sum(r_["other_victims"] for r_ in rows), "rows": rows}
    return scenario_record(4, "Multiple affected accounts", "Several victims pay one destination; other affected senders are found and assessed separately.",
                           "First multi_victim scenario (sorted) with >= 2 materialised victims; its first victim.",
                           [v], sid, "victim", eng, conn, checks, notes, other_ground_truth_victims=others,
                           other_victims_found_as_possible_victims=f"{len(found_as_victim)}/{len(others)}",
                           other_victims_engine_roles=found, aggregate=agg,
                           victim_transfer_scores=sc)


def _innocent_one(reg, gt, sid, inn, v, d) -> tuple[dict, dict]:
    out, sec = investigate(reg, v)
    r = role_of(out, inn)
    res = {"scenario_id": sid, "innocent_account": inn, "investigated_victim": v, "ground_truth_hops": d,
           "appeared": r is not None, "engine_role": r["role_candidate"] if r else None,
           "restriction": r["restriction"]["state"] if r else None,
           "labelled_intermediary_or_suspicious": bool(r and r["role_candidate"] in FLAGGING_ROLES),
           **(attribution_fields(r) if r else {}),
           "supporting_evidence": r["supporting_evidence"] if r and r["role_candidate"] in FLAGGING_ROLES else None,
           "contradictory_evidence": r["contradictory_evidence"] if r and r["role_candidate"] in FLAGGING_ROLES else None}
    return res, {"out": out, "sec": sec, "r": r}


def score_transfers(reg, account: str, txn_ids: list[str]) -> dict:
    """Diagnostic only (evaluator side): the transaction model's score for given transfers of ``account``, computed as
    engine step 3 does (the account's and its counterparties' histories, point-in-time features)."""
    from app.intelligence import ledger
    from app.intelligence import models as mdl
    from app.intelligence.features import transaction_features
    db = reg.open("forensic-scenarios")
    try:
        ds = reg.describe("forensic-scenarios", db)["source_kind"]
        h = ledger.account_history(db, [account], ds)
        L = ledger.account_history(db, {account} | ledger.counterparties(h, [account]), ds)
        idx = L.index[L.transaction_id.isin(txn_ids)]
        if not len(idx):
            return {}
        tm = mdl.load("transaction_model")
        sc = tm.score(transaction_features(L, idx))
        return {L.at[i, "transaction_id"]: {"amount": float(L.at[i, "amount"]),
                                            "share_of_balance": float(L.at[i, "amount"] / L.at[i, "sender_balance_before"])
                                            if L.at[i, "sender_balance_before"] else float("nan"),
                                            "calibrated_probability": float(sc.at[i, "calibrated_probability"]),
                                            "threshold": float(tm.threshold), "above_threshold": bool(sc.at[i, "above_threshold"])}
                for i in idx}
    finally:
        db.close()


def s5_innocent(reg, gt: GroundTruth, aggregate: bool = True) -> dict:
    cands = innocent_candidates(gt)
    if not cands:
        raise LookupError("no innocent counterparty within the default trace depth")
    sid, inn, v, d = cands[0]
    res, x = _innocent_one(reg, gt, sid, inn, v, d)
    out, r = x["out"], x["r"]
    eng, conn = engine_summary(out, v, x["sec"]), connected(out, gt, sid, v)
    checks = {
        "innocent_counterparty_appears": res["appeared"],
        "not_labelled_intermediary_or_suspicious": res["appeared"] and not res["labelled_intermediary_or_suspicious"],
        "no_restriction_review_on_innocent": res["appeared"] and res["restriction"] != STRONGEST_RESTRICTION,
        "no_safety_violation": not safety_violations(conn),
    }
    notes = []
    if r:
        notes.append(f"{inn} assessed as {r['role_candidate']}: {r['headline']}")
        if r["role_candidate"] == "unknown_role":
            notes.append("unknown_role is not an accusation, but it is less protective than 'no suspicious linkage observed'.")
    agg = None
    if aggregate:
        rows = [res] + [_innocent_one(reg, gt, *c)[0] for c in cands[1:]]
        agg = {"innocent_counterparties_within_default_depth": len(rows), "appeared": sum(r_["appeared"] for r_ in rows),
               "labelled_intermediary_or_suspicious": sum(r_["labelled_intermediary_or_suspicious"] for r_ in rows),
               "restriction_review_on_innocent": sum(r_["restriction"] == STRONGEST_RESTRICTION for r_ in rows),
               "engine_roles": dict(Counter(r_["engine_role"] or "not_in_trace" for r_ in rows)), "rows": rows}
        agg["n"] = agg["innocent_counterparties_within_default_depth"]
        bad = [r_ for r_ in rows if r_["labelled_intermediary_or_suspicious"]]
        for b in bad:
            notes.append(f"Across all innocent counterparties: {b['innocent_account']} ({b['scenario_id']}, investigating "
                         f"{b['investigated_victim']}) was labelled {b['engine_role']} with restriction {b['restriction']}. Evidence used: "
                         f"{' '.join(b['supporting_evidence'])} Contradictory: {' '.join(b['contradictory_evidence'])}")
        nap = [r_ for r_ in rows if not r_["appeared"]]
        if nap:
            notes.append(f"{len(nap)} of {len(rows)} innocent counterparties within depth {DEFAULT_MAX_DEPTH} did not appear in their victim's trace.")
    return scenario_record(5, "Innocent counterparty", "An innocent recipient of scam money appears in the investigation and is not labelled intermediary/suspicious.",
                           f"First innocent_counterparty (sorted by scenario_id, account_id) within {DEFAULT_MAX_DEPTH} ground-truth hops "
                           "of its scenario's first victim; that victim is investigated.",
                           [v, inn], sid, "innocent_counterparty (connected account); investigated account is the victim",
                           eng, conn, checks, notes, innocent_account=inn, innocent_ground_truth_hops=d,
                           innocent_assessment=None if not r else {"role": r["role_candidate"], "headline": r["headline"],
                                                                   "restriction": r["restriction"]["state"],
                                                                   "supporting_evidence": r["supporting_evidence"],
                                                                   "contradictory_evidence": r["contradictory_evidence"],
                                                                   "uncertainty_reason": r["uncertainty_reason"]},
                           all_innocent_counterparties=agg, aggregate=agg)


def s6_secondary(reg, gt: GroundTruth) -> dict:
    cands = secondary_candidates(gt)
    if not cands:
        raise LookupError("no materialised secondary victim")
    rows, first = [], None
    for sid, sv, v in cands:
        out, sec = investigate(reg, v)
        r = role_of(out, sv)
        rows.append({"scenario_id": sid, "secondary_victim": sv, "investigated_victim": v, "appeared": r is not None,
                     "engine_role": r["role_candidate"] if r else None, "restriction": r["restriction"]["state"] if r else None,
                     "may_be_victim": bool(r and r["may_be_victim"])})
        if first is None:
            first = (sid, sv, v, out, sec, r)
    sid, sv, v, out, sec, r = first
    own, own_sec = investigate(reg, sv)
    excluded = []
    for xsid, xsv, xv in secondary_candidates(gt, drained=False):
        xo, _ = investigate(reg, xv)
        xr = role_of(xo, xsv)
        excluded.append({"scenario_id": xsid, "secondary_victim": xsv, "investigated_victim": xv,
                         "engine_role": xr["role_candidate"] if xr else None, "restriction": xr["restriction"]["state"] if xr else None,
                         "reason": "Labelled secondary_victim (materialised) but its own-savings drain transfer is not in the ledger; "
                                   "its recorded behaviour is that of an intermediary. Ground-truth labelling defect in the generator."})
    eng, conn = engine_summary(out, v, sec), connected(out, gt, sid, v)
    exact = bool(r and s6_exact_role(r["role_candidate"]))
    distinguished = bool(r and s6_victim_not_intermediary(r["role_candidate"], r["may_be_victim"]))
    checks = {
        "secondary_victim_appears": r is not None,
        "labelled_potential_secondary_victim (original criterion)": exact,
        "not_given_restriction_review": bool(r) and r["restriction"]["state"] != STRONGEST_RESTRICTION,
        "no_safety_violation": not safety_violations(conn),
    }
    notes = []
    if r:
        notes.append(f"{sv} assessed as {r['role_candidate']} with restriction {r['restriction']['state']}: {r['headline']}")
    for x in rows:
        x["meets_old_exact_role_criterion"] = s6_exact_role(x["engine_role"])
        x["meets_new_victim_not_intermediary_criterion"] = s6_victim_not_intermediary(x["engine_role"], x["may_be_victim"])
    n_exact = sum(x["meets_old_exact_role_criterion"] for x in rows)
    n_dist = sum(x["meets_new_victim_not_intermediary_criterion"] for x in rows)
    notes.append(f"Criterion changed after observing the result (see criterion_change). Selected example {sv}: old exact-name "
                 f"criterion {'met' if exact else 'NOT met'}; new victim-class-and-not-intermediary criterion "
                 f"{'met' if distinguished else 'NOT met'}.")
    notes.append(f"Across all {len(rows)} secondary victims whose drain transfer exists: {n_exact} labelled potential_secondary_victim "
                 f"(old criterion); {n_dist} labelled victim-class and not intermediary (new criterion); "
                 f"roles {dict(Counter(str(x['engine_role']) for x in rows))}.")
    for x in rows:
        if x["engine_role"] in FLAGGING_ROLES:
            notes.append(f"{x['secondary_victim']} ({x['scenario_id']}) was labelled {x['engine_role']} "
                         f"(restriction {x['restriction']}): NOT distinguished from an intermediary.")
        elif x["meets_new_victim_not_intermediary_criterion"] and not x["meets_old_exact_role_criterion"]:
            notes.append(f"{x['secondary_victim']} ({x['scenario_id']}) was labelled {x['engine_role']} (may_be_victim="
                         f"{x['may_be_victim']}, restriction {x['restriction']}): a possible victim, not an intermediary, but not "
                         "the exact secondary-victim role.")
        elif not x["meets_new_victim_not_intermediary_criterion"]:
            notes.append(f"{x['secondary_victim']} ({x['scenario_id']}) was assessed {x['engine_role']} (restriction "
                         f"{x['restriction']}): not flagged as an intermediary, but not recognised as a possible victim either.")
    for x in excluded:
        notes.append(f"Excluded from selection: {x['secondary_victim']} ({x['scenario_id']}) - {x['reason']} The engine "
                     f"assessed it {x['engine_role']} with restriction {x['restriction']}.")
    return scenario_record(6, "Potential secondary victim", "A forwarding account whose own savings were also drained is told apart from an intermediary.",
                           "First materialised secondary_victim (sorted by scenario_id, account_id) whose own-savings drain transfer exists in the "
                           "ledger; its scenario's first victim is investigated, then the secondary victim itself.", [v, sv], sid, "secondary_victim (connected account)", eng, conn, checks, notes,
                           secondary_victim=sv,
                           secondary_victim_assessment=None if not r else {
                               "role": r["role_candidate"], "headline": r["headline"], "restriction": r["restriction"]["state"],
                               "may_be_victim": r["may_be_victim"], "supporting_evidence": r["supporting_evidence"],
                               "contradictory_evidence": r["contradictory_evidence"]},
                           secondary_victim_investigated_directly={"status": own["victim_assessment"]["status"],
                                                                   "headline": own["victim_assessment"]["headline"],
                                                                   "restriction": own["restriction_recommendation"]["state"],
                                                                   "suspicious_transactions": len(own["suspicious_transactions"]),
                                                                   "seconds": own_sec},
                           all_secondary_victims=rows, excluded_ground_truth_defects=excluded,
                           criterion_change={**S6_CRITERION_CHANGE,
                                             "reason": s6_change_reason(sv, r["role_candidate"] if r else None, bool(r and r["may_be_victim"])),
                                             "selected_example": sv,
                                             "selected_example_role": r["role_candidate"] if r else None,
                                             "selected_example_may_be_victim": bool(r and r["may_be_victim"]),
                                             "old_criterion_result": "pass" if exact else "fail",
                                             "new_criterion_result": "pass" if distinguished else "fail",
                                             "all_secondary_victims_old_criterion": f"{n_exact}/{len(rows)}",
                                             "all_secondary_victims_new_criterion": f"{n_dist}/{len(rows)}"},
                           aggregate={"n": len(rows), "distinguished": n_dist, "exact_role_potential_secondary_victim": n_exact,
                                      "labelled_intermediary_or_suspicious": sum(x["engine_role"] in FLAGGING_ROLES for x in rows),
                                      "restriction_review": sum(x["restriction"] == STRONGEST_RESTRICTION for x in rows)})


def s7_unknown(client, gt: GroundTruth) -> dict:
    acc = select_unknown_id(gt)
    r = client.post("/api/v2/dynamic-investigations", json={"account_id": acc, "dataset_id": "forensic-scenarios"})
    look = client.get(f"/api/v2/datasets/forensic-scenarios/accounts/{acc}")
    body = r.json()
    checks = {
        "http_404": r.status_code == 404,
        "error_code_account_not_found": body.get("error", {}).get("code") == "account_not_found",
        "no_report_invented": "victim_assessment" not in body and "role_assessments" not in body,
        "lookup_endpoint_404": look.status_code == 404,
    }
    return scenario_record(7, "Unknown account", "An ID not in the dataset returns account_not_found; nothing is invented.",
                           "Smallest FS-XXXXXXXX ID (counting up from FS-00000000) absent from the ledger's accounts.",
                           [acc], None, "not in dataset", None, [], checks, [],
                           http={"status_code": r.status_code, "body": body, "lookup_status_code": look.status_code})


def s8_low_history(client, gt: GroundTruth) -> dict:
    from app.intelligence.features import MIN_ACCOUNT_TRANSACTIONS
    acc = select_low_history(gt, MIN_ACCOUNT_TRANSACTIONS)
    look = client.get(f"/api/v2/datasets/forensic-scenarios/accounts/{acc}")
    r = client.post("/api/v2/dynamic-investigations", json={"account_id": acc, "dataset_id": "forensic-scenarios"})
    d = r.json()
    root = role_of(d, acc) if r.status_code == 200 else None
    am = (root or {}).get("account_model", {})
    checks = {
        "http_200": r.status_code == 200,
        "lookup_reports_history_insufficient": look.status_code == 200 and look.json().get("history_sufficient") is False,
        "status_insufficient_evidence": r.status_code == 200 and d["victim_assessment"]["status"] == "insufficient_evidence",
        "account_model_abstains": am.get("status") == "insufficient_history" and am.get("model_score") is None,
        "no_restriction_review": r.status_code == 200 and d["restriction_recommendation"]["state"] != STRONGEST_RESTRICTION,
    }
    eng = None
    if r.status_code == 200:
        eng = {"victim_assessment_status": d["victim_assessment"]["status"], "headline": d["victim_assessment"]["headline"],
               "uncertainty_reason": d["victim_assessment"]["uncertainty_reason"],
               "suspicious_transaction_count": len(d["suspicious_transactions"]), "branch_count": len(d["fund_trace"]["branches"]),
               "max_hops": max_hops(d), "investigated_account_restriction": d["restriction_recommendation"]["state"],
               "account_model_result": am, "transfers_scored_by_transaction_model": d["transaction_scoring"]["scored"],
               "account_summary": d["account_summary"]}
    notes = []
    if eng and eng["transfers_scored_by_transaction_model"]:
        notes.append(f"The transaction model still scored {eng['transfers_scored_by_transaction_model']} transfer(s) in the trace "
                     "(each transfer is scored on its own point-in-time context); only the account behaviour model abstains.")
    return scenario_record(8, "Insufficient history", "An account with fewer than the minimum transfers: the account model abstains, status insufficient_evidence.",
                           f"Account with the fewest (>= 1, < {MIN_ACCOUNT_TRANSACTIONS}) transfers in the ledger, ties broken by ID.",
                           [acc], None, gt.role_in(None, acc), eng, [], checks, notes,
                           transfers_on_record=int(gt.n_tx.get(acc, 0)), minimum_history=MIN_ACCOUNT_TRANSACTIONS,
                           http={"status_code": r.status_code, "lookup": look.json()})


def s9_unseen(gt: GroundTruth, investigated: dict[str, dict]) -> dict:
    """``investigated``: account ID -> {"account_model_status", "calibrated_probability", "transfers_scored"} from 1-6."""
    train = training_ids()
    ids = sorted(investigated)
    overlap = sorted(set(ids) & train)
    ledger_overlap = len(set(gt.accounts.account_id) & train)
    scored = {a: v for a, v in investigated.items() if v.get("account_model_status") == "scored" and v.get("transfers_scored", 0) > 0}
    arts = artifact_id_mentions()
    checks = {
        "zero_overlap_with_training_ids": not overlap,
        "zero_overlap_whole_demo_ledger_vs_training": ledger_overlap == 0,
        "every_investigated_account_scored_by_both_models": len(scored) == len(ids),
        "no_account_ids_in_model_artifacts": arts["account_id_strings_found"] == 0,
    }
    notes = [] if len(scored) == len(ids) else [f"Not scored: {sorted(set(ids) - set(scored))}."]
    return scenario_record(9, "Previously unseen account IDs", "Investigated IDs never occur in training data, yet receive model scores.",
                           "The investigated accounts of scenarios 1-6, compared with every account ID in data/v3_forensic/train "
                           "(accounts.csv and both transaction ID columns).", ids, None, "various", None, [], checks, notes,
                           training_ids_checked=len(train), demo_ledger_accounts=int(len(gt.accounts)),
                           overlap_investigated=overlap, overlap_whole_ledger=ledger_overlap, model_outputs=investigated,
                           artifact_scan=arts)


def s10_ordinary(reg, gt: GroundTruth, n: int) -> dict:
    accs = select_ordinary(gt, n)
    rows = []
    for a in accs:
        out, sec = investigate(reg, a)
        rows.append({"account_id": a, "transfers": int(gt.n_tx.get(a, 0)), "status": out["victim_assessment"]["status"],
                     "headline": out["victim_assessment"]["headline"], "suspicious_transactions": len(out["suspicious_transactions"]),
                     "uncorroborated_rule_flags": len(out["uncorroborated_rule_flags"]),
                     "restriction": out["restriction_recommendation"]["state"],
                     "flagged_connected_accounts": sorted(c["account_id"] for c in connected(out, gt, None, a) if c["engine_role"] in FLAGGING_ROLES),
                     "account_model": model_status(out, a)["investigated_account_model_status"],
                     "account_model_probability": model_status(out, a)["investigated_account_calibrated_probability"],
                     "seconds": sec})
    df = pd.DataFrame(rows)
    status = df.status.value_counts().to_dict()
    clean = float((df.status == "no_suspicious_activity_observed").mean())
    false_flags = df[df.status.isin(VICTIM_STATUSES)]
    checks = {
        "at_least_80pct_no_suspicious_activity": clean >= 0.8,
        "no_restriction_review_on_ordinary": not (df.restriction == STRONGEST_RESTRICTION).any(),
    }
    notes = [f"False flag: {r.account_id} -> {r.status} ({r.suspicious_transactions} suspicious transfer(s), restriction "
             f"{r.restriction}): {r.headline}" for r in false_flags.itertuples()]
    ins = df[df.status == "insufficient_evidence"]
    if len(ins):
        notes.append(f"{len(ins)} ordinary account(s) returned insufficient_evidence: {', '.join(ins.account_id)}.")
    fc = df[df.flagged_connected_accounts.map(len) > 0]
    if len(fc):
        notes.append(f"{len(fc)} ordinary investigation(s) labelled a connected account intermediary/suspicious: "
                     + "; ".join(f"{r.account_id}: {', '.join(r.flagged_connected_accounts)}" for r in fc.itertuples()))
    return scenario_record(10, "Normal legitimate accounts", "Ordinary accounts with enough history mostly show no suspicious activity; false flags reported.",
                           f"First {n} accounts (sorted by ID) labelled ordinary, in no scenario, with >= {ESTABLISHED_TXNS} transfers.",
                           accs, None, "ordinary", None, [], checks, notes,
                           n_accounts=len(df), status_counts=status, no_suspicious_activity_rate=round(clean, 4),
                           false_flag_count=int(len(false_flags)), false_flag_rate=round(len(false_flags) / len(df), 4) if len(df) else None,
                           restriction_counts=df.restriction.value_counts().to_dict(), per_account=rows)


# ---------------------------------------------------------------- report
def model_versions_of(record: dict) -> dict:
    m = (record.get("engine") or {}).get("models") or {}
    return {"transaction_model": m.get("transaction_model_version"), "account_model": m.get("account_model_version")}


def main(n_ordinary: int = 30, write: bool = True) -> dict:
    os.chdir(ROOT)
    t0 = time.perf_counter()
    db = build(LEDGER)
    from app.intelligence.datasets import DatasetRegistry
    from app.intelligence.engine import ENGINE_VERSION

    reg = DatasetRegistry(f"sqlite:///{ROOT / db}")
    gt = GroundTruth()
    client = http_client(ROOT / db)
    res = []
    for fn in (s1_direct, s2_multi_hop, s3_split, s4_multi_victim, s5_innocent, s6_secondary):
        res.append(fn(reg, gt))
        print(f"scenario {res[-1]['scenario']}: {res[-1]['outcome']}", flush=True)
    res.append(s7_unknown(client, gt))
    print(f"scenario 7: {res[-1]['outcome']}", flush=True)
    res.append(s8_low_history(client, gt))
    print(f"scenario 8: {res[-1]['outcome']}", flush=True)
    inv = {}
    for r in res[:6]:
        root = r["chosen_accounts"][0]
        m = r["engine"]["models"]
        inv[root] = {"scenario": r["scenario"], "account_model_status": m["investigated_account_model_status"],
                     "calibrated_probability": m["investigated_account_calibrated_probability"],
                     "transfers_scored": m["transfers_scored"]}
    res.append(s9_unseen(gt, inv))
    print(f"scenario 9: {res[-1]['outcome']}", flush=True)
    res.append(s10_ordinary(reg, gt, n_ordinary))
    print(f"scenario 10: {res[-1]['outcome']}", flush=True)
    for r in res:
        r["pattern"] = None if r["scenario_id"] is None else f"{gt.scen.at[r['scenario_id'], 'pattern']}:{gt.scen.at[r['scenario_id'], 'variant']}"
    findings = []
    for r in res:
        for c in r["connected_accounts"] + ((r.get("aggregate") or {}).get("rows") or []):
            acc = c.get("account_id") or c.get("innocent_account") or c.get("secondary_victim")
            role = c.get("engine_role")
            if role in FLAGGING_ROLES and attribution_conflict(c):
                f = {"scenario": r["scenario"], "account_id": acc, "true_role": c.get("true_role", "innocent_counterparty"),
                     "engine_role": role, "restriction": c.get("restriction"), "received_traced": c["received_traced"],
                     "sent_traced": c["sent_traced"], "forwarded_at_least": c["forwarded_at_least"],
                     "evidence_categories": c["evidence_categories"]}
                if f not in findings:
                    findings.append(f)
    report = {
        "title": "End-to-end scenario demonstration (synthetic data)",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ledger": LEDGER, "database": str(db), "generator_seed": 303, "engine_version": ENGINE_VERSION,
        "models": model_versions_of(res[0]),
        "notice": "All accounts and transfers are synthetic (forensic scenario generator). Ground truth was used only to choose "
                  "examples and to score the output; the engine never received it. Results describe behaviour on this synthetic "
                  "ledger and say nothing about real-world accuracy.",
        "summary": [{"scenario": r["scenario"], "name": r["name"], "accounts": r["chosen_accounts"][:3], "pattern": r["pattern"],
                     "outcome": r["outcome"], "failed_checks": [k for k, v in r["checks"].items() if not v],
                     "aggregate": aggregate_text(r)} for r in res],
        "passed": sum(r["outcome"] == "pass" for r in res), "total": len(res),
        "runtime_seconds": round(time.perf_counter() - t0, 1),
        "onward_attribution_conflicts": {
            "description": "Accounts labelled intermediary/suspicious on pass-through (ONWARD) evidence although their traced "
                           "onward transfers were at least twice the traced money they received and the engine's own "
                           "balance-based attribution lower bound is 0: the onward money was mostly the account's own.",
            "accounts": findings},
        "scenario_6_criterion_change": next(r["criterion_change"] for r in res if r["scenario"] == 6),
        "scenarios": res,
    }
    if write:
        REPORT.write_text(json.dumps(report, indent=2, default=str))
        DOC.write_text(render_markdown(report))
    return report


def aggregate_text(r: dict) -> str:
    a = r.get("aggregate")
    if not a:
        return ""
    if r["scenario"] == 4:
        return (f"{a['detected']}/{a['investigations']} victims detected; {a['with_at_least_one_other_victim_found']}/{a['investigations']} "
                f"surfaced >= 1 other victim ({a['other_victims_found']}/{a['other_victims_total']} other victims found)")
    if r["scenario"] == 5:
        return (f"{a['appeared']}/{a['n']} innocent counterparties appeared; {a['labelled_intermediary_or_suspicious']}/{a['n']} labelled "
                f"intermediary/suspicious; {a['restriction_review_on_innocent']}/{a['n']} given restriction review")
    if r["scenario"] == 6:
        return (f"{a['distinguished']}/{a['n']} labelled victim-class and not intermediary (new criterion); "
                f"{a['exact_role_potential_secondary_victim']}/{a['n']} labelled exactly potential secondary victim (old criterion); "
                f"{a['labelled_intermediary_or_suspicious']}/{a['n']} "
                f"labelled intermediary/suspicious; {a['restriction_review']}/{a['n']} given restriction review")
    return ""


def _m(x) -> str:
    return "n/a" if x is None else f"{x:,.2f}"


def render_markdown(rep: dict) -> str:  # noqa: C901 - straight-line report text
    S = {r["scenario"]: r for r in rep["scenarios"]}
    L = [
        "# Scenario demonstration (synthetic data)", "",
        f"Generated by `ml/forensics/demonstrate_scenarios.py` on {rep['generated_at']} against `{rep['database']}` "
        f"(forensic scenario ledger, generator seed {rep['generator_seed']}), engine `{rep['engine_version']}`, "
        f"transaction model `{rep['models']['transaction_model']}`, account model `{rep['models']['account_model']}`. "
        f"Machine-readable results: `ml/reports/scenario_demonstration.json`.", "",
        "**Every account and transfer below is synthetic.** Ground truth (`data/v3_forensic/demo/*.csv`) was used only to choose "
        "the example accounts (sorted, first qualifying, no hard-coded IDs) and to score the output afterwards. The engine received "
        "an account ID and a dataset ID only. Nothing here measures real-world accuracy, and no account was acted on: every "
        "restriction state is advisory.", "",
        "Reproduce: `PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.demonstrate_scenarios`", "",
        f"## Results: {rep['passed']} of {rep['total']} scenarios passed", "",
        "| # | Scenario | Account(s) | Engine outcome | Result (example) | All such accounts in the ledger |", "|---|---|---|---|---|---|",
    ]
    for r in rep["scenarios"]:
        e = r["engine"] or {}
        if r["scenario"] == 7:
            o = f"HTTP {r['http']['status_code']}, `{r['http']['body'].get('error', {}).get('code')}`"
        elif r["scenario"] == 9:
            o = f"{len(r['overlap_investigated'])} overlap with {r['training_ids_checked']:,} training IDs; {len(r['model_outputs'])}/{len(r['chosen_accounts'])} scored"
        elif r["scenario"] == 10:
            o = ", ".join(f"{k}: {v}" for k, v in r["status_counts"].items()) + f" (n={r['n_accounts']})"
        else:
            o = f"`{e.get('victim_assessment_status')}`, {e.get('suspicious_transaction_count')} suspicious, {e.get('branch_count')} branches, max {e.get('max_hops')} hops"
        accs = ", ".join(r["chosen_accounts"][:2]) + (f" (+{len(r['chosen_accounts']) - 2})" if len(r["chosen_accounts"]) > 2 else "")
        res = "PASS" if r["outcome"] == "pass" else "FAIL: " + ", ".join(k for k, v in r["checks"].items() if not v)
        L.append(f"| {r['scenario']} | {r['name']} | {accs} | {o} | {res} | {aggregate_text(r) or '-'} |")
    L += ["", "## Per-scenario narrative", ""]

    def roles_line(r):
        return "; ".join(f"{k} ×{v}" for k, v in sorted(r["connected_roles_vs_truth"].items())) or "none"

    s = S[1]
    e = s["engine"]
    t = next((x for x in e["suspicious_transactions"] if x["receiver_account_id"] in s["destination_accounts"]), None)
    L += [f"### 1. Direct victim -> attacker ({s['scenario_id']})", "",
          f"Investigated {s['chosen_accounts'][0]} (true role: victim). Status `{e['victim_assessment_status']}`: {e['headline']} "
          f"{e['suspicious_transaction_count']} suspicious transfer(s)"
          + (f"; the transfer to the attacker-controlled account {t['receiver_account_id']} was {t['transaction_id']} for "
             f"{_m(t['amount'])} INR on {t['timestamp']} (calibrated {t['calibrated_probability']}, factors: {'; '.join(t['top_model_factors'])})" if t else "")
          + f". Victim's scenario transfers flagged: {s['victim_transfers_flagged']}. Trace: {e['branch_count']} branches, "
          f"endings {e['branch_endings']}. Connected roles (true -> engine): {roles_line(s)}. Restriction on the victim: "
          f"`{e['investigated_account_restriction']}` (protective review, not a penalty).", ""]
    s = S[2]
    e = s["engine"]
    L += [f"### 2. Multi-hop chain ({s['scenario_id']})", "",
          f"Investigated {s['chosen_accounts'][0]}. Ground-truth chain: {' -> '.join(s['ground_truth_chain'])}. "
          f"Status `{e['victim_assessment_status']}`; the trace followed {s['ground_truth_hops_followed']} of "
          f"{len(s['ground_truth_chain']) - 1} ground-truth hops (max {e['max_hops']} hops in any branch). Movements:", ""]
    for m in s["movements_explained"]:
        L.append(f"- {m['transaction_id']}: {m['from']} -> {m['to']}, {_m(m['amount'])} INR, model score {m['model_score']} "
                 f"(calibrated {m['calibrated_probability']}); receiver true `{m['receiver_true_role']}`, engine `{m['receiver_engine_role']}`: {m['receiver_headline']}")
    L += ["", f"Connected roles (true -> engine): {roles_line(s)}.", ""]
    s = S[3]
    e = s["engine"]
    L += [f"### 3. Split transfer ({s['scenario_id']})", "",
          f"Investigated {s['chosen_accounts'][0]}. The splitting account {s['split_account']} (true `{s['split_account_true_role']}`, "
          f"engine `{s['split_account_engine_role']}`) appears in {s['branches_from_split_account']} branches leading to "
          f"{len(s['distinct_next_accounts'])} distinct next accounts ({', '.join(s['distinct_next_accounts'])}). Ground-truth legs shown: "
          f"{s['ground_truth_legs_shown']}. Branches merging two legs: {s['merged_branches'] or 'none'}. Status `{e['victim_assessment_status']}`, "
          f"{e['branch_count']} branches in total. Connected roles: {roles_line(s)}.", ""]
    s = S[4]
    e = s["engine"]
    L += [f"### 4. Multiple affected accounts ({s['scenario_id']})", "",
          f"Investigated {s['chosen_accounts'][0]}; the scenario's other victims are {', '.join(s['other_ground_truth_victims'])}. "
          f"Found as possible victims: {s['other_victims_found_as_possible_victims']} (engine roles {s['other_victims_engine_roles'] or 'none'}). "
          f"{len(s['connected_accounts'])} connected accounts were assessed separately. Engine's affected-account groups: "
          f"potential victims {e['affected_accounts']['potential_victims']}, intermediaries {e['affected_accounts']['potential_intermediaries']}, "
          f"suspicious {e['affected_accounts']['suspicious_accounts']}. Connected roles: {roles_line(s)}."
          + "".join(f" The victim's own scenario transfer {k} ({_m(x['amount'])} INR, {x['share_of_balance']:.0%} of its balance) scored "
                    f"calibrated {x['calibrated_probability']:.6f} against a threshold of {x['threshold']:.6f}"
                    + (", so it was flagged." if x["above_threshold"] else ", so it was not flagged and the trace had no seed.")
                    for k, x in s["victim_transfer_scores"].items())
          + f" Across every multi_victim and consolidation victim: {aggregate_text(s)}.", ""]
    s = S[5]
    ia = s["innocent_assessment"]
    agg = s["all_innocent_counterparties"]
    L += [f"### 5. Innocent counterparty ({s['scenario_id']})", "",
          f"Investigated victim {s['chosen_accounts'][0]}; the innocent counterparty {s['innocent_account']} is "
          f"{s['innocent_ground_truth_hops']} ground-truth hop(s) away. "
          + (f"Engine role `{ia['role']}`, restriction `{ia['restriction']}`: {ia['headline']} Contradictory evidence shown: "
             f"{' '.join(ia['contradictory_evidence']) or 'none'}" if ia else "It did not appear in the investigation.")
          + (f" Across all {agg['innocent_counterparties_within_default_depth']} innocent counterparties within {DEFAULT_MAX_DEPTH} hops of "
             f"their victim: {agg['appeared']} appeared, {agg['labelled_intermediary_or_suspicious']} labelled intermediary/suspicious, "
             f"{agg['restriction_review_on_innocent']} given restriction review; roles {agg['engine_roles']}." if agg else ""), ""]
    s = S[6]
    sa = s["secondary_victim_assessment"]
    di = s["secondary_victim_investigated_directly"]
    L += [f"### 6. Potential secondary victim ({s['scenario_id']})", "",
          f"Investigated victim {s['chosen_accounts'][0]}; secondary victim {s['secondary_victim']} "
          + (f"assessed `{sa['role']}`, restriction `{sa['restriction']}`, may_be_victim={sa['may_be_victim']}: {sa['headline'].rstrip('.')}" if sa else "did not appear")
          + f". Investigated directly, {s['secondary_victim']} gets status `{di['status']}` ({di['headline'].rstrip('.')}), restriction `{di['restriction']}`. "
          "All secondary victims whose drain transfer exists: " + "; ".join(f"{x['secondary_victim']} -> {x['engine_role']} ({x['restriction']})"
                                                                          for x in s["all_secondary_victims"]) + "."
          + "".join(f" Excluded as a ground-truth defect: {x['secondary_victim']} ({x['scenario_id']}) is labelled secondary_victim but no drain "
                    f"of its own savings exists in the ledger; the engine assessed it {x['engine_role']} ({x['restriction']})."
                    for x in s["excluded_ground_truth_defects"]), ""]
    cc = s["criterion_change"]
    L += [f"**Scored with the original criterion; the revised one is exploratory only.** Original criterion: {cc['old_criterion']} - result "
          f"**{cc['old_criterion_result']}** for {cc['selected_example']} ({cc['all_secondary_victims_old_criterion']} of all secondary "
          f"victims). Exploratory (revised after seeing the result, not scored): {cc['new_criterion']} - result **{cc['new_criterion_result']}** "
          f"({cc['all_secondary_victims_new_criterion']} of all secondary victims). Reason: {cc['reason']}", ""]
    s = S[7]
    L += ["### 7. Unknown account", "",
          f"`POST /api/v2/dynamic-investigations` with {s['chosen_accounts'][0]} returned HTTP {s['http']['status_code']} with "
          f"`{s['http']['body'].get('error', {}).get('code')}`: \"{s['http']['body'].get('error', {}).get('message')}\". The lookup endpoint "
          f"returned HTTP {s['http']['lookup_status_code']}. No report was produced.", ""]
    s = S[8]
    e = s["engine"] or {}
    L += ["### 8. Insufficient history", "",
          f"{s['chosen_accounts'][0]} (true label `{s['ground_truth_role']}`) has {s['transfers_on_record']} transfer(s) on record "
          f"(minimum {s['minimum_history']}). HTTP {s['http']['status_code']}; status `{e.get('victim_assessment_status')}` "
          f"({e.get('headline')}); account model `{(e.get('account_model_result') or {}).get('status')}` with no score; restriction "
          f"`{e.get('investigated_account_restriction')}`.", ""]
    s = S[9]
    L += ["### 9. Previously unseen account IDs", "",
          f"The {len(s['chosen_accounts'])} accounts investigated in scenarios 1-6 ({', '.join(s['chosen_accounts'])}) were compared with "
          f"{s['training_ids_checked']:,} account IDs in the training ledger: overlap {len(s['overlap_investigated'])}. Across the whole served "
          f"ledger ({s['demo_ledger_accounts']:,} accounts) the overlap is {s['overlap_whole_ledger']}. Every one received an account-model "
          "score and transfer scores: "
          + "; ".join(f"{a}: p={v['calibrated_probability']}, {v['transfers_scored']} transfers scored" for a, v in s["model_outputs"].items())
          + f". Model artifacts scanned for account-ID strings: {s['artifact_scan']['account_id_strings_found']} found in "
          f"{s['artifact_scan']['artifact_files_scanned']} files.", ""]
    s = S[10]
    L += ["### 10. Normal legitimate accounts", "",
          f"{s['n_accounts']} ordinary accounts: {s['status_counts']}. No-suspicious-activity rate {s['no_suspicious_activity_rate']:.0%}; "
          f"false flags {s['false_flag_count']} ({s['false_flag_rate']:.0%}). Restriction states: {s['restriction_counts']}.", ""]
    L += ["## Where the engine was uncertain or wrong", ""]
    conf = rep["onward_attribution_conflicts"]["accounts"]
    if conf:
        L += ["**Pass-through evidence from the account's own money.** " + rep["onward_attribution_conflicts"]["description"], ""]
        L += [f"- Scenario {f['scenario']}: {f['account_id']} (true {f['true_role']}) -> {f['engine_role']}, restriction "
              f"{f['restriction']}: received {_m(f['received_traced'])} traced, sent {_m(f['sent_traced'])}, attribution lower bound "
              f"{_m(f['forwarded_at_least'])}; evidence {f['evidence_categories']}." for f in conf]
        L.append("")
    any_note = False
    for r in rep["scenarios"]:
        notes = r["uncertain_or_missed"] + r["safety_violations"]
        if notes:
            any_note = True
            L.append(f"**{r['scenario']}. {r['name']}**")
            L += [f"- {n}" for n in notes]
            L.append("")
    if not any_note:
        L.append("No uncertainty or misses were recorded.")
    L += ["## Limits of this demonstration", "",
          "- One deterministic example per scenario (plus aggregates over every such account for 4, 5 and 6, and 30 accounts for 10); the broader rates are in "
          "`ml/reports/investigation_eval_demo.json` and `investigation_eval_cold.json`.",
          "- The ledger is synthetic and comes from the same generator family the models were trained on (a different seed and population). "
          "Behaviour on real bank data is unknown.",
          "- Pass/fail checks encode the owner's expected behaviour; a pass is not proof the engine is right in general.", ""]
    return "\n".join(L)


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--ordinary", type=int, default=30, help="number of ordinary accounts for scenario 10")
    a = ap.parse_args()
    rep = main(a.ordinary)
    print(json.dumps({"passed": rep["passed"], "total": rep["total"], "runtime_seconds": rep["runtime_seconds"],
                      "summary": rep["summary"], "scenario_6_criterion_change": rep["scenario_6_criterion_change"]}, indent=1))
