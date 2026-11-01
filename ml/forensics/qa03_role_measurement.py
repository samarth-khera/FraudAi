"""QA-03 measurement: how often the two role rules behind the audit's false labels mislead, and what a conservative
abstention changes. Development on the train ledger; the same script then reports the cold and demo ledgers.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.qa03_role_measurement --ledger train

Ground truth is read here, by the evaluator, only to score the engine's output; the engine never sees it.

A. Investigated account labelled "potential intermediary": split by how many independent kinds of evidence support it
   (FUNDED_FORWARD alone = 1). Roots: the scenario starting accounts, lookalikes, intermediaries and attacker-controlled
   accounts as roots, and a sample of ordinary accounts.
B. "Other senders" labelled "potential victim": split by whether the hub demonstrably passed that sender's payment on
   (balance-based lower bound on the share moved on within ONWARD_HOURS, the trace's own attribution rule).

Writes ml/reports/qa03_role_measurement_<ledger>.json.
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.api.v2.dynamic_schemas import DynamicInvestigationRequest
from backend.app.intelligence import engine as em
from backend.app.intelligence.datasets import DatasetRegistry
from ml.forensics.evaluate_investigations import build

DI = em.DynamicInvestigation
roles = em.roles
CAPTURE: dict[str, list] = {"investigated": [], "other": []}


def _install_probes() -> None:
    orig_assess = roles.assess
    orig_other = DI._other_senders.__func__

    def assess(e):
        r = orig_assess(e)
        if e.position == "investigated":
            CAPTURE["investigated"].append({"account_id": e.account_id, "role": r.role_candidate,
                                            "categories": sorted(set(r.categories)),
                                            "kinds": sorted(roles.independent_kinds(r.categories))})
        return r

    def other(cls, db, ds, root_id, ev, flow, tm, req, loaded=None):
        out = orig_other(cls, db, ds, root_id, ev, flow, tm, req, loaded)
        for e, r in out:
            hub, tid = e.paid_account_id, e.introduced_by
            H = em.ledger.account_history(db, {hub}, ds)
            received, moved_min, cash = DI._moved_on(hub, {tid}, H, roles.ONWARD_HOURS)
            t = H.loc[H.transaction_id == tid, "timestamp"]
            traced_in = [x.txn.timestamp for x in flow.edges if x.txn.destination_account_id == hub]
            gap_h = ((min(traced_in) - t.iloc[0]).total_seconds() / 3600) if len(t) and traced_in else None
            CAPTURE["other"].append({"root": root_id, "sender": e.account_id, "hub": hub, "transaction_id": tid,
                                     "role": r.role_candidate, "amount": e.sent_traced,
                                     "hub_moved_on_share": round(moved_min / received, 3) if received and moved_min is not None else None,
                                     "hub_cash_share": round(cash / received, 3) if received else None,
                                     "hours_before_hub_first_traced_receipt": round(gap_h, 1) if gap_h is not None else None})
        return out

    roles.assess = assess
    DI._other_senders = classmethod(other)


def main(ledger: str, ordinary: int, intermediaries: int) -> dict:
    db = build(ledger)
    registry = DatasetRegistry(f"sqlite:///{db}")
    gt = pd.read_csv(f"data/v3_forensic/{ledger}/roles.csv")
    gt = gt[gt.materialised]
    scen = pd.read_csv(f"data/v3_forensic/{ledger}/scenarios.csv").set_index("scenario_id")
    accounts = pd.read_csv(f"data/v3_forensic/{ledger}/accounts.csv")
    tx = pd.read_csv(f"data/v3_forensic/{ledger}/transactions.csv", usecols=["origin_account_id", "destination_account_id"])
    n_tx = pd.concat([tx.origin_account_id, tx.destination_account_id]).value_counts()
    role_of = gt.groupby("account_id")["role"].agg(lambda r: "+".join(sorted(set(r))))

    roots: dict[str, str] = {}
    for sid, g in gt.groupby("scenario_id"):
        pattern = scen.at[sid, "pattern"]
        start = g[g.role == ("lookalike_legitimate" if pattern == "lookalike" else "victim")]
        if len(start):
            roots.setdefault(start.account_id.iloc[0], "scenario_start")
    rng = np.random.default_rng(7)
    for role in ("intermediary", "attacker_controlled"):
        pool = sorted(set(gt[gt.role == role].account_id) - set(roots))
        for a in rng.choice(pool, min(intermediaries, len(pool)), replace=False):
            roots.setdefault(a, role)
    ordinary_pool = accounts[(accounts.ground_truth_label == "ordinary") & accounts.account_id.map(n_tx).fillna(0).ge(5)]
    for a in rng.choice(ordinary_pool.account_id.to_numpy(), min(ordinary, len(ordinary_pool)), replace=False):
        roots.setdefault(a, "ordinary_sample")

    _install_probes()
    rows, seconds = [], []
    for i, (a, why) in enumerate(roots.items(), 1):
        CAPTURE["investigated"].clear()
        n_other = len(CAPTURE["other"])
        t0 = time.perf_counter()
        out, _, _ = DI.compute(registry, None, DynamicInvestigationRequest(account_id=a, dataset_id="forensic-scenarios"))
        seconds.append(time.perf_counter() - t0)
        inv = next((c for c in CAPTURE["investigated"] if c["account_id"] == a), None)
        rows.append({"account_id": a, "selected_as": why, "truth": role_of.get(a, "no_scenario_role"),
                     "role": inv["role"] if inv else None, "kinds": inv["kinds"] if inv else [],
                     "categories": inv["categories"] if inv else [], "victim_status": out["victim_assessment"]["status"]})
        for o in CAPTURE["other"][n_other:]:
            o["truth"] = role_of.get(o["sender"], "no_scenario_role")
        if i % 50 == 0:
            print(f"{i}/{len(roots)} median {np.median(seconds):.2f}s", flush=True)

    df = pd.DataFrame(rows)
    pi = df[df.role == "potential_intermediary"].copy()
    pi["n_kinds"] = pi.kinds.map(len)
    part_a = {"investigated_labelled_potential_intermediary": int(len(pi)),
              "by_truth_and_kinds": {f"{t} / {k} kind(s)": int(n) for (t, k), n in pi.groupby(["truth", "n_kinds"]).size().items()},
              "single_kind_category_sets": Counter("+".join(c) for c in pi[pi.n_kinds == 1].categories).most_common(),
              "roots_by_truth": df.truth.value_counts().to_dict()}
    oth = pd.DataFrame(CAPTURE["other"]).drop_duplicates(["root", "sender"]) if CAPTURE["other"] else pd.DataFrame()
    part_b = {}
    if len(oth):
        pv = oth[oth.role == "potential_victim"].copy()
        pv["hub_passed_on"] = pv.hub_moved_on_share.fillna(0) >= roles.INTERMEDIARY_SHARE
        part_b = {"other_senders": int(len(oth)), "labelled_potential_victim": int(len(pv)),
                  "potential_victim_by_truth": pv.truth.value_counts().to_dict(),
                  "potential_victim_by_truth_and_hub_passed_on": {f"{t} / passed_on={p}": int(n) for (t, p), n in pv.groupby(["truth", "hub_passed_on"]).size().items()},
                  "hours_before_hub_first_traced_receipt_by_truth": {t: g.hours_before_hub_first_traced_receipt.describe().round(1).to_dict()
                                                                     for t, g in pv.groupby("truth")},
                  "examples_not_victim": pv[~pv.truth.str.contains("victim")].head(12).to_dict("records")}
    report = {"ledger": ledger, "roots": len(df), "seconds_median": round(float(np.median(seconds)), 3),
              "A_investigated_potential_intermediary": part_a, "B_other_sender_potential_victim": part_b,
              "per_root": df.to_dict("records"), "other_senders": CAPTURE["other"]}
    Path(f"ml/reports/qa03_role_measurement_{ledger}.json").write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="train")
    ap.add_argument("--ordinary", type=int, default=300)
    ap.add_argument("--intermediaries", type=int, default=120)
    a = ap.parse_args()
    r = main(a.ledger, a.ordinary, a.intermediaries)
    print(json.dumps({k: r[k] for k in ("ledger", "roots", "seconds_median", "A_investigated_potential_intermediary")}, indent=1, default=str))
    print(json.dumps({k: v for k, v in r["B_other_sender_potential_victim"].items() if k != "examples_not_victim"}, indent=1, default=str))
