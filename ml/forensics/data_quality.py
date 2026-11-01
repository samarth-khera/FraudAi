"""Data-quality and exploration report for the forensic ledgers, plus an external check on the demo ledger.

    PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.data_quality

Writes ml/reports/data_quality_v3.json. PaySim and AMLSim have their own sections in their scripts' reports.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text

from backend.app.intelligence import models as mdl
from backend.app.intelligence.features import (MIN_ACCOUNT_TRANSACTIONS, TXN_FEATURES, account_features, graph_features,
                                               transaction_features)
from backend.app.intelligence.ledger import v2_rows_to_frame
from backend.app.intelligence.schema import validate_transactions
from ml.forensics.adapters import forensic_frame, sha256
from ml.forensics.evaluation import metrics
from ml.forensics.generator import GENERATOR_VERSION, LEDGERS, generate_ledger

REPORT = Path("ml/reports/data_quality_v3.json")
DEMO_DB = Path("data/v2_fraudshield.db")


def describe_ledger(name: str) -> dict:
    L = generate_ledger(name)
    df = forensic_frame(L)
    valid, rep = validate_transactions(df)
    y = valid["label"].to_numpy()
    X = transaction_features(valid)
    by_label = {}
    for f in TXN_FEATURES:
        v = X[f]
        by_label[f] = {str(k): {"mean": round(float(g.mean()), 4) if g.notna().any() else None, "missing_share": round(float(g.isna().mean()), 4)}
                       for k, g in v.groupby(y)}
    amounts = valid.groupby("label")["amount"].quantile([0.01, 0.5, 0.99]).unstack().round(2)
    return {
        "config": {"seed": L.config.seed, "days": L.config.days, "people": L.config.num_people, "include_held_out": L.config.include_held_out},
        "generator_version": GENERATOR_VERSION,
        "validation": rep.as_dict(),
        "rows": len(valid), "accounts": int(L.accounts.shape[0]),
        "label_prevalence": round(float(y.mean()), 5), "positives": int(y.sum()), "negatives": int(len(y) - y.sum()),
        "positives_by_type": valid.groupby("transaction_type")["label"].agg(["sum", "count"]).astype(int).to_dict("index"),
        "positives_by_channel": valid.groupby("channel")["label"].agg(["sum", "count"]).astype(int).to_dict("index"),
        "amount_quantiles_by_label": {str(k): v for k, v in amounts.to_dict("index").items()},
        "missing_values": {c: int(n) for c, n in valid[[c for c in valid.columns if c not in ("label", "scenario_id")]].isna().sum().items() if n},
        "duplicate_transaction_ids": int(df.transaction_id.duplicated().sum()),
        "exact_duplicate_rows": int(df.drop(columns=["transaction_id", "source_record_id"]).duplicated().sum()),
        "feature_mean_by_label": by_label,
        "roles": L.roles.groupby("role")["materialised"].agg(["count", "sum"]).astype(int).rename(columns={"sum": "materialised"}).to_dict("index"),
        "scenarios_by_pattern": L.scenarios.groupby(["pattern", "variant"]).size().rename("n").reset_index().to_dict("records"),
        "unfundable_scenario_legs_skipped": L.skipped_legs,
        # Night = 00:00-04:59. "scenario" counts every scenario transfer, takeovers included; the takeover pattern is
        # night-heavy by design, so the share without it is reported separately.
        "time_of_day_night_share": {"scenario": round(float((valid.loc[y == 1, "timestamp"].dt.hour < 5).mean()), 4),
                                    "ordinary": round(float((valid.loc[y == 0, "timestamp"].dt.hour < 5).mean()), 4)},
        "time_of_day_night_share_detail": night_shares(valid, y, L.scenarios),
        "round_amount_share": {"scenario": round(float((valid.loc[y == 1, "amount"] % 500 == 0).mean()), 4),
                               "ordinary": round(float((valid.loc[y == 0, "amount"] % 500 == 0).mean()), 4)},
    }


def night_shares(valid: pd.DataFrame, y: np.ndarray, scenarios: pd.DataFrame) -> dict:
    """Share of transfers between 00:00 and 04:59, for scenario transfers with and without the takeover pattern."""
    night = valid["timestamp"].dt.hour < 5
    pattern = valid["scenario_id"].map(scenarios.set_index("scenario_id")["pattern"])
    pos = y == 1
    take = pos & (pattern == "takeover").to_numpy()
    def share(m):
        return round(float(night[m].mean()), 4) if m.any() else None
    return {"night_hours": "00:00-04:59",
            "scenario_including_takeovers": share(pos), "scenario_rows_including_takeovers": int(pos.sum()),
            "scenario_excluding_takeovers": share(pos & ~take), "scenario_rows_excluding_takeovers": int((pos & ~take).sum()),
            "takeover_only": share(take), "takeover_rows": int(take.sum()),
            "ordinary": share(~pos), "ordinary_rows": int((~pos).sum())}


# v2 demo-ledger account labels that correspond to the account model's positive class (role intermediary or
# attacker_controlled: accounts that move or collect scenario money). Victims, cash terminals and every legitimate_*
# label are negatives. Evaluation only.
DEMO_ACCOUNT_POSITIVE_LABELS = ("mule_aggregator", "mule_feeder", "mule_first_hop", "mule_intermediate", "shell_roundtripper",
                                "dormant_awakened_mule")


def demo_account_model_check(valid: pd.DataFrame, eng) -> dict:
    """Score the served (champion) account model on every demo-ledger account at the ledger's end, exactly as the engine
    scores an account: behaviour features + graph features from all records, abstaining below MIN_ACCOUNT_TRANSACTIONS."""
    m = mdl.load("account_model")
    with eng.connect() as c:
        acc = pd.DataFrame(c.execute(text("select account_id, ground_truth_label, customer_type from accounts")).all(),
                           columns=["account_id", "ground_truth_label", "customer_type"])
    ids = sorted(set(valid.sender_account_id) | set(valid.receiver_account_id))
    X = account_features(valid, ids).join(graph_features(valid, ids))
    enough = X["n_transactions"] >= MIN_ACCOUNT_TRANSACTIONS
    lab = acc.set_index("account_id")["ground_truth_label"]
    y_all = np.asarray(X.index.map(lab).isin(DEMO_ACCOUNT_POSITIVE_LABELS), dtype=int)
    Xs = X[enough.to_numpy()]
    s = m.score(Xs)
    p = s["calibrated_probability"].to_numpy()
    y = np.asarray(Xs.index.map(lab).isin(DEMO_ACCOUNT_POSITIVE_LABELS), dtype=int)
    flagged = s["above_threshold"].to_numpy()
    by_label = (pd.DataFrame({"label": Xs.index.map(lab), "flagged": flagged}).groupby("label")["flagged"]
                .agg(["count", "sum"]).astype(int).rename(columns={"sum": "flagged"}).to_dict("index"))
    return {
        "model_version": m.version, "artifact": "ml/artifacts/v3/account_model (served champion)",
        "threshold": {"value": m.threshold, "on": m.meta["threshold"].get("on")},
        "as_of": "ledger end (all records)", "positive_labels": list(DEMO_ACCOUNT_POSITIVE_LABELS),
        "accounts_in_ledger": int(len(acc)), "accounts_with_transfers": int(len(X)),
        "abstained_below_min_transactions": int((~enough).sum()), "positives_abstained": int(y_all[~enough.to_numpy()].sum()),
        "metrics": metrics(y, p, m.threshold, "demo ledger accounts (different generator; not used for any choice)"),
        "accounts_with_3plus_features_outside_training_range": int((s["outside_training_range"] >= 3).sum()),
        "flag_rate_by_ground_truth_label": by_label,
    }


def demo_ledger_check() -> dict:
    """The models were trained on the forensic generator; the demo ledger comes from a different generator. Its five
    planted scenarios carry transaction labels (is_suspicious_scenario), read here for evaluation only."""
    eng = create_engine(f"sqlite:///{DEMO_DB}")
    with eng.connect() as c:
        rows = c.execute(text("select transaction_id, timestamp, origin_account_id, destination_account_id, amount, currency, channel, status, "
                              "origin_balance_before, dest_balance_before from transactions")).all()
        labels = dict(c.execute(text("select transaction_id, is_suspicious_scenario from transactions")).all())
    df = v2_rows_to_frame(rows, "demo-ledger")
    valid, rep = validate_transactions(df)
    y = valid["transaction_id"].map(labels).astype(int).to_numpy()
    m = mdl.load("transaction_model")
    X = transaction_features(valid)
    s = m.score(X)
    p = s["calibrated_probability"].to_numpy()
    out = {"database_sha256": sha256(DEMO_DB), "validation": rep.as_dict(), "rows": len(valid), "positives": int(y.sum()),
           "transaction_model": metrics(y, p, m.threshold, "demo ledger (different generator; not used for any choice)"),
           "rows_with_3plus_features_outside_training_range": int((s["outside_training_range"] >= 3).sum()),
           "account_model": demo_account_model_check(valid, eng),
           "reading": "Distribution shift check: the demo generator's ordinary activity and five single scenarios differ from the "
                      "forensic generator the models were trained on."}
    return out


def main() -> dict:
    rep = {"forensic_ledgers": {n: describe_ledger(n) for n in LEDGERS}, "demo_ledger_external_check": demo_ledger_check()}
    REPORT.write_text(json.dumps(rep, indent=2, default=str))
    return rep


if __name__ == "__main__":  # pragma: no cover
    r = main()
    for n, v in r["forensic_ledgers"].items():
        print(n, v["rows"], v["positives"], v["label_prevalence"], v["validation"], v["time_of_day_night_share_detail"], v["round_amount_share"])
    d = r["demo_ledger_external_check"]
    print("demo", d["rows"], d["positives"], {k: d["transaction_model"][k] for k in ("precision", "recall", "pr_auc", "roc_auc", "confusion_matrix")},
          d["rows_with_3plus_features_outside_training_range"])
    a = d["account_model"]
    print("demo account model", a["model_version"], a["accounts_with_transfers"], "abstained", a["abstained_below_min_transactions"],
          {k: a["metrics"][k] for k in ("n", "positives", "precision", "recall", "pr_auc", "roc_auc", "false_positive_rate", "confusion_matrix")},
          "3+ out of range", a["accounts_with_3plus_features_outside_training_range"])
