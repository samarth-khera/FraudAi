"""Database session and engine management.

Defaults to SQLite for local development; switch to PostgreSQL by setting
DATABASE_URL in the environment without modifying business logic.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Default SQLite database path in backend directory
DEFAULT_DB_FILE = Path(__file__).resolve().parent.parent.parent / "fraudshield.db"
DEFAULT_DATABASE_URL = f"sqlite:///{DEFAULT_DB_FILE}"

DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


class Base(DeclarativeBase):
    pass


connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
