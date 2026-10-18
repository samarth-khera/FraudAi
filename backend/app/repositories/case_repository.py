"""Case data access layer.

Protocol defining repository operations, with InMemoryCaseRepository for test mocks
and SqlCaseRepository (in sql_case_repository.py) for persistent database storage.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Protocol

from app.db.models import utc_now
from app.models.domain import (
    Account,
    AccountReviewStatus,
    AuditEvent,
    EvidenceQuality,
    FraudCase,
    FundTracePath,
    InvestigationStatus,
    ReviewState,
    Transaction,
)

DEFAULT_FIXTURE = Path(__file__).resolve().parent.parent / "data" / "fs_1042.json"


class CaseRepository(Protocol):
    def list_cases(self, skip: int = 0, limit: int = 50) -> tuple[list[FraudCase], int]: ...
    def get_case(self, case_id: str) -> Optional[FraudCase]: ...
    def get_transactions(self, case_id: Optional[str] = None) -> list[Transaction]: ...
    def get_accounts(self) -> list[Account]: ...
    def get_review_statuses(self, case_id: str) -> list[AccountReviewStatus]: ...
    def create_case(self, case: FraudCase, initial_audit_user: str = "analyst_placeholder") -> FraudCase: ...
    def update_case(
        self,
        case_id: str,
        status: Optional[InvestigationStatus] = None,
        description: Optional[str] = None,
        user_id: str = "analyst_placeholder",
    ) -> FraudCase: ...
    def update_account_review(
        self,
        case_id: str,
        account_id: str,
        review_state: ReviewState,
        evidence_quality: EvidenceQuality = EvidenceQuality.NOT_ASSESSED,
        notes: Optional[str] = None,
        reviewer_id: str = "analyst_placeholder",
        decision_reasons: Optional[list[str]] = None,
        supporting_transaction_ids: Optional[list[str]] = None,
        additional_info_needed: bool = False,
    ) -> AccountReviewStatus: ...
    def add_transactions(
        self,
        transactions: list[Transaction],
        user_id: str = "system",
        case_id: Optional[str] = None,
    ) -> list[Transaction]: ...
    def get_audit_events(self, case_id: str) -> list[AuditEvent]: ...
    def record_audit_event(
        self,
        case_id: str,
        action: str,
        performed_by: str,
        entity_type: str,
        entity_id: str,
        details: Optional[dict[str, Any]] = None,
    ) -> AuditEvent: ...
    def save_trace_paths(self, case_id: str, paths: list[FundTracePath]) -> None: ...


class InMemoryCaseRepository:
    def __init__(
        self,
        cases: list[FraudCase],
        transactions: list[Transaction],
        accounts: list[Account],
        review_statuses: list[AccountReviewStatus],
        audit_events: Optional[list[AuditEvent]] = None,
    ) -> None:
        self._cases = {c.case_id: c for c in cases}
        self._transactions = list(transactions)
        self._accounts = {a.account_id: a for a in accounts}
        self._reviews = {(r.case_id, r.account_id): r for r in review_statuses}
        self._audits: list[AuditEvent] = list(audit_events or [])
        self._paths: dict[str, list[FundTracePath]] = {}

    @classmethod
    def from_json(cls, path: Path = DEFAULT_FIXTURE) -> "InMemoryCaseRepository":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            cases=[FraudCase(**c) for c in raw.get("cases", [])],
            transactions=[Transaction(**t) for t in raw.get("transactions", [])],
            accounts=[Account(**a) for a in raw.get("accounts", [])],
            review_statuses=[AccountReviewStatus(**r) for r in raw.get("account_review_statuses", [])],
        )

    def list_cases(self, skip: int = 0, limit: int = 50) -> tuple[list[FraudCase], int]:
        all_cases = list(self._cases.values())
        return all_cases[skip : skip + limit], len(all_cases)

    def get_case(self, case_id: str) -> Optional[FraudCase]:
        return self._cases.get(case_id)

    def get_transactions(self, case_id: Optional[str] = None) -> list[Transaction]:
        return list(self._transactions)

    def get_accounts(self) -> list[Account]:
        return list(self._accounts.values())

    def get_review_statuses(self, case_id: str) -> list[AccountReviewStatus]:
        return [r for r in self._reviews.values() if r.case_id == case_id]

    def create_case(
        self,
        case: FraudCase,
        initial_audit_user: str = "analyst_placeholder",
    ) -> FraudCase:
        from app.repositories.sql_case_repository import DuplicateEntityError
        if case.case_id in self._cases:
            raise DuplicateEntityError("case_already_exists", f"Case '{case.case_id}' already exists.")
        self._cases[case.case_id] = case
        self.record_audit_event(
            case_id=case.case_id,
            action="case_created",
            performed_by=initial_audit_user,
            entity_type="case",
            entity_id=case.case_id,
            details={"reported_origin_transaction_id": case.reported_origin_transaction_id},
        )
        return case

    def update_case(
        self,
        case_id: str,
        status: Optional[InvestigationStatus] = None,
        description: Optional[str] = None,
        user_id: str = "analyst_placeholder",
    ) -> FraudCase:
        from app.repositories.sql_case_repository import EntityNotFoundError
        c = self._cases.get(case_id)
        if not c:
            raise EntityNotFoundError("case_not_found", f"Case '{case_id}' not found.")
        updated_data = c.model_dump()
        if status is not None:
            updated_data["investigation_status"] = status
        if description is not None:
            updated_data["description"] = description
        updated = FraudCase(**updated_data)
        self._cases[case_id] = updated
        self.record_audit_event(
            case_id=case_id,
            action="case_metadata_updated",
            performed_by=user_id,
            entity_type="case",
            entity_id=case_id,
            details={"investigation_status": status.value if status else None},
        )
        return updated

    def update_account_review(
        self,
        case_id: str,
        account_id: str,
        review_state: ReviewState,
        evidence_quality: EvidenceQuality = EvidenceQuality.NOT_ASSESSED,
        notes: Optional[str] = None,
        reviewer_id: str = "analyst_placeholder",
        decision_reasons: Optional[list[str]] = None,
        supporting_transaction_ids: Optional[list[str]] = None,
        additional_info_needed: bool = False,
    ) -> AccountReviewStatus:
        from app.repositories.sql_case_repository import EntityNotFoundError
        if case_id not in self._cases:
            raise EntityNotFoundError("case_not_found", f"Case '{case_id}' not found.")
        prev = self._reviews.get((case_id, account_id))
        old_state = prev.review_state.value if prev else None
        reasons = [r.strip() for r in (decision_reasons or []) if r and r.strip()]
        tx_ids = [t.strip() for t in (supporting_transaction_ids or []) if t and t.strip()]
        rev = AccountReviewStatus(
            case_id=case_id,
            account_id=account_id,
            review_state=review_state,
            evidence_quality=evidence_quality,
            notes=notes,
            reviewer_id=reviewer_id,
            decision_reasons=reasons,
            supporting_transaction_ids=tx_ids,
            additional_info_needed=bool(additional_info_needed),
            automated_action_taken="none",
        )
        self._reviews[(case_id, account_id)] = rev
        self.record_audit_event(
            case_id=case_id,
            action="account_review_recorded",
            performed_by=reviewer_id,
            entity_type="account_review",
            entity_id=f"{case_id}:{account_id}",
            details={
                "account_id": account_id,
                "old_review_state": old_state,
                "new_review_state": review_state.value,
                "evidence_quality": evidence_quality.value,
                "notes": notes,
                "decision_reasons": reasons,
                "supporting_transaction_ids": tx_ids,
                "additional_info_needed": bool(additional_info_needed),
                "automated_action_taken": "none",
            },
        )
        return rev


    def add_transactions(
        self,
        transactions: list[Transaction],
        user_id: str = "system",
        case_id: Optional[str] = None,
    ) -> list[Transaction]:
        self._transactions.extend(transactions)
        if case_id:
            self.record_audit_event(
                case_id=case_id,
                action="transactions_added",
                performed_by=user_id,
                entity_type="transactions",
                entity_id=case_id,
                details={"added_count": len(transactions)},
            )
        return transactions

    def get_audit_events(self, case_id: str) -> list[AuditEvent]:
        from app.repositories.sql_case_repository import EntityNotFoundError
        if case_id not in self._cases:
            raise EntityNotFoundError("case_not_found", f"Case '{case_id}' not found.")
        return [e for e in self._audits if e.case_id == case_id]

    def record_audit_event(
        self,
        case_id: str,
        action: str,
        performed_by: str,
        entity_type: str,
        entity_id: str,
        details: Optional[dict[str, Any]] = None,
    ) -> AuditEvent:
        event = AuditEvent(
            event_id=len(self._audits) + 1,
            case_id=case_id,
            timestamp=utc_now(),
            action=action,
            performed_by=performed_by,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
        )
        self._audits.append(event)
        return event

    def save_trace_paths(self, case_id: str, paths: list[FundTracePath]) -> None:
        self._paths[case_id] = paths
        self.record_audit_event(
            case_id=case_id,
            action="trace_paths_persisted",
            performed_by="tracer_service",
            entity_type="trace_paths",
            entity_id=case_id,
            details={"path_count": len(paths)},
        )
