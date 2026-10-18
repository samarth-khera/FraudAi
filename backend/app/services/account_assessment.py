"""Evidence-aware downstream account assessment service.

Reuses the deterministic fund-tracing engine (`app.services.tracer.trace_case`)
to evaluate an account's structural position, observed ledger movement,
lineage-bounded fund exposure, timing/structural signals, supporting evidence,
and explicit evidence gaps without double-counting or declaring guilt/innocence.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Iterable, Optional

from app.models.domain import (
    Account,
    AccountReviewStatus,
    AccountRole,
    AuditEvent,
    EvidenceQuality,
    FraudCase,
    ReviewState,
    Transaction,
)
from app.repositories.sql_case_repository import EntityNotFoundError
from app.schemas.case_management import (
    AccountAssessmentResponse,
    AccountEvidenceAssessment,
    AccountGraphPosition,
    AccountObservedMovement,
    AccountSignal,
    AccountSupportingEvidence,
    AccountTraceableExposure,
    AuditEventResponse,
    CaseAccountAssessmentsResponse,
)
from app.schemas.trace import DISCLAIMER as TRACE_DISCLAIMER
from app.schemas.trace import TracedTransaction, TraceResult
from app.services.tracer import DEFAULT_MAX_DEPTH, ZERO, sanitize_transactions, trace_case

ASSESSMENT_DISCLAIMER = (
    "Decision support only. Receiving funds linked to a reported transaction does not establish "
    "knowledge, complicity, or wrongdoing; legitimate merchants, employees, and counterparties "
    "routinely receive downstream transfers. No account is ever frozen, restricted, or declared "
    "culpable or cleared automatically by this system."
)

TRANSACTION_RISK_SEPARATION_NOTE = (
    "Transaction ML risk scores (from POST /api/risk/score) evaluate pre-transaction tabular "
    "features of a single payment leg in isolation. They are never applied as an account-level "
    "probability and must not be used to infer an account holder's intent."
)

RAPID_PASS_THROUGH_SECONDS = 15 * 60  # 15 minutes


def _build_assessment_for_account(
    case: FraudCase,
    account_id: str,
    trace: TraceResult,
    clean_txs: dict[str, Transaction],
    account_map: dict[str, Account],
    review_map: dict[str, AccountReviewStatus],
    audit_events: list[AuditEvent],
) -> AccountAssessmentResponse:
    linked_map = {a.account_id: a for a in trace.linked_accounts}
    traced_tx_map = {t.transaction_id: t for t in trace.traced_transactions}
    origin_tx = clean_txs.get(trace.origin_transaction_id)
    victim_id = origin_tx.sender_account_id if origin_tx else None

    all_acct_inbound = [t for t in clean_txs.values() if t.receiver_account_id == account_id]
    all_acct_outbound = [t for t in clean_txs.values() if t.sender_account_id == account_id]

    acct_obj = account_map.get(account_id)
    linked_info = linked_map.get(account_id)
    rev_obj = review_map.get(account_id)

    if (
        acct_obj is None
        and linked_info is None
        and rev_obj is None
        and not all_acct_inbound
        and not all_acct_outbound
    ):
        raise EntityNotFoundError(
            "account_not_found",
            f"Account {account_id!r} was not found in case {case.case_id!r}.",
        )

    # 1. Traced vs non-traced transactions for this account
    traced_in = [
        traced_tx_map[t.transaction_id]
        for t in sorted(all_acct_inbound, key=lambda x: (x.timestamp, x.transaction_id))
        if t.transaction_id in traced_tx_map
    ]
    traced_out = [
        traced_tx_map[t.transaction_id]
        for t in sorted(all_acct_outbound, key=lambda x: (x.timestamp, x.transaction_id))
        if t.transaction_id in traced_tx_map
    ]
    other_in_count = len(all_acct_inbound) - len(traced_in)
    other_out_count = len(all_acct_outbound) - len(traced_out)

    upstream_ids = list(dict.fromkeys(t.sender_account_id for t in traced_in))
    downstream_ids = list(dict.fromkeys(t.receiver_account_id for t in traced_out))

    all_timestamps = [t.timestamp for t in all_acct_inbound + all_acct_outbound]
    last_activity = max(all_timestamps) if all_timestamps else None

    if account_id == victim_id:
        in_traced = True
        conn_type = "reporting_victim"
        hop_count: Optional[int] = None
        first_rec = traced_in[0].timestamp if traced_in else None
        path_ids = [p.path_id for p in trace.paths if account_id in p.account_ids]
        role = acct_obj.role if acct_obj else AccountRole.REPORTING_VICTIM
    elif linked_info is not None:
        in_traced = True
        conn_type = linked_info.connection_type
        hop_count = linked_info.hop_count
        first_rec = linked_info.first_received_at
        path_ids = list(linked_info.path_ids)
        role = linked_info.role
    else:
        in_traced = False
        conn_type = "not_in_downstream_trace"
        hop_count = None
        first_rec = min((t.timestamp for t in all_acct_inbound), default=None)
        path_ids = []
        role = acct_obj.role if acct_obj else AccountRole.UNKNOWN

    graph_position = AccountGraphPosition(
        account_id=account_id,
        label=acct_obj.label if acct_obj else f"Account {account_id}",
        role=role,
        is_synthetic=acct_obj.is_synthetic if acct_obj else True,
        in_traced_network=in_traced,
        connection_type=conn_type,
        hop_count=hop_count,
        upstream_account_ids=upstream_ids,
        downstream_account_ids=downstream_ids,
        path_ids=path_ids,
        first_received_at=first_rec,
        last_observed_activity_at=last_activity,
    )

    # 2. Observed movement (ledger values only)
    obs_in = linked_info.exposure.observed_inbound_value if linked_info else sum((t.amount for t in traced_in), ZERO)
    obs_out = linked_info.exposure.observed_outbound_value if linked_info else sum((t.amount for t in traced_out), ZERO)

    movement_note = (
        "Observed inbound and outbound values measure gross ledger transfers in the traced network. "
        "They must never be summed across hops as a stolen-fund total because the same funds move "
        "sequentially from hop to hop and may commingle with unrelated balances."
    )
    if other_in_count > 0 or other_out_count > 0:
        movement_note += (
            f" Additionally, {other_in_count} non-downstream inbound and {other_out_count} "
            "non-downstream outbound transaction(s) exist for this account outside the traced flow."
        )

    observed_movement = AccountObservedMovement(
        observed_inbound_value=obs_in,
        observed_outbound_value=obs_out,
        traced_inbound_count=len(traced_in),
        traced_outbound_count=len(traced_out),
        traced_inbound_transactions=traced_in,
        traced_outbound_transactions=traced_out,
        other_observed_inbound_count=other_in_count,
        other_observed_outbound_count=other_out_count,
        movement_note=movement_note,
    )

    # 3. Traceable fund exposure & anti-double-counting safeguards
    if account_id == victim_id:
        attr_in, attr_out, attr_unfwd = None, trace.summary.traceable_amount, None
        attr_status = "not_applicable_origin_sender"
        attr_basis = origin_tx.synthetic_lineage_metadata.basis.value if (origin_tx and origin_tx.synthetic_lineage_metadata) else None
    elif linked_info is not None:
        attr_in = linked_info.exposure.attributed_inbound_amount
        attr_out = linked_info.exposure.attributed_outbound_amount
        attr_unfwd = linked_info.exposure.attributed_unforwarded_amount
        attr_status = linked_info.exposure.attribution_status
        bases = {t.attribution_basis.value for t in traced_in + traced_out if t.attribution_basis is not None}
        attr_basis = sorted(bases)[0] if bases else None
    else:
        attr_in, attr_out, attr_unfwd = None, None, None
        attr_status = "no_traced_exposure"
        attr_basis = None

    assumptions: list[str] = [
        f"Case reported amount is {case.reported_amount} {case.currency}; total traceable case exposure is capped at {trace.summary.traceable_amount} {case.currency}.",
        "Attributed amounts are computed strictly from explicit per-transaction lineage metadata (`synthetic_lineage_metadata`) matching this case ID.",
        "If any inbound or outbound leg for an account lacks explicit lineage metadata, attribution status is marked `uncertain_missing_lineage` rather than guessing or defaulting to zero.",
    ]
    if attr_status == "explicit" and attr_unfwd is not None:
        assumptions.append(
            f"Unforwarded attributed exposure ({attr_unfwd} {case.currency}) equals attributed inbound ({attr_in} {case.currency}) minus attributed outbound ({attr_out} {case.currency}) observed in the dataset."
        )

    double_counting_safeguard = (
        f"Gross observed transaction volume across all {trace.summary.traced_transaction_count} traced legs is "
        f"{trace.summary.gross_observed_transaction_value} {case.currency}, whereas the reported case amount is "
        f"{case.reported_amount} {case.currency} (traceable: {trace.summary.traceable_amount} {case.currency}). "
        "FraudShield AI never adds downstream hop amounts together; only unforwarded attributed balances on "
        f"explicit-lineage accounts contribute to the located total ({trace.summary.located_amount} {case.currency})."
    )

    traceable_exposure = AccountTraceableExposure(
        reported_case_amount=case.reported_amount,
        case_traceable_amount=trace.summary.traceable_amount,
        gross_network_observed_value=trace.summary.gross_observed_transaction_value,
        attributed_inbound_amount=attr_in,
        attributed_outbound_amount=attr_out,
        attributed_unforwarded_amount=attr_unfwd,
        attribution_status=attr_status,
        attribution_basis=attr_basis,
        attribution_assumptions=assumptions,
        double_counting_safeguard=double_counting_safeguard,
    )

    # 4. Behavioral and structural signals (strictly derived from observed records)
    signals: list[AccountSignal] = []

    # Check rapid pass-through between traced inbound and traced outbound legs
    rapid_pairs: list[tuple[TracedTransaction, TracedTransaction, float]] = []
    for tin in traced_in:
        for tout in traced_out:
            delta_sec = (tout.timestamp - tin.timestamp).total_seconds()
            if 0 < delta_sec <= RAPID_PASS_THROUGH_SECONDS:
                rapid_pairs.append((tin, tout, delta_sec / 60.0))

    if rapid_pairs:
        min_in, min_out, mins = min(rapid_pairs, key=lambda item: item[2])
        rel_ids = list(dict.fromkeys([p[0].transaction_id for p in rapid_pairs] + [p[1].transaction_id for p in rapid_pairs]))
        signals.append(
            AccountSignal(
                code="rapid_pass_through",
                title="Rapid Outbound Forwarding Observed",
                description=(
                    f"Outbound transfer {min_out.transaction_id} occurred {mins:.1f} minute(s) after "
                    f"inbound transfer {min_in.transaction_id}."
                ),
                related_transaction_ids=rel_ids,
                interpretation_note=(
                    "Rapid pass-through can occur in automated payment forwarding, treasury sweeps, "
                    "or intermediary layering. Timing alone does not establish account-holder intent."
                ),
            )
        )

    if len(traced_out) >= 2 and account_id != victim_id:
        signals.append(
            AccountSignal(
                code="multi_branch_splitting",
                title="Outbound Split Across Multiple Transfers",
                description=(
                    f"Account initiated {len(traced_out)} downstream outbound transactions "
                    f"({', '.join(t.transaction_id for t in traced_out)}) to {len(downstream_ids)} recipient account(s)."
                ),
                related_transaction_ids=[t.transaction_id for t in traced_out],
                interpretation_note=(
                    "Splitting outbound payments across multiple recipients may reflect routine batch disbursements "
                    "(e.g., vendor/payroll payouts) or fund dispersion; verify underlying payment instructions."
                ),
            )
        )

    if obs_in > ZERO and obs_out == obs_in and account_id != victim_id:
        signals.append(
            AccountSignal(
                code="full_inbound_forwarding",
                title="100% of Observed Inbound Value Forwarded",
                description=(
                    f"Observed outbound value ({obs_out} {case.currency}) equals 100% of observed "
                    f"traced inbound value ({obs_in} {case.currency})."
                ),
                related_transaction_ids=[t.transaction_id for t in traced_in + traced_out],
                interpretation_note=(
                    "Full forwarding leaves zero unforwarded balance in the traced records, but requires "
                    "human review to determine whether the account acted as a pass-through conduit or settlement intermediary."
                ),
            )
        )

    if attr_unfwd is not None and attr_unfwd > ZERO:
        signals.append(
            AccountSignal(
                code="unforwarded_attributed_balance",
                title="Unforwarded Attributed Balance in Records",
                description=(
                    f"{attr_unfwd} {case.currency} of scenario-attributed inbound funds has no subsequent "
                    "downstream outbound transfer recorded in the dataset."
                ),
                related_transaction_ids=[t.transaction_id for t in traced_in],
                interpretation_note=(
                    "Unforwarded exposure means funds were not observed leaving in available records. "
                    "Bona fide merchants, contractors, or service providers legitimately retain payments for goods or services."
                ),
            )
        )

    cycle_txs = [t.transaction_id for t in traced_in + traced_out if t.is_cycle_closing]
    if cycle_txs:
        signals.append(
            AccountSignal(
                code="cycle_participation",
                title="Cycle-Closing Transfer Detected",
                description=(
                    f"Transaction(s) {', '.join(cycle_txs)} returned funds to an account already visited on the same path."
                ),
                related_transaction_ids=cycle_txs,
                interpretation_note=(
                    "Cyclic transfers halt path expansion to prevent infinite traversal and double-counting."
                ),
            )
        )

    # Check repeated counterparty transfers across all clean transactions involving this account
    counterparty_txs: dict[str, list[str]] = {}
    for t in all_acct_inbound:
        counterparty_txs.setdefault(t.sender_account_id, []).append(t.transaction_id)
    for t in all_acct_outbound:
        counterparty_txs.setdefault(t.receiver_account_id, []).append(t.transaction_id)
    repeated_counterparties = {cp: tids for cp, tids in counterparty_txs.items() if len(tids) >= 2}
    if repeated_counterparties:
        cp_desc = ", ".join(f"{cp} ({len(tids)} legs)" for cp, tids in sorted(repeated_counterparties.items()))
        rel_ids = [tid for tids in repeated_counterparties.values() for tid in tids]
        signals.append(
            AccountSignal(
                code="repeated_counterparty_activity",
                title="Repeated Counterparty Transfers",
                description=f"Multiple transfers observed with counterparty account(s): {cp_desc}.",
                related_transaction_ids=sorted(set(rel_ids)),
                interpretation_note=(
                    "Repeated transfers between the same accounts may indicate an ongoing commercial/personal "
                    "relationship or structured split transfers."
                ),
            )
        )

    # 5. Supporting evidence, evidence gaps, uncertainty & verification guidance
    current_review = rev_obj or AccountReviewStatus(
        account_id=account_id,
        case_id=case.case_id,
        review_state=ReviewState.REPORTING_VICTIM if account_id == victim_id else ReviewState.NOT_REVIEWED,
        evidence_quality=(
            EvidenceQuality.NOT_ASSESSED
            if account_id == victim_id
            else EvidenceQuality.GRAPH_CONNECTION_ONLY
        ),
        notes=None,
        reviewer_id=None,
        decision_reasons=[],
        supporting_transaction_ids=[],
        additional_info_needed=False,
        automated_action_taken="none",
    )

    supporting_evidence: list[AccountSupportingEvidence] = []
    if account_id == victim_id and origin_tx is not None:
        supporting_evidence.append(
            AccountSupportingEvidence(
                evidence_type="reported_origin_claim",
                summary=f"Account is the sender on the reported origin transaction {origin_tx.transaction_id} ({origin_tx.amount} {origin_tx.currency}).",
                related_transaction_ids=[origin_tx.transaction_id],
            )
        )
    elif conn_type == "origin_receiver" and origin_tx is not None:
        supporting_evidence.append(
            AccountSupportingEvidence(
                evidence_type="direct_origin_receipt",
                summary=f"Account directly received the reported origin transaction {origin_tx.transaction_id} ({origin_tx.amount} {origin_tx.currency}) from {origin_tx.sender_account_id}.",
                related_transaction_ids=[origin_tx.transaction_id],
            )
        )
    elif in_traced and traced_in:
        supporting_evidence.append(
            AccountSupportingEvidence(
                evidence_type="downstream_graph_connectivity",
                summary=(
                    f"Connected at hop {hop_count} from initial receiver via {len(traced_in)} inbound "
                    f"traced transaction(s) across path(s) {', '.join(path_ids)}."
                ),
                related_transaction_ids=[t.transaction_id for t in traced_in],
            )
        )

    explicit_lineage_txs = [t for t in traced_in + traced_out if t.attributed_amount is not None]
    if explicit_lineage_txs:
        notes_summary = "; ".join(
            f"{t.transaction_id}: {t.attributed_amount} {t.currency} ({t.attribution_basis.value if t.attribution_basis else 'assumed'})"
            for t in explicit_lineage_txs
        )
        supporting_evidence.append(
            AccountSupportingEvidence(
                evidence_type="scenario_lineage_metadata",
                summary=f"Explicit scenario lineage metadata present on {len(explicit_lineage_txs)} leg(s): {notes_summary}.",
                related_transaction_ids=[t.transaction_id for t in explicit_lineage_txs],
            )
        )

    if current_review.reviewer_id or current_review.decision_reasons or current_review.supporting_transaction_ids:
        supporting_evidence.append(
            AccountSupportingEvidence(
                evidence_type="human_reviewer_record",
                summary=(
                    f"Reviewer {current_review.reviewer_id or 'recorded'} set state to "
                    f"'{current_review.review_state.value}' with evidence quality '{current_review.evidence_quality.value}'"
                    + (f" — Notes: {current_review.notes}" if current_review.notes else ".")
                ),
                related_transaction_ids=list(current_review.supporting_transaction_ids),
            )
        )

    evidence_gaps: list[str] = []
    uncertainty_factors: list[str] = [
        "Graph connectivity and fund receipt do not establish whether the account holder had knowledge of the upstream report.",
    ]

    missing_lineage_txs = [t.transaction_id for t in traced_in + traced_out if t.attributed_amount is None]
    if missing_lineage_txs:
        evidence_gaps.append(
            f"Missing or unverified fund lineage metadata on transaction leg(s): {', '.join(missing_lineage_txs)}."
        )
        uncertainty_factors.append(
            f"Traceable exposure cannot be determined because transaction(s) {', '.join(missing_lineage_txs)} lack explicit case attribution."
        )

    if attr_status == "ambiguous_over_attribution":
        evidence_gaps.append(
            "Attributed outbound amount exceeds attributed inbound amount; accounting lineage is inconsistent."
        )
        uncertainty_factors.append(
            "Over-attribution ambiguity prevents calculating a valid unforwarded exposure balance."
        )

    if not in_traced:
        evidence_gaps.append(
            "Account has no chronologically valid downstream path from the reported origin transaction."
        )
        uncertainty_factors.append(
            "Observed transactions for this account occurred prior to or outside the downstream flow from the origin transaction."
        )

    if other_in_count > 0 or other_out_count > 0:
        evidence_gaps.append(
            f"Account has {other_in_count} inbound and {other_out_count} outbound transaction(s) outside the traced downstream chain; commingled balance history is not fully resolved."
        )
        uncertainty_factors.append(
            "Pre-existing or unrelated account funds may be commingled with traced transfers."
        )

    if attr_basis == "synthetic_scenario_assumption":
        evidence_gaps.append(
            "Lineage attribution relies on synthetic scenario assumptions rather than audited bank accounting records."
        )

    if current_review.evidence_quality != EvidenceQuality.CORROBORATED and account_id != victim_id:
        evidence_gaps.append(
            "No corroborated external documentation (e.g., KYC verification, commercial invoice, or customer statement) has been recorded yet."
        )

    if current_review.additional_info_needed:
        evidence_gaps.append(
            "Human reviewer explicitly flagged this account as requiring additional supporting information before concluding review."
        )

    acct_warnings = [
        w for w in trace.warnings
        if w.account_id == account_id
        or (w.transaction_id and w.transaction_id in {t.transaction_id for t in traced_in + traced_out})
    ]
    for w in acct_warnings:
        uncertainty_factors.append(f"Tracer warning [{w.code}]: {w.message}")
    if trace.summary.truncated:
        uncertainty_factors.append(
            f"Network trace was truncated at max_depth={trace.summary.max_depth}; further downstream hops may exist."
        )

    # Determine evidence sufficiency & non-punitive review guidance
    if account_id == victim_id:
        sufficiency = "scenario_lineage_assumed" if explicit_lineage_txs else "insufficient_evidence"
        rec_state = ReviewState.REPORTING_VICTIM
        rec_rationale = "Account is the reporting origin sender for this case."
        guidance = [
            "Confirm origin transaction details and claimant report documentation with the reporting account holder.",
        ]
    elif current_review.evidence_quality == EvidenceQuality.CORROBORATED and not current_review.additional_info_needed:
        sufficiency = "human_review_corroborated"
        rec_state = current_review.review_state
        rec_rationale = (
            "Human investigator has recorded corroborated evidence for this account; preserve documented review state."
        )
        guidance = [
            "Maintain corroborated documentation in the case dossier and audit trail.",
        ]
    elif attr_status in ("uncertain_missing_lineage", "ambiguous_over_attribution", "no_traced_exposure"):
        sufficiency = "insufficient_evidence"
        rec_state = ReviewState.UNDER_REVIEW if in_traced else ReviewState.NOT_REVIEWED
        rec_rationale = (
            "Lineage is incomplete or ambiguous (`insufficient_evidence`). Further human verification is required "
            "before drawing any conclusion about fund attribution."
        )
        guidance = [
            "Obtain ledger balance history and transaction narration for legs lacking explicit lineage metadata.",
            "Do not assume downstream transfers carry case-derived funds when intermediate commingling is unresolved.",
            "Verify whether the transfer corresponds to a normal commercial payment, invoice, or personal transfer.",
        ]
    elif current_review.evidence_quality == EvidenceQuality.GRAPH_CONNECTION_ONLY:
        sufficiency = "graph_connection_only"
        rec_state = ReviewState.UNDER_REVIEW
        rec_rationale = (
            "Available evidence consists solely of transaction graph connectivity; human review is needed to "
            "distinguish routine commercial/counterparty receipt from unauthorized pass-through."
        )
        guidance = [
            "Check counterparty relationship and payment purpose (invoice, merchant order, or payroll record).",
            "Review account KYC profile and historical transaction baseline before taking any external compliance step.",
        ]
    else:
        sufficiency = "scenario_lineage_assumed"
        rec_state = (
            ReviewState.UNDER_INVESTIGATION
            if conn_type == "origin_receiver"
            else ReviewState.UNDER_REVIEW
        )
        rec_rationale = (
            "Traceable exposure is supported by scenario lineage assumptions, but external corroboration "
            "(KYC, payment purpose, beneficiary documentation) is still required for human adjudication."
        )
        guidance = [
            "Verify the business or personal purpose of the inbound transfer(s) and any supporting invoices or contracts.",
            "If outbound forwarding occurred rapidly, check whether transfers were triggered by automated rules or manual login sessions.",
            "Record reviewer rationale and supporting transaction IDs in the human review workflow once verified.",
        ]

    evidence_assessment = AccountEvidenceAssessment(
        evidence_sufficiency=sufficiency,
        supporting_evidence=supporting_evidence,
        evidence_gaps=evidence_gaps,
        uncertainty_factors=uncertainty_factors,
        verification_guidance=guidance,
        recommended_review_state=rec_state,
        recommendation_rationale=rec_rationale,
    )

    paths_for_account = [p for p in trace.paths if account_id in p.account_ids]

    acct_audits = [
        AuditEventResponse(
            event_id=e.event_id,
            case_id=e.case_id,
            timestamp=e.timestamp,
            action=e.action,
            performed_by=e.performed_by,
            entity_type=e.entity_type,
            entity_id=e.entity_id,
            details=e.details,
        )
        for e in audit_events
        if e.entity_id == f"{case.case_id}:{account_id}"
        or e.entity_id == account_id
        or (isinstance(e.details, dict) and e.details.get("account_id") == account_id)
    ]

    return AccountAssessmentResponse(
        case_id=case.case_id,
        account_id=account_id,
        graph_position=graph_position,
        observed_movement=observed_movement,
        traceable_exposure=traceable_exposure,
        observed_signals=signals,
        paths_involving_account=paths_for_account,
        evidence_assessment=evidence_assessment,
        review_status=current_review,
        audit_history=acct_audits,
        warnings=acct_warnings,
        transaction_risk_separation_note=TRANSACTION_RISK_SEPARATION_NOTE,
        automated_action_taken="none",
        decision_support_only=True,
        disclaimer= f"{ASSESSMENT_DISCLAIMER} {TRACE_DISCLAIMER}",
    )


def assess_case_account(
    case: FraudCase,
    account_id: str,
    transactions: Iterable[Transaction],
    accounts: Optional[Iterable[Account]] = None,
    review_statuses: Optional[Iterable[AccountReviewStatus]] = None,
    audit_events: Optional[Iterable[AuditEvent]] = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> AccountAssessmentResponse:
    """Assess one account within a case using the existing tracing engine."""
    tx_list = list(transactions)
    acct_list = list(accounts or [])
    rev_list = list(review_statuses or [])
    audit_list = list(audit_events or [])

    trace = trace_case(
        case=case,
        transactions=tx_list,
        accounts=acct_list,
        review_statuses=rev_list,
        max_depth=max_depth,
    )
    clean_txs, _ = sanitize_transactions(tx_list)
    account_map = {a.account_id: a for a in acct_list}
    review_map = {r.account_id: r for r in rev_list if r.case_id == case.case_id}

    return _build_assessment_for_account(
        case=case,
        account_id=account_id,
        trace=trace,
        clean_txs=clean_txs,
        account_map=account_map,
        review_map=review_map,
        audit_events=audit_list,
    )


def assess_all_case_accounts(
    case: FraudCase,
    transactions: Iterable[Transaction],
    accounts: Optional[Iterable[Account]] = None,
    review_statuses: Optional[Iterable[AccountReviewStatus]] = None,
    audit_events: Optional[Iterable[AuditEvent]] = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> CaseAccountAssessmentsResponse:
    """Assess all accounts connected to a case's traced network in traversal order."""
    tx_list = list(transactions)
    acct_list = list(accounts or [])
    rev_list = list(review_statuses or [])
    audit_list = list(audit_events or [])

    trace = trace_case(
        case=case,
        transactions=tx_list,
        accounts=acct_list,
        review_statuses=rev_list,
        max_depth=max_depth,
    )
    clean_txs, _ = sanitize_transactions(tx_list)
    account_map = {a.account_id: a for a in acct_list}
    review_map = {r.account_id: r for r in rev_list if r.case_id == case.case_id}

    origin_tx = clean_txs.get(trace.origin_transaction_id)
    ordered_ids: list[str] = []
    if origin_tx is not None:
        ordered_ids.append(origin_tx.sender_account_id)
    for linked in trace.linked_accounts:
        if linked.account_id not in ordered_ids:
            ordered_ids.append(linked.account_id)

    assessments = [
        _build_assessment_for_account(
            case=case,
            account_id=aid,
            trace=trace,
            clean_txs=clean_txs,
            account_map=account_map,
            review_map=review_map,
            audit_events=audit_list,
        )
        for aid in ordered_ids
    ]

    return CaseAccountAssessmentsResponse(
        case_id=case.case_id,
        count=len(assessments),
        assessments=assessments,
        disclaimer=f"{ASSESSMENT_DISCLAIMER} {TRACE_DISCLAIMER}",
    )
