"""Build the FS-2001 sample case fixture from the V2 synthetic account ledger.

The case starts from one reported transfer (TXN-0062181). Downstream transfers
are collected with a label-free rule an investigator could apply without
knowing the synthetic ground truth:

    For every account that received money in the case, include each outgoing
    transfer it made within WINDOW_HOURS of receiving it, up to MAX_HOPS hops.

Scenario tags, ground-truth labels and suspicious flags are never read, so the
fixture cannot leak the answer into the investigation.

Usage (from the repository root):
    python scripts/build_v2_sample_case.py
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
V2_DB = REPO_ROOT / "data" / "v2_fraudshield.db"
OUT = REPO_ROOT / "backend" / "app" / "data" / "fs_2001.json"

CASE_ID = "FS-2001"
ORIGIN_TXN = "TXN-0062181"
WINDOW_HOURS = 6
MAX_HOPS = 4

# Ledger channels that map directly onto the case store's transaction types.
CHANNEL_TO_TYPE = {"UPI": "UPI", "IMPS": "IMPS", "NEFT": "NEFT", "RTGS": "RTGS", "ATM_CASH_OUT": "ATM_CASH_OUT"}


def _ts(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace(" ", "T"))


def collect_case_transactions(con: sqlite3.Connection) -> list[sqlite3.Row]:
    cols = "transaction_id, timestamp, origin_account_id, destination_account_id, amount, currency, channel"
    origin = con.execute(f"SELECT {cols} FROM transactions WHERE transaction_id = ?", (ORIGIN_TXN,)).fetchone()
    if origin is None:
        raise SystemExit(f"{ORIGIN_TXN} not found in {V2_DB}")

    collected = [origin]
    frontier = [(origin["destination_account_id"], _ts(origin["timestamp"]), 1)]
    visited = {origin["origin_account_id"]}
    while frontier:
        account_id, received_at, hop = frontier.pop(0)
        if account_id in visited or hop > MAX_HOPS:
            continue
        visited.add(account_id)
        rows = con.execute(
            f"SELECT {cols} FROM transactions WHERE origin_account_id = ? AND timestamp > ? AND timestamp <= ? "
            "ORDER BY timestamp",
            (
                account_id,
                received_at.isoformat(sep=" "),
                (received_at + timedelta(hours=WINDOW_HOURS)).isoformat(sep=" "),
            ),
        ).fetchall()
        for r in rows:
            collected.append(r)
            frontier.append((r["destination_account_id"], _ts(r["timestamp"]), hop + 1))
    return collected


def build() -> dict:
    con = sqlite3.connect(V2_DB)
    con.row_factory = sqlite3.Row
    txns = collect_case_transactions(con)
    origin = txns[0]

    account_ids: list[str] = []
    for t in txns:
        for a in (t["origin_account_id"], t["destination_account_id"]):
            if a not in account_ids:
                account_ids.append(a)

    def role(acc: str) -> str:
        if acc == origin["origin_account_id"]:
            return "reporting_victim"
        if acc == origin["destination_account_id"]:
            return "reported_initial_receiver"
        sends = any(t["origin_account_id"] == acc for t in txns)
        return "intermediate_recipient" if sends else "recipient"

    labels = {
        "reporting_victim": "Reporting customer (synthetic)",
        "reported_initial_receiver": "Reported initial receiver (synthetic)",
        "intermediate_recipient": "Intermediate recipient (synthetic)",
        "recipient": "Recipient under review (synthetic)",
    }

    unknown_channels = {t["channel"] for t in txns} - set(CHANNEL_TO_TYPE)
    if unknown_channels:
        raise SystemExit(f"Unsupported channels in case flow: {sorted(unknown_channels)}")

    reported_amount = float(origin["amount"])
    reported_at = _ts(origin["timestamp"]) + timedelta(minutes=85)

    return {
        "_notice": (
            "SYNTHETIC DEMONSTRATION DATA built from the V2 synthetic account ledger "
            "(data/v2_fraudshield.db) by scripts/build_v2_sample_case.py. Transaction and account IDs are the "
            "ledger's own IDs. The complaint wording and report time are written for the demo; the transfers are not."
        ),
        "account_dataset": "v2_synthetic_ledger",
        "derivation": {
            "origin_transaction_id": ORIGIN_TXN,
            "rule": (
                f"Starting from the reported transfer, include every outgoing transfer an account made within "
                f"{WINDOW_HOURS} hours of receiving money in the case, up to {MAX_HOPS} hops."
            ),
            "excluded_inputs": ["scenario_id", "scenario_tag", "is_suspicious_scenario", "ground_truth_label"],
        },
        "cases": [
            {
                "case_id": CASE_ID,
                "reported_origin_transaction_id": ORIGIN_TXN,
                "reported_amount": reported_amount,
                "currency": origin["currency"],
                "reported_at": reported_at.isoformat(),
                "investigation_status": "open",
                "description": (
                    f"Sample complaint: customer {origin['origin_account_id']} reports being persuaded by a caller to "
                    f"send {reported_amount:,.0f} INR by {origin['channel']} to {origin['destination_account_id']}. "
                    "Downstream transfers come from the synthetic account ledger. Receiving money in this case "
                    "is not a finding of wrongdoing."
                ),
            }
        ],
        "accounts": [
            {"account_id": a, "label": labels[role(a)], "role": role(a), "is_synthetic": True} for a in account_ids
        ],
        "account_review_statuses": [
            {
                "account_id": a,
                "case_id": CASE_ID,
                "review_state": "reporting_victim" if role(a) == "reporting_victim" else "not_reviewed",
                "evidence_quality": "not_assessed",
                "notes": "Reporting customer." if role(a) == "reporting_victim" else None,
            }
            for a in account_ids
        ],
        "transactions": [
            {
                "transaction_id": t["transaction_id"],
                "timestamp": _ts(t["timestamp"]).isoformat(),
                "sender_account_id": t["origin_account_id"],
                "receiver_account_id": t["destination_account_id"],
                "amount": float(t["amount"]),
                "currency": t["currency"],
                "transaction_type": CHANNEL_TO_TYPE[t["channel"]],
                "case_linkage": (
                    {"case_id": CASE_ID, "linkage_type": "reported_origin"}
                    if t["transaction_id"] == ORIGIN_TXN
                    else None
                ),
                # Only the reported transfer carries an attributed amount: it is the complainant's claim.
                # Downstream transfers stay unattributed because the ledger cannot show which rupees moved.
                "synthetic_lineage_metadata": (
                    {
                        "case_id": CASE_ID,
                        "attributed_amount": reported_amount,
                        "basis": "synthetic_scenario_assumption",
                        "note": "Amount claimed in the complaint; equals the recorded transfer.",
                    }
                    if t["transaction_id"] == ORIGIN_TXN
                    else None
                ),
            }
            for t in txns
        ],
    }


if __name__ == "__main__":
    fixture = build()
    OUT.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} with {len(fixture['transactions'])} transactions and {len(fixture['accounts'])} accounts.")
