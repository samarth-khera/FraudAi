#!/usr/bin/env python3
"""CLI script for ingesting FraudShield AI V2 synthetic data into the V2 database."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# Ensure project root and backend are on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.v2.ingestion import IngestionResult, ingest_v2_dataset
from backend.app.db.v2.models import AccountModel, TransactionModel
from backend.app.db.v2.session import (
    DEFAULT_V2_DATABASE_URL,
    get_v2_engine,
    validate_not_v1_database,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="FraudShield AI V2 Data Ingestion CLI"
    )
    parser.add_argument(
        "--input-dir",
        type=str,
        default="data/v2_synthetic",
        help="Directory containing accounts.csv and transactions.csv (default: data/v2_synthetic)",
    )
    parser.add_argument(
        "--accounts-csv",
        type=str,
        default=None,
        help="Optional direct path to accounts.csv",
    )
    parser.add_argument(
        "--transactions-csv",
        type=str,
        default=None,
        help="Optional direct path to transactions.csv",
    )
    parser.add_argument(
        "--db-url",
        type=str,
        default=None,
        help=f"Database connection URL (default: {DEFAULT_V2_DATABASE_URL})",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=10000,
        help="Batch size for bulk database inserts (default: 10000)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Explicitly wipe and re-import existing V2 database records (never touches V1)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    input_dir = Path(args.input_dir)
    acc_path = Path(args.accounts_csv) if args.accounts_csv else input_dir / "accounts.csv"
    txn_path = Path(args.transactions_csv) if args.transactions_csv else input_dir / "transactions.csv"

    db_url = args.db_url or DEFAULT_V2_DATABASE_URL

    print("================================================================================")
    print(" FraudShield AI V2 — High-Throughput Data Ingestion Pipeline")
    print("================================================================================")
    print(f" Accounts CSV:      {acc_path}")
    print(f" Transactions CSV:  {txn_path}")
    print(f" Target Database:   {db_url}")
    print(f" Batch Size:        {args.batch_size:,}")
    print(f" Replacement Mode:  {args.replace}")
    print("--------------------------------------------------------------------------------")

    # Safety check on database URL
    try:
        validate_not_v1_database(db_url)
    except ValueError as e:
        print(f"[FATAL SAFETY VIOLATION] {e}")
        return 1

    engine = get_v2_engine(db_url)

    try:
        t0 = time.perf_counter()
        result: IngestionResult = ingest_v2_dataset(
            engine=engine,
            accounts_csv_path=acc_path,
            transactions_csv_path=txn_path,
            batch_size=args.batch_size,
            replace=args.replace,
        )
        total_time = time.perf_counter() - t0

        print(f"[OK] Ingestion successfully completed in {total_time:.2f} seconds.")
        print(f"     Accounts inserted:     {result.accounts_imported:,}")
        print(f"     Transactions inserted: {result.transactions_imported:,}")

        # Post-ingestion query verification
        print("\n--- Verifying Ingested Database Records & Integrity ---")
        with Session(engine) as session:
            db_acc_count = session.scalar(select(func.count(AccountModel.account_id)))
            db_txn_count = session.scalar(select(func.count(TransactionModel.transaction_id)))
            scen_count = session.scalar(
                select(func.count(func.distinct(AccountModel.scenario_id))).where(
                    AccountModel.scenario_id.is_not(None)
                )
            )

            # Query sample account with its outgoing transactions
            sample_acc = session.scalar(
                select(AccountModel).where(AccountModel.account_id == "ACC-000001")
            )
            sample_out_count = (
                session.scalar(
                    select(func.count(TransactionModel.transaction_id)).where(
                        TransactionModel.origin_account_id == "ACC-000001"
                    )
                )
                if sample_acc
                else 0
            )

            print(f"[OK] Accounts verified in DB:      {db_acc_count:,}")
            print(f"[OK] Transactions verified in DB:  {db_txn_count:,}")
            print(f"[OK] Distinct Scenarios in DB:     {scen_count}")
            if sample_acc:
                print(f"[OK] Sample account verified:     {sample_acc.account_id} ({sample_acc.customer_name})")
                print(f"     Status: {sample_acc.status}, Role: {sample_acc.ground_truth_label}, Outgoing Txns: {sample_out_count}")

        if db_url.startswith("sqlite"):
            db_file_str = db_url.replace("sqlite:///", "")
            if not db_file_str.startswith(":memory:") and os.path.exists(db_file_str):
                db_size_mb = os.path.getsize(db_file_str) / (1024 * 1024)
                print(f"[OK] Final SQLite file size:       {db_file_str} ({db_size_mb:.2f} MB)")

        print("================================================================================")
        print(" V2 Data Ingestion & Database Verification Successfully Completed.")
        print("================================================================================")
        return 0

    except Exception as e:
        print(f"\n[FAILED] Ingestion aborted: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
