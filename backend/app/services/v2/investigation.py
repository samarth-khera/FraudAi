"""User-triggered, victim-first investigation over the configured transaction ledger.

Everything in a report is computed at request time from fresh queries: the entered account's history, transfers
flagged by fixed rules against that account's own earlier behaviour, a time-ordered trace of where those funds went
(and came from), an individual rule + model assessment of each linked account, and a balance-based exposure range.
Nothing is stored. Ground-truth labels and scenario tags in the synthetic ledger are never read here.
"""

from __future__ import annotations

import statistics
import time
import uuid
from collections import defaultdict
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

try:
    from app.api.v2.investigation_schemas import InvestigationRequest, InvestigationResponse
    from app.db.v2.models import AccountModel, TransactionModel
    from app.services.v2 import ai_analyst, data_source
    from app.services.v2.graph_tracer import FlowEdge, ForensicGraphTracer
    from app.services.v2.live_analysis import compare_review_suggestions
    from app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService
    from app.services.v2.risk_assessment import AccountRiskAssessor
except ModuleNotFoundError:
    from backend.app.api.v2.investigation_schemas import InvestigationRequest, InvestigationResponse
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.services.v2 import ai_analyst, data_source
    from backend.app.services.v2.graph_tracer import FlowEdge, ForensicGraphTracer
    from backend.app.services.v2.live_analysis import compare_review_suggestions
    from backend.app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService
    from backend.app.services.v2.risk_assessment import AccountRiskAssessor

# Flag thresholds. Each compares a transfer with the same account's EARLIER transfers only.
MIN_HISTORY = 5  # earlier outgoing (or incoming) transfers needed before "above own history" can apply
ABOVE_HISTORY_MULTIPLE = 2.0
ABOVE_HISTORY_MIN_AMOUNT = 10_000.0
DRAIN_SHARE = 0.5
DRAIN_MIN_AMOUNT = 25_000.0
BURST_WINDOW = timedelta(minutes=60)
BURST_MIN_TRANSFERS = 3
BURST_MIN_TOTAL = 25_000.0
FORWARD_WINDOW = timedelta(minutes=30)
FORWARD_MIN_INFLOW = 10_000.0
FORWARD_SHARE = 0.7

FALLBACK_SEEDS = 5  # largest transfers traced when none are flagged
MAX_SEEDS = 50
MAX_FUNDING_SEEDS = 10
MAX_EDGES_PER_ACCOUNT = 10
MAX_EXPOSURE_ACCOUNTS = 60
INTERMEDIARY_SHARE = 0.7


class AccountNotFound(Exception):
    pass


def _money(x: float) -> str:
    """Indian digit grouping (₹2,50,000), matching the frontend; paise only when present."""
    sign, x = ("-" if x < 0 else ""), abs(round(x, 2))
    whole, paise = divmod(round(x * 100), 100)
    digits = str(whole)
    head, tail = digits[:-3], digits[-3:]
    groups = [head[max(0, i - 2):i] for i in range(len(head), 0, -2)][::-1]
    grouped = ",".join(groups + [tail]) if head else tail
    return f"{sign}₹{grouped}" + (f".{paise:02d}" if paise else "")


def _ts(t: datetime) -> str:
    return t.isoformat()


def _transfer(t: TransactionModel) -> dict:
    return {
        "transaction_id": t.transaction_id,
        "timestamp": _ts(t.timestamp),
        "origin_account_id": t.origin_account_id,
        "destination_account_id": t.destination_account_id,
        "amount": round(t.amount, 2),
        "currency": t.currency,
        "channel": t.channel,
        "status": t.status,
        "origin_balance_before": round(t.origin_balance_before, 2),
        "origin_balance_after": round(t.origin_balance_after, 2),
        "dest_balance_before": round(t.dest_balance_before, 2),
        "dest_balance_after": round(t.dest_balance_after, 2),
    }


