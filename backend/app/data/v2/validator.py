"""Automated data quality and integrity validator for V2 synthetic banking data."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from backend.app.data.v2.models import SyntheticAccount, SyntheticTransaction


@dataclass
class ValidationReport:
    is_valid: bool
    num_accounts: int
    num_transactions: int
    num_scenarios_detected: int
    scenarios_found: list[str]
    unique_origin_accounts: int
    unique_dest_accounts: int
    errors: list[str]
    warnings: list[str]


class SyntheticDataValidator:
    """Validates mathematical integrity, referential constraints, and scenario coverage."""

    def __init__(self, accounts: list[SyntheticAccount], transactions: list[SyntheticTransaction]):
        self.accounts = accounts
        self.transactions = transactions
        self.acc_dict = {acc.account_id: acc for acc in accounts}
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def validate_all(self) -> ValidationReport:
        """Runs all verification passes."""
        self.errors.clear()
        self.warnings.clear()

        self._check_unique_ids()
        self._check_referential_integrity()
        self._check_chronological_ordering()
        self._check_transaction_balance_arithmetic()
        self._check_account_balance_reconciliation()
        scenarios = self._check_scenario_coverage()

        is_valid = len(self.errors) == 0

        # Unique counterparties
        orig_accs = len(set(t.origin_account_id for t in self.transactions))
        dest_accs = len(set(t.destination_account_id for t in self.transactions))

        return ValidationReport(
            is_valid=is_valid,
            num_accounts=len(self.accounts),
            num_transactions=len(self.transactions),
            num_scenarios_detected=len(scenarios),
            scenarios_found=scenarios,
            unique_origin_accounts=orig_accs,
            unique_dest_accounts=dest_accs,
            errors=self.errors,
            warnings=self.warnings,
        )

    def _check_unique_ids(self) -> None:
        """Checks for duplicate account or transaction IDs."""
        acc_ids = [a.account_id for a in self.accounts]
        if len(acc_ids) != len(set(acc_ids)):
            self.errors.append("Duplicate account IDs found in generated dataset.")

        txn_ids = [t.transaction_id for t in self.transactions]
        if len(txn_ids) != len(set(txn_ids)):
            self.errors.append("Duplicate transaction IDs found in generated dataset.")

    def _check_referential_integrity(self) -> None:
        """Verifies that all transaction endpoints exist in the accounts registry."""
        for t in self.transactions:
            if t.origin_account_id not in self.acc_dict:
                self.errors.append(f"Transaction {t.transaction_id} references missing origin {t.origin_account_id}")
            if t.destination_account_id not in self.acc_dict:
                self.errors.append(f"Transaction {t.transaction_id} references missing destination {t.destination_account_id}")

    def _check_chronological_ordering(self) -> None:
        """Ensures timestamps are non-decreasing."""
        prev_dt: datetime | None = None
        for t in self.transactions:
            dt = datetime.fromisoformat(t.timestamp)
            if prev_dt and dt < prev_dt:
                self.errors.append(f"Chronological violation: {t.transaction_id} ({t.timestamp}) before previous ({prev_dt})")
                break
            prev_dt = dt

    def _check_transaction_balance_arithmetic(self) -> None:
        """Validates that for every transaction, balances update with mathematical precision."""
        for t in self.transactions:
            if t.amount <= 0:
                self.errors.append(f"Transaction {t.transaction_id} has non-positive amount: {t.amount}")

            # Origin check: before - amount == after
            expected_orig_after = round(t.origin_balance_before - t.amount, 2)
            if abs(t.origin_balance_after - expected_orig_after) > 0.01:
                self.errors.append(
                    f"Origin balance arithmetic error in {t.transaction_id}: "
                    f"before {t.origin_balance_before} - {t.amount} != after {t.origin_balance_after}"
                )

            # Dest check: before + amount == after
            expected_dest_after = round(t.dest_balance_before + t.amount, 2)
            if abs(t.dest_balance_after - expected_dest_after) > 0.01:
                self.errors.append(
                    f"Destination balance arithmetic error in {t.transaction_id}: "
                    f"before {t.dest_balance_before} + {t.amount} != after {t.dest_balance_after}"
                )

            # Solvency check: origin before must be >= amount
            if t.amount > t.origin_balance_before + 0.01:
                self.errors.append(
                    f"Solvency violation in {t.transaction_id}: origin balance before ({t.origin_balance_before}) < amount ({t.amount})"
                )

    def _check_account_balance_reconciliation(self) -> None:
        """Validates that final account balance equals initial_balance + sum(credits) - sum(debits)."""
        net_flows: dict[str, float] = {acc_id: 0.0 for acc_id in self.acc_dict}

        for t in self.transactions:
            net_flows[t.origin_account_id] -= t.amount
            net_flows[t.destination_account_id] += t.amount

        for acc in self.accounts:
            expected_current = round(acc.initial_balance + net_flows[acc.account_id], 2)
            if abs(acc.current_balance - expected_current) > 0.02:
                self.errors.append(
                    f"Balance reconciliation failed for account {acc.account_id}: "
                    f"initial {acc.initial_balance} + net {net_flows[acc.account_id]:.2f} = {expected_current:.2f}, "
                    f"but recorded current_balance is {acc.current_balance}"
                )

    def _check_scenario_coverage(self) -> list[str]:
        """Verifies presence of all 5 controlled scenario topologies."""
        expected_scenarios = [
            "SCENARIO-APP-001",
            "SCENARIO-STRUCT-002",
            "SCENARIO-DISPERSAL-003",
            "SCENARIO-CYCLE-004",
            "SCENARIO-DORMANT-005",
        ]
        found_scenarios: set[str] = set()

        for t in self.transactions:
            if t.scenario_id:
                found_scenarios.add(t.scenario_id)

        for s in expected_scenarios:
            if s not in found_scenarios:
                self.warnings.append(f"Expected scenario {s} not detected in transactions.")

        return sorted(list(found_scenarios))
