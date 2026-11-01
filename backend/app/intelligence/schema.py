"""Normalized transaction schema shared by every data source, the training pipeline and online inference.

Each source keeps its own adapter (ml/forensics/adapters.py, ledger.py here). Sources are never concatenated into one
training table: their transaction semantics and label definitions differ (docs/DYNAMIC_INTELLIGENCE.md, "Datasets").
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# Columns every adapter produces. Optional values are NaN/None when the source does not provide them; they are never
# filled with invented values.
NORMALIZED_COLUMNS = [
    "transaction_id",
    "timestamp",            # naive UTC datetime64
    "sender_account_id",
    "receiver_account_id",
    "amount",
    "currency",             # None when the source has no currency
    "transaction_type",     # TRANSFER | PAYMENT | CASH_OUT | CASH_IN | DEBIT | OTHER
    "channel",              # source channel (UPI, NEFT, ...) or None
    "transaction_status",
    "sender_balance_before",    # pre-transaction balance if the source records it, else NaN
    "receiver_balance_before",  # pre-transaction balance if the source records it, else NaN
    "source_dataset",
    "source_record_id",
]
# Evaluation-only columns. Inference code must not read them (tests enforce this by scrambling them).
EVALUATION_ONLY_COLUMNS = ["label", "scenario_id"]
TRANSACTION_TYPES = ("TRANSFER", "PAYMENT", "CASH_OUT", "CASH_IN", "DEBIT", "OTHER")

# How V2-ledger channels map to transaction types. The ledger records a channel, not a purpose, so UPI/IMPS/NEFT
# are transfers even when the receiver is a shop; only card and ATM channels say more.
V2_CHANNEL_TYPE = {
    "UPI": "TRANSFER", "IMPS": "TRANSFER", "NEFT": "TRANSFER", "RTGS": "TRANSFER", "INTERNAL": "TRANSFER",
    "CARD_POS": "PAYMENT", "ATM_CASH_OUT": "CASH_OUT",
}


@dataclass
class ValidationReport:
    rows_in: int = 0
    rows_valid: int = 0
    errors: dict[str, int] = field(default_factory=dict)     # rows rejected, by reason
    warnings: dict[str, int] = field(default_factory=dict)   # rows kept but noteworthy, by reason

    def as_dict(self) -> dict:
        return {"rows_in": self.rows_in, "rows_valid": self.rows_valid, "errors": self.errors, "warnings": self.warnings}


def validate_transactions(df: pd.DataFrame, known_accounts: set[str] | None = None,
                          allowed_types: tuple[str, ...] = TRANSACTION_TYPES) -> tuple[pd.DataFrame, ValidationReport]:
    """Rejects rows that cannot be used and counts everything else worth knowing. Never modifies values.

    Rejected: missing columns (raises), duplicate transaction IDs (every copy), unparseable timestamps, non-positive or
    non-finite amounts, missing sender or receiver, unknown transaction types, references to accounts outside
    ``known_accounts`` when given. Warnings: self-transfers, a pre-transaction sender balance lower than the amount
    (contradictory unless overdrafts exist), negative balances, and missing optional fields.
    """
    missing = [c for c in NORMALIZED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"normalized frame is missing columns: {missing}")
    rep = ValidationReport(rows_in=len(df))
    bad = pd.Series(False, index=df.index)

    def reject(mask: pd.Series, reason: str) -> None:
        nonlocal bad
        n = int((mask & ~bad).sum())
        if n:
            rep.errors[reason] = n
        bad |= mask

    def warn(mask: pd.Series, reason: str) -> None:
        n = int((mask & ~bad).sum())
        if n:
            rep.warnings[reason] = n

    ids = df["transaction_id"]
    reject(ids.isna() | (ids.astype(str).str.strip() == ""), "missing_transaction_id")
    reject(ids.duplicated(keep=False) & ids.notna(), "duplicate_transaction_id")
    ts = pd.to_datetime(df["timestamp"], errors="coerce")
    reject(ts.isna(), "invalid_timestamp")
    amt = pd.to_numeric(df["amount"], errors="coerce")
    reject(~np.isfinite(amt.fillna(np.nan).astype(float)) | (amt <= 0), "invalid_amount")
    for col, reason in (("sender_account_id", "missing_sender"), ("receiver_account_id", "missing_receiver")):
        reject(df[col].isna() | (df[col].astype(str).str.strip() == ""), reason)
    reject(~df["transaction_type"].isin(allowed_types), "unexpected_transaction_type")
    if known_accounts is not None:
        reject(~df["sender_account_id"].isin(known_accounts) | ~df["receiver_account_id"].isin(known_accounts),
               "unknown_account_reference")
    warn(df["sender_account_id"] == df["receiver_account_id"], "self_transfer")
    sb = pd.to_numeric(df["sender_balance_before"], errors="coerce")
    warn(sb.notna() & (sb < amt), "sender_balance_below_amount")
    warn((sb < 0) | (pd.to_numeric(df["receiver_balance_before"], errors="coerce") < 0), "negative_balance")
    warn(sb.isna(), "sender_balance_missing")
    warn(df["channel"].isna(), "channel_missing")
    rep.rows_valid = int((~bad).sum())
    return df.loc[~bad].copy(), rep
