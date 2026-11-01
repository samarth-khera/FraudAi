"""Per-prediction feature contributions in plain language.

XGBoost models use TreeSHAP contributions (``pred_contribs``); logistic models use coefficient x standardised value.
They describe what moved this model's score, on the log-odds scale. They are not causes, and a factor is never
presented as proof of anything about the account holder.
"""

from __future__ import annotations

import math
from typing import Callable, Optional

import numpy as np
import pandas as pd

try:
    from app.intelligence.models import ScoringModel
except ModuleNotFoundError:
    from backend.app.intelligence.models import ScoringModel


def _n(x: float) -> str:
    return f"{x:,.0f}"


def _cnt(log1p: float) -> float:
    return math.expm1(log1p)


# feature -> function(value) returning a sentence about the observed value (None = do not show)
LABELS: dict[str, Callable[[float], Optional[str]]] = {
    "log_amount": lambda v: f"Amount {_n(math.expm1(v))}",
    "amount_to_sender_balance": lambda v: f"Took {v:.0%} of the sender's balance just before it",
    "s_prior_out_n": lambda v: f"Sender had {_n(_cnt(v))} earlier outgoing transfer(s)",
    "s_prior_in_n": lambda v: f"Sender had {_n(_cnt(v))} earlier incoming transfer(s)",
    "s_history_days": lambda v: f"Sender's records start {v:.0f} day(s) earlier",
    "s_out_n_1h": lambda v: f"{_n(v)} other outgoing transfer(s) by the sender in the previous hour",
    "s_out_n_24h": lambda v: f"{_n(v)} other outgoing transfer(s) by the sender in the previous 24 h",
    "s_out_amount_24h_log": lambda v: f"Sender paid out {_n(math.expm1(v))} in the previous 24 h",
    "s_amount_vs_prior_max": lambda v: f"{v:.1f}x the sender's largest earlier outgoing transfer",
    "s_amount_z": lambda v: f"{v:+.1f} standard deviations from the sender's usual outgoing amount",
    "s_new_recipients_24h": lambda v: f"{_n(v)} new recipient(s) paid by the sender in the previous 24 h",
    "s_distinct_recipients": lambda v: f"Sender had paid {_n(_cnt(v))} different account(s) before",
    "s_hours_since_last_out": lambda v: f"{math.expm1(v):.1f} h since the sender's previous outgoing transfer",
    "s_in_24h_to_amount": lambda v: f"Sender received {v:.0%} of this amount in the previous 24 h",
    "s_minutes_since_last_in": lambda v: f"{math.expm1(v):,.0f} min since the sender last received money",
    "pair_prior_n": lambda v: f"{_n(_cnt(v))} earlier transfer(s) between these two accounts",
    "first_time_pair": lambda v: "First recorded transfer between these two accounts" if v else "These accounts had transacted before",
    "r_prior_in_n": lambda v: f"Receiver had {_n(_cnt(v))} earlier incoming transfer(s)",
    "r_prior_out_n": lambda v: f"Receiver had {_n(_cnt(v))} earlier outgoing transfer(s)",
    "r_history_days": lambda v: f"Receiver's records start {v:.0f} day(s) earlier",
    "r_distinct_senders": lambda v: f"Receiver had been paid by {_n(_cnt(v))} different account(s) before",
    "r_in_n_24h": lambda v: f"Receiver got {_n(v)} other transfer(s) in the previous 24 h",
    "r_balance_before_log": lambda v: f"Receiver's balance before: {_n(math.expm1(v))}",
    "hour_sin": lambda v: None, "hour_cos": lambda v: None,
    "is_weekend": lambda v: "Weekend" if v else None,
    # account behaviour
    "n_out_log": lambda v: f"{_n(_cnt(v))} outgoing transfer(s) on record",
    "n_in_log": lambda v: f"{_n(_cnt(v))} incoming transfer(s) on record",
    "history_days": lambda v: f"Records span {v:.0f} day(s)",
    "active_days_log": lambda v: f"Active on {_n(_cnt(v))} day(s)",
    "total_in_log": lambda v: f"Received {_n(math.expm1(v))} in total",
    "total_out_log": lambda v: f"Sent {_n(math.expm1(v))} in total",
    "out_to_in_ratio": lambda v: f"Sent out {v:.2f}x what it received",
    "distinct_senders_log": lambda v: f"Paid by {_n(_cnt(v))} different account(s)",
    "distinct_recipients_log": lambda v: f"Paid {_n(_cnt(v))} different account(s)",
    "top_sender_share": lambda v: f"{v:.0%} of incoming money came from one sender",
    "top_recipient_share": lambda v: f"{v:.0%} of outgoing money went to one recipient",
    "out_amount_cv": lambda v: f"Outgoing amounts vary by {v:.1f}x their mean (coefficient of variation)",
    "max_out_to_median_out": lambda v: f"Largest outgoing transfer is {v:.1f}x its median one",
    "pass_through_1h": lambda v: f"{v:.0%} of money received (inflows of 1,000+) was sent on within 1 h",
    "pass_through_24h": lambda v: f"{v:.0%} of money received (inflows of 1,000+) was sent on within 24 h",
    "median_hold_hours": lambda v: f"Median {v:.1f} h between receiving money and the next payment out",
    "new_recipient_out_share": lambda v: f"{v:.0%} of outgoing money went to recipients on their first payment",
    "max_gap_days": lambda v: f"Longest gap without activity: {v:.0f} day(s)",
    "out_share_after_max_gap": lambda v: f"{v:.0%} of outgoing money left in the 7 days after that gap",
    "night_out_share": lambda v: f"{v:.0%} of outgoing money sent between 00:00 and 05:00",
    "cash_out_share": lambda v: f"{v:.0%} of outgoing money withdrawn as cash",
    "max_out_to_balance": lambda v: f"One payment took {v:.0%} of the balance it was paid from",
    "max_out_burst_1h": lambda v: f"Up to {_n(v)} outgoing transfer(s) within one hour",
    "senders_drained_in": lambda v: f"{_n(v)} sender(s) paid it at least half of their balance",
    "share_in_from_drains": lambda v: f"{v:.0%} of its incoming money came from such balance-draining payments",
    "recipients_young_share": lambda v: f"{v:.0%} of outgoing money went to accounts with under 30 days of records",
    "recipient_forwarders_share": lambda v: f"{v:.0%} of its recipients passed most of an inflow on within 24 h",
    "sender_forwarders_share": lambda v: f"{v:.0%} of its senders passed most of an inflow on within 24 h",
    "cycle_len_le3": lambda v: "Part of a 2- or 3-account loop of payments" if v else None,
    "two_hop_out_reach_log": lambda v: f"Its recipients paid {_n(_cnt(v))} further account(s) within 3 days",
    "shared_recipient_senders_log": lambda v: f"{_n(_cnt(v))} other account(s) paid the same recipients within 3 days",
}


