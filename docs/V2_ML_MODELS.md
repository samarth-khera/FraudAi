# FraudShield AI V2 — Phase 4: Machine Learning Models & Evaluation

## Executive Overview
FraudShield AI V2 integrates machine learning as an **explainable, non-punitive decision support system**. Rather than deploying opaque black-box models, V2 delivers:

1. **Transaction-Level Benchmark Model**: Trained on the historic PaySim mobile money dataset using strict chronological splitting and pre-transaction features only.
2. **Account-Behaviour Risk Model**: Trained on the V2 synthetic banking ledger using observable profile attributes, velocity signals, and network metrics, strictly evaluated on unseen crime scenarios.
3. **Native TreeSHAP Local Explanations**: Explains each individual account's prediction with exact Shapley contribution scores without fabricating values.
4. **Separation of Concepts**: Distinct separation between the heuristic baseline rules (`/api/v2/accounts/{id}/assessment`) and statistical ML probabilities (`/api/v2/accounts/{id}/ml-assessment`).

---

## 1. PaySim Transaction-Level Benchmark Model

The PaySim model serves as an academic and historical benchmark. It is **strictly isolated** from synthetic V2 core banking transactions.

### Data & Chronological Split
To prevent temporal lookahead bias, evaluation uses strict chronological horizons along the continuous `step` timeline (hours 1 to 743, ~31 simulation days):
- **Training Set**: Steps 1 to 500 (Days 1–20): $6,061,807$ total transactions ($5,561$ fraud). Negative class was subsampled to 100,000 for efficient gradient boosting while preserving 100% of fraud cases.
- **Validation Set**: Steps 501 to 620 (Days 21–25): $209,984$ transactions ($1,286$ fraud). Used exclusively for decision threshold tuning.
- **Held-Out Test Set**: Steps 621 to 743 (Days 26–31): $90,829$ transactions ($1,366$ fraud). Reserved strictly for final unpolluted evaluation.

### Pre-Transaction Feature Schema
| Feature | Type | Description |
| :--- | :--- | :--- |
| `step` | Float | Simulation hour of the transfer. |
| `amount` | Float | Transfer currency amount. |
| `oldbalanceOrg` | Float | Origin account balance prior to transaction. |
| `oldbalanceDest` | Float | Destination account balance prior to transaction. |
| `amount_to_oldbalanceOrg_ratio` | Float | Ratio of transfer amount to origin pre-balance. |
| `is_origin_zero_balance` | Binary | 1 if origin pre-balance is zero, else 0. |
| `is_dest_zero_balance` | Binary | 1 if destination pre-balance is zero, else 0. |
| `step_hour` | Float | Hour of the day (`step % 24`). |
| `step_day` | Float | Day of the month (`step // 24`). |
| `type_{CASH_IN, CASH_OUT, DEBIT, PAYMENT, TRANSFER}` | Binary | One-hot encoded transaction rails. |

**Strict Leakage Exclusions:**
- `newbalanceOrig` & `newbalanceDest`: Excluded because post-transaction balances leak whether funds actually left/arrived.
- `nameOrig` & `nameDest`: Excluded to prevent overfitting on entity identifiers.
- `isFlaggedFraud`: Excluded (post-hoc rule output).

### Benchmark Evaluation Metrics (Held-Out Test Set: 90,829 txns)
- **Model Type**: XGBoost Classifier (`n_estimators=100`, `max_depth=5`, `learning_rate=0.1`, `tree_method=hist`)
- **Fit Time**: 0.18 seconds
- **Validation Tuned Threshold**: 0.65
- **Precision**: 99.78%
- **Recall**: 99.93%
- **F1-Score**: 99.85%
- **ROC-AUC**: 1.0000
- **PR-AUC**: 0.9999
- **Confusion Matrix**:
  - True Negatives: $89,460$
  - False Positives: $3$
  - False Negatives: $1$
  - True Positives: $1,365$

---

## 2. V2 Account-Behaviour Risk Model

The account-behaviour model evaluates continuous transactional patterns across the V2 banking ledger to detect money muling, funnel structuring, rapid pass-through layering, and shell round-tripping.

### Feature Engineering (`AccountFeatureBuilder`)
Both training and real-time inference use the unified `AccountFeatureBuilder` module:

```
Raw SQL Ledger & Profile
          │
          ▼
┌────────────────────────────────────────────────────────┐
│ AccountFeatureBuilder (backend/app/services/v2/feature_builder.py) │
│ • 4 Profile attributes (customer_type, kyc_tier, init_bal, curr_bal)│
│ • 18 Behavioral signals (velocity, dwell, spike, fan-in/out, etc.)  │
│ • Strict leakage exclusion: zero ground_truth, zero PII, zero tags │
└────────────────────────────────────────────────────────┘
          │
          ▼
   26 Numerical Features (Zero Missing/NaN)
```

