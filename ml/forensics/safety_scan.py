"""Ledger-wide innocent-counterparty safety scan of the dynamic investigation engine on the served forensic ledger.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.safety_scan

Investigates, with the API's default request (evaluate_investigations.run), as roots:
  * every materialised ground-truth victim,
  * every lookalike hub (role lookalike_legitimate),
  * every innocent counterparty (role innocent_counterparty, materialised or not),
  * ORDINARY_SAMPLE ordinary accounts (ground_truth_label 'ordinary', no row in roles.csv, >= 5 transfers), drawn with
    a fixed seed from the sorted list.
Every account the engine assesses, in any position (the root included), is classified with ground truth AFTER the
engine has run: innocent_counterparty / lookalike_legitimate (that is its only materialised role), no_scenario_role (no
materialised role at all), or scenario_role (out of scope here). Every protected account that gets a scenario-like
role or a review state is listed with its evidence categories and the engine's own reasoning.

It also re-checks four previously fixed failure modes on every assessment:
  F1 a pass-through amount stated as larger than the traced money received,
  F2 one cash withdrawal counted twice (as onward transfer and as cash, or as two independent kinds of evidence),
  F3 a merchant / business account labelled a secondary victim,
  F4 receipt-only evidence triggering a restriction review.

The engine is observed, not changed: roles.restriction is wrapped only to record the (evidence, result) pair it is
handed, and the trace object is recorded the same way. Ground truth is read only here, by the evaluator. The ledger is
opened read-only for the independent channel/amount checks. Writes ml/reports/safety_scan.json. Synthetic data only.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from ml.forensics.evaluate_investigations import build, run  # noqa: E402
from backend.app.intelligence import engine as engine_module  # noqa: E402
from backend.app.intelligence.datasets import DatasetRegistry  # noqa: E402

roles = engine_module.roles  # the very module object the engine calls
LEDGER = "demo"
GT_DIR = ROOT / "data" / "v3_forensic" / LEDGER
REPORT = ROOT / "ml" / "reports" / "safety_scan.json"
ORDINARY_SAMPLE = 150
ORDINARY_MIN_TXNS = 5
SAMPLE_SEED = 20261101  # fixed; the draw is from the sorted eligible list, so it is reproducible
PROTECTED = ("innocent_counterparty", "lookalike_legitimate", "no_scenario_role")
SUSPICION_ROLES = {"potential_intermediary", "potentially_suspicious_account"}
VICTIM_CLASS_ROLES = {"potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed"}
WATCH_ROLES = SUSPICION_ROLES | {"potential_secondary_victim"}
WATCH_STATES = {"urgent_manual_review_recommended", "consider_temporary_restriction_review"}
REVIEW_STATES = WATCH_STATES | {"additional_verification_recommended"}
OUTGOING_CATEGORIES = {"ONWARD", "CASH", "FUNDED_FORWARD", "FLAGGED_IN_MOVED", "TXN_MODEL"}
CASH_CHANNEL = "ATM_CASH_OUT"
EPS = 0.01
_NUM = r"([0-9][0-9,]*(?:\.[0-9]+)?)"
SENT_OF = re.compile(rf"Sent {_NUM} of the {_NUM} it received")
SENT_WITHIN = re.compile(rf"Sent {_NUM} (?:onward )?within 24 h of receiving {_NUM}")
WITHDREW_WITHIN = re.compile(rf"Withdrew {_NUM} in cash within 24 h of receiving {_NUM}")


# Written out here, independently of the engine's roles module, so the F2 check does not test the code with itself.
MONEY_LEAVING = {"ONWARD", "CASH", "FUNDED_FORWARD", "FLAGGED_IN_MOVED"}
CONTEXT_ONLY = {"NEW_RECORDS", "RECEIPT_PATTERN"}  # kept as a literal so this check stays independent of roles.py
STRENGTH = ["none", "weak", "moderate", "strong"]


def my_kinds(cats: list[str]) -> set[str]:
    """Independent kinds of evidence: money-leaving categories are one kind; NEW_RECORDS and RECEIPT_PATTERN (receipt-only
    patterns) are context only and never count, matching roles.CONTEXT_ONLY."""
    return {("MONEY_LEAVING" if c in MONEY_LEAVING else c) for c in cats if c not in CONTEXT_ONLY}


def _n(s: str) -> float:
    return float(s.replace(",", ""))


# ---------------------------------------------------------------- observation hooks (no behaviour change)
class Recorder:
    def __init__(self):
        self.pairs: dict[str, tuple] = {}
        self.flow = None
        self._restriction = roles.restriction
        self._evidence = engine_module.DynamicInvestigation._evidence

    def install(self):
        rec = self
        orig_r, orig_e = self._restriction, self._evidence.__func__

        def restriction(e, r, relevant_ids):
            rec.pairs[e.account_id] = (e, r)
            return orig_r(e, r, relevant_ids)

        def _evidence(cls, root_id, base, flow, *a, **k):
            rec.flow = flow
            return orig_e(cls, root_id, base, flow, *a, **k)

        roles.restriction = restriction
        engine_module.DynamicInvestigation._evidence = classmethod(_evidence)

    def uninstall(self):
        roles.restriction = self._restriction
        engine_module.DynamicInvestigation._evidence = self._evidence

    def reset(self):
        self.pairs, self.flow = {}, None


# ---------------------------------------------------------------- ground truth (evaluator side only)
class Truth:
    def __init__(self):
        self.roles = pd.read_csv(GT_DIR / "roles.csv")
        self.accounts = pd.read_csv(GT_DIR / "accounts.csv", usecols=["account_id", "ground_truth_label", "customer_type"])
        tx = pd.read_csv(GT_DIR / "transactions.csv", usecols=["origin_account_id", "destination_account_id"])
        self.n_tx = pd.concat([tx.origin_account_id, tx.destination_account_id]).value_counts()
        mat = self.roles[self.roles.materialised]
        self.mat_roles = mat.groupby("account_id")["role"].agg(lambda r: sorted(set(r))).to_dict()
        self.planned = self.roles.groupby("account_id")["role"].agg(lambda r: sorted(set(r))).to_dict()
        self.label = self.accounts.set_index("account_id")["ground_truth_label"].to_dict()
        self.ctype = self.accounts.set_index("account_id")["customer_type"].to_dict()

    def truth_class(self, acc: str) -> str:
        r = self.mat_roles.get(acc)
        if not r:
            return "no_scenario_role"
        if r == ["innocent_counterparty"]:
            return "innocent_counterparty"
        if r == ["lookalike_legitimate"]:
            return "lookalike_legitimate"
        return "scenario_role"

    def detail(self, acc: str) -> dict:
        return {"ground_truth_label": self.label.get(acc), "customer_type": self.ctype.get(acc),
                "materialised_roles": self.mat_roles.get(acc, []), "planned_roles": self.planned.get(acc, [])}


def select_roots(t: Truth) -> list[dict]:
    out, seen = [], set()

    def add(acc, kind):
        if acc not in seen:
            seen.add(acc)
            out.append({"account_id": acc, "root_kind": kind})

    r = t.roles
    for a in sorted(r[(r.role == "victim") & r.materialised].account_id.unique()):
        add(a, "victim")
    for a in sorted(r[r.role == "lookalike_legitimate"].account_id.unique()):
        add(a, "lookalike_hub")
    for a in sorted(r[r.role == "innocent_counterparty"].account_id.unique()):
        add(a, "innocent_counterparty")
    in_roles = set(r.account_id)
    elig = sorted(a for a in t.accounts[t.accounts.ground_truth_label == "ordinary"].account_id
                  if a not in in_roles and t.n_tx.get(a, 0) >= ORDINARY_MIN_TXNS)
    rng = np.random.default_rng(SAMPLE_SEED)
    for a in sorted(rng.choice(np.array(elig), min(ORDINARY_SAMPLE, len(elig)), replace=False)):
        add(str(a), "ordinary")
    return out


# ---------------------------------------------------------------- independent checks
def ledger_rows(con: sqlite3.Connection, ids: set[str]) -> dict[str, tuple]:
    ids = sorted(ids)
    out = {}
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        q = f"select transaction_id, channel, amount from transactions where transaction_id in ({','.join('?' * len(chunk))})"
        out.update({tid: (ch, float(am)) for tid, ch, am in con.execute(q, chunk)})
    return out


def onward_split(flow, acc: str, root: str, chan: dict) -> tuple[float, float, set, set]:
    """Independent recomputation (channel and amount from SQL) of the transfers the engine's onward_within_24h covers:
    downstream transfers out of ``acc`` after the first hop, not loop-closing, within 24 h of their parent."""
    if acc == root or flow is None:
        return 0.0, 0.0, set(), set()
    nc, cash, nc_ids, cash_ids = 0.0, 0.0, set(), set()
    for e in flow.edges:
        if e.txn.origin_account_id != acc or e.direction != "downstream" or e.hop <= 1 or e.is_cycle:
            continue
        if (e.minutes_from_parent or 0) > roles.ONWARD_HOURS * 60:
            continue
        ch, amt = chan[e.txn.transaction_id]
        if ch == CASH_CHANNEL:
            cash += amt
            cash_ids.add(e.txn.transaction_id)
        else:
            nc += amt
            nc_ids.add(e.txn.transaction_id)
    return nc, cash, nc_ids, cash_ids


def texts(a: dict) -> list[str]:
    return list(a.get("supporting_evidence") or []) + [i["text"] for i in a.get("evidence_items") or []] + \
        list((a.get("restriction") or {}).get("supporting_evidence") or [])


def receipt_only_network(e) -> bool:
    """NETWORK that only describes what the account received (several payers, drained senders), not a loop."""
    return not e.in_cycle and (e.traced_paths_in >= 2 or e.drained_senders_near >= 2)


def threshold_met(kinds: set, held) -> bool:
    return len(kinds) >= 3 or (len(kinds) >= 2 and held is True)


def why(a: dict, e) -> str:
    g = a["graph_relationship"]
    parts = [a["headline"].rstrip(".")]
    parts.append(f"restriction rationale: {a['restriction']['rationale']}")
    parts.append(f"received traced {g['received_traced_amount']:,.2f}, sent traced {g['sent_traced_amount']:,.2f}, forwarded "
                 f"between {g['forwarded_at_least']} and {g['forwarded_at_most']}")
    if e is not None:
        parts.append(f"business_account={e.business_account}, in_flagged_flow={e.in_flagged_flow}, traced_paths_in={e.traced_paths_in}, "
                     f"in_cycle={e.in_cycle}, drained_senders_near={e.drained_senders_near}")
    return "; ".join(parts)


def main() -> dict:
    t0 = time.perf_counter()
    db = ROOT / build(LEDGER)
    registry = DatasetRegistry(f"sqlite:///{db}")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    t = Truth()
    roots = select_roots(t)
    rec = Recorder()
    rec.install()
    flagged, assessments_by_class = [], Counter()
    role_by_class: dict[str, Counter] = defaultdict(Counter)
    state_by_class: dict[str, Counter] = defaultdict(Counter)
    f1, f2, f3, f4 = (defaultdict(list) for _ in range(4))
    f_counts = Counter()
    errors, seconds = [], []
    try:
        for i, rt in enumerate(roots):
            rec.reset()
            s0 = time.perf_counter()
            try:
                out = run(registry, rt["account_id"])
            except Exception as exc:  # noqa: BLE001 - record and continue; reported
                errors.append({"root": rt["account_id"], "error": f"{type(exc).__name__}: {exc}"})
                continue
            seconds.append(time.perf_counter() - s0)
            if (i + 1) % 50 == 0:
                print(f"{i + 1}/{len(roots)} {rt['account_id']} {seconds[-1]:.1f}s", flush=True)
            root = rt["account_id"]
            flow = rec.flow
            tids = {e.txn.transaction_id for e in flow.edges} if flow is not None else set()
            chan = ledger_rows(con, tids)
            for a in out["role_assessments"]:
                acc = a["account_id"]
                e, r = rec.pairs.get(acc, (None, None))
                cls = t.truth_class(acc)
                pos = a["graph_relationship"]["position"]
                role, state = a["role_candidate"], a["restriction"]["state"]
                assessments_by_class[cls] += 1
                role_by_class[cls][role] += 1
                state_by_class[cls][state] += 1
                cats = a["evidence_categories"] or []
                g = a["graph_relationship"]
                ref = {"root": root, "root_kind": rt["root_kind"], "account_id": acc, "position": pos, "hop": g["hop"],
                       "truth_class": cls, "engine_role": role, "restriction": state}

                # ---- protected-account listing
                if cls in PROTECTED and (role in WATCH_ROLES or state in WATCH_STATES):
                    kind = "protective_victim_class" if a["may_be_victim"] and role not in SUSPICION_ROLES else "suspicion"
                    flagged.append({**ref, **t.detail(acc), "label_kind": kind, "may_be_victim": a["may_be_victim"],
                                    "evidence_categories": cats, "evidence_strength": a["evidence_strength"],
                                    "supporting_evidence": a["supporting_evidence"],
                                    "contradictory_evidence": a["contradictory_evidence"], "why": why(a, e)})

                # ---- F1 pass-through amount larger than the traced money received
                f_counts["F1_assessments_checked"] += 1
                for txt in texts(a):
                    for rx in (SENT_OF, SENT_WITHIN):
                        for m in rx.finditer(txt):
                            f_counts["F1_pass_through_statements"] += 1
                            if _n(m.group(1)) > _n(m.group(2)) + 0.5:
                                f1["stated_pass_through_exceeds_received"].append({**ref, "text": txt})
                    for m in WITHDREW_WITHIN.finditer(txt):
                        f_counts["F1_cash_timing_statements"] += 1
                        if _n(m.group(1)) > _n(m.group(2)) + 0.5:
                            f1["cash_timing_statement_exceeds_received_(informational)"].append({**ref, "text": txt})
                rec_amt = g["received_traced_amount"] or 0.0
                lo, hi = g["forwarded_at_least"], g["forwarded_at_most"]
                if pos != "investigated" and rec_amt > 0:
                    if (hi is not None and hi > rec_amt + EPS) or (lo is not None and lo > rec_amt + EPS):
                        f1["forwarded_range_exceeds_received"].append({**ref, "received": rec_amt, "forwarded_at_least": lo,
                                                                      "forwarded_at_most": hi})
                if "ONWARD" in cats:
                    f_counts["F1_onward_category"] += 1
                    if lo is None or lo < roles.INTERMEDIARY_SHARE * rec_amt - EPS:
                        f1["onward_without_balance_attribution"].append({**ref, "received": rec_amt, "forwarded_at_least": lo})
                if e is not None and pos != "investigated":
                    stated = roles.noncash_onward(e)
                    if stated > e.received_traced + EPS:
                        f1["noncash_onward_exceeds_received"].append({**ref, "stated": stated, "received": e.received_traced})

                # ---- F2 one cash withdrawal counted twice
                if e is not None and pos in ("downstream", "upstream"):
                    nc, cash, nc_ids, cash_ids = onward_split(flow, acc, root, chan)
                    f_counts["F2_accounts_recomputed"] += 1
                    if nc_ids & cash_ids:
                        f2["same_transfer_in_onward_and_cash"].append({**ref, "ids": sorted(nc_ids & cash_ids)})
                    eng_nc = max(0.0, e.onward_within_24h - e.onward_cash_within_24h)
                    if abs(eng_nc - nc) > 0.05 or abs(e.onward_cash_within_24h - cash) > 0.05:
                        f2["engine_noncash_or_cash_differs_from_sql"].append(
                            {**ref, "engine_noncash": round(eng_nc, 2), "sql_noncash": round(nc, 2),
                             "engine_cash": e.onward_cash_within_24h, "sql_cash": round(cash, 2)})
                    if cash > 0:
                        f_counts["F2_accounts_with_cash_withdrawal_in_trace"] += 1
                moved = [c for c in cats if c in MONEY_LEAVING]
                kinds = my_kinds(cats)
                if len(moved) >= 2:
                    f_counts["F2_assessments_with_2plus_money_leaving_categories"] += 1
                    if "CASH" in moved and "ONWARD" in moved:
                        f_counts["F2_assessments_with_both_ONWARD_and_CASH"] += 1
                    if role in SUSPICION_ROLES | {"potential_secondary_victim"}:
                        exp_strength = STRENGTH[min(len(kinds) + (role == "potential_secondary_victim"), 3)]
                        if a["evidence_strength"] != exp_strength:
                            f2["evidence_strength_counts_money_leaving_twice"].append(
                                {**ref, "categories": cats, "strength": a["evidence_strength"], "expected": exp_strength})
                if e is not None and role in SUSPICION_ROLES and not a["may_be_victim"]:
                    held = roles.funds_may_still_be_held(e)
                    # Documented protective rule (roles.own_funds_also_left), recomputed here from the raw evidence: an
                    # intermediary candidate whose own pre-receipt balance fell by >= 2,000 in the window while it made
                    # model-flagged transfers is never pushed to a restriction review.
                    own_left = (e.balance_before_receipt is not None and e.lowest_balance_in_window is not None
                                and e.balance_before_receipt - e.lowest_balance_in_window >= 2_000
                                and not e.business_account and "TXN_MODEL" in cats)
                    if own_left:
                        f_counts["F2_restriction_softened_by_own_funds_rule"] += int(threshold_met(kinds, held))
                        exp = "urgent_manual_review_recommended" if len(kinds) >= 2 else "additional_verification_recommended"
                    else:
                        exp = ("consider_temporary_restriction_review" if threshold_met(kinds, held) else
                               "urgent_manual_review_recommended" if len(kinds) >= 2 else "additional_verification_recommended")
                    raw_kinds = {c for c in cats if c != "NEW_RECORDS"}
                    if state != exp:
                        f2["restriction_state_not_from_collapsed_kinds"].append({**ref, "categories": cats, "expected": exp})
                    elif threshold_met(raw_kinds, held) and not threshold_met(kinds, held):
                        f_counts["F2_restriction_avoided_by_collapsing"] += 1

                # ---- F3 merchant / business accounts as secondary victims
                business = (e.business_account if e is not None else False) or t.ctype.get(acc) in ("sme", "corporate") \
                    or t.label.get(acc) in ("merchant", "employer", "cash_network")
                if business:
                    f_counts["F3_business_assessments"] += 1
                    if role == "potential_secondary_victim":
                        f3["business_labelled_potential_secondary_victim"].append({**ref, **t.detail(acc), "categories": cats})
                    elif role == "suspicious_activity_victim_unconfirmed" and pos != "investigated" \
                            and state == "urgent_manual_review_recommended":
                        f3["business_given_savings_based_urgent_review"].append({**ref, **t.detail(acc), "categories": cats})
                    if e is not None and pos != "investigated" and roles.savings_left(e):
                        f3["savings_left_true_for_business"].append({**ref, **t.detail(acc)})
                    if role in VICTIM_CLASS_ROLES:
                        f_counts["F3_business_with_any_victim_class_role_(informational)"] += 1

                # ---- F4 receipt-only evidence triggering a restriction review
                suspicion_review = state in REVIEW_STATES and not a["may_be_victim"]
                if suspicion_review:
                    f_counts["F4_suspicion_side_reviews"] += 1
                    out_cats = set(cats) & OUTGOING_CATEGORIES
                    if not out_cats:
                        f4["review_without_outgoing_side_evidence"].append({**ref, "categories": cats, "why": why(a, e)})
                    if e is not None and state == "consider_temporary_restriction_review":
                        if "NETWORK" in kinds and receipt_only_network(e):
                            held = roles.funds_may_still_be_held(e)
                            if not threshold_met(kinds - {"NETWORK"}, held):
                                f4["restriction_review_needs_receipt_only_NETWORK_(reported_not_failure_mode)"].append(
                                    {**ref, **t.detail(acc), "categories": cats, "funds_may_still_be_held": held, "why": why(a, e)})
                if e is not None and pos == "investigated" and role == "potentially_suspicious_account":
                    if not (e.flagged_out_ids or e.flagged_in_cash >= roles.CASH_SHARE * e.flagged_in_amount > 0):
                        f4["investigated_collector_without_outgoing_signal"].append({**ref, "categories": cats})
    finally:
        rec.uninstall()
        con.close()

    by_acc = defaultdict(list)
    for f in flagged:
        by_acc[(f["account_id"], f["truth_class"])].append(f)
    distinct = [{"account_id": a, "truth_class": c, **{k: v[0][k] for k in ("ground_truth_label", "customer_type", "planned_roles")},
                 "occurrences": len(v), "roots": sorted({x["root"] for x in v}),
                 "engine_roles": dict(Counter(x["engine_role"] for x in v)), "restrictions": dict(Counter(x["restriction"] for x in v)),
                 "label_kinds": dict(Counter(x["label_kind"] for x in v)),
                 "evidence_categories": sorted({c for x in v for c in x["evidence_categories"]})}
                for (a, c), v in sorted(by_acc.items())]

    def tally(kind):
        sel = [f for f in flagged if f["label_kind"] == kind]
        return {"occurrences": len(sel), "distinct_accounts": len({f["account_id"] for f in sel}),
                "by_truth_class": dict(Counter(f["truth_class"] for f in sel)),
                "by_role_and_restriction": dict(Counter(f"{f['engine_role']} / {f['restriction']}" for f in sel))}

    def fm(d, keys_failure):
        return {"failure_count": sum(len(d[k]) for k in keys_failure),
                "checks": {k: {"count": len(v), "examples": v[:15]} for k, v in d.items()}}

    report = {
        "title": "Innocent-counterparty safety scan (synthetic data)",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ledger": LEDGER, "database": str(db.relative_to(ROOT)), "generator_seed": 303,
        "engine_version": engine_module.ENGINE_VERSION,
        "request": "API defaults via ml.forensics.evaluate_investigations.run (DynamicInvestigationRequest defaults)",
        "notice": "Synthetic ledger. Ground truth was read only by this evaluator, after the engine ran, to classify accounts. "
                  "No threshold or rule was changed; this measures, it does not tune. Nothing here is a real-world accuracy claim.",
        "roots": {"total": len(roots), "by_kind": dict(Counter(r["root_kind"] for r in roots)),
                  "ordinary_sample": {"n": ORDINARY_SAMPLE, "min_transfers": ORDINARY_MIN_TXNS, "seed": SAMPLE_SEED,
                                      "rule": "ground_truth_label 'ordinary', no row in roles.csv, >= 5 transfers; numpy "
                                              "default_rng(seed).choice over the sorted eligible IDs"},
                  "errors": errors},
        "seconds_per_investigation": {"median": round(float(np.median(seconds)), 3) if seconds else None,
                                      "p95": round(float(np.quantile(seconds, 0.95)), 3) if seconds else None},
        "assessments_by_truth_class": dict(assessments_by_class),
        "engine_roles_by_truth_class": {k: dict(v) for k, v in role_by_class.items()},
        "restriction_states_by_truth_class": {k: dict(v) for k, v in state_by_class.items()},
        "protected_accounts_flagged": {
            "definition": "Accounts whose ground truth is innocent_counterparty / lookalike_legitimate (only materialised role) "
                          "or no materialised scenario role, given potential_intermediary, potentially_suspicious_account, "
                          "potential_secondary_victim, urgent_manual_review_recommended or consider_temporary_restriction_review, "
                          "in any position (the investigated account included).",
            "protective_victim_class": tally("protective_victim_class"),
            "suspicion": tally("suspicion"),
            "distinct_accounts": distinct,
            "occurrences": flagged,
        },
        "fixed_failure_modes": {
            "F1_pass_through_exceeds_received": {
                "description": "Every 'Sent X of the Y it received' / 'Sent X (onward) within 24 h of receiving Y' sentence has "
                               "X <= Y; forwarded range never exceeds received; ONWARD only with balance-based attribution "
                               ">= 70%; the engine's capped non-cash onward amount never exceeds received.",
                **fm(f1, ["stated_pass_through_exceeds_received", "forwarded_range_exceeds_received",
                          "onward_without_balance_attribution", "noncash_onward_exceeds_received"])},
            "F2_cash_withdrawal_counted_twice": {
                "description": "Independent SQL split of each traced account's onward transfers into non-cash and ATM_CASH_OUT "
                               "matches the engine; no transfer is in both; money-leaving categories (ONWARD, CASH, "
                               "FUNDED_FORWARD, FLAGGED_IN_MOVED) count as one kind in evidence strength and the restriction state.",
                **fm(f2, ["same_transfer_in_onward_and_cash", "engine_noncash_or_cash_differs_from_sql",
                          "evidence_strength_counts_money_leaving_twice",
                          "restriction_state_not_from_collapsed_kinds"])},
            "F3_merchant_as_secondary_victim": {
                "description": "No sme/corporate account, nor any account labelled merchant/employer/cash_network, is labelled "
                               "potential_secondary_victim or given the savings-based urgent review; savings_left() is never "
                               "true for one.",
                **fm(f3, ["business_labelled_potential_secondary_victim", "business_given_savings_based_urgent_review",
                          "savings_left_true_for_business"])},
            "F4_receipt_only_restriction_review": {
                "description": "Every suspicion-side review state (additional verification, urgent review, restriction review; "
                               "may_be_victim false) has at least one outgoing-side category (ONWARD, CASH, FUNDED_FORWARD, "
                               "FLAGGED_IN_MOVED, TXN_MODEL); an investigated collection point needs an outgoing signal. "
                               "Separately reported (not counted as the failure mode): restriction reviews that reach the "
                               "threshold only because receipt-only NETWORK evidence counts as a kind.",
                **fm(f4, ["review_without_outgoing_side_evidence", "investigated_collector_without_outgoing_signal"])},
            "counters": dict(f_counts),
        },
        "runtime_seconds": round(time.perf_counter() - t0, 1),
    }
    REPORT.write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":  # pragma: no cover
    r = main()
    pf = r["protected_accounts_flagged"]
    print(json.dumps({"roots": r["roots"], "assessments_by_truth_class": r["assessments_by_truth_class"],
                      "protective_victim_class": pf["protective_victim_class"], "suspicion": pf["suspicion"],
                      "distinct_flagged": [{k: d[k] for k in ("account_id", "truth_class", "ground_truth_label", "engine_roles",
                                                              "restrictions", "evidence_categories")} for d in pf["distinct_accounts"]],
                      "failure_modes": {k: (v["failure_count"] if isinstance(v, dict) and "failure_count" in v else v)
                                        for k, v in r["fixed_failure_modes"].items()},
                      "runtime_seconds": r["runtime_seconds"]}, indent=1, default=str))
