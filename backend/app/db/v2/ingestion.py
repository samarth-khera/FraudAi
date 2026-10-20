"""High-throughput, transactional data ingestion engine for FraudShield AI V2."""

from __future__ import annotations

import csv
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import Engine, delete, func, insert, select
from sqlalchemy.orm import Session

try:
    from app.db.v2.models import AccountModel, TransactionModel
    from app.db.v2.session import init_v2_db, validate_not_v1_database
except ModuleNotFoundError:
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.db.v2.session import init_v2_db, validate_not_v1_database


@dataclass
class IngestionResult:
    accounts_imported: int = 0
    transactions_imported: int = 0
    accounts_skipped: int = 0
    transactions_skipped: int = 0
    duration_seconds: float = 0.0
    errors: list[str] = field(default_factory=list)

    @property
    def is_success(self) -> bool:
        return len(self.errors) == 0 and self.accounts_imported > 0


class DataIngestionError(Exception):
    """Raised when data ingestion encounters a validation or integrity violation."""
    pass


def ingest_v2_dataset(
    engine: Engine,
    accounts_csv_path: str | Path,
    transactions_csv_path: str | Path,
    batch_size: int = 10000,
    replace: bool = False,
) -> IngestionResult:
    """Ingests synthetic accounts and transactions into V2 database with strict transactional rollback."""
    t0 = time.perf_counter()
    result = IngestionResult()

    # Safety guard: Ensure not pointing at legacy V1 database
    validate_not_v1_database(str(engine.url))

    acc_path = Path(accounts_csv_path)
    txn_path = Path(transactions_csv_path)

    if not acc_path.exists():
        raise FileNotFoundError(f"Accounts CSV not found: {acc_path}")
    if not txn_path.exists():
        raise FileNotFoundError(f"Transactions CSV not found: {txn_path}")

    # Ensure schema is initialized
    init_v2_db(engine)

    # Use a raw connection / session to perform atomic import
    with Session(engine) as session:
        # Check if database already has records
        existing_accs = session.scalar(select(func.count(AccountModel.account_id))) or 0
        existing_txns = session.scalar(select(func.count(TransactionModel.transaction_id))) or 0

        if (existing_accs > 0 or existing_txns > 0) and not replace:
            raise DataIngestionError(
                f"V2 database already contains {existing_accs:,} accounts and {existing_txns:,} transactions. "
                f"Reruns require explicit replacement mode (--replace) to prevent accidental data corruption."
            )

        if replace:
            # Atomic wipe of V2 tables only
            session.execute(delete(TransactionModel))
            session.execute(delete(AccountModel))
            session.flush()

        seen_account_ids: set[str] = set()
        seen_txn_ids: set[str] = set()

        try:
            # ------------------------------------------------------------------
            # Phase 1: Stream and Insert Accounts
            # ------------------------------------------------------------------
            with open(acc_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                account_batch: list[dict[str, Any]] = []

                for row_idx, row in enumerate(reader, start=2):
                    acc_id = row.get("account_id", "").strip()
                    if not acc_id:
                        raise DataIngestionError(f"Row {row_idx}: Missing account_id in accounts CSV.")
                    if acc_id in seen_account_ids:
                        raise DataIngestionError(f"Row {row_idx}: Duplicate account_id '{acc_id}' in accounts CSV.")

                    seen_account_ids.add(acc_id)

                    try:
                        init_bal = float(row["initial_balance"])
                        curr_bal = float(row["current_balance"])
                        opened_at = datetime.fromisoformat(row["account_opened_at"])
                    except (KeyError, ValueError) as e:
                        raise DataIngestionError(f"Row {row_idx}: Invalid numeric/datetime field in account '{acc_id}': {e}")

                    if init_bal < 0 or curr_bal < 0:
                        raise DataIngestionError(f"Row {row_idx}: Negative balance for account '{acc_id}'.")

                    account_batch.append({
                        "account_id": acc_id,
                        "customer_name": row["customer_name"],
                        "customer_type": row["customer_type"],
                        "kyc_tier": row["kyc_tier"],
                        "phone_number": row["phone_number"],
                        "email": row["email"],
                        "upi_id": row["upi_id"],
                        "tax_identifier": row["tax_identifier"],
                        "initial_balance": init_bal,
                        "current_balance": curr_bal,
                        "account_opened_at": opened_at,
                        "status": row.get("status", "active"),
                        "scenario_id": row.get("scenario_id") or None,
                        "ground_truth_label": row["ground_truth_label"],
                    })

                    if len(account_batch) >= batch_size:
                        session.execute(insert(AccountModel), account_batch)
                        result.accounts_imported += len(account_batch)
                        account_batch.clear()

                if account_batch:
                    session.execute(insert(AccountModel), account_batch)
                    result.accounts_imported += len(account_batch)
                    account_batch.clear()

            session.flush()

            # ------------------------------------------------------------------
            # Phase 2: Stream and Insert Transactions with Referential Checks
            # ------------------------------------------------------------------
            with open(txn_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                txn_batch: list[dict[str, Any]] = []

                for row_idx, row in enumerate(reader, start=2):
                    txn_id = row.get("transaction_id", "").strip()
                    if not txn_id:
                        raise DataIngestionError(f"Row {row_idx}: Missing transaction_id in transactions CSV.")
                    if txn_id in seen_txn_ids:
                        raise DataIngestionError(f"Row {row_idx}: Duplicate transaction_id '{txn_id}'.")

                    seen_txn_ids.add(txn_id)

                    orig_id = row.get("origin_account_id", "").strip()
                    dest_id = row.get("destination_account_id", "").strip()

                    # Referential integrity checks
                    if orig_id not in seen_account_ids:
                        raise DataIngestionError(
                            f"Row {row_idx}: Transaction '{txn_id}' references unknown origin_account_id '{orig_id}'."
                        )
                    if dest_id not in seen_account_ids:
                        raise DataIngestionError(
                            f"Row {row_idx}: Transaction '{txn_id}' references unknown destination_account_id '{dest_id}'."
                        )

                    try:
                        amt = float(row["amount"])
                        ts = datetime.fromisoformat(row["timestamp"])
                        orig_before = float(row["origin_balance_before"])
                        orig_after = float(row["origin_balance_after"])
                        dest_before = float(row["dest_balance_before"])
                        dest_after = float(row["dest_balance_after"])
                    except (KeyError, ValueError) as e:
                        raise DataIngestionError(f"Row {row_idx}: Invalid numeric/datetime in transaction '{txn_id}': {e}")

                    if amt <= 0:
                        raise DataIngestionError(f"Row {row_idx}: Non-positive amount ({amt}) in transaction '{txn_id}'.")
                    if orig_before < 0 or orig_after < 0 or dest_before < 0 or dest_after < 0:
                        raise DataIngestionError(f"Row {row_idx}: Negative balance in transaction '{txn_id}'.")

                    is_suspicious = str(row.get("is_suspicious_scenario", "")).strip().lower() in ("true", "1")

                    txn_batch.append({
                        "transaction_id": txn_id,
                        "timestamp": ts,
                        "origin_account_id": orig_id,
                        "destination_account_id": dest_id,
                        "amount": amt,
                        "currency": row.get("currency", "INR"),
                        "channel": row.get("channel", "UPI"),
                        "status": row.get("status", "COMPLETED"),
                        "origin_balance_before": orig_before,
                        "origin_balance_after": orig_after,
                        "dest_balance_before": dest_before,
                        "dest_balance_after": dest_after,
                        "scenario_id": row.get("scenario_id") or None,
                        "scenario_tag": row.get("scenario_tag", "baseline"),
                        "is_suspicious_scenario": is_suspicious,
                    })

                    if len(txn_batch) >= batch_size:
                        session.execute(insert(TransactionModel), txn_batch)
                        result.transactions_imported += len(txn_batch)
                        txn_batch.clear()

                if txn_batch:
                    session.execute(insert(TransactionModel), txn_batch)
                    result.transactions_imported += len(txn_batch)
                    txn_batch.clear()

            # Commit the entire atomic ingestion transaction
            session.commit()

        except Exception as e:
            session.rollback()
            result.errors.append(str(e))
            raise

    result.duration_seconds = time.perf_counter() - t0
    return result
