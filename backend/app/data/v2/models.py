"""Data models and enums for V2 synthetic banking data generation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional


class AccountType(str, Enum):
    RETAIL = "retail"
    SME = "sme"
    CORPORATE = "corporate"
    STUDENT = "student"


class KycTier(str, Enum):
    TIER_1_BASIC = "tier_1_basic"
    TIER_2_VERIFIED = "tier_2_verified"
    TIER_3_ENHANCED = "tier_3_enhanced"


class AccountStatus(str, Enum):
    ACTIVE = "active"
    DORMANT = "dormant"
    SUSPENDED = "suspended"


class PaymentChannel(str, Enum):
    UPI = "UPI"
    IMPS = "IMPS"
    NEFT = "NEFT"
    RTGS = "RTGS"
    CARD_POS = "CARD_POS"
    ATM_CASH_OUT = "ATM_CASH_OUT"
    INTERNAL = "INTERNAL"


class AccountLabel(str, Enum):
    LEGITIMATE_RETAIL = "legitimate_retail"
    LEGITIMATE_MERCHANT = "legitimate_merchant"
    LEGITIMATE_CORPORATE = "legitimate_corporate"
    COMPROMISED_VICTIM = "compromised_victim"
    MULE_FIRST_HOP = "mule_first_hop"
    MULE_INTERMEDIATE = "mule_intermediate"
    MULE_FEEDER = "mule_feeder"
    MULE_AGGREGATOR = "mule_aggregator"
    CASHOUT_TERMINAL = "cashout_terminal"
    SHELL_ROUNDTRIPPER = "shell_roundtripper"
    DORMANT_AWAKENED_MULE = "dormant_awakened_mule"
    UNLABELED = "unlabeled"


@dataclass
class SyntheticAccount:
    account_id: str
    customer_name: str
    customer_type: str
    kyc_tier: str
    phone_number: str
    email: str
    upi_id: str
    tax_identifier: str
    initial_balance: float
    current_balance: float
    account_opened_at: str
    status: str
    scenario_id: Optional[str]
    ground_truth_label: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SyntheticTransaction:
    transaction_id: str
    timestamp: str
    origin_account_id: str
    destination_account_id: str
    amount: float
    currency: str
    channel: str
    status: str
    origin_balance_before: float
    origin_balance_after: float
    dest_balance_before: float
    dest_balance_after: float
    scenario_id: Optional[str]
    scenario_tag: str
    is_suspicious_scenario: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GenerationConfig:
    seed: int = 42
    num_accounts: int = 10000
    num_transactions: int = 350000
    simulation_days: int = 90
    start_date: str = "2026-01-01T00:00:00Z"
    output_dir: str = "data/v2_synthetic"
