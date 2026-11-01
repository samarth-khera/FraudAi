"""QA-03: what the suggested sample accounts lead to, for the previous and the current sample rule.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.qa03_sample_outcomes --ledger train   # design
    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.qa03_sample_outcomes --ledger demo    # served ledger

Both rules read recorded transfers only. Ground truth is read here, by the evaluator, only to score the resulting
investigations: the investigated account's status against its scenario role, and connected-account labels that
contradict ground truth (a suspicious-role label on an account without a scenario role or an innocent counterparty, or
a potential-victim label on an attacker-controlled account or an intermediary). Writes
ml/reports/qa03_sample_outcomes_<ledger>.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sqlalchemy import func, select

from backend.app.api.v2 import dynamic_routes
from backend.app.api.v2.dynamic_schemas import DynamicInvestigationRequest
from backend.app.intelligence.datasets import DatasetRegistry
from backend.app.intelligence.engine import DynamicInvestigation
from ml.forensics.evaluate_investigations import FLAGGING_ROLES, build

AccountModel, TransactionModel = dynamic_routes.AccountModel, dynamic_routes.TransactionModel
PROTECTIVE = {"potential_victim", "potential_secondary_victim"}


def previous_rule(s) -> list[str]:
    """The sample rule before the 2026-11-02 remediation (largest share of balance, no other condition)."""
    ratio = func.max(TransactionModel.amount / TransactionModel.origin_balance_before)
    rows = s.execute(
        select(TransactionModel.origin_account_id, ratio.label("r"))
        .join(AccountModel, AccountModel.account_id == TransactionModel.origin_account_id)
        .where(AccountModel.customer_type.in_(("retail", "student")), TransactionModel.amount >= 10_000,
               TransactionModel.origin_balance_before > 0)
        .group_by(TransactionModel.origin_account_id).order_by(ratio.desc(), TransactionModel.origin_account_id).limit(6)).all()
    return [a for a, _ in rows]


def main(ledger: str) -> dict:
    db = build(ledger)
    registry = DatasetRegistry(f"sqlite:///{db}")
    gt = pd.read_csv(f"data/v3_forensic/{ledger}/roles.csv")
    gt = gt[gt.materialised]
    role_of = gt.groupby("account_id")["role"].agg(lambda r: "+".join(sorted(set(r))))
    s = registry.open("forensic-scenarios")
    try:
        rules = {"previous": previous_rule(s), "current": [a for a, _, _ in dynamic_routes._own_money_samples(s)]}
    finally:
        s.close()
    report = {"ledger": ledger, "rules": {}}
    for name, accounts in rules.items():
        rows = []
        for a in accounts:
            out, _, _ = DynamicInvestigation.compute(registry, None, DynamicInvestigationRequest(account_id=a, dataset_id="forensic-scenarios"))
            root = next(r for r in out["role_assessments"] if r["account_id"] == a)
            contradictions = []
            for r in out["role_assessments"]:
                if r["account_id"] == a:
                    continue
                truth = role_of.get(r["account_id"], "no_scenario_role")
                if r["role_candidate"] in FLAGGING_ROLES and truth in ("no_scenario_role", "innocent_counterparty"):
                    contradictions.append(f"{r['account_id']}: {r['role_candidate']} (truth {truth})")
                if r["role_candidate"] in PROTECTIVE and truth in ("attacker_controlled", "intermediary"):
                    contradictions.append(f"{r['account_id']}: {r['role_candidate']} (truth {truth})")
            truth = role_of.get(a, "no_scenario_role")
            # Suspicious-direction error on the investigated account (the FS-10B80A33 class) ...
            root_wrong = (root["role_candidate"] in FLAGGING_ROLES and "intermediary" not in truth and "attacker" not in truth)
            # ... and the protective-direction error (an account without a victim role called a potential victim).
            root_protective_wrong = root["role_candidate"] in PROTECTIVE and "victim" not in truth
            rows.append({"account_id": a, "truth": truth, "status": out["victim_assessment"]["status"],
                         "root_role": root["role_candidate"], "root_label_contradicts_truth": root_wrong,
                         "root_protective_label_contradicts_truth": root_protective_wrong,
                         "connected_label_contradictions": contradictions})
        report["rules"][name] = {
            "accounts": rows,
            "investigations_with_a_suspicious_direction_contradiction": sum(
                1 for r in rows if r["root_label_contradicts_truth"] or any("potential_intermediary" in c or "potentially_suspicious" in c
                                                                           for c in r["connected_label_contradictions"])),
            "investigations_with_any_contradicting_label": sum(
                1 for r in rows if r["root_label_contradicts_truth"] or r["root_protective_label_contradicts_truth"]
                or r["connected_label_contradictions"]),
        }
    Path(f"ml/reports/qa03_sample_outcomes_{ledger}.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":  # pragma: no cover
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="train")
    print(json.dumps(main(ap.parse_args().ledger), indent=1))
