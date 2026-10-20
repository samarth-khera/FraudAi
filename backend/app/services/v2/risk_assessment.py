"""Transparent baseline account-risk assessment service for FraudShield AI V2.

Computes explainable, deterministic behavioral signals from the raw transaction ledger.
Strictly prohibits the use of ground-truth scenario tags as runtime features.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

try:
    from app.api.v2.schemas import (
        AccountAssessmentResponse,
        RiskSignalValues,
    )
    from app.db.v2.models import AccountModel, TransactionModel
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import (
        AccountAssessmentResponse,
        RiskSignalValues,
    )
    from backend.app.db.v2.models import AccountModel, TransactionModel


class AccountRiskAssessor:
    """Evaluates account behavioral risk using explainable ledger metrics."""

    @staticmethod
    def assess_account(db: Session, account_id: str) -> Optional[AccountAssessmentResponse]:
        """Calculates rule-based heuristic risk signals and transparent score."""
        account = db.scalar(select(AccountModel).where(AccountModel.account_id == account_id))
        if not account:
            return None

        # Fetch all chronological transactions involving this account
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

        # Baseline empty state
        if total_txns == 0:
            return AccountAssessmentResponse(
                account_id=account_id,
                risk_score=0.0,
                risk_level="low",
                signals=RiskSignalValues(
                    total_transactions=0,
                    velocity_24h_count=0,
                    velocity_7d_count=0,
                    velocity_30d_count=0,
                    flow_through_ratio=0.0,
                    rapid_pass_through=False,
                    median_dwell_minutes=None,
                    max_amount=0.0,
                    avg_amount=0.0,
                    amount_spike_ratio=0.0,
                    unique_counterparties=0,
                    counterparty_diversity_ratio=0.0,
                    fan_in_ratio=0.0,
                    fan_out_ratio=0.0,
                    dormancy_gap_days=None,
                    dormant_awakening_detected=False,
                    cycle_detected=False,
                ),
                reason_codes=["NO_ACTIVITY: Account has zero recorded transactions in the ledger."],
                evidence_gaps=["NO_TRANSACTION_HISTORY: Unable to compute behavioral signals."],
                uncertainty_rating="high",
                recommendation="routine_monitoring",
                disclaimer="Decision support only. Synthetic testing data does not establish criminal culpability.",
            )

        # Compute Signal 1: Inflow vs Outflow & Flow-Through Ratio
        inflows = [t for t in txns if t.destination_account_id == account_id]
        outflows = [t for t in txns if t.origin_account_id == account_id]

        total_inflow_amt = sum(t.amount for t in inflows)
        total_outflow_amt = sum(t.amount for t in outflows)

        flow_through_ratio = (
            round(total_outflow_amt / total_inflow_amt, 4) if total_inflow_amt > 0 else 0.0
        )

        # Compute Signal 2: Rapid Pass-Through (< 30 minutes drain)
        rapid_pass_through = False
        dwell_minutes_list: list[float] = []

        for in_t in inflows:
            in_amt = in_t.amount
            if in_amt < 1000.0:
                continue
            # Look for subsequent outflows within 30 minutes
            subsequent_out = [
                out_t for out_t in outflows
                if in_t.timestamp <= out_t.timestamp <= in_t.timestamp + timedelta(minutes=30)
            ]
            if subsequent_out:
                rapid_out_amt = sum(o.amount for o in subsequent_out)
                dwell_mins = (subsequent_out[0].timestamp - in_t.timestamp).total_seconds() / 60.0
                dwell_minutes_list.append(dwell_mins)
                if rapid_out_amt >= in_amt * 0.70:
                    rapid_pass_through = True

        median_dwell = (
            round(float(sorted(dwell_minutes_list)[len(dwell_minutes_list) // 2]), 1)
            if dwell_minutes_list
            else None
        )

        # Compute Signal 3: Velocity over rolling horizons
        latest_ts = txns[-1].timestamp
        v24h = sum(1 for t in txns if t.timestamp >= latest_ts - timedelta(hours=24))
        v7d = sum(1 for t in txns if t.timestamp >= latest_ts - timedelta(days=7))
        v30d = sum(1 for t in txns if t.timestamp >= latest_ts - timedelta(days=30))

        # Compute Signal 4: Amount Spikes
        amounts = [t.amount for t in txns]
        max_amt = round(max(amounts), 2)
        avg_amt = round(sum(amounts) / len(amounts), 2)
        amount_spike_ratio = round(max_amt / avg_amt, 2) if avg_amt > 0 else 1.0

        # Compute Signal 5: Counterparty Diversity, Fan-In & Fan-Out
        counterparties: set[str] = set()
        for t in txns:
            if t.origin_account_id == account_id:
                counterparties.add(t.destination_account_id)
            else:
                counterparties.add(t.origin_account_id)

        unique_cp_count = len(counterparties)
        cp_diversity = round(unique_cp_count / total_txns, 4)

        fan_in_ratio = round(len(inflows) / total_txns, 4)
        fan_out_ratio = round(len(outflows) / total_txns, 4)

        # Compute Signal 6: Dormancy Activation
        dormant_awakened = False
        dormancy_gap_days: Optional[float] = None

        if account.account_opened_at:
            open_to_first = (txns[0].timestamp - account.account_opened_at).total_seconds() / 86400.0
            if open_to_first > 45.0 and txns[0].amount > 50000.0:
                dormant_awakened = True
                dormancy_gap_days = round(open_to_first, 1)

        # Also check gaps between consecutive transactions
        for i in range(1, len(txns)):
            gap = (txns[i].timestamp - txns[i - 1].timestamp).total_seconds() / 86400.0
            if gap > 45.0 and txns[i].amount > 50000.0:
                dormant_awakened = True
                dormancy_gap_days = round(gap, 1)
                break

        # Compute Signal 7: Cycle Detection (funds transferred to X then received back from X)
        cycle_detected = False
        send_targets = set(t.destination_account_id for t in outflows)
        recv_sources = set(t.origin_account_id for t in inflows)
        mutual_counterparties = send_targets.intersection(recv_sources)
        if len(mutual_counterparties) >= 2:
            cycle_detected = True

        # ----------------------------------------------------------------------
        # Heuristic Risk Score Construction (0 - 100)
        # ----------------------------------------------------------------------
        score = 10.0  # Base baseline
        reason_codes: list[str] = []

        if rapid_pass_through:
            score += 35.0
            reason_codes.append(
                f"RAPID_PASS_THROUGH: Inbound funds offloaded within 30 minutes (median dwell {median_dwell or 0} min)."
            )

        if total_inflow_amt > 10000.0 and 0.88 <= flow_through_ratio <= 1.05:
            score += 20.0
            reason_codes.append(
                f"HIGH_FLOW_THROUGH: Account retains < 10% of total inflows (flow-through ratio {flow_through_ratio:.2f})."
            )

        if amount_spike_ratio >= 6.0 and max_amt >= 25000.0:
            score += 15.0
            reason_codes.append(
                f"UNUSUAL_AMOUNT_SPIKE: Maximum transaction ({max_amt:.2f}) is {amount_spike_ratio:.1f}x higher than average."
            )

        if len(inflows) >= 6 and fan_in_ratio >= 0.80:
            score += 15.0
            reason_codes.append(
                f"FAN_IN_AGGREGATION: Multiple senders depositing into single account (fan-in ratio {fan_in_ratio:.2f})."
            )
        elif len(outflows) >= 6 and fan_out_ratio >= 0.80:
            score += 15.0
            reason_codes.append(
                f"FAN_OUT_DISPERSAL: High-frequency outbound dispersal to multiple recipients (fan-out ratio {fan_out_ratio:.2f})."
            )

        if dormant_awakened:
            score += 15.0
            reason_codes.append(
                f"DORMANT_ACCOUNT_AWAKENED: Account inactive for {dormancy_gap_days} days before sudden high-value activity."
            )

        if cycle_detected:
            score += 10.0
            reason_codes.append(
                f"CYCLIC_TRANSFERS: Mutual circular transactions detected with {len(mutual_counterparties)} counterparties."
            )

        # Bound score between 0.0 and 100.0
        final_score = round(min(100.0, max(0.0, score)), 1)

        # Risk Category
        if final_score <= 25.0:
            risk_level = "low"
        elif final_score <= 55.0:
            risk_level = "elevated"
        elif final_score <= 80.0:
            risk_level = "high"
        else:
            risk_level = "critical"

        # Uncertainty Rating
        if total_txns < 3:
            uncertainty = "high"
            reason_codes.append("LIMITED_HISTORY: Low transaction count increases baseline uncertainty.")
        elif total_txns < 8:
            uncertainty = "medium"
        else:
            uncertainty = "low"

        # Evidence Gaps
        evidence_gaps = [
            "DEVICE_TELEMETRY_UNAVAILABLE: Session IP, device fingerprint, and MAC addresses are not captured in current core banking data.",
            "EXTERNAL_PERIMETER_BLINDSPOT: Downstream transactions terminating at ATM or external banks cannot be verified.",
        ]
        if account.kyc_tier == "tier_1_basic":
            evidence_gaps.append("UNVERIFIED_KYC: Account possesses only Tier 1 Basic unverified due diligence.")

        # Recommendation
        if risk_level == "critical":
            recommendation = "priority_forensic_investigation: Expedite review for potential mule conduit or unauthorized takeover."
        elif risk_level == "high":
            recommendation = "enhanced_compliance_review: Perform manual inspection of counterparties and fund origins."
        elif risk_level == "elevated":
            recommendation = "standard_triage_queue: Monitor for recurring anomalous velocity or pass-through patterns."
        else:
            recommendation = "routine_monitoring: Consistent with standard personal or commercial customer baseline."

        disclaimer = (
            "Decision support only. Heuristic behavioral risk scores evaluate mathematical anomalies in transaction "
            "timing and velocity. They do not constitute legal proof of culpability or intent. Automated punitive actions "
            "or account freezing are strictly prohibited."
        )

        return AccountAssessmentResponse(
            account_id=account_id,
            risk_score=final_score,
            risk_level=risk_level,
            signals=RiskSignalValues(
                total_transactions=total_txns,
                velocity_24h_count=v24h,
                velocity_7d_count=v7d,
                velocity_30d_count=v30d,
                flow_through_ratio=flow_through_ratio,
                rapid_pass_through=rapid_pass_through,
                median_dwell_minutes=median_dwell,
                max_amount=max_amt,
                avg_amount=avg_amt,
                amount_spike_ratio=amount_spike_ratio,
                unique_counterparties=unique_cp_count,
                counterparty_diversity_ratio=cp_diversity,
                fan_in_ratio=fan_in_ratio,
                fan_out_ratio=fan_out_ratio,
                dormancy_gap_days=dormancy_gap_days,
                dormant_awakening_detected=dormant_awakened,
                cycle_detected=cycle_detected,
            ),
            reason_codes=reason_codes or ["NORMAL_ACTIVITY: Account activity aligns with standard banking parameters."],
            evidence_gaps=evidence_gaps,
            uncertainty_rating=uncertainty,
            recommendation=recommendation,
            disclaimer=disclaimer,
        )
