"""Forensic fund tracing and multi-hop graph traversal engine for FraudShield AI V2."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Sequence

from sqlalchemy import func, select
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


@dataclass
class FlowEdge:
    """One observed transfer reached by a seeded trace, with how it was reached."""

    txn: TransactionModel
    direction: str  # "downstream" (money leaving the root) or "upstream" (money reaching it)
    hop: int
    parent_transaction_id: Optional[str]
    minutes_from_parent: Optional[float]
    # Closes a loop of payments: the other party is already on this edge's own path back to the root, or it was first
    # reached from the opposite side of the root in an order that lets the money run all the way round (see
    # trace_from_seeds). Either way the loop passes through every account on both half-paths.
    is_cycle: bool
    converges: bool  # the other party is already in the graph via a different path (and no loop closes here)


@dataclass
class FlowTrace:
    edges: list[FlowEdge] = field(default_factory=list)
    node_hops: dict[str, tuple[int, str]] = field(default_factory=dict)  # account_id -> (hop, direction)
    max_depth_reached: int = 0
    truncation_notes: list[str] = field(default_factory=list)
    rows_read: int = 0
    # account_id -> what expanding it found: {"found": transfers in the window that were followed (at most the
    # per-account cap), "qualifying": every transfer in the window (counted only when capped, else == found),
    # "capped": per-account cap applied, "dropped_for_nodes": transfers not added because the account limit was full,
    # "anchor": the traced transfer the window was measured from}. Accounts never expanded are absent.
    expansions: dict[str, dict] = field(default_factory=dict)
    # For every depth-limited transfer (hop == max_depth, neither a loop nor a convergence): whether its far account
    # has at least one further qualifying transfer in the window (the same window and rule as an expansion). Only
    # those were really cut short by the depth limit; the others simply show nothing further.
    onward_beyond_depth: dict[str, bool] = field(default_factory=dict)
    # Seed transfers of the investigated account that could not be added because the account limit was already full.
    # They are not in ``edges`` and are disclosed in ``truncation_notes``; they must never be reported as traced.
    untraced_seeds: list[str] = field(default_factory=list)
    # A transfer found again while expanding from the opposite direction. It is already in ``edges`` (never added twice,
    # so nothing is double-counted); the link records that the branch reaching ``parent_transaction_id`` continues
    # into it. Tuples of (parent_transaction_id, transaction_id, direction of the expansion that found it again).
    cross_links: list[tuple[str, str, str]] = field(default_factory=list)
    # Every account on a detected loop of payments (both half-paths and the root when the loop runs through it).
    cycle_members: set[str] = field(default_factory=set)


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
                                edges_list.append(edge)
                                # Continue BFS if not cycle
                                if not is_cycle and curr_hop + 1 <= max_depth:
                                    queue.append((dest_id, curr_hop + 1, txn.timestamp))
                        else:
                            is_truncated = True
                            truncation_reason = f"Configured max_nodes limit of {max_nodes} accounts reached."
                    else:
                        edges_list.append(edge)

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
                                edges_list.append(edge)
                                if not is_cycle and curr_hop + 1 <= max_depth:
                                    queue.append((orig_id, curr_hop + 1, txn.timestamp))
                        else:
                            is_truncated = True
                            truncation_reason = f"Configured max_nodes limit of {max_nodes} accounts reached."
                    else:
                        edges_list.append(edge)

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

    @staticmethod
    def trace_from_seeds(
        db: Session,
        root_id: str,
        downstream_seeds: Sequence[TransactionModel],
        upstream_seeds: Sequence[TransactionModel],
        max_depth: int = 3,
        max_nodes: int = 200,
        window_hours: float = 72.0,
        max_edges_per_account: int = 10,
    ) -> FlowTrace:
        """Follows specific transfers of root_id through the ledger, respecting time order.

        Downstream: from each recipient, its transfers out within `window_hours` after it received the traced
        transfer. Upstream: into each sender, transfers it received within `window_hours` before it paid onward.
        Seeds are hop 1. Each account is expanded once (from the first traced transfer that reached it). Every
        limit that cuts the trace short is recorded in truncation_notes; nothing is dropped silently. The depth limit is
        recorded per last-hop transfer (``onward_beyond_depth``) and counted in the note only where a further qualifying
        transfer exists; a capped account's qualifying count is kept in ``expansions``; seeds the account limit kept out
        are listed in ``untraced_seeds``.

        Loops: a transfer closes a loop (``is_cycle``) when its other party is already on its own path back to the root,
        or when that party was first reached from the opposite side of the root and the timestamps let money run all
        the way round. Each half of the trace is in time order by construction, so the loop
        (party -> ... -> root -> ... -> party) is consistent when it has at most one place where time goes backwards:
        either at the party (it paid the money on within ``window_hours`` of receiving it, the same rule every hop of
        the trace follows) or at the root (it paid out within ``window_hours`` of receiving). Otherwise the meeting is
        only a convergence. A transfer found again from the opposite side is recorded in ``cross_links``, never added
        twice. ``cycle_members`` (the accounts a role assessment treats as "on a payment loop") counts only loops of
        at least LOOP_MIN_ACCOUNTS distinct accounts: two accounts paying each other is ordinary (refunds, shared bills,
        repaid loans) and is shown as a cycle ending, never used as evidence.
        """
        out = FlowTrace(node_hops={root_id: (0, "root")})
        seen: dict[str, FlowEdge] = {}
        intro: dict[str, FlowEdge] = {}  # account -> the traced transfer that first reached it
        seed_of: dict[str, FlowEdge] = {}  # transaction -> the hop-1 transfer (at the root) its chain starts from
        dropped_for_nodes = 0
        queue: deque[tuple[str, int, TransactionModel, tuple[str, ...], str]] = deque()
        window = timedelta(hours=window_hours)

        expanding: list[Optional[str]] = [None]

        def follows(received: TransactionModel, paid: TransactionModel) -> bool:
            """An account received `received` and paid `paid` on within the window (the rule every traced hop follows)."""
            return received.timestamp <= paid.timestamp <= received.timestamp + window

        def add(txn: TransactionModel, direction: str, hop: int, parent: Optional[TransactionModel], path: tuple[str, ...]) -> None:
            nonlocal dropped_for_nodes
            if txn.transaction_id in seen:
                prev_edge = seen[txn.transaction_id]
                link = (parent.transaction_id, txn.transaction_id, direction) if parent is not None else None
                if link and prev_edge.direction != direction and link not in out.cross_links:
                    out.cross_links.append(link)
                return
            other = txn.destination_account_id if direction == "downstream" else txn.origin_account_id
            is_cycle = other in path
            first = intro.get(other)
            own_seed = seed_of[parent.transaction_id].txn if parent is not None else txn
            if not is_cycle and first is not None and first.direction != direction:
                # `other` sits on the opposite half of the trace: the loop closes only if the money can run round in time.
                other_seed = seed_of[first.txn.transaction_id].txn
                if direction == "upstream":  # txn: other (downstream half) -> this half, which leads to the root
                    is_cycle = follows(first.txn, txn) or follows(own_seed, other_seed)
                else:  # txn: this half -> other (upstream half), which leads back to the root
                    is_cycle = follows(txn, first.txn) or follows(other_seed, own_seed)
            converges = other in out.node_hops and not is_cycle
            if other not in out.node_hops:
                if len(out.node_hops) >= max_nodes:
                    dropped_for_nodes += 1
                    if expanding[0] is not None:
                        out.expansions[expanding[0]]["dropped_for_nodes"] += 1
                    if parent is None:
                        out.untraced_seeds.append(txn.transaction_id)
                    return
                out.node_hops[other] = (hop, direction)
            minutes = None
            if parent is not None:
                delta = (txn.timestamp - parent.timestamp) if direction == "downstream" else (parent.timestamp - txn.timestamp)
                minutes = round(delta.total_seconds() / 60.0, 1)
            edge = FlowEdge(txn, direction, hop, parent.transaction_id if parent else None, minutes, is_cycle, converges)
            seen[txn.transaction_id] = edge
            seed_of[txn.transaction_id] = seed_of[parent.transaction_id] if parent is not None else edge
            intro.setdefault(other, edge)
            out.edges.append(edge)
            out.max_depth_reached = max(out.max_depth_reached, hop)
            if not is_cycle and not converges:
                if hop < max_depth:
                    queue.append((other, hop, txn, path + (other,), direction))

        for txn in sorted(downstream_seeds, key=lambda t: t.timestamp):
            add(txn, "downstream", 1, None, (root_id,))
        for txn in sorted(upstream_seeds, key=lambda t: t.timestamp):
            add(txn, "upstream", 1, None, (root_id,))

        def in_window(stmt, acc: str, anchor: TransactionModel, direction: str):
            """The qualifying transfers of `acc` after it received `anchor` (downstream) or before it paid `anchor` on
            (upstream), within the window. The one rule used for expansion, the per-account count and the depth check."""
            if direction == "downstream":
                stmt = stmt.where(
                    TransactionModel.origin_account_id == acc,
                    TransactionModel.timestamp >= anchor.timestamp,
                    TransactionModel.timestamp <= anchor.timestamp + window,
                )
            else:
                stmt = stmt.where(
                    TransactionModel.destination_account_id == acc,
                    TransactionModel.timestamp <= anchor.timestamp,
                    TransactionModel.timestamp >= anchor.timestamp - window,
                )
            return stmt.where(TransactionModel.transaction_id != anchor.transaction_id)

        capped: list[str] = []
        while queue:
            acc, hop, anchor, path, direction = queue.popleft()
            rows = db.scalars(
                in_window(select(TransactionModel), acc, anchor, direction)
                .order_by(TransactionModel.amount.desc()).limit(max_edges_per_account + 1)
            ).all()
            out.rows_read += len(rows)
            is_capped = len(rows) > max_edges_per_account
            # Capped: count every qualifying transfer (an indexed COUNT) so the branch can say how many were not followed.
            qualifying = (db.scalar(in_window(select(func.count()).select_from(TransactionModel), acc, anchor, direction))
                          if is_capped else len(rows))
            out.expansions[acc] = {"found": min(len(rows), max_edges_per_account), "qualifying": int(qualifying),
                                   "capped": is_capped, "dropped_for_nodes": 0, "direction": direction,
                                   "anchor": anchor.transaction_id}
            if is_capped:
                capped.append(acc)
                rows = rows[:max_edges_per_account]
            expanding[0] = acc
            for txn in sorted(rows, key=lambda t: t.timestamp):
                add(txn, direction, hop + 1, anchor, path)
            expanding[0] = None

        if capped:
            out.truncation_notes.append(
                f"{len(capped)} account(s) had more than {max_edges_per_account} transfers in the window; only the "
                f"{max_edges_per_account} largest were followed for each ({', '.join(capped[:8])}{'…' if len(capped) > 8 else ''})."
            )
        if dropped_for_nodes:
            out.truncation_notes.append(
                f"The account limit of {max_nodes} was reached; {dropped_for_nodes} further transfer(s) to new accounts were not added."
            )
        if out.untraced_seeds:
            ids = out.untraced_seeds
            out.truncation_notes.append(
                f"{len(ids)} selected transfer(s) of the investigated account could not be traced because the account limit "
                f"of {max_nodes} was already full ({', '.join(ids[:8])}{'…' if len(ids) > 8 else ''}); they are not listed as "
                "trace seeds."
            )
        # Depth limit: a transfer at the last hop was cut short only if its far account has a further qualifying transfer
        # in the window. One bounded existence query (LIMIT 1, same indexed rule as an expansion) per such transfer.
        frontier = [e for e in out.edges if e.hop == max_depth and not e.is_cycle and not e.converges]
        for e in frontier:
            hit = db.scalar(in_window(select(TransactionModel.transaction_id), _far(e), e.txn, e.direction).limit(1))
            out.rows_read += int(hit is not None)
            out.onward_beyond_depth[e.txn.transaction_id] = hit is not None
        cut = sum(out.onward_beyond_depth.values())
        if cut:
            out.truncation_notes.append(
                f"The depth limit of {max_depth} hop(s) was reached; {cut} account(s) at that depth have further transfers "
                "in the window that were not followed."
            )
        out.cycle_members = loop_members(out, root_id)
        return out


LOOP_MIN_ACCOUNTS = 3  # a loop must pass through at least this many distinct accounts to count as role evidence


def _far(e: FlowEdge) -> str:
    return e.txn.destination_account_id if e.direction == "downstream" else e.txn.origin_account_id


def loop_members(flow: FlowTrace, root_id: str) -> set[str]:
    """Accounts on every loop the trace closed: for a same-direction loop, the accounts from the repeated one to the
    closing transfer; for a loop through the root, the root and both half-paths that meet at the closing transfer."""
    by_id = {e.txn.transaction_id: e for e in flow.edges}
    intro: dict[str, FlowEdge] = {}
    for e in flow.edges:
        if not e.is_cycle and not e.converges:
            intro.setdefault(_far(e), e)

    def half(e: Optional[FlowEdge]) -> list[str]:
        """[root, ..., far end of e] following parent transfers back to the root."""
        accs: list[str] = []
        guard = 0
        while e is not None and guard <= len(by_id):
            accs.append(_far(e))
            e = by_id.get(e.parent_transaction_id) if e.parent_transaction_id else None
            guard += 1
        return [root_id] + accs[::-1]

    members: set[str] = set()
    for c in flow.edges:
        if not c.is_cycle:
            continue
        own = half(by_id.get(c.parent_transaction_id) if c.parent_transaction_id else None)
        x = _far(c)
        loop = set(own[own.index(x):]) if x in own else set(own) | set(half(intro.get(x)))
        if len(loop) >= LOOP_MIN_ACCOUNTS:
            members |= loop
    return members