def compute_flags(account_id: str, txns: list[TransactionModel]) -> dict[str, list[dict]]:
    """Rule flags for the account's own transfers. `txns` is its full history in time order."""
    flags: dict[str, list[dict]] = defaultdict(list)
    out = [t for t in txns if t.origin_account_id == account_id]
    inc = [t for t in txns if t.destination_account_id == account_id]

    for side, rows, code in (("outgoing", out, "AMOUNT_ABOVE_OWN_HISTORY"), ("incoming", inc, "INFLOW_ABOVE_OWN_HISTORY")):
        prev_max, n = 0.0, 0
        for t in rows:
            if n >= MIN_HISTORY and t.amount > ABOVE_HISTORY_MULTIPLE * prev_max and t.amount >= ABOVE_HISTORY_MIN_AMOUNT:
                flags[t.transaction_id].append({
                    "code": code,
                    "explanation": f"{_money(t.amount)} is {t.amount / prev_max:.1f}x the largest of the account's "
                                   f"{n} earlier {side} transfers ({_money(prev_max)}).",
                })
            prev_max, n = max(prev_max, t.amount), n + 1

    for t in out:
        before = t.origin_balance_before
        if t.amount >= DRAIN_MIN_AMOUNT and before > 0 and t.amount >= DRAIN_SHARE * before:
            flags[t.transaction_id].append({
                "code": "BALANCE_DRAIN",
                "explanation": f"Moved {t.amount / before * 100:.0f}% of the {_money(before)} balance held just before it.",
            })

    seen: set[str] = set()
    first_time: list[TransactionModel] = []
    for t in out:
        if t.destination_account_id not in seen:
            first_time.append(t)
        seen.add(t.destination_account_id)
    burst_ids: set[str] = set()
    for i, start in enumerate(first_time):
        group = [t for t in first_time[i:] if t.timestamp <= start.timestamp + BURST_WINDOW]
        total = sum(t.amount for t in group)
        if len(group) >= BURST_MIN_TRANSFERS and total >= BURST_MIN_TOTAL:
            span = (group[-1].timestamp - group[0].timestamp).total_seconds() / 60
            for t in group:
                if t.transaction_id not in burst_ids:
                    burst_ids.add(t.transaction_id)
                    flags[t.transaction_id].append({
                        "code": "BURST_TO_NEW_RECIPIENTS",
                        "explanation": f"One of {len(group)} transfers to recipients this account had never paid before, "
                                       f"sent within {span:.0f} minutes ({_money(total)} in total).",
                    })

    for t_in in inc:
        if t_in.amount < FORWARD_MIN_INFLOW:
            continue
        onward = [o for o in out if t_in.timestamp <= o.timestamp <= t_in.timestamp + FORWARD_WINDOW]
        if onward and sum(o.amount for o in onward) >= FORWARD_SHARE * t_in.amount:
            flags[t_in.transaction_id].append({
                "code": "RAPIDLY_FORWARDED_INFLOW",
                "explanation": f"{_money(sum(o.amount for o in onward))} left the account within 30 minutes of this "
                               f"{_money(t_in.amount)} arriving ({', '.join(o.transaction_id for o in onward)}).",
            })
            for o in onward:
                mins = (o.timestamp - t_in.timestamp).total_seconds() / 60
                flags[o.transaction_id].append({
                    "code": "FORWARDS_RECENT_INFLOW",
                    "explanation": f"Sent {mins:.0f} minutes after {_money(t_in.amount)} arrived ({t_in.transaction_id}).",
                })
    return dict(flags)


