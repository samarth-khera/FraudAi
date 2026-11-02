"""Account-role assessment and restriction-review recommendation: transparent rules over collected evidence.

The rules take one ``AccountEvidence`` record and return a role candidate, the evidence for and against it, and an
advisory restriction state. They never read ground truth, never act on an account, and never assign a role because an
account received money: every non-ordinary role needs evidence from the account's own behaviour or position.

Evidence categories (independent sources of support, counted for "evidence strength"):
  ONWARD     the traced money itself moved on: a material traced receipt (>= MATERIAL_RECEIPT), non-cash transfers
             within 24 h of at least 70% of it (capped at what was received, so the account's own money paid out does
             not count), AND the balance-based (lowest-intermediate-balance) attribution shows at least 70% of the
             traced amount left the account
  ACCOUNT_MODEL  account behaviour model at or above its validated threshold
  TXN_MODEL  one of its own traced outgoing transfers scored at or above the transaction model's threshold
  NETWORK    on a payment loop of traced transfers AND it sent traced money itself, so the loop runs through its own
             outgoing side (money it paid on came back to it)
  RECEIPT_PATTERN  what it RECEIVED: paid by >= 2 different traced senders, paid (within the window around the traced
             receipt) by >= 2 senders who each sent it at least 10,000 and half of their balance, or on a loop only as a
             receiver. Context only: receiving money is never evidence of a role, so it never counts toward evidence
             strength or the restriction-review threshold. It still defines the receipt side of the collector pattern,
             which separately needs outgoing-side evidence (see assess)
  CASH       a material traced receipt of which >= 50% was withdrawn as cash (capped at what was received) and the
             balance-based attribution shows >= 50% of the traced money left the account
  FUNDED_FORWARD  (investigated account only) most of its flagged outgoing transfers were paid out of money it had just
             received from new payers, which its own earlier balance could not have covered
  FLAGGED_IN_MOVED  (investigated account only) it received flagged transfers and the balance-based attribution shows
             at least 70% of that money left within 24 h
  NEW_RECORDS  fewer than 30 days of records when first reached, counted only when its records start well after the
             dataset's own first record (otherwise the dataset, not the account, is new). Context only: it never counts
             toward a role or a restriction threshold.
Context-only categories (NEW_RECORDS, RECEIPT_PATTERN) are listed with their sentence but excluded from
``independent_kinds``.
ONWARD, CASH, FUNDED_FORWARD and FLAGGED_IN_MOVED all describe money leaving the account, so they count as ONE
independent kind of evidence (``independent_kinds``): one withdrawal can never count twice. Evidence strength and the
restriction threshold use the same count.
Victim-side evidence: OWN_FUNDS (its own pre-existing balance fell by >= 50% in the window) on an established account
(>= 30 days and >= 10 transfers of records). Thresholds and their basis are listed in docs/DYNAMIC_INTELLIGENCE.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

INTERMEDIARY_SHARE = 0.7
ONWARD_HOURS = 24.0
CASH_SHARE = 0.5
OWN_FUNDS_SHARE = 0.5
OWN_FUNDS_MIN = 2_000.0
NEW_RECORDS_DAYS = 30.0
ESTABLISHED_DAYS, ESTABLISHED_TXNS = 30.0, 10
KEPT_SHARE = 0.3
MIN_TXNS = 5
STILL_HELD_SHARE = 0.2
# A traced receipt below this is too small for "passed the traced money on" or "withdrew it as cash" to mean anything:
# the account's own routine payments dwarf it (a shop that received 651 and then withdrew 10,000 of its own takings).
# Set on the train ledger only: below the 5th percentile of scenario intermediaries' traced receipts (2,517) and at the
# median of innocent counterparties' (2,000). It applies to ONWARD, CASH, the secondary-victim rule and FLAGGED_IN_MOVED.
MATERIAL_RECEIPT = 2_000.0
# Evidence categories that all describe money leaving the account: counted as one independent kind.
MOVED_OUT = frozenset({"ONWARD", "CASH", "FUNDED_FORWARD", "FLAGGED_IN_MOVED"})
# Shown with their sentence, never counted as a kind of evidence (strength, roles' support counts, restriction review).
CONTEXT_ONLY = frozenset({"NEW_RECORDS", "RECEIPT_PATTERN"})
INTERMEDIARY_ROLES = ("potential_intermediary", "potentially_suspicious_account")
VICTIM_ROLES = ("potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed")
# Which way each evidence category points: towards passing money on or collecting it (suspicion side). Victim-side
# evidence is the victim rules' own sentences (its own money left in transfers unlike its history, its savings fell).
SUSPICION_SIDE = frozenset({"ONWARD", "CASH", "NETWORK", "FUNDED_FORWARD", "FLAGGED_IN_MOVED", "ACCOUNT_MODEL", "TXN_MODEL"})
MODEL_CATEGORIES = frozenset({"ACCOUNT_MODEL", "TXN_MODEL"})
COUNTER_PREFIX = "Points the other way"
# An established history counts against a pass-through reading (new accounts are typical collection points), not against
# a victim reading: the victim rules require it, because only an established history makes a deviation meaningful.
ESTABLISHED_PREFIX = "Established records"

ROLE_LABELS = {
    "potential_victim": "Potential victim",
    "suspicious_activity_victim_unconfirmed": "Suspicious activity, victim status unconfirmed",
    "potential_secondary_victim": "Potential secondary victim",
    "potential_intermediary": "Potential intermediary",
    "potentially_suspicious_account": "Potentially suspicious account",
    "no_suspicious_linkage_observed": "No suspicious linkage observed",
    "no_suspicious_activity_observed": "No suspicious activity observed",
    "unknown_role": "Role unknown",
    "cash_withdrawal_point": "Cash withdrawal point (not a person's account)",
}
GROUP_OF_ROLE = {
    "potential_victim": "potential_victims", "suspicious_activity_victim_unconfirmed": "potential_victims",
    "potential_secondary_victim": "potential_secondary_victims", "potential_intermediary": "potential_intermediaries",
    "potentially_suspicious_account": "suspicious_accounts", "no_suspicious_linkage_observed": "ordinary_counterparties",
    "no_suspicious_activity_observed": "ordinary_counterparties", "unknown_role": "unknown_roles",
    "cash_withdrawal_point": "cash_withdrawal_points",
}
RESTRICTION_LABELS = {
    "no_restriction_recommendation": "No restriction recommendation from current evidence",
    "additional_verification_recommended": "Additional verification recommended",
    "urgent_manual_review_recommended": "Urgent manual review recommended",
    "consider_temporary_restriction_review": "Consider temporary restriction through the authorised financial institution, "
                                             "subject to human review and applicable policy",
    "insufficient_evidence_to_recommend": "Insufficient evidence to recommend restriction",
}


@dataclass
class AccountEvidence:
    account_id: str
    position: str                      # investigated | downstream | upstream | other_sender
    hop: Optional[int]
    n_transactions: int
    history_days: float                # records before it was first reached (or overall for the investigated account)
    analyzed: bool = True
    introduced_by: Optional[str] = None
    received_traced: float = 0.0
    receipt_ids: list[str] = field(default_factory=list)
    sent_traced: float = 0.0
    onward_ids: list[str] = field(default_factory=list)
    forwarded_min: Optional[float] = None
    forwarded_max: Optional[float] = None
    onward_delay_minutes: Optional[float] = None
    onward_within_24h: float = 0.0     # traced onward transfers made within 24 h of the receipt they follow
    onward_cash_within_24h: float = 0.0  # ...of which cash withdrawals (never also counted as ONWARD)
    onward_destinations: int = 0
    traced_paths_in: int = 0           # distinct accounts that paid it traced money (repeat payments by one sender = 1)
    in_cycle: bool = False
    balance_before_receipt: Optional[float] = None
    lowest_balance_in_window: Optional[float] = None
    latest_balance: Optional[float] = None
    cash_out_traced: float = 0.0
    flagged_out_ids: list[str] = field(default_factory=list)          # its own outgoing transfers flagged (model or rule)
    flagged_out_unfunded_ids: list[str] = field(default_factory=list)  # ...paid by its own money (not funded by a fresh inflow)
    # ...funded by a fresh inflow although its own earlier balance could have paid them: that balance was not drawn on
    flagged_out_matched_ids: list[str] = field(default_factory=list)
    flagged_in_senders: int = 0                                       # distinct senders of its flagged incoming transfers
    flagged_in_amount: float = 0.0                                    # total of those flagged incoming transfers
    flagged_in_moved_min: Optional[float] = None  # balance-based lower bound on how much of them left within 24 h
    flagged_in_cash: float = 0.0                  # cash it withdrew in that time
    deviation: list[str] = field(default_factory=list)               # how flagged transfers differ from its own history
    model_flagged_onward_ids: list[str] = field(default_factory=list)
    account_model: dict = field(default_factory=dict)                 # status, above_threshold, calibrated_probability
    graph: dict = field(default_factory=dict)
    business_account: bool = False
    cash_endpoint: bool = False        # reached only through cash-withdrawal transfers (an ATM/cash network in the ledger)
    drained_senders_near: int = 0      # senders paying it >= 10,000 and >= 50% of their balance near the traced receipt
    records_start_with_dataset: bool = False  # its first record is within a week of the dataset's first record
    in_flagged_flow: bool = True       # reached through a trace seed that was flagged (rules, or a validated model)
    uncorroborated_rule_flag_ids: list[str] = field(default_factory=list)  # rule flags the validated model does not support
    paid_account_id: Optional[str] = None    # other senders only: the traced account they paid...
    paid_account_role: Optional[str] = None  # ...and the role candidate that account was given
    paid_account_paid_by_investigated: bool = False  # ...and whether the investigated account paid it in a flagged transfer
    # Other senders only (QA-03): money it received in the ONWARD_HOURS before its own flagged transfer, as a share of
    # that transfer, and the transfer as a share of its balance just before it. None when a balance is missing.
    recent_inflow_share: Optional[float] = None
    balance_share: Optional[float] = None


@dataclass
class RoleResult:
    role_candidate: str
    assessment_status: str             # assessed | insufficient_evidence | not_analyzed
    headline: str
    supporting: list[str]
    contradictory: list[str]
    categories: list[str]
    evidence_strength: str             # none | weak | moderate | strong
    uncertainty_reason: Optional[str]
    next_check: str
    may_be_victim: bool = False
    category_text: dict = field(default_factory=dict)  # category code -> the sentence that supports it


def _m(x: Optional[float]) -> str:
    return "unknown" if x is None else f"{x:,.0f}"


def duration(minutes: float) -> str:
    """Plain-language elapsed time: minutes below 2 h, hours below 2 days, then days."""
    if minutes < 120:
        return f"{minutes:,.0f} min"
    if minutes < 2880:
        return f"{minutes / 60:,.0f} h"
    return f"{minutes / 1440:,.1f} days"


def noncash_onward(e: AccountEvidence) -> float:
    """Non-cash traced onward transfers within 24 h, capped at what was received (its own money paid out does not count)."""
    return min(max(0.0, e.onward_within_24h - e.onward_cash_within_24h), e.received_traced)


def material_receipt(e: AccountEvidence) -> bool:
    return e.received_traced >= MATERIAL_RECEIPT


def prompt_onward(e: AccountEvidence) -> bool:
    """Timing only: a material receipt and non-cash transfers of >= 70% of it within 24 h. Does NOT show that the traced
    money itself moved on (its own balance may have paid them), so on its own it is never an evidence category."""
    return material_receipt(e) and noncash_onward(e) >= INTERMEDIARY_SHARE * e.received_traced


def prompt_cash_out(e: AccountEvidence) -> bool:
    """Timing only, as prompt_onward: a material receipt and cash withdrawals of >= 50% of it within 24 h (capped at
    what was received). Not an evidence category on its own."""
    return material_receipt(e) and min(e.onward_cash_within_24h, e.received_traced) >= CASH_SHARE * e.received_traced


def traced_money_left(e: AccountEvidence, share: float) -> bool:
    """The balance-based attribution (lowest intermediate balance) shows >= share of the traced receipt left the account.
    Unknown attribution is not evidence."""
    return e.received_traced > 0 and e.forwarded_min is not None and e.forwarded_min >= share * e.received_traced


def kept_most(e: AccountEvidence) -> bool:
    return e.received_traced > 0 and e.forwarded_max is not None and e.forwarded_max < KEPT_SHARE * e.received_traced


def loop_through_own_outgoing(e: AccountEvidence) -> bool:
    """On a payment loop AND it sent traced money itself: the loop involves its own outgoing side. Being on a loop only
    as a receiver describes what it received, like several payers."""
    return e.in_cycle and e.sent_traced > 0


def independent_kinds(cats: list[str]) -> set[str]:
    """Independent kinds of evidence: money-leaving categories count once, context-only categories not at all. Used for
    both evidence strength and the restriction threshold, so the two always agree."""
    return {("MOVED_OUT" if c in MOVED_OUT else c) for c in cats if c not in CONTEXT_ONLY}


def strength_of(cats: list[str]) -> str:
    return _strength(len(independent_kinds(cats)))


def funds_may_still_be_held(e: AccountEvidence) -> Optional[bool]:
    """Whether traced money may still be in the account. Compared with what was forwarded and with the balance before the
    receipt (a large ordinary balance is not traced money). None (unknown) when neither comparison can be made."""
    if e.received_traced <= 0:
        return None
    checks = []
    if e.forwarded_max is not None:  # at most forwarded_max left in the window, so at least the rest was still there
        checks.append(e.received_traced - e.forwarded_max >= STILL_HELD_SHARE * e.received_traced)
    if e.latest_balance is not None and e.balance_before_receipt is not None:
        checks.append(e.latest_balance - e.balance_before_receipt >= STILL_HELD_SHARE * e.received_traced)
    return all(checks) if checks else None


def categories(e: AccountEvidence) -> tuple[list[str], list[str]]:
    """(category codes, sentences) supporting suspicion, each from an independent source."""
    cats, txt = [], []
    if prompt_onward(e) and traced_money_left(e, INTERMEDIARY_SHARE):
        cats.append("ONWARD")
        delay = f"; the first went {duration(e.onward_delay_minutes)} after receipt" if e.onward_delay_minutes is not None else ""
        txt.append(f"Sent {_m(noncash_onward(e))} of the {_m(e.received_traced)} it received in traced transfers onward within 24 h"
                   f"{delay}. Balance-based attribution: between {_m(e.forwarded_min)} and {_m(e.forwarded_max)} of the traced "
                   "money itself moved on.")
    if e.account_model.get("status") == "scored" and e.account_model.get("above_threshold"):
        cats.append("ACCOUNT_MODEL")
        txt.append("The account behaviour model scores its history at or above the validated review threshold.")
    if e.model_flagged_onward_ids:
        cats.append("TXN_MODEL")
        txt.append(f"The transaction model flags {len(e.model_flagged_onward_ids)} of its traced outgoing transfer(s) "
                   f"({', '.join(e.model_flagged_onward_ids[:3])}).")
    if loop_through_own_outgoing(e):
        cats.append("NETWORK")
        txt.append("Network position: money it sent on returned to it around a loop of payments.")
    recv = []
    if e.in_cycle and not loop_through_own_outgoing(e):
        recv.append("it is on a loop of payments, but only as a receiver")
    if e.traced_paths_in >= 2:
        recv.append(f"{e.traced_paths_in} different accounts paid it traced money")
    if e.drained_senders_near >= 2:
        recv.append(f"{e.drained_senders_near} senders each paid it at least 10,000 and half of their balance around that time")
    if recv:
        cats.append("RECEIPT_PATTERN")
        txt.append("What it received (context only: receiving money is not evidence of a role, and this is not counted in "
                   "the evidence strength or toward a restriction review): " + "; ".join(recv) + ".")
    if material_receipt(e) and min(e.cash_out_traced, e.received_traced) >= CASH_SHARE * e.received_traced \
            and traced_money_left(e, CASH_SHARE):
        cats.append("CASH")
        txt.append(f"Withdrew {_m(e.cash_out_traced)} as cash after receiving {_m(e.received_traced)} in traced transfers "
                   f"(balance-based: at least {_m(e.forwarded_min)} of the traced money left); cash cannot be followed in the ledger.")
    if e.position != "investigated" and e.history_days < NEW_RECORDS_DAYS and e.n_transactions > 0 and not e.records_start_with_dataset:
        cats.append("NEW_RECORDS")
        txt.append(f"Its records start only {e.history_days:.0f} day(s) before it was reached.")
    return cats, txt


def _strength(n: int) -> str:
    return "none" if n == 0 else "weak" if n == 1 else "moderate" if n == 2 else "strong"


def _own_funds(e: AccountEvidence) -> Optional[float]:
    if e.balance_before_receipt is None or e.lowest_balance_in_window is None:
        return None
    return max(0.0, e.balance_before_receipt - e.lowest_balance_in_window)


def _established(e: AccountEvidence) -> bool:
    # When the dataset itself is younger than 30 days at that point, "established" falls back to the number of records.
    return e.n_transactions >= ESTABLISHED_TXNS and (e.history_days >= ESTABLISHED_DAYS or e.records_start_with_dataset)


def savings_left(e: AccountEvidence) -> bool:
    """Its own pre-existing savings (>= OWN_FUNDS_MIN) fell by half or more in the window, on an established personal
    account, after a material traced receipt. Never for a business account, whose routine payouts lower its balance
    whatever it receives."""
    own = _own_funds(e)
    return own is not None and bool(e.balance_before_receipt) and e.balance_before_receipt >= OWN_FUNDS_MIN \
        and own >= OWN_FUNDS_SHARE * e.balance_before_receipt and _established(e) and not e.business_account \
        and material_receipt(e)


def own_funds_also_left(e: AccountEvidence, r: "RoleResult") -> Optional[float]:
    """Protective check for pass-through candidates: the account's OWN money (its balance before the traced receipt) fell
    by at least OWN_FUNDS_MIN during the window while it made transfers the transaction model flags. A pass-through that
    also loses its own savings may itself be exploited (the 'secondary victim' pattern), so it must not be pushed towards
    restriction. Returns the amount of own funds that left, or None. It can only soften a recommendation, never accuse,
    and it reuses existing constants (no new threshold). Personal accounts only: business payouts lower balances anyway."""
    own = _own_funds(e)
    if own is None or own < OWN_FUNDS_MIN or e.business_account or "TXN_MODEL" not in r.categories:
        return None
    return own


def assess(e: AccountEvidence) -> RoleResult:
    cats, sup = categories(e)
    r = _assess(e, cats, list(sup))
    base = dict(zip(cats, sup))
    # The sentence behind each category the result counts (rule-specific categories bring their own).
    r.category_text = {c: r.category_text.get(c) or base[c] for c in r.categories if c in r.category_text or c in base}
    add_counter_evidence(e, r, base)
    return r


def victim_side_observations(e: AccountEvidence) -> list[str]:
    """Recorded facts that point towards the account being a victim, whatever role it was given."""
    out = []
    if e.flagged_out_unfunded_ids and e.position != "other_sender":
        out.append(f"{len(e.flagged_out_unfunded_ids)} of its flagged outgoing transfer(s) were paid with its own money: no "
                   "money it had just received from a new payer covered them.")
    own = _own_funds(e)
    if own is not None and own >= OWN_FUNDS_MIN and e.balance_before_receipt and not e.business_account:
        out.append(f"Its own balance before the traced receipt ({_m(e.balance_before_receipt)}) fell by at least {_m(own)} "
                   "within the window.")
    return out


def add_counter_evidence(e: AccountEvidence, r: RoleResult, base: dict[str, str]) -> None:
    """Evidence pointing away from the assigned role is listed with the contradictory evidence, never dropped: the
    suspicion-side signals of a possible victim, and the victim-side observations of an intermediary or
    suspicious-account candidate. Display only: no role, strength or restriction state reads it."""
    if r.role_candidate in VICTIM_ROLES:
        r.contradictory[:] = [c for c in r.contradictory if not c.startswith(ESTABLISHED_PREFIX)]
        for c in r.categories:
            if c in SUSPICION_SIDE and c in base:
                kind = "model output" if c in MODEL_CATEGORIES else "recorded fact"
                r.contradictory.append(f"{COUNTER_PREFIX} ({kind}): {base[c]}")
    elif r.role_candidate in INTERMEDIARY_ROLES:
        r.contradictory.extend(f"{COUNTER_PREFIX} (recorded fact): {s}" for s in victim_side_observations(e))


def _flagged_in_moved(e: AccountEvidence) -> Optional[str]:
    """Investigated account: the flagged money it received demonstrably left again (balance-based), or None."""
    if e.flagged_in_amount >= MATERIAL_RECEIPT and e.flagged_in_moved_min is not None \
            and e.flagged_in_moved_min >= INTERMEDIARY_SHARE * e.flagged_in_amount:
        return (f"Received {_m(e.flagged_in_amount)} in flagged transfers from {e.flagged_in_senders} sender(s); balance-based "
                f"attribution shows at least {_m(e.flagged_in_moved_min)} of that money left the account within 24 h.")
    return None


def _assess(e: AccountEvidence, cats: list[str], sup: list[str]) -> RoleResult:
    con: list[str] = []
    established = _established(e)
    if established:
        con.append(f"{ESTABLISHED_PREFIX}: {e.n_transactions} transfers over {e.history_days:.0f} days before it was reached.")
    if e.business_account:
        con.append("It is a business account; businesses routinely receive and pay out funds.")
    if e.account_model.get("status") == "scored" and not e.account_model.get("above_threshold"):
        con.append("The account behaviour model scores it below its review threshold (which does not clear it).")
    if kept_most(e):
        con.append(f"Kept most of what it received: at most {_m(e.forwarded_max)} of {_m(e.received_traced)} left in the window.")

    if e.cash_endpoint:
        return RoleResult("cash_withdrawal_point", "assessed",
                          "The ledger records cash withdrawals here; it stands for an ATM or cash network, not a person.",
                          [], [], [], "none", "Cash leaves the ledger here and cannot be followed.",
                          "Request ATM or cash-terminal records (location, time, camera footage) from the institution.")
    if not e.analyzed:
        return RoleResult("unknown_role", "not_analyzed", "Not individually analysed in this run (account limit).", sup, con, cats,
                          strength_of(cats), "Outside the number of accounts analysed per investigation.",
                          "Run a separate investigation on this account if its link to the flow matters.")

    # ------------------------------------------------------------------ investigated account
    if e.position == "investigated":
        if e.n_transactions < MIN_TXNS:
            return RoleResult("unknown_role", "insufficient_evidence", f"Only {e.n_transactions} transfer(s) on record.", sup, con,
                              cats, strength_of(cats), f"Fewer than {MIN_TXNS} transfers: too little history to compare against.",
                              "Obtain longer account history or the customer's own account of the transfers.")
        # Victim checks come first: flagged transfers paid out of its own money, unlike its own history, point to a
        # victim whatever else arrived in the account.
        if e.flagged_out_ids and len(e.flagged_out_unfunded_ids) >= len(e.flagged_out_ids) / 2:
            vsup = [f"Sent {len(e.flagged_out_unfunded_ids)} flagged transfer(s) that were not funded by money it had just received."]
            vsup += e.deviation
            if established and e.deviation:
                return RoleResult("potential_victim", "assessed",
                                  "Money left this account in transfers that differ from its own history.", vsup,
                                  ["The ledger records a payment, not whether the holder authorised it or was deceived."], cats,
                                  _strength(len(e.deviation)), None,
                                  "Contact the holder through a verified channel to confirm whether they authorised these transfers.",
                                  may_be_victim=True)
            return RoleResult("suspicious_activity_victim_unconfirmed", "assessed",
                              "Flagged transfers left this account, but its history is too short or too ordinary to call it a victim.",
                              vsup, con, cats, _strength(len(e.deviation)),
                              "Victim status needs the holder's account of the transfers.",
                              "Ask the holder whether they made and authorised the flagged transfers.", may_be_victim=True)
        moved_in = _flagged_in_moved(e)
        # Collecting flagged payments: the money must demonstrably have left again, AND its own outgoing side must carry
        # a signal (a flagged outgoing transfer, or cash withdrawn of >= half of it). Pooling family money and paying a
        # hospital bill moves money on too, in an ordinary unflagged payment.
        out_signal = bool(e.flagged_out_ids) or e.flagged_in_cash >= CASH_SHARE * e.flagged_in_amount > 0
        if e.flagged_in_senders >= 2 and moved_in and out_signal and "ACCOUNT_MODEL" in cats:
            c2 = cats + ["FLAGGED_IN_MOVED"]
            r = RoleResult("potentially_suspicious_account", "assessed",
                           f"Received flagged transfers from {e.flagged_in_senders} different senders and moved most of that money "
                           "on within 24 h.", sup + [moved_in], con, c2, strength_of(c2),
                           "The ledger cannot show who controls the account or why the money was collected.",
                           "Review the account's KYC, opening records and the purpose of the flagged inflows.")
            r.category_text = {"FLAGGED_IN_MOVED": moved_in}
            return r
        in_note = ([f"Received flagged transfers from {e.flagged_in_senders} different senders (receiving money is not, on its "
                    "own, evidence of a role)."] if e.flagged_in_senders >= 2 else [])
        if e.flagged_out_ids:
            unf = set(e.flagged_out_unfunded_ids)
            funded = [t for t in e.flagged_out_ids if t not in unf]
            matched = [t for t in funded if t in set(e.flagged_out_matched_ids)]
            strict = [t for t in funded if t not in set(matched)]
            if not matched:
                ff = (f"{len(funded)} of its {len(e.flagged_out_ids)} flagged outgoing transfer(s) ({', '.join(funded[:3])}) were paid "
                      "out of money received in the previous 24 h from payers that had not paid it before, which its own earlier "
                      "balance could not have covered.")
            else:
                parts = [f"{len(strict)} ({', '.join(strict[:3])}) were paid out of money received in the previous 24 h from payers "
                         "that had not paid it before, which its own earlier balance could not have covered"] if strict else []
                parts.append(f"{len(matched)} ({', '.join(matched[:3])}) were covered by money received in the previous 24 h from "
                             "payers that had not paid it before, and its own earlier balance was not drawn down to pay them: the "
                             "money that left was the money that had just arrived")
                ff = f"Of its {len(e.flagged_out_ids)} flagged outgoing transfer(s), " + "; ".join(parts) + "."
            c2 = cats + ["FUNDED_FORWARD"]
            if len(independent_kinds(c2)) < 2:
                # QA-03: forwarding money it had just received is the only kind of evidence. On the train ledger 3 of the
                # 4 investigated accounts labelled an intermediary on this alone were not (a victim, a legitimate
                # look-alike, an account without a scenario role); with a second independent kind all 122 were. One kind
                # of evidence does not establish a role, so the label abstains and the observation stays visible.
                r = RoleResult("unknown_role", "assessed",
                               "Its flagged outgoing transfer(s) were paid out of money it had just received. That one "
                               "observation does not establish a role.",
                               sup + [ff] + in_note, con, c2, strength_of(c2),
                               "Only one kind of evidence: passing on money just received is also what deceived holders and "
                               "people paying family or suppliers do, and nothing else in the records points either way.",
                               "Ask the holder where the incoming money came from and why it was sent on.")
                r.category_text = {"FUNDED_FORWARD": ff}
                return r
            r = RoleResult("potential_intermediary", "assessed",
                           "Its flagged outgoing transfers mostly forwarded money it had just received.",
                           sup + [ff] + in_note, con, c2, strength_of(c2),
                           "Forwarding can be legitimate or done on a scammer's instructions.",
                           "Establish where the inflows came from and why they were passed on.")
            r.category_text = {"FUNDED_FORWARD": ff}
            return r
        if "ACCOUNT_MODEL" in cats:
            return RoleResult("unknown_role", "assessed", "No single transfer is flagged, but the account behaviour model suggests review.",
                              sup + in_note, con, cats, strength_of(cats), "Model score without a flagged transfer to anchor it.",
                              "Review the model factors against the account's statements.")
        if e.uncorroborated_rule_flag_ids:
            n = len(e.uncorroborated_rule_flag_ids)
            return RoleResult("no_suspicious_activity_observed", "assessed",
                              f"The fixed rules flag {n} transfer(s) as unusual for this account, but the validated transaction model "
                              "does not; on its own that is not treated as suspicious activity.", [],
                              con + [f"Uncorroborated rule flag(s): {', '.join(e.uncorroborated_rule_flag_ids[:4])}. A first rent "
                                     "payment or a large purchase often looks unusual against an account's own history."],
                              [], "none", "Rule and model disagree; the model is the validated detector on this dataset.",
                              "If there is a complaint about these transfers, confirm them with the holder.")
        return RoleResult("no_suspicious_activity_observed", "assessed",
                          "No transfer from this account is flagged by the rules or the transaction model.", [], con, [], "none",
                          None, "No action is suggested from this evidence alone.")

    # ------------------------------------------------------------------ connected accounts
    if e.n_transactions < MIN_TXNS and not cats:
        return RoleResult("unknown_role", "insufficient_evidence", f"Only {e.n_transactions} transfer(s) on record.", sup, con, cats,
                          "none", f"Fewer than {MIN_TXNS} transfers on record.", "Obtain the account's KYC and opening records.")

    if e.position == "other_sender":
        # Found by looking at other payments into a traced account of interest (the "hub": an intermediary or
        # suspicious-account candidate, or an account the investigated account paid in a flagged transfer). The hub's
        # role is a candidate, not a finding, and may be wrong: the evidence about THIS account is only its own
        # transfer, flagged by the model.
        paid = e.paid_account_id or "an account in the trace"
        if e.paid_account_role in INTERMEDIARY_ROLES:
            what = f"{paid}, which this trace assessed as a {ROLE_LABELS[e.paid_account_role].lower()} candidate"
        elif e.paid_account_paid_by_investigated:
            what = f"{paid}, which the investigated account also paid in a flagged transfer"
            if e.paid_account_role in ROLE_LABELS:
                what += f" (its role in this trace: {ROLE_LABELS[e.paid_account_role].lower()})"
        else:
            what = f"{paid}, an account this trace reached"
        basis = (f"The evidence here is the transaction model's flag on its own transfer, not the role given to {paid}; "
                 "that role is a candidate and may be wrong.")
        tid = e.flagged_out_ids[0] if e.flagged_out_ids else None
        # QA-03: a potential victim found this way must have lost its OWN money: money received in the 24 h before
        # covered less than INTERMEDIARY_SHARE of the payment, and the payment took at least OWN_FUNDS_SHARE of its
        # balance (the engine's existing victim-side thresholds). On the train ledger, all 49 intermediaries labelled
        # potential victims here had received at least the payment's amount in the 24 h before it (no victim had more
        # than 69%); the balance condition removes the same 49 and also keeps out an ordinary-looking payment that took
        # a small part of the balance, at the cost of 11 of the 53 true other victims (they become role unknown).
        own_money = e.recent_inflow_share is not None and e.recent_inflow_share < INTERMEDIARY_SHARE
        material = e.balance_share is not None and e.balance_share >= OWN_FUNDS_SHARE
        if e.flagged_out_unfunded_ids and e.deviation and established and not (own_money and material):
            why = []
            if not own_money:
                why.append(f"money it received in the 24 h before covered at least {INTERMEDIARY_SHARE:.0%} of this payment, so "
                           "it may have been passing money on rather than losing its own"
                           if e.recent_inflow_share is not None else "its recent incoming money could not be measured")
            if not material:
                why.append(f"the payment took less than {OWN_FUNDS_SHARE:.0%} of its balance at the time"
                           if e.balance_share is not None else "its balance before the payment is not recorded")
            return RoleResult("unknown_role", "assessed",
                              f"Sent a transfer the transaction model flags into {what}; on its own that does not describe a role.",
                              sup + ([f"Its own transfer {tid} is flagged by the transaction model."] if tid else []), con, cats,
                              "none", "Not called a potential victim: " + "; ".join(why) + ". " + basis,
                              "No action from this evidence alone; if the holder reports a loss, review this payment.")
        if e.flagged_out_unfunded_ids and e.deviation and established:
            return RoleResult("potential_victim", "assessed",
                              f"Sent a transfer the transaction model flags into {what}.",
                              [f"Its own transfer {e.flagged_out_unfunded_ids[0]} is flagged by the transaction model and was not "
                               "funded by money it had just received."] + e.deviation, con, ["TXN_MODEL"],
                              _strength(1 + bool(e.deviation)), f"Found by looking at other payments into {paid}. " + basis,
                              "Check whether this holder has reported a loss; contact through a verified channel.", may_be_victim=True)
        return RoleResult("unknown_role", "assessed",
                          f"Sent a transfer the transaction model flags into {what}; on its own that does not describe a role.",
                          sup + ([f"Its own transfer {tid} is flagged by the transaction model."] if tid else []), con, cats,
                          "none", "A single flagged payment is not evidence of a role. " + basis,
                          "No action from this evidence alone.")

    if e.position == "upstream":
        # Paid into the traced flow before the investigated account: never a collection point of that money.
        if e.flagged_out_unfunded_ids and e.deviation and established:
            return RoleResult("potential_victim", "assessed", "Paid into the traced flow in a flagged transfer unlike its own history.",
                              [f"Its transfer {e.flagged_out_unfunded_ids[0]} is flagged and was not funded by money it had just received."]
                              + e.deviation, con, cats, _strength(1 + len(e.deviation)),
                              "Found upstream of the investigated account.", "Check whether this holder has reported a loss.", may_be_victim=True)
        if not cats or (established and set(cats) <= {"NEW_RECORDS", "NETWORK", "RECEIPT_PATTERN"}):
            return RoleResult("no_suspicious_linkage_observed", "assessed",
                              "No suspicious linkage observed: an earlier payer of the traced account with no flagged behaviour.",
                              [], con, [], "none", "This does not establish that the account is uninvolved.",
                              "No action is suggested from this evidence alone.")
        return RoleResult("unknown_role", "assessed", "An earlier payer with some signals but no clear role.", sup, con, cats,
                          strength_of(cats), "Signals without a pattern.", "Review the listed signals against its records.")

    if not e.in_flagged_flow:
        # Reached only through transfers nobody flagged (the trace followed the largest ones for context). Onward
        # payments there are ordinary life, not evidence; only the account's own model or rule signals would count.
        own_signals = set(cats) & {"ACCOUNT_MODEL", "TXN_MODEL", "CASH"}
        if not own_signals:
            return RoleResult("no_suspicious_linkage_observed", "assessed",
                              "No suspicious linkage observed: connected only through transfers that were not flagged.",
                              [], con + ([f"Observed but not treated as evidence here: {t}" for t in sup]), cats, "none",
                              "This does not establish that the account is uninvolved.", "No action is suggested from this evidence alone.")
        return RoleResult("unknown_role", "assessed", "Connected through unflagged transfers, with some signals of its own.",
                          sup, con, cats, strength_of(sorted(own_signals)), "No flagged flow links it to the investigated account.",
                          "Review its own signals separately if relevant.")

    own = _own_funds(e)
    drained = savings_left(e)
    if drained and not traced_money_left(e, INTERMEDIARY_SHARE) and "TXN_MODEL" in cats:
        # Its own savings left in transfers the model flags, but the balance-based attribution cannot show that the traced
        # money itself moved on: neither "passed traced money on" (secondary victim) nor "intermediary" is supported.
        return RoleResult("suspicious_activity_victim_unconfirmed", "assessed",
                          "Its own savings left in transfers the transaction model flags soon after it received traced money; "
                          "it may itself have been exploited.",
                          sup + [f"Its own balance before the traced receipt ({_m(e.balance_before_receipt)}) fell by at least "
                                 f"{_m(own)} within the window; balance-based attribution: between {_m(e.forwarded_min)} and "
                                 f"{_m(e.forwarded_max)} of the traced money itself moved on."], con, cats, strength_of(cats),
                          "The ledger cannot show whether the traced money or its own savings paid the flagged transfers, or "
                          "whether the holder was deceived.",
                          "Contact the holder through a verified channel; treat as a possible victim first.", may_be_victim=True)
    # Secondary victim: the traced money itself moved on (balance-based), the receipt was material, and its own savings
    # left too.
    if drained and traced_money_left(e, INTERMEDIARY_SHARE) and ("ONWARD" in cats or "TXN_MODEL" in cats):
        return RoleResult("potential_secondary_victim", "assessed",
                          "Passed traced money on and its own savings left too, which suggests it was itself exploited.",
                          sup + [f"Its own balance before the traced receipt ({_m(e.balance_before_receipt)}) fell by at least "
                                 f"{_m(own)} within the window."], con, cats, _strength(len(independent_kinds(cats)) + 1),
                          "Being exploited and passing money on look alike in a ledger; intent is unknown.",
                          "Contact the holder through a verified channel; treat as a possible victim first.", may_be_victim=True)

    kinds = independent_kinds(cats)
    # Collection or cash-out point. What it received (several payers, drained senders) only describes the money arriving;
    # the role also needs evidence from its own outgoing side (cash withdrawn, or its onward transfers flagged by the
    # transaction model), and keeping most of the money rules it out unless that money was withdrawn as cash.
    received_pattern = "CASH" in cats or e.traced_paths_in >= 2 or e.drained_senders_near >= 2
    outgoing_evidence = "CASH" in cats or "TXN_MODEL" in cats
    # What it received (RECEIPT_PATTERN, context only) defines the pattern; it is not one of the two supporting
    # categories. A loop through its own outgoing side (NETWORK) still counts.
    others = set(cats) - {"ONWARD"} - CONTEXT_ONLY
    if received_pattern and outgoing_evidence and e.onward_destinations <= 1 and (not kept_most(e) or "CASH" in cats) \
            and len(others) >= 2:
        how = "the money is withdrawn as cash" if "CASH" in cats else "the money leaves in transfers the transaction model flags"
        return RoleResult("potentially_suspicious_account", "assessed",
                          f"Looks like a collection or cash-out point: {how}.", sup, con, cats,
                          strength_of(cats), "The ledger cannot show who controls the account.",
                          "Review KYC, account opening, device and ATM records for this account.")
    moved = e.sent_traced > 0 or e.cash_out_traced > 0
    # As above, what it received (RECEIPT_PATTERN) is not support for a role here.
    support = independent_kinds(cats)
    observed = {"CASH", "NETWORK"} & set(cats)
    model = {"ACCOUNT_MODEL", "TXN_MODEL"} & set(cats)
    if "ONWARD" not in cats and moved and len(support) >= 3 and observed and model:
        return RoleResult("potentially_suspicious_account", "assessed",
                          "Moved part of the traced money on or withdrew it, with several independent signals.", sup, con, cats,
                          strength_of(cats), "Partial onward movement; the ledger cannot show who controls the account.",
                          "Review KYC, account opening and device records, and where the rest of the money went.")
    if "ONWARD" in cats:
        return RoleResult("potential_intermediary", "assessed",
                          "Received traced money and passed most of it on quickly - consistent with a pass-through, "
                          "which does not establish that the holder knowingly took part.", sup, con, cats, strength_of(cats),
                          "Pass-through behaviour has innocent explanations (paying suppliers, family, or following a scammer's instructions).",
                          "Review KYC and the purpose of the onward transfers before any decision.")
    if (prompt_onward(e) or prompt_cash_out(e)) and "TXN_MODEL" in cats:
        # Timing alone is not evidence (its own balance may have paid the transfers or withdrawals); with its own onward
        # transfer flagged by the validated transaction model it is a candidate, but the timing adds no evidence category.
        how = (f"Sent {_m(noncash_onward(e))}" if prompt_onward(e) else f"Withdrew {_m(e.onward_cash_within_24h)} in cash")
        timing = (f"{how} within 24 h of receiving {_m(e.received_traced)} in traced transfers. Balance-based "
                  f"attribution: between {_m(e.forwarded_min)} and {_m(e.forwarded_max)} of the traced money itself left; "
                  "its own balance could have paid the rest.")
        return RoleResult("potential_intermediary", "assessed",
                          "Paid out or withdrew most of what it received within a day, in transfers the transaction model flags; "
                          "the ledger cannot show that these were the same funds.", sup + [timing], con, cats, strength_of(cats),
                          "Its own balance could have paid these transfers, so this may be ordinary spending that happened to follow "
                          "the receipt; pass-through behaviour also has innocent explanations.",
                          "Review KYC and the purpose of the onward transfers before any decision.")
    if not kinds and "RECEIPT_PATTERN" in cats:
        return RoleResult("unknown_role", "assessed", "Only what it received stands out; receiving money is not, on its own, "
                          "evidence of a role.", sup, con, cats, "none",
                          "Several payers can be a shared bill, a collection among family or a small business.",
                          "Review its statement for the window if relevant.")
    if not kinds and (established or e.business_account):
        return RoleResult("no_suspicious_linkage_observed", "assessed",
                          "No suspicious linkage observed in the available data: ordinary records and no flagged behaviour.",
                          [], con, cats, "none", "This does not establish that the account is uninvolved.",
                          "No action is suggested from this evidence alone.")
    if len(kinds) >= 2:
        return RoleResult("unknown_role", "assessed", "Several signals, but no clear pattern of passing money on or collecting it.",
                          sup, con, cats, strength_of(cats), "Mixed evidence.", "Review the listed signals against the account's records.")
    if e.position == "downstream" and kept_most(e) and not cats:
        return RoleResult("no_suspicious_linkage_observed", "assessed",
                          "No suspicious linkage observed in the available data: it received the money and kept it.",
                          [], con, [], "none", "This does not establish that the account is uninvolved.",
                          "No action is suggested from this evidence alone.")
    if not cats and (established or e.business_account):
        return RoleResult("no_suspicious_linkage_observed", "assessed",
                          "No suspicious linkage observed in the available data: ordinary records and no flagged behaviour.",
                          [], con, [], "none", "This does not establish that the account is uninvolved.",
                          "No action is suggested from this evidence alone.")
    if not cats:
        return RoleResult("unknown_role", "assessed", "Not enough evidence to describe its role.", [], con, [], "none",
                          "Partial onward movement without other signals.", "Review its statement for the window if relevant.")
    return RoleResult("unknown_role", "assessed", "One signal only; not enough to describe a role.", sup, con, cats, strength_of(cats),
                      "A single signal is not evidence of a role.", "Review the signal against the account's records.")


# Ordinary explanations shown with every role that could be wrong about the account.
INNOCENT_EXPLANATIONS = {
    "potential_intermediary": [
        "The holder may have been deceived into receiving and moving funds (e.g. a fake job or refund scam).",
        "The payments may be for genuine goods, services, rent or family support."],
    "potentially_suspicious_account": [
        "The holder may have been deceived into receiving and moving funds (e.g. a fake job or refund scam).",
        "The payments may be for genuine goods, services, rent or family support.",
        "Several people paying one account can be a shared bill, a collection among family or friends, or a small business."],
    "potential_victim": [
        "The flagged transfer may be a genuine large payment (a purchase, rent, a deposit or a transfer to family) that only "
        "looks unusual against the account's own history."],
    "suspicious_activity_victim_unconfirmed": [
        "The flagged transfer may be a genuine large purchase, rent or a transfer to family.",
        "A short or irregular history makes ordinary transfers look unusual."],
    "potential_secondary_victim": [
        "Routine supplier, payroll or household payments can lower the balance at the same time as money arrives.",
        "The account may have passed the money on for a genuine reason (repaying a loan, a shared expense)."],
    "unknown_role": [
        "Each listed signal has ordinary explanations; together they do not form a pattern.",
        "Model scores reflect resemblance to synthetic scenarios, not anyone's intent."],
}


def restriction(e: AccountEvidence, r: RoleResult, relevant_ids: list[str]) -> dict:
    """Advisory restriction state. Never an action. Requires at least two independent kinds of evidence beyond receiving
    money (money-leaving categories count once; what it received, RECEIPT_PATTERN, and NEW_RECORDS never count), and
    three unless traced funds may still be held."""
    kinds = independent_kinds(r.categories)
    held = funds_may_still_be_held(e)  # True / False / None (unknown never counts)
    verification = ["Confirm the holder's identity and the purpose of the listed transfers with the account's institution.",
                    "Obtain device, login and session records for the listed transfers (not held in the ledger)."]
    missing = ["Whether the holder authorised or knew about the transfers (not recorded in a ledger).",
               "Records held by other institutions for counterparties outside this dataset."]
    innocent = list(INNOCENT_EXPLANATIONS.get(r.role_candidate, []))
    state, rationale = "insufficient_evidence_to_recommend", "The evidence does not support a recommendation either way."
    if r.role_candidate in ("no_suspicious_linkage_observed", "no_suspicious_activity_observed"):
        state, rationale = "no_restriction_recommendation", "Nothing in the available data links this account to suspicious activity."
    elif r.role_candidate == "cash_withdrawal_point":
        state, rationale = "no_restriction_recommendation", "A cash network is infrastructure, not a person's account."
    elif r.role_candidate in ("potential_victim", "potential_secondary_victim"):
        state = "urgent_manual_review_recommended"
        rationale = ("The account may itself be a victim. Review it urgently to protect the holder: contact them through a "
                     "verified channel. Any protective hold is a decision for the institution with the holder, never a penalty.")
    elif r.role_candidate == "suspicious_activity_victim_unconfirmed" and e.position != "investigated" and savings_left(e):
        # Its own savings are leaving in flagged transfers: the same protective urgency as a secondary victim.
        state = "urgent_manual_review_recommended"
        rationale = ("Its own savings fell by half or more in transfers the transaction model flags. Review it urgently to protect "
                     "the holder: contact them through a verified channel. Any protective hold is a decision for the "
                     "institution with the holder, never a penalty.")
    elif r.role_candidate == "suspicious_activity_victim_unconfirmed":
        state, rationale = "additional_verification_recommended", "Flagged transfers left the account; confirm with the holder first."
    elif r.role_candidate in INTERMEDIARY_ROLES and not r.may_be_victim and own_funds_also_left(e, r) is not None:
        own = own_funds_also_left(e, r)
        state = "urgent_manual_review_recommended" if len(kinds) >= 2 else "additional_verification_recommended"
        rationale = (f"{len(kinds)} independent kind(s) of evidence support review, but its own money also left: its balance "
                     f"before the traced receipt fell by {_m(own)} in this window, in transfers the transaction model flags. "
                     "It may itself be exploited, so no restriction review is suggested; contact the holder through a verified "
                     "channel first. Any protective hold is a decision for the institution with the holder, never a penalty.")
        innocent.insert(0, "Its own savings left alongside the traced money: a pattern seen when the holder is deceived or "
                           "coerced into moving money and is then drained as well.")
    elif r.role_candidate in INTERMEDIARY_ROLES and not r.may_be_victim:
        if len(kinds) >= 3 or (len(kinds) >= 2 and held is True):
            state = "consider_temporary_restriction_review"
            rationale = (f"{len(kinds)} independent kinds of evidence support review"
                         + (" and traced funds may still be in the account" if held else "")
                         + ". A temporary restriction may be considered by the authorised institution after human review, "
                           "under its policy. This report takes no action.")
        elif len(kinds) >= 2:
            state, rationale = "urgent_manual_review_recommended", "Two independent kinds of evidence support urgent review."
        else:
            state, rationale = "additional_verification_recommended", "Only one kind of evidence; verify before anything else."
    if "RECEIPT_PATTERN" in r.categories and state != "no_restriction_recommendation":
        rationale += " What it received (several payers or drained senders nearby) is shown as context and not counted."
    may_note = None
    if r.may_be_victim:
        may_note = "The account may itself be a victim; restriction must not be used as a penalty against it."
    elif r.role_candidate in INTERMEDIARY_ROLES:
        may_note = "Accounts used to move scam money are often operated by people who were deceived themselves."
    return {
        "account_id": e.account_id, "state": state, "label": RESTRICTION_LABELS[state], "rationale": rationale,
        "supporting_evidence": r.supporting if state != "no_restriction_recommendation" else [],
        "relevant_transaction_ids": relevant_ids, "may_be_victim": r.may_be_victim, "victim_note": may_note,
        "innocent_explanations": innocent, "verification_needed": verification if state != "no_restriction_recommendation" else [],
        "missing_information": missing, "funds_may_still_be_held": held,
        "human_review_required": True, "automatic_action_taken": False,
    }
