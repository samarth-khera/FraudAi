"""Deterministic fund-tracing engine (synthetic Phase 1).

How it works
------------
1. Transactions are sanitised (duplicate IDs, self-transfers handled safely).
2. Starting at the reported origin transaction, the engine walks forward: a
   later transaction is "downstream" when its sender is the receiver of the
   previous leg and its timestamp is strictly later.
3. Each account may appear once per path; a transfer that returns to an account
   already on the path is recorded as cycle-closing and not expanded.
4. Traversal stops at ``max_depth`` hops (origin = hop 0) and at ``max_paths``.
5. Fund attribution uses ONLY explicit ``synthetic_lineage_metadata``. Missing
   or inconsistent lineage yields ``None`` / an "uncertain" status; unobserved
   money is never silently treated as spent.

Observed transaction values are never summed into a "fraud total".
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Iterable, Optional

from app.models.domain import (
    Account,
    AccountReviewStatus,
    AccountRole,
    EvidenceQuality,
    FraudCase,
    FundTracePath,
    PathTermination,
    ReviewState,
    Transaction,
)
from app.schemas.trace import (
    AccountTraceInfo,
    ExposureInfo,
    ReviewInfo,
    TracedTransaction,
    TraceResult,
    TraceSummary,
    TraceWarning,
)

DEFAULT_MAX_DEPTH = 10
DEFAULT_MAX_PATHS = 1000
ZERO = Decimal(0)


class TraceError(Exception):
    """Raised when a trace cannot be started (e.g. missing origin)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def sanitize_transactions(
    transactions: Iterable[Transaction],
) -> tuple[dict[str, Transaction], list[TraceWarning]]:
    """Drop unsafe records.

    * Identical duplicates: first kept, warning emitted.
    * Conflicting duplicates (same ID, different content): ALL copies are
      quarantined because the true record is ambiguous.
    * Self-transfers are ignored for tracing.
    """
    warnings: list[TraceWarning] = []
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for t in transactions:
        groups[t.transaction_id].append(t)

    clean: dict[str, Transaction] = {}
    for tid, group in groups.items():
        if len(group) > 1:
            if all(g == group[0] for g in group):
                warnings.append(TraceWarning(
                    code="duplicate_transaction_identical",
                    message=f"Transaction {tid} appears {len(group)} times with identical "
                            "content; only one copy used.",
                    transaction_id=tid))
            else:
                warnings.append(TraceWarning(
                    code="duplicate_transaction_conflicting",
                    message=f"Transaction {tid} appears with conflicting content; all copies "
                            "quarantined because the true record is ambiguous.",
                    transaction_id=tid))
                continue
        tx = group[0]
        if tx.sender_account_id == tx.receiver_account_id:
            warnings.append(TraceWarning(
                code="self_transfer_ignored",
                message=f"Transaction {tid} has the same sender and receiver; ignored.",
                transaction_id=tid))
            continue
        clean[tid] = tx
    return clean, warnings


def _attribution(tx: Transaction, case_id: str, warnings: list[TraceWarning]) -> Optional[Decimal]:
    """Return explicit attributed amount for this case, or None if unknown."""
    lin = tx.synthetic_lineage_metadata
    if lin is None or lin.case_id != case_id:
        return None
    if lin.attributed_amount > tx.amount:
        warnings.append(TraceWarning(
            code="lineage_exceeds_transaction_amount",
            message=f"Lineage for {tx.transaction_id} exceeds the observed amount; "
                    "treated as uncertain.",
            transaction_id=tx.transaction_id))
        return None
    return lin.attributed_amount


