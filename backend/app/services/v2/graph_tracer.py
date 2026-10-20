"""Forensic fund tracing and multi-hop graph traversal engine for FraudShield AI V2."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    from app.api.v2.schemas import (
        GraphEdge,
        GraphNode,
        TraceGraphResponse,
    )
    from app.db.v2.models import AccountModel, TransactionModel
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import (
        GraphEdge,
        GraphNode,
        TraceGraphResponse,
    )
    from backend.app.db.v2.models import AccountModel, TransactionModel


class ForensicGraphTracer:
    """Deterministic, cycle-safe multi-hop graph tracer with exposure guardrails."""

    @staticmethod
    def trace_account_funds(
        db: Session,
        account_id: str,
        direction: str = "outgoing",
        max_depth: int = 3,
        max_nodes: int = 50,
        min_amount: float = 0.0,
        time_window_hours: Optional[float] = None,
    ) -> Optional[TraceGraphResponse]:
        """Performs a multi-hop breadth-first traversal starting from account_id."""
        # 1. Fetch root account
        root = db.scalar(select(AccountModel).where(AccountModel.account_id == account_id))
        if not root:
            return None

        # Container for graph nodes and edges
        nodes_map: dict[str, GraphNode] = {
            root.account_id: GraphNode(
                account_id=root.account_id,
                customer_name=root.customer_name,
                customer_type=root.customer_type,
                kyc_tier=root.kyc_tier,
                current_balance=round(root.current_balance, 2),
                hop_distance=0,
                is_root=True,
            )
        }
        edges_list: list[GraphEdge] = []
        seen_edges: set[str] = set()

        # Queue contains: (current_account_id, current_hop, parent_timestamp)
        queue: deque[tuple[str, int, Optional[datetime]]] = deque([(root.account_id, 0, None)])
        max_depth_reached = 0
        is_truncated = False
        truncation_reason: Optional[str] = None

        while queue:
            curr_id, curr_hop, parent_ts = queue.popleft()
            max_depth_reached = max(max_depth_reached, curr_hop)

            if curr_hop >= max_depth:
                is_truncated = True
                truncation_reason = f"Configured max_depth limit of {max_depth} hops reached."
                continue

            if len(nodes_map) >= max_nodes:
                is_truncated = True
                truncation_reason = f"Configured max_nodes limit of {max_nodes} accounts reached."
                break

            # ------------------------------------------------------------------
            # Outgoing Fund Flow Traversal
            # ------------------------------------------------------------------
            if direction in ("outgoing", "both"):
                stmt = (
                    select(TransactionModel)
                    .where(
                        TransactionModel.origin_account_id == curr_id,
                        TransactionModel.amount >= min_amount,
                    )
                    .order_by(TransactionModel.timestamp.asc())
                )

                if parent_ts is not None:
                    stmt = stmt.where(TransactionModel.timestamp >= parent_ts)
                    if time_window_hours is not None:
                        max_ts = parent_ts + timedelta(hours=time_window_hours)
                        stmt = stmt.where(TransactionModel.timestamp <= max_ts)

                out_txns = db.scalars(stmt).all()
                for txn in out_txns:
                    if txn.transaction_id in seen_edges:
                        continue
                    seen_edges.add(txn.transaction_id)

                    dest_id = txn.destination_account_id
                    is_cycle = dest_id in nodes_map

                    edge = GraphEdge(
                        transaction_id=txn.transaction_id,
                        origin_account_id=txn.origin_account_id,
                        destination_account_id=txn.destination_account_id,
                        amount=round(txn.amount, 2),
                        currency=txn.currency,
                        channel=txn.channel,
                        timestamp=txn.timestamp.isoformat(),
                        hop=curr_hop + 1,
                        is_cycle=is_cycle,
                    )
                    edges_list.append(edge)

                    # Expand node if not already added
                    if dest_id not in nodes_map:
                        if len(nodes_map) < max_nodes:
                            dest_acc = db.scalar(
                                select(AccountModel).where(AccountModel.account_id == dest_id)
                            )
                            if dest_acc:
                                nodes_map[dest_id] = GraphNode(
                                    account_id=dest_acc.account_id,
                                    customer_name=dest_acc.customer_name,
                                    customer_type=dest_acc.customer_type,
                                    kyc_tier=dest_acc.kyc_tier,
                                    current_balance=round(dest_acc.current_balance, 2),
                                    hop_distance=curr_hop + 1,
                                    is_root=False,
                                )
                                # Continue BFS if not cycle
                                if not is_cycle and curr_hop + 1 <= max_depth:
                                    queue.append((dest_id, curr_hop + 1, txn.timestamp))
                        else:
                            is_truncated = True
                            truncation_reason = f"Configured max_nodes limit of {max_nodes} accounts reached."

            # ------------------------------------------------------------------
            # Incoming Funding Traversal
            # ------------------------------------------------------------------
            if direction in ("incoming", "both"):
                stmt = (
                    select(TransactionModel)
                    .where(
                        TransactionModel.destination_account_id == curr_id,
                        TransactionModel.amount >= min_amount,
                    )
                    .order_by(TransactionModel.timestamp.desc())
                )

                if parent_ts is not None:
                    stmt = stmt.where(TransactionModel.timestamp <= parent_ts)
                    if time_window_hours is not None:
                        min_ts = parent_ts - timedelta(hours=time_window_hours)
                        stmt = stmt.where(TransactionModel.timestamp >= min_ts)

                in_txns = db.scalars(stmt).all()
                for txn in in_txns:
                    if txn.transaction_id in seen_edges:
                        continue
                    seen_edges.add(txn.transaction_id)

                    orig_id = txn.origin_account_id
                    is_cycle = orig_id in nodes_map

                    edge = GraphEdge(
                        transaction_id=txn.transaction_id,
                        origin_account_id=txn.origin_account_id,
                        destination_account_id=txn.destination_account_id,
                        amount=round(txn.amount, 2),
                        currency=txn.currency,
                        channel=txn.channel,
                        timestamp=txn.timestamp.isoformat(),
                        hop=curr_hop + 1,
                        is_cycle=is_cycle,
                    )
                    edges_list.append(edge)

                    if orig_id not in nodes_map:
                        if len(nodes_map) < max_nodes:
                            orig_acc = db.scalar(
                                select(AccountModel).where(AccountModel.account_id == orig_id)
                            )
                            if orig_acc:
                                nodes_map[orig_id] = GraphNode(
                                    account_id=orig_acc.account_id,
                                    customer_name=orig_acc.customer_name,
                                    customer_type=orig_acc.customer_type,
                                    kyc_tier=orig_acc.kyc_tier,
                                    current_balance=round(orig_acc.current_balance, 2),
                                    hop_distance=curr_hop + 1,
                                    is_root=False,
                                )
                                if not is_cycle and curr_hop + 1 <= max_depth:
                                    queue.append((orig_id, curr_hop + 1, txn.timestamp))
                        else:
                            is_truncated = True
                            truncation_reason = f"Configured max_nodes limit of {max_nodes} accounts reached."

        # If traversal ended naturally
        if not is_truncated:
            truncation_reason = "Completed; all connected transaction paths exhausted within constraints."

        # ----------------------------------------------------------------------
        # Strict Accounting & Attribution Guardrails
        # ----------------------------------------------------------------------
        # Observed total: sum of all edges in the returned subgraph
        observed_total = round(sum(e.amount for e in edges_list), 2)

        # Attributed exposure upper bound:
        # For outgoing: sum of 1st-hop transfers out of root (subsequent hops are re-transfers, NOT new money!)
        # For incoming: sum of 1st-hop transfers into root
        if direction == "outgoing":
            root_outflow = sum(
                e.amount for e in edges_list if e.origin_account_id == root.account_id and e.hop == 1
            )
            exposure_bound = round(root_outflow, 2)
        elif direction == "incoming":
            root_inflow = sum(
                e.amount for e in edges_list if e.destination_account_id == root.account_id and e.hop == 1
            )
            exposure_bound = round(root_inflow, 2)
        else:
            root_flow = sum(
                e.amount for e in edges_list if (e.origin_account_id == root.account_id or e.destination_account_id == root.account_id) and e.hop == 1
            )
            exposure_bound = round(root_flow, 2)

        attribution_disclaimer = (
            "Observed total transferred represents the sum of all individual ledger movements across hops. "
            "Attributed exposure upper bound represents the initial flow from/to root. Downstream re-transfers "
            "must never be summed as additional stolen funds. Attribution through mixed balances is inherently uncertain."
        )

        return TraceGraphResponse(
            root_account_id=root.account_id,
            direction=direction,
            max_depth_configured=max_depth,
            max_depth_reached=max_depth_reached,
            nodes=list(nodes_map.values()),
            edges=edges_list,
            total_nodes=len(nodes_map),
            total_edges=len(edges_list),
            is_truncated=is_truncated,
            truncation_reason=truncation_reason,
            observed_total_transferred=observed_total,
            attributed_exposure_upper_bound=exposure_bound,
            attribution_status="observed_transfers_with_bounded_exposure",
            attribution_disclaimer=attribution_disclaimer,
        )
