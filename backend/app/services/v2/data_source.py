"""Which transaction ledger the V2 APIs query, where it came from, and how fresh it is.

Every investigation reports this so a reader can tell synthetic demo data from institution records.
One deployment reads exactly one source; sources are never mixed.

Configuration (environment):
    FRAUDSHIELD_DATA_SOURCE              synthetic_demo_ledger (default) | authorized_institution_ledger
    FRAUDSHIELD_V2_DATABASE_URL          ledger database (default: data/v2_fraudshield.db, the synthetic ledger)
    FRAUDSHIELD_DATA_SOURCE_NAME         required for authorized_institution_ledger: institution / feed name
    FRAUDSHIELD_DATA_AUTHORIZATION_REF   required for authorized_institution_ledger: data-sharing agreement or
                                         approval reference under which the records may be analysed

An authorized source is a database in the V2 ledger schema loaded from an institution's own records
(see scripts/ingest_v2_data.py for the schema). No such feed is connected in this repository.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

try:
    from app.db.v2.models import AccountModel, TransactionModel
    from app.db.v2.session import DEFAULT_V2_DB_FILE, get_v2_database_url
except ModuleNotFoundError:
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.db.v2.session import DEFAULT_V2_DB_FILE, get_v2_database_url

SYNTHETIC = "synthetic_demo_ledger"
AUTHORIZED = "authorized_institution_ledger"
KNOWN_KINDS = (SYNTHETIC, AUTHORIZED)


class DataSourceUnavailable(Exception):
    """The configured source cannot be used. `code` is stable for API clients; `message` names the blocker."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class DataSourceConfig:
    kind: str
    name: str
    database_url: str
    authorization_ref: Optional[str]

    @property
    def is_synthetic(self) -> bool:
        return self.kind == SYNTHETIC


def _is_default_synthetic_db(url: str) -> bool:
    return url.startswith("sqlite") and Path(url.replace("sqlite:///", "")).resolve() == DEFAULT_V2_DB_FILE.resolve()


def load_config() -> DataSourceConfig:
    """Reads and validates the source configuration. Raises DataSourceUnavailable with the exact blocker."""
    kind = (os.environ.get("FRAUDSHIELD_DATA_SOURCE") or SYNTHETIC).strip()
    url = get_v2_database_url()
    if kind not in KNOWN_KINDS:
        raise DataSourceUnavailable(
            "data_source_misconfigured",
            f"FRAUDSHIELD_DATA_SOURCE is '{kind}', which is not a known source. Use one of: {', '.join(KNOWN_KINDS)}.",
        )
    if kind == SYNTHETIC:
        return DataSourceConfig(SYNTHETIC, "FraudShield synthetic demo ledger (generator seed 42)", url, None)

    name = (os.environ.get("FRAUDSHIELD_DATA_SOURCE_NAME") or "").strip()
    ref = (os.environ.get("FRAUDSHIELD_DATA_AUTHORIZATION_REF") or "").strip()
    missing = [k for k, v in (("FRAUDSHIELD_DATA_SOURCE_NAME", name), ("FRAUDSHIELD_DATA_AUTHORIZATION_REF", ref)) if not v]
    if missing:
        raise DataSourceUnavailable(
            "data_source_not_authorized",
            "An authorized institution ledger is configured but " + " and ".join(missing) + " is not set. "
            "Investigations will not run against institution data without a named source and authorization reference.",
        )
    if _is_default_synthetic_db(url):
        raise DataSourceUnavailable(
            "data_source_mismatch",
            "The source is declared as an authorized institution ledger, but FRAUDSHIELD_V2_DATABASE_URL points at the "
            "synthetic demo ledger. Refusing to label synthetic records as institution data.",
        )
    return DataSourceConfig(AUTHORIZED, name, url, ref)


def _database_label(url: str) -> tuple[str, str]:
    """(backend, label) without credentials or host names."""
    try:
        parsed = make_url(url)
    except Exception:  # noqa: BLE001 - never echo an unparseable URL, it may hold secrets
        return "unknown", "unparseable database URL"
    backend = parsed.get_backend_name()
    if backend == "sqlite":
        return backend, Path(parsed.database or "").name or "in-memory"
    return backend, parsed.database or "(database name not set)"


def _iso(ts: Optional[datetime]) -> Optional[str]:
    # Same convention as the other V2 endpoints: ledger timestamps are emitted as stored.
    return ts.isoformat() if ts is not None else None


def describe(db: Session, config: Optional[DataSourceConfig] = None) -> dict:
    """Source metadata from a fresh query. Raises DataSourceUnavailable if the ledger cannot be read or is empty."""
    config = config or load_config()
    bound_url = db.get_bind().url.render_as_string(hide_password=True)  # the database actually being queried
    backend, label = _database_label(bound_url)
    try:
        accounts = db.scalar(select(func.count()).select_from(AccountModel)) or 0
        txn_count, first_ts, last_ts = db.execute(
            select(func.count(), func.min(TransactionModel.timestamp), func.max(TransactionModel.timestamp))
        ).one()
    except SQLAlchemyError as exc:
        raise DataSourceUnavailable(
            "ledger_unavailable",
            f"The configured ledger ({backend}: {label}) could not be queried: {type(exc).__name__}. "
            "It may not have been initialized; for the demo ledger run scripts/render_build.sh or the generate/ingest scripts.",
        ) from exc
    if not accounts or not txn_count:
        raise DataSourceUnavailable(
            "ledger_empty",
            f"The configured ledger ({backend}: {label}) has {accounts} accounts and {txn_count or 0} transactions. "
            "There is nothing to investigate until it is loaded.",
        )

    built_at = None
    if backend == "sqlite" and label != "in-memory":
        path = Path(make_url(bound_url).database or "")
        if path.exists():
            built_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()

    if config.is_synthetic:
        freshness = (
            "Static synthetic snapshot regenerated from a fixed seed when the server is built. It is not a live feed: "
            "no new transactions arrive, and 'data as of' is the latest synthetic transaction time."
        )
        disclosure = "Synthetic demo data. No real customers, accounts or bank transactions are involved."
    else:
        freshness = "Institution ledger loaded into this database. 'Data as of' is the latest transaction it holds."
        disclosure = f"Institution records from {config.name}, analysed under authorization {config.authorization_ref}."

    return {
        "source_kind": config.kind,
        "source_name": config.name,
        "is_synthetic": config.is_synthetic,
        "real_bank_data": not config.is_synthetic,
        "authorization_reference": config.authorization_ref,
        "database_backend": backend,
        "database_label": label,
        "accounts_count": int(accounts),
        "transactions_count": int(txn_count),
        "earliest_transaction_at": _iso(first_ts),
        "data_as_of": _iso(last_ts),
        "snapshot_built_at": built_at,
        "queried_at": datetime.now(timezone.utc).isoformat(),
        "freshness_note": freshness,
        "disclosure": disclosure,
    }
