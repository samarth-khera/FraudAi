"""Chunked dataset validation and profiling for the PaySim CSV.

The CSV (~490 MB) is streamed in chunks; only small accumulators and a uint64 hash
per row (for duplicate detection) are kept in memory. The source file is only ever
opened read-only.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ml.config import EXPECTED_TYPES, REQUIRED_COLUMNS, TARGET


class DataValidationError(Exception):
    """Raised when the dataset is missing, unreadable, or structurally wrong."""


def file_sha256(path: Path, block: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(block), b""):
            h.update(chunk)
    return h.hexdigest()


def check_header(path: Path) -> list[str]:
    """Return the CSV header, raising DataValidationError for missing file/columns."""
    path = Path(path)
    if not path.is_file():
        raise DataValidationError(f"Dataset not found: {path}")
    try:
        header = list(pd.read_csv(path, nrows=0).columns)
    except Exception as exc:  # unreadable / not a CSV
        raise DataValidationError(f"Dataset is not readable as CSV: {exc}") from exc
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise DataValidationError(f"Missing required columns: {missing}")
    return header


def profile_csv(path: Path, chunksize: int = 500_000) -> dict[str, Any]:
    """Stream the file once and collect validation + EDA statistics (real observed values)."""
    path = Path(path)
    header = check_header(path)
    dtypes = {c: t for c, t in REQUIRED_COLUMNS.items()}

    rows = 0
    nulls: dict[str, int] = defaultdict(int)
    target_counts: dict[int, int] = defaultdict(int)
    type_rows: dict[str, int] = defaultdict(int)
    type_fraud: dict[str, int] = defaultdict(int)
    flagged = flagged_and_fraud = 0
    step_min, step_max = None, None
    steps_sorted, last_step = True, -1
    step_rows: dict[int, int] = defaultdict(int)
    step_fraud: dict[int, int] = defaultdict(int)
    amount = {"min": np.inf, "max": -np.inf, "negative": 0, "zero": 0}
    amount_sum = {0: 0.0, 1: 0.0}
    dest_both_zero = {0: 0, 1: 0}
    orig_new_zero = {0: 0, 1: 0}
    hashes: list[np.ndarray] = []

    try:
        reader = pd.read_csv(path, dtype=dtypes, chunksize=chunksize)
        for chunk in reader:
            rows += len(chunk)
            for c, n in chunk.isna().sum().items():
                nulls[c] += int(n)

            vals = set(chunk[TARGET].unique().tolist())
            bad = vals - {0, 1}
            if bad:
                raise DataValidationError(f"Target {TARGET} has values outside {{0,1}}: {sorted(bad)}")
            for k, n in chunk[TARGET].value_counts().items():
                target_counts[int(k)] += int(n)

            g = chunk.groupby("type", observed=True)[TARGET].agg(["size", "sum"])
            for t, r in g.iterrows():
                type_rows[t] += int(r["size"])
                type_fraud[t] += int(r["sum"])

            flagged += int((chunk["isFlaggedFraud"] == 1).sum())
            flagged_and_fraud += int(((chunk["isFlaggedFraud"] == 1) & (chunk[TARGET] == 1)).sum())

            s = chunk["step"]
            step_min = int(s.min()) if step_min is None else min(step_min, int(s.min()))
            step_max = int(s.max()) if step_max is None else max(step_max, int(s.max()))
            if int(s.iloc[0]) < last_step or not s.is_monotonic_increasing:
                steps_sorted = False
            last_step = int(s.iloc[-1])
            sr = chunk.groupby("step")[TARGET].agg(["size", "sum"])
            for st, r in sr.iterrows():
                step_rows[int(st)] += int(r["size"])
                step_fraud[int(st)] += int(r["sum"])

            a = chunk["amount"]
            amount["min"] = min(amount["min"], float(a.min()))
            amount["max"] = max(amount["max"], float(a.max()))
            amount["negative"] += int((a < 0).sum())
            amount["zero"] += int((a == 0).sum())
            for cls in (0, 1):
                m = chunk[TARGET] == cls
                amount_sum[cls] += float(a[m].sum())
                dest_both_zero[cls] += int(((chunk["oldbalanceDest"] == 0) & (chunk["newbalanceDest"] == 0) & (a > 0) & m).sum())
                orig_new_zero[cls] += int(((chunk["newbalanceOrig"] == 0) & m).sum())

            hashes.append(pd.util.hash_pandas_object(chunk, index=False).to_numpy(dtype=np.uint64))
    except DataValidationError:
        raise
    except Exception as exc:
        raise DataValidationError(f"Failed while parsing CSV (dtype/format problem?): {exc}") from exc

    if rows == 0:
        raise DataValidationError("Dataset contains no rows.")

    all_hashes = np.concatenate(hashes)
    del hashes
    duplicates = int(rows - np.unique(all_hashes).size)
    del all_hashes

    n_fraud = target_counts.get(1, 0)
    n_legit = target_counts.get(0, 0)
    return {
        "path": str(path),
        "file_size_bytes": path.stat().st_size,
        "columns": header,
        "dtypes_parsed": dtypes,
        "rows": rows,
        "missing_values": {c: int(nulls.get(c, 0)) for c in header},
        "duplicate_rows": duplicates,
        "duplicate_method": "64-bit row hash (collisions negligible but theoretically possible)",
        "class_distribution": {"legitimate_0": n_legit, "fraud_1": n_fraud},
        "fraud_prevalence": n_fraud / rows,
        "imbalance_ratio_legit_per_fraud": (n_legit / n_fraud) if n_fraud else None,
        "type_distribution": {t: {"rows": type_rows[t], "fraud": type_fraud[t],
                                  "fraud_rate": type_fraud[t] / type_rows[t]} for t in sorted(type_rows)},
        "unexpected_types": sorted(set(type_rows) - set(EXPECTED_TYPES)),
        "isFlaggedFraud": {"flagged_rows": flagged, "flagged_and_fraud": flagged_and_fraud,
                           "fraud_rows_not_flagged": n_fraud - flagged_and_fraud},
        "step": {"min": step_min, "max": step_max, "sorted_ascending": steps_sorted,
                 "distinct_steps": len(step_rows)},
        "amount": {**amount, "mean_legit": amount_sum[0] / max(n_legit, 1),
                   "mean_fraud": amount_sum[1] / max(n_fraud, 1)},
        "balance_quirks": {
            "dest_balances_both_zero_with_positive_amount": {"legit": dest_both_zero[0], "fraud": dest_both_zero[1]},
            "newbalanceOrig_zero": {"legit": orig_new_zero[0], "fraud": orig_new_zero[1]},
        },
        "per_step": {"rows": {int(k): v for k, v in step_rows.items()},
                     "fraud": {int(k): v for k, v in step_fraud.items()}},
    }


def validation_issues(profile: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) from a profile. Errors block training."""
    errors: list[str] = []
    warnings: list[str] = []
    cd = profile["class_distribution"]
    if cd["fraud_1"] == 0:
        errors.append("No fraud rows present; cannot train a classifier.")
    if cd["legitimate_0"] == 0:
        errors.append("No legitimate rows present.")
    if profile["unexpected_types"]:
        errors.append(f"Unexpected transaction types: {profile['unexpected_types']}")
    if profile["amount"]["negative"] > 0:
        errors.append(f"{profile['amount']['negative']} rows have negative amounts.")
    for c, n in profile["missing_values"].items():
        if n:
            warnings.append(f"Column {c} has {n} missing values.")
    if profile["duplicate_rows"]:
        warnings.append(f"{profile['duplicate_rows']} duplicate rows found.")
    if not profile["step"]["sorted_ascending"]:
        warnings.append("Rows are not sorted by step; chronological split sorts explicitly.")
    return errors, warnings


