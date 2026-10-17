"""Idempotent seed data loader for the synthetic demo scenario (FS-1042)."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import (
    AccountModel,
    AccountReviewStatusModel,
    AuditEventModel,
    FraudCaseModel,
    TransactionModel,
    utc_now,
)

logger = logging.getLogger("fraudshield.db.seed")

DEFAULT_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "data" / "fs_1042.json"


def seed_demo_data(db: Session, fixture_path: Path = DEFAULT_FIXTURE_PATH) -> bool:
    """Load synthetic demo data idempotently.

    Returns True if new data was seeded, False if demo case was already present.
    """
    if not fixture_path.is_file():
        logger.warning("Fixture file not found at %s; skipping seeding", fixture_path)
        return False

    raw = json.loads(fixture_path.read_text(encoding="utf-8"))

    # 1. Accounts
    for a in raw.get("accounts", []):
        existing_acc = db.query(AccountModel).filter_by(account_id=a["account_id"]).first()
        if not existing_acc:
            db.add(
                AccountModel(
                    account_id=a["account_id"],
                    label=a.get("label", a["account_id"]),
                    role=a.get("role", "unknown"),
                    is_synthetic=a.get("is_synthetic", True),
                )
            )
    db.flush()

    # 2. Transactions
    for t in raw.get("transactions", []):
        existing_tx = db.query(TransactionModel).filter_by(transaction_id=t["transaction_id"]).first()
        if not existing_tx:
            linkage = t.get("case_linkage")
            lineage = t.get("synthetic_lineage_metadata")
            db.add(
                TransactionModel(
                    transaction_id=t["transaction_id"],
                    timestamp=datetime.fromisoformat(t["timestamp"]),
                    sender_account_id=t["sender_account_id"],
                    receiver_account_id=t["receiver_account_id"],
                    amount=float(t["amount"]),
                    currency=t.get("currency", "INR"),
                    transaction_type=t["transaction_type"],
                    case_linkage_case_id=linkage["case_id"] if linkage else None,
                    case_linkage_type=linkage["linkage_type"] if linkage else None,
                    synthetic_lineage_case_id=lineage["case_id"] if lineage else None,
                    synthetic_lineage_attributed_amount=float(lineage["attributed_amount"])
                    if lineage
                    else None,
                    synthetic_lineage_basis=lineage.get("basis") if lineage else None,
                    synthetic_lineage_note=lineage.get("note") if lineage else None,
                )
            )
    db.flush()

    # 3. Cases
    seeded_any_case = False
    for c in raw.get("cases", []):
        case_id = c["case_id"]
        existing_case = db.query(FraudCaseModel).filter_by(case_id=case_id).first()
        if not existing_case:
            new_case = FraudCaseModel(
                case_id=case_id,
                reported_origin_transaction_id=c["reported_origin_transaction_id"],
                reported_amount=float(c["reported_amount"]),
                currency=c.get("currency", "INR"),
                reported_at=datetime.fromisoformat(c["reported_at"]),
                investigation_status=c.get("investigation_status", "under_investigation"),
                description=c.get("description", ""),
            )
            db.add(new_case)
            db.flush()

            # Record audit event for seeded case creation
            audit = AuditEventModel(
                case_id=case_id,
                action="case_created",
                performed_by="system_seeder",
                entity_type="case",
                entity_id=case_id,
                timestamp=utc_now(),
            )
            audit.details = {
                "source": "fs_1042.json",
                "reported_amount": float(c["reported_amount"]),
                "currency": c.get("currency", "INR"),
                "reported_origin_transaction_id": c["reported_origin_transaction_id"],
            }
            db.add(audit)
            seeded_any_case = True

    # 4. Account Review Statuses
    for r in raw.get("account_review_statuses", []):
        existing_rev = (
            db.query(AccountReviewStatusModel)
            .filter_by(case_id=r["case_id"], account_id=r["account_id"])
            .first()
        )
        if not existing_rev:
            db.add(
                AccountReviewStatusModel(
                    case_id=r["case_id"],
                    account_id=r["account_id"],
                    review_state=r.get("review_state", "not_reviewed"),
                    evidence_quality=r.get("evidence_quality", "not_assessed"),
                    notes=r.get("notes"),
                    reviewer_id="system_seeder",
                    automated_action_taken="none",
                )
            )

    db.commit()
    logger.info("Database seeded successfully (new case seeded: %s)", seeded_any_case)
    return seeded_any_case
