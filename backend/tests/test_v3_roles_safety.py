"""Role and restriction safety: regression tests for the failure modes found in review of the dynamic-intelligence role
rules (receipt-driven or double-counted escalation, mislabelled merchants and salary-funded victims, unsupported
'funds still held', injected categories, receipt-only evidence in the restriction count, other affected
senders, missing innocent explanations) and an end-to-end check against the
served synthetic ledger's evaluation-only ground truth.

The concrete numbers come from accounts on the served forensic ledger (data/v3_forensic_scenarios.db, seed 303) named
in each test. Ground truth is read only by the end-to-end test, to score the engine's output; the engine never sees it.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.intelligence import models as mdl  # noqa: E402
from app.intelligence import roles  # noqa: E402
from app.intelligence.engine import DynamicInvestigation  # noqa: E402

SERVED_DB = ROOT / "data" / "v3_forensic_scenarios.db"
DEMO_TRUTH = ROOT / "data" / "v3_forensic" / "demo"
HIGH = {"status": "scored", "above_threshold": True}
LOW = {"status": "scored", "above_threshold": False}
FLAGGING = set(roles.INTERMEDIARY_ROLES)
REVIEW = "consider_temporary_restriction_review"


def ev(**kw) -> roles.AccountEvidence:
    base = dict(account_id="X", position="downstream", hop=1, n_transactions=40, history_days=120.0)
    return roles.AccountEvidence(**{**base, **kw})


def run(e: roles.AccountEvidence):
    r = roles.assess(e)
    return r, roles.restriction(e, r, [])


# ---------------------------------------------------------------- ONWARD measures the traced money itself
def test_routine_payout_of_own_money_after_a_small_receipt_is_not_onward_or_cash():
    # FS-B19B3066 -> FS-9945E4AC (innocent counterparty, a shop): received 651.35, then one 10,000 ATM withdrawal of its
    # own takings; balance 362,209 before receipt, 343,158 latest; balance-based attribution: nothing of the 651 left.
    for business in (True, False):
        e = ev(received_traced=651.35, onward_within_24h=10_000, onward_cash_within_24h=10_000, cash_out_traced=10_000,
               sent_traced=10_000, onward_destinations=1, forwarded_min=0.0, forwarded_max=651.35,
               balance_before_receipt=362_209, lowest_balance_in_window=343_158, latest_balance=343_158,
               account_model=LOW, business_account=business)
        r, rec = run(e)
        assert "ONWARD" not in r.categories and "CASH" not in r.categories
        assert r.role_candidate not in FLAGGING and rec["state"] != REVIEW
        assert rec["funds_may_still_be_held"] is False


def test_onward_larger_than_the_receipt_is_capped_and_needs_attribution():
    # FS-748E87EF -> FS-D982605C (no scenario role): received 1,078, sent 5,542 (5,000 of it cash), nothing attributed.
    e = ev(received_traced=1_078, onward_within_24h=5_542, onward_cash_within_24h=5_000, cash_out_traced=5_000, sent_traced=5_542,
           forwarded_min=0.0, forwarded_max=1_078, latest_balance=5_879, account_model=LOW)
    r, rec = run(e)
    assert not set(r.categories) & {"ONWARD", "CASH"} and rec["state"] != REVIEW
    # A material receipt paid on in full, but out of a large own balance (attribution 0): timing only, not ONWARD.
    big = ev(received_traced=9_000, onward_within_24h=8_098, onward_destinations=1, sent_traced=8_098, forwarded_min=0.0,
             forwarded_max=9_000, balance_before_receipt=28_425, account_model=LOW)
    assert roles.prompt_onward(big) and "ONWARD" not in roles.categories(big)[0]
    assert roles.assess(big).role_candidate not in FLAGGING
    # Unknown attribution is not evidence.
    unknown = ev(received_traced=50_000, onward_within_24h=46_000, sent_traced=46_000, account_model=LOW)
    assert "ONWARD" not in roles.categories(unknown)[0]


def test_timing_with_a_model_flagged_onward_transfer_is_a_candidate_but_not_an_onward_category():
    # Pass-through timing out of a funded account: candidate only with its own onward transfer flagged by the model.
    e = ev(received_traced=50_000, onward_within_24h=46_000, onward_delay_minutes=20, onward_destinations=2, sent_traced=46_000,
           account_model=HIGH, model_flagged_onward_ids=["T9"], forwarded_min=10_000, forwarded_max=46_000)
    r, rec = run(e)
    assert r.role_candidate == "potential_intermediary" and "ONWARD" not in r.categories
    assert r.evidence_strength == "moderate" and rec["state"] == "urgent_manual_review_recommended"


# ---------------------------------------------------------------- one withdrawal is one kind of evidence
def test_a_single_cash_withdrawal_never_counts_as_cash_and_onward():
    e = ev(received_traced=20_000, onward_within_24h=18_000, onward_cash_within_24h=18_000, cash_out_traced=18_000,
           sent_traced=18_000, onward_destinations=1, forwarded_min=18_000, forwarded_max=18_000, account_model=LOW)
    r, rec = run(e)
    assert "CASH" in r.categories and "ONWARD" not in r.categories
    assert rec["state"] != REVIEW


def test_money_leaving_categories_count_once_for_strength_and_restriction():
    assert roles.independent_kinds(["ONWARD", "CASH", "NEW_RECORDS"]) == {"MOVED_OUT"}
    e = ev(received_traced=20_000, onward_within_24h=26_000, onward_cash_within_24h=12_000, cash_out_traced=12_000,
           sent_traced=26_000, onward_destinations=2, forwarded_min=20_000, forwarded_max=20_000, account_model=LOW)
    r, rec = run(e)
    assert {"ONWARD", "CASH"} <= set(r.categories)
    assert r.evidence_strength == "weak" and rec["state"] == "additional_verification_recommended"


# ---------------------------------------------------------------- receiving money never makes a collector
@pytest.mark.parametrize("kw", [
    # Verdict repro A: business account, two payers, kept everything, account model above threshold.
    dict(received_traced=40_000, traced_paths_in=2, forwarded_min=0, forwarded_max=0, latest_balance=300_000,
         balance_before_receipt=260_000, account_model=HIGH, business_account=True, onward_destinations=0),
    # Repro B: two payers and half withdrawn as cash, model below threshold.
    dict(received_traced=40_000, traced_paths_in=2, cash_out_traced=20_000, onward_within_24h=20_000, onward_cash_within_24h=20_000,
         forwarded_min=20_000, forwarded_max=20_000, latest_balance=300_000, account_model=LOW, onward_destinations=1, sent_traced=20_000),
    # Repro C: drained senders nearby, kept everything, model above threshold.
    dict(received_traced=40_000, drained_senders_near=2, forwarded_min=0, forwarded_max=0, latest_balance=300_000,
         balance_before_receipt=260_000, account_model=HIGH, onward_destinations=0),
])
def test_receipt_only_network_evidence_never_makes_a_suspicious_collector(kw):
    r, rec = run(ev(**kw))
    assert r.role_candidate != "potentially_suspicious_account"
    assert rec["state"] != REVIEW
    assert "money ends here" not in r.headline


def test_kept_money_blocks_the_collector_rule_unless_it_was_withdrawn_as_cash():
    kept = ev(received_traced=40_000, traced_paths_in=3, forwarded_min=0, forwarded_max=5_000, sent_traced=5_000,
              account_model=HIGH, model_flagged_onward_ids=["T1"], onward_destinations=1)
    assert roles.assess(kept).role_candidate != "potentially_suspicious_account"
    cashed = ev(received_traced=40_000, traced_paths_in=3, cash_out_traced=36_000, onward_within_24h=36_000,
                onward_cash_within_24h=36_000, forwarded_min=36_000, forwarded_max=36_000, sent_traced=36_000,
                account_model=HIGH, onward_destinations=1)
    r = roles.assess(cashed)
    assert r.role_candidate == "potentially_suspicious_account" and "cash" in r.headline


# ---------------------------------------------------------------- secondary victims
def test_a_merchant_paying_its_usual_payouts_after_a_small_receipt_is_not_a_secondary_victim():
    # FS-55B251FD -> FS-7103AB15 (sme, no scenario role): received 456.89, paid out 216,108 the same day.
    for business in (True, False):
        e = ev(received_traced=456.89, onward_within_24h=216_108, sent_traced=216_108, onward_destinations=3, forwarded_min=0.0,
               forwarded_max=456.89, balance_before_receipt=240_000, lowest_balance_in_window=20_000, account_model=LOW,
               business_account=business)
        r, rec = run(e)
        assert r.role_candidate != "potential_secondary_victim" and not r.may_be_victim
        assert rec["state"] != "urgent_manual_review_recommended"
    # A business never becomes a secondary victim even with a material receipt that demonstrably moved on.
    biz = ev(received_traced=50_000, onward_within_24h=48_000, sent_traced=90_000, onward_destinations=1, forwarded_min=45_000,
             forwarded_max=50_000, balance_before_receipt=60_000, lowest_balance_in_window=5_000, account_model=HIGH,
             model_flagged_onward_ids=["T1"], business_account=True)
    assert roles.assess(biz).role_candidate != "potential_secondary_victim"


def test_own_savings_leaving_without_attributed_traced_money_is_an_unconfirmed_victim_not_an_intermediary():
    # Train-ledger secondary-victim profile: savings larger than the receipt, so attribution shows none of it moved.
    e = ev(received_traced=107_500, onward_within_24h=253_763, sent_traced=253_763, onward_destinations=2, forwarded_min=0.0,
           forwarded_max=107_500, balance_before_receipt=279_318, lowest_balance_in_window=133_055, account_model=HIGH,
           model_flagged_onward_ids=["T1"])
    r, rec = run(e)
    assert r.role_candidate == "suspicious_activity_victim_unconfirmed" and r.may_be_victim
    # Its own savings are draining: the same protective urgency as a secondary victim, never restriction review.
    assert rec["state"] == "urgent_manual_review_recommended" and rec["innocent_explanations"]
    # Served ledger FS-8AEE629E -> FS-29869761 (secondary victim): 66,907 of its own, received 14,500, then sent 53,455 in
    # two model-flagged transfers to a new account; lowest balance 22,435; attribution: 0 of the 14,500 moved.
    sv = ev(received_traced=14_500, onward_within_24h=53_454.66, sent_traced=58_971.63, onward_destinations=5, forwarded_min=0.0,
            forwarded_max=14_500, balance_before_receipt=66_906.55, lowest_balance_in_window=22_434.92, latest_balance=37_554.48,
            n_transactions=40, history_days=46.5, account_model=LOW, model_flagged_onward_ids=["TX-303-0050844", "TX-303-0050888"])
    r, rec = run(sv)
    assert r.may_be_victim and r.role_candidate not in FLAGGING and rec["state"] == "urgent_manual_review_recommended"


# ---------------------------------------------------------------- the investigated account
def victim_root(**kw):
    return ev(position="investigated", hop=0, flagged_out_ids=["T1"], flagged_out_unfunded_ids=["T1"],
              deviation=["1 flagged transfer(s) went to account(s) it had never paid before."], **kw)


def test_unfunded_deviating_outflows_reach_the_victim_branch_before_any_collector_rule():
    e = victim_root(flagged_in_senders=2, flagged_in_amount=30_000, flagged_in_moved_min=30_000, account_model=HIGH)
    r, rec = run(e)
    assert r.role_candidate == "potential_victim" and r.may_be_victim and rec["state"] != REVIEW


def test_flagged_inflows_alone_never_make_the_investigated_account_a_collector():
    # FS-D0D054F1 / FS-F3544284 (look-alike: relatives pooled money for a bill): two flagged senders, model above
    # threshold, nothing received through the trace, no flagged outgoing transfer.
    e = ev(position="investigated", hop=0, flagged_in_senders=2, account_model=HIGH)
    r, rec = run(e)
    assert r.role_candidate != "potentially_suspicious_account" and "moves them on" not in r.headline
    assert "NETWORK" not in r.categories and rec["state"] != REVIEW
    # The pooled money was paid on (a hospital bill), in an ordinary unflagged payment: still not a collector.
    pooled = ev(position="investigated", hop=0, flagged_in_senders=2, flagged_in_amount=49_500, flagged_in_moved_min=39_022,
                account_model=HIGH)
    assert roles.assess(pooled).role_candidate != "potentially_suspicious_account"
    # Moved on AND withdrawn as cash: the rule may fire, with a headline that states what was observed.
    cashed = ev(position="investigated", hop=0, flagged_in_senders=2, flagged_in_amount=49_500, flagged_in_moved_min=45_000,
                flagged_in_cash=40_000, account_model=HIGH)
    r = roles.assess(cashed)
    assert r.role_candidate == "potentially_suspicious_account" and "FLAGGED_IN_MOVED" in r.categories
    assert "moved most of that money on" in r.headline and "FLAGGED_IN_MOVED" in r.category_text


def test_forwarder_gets_a_documented_category_not_an_injected_onward():
    e = ev(position="investigated", hop=0, flagged_out_ids=["T1", "T2"], flagged_out_unfunded_ids=[], account_model=HIGH)
    r, rec = run(e)
    assert r.role_candidate == "potential_intermediary"
    assert "ONWARD" not in r.categories and "FUNDED_FORWARD" in r.categories and "FUNDED_FORWARD" in r.category_text
    assert r.evidence_strength == roles.strength_of(r.categories) == "moderate"
    assert rec["state"] == "urgent_manual_review_recommended"  # two kinds, and the strength agrees with the count
    qs = {q["q"]: q["a"] for q in DynamicInvestigation._questions(e, r, None)}
    answer = qs["Is there evidence of suspicious intermediary behaviour?"]
    assert answer.startswith("Yes: ") and "flagged outgoing transfer" in answer and "passed most traced money" not in answer
    root = ev(position="investigated", hop=0, flagged_out_ids=["T1"], flagged_out_unfunded_ids=[], account_model=LOW)
    r = roles.assess(root)
    assert r.categories == ["FUNDED_FORWARD"] and r.evidence_strength == "weak"
    assert roles.restriction(root, r, [])["state"] == "additional_verification_recommended"


def _ledger(rows):
    df = pd.DataFrame(rows, columns=["transaction_id", "timestamp", "sender_account_id", "receiver_account_id", "amount",
                                     "sender_balance_before", "receiver_balance_before"])
    df["timestamp"] = pd.to_datetime(df.timestamp)
    return df.sort_values(["timestamp", "transaction_id"]).reset_index(drop=True)


def test_a_recurring_salary_never_makes_a_scam_payment_funded_forwarding():
    # FS-376140E3: salary 63,521.69 at 10:57 from FS-CA28E0CE (which paid it a month earlier too; balance before the
    # salary 62,889.96), then the flagged 77,000 victim transfer at 18:52.
    L = _ledger([
        ("S0", "2026-02-01 10:50", "FS-CA28E0CE", "V", 63_000.0, 900_000.0, 2_000.0),
        ("S1", "2026-03-01 10:57", "FS-CA28E0CE", "V", 63_521.69, 900_000.0, 62_889.96),
        ("F1", "2026-03-01 18:52", "V", "MULE", 77_000.0, 126_411.65, 0.0),
    ])
    unfunded, _ = DynamicInvestigation._unfunded("V", ["F1"], L, {})
    assert unfunded == ["F1"]
    # Even from a new payer, an inflow does not fund a transfer the account's own earlier balance could cover.
    L2 = _ledger([("N1", "2026-03-01 10:57", "NEW", "V", 63_521.69, 900_000.0, 62_889.96),
                  ("F1", "2026-03-01 18:52", "V", "MULE", 77_000.0, 126_411.65, 0.0)])
    assert DynamicInvestigation._unfunded("V", ["F1"], L2, {})[0] == ["F1"]
    # Genuine forwarding: a new payer's money arrives in a near-empty account and is sent straight on.
    L3 = _ledger([("N1", "2026-03-01 10:57", "NEW", "M", 50_000.0, 900_000.0, 1_000.0),
                  ("F1", "2026-03-01 11:30", "M", "NEXT", 45_000.0, 51_000.0, 0.0)])
    assert DynamicInvestigation._unfunded("M", ["F1"], L3, {})[0] == []


def test_balance_based_movement_of_flagged_inflows():
    L = _ledger([("I1", "2026-03-01 10:00", "A", "R", 20_000.0, 50_000.0, 1_000.0),
                 ("I2", "2026-03-01 11:00", "B", "R", 20_000.0, 50_000.0, 21_000.0),
                 ("O1", "2026-03-01 12:00", "R", "C", 38_000.0, 41_000.0, 0.0)])
    L["channel"] = "UPI"
    received, moved, cash = DynamicInvestigation._moved_on("R", {"I1", "I2"}, L, 24)
    assert received == 40_000 and moved == 37_000 and cash == 0


# ---------------------------------------------------------------- "funds may still be held"
def test_funds_still_held_compares_against_the_balance_before_receipt_and_unknown_never_counts():
    e = ev(received_traced=651.35, forwarded_max=651.35, balance_before_receipt=362_209, latest_balance=343_158)
    assert roles.funds_may_still_be_held(e) is False
    kept = ev(received_traced=40_000, forwarded_max=5_000, balance_before_receipt=1_000, latest_balance=36_000)
    assert roles.funds_may_still_be_held(kept) is True
    assert roles.funds_may_still_be_held(ev(received_traced=40_000)) is None
    # Two kinds of evidence plus an unknown holding: urgent review, never restriction review.
    two = ev(received_traced=50_000, onward_within_24h=46_000, onward_destinations=2, sent_traced=46_000, forwarded_min=40_000,
             account_model=HIGH)
    r, rec = run(two)
    assert len(roles.independent_kinds(r.categories)) == 2
    assert rec["funds_may_still_be_held"] is None and rec["state"] == "urgent_manual_review_recommended"


# ---------------------------------------------------------------- receipt-only evidence never triggers restriction review
# Served ledger (ml/reports/safety_scan.json): FS-6D5033D8, FS-0840088A and FS-BBCD8F9B reached restriction review only
# because "2 senders each paid it at least 10,000 and half of their balance" counted as a third kind of evidence.
RECEIPT_ONLY = [dict(traced_paths_in=2), dict(drained_senders_near=2), dict(traced_paths_in=3, drained_senders_near=2)]


@pytest.mark.parametrize("receipt", RECEIPT_ONLY)
def test_receipt_only_network_plus_one_other_kind_never_reaches_restriction_review(receipt):
    # One kind of its own (a model-flagged onward transfer) and traced funds that may still be held: before the fix the
    # receipt pattern was the second kind, and two kinds plus "held" reached restriction review.
    e = ev(received_traced=50_000, onward_within_24h=46_000, onward_destinations=2, sent_traced=46_000, forwarded_min=10_000,
           forwarded_max=20_000, account_model=LOW, model_flagged_onward_ids=["T1"], **receipt)
    r, rec = run(e)
    assert r.role_candidate == "potential_intermediary"
    assert "RECEIPT_PATTERN" in r.categories and "NETWORK" not in r.categories
    assert roles.independent_kinds(r.categories) == {"TXN_MODEL"}
    assert r.evidence_strength == roles.strength_of(r.categories) == "weak"
    assert rec["funds_may_still_be_held"] is True
    assert rec["state"] == "additional_verification_recommended"
    # Still shown, clearly labelled as context.
    text = dict(zip(*roles.categories(e)))["RECEIPT_PATTERN"]
    assert "context only" in text and "not counted" in text


@pytest.mark.parametrize("receipt", RECEIPT_ONLY)
def test_receipt_only_network_plus_two_other_kinds_is_counted_as_two(receipt):
    # FS-0840088A profile: account model above threshold, a model-flagged onward transfer, two drained senders nearby,
    # received 20,000, sent 165,326, attribution 0 to 20,000; nothing held. Two kinds: urgent review, not restriction.
    e = ev(received_traced=20_000, onward_within_24h=19_000, onward_destinations=1, sent_traced=165_326.24, forwarded_min=0.0,
           forwarded_max=20_000, balance_before_receipt=150_000, latest_balance=5_000, account_model=HIGH,
           model_flagged_onward_ids=["T1"], **receipt)
    r, rec = run(e)
    assert r.role_candidate in FLAGGING and len(roles.independent_kinds(r.categories)) == 2
    assert rec["state"] == "urgent_manual_review_recommended" and "not counted" in rec["rationale"]


def test_a_loop_counts_only_through_the_accounts_own_outgoing_side():
    loop = ev(received_traced=50_000, onward_within_24h=46_000, onward_destinations=2, sent_traced=46_000, forwarded_min=10_000,
              forwarded_max=20_000, account_model=LOW, model_flagged_onward_ids=["T1"], in_cycle=True)
    r, rec = run(loop)
    assert "NETWORK" in r.categories and roles.independent_kinds(r.categories) == {"TXN_MODEL", "NETWORK"}
    assert rec["state"] == REVIEW  # two kinds and funds may still be held
    receiver_only = ev(received_traced=50_000, in_cycle=True, forwarded_max=0, account_model=HIGH)
    cats = roles.categories(receiver_only)[0]
    assert "NETWORK" not in cats and "RECEIPT_PATTERN" in cats


def test_receipt_pattern_alone_is_not_a_signal():
    r, rec = run(ev(received_traced=40_000, traced_paths_in=2, forwarded_min=0, forwarded_max=40_000, account_model=LOW))
    assert r.role_candidate == "unknown_role" and r.evidence_strength == "none" and rec["state"] != REVIEW
    assert "receiving money is not" in r.headline


# ---------------------------------------------------------------- hubs for other affected senders
def _hub_search(monkeypatch, flagged: set[str], dataset_id="forensic-scenarios", hub_role_evidence=None, root_flagged=()):
    """Runs DynamicInvestigation._other_senders against a stub ledger: root R paid hub H (transfer H0); S1 and S2 also
    paid H, and the stub transaction model flags exactly the transfers in ``flagged``. ``root_flagged``: the root's
    own model-flagged outgoing transfers."""
    from app.intelligence import engine as engine_module
    root = ev(account_id="R", position="investigated", hop=0, flagged_out_ids=list(root_flagged))
    hub = hub_role_evidence or ev(account_id="H", received_traced=50_000, onward_within_24h=46_000, sent_traced=46_000,
                                  forwarded_min=10_000, forwarded_max=46_000, onward_destinations=2, account_model=LOW,
                                  model_flagged_onward_ids=["H1"])
    t0 = pd.Timestamp("2026-03-01 12:00")
    rows = [("H0", t0, "R", "H", 30_000.0)]
    for k, s in enumerate(["S1", "S2"]):
        rows += [(f"{s}-{i}", t0 - pd.Timedelta(days=60 - i * 5), s, f"SHOP{i}", 1_000.0) for i in range(10)]
        rows.append((f"T{k + 1}", t0 + pd.Timedelta(hours=3 + k), s, "H", 40_000.0))
    hist = _ledger([(t, ts, a, b, amt, 60_000.0, 1_000.0) for t, ts, a, b, amt in rows])
    hist["currency"], hist["transaction_type"], hist["channel"] = "INR", "TRANSFER", "UPI"
    monkeypatch.setattr(engine_module.ledger, "account_history", lambda *a, **k: hist)
    monkeypatch.setattr(engine_module, "transaction_features", lambda h, idx: pd.DataFrame(index=idx))
    tm = SimpleNamespace(score=lambda X: pd.DataFrame(
        {"above_threshold": [hist.at[i, "transaction_id"] in flagged for i in X.index], "model_score": 0.9,
         "calibrated_probability": 0.5, "outside_training_range": 0}, index=X.index))
    db = SimpleNamespace(execute=lambda stmt: SimpleNamespace(all=lambda: [("T1", "S1"), ("T2", "S2"), ("H0", "R")]))
    flow = SimpleNamespace(edges=[SimpleNamespace(txn=SimpleNamespace(destination_account_id="H", timestamp=t0))],
                           node_hops={"R": (0, "investigated"), "H": (1, "downstream")})
    req = SimpleNamespace(dataset_id=dataset_id, onward_window_hours=48)
    return DynamicInvestigation._other_senders(db, "forensic-scenarios", "R", {"R": root, "H": hub}, flow, tm, req)


def test_a_weakly_supported_candidate_may_seed_the_search_but_only_flagged_senders_are_reported(monkeypatch):
    weak = ev(account_id="H", received_traced=50_000, onward_within_24h=46_000, sent_traced=46_000, forwarded_min=10_000,
              forwarded_max=46_000, onward_destinations=2, account_model=LOW, model_flagged_onward_ids=["H1"])
    r = roles.assess(weak)
    assert r.role_candidate == "potential_intermediary" and len(roles.independent_kinds(r.categories)) == 1
    out = _hub_search(monkeypatch, flagged={"T1"}, hub_role_evidence=weak)
    # S1's own transfer is flagged: reported. S2 paid the same hub in an unflagged transfer: not reported. The
    # investigated account is never an other sender.
    assert [e.account_id for e, _ in out] == ["S1"]
    e, res = out[0]
    assert e.flagged_out_ids == ["T1"] and e.paid_account_id == "H" and e.paid_account_role == "potential_intermediary"
    # Wording: names the hub's role as a candidate, and says the sender's own flag is the evidence, not the hub.
    words = " ".join([res.headline, res.uncertainty_reason or ""] + res.supporting)
    assert "potential intermediary candidate" in res.headline and "suspicious account" not in words
    assert "flag on its own transfer" in res.uncertainty_reason and "not the role given to H" in res.uncertainty_reason
    # A hub's customers paying it in ordinary, unflagged transfers yield nobody, however the hub was assessed.
    assert _hub_search(monkeypatch, flagged=set(), hub_role_evidence=weak) == []


def test_the_investigated_accounts_flagged_payee_seeds_the_search_unless_it_was_assessed_as_unlinked(monkeypatch):
    # Several victims paying one collection account: the account the investigated victim paid in a flagged transfer is
    # a hub whatever role it was given, unless the engine found nothing linking it (or nothing of its own).
    payee = dict(account_id="H", received_traced=30_000, receipt_ids=["H0"], forwarded_min=0, forwarded_max=30_000)
    unknown = ev(**payee, account_model=HIGH)  # one kind of its own: role unknown
    assert roles.assess(unknown).role_candidate == "unknown_role"
    out = _hub_search(monkeypatch, flagged={"T1"}, hub_role_evidence=unknown, root_flagged=["H0"])
    assert [e.account_id for e, _ in out] == ["S1"]
    e, res = out[0]
    assert e.paid_account_paid_by_investigated and "which the investigated account also paid in a flagged transfer" in res.headline
    assert "(its role in this trace: role unknown)" in res.headline and "suspicious account" not in res.headline
    assert "not the role given to H" in res.uncertainty_reason
    # The same payee, but the investigated account's transfer to it is not flagged: not a hub.
    assert _hub_search(monkeypatch, flagged={"T1"}, hub_role_evidence=unknown, root_flagged=["OTHER"]) == []
    # Assessed as unlinked (an established shop that kept the money), or a role unknown with no evidence of its own:
    # not a hub, even though the investigated account paid it in a flagged transfer and its customers' transfers are flagged.
    shop = ev(**payee, account_model=LOW, business_account=True)
    assert roles.assess(shop).role_candidate == "no_suspicious_linkage_observed"
    bare = ev(**payee, n_transactions=6, history_days=10.0, account_model=LOW)
    assert roles.assess(bare).role_candidate == "unknown_role" and not roles.independent_kinds(roles.assess(bare).categories)
    for hub in (shop, bare):
        assert _hub_search(monkeypatch, flagged={"T1", "T2"}, hub_role_evidence=hub, root_flagged=["H0"]) == []


def test_other_senders_need_a_validated_model_and_a_candidate_hub(monkeypatch):
    # Where the model is not validated its flag is not evidence: nobody is reported.
    assert _hub_search(monkeypatch, flagged={"T1", "T2"}, dataset_id="demo-ledger") == []
    # No transaction model: nothing is searched.
    assert DynamicInvestigation._other_senders(None, "x", "R", {"R": ev(position="investigated", hop=0)}, None, None,
                                               SimpleNamespace(dataset_id="forensic-scenarios")) == []
    # A traced account without an intermediary or suspicious-account candidate role, which the investigated account did
    # not pay in a flagged transfer, is never a hub.
    ordinary = ev(account_id="H", received_traced=5_000, forwarded_max=0, account_model=HIGH)
    assert roles.assess(ordinary).role_candidate not in FLAGGING
    assert _hub_search(monkeypatch, flagged={"T1", "T2"}, hub_role_evidence=ordinary) == []


def test_other_senders_are_described_by_the_hub_role_not_as_paying_a_suspicious_account():
    e = ev(account_id="S", position="other_sender", hop=None, n_transactions=30, flagged_out_ids=["T7"],
           flagged_out_unfunded_ids=["T7"], deviation=["1 flagged transfer(s) went to account(s) it had never paid before."],
           paid_account_id="FS-HUB", paid_account_role="potential_intermediary", account_model={"status": "not_analyzed"})
    r = roles.assess(e)
    assert "FS-HUB, which this trace assessed as a potential intermediary candidate" in r.headline
    assert "suspicious account" not in r.headline and "not the role given to FS-HUB" in r.uncertainty_reason
    plain = ev(account_id="S", position="other_sender", hop=None, n_transactions=30, flagged_out_ids=["T7"],
               paid_account_id="FS-HUB", paid_account_role="potentially_suspicious_account", account_model={"status": "not_analyzed"})
    pr = roles.assess(plain)
    assert pr.role_candidate == "unknown_role" and "potentially suspicious account candidate" in pr.headline
    assert "not the role given to FS-HUB" in pr.uncertainty_reason
    qs = DynamicInvestigation._questions(e, r, {"paid": "FS-HUB"})
    assert "potential intermediary" in qs[0]["a"] and "suspicious account" not in qs[0]["a"]


# ---------------------------------------------------------------- innocent explanations
@pytest.mark.parametrize("e", [
    victim_root(),
    ev(position="investigated", hop=0, flagged_out_ids=["T1"], flagged_out_unfunded_ids=["T1"]),  # unconfirmed victim
    ev(received_traced=50_000, onward_within_24h=48_000, sent_traced=90_000, onward_destinations=1, forwarded_min=45_000,
       forwarded_max=50_000, balance_before_receipt=60_000, lowest_balance_in_window=5_000, account_model=HIGH,
       model_flagged_onward_ids=["T1"]),  # secondary victim
    ev(position="investigated", hop=0, account_model=HIGH),  # unknown role
])
def test_every_role_that_can_be_wrong_carries_innocent_explanations(e):
    r, rec = run(e)
    assert r.role_candidate in ("potential_victim", "suspicious_activity_victim_unconfirmed", "potential_secondary_victim",
                                "unknown_role")
    assert rec["innocent_explanations"], r.role_candidate


# ---------------------------------------------------------------- the investigated account's near misses
def test_closest_unflagged_transfers_are_shown_with_score_and_threshold_and_never_flag():
    tm = SimpleNamespace(threshold=0.001302)
    scored = {t: {"transaction_id": t, "timestamp": "2026-03-06T11:23:12", "sender_account_id": s, "receiver_account_id": "Y",
                  "amount": a, "transaction_type": "TRANSFER", "channel": "UPI", "model_score": 0.1, "model_flag": f,
                  "evidence_use": "evidence"}
              for t, s, a, f in [("A", "R", 6_662.49, False), ("B", "R", 6_000, False), ("C", "R", 1_000, False),
                                 ("D", "R", 500, False), ("E", "R", 90_000, True), ("F", "OTHER", 9_999, False)]}
    raw = {"A": 0.000978, "B": 0.000284, "C": 0.000265, "D": 0.0001, "E": 0.5, "F": 0.0012}
    out = DynamicInvestigation._closest_unflagged("R", scored, raw, {"E"}, tm)
    assert [d["transaction_id"] for d in out] == ["A", "B", "C"]
    assert out[0]["calibrated_probability"] == 0.000978 and out[0]["threshold"] == 0.001302 and out[0]["share_of_threshold"] == 0.751
    assert DynamicInvestigation._closest_unflagged("R", scored, raw, set(), None) == []


# ---------------------------------------------------------------- end to end on the served ledger's ground truth
def _served_ready() -> bool:
    if not (SERVED_DB.exists() and (DEMO_TRUTH / "roles.csv").exists()):
        return False
    try:
        mdl.load("transaction_model")
        mdl.load("account_model")
        return True
    except mdl.ModelArtifactUnavailable:
        return False


served = pytest.mark.skipif(not _served_ready(), reason="served forensic ledger, its ground truth or the v3 models are absent")


@pytest.fixture(scope="module")
def served_runs():
    from app.api.v2.dynamic_schemas import DynamicInvestigationRequest
    from app.intelligence.datasets import DatasetRegistry
    registry = DatasetRegistry(f"sqlite:///{SERVED_DB}")
    gt = pd.read_csv(DEMO_TRUTH / "roles.csv")
    gt = gt[gt.materialised]
    roots = sorted(set(gt[gt.role.isin(["victim", "lookalike_legitimate"])].account_id))
    runs = {}
    for a in roots:
        req = DynamicInvestigationRequest(account_id=a, dataset_id="forensic-scenarios")
        runs[a], _, _ = DynamicInvestigation.compute(registry, None, req)
    return runs, gt


@served
def test_no_innocent_counterparty_or_lookalike_is_called_suspicious_or_sent_to_restriction_review(served_runs):
    runs, gt = served_runs
    protected = set(gt[gt.role.isin(["innocent_counterparty", "lookalike_legitimate"])].account_id)
    offenders = []
    for root, out in runs.items():
        for a in out["role_assessments"]:
            if a["account_id"] in protected and (a["restriction"]["state"] == REVIEW
                                                 or a["role_candidate"] == "potentially_suspicious_account"):
                offenders.append((root, a["account_id"], a["role_candidate"], a["restriction"]["state"]))
            if a["may_be_victim"]:
                assert a["restriction"]["state"] != REVIEW
            if a["restriction"]["state"] == REVIEW:
                assert len(roles.independent_kinds(a["evidence_categories"])) >= 2
                assert "RECEIPT_PATTERN" not in roles.independent_kinds(a["evidence_categories"])
                assert a["evidence_strength"] == roles.strength_of(a["evidence_categories"])
            assert a["restriction"]["automatic_action_taken"] is False
    assert offenders == []


@served
def test_every_other_sender_rests_on_its_own_model_flagged_transfer_into_a_hub(served_runs):
    runs, _ = served_runs
    unlinked = {"no_suspicious_linkage_observed", "no_suspicious_activity_observed", "cash_withdrawal_point"}
    n = 0
    for root, out in runs.items():
        role_of = {a["account_id"]: a["role_candidate"] for a in out["role_assessments"]}
        paid_by_root = {t["receiver_account_id"] for t in out["suspicious_transactions"]
                        if t["sender_account_id"] == root and t["model_flag"]}
        for a in out["role_assessments"]:
            if a["graph_relationship"]["position"] != "other_sender":
                continue
            n += 1
            t = a["other_sender_transaction"]
            hub = a["graph_relationship"]["paid_suspicious_account"]
            assert t["model_flag"] is True and t["sender_account_id"] == a["account_id"] and t["receiver_account_id"] == hub
            # A hub is an intermediary or suspicious-account candidate, or the investigated account's flagged payee that
            # was not assessed as unlinked.
            assert hub != root and (role_of.get(hub) in FLAGGING or (hub in paid_by_root and role_of.get(hub) not in unlinked))
            assert "suspicious account" not in a["headline"] or "potentially suspicious account candidate" in a["headline"]
            assert a["restriction"]["state"] != REVIEW and a["restriction"]["automatic_action_taken"] is False
    assert n > 0


@served
def test_a_narrow_model_miss_on_the_investigated_account_is_visible(served_runs):
    runs, _ = served_runs
    out = runs.get("FS-03BDFF00")
    if out is None:
        pytest.skip("FS-03BDFF00 is not a victim root in this build of the served ledger")
    near = {d["transaction_id"]: d for d in out["closest_unflagged_transfers"]}
    assert "TX-303-0064858" in near
    d = near["TX-303-0064858"]
    assert d["calibrated_probability"] < d["threshold"] and d["share_of_threshold"] < 1
    assert "TX-303-0064858" not in {s["transaction_id"] for s in out["suspicious_transactions"]}


# ---------------------------------------------------------------- own funds leaving alongside a pass-through (final review)
def test_pure_pass_through_with_no_own_savings_keeps_its_restriction_review():
    # FS-BE16A3FE (served ledger): spent its own savings down to 166.90 through ordinary purchases, then received 74,578.24
    # from the victim and forwarded 73,602.77 to the collector 82 min later (flagged). Ground truth planned it as a secondary
    # victim, but its drain never happened because nothing was left; in the ledger it is a plain pass-through. Three
    # independent kinds of evidence are real, so the restriction review stands; the deception explanation is listed.
    e = ev(received_traced=74_578.24, onward_within_24h=74_262.48, onward_delay_minutes=81.7, onward_destinations=2,
           sent_traced=74_262.48, forwarded_min=74_095.58, forwarded_max=74_262.48, balance_before_receipt=166.90,
           lowest_balance_in_window=482.66, latest_balance=161.82, account_model=HIGH,
           model_flagged_onward_ids=["TX-303-0054824"], n_transactions=21, history_days=53.4)
    r, rec = run(e)
    assert r.role_candidate == "potential_intermediary" and set(roles.independent_kinds(r.categories)) == {"MOVED_OUT", "ACCOUNT_MODEL", "TXN_MODEL"}
    assert roles.own_funds_also_left(e, r) is None  # its own money before the receipt was 166.90: nothing of its own left
    assert rec["state"] == "consider_temporary_restriction_review"
    assert any("deceived" in x for x in rec["innocent_explanations"]) and rec["automatic_action_taken"] is False


def test_pass_through_that_also_loses_its_own_savings_is_never_pushed_to_restriction():
    # FS-4268EBB9 (cold ledger, a secondary victim): 86,378.84 of its own before receiving 165,168.50; forwarded 155,000 and
    # then 48,936.78 more (both flagged), so its own balance fell by 38,768 (45%: below the 50% savings rule). It must not
    # be recommended for restriction: urgent manual review, with the own-funds loss stated.
    e = ev(received_traced=165_168.50, onward_within_24h=165_168.50, onward_delay_minutes=16.7, onward_destinations=2,
           sent_traced=203_936.78, forwarded_min=117_557.94, forwarded_max=165_168.50, balance_before_receipt=86_378.84,
           lowest_balance_in_window=47_610.56, account_model=HIGH, model_flagged_onward_ids=["A", "B"],
           n_transactions=57, history_days=43.0)
    r, rec = run(e)
    assert r.role_candidate == "potential_intermediary"
    assert roles.own_funds_also_left(e, r) == pytest.approx(38_768.28, abs=0.01)
    assert rec["state"] == "urgent_manual_review_recommended"
    assert "its own money also left" in rec["rationale"] and "never a penalty" in rec["rationale"]
    assert rec["innocent_explanations"][0].startswith("Its own savings left")


def test_own_funds_rule_needs_flagged_transfers_and_a_personal_account():
    base = dict(received_traced=50_000, onward_within_24h=46_000, onward_delay_minutes=20, onward_destinations=2,
                sent_traced=60_000, forwarded_min=40_000, forwarded_max=46_000, balance_before_receipt=30_000,
                lowest_balance_in_window=15_000, account_model=HIGH)
    flagged, _ = run(ev(**base, model_flagged_onward_ids=["T1"]))
    assert roles.own_funds_also_left(ev(**base, model_flagged_onward_ids=["T1"]), flagged) == pytest.approx(15_000)
    unflagged_e = ev(**base)
    unflagged, rec = run(unflagged_e)
    assert roles.own_funds_also_left(unflagged_e, unflagged) is None  # no flagged transfer carried it
    business_e = ev(**base, model_flagged_onward_ids=["T1"], business_account=True)
    business, _ = run(business_e)
    assert roles.own_funds_also_left(business_e, business) is None  # business payouts lower balances anyway
    small_e = ev(**{**base, "lowest_balance_in_window": 28_500}, model_flagged_onward_ids=["T1"])
    small, _ = run(small_e)
    assert roles.own_funds_also_left(small_e, small) is None  # below OWN_FUNDS_MIN (2,000)
