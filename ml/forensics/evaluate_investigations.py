"""End-to-end evaluation of the dynamic investigation engine against the generator's ground-truth roles.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.evaluate_investigations --ledger train   # development
    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.evaluate_investigations --ledger cold    # held out

Ground truth is read here, by the evaluator, only to score the engine's output; the engine itself never sees it.
Role rules were developed on the "train" ledger; the "cold" ledger (disjoint accounts, held-out variants) is the
reported evaluation. Writes ml/reports/investigation_eval_<ledger>.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.api.v2.dynamic_schemas import DynamicInvestigationRequest
from backend.app.intelligence.datasets import DatasetRegistry
from backend.app.intelligence import engine as engine_module
from backend.app.intelligence.engine import DynamicInvestigation

FLAGGING_ROLES = {"potential_intermediary", "potentially_suspicious_account"}
VICTIM_ROLES = {"potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed"}


def build(ledger: str) -> Path:
    db = Path(f"data/v3_forensic_{ledger}.db") if ledger != "demo" else Path("data/v3_forensic_scenarios.db")
    if not db.exists():
        subprocess.run([sys.executable, "scripts/build_forensic_ledger.py", "--ledger", ledger, "--db", str(db)], check=True)
    return db


def run(registry, account_id):
    req = DynamicInvestigationRequest(account_id=account_id, dataset_id="forensic-scenarios")
    out, base, _ = DynamicInvestigation.compute(registry, None, req)
    out["investigation"] = {**base, "ai_analysis": {"state": "disabled"}}
    return out


def main(ledger: str, sample_ordinary: int = 80) -> dict:
    db = build(ledger)
    registry = DatasetRegistry(f"sqlite:///{db}")
    gt = pd.read_csv(f"data/v3_forensic/{ledger}/roles.csv")
    gt = gt[gt.materialised]
    scen = pd.read_csv(f"data/v3_forensic/{ledger}/scenarios.csv").set_index("scenario_id")
    accounts = pd.read_csv(f"data/v3_forensic/{ledger}/accounts.csv")
    tx = pd.read_csv(f"data/v3_forensic/{ledger}/transactions.csv", usecols=["origin_account_id", "destination_account_id"])
    n_tx = pd.concat([tx.origin_account_id, tx.destination_account_id]).value_counts()
    role_of = gt.groupby("account_id")["role"].agg(lambda r: sorted(set(r)))

    cases = []
    for sid, g in gt.groupby("scenario_id"):
        pattern, variant = scen.at[sid, "pattern"], scen.at[sid, "variant"]
        start = g[g.role == ("lookalike_legitimate" if pattern == "lookalike" else "victim")]
        if len(start):
            cases.append({"account_id": start.account_id.iloc[0], "scenario_id": sid, "pattern": pattern, "variant": variant,
                          "held_out": bool(scen.at[sid, "held_out"]), "expected": "lookalike" if pattern == "lookalike" else "victim"})
    rng = np.random.default_rng(7)
    ordinary = accounts[(accounts.ground_truth_label == "ordinary") & accounts.account_id.map(n_tx).fillna(0).ge(5)]
    for a in rng.choice(ordinary.account_id.to_numpy(), min(sample_ordinary, len(ordinary)), replace=False):
        cases.append({"account_id": a, "scenario_id": None, "pattern": "normal", "variant": "ordinary", "held_out": False, "expected": "ordinary"})
    low = accounts[accounts.account_id.map(n_tx).fillna(0).between(1, 4)]
    if len(low):
        cases.append({"account_id": low.account_id.iloc[0], "scenario_id": None, "pattern": "insufficient_history", "variant": "",
                      "held_out": False, "expected": "insufficient"})

    rows, conf, restrict, seconds = [], defaultdict(Counter), defaultdict(Counter), []
    unscen_flag = Counter()
    examples: dict[str, dict] = {}
    for c in cases:
        t0 = time.perf_counter()
        out = run(registry, c["account_id"])
        seconds.append(time.perf_counter() - t0)
        if len(seconds) % 25 == 0 or seconds[-1] > 10:
            print(f"{len(seconds)}/{len(cases)} {c['account_id']} {seconds[-1]:.1f}s", flush=True)
        status = out["victim_assessment"]["status"]
        connected = []
        for a in out["role_assessments"]:
            if a["account_id"] == c["account_id"]:
                continue
            truth = role_of.get(a["account_id"])
            in_this = c["scenario_id"] is not None and a["account_id"] in set(gt.loc[gt.scenario_id == c["scenario_id"], "account_id"])
            key = (truth[0] if len(truth) == 1 else "+".join(truth)) if truth is not None else (
                "cash_network" if a["role_candidate"] == "cash_withdrawal_point" else "no_scenario_role")
            if truth is not None and not in_this:
                key = "role_in_other_scenario"
            conf[key][a["role_candidate"]] += 1
            restrict[key][a["restriction"]["state"]] += 1
            connected.append((a["account_id"], key, a["role_candidate"]))
        found = {k for _, k, r in connected if r in FLAGGING_ROLES}
        rows.append({**c, "status": status, "suspicious_transactions": len(out["suspicious_transactions"]),
                     "accounts_in_trace": out["fund_trace"]["accounts"], "branches": len(out["fund_trace"]["branches"]),
                     "intermediaries_found": sum(1 for _, k, r in connected if k == "intermediary" and r in FLAGGING_ROLES),
                     "intermediaries_in_trace": sum(1 for _, k, _ in connected if k == "intermediary"),
                     "other_victims_found": len(out["affected_accounts"]["potential_victims"]),
                     "restriction_on_investigated": out["restriction_recommendation"]["state"],
                     "flagged_kinds": sorted(found)})
        key = f"{c['pattern']}:{c['variant']}"
        if key not in examples and c["expected"] != "ordinary":
            examples[key] = {"account_id": c["account_id"], "status": status, "branches": len(out["fund_trace"]["branches"]),
                             "roles": Counter(r for _, _, r in connected)}
    df = pd.DataFrame(rows)
    try:
        run(registry, "FS-00000000")
        not_found = "returned a report (WRONG)"
    except engine_module.AccountNotFound:  # the class the engine actually raises (import-path independent)
        not_found = "account_not_found raised (correct)"

    def rate(m):
        return round(float(m.mean()), 4) if len(m) else None

    vict = df[df.expected == "victim"]
    report = {
        "ledger": ledger, "database": str(db), "investigations": len(df),
        "seconds_per_investigation": {"median": round(float(np.median(seconds)), 3), "p95": round(float(np.quantile(seconds, 0.95)), 3)},
        "investigated_account_status": {
            "victims": {"n": len(vict), "status_counts": vict.status.value_counts().to_dict(),
                        "potential_victim_rate": rate(vict.status == "potential_victim"),
                        "suspicious_activity_detected_rate": rate(vict.status.isin(["potential_victim", "suspicious_activity_victim_status_unconfirmed"]))},
            "victims_by_pattern": {p: {"n": len(g), "detected": rate(g.status.isin(["potential_victim", "suspicious_activity_victim_status_unconfirmed"]))}
                                   for p, g in vict.groupby(vict.pattern + ":" + vict.variant)},
            "ordinary_accounts": {"n": int((df.expected == "ordinary").sum()),
                                  "status_counts": df[df.expected == "ordinary"].status.value_counts().to_dict()},
            "lookalikes": {"n": int((df.expected == "lookalike").sum()), "status_counts": df[df.expected == "lookalike"].status.value_counts().to_dict()},
            "insufficient_history_case": df[df.expected == "insufficient"][["account_id", "status"]].to_dict("records"),
            "unknown_account": not_found,
        },
        "intermediary_recall_within_traces": {"found": int(vict.intermediaries_found.sum()), "in_traces": int(vict.intermediaries_in_trace.sum())},
        "connected_account_roles_by_ground_truth": {k: dict(v) for k, v in conf.items()},
        "restriction_states_by_ground_truth": {k: dict(v) for k, v in restrict.items()},
        "safety": {
            "restriction_review_for_innocent_or_ordinary": int(sum(restrict[k]["consider_temporary_restriction_review"]
                                                                   for k in ("innocent_counterparty", "no_scenario_role", "merchant", "ordinary"))),
            "restriction_review_for_victims": int(sum(restrict[k]["consider_temporary_restriction_review"] for k in ("victim", "secondary_victim"))),
            "innocent_counterparties_labelled_suspicious": int(sum(conf["innocent_counterparty"][r] for r in FLAGGING_ROLES)),
            "innocent_counterparties_seen": int(sum(conf["innocent_counterparty"].values())),
            "accounts_without_scenario_role_labelled_suspicious": int(sum(conf["no_scenario_role"][r] for r in FLAGGING_ROLES)),
            "accounts_without_scenario_role_seen": int(sum(conf["no_scenario_role"].values())),
        },
        "examples": {k: {**v, "roles": dict(v["roles"])} for k, v in examples.items()},
        "per_case": df.to_dict("records"),
    }
    Path(f"ml/reports/investigation_eval_{ledger}.json").write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="train")
    ap.add_argument("--ordinary", type=int, default=80)
    a = ap.parse_args()
    r = main(a.ledger, a.ordinary)
    print(json.dumps({k: r[k] for k in ("investigations", "seconds_per_investigation", "investigated_account_status",
                                         "intermediary_recall_within_traces", "connected_account_roles_by_ground_truth",
                                         "restriction_states_by_ground_truth", "safety")}, indent=1, default=str))
