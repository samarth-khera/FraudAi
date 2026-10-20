"""Deterministic, high-performance synthetic banking data generator for FraudShield AI V2."""

from __future__ import annotations

import csv
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import numpy as np

from backend.app.data.v2.models import (
    AccountLabel,
    AccountStatus,
    AccountType,
    GenerationConfig,
    KycTier,
    PaymentChannel,
    SyntheticAccount,
    SyntheticTransaction,
)

# Deterministic name pools
FIRST_NAMES = [
    "Aarav", "Aditi", "Aditya", "Advik", "Amit", "Ananya", "Anita", "Arjun",
    "Arnav", "Atharv", "Aayan", "Deepak", "Diya", "Geeta", "Ishan", "Kavita",
    "Kiara", "Krishna", "Meera", "Neha", "Nikhil", "Pari", "Pooja", "Pranav",
    "Priya", "Rahul", "Rajesh", "Ramesh", "Reyansh", "Riya", "Rohan", "Sai",
    "Sameer", "Sanvi", "Sara", "Shaurya", "Sneha", "Sunita", "Suresh", "Varun",
    "Vihaan", "Vikram", "Vivaan", "Yash", "Zoya"
]

LAST_NAMES = [
    "Agarwal", "Banerjee", "Bhat", "Chatterjee", "Das", "Deshmukh", "Gupta",
    "Iyer", "Joshi", "Kulkarni", "Kumar", "Mehta", "Mukherjee", "Nair", "Patel",
    "Rao", "Reddy", "Roy", "Sen", "Shah", "Sharma", "Singh", "Verma"
]

MERCHANT_NAMES = [
    "Apex Superstore", "CloudKitchen Fresh", "DailyNeeds Mart", "FreshMart Express",
    "Metro Fuel Station", "Nexus Pharmacy", "Prime Digital Hub", "QuickBazaar Retail",
    "SmartGadgets India", "Star Cafe & Bakery", "Swift Logistics", "Urban Grocers",
    "Zenith Electronics", "BlueDart Parcel Hub", "Apollo MedStore", "Reliance Mart"
]

CORPORATE_NAMES = [
    "Horizon Infra Corp", "Global Tech Solutions Ltd", "Sterling Trading Co",
    "Apex Digital Ventures", "Nexus Logistics Pvt Ltd", "Vanguard Financial Services",
    "Titan Engineering Works", "Summit Media Network", "Pinnacle Consulting Group"
]