def validate_frame(df: pd.DataFrame, required: list[str] | None = None) -> None:
    """Validate an already-loaded modelling frame; raises DataValidationError."""
    required = required if required is not None else list(REQUIRED_COLUMNS)
    if len(df) == 0:
        raise DataValidationError("Dataset contains no rows.")
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise DataValidationError(f"Missing required columns: {missing}")
    if TARGET in df.columns:
        bad = set(pd.unique(df[TARGET])) - {0, 1}
        if bad:
            raise DataValidationError(f"Target {TARGET} has values outside {{0,1}}: {sorted(bad)}")
        if df[TARGET].sum() == 0:
            raise DataValidationError("No fraud rows present.")
        if df[TARGET].sum() == len(df):
            raise DataValidationError("No legitimate rows present.")
    nulls = df[[c for c in required if c in df.columns]].isna().sum()
    nulls = nulls[nulls > 0]
    if len(nulls):
        raise DataValidationError(f"Missing values found: {nulls.to_dict()}")
    if "type" in df.columns:
        unexpected = set(df["type"].astype(str).unique()) - set(EXPECTED_TYPES)
        if unexpected:
            raise DataValidationError(f"Unexpected transaction types: {sorted(unexpected)}")
    if "amount" in df.columns and (df["amount"] < 0).any():
        raise DataValidationError("Negative transaction amounts found.")


def load_modelling_frame(path: Path, columns: list[str]) -> pd.DataFrame:
    """Load only the needed columns with compact dtypes (no name columns, no flag column)."""
    if TARGET not in columns:
        columns = columns + [TARGET]
    check_header(path)
    dtypes: dict[str, Any] = {}
    for c in columns:
        t = REQUIRED_COLUMNS[c]
        dtypes[c] = {"float64": "float32", "string": "category"}.get(t, t)
    return pd.read_csv(path, usecols=columns, dtype=dtypes)
