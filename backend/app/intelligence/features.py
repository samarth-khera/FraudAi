"""Point-in-time features. The same code builds training rows and serves live investigations.

Transaction features (model A) for a transfer at time t use only that sender's and receiver's transfers with a
timestamp strictly before t: nothing at or after t, no post-transaction balance, no label, no identifier. Because they
depend only on the two parties' earlier records, computing them from a small extract (the parties' own histories) gives
exactly the result computed from the whole ledger; a test checks this.

Account features (model B) and graph features (model C) describe an account from its records up to ``as_of``, plus,
for the graph features, its direct counterparties' records up to ``as_of``.

Identifiers are used only to group records; they are never values in a feature vector.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

FEATURE_SCHEMA_VERSION = "pit-features-1.0.0"
_K = np.int64(1) << np.int64(36)  # time span per group key (seconds); ~2,000 years

# ---------------------------------------------------------------------------- model A
TXN_NUMERIC = [
    "log_amount",
    "amount_to_sender_balance",
    "sender_balance_missing",
    "s_prior_out_n",
    "s_prior_in_n",
    "s_history_days",
    "s_out_n_1h",
    "s_out_n_24h",
    "s_out_amount_24h_log",
    "s_amount_vs_prior_max",
    "s_amount_z",
    "s_new_recipients_24h",
    "s_distinct_recipients",
    "s_hours_since_last_out",
    "s_in_24h_to_amount",
    "s_minutes_since_last_in",
    "pair_prior_n",
    "first_time_pair",
    "r_prior_in_n",
    "r_prior_out_n",
    "r_history_days",
    "r_distinct_senders",
    "r_in_n_24h",
    "r_balance_before_log",
    "hour_sin",
    "hour_cos",
    "is_weekend",
]
TXN_TYPE_FEATURES = ["type_TRANSFER", "type_PAYMENT", "type_CASH_OUT", "type_CASH_IN", "type_DEBIT"]
TXN_CHANNEL_FEATURES = ["ch_UPI", "ch_IMPS", "ch_NEFT", "ch_RTGS", "ch_CARD_POS", "ch_ATM_CASH_OUT"]
TXN_FEATURES = TXN_NUMERIC + TXN_TYPE_FEATURES + TXN_CHANNEL_FEATURES

# Columns that must never be model inputs, whatever a future refactor does. Checked by tests and the leakage audit.
FORBIDDEN_INPUTS = {
    "transaction_id", "sender_account_id", "receiver_account_id", "source_record_id", "source_dataset", "label",
    "scenario_id", "scenario_tag", "is_suspicious_scenario", "ground_truth_label", "isFraud", "isFlaggedFraud",
    "newbalanceOrig", "newbalanceDest", "origin_balance_after", "dest_balance_after", "customer_name", "nameOrig",
    "nameDest", "account_id", "row_order",
    # Adapter and generator names for the same kind of information: the source's own fraud flag, a post-transaction
    # balance, simulator time indices, and the generator's ground-truth role/pattern columns.
    "source_flag", "post_sender_balance", "step", "fraudStep", "role", "role_detail", "pattern", "variant", "held_out",
    "materialised", "is_fraud",
}


def _secs(ts: pd.Series) -> np.ndarray:
    return (pd.to_datetime(ts).astype("datetime64[s]").astype(np.int64)).to_numpy()


class _Events:
    """One side of the ledger (outgoing or incoming) sorted by (account, time), with prefix sums for windows."""

    def __init__(self, acct: np.ndarray, t: np.ndarray, amount: np.ndarray, other: np.ndarray):
        order = np.lexsort((t, acct))
        self.acct, self.t, self.amt, self.other = acct[order], t[order], amount[order], other[order]
        self.key = self.acct.astype(np.int64) * _K + self.t
        # Running sums restart for every account, so one account's values never depend (even numerically) on
        # another account's records.
        g = pd.Series(self.amt).groupby(self.acct)
        self.ccs = g.cumsum().to_numpy() if len(self.amt) else self.amt
        self.ccs2 = (pd.Series(self.amt ** 2).groupby(self.acct).cumsum().to_numpy()) if len(self.amt) else self.amt
        self.cummax = g.cummax().to_numpy() if len(self.amt) else self.amt

    def lo(self, a: np.ndarray) -> np.ndarray:
        return np.searchsorted(self.key, a.astype(np.int64) * _K, "left")

    def before(self, a: np.ndarray, t: np.ndarray) -> np.ndarray:
        """Index one past the last event of account a strictly before t."""
        return np.searchsorted(self.key, a.astype(np.int64) * _K + t, "left")

    def wsum(self, cum: np.ndarray, start: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
        """Sum over events [lo, hi) of one account whose events start at ``start``, from its own running sum."""
        if not len(cum):
            return np.zeros(len(lo))
        upper = np.where(hi > start, cum[np.maximum(hi - 1, 0)], 0.0)
        lower = np.where(lo > start, cum[np.maximum(lo - 1, 0)], 0.0)
        return np.where(hi > lo, upper - lower, 0.0)


def transaction_features(tx: pd.DataFrame, targets: pd.Index | None = None) -> pd.DataFrame:
    """Decision-time features for the rows of ``tx`` in ``targets`` (default: all), indexed like ``tx``.

    ``tx`` is in the normalized schema. For exact results it must contain every earlier transfer of each target's
    sender and receiver; ``ledger.party_histories`` provides that extract online.
    """
    targets = tx.index if targets is None else targets
    t_all = _secs(tx["timestamp"])
    t0 = t_all.min() if len(t_all) else 0
    t_all = t_all - t0
    codes, uniq = pd.factorize(pd.concat([tx["sender_account_id"], tx["receiver_account_id"]], ignore_index=True))
    n = len(tx)
    s_code, r_code = codes[:n], codes[n:]
    amt = tx["amount"].to_numpy(dtype=float)
    out_ev = _Events(s_code, t_all, amt, r_code)
    in_ev = _Events(r_code, t_all, amt, s_code)
    pair_codes, _ = pd.factorize(pd.Series(s_code).astype(np.int64) * np.int64(len(uniq) + 1) + r_code)
    pair_ev = _Events(pair_codes, t_all, amt, r_code)
    # first time each (sender, receiver) pair occurred -> per-account "new counterparty" events
    first_pair = pd.DataFrame({"p": pair_codes, "s": s_code, "r": r_code, "t": t_all}).groupby("p", sort=False).agg(
        s=("s", "first"), r=("r", "first"), t=("t", "min"))
    newrec = _Events(first_pair["s"].to_numpy(), first_pair["t"].to_numpy(), np.ones(len(first_pair)), first_pair["r"].to_numpy())
    newsend = _Events(first_pair["r"].to_numpy(), first_pair["t"].to_numpy(), np.ones(len(first_pair)), first_pair["s"].to_numpy())

    pos = tx.index.get_indexer(targets)
    S, R, T, A = s_code[pos], r_code[pos], t_all[pos], amt[pos]
    P = pair_codes[pos]
    H, D = 3600, 86400

    def count(ev: _Events, a, t, w=None):
        hi = ev.before(a, t)
        lo = ev.lo(a) if w is None else ev.before(a, np.maximum(t - w, 0))
        return hi - lo, lo, hi

    f: dict[str, np.ndarray] = {}
    f["log_amount"] = np.log1p(A)
    sb = pd.to_numeric(tx["sender_balance_before"], errors="coerce").to_numpy(dtype=float)[pos]
    f["amount_to_sender_balance"] = np.where(np.isnan(sb), np.nan, A / (sb + 1.0))
    f["sender_balance_missing"] = np.isnan(sb).astype(float)

    s_out_n, s_lo, s_hi = count(out_ev, S, T)
    s_in_n, si_lo, si_hi = count(in_ev, S, T)
    f["s_prior_out_n"] = np.log1p(s_out_n)
    f["s_prior_in_n"] = np.log1p(s_in_n)
    first_s = np.minimum(np.where(s_out_n > 0, out_ev.t[np.minimum(s_lo, len(out_ev.t) - 1)], T),
                         np.where(s_in_n > 0, in_ev.t[np.minimum(si_lo, len(in_ev.t) - 1)], T)) if n else T
    f["s_history_days"] = (T - first_s) / D
    f["s_out_n_1h"] = count(out_ev, S, T, H)[0].astype(float)
    n24, lo24, hi24 = count(out_ev, S, T, D)
    f["s_out_n_24h"] = n24.astype(float)
    f["s_out_amount_24h_log"] = np.log1p(out_ev.wsum(out_ev.ccs, s_lo, lo24, hi24))
    has = s_out_n > 0
    prior_max = np.where(has, out_ev.cummax[np.maximum(s_hi - 1, 0)] if len(out_ev.amt) else 0.0, np.nan)
    f["s_amount_vs_prior_max"] = np.where(has, A / np.maximum(prior_max, 1.0), np.nan)
    tot = out_ev.wsum(out_ev.ccs, s_lo, s_lo, s_hi)
    tot2 = out_ev.wsum(out_ev.ccs2, s_lo, s_lo, s_hi)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = tot / np.maximum(s_out_n, 1)
        std = np.sqrt(np.maximum(tot2 / np.maximum(s_out_n, 1) - mean ** 2, 0.0))
        f["s_amount_z"] = np.where(s_out_n >= 3, (A - mean) / np.maximum(std, 1.0), np.nan)
    f["s_new_recipients_24h"] = count(newrec, S, T, D)[0].astype(float)
    f["s_distinct_recipients"] = np.log1p(count(newrec, S, T)[0])
    last_out = np.where(has, out_ev.t[np.maximum(s_hi - 1, 0)] if len(out_ev.t) else 0, np.nan)
    f["s_hours_since_last_out"] = np.where(has, np.log1p((T - last_out) / H), np.nan)
    in24, ilo, ihi = count(in_ev, S, T, D)
    f["s_in_24h_to_amount"] = in_ev.wsum(in_ev.ccs, si_lo, ilo, ihi) / np.maximum(A, 1.0)
    has_in = s_in_n > 0
    last_in = np.where(has_in, in_ev.t[np.maximum(si_hi - 1, 0)] if len(in_ev.t) else 0, np.nan)
    f["s_minutes_since_last_in"] = np.where(has_in, np.log1p((T - last_in) / 60.0), np.nan)
    pn = count(pair_ev, P, T)[0]
    f["pair_prior_n"] = np.log1p(pn)
    f["first_time_pair"] = (pn == 0).astype(float)

    r_in_n, ri_lo, _ = count(in_ev, R, T)
    r_out_n, ro_lo, _ = count(out_ev, R, T)
    f["r_prior_in_n"] = np.log1p(r_in_n)
    f["r_prior_out_n"] = np.log1p(r_out_n)
    first_r = np.minimum(np.where(r_in_n > 0, in_ev.t[np.minimum(ri_lo, len(in_ev.t) - 1)], T),
                         np.where(r_out_n > 0, out_ev.t[np.minimum(ro_lo, len(out_ev.t) - 1)], T)) if n else T
    f["r_history_days"] = (T - first_r) / D
    f["r_distinct_senders"] = np.log1p(count(newsend, R, T)[0])
    f["r_in_n_24h"] = count(in_ev, R, T, D)[0].astype(float)
    rb = pd.to_numeric(tx["receiver_balance_before"], errors="coerce").to_numpy(dtype=float)[pos]
    f["r_balance_before_log"] = np.where(np.isnan(rb), np.nan, np.log1p(np.maximum(rb, 0)))

    ts = pd.to_datetime(tx["timestamp"].to_numpy()[pos])
    hour = ts.hour.to_numpy() + ts.minute.to_numpy() / 60.0
    f["hour_sin"], f["hour_cos"] = np.sin(2 * np.pi * hour / 24), np.cos(2 * np.pi * hour / 24)
    f["is_weekend"] = (ts.dayofweek.to_numpy() >= 5).astype(float)
    ttype = tx["transaction_type"].to_numpy()[pos]
    for c in TXN_TYPE_FEATURES:
        f[c] = (ttype == c[5:]).astype(float)
    ch = tx["channel"].to_numpy()[pos]
    for c in TXN_CHANNEL_FEATURES:
        f[c] = (ch == c[3:]).astype(float)
    return pd.DataFrame(f, index=targets)[TXN_FEATURES]


# ---------------------------------------------------------------------------- models B and C
ACCOUNT_FEATURES = [
    "n_out_log", "n_in_log", "history_days", "active_days_log", "total_in_log", "total_out_log", "out_to_in_ratio",
    "distinct_senders_log", "distinct_recipients_log", "top_sender_share", "top_recipient_share", "out_amount_cv",
    "max_out_to_median_out", "pass_through_1h", "pass_through_24h", "median_hold_hours", "new_recipient_out_share",
    "max_gap_days", "out_share_after_max_gap", "night_out_share", "cash_out_share", "max_out_to_balance",
    "max_out_burst_1h",
]
GRAPH_FEATURES = [
    "senders_drained_in", "share_in_from_drains", "recipients_young_share", "recipient_forwarders_share",
    "sender_forwarders_share", "cycle_len_le3", "two_hop_out_reach_log", "shared_recipient_senders_log",
]
MIN_ACCOUNT_TRANSACTIONS = 5  # below this the account models abstain (see docs: "Insufficient history")


def _prep(tx: pd.DataFrame, as_of: pd.Timestamp | None) -> pd.DataFrame:
    d = tx if as_of is None else tx[pd.to_datetime(tx["timestamp"]) <= as_of]
    d = d.copy()
    d["_t"] = _secs(d["timestamp"])
    return d.sort_values(["_t", "transaction_id"], kind="mergesort")


def account_features(tx: pd.DataFrame, accounts: list[str], as_of: pd.Timestamp | None = None) -> pd.DataFrame:
    """Behaviour of each account from its own records up to ``as_of``. Also returns ``n_transactions``."""
    d = _prep(tx, as_of)
    accounts = list(dict.fromkeys(accounts))
    acc_set = set(accounts)
    out = d[d.sender_account_id.isin(acc_set)]
    inn = d[d.receiver_account_id.isin(acc_set)]
    end = d["_t"].max() if len(d) else 0
    if as_of is not None:
        end = int(pd.Timestamp(as_of).value // 10**9)
    rows = {}
    og = dict(tuple(out.groupby("sender_account_id", sort=False)))
    ig = dict(tuple(inn.groupby("receiver_account_id", sort=False)))
    empty = d.iloc[0:0]
    for a in accounts:
        o, i = og.get(a, empty), ig.get(a, empty)
        rows[a] = _one_account(o, i, end)
    df = pd.DataFrame.from_dict(rows, orient="index")
    return df.reindex(accounts)


def _one_account(o: pd.DataFrame, i: pd.DataFrame, end: int) -> dict:
    H, D = 3600.0, 86400.0
    ot, oa = o["_t"].to_numpy(), o["amount"].to_numpy(dtype=float)
    it, ia = i["_t"].to_numpy(), i["amount"].to_numpy(dtype=float)
    n_out, n_in = len(ot), len(it)
    allt = np.sort(np.concatenate([ot, it]))
    r: dict[str, float] = {"n_transactions": float(n_out + n_in)}
    r["n_out_log"], r["n_in_log"] = np.log1p(n_out), np.log1p(n_in)
    r["history_days"] = (end - allt[0]) / D if len(allt) else 0.0
    r["active_days_log"] = np.log1p(len(np.unique(allt // 86400))) if len(allt) else 0.0
    tin, tout = ia.sum(), oa.sum()
    r["total_in_log"], r["total_out_log"] = np.log1p(tin), np.log1p(tout)
    r["out_to_in_ratio"] = min(tout / tin, 5.0) if tin > 0 else (5.0 if tout > 0 else 0.0)
    r["distinct_senders_log"] = np.log1p(i["sender_account_id"].nunique()) if n_in else 0.0
    r["distinct_recipients_log"] = np.log1p(o["receiver_account_id"].nunique()) if n_out else 0.0
    r["top_sender_share"] = i.groupby("sender_account_id")["amount"].sum().max() / tin if tin > 0 else 0.0
    r["top_recipient_share"] = o.groupby("receiver_account_id")["amount"].sum().max() / tout if tout > 0 else 0.0
    r["out_amount_cv"] = oa.std() / oa.mean() if n_out > 1 else 0.0
    r["max_out_to_median_out"] = oa.max() / max(np.median(oa), 1.0) if n_out else 0.0
    # Pass-through: of each inflow >= 1,000, how much left within 1 h / 24 h (outflows matched once, in time order).
    pt1 = pt24 = 0.0
    holds = []
    big = ia >= 1000
    if n_out and big.any():
        cs = np.concatenate([[0.0], np.cumsum(oa)])
        for t, a in zip(it[big], ia[big]):
            lo = np.searchsorted(ot, t, "left")
            pt1 += min(cs[np.searchsorted(ot, t + H, "right")] - cs[lo], a)
            pt24 += min(cs[np.searchsorted(ot, t + D, "right")] - cs[lo], a)
            if lo < n_out:
                holds.append((ot[lo] - t) / H)
        r["pass_through_1h"], r["pass_through_24h"] = pt1 / ia[big].sum(), pt24 / ia[big].sum()
    else:
        r["pass_through_1h"] = r["pass_through_24h"] = 0.0
    r["median_hold_hours"] = float(np.median(holds)) if holds else 720.0
    if n_out:
        first = ~o["receiver_account_id"].duplicated().to_numpy()
        r["new_recipient_out_share"] = oa[first].sum() / tout if tout > 0 else 0.0
    else:
        r["new_recipient_out_share"] = 0.0
    if len(allt) > 1:
        gaps = np.diff(allt)
        g = int(np.argmax(gaps))
        r["max_gap_days"] = gaps[g] / D
        after = (ot > allt[g]) & (ot <= allt[g] + 7 * D)
        r["out_share_after_max_gap"] = oa[after].sum() / tout if tout > 0 else 0.0
    else:
        r["max_gap_days"] = r["out_share_after_max_gap"] = 0.0
    hours = (ot % 86400) // 3600
    r["night_out_share"] = oa[hours < 5].sum() / tout if tout > 0 else 0.0
    r["cash_out_share"] = oa[(o["transaction_type"] == "CASH_OUT").to_numpy()].sum() / tout if tout > 0 else 0.0
    bb = pd.to_numeric(o["sender_balance_before"], errors="coerce").to_numpy(dtype=float)
    ok = ~np.isnan(bb) & (bb > 0)
    r["max_out_to_balance"] = float(np.max(oa[ok] / bb[ok])) if ok.any() else 0.0
    if n_out:
        r["max_out_burst_1h"] = float((np.searchsorted(ot, ot + H, "right") - np.arange(n_out)).max())
    else:
        r["max_out_burst_1h"] = 0.0
    return r


def graph_features(tx: pd.DataFrame, accounts: list[str], as_of: pd.Timestamp | None = None) -> pd.DataFrame:
    """Network context of each account up to ``as_of``.

    Exact when ``tx`` holds every record of the accounts and of their direct counterparties (the local ledger).
    * senders_drained_in / share_in_from_drains: senders whose transfer to this account took >= 50% of their balance.
    * recipients_young_share: share of outgoing amount sent to accounts with < 30 days of records at that time.
    * recipient/sender_forwarders_share: share of counterparties that passed on >= 70% of an inflow within 24 h.
    * cycle_len_le3: the account is on a directed cycle of length 2 or 3 among its counterparties.
    * two_hop_out_reach_log: distinct accounts its recipients paid after receiving from it (within 72 h).
    * shared_recipient_senders_log: other accounts that paid the same recipients within 3 days of it.
    """
    d = _prep(tx, as_of)
    accounts = list(dict.fromkeys(accounts))
    s, r_, t, a = d["sender_account_id"].to_numpy(), d["receiver_account_id"].to_numpy(), d["_t"].to_numpy(), d["amount"].to_numpy(dtype=float)
    sb = pd.to_numeric(d["sender_balance_before"], errors="coerce").to_numpy(dtype=float)
    first_seen = pd.concat([pd.Series(t, index=s), pd.Series(t, index=r_)]).groupby(level=0).min()
    by_s = d.groupby("sender_account_id", sort=False).indices
    by_r = d.groupby("receiver_account_id", sort=False).indices
    fw_cache: dict[str, bool] = {}

    def forwards(acc: str) -> bool:
        if acc not in fw_cache:
            ii, oo = by_r.get(acc, []), by_s.get(acc, [])
            hit = False
            if len(ii) and len(oo):
                ot, oa = t[oo], a[oo]
                cs = np.concatenate([[0.0], np.cumsum(oa)])
                for k in ii:
                    if a[k] < 1000:
                        continue
                    lo, hi = np.searchsorted(ot, t[k], "left"), np.searchsorted(ot, t[k] + 86400, "right")
                    if cs[hi] - cs[lo] >= 0.7 * a[k]:
                        hit = True
                        break
            fw_cache[acc] = hit
        return fw_cache[acc]

    rows = {}
    for acc in accounts:
        ii, oo = by_r.get(acc, np.array([], int)), by_s.get(acc, np.array([], int))
        f: dict[str, float] = {}
        drained = (~np.isnan(sb[ii])) & (sb[ii] > 0) & (a[ii] >= 0.5 * sb[ii]) if len(ii) else np.array([], bool)
        f["senders_drained_in"] = float(len(set(s[ii][drained]))) if len(ii) else 0.0
        f["share_in_from_drains"] = a[ii][drained].sum() / a[ii].sum() if len(ii) and a[ii].sum() > 0 else 0.0
        if len(oo):
            young = np.array([(t[k] - first_seen.get(r_[k], t[k])) < 30 * 86400 for k in oo])
            f["recipients_young_share"] = a[oo][young].sum() / a[oo].sum()
        else:
            f["recipients_young_share"] = 0.0
        recips, senders = set(r_[oo]) - {acc}, set(s[ii]) - {acc}
        f["recipient_forwarders_share"] = np.mean([forwards(x) for x in recips]) if recips else 0.0
        f["sender_forwarders_share"] = np.mean([forwards(x) for x in senders]) if senders else 0.0
        cyc = bool(recips & senders)
        if not cyc:
            for x in recips:
                if set(r_[by_s.get(x, [])]) & senders:
                    cyc = True
                    break
        f["cycle_len_le3"] = float(cyc)
        reach, shared = set(), set()
        for k in oo:
            x = r_[k]
            xo = by_s.get(x, [])
            if len(xo):
                m = (t[xo] >= t[k]) & (t[xo] <= t[k] + 3 * 86400)
                reach |= set(r_[xo][m])
            xi = by_r.get(x, [])
            if len(xi):
                m = np.abs(t[xi] - t[k]) <= 3 * 86400
                shared |= set(s[xi][m])
        reach.discard(acc)
        shared.discard(acc)
        f["two_hop_out_reach_log"] = np.log1p(len(reach))
        f["shared_recipient_senders_log"] = np.log1p(len(shared))
        rows[acc] = f
    return pd.DataFrame.from_dict(rows, orient="index").reindex(accounts)[GRAPH_FEATURES]