| Feature Category | Features |
| :--- | :--- |
| **Customer Profile** | `customer_type_retail`, `customer_type_student`, `customer_type_sme`, `customer_type_corporate`, `kyc_tier_level`, `initial_balance`, `current_balance`, `balance_ratio`. |
| **Transaction Velocity** | `total_transactions`, `velocity_24h_count`, `velocity_7d_count`, `velocity_30d_count`. |
| **Flow & Drainage** | `flow_through_ratio`, `rapid_pass_through`, `median_dwell_minutes`, `has_dwell_time`. |
| **Amount Distribution** | `max_amount`, `avg_amount`, `amount_spike_ratio`. |
| **Counterparty Topology** | `unique_counterparties`, `counterparty_diversity_ratio`, `fan_in_ratio`, `fan_out_ratio`. |
| **Anomalous Activation** | `dormancy_gap_days`, `dormant_awakening_detected`, `cycle_detected`. |

### Leakage Protections & Target Definition
- **Target Mapping**:
  - `1 (Suspicious)`: Mule feeders, intermediate mules, aggregators, terminal cashouts, shell roundtrippers, and dormant mules ($32$ accounts).
  - `0 (Legitimate / Non-Perpetrator)`: Retail, merchant, and corporate customers ($9,966$ accounts), plus compromised victims ($2$ accounts).
- **Compromised Victim Handling**: Victims whose balances were drained by attackers are classified as $0$ (non-perpetrators). In banking forensics, labeling an innocent victim as a fraud perpetrator is a severe operational failure.
- **Group-Aware Scenario Separation**:
  - Simulated crime scenarios are grouped by `scenario_id`. Accounts participating in the same simulated network are **never split** across train and test.
  - **Train Scenarios**: `SCENARIO-STRUCT-002` (Structuring), `SCENARIO-DISPERSAL-003` (Dispersal), `SCENARIO-CYCLE-004` (Cycle) + 80% normal accounts ($8,000$ accounts total).
  - **Held-Out Test Scenarios**: `SCENARIO-APP-001` (APP Scam) and `SCENARIO-DORMANT-005` (Dormant Awakening) + 20% normal accounts ($2,000$ accounts total).

### Evaluation Results (Held-Out Unseen Scenarios: 2,000 accounts)
- **Model Type**: XGBoost Classifier (`max_depth=4`, `learning_rate=0.05`, `scale_pos_weight=5.0`)
- **Training Time**: 0.09 seconds
- **ROC-AUC**: **0.9945**
- **Normal Accounts False Positive Rate**: **0.10%** ($2$ false positives out of $1,994$ normal accounts).
- **Confusion Matrix on Held-Out Test Accounts**:
  - True Negatives: $1,992$
  - False Positives: $2$
  - False Negatives: $4$
  - True Positives: $2$

### Head-to-Head Comparison: ML Model vs. Phase 3 Rule Baseline
| Dimension | Phase 3 Rule Baseline | Phase 4 Tabular ML Model |
| :--- | :--- | :--- |
| **False Positives on Normal Accounts** | $149$ false positives ($7.5\%$ FPR) | **$2$ false positives ($0.1\%$ FPR)** |
| **Precision** | $3.25\%$ | **$50.00\%$** |
| **ROC-AUC** | N/A (Discrete Heuristic) | **$0.9945$** |
| **Operational Role** | Broad heuristic safety net capturing raw velocity/spikes. | High-precision behavioral ranking and calibrated probabilities. |

### Innocent Victim Protection Analysis
In `SCENARIO-APP-001`, victim account `ACC-000001` (Aditi Joshi) had ₹250,000 stolen by an attacker.
- The ML model output a probability of $0.7648$ ($76.5$ risk score) because of the sheer magnitude of the anomalous debit.
- The Rule Baseline scored it $25.0$ (Low risk) because it recognized the absence of rapid pass-through or dormant awakening.
- **Critical Policy Takeaway**: Statistical ML models alone cannot differentiate a victim suffering an unauthorized drain from an account deliberately sending funds. This demonstrates why FraudShield AI V2 mandates **human-in-the-loop review** and combines graph tracing with ML predictions.

---

## 3. Explainability & Native TreeSHAP

Rather than presenting global static averages or fabricating SHAP numbers, the V2 inference engine calculates **exact, local TreeSHAP attribution** natively via C++ XGBoost (`booster.predict(dmat, pred_contribs=True)`):

$$\sum_{i=1}^{M} \phi_i(x) + \phi_0 = \text{log-odds}(x)$$

