"""Dynamic investigation: account ID in, evidence-linked investigation out.

Order of work (each step's duration is reported in ``processing_steps``):
 1. Look the account up in the chosen dataset (404 if absent; nothing is invented for a missing account).
 2. Load its history and its counterparties' histories (indexed reads, no full-ledger scan).
 3. Score each of its transfers with the transaction model, using only records before each transfer.
 4. Run the existing bounded trace and per-account assessment (graph_tracer + investigation.py), seeded from transfers
    flagged by the rules or the transaction model.
 5. Score every traced transfer; score the analysed accounts with the account behaviour model; compute graph context.
 6. Look for other senders into suspicious accounts whose own transfer is flagged (other possibly affected accounts).
 7. Assess each account's role and the advisory restriction state (roles.py); split the trace into branches with an
    ending reason each.
Ground-truth columns are never selected or read. Nothing is written; no account is acted upon.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
import pandas as pd
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

try:
    from app.api.v2.investigation_schemas import InvestigationRequest
    from app.db.v2.models import AccountModel, TransactionModel
    from app.intelligence import explain, ledger, roles
    from app.intelligence import models as mdl
    from app.intelligence.datasets import DATASETS, DatasetRegistry
    from app.intelligence.features import MIN_ACCOUNT_TRANSACTIONS, account_features, graph_features, transaction_features
    from app.services.v2.data_source import DataSourceUnavailable
    from app.services.v2.investigation import AccountNotFound, InvestigationService
except ModuleNotFoundError:
    from backend.app.api.v2.investigation_schemas import InvestigationRequest
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.intelligence import explain, ledger, roles
    from backend.app.intelligence import models as mdl
    from backend.app.intelligence.datasets import DATASETS, DatasetRegistry
    from backend.app.intelligence.features import MIN_ACCOUNT_TRANSACTIONS, account_features, graph_features, transaction_features
    from backend.app.services.v2.data_source import DataSourceUnavailable
    from backend.app.services.v2.investigation import AccountNotFound, InvestigationService

ENGINE_VERSION = "dynamic-investigation-1.0.0"
# What kind of source each evidence category comes from: a recorded fact, a model output or a fixed rule.
EVIDENCE_KIND = {"ONWARD": "observed", "NETWORK": "observed", "CASH": "observed", "NEW_RECORDS": "observed",
                 "FUNDED_FORWARD": "observed", "FLAGGED_IN_MOVED": "observed",
                 "ACCOUNT_MODEL": "model", "TXN_MODEL": "model"}
# Sentences that state what a model output (its flag, score or threshold), as opposed to a recorded transfer or balance.
MODEL_SENTENCE = re.compile(r"\b(?:transaction model|account (?:behaviour )?model|model (?:flags|score|scores|suggests))\b", re.IGNORECASE)
# A payer that already paid the account at least this many days before an inflow (a salary, a regular family or rent
# transfer) is an established income source: its payment is not money handed over to be passed on, so it never makes
# a flagged outgoing transfer "funded forwarding". Scenario money moves within hours or a few days (the trace window),
# so a week separates the two without depending on any ledger's results.
RECURRING_PAYER_DAYS = 7
# How many of the investigated account's own unflagged outgoing transfers to show with their score and the threshold.
CLOSEST_UNFLAGGED = 3
MAX_OTHER_SENDERS = 15
MAX_HUB_INFLOWS = 50       # largest inflows examined per suspicious account
MAX_CANDIDATE_SENDERS = 60  # senders whose histories are loaded to score their transfer
HIGH_PROBABILITY = 0.5

ENDINGS = {
    "cycle_detected": "Cycle detected: the money returned to an account already on this path.",
    "already_examined_on_another_branch": "Account already reached on another branch, so it is not followed a second time.",
    "joins_opposite_direction_trace": "This part of the flow is already traced from the other side of the investigated account, "
                                      "so it is not repeated here.",
    "maximum_depth_reached": "Maximum depth reached: this account has further transfers in the window that were not followed.",
    "maximum_node_limit_reached": "Maximum account limit reached: further transfers from here were not added.",
    "per_account_limit_applied": "Only this account's largest transfers in the window were followed; others may continue.",
    "cash_withdrawal_recorded": "Recorded as a cash withdrawal; the ledger cannot follow cash any further.",
    "no_further_transaction_in_window": "No further outgoing transfer found in the available window.",
    "no_earlier_transaction_in_window": "No earlier incoming transfer found in the available window.",
    "incomplete_or_missing_data": "The account's records are not in this dataset, so the trail cannot continue.",
}


def _iso(ts) -> str:
    return pd.Timestamp(ts).isoformat()


class StepClock:
    def __init__(self):
        self.steps: list[dict] = []
        self._t = time.perf_counter()

    def done(self, step: str, label: str, detail: str) -> None:
        now = time.perf_counter()
        self.steps.append({"step": step, "label": label, "duration_ms": int((now - self._t) * 1000), "detail": detail})
        self._t = now


def _load_models() -> tuple[Optional[mdl.ScoringModel], Optional[mdl.ScoringModel], dict]:
    status = {}
    out = []
    for name in ("transaction_model", "account_model"):
        try:
            m = mdl.load(name)
            out.append(m)
            status[name] = None
        except mdl.ModelArtifactUnavailable as exc:
            out.append(None)
            status[name] = str(exc)
    return out[0], out[1], status


def _risk_category(p: Optional[float], above: bool) -> str:
    if p is None or np.isnan(p):
        return "not_scored"
    if above and p >= HIGH_PROBABILITY:
        return "high"
    return "elevated" if above else "low"


def model_metadata(m: Optional[mdl.ScoringModel], error: Optional[str], purpose: str) -> dict:
    if m is None:
        return {"available": False, "purpose": purpose, "unavailable_reason": error}
    meta = m.meta
    met = meta.get("metrics", {})
    cold = met.get("cold_ledger_test") or {}
    return {
        "available": True, "purpose": purpose, "model_version": meta["model_version"], "family": meta["family"],
        "feature_schema_version": meta["feature_schema_version"], "trained_at": meta["environment"]["trained_at"],
        "training_data": meta.get("dataset") or {"source": "forensic-scenarios (synthetic)", "generator_version": meta.get("generator_version")},
        "label_definition": meta.get("label_definition"),
        "threshold": meta["threshold"]["value"], "threshold_rule": meta["threshold"]["rule"],
        "calibration": meta["calibration"]["method"], "calibrated_on": meta["calibration"].get("fitted_on"),
        "held_out_evaluation": {k: cold.get(k) for k in ("n", "positives", "precision", "recall", "pr_auc", "brier")} if cold else None,
        "score_semantics": "Model score = raw model output. Calibrated probability = the rate at which synthetic validation "
                           "cases with this score were scenario cases; it is not a probability that a person committed fraud.",
    }


# Trace-report recommendations about restricting or escalating an account. The role engine's restriction state
# supersedes them for every account it assessed, so they are dropped there instead of contradicting it.
SUPERSEDED_ACTIONS = ("consider_escalation", "further_review")


def drop_superseded_recommendations(base: dict, assessed: set[str]) -> None:
    """Removes those recommendations from the trace report and from its template answer that lists them."""
    gone = [r for r in base["recommendations"] if r["action"] in SUPERSEDED_ACTIONS and r["account_id"] in assessed]
    if not gone:
        return
    texts = {r["statement"] for r in gone}
    base["recommendations"] = [r for r in base["recommendations"] if r not in gone]
    for section in base["evidence_summary"]:
        if section["claims"] and all(c["kind"] == "interpretation" for c in section["claims"]):
            section["claims"] = [c for c in section["claims"] if c["text"] not in texts]


class DynamicInvestigation:
    @classmethod
    def compute(cls, registry: DatasetRegistry, demo_db: Session, req) -> tuple[dict, dict, float]:
        """Returns (dynamic sections, base investigation report, perf_counter start)."""
        clock = StepClock()
        t_start = time.perf_counter()
        started = datetime.now(timezone.utc)
        ok, why = registry.available(req.dataset_id)
        if not ok:
            raise DataSourceUnavailable("dataset_unavailable", why)
        db = demo_db if req.dataset_id == "demo-ledger" else registry.open(req.dataset_id)
        try:
            return cls._compute(registry, db, req, clock, started, t_start)
        finally:
            if db is not demo_db:
                db.close()

    @classmethod
    def _compute(cls, registry, db: Session, req, clock: StepClock, started, t_start):
        source = registry.describe(req.dataset_id, db)
        root_id = req.account_id
        acc = db.scalar(select(AccountModel).where(AccountModel.account_id == root_id))
        if acc is None:
            raise AccountNotFound(root_id)
        tm, am, model_err = _load_models()
        ds = source["source_kind"]
        # Model outputs count as evidence only where validated on this generator family AND in distribution
        # (DatasetSpec.model_support); otherwise they are reference only.
        use = DATASETS[req.dataset_id].model_support == "validated_in_distribution"
        root_hist = ledger.account_history(db, [root_id], ds)
        clock.done("lookup", "Loading account history", f"{len(root_hist)} transfer(s) found for {root_id}.")

        cps = ledger.counterparties(root_hist, [root_id])
        local = ledger.account_history(db, {root_id} | cps, ds)
        root_rows = local.index[(local.sender_account_id == root_id) | (local.receiver_account_id == root_id)]
        X_root = transaction_features(local, root_rows) if len(root_rows) else None
        clock.done("features", "Generating historical features",
                   f"Point-in-time features for {len(root_rows)} transfer(s) from {len(local)} records of {len(cps) + 1} account(s).")

        scored: dict[str, dict] = {}
        model_flags: dict[str, list[dict]] = {}
        root_p: dict[str, float] = {}  # unrounded calibrated scores of its own transfers (for closest_unflagged_transfers)
        if tm is not None and X_root is not None:
            s = tm.score(X_root)
            facs = explain.top_factors(tm, X_root.loc[s.index[s["above_threshold"]]]) if s["above_threshold"].any() else []
            fac_iter = iter(facs)
            for i, row in s.iterrows():
                r = local.loc[i]
                d = cls._scored(r, row, next(fac_iter) if row["above_threshold"] else [], use)
                scored[r.transaction_id] = d
                if not pd.isna(row["calibrated_probability"]):
                    root_p[r.transaction_id] = float(row["calibrated_probability"])
                if use and row["above_threshold"] and r.sender_account_id == root_id:
                    model_flags[r.transaction_id] = [{
                        "code": "MODEL_TRANSACTION_RISK",
                        "explanation": f"Transaction model ({tm.version}) calibrated score {d['calibrated_probability']:.1%} is at or "
                                       f"above its validated review threshold of {tm.threshold:.1%}.",
                    }]
        n_flag = sum(1 for d in scored.values() if d["model_flag"])
        clock.done("detect", "Detecting suspicious transactions",
                   ("Transaction model unavailable; only the fixed rules were applied." if tm is None else
                    f"{len(scored)} transfer(s) scored; {n_flag} at or above the transaction model's threshold"
                    + ("." if use else " (reference only: the model is not validated on this dataset, so the fixed rules decide).")))

        base_req = InvestigationRequest(account_id=root_id, max_depth=req.max_depth, max_nodes=req.max_nodes,
                                        onward_window_hours=req.onward_window_hours, trace_scope="flagged",
                                        max_accounts_analyzed=req.max_accounts_analyzed, ai_explanation="separate")
        # The V2 account model is validated on the demo ledger only; elsewhere its scores and findings are left out.
        base, _, flow = InvestigationService.compute_with_trace(db, base_req, source=source, extra_flags=model_flags,
                                                                use_v2_model=req.dataset_id == "demo-ledger")
        clock.done("trace", "Tracing funds", f"{len(flow.edges)} traced transfer(s) across {len(flow.node_hops)} account(s), "
                                              f"up to {flow.max_depth_reached} hop(s).")

        # ---------------------------------------------------------------- traced accounts
        trace_ids = set(flow.node_hops)
        need = trace_ids - ({root_id} | cps)  # accounts whose full history is not loaded yet
        extra = ledger.account_history(db, need, ds) if need else local.iloc[0:0]
        L1 = pd.concat([local, extra]).drop_duplicates("transaction_id").sort_values(["timestamp", "transaction_id"], kind="mergesort").reset_index(drop=True)
        edge_ids = [e.txn.transaction_id for e in flow.edges]
        if tm is not None and edge_ids:
            todo = L1.index[L1.transaction_id.isin(set(edge_ids) - set(scored))]
            if len(todo):
                Xe = transaction_features(L1, todo)
                se = tm.score(Xe)
                flagged_idx = se.index[se["above_threshold"]]
                facs = dict(zip(flagged_idx, explain.top_factors(tm, Xe.loc[flagged_idx]))) if len(flagged_idx) else {}
                for i, row in se.iterrows():
                    scored[L1.at[i, "transaction_id"]] = cls._scored(L1.loc[i], row, facs.get(i, []), use)

        analyzed = [a["account_id"] for a in base["accounts"] if a["analyzed"]]
        n_tx = {a: int(((L1.sender_account_id == a) | (L1.receiver_account_id == a)).sum()) for a in trace_ids}
        cps2 = ledger.counterparties(L1[L1.sender_account_id.isin(analyzed) | L1.receiver_account_id.isin(analyzed)], analyzed)
        more = cps2 - set(L1.sender_account_id) - set(L1.receiver_account_id)
        L2 = pd.concat([L1, ledger.account_history(db, more, ds)]).drop_duplicates("transaction_id") if more else L1
        afe = account_features(L1, analyzed).join(graph_features(L2, analyzed)) if analyzed else pd.DataFrame()
        acc_model: dict[str, dict] = {}
        for a in trace_ids:
            if a not in analyzed:
                acc_model[a] = {"status": "not_analyzed"}
            elif am is None:
                acc_model[a] = {"status": "model_unavailable", "reason": model_err["account_model"]}
            elif afe.at[a, "n_transactions"] < MIN_ACCOUNT_TRANSACTIONS:
                acc_model[a] = {"status": "insufficient_history", "n_transactions": int(afe.at[a, "n_transactions"]),
                                "reason": f"Fewer than {MIN_ACCOUNT_TRANSACTIONS} transfers on record; the model abstains."}
        scorable = [a for a in analyzed if a not in acc_model]
        if scorable:
            sb = am.score(afe.loc[scorable])
            facs = explain.top_factors(am, afe.loc[scorable])
            for a, f in zip(scorable, facs):
                r = sb.loc[a]
                acc_model[a] = {"status": "scored", "model_version": am.version, "model_score": round(float(r.model_score), 4),
                                "calibrated_probability": round(float(r.calibrated_probability), 4),
                                "above_threshold": bool(r.above_threshold), "threshold": am.threshold,
                                "outside_training_range": int(r.outside_training_range) >= 3, "factors": f,
                                "n_transactions": int(afe.at[a, "n_transactions"])}
        clock.done("counterparties", "Examining counterparties",
                   f"{len(analyzed)} account(s) analysed with {len(L2)} records; {sum(1 for v in acc_model.values() if v['status'] == 'scored')} "
                   "scored by the account behaviour model.")

        # ---------------------------------------------------------------- evidence per account
        ev = cls._evidence(root_id, base, flow, L1, afe, acc_model, scored, n_tx, req, use)
        others = cls._other_senders(db, ds, root_id, ev, flow, tm, req, loaded=L1) if use else []
        results = {a: roles.assess(e) for a, e in ev.items()}
        for e, r in others:
            ev[e.account_id], results[e.account_id] = e, r
        assessments = [cls._role_out(ev[a], results[a], scored, flow) for a in ev]
        branches = cls._branches(flow, req, L1)
        clock.done("report", "Preparing investigation results", f"{len(assessments)} account(s) assessed; {len(branches)} branch(es).")
        drop_superseded_recommendations(base, {a["account_id"] for a in assessments})

        root_r = results[root_id]
        victim_status = {
            "potential_victim": "potential_victim", "suspicious_activity_victim_unconfirmed": "suspicious_activity_victim_status_unconfirmed",
            "no_suspicious_activity_observed": "no_suspicious_activity_observed", "potential_intermediary": "suspicious_activity_victim_status_unconfirmed",
            "potentially_suspicious_account": "suspicious_activity_victim_status_unconfirmed",
        }.get(root_r.role_candidate, "insufficient_evidence")
        rule_flags = {e["transaction_id"]: e["flags"] for e in base["trace"]["edges"] if e["flags"]}
        for d in scored.values():
            d["rule_flags"] = [f for f in rule_flags.get(d["transaction_id"], []) if f["code"] != "MODEL_TRANSACTION_RISK"]
        mine_ = [d for d in scored.values() if root_id in (d["sender_account_id"], d["receiver_account_id"])]
        suspicious = sorted([d for d in mine_ if (d["model_flag"] if use else bool(d["rule_flags"]))], key=lambda d: d["timestamp"])
        uncorroborated = sorted([d for d in mine_ if use and d["rule_flags"] and not d["model_flag"]], key=lambda d: d["timestamp"])
        groups: dict[str, list[str]] = defaultdict(list)
        for a in assessments:
            if a["account_id"] != root_id:
                groups[roles.GROUP_OF_ROLE[a["role_candidate"]]].append(a["account_id"])
        hist_first = root_hist["timestamp"].min() if len(root_hist) else None
        out = {
            "investigation_id": f"DYN-{uuid.uuid4().hex[:12].upper()}",
            "engine_version": ENGINE_VERSION,
            "started_at": started.isoformat(),
            "dataset": {"dataset_id": req.dataset_id, "title": DATASETS[req.dataset_id].title,
                        "description": DATASETS[req.dataset_id].description, "evaluation_labels_note": DATASETS[req.dataset_id].evaluation_labels_note,
                        "source": source},
            "account_summary": {
                "account_id": root_id, "exists": True, "customer_type": acc.customer_type,
                "transactions": int(len(root_hist)),
                "outgoing": int((root_hist.sender_account_id == root_id).sum()), "incoming": int((root_hist.receiver_account_id == root_id).sum()),
                "counterparties": len(cps), "first_transaction_at": _iso(hist_first) if hist_first is not None else None,
                "last_transaction_at": _iso(root_hist["timestamp"].max()) if len(root_hist) else None,
                "history_sufficient": len(root_hist) >= MIN_ACCOUNT_TRANSACTIONS,
            },
            "victim_assessment": {
                "account_id": root_id, "status": victim_status, "label": cls.VICTIM_LABELS[victim_status],
                "headline": root_r.headline, "role_candidate": root_r.role_candidate, "evidence": root_r.supporting,
                "contradictory_evidence": root_r.contradictory, "uncertainty_reason": root_r.uncertainty_reason,
            },
            "suspicious_transactions": suspicious,
            "uncorroborated_rule_flags": uncorroborated,
            "transaction_scores": sorted([d for t, d in scored.items() if t in set(edge_ids)], key=lambda d: d["timestamp"]),
            "transaction_scoring": {
                "scored": sum(1 for d in scored.values() if d["model_score"] is not None),
                # Scored transfers the investigated account sent or received (`scored` also counts traced counterparties').
                "scored_on_investigated_account": sum(1 for d in mine_ if d["model_score"] is not None),
                "flagged_by_model": sum(1 for d in scored.values() if d["model_flag"]),
                "flagged_on_investigated_account": n_flag,
                "model_available": tm is not None,
                "model_used_as_evidence": bool(use and tm is not None),
            },
            "closest_unflagged_transfers": cls._closest_unflagged(root_id, scored, root_p, {d["transaction_id"] for d in suspicious}, tm),
            "fund_trace": {"branches": branches, "transactions": len(flow.edges), "accounts": len(flow.node_hops),
                           "max_depth_reached": flow.max_depth_reached, "truncation_notes": flow.truncation_notes},
            "affected_accounts": {k: groups.get(k, []) for k in ("potential_victims", "potential_secondary_victims", "potential_intermediaries",
                                                                   "suspicious_accounts", "ordinary_counterparties", "unknown_roles",
                                                                   "cash_withdrawal_points")},
            "role_assessments": assessments,
            "network_findings": cls._network_findings(flow, ev, others),
            "restriction_recommendation": next(a["restriction"] for a in assessments if a["account_id"] == root_id),
            "data_coverage": {
                "investigated_account_transactions": int(len(root_hist)),
                "history_span_days": round((root_hist["timestamp"].max() - hist_first).total_seconds() / 86400, 1) if len(root_hist) > 1 else 0.0,
                "records_loaded": int(len(L2)), "accounts_in_trace": len(flow.node_hops), "accounts_analyzed": len(analyzed),
                "accounts_with_insufficient_history": sorted(a for a, v in acc_model.items() if v["status"] == "insufficient_history"),
                "trace_truncated": bool(flow.truncation_notes), "data_as_of": source["data_as_of"],
                "note": "Only records in this dataset are used. Counterparties at other institutions and anything off-ledger "
                        "(cash, devices, logins) are not visible.",
            },
            "model_validation": {"validated_for_this_dataset": use, "note": DATASETS[req.dataset_id].model_note,
                                 "support_state": DATASETS[req.dataset_id].model_support,
                                 "distribution_check": DATASETS[req.dataset_id].distribution_check},
            "model_metadata": {
                "transaction_model": model_metadata(tm, model_err["transaction_model"], "Risk of each transfer at the time it was made"),
                "account_model": model_metadata(am, model_err["account_model"], "Whether an account's own history looks like receiving and passing on or collecting scenario money"),
                "graph_analysis": {"available": True, "purpose": "Deterministic network facts (loops, convergence, onward movement, balance-draining senders)",
                                   "note": "Computed directly from the records; no model."},
                "rules": {"available": True, "purpose": "Fixed checks of each transfer against the account's own earlier transfers (investigation.py)"},
            },
            "limitations": cls._limitations(source, tm, am, flow, acc_model)
            + ([] if use else [DATASETS[req.dataset_id].model_note]),
            "processing_steps": clock.steps,
            "synthetic_data_notice": source["disclosure"],
            "automatic_actions_taken": [],
        }
        out["investigation_digest"] = cls.digest(out, base)
        out["completed_at"] = datetime.now(timezone.utc).isoformat()
        out["duration_ms"] = int((time.perf_counter() - t_start) * 1000)
        return out, base, t_start

    VICTIM_LABELS = {
        "potential_victim": "Potential victim",
        "suspicious_activity_victim_status_unconfirmed": "Suspicious activity detected, victim status unconfirmed",
        "no_suspicious_activity_observed": "No suspicious activity observed",
        "insufficient_evidence": "Insufficient evidence",
    }

    # Run-specific fields left out of the digest: identifiers, wall-clock times and timings. Everything else in the
    # response (every deterministic section, including any added later) is covered.
    DIGEST_EXCLUDED = frozenset({"investigation_id", "started_at", "completed_at", "duration_ms", "processing_steps",
                                 "investigation_digest"})
    DIGEST_EXCLUDED_SOURCE = frozenset({"queried_at", "snapshot_built_at"})  # when the ledger was read / its file written

    @classmethod
    def digest(cls, out: dict, base: dict) -> str:
        keep = {k: v for k, v in out.items() if k not in cls.DIGEST_EXCLUDED}
        if isinstance(keep.get("dataset"), dict) and isinstance(keep["dataset"].get("source"), dict):
            keep["dataset"] = {**keep["dataset"], "source": {k: v for k, v in keep["dataset"]["source"].items()
                                                             if k not in cls.DIGEST_EXCLUDED_SOURCE}}
        keep["base_report_digest"] = base["report_digest"]
        return hashlib.sha256(json.dumps(keep, sort_keys=True, default=str).encode()).hexdigest()[:24]

    @staticmethod
    def _scored(r: pd.Series, s: pd.Series, factors: list[dict], use: bool = True) -> dict:
        p = float(s["calibrated_probability"]) if not pd.isna(s["calibrated_probability"]) else None
        return {
            "transaction_id": r.transaction_id, "timestamp": _iso(r.timestamp), "sender_account_id": r.sender_account_id,
            "receiver_account_id": r.receiver_account_id, "amount": round(float(r.amount), 2), "currency": r.currency,
            "transaction_type": r.transaction_type, "channel": r.channel, "model_score": round(float(s["model_score"]), 4),
            "calibrated_probability": round(p, 4) if p is not None else None, "model_flag": bool(s["above_threshold"]),
            "risk_category": _risk_category(p, bool(s["above_threshold"])), "model_factors": factors,
            "outside_training_range": int(s["outside_training_range"]) >= 3, "rule_flags": [],
            "evidence_use": "evidence" if use else "reference_only",
        }

    @classmethod
    def _evidence(cls, root_id, base, flow, L1: pd.DataFrame, afe, acc_model, scored, n_tx, req, use: bool = True) -> dict[str, roles.AccountEvidence]:
        exp = {x["account_id"]: x for x in base["exposure"]["per_account"]}
        by_acc = {a["account_id"]: a for a in base["accounts"]}
        in_e, out_e = defaultdict(list), defaultdict(list)
        for e in flow.edges:
            in_e[e.txn.destination_account_id].append(e)
            out_e[e.txn.origin_account_id].append(e)
        root_of: dict[str, str] = {}
        parent = {e.txn.transaction_id: e.parent_transaction_id for e in flow.edges}
        for e in flow.edges:
            t = e.txn.transaction_id
            while parent.get(t):
                t = parent[t]
            root_of[e.txn.transaction_id] = t
        # Decision layer: where the transaction model is validated it is the primary detector and a rule flag it does
        # not corroborate is kept visible but carries no weight; elsewhere the fixed rules are primary.
        def counts(flags: list[dict]) -> bool:
            return any((f["code"] == "MODEL_TRANSACTION_RISK") == use for f in flags)

        flagged_seeds = {e["transaction_id"] for e in base["trace"]["edges"] if e["hop"] == 1 and counts(e["flags"])}
        edge_flags = {te["transaction_id"]: te["flags"] for te in base["trace"]["edges"]}
        first_seen = pd.concat([L1.groupby("sender_account_id")["timestamp"].min(), L1.groupby("receiver_account_id")["timestamp"].min()]).groupby(level=0).min()
        ds_start = pd.Timestamp(base["data_source"]["earliest_transaction_at"]).tz_localize(None) if base["data_source"].get("earliest_transaction_at") else None
        win = pd.Timedelta(hours=req.onward_window_hours)
        big_drain = L1[(L1.sender_balance_before > 0) & (L1.amount >= 10_000) & (L1.amount >= 0.5 * L1.sender_balance_before)]
        last_bal = cls._latest_balances(L1)
        out = {}
        for a, (hop, direction) in flow.node_hops.items():
            ins = [e for e in in_e[a] if not e.is_cycle or a != root_id]
            outs = out_e[a]
            reached = min((e.txn.timestamp for e in (ins if direction != "upstream" else outs)), default=None)
            hist_days = 0.0
            if a in first_seen.index:
                ref = pd.Timestamp(reached) if reached is not None and a != root_id else L1["timestamp"].max()
                hist_days = max(0.0, (ref - first_seen[a]).total_seconds() / 86400)
            x = exp.get(a, {})
            first_receipt = min(ins, key=lambda e: e.txn.timestamp, default=None) if direction == "downstream" else None
            onward = [e for e in outs if e.direction == "downstream" and e.hop > 1] if a != root_id else []
            delay = min((e.minutes_from_parent for e in onward if e.minutes_from_parent is not None), default=None)
            mine = [d for d in scored.values() if use and d["sender_account_id"] == a and d["model_flag"]]
            rule_flagged = {e.txn.transaction_id for e in outs if any(f["code"] != "MODEL_TRANSACTION_RISK" for f in edge_flags.get(e.txn.transaction_id, []))}
            flagged_out = sorted({d["transaction_id"] for d in mine} if use else rule_flagged)
            uncorroborated = sorted(rule_flagged - set(flagged_out)) if use else []
            unfunded, deviation = cls._unfunded(a, flagged_out, L1, scored)
            flagged_in_rows = [d for d in scored.values() if use and d["receiver_account_id"] == a and d["model_flag"]]
            flagged_in = {d["sender_account_id"] for d in flagged_in_rows}
            # Investigated account: did the flagged money it received leave again? (balance-based, as for traced accounts)
            in_amount, in_moved, in_cash = (cls._moved_on(a, {d["transaction_id"] for d in flagged_in_rows}, L1, roles.ONWARD_HOURS)
                                            if a == root_id and flagged_in_rows else (0.0, None, 0.0))
            onward24 = [e for e in onward if not e.is_cycle and (e.minutes_from_parent or 0) <= roles.ONWARD_HOURS * 60]
            gf = afe.loc[a].to_dict() if a in afe.index else {}
            fa = by_acc.get(a, {})
            out[a] = roles.AccountEvidence(
                account_id=a, position="investigated" if a == root_id else direction, hop=hop,
                n_transactions=n_tx.get(a, 0), history_days=round(hist_days, 1), analyzed=fa.get("analyzed", a == root_id),
                introduced_by=(first_receipt.txn.transaction_id if first_receipt else (min(outs, key=lambda e: e.txn.timestamp).txn.transaction_id if outs and direction == "upstream" else None)),
                received_traced=round(sum(e.txn.amount for e in ins if e.direction == "downstream" and not e.is_cycle), 2) if a != root_id else 0.0,
                receipt_ids=[e.txn.transaction_id for e in ins],
                sent_traced=round(sum(e.txn.amount for e in outs), 2), onward_ids=[e.txn.transaction_id for e in outs],
                forwarded_min=x.get("forwarded_min"), forwarded_max=x.get("forwarded_max"), onward_delay_minutes=delay,
                onward_within_24h=round(sum(e.txn.amount for e in onward24), 2),
                onward_cash_within_24h=round(sum(e.txn.amount for e in onward24 if e.txn.channel == "ATM_CASH_OUT"), 2),
                onward_destinations=len({e.txn.destination_account_id for e in onward}),
                # Distinct accounts that paid it traced money: repeat payments from one sender (e.g. the investigated
                # account paying it twice) are one path, and money returning around a loop is counted by in_cycle.
                traced_paths_in=len({e.txn.origin_account_id for e in ins if not e.is_cycle}) if a != root_id else 0,
                in_cycle=a in cls._cycle_members(flow),
                balance_before_receipt=cls._balance_before(L1, first_receipt.txn.transaction_id) if first_receipt else None,
                lowest_balance_in_window=x.get("lowest_balance_in_window"), latest_balance=last_bal.get(a),
                cash_out_traced=round(sum(e.txn.amount for e in onward if e.txn.channel == "ATM_CASH_OUT"), 2),
                flagged_out_ids=flagged_out, flagged_out_unfunded_ids=unfunded, flagged_in_senders=len(flagged_in),
                flagged_in_amount=round(in_amount, 2), flagged_in_moved_min=in_moved, flagged_in_cash=round(in_cash, 2),
                deviation=deviation, uncorroborated_rule_flag_ids=uncorroborated,
                model_flagged_onward_ids=[e.txn.transaction_id for e in onward if use and scored.get(e.txn.transaction_id, {}).get("model_flag")],
                account_model=cls._as_evidence(acc_model.get(a, {"status": "not_analyzed"}), use), graph=gf,
                business_account=fa.get("customer_type") in ("sme", "corporate"),
                cash_endpoint=bool(ins) and a != root_id and all(e.txn.channel == "ATM_CASH_OUT" for e in ins) and not outs,
                drained_senders_near=int(big_drain[(big_drain.receiver_account_id == a) & (big_drain.timestamp >= pd.Timestamp(reached) - win)
                                                   & (big_drain.timestamp <= pd.Timestamp(reached) + win)].sender_account_id.nunique())
                if reached is not None and a != root_id else 0,
                in_flagged_flow=a == root_id or any(root_of[e.txn.transaction_id] in flagged_seeds for e in ins + outs),
                records_start_with_dataset=bool(ds_start is not None and a in first_seen.index and first_seen[a] - ds_start < pd.Timedelta(days=7)),
            )
        return out

    @staticmethod
    def _cycle_members(flow) -> set[str]:
        """Every account on a loop the trace closed, including loops through the investigated account that the
        downstream and upstream halves of the trace close between them (graph_tracer.loop_members)."""
        members = getattr(flow, "cycle_members", None)
        if members is None:  # a trace object built without loop membership: fall back to the closing transfers' ends
            members = {a for e in flow.edges if e.is_cycle for a in (e.txn.origin_account_id, e.txn.destination_account_id)}
        return members

    @staticmethod
    def _as_evidence(result: dict, use: bool) -> dict:
        """An account-model score on a dataset the model was not validated on is shown, never used as evidence."""
        return result if use or result.get("status") != "scored" else {**result, "status": "reference_only"}

    @staticmethod
    def _balance_before(L1: pd.DataFrame, tid: str) -> Optional[float]:
        r = L1.loc[L1.transaction_id == tid, "receiver_balance_before"]
        return None if r.empty or pd.isna(r.iloc[0]) else float(r.iloc[0])

    @staticmethod
    def _latest_balances(L1: pd.DataFrame) -> dict[str, float]:
        s = L1.assign(acc=L1.sender_account_id, bal=L1.sender_balance_before - L1.amount)[["timestamp", "transaction_id", "acc", "bal"]]
        r = L1.assign(acc=L1.receiver_account_id, bal=L1.receiver_balance_before + L1.amount)[["timestamp", "transaction_id", "acc", "bal"]]
        both = pd.concat([s, r]).sort_values(["timestamp", "transaction_id"], kind="mergesort")
        last = both.groupby("acc")["bal"].last()
        return {k: float(v) for k, v in last.items() if not pd.isna(v)}

    @staticmethod
    def _closest_unflagged(root_id: str, scored: dict, raw_p: dict, flagged_ids: set[str], tm) -> list[dict]:
        """The investigated account's own outgoing transfers that were NOT flagged, highest calibrated score first, with
        the threshold they fell short of. Shown so a narrow miss is visible; never a flag, never a trace seed."""
        if tm is None:
            return []
        mine = [d for t, d in scored.items() if t in raw_p and d["sender_account_id"] == root_id and not d["model_flag"]
                and t not in flagged_ids]
        mine.sort(key=lambda d: (-raw_p[d["transaction_id"]], d["transaction_id"]))
        thr = float(tm.threshold)
        return [{"transaction_id": d["transaction_id"], "timestamp": d["timestamp"], "receiver_account_id": d["receiver_account_id"],
                 "amount": d["amount"], "transaction_type": d["transaction_type"], "channel": d["channel"],
                 "calibrated_probability": round(raw_p[d["transaction_id"]], 6), "model_score": d["model_score"],
                 "threshold": round(thr, 6),
                 "share_of_threshold": round(raw_p[d["transaction_id"]] / thr, 3) if thr > 0 else None,
                 "evidence_use": d["evidence_use"]}
                for d in mine[:CLOSEST_UNFLAGGED]]

    @staticmethod
    def _moved_on(a: str, inflow_ids: set[str], L1: pd.DataFrame, hours: float) -> tuple[float, Optional[float], float]:
        """(amount of the given inflows, balance-based lower bound on how much of it left the account by `hours` after
        the last of them, cash withdrawn in that time). The same lowest-intermediate-balance rule as the trace's
        forwarded_min: the inflows are assumed to stay in the account until its balance falls below them. The lower
        bound is None when a balance is missing."""
        rows = L1[(L1.sender_account_id == a) | (L1.receiver_account_id == a)].sort_values(["timestamp", "transaction_id"], kind="mergesort")
        mark = rows.transaction_id.isin(inflow_ids) & (rows.receiver_account_id == a)
        if not mark.any():
            return 0.0, None, 0.0
        start, end = rows.timestamp[mark].min(), rows.timestamp[mark].max() + pd.Timedelta(hours=hours)
        received = traced = cash = 0.0
        for r in rows[(rows.timestamp >= start) & (rows.timestamp <= end)].itertuples(index=False):
            incoming = r.receiver_account_id == a
            bal = (r.receiver_balance_before + r.amount) if incoming else (r.sender_balance_before - r.amount)
            if pd.isna(bal):
                return float(rows.amount[mark].sum()), None, 0.0
            if incoming and r.transaction_id in inflow_ids:
                received += float(r.amount)
                traced += float(r.amount)
            if not incoming and r.channel == "ATM_CASH_OUT":
                cash += float(r.amount)
            traced = min(traced, max(0.0, float(bal)))
        return received, round(max(0.0, received - traced), 2), cash

    @staticmethod
    def _unfunded(a: str, flagged: list[str], L1: pd.DataFrame, scored: dict) -> tuple[list[str], list[str]]:
        """Flagged outgoing transfers NOT shown to be funded by money just received, and how the flagged transfers differ
        from the account's own earlier outgoing transfers. A flagged transfer counts as funded forwarding only when
        inflows in the 24 h before it cover >= 70% of it, those inflows come from payers that had not already paid the
        account at least RECURRING_PAYER_DAYS earlier (a salary or regular transfer is income, not money to pass on),
        and the balance before those inflows could NOT have covered 70% of it (otherwise the account's own money may
        have paid it). An unknown balance is not evidence of funding."""
        rows = L1[(L1.sender_account_id == a) | (L1.receiver_account_id == a)]
        unfunded, dev = [], []
        outs = rows[rows.sender_account_id == a]
        incoming = rows[rows.receiver_account_id == a].sort_values(["timestamp", "transaction_id"], kind="mergesort")
        for tid in flagged:
            t = rows[rows.transaction_id == tid]
            if t.empty:
                continue
            ts, amt = t.timestamp.iloc[0], float(t.amount.iloc[0])
            recent = incoming[(incoming.timestamp < ts) & (incoming.timestamp >= ts - pd.Timedelta(hours=roles.ONWARD_HOURS))]
            established = set(incoming[incoming.timestamp < recent.timestamp.min() - pd.Timedelta(days=RECURRING_PAYER_DAYS)]
                              .sender_account_id) if len(recent) else set()
            fresh = recent[~recent.sender_account_id.isin(established)]
            funded = False
            if len(fresh) and fresh.amount.sum() >= roles.INTERMEDIARY_SHARE * amt:
                before = fresh.receiver_balance_before.iloc[0]  # rows are in time order: balance before the first such inflow
                funded = not pd.isna(before) and float(before) < roles.INTERMEDIARY_SHARE * amt
            if not funded:
                unfunded.append(tid)
        if unfunded:
            first = rows[rows.transaction_id.isin(unfunded)].timestamp.min()
            prior = outs[outs.timestamp < first]
            fl = rows[rows.transaction_id.isin(unfunded)]
            if len(prior) >= 5 and fl.amount.max() > 2 * prior.amount.max():
                dev.append(f"Largest flagged transfer ({fl.amount.max():,.0f}) is more than twice its largest earlier one ({prior.amount.max():,.0f}).")
            new_rec = fl[~fl.receiver_account_id.isin(set(prior.receiver_account_id))]
            if len(new_rec):
                dev.append(f"{len(new_rec)} flagged transfer(s) went to account(s) it had never paid before.")
            bal = fl.sender_balance_before
            drain = fl[(bal > 0) & (fl.amount >= 0.5 * bal)]
            if len(drain):
                dev.append(f"{len(drain)} flagged transfer(s) took at least half of the balance at the time.")
            hours = fl.timestamp.dt.hour
            if (hours < 5).any() and len(prior) and (prior.timestamp.dt.hour < 5).mean() < 0.05:
                dev.append("Flagged transfer(s) between 00:00 and 05:00, when it rarely transacted before.")
        return unfunded, dev

    @classmethod
    def _other_senders(cls, db, ds, root_id, ev, flow, tm, req, loaded=None) -> list[tuple[roles.AccountEvidence, roles.RoleResult]]:
        """Other accounts that paid a traced account of interest (the "hub") within the window, in a transfer of their OWN
        that the validated transaction model flags.

        A hub is a traced account other than the investigated one that EITHER has a candidate role in
        roles.INTERMEDIARY_ROLES (however many kinds of evidence support it), OR received a transfer from the investigated
        account that the model flags (the several-victims pattern: victims pay the same collection account) and was not
        itself assessed as unlinked (no suspicious linkage or activity observed, or a cash point; an unknown role needs
        at least one independent kind of evidence of its own). The hub's role is only where to look, never evidence
        against a sender: what makes a sender an "other sender" is its own model-flagged transfer into the hub, so a
        mistaken hub (an ordinary shop) yields nobody unless its customers' own transfers are flagged too.
        Measured on the train ledger only (multi-victim and consolidation victims as roots): candidates-only hubs, with or
        without a >= 2-kinds requirement, found 46 of 322 other victims; adding the investigated account's flagged payees
        finds 205 of 322 with the same 4 senders without a victim role (1 no-role account, 3 mules; no innocent
        counterparty). Admitting unlinked or zero-evidence payees added false senders (innocent counterparties' and
        ordinary accounts' customers), and widening to every unknown-role or victim-class account reported 104 senders
        without a victim role, so neither is done. Validated datasets only: where the model is not validated its flag is
        not evidence, so nobody is reported."""
        if tm is None or DATASETS[req.dataset_id].model_support != "validated_in_distribution":
            return []
        prelim = {a: roles.assess(e) for a, e in ev.items()}
        root_flagged = set(ev[root_id].flagged_out_ids) if root_id in ev else set()
        unlinked = ("no_suspicious_linkage_observed", "no_suspicious_activity_observed", "cash_withdrawal_point")
        paid_by_root = {a for a, r in prelim.items() if a != root_id and ev[a].position == "downstream"
                        and root_flagged & set(ev[a].receipt_ids) and r.role_candidate not in unlinked
                        and (r.role_candidate != "unknown_role" or roles.independent_kinds(r.categories))}
        hubs = [a for a, r in prelim.items() if a != root_id and (r.role_candidate in roles.INTERMEDIARY_ROLES or a in paid_by_root)]
        # Role candidates first, best-supported first, so the per-investigation limits below never crowd them out.
        hubs.sort(key=lambda a: (prelim[a].role_candidate not in roles.INTERMEDIARY_ROLES,
                                 -len(roles.independent_kinds(prelim[a].categories))))
        if not hubs:
            return []
        win = pd.Timedelta(hours=req.onward_window_hours)
        cand = []
        for h in hubs[:10]:
            times = [e.txn.timestamp for e in flow.edges if e.txn.destination_account_id == h]
            if not times:
                continue
            lo, hi = min(times) - win, max(times) + win
            rows = db.execute(select(TransactionModel.transaction_id, TransactionModel.origin_account_id).where(and_(
                TransactionModel.destination_account_id == h, TransactionModel.timestamp >= lo, TransactionModel.timestamp <= hi))
                .order_by(TransactionModel.amount.desc()).limit(MAX_HUB_INFLOWS)).all()
            cand += [(tid, s, h) for tid, s in rows if s not in flow.node_hops]
        # Bounded: only the largest inflows per account and a fixed number of senders are examined.
        keep = list(dict.fromkeys(s for _, s, _ in cand))[:MAX_CANDIDATE_SENDERS]
        cand = [c for c in cand if c[1] in set(keep)]
        if not cand:
            return []
        senders = {s for _, s, _ in cand}
        # Every traced account's full history is already in `loaded` (L1): only the new senders are read.
        hist = ledger.account_history(db, senders | {h for *_, h in cand}, ds, loaded=loaded, loaded_ids=flow.node_hops)
        idx = hist.index[hist.transaction_id.isin({t for t, _, _ in cand})]
        X = transaction_features(hist, idx)
        sc = tm.score(X)
        out = []
        seen = set()
        for i in sc.index[sc["above_threshold"]]:
            r = hist.loc[i]
            s = r.sender_account_id
            if s in seen or len(out) >= MAX_OTHER_SENDERS:
                continue
            seen.add(s)
            unfunded, dev = cls._unfunded(s, [r.transaction_id], hist, {})
            mine = hist[((hist.sender_account_id == s) | (hist.receiver_account_id == s)) & (hist.timestamp < r.timestamp)]
            n = int(len(mine))
            # Its own money or money just received, and how much of its balance the payment took (roles: other senders).
            recent_in = mine[(mine.receiver_account_id == s) & (mine.timestamp >= r.timestamp - pd.Timedelta(hours=roles.ONWARD_HOURS))]
            amt, bal = float(r.amount), r.sender_balance_before
            recent_share = float(recent_in.amount.sum()) / amt if amt > 0 else None
            balance_share = amt / float(bal) if not pd.isna(bal) and float(bal) > 0 else None
            days = (r.timestamp - mine.timestamp.min()).total_seconds() / 86400 if n else 0.0
            e = roles.AccountEvidence(account_id=s, position="other_sender", hop=None, n_transactions=n,
                                      history_days=round(days, 1), introduced_by=r.transaction_id, sent_traced=float(r.amount),
                                      onward_ids=[r.transaction_id], flagged_out_ids=[r.transaction_id],
                                      flagged_out_unfunded_ids=unfunded, deviation=dev, account_model={"status": "not_analyzed"},
                                      paid_account_id=r.receiver_account_id,
                                      paid_account_role=prelim[r.receiver_account_id].role_candidate if r.receiver_account_id in prelim else None,
                                      paid_account_paid_by_investigated=r.receiver_account_id in paid_by_root,
                                      recent_inflow_share=recent_share, balance_share=balance_share)
            e._other = {"paid": r.receiver_account_id, "transaction": cls._scored(r, sc.loc[i], [])}  # type: ignore[attr-defined]
            out.append((e, roles.assess(e)))
        return out

    @classmethod
    def _role_out(cls, e: roles.AccountEvidence, r: roles.RoleResult, scored: dict, flow) -> dict:
        rel_ids = sorted(set(e.receipt_ids + e.onward_ids + e.flagged_out_ids))[:30]
        other = getattr(e, "_other", None)
        rel = {
            "position": e.position, "hop": e.hop, "introduced_by_transaction_id": e.introduced_by,
            "received_traced_amount": e.received_traced, "sent_traced_amount": e.sent_traced,
            "forwarded_at_least": e.forwarded_min, "forwarded_at_most": e.forwarded_max,
            "onward_delay_minutes": e.onward_delay_minutes, "onward_destinations": e.onward_destinations,
            "traced_paths_in": e.traced_paths_in, "in_cycle": e.in_cycle, "paid_suspicious_account": other["paid"] if other else None,
        }
        am = e.account_model
        prob = am.get("calibrated_probability") if am.get("status") == "scored" else None
        questions = cls._questions(e, r, other)
        cats, txt = roles.categories(e)
        items = [{"category": c, "kind": EVIDENCE_KIND.get(c, "observed"), "text": t} for c, t in zip(cats, txt)]
        # Categories a role rule adds itself (FUNDED_FORWARD, FLAGGED_IN_MOVED) carry their own sentence.
        items += [{"category": c, "kind": EVIDENCE_KIND.get(c, "observed"), "text": t} for c, t in r.category_text.items() if c not in cats]
        shown = set(txt) | set(r.category_text.values())
        # A supporting sentence that reports a model's output is a model output, not a recorded fact (QA-03: keep what the
        # records show apart from what a model says). Display only: no role, status or restriction reads this field.
        items += [{"category": "MODEL_OUTPUT" if MODEL_SENTENCE.search(t) else "OBSERVED",
                   "kind": "model" if MODEL_SENTENCE.search(t) else "observed", "text": t}
                  for t in r.supporting if t not in shown]
        return {
            "account_id": e.account_id, "role_candidate": r.role_candidate, "role_label": roles.ROLE_LABELS[r.role_candidate],
            "assessment_status": r.assessment_status, "headline": r.headline, "supporting_evidence": r.supporting,
            "evidence_items": items, "contradictory_evidence": r.contradictory, "evidence_categories": r.categories, "evidence_strength": r.evidence_strength,
            "relevant_transaction_ids": rel_ids, "graph_relationship": rel,
            "account_model": am, "account_model_calibrated_probability": prob,
            "data_coverage": {"transactions": e.n_transactions, "history_days_before_reached": e.history_days, "analyzed": e.analyzed},
            "uncertainty_reason": r.uncertainty_reason, "recommended_next_check": r.next_check,
            "questions": questions, "may_be_victim": r.may_be_victim,
            "restriction": roles.restriction(e, r, rel_ids),
            "other_sender_transaction": other["transaction"] if other else None,
        }

    @staticmethod
    def _questions(e: roles.AccountEvidence, r: roles.RoleResult, other) -> list[dict]:
        m = lambda x: "unknown" if x is None else f"{x:,.0f}"  # noqa: E731
        pos = {"investigated": "It is the investigated account.", "downstream": f"It received traced money {e.hop} hop(s) after the investigated account.",
               "upstream": f"It paid money into the traced flow {e.hop} hop(s) before the investigated account.",
               "other_sender": f"It sent a flagged transfer to {e.paid_account_id or (other['paid'] if other else 'an account in the trace')}"
                               + (f" ({roles.ROLE_LABELS[e.paid_account_role].lower()})" if e.paid_account_role in roles.ROLE_LABELS else "")
                               + ", which the trace reached."}[e.position]
        moved_txt = next((r.category_text[c] for c in ("ONWARD", "FUNDED_FORWARD", "FLAGGED_IN_MOVED", "CASH") if c in r.category_text), None)
        if moved_txt and r.role_candidate in roles.INTERMEDIARY_ROLES:
            intermediary = "Yes: " + moved_txt
        elif r.role_candidate in roles.INTERMEDIARY_ROLES:
            intermediary = "Possibly: " + r.headline + " " + (r.uncertainty_reason or "")
        else:
            intermediary = "No." if not moved_txt else "Observed, but not assessed as intermediary behaviour: " + moved_txt
        after = "Not applicable."
        if e.position == "downstream" and e.received_traced:
            after = (f"It sent {m(e.onward_within_24h)} onward within 24 h"
                     + (f", the first transfer {roles.duration(e.onward_delay_minutes)} after receipt" if e.onward_delay_minutes is not None else "")
                     + f". Balance-based attribution: between {m(e.forwarded_min)} and {m(e.forwarded_max)} of the traced money itself moved on.")
        am = e.account_model
        hist = {"scored": "The account behaviour model scores it " + ("at or above" if am.get("above_threshold") else "below") + " its review threshold.",
                "insufficient_history": "Too few records for the account behaviour model; it abstains.",
                "not_analyzed": "Not analysed in this run.", "model_unavailable": "The account behaviour model is unavailable.",
                "reference_only": "The account behaviour model is not validated on this dataset; its score is shown for reference only."}.get(am.get("status"), "Unknown.")
        return [
            {"q": "How did this account become connected?", "a": pos},
            {"q": "Which transaction introduced it?", "a": e.introduced_by or "None recorded in the trace."},
            {"q": "What amount was received?", "a": m(e.received_traced) if e.position == "downstream" else "Not applicable."},
            {"q": "What happened after receipt?", "a": after},
            {"q": "Did it transfer money further?", "a": f"Yes, to {e.onward_destinations} account(s) in the trace." if e.onward_destinations else "No onward transfer in the trace."},
            {"q": "Did it receive funds from more than one suspicious path?",
             "a": f"Yes, from {e.traced_paths_in} different accounts in the trace (receiving money is not, on its own, evidence of a role)."
             if e.traced_paths_in >= 2 else "No."},
            {"q": "Does its history look normal or unusual?", "a": hist},
            {"q": "Is there evidence it may itself be a victim?", "a": "Yes: " + r.headline if r.may_be_victim else "None found in the ledger."},
            {"q": "Is there evidence of suspicious intermediary behaviour?", "a": intermediary.strip()},
            {"q": "What remains unknown?", "a": r.uncertainty_reason or "Whether the holder authorised or knew about these transfers."},
        ]

    @staticmethod
    def _branches(flow, req, L1: pd.DataFrame) -> list[dict]:
        """One branch per root-to-leaf path of the trace, with the reason it ends.

        Branches only rearrange traced transfers: every transfer in ``flow.edges`` is on at least one branch and nothing
        else is. A transfer the trace found again from the opposite side (``flow.cross_links``) ends the branch that
        reached it, as a last step with the ending ``joins_opposite_direction_trace``; it is still one edge, so no
        total counts it twice. Ending order: loop, cash withdrawal, already reached (same or opposite side), depth
        limit (only where the last account has a further qualifying transfer in the window, ``flow.onward_beyond_depth``;
        otherwise nothing further in the window), account limit, nothing further in the window.

        An account whose expansion hit the per-account cap (``flow.expansions[...]["capped"]``) also gets one branch that
        ends at that account with ``per_account_limit_applied``, stating how many of its qualifying transfers were
        followed; its followed transfers continue on their own branches. That branch adds no transfer.
        """
        children = defaultdict(list)
        for e in flow.edges:
            children[e.parent_transaction_id].append(e)
        by_id = {e.txn.transaction_id: e for e in flow.edges}
        intro = {}  # account -> the transfer that first reached it (neither a loop nor a convergence)
        for e in flow.edges:
            if not e.is_cycle and not e.converges:
                intro.setdefault(e.txn.destination_account_id if e.direction == "downstream" else e.txn.origin_account_id, e.txn.transaction_id)
        cross = defaultdict(list)
        for parent_id, tid, _direction in getattr(flow, "cross_links", []):
            if parent_id in by_id and tid in by_id:
                cross[parent_id].append(by_id[tid])
        branches = []

        def far(e) -> str:
            return e.txn.destination_account_id if e.direction == "downstream" else e.txn.origin_account_id

        def opposite_side(e) -> bool:
            """The far account was first reached from the other side of the investigated account."""
            first = flow.node_hops.get(far(e))
            return first is not None and first[1] not in (e.direction, "root")

        def ending(e) -> str:
            other = far(e)
            if e.is_cycle:
                return "cycle_detected"
            if e.direction == "downstream" and e.txn.channel == "ATM_CASH_OUT":
                return "cash_withdrawal_recorded"
            if e.converges:
                return "joins_opposite_direction_trace" if opposite_side(e) else "already_examined_on_another_branch"
            if e.hop >= req.max_depth:
                # Cut short only if the account has a further qualifying transfer in the window (unknown: assume so).
                if getattr(flow, "onward_beyond_depth", {}).get(e.txn.transaction_id, True):
                    return "maximum_depth_reached"
                return "no_further_transaction_in_window" if e.direction == "downstream" else "no_earlier_transaction_in_window"
            x = flow.expansions.get(other)
            if x is None:
                return "maximum_node_limit_reached" if len(flow.node_hops) >= req.max_nodes else "incomplete_or_missing_data"
            if x["dropped_for_nodes"]:
                return "maximum_node_limit_reached"
            return "no_further_transaction_in_window" if e.direction == "downstream" else "no_earlier_transaction_in_window"

        def emit(path, direction, code, txt, refer=None):
            # Accounts in the order of the branch's own direction (a cross-link step is read the same way).
            step = (lambda t: t.destination_account_id) if direction == "downstream" else (lambda t: t.origin_account_id)
            accs = [path[0].txn.origin_account_id if direction == "downstream" else path[0].txn.destination_account_id]
            accs += [step(p.txn) for p in path]
            n = len([b for b in branches if b["direction"] == direction]) + 1
            branches.append({"branch_id": f"{'OUT' if direction == 'downstream' else 'IN'}-{n}",
                             "direction": direction, "transaction_ids": [p.txn.transaction_id for p in path], "accounts": accs,
                             "amounts": [round(p.txn.amount, 2) for p in path], "ending": {"reason": code, "detail": txt},
                             "_refer": refer})

        def walk(e, path):
            path = path + [e]
            kids = children.get(e.txn.transaction_id, [])
            links = cross.get(e.txn.transaction_id, [])
            if not kids and not links:
                code = ending(e)
                txt = ENDINGS[code]
                refer = None
                if code in ("joins_opposite_direction_trace", "already_examined_on_another_branch") or (
                        code == "cycle_detected" and opposite_side(e)):
                    refer = ("account", far(e), intro.get(far(e)), None)
                emit(path, e.direction, code, txt, refer)
            for k in sorted(kids, key=lambda k: k.txn.timestamp):
                walk(k, path)
            for c in sorted(links, key=lambda c: c.txn.timestamp):
                emit(path + [c], e.direction, "joins_opposite_direction_trace", ENDINGS["joins_opposite_direction_trace"],
                     ("transaction", c.txn.transaction_id, c.txn.transaction_id, c.is_cycle))
            x = flow.expansions.get(far(e)) or {}
            if x.get("capped") and x.get("anchor") == e.txn.transaction_id:
                acc, n, m = far(e), x["found"], x.get("qualifying", x["found"])
                what = (f"{acc} made {m} transfers within {req.onward_window_hours:g} h of receiving this money"
                        if e.direction == "downstream" else
                        f"{acc} received {m} transfers within {req.onward_window_hours:g} h before paying this money on")
                emit(path, e.direction, "per_account_limit_applied",
                     f"{what}; only the {n} largest were followed (shown on their own branches). The other {m - n} "
                     "were not traced, so the money may continue through them.")

        for seed in sorted(children.get(None, []), key=lambda e: (e.direction != "downstream", e.txn.timestamp)):
            walk(seed, [])

        # Name the branch each ending refers to, once every branch has its id.
        for b in branches:
            refer = b.pop("_refer")
            if not refer:
                continue
            kind, target, via, loops = refer
            others = [o for o in branches if o is not b and via in o["transaction_ids"]
                      and not (kind == "transaction" and o["direction"] == b["direction"])]
            where = f" (branch {others[0]['branch_id']})" if others else ""
            reason = b["ending"]["reason"]
            if kind == "transaction":
                b["ending"]["detail"] = (f"This transfer is already traced from the other side of the investigated account{where}, "
                                         "so it is shown once there and not followed again here."
                                         + (" It closes a loop of payments through the investigated account." if loops else ""))
            elif reason == "cycle_detected":
                b["ending"]["detail"] = (f"Cycle detected: this transfer closes a loop of payments through the investigated account; "
                                         f"{target} was already reached on the other side of the trace{where}.")
            elif reason == "joins_opposite_direction_trace":
                b["ending"]["detail"] = (f"{target} was already reached from the other side of the investigated account{where}. "
                                         "The timing does not form a loop, so it is not followed a second time.")
            elif where:
                b["ending"]["detail"] = f"{target} was already reached on another branch{where}, so it is not followed a second time."
        return branches

    @staticmethod
    def _network_findings(flow, ev, others) -> list[str]:
        out = []
        cyc = [e for e in flow.edges if e.is_cycle]
        if cyc:
            out.append(f"{len(cyc)} transfer(s) returned money to an account already on its path ({', '.join(e.txn.transaction_id for e in cyc[:4])}).")
        multi = [a for a, e in ev.items() if e.traced_paths_in >= 2]
        if multi:
            out.append(f"{len(multi)} account(s) were reached by more than one traced path: {', '.join(multi[:6])}.")
        conv = [e for e in flow.edges if e.converges]
        if conv:
            out.append(f"{len(conv)} transfer(s) reached accounts already in the trace by another route (convergence).")
        if others:
            paid = sorted({e.paid_account_id for e, _ in others if e.paid_account_id})
            out.append(f"{len(others)} other account(s) sent transfers the transaction model flags into traced account(s) "
                       f"({', '.join(paid[:4])}) that are intermediary or suspicious-account candidates or that the investigated "
                       f"account paid in a flagged transfer: {', '.join(e.account_id for e, _ in others[:6])}. They may also be "
                       "affected; the evidence is the flag on each one's own transfer, not the role of the account it paid.")
        cash = [e for e in flow.edges if e.txn.channel == "ATM_CASH_OUT" and e.direction == "downstream"]
        if cash:
            out.append(f"{len(cash)} traced transfer(s) were cash withdrawals; the ledger cannot follow cash.")
        return out

    @staticmethod
    def _limitations(source, tm, am, flow, acc_model) -> list[str]:
        out = []
        if source["is_synthetic"]:
            out.append("All records are synthetic. Model performance on synthetic scenarios says nothing about real-world accuracy.")
        out.append("A ledger records payments, not intent: no finding establishes that anyone knowingly committed fraud.")
        out.append("Roles are candidates for human review, assigned by documented rules (docs/DYNAMIC_INTELLIGENCE.md).")
        if tm is None:
            out.append("The transaction model was unavailable; suspicious transfers come from the fixed rules only.")
        if am is None:
            out.append("The account behaviour model was unavailable; roles rest on trace evidence and rules only.")
        ins = [a for a, v in acc_model.items() if v["status"] == "insufficient_history"]
        if ins:
            out.append(f"{len(ins)} account(s) have fewer than {MIN_ACCOUNT_TRANSACTIONS} transfers; the account model abstained for them.")
        out += flow.truncation_notes
        out.append("Funds are never described as recovered, frozen or lost: the ledger cannot show that.")
        return out
