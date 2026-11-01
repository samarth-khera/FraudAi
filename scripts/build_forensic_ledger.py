#!/usr/bin/env python3
"""Builds a forensic scenario ledger (ml/forensics/generator.py) into a V2-schema SQLite database.

    python scripts/build_forensic_ledger.py                       # served ledger: seed 303 -> data/v3_forensic_scenarios.db
    python scripts/build_forensic_ledger.py --ledger cold --db data/v3_forensic_cold.db   # evaluation ledger

The ground-truth roles table is written next to the CSVs (data/v3_forensic/<ledger>/roles.csv, git-ignored) for
evaluation; the database carries one role per account in ground_truth_label, which the app never reads.
Deterministic: the same seed produces the same accounts, transactions and roles.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path[:0] = [ROOT, os.path.join(ROOT, "backend")]

from backend.app.db.v2.ingestion import ingest_v2_dataset  # noqa: E402
from backend.app.db.v2.session import get_v2_engine  # noqa: E402
from ml.forensics.generator import LEDGERS, generate_ledger  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="demo", choices=sorted(LEDGERS))
    ap.add_argument("--db", default="data/v3_forensic_scenarios.db")
    ap.add_argument("--csv-dir", default=None)
    a = ap.parse_args()
    t0 = time.perf_counter()
    L = generate_ledger(a.ledger)
    paths = L.write(a.csv_dir or f"data/v3_forensic/{a.ledger}")
    engine = get_v2_engine(f"sqlite:///{a.db}")
    res = ingest_v2_dataset(engine, paths["accounts"], paths["transactions"], batch_size=10000, replace=True)
    engine.dispose()
    if res.errors:
        print("ingestion errors:", res.errors[:5])
        return 1
    print(f"{a.ledger}: {res.accounts_imported} accounts, {res.transactions_imported} transactions, "
          f"{int(L.transactions.is_suspicious_scenario.sum())} scenario transfers, {L.skipped_legs} unfundable legs skipped "
          f"-> {a.db} ({time.perf_counter() - t0:.1f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
