"""Case data access layer.

An in-memory repository loaded from JSON fixtures. Swap this class for a
PostgreSQL-backed implementation later without touching routes or services.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, Protocol

from app.models.domain import Account, AccountReviewStatus, FraudCase, Transaction

DEFAULT_FIXTURE = Path(__file__).resolve().parent.parent / "data" / "fs_1042.json"


class CaseRepository(Protocol):
    def list_cases(self) -> list[FraudCase]: ...
    def get_case(self, case_id: str) -> Optional[FraudCase]: ...
    def get_transactions(self) -> list[Transaction]: ...
    def get_accounts(self) -> list[Account]: ...
    def get_review_statuses(self, case_id: str) -> list[AccountReviewStatus]: ...


class InMemoryCaseRepository:
    def __init__(
        self,
        cases: list[FraudCase],
        transactions: list[Transaction],
        accounts: list[Account],
        review_statuses: list[AccountReviewStatus],
    ) -> None:
        self._cases = {c.case_id: c for c in cases}
        self._transactions = list(transactions)
        self._accounts = list(accounts)
        self._reviews = list(review_statuses)

    @classmethod
    def from_json(cls, path: Path = DEFAULT_FIXTURE) -> "InMemoryCaseRepository":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            cases=[FraudCase(**c) for c in raw.get("cases", [])],
            transactions=[Transaction(**t) for t in raw.get("transactions", [])],
            accounts=[Account(**a) for a in raw.get("accounts", [])],
            review_statuses=[AccountReviewStatus(**r) for r in raw.get("account_review_statuses", [])],
        )

    def list_cases(self) -> list[FraudCase]:
        return list(self._cases.values())

    def get_case(self, case_id: str) -> Optional[FraudCase]:
        return self._cases.get(case_id)

    def get_transactions(self) -> list[Transaction]:
        return list(self._transactions)

    def get_accounts(self) -> list[Account]:
        return list(self._accounts)

    def get_review_statuses(self, case_id: str) -> list[AccountReviewStatus]:
        return [r for r in self._reviews if r.case_id == case_id]
