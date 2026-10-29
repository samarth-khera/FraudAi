"""Shared test helpers."""

from __future__ import annotations

import atexit
import os
import tempfile
from datetime import datetime, timedelta
from decimal import Decimal

# Point the case database at a throwaway file before the app is imported, so test runs never
# write audit events or reviews into the local demo database (backend/fraudshield.db).
_TEST_DB_FD, _TEST_DB_PATH = tempfile.mkstemp(prefix="fraudshield_test_", suffix=".db")
os.close(_TEST_DB_FD)
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
atexit.register(lambda: os.path.exists(_TEST_DB_PATH) and os.remove(_TEST_DB_PATH))

import pytest
from fastapi.testclient import TestClient

from app.api.routes import get_repository
from app.main import create_app
from app.models.domain import (
    FraudCase,
    InvestigationStatus,
    SyntheticLineage,
    Transaction,
    TransactionType,
)
from app.repositories.case_repository import InMemoryCaseRepository

BASE = datetime(2026, 1, 12, 10, 0, 0)


def make_case(origin: str = "T001", amount: int = 50000) -> FraudCase:
    return FraudCase(
        case_id="FS-TEST", reported_origin_transaction_id=origin, reported_amount=amount,
        currency="INR", reported_at=BASE, investigation_status=InvestigationStatus.OPEN,
        description="test")


def tx(tid: str, minutes: int, sender: str, receiver: str, amount: int,
       lineage: int | None = None, case_id: str = "FS-TEST") -> Transaction:
    return Transaction(
        transaction_id=tid, timestamp=BASE + timedelta(minutes=minutes),
        sender_account_id=sender, receiver_account_id=receiver, amount=Decimal(amount),
        currency="INR", transaction_type=TransactionType.UPI,
        synthetic_lineage_metadata=(
            SyntheticLineage(case_id=case_id, attributed_amount=Decimal(lineage))
            if lineage is not None else None))


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture(scope="session")
def repo() -> InMemoryCaseRepository:
    return InMemoryCaseRepository.from_json()


@pytest.fixture
def custom_client():
    """Factory: client backed by a repository with custom transactions."""
    app = create_app()

    def _make(transactions: list[Transaction], case: FraudCase | None = None) -> TestClient:
        r = InMemoryCaseRepository([case or make_case()], transactions, [], [])
        app.dependency_overrides[get_repository] = lambda: r
        return TestClient(app)

    yield _make
    app.dependency_overrides.clear()
