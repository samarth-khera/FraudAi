"""V2 Database session and engine configuration.

Isolated from the legacy V1 database (backend/fraudshield.db).
Defaults to SQLite with WAL mode for local high-throughput development,
with full capability to connect to PostgreSQL via FRAUDSHIELD_V2_DATABASE_URL.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Default isolated V2 SQLite database path in repository root data/ directory
PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_V2_DB_FILE = PROJECT_ROOT / "data" / "v2_fraudshield.db"
DEFAULT_V2_DATABASE_URL = f"sqlite:///{DEFAULT_V2_DB_FILE}"

V1_DB_NAME = "fraudshield.db"


class Base(DeclarativeBase):
    """Declarative base for all V2 domain and ledger tables."""
    pass


def get_v2_database_url() -> str:
    """Retrieves the active V2 database connection URL from environment or default."""
    url = os.environ.get("FRAUDSHIELD_V2_DATABASE_URL") or os.environ.get("DATABASE_URL_V2")
    if not url:
        return DEFAULT_V2_DATABASE_URL
    return url


def validate_not_v1_database(url_or_path: str) -> None:
    """Security guard: Prevents pointing V2 database operations to the legacy V1 database."""
    cleaned = str(url_or_path).strip().lower()
    if cleaned.endswith(V1_DB_NAME) and not cleaned.endswith(f"v2_{V1_DB_NAME}"):
        raise ValueError(
            f"Safety Violation: Cannot point V2 database operations at legacy V1 database ({url_or_path}). "
            f"V2 must use an isolated database (e.g., {DEFAULT_V2_DB_FILE})."
        )


def get_v2_engine(db_url: str | None = None) -> Engine:
    """Creates a configured SQLAlchemy Engine for V2 with performance pragmas."""
    active_url = db_url or get_v2_database_url()
    validate_not_v1_database(active_url)

    connect_args: dict[str, bool] = {}
    is_sqlite = active_url.startswith("sqlite")

    if is_sqlite:
        connect_args["check_same_thread"] = False
        # Ensure parent directory exists for file-based SQLite
        if not active_url.startswith("sqlite:///:memory:"):
            db_path = Path(active_url.replace("sqlite:///", ""))
            db_path.parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        active_url,
        connect_args=connect_args,
        pool_pre_ping=True,
    )

    if is_sqlite:
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

    return engine


def get_v2_sessionmaker(engine: Engine | None = None) -> sessionmaker[Session]:
    """Returns a sessionmaker bound to the V2 engine."""
    active_engine = engine or get_v2_engine()
    return sessionmaker(autocommit=False, autoflush=False, bind=active_engine)


def init_v2_db(engine: Engine | None = None) -> None:
    """Creates all V2 schema tables if they do not exist."""
    active_engine = engine or get_v2_engine()
    Base.metadata.create_all(bind=active_engine)


def get_v2_db(engine: Engine | None = None) -> Generator[Session, None, None]:
    """Dependency / context provider yielding a V2 database session."""
    session_factory = get_v2_sessionmaker(engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
