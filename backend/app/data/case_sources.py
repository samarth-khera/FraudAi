"""Which account dataset a case's account IDs belong to.

Cases normally carry their own small transaction store ("case_ledger"); their
account IDs (e.g. ``A100``) have no record in the V2 synthetic account ledger,
so V2 profiles and the account-level model must not be applied to them.

A fixture may declare ``"account_dataset": "v2_synthetic_ledger"`` when its
transactions are copied verbatim from that ledger (same transaction and
account IDs). Only then is it valid to look the case's accounts up in V2.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("fraudshield.case_sources")

DATA_DIR = Path(__file__).resolve().parent

CASE_LEDGER = "case_ledger"
V2_SYNTHETIC_LEDGER = "v2_synthetic_ledger"

_NOTES = {
    CASE_LEDGER: (
        "Accounts in this case exist only in the case's own transaction records. "
        "They have no record in the synthetic account ledger, so no account-level model assessment applies."
    ),
    V2_SYNTHETIC_LEDGER: (
        "Transactions in this case are copied from the synthetic account ledger with their original IDs, "
        "so each account's ledger history and account-level model assessment can be shown."
    ),
}


def fixture_paths() -> list[Path]:
    return sorted(DATA_DIR.glob("fs_*.json"))


@lru_cache(maxsize=1)
def _registry() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in fixture_paths():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("Could not read case fixture %s: %s", path.name, exc)
            continue
        dataset = raw.get("account_dataset", CASE_LEDGER)
        for case in raw.get("cases", []):
            out[case["case_id"]] = dataset
    return out


def account_dataset_for(case_id: str) -> str:
    return _registry().get(case_id, CASE_LEDGER)


def dataset_note_for(dataset: str) -> str:
    return _NOTES.get(dataset, _NOTES[CASE_LEDGER])
