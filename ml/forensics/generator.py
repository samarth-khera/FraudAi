"""Forensic scenario generator: reproducible synthetic ledgers with documented account roles.

Why a third generator. The demo ledger (backend/app/data/v2/generator.py) plants five single scenarios and
overwrites scenario accounts' balances; the scenario bank (ml/v2/scenario_bank.py) fixes that for the account
model but has no victim / attacker / innocent-counterparty roles and no transaction-level design. Neither can
evaluate who in a traced network is a victim, an intermediary or an ordinary counterparty. This generator plants
twelve documented patterns into its own baseline economy and records, separately from the ledger, the role each
account played (see ROLE_DEFINITIONS and docs/DYNAMIC_INTELLIGENCE.md).

Rules that keep it honest:
* Account IDs are random per seed (``FS-`` + 8 hex digits), so two ledgers share no IDs and the ID says nothing.
* No balance is overwritten. Scenario amounts are fractions of what an account actually holds or received when
  the transfer happens; a leg that cannot be funded is skipped and counted.
* Scenario timing uses the same time-of-day distribution as ordinary activity (account takeovers excepted, which
  happen at night 30% of the time, and ordinary activity has a night share too).
* Ordinary activity contains the legitimate look-alikes: payroll fan-out, rent paid minutes after salary, cash
  withdrawals, merchant settlement sweeps, family money pooled for a large bill, and newly opened accounts.
* Every account plays at most one scenario role. Ground truth goes to ``ground_truth_label``/``scenario_id`` and
  the roles table only; inference code never reads them (tests scramble them and compare outputs).
* Variants listed in HELD_OUT_VARIANTS are generated only when ``include_held_out`` is true, so a training ledger
  never contains them and evaluation on a held-out ledger measures behaviour the models never saw.

All of this is synthetic and designed to stress the system, not to reproduce real banking volumes or rates.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd

GENERATOR_VERSION = "forensic-scenarios-1.0.0"

# ---------------------------------------------------------------------------- definitions
ROLE_DEFINITIONS: dict[str, str] = {
    "victim": "Lost money through an unauthorised or deceptive transfer it was manipulated into (APP scam) or that "
              "an attacker made from it (account takeover). Its own funds left the account.",
    "secondary_victim": "Received money inside a scam chain and was itself exploited: besides forwarding what it "
                        "received, its own pre-existing funds were drained to the network.",
    "intermediary": "Received scam money and passed most of it on (money-mule behaviour). The generator does not "
                    "model whether the holder knew; the label describes the account's position, not intent.",
    "attacker_controlled": "Collection or cash-out account controlled by the scenario's attacker: the end point that "
                           "collects or withdraws the money.",
    "innocent_counterparty": "Ordinary account that received money originating from a scam flow (a purchase, rent, "
                             "a sale) with no knowledge of or role in it.",
    "lookalike_legitimate": "Ordinary account whose legitimate activity resembles a suspicious pattern "
                            "(money pooled from relatives then paid on, settlement passed through).",
    "ordinary": "Ordinary person with no part in any scenario.",
    "merchant": "Ordinary merchant or service provider with no part in any scenario.",
    "employer": "Ordinary employer paying salaries.",
    "cash_network": "Synthetic stand-in for an ATM/cash network; destination of cash withdrawals. Not evaluated.",
}

# Roles an evaluation counts as needing examination (account behaviour model target).
SUSPICIOUS_ROLES = ("intermediary", "attacker_controlled")
AFFECTED_ROLES = ("victim", "secondary_victim")

PATTERN_DEFINITIONS: dict[str, str] = {
    "direct": "1. Victim pays the attacker's collection account directly, once or in a quick burst.",
    "chain": "2. Victim -> one intermediary -> attacker.",
    "multi_hop": "3. Victim -> two or three intermediaries in sequence -> attacker.",
    "split": "4. Victim -> intermediary, who splits the money across 2-5 further intermediaries, each cashing out.",
    "consolidation": "5. Money split across intermediaries is consolidated again into one collection account.",
    "circular": "6. Intermediaries pass money around a loop back to an earlier account before it exits.",
    "multi_victim": "7. Several unrelated victims pay the same intermediary or collection account.",
    "incidental": "8. Scam money reaches an ordinary merchant or landlord (a purchase or rent) - add-on to 1-7.",
    "innocent_recipient": "9. An ordinary person receives scam money (e.g. selling an item) and does not pass it on "
                          "- add-on to 1-7.",
    "lookalike": "10. Legitimate activity resembling a pattern: relatives pool money, one account pays a hospital or "
                 "college bill within hours.",
    "takeover": "11. Account takeover: an attacker operates the victim's account and sends a burst to new recipients.",
    "normal": "12. Ordinary economy: salaries, payroll fan-out, rent, bills, purchases, P2P, cash, merchant sweeps.",
}
# Variants never generated into a training ledger.
HELD_OUT_VARIANTS = {
    "multi_hop:slow": "Each hop waits 6-40 hours instead of minutes, so 'forwarded within the hour' never fires.",
    "split:structured": "The split uses many transfers under 10,000 instead of a few large ones.",
    "takeover:after_dormancy": "The account had no activity for 45+ days before the takeover burst.",
}

HOUR_WEIGHTS = np.array([1, 0.6, 0.4, 0.3, 0.3, 0.6, 1.5, 3, 5, 6, 7, 7, 7, 6.5, 6, 6, 6, 6.5, 7, 7.5, 7, 5.5, 3.5, 2],
                        dtype=float)
HOUR_WEIGHTS /= HOUR_WEIGHTS.sum()
FIRST = ["Aarav", "Aditi", "Ananya", "Arjun", "Diya", "Farah", "Gaurav", "Harini", "Imran", "Ishaan", "Jaya",
         "Kabir", "Lakshmi", "Meera", "Naveen", "Nisha", "Omkar", "Pooja", "Rahul", "Riya", "Sahil", "Sana",
         "Tanvi", "Uday", "Varun", "Vidya", "Yusuf", "Zara"]
LAST = ["Agarwal", "Bose", "Chopra", "Das", "Fernandes", "Ghosh", "Iyer", "Jain", "Kapoor", "Khan", "Menon",
        "Nair", "Pillai", "Rao", "Sethi", "Shah", "Singh", "Thomas", "Verma", "Yadav"]


@dataclass
class ForensicLedgerConfig:
    seed: int = 101
    num_people: int = 9000
    num_merchants: int = 700
    num_employers: int = 60
    num_cash_networks: int = 3
    days: int = 120
    start: str = "2026-01-01T00:00:00+00:00"
    include_held_out: bool = False
    # Scenario instances per pattern (patterns 8 and 9 are add-ons attached to these at random).
    instances: dict[str, int] = field(default_factory=lambda: {
        "direct": 45, "chain": 45, "multi_hop": 40, "split": 35, "consolidation": 25, "circular": 20,
        "multi_victim": 25, "takeover": 40, "lookalike": 60,
    })
    # Share of instances of a pattern generated as its held-out variant (only when include_held_out).
    held_out_share: float = 0.35


@dataclass
class _Leg:
    ts: datetime
    origin: str
    dest: str
    channel: str
    amount: Optional[float] = None
    frac_balance: Optional[float] = None
    of_key: Optional[str] = None
    of_frac: float = 1.0
    key: Optional[str] = None
    scenario_id: Optional[str] = None
    tag: str = "normal"
    suspicious: bool = False
    min_amount: float = 50.0
    order: int = 0


class ForensicScenarioGenerator:
    def __init__(self, config: Optional[ForensicLedgerConfig] = None):
        self.c = config or ForensicLedgerConfig()
        self.rng = random.Random(self.c.seed)
        self.np = np.random.default_rng(self.c.seed)
        self.start = datetime.fromisoformat(self.c.start)
        self.accounts: dict[str, dict] = {}
        self.legs: list[_Leg] = []
        self.roles: list[dict] = []
        self.scenarios: list[dict] = []
        self.used: set[str] = set()
        self.people: list[str] = []
        self.merchants: list[str] = []
        self.employers: list[str] = []
        self.cash: list[str] = []
        self.landlords: list[str] = []
        self.utilities: list[str] = []
        self.contacts: dict[str, list[str]] = {}
        self.income: dict[str, float] = {}
        self.quiet: dict[str, tuple[datetime, datetime]] = {}  # account -> (from, until) with no ordinary activity
        self.skipped_legs = 0
        self._order = 0

    # ------------------------------------------------------------------ helpers
    def _new_id(self) -> str:
        while True:
            acc = f"FS-{self.rng.getrandbits(32):08X}"
            if acc not in self.accounts:
                return acc

    def _tod(self, day_start: datetime, night: bool = False) -> datetime:
        hour = self.rng.choice([0, 1, 2, 3, 4]) if night else int(self.np.choice(24, p=HOUR_WEIGHTS))
        return day_start + timedelta(hours=hour, seconds=self.rng.randint(0, 3599))

    def _day(self, d: float) -> datetime:
        return (self.start + timedelta(days=int(d))).replace(hour=0, minute=0, second=0)

    def _amount(self, median: float, sigma: float = 0.6) -> float:
        a = float(self.np.lognormal(np.log(median), sigma))
        # Round amounts are common in ordinary and scenario transfers alike.
        return round(a / 500) * 500.0 if a > 2000 and self.rng.random() < 0.4 else round(a, 2)

    def _leg(self, **kw) -> _Leg:
        self._order += 1
        leg = _Leg(order=self._order, **kw)
        self.legs.append(leg)
        return leg

    def _account(self, kind: str, opened: Optional[datetime] = None, balance: Optional[float] = None) -> str:
        acc = self._new_id()
        first, last = self.rng.choice(FIRST), self.rng.choice(LAST)
        ctype = {"person": "retail", "student": "student", "merchant": "sme", "employer": "corporate",
                 "cash": "corporate", "utility": "sme"}[kind]
        if kind == "person" and self.rng.random() < 0.15:
            ctype = "student"
        name = {"merchant": f"{last} Stores (synthetic)", "employer": f"{last} Industries (synthetic)",
                "cash": "Cash withdrawal network (synthetic)", "utility": f"{last} Utilities (synthetic)"}.get(
            kind, f"{first} {last}")
        if balance is None:
            balance = {"person": self.np.lognormal(np.log(30_000), 0.9), "merchant": self.np.lognormal(np.log(150_000), 0.8),
                       "employer": self.np.lognormal(np.log(2e8), 0.5), "cash": 1e12, "utility": 5e5}.get(kind, 20_000)
        opened = opened or self.start - timedelta(days=self.rng.randint(60, 2000))
        h = hashlib.sha1(acc.encode()).hexdigest()[:6]
        self.accounts[acc] = {
            "account_id": acc, "customer_name": name, "customer_type": ctype,
            "kyc_tier": "tier_1_basic" if ctype == "student" or self.rng.random() < 0.3 else "tier_2_verified",
            "phone_number": f"+91 9{self.rng.randint(100000000, 999999999)}", "email": f"user{h}@example.bank",
            "upi_id": f"{h}@synthetic", "tax_identifier": f"SYN{h.upper()}", "initial_balance": round(float(balance), 2),
            "account_opened_at": opened, "status": "active", "scenario_id": None,
            "ground_truth_label": {"person": "ordinary", "student": "ordinary", "merchant": "merchant",
                                   "employer": "employer", "cash": "cash_network", "utility": "merchant"}[kind],
            "_kind": kind,
        }
        return acc

    def _role(self, acc: str, role: str, sid: str, detail: str = "") -> None:
        a = self.accounts[acc]
        if a["ground_truth_label"] in ("ordinary", "merchant") and role != "innocent_counterparty":
            self.used.add(acc)
        if a["scenario_id"] is None:  # first scenario wins for the account record; the roles table keeps all
            a["ground_truth_label"], a["scenario_id"] = role, sid
        self.roles.append({"account_id": acc, "scenario_id": sid, "role": role, "role_detail": detail})

    def _take_person(self, min_income: float = 0.0) -> str:
        for _ in range(10_000):
            acc = self.rng.choice(self.people)
            if acc not in self.used and acc not in self.landlords and self.income.get(acc, 0) >= min_income:
                self.used.add(acc)
                return acc
        raise RuntimeError("person pool exhausted; increase num_people")

    def _fresh_account(self, when: datetime) -> str:
        """A recently opened account (mules and collection accounts often are; so are 8% of ordinary ones)."""
        acc = self._account("person", opened=when - timedelta(days=self.rng.uniform(3, 45)),
                            balance=self.rng.uniform(200, 4000))
        self.used.add(acc)
        self.contacts[acc] = self.rng.sample(self.people, 2)
        self._ordinary_activity(acc, light=True)
        return acc

    def _mule(self, when: datetime) -> str:
        return self._fresh_account(when) if self.rng.random() < 0.45 else self._take_person()

    # ------------------------------------------------------------------ ordinary economy
    def _build_population(self) -> None:
        c = self.c
        for _ in range(c.num_employers):
            self.employers.append(self._account("employer"))
        for _ in range(c.num_cash_networks):
            self.cash.append(self._account("cash"))
        for _ in range(c.num_merchants):
            self.merchants.append(self._account("merchant"))
        for _ in range(max(3, c.num_merchants // 40)):
            self.utilities.append(self._account("utility"))
        late = int(c.num_people * 0.08)
        for i in range(c.num_people):
            opened = None
            if i < late:  # newly opened ordinary accounts, so "new account" is not a scenario-only trait
                opened = self.start + timedelta(days=self.rng.uniform(0, c.days - 10))
            acc = self._account("person", opened=opened)
            self.people.append(acc)
            self.income[acc] = float(self.np.lognormal(np.log(42_000), 0.55))
        self.landlords = self.rng.sample(self.people, max(10, c.num_people // 25))
        for acc in self.people:
            self.contacts[acc] = self.rng.sample(self.people, self.rng.randint(2, 6))

    def _ordinary_activity(self, acc: str, light: bool = False) -> None:
        """Plans ordinary activity for one person between its opening date and the end of the ledger."""
        c, r = self.c, self.rng
        opened = max(self.accounts[acc]["account_opened_at"], self.start)
        first_day = (opened - self.start).days + 1
        student = self.accounts[acc]["customer_type"] == "student"
        income = self.income.setdefault(acc, float(self.np.lognormal(np.log(42_000), 0.55)))
        employer = r.choice(self.employers)
        parent = r.choice(self.people) if student else None
        landlord = r.choice(self.landlords) if not student and r.random() < 0.55 else None
        rent_fast = r.random() < 0.15  # rent paid minutes after the salary lands: a legitimate rapid forward
        scale = 0.3 if light else 1.0
        for d in range(max(0, first_day), c.days):
            day = self._day(d)
            if day.day == 1 or (d == first_day and light):
                if not light:
                    if student:
                        t = self._tod(day)
                        self._leg(ts=t, origin=parent, dest=acc, channel="UPI", amount=self._amount(income * 0.25, 0.3), tag="allowance")
                    else:
                        t = day + timedelta(hours=9, minutes=r.randint(0, 120))
                        self._leg(ts=t, origin=employer, dest=acc, channel="NEFT", amount=round(income, 2), tag="salary")
                        if landlord:
                            dt = timedelta(minutes=r.uniform(2, 40)) if rent_fast else timedelta(days=r.uniform(0.5, 4))
                            self._leg(ts=t + dt, origin=acc, dest=landlord, channel="IMPS", amount=round(income * r.uniform(0.2, 0.35), -2), tag="rent")
                    self._leg(ts=self._tod(day + timedelta(days=r.randint(1, 6))), origin=acc, dest=r.choice(self.utilities),
                              channel="UPI", amount=self._amount(1200, 0.5), tag="bill")
            n_pos = self.np.poisson(0.3 * scale)
            for _ in range(n_pos):
                self._leg(ts=self._tod(day), origin=acc, dest=r.choice(self.merchants), channel=r.choice(["UPI", "CARD_POS", "CARD_POS"]),
                          amount=self._amount(650, 0.9), tag="purchase")
            if r.random() < 0.035 * scale:
                self._leg(ts=self._tod(day), origin=acc, dest=r.choice(self.contacts[acc]), channel=r.choice(["UPI", "IMPS", "IMPS"]),
                          amount=self._amount(2500, 0.9), tag="p2p")
            if r.random() < 0.04 * scale:
                self._leg(ts=self._tod(day), origin=acc, dest=r.choice(self.cash), channel="ATM_CASH_OUT",
                          amount=float(r.choice([1000, 2000, 3000, 5000, 10000, 20000, 40000] if r.random() < 0.1 else [1000, 2000, 3000, 5000, 10000])), tag="cash")
            if r.random() < 0.003 * scale:  # a large legitimate purchase (appliance, deposit, travel)
                self._leg(ts=self._tod(day), origin=acc, dest=r.choice(self.merchants), channel=r.choice(["IMPS", "NEFT", "CARD_POS"]),
                          amount=self._amount(35_000, 0.6), tag="large_purchase")

    def _merchant_activity(self) -> None:
        r = self.rng
        for m in self.merchants + self.utilities:
            supplier = r.choice(self.merchants)
            owner = r.choice(self.people)
            for d in range(r.randint(0, 6), self.c.days, 7):  # weekly settlement sweep: inflows then one large outflow
                self._leg(ts=self._day(d) + timedelta(hours=18, minutes=r.randint(0, 120)), origin=m,
                          dest=supplier if r.random() < 0.6 else owner, channel="NEFT", frac_balance=r.uniform(0.5, 0.85),
                          tag="settlement", min_amount=1000)
        for e in self.employers:
            for d in range(0, self.c.days, 15):
                self._leg(ts=self._tod(self._day(d)), origin=e, dest=r.choice(self.merchants), channel="RTGS",
                          amount=self._amount(400_000, 0.5), tag="b2b")

    # ------------------------------------------------------------------ scenario helpers
    def _variant(self, pattern: str) -> str:
        held = [v.split(":")[1] for v in HELD_OUT_VARIANTS if v.startswith(pattern + ":")]
        if held and self.c.include_held_out and self.rng.random() < self.c.held_out_share:
            return held[0]
        return "standard"

    def _when(self) -> datetime:
        return self._tod(self._day(self.rng.uniform(20, self.c.days - 6)))

    def _daytime(self, ts: datetime) -> datetime:
        """Moves a cash withdrawal or slow hop that would land between midnight and 6:00 into the morning."""
        return ts.replace(hour=self.rng.randint(6, 9), minute=self.rng.randint(0, 59)) if ts.hour < 6 else ts

    def _delay(self, slow: bool = False) -> timedelta:
        return timedelta(hours=self.rng.uniform(6, 40)) if slow else timedelta(minutes=self.rng.uniform(3, 90))

    def _sid(self, pattern: str, variant: str) -> str:
        sid = f"SC-{pattern.upper().replace('_', '-')}-{len(self.scenarios) + 1:04d}"
        self.scenarios.append({"scenario_id": sid, "pattern": pattern, "variant": variant,
                               "held_out": f"{pattern}:{variant}" in HELD_OUT_VARIANTS})
        return sid

    def _victim_pays(self, sid: str, victim: str, dest: str, t: datetime, key: str, burst: int = 1) -> list[str]:
        """The victim's own unauthorised/deceived transfer(s). Amount is a share of what the victim holds."""
        keys = []
        t = self._daytime(t)
        share = self.rng.uniform(0.35, 0.95)
        for i in range(burst):
            k = f"{key}.{i}"
            self._leg(ts=t + timedelta(minutes=i * self.rng.uniform(2, 12)), origin=victim, dest=dest,
                      channel=self.rng.choice(["IMPS", "UPI", "UPI", "NEFT"]), frac_balance=share / (burst - i) if burst > 1 else share,
                      key=k, scenario_id=sid, tag="victim_transfer", suspicious=True, min_amount=3000)
            keys.append(k)
        return keys

    def _forward(self, sid: str, origin: str, dest: str, t: datetime, of_key: str, frac: float, key: str, tag: str = "forward",
                 channel: Optional[str] = None) -> None:
        self._leg(ts=t, origin=origin, dest=dest, channel=channel or self.rng.choice(["UPI", "UPI", "IMPS", "NEFT"]), of_key=of_key,
                  of_frac=frac, key=key, scenario_id=sid, tag=tag, suspicious=True, min_amount=500)

    def _cash_out(self, sid: str, acc: str, t: datetime, of_key: str) -> None:
        """Collection account withdraws in 1-3 pieces, sometimes spends part (add-ons 8 and 9)."""
        r = self.rng
        pieces = r.randint(1, 3)
        total = r.uniform(0.55, 0.9)
        for i in range(pieces):
            self._forward(sid, acc, r.choice(self.cash), self._daytime(t + timedelta(hours=r.uniform(0.3, 20))), of_key, total / pieces,
                          f"{of_key}.cash{i}", tag="cash_out", channel="ATM_CASH_OUT")
        self._addons(sid, acc, t, of_key)

    def _addons(self, sid: str, acc: str, t: datetime, of_key: str) -> None:
        r = self.rng
        if r.random() < 0.45:  # pattern 8: incidental merchant / landlord payment
            dest = r.choice(self.merchants + self.landlords)
            self._role(dest, "innocent_counterparty", sid, "received a purchase or rent payment from scam money")
            self._leg(ts=self._daytime(t + timedelta(hours=r.uniform(1, 30))), origin=acc, dest=dest, channel=r.choice(["UPI", "CARD_POS"]),
                      of_key=of_key, of_frac=r.uniform(0.02, 0.08), scenario_id=sid, tag="flow_incidental", min_amount=200)
        if r.random() < 0.3:  # pattern 9: an ordinary person is paid (e.g. sold a phone) and keeps the money
            dest = self._take_person()
            self._role(dest, "innocent_counterparty", sid, "sold something to the collection account")
            self._leg(ts=self._daytime(t + timedelta(hours=r.uniform(1, 30))), origin=acc, dest=dest, channel="UPI", of_key=of_key,
                      of_frac=r.uniform(0.05, 0.15), scenario_id=sid, tag="flow_incidental", min_amount=500)

    def _maybe_secondary(self, sid: str, mule: str, t: datetime, collector: str) -> bool:
        """Pattern 6 add-on: an intermediary whose own savings are drained after it forwards (secondary victim)."""
        if mule in self.people and self.rng.random() < 0.3:
            self._leg(ts=t + timedelta(minutes=self.rng.uniform(5, 120)), origin=mule, dest=collector, channel="IMPS",
                      frac_balance=self.rng.uniform(0.5, 0.9), scenario_id=sid, tag="secondary_victim_drain",
                      suspicious=True, min_amount=2000)
            return True
        return False

    # ------------------------------------------------------------------ patterns
    def _p_direct(self) -> None:
        sid = self._sid("direct", "standard")
        t = self._when()
        victim, attacker = self._take_person(30_000), self._fresh_account(t) if self.rng.random() < 0.5 else self._take_person()
        self._role(victim, "victim", sid, "app_scam")
        self._role(attacker, "attacker_controlled", sid)
        keys = self._victim_pays(sid, victim, attacker, t, f"{sid}.v", burst=self.rng.choice([1, 1, 2, 3]))
        for k in keys:
            self._cash_out(sid, attacker, t + timedelta(minutes=20), k)

    def _chain(self, pattern: str, hops: int, slow: bool = False) -> None:
        variant = "slow" if slow else "standard"
        sid = self._sid(pattern, variant)
        t = self._when()
        victim = self._take_person(30_000)
        self._role(victim, "victim", sid, "app_scam")
        mules = [self._mule(t) for _ in range(hops)]
        collector = self._fresh_account(t) if self.rng.random() < 0.5 else self._take_person()
        self._role(collector, "attacker_controlled", sid)
        key = self._victim_pays(sid, victim, mules[0], t, f"{sid}.v")[0]
        for i, m in enumerate(mules):
            nxt = mules[i + 1] if i + 1 < len(mules) else collector
            t = t + self._delay(slow)
            t = self._daytime(t) if slow else t
            k = f"{sid}.h{i}"
            self._forward(sid, m, nxt, t, key, self.rng.uniform(0.85, 0.99), k)
            secondary = self._maybe_secondary(sid, m, t, collector)
            self._role(m, "secondary_victim" if secondary else "intermediary", sid, f"hop {i + 1}")
            key = k
        self._cash_out(sid, collector, t, key)

    def _p_split(self) -> None:
        variant = self._variant("split")
        sid = self._sid("split", variant)
        t = self._when()
        victim = self._take_person(40_000)
        self._role(victim, "victim", sid, "app_scam")
        m1 = self._mule(t)
        self._role(m1, "intermediary", sid, "receives and splits")
        key = self._victim_pays(sid, victim, m1, t, f"{sid}.v")[0]
        k_branches = self.rng.randint(2, 5)
        shares = self.np.dirichlet(np.ones(k_branches)) * self.rng.uniform(0.85, 0.98)
        t1 = t + self._delay()
        for b in range(k_branches):
            mb = self._mule(t1)
            self._role(mb, "intermediary", sid, f"branch {b + 1}")
            if variant == "structured":  # held-out: many small transfers under 10,000
                n = self.rng.randint(3, 6)
                for j in range(n):
                    self._forward(sid, m1, mb, t1 + timedelta(minutes=b * 4 + j * self.rng.uniform(1, 6)), key,
                                  float(shares[b]) / n, f"{sid}.b{b}.{j}")
                bkey = f"{sid}.b{b}.0"
                frac = 0.9 * n
            else:
                self._forward(sid, m1, mb, t1 + timedelta(minutes=b * self.rng.uniform(1, 6)), key, float(shares[b]), f"{sid}.b{b}")
                bkey, frac = f"{sid}.b{b}", 0.9
            for p in range(self.rng.randint(1, 2)):
                self._forward(sid, mb, self.rng.choice(self.cash), t1 + self._delay(), bkey, min(frac, 0.95) / (p + 1) * 0.5,
                              f"{sid}.b{b}.cash{p}", tag="cash_out", channel="ATM_CASH_OUT")
        self._addons(sid, m1, t1, key)

    def _p_consolidation(self) -> None:
        sid = self._sid("consolidation", "standard")
        t = self._when()
        victims = [self._take_person(30_000) for _ in range(self.rng.randint(1, 3))]
        collector = self._fresh_account(t) if self.rng.random() < 0.5 else self._take_person()
        self._role(collector, "attacker_controlled", sid, "consolidates")
        last_key, tc = None, t
        for vi, victim in enumerate(victims):
            self._role(victim, "victim", sid, "app_scam")
            tv = t + timedelta(hours=vi * self.rng.uniform(1, 18))
            m1 = self._mule(tv)
            self._role(m1, "intermediary", sid, "first receiver")
            key = self._victim_pays(sid, victim, m1, tv, f"{sid}.v{vi}")[0]
            n = self.rng.randint(2, 4)
            for b in range(n):
                mb = self._mule(tv)
                self._role(mb, "intermediary", sid, "feeder")
                tb = self._daytime(tv + self._delay())
                self._forward(sid, m1, mb, tb, key, 0.95 / n, f"{sid}.v{vi}.b{b}")
                tc = max(tc, tb + self._delay())
                self._forward(sid, mb, collector, tb + self._delay(), f"{sid}.v{vi}.b{b}", self.rng.uniform(0.85, 0.98),
                              f"{sid}.v{vi}.c{b}")
                last_key = f"{sid}.v{vi}.c{b}"
        self._cash_out(sid, collector, tc + timedelta(hours=1), last_key)

    def _p_circular(self) -> None:
        sid = self._sid("circular", "standard")
        t = self._when()
        victim = self._take_person(30_000)
        self._role(victim, "victim", sid, "app_scam")
        loop = [self._mule(t) for _ in range(self.rng.randint(3, 4))]
        for m in loop:
            self._role(m, "intermediary", sid, "loop member")
        collector = self._take_person()
        self._role(collector, "attacker_controlled", sid)
        key = self._victim_pays(sid, victim, loop[0], t, f"{sid}.v")[0]
        for i in range(len(loop)):
            t = t + self._delay()
            k = f"{sid}.l{i}"
            self._forward(sid, loop[i], loop[(i + 1) % len(loop)], t, key, self.rng.uniform(0.85, 0.97), k)
            key = k
        t = t + self._delay()
        self._forward(sid, loop[0], collector, t, key, 0.95, f"{sid}.exit")
        self._cash_out(sid, collector, t, f"{sid}.exit")

    def _p_multi_victim(self) -> None:
        sid = self._sid("multi_victim", "standard")
        t = self._when()
        dest = self._mule(t)
        self._role(dest, "intermediary", sid, "common destination")
        collector = self._fresh_account(t)
        self._role(collector, "attacker_controlled", sid)
        keys = []
        for vi in range(self.rng.randint(2, 5)):
            victim = self._take_person(20_000)
            self._role(victim, "victim", sid, "app_scam")
            keys += self._victim_pays(sid, victim, dest, t + timedelta(hours=self.rng.uniform(0, 96)), f"{sid}.v{vi}")
        tlast = self._daytime(t + timedelta(hours=100))
        for i, k in enumerate(keys):
            self._forward(sid, dest, collector, tlast + timedelta(minutes=i * 7), k, self.rng.uniform(0.85, 0.97), f"{k}.fw")
        self._cash_out(sid, collector, tlast + timedelta(hours=1), f"{keys[0]}.fw")

    def _p_takeover(self) -> None:
        variant = self._variant("takeover")
        sid = self._sid("takeover", variant)
        victim = self._take_person(30_000)
        t = self._when()
        if variant == "after_dormancy":
            self.quiet[victim] = (t - timedelta(days=self.rng.uniform(45, 60)), t)
        self._role(victim, "victim", sid, "account_takeover")
        night = self.rng.random() < 0.3
        t = self._tod(t.replace(hour=0, minute=0, second=0), night=night)
        recipients = [self._mule(t) for _ in range(self.rng.randint(2, 4))]
        share = self.rng.uniform(0.6, 0.95)
        for i, m in enumerate(recipients):
            self._role(m, "intermediary", sid, "takeover recipient")
            k = f"{sid}.t{i}"
            self._leg(ts=t + timedelta(minutes=i * self.rng.uniform(1, 8)), origin=victim, dest=m, channel=self.rng.choice(["IMPS", "UPI"]),
                      frac_balance=share / (len(recipients) - i), key=k, scenario_id=sid, tag="takeover_transfer",
                      suspicious=True, min_amount=2000)
            self._forward(sid, m, self.rng.choice(self.cash), t + self._delay(), k, self.rng.uniform(0.8, 0.97), f"{k}.cash",
                          tag="cash_out", channel="ATM_CASH_OUT")

    def _p_lookalike(self) -> None:
        """Pattern 10 (legitimate): relatives pool money; the account pays a large bill within hours."""
        sid = self._sid("lookalike", "family_pool")
        t = self._when()
        hub = self._take_person()
        self._role(hub, "lookalike_legitimate", sid, "pooled family money for a bill")
        keys = []
        for i in range(self.rng.randint(3, 6)):
            rel = self.rng.choice(self.contacts[hub])
            k = f"{sid}.r{i}"
            self._leg(ts=t + timedelta(hours=self.rng.uniform(0, 30)), origin=rel, dest=hub, channel="UPI",
                      amount=self._amount(15_000, 0.5), key=k, scenario_id=sid, tag="family_pool")
            keys.append(k)
        bill = self.rng.choice(self.merchants)
        self._leg(ts=t + timedelta(hours=self.rng.uniform(31, 40)), origin=hub, dest=bill, channel="NEFT",
                  frac_balance=self.rng.uniform(0.7, 0.95), scenario_id=sid, tag="large_bill", min_amount=5000)

    def _plan_scenarios(self) -> None:
        n = self.c.instances
        for _ in range(n["direct"]):
            self._p_direct()
        for _ in range(n["chain"]):
            self._chain("chain", 1)
        for _ in range(n["multi_hop"]):
            v = self._variant("multi_hop")
            self._chain("multi_hop", self.rng.randint(2, 3), slow=v == "slow")
        for _ in range(n["split"]):
            self._p_split()
        for _ in range(n["consolidation"]):
            self._p_consolidation()
        for _ in range(n["circular"]):
            self._p_circular()
        for _ in range(n["multi_victim"]):
            self._p_multi_victim()
        for _ in range(n["takeover"]):
            self._p_takeover()
        for _ in range(n["lookalike"]):
            self._p_lookalike()

    # ------------------------------------------------------------------ apply
    def _apply(self) -> pd.DataFrame:
        bal = {a: v["initial_balance"] for a, v in self.accounts.items()}
        realised: dict[str, float] = {}
        rows = []
        end = self.start + timedelta(days=self.c.days)
        for leg in sorted(self.legs, key=lambda l: (l.ts, l.order)):
            if leg.ts >= end or leg.ts < self.accounts[leg.origin]["account_opened_at"]:
                continue
            if leg.ts < self.accounts[leg.dest]["account_opened_at"] or leg.origin == leg.dest:
                continue
            if leg.scenario_id is None or not leg.suspicious:
                q = self.quiet.get(leg.origin) or self.quiet.get(leg.dest)
                if q and q[0] <= leg.ts < q[1] and leg.tag not in ("flow_incidental",):
                    continue
            b = bal[leg.origin]
            if leg.of_key is not None:
                if leg.of_key not in realised:
                    if leg.scenario_id:
                        self.skipped_legs += 1
                    continue
                amt = realised[leg.of_key] * leg.of_frac
                amt = min(amt, b * 0.995)  # ordinary spending since receipt may have left less
            elif leg.frac_balance is not None:
                amt = b * leg.frac_balance
            else:
                amt = leg.amount or 0.0
            if leg.channel == "ATM_CASH_OUT":
                amt = np.floor(amt / 100) * 100  # ATMs dispense round amounts, for everyone
            elif leg.scenario_id and amt > 2000 and self.rng.random() < 0.4:
                amt = np.floor(amt / 500) * 500  # forwarded amounts are often rounded, like ordinary ones
            amt = round(float(amt), 2)
            if amt < leg.min_amount or amt > b:
                if leg.scenario_id:
                    self.skipped_legs += 1
                continue
            if leg.key:
                realised[leg.key] = amt
            db = bal[leg.dest]
            bal[leg.origin], bal[leg.dest] = round(b - amt, 2), round(db + amt, 2)
            rows.append((leg.ts, leg.origin, leg.dest, amt, leg.channel, round(b, 2), round(b - amt, 2), round(db, 2),
                         round(db + amt, 2), leg.scenario_id, leg.tag, leg.suspicious))
        tx = pd.DataFrame(rows, columns=["timestamp", "origin_account_id", "destination_account_id", "amount", "channel",
                                         "origin_balance_before", "origin_balance_after", "dest_balance_before",
                                         "dest_balance_after", "scenario_id", "scenario_tag", "is_suspicious_scenario"])
        tx.insert(0, "transaction_id", [f"TX-{self.c.seed:03d}-{i:07d}" for i in range(1, len(tx) + 1)])
        tx["currency"], tx["status"] = "INR", "COMPLETED"
        for a, v in self.accounts.items():
            v["current_balance"] = bal[a]
        return tx

    def generate(self) -> "ForensicLedger":
        self._build_population()
        self._plan_scenarios()  # before ordinary activity so scenario accounts are drawn first
        for acc in self.people:
            self._ordinary_activity(acc)
        self._merchant_activity()
        tx = self._apply()
        acc = pd.DataFrame([{k: v for k, v in a.items() if not k.startswith("_")} for a in self.accounts.values()])
        roles = pd.DataFrame(self.roles, columns=["account_id", "scenario_id", "role", "role_detail"])
        scen = pd.DataFrame(self.scenarios)
        # Roles whose defining scenario transfers never happened (unfundable legs) are kept but marked. A role counts
        # as materialised only when the transfers that define it exist in the ledger for that same scenario: an
        # intermediary must have both received and sent scenario money (one that only received it behaved as a plain
        # recipient), a victim or secondary victim must have sent it, a collector or innocent counterparty must have
        # received it. Other roles need any transfer of their scenario.
        # A secondary victim additionally needs its own drain transfer: without it the account only forwarded, i.e.
        # behaved as an intermediary, and calling it a victim in the ground truth would be wrong.
        st = tx[tx.scenario_id.notna()]
        sent = set(zip(st.origin_account_id, st.scenario_id))
        recv = set(zip(st.destination_account_id, st.scenario_id))
        drained = set(zip(st.loc[st.scenario_tag == "secondary_victim_drain", "origin_account_id"],
                          st.loc[st.scenario_tag == "secondary_victim_drain", "scenario_id"]))
        needs = {"intermediary": (True, True), "victim": (True, False), "secondary_victim": (True, False),
                 "attacker_controlled": (False, True), "innocent_counterparty": (False, True)}

        def materialised(row) -> bool:
            key = (row.account_id, row.scenario_id)
            if row.role == "secondary_victim" and key not in drained:
                return False
            must_send, must_recv = needs.get(row.role, (False, False))
            if must_send or must_recv:
                return (not must_send or key in sent) and (not must_recv or key in recv)
            return key in sent or key in recv

        roles["materialised"] = [materialised(r) for r in roles.itertuples(index=False)] if len(roles) else []
        return ForensicLedger(self.c, acc, tx, roles, scen, self.skipped_legs)


