"""Dataset-level distribution check: how far each dataset's model inputs are from the models' training data.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.distribution_shift

Why. The per-transfer "outside training range" caution checks each input against its training min/max. On the
FraudShield demo ledger (a different generator) the models fail badly (transaction model PR-AUC 0.058, account model
0.051), yet only 0.7% of transfers and 3 of 10,000 accounts trip that range check: every input stays inside its range
while the joint behaviour is different. A dataset-level check is needed before model outputs can be trusted at all.

Method (fixed before looking at results). Population Stability Index per model input, against the training split:
- transaction model: train ledger (seed 101) days 0-83 (the model's training rows) as reference;
- account model: train ledger accounts at ledger end with >= 5 transfers as reference;
- reference bins: deciles of the reference (unique edges); binary/low-cardinality inputs use their values;
- PSI = sum((q - p) * ln(q / p)) with a 1e-4 floor; the usual convention reads > 0.25 as a significant shift.
A sanity row (the train ledger's own validation period, days 84-101) shows the in-distribution baseline.
Support rule. A first version counted every input and misfired on the in-distribution control: the train ledger's own
validation period showed 8 "shifted" transaction inputs, all of them counts or day-spans that grow with calendar position
and ledger length (prior counts, history days, distinct counterparties), not behaviour. Inputs are therefore split by
their meaning (fixed list ACCUMULATION below, chosen by definition, not by PSI): accumulation inputs measure how much
history has built up; behaviour-shape inputs (amounts, ratios, shares, timing, types, channels) measure how accounts
behave. A dataset is "in distribution" for a model when at most 10% of its behaviour-shape inputs have PSI > 0.25;
accumulation shift is reported separately as "history length differs". This rule was introduced after seeing the
control misfire, which is disclosed here; the control is kept in the report so the reason stays visible. The result is
copied into backend/app/intelligence/datasets.py (a test checks they agree).
Writes ml/reports/distribution_shift.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text

sys.path[:0] = [".", "backend"]
from backend.app.intelligence.features import (ACCOUNT_FEATURES, GRAPH_FEATURES, MIN_ACCOUNT_TRANSACTIONS,  # noqa: E402
                                               TXN_FEATURES, account_features, graph_features, transaction_features)
from backend.app.intelligence import models as mdl  # noqa: E402
from backend.app.intelligence.ledger import v2_rows_to_frame  # noqa: E402
from backend.app.intelligence.schema import validate_transactions  # noqa: E402

REPORT = Path("ml/reports/distribution_shift.json")
SHIFT_PSI = 0.25
MAX_SHIFTED_SHARE = 0.10
ACCUMULATION = {  # grow with calendar position / ledger length by definition
    "s_prior_out_n", "s_prior_in_n", "s_history_days", "s_distinct_recipients", "pair_prior_n",
    "r_prior_in_n", "r_prior_out_n", "r_history_days", "r_distinct_senders",
    "n_out_log", "n_in_log", "total_in_log", "total_out_log", "distinct_senders_log", "distinct_recipients_log", "max_gap_days",
}
DATASETS = {
    "train_validation_period (in-distribution baseline)": ("data/v3_forensic_train.db", "validation"),
    "forensic cold ledger (seed 202)": ("data/v3_forensic_cold.db", "all"),
    "forensic-scenarios (served, seed 303)": ("data/v3_forensic_scenarios.db", "all"),
    "demo-ledger (FraudShield generator, seed 42)": ("data/v2_fraudshield.db", "all"),
}


def load(db: str) -> pd.DataFrame:
    eng = create_engine(f"sqlite:///{db}")
    with eng.connect() as c:
        rows = c.execute(text("select transaction_id, timestamp, origin_account_id, destination_account_id, amount, currency, "
                              "channel, status, origin_balance_before, dest_balance_before from transactions")).all()
    valid, _ = validate_transactions(v2_rows_to_frame(rows, db))
    return valid


def bins(ref: pd.Series):
    r = ref.dropna()
    if r.nunique() <= 10:
        return ("cat", sorted(r.unique().tolist()))
    edges = np.unique(np.quantile(r, np.linspace(0, 1, 11)))
    return ("num", edges)


def shares(x: pd.Series, spec) -> np.ndarray:
    kind, b = spec
    x = x.dropna()
    if kind == "cat":
        counts = np.array([(x == v).sum() for v in b] + [(~x.isin(b)).sum()], dtype=float)
    else:
        idx = np.clip(np.searchsorted(b, x.to_numpy(), side="right") - 1, 0, len(b) - 2)
        counts = np.bincount(idx, minlength=len(b) - 1).astype(float)
    return counts / max(counts.sum(), 1.0)


def psi(p: np.ndarray, q: np.ndarray) -> float:
    p, q = np.maximum(p, 1e-4), np.maximum(q, 1e-4)
    return float(np.sum((q - p) * np.log(q / p)))


def compare(ref: pd.DataFrame, cur: pd.DataFrame, feats: list[str]) -> dict:
    per = {}
    for f in feats:
        spec = bins(ref[f])
        per[f] = round(psi(shares(ref[f], spec), shares(cur[f], spec)), 4)
    behaviour = {f: v for f, v in per.items() if f not in ACCUMULATION}
    accumulation = {f: v for f, v in per.items() if f in ACCUMULATION}
    shifted = sorted((f for f, v in behaviour.items() if v > SHIFT_PSI), key=lambda f: -per[f])
    acc_shifted = sorted((f for f, v in accumulation.items() if v > SHIFT_PSI), key=lambda f: -per[f])
    bvals = np.array(list(behaviour.values()))
    return {"rows": int(len(cur)), "behaviour_inputs": len(behaviour), "accumulation_inputs": len(accumulation),
            "behaviour_median_psi": round(float(np.median(bvals)), 4), "behaviour_max_psi": round(float(bvals.max()), 4),
            "behaviour_inputs_psi_over_0_25": len(shifted), "share_behaviour_inputs_shifted": round(len(shifted) / len(behaviour), 3),
            "in_distribution": len(shifted) / len(behaviour) <= MAX_SHIFTED_SHARE,
            "history_length_differs": bool(acc_shifted), "accumulation_inputs_psi_over_0_25": len(acc_shifted),
            "most_shifted_behaviour": {f: per[f] for f in shifted[:8]},
            "most_shifted_accumulation": {f: per[f] for f in acc_shifted[:8]},
"per_input": per}


def main() -> dict:
    tm, am = mdl.load("transaction_model"), mdl.load("account_model")
    txn_feats = [f for f in tm.features if f in TXN_FEATURES or f in tm.features]
    acc_feats = list(am.features)
    train = load("data/v3_forensic_train.db")
    day = (train.timestamp - train.timestamp.min()).dt.total_seconds() / 86400
    Xt = transaction_features(train)
    ref_txn = Xt[(day < 84).to_numpy()]
    ids = sorted(set(train.sender_account_id) | set(train.receiver_account_id))
    At = account_features(train, ids).join(graph_features(train, ids))
    ref_acc = At[At.n_transactions >= MIN_ACCOUNT_TRANSACTIONS]
    out = {"method": __doc__.split("Method (fixed before looking at results).")[1].split("Writes")[0].strip(),
           "reference": {"transaction_model": f"train ledger days 0-83, {len(ref_txn):,} transfers",
                         "account_model": f"train ledger accounts at ledger end with >= 5 transfers, {len(ref_acc):,}"},
           "datasets": {}}
    for name, (db, part) in DATASETS.items():
        if not Path(db).exists():
            out["datasets"][name] = {"skipped": f"{db} not built"}
            continue
        if part == "validation":
            cur_t = Xt[((day >= 84) & (day < 102)).to_numpy()]
            cur_a = None
        else:
            d = load(db)
            cur_t = transaction_features(d)
            ids_d = sorted(set(d.sender_account_id) | set(d.receiver_account_id))
            A = account_features(d, ids_d).join(graph_features(d, ids_d))
            cur_a = A[A.n_transactions >= MIN_ACCOUNT_TRANSACTIONS]
        entry = {"transaction_model": compare(ref_txn, cur_t, txn_feats)}
        if cur_a is not None:
            entry["account_model"] = compare(ref_acc, cur_a, acc_feats)
        out["datasets"][name] = entry
        print(name, {m: {k: v[k] for k in ("behaviour_max_psi", "behaviour_inputs_psi_over_0_25", "in_distribution",
                                           "history_length_differs")}
                     for m, v in entry.items()}, flush=True)
    REPORT.write_text(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":  # pragma: no cover
    main()
