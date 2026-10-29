"""Live Account Analysis Service for FraudShield AI V2.

Orchestrates on-demand real-time feature extraction, rule assessment,
ML inference, TreeSHAP explanation, and advisory recommendation generation.
Strictly isolates synthetic evaluation tags from runtime analysis.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

try:
    from app.api.v2.schemas import (
        AccountLiveAnalysisResponse,
        LedgerSnapshotInfo,
        ModelDivergenceInfo,
        RecommendedAction,
    )
    from app.db.v2.models import AccountModel, TransactionModel
    from app.services.v2.ml_service import V2MLInferenceService
    from app.services.v2.risk_assessment import AccountRiskAssessor
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import (
        AccountLiveAnalysisResponse,
        LedgerSnapshotInfo,
        ModelDivergenceInfo,
        RecommendedAction,
    )
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.services.v2.ml_service import V2MLInferenceService
    from backend.app.services.v2.risk_assessment import AccountRiskAssessor


def compare_review_suggestions(model_predicted_class: str, rule_risk_level: str, rapid_pass_through: bool) -> dict:
    """Compare the two checks by their own review points, never by subtracting their scores.

    The rule score is points out of 100; the model score is an uncalibrated 0-1 output shown as a percentage.
    The model's review point is applied upstream (predicted_class uses the served threshold); the rules'
    review point is "high" or above, matching the rule assessor's own recommendation text.
    """
    model_suggests = model_predicted_class == "suspicious"
    rules_suggest = rule_risk_level in ("high", "critical")
    basis = []
    if model_suggests:
        basis.append("model_at_or_above_threshold")
    if rules_suggest:
        basis.append("rules_high_or_above")
    if rapid_pass_through:
        basis.append("rapid_pass_through_observed")
    return {
        "model_suggests_review": model_suggests,
        "rule_suggests_review": rules_suggest,
        "checks_disagree": model_suggests != rules_suggest,
        "human_review_basis": basis,
    }


class AccountLiveAnalysisService:
    """Orchestrates on-demand real-time forensic analysis of an account."""

    @classmethod
    def run_analysis(cls, db: Session, account_id: str) -> Optional[AccountLiveAnalysisResponse]:
        """Executes fresh, live analysis using actual database records and models."""
        account = db.scalar(select(AccountModel).where(AccountModel.account_id == account_id))
        if not account:
            return None

        # 1. Fetch current ledger transactions to build snapshot
        txns = db.scalars(
            select(TransactionModel)
            .where(
                or_(
                    TransactionModel.origin_account_id == account_id,
                    TransactionModel.destination_account_id == account_id,
                )
            )
            .order_by(TransactionModel.timestamp.asc())
        ).all()

        total_txns = len(txns)
        latest_ts = txns[-1].timestamp.isoformat() if txns else None
        first_ts = txns[0].timestamp.isoformat() if txns else None

        inflows = [t for t in txns if t.destination_account_id == account_id]
        outflows = [t for t in txns if t.origin_account_id == account_id]

        total_received = round(sum(t.amount for t in inflows), 2)
        total_sent = round(sum(t.amount for t in outflows), 2)
        current_balance = round(float(account.current_balance), 2)

        snapshot = LedgerSnapshotInfo(
            transactions_examined=total_txns,
            latest_transaction_timestamp=latest_ts,
            first_transaction_timestamp=first_ts,
            total_received=total_received,
            total_sent=total_sent,
            current_balance=current_balance,
        )

        # 2. Run rule-based assessment
        rule_assessment = AccountRiskAssessor.assess_account(db, account_id)
        if not rule_assessment:
            return None

        # 3. Run ML inference with TreeSHAP
        ml_assessment = V2MLInferenceService.assess_account(db, account_id)
        if not ml_assessment:
            return None

        # 4. Compare the two checks on their own terms (see compare_review_suggestions).
        ml_score = ml_assessment.risk_score
        rule_score = rule_assessment.risk_score
        review = compare_review_suggestions(
            ml_assessment.predicted_class, rule_assessment.risk_level, bool(rule_assessment.signals.rapid_pass_through)
        )
        model_suggests_review = review["model_suggests_review"]
        rules_suggest_review = review["rule_suggests_review"]

        if model_suggests_review and not rules_suggest_review:
            divergence_interp = (
                "The account model suggests review but the fixed rules do not. The model weighs the account's whole "
                "behaviour pattern; the rules look for specific signals such as quick forwarding. Neither is "
                "automatically right. A large unusual payment out of an account can also be a sign of a scam victim."
            )
            suggested_focus = "Look at the transactions and the model's listed factors before deciding anything."
        elif rules_suggest_review and not model_suggests_review:
            divergence_interp = (
                "The fixed rules suggest review but the account model does not. The rules found specific signals; "
                "the model scored the account's overall behaviour below its review threshold. A score below the "
                "threshold does not clear the account."
            )
            suggested_focus = "Check the rule signals against the actual transfers and counterparties."
        elif model_suggests_review:
            divergence_interp = "Both the fixed rules and the account model suggest review."
            suggested_focus = "Review the transfers and evidence; agreement between the checks is not proof."
        else:
            divergence_interp = "Neither the fixed rules nor the account model suggests review."
            suggested_focus = "This does not clear the account; consider the case evidence."

        divergence_info = ModelDivergenceInfo(
            model_suggests_review=model_suggests_review,
            rule_suggests_review=rules_suggest_review,
            checks_disagree=review["checks_disagree"],
            model_review_threshold=V2MLInferenceService.decision_threshold(),
            ml_score=ml_score,
            rule_score=rule_score,
            divergence_detected=review["checks_disagree"],
            # Deprecated; same arithmetic as before so existing callers see no change in value.
            score_delta=round(abs(ml_score - rule_score), 1),
            interpretation=divergence_interp,
            suggested_focus=suggested_focus,
        )

        # 5. Synthesize evidence-backed recommendations
        signals = rule_assessment.signals
        recommended_actions: list[RecommendedAction] = []
        action_idx = 1

        # A. Large outlier transaction
        if signals.amount_spike_ratio >= 5.0 or signals.max_amount >= 100000.0:
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title=f"Review High-Value Outlier Transfer of ₹{signals.max_amount:,.2f}",
                    priority="high_priority" if signals.amount_spike_ratio >= 10.0 else "recommended",
                    action_type="review_large_transaction",
                    rationale=(
                        f"The largest single transfer of ₹{signals.max_amount:,.2f} is {signals.amount_spike_ratio:.1f}x higher "
                        f"than the account's average transaction amount of ₹{signals.avg_amount:,.2f}."
                    ),
                    supporting_evidence=f"Observed peak transfer: ₹{signals.max_amount:,.2f} (spike ratio {signals.amount_spike_ratio:.1f}x).",
                    suggested_records="Verify customer mandate, 2FA/OTP delivery logs, and customer callback confirmation.",
                    remaining_uncertainty="Legitimate one-off capital expenditures (real estate, vehicle purchase, medical emergencies) can produce identical spikes.",
                )
            )
            action_idx += 1

        # B. Rapid pass-through / Mule conduit
        if signals.rapid_pass_through or signals.flow_through_ratio >= 0.85:
            dwell_str = f" with median dwell time of {signals.median_dwell_minutes} minutes" if signals.median_dwell_minutes else ""
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title="Inspect Downstream Pass-Through & Rapid Conduit Routing",
                    priority="high_priority",
                    action_type="inspect_pass_through",
                    rationale=(
                        f"Account acts as a pass-through node, forwarding {signals.flow_through_ratio * 100:.1f}% of received funds outward{dwell_str}."
                    ),
                    supporting_evidence=f"Flow-through ratio of {signals.flow_through_ratio:.2f}; rapid pass-through signal is active.",
                    suggested_records="Request beneficiary bank settlement logs, beneficiary account KYC profiles, and payment gateway routing data.",
                    remaining_uncertainty="Downstream recipient accounts at third-party institutions cannot be verified without inter-bank data sharing.",
                )
            )
            action_idx += 1

        # C. Model suggests review but the rules do not (a pattern seen when a customer is drained by a scam)
        if model_suggests_review and not rules_suggest_review:
            top = ml_assessment.top_contributions[0] if ml_assessment.top_contributions else None
            top_text = (
                f"The input with the largest effect on the model score was {top.feature_name} "
                f"({'raised' if top.impact_direction == 'increases_risk' else 'lowered'} the score)."
                if top
                else "No model explanation was available for this result."
            )
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title="Check whether the account holder could be a victim",
                    priority="high_priority",
                    action_type="divergence_reconciliation",
                    rationale=(
                        "The account model suggests review but the fixed rules do not. When this is driven by a sudden "
                        "large payment out of an established account, the holder may have been deceived or had the "
                        "account taken over."
                    ),
                    supporting_evidence=f"Model score {ml_score:.1f}% (at or above its review threshold); rule score {rule_score:.1f}/100. {top_text}",
                    suggested_records="Contact the account holder out of band to confirm whether they authorised the transfer.",
                    remaining_uncertainty="Whether the holder acted under deception or made the transfer intentionally.",
                )
            )
            action_idx += 1

        # D. High fan-out dispersal
        if signals.fan_out_ratio >= 0.70 and signals.unique_counterparties >= 5:
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title=f"Analyze Dispersal Counterparties across {signals.unique_counterparties} Beneficiaries",
                    priority="recommended",
                    action_type="counterparty_origin_verification",
                    rationale=f"High-frequency outbound dispersal across {signals.unique_counterparties} distinct counterparties.",
                    supporting_evidence=f"Fan-out ratio of {signals.fan_out_ratio:.2f} across {signals.unique_counterparties} recipients.",
                    suggested_records="Examine destination bank IFSC codes, branch geography, and recipient account age.",
                    remaining_uncertainty="Legitimate small business vendor disbursements or salary payouts can exhibit high fan-out ratios.",
                )
            )
            action_idx += 1

        # E. Dormancy awakening
        if signals.dormant_awakening_detected:
            gap = signals.dormancy_gap_days or 0
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title=f"Investigate Sudden Reactivation Following {gap} Days Dormancy",
                    priority="recommended",
                    action_type="dormant_reactivation_audit",
                    rationale=f"Account resumed high-value transactions following {gap} days of complete inactivity.",
                    supporting_evidence=f"Dormancy gap of {gap} days followed by immediate debit/credit activity.",
                    suggested_records="Review recent online banking login logs, password reset history, and KYC re-verification submissions.",
                    remaining_uncertainty="Customer may have simply resumed regular banking for seasonal or personal life events.",
                )
            )
            action_idx += 1

        # F. Cyclic transfers
        if signals.cycle_detected:
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title="Examine Circular Fund Cycles & Counterparty Reciprocity",
                    priority="high_priority",
                    action_type="circular_cycle_inspection",
                    rationale="Circular transaction paths detected involving reciprocal transfers between the same counterparties.",
                    supporting_evidence="Cycle detection heuristic triggered on multi-hop transfer sequences.",
                    suggested_records="Review cross-account beneficial ownership and shared authorized signatories.",
                    remaining_uncertainty="Family member reimbursements or mutual business reconciliation can create false circular edges.",
                )
            )
            action_idx += 1

        # G. Baseline / Routine monitoring
        if not recommended_actions and ml_score < 30.0 and rule_score <= 25.0:
            recommended_actions.append(
                RecommendedAction(
                    action_id=f"ACT-00{action_idx}",
                    title="Maintain Routine Periodic Account Monitoring",
                    priority="routine",
                    action_type="routine_monitoring",
                    rationale="All observable velocity, amount, and counterparty metrics align with standard customer baseline.",
                    supporting_evidence=f"ML score ({ml_score:.1f}) and rule baseline ({rule_score:.1f}) within normal operational bounds.",
                    suggested_records="Standard scheduled transaction sampling and standard periodic KYC review.",
                    remaining_uncertainty="Low-frequency smurfing or sleeper accounts may not exhibit immediate velocity anomalies.",
                )
            )
            action_idx += 1

        # H. Missing Evidence Advisory
        recommended_actions.append(
            RecommendedAction(
                action_id=f"ACT-00{action_idx}",
                title="Acquire Peripheral Device Telemetry & IP Logs",
                priority="more_evidence_needed",
                action_type="device_telemetry_request",
                rationale="Core banking ledger does not record session IP, device fingerprint, or channel authentication metadata.",
                supporting_evidence="Core ledger blindspot: device telemetry unrecorded in transaction table.",
                suggested_records="Request web/mobile banking server access logs, device GUIDs, and payment gateway switch logs.",
                remaining_uncertainty="Without device telemetry, account takeover cannot be definitively proven or ruled out.",
            )
        )


        now_utc = datetime.now(timezone.utc).isoformat()
        run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"

        return AccountLiveAnalysisResponse(
            analysis_id=run_id,
            account_id=account_id,
            analyzed_at=now_utc,
            model_version=ml_assessment.model_version,
            ledger_snapshot=snapshot,
            rule_assessment=rule_assessment,
            ml_assessment=ml_assessment,
            divergence=divergence_info,
            recommended_actions=recommended_actions,
            evidence_gaps=rule_assessment.evidence_gaps,
            human_review_recommended=bool(review["human_review_basis"]),
            human_review_basis=review["human_review_basis"],
            disclaimer=(
                "Advisory Decision Support Only. Results reflect on-demand real-time computation of observable ledger features "
                "and trained machine learning inference. Machine learning risk estimates and rule signals provide indicators "
                "for investigator review and do not constitute legal proof of culpability or intent. Automated punitive actions, "
                "account freezing, or denial of service based solely on these findings are strictly prohibited."
            ),
        )
