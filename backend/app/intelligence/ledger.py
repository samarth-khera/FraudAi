"""Reads V2-schema ledgers into the normalized frame, by account, using the (account, timestamp) indexes.

An investigation never scans the whole ledger: it reads the investigated account's records and, where features need
them, the records of its counterparties. Scenario and ground-truth columns are not selected.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

try:
    from app.db.v2.models import TransactionModel
    from app.intelligence.schema import NORMALIZED_COLUMNS, V2_CHANNEL_TYPE
except ModuleNotFoundError:
    from backend.app.db.v2.models import TransactionModel
    from backend.app.intelligence.schema import NORMALIZED_COLUMNS, V2_CHANNEL_TYPE

_COLS = (
    TransactionModel.transaction_id, TransactionModel.timestamp, TransactionModel.origin_account_id,
    TransactionModel.destination_account_id, TransactionModel.amount, TransactionModel.currency, TransactionModel.channel,
    TransactionModel.status, TransactionModel.origin_balance_before, TransactionModel.dest_balance_before,
)
_CHUNK = 400  # SQLite variable limit headroom


def v2_rows_to_frame(rows: Iterable, source_dataset: str) -> pd.DataFrame:
    df = pd.DataFrame(list(rows), columns=["transaction_id", "timestamp", "sender_account_id", "receiver_account_id", "amount",
                                           "currency", "channel", "transaction_status", "sender_balance_before",
                                           "receiver_balance_before"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True).dt.tz_localize(None) if len(df) else pd.to_datetime(df["timestamp"])
    df["transaction_type"] = df["channel"].map(V2_CHANNEL_TYPE).fillna("OTHER")
    df["source_dataset"] = source_dataset
    df["source_record_id"] = df["transaction_id"]
    df = df.drop_duplicates("transaction_id")
    return df.sort_values(["timestamp", "transaction_id"], kind="mergesort").reset_index(drop=True)[NORMALIZED_COLUMNS]


def account_history(db: Session, account_ids: Iterable[str], source_dataset: str, until=None,
                    loaded: pd.DataFrame | None = None, loaded_ids: Iterable[str] = ()) -> pd.DataFrame:
    """Every transfer sent or received by any of ``account_ids`` (optionally up to ``until``).

    ``loaded``/``loaded_ids``: a frame already holding the complete history of each account in ``loaded_ids`` (as an
    earlier call returned it). Those accounts are taken from it instead of being read again; the result is the same
    rows in the same order as a fresh read. The history is never windowed or capped: the point-in-time features use
    every earlier record of an account, so a window could change them.
    """
    ids = sorted(set(account_ids))
    reuse = sorted(set(ids) & set(loaded_ids)) if loaded is not None else []
    if reuse:
        ids = sorted(set(ids) - set(reuse))
        kept = loaded[loaded.sender_account_id.isin(reuse) | loaded.receiver_account_id.isin(reuse)]
        if until is not None:
            cut = pd.Timestamp(until)
            kept = kept[kept.timestamp <= (cut.tz_convert(None) if cut.tzinfo else cut)]
        fresh = account_history(db, ids, source_dataset, until) if ids else kept.iloc[0:0]
        both = pd.concat([kept, fresh]).drop_duplicates("transaction_id")
        return both.sort_values(["timestamp", "transaction_id"], kind="mergesort").reset_index(drop=True)[NORMALIZED_COLUMNS]
    rows: list = []
    for i in range(0, len(ids), _CHUNK):
        chunk = ids[i:i + _CHUNK]
        stmt = select(*_COLS).where(or_(TransactionModel.origin_account_id.in_(chunk), TransactionModel.destination_account_id.in_(chunk)))
        if until is not None:
            stmt = stmt.where(TransactionModel.timestamp <= until)
        rows += db.execute(stmt).all()
    return v2_rows_to_frame(rows, source_dataset)


def counterparties(tx: pd.DataFrame, account_ids: Iterable[str]) -> set[str]:
    ids = set(account_ids)
    s, r = tx["sender_account_id"].to_numpy(), tx["receiver_account_id"].to_numpy()
    return (set(r[np.isin(s, list(ids))]) | set(s[np.isin(r, list(ids))])) - ids