class SyntheticBankGenerator:
    """Generates a complete synthetic banking ecosystem with continuous ledger integrity."""

    def __init__(self, config: Optional[GenerationConfig] = None):
        self.config = config or GenerationConfig()
        self.rng = random.Random(self.config.seed)
        self.np_rng = np.random.default_rng(self.config.seed)
        self.start_dt = datetime.fromisoformat(
            self.config.start_date.replace("Z", "+00:00")
        )

        self.accounts: dict[str, SyntheticAccount] = {}
        self.running_balances: dict[str, float] = {}
        self.transactions: list[SyntheticTransaction] = []

        # Categorized account IDs for realistic counterparties
        self.retail_ids: list[str] = []
        self.student_ids: list[str] = []
        self.merchant_ids: list[str] = []
        self.corporate_ids: list[str] = []
        self.scenario_account_ids: set[str] = set()

    def generate(self) -> tuple[list[SyntheticAccount], list[SyntheticTransaction]]:
        """Executes full generation sequence: Accounts -> Scenarios -> Baseline -> Chrono Ledger."""
        self._generate_accounts()
        planned_txns = self._plan_all_transactions()
        self._apply_transactions_chronologically(planned_txns)
        self._sync_final_account_balances()
        return list(self.accounts.values()), self.transactions

    def _generate_accounts(self) -> None:
        """Generates synthetic accounts with profiles and starting balances."""
        num_accs = self.config.num_accounts

        for i in range(1, num_accs + 1):
            acc_id = f"ACC-{i:06d}"

            # Customer type distribution: 70% retail, 15% student, 10% merchant/sme, 5% corporate
            p = self.rng.random()
            if p < 0.70:
                cust_type = AccountType.RETAIL.value
                first = self.rng.choice(FIRST_NAMES)
                last = self.rng.choice(LAST_NAMES)
                name = f"{first} {last}"
                kyc = self.rng.choice(
                    [KycTier.TIER_2_VERIFIED.value, KycTier.TIER_1_BASIC.value]
                )
                init_bal = round(self.rng.uniform(5000.0, 75000.0), 2)
                self.retail_ids.append(acc_id)
            elif p < 0.85:
                cust_type = AccountType.STUDENT.value
                first = self.rng.choice(FIRST_NAMES)
                last = self.rng.choice(LAST_NAMES)
                name = f"{first} {last}"
                kyc = KycTier.TIER_1_BASIC.value
                init_bal = round(self.rng.uniform(1000.0, 15000.0), 2)
                self.student_ids.append(acc_id)
            elif p < 0.95:
                cust_type = AccountType.SME.value
                name = self.rng.choice(MERCHANT_NAMES) + f" #{i%50+1}"
                kyc = KycTier.TIER_2_VERIFIED.value
                init_bal = round(self.rng.uniform(50000.0, 500000.0), 2)
                self.merchant_ids.append(acc_id)
            else:
                cust_type = AccountType.CORPORATE.value
                name = self.rng.choice(CORPORATE_NAMES)
                kyc = KycTier.TIER_3_ENHANCED.value
                init_bal = round(self.rng.uniform(500000.0, 5000000.0), 2)
                self.corporate_ids.append(acc_id)

            days_prior = self.rng.randint(30, 365)
            open_dt = self.start_dt - timedelta(days=days_prior)

            phone = f"+91 {self.rng.randint(70000, 99999)} {i:05d}"
            clean_name = name.lower().replace(" ", "").replace("&", "").replace("#", "")[:10]
            email = f"{clean_name}.{i:04d}@example.bank"
            upi = f"{clean_name}{i:04d}@okhdfcbank"
            tax_id = f"SYNTH{i:05d}P"

            account = SyntheticAccount(
                account_id=acc_id,
                customer_name=name,
                customer_type=cust_type,
                kyc_tier=kyc,
                phone_number=phone,
                email=email,
                upi_id=upi,
                tax_identifier=tax_id,
                initial_balance=init_bal,
                current_balance=init_bal,
                account_opened_at=open_dt.isoformat(),
                status=AccountStatus.ACTIVE.value,
                scenario_id=None,
                ground_truth_label=AccountLabel.LEGITIMATE_RETAIL.value if cust_type in (AccountType.RETAIL.value, AccountType.STUDENT.value) else (AccountLabel.LEGITIMATE_MERCHANT.value if cust_type == AccountType.SME.value else AccountLabel.LEGITIMATE_CORPORATE.value)
            )

            self.accounts[acc_id] = account
            self.running_balances[acc_id] = init_bal

    def _plan_all_transactions(self) -> list[dict[str, Any]]:
        """Plans all baseline transactions and scenario transactions before chronological sequencing."""
        planned: list[dict[str, Any]] = []

        # 1. Plan Five Controlled Scenarios first
        scenario_txns = self._plan_scenarios()
        planned.extend(scenario_txns)

        # 2. Plan Baseline Background Transactions
        # Oversample by 3% so that after any low-balance skips, completed txns >= num_transactions
        needed_baseline = max(0, self.config.num_transactions - len(scenario_txns))
        target_baseline = int(needed_baseline * 1.035) + 500
        baseline_txns = self._plan_baseline_transactions(target_baseline)
        planned.extend(baseline_txns)

        # Sort all planned transactions strictly by planned timestamp
        planned.sort(key=lambda t: t["timestamp"])
        return planned

    def _plan_scenarios(self) -> list[dict[str, Any]]:
        """Plans the 5 controlled financial crime topologies."""
        scenario_txns: list[dict[str, Any]] = []
        sim_days = self.config.simulation_days

        # Ensure we have enough accounts for scenarios
        if len(self.retail_ids) < 30 or len(self.student_ids) < 15:
            return scenario_txns

        # -------------------------------------------------------------------
        # Scenario 1: APP Scam Layering (Victim -> Mule 1 -> Mule 2/3 -> Cashout)
        # -------------------------------------------------------------------
        scen1_id = "SCENARIO-APP-001"
        victim_id = self.retail_ids[0]
        mule1_id = self.retail_ids[1]
        mule2_id = self.student_ids[0]
        mule3_id = self.student_ids[1]
        cashout1_id = self.merchant_ids[0] if self.merchant_ids else self.retail_ids[2]
        cashout2_id = self.merchant_ids[1] if len(self.merchant_ids) > 1 else self.retail_ids[3]

        self.accounts[victim_id].ground_truth_label = AccountLabel.COMPROMISED_VICTIM.value
        self.accounts[victim_id].scenario_id = scen1_id
        self.accounts[mule1_id].ground_truth_label = AccountLabel.MULE_FIRST_HOP.value
        self.accounts[mule1_id].scenario_id = scen1_id
        self.accounts[mule2_id].ground_truth_label = AccountLabel.MULE_INTERMEDIATE.value
        self.accounts[mule2_id].scenario_id = scen1_id
        self.accounts[mule3_id].ground_truth_label = AccountLabel.MULE_INTERMEDIATE.value
        self.accounts[mule3_id].scenario_id = scen1_id
        self.accounts[cashout1_id].ground_truth_label = AccountLabel.CASHOUT_TERMINAL.value
        self.accounts[cashout1_id].scenario_id = scen1_id
        self.accounts[cashout2_id].ground_truth_label = AccountLabel.CASHOUT_TERMINAL.value
        self.accounts[cashout2_id].scenario_id = scen1_id

        # Guarantee victim has sufficient funds at start
        self.running_balances[victim_id] = max(self.running_balances[victim_id], 300000.0)
        self.accounts[victim_id].initial_balance = self.running_balances[victim_id]

        t0 = self.start_dt + timedelta(days=min(15, sim_days - 2), hours=10, minutes=15)
        # Hop 1: Victim -> Mule 1 (250,000)
        scenario_txns.append({
            "timestamp": t0,
            "origin_id": victim_id,
            "dest_id": mule1_id,
            "amount": 250000.0,
            "channel": PaymentChannel.IMPS.value,
            "scenario_id": scen1_id,
            "scenario_tag": "app_scam_hop1_victim_drain",
            "is_suspicious": True,
        })
        # Hop 2: Mule 1 splits to Mule 2 and Mule 3 (within 10 minutes)
        t1 = t0 + timedelta(minutes=8)
        scenario_txns.append({
            "timestamp": t1,
            "origin_id": mule1_id,
            "dest_id": mule2_id,
            "amount": 120000.0,
            "channel": PaymentChannel.UPI.value,
            "scenario_id": scen1_id,
            "scenario_tag": "app_scam_hop2_layering_split",
            "is_suspicious": True,
        })
        scenario_txns.append({
            "timestamp": t1 + timedelta(minutes=2),
            "origin_id": mule1_id,
            "dest_id": mule3_id,
            "amount": 125000.0,
            "channel": PaymentChannel.UPI.value,
            "scenario_id": scen1_id,
            "scenario_tag": "app_scam_hop2_layering_split",
            "is_suspicious": True,
        })
        # Hop 3: Mule 2 & Mule 3 forward to Cashout Terminals (within 15 minutes)
        t2 = t1 + timedelta(minutes=12)
        scenario_txns.append({
            "timestamp": t2,
            "origin_id": mule2_id,
            "dest_id": cashout1_id,
            "amount": 118000.0,
            "channel": PaymentChannel.ATM_CASH_OUT.value,
            "scenario_id": scen1_id,
            "scenario_tag": "app_scam_hop3_terminal_cashout",
            "is_suspicious": True,
        })
        scenario_txns.append({
            "timestamp": t2 + timedelta(minutes=3),
            "origin_id": mule3_id,
            "dest_id": cashout2_id,
            "amount": 123000.0,
            "channel": PaymentChannel.ATM_CASH_OUT.value,
            "scenario_id": scen1_id,
            "scenario_tag": "app_scam_hop3_terminal_cashout",
            "is_suspicious": True,
        })

        # -------------------------------------------------------------------
        # Scenario 2: Structuring / Smurfing (Fan-In Aggregation)
        # -------------------------------------------------------------------
        scen2_id = "SCENARIO-STRUCT-002"
        aggregator_id = self.retail_ids[4]
        self.accounts[aggregator_id].ground_truth_label = AccountLabel.MULE_AGGREGATOR.value
        self.accounts[aggregator_id].scenario_id = scen2_id

        feeder_ids = self.retail_ids[5:15]
        for f_id in feeder_ids:
            self.accounts[f_id].ground_truth_label = AccountLabel.MULE_FEEDER.value
            self.accounts[f_id].scenario_id = scen2_id
            self.running_balances[f_id] = max(self.running_balances[f_id], 60000.0)
            self.accounts[f_id].initial_balance = self.running_balances[f_id]

        t_struct = self.start_dt + timedelta(days=min(25, sim_days - 2), hours=8)
        total_aggregated = 0.0
        for idx, f_id in enumerate(feeder_ids):
            # Amount just below reporting threshold 50,000
            amt = round(48000.0 + (idx * 150.0), 2)
            total_aggregated += amt
            t_feed = t_struct + timedelta(hours=idx * 2, minutes=self.rng.randint(5, 45))
            scenario_txns.append({
                "timestamp": t_feed,
                "origin_id": f_id,
                "dest_id": aggregator_id,
                "amount": amt,
                "channel": PaymentChannel.UPI.value,
                "scenario_id": scen2_id,
                "scenario_tag": "structuring_fan_in_deposit",
                "is_suspicious": True,
            })

        # Aggregator drains consolidated amount out to external terminal
        drain_terminal_id = self.merchant_ids[2] if len(self.merchant_ids) > 2 else self.retail_ids[15]
        self.accounts[drain_terminal_id].ground_truth_label = AccountLabel.CASHOUT_TERMINAL.value
        scenario_txns.append({
            "timestamp": t_struct + timedelta(hours=26),
            "origin_id": aggregator_id,
            "dest_id": drain_terminal_id,
            "amount": round(total_aggregated * 0.98, 2),
            "channel": PaymentChannel.RTGS.value,
            "scenario_id": scen2_id,
            "scenario_tag": "structuring_consolidated_drain",
            "is_suspicious": True,
        })

        # -------------------------------------------------------------------
        # Scenario 3: Fan-Out Dispersal (Compromised Source -> Multiple Mules)
        # -------------------------------------------------------------------
        scen3_id = "SCENARIO-DISPERSAL-003"
        disp_source_id = self.corporate_ids[0] if self.corporate_ids else self.retail_ids[16]
        self.accounts[disp_source_id].ground_truth_label = AccountLabel.COMPROMISED_VICTIM.value
        self.accounts[disp_source_id].scenario_id = scen3_id
        self.running_balances[disp_source_id] = max(self.running_balances[disp_source_id], 500000.0)
        self.accounts[disp_source_id].initial_balance = self.running_balances[disp_source_id]

        mule_recipients = self.student_ids[2:12]
        t_disp = self.start_dt + timedelta(days=min(40, sim_days - 2), hours=14)
        for idx, m_id in enumerate(mule_recipients):
            self.accounts[m_id].ground_truth_label = AccountLabel.MULE_INTERMEDIATE.value
            self.accounts[m_id].scenario_id = scen3_id
            amt = 25000.0
            t_fanout = t_disp + timedelta(minutes=idx * 3)
            # Fan out from compromised source
            scenario_txns.append({
                "timestamp": t_fanout,
                "origin_id": disp_source_id,
                "dest_id": m_id,
                "amount": amt,
                "channel": PaymentChannel.NEFT.value,
                "scenario_id": scen3_id,
                "scenario_tag": "fan_out_dispersion",
                "is_suspicious": True,
            })
            # Immediate cash withdrawal at ATM within 30 minutes
            scenario_txns.append({
                "timestamp": t_fanout + timedelta(minutes=15),
                "origin_id": m_id,
                "dest_id": cashout1_id,
                "amount": 24500.0,
                "channel": PaymentChannel.ATM_CASH_OUT.value,
                "scenario_id": scen3_id,
                "scenario_tag": "fan_out_immediate_atm_drain",
                "is_suspicious": True,
            })

        # -------------------------------------------------------------------
        # Scenario 4: Cyclic Round-Tripping (A -> B -> C -> D -> A)
        # -------------------------------------------------------------------
        scen4_id = "SCENARIO-CYCLE-004"
        cycle_nodes = self.retail_ids[17:21]
        for c_id in cycle_nodes:
            self.accounts[c_id].ground_truth_label = AccountLabel.SHELL_ROUNDTRIPPER.value
            self.accounts[c_id].scenario_id = scen4_id
            self.running_balances[c_id] = max(self.running_balances[c_id], 150000.0)
            self.accounts[c_id].initial_balance = self.running_balances[c_id]

        t_cycle = self.start_dt + timedelta(days=min(55, sim_days - 2), hours=11)
        cycle_amt = 95000.0
        for step in range(len(cycle_nodes)):
            orig = cycle_nodes[step]
            dest = cycle_nodes[(step + 1) % len(cycle_nodes)]
            scenario_txns.append({
                "timestamp": t_cycle + timedelta(hours=step * 4),
                "origin_id": orig,
                "dest_id": dest,
                "amount": cycle_amt,
                "channel": PaymentChannel.RTGS.value,
                "scenario_id": scen4_id,
                "scenario_tag": f"cyclic_hop_{step+1}",
                "is_suspicious": True,
            })

        # -------------------------------------------------------------------
        # Scenario 5: Dormant Account Awakening (Dormant 120d, sudden large drain)
        # -------------------------------------------------------------------
        scen5_id = "SCENARIO-DORMANT-005"
        dormant_id = self.retail_ids[21]
        self.accounts[dormant_id].status = AccountStatus.DORMANT.value
        self.accounts[dormant_id].ground_truth_label = AccountLabel.DORMANT_AWAKENED_MULE.value
        self.accounts[dormant_id].scenario_id = scen5_id
        # Seed initial low balance
        self.running_balances[dormant_id] = 120.0
        self.accounts[dormant_id].initial_balance = 120.0

        # External funding source to trigger dormant awakening
        funding_source = self.retail_ids[22]
        self.running_balances[funding_source] = max(self.running_balances[funding_source], 250000.0)
        self.accounts[funding_source].initial_balance = self.running_balances[funding_source]

        t_dormant = self.start_dt + timedelta(days=min(70, sim_days - 2), hours=16)
        # 1. Sudden large inbound
        scenario_txns.append({
            "timestamp": t_dormant,
            "origin_id": funding_source,
            "dest_id": dormant_id,
            "amount": 180000.0,
            "channel": PaymentChannel.IMPS.value,
            "scenario_id": scen5_id,
            "scenario_tag": "dormant_high_value_inflow",
            "is_suspicious": True,
        })
        # 2. Immediate drain within 11 minutes
        scenario_txns.append({
            "timestamp": t_dormant + timedelta(minutes=11),
            "origin_id": dormant_id,
            "dest_id": cashout2_id,
            "amount": 179500.0,
            "channel": PaymentChannel.INTERNAL.value,
            "scenario_id": scen5_id,
            "scenario_tag": "dormant_rapid_pass_through_drain",
            "is_suspicious": True,
        })

        return scenario_txns

    def _plan_baseline_transactions(self, target_count: int) -> list[dict[str, Any]]:
        """Plans legitimate background retail, salary, P2P, and merchant transactions."""
        planned: list[dict[str, Any]] = []
        if target_count <= 0:
            return planned

        sim_seconds = int(self.config.simulation_days * 86400)
        all_acc_ids = list(self.accounts.keys())
        num_accs = len(all_acc_ids)

        # Precompute random offsets in seconds
        offsets = self.np_rng.integers(0, sim_seconds, size=target_count)
        offsets.sort()

        # Regular salary injections every 30 days to keep retail liquidity high
        # We can simulate salary/credit injections for ~15% of transactions
        for i in range(target_count):
            t_offset = int(offsets[i])
            txn_time = self.start_dt + timedelta(seconds=t_offset)

            p_type = self.rng.random()
            if p_type < 0.15 and self.corporate_ids and self.retail_ids:
                # Salary / Corporate distribution
                orig = self.rng.choice(self.corporate_ids)
                dest = self.rng.choice(self.retail_ids)
                amt = round(self.rng.uniform(25000.0, 85000.0), 2)
                channel = PaymentChannel.NEFT.value
                tag = "baseline_salary_credit"
            elif p_type < 0.60 and self.merchant_ids:
                # Retail POS / E-Commerce purchase at Merchant
                orig = self.rng.choice(self.retail_ids)
                dest = self.rng.choice(self.merchant_ids)
                amt = round(self.rng.uniform(50.0, 3500.0), 2)
                channel = self.rng.choice([PaymentChannel.UPI.value, PaymentChannel.CARD_POS.value])
                tag = "baseline_merchant_purchase"
            else:
                # Peer-to-peer transfer
                orig = self.rng.choice(all_acc_ids)
                dest = self.rng.choice(all_acc_ids)
                if orig == dest:
                    dest = all_acc_ids[(all_acc_ids.index(orig) + 1) % num_accs]
                amt = round(self.rng.uniform(100.0, 15000.0), 2)
                channel = self.rng.choice([PaymentChannel.UPI.value, PaymentChannel.IMPS.value])
                tag = "baseline_p2p_transfer"

            planned.append({
                "timestamp": txn_time,
                "origin_id": orig,
                "dest_id": dest,
                "amount": amt,
                "channel": channel,
                "scenario_id": None,
                "scenario_tag": tag,
                "is_suspicious": False,
            })

        return planned

    def _apply_transactions_chronologically(self, planned_txns: list[dict[str, Any]]) -> None:
        """Applies transactions strictly in chronological order, maintaining mathematical balance integrity."""
        self.transactions.clear()
        txn_counter = 1

        for item in planned_txns:
            orig_id = item["origin_id"]
            dest_id = item["dest_id"]
            amt = item["amount"]

            orig_bal_before = self.running_balances[orig_id]

            # Strict Ledger Rule: Outgoing transfers must respect available balance.
            # If a baseline transfer exceeds available balance, scale it to affordable amount or provide liquidity
            if amt > orig_bal_before:
                if item["is_suspicious"]:
                    # Injected scenario: ensure sender has sufficient funds
                    needed = amt - orig_bal_before + 1000.0
                    self.accounts[orig_id].initial_balance += needed
                    orig_bal_before += needed
                    self.running_balances[orig_id] = orig_bal_before
                else:
                    # Baseline transaction: scale amount to safe affordable proportion (or skip if balance <= 10)
                    if orig_bal_before <= 10.0:
                        continue
                    amt = round(self.rng.uniform(5.0, orig_bal_before * 0.75), 2)

            dest_bal_before = self.running_balances[dest_id]

            orig_bal_after = round(orig_bal_before - amt, 2)
            dest_bal_after = round(dest_bal_before + amt, 2)

            self.running_balances[orig_id] = orig_bal_after
            self.running_balances[dest_id] = dest_bal_after

            txn = SyntheticTransaction(
                transaction_id=f"TXN-{txn_counter:07d}",
                timestamp=item["timestamp"].isoformat(),
                origin_account_id=orig_id,
                destination_account_id=dest_id,
                amount=amt,
                currency="INR",
                channel=item["channel"],
                status="COMPLETED",
                origin_balance_before=round(orig_bal_before, 2),
                origin_balance_after=orig_bal_after,
                dest_balance_before=round(dest_bal_before, 2),
                dest_balance_after=dest_bal_after,
                scenario_id=item["scenario_id"],
                scenario_tag=item["scenario_tag"],
                is_suspicious_scenario=item["is_suspicious"],
            )

            self.transactions.append(txn)
            txn_counter += 1

    def _sync_final_account_balances(self) -> None:
        """Synchronizes final running balances back into SyntheticAccount objects."""
        for acc_id, final_bal in self.running_balances.items():
            self.accounts[acc_id].current_balance = round(final_bal, 2)

    def export_to_csv(self, output_dir: Optional[str] = None) -> tuple[str, str]:
        """Exports generated accounts and transactions to CSV files in output_dir."""
        out_dir = output_dir or self.config.output_dir
        os.makedirs(out_dir, exist_ok=True)

        acc_path = os.path.join(out_dir, "accounts.csv")
        txn_path = os.path.join(out_dir, "transactions.csv")

        # Export accounts
        if self.accounts:
            with open(acc_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(self.accounts[next(iter(self.accounts))].to_dict().keys()))
                writer.writeheader()
                for acc in self.accounts.values():
                    writer.writerow(acc.to_dict())

        # Export transactions
        if self.transactions:
            with open(txn_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(self.transactions[0].to_dict().keys()))
                writer.writeheader()
                for txn in self.transactions:
                    writer.writerow(txn.to_dict())

        return acc_path, txn_path
