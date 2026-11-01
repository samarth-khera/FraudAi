"""Untouched hold-out evaluation protocol for the role engine and models.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.holdout_evaluation

Why this exists. The role rules were designed on the train ledger (seed 101), and during development accounts on the
served ledger (seed 303) were used as concrete failure examples, and the cold ledger (seed 202) was run several times
while rules changed. Neither of those can be called untouched for the role engine any more. This script evaluates a
FRESH ledger (seed 404, `LEDGERS["holdout"]` in generator.py) exactly once per frozen code manifest:

1. It fingerprints everything that decides an outcome (the inference code, the tracer, the served model artifacts and
   the generator) into a manifest hash.
2. If ml/reports/holdout_evaluation.json exists for the SAME manifest, it prints the stored result and stops: re-running
   would only invite looking at the numbers again.
3. If it exists for a DIFFERENT manifest, it refuses (exit 2). Seed 404 has then been looked at under other code, so it
   is no longer untouched; a new seed must be added and recorded instead. Nothing may be tuned against this ledger.
4. Otherwise it builds the ledger, runs the full engine as the API does (via evaluate_investigations), adds the
   secondary-victim criterion check, and writes the report once.

Ground truth is read here only to choose investigation roots and to score the engine's output; the engine never sees it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

LEDGER = "holdout"
DB = Path("data/v3_forensic_holdout.db")
REPORT = Path("ml/reports/holdout_evaluation.json")


def paths_for(ledger: str) -> tuple[Path, Path]:
    """Seed 404 keeps its original paths; a later untouched ledger gets its own database and report."""
    if ledger == "holdout":
        return DB, REPORT
    return Path(f"data/v3_forensic_{ledger}.db"), Path(f"ml/reports/holdout_evaluation_{ledger}.json")
FROZEN_GLOBS = [
    "backend/app/intelligence/*.py",
    "backend/app/services/v2/graph_tracer.py",
    "backend/app/services/v2/investigation.py",
    "backend/app/api/v2/dynamic_routes.py",
    "ml/artifacts/v3/transaction_model/*",
    "ml/artifacts/v3/account_model/*",
    "ml/forensics/generator.py",
    "ml/forensics/evaluate_investigations.py",
]
VICTIM_CLASS = {"potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed"}
SUSPICION = {"potential_intermediary", "potentially_suspicious_account"}


def manifest() -> dict:
    files = sorted({p for g in FROZEN_GLOBS for p in Path(".").glob(g) if p.is_file()})
    h = hashlib.sha256()
    per_file = {}
    for p in files:
        d = hashlib.sha256(p.read_bytes()).hexdigest()
        per_file[str(p)] = d
        h.update(f"{p}:{d}\n".encode())
    return {"sha256": h.hexdigest(), "files": per_file}


def secondary_victim_check(registry, run, ledger: str = LEDGER) -> dict:
    """Original criterion (pre-registered in the owner's brief): the engine labels a materialised secondary victim exactly
    `potential_secondary_victim`. Exploratory criterion (introduced after seeing scenario 6 on the served ledger): a
    victim-class role with may_be_victim true and not an intermediary/suspicious role."""
    gt = pd.read_csv(f"data/v3_forensic/{ledger}/roles.csv")
    gt = gt[gt.materialised]
    rows = []
    for _, sv in gt[gt.role == "secondary_victim"].sort_values(["scenario_id", "account_id"]).iterrows():
        victims = gt[(gt.scenario_id == sv.scenario_id) & (gt.role == "victim")].account_id.sort_values()
        if victims.empty:
            rows.append({"account_id": sv.account_id, "scenario_id": sv.scenario_id, "reached": False, "note": "no victim root"})
            continue
        out = run(registry, victims.iloc[0])
        ra = next((a for a in out["role_assessments"] if a["account_id"] == sv.account_id), None)
        if ra is None:
            rows.append({"account_id": sv.account_id, "scenario_id": sv.scenario_id, "root": victims.iloc[0], "reached": False})
            continue
        role = ra["role_candidate"]
        rows.append({"account_id": sv.account_id, "scenario_id": sv.scenario_id, "root": victims.iloc[0], "reached": True,
                     "role": role, "may_be_victim": ra["may_be_victim"], "restriction": ra["restriction"]["state"],
                     "original_criterion_met": role == "potential_secondary_victim",
                     "exploratory_criterion_met": role in VICTIM_CLASS and ra["may_be_victim"] and role not in SUSPICION})
    reached = [r for r in rows if r.get("reached")]
    return {
        "materialised_secondary_victims": len(rows), "reached_by_trace": len(reached),
        "original_criterion_met": sum(r["original_criterion_met"] for r in reached),
        "exploratory_criterion_met": sum(r["exploratory_criterion_met"] for r in reached),
        "labelled_intermediary_or_suspicious": sum(r["role"] in SUSPICION for r in reached),
        "given_restriction_review": sum(r["restriction"] == "consider_temporary_restriction_review" for r in reached),
        "accounts": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ordinary", type=int, default=60)
    ap.add_argument("--ledger", default=LEDGER, help="an untouched ledger in generator.LEDGERS (default: seed 404)")
    a = ap.parse_args()
    db_path, report_path = paths_for(a.ledger)
    m = manifest()
    if report_path.exists():
        prev = json.loads(report_path.read_text())
        if prev["manifest"]["sha256"] == m["sha256"]:
            print("Hold-out already evaluated for this exact code; stored result (not recomputed):")
            print(json.dumps(prev["summary"], indent=2))
            return 0
        changed = sorted(k for k in set(m["files"]) | set(prev["manifest"]["files"])
                         if m["files"].get(k) != prev["manifest"]["files"].get(k))
        print(f"REFUSED: {a.ledger} was already evaluated under different code, so it is no longer untouched.\n"
              f"Changed since then: {changed}\nAdd a new hold-out seed and record why; never re-tune against this one.")
        return 2

    sys.path[:0] = [".", "backend"]
    from ml.forensics import evaluate_investigations as ev
    from backend.app.intelligence.datasets import DatasetRegistry
    from ml.forensics.generator import LEDGERS

    t0 = time.perf_counter()
    if not db_path.exists():
        subprocess.run([sys.executable, "scripts/build_forensic_ledger.py", "--ledger", a.ledger, "--db", str(db_path)], check=True)
    report = ev.main(a.ledger, sample_ordinary=a.ordinary)
    registry = DatasetRegistry(f"sqlite:///{db_path}")
    sv = secondary_victim_check(registry, ev.run, a.ledger)
    status = report["investigated_account_status"]
    summary = {
        "ledger": f"forensic generator seed {LEDGERS[a.ledger].seed} ({a.ledger}); never used for any design, tuning or threshold choice",
        "investigations": report["investigations"],
        "victims": status["victims"],
        "victims_by_pattern": status["victims_by_pattern"],
        "ordinary_accounts": status["ordinary_accounts"],
        "lookalikes": status["lookalikes"],
        "unknown_account": status["unknown_account"],
        "insufficient_history_case": status["insufficient_history_case"],
        "connected_account_roles_by_ground_truth": report["connected_account_roles_by_ground_truth"],
        "restriction_states_by_ground_truth": report["restriction_states_by_ground_truth"],
        "safety": report["safety"],
        "secondary_victims": {k: v for k, v in sv.items() if k != "accounts"},
    }
    out = {
        "protocol": __doc__.strip().splitlines()[0],
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "manifest": m,
        "summary": summary,
        "secondary_victim_accounts": sv["accounts"],
        "runtime_seconds": round(time.perf_counter() - t0, 1),
    }
    report_path.write_text(json.dumps(out, indent=2, default=str))
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