def trace_case(
    case: FraudCase,
    transactions: Iterable[Transaction],
    accounts: Optional[Iterable[Account]] = None,
    review_statuses: Optional[Iterable[AccountReviewStatus]] = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
    max_paths: int = DEFAULT_MAX_PATHS,
) -> TraceResult:
    if max_depth < 0:
        raise TraceError("invalid_depth", "max_depth must be >= 0.")

    tx_by_id, warnings = sanitize_transactions(transactions)
    account_map = {a.account_id: a for a in (accounts or [])}
    review_map = {r.account_id: r for r in (review_statuses or []) if r.case_id == case.case_id}

    origin = tx_by_id.get(case.reported_origin_transaction_id)
    if origin is None:
        raise TraceError(
            "origin_transaction_unavailable",
            f"Reported origin transaction {case.reported_origin_transaction_id!r} is missing "
            "or was quarantined as ambiguous.")

    outgoing: dict[str, list[Transaction]] = defaultdict(list)
    for t in tx_by_id.values():
        outgoing[t.sender_account_id].append(t)
    for lst in outgoing.values():
        lst.sort(key=lambda t: (t.timestamp, t.transaction_id))

    hops: dict[str, int] = {origin.transaction_id: 0}
    cycle_closing: set[str] = set()
    paths: list[FundTracePath] = []
    state = {"truncated": False, "cycles": False}
    attr_cache: dict[str, Optional[Decimal]] = {}

    def attr(tx: Transaction) -> Optional[Decimal]:
        if tx.transaction_id not in attr_cache:
            attr_cache[tx.transaction_id] = _attribution(tx, case.case_id, warnings)
        return attr_cache[tx.transaction_id]

    def emit(tx_path: list[Transaction], acct_path: list[str], reason: PathTermination) -> None:
        if len(paths) >= max_paths:
            if not state["truncated"]:
                state["truncated"] = True
                warnings.append(TraceWarning(
                    code="max_paths_reached",
                    message=f"Path enumeration stopped at {max_paths} paths."))
            return
        attrs = [attr(t) for t in tx_path]
        explicit = all(a is not None for a in attrs)
        paths.append(FundTracePath(
            path_id=f"P{len(paths) + 1}",
            account_ids=list(acct_path),
            transaction_ids=[t.transaction_id for t in tx_path],
            transaction_amounts=[t.amount for t in tx_path],
            hop_count=len(tx_path) - 1,
            started_at=tx_path[0].timestamp,
            ended_at=tx_path[-1].timestamp,
            terminal_account_id=acct_path[-1],
            termination_reason=reason,
            max_attributable_amount=min(attrs) if explicit else None,  # type: ignore[type-var]
            attribution_status="explicit" if explicit else "uncertain",
        ))

    def walk(tx_path: list[Transaction], acct_path: list[str]) -> None:
        if len(paths) >= max_paths:
            return
        last = tx_path[-1]
        hop = len(tx_path) - 1
        blocked_by_depth = False
        expanded = False
        for nxt in outgoing.get(last.receiver_account_id, []):
            if nxt.timestamp <= last.timestamp:
                continue
            if hop + 1 > max_depth:
                blocked_by_depth = True
                state["truncated"] = True
                continue
            hops[nxt.transaction_id] = min(hops.get(nxt.transaction_id, hop + 1), hop + 1)
            expanded = True
            if nxt.receiver_account_id in acct_path:
                state["cycles"] = True
                cycle_closing.add(nxt.transaction_id)
                warnings.append(TraceWarning(
                    code="cycle_detected",
                    message=f"Transaction {nxt.transaction_id} returns funds to account "
                            f"{nxt.receiver_account_id} already on the path; not expanded.",
                    transaction_id=nxt.transaction_id,
                    account_id=nxt.receiver_account_id))
                emit(tx_path + [nxt], acct_path + [nxt.receiver_account_id],
                     PathTermination.CYCLE_DETECTED)
            else:
                walk(tx_path + [nxt], acct_path + [nxt.receiver_account_id])
        if not expanded:
            emit(tx_path, acct_path,
                 PathTermination.DEPTH_LIMIT if blocked_by_depth else PathTermination.END_OF_RECORDS)

    walk([origin], [origin.sender_account_id, origin.receiver_account_id])

    # ---- traced transactions (distinct) ----
    traced_ids = sorted(hops, key=lambda i: (tx_by_id[i].timestamp, i))
    traced_txs = [tx_by_id[i] for i in traced_ids]
    traced_models: list[TracedTransaction] = []
    for t in traced_txs:
        a = attr(t)
        lin = t.synthetic_lineage_metadata if a is not None else None
        traced_models.append(TracedTransaction(
            transaction_id=t.transaction_id, timestamp=t.timestamp,
            sender_account_id=t.sender_account_id, receiver_account_id=t.receiver_account_id,
            amount=t.amount, currency=t.currency, transaction_type=t.transaction_type,
            hop_count=hops[t.transaction_id], attributed_amount=a,
            attribution_basis=lin.basis if lin else None,
            attribution_note=lin.note if lin else None,
            is_cycle_closing=t.transaction_id in cycle_closing))

    # ---- per-account info ----
    victim_id = origin.sender_account_id
    inbound: dict[str, list[Transaction]] = defaultdict(list)
    outbound: dict[str, list[Transaction]] = defaultdict(list)
    for t in traced_txs:
        inbound[t.receiver_account_id].append(t)
        outbound[t.sender_account_id].append(t)

    path_ids_by_acct: dict[str, list[str]] = defaultdict(list)
    for p in paths:
        for acct in dict.fromkeys(p.account_ids[1:]):
            path_ids_by_acct[acct].append(p.path_id)

    linked: list[AccountTraceInfo] = []
    uncertain_ids: list[str] = []
    located = ZERO
    for acct_id in sorted(inbound, key=lambda a: (min(hops[t.transaction_id] for t in inbound[a]),
                                                  inbound[a][0].timestamp, a)):
        if acct_id == victim_id:
            continue
        ins, outs = inbound[acct_id], outbound.get(acct_id, [])
        in_attr = [attr(t) for t in ins]
        out_attr = [attr(t) for t in outs]
        if any(x is None for x in in_attr + out_attr):
            status, a_in, a_out, unfwd = "uncertain_missing_lineage", None, None, None
        else:
            a_in, a_out = sum(in_attr, ZERO), sum(out_attr, ZERO)  # type: ignore[arg-type]
            if a_out > a_in:
                status, unfwd = "ambiguous_over_attribution", None
            else:
                status, unfwd = "explicit", a_in - a_out
                located += unfwd
        if status != "explicit":
            uncertain_ids.append(acct_id)
            warnings.append(TraceWarning(
                code=status, account_id=acct_id,
                message=f"Fund attribution for {acct_id} is uncertain ({status})."))

        min_hop = min(hops[t.transaction_id] for t in ins)
        acct = account_map.get(acct_id)
        rev = review_map.get(acct_id)
        if acct_id == origin.receiver_account_id:
            conn, hop_n = "origin_receiver", 0
        else:
            hop_n = min_hop
            conn = "direct" if hop_n == 1 else "indirect"
        linked.append(AccountTraceInfo(
            account_id=acct_id, label=acct.label if acct else None,
            role=acct.role if acct else AccountRole.UNKNOWN,
            connection_type=conn, hop_count=hop_n,
            first_received_at=min(t.timestamp for t in ins),
            inbound_transaction_ids=[t.transaction_id for t in ins],
            outbound_transaction_ids=[t.transaction_id for t in outs],
            path_ids=path_ids_by_acct.get(acct_id, []),
            exposure=ExposureInfo(
                observed_inbound_value=sum((t.amount for t in ins), ZERO),
                observed_outbound_value=sum((t.amount for t in outs), ZERO),
                attributed_inbound_amount=a_in, attributed_outbound_amount=a_out,
                attributed_unforwarded_amount=unfwd, attribution_status=status),
            review=ReviewInfo(
                review_state=rev.review_state if rev else ReviewState.NOT_REVIEWED,
                evidence_quality=rev.evidence_quality if rev else EvidenceQuality.GRAPH_CONNECTION_ONLY,
                notes=rev.notes if rev else None,
                reviewer_id=rev.reviewer_id if rev else None,
                decision_reasons=list(rev.decision_reasons) if rev else [],
                supporting_transaction_ids=list(rev.supporting_transaction_ids) if rev else [],
                additional_info_needed=bool(rev.additional_info_needed) if rev else False,
                automated_action_taken="none"),
            is_synthetic=acct.is_synthetic if acct else True))


    origin_attr = attr(origin)
    traceable = min(origin_attr, case.reported_amount) if origin_attr is not None else ZERO
    if origin_attr is None:
        warnings.append(TraceWarning(
            code="origin_lineage_missing", transaction_id=origin.transaction_id,
            message="Origin transaction has no explicit lineage; traceable amount reported as 0."))
    unlocated = max(ZERO, traceable - located)
    if located > traceable:
        warnings.append(TraceWarning(
            code="located_exceeds_traceable",
            message="Located amount exceeds traceable amount; lineage is inconsistent."))

    summary = TraceSummary(
        reported_amount=case.reported_amount, currency=case.currency,
        traceable_amount=traceable, located_amount=located, unlocated_amount=unlocated,
        gross_observed_transaction_value=sum((t.amount for t in traced_txs), ZERO),
        linked_account_count=len(linked), traced_transaction_count=len(traced_txs),
        path_count=len(paths), max_depth=max_depth, truncated=state["truncated"],
        cycles_detected=state["cycles"], uncertain_account_ids=uncertain_ids)

    return TraceResult(
        case_id=case.case_id, origin_transaction_id=origin.transaction_id, summary=summary,
        linked_accounts=linked, traced_transactions=traced_models, paths=paths,
        warnings=warnings)
