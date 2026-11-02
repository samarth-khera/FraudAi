"""Investigator report: an evidence-grounded summary assembled from one dynamic investigation's own results.

Fixed code builds the report from the structured investigation: recorded transfers, model outputs, the rule-based role
assessments and their advisory restriction states. No language model is involved and the report says so; the optional
AI analyst is a separate section and never feeds it. The report assigns no role and changes no assessment: every role,
evidence item and restriction state is copied from the role engine (roles.py via engine.py). What it adds is a review
level per account, a fixed mapping of the engine's restriction state with two safeguards:

* a level above 2 needs at least one recorded fact: a model output alone never raises an account above level 2;
* an account that may itself be a victim gets protective verification only, never a restriction level.

Nothing is executed. A recommendation is advice for an authorised human decision-maker at the account-holding
institution; FraudShield cannot restrict, freeze or hold an account and the public deployment is read-only.
Ground truth is never read. The report holds no wall-clock values, so the investigation digest covers it.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

try:
    from app.intelligence import roles
except ModuleNotFoundError:
    from backend.app.intelligence import roles

REPORT_VERSION = "investigator-report-1.0.0"
NOTICE = ("Recommendation only. No account restriction, freeze or hold has been executed. Authorized institutional "
          "approval and applicable procedures are required.")
GENERATOR = {
    "kind": "deterministic",
    "language_model_used": False,
    "description": "Assembled by fixed code from this investigation's recorded transfers, model outputs and role-rule "
                   "results. No language model wrote it; the optional AI analyst is a separate section and never feeds it.",
}
SCORE_NOTE = ("A model score says how closely a transfer or an account resembles synthetic scenario cases. It is not the "
              "probability that anyone committed fraud, and it is never on its own a reason for urgent review or restriction.")
LEVELS = {1: "Routine review", 2: "Enhanced verification", 3: "Urgent manual investigation",
          4: "Consider temporary restriction under institutional policy"}
PROTECTIVE = {2: "Protective verification", 3: "Urgent protective verification"}
AUTHORISERS = {
    1: "No decision needed beyond the institution's routine monitoring.",
    2: "A fraud analyst at the account-holding institution decides what to verify.",
    3: "The fraud investigation lead at the account-holding institution, following its procedures.",
    4: "An authorized decision-maker at the account-holding institution (fraud operations or financial-crime compliance), "
       "under its policy and applicable law. FraudShield cannot place a hold.",
}
PROTECTIVE_AUTHORISER = ("The holder's institution, together with the holder contacted through a verified channel. Any "
                         "protective measure follows the institution's procedure and is never a penalty.")
STATE_LEVEL = {"consider_temporary_restriction_review": 4, "urgent_manual_review_recommended": 3,
               "additional_verification_recommended": 2}
NO_LINK = ("no_suspicious_linkage_observed", "no_suspicious_activity_observed", "cash_withdrawal_point")
VICTIM_CLASS = ("potential_victim", "potential_secondary_victim", "suspicious_activity_victim_unconfirmed")
ACTIONS = {
    "potential_victim": "Potential victim: protective verification. Contact the holder through a verified channel and confirm "
                        "whether they authorised the flagged transfers.",
    "potential_secondary_victim": "Potential secondary victim: protective verification. Treat as a possible victim first and "
                                  "contact the holder through a verified channel.",
    "suspicious_activity_victim_unconfirmed": "Victim status unconfirmed: ask the holder whether they made and authorised the "
                                              "flagged transfers before anything else.",
    "potential_intermediary": "Potential intermediary: review the fund movement. Establish where the incoming money came from, "
                              "why it was passed on, and whether the holder was deceived.",
    "potentially_suspicious_account": "Potential suspicious account: urgent investigation of account opening, KYC, device and "
                                      "cash-withdrawal records.",
    "unknown_role": "Role unknown: obtain additional information before drawing any conclusion.",
    "no_suspicious_linkage_observed": "No suspicious linkage observed: no restriction recommendation and no action from this "
                                      "evidence alone.",
    "no_suspicious_activity_observed": "No suspicious activity observed: no restriction recommendation and no action from this "
                                       "evidence alone.",
    "cash_withdrawal_point": "Cash withdrawal point (an ATM or cash network, not a person): request cash-terminal records.",
}
SAFEGUARDS = [
    "FraudShield never restricts, freezes or holds an account. The public deployment is read-only and has no such operation.",
    "Every level is advice for an authorized human decision-maker at the account-holding institution, under its policy and "
    "applicable law. Nothing here is a legal finding.",
    "No recommendation rests on a model score alone: levels 3 and 4 need at least one recorded fact.",
    "Receiving money is never evidence of a role. Each recipient is assessed on its own records; most are not suspicious.",
    "An account that may itself be a victim gets protective verification only, never a restriction level.",
    "Amounts at different hops are never added together: the same money can be counted at every hop it passes.",
]
ORDER = {"investigated": 0, "downstream": 1, "upstream": 2, "other_sender": 3}
CONTEXT_WINDOW_HOURS = roles.ONWARD_HOURS
MAX_CHRONOLOGY = 40


def _m(x: Optional[float]) -> str:
    return "unknown" if x is None else f"{x:,.0f}"


def _pct(x: Optional[float]) -> str:
    """A share as a percentage, with two decimals below 1% so a small threshold never reads as 0.1%."""
    return "unknown" if x is None else f"{x * 100:.2f}%" if x < 0.01 else f"{x * 100:.1f}%"


def _kind_label(kind: str) -> str:
    return {"observed": "Recorded fact", "model": "Model output", "rule": "Fixed rule"}.get(kind, "Recorded fact")


def _items(ra: dict, side: Optional[str] = None) -> list[dict]:
    out = []
    for i in ra.get("evidence_items", []):
        s = i.get("side") or ("suspicion" if i["category"] in roles.SUSPICION_SIDE else "context")
        if side is None or s == side:
            out.append({"kind": i["kind"], "side": s, "category": i["category"], "text": i["text"]})
    return out


def _role_side(ra: dict) -> Optional[str]:
    if ra["role_candidate"] in VICTIM_CLASS or ra.get("may_be_victim"):
        return "victim"
    if ra["role_candidate"] in roles.INTERMEDIARY_ROLES:
        return "suspicion"
    return None


def priority(ra: dict) -> dict:
    """Review level for one assessed account (fixed mapping of the engine's restriction state, see module doc)."""
    role, state = ra["role_candidate"], ra["restriction"]["state"]
    kinds = roles.independent_kinds(ra["evidence_categories"])
    recorded = [i for i in ra.get("evidence_items", [])
                if i["kind"] == "observed" and i["category"] not in roles.CONTEXT_ONLY and i.get("side") != "context"]
    if ra.get("may_be_victim") or role in VICTIM_CLASS:
        level = 3 if state == "urgent_manual_review_recommended" else 2
        return {"level": level, "label": f"Level {level}: {PROTECTIVE[level]}", "track": "protective", "model_only": False,
                "capped": False, "basis": "The account may itself be a victim: protective verification with the holder, "
                                          "never a restriction."}
    if role in NO_LINK:
        return {"level": 1, "label": f"Level 1: {LEVELS[1]}", "track": "routine", "model_only": False, "capped": False,
                "basis": "No suspicious linkage or activity in the available records."}
    level = STATE_LEVEL.get(state) or (2 if kinds else 1)
    model_only = bool(kinds) and not recorded
    capped = model_only and level > 2
    if capped:
        level = 2
    if level == 1:
        basis = ("Not individually analysed in this run." if ra["assessment_status"] == "not_analyzed" else
                 "Too little history to assess." if ra["assessment_status"] == "insufficient_evidence" else
                 "Not enough evidence to describe a role.")
    elif level == 2:
        basis = "Suspicious-looking activity, but not enough independent evidence for urgent review."
        if model_only:
            basis += " Only model output points to it; no recorded fact in this trace does."
        if capped:
            basis += " Kept at level 2 because a model score alone never raises an account higher."
    else:
        basis = (f"{len(kinds)} independent kind(s) of evidence, including at least one recorded fact."
                 + (" The role engine suggests a temporary restriction may be considered by the authorized institution "
                    "after human review." if level == 4 else ""))
    return {"level": level, "label": f"Level {level}: {LEVELS[level]}", "track": "suspicion" if level >= 2 else "routine",
            "model_only": model_only, "capped": capped, "basis": basis}


def _flow_role(ra: dict, root_id: str) -> str:
    g = ra["graph_relationship"]
    pos, hop = g["position"], g["hop"]
    if ra["role_candidate"] == "cash_withdrawal_point":
        return f"Cash withdrawal point reached at hop {hop}: the ledger records cash leaving here and cannot follow it."
    if pos == "investigated":
        return "The investigated account."
    if pos == "downstream":
        s = f"Received {_m(g['received_traced_amount'])} in traced transfers, {hop} hop(s) after {root_id}"
        if g["sent_traced_amount"]:
            s += f"; its own traced outgoing transfers total {_m(g['sent_traced_amount'])}"
        if g["forwarded_at_least"] is not None or g["forwarded_at_most"] is not None:
            s += (f". Balance-based attribution: between {_m(g['forwarded_at_least'])} and {_m(g['forwarded_at_most'])} of the "
                  "traced money moved on")
        return s + "."
    if pos == "upstream":
        return f"Paid {_m(g['sent_traced_amount'])} into the traced flow, {hop} hop(s) before {root_id}."
    paid = g.get("paid_suspicious_account") or "a traced account"
    return f"Not on the traced path: sent its own flagged transfer of {_m(g['sent_traced_amount'])} into {paid}."


def _behaviour(ra: dict, own_flagged: int) -> str:
    am = ra["account_model"]
    status = am.get("status")
    if status == "scored":
        side = "at or above" if am.get("above_threshold") else "below"
        s = (f"Account behaviour model (model output): calibrated score {_pct(am['calibrated_probability'])}, {side} its "
             f"review threshold of {_pct(am['threshold'])}.")
    elif status == "reference_only":
        s = "Account behaviour model: not validated on this dataset, so its score is reference only."
    elif status == "insufficient_history":
        s = "Account behaviour model: too few records, so it abstains."
    elif status == "model_unavailable":
        s = "Account behaviour model: unavailable."
    else:
        s = "Account behaviour model: not run for this account in this investigation."
    if own_flagged:
        s += f" The transaction model flags {own_flagged} of its own traced outgoing transfer(s)."
    return s


def recommendation(ra: dict, pr: dict) -> dict:
    r = ra["restriction"]
    side = _role_side(ra)
    if side:
        support = _items(ra, side)
        other = "suspicion" if side == "victim" else "victim"
        against = [f"{_kind_label(i['kind'])}: {i['text']}" for i in _items(ra, other)]
    else:
        support = [i for i in _items(ra) if i["side"] != "context"]
        against = []
    against += [c for c in ra["contradictory_evidence"] if c not in against
                and not any(c.endswith(a.split(": ", 1)[-1]) for a in against)]
    reason = r["rationale"]
    if pr["capped"]:
        reason += " Only model output supports it, so the level stays at 2."
    verify = list(r["verification_needed"]) or ["Nothing to verify from this evidence alone."]
    if pr["track"] == "protective":
        verify = ["Confirm with the holder, through a verified channel, whether they made and authorised the flagged "
                  "transfers."] + [v for v in verify if "holder" not in v.lower()]
    return {
        "account_id": ra["account_id"], "role_candidate": ra["role_candidate"], "role_label": ra["role_label"],
        "level": pr["level"], "level_label": pr["label"], "track": pr["track"], "model_only": pr["model_only"],
        "action": ACTIONS[ra["role_candidate"]], "reason": reason,
        "supporting_evidence": [{"kind": i["kind"], "text": i["text"]} for i in support],
        "contradictory_evidence": against,
        "innocent_explanations": list(r["innocent_explanations"]),
        "verify_before_action": verify,
        "authorised_by": PROTECTIVE_AUTHORISER if pr["track"] == "protective" else AUTHORISERS[pr["level"]],
        "victim_note": r.get("victim_note"),
        "restriction_state": r["state"], "restriction_label": r["label"],
        "action_executed": False,
    }


def _connected(ra: dict, pr: dict, root_id: str, own_flagged: int) -> dict:
    side = _role_side(ra)
    ev = _items(ra, side) if side else [i for i in _items(ra) if i["side"] != "context"]
    return {
        "account_id": ra["account_id"], "role_candidate": ra["role_candidate"], "role_label": ra["role_label"],
        "assessment_status": ra["assessment_status"], "position": ra["graph_relationship"]["position"],
        "hop": ra["graph_relationship"]["hop"], "flow_role": _flow_role(ra, root_id), "behaviour": _behaviour(ra, own_flagged),
        "evidence": [{"kind": i["kind"], "text": i["text"]} for i in ev[:4]],
        "evidence_strength": ra["evidence_strength"], "level": pr["level"], "level_label": pr["label"], "track": pr["track"],
        "recommended_action": ACTIONS[ra["role_candidate"]], "next_check": ra["recommended_next_check"],
        "may_be_victim": ra["may_be_victim"],
    }


def _chronology(out: dict, base: dict, root_rows: list[dict], root_scores: dict, funding: dict, root_id: str) -> dict:
    use = bool(out["model_validation"]["validated_for_this_dataset"])
    thr = (out["model_metadata"].get("transaction_model") or {}).get("threshold")
    flagged = {d["transaction_id"] for d in out["suspicious_transactions"]}
    unc = {d["transaction_id"] for d in out["uncorroborated_rule_flags"]}
    rule_flags = {e["transaction_id"]: [f for f in e["flags"] if f["code"] != "MODEL_TRANSACTION_RISK"] for e in base["trace"]["edges"]}
    branch_of = defaultdict(list)
    for b in out["fund_trace"]["branches"]:
        for t in b["transaction_ids"]:
            if b["branch_id"] not in branch_of[t]:
                branch_of[t].append(b["branch_id"])
    traced = {e["transaction_id"] for e in base["trace"]["edges"] if root_id in (e["origin_account_id"], e["destination_account_id"])}
    anchors = sorted(r["timestamp"] for r in root_rows if r["transaction_id"] in flagged | traced | unc)
    import pandas as pd  # local: keeps module import light for the schema

    win = pd.Timedelta(hours=CONTEXT_WINDOW_HOURS)
    stamps = [pd.Timestamp(a) for a in anchors]

    def near(ts: str) -> bool:
        t = pd.Timestamp(ts)
        return any(abs(t - s) <= win for s in stamps)

    key = [r for r in root_rows if r["transaction_id"] in flagged | traced | unc]
    ctx = [r for r in root_rows if r not in key and stamps and near(r["timestamp"])]
    note = (f"Flagged and traced transfers of {root_id}, with its other transfers from {CONTEXT_WINDOW_HOURS:g} h before to "
            f"{CONTEXT_WINDOW_HOURS:g} h after them for context.")
    if not key:
        ctx = root_rows[-10:]
        note = f"No transfer of {root_id} is flagged or traced; its 10 latest transfers are shown for context."
    rows = sorted(key + ctx, key=lambda r: (r["timestamp"], r["transaction_id"]))
    omitted = 0
    if len(rows) > MAX_CHRONOLOGY:
        keep = {r["transaction_id"] for r in key}
        ctx_keep = sorted(ctx, key=lambda r: min(abs(pd.Timestamp(r["timestamp"]) - s) for s in stamps) if stamps else 0)
        room = max(0, MAX_CHRONOLOGY - len(keep))
        keep |= {r["transaction_id"] for r in ctx_keep[:room]}
        omitted = len(rows) - len(keep)
        rows = [r for r in rows if r["transaction_id"] in keep]
    unf, mat = set(funding.get("unfunded", [])), set(funding.get("matched", []))
    out_rows = []
    for r in rows:
        tid = r["transaction_id"]
        outgoing = r["sender_account_id"] == root_id
        s = root_scores.get(tid)
        why = []
        if s and s.get("model_flag"):
            txt = (f"Flagged by the transaction model: calibrated score {_pct(s['calibrated_probability'])} is at or above "
                   f"its review threshold of {_pct(thr)}." if thr is not None and s.get("calibrated_probability") is not None
                   else "Flagged by the transaction model.")
            if s.get("evidence_use") == "reference_only":
                txt += " Reference only on this dataset: not evidence."
            why.append(txt)
        for f in rule_flags.get(tid, []):
            why.append(f"Fixed rule: {f['explanation']}")
        if tid in unc:
            why.append("The fixed rules flag it but the validated transaction model does not; shown, not used as evidence.")
        if outgoing and tid in unf:
            why.append("Paid with its own money: no money it had just received from a new payer covered it.")
        elif outgoing and tid in mat:
            why.append("Covered by money it had received in the previous 24 h from a new payer; its own earlier balance was "
                       "not drawn down to pay it.")
        elif outgoing and tid in flagged and tid in set(funding.get("flagged", [])):
            why.append("Paid out of money it had just received from a new payer, which its own earlier balance could not have "
                       "covered.")
        if tid in traced:
            why.append(f"Traced: branch {', '.join(branch_of.get(tid, [])) or 'of the trace'}.")
        if not why:
            why.append(f"Context: within {CONTEXT_WINDOW_HOURS:g} h of a flagged or traced transfer." if stamps else
                       "Context: one of its latest transfers.")
        bal_before = r["sender_balance_before"] if outgoing else r["receiver_balance_before"]
        out_rows.append({
            "transaction_id": tid, "timestamp": r["timestamp"], "direction": "outgoing" if outgoing else "incoming",
            "counterparty": r["receiver_account_id"] if outgoing else r["sender_account_id"],
            "amount": r["amount"], "channel": r.get("channel"),
            "balance_before": bal_before,
            "balance_after": None if bal_before is None else round(bal_before - r["amount"] if outgoing else bal_before + r["amount"], 2),
            "model_flag": bool(s and s.get("model_flag")),
            "calibrated_probability": s.get("calibrated_probability") if s else None,
            "evidence_use": s.get("evidence_use") if s else None,
            "rule_flags": [f["code"] for f in rule_flags.get(tid, [])],
            "flagged": tid in flagged, "traced": tid in traced, "branch_ids": branch_of.get(tid, []),
            "selected_because": why,
        })
    return {"rows": out_rows, "window_note": note, "omitted": omitted, "model_threshold": thr,
            "model_evidence_use": "evidence" if use else "reference_only"}


def _fund_flow(out: dict, base: dict, ras: dict, root_id: str) -> dict:
    edges = base["trace"]["edges"]
    exp = base["exposure"]
    hops: dict[tuple, dict] = {}
    for e in edges:
        k = (e["direction"], e["hop"])
        h = hops.setdefault(k, {"direction": e["direction"], "hop": e["hop"], "transfers": 0, "total": 0.0, "accounts": []})
        h["transfers"] += 1
        h["total"] = round(h["total"] + e["amount"], 2)
        acc = e["destination_account_id"] if e["direction"] == "downstream" else e["origin_account_id"]
        if acc not in h["accounts"]:
            h["accounts"].append(acc)
    first = [{"account_id": e["destination_account_id"], "transaction_id": e["transaction_id"], "amount": e["amount"],
              "timestamp": e["timestamp"], "channel": e["channel"]}
             for e in edges if e["direction"] == "downstream" and e["hop"] == 1]
    sources = [{"account_id": e["origin_account_id"], "transaction_id": e["transaction_id"], "amount": e["amount"],
                "timestamp": e["timestamp"], "channel": e["channel"]}
               for e in edges if e["direction"] == "upstream" and e["hop"] == 1]
    earliest = []
    for b in out["fund_trace"]["branches"]:
        if b["direction"] == "upstream" and b["accounts"]:
            a = b["accounts"][-1]
            if a not in [x["account_id"] for x in earliest]:
                earliest.append({"account_id": a, "branch_id": b["branch_id"], "hops_before": len(b["transaction_ids"])})
    cash = [{"account_id": e["origin_account_id"], "cash_point": e["destination_account_id"], "transaction_id": e["transaction_id"],
             "amount": e["amount"], "timestamp": e["timestamp"]}
            for e in edges if e["direction"] == "downstream" and e["channel"] == "ATM_CASH_OUT"]
    conv = [{"transaction_id": e["transaction_id"], "from_account": e["origin_account_id"], "to_account": e["destination_account_id"],
             "amount": e["amount"]} for e in edges if e.get("converges")]
    multi = sorted(a for a, r in ras.items() if r["graph_relationship"]["traced_paths_in"] >= 2)
    branches = [{"branch_id": b["branch_id"], "direction": b["direction"], "accounts": b["accounts"], "amounts": b["amounts"],
                 "transaction_ids": b["transaction_ids"], "ending_reason": b["ending"]["reason"], "ending_detail": b["ending"]["detail"]}
                for b in out["fund_trace"]["branches"]]
    cycles = [b for b in branches if b["ending_reason"] == "cycle_detected"]
    open_ends = {"maximum_depth_reached", "maximum_node_limit_reached", "per_account_limit_applied", "incomplete_or_missing_data"}
    untraced = [{"branch_id": b["branch_id"], "account_id": b["accounts"][-1], "last_amount": b["amounts"][-1] if b["amounts"] else None,
                 "reason": b["ending_reason"], "detail": b["ending_detail"]}
                for b in branches if b["ending_reason"] in open_ends]
    per_acc = []
    for x in exp.get("per_account", []):
        a = x["account_id"]
        ra = ras.get(a)
        recv = x.get("traced_in_amount")
        fmax = x.get("forwarded_max")
        per_acc.append({
            "account_id": a, "hop": x.get("hop"), "role_label": ra["role_label"] if ra else None,
            "received_traced": recv, "forwarded_at_least": x.get("forwarded_min"), "forwarded_at_most": fmax,
            "kept_at_least": round(recv - fmax, 2) if recv is not None and fmax is not None else None,
            "cash_withdrawn": round(sum(c["amount"] for c in cash if c["account_id"] == a), 2),
        })
    return {
        "investigated_account": root_id,
        "flagged_outgoing_total": exp.get("flagged_outgoing_total"),
        "traced_outgoing_total": exp.get("traced_outgoing_total"),
        "sources": sources, "earliest_sources": earliest, "first_recipients": first,
        "hops": sorted(hops.values(), key=lambda h: (h["direction"] != "downstream", h["hop"])),
        "recipients": sorted({e["destination_account_id"] for e in edges if e["direction"] == "downstream"}),
        "attribution": per_acc, "branches": branches, "cycles": cycles, "convergence": conv,
        "reached_by_several_paths": multi, "cash_endings": cash, "untraced": untraced,
        "truncation_notes": out["fund_trace"]["truncation_notes"],
        "method": exp.get("method"),
        "amount_note": ("Amounts at each hop are what the recorded transfers carried. They are not added together and are not "
                        "a loss figure: the same money can be counted at every hop, and a recipient's onward transfers can "
                        "include its own money. Only the balance-based ranges say how much of the traced money itself moved on."),
    }


def _findings(out: dict, base: dict, ras: dict, prs: dict, root_id: str, recs: list[dict]) -> dict:
    root = ras[root_id]
    use = bool(out["model_validation"]["validated_for_this_dataset"])
    sent = [d for d in out["suspicious_transactions"] if d["sender_account_id"] == root_id]
    recv = [d for d in out["suspicious_transactions"] if d["receiver_account_id"] == root_id]
    recorded, model_only, unknown = [], [], []
    if sent:
        recorded.append(f"{root_id} sent {len(sent)} flagged transfer(s) totalling {_m(sum(d['amount'] for d in sent))} "
                        f"({', '.join(d['transaction_id'] for d in sent[:4])}).")
    if recv:
        recorded.append(f"{root_id} received {len(recv)} flagged transfer(s) totalling {_m(sum(d['amount'] for d in recv))}.")
    recorded += [i["text"] for i in root.get("evidence_items", []) if i["kind"] == "observed" and i.get("side") != "context"]
    for a, ra in ras.items():
        if a == root_id or prs[a]["level"] < 3:
            continue
        obs = [i["text"] for i in ra.get("evidence_items", []) if i["kind"] == "observed" and i.get("side") != "context"]
        if obs:
            recorded.append(f"{a}: {obs[0]}")
    cash = [e for e in base["trace"]["edges"] if e["direction"] == "downstream" and e["channel"] == "ATM_CASH_OUT"]
    if cash:
        recorded.append(f"{len(cash)} traced transfer(s) were cash withdrawals ({_m(sum(e['amount'] for e in cash))} in total); "
                        "the ledger cannot follow cash.")
    for a, ra in ras.items():
        items = [i for i in ra.get("evidence_items", []) if i.get("side") != "context"]
        if items and all(i["kind"] == "model" for i in items):
            model_only.append(f"{a}: only model output points to it ({'; '.join(i['text'] for i in items[:2])})")
    if not use:
        model_only.insert(0, "The models are not validated on this dataset: their outputs are shown for reference only and "
                             "support no finding.")
    if root.get("uncertainty_reason"):
        unknown.append(root["uncertainty_reason"])
    unknown.append("Whether any holder authorised or knew about the transfers: a ledger records payments, not intent.")
    unknown.append(out["data_coverage"]["note"])
    unknown += out["fund_trace"]["truncation_notes"]
    not_analyzed = [a for a, ra in ras.items() if ra["assessment_status"] == "not_analyzed"]
    if not_analyzed:
        unknown.append(f"{len(not_analyzed)} account(s) were not individually analysed (account limit): {', '.join(not_analyzed[:6])}.")
    thin = out["data_coverage"].get("accounts_with_insufficient_history") or []
    if thin:
        unknown.append(f"{len(thin)} account(s) have too little history for the account behaviour model: {', '.join(thin[:6])}.")
    records = list(base.get("records_to_request") or [])
    if any(r["track"] == "protective" for r in recs) and not any("holder" in x.lower() for x in records):
        records.append("The holder's own account of the flagged transfers, obtained through a verified channel.")
    return {
        "recorded_evidence": list(dict.fromkeys(recorded)),
        "model_output_only": model_only,
        "unknown": list(dict.fromkeys(unknown)),
        "urgent_review": [r["account_id"] for r in recs if r["track"] == "suspicion" and r["level"] >= 3],
        "enhanced_verification": [r["account_id"] for r in recs if r["track"] == "suspicion" and r["level"] == 2],
        "protective_verification": [r["account_id"] for r in recs if r["track"] == "protective"],
        "no_action": [r["account_id"] for r in recs if r["level"] == 1],
        "records_to_obtain": records,
    }


def build(out: dict, base: dict, root_rows: list[dict], root_scores: dict, funding: dict) -> dict:
    """The investigator report for one investigation. ``out`` is the dynamic response without the report, ``base`` the
    trace report, ``root_rows`` the investigated account's recorded transfers (time order), ``root_scores`` the model
    results for them, and ``funding`` how its flagged outgoing transfers were funded (engine._unfunded)."""
    root_id = out["account_summary"]["account_id"]
    ras = {a["account_id"]: a for a in out["role_assessments"]}
    root = ras[root_id]
    prs = {a: priority(r) for a, r in ras.items()}
    own_flagged = defaultdict(int)
    for d in out["transaction_scores"]:
        if d["model_flag"] and d["evidence_use"] == "evidence":
            own_flagged[d["sender_account_id"]] += 1
    order = sorted(ras, key=lambda a: (a != root_id, -prs[a]["level"], ORDER.get(ras[a]["graph_relationship"]["position"], 9),
                                       ras[a]["graph_relationship"]["hop"] or 0, a))
    recs = [recommendation(ras[a], prs[a]) for a in order]
    side = _role_side(root)
    pr = prs[root_id]
    lean = {"victim": "victim", "suspicion": "intermediary" if root["role_candidate"] == "potential_intermediary"
            else "suspicious_account"}.get(side or "", "none" if root["role_candidate"] in NO_LINK else "undetermined")
    lean_text = {
        "victim": "More consistent with a victim than with an intermediary or a suspicious account.",
        "intermediary": "More consistent with an intermediary (receiving money and passing it on) than with a victim.",
        "suspicious_account": "More consistent with a collection or cash-out account than with a victim.",
        "none": "No suspicious activity observed in the available records.",
        "undetermined": "Neither a victim pattern nor an intermediary pattern is established by the evidence.",
    }[lean]
    main = _items(root, side) if side else [i for i in _items(root) if i["side"] != "context"]
    uncertainty = [x for x in [root.get("uncertainty_reason")] if x]
    uncertainty += [c for c in root["contradictory_evidence"] if c not in uncertainty][:4]
    if not out["model_validation"]["validated_for_this_dataset"]:
        uncertainty.append(out["model_validation"]["note"])
    if not out["account_summary"].get("history_sufficient", True):
        uncertainty.append("The investigated account has little recorded history, so comparisons with its own past are weak.")
    am_meta = out["model_metadata"].get("account_model") or {}
    tm_meta = out["model_metadata"].get("transaction_model") or {}
    flagged_root = [d for d in out["suspicious_transactions"] if root_id in (d["sender_account_id"], d["receiver_account_id"])]
    ts = out["transaction_scoring"]
    rule_flags = [{"transaction_id": e["transaction_id"], "code": f["code"], "explanation": f["explanation"]}
                  for e in base["trace"]["edges"] if root_id in (e["origin_account_id"], e["destination_account_id"])
                  for f in e["flags"] if f["code"] != "MODEL_TRANSACTION_RISK"]
    am = root["account_model"]
    return {
        "report_version": REPORT_VERSION,
        "generator": GENERATOR,
        "notice": NOTICE,
        "executive_summary": {
            "account_id": root_id, "dataset_id": out["dataset"]["dataset_id"], "dataset_title": out["dataset"]["title"],
            "data_as_of": out["data_coverage"].get("data_as_of"), "synthetic": bool(out["dataset"]["source"].get("is_synthetic")),
            "candidate_role": root["role_candidate"], "candidate_role_label": root["role_label"],
            "assessment_status": root["assessment_status"], "headline": root["headline"],
            "review_level": pr["level"], "review_level_label": pr["label"], "review_track": pr["track"],
            "leaning": lean, "leaning_text": lean_text,
            "main_reasons": [{"kind": i["kind"], "text": i["text"]} for i in main[:5]],
            "evidence_strength": root["evidence_strength"],
            "uncertainty": uncertainty,
        },
        "risk_assessment": {
            "transaction_model": {
                "available": bool(tm_meta.get("available")), "version": tm_meta.get("model_version"),
                "threshold": tm_meta.get("threshold"), "used_as_evidence": bool(ts.get("model_used_as_evidence")),
                "scored_on_account": ts.get("scored_on_investigated_account"), "flagged_on_account": ts.get("flagged_on_investigated_account"),
                "flagged_transfers": [{"transaction_id": d["transaction_id"], "timestamp": d["timestamp"],
                                       "direction": "outgoing" if d["sender_account_id"] == root_id else "incoming",
                                       "counterparty": d["receiver_account_id"] if d["sender_account_id"] == root_id else d["sender_account_id"],
                                       "amount": d["amount"], "calibrated_probability": d["calibrated_probability"],
                                       "factors": [f["label"] for f in d["model_factors"][:3]]} for d in flagged_root],
            },
            "account_model": {
                "available": bool(am_meta.get("available")), "version": am.get("model_version") or am_meta.get("model_version"),
                "status": am.get("status"), "calibrated_probability": am.get("calibrated_probability"),
                "threshold": am.get("threshold") or am_meta.get("threshold"), "above_threshold": am.get("above_threshold"),
                "factors": [{"label": f["label"], "contribution": f["contribution"]} for f in (am.get("factors") or [])[:3]],
                "positive_target": "Trained to recognise pass-through and collection behaviour (scenario intermediaries and "
                                   "attacker-controlled accounts). It is not a victim-versus-fraud classifier.",
            },
            "rules": {"flags_on_account": rule_flags,
                      "uncorroborated": [d["transaction_id"] for d in out["uncorroborated_rule_flags"]],
                      "role_rule": root["headline"]},
            "model_support": {"state": out["model_validation"]["support_state"],
                              "validated_for_this_dataset": out["model_validation"]["validated_for_this_dataset"],
                              "note": out["model_validation"]["note"]},
            "evidence_strength": root["evidence_strength"],
            "victim_side_evidence": [{"kind": i["kind"], "text": i["text"]} for i in _items(root, "victim")],
            "suspicion_side_evidence": [{"kind": i["kind"], "text": i["text"]} for i in _items(root, "suspicion")],
            "context": [{"kind": i["kind"], "text": i["text"]} for i in _items(root, "context")],
            "contradictory_evidence": root["contradictory_evidence"],
            "innocent_explanations": root["restriction"]["innocent_explanations"],
            "missing_information": root["restriction"]["missing_information"],
            "score_note": SCORE_NOTE,
        },
        "chronology": _chronology(out, base, root_rows, root_scores, funding, root_id),
        "fund_flow": _fund_flow(out, base, ras, root_id),
        "connected_accounts": [_connected(ras[a], prs[a], root_id, own_flagged.get(a, 0)) for a in order if a != root_id],
        "recommendations": recs,
        "findings": _findings(out, base, ras, prs, root_id, recs),
        "safeguards": SAFEGUARDS,
    }
