"""Review every protective victim label the engine gave to an account with no scenario role (cold ledger by default).

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.review_protective_labels --ledger cold

The engine labels an account `potential_victim` (urgent manual review, to protect the holder) when a transfer of its own
that the transaction model flags was not funded by fresh inflows and deviates from its established history. This script
re-runs the same investigations as ml/forensics/evaluate_investigations.py (the roots listed in its report) and collects
every such label on an account the generator gave no scenario role.

Each label is graded TWICE, and the two are kept apart:
1. Evidence grade (no ground truth): a fixed rubric over what the investigator sees, written before looking at results.
   - supported: the flagged transfer deviates in >= 3 independent ways (over twice its largest earlier transfer; a
     recipient it never paid before; at least half its balance; night-time when it rarely transacts) AND the account
     model is not below its threshold-or-abstaining contradicting it -- i.e. an investigator would reasonably check;
   - uncertain: 2 deviations;
   - weak: 1 deviation.
2. Ground truth (evaluation only): the generator's activity tag for the flagged transfer (rent, allowance, p2p, ...).
   Every one of these accounts is, by construction, NOT a scenario victim, so against ground truth every label here is a
   false victim label. The question this answers is how misleading the evidence was, not whether the account was a victim.
Writes ml/reports/protective_label_review_<ledger>.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

sys.path[:0] = [".", "backend"]
from backend.app.intelligence.datasets import DatasetRegistry  # noqa: E402
from ml.forensics.evaluate_investigations import build, run  # noqa: E402

DEVIATIONS = {  # the engine's exact deviation sentences (engine.py, victim evidence)
    "over_twice_largest": re.compile(r"is more than twice its largest earlier one", re.I),
    "new_recipient": re.compile(r"went to account\(s\) it had never paid before", re.I),
    "half_balance": re.compile(r"took at least half of the balance at the time", re.I),
    "night": re.compile(r"between 00:00 and 05:00, when it rarely transacted", re.I),
}


def deviations(texts: list[str]) -> list[str]:
    joined = " ".join(texts)
    return sorted(k for k, rx in DEVIATIONS.items() if rx.search(joined))


def main(ledger: str) -> dict:
    db = build(ledger)
    reg = DatasetRegistry(f"sqlite:///{db}")
    roots = [c["account_id"] for c in json.loads(Path(f"ml/reports/investigation_eval_{ledger}.json").read_text())["per_case"]]
    gt = pd.read_csv(f"data/v3_forensic/{ledger}/roles.csv")
    gt = gt[gt.materialised]
    with_role = set(gt.account_id)
    tx = pd.read_csv(f"data/v3_forensic/{ledger}/transactions.csv",
                     usecols=["transaction_id", "scenario_tag", "amount", "origin_account_id", "destination_account_id"])
    tag = dict(zip(tx.transaction_id, tx.scenario_tag))
    labels = []
    for root in roots:
        out = run(reg, root)
        for a in out["role_assessments"]:
            if a["account_id"] == root or a["account_id"] in with_role or a["role_candidate"] != "potential_victim":
                continue
            texts = a["supporting_evidence"] + [e["text"] for e in a.get("evidence_items", [])]
            dev = deviations(texts)
            am = a["account_model"] or {}
            grade = "supported" if len(dev) >= 3 else "uncertain" if len(dev) == 2 else "weak"
            ids = a["relevant_transaction_ids"]
            labels.append({
                "root": root, "account_id": a["account_id"], "position": a["graph_relationship"]["position"],
                "hop": a["graph_relationship"]["hop"], "restriction": a["restriction"]["state"],
                "evidence_grade": grade, "deviations": dev, "supporting_evidence": a["supporting_evidence"],
                "contradictory_evidence": a["contradictory_evidence"],
                "account_model": {k: am.get(k) for k in ("status", "calibrated_probability", "above_threshold")},
                "relevant_transaction_ids": ids,
                "ground_truth_activity_of_flagged_transfers": [tag.get(t) for t in ids],
            })
    uniq = {x["account_id"] for x in labels}
    report = {
        "ledger": ledger, "roots": len(roots), "label_occurrences": len(labels), "distinct_accounts": len(uniq),
        "against_ground_truth": "all are false victim labels (accounts with no scenario role)",
        "by_evidence_grade": dict(Counter(x["evidence_grade"] for x in labels)),
        "by_position": dict(Counter(x["position"] for x in labels)),
        "by_deviation_count": dict(Counter(len(x["deviations"]) for x in labels)),
        "deviation_frequency": dict(Counter(d for x in labels for d in x["deviations"])),
        "ground_truth_activity_of_flagged_transfers": dict(Counter(t for x in labels for t in x["ground_truth_activity_of_flagged_transfers"])),
        "restriction_states": dict(Counter(x["restriction"] for x in labels)),
        "account_model_above_threshold": sum(bool(x["account_model"]["above_threshold"]) for x in labels),
        "labels": labels,
    }
    Path(f"ml/reports/protective_label_review_{ledger}.json").write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="cold")
    r = main(ap.parse_args().ledger)
    print(json.dumps({k: v for k, v in r.items() if k != "labels"}, indent=1))