class InvestigationService:
    @classmethod
    def run(cls, db: Session, req: InvestigationRequest, provider: Any = None) -> InvestigationResponse:
        started = datetime.now(timezone.utc)
        clock = time.perf_counter()
        source = data_source.describe(db)  # raises DataSourceUnavailable with the precise blocker
        rows_read = 0

        root_id = req.account_id
        root = db.scalar(select(AccountModel).where(AccountModel.account_id == root_id))
        if root is None:
            raise AccountNotFound(root_id)

        history = db.scalars(
            select(TransactionModel)
            .where(or_(TransactionModel.origin_account_id == root_id, TransactionModel.destination_account_id == root_id))
            .order_by(TransactionModel.timestamp.asc(), TransactionModel.transaction_id.asc())
        ).all()
        rows_read += len(history)

        start_dt = datetime.combine(req.start_date, dtime.min) if req.start_date else None
        end_dt = datetime.combine(req.end_date, dtime.max) if req.end_date else None
        period = [t for t in history if (start_dt is None or t.timestamp >= start_dt) and (end_dt is None or t.timestamp <= end_dt)]
        period_out = [t for t in period if t.origin_account_id == root_id]
        period_in = [t for t in period if t.destination_account_id == root_id]

        flags = compute_flags(root_id, list(history))
        flagged_out = [t for t in period_out if t.transaction_id in flags]
        flagged_in = [t for t in period_in if t.transaction_id in flags]

        # ---------------------------------------------------------------- seeds
        window = timedelta(hours=req.onward_window_hours)
        selection: list[str] = []
        if req.trace_scope == "all":
            down = sorted(period_out, key=lambda t: -t.amount)[:MAX_SEEDS]
            up = sorted(period_in, key=lambda t: -t.amount)[:MAX_SEEDS]
            selection.append(f"All {len(period_out)} outgoing and {len(period_in)} incoming transfers in the period were selected for tracing.")
            if len(period_out) > MAX_SEEDS or len(period_in) > MAX_SEEDS:
                selection.append(f"Only the {MAX_SEEDS} largest in each direction were traced.")
        else:
            if flagged_out:
                down = flagged_out
                selection.append(f"Traced the {len(flagged_out)} outgoing transfer(s) flagged as unusual.")
            else:
                down = sorted(period_out, key=lambda t: -t.amount)[:FALLBACK_SEEDS]
                selection.append(
                    f"No outgoing transfer in the period was flagged as unusual, so the {len(down)} largest were traced instead."
                    if down else "The account made no outgoing transfers in the period."
                )
            funding = []
            for t in flagged_out:
                funding += [i for i in period_in if t.timestamp - window <= i.timestamp <= t.timestamp]
            funding_ids = {t.transaction_id for t in flagged_in}
            up = list(flagged_in) + sorted(
                [t for t in {f.transaction_id: f for f in funding}.values() if t.transaction_id not in funding_ids],
                key=lambda t: -t.amount,
            )[:MAX_FUNDING_SEEDS]
            if flagged_in:
                selection.append(f"Traced back the {len(flagged_in)} incoming transfer(s) flagged as unusual.")
            if len(up) > len(flagged_in):
                selection.append(
                    f"Traced back {len(up) - len(flagged_in)} incoming transfer(s) received within {req.onward_window_hours:g} h "
                    "before a flagged outgoing transfer."
                )
            if not up and not flagged_out:
                up = sorted(period_in, key=lambda t: -t.amount)[:FALLBACK_SEEDS]
                if up:
                    selection.append(f"No incoming transfer was flagged, so the {len(up)} largest incoming were traced back.")

        flow = ForensicGraphTracer.trace_from_seeds(
            db, root_id, down, up, max_depth=req.max_depth, max_nodes=req.max_nodes,
            window_hours=req.onward_window_hours, max_edges_per_account=MAX_EDGES_PER_ACCOUNT,
        )
        rows_read += flow.rows_read

        accounts = {
            a.account_id: a
            for a in db.scalars(select(AccountModel).where(AccountModel.account_id.in_(list(flow.node_hops)))).all()
        }

        def graph_role(acc_id: str) -> str:
            hop, direction = flow.node_hops[acc_id]
            if hop == 0:
                return "investigated_account"
            if direction == "downstream":
                return "direct_recipient" if hop == 1 else "onward_recipient"
            return "direct_sender" if hop == 1 else "upstream_sender"

        edges = []
        for e in flow.edges:
            d = _transfer(e.txn)
            touches_root = root_id in (e.txn.origin_account_id, e.txn.destination_account_id)
            d.update({
                "direction": e.direction,
                "hop": e.hop,
                "evidence_type": "observed_direct" if touches_root else "inferred_related",
                "parent_transaction_id": e.parent_transaction_id,
                "minutes_from_parent": e.minutes_from_parent,
                "is_cycle": e.is_cycle,
                "converges": e.converges,
                "flags": flags.get(e.txn.transaction_id, []) if touches_root else [],
            })
            edges.append(d)
        edges.sort(key=lambda d: d["timestamp"])

        traced_in: dict[str, float] = defaultdict(float)
        traced_out: dict[str, float] = defaultdict(float)
        in_edges: dict[str, list[FlowEdge]] = defaultdict(list)
        out_edges: dict[str, list[FlowEdge]] = defaultdict(list)
        # Cycle edges stay in the graph and findings but are not counted as new money into an account.
        for e in (e for e in flow.edges if not e.is_cycle):
            traced_in[e.txn.destination_account_id] += e.txn.amount
            traced_out[e.txn.origin_account_id] += e.txn.amount
            in_edges[e.txn.destination_account_id].append(e)
            out_edges[e.txn.origin_account_id].append(e)

        # ---------------------------------------------------------------- exposure (lowest intermediate balance)
        downstream_ids = sorted(
            [a for a, (h, d) in flow.node_hops.items() if d == "downstream"],
            key=lambda a: (flow.node_hops[a][0], -traced_in[a]),
        )
        exposure_lines: dict[str, dict] = {}
        for acc_id in downstream_ids[:MAX_EXPOSURE_ACCOUNTS]:
            receipts = [e.txn for e in in_edges[acc_id] if e.direction == "downstream"]
            if not receipts:
                continue
            first = min(r.timestamp for r in receipts)
            receipt_ids = {r.transaction_id for r in receipts}
            rows = db.scalars(
                select(TransactionModel)
                .where(
                    or_(TransactionModel.origin_account_id == acc_id, TransactionModel.destination_account_id == acc_id),
                    and_(TransactionModel.timestamp >= first, TransactionModel.timestamp <= first + window),
                )
                .order_by(TransactionModel.timestamp.asc(), TransactionModel.transaction_id.asc())
            ).all()
            rows_read += len(rows)
            traced, lowest, outgoing = 0.0, None, 0.0
            received = 0.0
            for t in rows:
                is_dest = t.destination_account_id == acc_id
                balance = t.dest_balance_after if is_dest else t.origin_balance_after
                if t.transaction_id in receipt_ids:
                    traced += t.amount
                    received += t.amount
                if not is_dest:
                    outgoing += t.amount
                traced = min(traced, balance)
                lowest = balance if lowest is None else min(lowest, balance)
            exposure_lines[acc_id] = {
                "account_id": acc_id,
                "hop": flow.node_hops[acc_id][0],
                "traced_in_amount": round(received, 2),
                "outgoing_in_window": round(outgoing, 2),
                "forwarded_min": round(max(0.0, received - traced), 2),
                "forwarded_max": round(min(received, outgoing), 2),
                "lowest_balance_in_window": round(lowest, 2) if lowest is not None else None,
            }

        # ---------------------------------------------------------------- per-account assessment
        upstream_ids = sorted(
            [a for a, (h, d) in flow.node_hops.items() if d == "upstream"],
            key=lambda a: (flow.node_hops[a][0], -traced_out[a]),
        )
        priority = [root_id] + downstream_ids + upstream_ids
        to_analyze = priority[: req.max_accounts_analyzed]
        model_error: Optional[str] = None
        assessed: dict[str, dict] = {}
        for acc_id in to_analyze:
            if acc_id in assessed or acc_id not in accounts:
                continue
            rule = AccountRiskAssessor.assess_account(db, acc_id)
            rows_read += rule.signals.total_transactions
            ml = None
            if model_error is None:
                try:
                    ml = V2MLInferenceService.assess_account(db, acc_id, rule_assessment=rule, account=accounts[acc_id])
                except ModelUnavailableException as exc:
                    model_error = str(exc)
            assessed[acc_id] = {"rule": rule, "ml": ml}

        threshold = V2MLInferenceService.decision_threshold() if model_error is None else None
        model_version = next((v["ml"].model_version for v in assessed.values() if v["ml"]), None)

        # ---------------------------------------------------------------- per-account findings
        account_findings = []
        for acc_id in priority:
            acc = accounts.get(acc_id)
            if acc is None:
                continue
            hop, _ = flow.node_hops[acc_id]
            role_g = graph_role(acc_id)
            a = assessed.get(acc_id)
            rule = a["rule"] if a else None
            ml = a["ml"] if a else None
            cmp = (
                compare_review_suggestions(ml.predicted_class, rule.risk_level, bool(rule.signals.rapid_pass_through))
                if rule is not None and ml is not None else None
            )
            rule_suggests = rule.risk_level in ("high", "critical") if rule else None
            model_suggests = cmp["model_suggests_review"] if cmp else None
            line = exposure_lines.get(acc_id)
            evidence_ids = sorted({e.txn.transaction_id for e in in_edges[acc_id] + out_edges[acc_id]})
            basis: list[str] = []

            if acc_id == root_id:
                forwarding = [t for t in flagged_out if any(f["code"] == "FORWARDS_RECENT_INFLOW" for f in flags[t.transaction_id])]
                if flagged_out and len(forwarding) < len(flagged_out):
                    role = "victim_candidate"
                    basis.append(
                        f"Sent {len(flagged_out)} transfer(s) flagged as unusual against its own history, "
                        f"{_money(sum(t.amount for t in flagged_out))} in total."
                    )
                elif flagged_out:
                    role = "possible_intermediary"
                    basis.append("Its flagged outgoing transfers forwarded money it had received minutes earlier, "
                                 "so it may not be where the funds originated.")
                else:
                    role = "insufficient_evidence"
                    basis.append("No outgoing transfer in the period was flagged as unusual.")
            elif a is None:
                role = "not_analyzed"
            elif role_g in ("direct_recipient", "onward_recipient") and line and line["traced_in_amount"] > 0 \
                    and line["forwarded_min"] >= INTERMEDIARY_SHARE * line["traced_in_amount"]:
                role = "possible_intermediary"
                basis.append(
                    f"Received {_money(line['traced_in_amount'])} in traced transfers and, judging by its balance, at least "
                    f"{_money(line['forwarded_min'])} of it had moved on within {req.onward_window_hours:g} h "
                    f"(lowest balance in that time {_money(line['lowest_balance_in_window'] or 0)})."
                )
            elif rule_suggests or model_suggests:
                role = "recipient_under_review" if flow.node_hops[acc_id][1] == "downstream" else "sender_under_review"
            else:
                role = "insufficient_evidence"

            if acc_id != root_id and a is not None:
                if flow.node_hops[acc_id][1] == "downstream":
                    basis.append(f"Received {_money(traced_in[acc_id])} through traced transfers ({hop} hop(s) from {root_id}).")
                else:
                    basis.append(f"Sent {_money(traced_out[acc_id])} into the traced flow ({hop} hop(s) before {root_id}).")
                if rule_suggests:
                    basis.append(f"Fixed rules score it {rule.risk_score:.0f}/100 ({rule.risk_level}).")
                if model_suggests:
                    basis.append(f"Model score {ml.risk_score:.1f}% is at or above the review threshold of {threshold * 100:.1f}%.")
                if role == "insufficient_evidence":
                    basis.append("Neither check suggests review and no strong onward movement was observed.")

            alternatives: list[str] = []
            if acc_id == root_id:
                alternatives.append("The holder may have made these payments knowingly and for legitimate reasons; "
                                    "the ledger records the payment, not whether it was authorised or induced by deception.")
            else:
                alternatives.append("Receiving or sending money is not wrongdoing: the holder may have been paid for goods "
                                    "or services, or been deceived into moving funds for someone else.")
            if acc.customer_type in ("sme", "corporate"):
                alternatives.append(f"It is a {acc.customer_type} account; businesses routinely receive and pay out funds.")
            first_link = min((e.txn.timestamp for e in in_edges[acc_id] + out_edges[acc_id]), default=None)
            if first_link and acc.account_opened_at:
                age_days = (first_link - acc.account_opened_at.replace(tzinfo=None)).days
                if age_days >= 180:
                    alternatives.append(f"The account was opened {age_days} days before its first traced transfer, "
                                        "so it was not opened just for this flow.")
            if role == "possible_intermediary":
                alternatives.append("Fast onward payments can be ordinary (paying suppliers or family) or made by a "
                                    "holder who is themself following a scammer's instructions.")
            if cmp and cmp["model_suggests_review"] and not rule_suggests:
                alternatives.append("The model flags it but the rules do not; a large unusual payment out can also be "
                                    "the mark of a scam victim rather than a perpetrator.")

            missing = ["Device, IP and login records for these transfers (not held in the ledger)."]
            if acc.kyc_tier == "tier_1_basic":
                missing.append("KYC is basic tier: the holder's identity is not fully verified.")
            if any(e.txn.channel == "ATM_CASH_OUT" for e in in_edges[acc_id] + out_edges[acc_id]):
                missing.append("ATM or cash-terminal records (location, camera footage): the ledger cannot follow cash.")
            if a is None:
                missing.append(f"Not individually assessed in this run (limit of {req.max_accounts_analyzed} accounts).")
            elif rule.uncertainty_rating == "high":
                missing.append(f"Only {rule.signals.total_transactions} transaction(s) on record: scores are less reliable.")
            if a is not None and ml is None:
                missing.append("Model assessment unavailable: " + (model_error or "unknown reason."))

            steps: list[str] = []
            ev = ", ".join(evidence_ids[:4]) or "the traced transfers"
            if role == "victim_candidate":
                steps.append(f"Contact the account holder through a verified channel to confirm whether they authorised "
                             f"{', '.join(t.transaction_id for t in flagged_out[:4])}.")
                steps.append("Request authentication and session logs for the flagged transfers.")
            elif role == "possible_intermediary":
                steps.append(f"Review KYC and account-opening records, and the purpose of {ev}.")
                steps.append("Consider escalating for a decision on protective restrictions through the institution's "
                             "authorised process. Nothing is restricted automatically.")
            elif role in ("recipient_under_review", "sender_under_review"):
                steps.append(f"Review the rule reasons and model factors against {ev} before deciding anything.")
            elif role == "not_analyzed":
                steps.append("Run a separate investigation on this account if its link to the flow matters.")
            else:
                steps.append("No action is suggested from this evidence alone; keep it in the case file.")

            disagree_note = None
            if cmp and cmp["checks_disagree"]:
                disagree_note = (
                    "The model suggests review but the fixed rules do not." if cmp["model_suggests_review"]
                    else "The fixed rules suggest review but the model scores it below its threshold, which does not clear it."
                )

            account_findings.append({
                "account_id": acc_id,
                "customer_name": acc.customer_name,
                "customer_type": acc.customer_type,
                "kyc_tier": acc.kyc_tier,
                "graph_role": role_g,
                "hop_distance": hop,
                "role_assessment": role,
                "role_basis": basis,
                "analyzed": a is not None,
                "not_analyzed_reason": None if a else f"Beyond the limit of {req.max_accounts_analyzed} accounts assessed per investigation.",
                "rule_assessment": rule,
                "model_assessment": ml,
                "model_unavailable_reason": model_error if a is not None and ml is None else None,
                "model_suggests_review": model_suggests,
                "rule_suggests_review": rule_suggests,
                "checks_disagree": cmp["checks_disagree"] if cmp else None,
                "disagreement_note": disagree_note,
                "traced_in_amount": round(traced_in[acc_id], 2),
                "traced_out_amount": round(traced_out[acc_id], 2),
                "evidence_transaction_ids": evidence_ids,
                "alternative_explanations": alternatives,
                "missing_evidence": missing,
                "next_steps": steps,
            })

        # ---------------------------------------------------------------- findings
        findings: list[dict] = []

        def add(kind: str, subject: Optional[str], statement: str, txns: list[str] = (), accs: list[str] = ()) -> str:
            fid = f"F-{len(findings) + 1:03d}"
            findings.append({"finding_id": fid, "kind": kind, "subject_account_id": subject, "statement": statement,
                             "evidence": {"transaction_ids": list(txns), "account_ids": list(accs)}})
            return fid

        if source["is_synthetic"]:
            add("limitation", None, "Every record in this investigation comes from the synthetic demo ledger; "
                                    "no real customer or bank transaction is involved.")
        for t in flagged_out + flagged_in:
            other = t.destination_account_id if t.origin_account_id == root_id else t.origin_account_id
            verb = "sent" if t.origin_account_id == root_id else "received"
            add("observed", root_id, f"{root_id} {verb} {_money(t.amount)} {'to' if verb == 'sent' else 'from'} {other} "
                                     f"via {t.channel} at {_ts(t.timestamp)}.", [t.transaction_id], [root_id, other])
            add("rule", root_id, f"{t.transaction_id} is flagged: " + " ".join(f["explanation"] for f in flags[t.transaction_id]),
                [t.transaction_id], [root_id])
        for acc_id in downstream_ids:
            onward = [e.txn for e in out_edges[acc_id] if e.direction == "downstream"]
            receipts = [e.txn for e in in_edges[acc_id] if e.direction == "downstream"]
            if onward and receipts:
                gap_h = (min(o.timestamp for o in onward) - min(r.timestamp for r in receipts)).total_seconds() / 3600
                add("observed", acc_id,
                    f"After receiving {_money(sum(r.amount for r in receipts))}, {acc_id} sent {_money(sum(o.amount for o in onward))} "
                    f"in {len(onward)} transfer(s), the first {gap_h:.1f} h later. Whether this was the same money is inferred, not proven.",
                    [r.transaction_id for r in receipts] + [o.transaction_id for o in onward],
                    sorted({acc_id, *(o.destination_account_id for o in onward)}))
        for e in flow.edges:
            if e.is_cycle:
                back_to = e.txn.destination_account_id if e.direction == "downstream" else e.txn.origin_account_id
                add("observed", back_to, f"{e.txn.transaction_id} moves {_money(e.txn.amount)} back to {back_to}, "
                                         "which is already on the traced path: a cycle.",
                    [e.txn.transaction_id], [e.txn.origin_account_id, e.txn.destination_account_id])
            if e.txn.channel == "ATM_CASH_OUT":
                add("observed", e.txn.origin_account_id,
                    f"{_money(e.txn.amount)} left {e.txn.origin_account_id} as an ATM cash-out ({e.txn.transaction_id}); "
                    "the ledger cannot follow cash further.",
                    [e.txn.transaction_id], [e.txn.origin_account_id, e.txn.destination_account_id])
        for f in account_findings:
            rule, ml = f["rule_assessment"], f["model_assessment"]
            if f["rule_suggests_review"]:
                reasons = "; ".join(r.split(":")[0] for r in rule.reason_codes[:4])
                add("rule", f["account_id"], f"Fixed rules score {f['account_id']} {rule.risk_score:.0f}/100 ({rule.risk_level}): {reasons}.",
                    f["evidence_transaction_ids"][:6], [f["account_id"]])
            if f["model_suggests_review"]:
                top = ml.top_contributions[0] if ml.top_contributions else None
                factor = f" Largest factor: {top.feature_name} ({'raises' if top.impact_direction == 'increases_risk' else 'lowers'} the score)." if top else ""
                add("model", f["account_id"], f"Model score for {f['account_id']} is {ml.risk_score:.1f}%, at or above the "
                                              f"review threshold of {threshold * 100:.1f}%.{factor}",
                    f["evidence_transaction_ids"][:6], [f["account_id"]])
            if f["checks_disagree"]:
                add("model", f["account_id"], f"{f['account_id']}: {f['disagreement_note']}", [], [f["account_id"]])
        for note in flow.truncation_notes:
            add("limitation", None, note)
        if model_error:
            add("limitation", None, f"The account model could not run, so no model scores are included: {model_error}")

        # ---------------------------------------------------------------- recommendations
        recs: list[dict] = []
        for f in account_findings:
            role, acc_id = f["role_assessment"], f["account_id"]
            refs = {"transaction_ids": f["evidence_transaction_ids"][:6], "account_ids": [acc_id]}
            if role == "victim_candidate":
                recs.append(("contact_account_holder", acc_id, f"Confirm with the holder of {acc_id}, through a verified channel, whether the flagged transfers were authorised.",
                             refs, "The ledger cannot show intent, authorisation or deception."))
            elif role == "possible_intermediary":
                recs.append(("consider_escalation", acc_id, f"Consider escalating {acc_id} for an authorised decision on protective restrictions, after reviewing its KYC and the onward transfers.",
                             refs, "Fast onward movement is consistent with a mule account but also with ordinary payments or a deceived holder."))
            elif role in ("recipient_under_review", "sender_under_review"):
                recs.append(("further_review", acc_id, f"Review {acc_id}: its checks suggest review, but no strong onward movement of the traced funds was observed.",
                             refs, "Scores are prompts for review, not findings; the model was trained on synthetic data."))
        recs.append(("obtain_records", None, "Obtain device/login records for the flagged transfers and beneficiary-bank statements for accounts at the end of the trace.",
                     {"transaction_ids": [t.transaction_id for t in flagged_out[:6]], "account_ids": [root_id]},
                     "Without them, account takeover and the final destination of funds cannot be established."))
        recommendations = [
            {"recommendation_id": f"R-{i + 1:03d}", "action": a, "account_id": acc, "statement": s, "evidence": ev, "uncertainty": u}
            for i, (a, acc, s, ev, u) in enumerate(recs)
        ]

        unknowns = [
            "Whether the flagged transfers were authorised by the account holder: the ledger records payments, not intent.",
            "Which part of a recipient's later transfers carried this money: balances mix funds, so onward links are "
            "inferred from timing and balances, not proven.",
            "Activity outside this ledger: accounts at other institutions, cash after withdrawal, and transfers beyond the "
            "trace limits.",
            "Device, login, communication and complaint records, none of which are in the ledger.",
        ] + flow.truncation_notes + ([f"Model output: {model_error}"] if model_error else [])
        records = [
            "Authentication, device and IP logs for the flagged transfers.",
            "The account holder's statement or complaint, if one exists.",
            "KYC and account-opening documents for accounts assessed as possible intermediaries.",
            "Beneficiary-bank statements for accounts at the end of the trace.",
        ]
        if any(e.txn.channel == "ATM_CASH_OUT" for e in flow.edges):
            records.append("ATM / cash-terminal records for the cash-out transfers.")

        # ---------------------------------------------------------------- exposure
        flagged_total = round(sum(t.amount for t in flagged_out), 2)
        exposure = {
            "flagged_outgoing_total": flagged_total,
            "traced_outgoing_total": round(sum(t.amount for t in down), 2),
            "observed_downstream_total": round(sum(e.txn.amount for e in flow.edges if e.direction == "downstream"), 2),
            "per_account": [exposure_lines[a] for a in downstream_ids if a in exposure_lines],
            "method": (
                "For each account that received traced funds, its own balance is followed from the first traced receipt "
                f"to {req.onward_window_hours:g} h later. Lower bound (lowest intermediate balance): traced funds are assumed "
                "to stay in the account until its balance falls below them. Upper bound: no more than was received, and no "
                "more than actually left the account. Ranges are per account and must not be added across hops."
            ),
            "limitations": [
                "The observed downstream total counts the same money each time it moves; it is not a loss figure.",
                "Balances combine funds from many sources; no method can prove which rupees were the victim's.",
                f"Exposure is computed for up to {MAX_EXPOSURE_ACCOUNTS} downstream accounts.",
            ],
        }

        # ---------------------------------------------------------------- template evidence summary
        by_id = {f["account_id"]: f for f in account_findings}
        direct = [a for a in downstream_ids if flow.node_hops[a][0] == 1]
        summary = [
            {"question": ai_analyst.QUESTIONS[0], "claims": (
                [{"kind": "rule", "text": f"{root_id} made {len(flagged_out)} outgoing transfer(s) flagged as unusual, "
                                         f"{_money(flagged_total)} in total.", "refs": [t.transaction_id for t in flagged_out]}]
                if flagged_out else
                [{"kind": "observed", "text": f"No outgoing transfer by {root_id} in the period was flagged as unusual.", "refs": [root_id]}]
            )},
            {"question": ai_analyst.QUESTIONS[1], "claims": [
                {"kind": "observed", "text": f"{t.transaction_id}: {_money(t.amount)} "
                                             f"{'to ' + t.destination_account_id if t.origin_account_id == root_id else 'from ' + t.origin_account_id} "
                                             f"via {t.channel}.", "refs": [t.transaction_id]}
                for t in sorted(list(down) + list(up), key=lambda t: t.timestamp)[:12]
            ] or [{"kind": "observed", "text": "No transfers were selected for tracing.", "refs": [root_id]}]},
            {"question": ai_analyst.QUESTIONS[2], "claims": [
                {"kind": "observed", "text": f"{a} received {_money(traced_in[a])} directly from {root_id}.",
                 "refs": [a] + [e.txn.transaction_id for e in in_edges[a] if e.direction == "downstream"]}
                for a in direct[:10]
            ] or [{"kind": "observed", "text": "No traced transfer left the account.", "refs": [root_id]}]},
            {"question": ai_analyst.QUESTIONS[3], "claims": [
                {"kind": "observed", "text": f["statement"], "refs": f["evidence"]["transaction_ids"][:8]}
                for f in findings if f["kind"] == "observed" and f["statement"].startswith("After receiving")
            ][:10] or [{"kind": "limitation", "text": "No onward transfers were observed within the trace window.", "refs": []}]},
            {"question": ai_analyst.QUESTIONS[4], "claims": [
                {"kind": "rule" if by_id[a]["rule_suggests_review"] or by_id[a]["role_assessment"] == "possible_intermediary" else "model",
                 "text": f"{a} ({by_id[a]['role_assessment'].replace('_', ' ')}): " + " ".join(by_id[a]["role_basis"]),
                 "refs": [a] + by_id[a]["evidence_transaction_ids"][:4]}
                for a in by_id if a != root_id and by_id[a]["role_assessment"] in ("possible_intermediary", "recipient_under_review", "sender_under_review")
            ][:10] or [{"kind": "limitation", "text": "No linked account met the criteria for review in this run.", "refs": []}]},
            {"question": ai_analyst.QUESTIONS[5], "claims": (
                [{"kind": "model", "text": f"{f['account_id']}: {f['disagreement_note']}", "refs": [f["account_id"]]}
                 for f in account_findings if f["checks_disagree"]][:10]
                or ([{"kind": "model", "text": f"The model and the rules agree for all {sum(1 for f in account_findings if f['checks_disagree'] is not None)} accounts assessed by both.",
                      "refs": [f["account_id"] for f in account_findings if f["checks_disagree"] is not None][:10]}]
                    if not model_error else
                    [{"kind": "limitation", "text": f"No comparison: the model could not run ({model_error}).", "refs": []}])
            )},
            {"question": ai_analyst.QUESTIONS[6], "claims": [{"kind": "limitation", "text": u, "refs": []} for u in unknowns]},
            {"question": ai_analyst.QUESTIONS[7], "claims": [{"kind": "limitation", "text": r, "refs": []} for r in records]},
            {"question": ai_analyst.QUESTIONS[8], "claims": [
                {"kind": "interpretation", "text": r["statement"], "refs": r["evidence"]["transaction_ids"] + r["evidence"]["account_ids"]}
                for r in recommendations
            ]},
        ]

        median_out = statistics.median([t.amount for t in history if t.origin_account_id == root_id]) \
            if any(t.origin_account_id == root_id for t in history) else None
        first_flag = min((t.timestamp for t in flagged_out), default=None)
        earlier = [t.amount for t in history if t.origin_account_id == root_id and first_flag and t.timestamp < first_flag]

        def top(rows: list[TransactionModel], key: str) -> list[dict]:
            agg: dict[str, dict] = {}
            for t in rows:
                acc_id = getattr(t, key)
                g = agg.setdefault(acc_id, {"account_id": acc_id, "transfers": 0, "total_amount": 0.0,
                                            "first_at": _ts(t.timestamp), "last_at": _ts(t.timestamp)})
                g["transfers"] += 1
                g["total_amount"] = round(g["total_amount"] + t.amount, 2)
                g["last_at"] = _ts(t.timestamp)
            return sorted(agg.values(), key=lambda g: -g["total_amount"])[:8]

        flagged_edges = [e for e in edges if e["flags"]] + [
            dict(_transfer(t), direction="downstream" if t.origin_account_id == root_id else "upstream", hop=1,
                 evidence_type="observed_direct", parent_transaction_id=None, minutes_from_parent=None,
                 is_cycle=False, converges=False, flags=flags[t.transaction_id])
            for t in flagged_out + flagged_in if t.transaction_id not in {e["transaction_id"] for e in edges}
        ]

        victim = {
            "account_id": root_id,
            "customer_name": root.customer_name,
            "customer_type": root.customer_type,
            "kyc_tier": root.kyc_tier,
            "account_status": root.status,
            "account_opened_at": _ts(root.account_opened_at.replace(tzinfo=None)),
            "current_balance": round(root.current_balance, 2),
            "period_start": req.start_date.isoformat() if req.start_date else None,
            "period_end": req.end_date.isoformat() if req.end_date else None,
            "transactions_in_period": len(period),
            "transactions_all_time": len(history),
            "incoming_count": len(period_in),
            "incoming_total": round(sum(t.amount for t in period_in), 2),
            "outgoing_count": len(period_out),
            "outgoing_total": round(sum(t.amount for t in period_out), 2),
            "median_outgoing_amount": round(median_out, 2) if median_out is not None else None,
            "largest_earlier_outgoing_before_first_flag": round(max(earlier), 2) if earlier else None,
            "first_transaction_at": _ts(history[0].timestamp) if history else None,
            "last_transaction_at": _ts(history[-1].timestamp) if history else None,
            "top_senders": top(period_in, "origin_account_id"),
            "top_recipients": top(period_out, "destination_account_id"),
            "flagged_transfers": sorted(flagged_edges, key=lambda e: e["timestamp"]),
        }

        nodes = [
            {
                "account_id": acc_id,
                "customer_name": accounts[acc_id].customer_name,
                "customer_type": accounts[acc_id].customer_type,
                "kyc_tier": accounts[acc_id].kyc_tier,
                "account_status": accounts[acc_id].status,
                "current_balance": round(accounts[acc_id].current_balance, 2),
                "hop_distance": flow.node_hops[acc_id][0],
                "graph_role": graph_role(acc_id),
                "is_root": acc_id == root_id,
            }
            for acc_id in flow.node_hops if acc_id in accounts
        ]

        report = {
            "investigation_id": f"INV-{uuid.uuid4().hex[:10].upper()}",
            "started_at": started.isoformat(),
            "request": req.model_dump(mode="json"),
            "data_source": source,
            "model_version": model_version,
            "model_review_threshold": threshold,
            "model_available": model_error is None,
            "model_unavailable_reason": model_error,
            "victim": victim,
            "trace": {
                "nodes": nodes,
                "edges": edges,
                "downstream_seed_transaction_ids": [t.transaction_id for t in down],
                "upstream_seed_transaction_ids": [t.transaction_id for t in up],
                "seed_selection": " ".join(selection),
                "max_depth_reached": flow.max_depth_reached,
                "cycles_detected": sum(1 for e in flow.edges if e.is_cycle),
                "is_truncated": bool(flow.truncation_notes),
                "truncation_notes": flow.truncation_notes,
                "transactions_read": flow.rows_read,
            },
            "accounts": [
                f | {"rule_assessment": f["rule_assessment"].model_dump() if f["rule_assessment"] else None,
                     "model_assessment": f["model_assessment"].model_dump() if f["model_assessment"] else None}
                for f in account_findings
            ],
            "findings": findings,
            "exposure": exposure,
            "evidence_summary": summary,
            "recommendations": recommendations,
            "unknowns": unknowns,
            "records_to_request": records,
            "ledger_rows_read": rows_read,
            "persisted": False,
            "disclaimer": (
                "Decision support only. Findings describe recorded transfers and automated checks; they are not proof of "
                "fraud, intent or guilt. No account is frozen, blocked or flagged by this report: any restriction requires "
                "an authorised institution process with documented grounds."
                + (" All data is synthetic." if source["is_synthetic"] else "")
            ),
        }
        report["ai_analysis"] = ai_analyst.run(report, provider)
        report["completed_at"] = datetime.now(timezone.utc).isoformat()
        report["duration_ms"] = int((time.perf_counter() - clock) * 1000)
        return InvestigationResponse.model_validate(report)
