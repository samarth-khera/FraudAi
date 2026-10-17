# Model Card — FraudShield AI transaction risk model (v1)

## Intended use
Decision support that scores a transaction's fraud risk to help prioritise HUMAN review. It must not freeze/unfreeze accounts automatically, and a high score is not evidence that an account owner is a scammer.

## Data
- PaySim synthetic mobile-money simulation (NOT real customers): 6,362,620 rows, 8,213 fraud (0.1291%).
- Dataset SHA-256: `16910f90577b0d981bf8ff289714510bb89bc71bff7d3f220f024e287e4eea6b`
- Chronological split on `step`: train steps ≤ 323 (4,463,587 rows, 3,643 fraud); validation ≤ 378 (980,416, 564); test > 378 (918,617, 4,006).

## Selected model
- **xgboost** — XGBoost (hist), scale_pos_weight=neg/pos on train, early stopping on validation PR-AUC.
- Feature set: `pre_transaction`. Inputs: step, type, amount, oldbalanceOrg, oldbalanceDest.
- Engineered features: type, amount, oldbalanceOrg, oldbalanceDest, hour_of_day, amount_to_old_balance_orig, orig_balance_zero, dest_balance_zero.
- Threshold 0.998286 chosen on VALIDATION data only (strategy `max_f1`).
- Imbalance handled with class weighting / scale_pos_weight (training data only).

## Excluded columns
- `isFraud`: Target label.
- `isFlaggedFraud`: Output of the simulator's own rule-based flagging; it is derived from the fraud process and would leak the label.
- `nameOrig`: Raw account ID: high-cardinality identifier, memorises accounts rather than generalising; excluded from the initial tabular model.
- `nameDest`: Raw account ID: same reason as nameOrig.

## Leakage and availability
All inputs are plausibly available before the transaction settles (to be confirmed against the production payment flow).
Balance-change features must be confirmed available at prediction time before use. `newbalanceOrig`/`newbalanceDest` are written after the transaction executes; the `xgboost_with_post_balance` row below exists only to quantify how much they would inflate results.

## Held-out TEST results (thresholds frozen from validation)
| model | feature set | threshold | precision | recall | F1 | PR-AUC | ROC-AUC | TP / FP / FN / TN | FPR |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| dummy_prior | pre_transaction | 0.5000 | 0.0000 | 0.0000 | 0.0000 | 0.0044 | 0.5000 | 0 / 0 / 4,006 / 914,611 | 0.000000 |
| logistic_regression | pre_transaction | 0.9993 | 0.9138 | 0.2486 | 0.3909 | 0.4883 | 0.9853 | 996 / 94 / 3,010 / 914,517 | 0.000103 |
| xgboost | pre_transaction | 0.9983 | 0.9859 | 0.8357 | 0.9046 | 0.9828 | 0.9999 | 3,348 / 48 / 658 / 914,563 | 0.000052 |
| xgboost_with_post_balance | with_post_balance | 0.9992 | 0.9995 | 0.9933 | 0.9964 | 0.9997 | 1.0000 | 3,979 / 2 / 27 / 914,609 | 0.000002 |

Selected model at its threshold on test: precision 0.9859, recall 0.8357, false-positive rate 0.000052, test fraud prevalence 0.436090%.

## Trade-off
Lowering the threshold catches more fraud (higher recall) but flags more legitimate transactions (more false positives, lower precision), each of which costs analyst time and can inconvenience an innocent customer. Raising it does the reverse. Because fraud is extremely rare, even a tiny false-positive rate produces many false alerts in absolute numbers.

## Limitations
- PaySim is simulated; fraud patterns (e.g. only TRANSFER and CASH_OUT) reflect the simulator and results may not transfer to real banking data.
- Single time-ordered split; no cross-validation, calibration or drift analysis yet.
- No account-history/graph features yet; raw account IDs are deliberately not used.
- Not validated for fairness or production deployment.
