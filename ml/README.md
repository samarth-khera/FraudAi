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

---

# v3: dynamic fraud intelligence (`ml/forensics/`)

The models behind `POST /api/v2/dynamic-investigations`. The feature code is shared with serving:
`backend/app/intelligence/features.py` is imported by both the training scripts and the API, so nothing can drift.
Full documentation, with results: [docs/DYNAMIC_INTELLIGENCE.md](../docs/DYNAMIC_INTELLIGENCE.md).

| Module | Role |
|---|---|
| `generator.py` | Forensic scenario generator (12 documented patterns, account roles, held-out variants, three fixed ledgers) |
| `adapters.py` | PaySim, AMLSim and forensic-ledger adapters into the normalized schema |
| `evaluation.py` | Rare-event metrics, validation-only thresholds, group bootstrap |
| `modeling.py` | Candidate models, imbalance strategies, calibration and text (JSON) export |
| `train_transaction_model.py` | Model A: decision-time transaction risk |
| `train_account_model.py` | Models B and C: account behaviour, with and without graph features. Writes the challenger only; `--promote` is needed to replace the served model |
| `compare_account_models.py` | Champion vs challenger on the corrected labels, by snapshot, history length and role |
| `evaluate_investigations.py` | The whole engine against ground-truth roles |
| `safety_scan.py` | Ledger-wide innocent-counterparty safety scan of the engine on the served ledger |
| `verify_tracing.py` | Independent SQL verification of fund tracing (amounts, endings, loops, limits) |
| `analyse_false_negative.py` | Diagnosis of the scenario 4 missed victim transfer and the threshold trade-off |
| `demonstrate_scenarios.py` | Ten end-to-end scenarios; writes `docs/SCENARIO_DEMONSTRATION.md` |
| `paysim_transaction_model.py`, `amlsim_graph_benchmark.py` | Source-specific external evaluations |
| `data_quality.py` | Data-quality report and the demo-ledger distribution-shift check (both v3 models) |

Artifacts in `ml/artifacts/v3/`:

| Directory | Model | Served | Report |
|---|---|---|---|
| `transaction_model/` | `v3-transaction-1.0.0` | Yes | `ml/reports/transaction_model_v3.json` |
| `account_model/` | `v3-account-1.0.0` (champion; trained on pre-correction planned-role labels) | Yes | `ml/reports/account_model_v3.json` |
| `account_model_challenger/` | `v3-account-1.1.0` (challenger; multi-snapshot, corrected labels, graph features, isotonic) | No | `ml/reports/account_model_v3_challenger.json` |

Each holds `model.json` (the XGBoost booster in its native JSON, no pickle) and `metadata.json` (features, calibration
map, threshold, training ranges, metrics, seeds and versions). They are committed because they are small.

The challenger is not served: the owner decides on promotion. `ml/reports/account_model_champion_challenger.json`
compares the two on the corrected labels and explains the challenger's higher false-positive rate on long histories (an
isotonic plateau at its threshold) and its larger train–validation gap (in-sample saturation, not leakage). Note that
the challenger's own report and metadata still say `promotion.promoted: true`; that was written by an earlier version of
the script that promoted automatically, and the promotion was undone. Promotion and rollback steps are in
[docs/DYNAMIC_INTELLIGENCE.md §7.4](../docs/DYNAMIC_INTELLIGENCE.md#74-promotion-status-rule-and-how-to-do-it).

Other reports: `investigation_eval_{train,cold,demo}.json`, `safety_scan.json`, `tracing_verification.json`,
`scenario4_false_negative.json`, `scenario_demonstration.json`, `data_quality_v3.json`, `paysim_transaction_model.json`
and `amlsim_graph_benchmark.json`. Files ending in `_previous.json` are earlier runs kept for comparison; they are not
current results.