@dataclass
class ForensicLedger:
    config: ForensicLedgerConfig
    accounts: pd.DataFrame
    transactions: pd.DataFrame
    roles: pd.DataFrame
    scenarios: pd.DataFrame
    skipped_legs: int

    def write(self, out_dir: str) -> dict[str, str]:
        """CSV in the V2 ingestion format plus the roles/scenarios ground-truth tables."""
        from pathlib import Path

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        acc = self.accounts.copy()
        acc["account_opened_at"] = acc["account_opened_at"].map(lambda d: d.isoformat())
        tx = self.transactions.copy()
        tx["timestamp"] = tx["timestamp"].map(lambda d: d.isoformat())
        paths = {"accounts": out / "accounts.csv", "transactions": out / "transactions.csv",
                 "roles": out / "roles.csv", "scenarios": out / "scenarios.csv"}
        acc.to_csv(paths["accounts"], index=False)
        tx.to_csv(paths["transactions"], index=False)
        self.roles.to_csv(paths["roles"], index=False)
        self.scenarios.to_csv(paths["scenarios"], index=False)
        return {k: str(v) for k, v in paths.items()}


# Fixed ledgers used by the pipeline. Seeds differ, so IDs and instances differ; B and C contain held-out variants.
LEDGERS: dict[str, ForensicLedgerConfig] = {
    "train": ForensicLedgerConfig(seed=101),
    "cold": ForensicLedgerConfig(seed=202, num_people=6000, num_merchants=450, num_employers=40, include_held_out=True,
                                 instances={"direct": 30, "chain": 30, "multi_hop": 35, "split": 30, "consolidation": 18,
                                            "circular": 14, "multi_victim": 18, "takeover": 35, "lookalike": 40}),
    "demo": ForensicLedgerConfig(seed=303, num_people=2400, num_merchants=180, num_employers=20, days=90, include_held_out=True,
                                 instances={"direct": 8, "chain": 8, "multi_hop": 8, "split": 7, "consolidation": 5,
                                            "circular": 4, "multi_victim": 5, "takeover": 8, "lookalike": 10}),
}


