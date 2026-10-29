"""Unified feature builder for FraudShield AI V2 account-behaviour models.

Extracts identical observable behavioral and profile features during both training
and runtime inference. Strictly prohibits ground-truth labels and PII leakage.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    from app.db.v2.models import AccountModel
    from app.services.v2.risk_assessment import AccountRiskAssessor
except ModuleNotFoundError:
    from backend.app.db.v2.models import AccountModel
    from backend.app.services.v2.risk_assessment import AccountRiskAssessor


FEATURE_NAMES: List[str] = [
    # Profile observable features
    "customer_type_retail",
    "customer_type_student",
    "customer_type_sme",
    "customer_type_corporate",
    "kyc_tier_level",
    "initial_balance",
    "current_balance",
    "balance_ratio",
    # Behavioral & velocity signals
    "total_transactions",
    "velocity_24h_count",
    "velocity_7d_count",
    "velocity_30d_count",
    "flow_through_ratio",
    "rapid_pass_through",
    "median_dwell_minutes",
    "has_dwell_time",
    "max_amount",
    "avg_amount",
    "amount_spike_ratio",
    "unique_counterparties",
    "counterparty_diversity_ratio",
    "fan_in_ratio",
    "fan_out_ratio",
    "dormancy_gap_days",
    "dormant_awakening_detected",
    "cycle_detected",
]


class AccountFeatureBuilder:
    """Extracts observable features for a given account from the database."""

    @staticmethod
    def get_feature_names() -> List[str]:
        """Returns the fixed, ordered list of feature names used by the ML model."""
        return list(FEATURE_NAMES)

    @classmethod
    def extract_features(cls, db: Session, account_id: str) -> Optional[Dict[str, float]]:
        """Extracts the observable numerical feature dictionary for an account.

        Returns None if account does not exist.
        Excludes all ground-truth labels, scenario IDs, and PII.
        """
        account = db.scalar(select(AccountModel).where(AccountModel.account_id == account_id))
        if not account:
            return None

        # Reuse Phase 3 baseline assessor logic for identical signal calculation
        assessment = AccountRiskAssessor.assess_account(db, account_id)
        if not assessment:
            return None
        return cls.features_from_assessment(account, assessment)

    @staticmethod
    def features_from_assessment(account: AccountModel, assessment) -> Dict[str, float]:
        """Builds the feature dictionary from an account row and its already-computed rule assessment."""
        sig = assessment.signals

        # Profile features
        cust_type = account.customer_type or "retail"
        kyc = account.kyc_tier or "tier_1_basic"
        kyc_level = 3.0 if kyc == "tier_3_enhanced" else (2.0 if kyc == "tier_2_verified" else 1.0)
        init_bal = float(account.initial_balance or 0.0)
        curr_bal = float(account.current_balance or 0.0)
        balance_ratio = round(curr_bal / (init_bal + 1.0), 4)

        # Behavioral & velocity features
        features: Dict[str, float] = {
            "customer_type_retail": 1.0 if cust_type == "retail" else 0.0,
            "customer_type_student": 1.0 if cust_type == "student" else 0.0,
            "customer_type_sme": 1.0 if cust_type == "sme" else 0.0,
            "customer_type_corporate": 1.0 if cust_type == "corporate" else 0.0,
            "kyc_tier_level": kyc_level,
            "initial_balance": init_bal,
            "current_balance": curr_bal,
            "balance_ratio": balance_ratio,
            "total_transactions": float(sig.total_transactions),
            "velocity_24h_count": float(sig.velocity_24h_count),
            "velocity_7d_count": float(sig.velocity_7d_count),
            "velocity_30d_count": float(sig.velocity_30d_count),
            "flow_through_ratio": float(sig.flow_through_ratio),
            "rapid_pass_through": 1.0 if sig.rapid_pass_through else 0.0,
            "median_dwell_minutes": float(sig.median_dwell_minutes) if sig.median_dwell_minutes is not None else -1.0,
            "has_dwell_time": 1.0 if sig.median_dwell_minutes is not None else 0.0,
            "max_amount": float(sig.max_amount),
            "avg_amount": float(sig.avg_amount),
            "amount_spike_ratio": float(sig.amount_spike_ratio),
            "unique_counterparties": float(sig.unique_counterparties),
            "counterparty_diversity_ratio": float(sig.counterparty_diversity_ratio),
            "fan_in_ratio": float(sig.fan_in_ratio),
            "fan_out_ratio": float(sig.fan_out_ratio),
            "dormancy_gap_days": float(sig.dormancy_gap_days) if sig.dormancy_gap_days is not None else 0.0,
            "dormant_awakening_detected": 1.0 if sig.dormant_awakening_detected else 0.0,
            "cycle_detected": 1.0 if sig.cycle_detected else 0.0,
        }

        return features

    @classmethod
    def to_feature_vector(cls, features_dict: Dict[str, float]) -> np.ndarray:
        """Converts a feature dictionary to an ordered numpy array for model inference."""
        return np.array([features_dict[name] for name in FEATURE_NAMES], dtype=np.float32).reshape(1, -1)

    @classmethod
    def to_dataframe(cls, features_dict: Dict[str, float]) -> pd.DataFrame:
        """Converts a feature dictionary to an ordered single-row DataFrame."""
        return pd.DataFrame([[features_dict[name] for name in FEATURE_NAMES]], columns=FEATURE_NAMES)