### Sample TreeSHAP Local Contribution (`ACC-000001`)
```json
"top_contributions": [
  {
    "feature_name": "max_amount",
    "feature_value": 250000.0,
    "contribution_score": 3.9147,
    "impact_direction": "increases_risk"
  },
  {
    "feature_name": "initial_balance",
    "feature_value": 300000.0,
    "contribution_score": 1.1385,
    "impact_direction": "increases_risk"
  },
  {
    "feature_name": "avg_amount",
    "feature_value": 12480.89,
    "contribution_score": 0.9569,
    "impact_direction": "increases_risk"
  },
  {
    "feature_name": "current_balance",
    "feature_value": 177156.23,
    "contribution_score": -0.2986,
    "impact_direction": "decreases_risk"
  }
]
```

---

## 4. API Endpoints Reference

### 4.1 Model Health & Status (`GET /api/v2/models/status`)
Inspects saved model binaries and metadata, returning availability and evaluation metrics.

**Response Example (200 OK):**
```json
{
  "account_model": {
    "available": true,
    "version": "v2-account-1.0.0",
    "model_type": "XGBClassifier (Tabular Gradient Boosting)",
    "features_count": 26,
    "trained_at": "2026-10-20T14:56:12Z",
    "test_metrics": {
      "threshold": 0.5,
      "precision": 0.5,
      "recall": 0.3333,
      "f1_score": 0.4,
      "roc_auc": 0.9945,
      "pr_auc": 0.4642
    },
    "limitations": "Trained on synthetic banking network scenarios. Provides advisory decision-support only."
  },
  "paysim_benchmark": {
    "available": true,
    "version": "v2-benchmark-1.0.0",
    "model_type": "PaySim Transaction Benchmark (XGBoost)",
    "features_count": 14,
    "trained_at": "2026-10-20T14:54:45Z",
    "test_metrics": {
      "precision": 0.9978,
      "recall": 0.9993,
      "f1_score": 0.9985,
      "roc_auc": 1.0,
      "pr_auc": 0.9999
    },
    "limitations": "PaySim dataset benchmark only. Do not apply to V2 banking transactions without feature adapters."
  },
  "overall_status": "healthy",
  "inference_ready": true,
  "disclaimer": "Models serve strictly as decision support. Performance metrics reflect synthetic held-out evaluation."
}
```

### 4.2 Account ML Assessment (`GET /api/v2/accounts/{account_id}/ml-assessment`)
Generates real-time calibrated risk probabilities and TreeSHAP explanations.

**Response Example (200 OK):**
```json
{
  "account_id": "ACC-000001",
  "risk_score": 76.5,
  "risk_level": "high",
  "predicted_probability": 0.7648,
  "predicted_class": "suspicious",
  "model_version": "v2-account-1.0.0",
  "model_type": "XGBClassifier",
  "top_contributions": [
    {
      "feature_name": "max_amount",
      "feature_value": 250000.0,
      "contribution_score": 3.9147,
      "impact_direction": "increases_risk"
    }
  ],
  "observable_features": {
    "customer_type_retail": 1.0,
    "kyc_tier_level": 2.0,
    "initial_balance": 300000.0,
    "current_balance": 177156.23,
    "total_transactions": 56.0,
    "velocity_24h_count": 1.0,
    "amount_spike_ratio": 20.03
  },
  "disclaimer": "Decision support only. Model trained exclusively on synthetic financial network scenarios. High model risk scores do NOT constitute legal proof of guilt. Automated account freezing is strictly prohibited."
}
```

**Error Handling:**
- `404 Not Found`: If `account_id` does not exist in the V2 ledger.
- `503 Service Unavailable`: If model artifacts are missing or unreadable (`code: "model_unavailable"`).

---

## 5. Reproducible Training Commands

To retrain the models from scratch:

```bash
# 1. Train PaySim transaction-level benchmark
PYTHONPATH=. backend/.venv/bin/python ml/v2/paysim_benchmark.py

# 2. Train V2 Account-behaviour risk model
PYTHONPATH=backend:. backend/.venv/bin/python ml/v2/train_account_model.py

# 3. Run all unit and integration tests
backend/.venv/bin/pytest backend/tests/test_v2_ml_models.py
```

---

## 6. Regulatory & Ethical Disclaimers
1. **Synthetic Nature**: Training labels and topological scenarios originate from synthetic simulation. They do not constitute verified criminal records.
2. **Advisory Decision Support Only**: Model scores are prioritization signals for human compliance investigators.
3. **Strict Prohibition on Automated Punitive Actions**: Automated freezing of accounts, denying consumer access, or blocking payment cards based solely on ML outputs is strictly prohibited by design.
