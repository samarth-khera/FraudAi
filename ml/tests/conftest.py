"""Shared fixtures: a small synthetic frame used ONLY for unit tests (never for real training)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ml.config import EXPECTED_TYPES


def make_frame(n_steps: int = 40, per_step: int = 60, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = n_steps * per_step
    step = np.repeat(np.arange(1, n_steps + 1), per_step)
    typ = rng.choice(EXPECTED_TYPES, n)
    amount = rng.gamma(2.0, 5000.0, n).astype("float32")
    old_o = rng.gamma(2.0, 20000.0, n).astype("float32")
    old_d = (rng.random(n) < 0.5) * rng.gamma(2.0, 20000.0, n).astype("float32")
    fraud = ((typ == "TRANSFER") | (typ == "CASH_OUT")) & (amount > np.quantile(amount, 0.93))
    new_o = np.where(fraud, 0, np.maximum(old_o - amount, 0)).astype("float32")
    new_d = (old_d + amount).astype("float32")
    return pd.DataFrame({
        "step": step.astype("int32"), "type": typ, "amount": amount,
        "oldbalanceOrg": old_o, "newbalanceOrig": new_o,
        "oldbalanceDest": old_d.astype("float32"), "newbalanceDest": new_d,
        "isFraud": fraud.astype("int8"),
        "isFlaggedFraud": np.zeros(n, dtype="int8"),
        "nameOrig": [f"C{i}" for i in range(n)], "nameDest": [f"M{i}" for i in range(n)],
    })


@pytest.fixture
def frame() -> pd.DataFrame:
    return make_frame()
