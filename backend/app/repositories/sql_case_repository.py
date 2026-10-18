"""SQLAlchemy-backed Case Repository.

Implements persistent case, account, transaction, review, and audit trail operations.
Works with SQLite locally and PostgreSQL in production without modifying business logic.
"""

from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db.models import (
    AccountModel,
    AccountReviewStatusModel,
    AuditEventModel,
    CaseTracePathModel,
    FraudCaseModel,
    TransactionModel,
    utc_now,
)
from app.models.domain import (
    Account,
    AccountReviewStatus,
    AccountRole,
    AttributionBasis,
    AuditEvent,
    CaseLinkage,
    EvidenceQuality,
    FraudCase,
    FundTracePath,
    InvestigationStatus,
    PathTermination,
    ReviewState,
    SyntheticLineage,
    Transaction,
    TransactionType,
)


class DuplicateEntityError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class EntityNotFoundError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _model_to_case(m: FraudCaseModel) -> FraudCase:
    return FraudCase(
        case_id=m.case_id,
        reported_origin_transaction_id=m.reported_origin_transaction_id,
        reported_amount=Decimal(str(m.reported_amount)),
        currency=m.currency,
        reported_at=m.reported_at,
        investigation_status=InvestigationStatus(m.investigation_status),
        description=m.description,
    )


def _model_to_account(m: AccountModel) -> Account:
    return Account(
        account_id=m.account_id,
        label=m.label,
        role=AccountRole(m.role),
        is_synthetic=m.is_synthetic,
    )


def _model_to_transaction(m: TransactionModel) -> Transaction:
    linkage = (
        CaseLinkage(case_id=m.case_linkage_case_id, linkage_type=m.case_linkage_type or "reported_origin")
        if m.case_linkage_case_id
        else None
    )
    lineage = (
        SyntheticLineage(
            case_id=m.synthetic_lineage_case_id,
            attributed_amount=Decimal(str(m.synthetic_lineage_attributed_amount)),
            basis=AttributionBasis(m.synthetic_lineage_basis or AttributionBasis.SYNTHETIC_SCENARIO_ASSUMPTION.value),
            note=m.synthetic_lineage_note,
        )
        if m.synthetic_lineage_case_id and m.synthetic_lineage_attributed_amount is not None
        else None
    )
    return Transaction(
        transaction_id=m.transaction_id,
        timestamp=m.timestamp,
        sender_account_id=m.sender_account_id,
        receiver_account_id=m.receiver_account_id,
        amount=Decimal(str(m.amount)),
        currency=m.currency,
        transaction_type=TransactionType(m.transaction_type),
        case_linkage=linkage,
        synthetic_lineage_metadata=lineage,
    )


def _model_to_review(
    m: AccountReviewStatusModel,
    extra: Optional[dict[str, Any]] = None,
) -> AccountReviewStatus:
    ext = extra or {}
    return AccountReviewStatus(
        account_id=m.account_id,
        case_id=m.case_id,
        review_state=ReviewState(m.review_state),
        evidence_quality=EvidenceQuality(m.evidence_quality),
        notes=m.notes,
        reviewer_id=m.reviewer_id,
        decision_reasons=list(ext.get("decision_reasons") or []),
        supporting_transaction_ids=list(ext.get("supporting_transaction_ids") or []),
        additional_info_needed=bool(ext.get("additional_info_needed", False)),
        automated_action_taken=m.automated_action_taken,
    )


def _model_to_audit(m: AuditEventModel) -> AuditEvent:
    return AuditEvent(
        event_id=m.event_id,
        case_id=m.case_id,
        timestamp=m.timestamp,
        action=m.action,
        performed_by=m.performed_by,
        entity_type=m.entity_type,
        entity_id=m.entity_id,
        details=m.details,
    )


class SqlCaseRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------------- Case methods ----------------
    def list_cases(self, skip: int = 0, limit: int = 50) -> tuple[list[FraudCase], int]:
        total = self.db.query(FraudCaseModel).count()
        rows = (
            self.db.query(FraudCaseModel)
            .order_by(desc(FraudCaseModel.reported_at))
            .offset(skip)
            .limit(limit)
            .all()
        )
        return [_model_to_case(r) for r in rows], total

    def get_case(self, case_id: str) -> Optional[FraudCase]:
        m = self.db.query(FraudCaseModel).filter_by(case_id=case_id).first()
        return _model_to_case(m) if m else None

    def create_case(
        self,
        case: FraudCase,
        initial_audit_user: str = "analyst_placeholder",
    ) -> FraudCase:
        if self.db.query(FraudCaseModel).filter_by(case_id=case.case_id).first():
            raise DuplicateEntityError(
                "case_already_exists", f"Case '{case.case_id}' already exists."
            )

        m = FraudCaseModel(
            case_id=case.case_id,
            reported_origin_transaction_id=case.reported_origin_transaction_id,
            reported_amount=float(case.reported_amount),
            currency=case.currency,
            reported_at=case.reported_at,
            investigation_status=case.investigation_status.value,
            description=case.description,
        )
        self.db.add(m)
        self.db.flush()

        # Audit event (append-only)
        audit = AuditEventModel(
            case_id=case.case_id,
            action="case_created",
            performed_by=initial_audit_user,
            entity_type="case",
            entity_id=case.case_id,
            timestamp=utc_now(),
        )
        audit.details = {
            "reported_origin_transaction_id": case.reported_origin_transaction_id,
            "reported_amount": float(case.reported_amount),
            "currency": case.currency,
            "investigation_status": case.investigation_status.value,
        }
        self.db.add(audit)
        self.db.commit()
        return _model_to_case(m)

    def update_case(
        self,
        case_id: str,
        status: Optional[InvestigationStatus] = None,
        description: Optional[str] = None,
        user_id: str = "analyst_placeholder",
    ) -> FraudCase:
        m = self.db.query(FraudCaseModel).filter_by(case_id=case_id).first()
        if not m:
            raise EntityNotFoundError("case_not_found", f"Case '{case_id}' not found.")

        changes: dict[str, Any] = {}
        if status is not None and status.value != m.investigation_status:
            changes["investigation_status"] = {"old": m.investigation_status, "new": status.value}
            m.investigation_status = status.value
        if description is not None and description != m.description:
            changes["description"] = {"old": m.description, "new": description}
            m.description = description

        if changes:
            m.updated_at = utc_now()
            audit = AuditEventModel(
                case_id=case_id,
                action="case_metadata_updated",
                performed_by=user_id,
                entity_type="case",
                entity_id=case_id,
                timestamp=utc_now(),
            )
            audit.details = changes
            self.db.add(audit)
            self.db.commit()
            self.db.refresh(m)

        return _model_to_case(m)

    # ---------------- Accounts ----------------
    def get_accounts(self) -> list[Account]:
        return [_model_to_account(a) for a in self.db.query(AccountModel).all()]

    def get_account(self, account_id: str) -> Optional[Account]:
        a = self.db.query(AccountModel).filter_by(account_id=account_id).first()
        return _model_to_account(a) if a else None

    def upsert_account(self, account: Account) -> Account:
        existing = self.db.query(AccountModel).filter_by(account_id=account.account_id).first()
        if existing:
            existing.label = account.label
            existing.role = account.role.value
            existing.is_synthetic = account.is_synthetic
        else:
            existing = AccountModel(
                account_id=account.account_id,
                label=account.label,
                role=account.role.value,
                is_synthetic=account.is_synthetic,
            )
            self.db.add(existing)
        self.db.commit()
        self.db.refresh(existing)
        return _model_to_account(existing)

    # ---------------- Transactions ----------------
    def get_transactions(self, case_id: Optional[str] = None) -> list[Transaction]:
        # Return all transactions (or filtered by case if linkage/lineage matches)
        q = self.db.query(TransactionModel).order_by(TransactionModel.timestamp)
        return [_model_to_transaction(t) for t in q.all()]

    def add_transactions(
        self,
        transactions: list[Transaction],
        user_id: str = "system",
        case_id: Optional[str] = None,
    ) -> list[Transaction]:
        added: list[TransactionModel] = []
        for t in transactions:
            # Ensure sender and receiver accounts exist in DB to satisfy foreign keys
            for aid in (t.sender_account_id, t.receiver_account_id):
                if not self.db.query(AccountModel).filter_by(account_id=aid).first():
                    self.db.add(
                        AccountModel(
                            account_id=aid,
                            label=f"Account {aid}",
                            role="unknown",
                            is_synthetic=True,
                        )
                    )
            self.db.flush()

            existing = self.db.query(TransactionModel).filter_by(transaction_id=t.transaction_id).first()
            if existing:
                # Check for conflicting details
                if (
                    existing.sender_account_id != t.sender_account_id
                    or existing.receiver_account_id != t.receiver_account_id
                    or abs(existing.amount - float(t.amount)) > 1e-6
                ):
                    raise DuplicateEntityError(
                        "duplicate_transaction_conflicting",
                        f"Transaction '{t.transaction_id}' already exists with conflicting details.",
                    )
                # Identical duplicate: skip re-inserting
                continue

            linkage = t.case_linkage
            lineage = t.synthetic_lineage_metadata
            tm = TransactionModel(
                transaction_id=t.transaction_id,
                timestamp=t.timestamp,
                sender_account_id=t.sender_account_id,
                receiver_account_id=t.receiver_account_id,
                amount=float(t.amount),
                currency=t.currency,
                transaction_type=t.transaction_type.value,
                case_linkage_case_id=linkage.case_id if linkage else None,
                case_linkage_type=linkage.linkage_type if linkage else None,
                synthetic_lineage_case_id=lineage.case_id if lineage else None,
                synthetic_lineage_attributed_amount=float(lineage.attributed_amount) if lineage else None,
                synthetic_lineage_basis=lineage.basis.value if lineage else None,
                synthetic_lineage_note=lineage.note if lineage else None,
            )
            self.db.add(tm)
            added.append(tm)

        self.db.flush()
        if added and case_id:
            audit = AuditEventModel(
                case_id=case_id,
                action="transactions_added",
                performed_by=user_id,
                entity_type="transaction",
                entity_id=case_id,
                timestamp=utc_now(),
            )
            audit.details = {"transaction_ids": [m.transaction_id for m in added]}
            self.db.add(audit)

        self.db.commit()
        return [_model_to_transaction(m) for m in added]

    # ---------------- Review Status ----------------
    def get_review_statuses(self, case_id: str) -> list[AccountReviewStatus]:
        rows = self.db.query(AccountReviewStatusModel).filter_by(case_id=case_id).all()
        review_events = (
            self.db.query(AuditEventModel)
            .filter_by(case_id=case_id, action="account_review_recorded")
            .order_by(AuditEventModel.timestamp.asc(), AuditEventModel.event_id.asc())
            .all()
        )
        latest_extra_by_acct: dict[str, dict[str, Any]] = {}
        for ev in review_events:
            d = ev.details
            if isinstance(d, dict) and d.get("account_id"):
                latest_extra_by_acct[str(d["account_id"])] = d
        return [_model_to_review(r, latest_extra_by_acct.get(r.account_id)) for r in rows]

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
        case = self.db.query(FraudCaseModel).filter_by(case_id=case_id).first()
        if not case:
            raise EntityNotFoundError("case_not_found", f"Case '{case_id}' not found.")

        # Ensure account exists in accounts table
        if not self.db.query(AccountModel).filter_by(account_id=account_id).first():
            self.db.add(AccountModel(account_id=account_id, label=account_id, role="unknown", is_synthetic=True))
            self.db.flush()

        rev = (
            self.db.query(AccountReviewStatusModel)
            .filter_by(case_id=case_id, account_id=account_id)
            .first()
        )
        old_state = rev.review_state if rev else None
        if rev:
            rev.review_state = review_state.value
            rev.evidence_quality = evidence_quality.value
            rev.notes = notes
            rev.reviewer_id = reviewer_id
            rev.updated_at = utc_now()
        else:
            rev = AccountReviewStatusModel(
                case_id=case_id,
                account_id=account_id,
                review_state=review_state.value,
                evidence_quality=evidence_quality.value,
                notes=notes,
                reviewer_id=reviewer_id,
                automated_action_taken="none",
            )
            self.db.add(rev)

        self.db.flush()

        reasons = [r.strip() for r in (decision_reasons or []) if r and r.strip()]
        tx_ids = [t.strip() for t in (supporting_transaction_ids or []) if t and t.strip()]

        # Audit event (append-only)
        audit = AuditEventModel(
            case_id=case_id,
            action="account_review_recorded",
            performed_by=reviewer_id,
            entity_type="account_review",
            entity_id=f"{case_id}:{account_id}",
            timestamp=utc_now(),
        )
        extra_details = {
            "account_id": account_id,
            "old_review_state": old_state,
            "new_review_state": review_state.value,
            "evidence_quality": evidence_quality.value,
            "notes": notes,
            "decision_reasons": reasons,
            "supporting_transaction_ids": tx_ids,
            "additional_info_needed": bool(additional_info_needed),
            "automated_action_taken": "none",
        }
        audit.details = extra_details
        self.db.add(audit)
        self.db.commit()
        self.db.refresh(rev)
        return _model_to_review(rev, extra_details)


    # ---------------- Audit Trail ----------------
    def get_audit_events(self, case_id: str) -> list[AuditEvent]:
        case = self.db.query(FraudCaseModel).filter_by(case_id=case_id).first()
        if not case:
            raise EntityNotFoundError("case_not_found", f"Case '{case_id}' not found.")
        rows = (
            self.db.query(AuditEventModel)
            .filter_by(case_id=case_id)
            .order_by(AuditEventModel.timestamp.asc(), AuditEventModel.event_id.asc())
            .all()
        )
        return [_model_to_audit(r) for r in rows]

    def record_audit_event(
        self,
        case_id: str,
        action: str,
        performed_by: str,
        entity_type: str,
        entity_id: str,
        details: Optional[dict[str, Any]] = None,
    ) -> AuditEvent:
        audit = AuditEventModel(
            case_id=case_id,
            action=action,
            performed_by=performed_by,
            entity_type=entity_type,
            entity_id=entity_id,
            timestamp=utc_now(),
        )
        audit.details = details
        self.db.add(audit)
        self.db.commit()
        self.db.refresh(audit)
        return _model_to_audit(audit)

    # ---------------- Trace Paths ----------------
    def save_trace_paths(self, case_id: str, paths: list[FundTracePath]) -> None:
        # Clear previous paths for this case to avoid duplicates on re-tracing
        self.db.query(CaseTracePathModel).filter_by(case_id=case_id).delete()
        for p in paths:
            m = CaseTracePathModel(
                case_id=case_id,
                path_id=p.path_id,
                account_ids_json=json.dumps(p.account_ids),
                transaction_ids_json=json.dumps(p.transaction_ids),
                transaction_amounts_json=json.dumps([float(x) for x in p.transaction_amounts]),
                hop_count=p.hop_count,
                started_at=p.started_at,
                ended_at=p.ended_at,
                terminal_account_id=p.terminal_account_id,
                termination_reason=p.termination_reason.value,
                max_attributable_amount=float(p.max_attributable_amount) if p.max_attributable_amount is not None else None,
                attribution_status=p.attribution_status,
            )
            self.db.add(m)
        self.db.commit()

        # Audit event for persisting trace computation
        self.record_audit_event(
            case_id=case_id,
            action="trace_paths_persisted",
            performed_by="tracer_service",
            entity_type="trace_paths",
            entity_id=case_id,
            details={"path_count": len(paths)},
        )

    def get_trace_paths(self, case_id: str) -> list[FundTracePath]:
        rows = self.db.query(CaseTracePathModel).filter_by(case_id=case_id).all()
        out: list[FundTracePath] = []
        for r in rows:
            out.append(
                FundTracePath(
                    path_id=r.path_id,
                    account_ids=json.loads(r.account_ids_json),
                    transaction_ids=json.loads(r.transaction_ids_json),
                    transaction_amounts=[Decimal(str(x)) for x in json.loads(r.transaction_amounts_json)],
                    hop_count=r.hop_count,
                    started_at=r.started_at,
                    ended_at=r.ended_at,
                    terminal_account_id=r.terminal_account_id,
                    termination_reason=PathTermination(r.termination_reason),
                    max_attributable_amount=Decimal(str(r.max_attributable_amount)) if r.max_attributable_amount is not None else None,
                    attribution_status=r.attribution_status,
                )
            )
        return out