# Untouched evaluation ledger (seed 404). It was added after the role rules, thresholds and models were frozen and is
# read only by ml/forensics/holdout_evaluation.py, which refuses to re-run it once a result exists for a different code
# manifest: nothing may be tuned against it. A different seed than every other ledger, so its accounts and scenario
# instances are new; it includes the held-out variants.
LEDGERS["holdout"] = ForensicLedgerConfig(
    seed=404, num_people=2400, num_merchants=180, num_employers=20, days=90, include_held_out=True,
    instances={"direct": 8, "chain": 12, "multi_hop": 10, "split": 7, "consolidation": 6,
               "circular": 4, "multi_victim": 8, "takeover": 8, "lookalike": 10})


# Second untouched evaluation ledger (seed 505), added on 2026-11-02 for the QA remediation. Seed 404 was evaluated
# under the earlier code (ml/reports/holdout_evaluation.json) and is no longer untouched for the changed role rules, so
# it is not re-run. The QA-03 rule changes were designed on the train ledger only; this ledger is evaluated once, after
# those changes were frozen, by ml/forensics/holdout_evaluation.py --ledger holdout_2026_11. Same size and mix as 404.
LEDGERS["holdout_2026_11"] = ForensicLedgerConfig(
    seed=505, num_people=2400, num_merchants=180, num_employers=20, days=90, include_held_out=True,
    instances={"direct": 8, "chain": 12, "multi_hop": 10, "split": 7, "consolidation": 6,
               "circular": 4, "multi_victim": 8, "takeover": 8, "lookalike": 10})


def generate_ledger(name: str) -> ForensicLedger:
    return ForensicScenarioGenerator(LEDGERS[name]).generate()


if __name__ == "__main__":  # pragma: no cover
    import sys
    import time

    for name in sys.argv[1:] or ["demo"]:
        t0 = time.perf_counter()
        L = generate_ledger(name)
        print(name, len(L.accounts), "accounts", len(L.transactions), "transactions",
              int(L.transactions.is_suspicious_scenario.sum()), "suspicious", "skipped legs", L.skipped_legs,
              f"{time.perf_counter() - t0:.1f}s")
        print(L.roles.groupby("role").materialised.agg(["count", "sum"]))
