"""Scenario-bank generator: a larger, more varied synthetic ledger for evaluating the account model.

The demo ledger (data/v2_fraudshield.db) contains five hand-placed scenarios with a single instance each,
which leaves the account model with 26 training positives and 6 test positives. This generator reuses the
demo generator's account and baseline-activity logic but plants many randomised instances of each scenario
family, plus legitimate look-alike behaviour ("hard negatives"), so that evaluation is less fragile.

Design rules (see docs/ACCOUNT_MODEL_AUDIT.md):

* Labels are assigned by the role an account plays in a planted scenario. Positive = an account used to
  receive and pass on, cash out or structure scenario funds. Victims and hard negatives are negative.
* Nothing that encodes the label is written into features. Unlike the demo generator, scenario accounts do
  not get their opening balance overwritten: downstream amounts are computed at apply time from what the
  account actually received, and structuring feeders are funded by a cash deposit first.
* Dormant accounts are genuinely inactive before they "awaken".
* Every scenario account belongs to exactly one scenario instance. Cash withdrawals and deposits go to
  dedicated external sink accounts (label ``unlabeled``), which are excluded from training and evaluation.
* Two families (cyclic round-tripping, slow layering) are generated for the test split only, to measure
  behaviour the model never saw in training.

This data is synthetic. It is designed to stress the model, not to reproduce real banking behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Optional

try:
    from backend.app.data.v2.generator import SyntheticBankGenerator
    from backend.app.data.v2.models import AccountLabel, AccountType, GenerationConfig, KycTier, PaymentChannel, SyntheticTransaction
except ModuleNotFoundError:  # pragma: no cover - imported with backend/ on sys.path
    from app.data.v2.generator import SyntheticBankGenerator
    from app.data.v2.models import AccountLabel, AccountType, GenerationConfig, KycTier, PaymentChannel, SyntheticTransaction

# Families present in train/validation/test. Instances of these are split by instance.
SEEN_FAMILIES = ("app_layering", "fan_out_dispersal", "structuring", "dormant_awakening")
# Families generated only for the locked test split.
UNSEEN_FAMILIES = ("cyclic_roundtrip", "slow_layering")
HARD_NEGATIVE_FAMILIES = ("salary_quick_payment", "student_fee_payment", "legit_dormant_reactivation", "merchant_sweep")

POSITIVE_LABELS = {
    AccountLabel.MULE_FIRST_HOP.value,
    AccountLabel.MULE_INTERMEDIATE.value,
    AccountLabel.MULE_FEEDER.value,
    AccountLabel.MULE_AGGREGATOR.value,
    AccountLabel.DORMANT_AWAKENED_MULE.value,
    AccountLabel.SHELL_ROUNDTRIPPER.value,
}
EXCLUDED_LABELS = {AccountLabel.UNLABELED.value}


@dataclass
class ScenarioBankConfig:
    seed: int = 20261029
    num_accounts: int = 20000
    num_transactions: int = 700000
    simulation_days: int = 90
    start_date: str = "2026-01-01T00:00:00Z"
    output_dir: str = "data/v2_model_eval"
    instances: dict[str, int] = field(
        default_factory=lambda: {
            "app_layering": 60,
            "fan_out_dispersal": 30,
            "structuring": 20,
            "dormant_awakening": 40,
            "cyclic_roundtrip": 15,
            "slow_layering": 25,
            "salary_quick_payment": 300,
            "student_fee_payment": 150,
            "legit_dormant_reactivation": 100,
            "merchant_sweep": 60,
        }
    )


class ScenarioBankGenerator(SyntheticBankGenerator):
    """Plants many randomised scenario instances into the demo generator's baseline economy."""

    def __init__(self, bank_config: Optional[ScenarioBankConfig] = None):
        self.bank_config = bank_config or ScenarioBankConfig()
        c = self.bank_config
        super().__init__(
            GenerationConfig(
                seed=c.seed,
                num_accounts=c.num_accounts,
                num_transactions=c.num_transactions,
                simulation_days=c.simulation_days,
                start_date=c.start_date,
                output_dir=c.output_dir,
            )
        )
        # group_id -> {"family": str, "kind": "positive_scenario" | "hard_negative"}
        self.groups: dict[str, dict[str, str]] = {}
        self.sink_ids: list[str] = []
        # account_id -> start of a window with no baseline activity (dormant accounts)
        self.quiet_until: dict[str, Any] = {}
        # accounts whose opening balance had to be topped up to fund a planted transfer
        self.topped_up: dict[str, float] = {}
        self._used: set[str] = set()
        self._pools: dict[str, list[str]] = {}
        self._counterparties: dict[str, list[str]] = {}

    # ------------------------------------------------------------------ helpers
    def _take(self, pool: str) -> str:
        """Draws an unused account of the given type, so no account is in two scenario instances."""
        candidates = self._pools[pool]
        while candidates:
            acc = candidates.pop()
            if acc not in self._used:
                self._used.add(acc)
                return acc
        raise RuntimeError(f"Account pool '{pool}' exhausted; increase num_accounts")

    def _cp(self, *pools: str) -> str:
        return self.rng.choice([a for p in pools for a in self._counterparties[p]])

    def _take_person(self) -> str:
        # Students are drawn at their share of the population: the generator must not plant a
        # demographic shortcut that the model could learn instead of behaviour.
        share = len(self.student_ids) / max(1, len(self.student_ids) + len(self.retail_ids))
        return self._take("student" if self.rng.random() < share else "retail")

    def _at(self, day_lo: float, day_hi: float):
        days = self.rng.uniform(day_lo, min(day_hi, self.config.simulation_days - 3))
        return self.start_dt + timedelta(days=days)

    def _mark(self, acc: str, label: str, group: str) -> None:
        self.accounts[acc].ground_truth_label = label
        self.accounts[acc].scenario_id = group

    def _new_group(self, family: str, idx: int, kind: str) -> str:
        prefix = "HN" if kind == "hard_negative" else "SC"
        gid = f"{prefix}-{family.upper().replace('_', '-')}-{idx:03d}"
        self.groups[gid] = {"family": family, "kind": kind}
        return gid

    def _leg(self, ts, origin: str, dest: str, *, group: str, tag: str, channel: str, suspicious: bool,
             key: Optional[str] = None, amount: Optional[float] = None,
             of_key: Optional[str] = None, of_balance: Optional[float] = None, fraction: float = 1.0,
             floor: float = 0.0, cap: Optional[float] = None) -> dict[str, Any]:
        """A planned transfer. Amount is fixed, a fraction of an earlier leg, or a fraction of the sender's balance."""
        return {
            "timestamp": ts,
            "origin_id": origin,
            "dest_id": dest,
            "amount": amount,
            "key": key,
            "of_key": of_key,
            "of_balance": of_balance,
            "fraction": fraction,
            "floor": floor,
            "cap": cap,
            "channel": channel,
            "scenario_id": group,
            "scenario_tag": tag,
            "is_suspicious": suspicious,
        }

    # ------------------------------------------------------------------ accounts
    def _generate_accounts(self) -> None:
        super()._generate_accounts()
        # External sinks stand in for ATM networks and cash-deposit channels; excluded from evaluation.
        for i in range(1, 4):
            acc_id = f"SINK-{i:03d}"
            first = next(iter(self.accounts.values()))
            sink = type(first)(
                account_id=acc_id,
                customer_name=f"External cash network {i} (synthetic)",
                customer_type=AccountType.CORPORATE.value,
                kyc_tier=KycTier.TIER_3_ENHANCED.value,
                phone_number="+91 00000 00000",
                email=f"sink{i}@example.bank",
                upi_id=f"sink{i}@external",
                tax_identifier=f"SINK{i:05d}X",
                initial_balance=1e12,
                current_balance=1e12,
                account_opened_at=self.start_dt.isoformat(),
                status="active",
                scenario_id=None,
                ground_truth_label=AccountLabel.UNLABELED.value,
            )
            self.accounts[acc_id] = sink
            self.running_balances[acc_id] = 1e12
            self.sink_ids.append(acc_id)
        for name, ids in (("retail", self.retail_ids), ("student", self.student_ids),
                          ("merchant", self.merchant_ids), ("corporate", self.corporate_ids)):
            pool = list(ids)
            self.rng.shuffle(pool)
            # Counterparties (payers, landlords, schools) are reserved so they never also play a scenario role.
            reserve = max(1, len(pool) // 20)
            self._counterparties[name] = pool[:reserve]
            self._pools[name] = pool[reserve:]

    # ------------------------------------------------------------------ scenarios
    def _plan_scenarios(self) -> list[dict[str, Any]]:
        n = self.bank_config.instances
        planned: list[dict[str, Any]] = []
        for i in range(n["app_layering"]):
            planned += self._plan_layering(self._new_group("app_layering", i, "positive_scenario"), slow=False)
        for i in range(n["slow_layering"]):
            planned += self._plan_layering(self._new_group("slow_layering", i, "positive_scenario"), slow=True)
        for i in range(n["fan_out_dispersal"]):
            planned += self._plan_fan_out(self._new_group("fan_out_dispersal", i, "positive_scenario"))
        for i in range(n["structuring"]):
            planned += self._plan_structuring(self._new_group("structuring", i, "positive_scenario"))
        for i in range(n["dormant_awakening"]):
            planned += self._plan_dormant(self._new_group("dormant_awakening", i, "positive_scenario"))
        for i in range(n["cyclic_roundtrip"]):
            planned += self._plan_cycle(self._new_group("cyclic_roundtrip", i, "positive_scenario"))
        for i in range(n["salary_quick_payment"]):
            planned += self._plan_salary_quick_payment(self._new_group("salary_quick_payment", i, "hard_negative"))
        for i in range(n["student_fee_payment"]):
            planned += self._plan_student_fee(self._new_group("student_fee_payment", i, "hard_negative"))
        for i in range(n["legit_dormant_reactivation"]):
            planned += self._plan_legit_dormant(self._new_group("legit_dormant_reactivation", i, "hard_negative"))
        for i in range(n["merchant_sweep"]):
            planned += self._plan_merchant_sweep(self._new_group("merchant_sweep", i, "hard_negative"))
        return planned

    def _plan_layering(self, g: str, slow: bool) -> list[dict[str, Any]]:
        """Victim -> first-hop mule -> 1-3 intermediates -> cash-out (sometimes via a second layer).

        ``slow`` waits 2-10 hours at each hop instead of minutes, so the 30-minute quick-forwarding
        signal does not fire. It is a test-only family.
        """
        r = self.rng
        victim = self._take("retail" if r.random() < 0.8 else "merchant")
        self._mark(victim, AccountLabel.COMPROMISED_VICTIM.value, g)
        hop1 = self._take_person()
        self._mark(hop1, AccountLabel.MULE_FIRST_HOP.value, g)
        delay = (lambda: timedelta(hours=r.uniform(2, 10))) if slow else (lambda: timedelta(minutes=r.uniform(3, 40)))
        t0 = self._at(5, 80)
        tag = "slow_layering" if slow else "app_layering"
        legs = [self._leg(t0, victim, hop1, group=g, tag=f"{tag}_victim_drain", channel=r.choice(["IMPS", "UPI", "NEFT"]),
                          suspicious=True, key=f"{g}:in", of_balance=r.uniform(0.5, 0.95), floor=20000.0, cap=400000.0)]
        k = r.choice([1, 2, 2, 3])
        forward = r.uniform(0.85, 0.99)
        t1 = t0 + delay()
        for j in range(k):
            mid = self._take_person()
            self._mark(mid, AccountLabel.MULE_INTERMEDIATE.value, g)
            legs.append(self._leg(t1 + timedelta(minutes=2 * j), hop1, mid, group=g, tag=f"{tag}_split", channel="UPI",
                                  suspicious=True, key=f"{g}:mid{j}", of_key=f"{g}:in", fraction=forward / k))
            t2 = t1 + timedelta(minutes=2 * j) + delay()
            if r.random() < 0.3:
                second = self._take_person()
                self._mark(second, AccountLabel.MULE_INTERMEDIATE.value, g)
                legs.append(self._leg(t2, mid, second, group=g, tag=f"{tag}_second_layer", channel="IMPS", suspicious=True,
                                      key=f"{g}:second{j}", of_key=f"{g}:mid{j}", fraction=r.uniform(0.9, 0.99)))
                legs.append(self._leg(t2 + delay(), second, r.choice(self.sink_ids), group=g, tag=f"{tag}_cash_out",
                                      channel="ATM_CASH_OUT", suspicious=True, of_key=f"{g}:second{j}", fraction=r.uniform(0.9, 0.99)))
            else:
                legs.append(self._leg(t2, mid, r.choice(self.sink_ids), group=g, tag=f"{tag}_cash_out", channel="ATM_CASH_OUT",
                                      suspicious=True, of_key=f"{g}:mid{j}", fraction=r.uniform(0.9, 0.99)))
        return legs

    def _plan_fan_out(self, g: str) -> list[dict[str, Any]]:
        """A compromised business account is drained into 4-12 mules who each withdraw cash."""
        r = self.rng
        source = self._take("corporate" if r.random() < 0.5 else "merchant")
        self._mark(source, AccountLabel.COMPROMISED_VICTIM.value, g)
        m = r.randint(4, 12)
        share = r.uniform(0.25, 0.6) / m
        t0 = self._at(5, 80)
        legs = []
        for j in range(m):
            mule = self._take_person()
            self._mark(mule, AccountLabel.MULE_INTERMEDIATE.value, g)
            ts = t0 + timedelta(minutes=r.uniform(0, 3) + 3 * j)
            legs.append(self._leg(ts, source, mule, group=g, tag="fan_out_dispersion", channel=r.choice(["NEFT", "IMPS"]),
                                  suspicious=True, key=f"{g}:m{j}", of_balance=share, floor=8000.0, cap=150000.0))
            legs.append(self._leg(ts + timedelta(minutes=r.uniform(5, 60)), mule, r.choice(self.sink_ids), group=g,
                                  tag="fan_out_cash_out", channel="ATM_CASH_OUT", suspicious=True,
                                  of_key=f"{g}:m{j}", fraction=r.uniform(0.9, 0.99)))
        return legs

    def _plan_structuring(self, g: str) -> list[dict[str, Any]]:
        """Feeders deposit cash and pass amounts just below ₹50,000 to an aggregator, who drains the total."""
        r = self.rng
        agg = self._take_person()
        self._mark(agg, AccountLabel.MULE_AGGREGATOR.value, g)
        n = r.randint(6, 14)
        t0 = self._at(5, 70)
        legs = []
        last = t0
        for j in range(n):
            feeder = self._take_person()
            self._mark(feeder, AccountLabel.MULE_FEEDER.value, g)
            td = t0 + timedelta(hours=r.uniform(0, 48))
            deposit = round(r.uniform(40000.0, 49500.0), 2)
            legs.append(self._leg(td, r.choice(self.sink_ids), feeder, group=g, tag="structuring_cash_deposit", channel="INTERNAL",
                                  suspicious=True, key=f"{g}:dep{j}", amount=deposit))
            tf = td + timedelta(hours=r.uniform(0.5, 24))
            last = max(last, tf)
            legs.append(self._leg(tf, feeder, agg, group=g, tag="structuring_fan_in", channel="UPI", suspicious=True,
                                  key=f"{g}:feed{j}", of_key=f"{g}:dep{j}", fraction=r.uniform(0.97, 1.0)))
        total_key_fraction = r.uniform(0.9, 0.98)
        legs.append(self._leg(last + timedelta(hours=r.uniform(2, 30)), agg, r.choice(self.sink_ids), group=g,
                              tag="structuring_consolidated_drain", channel="RTGS", suspicious=True,
                              of_balance=total_key_fraction))
        return legs

    def _plan_dormant(self, g: str) -> list[dict[str, Any]]:
        """An account with no activity for 50+ days receives a large transfer and drains it within minutes."""
        r = self.rng
        acc = self._take_person()
        self._mark(acc, AccountLabel.DORMANT_AWAKENED_MULE.value, g)
        t0 = self._at(25, 85)
        self.quiet_until[acc] = t0
        amt = round(r.uniform(60000.0, 250000.0), 2)
        return [
            self._leg(t0, r.choice(self.sink_ids), acc, group=g, tag="dormant_high_value_inflow", channel="IMPS",
                      suspicious=True, key=f"{g}:in", amount=amt),
            self._leg(t0 + timedelta(minutes=r.uniform(5, 40)), acc, r.choice(self.sink_ids), group=g,
                      tag="dormant_rapid_drain", channel=r.choice(["IMPS", "ATM_CASH_OUT"]), suspicious=True,
                      of_key=f"{g}:in", fraction=r.uniform(0.95, 0.99)),
        ]

    def _plan_cycle(self, g: str) -> list[dict[str, Any]]:
        """3-6 accounts pass the same money around a loop over hours (test-only family)."""
        r = self.rng
        nodes = [self._take("retail" if r.random() < 0.6 else "merchant") for _ in range(r.randint(3, 6))]
        for acc in nodes:
            self._mark(acc, AccountLabel.SHELL_ROUNDTRIPPER.value, g)
        t = self._at(5, 75)
        legs = [self._leg(t, r.choice(self.sink_ids), nodes[0], group=g, tag="cycle_seed", channel="RTGS", suspicious=True,
                          key=f"{g}:h0", amount=round(r.uniform(50000.0, 150000.0), 2))]
        for rounds in range(r.randint(1, 3)):
            for step in range(len(nodes)):
                idx = rounds * len(nodes) + step
                t += timedelta(hours=r.uniform(1, 6))
                legs.append(self._leg(t, nodes[step], nodes[(step + 1) % len(nodes)], group=g, tag="cycle_hop", channel="RTGS",
                                      suspicious=True, key=f"{g}:h{idx + 1}", of_key=f"{g}:h{idx}", fraction=r.uniform(0.97, 0.995)))
        return legs

    # ------------------------------------------------------------------ hard negatives
    def _plan_salary_quick_payment(self, g: str) -> list[dict[str, Any]]:
        """A salary or bonus arrives and most of it pays rent or a loan instalment within minutes."""
        r = self.rng
        acc = self._take("retail")
        self.accounts[acc].scenario_id = g
        payer = self._cp("corporate")
        t = self._at(3, 85)
        return [
            self._leg(t, payer, acc, group=g, tag="hn_salary", channel="NEFT", suspicious=False, key=f"{g}:in",
                      of_balance=0.05, floor=40000.0, cap=150000.0),
            self._leg(t + timedelta(minutes=r.uniform(5, 25)), acc, self._cp("merchant", "corporate"), group=g,
                      tag="hn_rent_or_emi", channel=r.choice(["UPI", "IMPS", "NEFT"]), suspicious=False,
                      of_key=f"{g}:in", fraction=r.uniform(0.7, 0.95)),
        ]

    def _plan_student_fee(self, g: str) -> list[dict[str, Any]]:
        """A parent sends a student a large amount that is paid on as fees within minutes."""
        r = self.rng
        acc = self._take("student")
        self.accounts[acc].scenario_id = g
        parent = self._cp("retail")
        t = self._at(3, 85)
        return [
            self._leg(t, parent, acc, group=g, tag="hn_family_support", channel="IMPS", suspicious=False, key=f"{g}:in",
                      of_balance=r.uniform(0.6, 0.95), floor=50000.0, cap=200000.0),
            self._leg(t + timedelta(minutes=r.uniform(2, 30)), acc, self._cp("corporate", "merchant"), group=g,
                      tag="hn_fee_payment", channel=r.choice(["NEFT", "UPI"]), suspicious=False,
                      of_key=f"{g}:in", fraction=r.uniform(0.9, 1.0)),
        ]

    def _plan_legit_dormant(self, g: str) -> list[dict[str, Any]]:
        """An inactive account receives a maturity or sale payout; half move it on quickly to an investment."""
        r = self.rng
        acc = self._take_person()
        self.accounts[acc].scenario_id = g
        t = self._at(25, 85)
        self.quiet_until[acc] = t
        legs = [self._leg(t, self._cp("corporate"), acc, group=g, tag="hn_payout", channel="NEFT", suspicious=False,
                          key=f"{g}:in", of_balance=0.1, floor=60000.0, cap=300000.0)]
        if r.random() < 0.5:
            legs.append(self._leg(t + timedelta(minutes=r.uniform(10, 40)), acc, self._cp("corporate"), group=g,
                                  tag="hn_investment", channel="NEFT", suspicious=False, of_key=f"{g}:in",
                                  fraction=r.uniform(0.8, 0.95)))
        return legs

    def _plan_merchant_sweep(self, g: str) -> list[dict[str, Any]]:
        """A shop sweeps most of its balance to its company account every few days."""
        r = self.rng
        acc = self._take("merchant")
        self.accounts[acc].scenario_id = g
        target = self._cp("corporate")
        t = self.start_dt + timedelta(days=r.uniform(2, 6))
        legs = []
        while t < self.start_dt + timedelta(days=self.config.simulation_days - 3):
            legs.append(self._leg(t, acc, target, group=g, tag="hn_settlement_sweep", channel="NEFT", suspicious=False,
                                  of_balance=r.uniform(0.8, 0.95)))
            t += timedelta(days=r.uniform(3, 7))
        return legs

    # ------------------------------------------------------------------ ledger
    def _plan_baseline_transactions(self, target_count: int) -> list[dict[str, Any]]:
        planned = super()._plan_baseline_transactions(target_count)
        sinks = set(self.sink_ids)

        def keep(t: dict[str, Any]) -> bool:
            for acc in (t["origin_id"], t["dest_id"]):
                if acc in sinks:
                    return False
                quiet = self.quiet_until.get(acc)
                if quiet is not None and t["timestamp"] < quiet:
                    return False
            return True

        return [t for t in planned if keep(t)]

    def _apply_transactions_chronologically(self, planned_txns: list[dict[str, Any]]) -> None:
        """Like the demo generator, but planted amounts follow what accounts actually hold or received."""
        self.transactions.clear()
        applied: dict[str, float] = {}
        counter = 1
        for item in planned_txns:
            orig_id, dest_id = item["origin_id"], item["dest_id"]
            bal = self.running_balances[orig_id]
            planted = item.get("key") is not None or item.get("of_key") is not None or item.get("of_balance") is not None
            if item.get("of_key") is not None:
                if item["of_key"] not in applied:
                    continue  # parent leg was skipped
                amt = round(applied[item["of_key"]] * item["fraction"], 2)
            elif item.get("of_balance") is not None:
                amt = round(max(bal * item["of_balance"], min(item.get("floor") or 0.0, bal * 0.95)), 2)
                if item.get("cap"):
                    amt = min(amt, item["cap"])
            else:
                amt = item["amount"]
            if amt is None or amt <= 0:
                continue
            derived = item.get("of_key") is not None or item.get("of_balance") is not None
            if amt > bal and derived:
                # Ordinary spending since the money arrived left less than planned: pass on what is there.
                amt = round(bal * 0.99, 2)
            if amt > bal:
                if planted:
                    # Only fixed-amount planted legs can need this; it is recorded and reported.
                    needed = amt - bal + 1000.0
                    self.accounts[orig_id].initial_balance += needed
                    self.topped_up[orig_id] = self.topped_up.get(orig_id, 0.0) + needed
                    bal += needed
                    self.running_balances[orig_id] = bal
                else:
                    if bal <= 10.0:
                        continue
                    amt = round(self.rng.uniform(5.0, bal * 0.75), 2)
            if item.get("key"):
                applied[item["key"]] = amt
            dest_before = self.running_balances[dest_id]
            self.running_balances[orig_id] = round(bal - amt, 2)
            self.running_balances[dest_id] = round(dest_before + amt, 2)
            self.transactions.append(
                SyntheticTransaction(
                    transaction_id=f"TXN-{counter:07d}",
                    timestamp=item["timestamp"].isoformat(),
                    origin_account_id=orig_id,
                    destination_account_id=dest_id,
                    amount=amt,
                    currency="INR",
                    channel=item["channel"],
                    status="COMPLETED",
                    origin_balance_before=round(bal, 2),
                    origin_balance_after=round(bal - amt, 2),
                    dest_balance_before=round(dest_before, 2),
                    dest_balance_after=round(dest_before + amt, 2),
                    scenario_id=item["scenario_id"],
                    scenario_tag=item["scenario_tag"],
                    is_suspicious_scenario=item["is_suspicious"],
                )
            )
            counter += 1


def build_scenario_bank(config: Optional[ScenarioBankConfig] = None, db_path: Optional[str] = None) -> dict[str, Any]:
    """Generates, validates, exports and ingests the scenario-bank ledger into its own SQLite file."""
    import json
    import time
    from pathlib import Path

    from sqlalchemy import create_engine

    try:
        from backend.app.data.v2.validator import SyntheticDataValidator
        from backend.app.db.v2.ingestion import ingest_v2_dataset
    except ModuleNotFoundError:  # pragma: no cover
        from app.data.v2.validator import SyntheticDataValidator
        from app.db.v2.ingestion import ingest_v2_dataset

    cfg = config or ScenarioBankConfig()
    t0 = time.perf_counter()
    gen = ScenarioBankGenerator(cfg)
    accounts, transactions = gen.generate()
    report = SyntheticDataValidator(accounts, transactions).validate_all()
    if not report.is_valid:
        raise RuntimeError(f"Scenario bank failed ledger validation: {report.errors[:5]}")
    acc_csv, txn_csv = gen.export_to_csv(cfg.output_dir)
    out = Path(cfg.output_dir)
    db_file = Path(db_path) if db_path else out / "v2_model_eval.db"
    groups = {
        "seed": cfg.seed,
        "groups": gen.groups,
        "sink_ids": gen.sink_ids,
        "topped_up_accounts": {k: round(v, 2) for k, v in gen.topped_up.items()},
    }
    (out / "groups.json").write_text(json.dumps(groups, indent=2))
    engine = create_engine(f"sqlite:///{db_file}")
    ingest_v2_dataset(engine, acc_csv, txn_csv, batch_size=20000, replace=True)
    engine.dispose()
    positives = sum(1 for a in accounts if a.ground_truth_label in POSITIVE_LABELS)
    return {
        "db_path": str(db_file),
        "accounts": len(accounts),
        "transactions": len(transactions),
        "positive_accounts": positives,
        "groups": len(gen.groups),
        "topped_up_positive_accounts": sorted(
            k for k in gen.topped_up if gen.accounts[k].ground_truth_label in POSITIVE_LABELS
        ),
        "seconds": round(time.perf_counter() - t0, 1),
    }


if __name__ == "__main__":
    print(build_scenario_bank())
