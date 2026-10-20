"""Automated unit and data quality tests for V2 Synthetic Banking Data Generator."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

try:
    from app.data.v2.generator import SyntheticBankGenerator
    from app.data.v2.models import (
        AccountLabel,
        AccountStatus,
        AccountType,
        GenerationConfig,
        KycTier,
    )
    from app.data.v2.validator import SyntheticDataValidator
except ModuleNotFoundError:
    from backend.app.data.v2.generator import SyntheticBankGenerator
    from backend.app.data.v2.models import (
        AccountLabel,
        AccountStatus,
        AccountType,
        GenerationConfig,
        KycTier,
    )
    from backend.app.data.v2.validator import SyntheticDataValidator


@pytest.fixture
def small_config() -> GenerationConfig:
    return GenerationConfig(
        seed=42,
        num_accounts=120,
        num_transactions=1500,
        simulation_days=14,
        start_date="2026-01-01T00:00:00Z",
    )


@pytest.fixture
def generated_dataset(small_config: GenerationConfig):
    generator = SyntheticBankGenerator(small_config)
    accounts, transactions = generator.generate()
    return accounts, transactions, small_config


def test_determinism():
    """Verify identical seeds produce byte-for-byte identical output."""
    cfg = GenerationConfig(seed=42, num_accounts=50, num_transactions=200, simulation_days=7)
    g1 = SyntheticBankGenerator(cfg)
    accs1, txns1 = g1.generate()

    g2 = SyntheticBankGenerator(cfg)
    accs2, txns2 = g2.generate()

    assert len(accs1) == len(accs2)
    assert len(txns1) == len(txns2)

    for a1, a2 in zip(accs1, accs2):
        assert a1.to_dict() == a2.to_dict()

    for t1, t2 in zip(txns1, txns2):
        assert t1.to_dict() == t2.to_dict()


def test_unique_ids(generated_dataset):
    """Verify all account IDs and transaction IDs are strictly unique."""
    accounts, transactions, _ = generated_dataset

    acc_ids = [a.account_id for a in accounts]
    assert len(acc_ids) == len(set(acc_ids)), "Duplicate account IDs detected"

    txn_ids = [t.transaction_id for t in transactions]
    assert len(txn_ids) == len(set(txn_ids)), "Duplicate transaction IDs detected"


def test_schema_validity(generated_dataset):
    """Verify schema integrity of all account and transaction records."""
    accounts, transactions, _ = generated_dataset

    for acc in accounts:
        assert acc.account_id.startswith("ACC-")
        assert len(acc.customer_name) > 2
        assert acc.customer_type in [t.value for t in AccountType]
        assert acc.kyc_tier in [k.value for k in KycTier]
        assert acc.status in [s.value for s in AccountStatus]
        assert acc.initial_balance >= 0
        assert acc.current_balance >= 0
        assert "@" in acc.email
        assert "@" in acc.upi_id

    for t in transactions:
        assert t.transaction_id.startswith("TXN-")
        assert t.amount > 0
        assert t.origin_balance_before >= 0
        assert t.origin_balance_after >= 0
        assert t.dest_balance_before >= 0
        assert t.dest_balance_after >= 0
        assert t.currency == "INR"
        assert t.status == "COMPLETED"


def test_referential_integrity(generated_dataset):
    """Verify every transaction endpoints exist in accounts table."""
    accounts, transactions, _ = generated_dataset
    acc_map = {a.account_id: a for a in accounts}

    for t in transactions:
        assert t.origin_account_id in acc_map, f"Missing origin account: {t.origin_account_id}"
        assert t.destination_account_id in acc_map, f"Missing destination account: {t.destination_account_id}"


def test_chronological_ordering(generated_dataset):
    """Verify transactions are strictly chronological."""
    _, transactions, _ = generated_dataset

    prev_dt = datetime.min.replace(tzinfo=timezone.utc)
    for t in transactions:
        dt = datetime.fromisoformat(t.timestamp)
        assert dt >= prev_dt, f"Chronological violation at {t.transaction_id}"
        prev_dt = dt


def test_scenario_coverage_and_labels(generated_dataset):
    """Verify all 5 scenarios are generated with authentic ground truth labels."""
    accounts, transactions, _ = generated_dataset

    # Verify scenario transaction coverage
    scenario_ids = set(t.scenario_id for t in transactions if t.scenario_id)
    expected_scenarios = {
        "SCENARIO-APP-001",
        "SCENARIO-STRUCT-002",
        "SCENARIO-DISPERSAL-003",
        "SCENARIO-CYCLE-004",
        "SCENARIO-DORMANT-005",
    }
    assert expected_scenarios.issubset(scenario_ids), f"Missing scenarios: {expected_scenarios - scenario_ids}"

    # Verify accounts have associated ground truth labels
    labels = set(a.ground_truth_label for a in accounts)
    assert AccountLabel.COMPROMISED_VICTIM.value in labels
    assert AccountLabel.MULE_FIRST_HOP.value in labels
    assert AccountLabel.MULE_INTERMEDIATE.value in labels
    assert AccountLabel.MULE_FEEDER.value in labels
    assert AccountLabel.MULE_AGGREGATOR.value in labels
    assert AccountLabel.CASHOUT_TERMINAL.value in labels
    assert AccountLabel.SHELL_ROUNDTRIPPER.value in labels
    assert AccountLabel.DORMANT_AWAKENED_MULE.value in labels
    assert AccountLabel.LEGITIMATE_RETAIL.value in labels


def test_ledger_balance_integrity(generated_dataset):
    """Verify absolute mathematical conservation of funds across ledger."""
    accounts, transactions, _ = generated_dataset

    validator = SyntheticDataValidator(accounts, transactions)
    report = validator.validate_all()

    assert report.is_valid, f"Validation failed with errors: {report.errors}"
    assert len(report.errors) == 0


def test_solvency_and_available_balance(generated_dataset):
    """Verify that no account ever debits more than its available balance."""
    _, transactions, _ = generated_dataset

    for t in transactions:
        assert t.origin_balance_before >= t.amount - 0.001, (
            f"Solvency failure on {t.transaction_id}: "
            f"Origin balance {t.origin_balance_before} < amount {t.amount}"
        )
        assert abs(t.origin_balance_after - (t.origin_balance_before - t.amount)) < 0.01
        assert abs(t.dest_balance_after - (t.dest_balance_before + t.amount)) < 0.01
