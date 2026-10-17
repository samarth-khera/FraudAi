# PaySim EDA & Validation Report

_All numbers below were computed from the actual CSV by `ml/eda.py`._

- File: `PS_20174392719_1491204439457_log.csv` (493,534,783 bytes)
- SHA-256: `16910f90577b0d981bf8ff289714510bb89bc71bff7d3f220f024e287e4eea6b`
- Rows: **6,362,620**; columns: step, type, amount, nameOrig, oldbalanceOrg, newbalanceOrig, nameDest, oldbalanceDest, newbalanceDest, isFraud, isFlaggedFraud
- Duplicate rows: **0** (64-bit row hash (collisions negligible but theoretically possible))
- Missing values: 0 total (none)

## Target (`isFraud`)
- Legitimate (0): 6,354,407
- Fraud (1): 8,213
- Fraud prevalence: **0.129082%**
- Imbalance: 773.7 legitimate per fraud

## Transaction types
| type | rows | fraud | fraud rate |
|---|---:|---:|---:|
| CASH_IN | 1,399,284 | 0 | 0.0000% |
| CASH_OUT | 2,237,500 | 4,116 | 0.1840% |
| DEBIT | 41,432 | 0 | 0.0000% |
| PAYMENT | 2,151,495 | 0 | 0.0000% |
| TRANSFER | 532,909 | 4,097 | 0.7688% |

## `isFlaggedFraud` (excluded from features)
- Rows flagged: 16; flagged AND fraud: 16; fraud rows NOT flagged: 8,197

## Time (`step`, 1 step = 1 hour)
- Range 1–743, 743 distinct steps, sorted ascending in file: True

## Amount
- min 0.00, max 92,445,516.64, negative rows 0, zero rows 16
- mean amount: legitimate 178,197.04, fraud 1,467,967.30

## Balance patterns relevant to leakage assessment
- Rows with destination old & new balance both 0 and amount > 0: legit 2,313,206, fraud 4,070
- Rows with newbalanceOrig == 0: legit 3,601,513, fraud 8,053

## Validation outcome
- Errors: none
- Warnings: none
