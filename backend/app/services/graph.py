"""Builds the frontend-friendly graph (nodes/edges) from a TraceResult using NetworkX."""

from __future__ import annotations

import networkx as nx

from app.models.domain import Account, AccountReviewStatus, AccountRole, EvidenceQuality, ReviewState
from app.schemas.trace import GraphEdge, GraphNode, GraphResponse, TraceResult


def build_graph(
    trace: TraceResult,
    accounts: list[Account],
    review_statuses: list[AccountReviewStatus],
) -> GraphResponse:
    account_map = {a.account_id: a for a in accounts}
    review_map = {r.account_id: r for r in review_statuses}
    linked = {a.account_id: a for a in trace.linked_accounts}

    g = nx.MultiDiGraph()
    for t in trace.traced_transactions:
        g.add_edge(t.sender_account_id, t.receiver_account_id, key=t.transaction_id, tx=t)

    nodes: list[GraphNode] = []
    # Edges were added chronologically, so node insertion order is the
    # traversal order: victim first, then the initial receiver, and so on.
    for n in g.nodes:
        acct = account_map.get(n)
        info = linked.get(n)
        rev = review_map.get(n)
        nodes.append(GraphNode(
            id=n,
            label=acct.label if acct else n,
            role=acct.role if acct else AccountRole.UNKNOWN,
            hop_count=info.hop_count if info else None,
            review_state=rev.review_state if rev else ReviewState.NOT_REVIEWED,
            evidence_quality=(rev.evidence_quality if rev else EvidenceQuality.GRAPH_CONNECTION_ONLY),
            attributed_unforwarded_amount=info.exposure.attributed_unforwarded_amount if info else None,
            attribution_status=info.exposure.attribution_status if info else None,
            is_synthetic=acct.is_synthetic if acct else True,
        ))

    edges: list[GraphEdge] = []
    for u, v, key, data in g.edges(keys=True, data=True):
        t = data["tx"]
        edges.append(GraphEdge(
            id=key, source=u, target=v, amount=t.amount, currency=t.currency,
            transaction_type=t.transaction_type, timestamp=t.timestamp, hop_count=t.hop_count,
            attributed_amount=t.attributed_amount, attribution_basis=t.attribution_basis,
            is_cycle_closing=t.is_cycle_closing))
    edges.sort(key=lambda e: (e.timestamp, e.id))

    s = trace.summary
    return GraphResponse(
        case_id=trace.case_id, nodes=nodes, edges=edges,
        meta={
            "origin_transaction_id": trace.origin_transaction_id,
            "max_depth": s.max_depth, "truncated": s.truncated,
            "cycles_detected": s.cycles_detected,
            "node_count": len(nodes), "edge_count": len(edges),
            "amounts_note": "Edge 'amount' is the observed transaction value; "
                            "'attributed_amount' is a scenario assumption. Do not sum edge amounts as a fraud total.",
        })
