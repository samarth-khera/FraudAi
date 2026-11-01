"""Account and graph features on IBM AMLSim's published sample networks (independent simulator, Apache-2.0).

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.amlsim_graph_benchmark

What the samples provide: transactions (source, target, value, step) and a node-level label ``isFraud`` meaning the
account belongs to a generated laundering pattern (cycles, fan-in). No transaction labels, types, balances or pattern IDs.
``fraudStep`` (when a node joined a pattern) is post-event information and is never used.

Two questions, both source-specific (nothing here is applied to FraudShield ledgers):
1. Within one sample, do graph features add to behaviour features? Nodes are split 60/20/20 at random (seeded); every
   sample shares one background graph, so this is a node-level, not a network-disjoint, split.
2. Pattern transfer: train on the cycle sample, test on the fan-in sample (and the reverse). The background accounts
   are the same node IDs in both samples (same base simulation), so the overlap is reported; the laundering patterns differ.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from backend.app.intelligence.features import ACCOUNT_FEATURES, GRAPH_FEATURES, account_features, graph_features
from ml.forensics.adapters import AMLSIM_DIR, amlsim_sample, sha256
from ml.forensics.evaluation import metrics, pick_threshold
from ml.forensics.modeling import SEED, environment, fit_logistic, fit_xgb, quick

REPORT = Path("ml/reports/amlsim_graph_benchmark.json")
SAMPLES = ("20K_cycle200", "20K_fanin200")
# Balance-based features are undefined here (no balances) and dropped rather than imputed.
NO_BALANCE = {"max_out_to_balance", "senders_drained_in", "share_in_from_drains", "cash_out_share"}


def table(name: str) -> pd.DataFrame:
    tx, nodes = amlsim_sample(name)
    accs = nodes["account_id"].tolist()
    f = account_features(tx, accs).join(graph_features(tx, accs))
    f["y"] = nodes.set_index("account_id")["isFraud"].reindex(accs).to_numpy()
    return f


def split(index: pd.Index) -> np.ndarray:
    h = np.array([int(hashlib.sha256(f"{SEED}:{a}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF for a in index])
    return np.where(h < 0.6, 0, np.where(h < 0.8, 1, 2))


def main() -> dict:
    t0 = time.perf_counter()
    rep: dict = {"dataset": {"name": "IBM AMLSim published samples (github.com/IBM/AMLSim, sample/)", "license": "Apache-2.0",
                             "commit": "7338a4bcb1af9bcfea2201ad7daccfe2a4d569ca",
                             "archives": {p.name: sha256(p) for p in sorted(AMLSIM_DIR.parent.glob("*.tgz"))}},
                 "environment": environment()}
    beh = [f for f in ACCOUNT_FEATURES if f not in NO_BALANCE and f not in ("history_days", "active_days_log")]
    gra = [f for f in GRAPH_FEATURES if f not in NO_BALANCE]
    tabs = {n: table(n) for n in SAMPLES}
    rep["samples"] = {n: {"accounts": len(t), "pattern_accounts": int(t.y.sum()), "prevalence": round(float(t.y.mean()), 4)} for n, t in tabs.items()}
    within = {}
    for n, t in tabs.items():
        s = split(t.index)
        tr, va, te = t[s == 0], t[s == 1], t[s == 2]
        res = {}
        for fs_name, feats in (("behaviour_only", beh), ("behaviour_plus_graph", beh + gra)):
            spw = float((tr.y == 0).sum() / max(tr.y.sum(), 1))
            m = fit_xgb(tr, tr.y.to_numpy(), va, va.y.to_numpy(), {"max_depth": 4, "min_child_weight": 5, "lambda": 5, "alpha": 0.5,
                                                                   "scale_pos_weight": round(np.sqrt(spw), 2)}, feats)
            thr, rule = pick_threshold(va.y.to_numpy(), m.predict(va), 0.5)
            res[fs_name] = {"validation": quick(va.y.to_numpy(), m.predict(va)), "test": metrics(te.y.to_numpy(), m.predict(te), thr, f"{n} test"),
                            "threshold_rule": rule}
            lr = fit_logistic(tr, tr.y.to_numpy(), 0.3, feats)
            res[fs_name]["logistic_test_pr_auc"] = quick(te.y.to_numpy(), lr.predict(te))["pr_auc"]
        within[n] = res
    rep["within_sample"] = within
    transfer = {}
    for a, b in (SAMPLES, SAMPLES[::-1]):
        ta, tb = tabs[a], tabs[b]
        s = split(ta.index)
        tr, va = ta[s != 1], ta[s == 1]
        m = fit_xgb(tr, tr.y.to_numpy(), va, va.y.to_numpy(), {"max_depth": 4, "min_child_weight": 5, "lambda": 5, "alpha": 0.5,
                                                               "scale_pos_weight": 4.0}, beh + gra)
        thr, _ = pick_threshold(va.y.to_numpy(), m.predict(va), 0.5)
        transfer[f"train {a} -> test {b}"] = {
            "test": metrics(tb.y.to_numpy(), m.predict(tb), thr, f"{b} (all accounts)"),
            "shared_pattern_accounts": int(len(set(ta.index[ta.y == 1]) & set(tb.index[tb.y == 1]))),
            "note": "Background accounts share node IDs across samples; laundering-pattern membership differs.",
        }
    rep["pattern_transfer"] = transfer
    rep["runtime_seconds"] = round(time.perf_counter() - t0, 1)
    REPORT.write_text(json.dumps(rep, indent=2, default=str))
    return rep


if __name__ == "__main__":  # pragma: no cover
    r = main()
    print(json.dumps(r["samples"]))
    for n, v in r["within_sample"].items():
        for k, x in v.items():
            print(n, k, x["test"]["pr_auc"], x["test"]["precision"], x["test"]["recall"], "LR", x["logistic_test_pr_auc"])
    for k, v in r["pattern_transfer"].items():
        print(k, v["test"]["pr_auc"], v["test"]["precision"], v["test"]["recall"], v["shared_pattern_accounts"])
