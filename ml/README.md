# FraudShield AI — ML pipeline (Phase 2: first training pipeline)

Separate from `backend/`. Trains and evaluates transaction fraud-risk models on the
**PaySim** dataset (a *synthetic* mobile-money simulation, not real customers).
Model output is decision support for human review; it never freezes accounts and a high
score is not evidence of guilt.

## Setup

Uses the existing virtual environment from the backend.

```bash
# from the repository root
backend/.venv/bin/pip install -r ml/requirements.txt
```

Place the dataset (not committed; `data/raw/` is git-ignored) at
`data/raw/PS_20174392719_1491204439457_log.csv`. The file is only ever opened read-only.

## Commands (run from repository root)

```bash
# 1. Validate + EDA (streams the CSV in chunks) -> ml/reports/eda_report.{md,json}
backend/.venv/bin/python -m ml.eda

# 2. Train, select threshold on validation, evaluate on test, save artifacts
backend/.venv/bin/python -m ml.train

# 3. ML unit tests
backend/.venv/bin/python -m pytest ml/tests -q

# Phase 1 backend tests (unchanged)
cd backend && .venv/bin/python -m pytest -q
```

If validation fails, `ml.train` exits with code 2 and prints the real error; it never
substitutes other data.

## Design

| Module | Role |
|---|---|
| `config.py` | paths, required columns, excluded columns, split fractions |
| `data_validation.py` | chunked profiling/validation, frame validation, compact loader |
| `features.py` | feature sets, engineering, sklearn pipeline, feature schema |
| `splitting.py` | chronological split by `step` |
| `evaluation.py` | metrics, validation-only threshold selection |
| `train.py` | experiment runner and artifact saving |
| `model_card.py` | model card rendered from computed metrics |
| `inference.py` | `FraudModel.load()` / `predict_proba()` / `predict()` |

### Leakage safeguards
- Target `isFraud`; `isFlaggedFraud` (simulator's own flag) and raw `nameOrig`/`nameDest` IDs are never features.
- **Chronological split** on `step` (70/15/15 by rows, cut on whole steps): fit on train; early stopping, model selection and threshold on validation; test scored once.
- Two feature sets: `pre_transaction` (step→hour, type, amount, **old** balances + derived ratios/flags; deployable candidate) and `with_post_balance` (adds **new** balances and balance-error features). Post-transaction fields are written after execution and encode simulator mechanics, so that model is reported for comparison only and is never selected for deployment. Availability of any balance field at prediction time must be confirmed before use.
- Imbalance: `class_weight="balanced"` (logistic regression) and `scale_pos_weight` = neg/pos computed on train only (XGBoost). The dummy baseline uses a fixed 0.5 threshold.

## Outputs

- `ml/reports/eda_report.md|json` — observed dataset statistics
- `ml/reports/metrics.json`, `ml/reports/model_card.md` — all models, validation + test metrics
- `ml/artifacts/model_v1/` — `pipeline.joblib` (git-ignored binary), `feature_schema.json`, `threshold.json`, `metrics.json`, `model_card.md`

Load without retraining:

```python
from ml.inference import FraudModel
model = FraudModel.load()           # ml/artifacts/model_v1
scores = model.predict_proba(df)    # df has the columns in feature_schema.json
flags = model.predict(df)           # score >= saved threshold -> review flag
```

See `ml/reports/model_card.md` for the actual results and limitations.
