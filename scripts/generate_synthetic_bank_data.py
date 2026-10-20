#!/usr/bin/env python3
"""CLI script for generating reproducible synthetic banking network data for FraudShield AI V2."""

from __future__ import annotations

import argparse
import os
import sys
import time

# Ensure project root is on sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.app.data.v2.generator import SyntheticBankGenerator
from backend.app.data.v2.models import GenerationConfig
from backend.app.data.v2.validator import SyntheticDataValidator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="FraudShield AI V2 Synthetic Banking Data Generator"
    )
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for deterministic output (default: 42)")
    parser.add_argument("--accounts", type=int, default=10000, help="Number of accounts to generate (default: 10000)")
    parser.add_argument("--transactions", type=int, default=350000, help="Target number of transactions (default: 350000)")
    parser.add_argument("--days", type=int, default=90, help="Simulation duration in days (default: 90)")
    parser.add_argument("--output-dir", type=str, default="data/v2_synthetic", help="Output directory for CSV files")
    parser.add_argument("--validate", action="store_true", default=True, help="Validate mathematical ledger integrity")
    parser.add_argument("--no-export", action="store_true", help="Skip writing CSVs to disk (useful for benchmarks)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    print("================================================================================")
    print(" FraudShield AI V2 — Synthetic Banking Ecosystem Generator")
    print("================================================================================")
    print(f" Seed:               {args.seed}")
    print(f" Target Accounts:    {args.accounts:,}")
    print(f" Target Txns:        {args.transactions:,}")
    print(f" Simulation Horizon: {args.days} days")
    print(f" Output Directory:   {args.output_dir}")
    print("--------------------------------------------------------------------------------")

    config = GenerationConfig(
        seed=args.seed,
        num_accounts=args.accounts,
        num_transactions=args.transactions,
        simulation_days=args.days,
        output_dir=args.output_dir,
    )

    t0 = time.perf_counter()
    generator = SyntheticBankGenerator(config)
    accounts, transactions = generator.generate()
    gen_time = time.perf_counter() - t0

    print(f"[OK] Generation completed in {gen_time:.2f} seconds.")
    print(f"     Accounts generated:     {len(accounts):,}")
    print(f"     Transactions generated: {len(transactions):,}")

    # Optional Validation
    if args.validate:
        print("\n--- Validating Mathematical Ledger Integrity & Schema Constraints ---")
        t_val = time.perf_counter()
        validator = SyntheticDataValidator(accounts, transactions)
        report = validator.validate_all()
        val_time = time.perf_counter() - t_val

        if report.is_valid:
            print(f"[PASSED] Integrity check passed in {val_time:.2f} seconds.")
            print(f"         Scenarios verified:    {len(report.scenarios_found)} ({', '.join(report.scenarios_found)})")
            print(f"         Unique origin accs:    {report.unique_origin_accounts:,}")
            print(f"         Unique dest accs:      {report.unique_dest_accounts:,}")
        else:
            print(f"[FAILED] Validation errors encountered ({len(report.errors)}):")
            for err in report.errors[:10]:
                print(f"         - {err}")
            if len(report.errors) > 10:
                print(f"         ... and {len(report.errors) - 10} more errors.")
            return 1

        if report.warnings:
            print(f"[WARN] Warnings ({len(report.warnings)}):")
            for warn in report.warnings:
                print(f"       - {warn}")

    # Export to CSV
    if not args.no_export:
        print("\n--- Exporting to Local CSV Storage ---")
        t_exp = time.perf_counter()
        acc_path, txn_path = generator.export_to_csv()
        exp_time = time.perf_counter() - t_exp

        acc_size_mb = os.path.getsize(acc_path) / (1024 * 1024)
        txn_size_mb = os.path.getsize(txn_path) / (1024 * 1024)

        print(f"[OK] Exported accounts to:     {acc_path} ({acc_size_mb:.2f} MB)")
        print(f"[OK] Exported transactions to: {txn_path} ({txn_size_mb:.2f} MB)")
        print(f"[OK] Export completed in {exp_time:.2f} seconds.")

    print("\n================================================================================")
    print(" Generation & Integrity Verification Successfully Completed.")
    print("================================================================================")
    return 0


if __name__ == "__main__":
    sys.exit(main())
