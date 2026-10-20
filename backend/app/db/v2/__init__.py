"""V2 Database Module for FraudShield AI."""

from backend.app.db.v2.models import AccountModel, Base, TransactionModel
from backend.app.db.v2.session import (
    DEFAULT_V2_DB_FILE,
    get_v2_db,
    get_v2_engine,
    get_v2_sessionmaker,
    init_v2_db,
)

__all__ = [
    "AccountModel",
    "Base",
    "DEFAULT_V2_DB_FILE",
    "TransactionModel",
    "get_v2_db",
    "get_v2_engine",
    "get_v2_sessionmaker",
    "init_v2_db",
]