def contributions(model: ScoringModel, X: pd.DataFrame) -> np.ndarray:
    """(rows x features) contributions on the log-odds scale, aligned with ``model.features``."""
    Xf = X[model.features].astype(float)
    if model._booster is not None:
        import xgboost as xgb

        c = model._booster.predict(xgb.DMatrix(Xf.to_numpy(), feature_names=model.features, missing=np.nan), pred_contribs=True)
        return c[:, :-1]
    v = Xf.to_numpy()
    v = np.where(np.isnan(v), model._impute, v)
    z = (v - model._mean[: v.shape[1]]) / model._scale[: v.shape[1]]
    return z * model._coef[: v.shape[1]]


def top_factors(model: ScoringModel, X: pd.DataFrame, k: int = 3) -> list[list[dict]]:
    """For each row: up to k features that raised the score most, with the observed value in words."""
    c = contributions(model, X)
    out = []
    Xf = X[model.features]
    for i in range(len(X)):
        row = []
        for j in np.argsort(-c[i]):
            if c[i, j] <= 0 or len(row) >= k:
                break
            f = model.features[j]
            v = Xf.iloc[i, j]
            text = None if pd.isna(v) else LABELS.get(f, lambda _: None)(float(v))
            if text:
                row.append({"feature": f, "label": text, "value": None if pd.isna(v) else round(float(v), 4),
                            "contribution": round(float(c[i, j]), 4)})
        out.append(row)
    return out
