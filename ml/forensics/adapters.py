"""Source-specific adapters into the normalized schema. Raw files are opened read-only and never rewritten.

Each adapter keeps the source's own label meaning in ``label`` (evaluation only) and documents what it cannot map.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.intelligence.schema import NORMALIZED_COLUMNS, V2_CHANNEL_TYPE

PAYSIM_FILE = Path("data/raw/PS_20174392719_1491204439457_log.csv")
AMLSIM_DIR = Path("data/raw/amlsim/extracted")
# PaySim's `step` is an hour index of a 30-day simulation with no calendar date; any base date is arbitrary.
PAYSIM_BASE = pd.Timestamp("2017-01-01")
AMLSIM_BASE = pd.Timestamp("2017-01-01")


def sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while b := f.read(chunk):
            h.update(b)
    return h.hexdigest()


def paysim(path: Path = PAYSIM_FILE) -> pd.DataFrame:
    """PaySim -> normalized. ``label`` = isFraud; ``source_flag`` = isFlaggedFraud (never a feature).

    Not mapped: newbalanceOrig / newbalanceDest (written after the transfer; kept as ``post_*`` for audits only).
    Merchant ('M...') balances are always 0 in PaySim because the simulator does not track them, so they are mapped
    to NaN (unknown), not 0.
    """
    raw = pd.read_csv(path, dtype={"type": "category"})
    df = pd.DataFrame({
        "transaction_id": "PS-" + pd.Series(np.arange(1, len(raw) + 1), dtype=str),
        "timestamp": PAYSIM_BASE + pd.to_timedelta(raw["step"], unit="h"),
        "sender_account_id": raw["nameOrig"],
        "receiver_account_id": raw["nameDest"],
        "amount": raw["amount"].astype(float),
        "currency": None,
        "transaction_type": raw["type"].astype(str),
        "channel": None,
        "transaction_status": "COMPLETED",
        "sender_balance_before": raw["oldbalanceOrg"].astype(float),
        "receiver_balance_before": np.where(raw["nameDest"].str.startswith("M"), np.nan, raw["oldbalanceDest"]),
        "source_dataset": "paysim",
        "source_record_id": np.arange(2, len(raw) + 2),  # line number in the CSV
    })
    df["label"] = raw["isFraud"].astype(int)
    df["source_flag"] = raw["isFlaggedFraud"].astype(int)
    df["post_sender_balance"] = raw["newbalanceOrig"].astype(float)
    df["step"] = raw["step"].astype(int)
    return df


def amlsim_sample(name: str, root: Path = AMLSIM_DIR) -> tuple[pd.DataFrame, pd.DataFrame]:
    """AMLSim published sample -> (normalized transactions, nodes).

    The sample has no transaction labels, transaction types, balances or pattern IDs: ``label`` is NaN and only the
    node-level ``isFraud`` (account belongs to a generated laundering pattern) is available. ``fraudStep`` is the step
    at which a node joined a pattern - post-event information, never a feature. ``time`` is a simulation step; it is
    mapped to days from an arbitrary base date.
    """
    d = root / name
    tx = pd.read_csv(d / "transactions.csv")
    nodes = pd.read_csv(d / "nodes.csv")
    df = pd.DataFrame({
        "transaction_id": [f"AML-{name}-{i}" for i in range(1, len(tx) + 1)],
        "timestamp": AMLSIM_BASE + pd.to_timedelta(tx["time"], unit="D"),
        "sender_account_id": "N" + tx["sourceNodeId"].astype(str),
        "receiver_account_id": "N" + tx["targetNodeId"].astype(str),
        "amount": tx["value"].astype(float),
        "currency": None, "transaction_type": "TRANSFER", "channel": None, "transaction_status": "COMPLETED",
        "sender_balance_before": np.nan, "receiver_balance_before": np.nan,
        "source_dataset": f"amlsim:{name}", "source_record_id": np.arange(2, len(tx) + 2),
    })
    df["label"] = np.nan
    nodes = nodes.assign(account_id="N" + nodes["nodeid"].astype(str))
    return df, nodes


def forensic_frame(ledger) -> pd.DataFrame:
    """In-memory forensic ledger (ml.forensics.generator.ForensicLedger) -> normalized, with evaluation columns."""
    tx = ledger.transactions
    df = pd.DataFrame({
        "transaction_id": tx["transaction_id"], "timestamp": pd.to_datetime(tx["timestamp"], utc=True).dt.tz_localize(None),
        "sender_account_id": tx["origin_account_id"], "receiver_account_id": tx["destination_account_id"],
        "amount": tx["amount"].astype(float), "currency": tx["currency"], "transaction_type": tx["channel"].map(V2_CHANNEL_TYPE),
        "channel": tx["channel"], "transaction_status": tx["status"], "sender_balance_before": tx["origin_balance_before"],
        "receiver_balance_before": tx["dest_balance_before"], "source_dataset": f"forensic-scenarios:seed{ledger.config.seed}",
        "source_record_id": tx["transaction_id"],
    })
    df["label"] = tx["is_suspicious_scenario"].astype(int)
    df["scenario_id"] = tx["scenario_id"]
    return df.sort_values(["timestamp", "transaction_id"], kind="mergesort").reset_index(drop=True)


def check_columns(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in NORMALIZED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"adapter output is missing normalized columns: {missing}")
    return df
