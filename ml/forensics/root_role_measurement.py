"""Investigated-account role by ground truth, with every scenario account used as the investigation root.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.root_role_measurement --ledger train --tag before

Why this exists. The investigation evaluations (evaluate_investigations.py, holdout_evaluation.py) start investigations
only from victims, look-alikes and ordinary accounts; the QA-03 measurement added a sample of intermediaries. An account
investigated directly is assessed by the investigated-account rules in roles.py, while the same account reached from
someone else's investigation is assessed by the connected-account rules. This measurement uses every materialised
scenario account (victims, secondary victims, intermediaries, attacker-controlled accounts, innocent counterparties,
look-alikes) as a root, plus a sample of ordinary accounts and of accounts with very little history, and compares the two
views of the same account.

Ground truth is read here, by the evaluator, only to choose roots and to score the engine's output; the engine never
sees it. Writes ml/reports/root_role_measurement_<ledger>[_<tag>].json.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

VICTIM_CLASS = {"potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed"}
SUSPICION_CLASS = {"potential_intermediary", "potentially_suspicious_account"}
NONE_CLASS = {"no_suspicious_linkage_observed", "no_suspicious_activity_observed", "cash_withdrawal_point"}
SCENARIO_ROLES = ("victim", "secondary_victim", "intermediary", "attacker_controlled", "innocent_counterparty",
                  "lookalike_legitimate")
_REGISTRY = None


def group(role: str | None) -> str:
    if role in VICTIM_CLASS:
        return "victim_class"
    if role in SUSPICION_CLASS:
        return "suspicion_class"
    if role in NONE_CLASS:
        return "no_linkage"
    return "abstain" if role == "unknown_role" else "missing"


def _init(db: str) -> None:
    global _REGISTRY
    from backend.app.intelligence.datasets import DatasetRegistry
    _REGISTRY = DatasetRegistry(f"sqlite:///{db}")


def _investigate(account_id: str) -> dict:
    from ml.forensics.evaluate_investigations import run
    t0 = time.perf_counter()
    try:
        out = run(_REGISTRY, account_id)
    except Exception as exc:  # noqa: BLE001 - recorded, never hidden
        return {"account_id": account_id, "error": f"{type(exc).__name__}: {exc}"}
    from backend.app.intelligence import roles
    root = next(a for a in out["role_assessments"] if a["account_id"] == account_id)
    return {
        "account_id": account_id, "seconds": round(time.perf_counter() - t0, 3),
        "role": root["role_candidate"], "victim_status": out["victim_assessment"]["status"],
        "categories": root["evidence_categories"], "kinds": sorted(roles.independent_kinds(root["evidence_categories"])),
        "restriction": root["restriction"]["state"], "may_be_victim": root["may_be_victim"],
        "connected": [(a["account_id"], a["role_candidate"], a["restriction"]["state"], a["graph_relationship"]["position"])
                      for a in out["role_assessments"] if a["account_id"] != account_id],
    }


def main(ledger: str, tag: str, ordinary: int, low: int, workers: int) -> dict:
    from ml.forensics.evaluate_investigations import build
    db = build(ledger)
    gt = pd.read_csv(f"data/v3_forensic/{ledger}/roles.csv")
    gt = gt[gt.materialised]
    accounts = pd.read_csv(f"data/v3_forensic/{ledger}/accounts.csv")
    tx = pd.read_csv(f"data/v3_forensic/{ledger}/transactions.csv", usecols=["origin_account_id", "destination_account_id"])
    n_tx = pd.concat([tx.origin_account_id, tx.destination_account_id]).value_counts()
    truth = gt.groupby("account_id")["role"].agg(lambda r: "+".join(sorted(set(r)))).to_dict()
    scen_of = gt.groupby("account_id")["scenario_id"].agg(lambda s: sorted(set(s))).to_dict()

    roots: dict[str, str] = {a: truth[a] for a in sorted(gt[gt.role.isin(SCENARIO_ROLES)].account_id.unique())}
    rng = np.random.default_rng(7)
    pool = accounts[(accounts.ground_truth_label == "ordinary") & accounts.account_id.map(n_tx).fillna(0).ge(5)]
    for a in rng.choice(pool.account_id.to_numpy(), min(ordinary, len(pool)), replace=False):
        roots.setdefault(a, "ordinary_sample")
    thin = accounts[accounts.account_id.map(n_tx).fillna(0).between(1, 4) & ~accounts.account_id.isin(roots)]
    for a in rng.choice(thin.account_id.to_numpy(), min(low, len(thin)), replace=False):
        roots.setdefault(a, "low_history_sample")

    t0 = time.perf_counter()
    results = []
    with ProcessPoolExecutor(max_workers=workers, initializer=_init, initargs=(str(db),)) as ex:
        for i, r in enumerate(ex.map(_investigate, list(roots), chunksize=4), 1):
            results.append(r)
            if i % 100 == 0:
                print(f"{i}/{len(roots)} {time.perf_counter() - t0:.0f}s", flush=True)

    errors = [r for r in results if "error" in r]
    ok = [r for r in results if "error" not in r]
    root_table: dict[str, Counter] = defaultdict(Counter)
    root_restriction: dict[str, Counter] = defaultdict(Counter)
    for r in ok:
        root_table[roots[r["account_id"]]][r["role"]] += 1
        root_restriction[roots[r["account_id"]]][r["restriction"]] += 1

    # Connected view: the same account reached from investigations of ITS OWN scenario's other accounts.
    conn_roles: dict[str, list[str]] = defaultdict(list)
    conn_table: dict[str, Counter] = defaultdict(Counter)
    conn_restriction: dict[str, Counter] = defaultdict(Counter)
    for r in ok:
        root_scen = set(scen_of.get(r["account_id"], []))
        for acc, role, state, _pos in r["connected"]:
            t = truth.get(acc)
            same = bool(root_scen & set(scen_of.get(acc, [])))
            key = t if (t is not None and same) else ("role_in_other_scenario" if t is not None else (
                "cash_network" if role == "cash_withdrawal_point" else "no_scenario_role"))
            conn_table[key][role] += 1
            conn_restriction[key][state] += 1
            if t is not None and same:
                conn_roles[acc].append(role)

    by_id = {r["account_id"]: r for r in ok}
    consistency = Counter()
    disagreements = []
    for acc, rs in conn_roles.items():
        if acc not in by_id:
            continue
        root_g = group(by_id[acc]["role"])
        conn_g = Counter(group(x) for x in rs).most_common(1)[0][0]
        consistency[f"{truth[acc]}: root {root_g} / connected {conn_g}"] += 1
        if root_g != conn_g and {root_g, conn_g} == {"victim_class", "suspicion_class"}:
            disagreements.append({"account_id": acc, "truth": truth[acc], "root_role": by_id[acc]["role"],
                                  "connected_roles": dict(Counter(rs))})

    def count(table, keys, roles_):
        return int(sum(table[k][x] for k in keys for x in roles_))

    summary = {
        "ledger": ledger, "tag": tag, "roots": len(roots), "errors": len(errors),
        "runtime_seconds": round(time.perf_counter() - t0, 1),
        "root_role_by_truth": {k: dict(v.most_common()) for k, v in sorted(root_table.items())},
        "root_restriction_by_truth": {k: dict(v.most_common()) for k, v in sorted(root_restriction.items())},
        "connected_role_by_truth": {k: dict(v.most_common()) for k, v in sorted(conn_table.items())},
        "connected_restriction_by_truth": {k: dict(v.most_common()) for k, v in sorted(conn_restriction.items())},
        "key_rates": {
            "victim_roots_victim_class": _rate(root_table, ["victim"], VICTIM_CLASS),
            "victim_roots_suspicion_class": _rate(root_table, ["victim"], SUSPICION_CLASS),
            "intermediary_roots_victim_class": _rate(root_table, ["intermediary"], VICTIM_CLASS),
            "intermediary_roots_suspicion_class": _rate(root_table, ["intermediary"], SUSPICION_CLASS),
            "attacker_roots_victim_class": _rate(root_table, ["attacker_controlled"], VICTIM_CLASS),
            "attacker_roots_suspicion_class": _rate(root_table, ["attacker_controlled"], SUSPICION_CLASS),
            "secondary_victim_roots_suspicion_class": _rate(root_table, ["secondary_victim"], SUSPICION_CLASS),
            "lookalike_roots_suspicion_class": _rate(root_table, ["lookalike_legitimate"], SUSPICION_CLASS),
            "innocent_roots_suspicion_class": _rate(root_table, ["innocent_counterparty"], SUSPICION_CLASS),
            "ordinary_roots_suspicion_class": _rate(root_table, ["ordinary_sample"], SUSPICION_CLASS),
            "low_history_roots_abstain": _rate(root_table, ["low_history_sample"], {"unknown_role"}),
        },
        "safety": {
            "restriction_review_for_victim_roots": count(root_restriction, ["victim", "secondary_victim"], ["consider_temporary_restriction_review"]),
            "restriction_review_for_innocent_lookalike_ordinary_roots": count(
                root_restriction, ["innocent_counterparty", "lookalike_legitimate", "ordinary_sample"], ["consider_temporary_restriction_review"]),
            "innocent_counterparties_connected_suspicion_class": count(conn_table, ["innocent_counterparty"], SUSPICION_CLASS),
            "innocent_counterparties_connected_seen": int(sum(conn_table["innocent_counterparty"].values())),
            "no_scenario_role_connected_suspicion_class": count(conn_table, ["no_scenario_role"], SUSPICION_CLASS),
            "no_scenario_role_connected_seen": int(sum(conn_table["no_scenario_role"].values())),
            "victims_connected_suspicion_class": count(conn_table, ["victim", "secondary_victim"], SUSPICION_CLASS),
            "restriction_review_for_connected_victims_or_innocent": count(
                conn_restriction, ["victim", "secondary_victim", "innocent_counterparty", "no_scenario_role"],
                ["consider_temporary_restriction_review"]),
        },
        "root_vs_connected_consistency": dict(consistency.most_common()),
        "victim_vs_suspicion_disagreements": len(disagreements),
    }
    report = {**summary, "disagreement_examples": disagreements[:40], "errors_detail": errors[:20],
              "per_root": [{k: v for k, v in r.items() if k != "connected"} | {"truth": roots[r["account_id"]]} for r in ok]}
    name = f"root_role_measurement_{ledger}" + (f"_{tag}" if tag else "")
    Path(f"ml/reports/{name}.json").write_text(json.dumps(report, indent=2, default=str))
    return summary


def _rate(table, keys, roles_) -> dict:
    n = int(sum(sum(table[k].values()) for k in keys))
    hit = int(sum(table[k][x] for k in keys for x in roles_))
    return {"n": n, "count": hit, "rate": round(hit / n, 4) if n else None}


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="train")
    ap.add_argument("--tag", default="")
    ap.add_argument("--ordinary", type=int, default=150)
    ap.add_argument("--low", type=int, default=10)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    a = ap.parse_args()
    s = main(a.ledger, a.tag, a.ordinary, a.low, a.workers)
    print(json.dumps(s, indent=1, default=str))
