"""Account intelligence and ledger querying service for FraudShield AI V2."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import distinct, func, or_, select, union
from sqlalchemy.orm import Session

try:
    from app.api.v2.schemas import (
        AccountProfileResponse,
        AccountSummaryMetrics,
        AccountTransactionsResponse,
        TransactionItem,
    )
    from app.db.v2.models import AccountModel, TransactionModel
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import (
        AccountProfileResponse,
        AccountSummaryMetrics,
        AccountTransactionsResponse,
        TransactionItem,
    )
    from backend.app.db.v2.models import AccountModel, TransactionModel


class AccountService:
    """Service providing 360° profile metrics and chronological ledger histories."""

    @staticmethod
    def get_account_profile(db: Session, account_id: str) -> Optional[AccountProfileResponse]:
        """Fetches account metadata and calculates ledger summary statistics."""
        account = db.scalar(select(AccountModel).where(AccountModel.account_id == account_id))
        if not account:
            return None

        # Incoming metrics
        in_row = db.execute(
            select(
                func.count(TransactionModel.transaction_id),
                func.coalesce(func.sum(TransactionModel.amount), 0.0),
            ).where(TransactionModel.destination_account_id == account_id)
        ).first()
        in_count = in_row[0] if in_row else 0
        in_amount = round(float(in_row[1]), 2) if in_row else 0.0

        # Outgoing metrics
        out_row = db.execute(
            select(
                func.count(TransactionModel.transaction_id),
                func.coalesce(func.sum(TransactionModel.amount), 0.0),
            ).where(TransactionModel.origin_account_id == account_id)
        ).first()
        out_count = out_row[0] if out_row else 0
        out_amount = round(float(out_row[1]), 2) if out_row else 0.0

        net_flow = round(in_amount - out_amount, 2)

        # Unique counterparties (union of senders and receivers)
        in_senders = select(TransactionModel.origin_account_id.label("cp_id")).where(
            TransactionModel.destination_account_id == account_id
        )
        out_receivers = select(TransactionModel.destination_account_id.label("cp_id")).where(
            TransactionModel.origin_account_id == account_id
        )
        all_cp = union(in_senders, out_receivers).subquery()
        unique_cp_count = db.scalar(select(func.count(all_cp.c.cp_id))) or 0

        # Activity timestamps
        first_act = db.scalar(
            select(func.min(TransactionModel.timestamp)).where(
                or_(
                    TransactionModel.origin_account_id == account_id,
                    TransactionModel.destination_account_id == account_id,
                )
            )
        )
        last_act = db.scalar(
            select(func.max(TransactionModel.timestamp)).where(
                or_(
                    TransactionModel.origin_account_id == account_id,
                    TransactionModel.destination_account_id == account_id,
                )
            )
        )

        metrics = AccountSummaryMetrics(
            total_incoming_txns=in_count,
            total_outgoing_txns=out_count,
            total_incoming_amount=in_amount,
            total_outgoing_amount=out_amount,
            net_flow=net_flow,
            unique_counterparties=unique_cp_count,
            first_activity_at=first_act.isoformat() if first_act else None,
            last_activity_at=last_act.isoformat() if last_act else None,
        )

        return AccountProfileResponse(
            account_id=account.account_id,
            customer_name=account.customer_name,
            customer_type=account.customer_type,
            kyc_tier=account.kyc_tier,
            phone_number=account.phone_number,
            email=account.email,
            upi_id=account.upi_id,
            tax_identifier=account.tax_identifier,
            initial_balance=round(account.initial_balance, 2),
            current_balance=round(account.current_balance, 2),
            account_opened_at=account.account_opened_at.isoformat() if account.account_opened_at else "",
            status=account.status,
            metrics=metrics,
        )

    @staticmethod
    def get_account_transactions(
        db: Session,
        account_id: str,
        direction: str = "all",
        channel: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        order: str = "desc",
    ) -> Optional[AccountTransactionsResponse]:
        """Returns paginated chronological transactions for an account."""
        # Check account existence
        exists = db.scalar(select(AccountModel.account_id).where(AccountModel.account_id == account_id))
        if not exists:
            return None

        # Build base filter
        if direction == "inbound":
            base_filter = TransactionModel.destination_account_id == account_id
        elif direction == "outbound":
            base_filter = TransactionModel.origin_account_id == account_id
        else:
            base_filter = or_(
                TransactionModel.origin_account_id == account_id,
                TransactionModel.destination_account_id == account_id,
            )

        filters = [base_filter]
        if channel:
            filters.append(TransactionModel.channel == channel)

        # Count total matching
        total = db.scalar(select(func.count(TransactionModel.transaction_id)).where(*filters)) or 0

        # Query items
        stmt = select(TransactionModel).where(*filters)
        if order.lower() == "asc":
            stmt = stmt.order_by(TransactionModel.timestamp.asc())
        else:
            stmt = stmt.order_by(TransactionModel.timestamp.desc())

        stmt = stmt.limit(limit).offset(offset)
        rows = db.scalars(stmt).all()

        items: list[TransactionItem] = []
        for r in rows:
            is_inbound = r.destination_account_id == account_id
            dir_str = "inbound" if is_inbound else "outbound"
            cp_id = r.origin_account_id if is_inbound else r.destination_account_id

            items.append(
                TransactionItem(
                    transaction_id=r.transaction_id,
                    timestamp=r.timestamp.isoformat(),
                    origin_account_id=r.origin_account_id,
                    destination_account_id=r.destination_account_id,
                    amount=round(r.amount, 2),
                    currency=r.currency,
                    channel=r.channel,
                    status=r.status,
                    origin_balance_before=round(r.origin_balance_before, 2),
                    origin_balance_after=round(r.origin_balance_after, 2),
                    dest_balance_before=round(r.dest_balance_before, 2),
                    dest_balance_after=round(r.dest_balance_after, 2),
                    direction=dir_str,
                    counterparty_account_id=cp_id,
                )
            )

        return AccountTransactionsResponse(
            account_id=account_id,
            total=total,
            limit=limit,
            offset=offset,
            transactions=items,
        )
