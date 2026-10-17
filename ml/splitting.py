"""Chronological train/validation/test split on the `step` column."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ml.config import TARGET, TRAIN_FRACTION, VAL_FRACTION


@dataclass(frozen=True)
class SplitInfo:
    train_max_step: int
    val_max_step: int
    train_rows: int
    val_rows: int
    test_rows: int
    train_fraud: int
    val_fraud: int
    test_fraud: int


def chronological_split(
    df: pd.DataFrame,
    train_fraction: float = TRAIN_FRACTION,
    val_fraction: float = VAL_FRACTION,
    target: str = TARGET,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, SplitInfo]:
    """Split by time: train < validation < test, never sharing a `step`.

    Cut points are the smallest whole-step boundaries whose cumulative row share reaches
    the requested fractions. Raises ValueError if a partition would be empty or contain
    no fraud (a model can't be fitted/selected/evaluated on it).
    """
    if not 0 < train_fraction < 1 or not 0 < val_fraction < 1 or train_fraction + val_fraction >= 1:
        raise ValueError("Fractions must be in (0,1) and leave a non-empty test share.")
    if "step" not in df.columns:
        raise ValueError("DataFrame must contain a 'step' column.")

    steps = df["step"].to_numpy()
    uniq, counts = np.unique(steps, return_counts=True)
    cum = np.cumsum(counts) / counts.sum()
    train_max = int(uniq[np.searchsorted(cum, train_fraction, side="left")])
    val_max = int(uniq[np.searchsorted(cum, train_fraction + val_fraction, side="left")])
    if val_max <= train_max:
        raise ValueError("Not enough distinct steps to form three chronological partitions.")

    train = df[df["step"] <= train_max]
    val = df[(df["step"] > train_max) & (df["step"] <= val_max)]
    test = df[df["step"] > val_max]
    if min(len(train), len(val), len(test)) == 0:
        raise ValueError("A chronological partition is empty.")

    info = SplitInfo(train_max, val_max, len(train), len(val), len(test),
                     int(train[target].sum()), int(val[target].sum()), int(test[target].sum()))
    for name, n in (("train", info.train_fraud), ("validation", info.val_fraud), ("test", info.test_fraud)):
        if n == 0:
            raise ValueError(f"The {name} partition contains no fraud rows.")
    return train, val, test, info
