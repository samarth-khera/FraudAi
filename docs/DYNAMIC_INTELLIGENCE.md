# Dynamic fraud intelligence

`POST /api/v2/dynamic-investigations` in the API, **Investigate** in the app. An investigator enters an account ID and
picks a synthetic dataset. The system reads that account's history, scores each transfer, traces the money, assesses
every connected account's possible role, and returns an evidence-linked report with an advisory restriction state.

Every result here comes from synthetic data. Nothing measures real-world fraud-detection accuracy, and nothing here is a
fairness claim. No finding establishes that anyone knowingly committed fraud. Nothing ever freezes, blocks or changes an
account. All numbers below are copied from the reports in `ml/reports/` named next to them.

Contents:
1. Gap report: what existed before.
2. Architecture.
3. Datasets and the ground-truth "materialised" rule.
4. The forensic scenario generator.
5. Leakage prevention and why account IDs cannot be memorised.
6. Model A: transaction risk (served: `v3-transaction-1.0.0`).
7. Models B and C: account behaviour. Champion `v3-account-1.0.0` (served) and challenger `v3-account-1.1.0` (not served).
8. External and source-specific checks: demo ledger, PaySim, AMLSim.
9. Role engine, thresholds and restriction recommendations.
10. Fund tracing, branch endings and tracing verification.
11. End-to-end evaluation of the engine, the ledger-wide safety scan and scenario 4.
12. API, UI and the AI analyst.
13. Limitations and remaining failure modes.
14. Reproducing everything.

---

## 1. Gap report: what existed before

| Area | Before this work | Gap |
|---|---|---|
| Investigation | `POST /investigations`: rule flags on the account's own history, a bounded BFS trace, per-account rules and the v2 account model, LIBR exposure, role labels | No transaction model. The trace was seeded by rules only. Roles were 6 coarse labels with no victim or innocent-counterparty distinction, no "other affected accounts" and no restriction reasoning |
| Transaction model | PaySim benchmark only (`ml/v2/paysim_benchmark.py`), never used in investigations | Validation and test subsampled to about 1.5% prevalence (real 0.13%). `step` used as a feature. Near-perfect scores that come from the simulator's fraud mechanic |
| Account model | `v2-account-2.0.0` trained on the scenario bank (demo-generator family) | Features use the full history and the current balance (not point-in-time). No cold-account test with disjoint IDs. Counterparty and graph context listed as the main open issue |
| Data | One V2 ledger schema, demo generator with five single scenarios and documented label defects | No normalized multi-source schema, no role ground truth, no AMLSim |
| Datasets in the API | One configured ledger | No dataset selection |

## 2. Architecture

```
backend/app/intelligence/
  schema.py     normalized transaction schema + validation
  ledger.py     indexed per-account reads from V2-schema ledgers (no full scans)
  features.py   point-in-time transaction features (A), account features (B), graph features (C)
  models.py     loads JSON model artifacts, calibration, thresholds, out-of-range checks
  explain.py    TreeSHAP / coefficient contributions in plain language
  roles.py      role rules and restriction recommendations (pure functions)
  datasets.py   dataset registry (demo-ledger, forensic-scenarios)
  engine.py     the orchestrator
backend/app/api/v2/dynamic_routes.py, dynamic_schemas.py   API + response schema
ml/forensics/   generator, adapters, training, evaluation, benchmarks, verification (offline only)
```

**One pipeline at three stages.** The same `features.py` code is imported by training and by serving. Serving never
trains. Models are XGBoost native JSON files with their metadata (features, calibration map, threshold, training ranges,
metrics, seeds, library versions). There are no pickles.

**Model artifacts** (`ml/artifacts/v3/`):

| Directory | Model | Served | `model.json` |
|---|---|---|---|
| `transaction_model/` | `v3-transaction-1.0.0` | Yes | 0.96 MB |
| `account_model/` | `v3-account-1.0.0` (champion) | Yes | 0.50 MB |
| `account_model_challenger/` | `v3-account-1.1.0` (challenger) | No | 1.30 MB |

The serving code loads only `transaction_model/` and `account_model/`. The challenger is read only by
`ml/forensics/compare_account_models.py` and the tests.

**How the orchestrator runs.** The investigation runs these steps in order:

1. **Look up the account** in the chosen dataset. An unknown ID returns `404 account_not_found`; nothing is invented.
2. **Load history:** the account's own history and its counterparties' histories, through the `(account, timestamp)`
   indexes.
3. **Score every transfer** of the account with Model A, using only records before each transfer.
4. **Run the existing bounded trace** (`InvestigationService.compute_with_trace`), seeded by transfers flagged by the
   rules or, on validated datasets, by the model. The v2 account model (`v2-account-2.0.0`) runs inside this step only on
   `demo-ledger`, the ledger it was validated on; on `forensic-scenarios` its scores are not computed.
5. **Score every traced transfer.** Score the analysed accounts with Model B (it abstains below 5 transfers) and compute
   their graph facts.
6. **Look for other affected senders:** other accounts whose own model-flagged transfer reached an intermediary or
   suspicious-account candidate, or an account the investigated account paid in a flagged transfer (§9).
7. **Assess roles and restriction states, and build the branches.** The trace report's own `consider_escalation` and
   `further_review` recommendations are removed for every account the role engine assessed, so the two never disagree.

Each step's real duration is returned in `processing_steps`.

**When models count as evidence.** On a dataset the models were not validated on (`demo-ledger`), their outputs are shown
with `evidence_use: "reference_only"` and are never used as evidence, trace seeds or role support (§8).

## 3. Datasets and the ground-truth "materialised" rule

See [DATASETS.md](DATASETS.md) for the full record: source, licence, checksum, schema, label meaning and
transformations.

- **Forensic scenario ledgers (this repository):** `train` (seed 101), `cold` (seed 202) and `demo` (seed 303, served as
  `forensic-scenarios`).
- **FraudShield demo ledger** (`demo-ledger`): a different generator, used as an external check.
- **PaySim** (CC BY-SA 4.0) and the **IBM AMLSim published samples** (Apache-2.0): source-specific checks.
- **IBM AMLworld:** not used; it needs a Kaggle login.

**Ground truth is evaluation-only.** The role table is written to `data/v3_forensic/<ledger>/roles.csv`. Only evaluators
in `ml/forensics/` read it; `backend/app` inference code never does, and a source-level test enforces this.

**The corrected "materialised" rule.** The generator plans roles before it knows whether every leg can be funded, so some
planned roles never happen. A role counts as materialised only when the transfers that define it exist for that same
scenario:

| Role | Materialised when |
|---|---|
| `intermediary` | it both received AND sent money of its scenario |
| `victim` | it sent money of its scenario |
| `secondary_victim` | its own drain transfer exists (and it sent scenario money) |
| `attacker_controlled`, `innocent_counterparty` | it received money of its scenario |
| other roles | any transfer of its scenario |

The previous rule counted a role as materialised whenever the account appeared in any scenario transfer. Transactions
did not change; only `roles.csv` did. Materialised roles fell from **1,329 to 1,305** (train), **1,000 to 978** (cold) and
**263 to 257** (demo). Per-role counts are in `ml/reports/data_quality_v3.json` (`forensic_ledgers.*.roles`).

## 4. The forensic scenario generator

`ml/forensics/generator.py` (`forensic-scenarios-1.0.0`) has its own baseline economy:
- **People and income:** salaried people and students.
- **Payments:** rent (15% of renters pay within minutes of their salary), bills, card and UPI purchases, P2P to fixed
  contacts, cash withdrawals and occasional large purchases.
- **Businesses:** merchants with weekly settlement sweeps, employers with payroll fan-out and B2B payments.
- **New accounts:** 8% of ordinary accounts open during the ledger.

Planted patterns:

| # | Pattern | Roles it creates |
|---|---|---|
| 1 | Direct victim → collection account (single or burst) | victim, attacker_controlled |
| 2 | Victim → intermediary → collector | + intermediary |
| 3 | Victim → 2–3 intermediaries in sequence → collector | + intermediary per hop |
| 4 | Victim → intermediary → 2–5 branch intermediaries → cash-out | split |
| 5 | Split then consolidation into one collector (1–3 victims) | consolidation |
| 6 | Loop of 3–4 intermediaries back to the first, then exit | circular |
| 7 | 2–5 victims pay one intermediary → collector | several victims |
| 8 | Scam money reaches a merchant or landlord (add-on) | innocent_counterparty |
| 9 | Scam money pays an ordinary person who keeps it (add-on) | innocent_counterparty |
| 10 | Relatives pool money; the hub pays a large bill within hours (legitimate) | lookalike_legitimate |
| 11 | Account takeover: burst to new recipients, at night 30% of the time | victim (account_takeover), intermediary |
| 12 | Ordinary economy | ordinary, merchant, employer |

In chain patterns, 30% of existing-person intermediaries have their own savings drained to the collector as well
(`secondary_victim`).

**Held-out variants.** These appear only in the cold and demo ledgers:
- `multi_hop:slow`: each hop waits 6–40 hours.
- `split:structured`: many transfers under 10,000.
- `takeover:after_dormancy`: 45 or more quiet days before the takeover.

**Safeguards against generator shortcuts.** Each was checked; the checks are in `ml/reports/data_quality_v3.json`:
- **No balance overwrites:** amounts are shares of what an account actually holds or received; unfundable legs are
  skipped and counted (386 train, 333 cold, 70 demo).
- **Random account IDs per seed:** each seed draws `FS-` plus 8 hex digits, so ledgers share no IDs.
- **Account-level safeguards:** each account plays at most one scenario role, and self-transfers are rejected.

**Timing and amount shortcuts (measured, not removed).** Night is 00:00–04:59.

| Measure | Train | Cold | Demo |
|---|---|---|---|
| Round-amount share, scenario vs ordinary transfers | 30.8% vs 14.3% | 30.4% vs 14.4% | 34.8% vs 14.3% |
| Night share, all scenario transfers (takeovers included) vs ordinary | 6.6% vs 2.8% | 3.5% vs 2.8% | 3.9% vs 2.8% |
| Night share, scenario transfers excluding takeovers | 1.5% | 0.7% | 0.3% |
| Night share, takeover transfers only | 49.7% | 21.2% | 35.3% |

Scenario transfers are about twice as often round amounts as ordinary ones, so this shortcut runs towards "round means
scenario". No feature encodes roundness (amount enters only as its logarithm and as ratios), but a model could still pick
it up indirectly. The night gap comes from the takeover pattern, which is night-heavy by design.

## 5. Leakage prevention: why account IDs cannot be memorised

- **Explicit deny-list:** `features.FORBIDDEN_INPUTS` covers IDs, names, labels, scenario fields, post-transaction
  balances and `isFlaggedFraud`. Tests assert it is disjoint from every feature list and from the features stored in
  each artifact.
- **Point in time:** a transfer at time *t* uses only the sender's and receiver's records with a timestamp strictly
  before *t*. Ties are excluded, including the transfer itself. Running sums restart for every account, so one account's
  features cannot depend, even numerically, on another account's records.
- **Tests that prove it:**

| Test | What it proves |
|---|---|
| `test_features_do_not_change_when_account_ids_are_relabelled` | Every ID is replaced by a different string: features and model scores are identical |
| `test_adding_or_changing_future_transactions_does_not_change_earlier_predictions` | Future rows are appended with amounts ×7: earlier features are unchanged |
| `test_party_history_extract_gives_the_same_features_as_the_whole_ledger` | The serving extract equals the full-ledger computation |
| `test_report_is_deterministic_and_ignores_ground_truth` | Scrambling every ground-truth column leaves the investigation digest unchanged |
| `test_inference_code_never_reads_ground_truth` | Source-level check of every inference module |

- **Automated leakage audit:** the training report lists each feature's single-feature ROC-AUC and alerts at 0.98 or
  more. The highest is 0.885 (`amount_to_sender_balance`); none alerted (`transaction_model_v3.json`, `leakage_audit`).
- **Generalisation, not memorisation:** the cold ledger shares **0 account IDs** with the training ledger, and every
  "cold ledger" metric below uses accounts never seen in training.

## 6. Model A: transaction risk at decision time

Served artifact: `ml/artifacts/v3/transaction_model/` (`v3-transaction-1.0.0`). Report: `ml/reports/transaction_model_v3.json`.
The model file is byte-identical to the one first trained; the latest run changed only metadata (the temporal-test
confidence interval now resamples whole scenario instances, and `s_history_days` / `r_history_days` are excluded from the
out-of-range check because they grow with calendar position).

**Features (38):**
- **Amount and balance:** log amount; amount relative to the sender's pre-transfer balance.
- **Sender history:** prior outgoing and incoming counts, record span, outflow counts in the last 1 h and 24 h, outflow
  amount in the last 24 h, ratio to the largest earlier outflow, z-score against earlier outflows, new recipients in the
  last 24 h, distinct recipients, hours since the last outflow, and the share of this amount received in the last 24 h.
- **Relationship:** minutes since the last receipt, prior transfers between the pair, and a first-time-pair flag.
- **Receiver history:** prior incoming and outgoing counts, record span, distinct senders, inflows in the last 24 h, and
  pre-transfer balance.
- **Time and type:** hour of day (sin and cos), weekend, transaction type and channel one-hots.

**Splits:**
- **Training ledger:** days 0–83 train (307,255 transfers, 1,108 positives, 165 scenario instances), days 84–101
  validation (82,339; 297; 47), days 102–119 temporal test (60,830; 273; 43).
- **Cold ledger:** 299,828 transfers with 1,330 positives in 194 scenario instances, including held-out variants.

**Selection, on validation PR-AUC only.** Each family's best validation result:

| Family | Train PR-AUC | Validation PR-AUC |
|---|---|---|
| Logistic regression (C = 0.01, balanced) | 0.432 | 0.551 |
| Random forest (unbounded depth, leaf 10) | 0.996 | 0.887 |
| **XGBoost (depth 5, min child 1, λ 1, early stop at 301 trees)** | 0.9996 | **0.941** |

Imbalance strategies for the selected configuration (validation PR-AUC):

| Strategy | Validation PR-AUC |
|---|---|
| No reweighting | 0.925 |
| `scale_pos_weight` = √(neg/pos) | **0.941** |
| `scale_pos_weight` = neg/pos | 0.933 |
| 20:1 undersampling (training split only) | 0.924 |

SMOTE was not used: most features are counts, flags and one-hots, so interpolated rows would not be valid transfers.
Validation and test keep their real prevalence (0.36–0.45%).

**Calibration and threshold:**
- **Calibration:** sigmoid, which beat isotonic in two-fold cross-fitting over the validation period (Brier 0.000882 vs
  0.001008; uncalibrated 0.001005).
- **Threshold:** the lowest validation threshold with precision of at least 50%, which is 0.13% calibrated
  (0.001301623065955937, displayed as 0.001302). Scenario transfers are rare, so the calibrated threshold is low.
- **Exact thresholds.** The training scripts used to store thresholds rounded to 6 decimals; this one was rounded up, so
  the one validation positive scored exactly at the selected value fell below the served threshold (served validation
  TP 285 / FN 12 instead of 286 / 11). The scripts now store the exact float (`evaluation.threshold_record`), and the
  existing metadata was corrected by re-applying the documented selection to the frozen models' validation scores,
  without retraining (`model.json` unchanged). The account champion (0.052098002284765244) and challenger
  (0.05747126415371895) were corrected the same way. No cold, temporal-test or served-ledger row lies between the old
  and exact values, so only the validation count moved. A test checks that each stored threshold equals the recomputed
  selection exactly.

**Results (test sets scored once):**

| Split | Transfers | Positives | Precision | Recall | PR-AUC (95% CI) | ROC-AUC | Brier | FP | FN |
|---|---|---|---|---|---|---|---|---|---|
| Train | 307,255 | 1,108 | 0.689 | 1.000 | 0.9996 | 1.000 | 0.00008 | 501 | 0 |
| Validation | 82,339 | 297 | 0.526 | 0.963 | 0.941 | 0.9993 | 0.00067 | 258 | 11 |
| Temporal test | 60,830 | 273 | 0.824 | 0.978 | 0.987 (0.978–0.994) | 0.9999 | 0.00050 | 57 | 6 |
| Temporal test, senders unseen in training period | 1,337 | 76 | 0.882 | 0.987 | 0.996 | 0.9997 | 0.0029 | 10 | 1 |
| **Cold ledger (disjoint accounts)** | 299,828 | 1,330 | **0.689** | **0.939** | **0.946 (0.931–0.959)** | 0.9994 | 0.00087 | 563 | 81 |
| Cold ledger, seen variants only | 299,509 | 1,027 | 0.636 | 0.954 | 0.953 | 0.9995 | 0.00056 | 561 | 47 |
| Served forensic ledger (seed 303) | 88,623 | 333 | 0.680 | 0.898 | 0.909 | 0.9987 | 0.00096 | 141 | 34 |

Confidence intervals are 95% bootstrap intervals that resample whole scenario instances. The cold-ledger confusion matrix
is TN 297,935, FP 563, FN 81, TP 1,249; the false-positive rate is 0.19%.

**Further cold-ledger detail:**
- **Recall at fixed precision:** 0.967 at 50% precision, 0.920 at 80% and 0.864 at 90%.
- **Held-out variant recall:** slow multi-hop 92.9%, structured split 88.3%, takeover after dormancy 87.1%.
- **Recall by pattern:** 0.91–0.98.

**Failure analysis (cold ledger):**
- **False positives:** P2P transfers (217), ordinary cash withdrawals (198), student allowances (67), family pooling
  (37) and rent (23).
- **False negatives:** forwarding (23), cash-out (20), victim transfers (18), takeover transfers (17), secondary-victim
  drains (3).

**Segments (cold ledger, at the threshold):**

| Slice | Group | Precision | Recall | False-positive rate |
|---|---|---|---|---|
| Sender history | No prior outflows | 0.87 | 0.87 | |
| Sender history | 1–4 prior outflows | 0.93 | 0.98 | |
| Sender history | 5 or more prior outflows | 0.62 | 0.93 | |
| Customer type (slice only, not a feature) | Students | | | 0.32% |
| Customer type (slice only, not a feature) | Retail | | | 0.19% |

Students have the higher false-positive rate. No corporate positives exist, so nothing can be said about corporate
accounts.

**Fit diagnosis:**
- **Overfitting:** train PR-AUC (about 1.0) exceeds validation (0.941) by 0.058; temporal test (0.987) is above
  validation. Validation and cold test are within 0.005, so the gap does not grow on unseen accounts.
- **Underfitting:** the learning curve rises (validation 0.846 at 10% of the data, 0.893 at 25%, 0.932 at 50%, 0.941 at
  100%) with train about 1.0 throughout. The model has more capacity than data; it is not underfitting, and more data
  would still help.
- **Ablations (validation PR-AUC):** without the balance ratio 0.925, without channel 0.938, without time of day 0.944.

**Top features by XGBoost total gain (share of model importance):**

| Feature | Share |
|---|---|
| Share of the amount received in the previous 24 h | 0.27 |
| Minutes since the last receipt | 0.11 |
| Amount | 0.10 |
| Amount relative to balance | 0.09 |
| Receiver's prior outflows | 0.08 |

TreeSHAP is used only for the per-transfer explanations shown in a report (`explain.py`), not for this table.

**Out-of-range inputs.** Each score carries `outside_training_range: true` when 3 or more features fall outside the
training split's 0.5th–99.5th percentiles. It is a caution shown with the score; it does not change whether a flag counts
as evidence.

**Why these numbers are high.** The generator plants flows with consistent behaviour, such as receiving money and paying
it on. These are recognisable mechanisms, but they are this generator's mechanisms. §8 shows the same model failing on a
ledger built by a different generator.

**Artifact:** 0.97 MB with metadata, scoring about 3.5 ms per 1,000 rows. Reloading it reproduces the training scores
exactly.

## 7. Models B and C: account behaviour

**Target:** the account played `intermediary` or `attacker_controlled`. Victims, innocent counterparties, look-alikes,
merchants and ordinary accounts are negatives. Secondary victims are excluded from fitting and metrics and reported
separately. Accounts with fewer than 5 transfers abstain.

Two models exist. The owner's decision is that the **champion `v3-account-1.0.0` stays served**; the challenger
`v3-account-1.1.0` is evaluated but **not served**, and its promotion awaits the owner's decision.

| | Champion `v3-account-1.0.0` (served) | Challenger `v3-account-1.1.0` (not served) |
|---|---|---|
| Location | `ml/artifacts/v3/account_model/` | `ml/artifacts/v3/account_model_challenger/` |
| Own training report | `ml/reports/account_model_v3.json` | `ml/reports/account_model_v3_challenger.json` |
| Labels at training | Planned roles (before the materialised correction, §3) | Corrected materialised rule, evaluated at each as-of date |
| Training rows | One snapshot per account at the ledger end (day 120): 7,525 train / 2,534 validation | Snapshots at days 30, 60, 90 and 120: 28,613 train rows (7,540 accounts) / 9,656 validation rows |
| Features | 21 behaviour features, no account age, no graph | 31: behaviour, account age (`active_days_log`, `history_days`) and 8 graph features |
| Model | XGBoost, depth 4, min child 5, λ 10, α 0.5, `scale_pos_weight` 3.54, 282 trees | XGBoost, depth 4, min child 1, λ 10, α 0.5, `scale_pos_weight` 5.2, 624 trees |
| Calibration | Sigmoid | Isotonic |
| Threshold (calibrated) | 0.052098: lowest validation threshold with precision ≥ 50% | 0.057471: same rule, on pooled-snapshot validation |

The side-by-side comparison on today's labels is in `ml/reports/account_model_champion_challenger.json`
(`ml/forensics/compare_account_models.py`). Both frozen models are scored on identical rows, each at its own stored
threshold; nothing in that comparison was fitted or selected on the cold or demo ledgers.

### 7.1 Champion `v3-account-1.0.0` (served), as trained

These figures come from its own report, `account_model_v3.json`, and use the **old planned-role labels**: a planned
suspicious role counted as positive even when none of its scenario transfers happened. The comparison report reproduces
them exactly with those labels (`provenance_check_champion`). §7.3 re-scores the same model on the corrected labels.

**Splits:**
- **Training ledger:** accounts split 75/25 by scenario instance (0 instances in both sets). Train has 7,525 accounts
  (556 positives); validation has 2,534 (231).
- **Cold ledger:** 6,702 scored accounts (594 positives); 97 abstained, 81 of them positives. It shares 0 IDs with the
  training ledger.

**Feature-set comparison (validation PR-AUC):**

| Feature set | Validation PR-AUC |
|---|---|
| Behaviour without account age | **0.818** |
| Behaviour with account age | 0.821 |
| Behaviour + graph (8 network features) | 0.823 |

The rule is the simplest set unless a richer one gains at least 0.01. Neither did (+0.003 for graph features), so graph
features were not used. Account-age features were excluded because they can flag a newly opened account before it does
anything.

**Fit:** other candidates reached validation PR-AUC 0.69 (logistic regression) and 0.81 (random forest, no text export).
Train PR-AUC 0.943 vs validation 0.818; validation and cold test agree within 0.009.

| Split | Accounts | Positives | Precision | Recall | PR-AUC (95% CI) | ROC-AUC | Brier | ECE |
|---|---|---|---|---|---|---|---|---|
| Train | 7,525 | 556 | 0.497 | 0.973 | 0.943 | 0.992 | 0.014 | 0.017 |
| Validation | 2,534 | 231 | 0.501 | 0.818 | 0.818 | 0.933 | 0.032 | 0.010 |
| **Cold ledger** | 6,702 | 594 | **0.467** | **0.822** | **0.809 (0.770–0.843)** | 0.928 | 0.032 | 0.011 |
| Served forensic ledger | 2,644 | 160 | 0.337 | 0.713 | 0.692 | 0.914 | 0.031 | 0.019 |

Cold-ledger flag rates by true role (old labels): collectors 86%, intermediaries 81%, look-alikes (legitimate pooling)
60%, victims 10%, ordinary 9.5%, innocent counterparties 9.1%, merchants and employers 0%; secondary victims (excluded
from metrics) 82%. Held-out variant recall: slow multi-hop 82%, structured split 58%, takeover after dormancy 88%.

**Top features (share of model importance, XGBoost total gain):** pass-through within 24 h (0.30), outflow count (0.10),
pass-through within 1 h (0.08), top-sender share (0.06) and cash-out share (0.06).

### 7.2 Challenger `v3-account-1.1.0` (not served)

`ml/forensics/train_account_model.py` builds one row per account per as-of date (days 30, 60, 90 and 120; the demo
ledger ends on day 90), using only records up to that date, and labels each row with the materialised rule at that date.
Rows whose suspicious role was in progress (some but not all defining transfers had happened) and secondary victims are
excluded. All snapshots of an account and of its scenario instance stay in one split.

- **Feature-set selection (pooled validation PR-AUC):** behaviour without account age 0.818, behaviour with account age
  0.820, behaviour + graph 0.847. Graph features gained 0.027, above the 0.01 rule, so the challenger uses them.
- **Temporal (out-of-time) test** (a separate fit on instances that ended before day 84, scored as of day 120 on 85
  instances that started after it): PR-AUC 0.882 (0.844–0.915).
- **Held-out variant recall, cold ledger end:** slow multi-hop 75%, structured split 86%, takeover after dormancy 97%.
- **Top features:** pass-through within 24 h (0.34), pass-through within 1 h (0.10), `sender_forwarders_share` (0.06),
  `share_in_from_drains` (0.06).

### 7.3 Champion vs challenger on the corrected labels

From `account_model_champion_challenger.json`. Each model at its own stored threshold. CIs resample whole scenario
instances.

**At the ledger end** (one row per account):

| Ledger | Rows / positives | Model | PR-AUC (95% CI) | Precision | Recall | FPR | Brier | ECE |
|---|---|---|---|---|---|---|---|---|
| Validation (train ledger), day 120 | 2,534 / 202 | Champion | 0.851 (0.797–0.899) | 0.472 | 0.881 | 8.5% | 0.027 | 0.013 |
| | | Challenger | 0.875 (0.836–0.915) | 0.409 | 0.926 | 11.6% | 0.022 | 0.004 |
| Cold, day 120 | 6,703 / 515 | Champion | 0.861 (0.832–0.887) | 0.446 | 0.907 | 9.4% | 0.025 | 0.018 |
| | | Challenger | 0.870 (0.839–0.893) | 0.396 | 0.915 | 11.6% | 0.021 | 0.005 |
| Served demo, day 90 | 2,646 / 142 | Champion | 0.734 (0.667–0.793) | 0.325 | 0.775 | 9.2% | 0.026 | 0.020 |
| | | Challenger | 0.809 (0.748–0.853) | 0.440 | 0.873 | 6.3% | 0.020 | 0.011 |

**All snapshots pooled** (days 30/60/90/120; the shorter histories investigations also see):

| Ledger | Rows / positives | Champion PR-AUC / precision / recall / FPR | Challenger PR-AUC / precision / recall / FPR |
|---|---|---|---|
| Validation | 9,656 / 446 | 0.739 / 0.205 / 0.888 / 16.7% | 0.841 / 0.391 / 0.913 / 6.9% |
| Cold | 25,380 / 996 | 0.756 / 0.180 / 0.916 / 17.1% | 0.852 / 0.366 / 0.918 / 6.5% |
| Served demo | 7,599 / 221 | 0.615 / 0.116 / 0.805 / 18.4% | 0.779 / 0.375 / 0.864 / 4.3% |

**False-positive rate by history length** (all snapshots pooled):

| Days of records | Validation: champion / challenger | Cold: champion / challenger | Demo: champion / challenger |
|---|---|---|---|
| < 30 | 31.9% / 1.2% | 32.7% / 1.2% | 31.6% / 1.4% |
| 30–60 | 16.7% / 6.3% | 16.8% / 5.0% | 15.1% / 5.2% |
| 60–90 | 9.8% / 8.5% | 9.8% / 8.1% | 8.3% / 6.4% |
| ≥ 90 | 7.8% / 11.9% | 8.4% / 12.0% | (ledger is 90 days) |

**Flag rates by true role, cold ledger end:**

| True role | Rows | Champion | Challenger |
|---|---|---|---|
| Intermediary | 387 | 90.4% | 91.5% |
| Collector (attacker_controlled) | 128 | 91.4% | 91.4% |
| Victim | 246 | 10.2% | 14.6% |
| Innocent counterparty | 116 | 9.5% | 14.7% |
| Look-alike (legitimate pooling) | 40 | 60.0% | 67.5% |
| Merchant or employer | 447 | 0% | 0% |
| Ordinary | 5,207 | 9.5% | 12.0% |
| Planned scenario role that never materialised | 132 | 20.5% | 10.6% |

**Before an account acts** (`account_model_v3_challenger.json`, `as_of_before_scenario`): 288 cold-ledger accounts that
later acted as intermediaries or attacker-controlled collectors were scored as of a date at least one day before their
scenario began (median day 77), next to 600 ordinary cold accounts scored at the same dates. The champion flagged 24.0%
of them against 21.6% of the ordinary accounts; the challenger 7.6% against 6.9%. Neither flags future suspicious accounts
much more than ordinary ones at the same date, but the champion flags about a fifth of both, because short histories
look unusual to it (37–58% of ordinary accounts flagged when scored at days 14–42).

**Why the challenger flags more long-history accounts** (`conclusion.a_long_history_false_positives`):
- **Main cause: an isotonic plateau at the threshold.** The stored threshold 0.057471 equals one isotonic step that
  covers raw scores 0.035–0.100. On the cold ledger end, 416 of the challenger's 1,189 flags lie on that step, including
  397 of its 718 false positives, at 4.6% precision. Threshold selection stopped inside that tied block, so the realised
  pooled-validation precision at the stored threshold is 39.1%: the challenger does not meet its own "precision ≥ 50%"
  rule.
- **Residual slope.** Even at a tie-aware threshold (0.068966, chosen on validation; analysis only) the challenger's cold
  FPR still rises with history: 0.6% (< 30 days), 2.1%, 4.0%, 5.3% (≥ 90 days). Removing the graph or account-age
  contribution would not lower the overall FPR (0.142 and 0.125 against 0.116 as scored).
- **Not the cause:** the pooled threshold being dominated by short histories (validation rows are spread evenly across
  history bands) and the label correction (ordinary accounts are negatives under both label sets).
- The problem is visible on validation already (ledger-end FPR 8.5% champion vs 11.6% challenger); the promotion rule
  did not look at long-history FPR.

**Why the challenger's train–validation gap is larger** (`conclusion.b_train_validation_gap`):
- **The reported gaps are not like for like.** Champion 0.125 (ledger-end rows, old labels, 7.4% prevalence); challenger
  0.159 (pooled snapshots, current labels, 3.6% prevalence). On identical rows and current labels: ledger end 0.116
  (champion) vs 0.124 (challenger); pooled 0.101 vs 0.159.
- **What the gap is:** in-sample saturation of 624 trees, not leakage. The challenger's train PR-AUC is about 1.0 at every
  snapshot; group 5-fold out-of-fold PR-AUC inside train is 0.869, close to validation 0.847 (raw scores). The champion's
  configuration refitted on current labels shows the same pattern (in-sample minus out-of-fold 0.126).
- **Not the cause:** near-duplicate snapshots (0 of 21,073 consecutive snapshot pairs are identical) or `min_child_weight`
  1 (setting it to 5 changes in-sample / out-of-fold PR-AUC from 0.9998 / 0.869 to 0.9996 / 0.869).
- Isotonic ties cost pooled validation PR-AUC 0.847 (raw) → 0.841. The learning curve is still rising (0.796, 0.827,
  0.832, 0.847 at 25/50/75/100% of training groups), so more scenarios should help more than regularisation.

### 7.4 Promotion: status, rule and how to do it

- **Status:** not promoted. The script's promotion rule (validation only: ledger-end validation PR-AUC not lower than the
  champion's by more than 0.01, AND validation FPR on accounts with < 60 days of records lower) passes: 0.8752 vs 0.8511,
  and 3.75% vs 24.21%. The comparison report recommends against promoting the artifact as it is, for the reasons in
  §7.3. The decision stays with the owner.
- **Conditions the comparison report sets for a replacement:** a threshold rule that keeps tied scores together (or
  selection on raw scores), chosen on validation only; a promotion rule that also requires validation FPR on ≥ 90-day
  histories and victim and innocent-counterparty flag rates no worse than the champion's; and, because the analysis
  thresholds have now been reported on cold and demo, confirmation on a fresh ledger (new seed) scored once.
- **Stale fields in the challenger's own files.** `account_model_v3_challenger.json` and
  `account_model_challenger/metadata.json` contain `promotion.promoted: true`, `artifact.path: ml/artifacts/v3/account_model`
  and `previous_kept_at: ml/artifacts/v3/account_model_previous`. They were written by an earlier version of the training
  script that promoted automatically when the rule passed. That promotion was undone on the owner's decision: the champion
  is back in `account_model/`, the challenger is in `account_model_challenger/`, and `account_model_previous/` does not
  exist.
- **Training now never changes the served model by default.** `python -m ml.forensics.train_account_model` always writes
  the new model to `account_model_challenger/` and its report to `account_model_v3_challenger.json`.
- **To promote:** run `PYTHONPATH=.:backend backend/.venv/bin/python -m ml.forensics.train_account_model --promote`. Only
  when the rule also passes does it copy the current champion to `ml/artifacts/v3/account_model_previous/` and write the
  new model to `ml/artifacts/v3/account_model/`. It retrains rather than copying the existing challenger; training is
  seeded, and the comparison report shows a refit reproduces the challenger's scores exactly. Restart the server
  afterwards (models are cached per process) and re-run the evaluations in §14.
- **To roll back:** replace `ml/artifacts/v3/account_model/` with the copy in `ml/artifacts/v3/account_model_previous/`
  and restart the server.

## 8. External and source-specific checks

### Demo ledger (different generator; not used to choose any model)

Source: `ml/reports/data_quality_v3.json`, `demo_ledger_external_check`. This is the FraudShield demo ledger
(`data/v2_fraudshield.db`, seed 42), not the forensic `demo` ledger (seed 303). It was not used for any model choice.

| Model | Rows | Positives | Precision | Recall | PR-AUC | ROC-AUC |
|---|---|---|---|---|---|---|
| Transaction model `v3-transaction-1.0.0` | 353,393 transfers | 42 | 0.011 | 0.64 | 0.058 | 0.983 |
| Account model `v3-account-1.0.0` (champion) | 10,000 accounts | 29 | 0.013 | 0.62 | 0.051 | 0.798 |

**Where it fails.** The transaction model produced 2,512 false positives for 27 true positives; at 50% precision its
recall is 4.8%. The account model flagged 1,347 of 9,971 negatives, including 385 of 462 legitimate corporate accounts,
and reaches no precision target at all. The models do not transfer across generators.

**The per-input range check does not detect this.** Only 2,478 of 353,393 transfers (0.7%) and 3 of 10,000 accounts have
three or more inputs outside the training range: each input stays inside its range while the joint behaviour differs.

**Dataset-level distribution check** (`ml/forensics/distribution_shift.py` → `ml/reports/distribution_shift.json`).
Population Stability Index of every model input against the training split. Inputs that grow with ledger length by
definition (prior counts, history days, distinct counterparties, totals: "accumulation") are reported separately from
behaviour-shape inputs (amounts, ratios, shares, timing, types, channels). A first version that counted every input
flagged the train ledger's own validation period as shifted (8 accumulation inputs), so the split was introduced; this
is disclosed in the script and the control stays in the report.

| Dataset | Transaction model: behaviour inputs with PSI > 0.25 | Account model: behaviour inputs with PSI > 0.25 |
|---|---|---|
| Train ledger, validation period (control) | 0 of 29 (max 0.24) | – |
| Cold ledger (seed 202) | 0 of 29 | 0 of 14 |
| Served forensic ledger (seed 303) | 0 of 29 | 0 of 14 |
| **FraudShield demo ledger (different generator)** | **9 of 29** (max 1.91) | **10 of 14** (max 7.56) |

**Explicit support state.** Each dataset now carries `model_support` (in `GET /datasets/{id}/accounts/{id}` and in the
report's `model_validation.support_state`): `validated_in_distribution` (forensic-scenarios), `unsupported_distribution_shift`
(demo-ledger) or `unsupported_not_checked` (the default for any dataset that was never checked). Model outputs count as
evidence only in the first state; otherwise they are reference only and the UI says "Models unsupported on this dataset
(out of distribution)". A test checks the registry against the report. **Nothing here supports a claim of generalisation
beyond this one synthetic generator family**; a new data source needs its own validation and distribution check.

### PaySim

`ml/forensics/paysim_transaction_model.py` evaluates the same feature code on PaySim. It uses PaySim's own
chronological split and keeps the real prevalence. Results are in `ml/reports/paysim_transaction_model.json`.

**Scope and validation:**
- **Rows scored:** TRANSFER and CASH_OUT only, because no other type has a fraud label. Every row still contributes
  history.
- **Validation:** 16 rows with amount 0 were rejected. 4,079,080 rows have a pre-transfer balance below the amount, a
  known PaySim inconsistency, so they were counted but kept.
- **Excluded features:** channel one-hots (PaySim has no channel), the PAYMENT / CASH_IN / DEBIT type flags (never
  fraud-labelled, not scored) and `is_weekend` (PaySim steps have no calendar date, so a weekday would come from the
  adapter's arbitrary base date).

**Splits (whole steps, cut at 70% / 85% of rows):**

| Split | Steps | Rows | Positives | Prevalence |
|---|---|---|---|---|
| Train | 1–323 | 1,951,895 | 3,643 | 0.19% |
| Validation | 324–378 | 427,991 | 564 | 0.13% |
| Test | 379–743 | 390,523 | 4,006 | 1.03% |

Test prevalence is higher because PaySim's volume collapses after about step 400 while fraud stays constant.

**Cold accounts:** only 350 test senders appeared in training; 64% of test receivers did.

| Feature set | Selected (validation PR-AUC) | Test precision | Test recall | Test PR-AUC | Test ROC-AUC | Test FP rate |
|---|---|---|---|---|---|---|
| Decision-time features | Random forest (0.972) | 0.868 | 0.997 | 0.993 | 0.9999 | 0.16% |
| Without the balance-drain ratio | XGBoost (0.468) | 0.512 | 0.465 | 0.544 | 0.944 | 0.46% |

Logistic regression and the random forest are fitted on a 20:1 undersampled training split with class weights; XGBoost
uses the full split with `scale_pos_weight`. With the full feature set, `amount_to_sender_balance` carries 54% of the
forest's importance, and removing it roughly halves performance. PaySim fraud is generated by emptying the sender's
balance: 97.8% of fraud rows do so, against 0.0001% of other rows. Its near-perfect scores therefore describe the
simulator. Logistic regression reached a validation PR-AUC of 0.19.

### AMLSim (independent simulator)

Source: `ml/reports/amlsim_graph_benchmark.json`. Each sample has 20,000 accounts, 4.7% of them in patterns. Balance
features are dropped because the samples have no balances.

| Sample and test | Behaviour only, XGBoost test PR-AUC | Behaviour + graph, XGBoost test PR-AUC | Logistic baseline, behaviour only → + graph |
|---|---|---|---|
| Cycles (node split) | 0.692 | 0.687 | 0.709 → 0.731 |
| Fan-in (node split) | 0.743 | 0.750 | 0.751 → 0.753 |
| Train cycles → test fan-in | | 0.702 | |
| Train fan-in → test cycles | | 0.719 | |

For XGBoost, graph features change test PR-AUC by at most ±0.008. The logistic baseline gained +0.022 on cycles and
+0.002 on fan-in, and beat XGBoost on test in both samples. AMLSim therefore shows no consistent gain from graph
features. The samples share one background graph, so the cross-sample test is not account-disjoint (101 pattern accounts
are shared; the report gives the overlap).

## 9. Role engine, thresholds and restriction recommendations

`backend/app/intelligence/roles.py` applies pure rules to one evidence record per account. It never reads ground truth,
and it never assigns a role because an account received money: every non-ordinary role needs evidence from the account's
own behaviour or position.

**Decision layer: what counts as a flagged transfer.** No scores are averaged. Each source keeps its own output, and a
single precedence rule decides which flags count as evidence.

On datasets where the transaction model is validated (`forensic-scenarios`):
- **What counts:** a transfer counts as flagged when the model is at or above its threshold.
- **Uncorroborated rule flags:** a transfer the fixed rules flag but the model does not is listed separately in
  `uncorroborated_rule_flags`. It is not treated as suspicious activity.
- **Why:** on the development ledger the rule "amount more than twice the account's own largest earlier transfer"
  flagged first rent payments and large purchases and put a large share of ordinary accounts into "suspicious activity
  detected", while the model scored the same transfers near 0. (The share was a development observation and was not
  recorded in a report.)

On datasets where the model is not validated (`demo-ledger`), the fixed rules are the detector and model outputs are
reference only.

Trace seeds are unchanged: rule-flagged transfers are still traced. Only flows that start from a transfer that counts
can make onward movement count as evidence.

### Evidence categories

| Category | Kind | Meaning |
|---|---|---|
| ONWARD | Observed | A material traced receipt (≥ 2,000); non-cash transfers within 24 h of at least 70% of it, capped at what was received; AND the balance-based (lowest-intermediate-balance) attribution shows at least 70% of the traced money itself left |
| CASH | Observed | A material traced receipt of which ≥ 50% was withdrawn as cash (capped at what was received), and balance-based attribution shows ≥ 50% of the traced money left |
| FUNDED_FORWARD | Observed | Investigated account only: most of its flagged outgoing transfers were paid out of money just received from new payers, which its own earlier balance could not have covered |
| FLAGGED_IN_MOVED | Observed | Investigated account only: it received ≥ 2,000 in flagged transfers and balance-based attribution shows ≥ 70% of that money left within 24 h |
| ACCOUNT_MODEL | Model | Model B (the served champion) is at or above its threshold, on validated datasets only |
| TXN_MODEL | Model | Model A flags one of the account's own traced outgoing transfers, on validated datasets only |
| NETWORK | Observed | On a payment loop of ≥ 3 accounts that runs through the account's own outgoing side (it sent traced money on along the loop) |
| RECEIPT_PATTERN | Observed | Receipt-only patterns: paid traced money by ≥ 2 different accounts, paid ≥ 10,000 and half their balance by ≥ 2 senders around the traced receipt, or on a loop only as a receiver. **Context only:** shown, but never counted toward evidence strength, a role or a restriction review. Receiving money is not, on its own, evidence of a role |
| NEW_RECORDS | Observed | Records start less than 30 days before it was reached, and well after the dataset's own start. Context only: never counts toward a role or a restriction |

ONWARD, CASH, FUNDED_FORWARD and FLAGGED_IN_MOVED all describe money leaving the account, so they count as **one**
independent kind (`MOVED_OUT`): one withdrawal can never count twice. NEW_RECORDS and RECEIPT_PATTERN are context only
(`roles.CONTEXT_ONLY`) and never count. Evidence strength and the restriction threshold use the same count
(`roles.independent_kinds`).

### Thresholds, why, and where each was set

| Constant (code) | Value | Why | Basis |
|---|---|---|---|
| `MATERIAL_RECEIPT` (roles.py) | 2,000 | Below this a traced receipt is too small for "passed it on" or "withdrew it" to mean anything; the account's own routine payments dwarf it. Applies to ONWARD, CASH, FLAGGED_IN_MOVED and the secondary-victim rule | Train ledger only: below the 5th percentile of scenario intermediaries' traced receipts (2,517) and at the median of innocent counterparties' (2,000) |
| `RECURRING_PAYER_DAYS` (engine.py) | 7 days | A payer that already paid the account a week or more before an inflow (salary, regular family or rent transfer) is income, not money handed over to be passed on, so it never makes a flagged transfer "funded forwarding" | Set a priori: scenario money moves within hours to a few days, so a week separates the two without using any ledger's results |
| `INTERMEDIARY_SHARE`, `ONWARD_HOURS` | 70%, 24 h | Most of the traced money moved on soon. Applied to the non-cash amount, capped at what was received, and also required of the balance-based attribution, so the account's own money paid out does not count | The 70% share comes from the existing rule set (LIVE_INVESTIGATION.md, `FORWARDS_RECENT_INFLOW`); 24 h was fixed during role-rule development on the train ledger |
| `CASH_SHARE` | 50% | At least half of the traced receipt was withdrawn as cash, again also by balance-based attribution | Role-rule development on the train ledger |
| `STILL_HELD_SHARE` | 20% | "Funds may still be held" needs at least a fifth of the traced receipt still provably there: received minus the most that left, AND the latest balance minus the balance before the receipt. Unknown never counts | Role-rule development on the train ledger |
| `OWN_FUNDS_SHARE`, `OWN_FUNDS_MIN` | 50%, 2,000 | Its own pre-existing savings (at least 2,000) fell by half or more in the window: a sign the holder may be exploited | Role-rule development on the train ledger |
| `ESTABLISHED_DAYS`, `ESTABLISHED_TXNS` | 30 days and 10 transfers | Enough history to call a deviation real | Role-rule development on the train ledger |
| `KEPT_SHARE` | 30% | At most 30% left the window: it kept most of the money | Role-rule development on the train ledger |
| `MIN_TXNS` | 5 transfers | Below this nothing is compared; the account model abstains too | Model abstention rule |
| Hubs for "other senders" | Candidate role, or a model-flagged payee | A hub is any traced intermediary or suspicious-account candidate, or a downstream account the investigated account paid in a model-flagged transfer (unless it was assessed as no linkage, no activity or a cash point; an `unknown_role` payee needs one independent kind of its own). The protection is on the sender side: an account is reported as another affected sender only if its **own** transfer into the hub is flagged by the validated transaction model, and the wording names the hub's candidate role, never "the suspicious account" | Designed on the train ledger (see below); an earlier "≥ 2 kinds" filter was removed because it was not what protected anyone and cut recall |
| 10,000 (drained senders) | 10,000 | Size of a "balance-draining" payment for RECEIPT_PATTERN | Existing rule set |

**Money-leaving evidence counts once (`MOVED_OUT`).** A single cash withdrawal used to count as both CASH and ONWARD;
now it is one kind.

### Roles

Investigated account (checked in this order):

| Role | When it applies |
|---|---|
| `unknown_role` (insufficient) | Fewer than 5 transfers |
| `potential_victim` | At least half of its flagged outgoing transfers were not funded by fresh inflows, it is established, and they deviate from its own history (over twice its largest earlier transfer, a new recipient, at least half the balance, or 00:00–05:00 when it rarely transacted then). Victim checks come first, whatever else arrived in the account |
| `suspicious_activity_victim_unconfirmed` | The same flagged, unfunded transfers, but too little history or no deviation |
| `potentially_suspicious_account` | Flagged transfers from ≥ 2 senders, FLAGGED_IN_MOVED, an outgoing-side signal (a flagged outgoing transfer or cash ≥ 50% of the flagged inflows), and ACCOUNT_MODEL |
| `potential_intermediary` | Its flagged outgoing transfers were mostly funded forwarding (FUNDED_FORWARD). A transfer counts as funded only when inflows in the previous 24 h cover ≥ 70% of it, come from payers that had not paid it at least 7 days earlier, and the balance before them could not have covered 70% of it |
| `unknown_role` | Only the account model suggests review |
| `no_suspicious_activity_observed` | No flagged transfer, or only uncorroborated rule flags |

Connected accounts:

| Role | When it applies |
|---|---|
| `cash_withdrawal_point` | Reached only through cash withdrawals and sends nothing: an ATM or cash network, not a person |
| `potential_victim` (upstream or other sender) | Its flagged transfer into the flow was unfunded and deviates from its established history |
| `no_suspicious_linkage_observed` | No categories on an established or business account; an earlier payer with only context or receipt-side signals; or reached only through transfers nobody flagged (onward movement there is ordinary life) |
| `suspicious_activity_victim_unconfirmed` | Its own savings fell by half or more in transfers the transaction model flags, but attribution cannot show the traced money itself moved on |
| `potential_secondary_victim` | Its own savings fell by half or more (established, personal, not a business), the receipt was material, attribution shows ≥ 70% of the traced money moved on, and ONWARD or TXN_MODEL |
| `potentially_suspicious_account` (collection or cash-out point) | Receipt pattern (CASH, ≥ 2 distinct payers or ≥ 2 drained senders) AND outgoing-side evidence (CASH or TXN_MODEL) AND at most one onward destination AND it did not keep most of the money (unless withdrawn as cash) AND ≥ 2 supporting kinds besides ONWARD (RECEIPT_PATTERN never counts) |
| `potentially_suspicious_account` (partial movement) | No ONWARD, but it moved some money, with ≥ 3 independent kinds including an observed one (CASH or a loop) and a model one |
| `potential_intermediary` | ONWARD; or timing alone (≥ 70% paid out or ≥ 50% withdrawn within 24 h) together with TXN_MODEL, in which case the timing adds no category |
| `unknown_role` | Mixed or single signals, or fewer than 5 transfers |

Each account gets supporting evidence (each item labelled recorded fact or model output), contradictory evidence, evidence
strength (count of independent kinds), the relevant transaction IDs and graph relationship, the account-model result
and data coverage, an uncertainty reason, a recommended next check and ten fixed questions. Every role that could be
wrong about an account (victim, unconfirmed victim, secondary victim, intermediary, suspicious account, unknown) carries
ordinary explanations.

### Restriction states

| State | When |
|---|---|
| `no_restriction_recommendation` | No suspicious linkage or activity; cash points |
| `insufficient_evidence_to_recommend` | Unknown roles |
| `additional_verification_recommended` | Unconfirmed victims (other than the savings case below); intermediaries with one kind of evidence |
| `urgent_manual_review_recommended` | Potential and secondary victims, to protect the holder; a connected unconfirmed victim whose own savings fell by half or more; intermediaries or suspicious accounts with two kinds; an intermediary candidate whose **own** money also left (below) |
| `consider_temporary_restriction_review` | Intermediary roles with ≥ 3 independent kinds, or 2 plus traced funds that may still be held, and only if its own money did not also leave. Never for an account that may be a victim |

**Own funds leaving alongside a pass-through** (`roles.own_funds_also_left`, added in the final review). If an
intermediary candidate's own balance before the traced receipt fell by at least `OWN_FUNDS_MIN` (2,000, an existing
constant) during the window while it made transfers the transaction model flags, it may itself be exploited (the
secondary-victim pattern). It then gets urgent manual review, never a restriction review, with the own-funds loss stated.
The rule can only soften a recommendation. Found from a cold-ledger case (FS-4268EBB9: a secondary victim whose own funds
fell 45%, below the 50% savings rule); decided without a new threshold and measured on the train ledger first
(restriction reviews: true intermediaries 182 → 180, secondary victims 2 → 1; nothing else changed).

**Why FS-BE16A3FE keeps its restriction review.** On the served ledger it received 74,578 from a victim and forwarded
73,603 to the collector 82 minutes later; the account model and transaction model both flag it. The generator planned it
as a secondary victim, but it had spent its own savings down to 167 through ordinary purchases, so the planned drain never
happened and nothing in the ledger shows it being exploited: its records are those of a plain intermediary. Three
independent kinds of evidence are real, so the review stands (with "may have been deceived into receiving and moving
funds" listed). It is counted under "no scenario role" in the evaluations only because its planned label never
materialised; the ground truth was not relabelled to improve the numbers. A regression test pins this case.

Every state carries `human_review_required: true` and `automatic_action_taken: false`, plus innocent explanations,
verification needed and missing information. No API route can freeze, block, restrict or suspend anything, and a test
enforces this.

### Which data influenced the role rules, and the untouched evaluation

| Data | How it influenced the role rules | Can its role results be called held out? |
|---|---|---|
| Train ledger (seed 101) | Development ledger: rules, `MATERIAL_RECEIPT`, the hub rule and the own-funds rule were designed and measured here | No (development data) |
| Served ledger (seed 303) | Concrete failure examples during the safety review (pass-through larger than the receipt, double-counted withdrawal, merchants as secondary victims, receipt-only collectors, a salary-funded victim); one rule added because of FS-29869761 (urgent review for a savings-drained unconfirmed victim); regression tests use its numbers; the scenario-6 criterion was revised after seeing its result | **No** |
| Cold ledger (seed 202) | No threshold was set from it, but it was run before and after rule changes, the hub-rule agent measured it twice, and the own-funds rule was prompted by one of its cases (FS-4268EBB9, decided without a new threshold and measured on train) | **No**: it has been looked at during rule work |
| FraudShield demo ledger (seed 42) | An early "balance-draining payments" false-accusation source came from it | Not used for role evaluation |
| **Hold-out ledger (seed 404)** | **None.** Added after the rules, thresholds and models were frozen | **Yes, once** |

**Untouched protocol** (`ml/forensics/holdout_evaluation.py`, tested in `ml/tests/test_holdout_protocol.py`). The script
fingerprints the 18 files that decide an outcome (inference code, tracer, served model artifacts, generator, evaluator).
It evaluates seed 404 once and stores the result with that fingerprint. A second run with the same code only prints the
stored result. If any frozen file changes, it refuses: seed 404 has been seen and a new seed must be added and recorded.
Nothing may be tuned against it.

**Hold-out result** (`ml/reports/holdout_evaluation.json`, manifest `cfe6642c…`, 132 investigations, evaluated once):

| Measure | Hold-out (seed 404) |
|---|---|
| Victims flagged (potential victim or unconfirmed) | 59 of 61 (96.7%) |
| Held-out variants: slow multi-hop / structured split / takeover after dormancy | 2 of 2 / 2 of 2 / 1 of 2 |
| Ordinary investigated accounts: no suspicious activity / potential victim / insufficient | 57 / 1 / 2 of 60 |
| Look-alike hubs called potential victim | 0 of 10 |
| True intermediaries labelled intermediary or suspicious | 91 of 124 |
| True collectors labelled intermediary or suspicious | 19 of 38 |
| Innocent counterparties labelled intermediary or suspicious / given restriction review | 0 of 32 / 0 |
| No-scenario-role accounts labelled intermediary or suspicious / given restriction review | 0 of 822 / 0 |
| No-scenario-role accounts given a protective potential-victim label | 5 of 822 |
| Victims or secondary victims given restriction review | 0 |
| Secondary victims (6 reached): exact `potential_secondary_victim` (original criterion) | **2 of 6** |
| Secondary victims: victim-class and not intermediary (exploratory criterion) | 4 of 6 (0 labelled intermediary) |

One fresh seed of the same generator family is a small sample (61 victims, 6 secondary victims); it checks for
overfitting to the development ledgers, not real-world performance.

**The trade-off of the final rule changes (cold ledger).** "Before" comes from a development run of the engine just before
the final changes; that run is not kept in `ml/reports/` (its traces also differ, e.g. 398 true intermediaries reached
instead of 369). "After" is `ml/reports/investigation_eval_cold.json`.

| Cold ledger | Before | After |
|---|---|---|
| True intermediaries given `consider_temporary_restriction_review` | 236 of 398 | 106 of 369 |
| True collectors given `consider_temporary_restriction_review` | 77 of 108 | 40 of 108 |
| True intermediaries labelled intermediary or suspicious | 260 of 398 | 255 of 369 |
| Accounts with no scenario role labelled intermediary | 6 of 1,438 | 1 of 1,438 |
| Accounts with no scenario role labelled secondary victim | 16 | 0 |
| Innocent counterparties labelled intermediary | 3 of 89 | 0 of 89 |
| Accounts with no scenario role labelled potential victim (protective review) | 38 | 40 |
| Random ordinary investigated accounts called potential victim | 5 of 80 | 8 of 80 |
| Look-alike hubs called potential victim | 0 of 39 | 5 of 39 |

Fewer true intermediaries now reach restriction review (most move to urgent manual review), accusations of uninvolved
accounts fell, and protective "potential victim" labels on uninvolved accounts rose.

**Last two rule changes** (designed on the train ledger only; cold and served results come from one run each afterwards):
- **Receipt-only evidence never counts toward a restriction review.** Receipt patterns (several payers, drained senders
  nearby, being on a loop only as a receiver) became the context-only RECEIPT_PATTERN category; NETWORK now means a loop
  through the account's own outgoing side. On the served ledger this moved the 4 restriction reviews that relied on
  receipt-only evidence (FS-6D5033D8 twice, FS-0840088A, FS-BBCD8F9B, all true scenario accounts) to urgent manual
  review. On the cold ledger true-intermediary restriction reviews went from 114 to 108.
- **Other affected senders: recall restored.** The "≥ 2 kinds" hub filter introduced with the safety fixes was not the
  cause of the drop: most missed victims had paid a collection account that the stricter rules now call `unknown_role`
  or an unconfirmed victim. The hub rule in §9 fixes this while keeping the protection on the sender side (each sender's
  own transfer must be model-flagged). Measured on the train ledger first: multi-victim and consolidation roots that
  surfaced at least one other victim 18 of 126 → 81 of 126 (other victims found 46 of 322 → 205 of 322), with false
  other senders unchanged at 4 (none an innocent counterparty).

## 10. Fund tracing, branch endings and tracing verification

The existing bounded, time-ordered BFS (`graph_tracer.py`) is reused and extended. It now records, per expanded account,
how many transfers it found, whether the 10-largest-per-account cap applied, and how many transfers the account limit
dropped.

**Loops, including loops through the investigated account.** A transfer closes a loop (`is_cycle`) when its other party
is already on its own path back to the root, or when that party was first reached from the opposite side of the root and
the timestamps let money run all the way round (each half is time-ordered, so at most one point may go back in time:
the party paid on within the window of receiving, or the root did). Otherwise the meeting is a convergence.
`cycle_members` (used for the NETWORK category) counts only loops of at least 3 distinct accounts; two accounts paying
each other is ordinary (refunds, shared bills) and is shown as a cycle ending, never used as evidence.

**Cross-links.** A transfer found again while expanding from the opposite direction is never added twice. It is recorded
in `cross_links`, and the branch that reached it ends with `joins_opposite_direction_trace`, naming the branch where it
is shown.

**Branches.** The engine splits the trace into branches (`OUT-n` and `IN-n`), each root to leaf, with the transfer IDs,
accounts, amounts and an ending reason. Ending order: loop, cash withdrawal, already reached (opposite side or same side),
depth limit, account limit, per-account cap, nothing further in the window.
- `cycle_detected`, `cash_withdrawal_recorded` (downstream ATM cash-out; cash cannot be followed)
- `joins_opposite_direction_trace`, `already_examined_on_another_branch`
- `maximum_depth_reached`, `maximum_node_limit_reached`, `per_account_limit_applied`
- `no_further_transaction_in_window`, `no_earlier_transaction_in_window`, `incomplete_or_missing_data`

Branches contain exactly the traced transfers: none are invented and none dropped. No ending says money was recovered,
lost or frozen.

**Digest.** `investigation_digest` hashes every section of the response except the run-specific fields
(`investigation_id`, `started_at`, `completed_at`, `duration_ms`, `processing_steps`, and the source's `queried_at` /
`snapshot_built_at`), plus the trace report's own digest. Identical requests on the same ledger give the same digest.

**Verification** (`ml/forensics/verify_tracing.py` → `ml/reports/tracing_verification.json`). Every amount, ending, loop
and limit was recomputed with direct SQL on the served ledger, without engine code: 1,584 runs over 152 accounts (61
victims, 25 circular-scenario members, 10 look-alike hubs, 60 ordinary accounts) at depths 1–6, with node limits 10, 50
and 200 on a subset. **All 29 checks pass (0 failures, 0 engine errors).** The first verification run found five real
defects; all are fixed and covered by regression tests in `backend/tests/test_v3_tracing.py`:

| Defect found | Fix | Check after the fix |
|---|---|---|
| `maximum_depth_reached` was given at the last hop even when the money had simply stopped (46% of those endings) | The tracer runs one bounded existence query per last-hop account; the ending is `maximum_depth_reached` only when a further qualifying transfer exists, otherwise the truthful "no further / no earlier transaction" | 1,304 / 1,304 |
| The depth-limit note counted every last-hop account as "not followed further" | It counts only accounts with a further transfer, and is omitted when there are none | 721 / 721 |
| `per_account_limit_applied` could never appear | A branch now ends at a capped account stating "M transfers within the window; only the 10 largest were followed" (no transfer added) | 31 / 31 |
| The forwarded range covered only receipts within 72 h of the first one, while the received amount counted all traced receipts | Every traced receipt is covered: receipts are grouped into non-overlapping 72 h windows, the balance rule runs per window and results add up (identical when all receipts share one window) | 8,805 / 8,805 |
| Seed lists named transfers the node limit kept out of the trace | Seed lists name only traced seeds; dropped seeds are listed separately and in the truncation note | 1,584 / 1,584 |

| Check | Result |
|---|---|
| Trace edges, branch steps and every transaction object match the ledger | 14,856 / 20,730 / 40,215 checked, 0 failed |
| Received / sent traced amounts follow their stated rules; forwarded bounds ordered; exposure recomputed by SQL (per-window rule) | 14,107 / 14,107 / 17,610 / 8,805 checked, 0 failed |
| Every ending's condition holds; no ending claims money recovered, frozen or lost | 10,377 checked, 0 failed |
| Every planted loop within depth is closed by a cycle transfer and all members carry `in_cycle` | 230 checked, 0 failed |
| Every `is_cycle` transfer and every `in_cycle` account is on a real loop | 303 and 997 checked, 0 failed |
| Depth and node limits respected; raising depth never alters earlier transfers; identical requests give identical digests | 1,584 / 1,584 / 1,320 / 45 checked, 0 failed |
| Branches are valid time-ordered chains covering exactly the traced transfers | 13,545 checked, 0 failed |
| Other senders' transfers match the ledger | 333 checked, 0 failed |

Two checks were corrected along with the fixes because they encoded the old behaviour and contradicted their companion
checks (no output could pass both): b1 required "no further transaction" endings to sit below the depth limit, and a8
recomputed the old single-window exposure rule. Both are still independent SQL recomputations, now of the documented
rules.

Ending counts across all runs: no further transfer 2,636, no earlier transfer 2,441, cash withdrawal 1,779, already
examined 1,571, depth limit 1,304, cycle 303, account limit 231, joins opposite-direction trace 81, per-account cap 31.

## 11. End-to-end evaluation of the engine

`ml/forensics/evaluate_investigations.py` runs the full engine, as the API does, against the generator's ground truth.
Ground truth is read only by the evaluator. It runs one investigation per scenario instance (starting from its first
victim, or the look-alike's hub), random ordinary accounts with at least 5 transfers (80 on train and cold, 60 on demo),
one low-history account and one unknown ID.

**Summary across ledgers** (`investigation_eval_{train,cold,demo}.json`):

| | Train (rules developed here) | Cold | Served demo (seed 303; not fully held out, §9) |
|---|---|---|---|
| Investigations; median seconds (final runs, 8 evaluations in parallel on one machine) | 390; 1.03 | 314; 0.88 | 118; 0.58 |
| Victims flagged (potential victim or unconfirmed) | 246 of 251 | 184 of 194 | 44 of 47 |
| True intermediaries labelled intermediary or suspicious | 366 of 479 | 255 of 369 | 61 of 90 |
| True collectors labelled intermediary or suspicious | 98 of 163 | 63 of 108 | 14 of 28 |
| Innocent counterparties labelled intermediary or suspicious | 0 of 114 | 0 of 89 | 0 of 21 |
| Innocent counterparties given restriction review | 0 of 114 | 0 of 89 | 0 of 21 |
| No-scenario-role accounts labelled intermediary or suspicious | 1 of 2,248 | 1 of 1,438 | 1 of 640 |
| No-scenario-role accounts given restriction review | 0 of 2,248 | 1 of 1,438 | 1 of 640 |
| Secondary victims given restriction review | 1 of 21 | 1 of 15 | 0 of 4 |
| True victims reached in traces given restriction review | 0 of 61 | 0 of 24 | 0 of 5 |

**Investigated account (cold ledger):**

| Accounts investigated | n | Result |
|---|---|---|
| Victims | 194 | 94.8% flagged: 93.8% potential victim, 1.0% suspicious activity with victim status unconfirmed. 5.2% missed (no flagged transfer) |
| Ordinary accounts (random) | 80 | 80.0% no suspicious activity, 10.0% potential victim, 7.5% insufficient evidence, 2.5% unconfirmed |
| Legitimate look-alikes (family pooling) | 39 | 12.8% potential victim, 2.6% unconfirmed, 48.7% insufficient evidence, 35.9% no suspicious activity |
| Low-history account | 1 | Insufficient evidence; the account model abstained |
| Unknown ID | 1 | `account_not_found`; nothing invented |

Detection rate by pattern (cold):

| Pattern | Detected | Victims |
|---|---|---|
| Direct | 100% | 27 |
| Chain | 93% | 29 |
| Multi-hop | 95% | 21 |
| Multi-hop, slow (held out) | 100% | 10 |
| Split | 100% | 15 |
| Split, structured (held out) | 100% | 10 |
| Consolidation | 100% | 17 |
| Circular | 85% | 13 |
| Several victims | 78% | 18 |
| Takeover | 100% | 18 |
| Takeover after dormancy (held out) | 94% | 16 |

**Connected accounts (cold ledger), by true role:**

| True role | Seen in traces | Labelled intermediary or suspicious | Other labels |
|---|---|---|---|
| Intermediary | 369 | 255 (69.1%) | unknown 105, no linkage 5, unconfirmed victim 4 |
| Collector (attacker_controlled) | 108 | 63 (58.3%) | unknown 44, no linkage 1 |
| Secondary victim | 15 | 2 as intermediary | secondary victim 3, unconfirmed victim 5, unknown 5 |
| Innocent counterparty | 89 | 0 | no linkage 70, unknown 19 |
| No scenario role (ordinary, merchant) | 1,438 | 1 (0.07%) | no linkage 1,277, unknown 120, potential victim 40 |
| Role in another scenario | 172 | 0 | no linkage 129, unknown 38, potential victim 4, secondary victim 1 |
| Victim (other victims reached, mostly as other senders) | 24 | 0 | potential victim 24 |
| Cash network | 380 | 0 | all `cash_withdrawal_point` |

Restriction states for true intermediaries (cold): restriction review 106, urgent manual review 142, additional
verification 11, insufficient evidence 105, none 5.

**Served ledger (seed 303)** (`investigation_eval_demo.json`; not fully held out, §9). Investigated: 44 of 47 victims
called potential victims (3 missed); 60 random ordinary accounts gave 53 no suspicious activity, 4 potential victim, 3
insufficient evidence; 10 look-alike hubs gave 7 insufficient evidence and 3 potential victim. Connected: of 640
no-scenario-role accounts, 1 was labelled intermediary and given restriction review, 6 potential victim (protective urgent
review), 577 no linkage and 56 unknown; of 21 innocent counterparties, 18 no linkage and 3 unknown, none reviewed; of 4
secondary victims, 2 unconfirmed victims (urgent review), 1 no linkage and 1 unknown.

**Finding other affected accounts.** In 11 of 18 several-victim scenarios on the cold ledger, another victim was
surfaced through the "other senders" step (29 other victims in all; before the hub-rule fix: 6 of 18 and 7). On the
served ledger, across every several-victim and consolidation victim, 18 of 21 victims were detected and 9 surfaced at
least one other victim (20 of 46 other victims found; 3 and 4 before the fix). Scenario 4 below shows why one case
still fails.

**Reading this.** On held-out accounts from the same generator family, the engine finds most victims and rarely accuses
accounts with no scenario role. About a third of true intermediaries end up "unknown", mostly because the 24-hour onward
rule or the evidence threshold was not met; the engine errs towards "unknown" rather than accusation. All of this is
synthetic and specific to one generator (§8).

### Ledger-wide safety scan (served ledger)

`ml/forensics/safety_scan.py` → `ml/reports/safety_scan.json`. 256 investigations with the API defaults on the served
ledger. Every account assessed in any position was classified with ground truth after the engine ran. No threshold or
rule was changed by this scan.

- **Innocent counterparties:** 0 labelled intermediary or suspicious, 0 restriction reviews; 2 assessments labelled
  potential victim with protective urgent review.
- **Look-alike accounts:** 0 suspicion labels; 3 potential victim with protective urgent review.
- **Accounts with no scenario role:** 3 suspicion labels on 3 distinct accounts, all `potential_intermediary`:
  - FS-BE16A3FE, `consider_temporary_restriction_review`: a plain pass-through in the ledger whose planned
    secondary-victim role never materialised (§9 explains why the review stands).
  - FS-10B80A33 (`additional_verification_recommended`) and FS-7BA8A2CC (`urgent_manual_review_recommended`): ordinary
    accounts investigated directly, whose one flagged outgoing transfer was funded by a fresh inflow (FUNDED_FORWARD).
- **Protective potential-victim labels on protected accounts:** 25 occurrences on 23 distinct accounts.
- **The four fixed failure modes, 0 occurrences each:** pass-through stated larger than the receipt (199 statements,
  2,622 assessments), one cash withdrawal counted twice (2,342 accounts recomputed by SQL), a business account labelled
  secondary victim (1,180 business assessments), a review state resting on receipt-only evidence (96 suspicion-side
  reviews). The own-funds rule softened 2 restriction reviews (both true scenario intermediaries) to urgent review.

### Reconciling the safety figures

The figures come from different ledgers and count different things. An **investigation** is one engine run from one
investigated account. An **assessment** is one account's role assessment inside one investigation, in any position;
the same account can be assessed in several investigations. A **distinct account** is counted once.

| Figure | Ledger | Population | Unit |
|---|---|---|---|
| 256 | Served (seed 303) | Safety-scan roots: 61 victims, 10 look-alike hubs, 35 innocent counterparties, 150 seeded ordinary accounts | investigations |
| 2,622 | Served (seed 303) | Every account assessed across those 256 runs, investigated accounts included: 2,166 no scenario role, 320 scenario roles, 123 innocent counterparties, 13 look-alikes | assessments (an earlier run before the other-sender fix gave 2,606) |
| 25 on 23 | Served (seed 303) | Protective potential-victim labels on innocent, look-alike or no-role accounts in the scan | assessments on distinct accounts |
| 314 | Cold (seed 202) | Evaluation roots: 194 victims, 39 look-alike hubs, 80 ordinary accounts, 1 low-history account | investigations |
| 2,595 | Cold (seed 202) | Connected accounts assessed across those runs (investigated accounts excluded), incl. 1,438 no scenario role, 89 innocent counterparties, 369 intermediaries | assessments |
| 40 of 1,438 | Cold (seed 202) | No-scenario-role connected assessments labelled potential victim (40 distinct accounts) | assessments |
| 118 / 945 | Served (seed 303) | `evaluate_investigations --ledger demo` roots / connected assessments (a different root set from the safety scan) | investigations / assessments |
| 132 / 822 | Hold-out (seed 404) | Hold-out roots / no-scenario-role connected assessments | investigations / assessments |

The served-ledger evaluation (118 runs) and the safety scan (256 runs) use different root sets on the same ledger, so
their counts are not additive.

### Scenario 4: a narrow model miss

`ml/forensics/analyse_false_negative.py` → `ml/reports/scenario4_false_negative.json`. Victim FS-03BDFF00 of
SC-MULTI-VICTIM-0041 sent TX-303-0064858 (6,662.49, 52% of its balance).

- **Cause.** Not a held-out variant and no input out of range. A small transfer, not large for this sender (below its
  earlier maximum, +2.3 SD), to a receiver that already had many outgoing transfers, at midday. Calibrated score 0.000978
  against the threshold 0.001302 (75.1% of it); log-odds short by 0.227.
- **Rules.** None can fire: each needs at least 10,000 or 25,000, or a burst or recent inflow. An uncorroborated
  `AMOUNT_ABOVE_OWN_HISTORY` flag on a 10,795.53 merchant payment was the only trace seed and pre-empted the
  "five largest outgoing" fallback, in which this transfer ranks second. The engine reports
  `no_suspicious_activity_observed`.
- **Threshold kept.** On validation, lowering the threshold to this transfer's score adds 40 false positives and 0 true
  positives, and precision falls to 49.0%, below the 50% target. Post hoc, for information only: on the cold ledger +93
  false positives and +5 true positives (recall +0.4 points); on the served ledger +35 and +5. With the lowered threshold
  the engine flags the victim but still surfaces none of the 3 other victims (the intermediary is assessed
  `unknown_role`). The validation-selected threshold therefore stays.
- **How often.** Victim transfers missed: 3 of 50 on validation (6%); post hoc 18 of 233 on the cold ledger (9 of 55 in
  several-victim scenarios) and 5 of 57 on the served ledger.
- **What the report shows instead.** `closest_unflagged_transfers` lists the investigated account's three highest-scoring
  unflagged outgoing transfers with their score, the threshold and the share of it. TX-303-0064858 is the first entry, at
  75.1%. It is context only: never a flag and never a trace seed.

### Scenario demonstration

[SCENARIO_DEMONSTRATION.md](SCENARIO_DEMONSTRATION.md) (`ml/reports/scenario_demonstration.json`) runs ten required
scenarios on the served ledger. **8 of 10 pass under the original, pre-registered criteria.** Scenario 4 fails (above).
Scenario 6 fails: the original criterion requires the exact role `potential_secondary_victim`, and 0 of the 4 secondary
victims on the served ledger receive it (2 are unconfirmed victims under urgent review, 1 no linkage, 1 unknown; none is
labelled intermediary and none gets a restriction review).

A revised criterion (a victim-class role that is not an intermediary role) was introduced **after** seeing that result.
It is not used for pass/fail. It is reported only as an exploratory metric: 2 of 4 on the served ledger and, on the
untouched hold-out ledger, 4 of 6 (against 2 of 6 under the original criterion).

## 12. API, UI and the AI analyst

**API:**

| Method and path | Purpose |
|---|---|
| `GET /api/v2/datasets` | Datasets, availability and record counts |
| `GET /api/v2/datasets/{dataset}/accounts/{id}` | History coverage, model availability and whether models count as evidence here. No prediction; 404 if absent |
| `GET /api/v2/datasets/{dataset}/sample-accounts` | Starting points chosen from observable activity only |
| `POST /api/v2/dynamic-investigations` | The investigation (schema `DynamicInvestigationResponse`; the trace report is nested as `investigation`) |
| `POST /api/v2/dynamic-investigations/explanation` | The optional AI explanation, recomputed server-side and matched by `report_digest` |

**UI** (`/investigate`):
- **Dataset picker and account summary:** coverage and models, no prediction.
- **One request,** with the engine's real steps listed (no fake progress).
- **Six stages:**
  - **Overview:** is the account a potential victim, the suspicious transfers with model factors, the closest unflagged
    transfers, and data coverage.
  - **Fund trail:** the left-to-right tree and the step-by-step story.
  - **Affected accounts:** grouped by role, with evidence, ten questions and restriction state.
  - **Risk evidence.**
  - **AI analyst.**
  - **Next steps:** the restriction discussion with human-approval wording.

**AI analyst** (`backend/app/services/v2/ai_analyst.py`; configuration and privacy in [AI_ANALYST.md](AI_ANALYST.md)):
- **It explains the dynamic assessment.** For a dynamic investigation the extract sent to Gemini takes its accounts from
  `role_assessments` (role candidate, evidence items, contradictory evidence, uncertainty, restriction state,
  `may_be_victim`) and its flagged transfers from `suspicious_transactions`. Model details are included only where they
  count as evidence (`evidence_use: "evidence"`; the account model only with status `scored`). The trace report's older
  model statements are dropped. IDs are pseudonymised and the answer is grounded against them.
- **Real states.** `disabled` (turned off on the server), `not_configured` (no API key), `skipped_privacy_policy`,
  `unavailable`, `completed`, or `deferred`. The investigation route returns `deferred` only when an explanation request
  could produce one; otherwise it returns the real state at once, so the page does not send a second request that would
  recompute the investigation for nothing. The explanation route answers an unknown account with 404 and, when nothing
  can be explained, returns the state without recomputing (empty `report_digest`).
- **The v2 model is used only on `demo-ledger`.** On `forensic-scenarios` the trace report contains no `v2-account-2.0.0`
  scores, so neither the page nor the analyst can mix them with the v3 assessment.

## 13. Limitations and remaining failure modes

- **Synthetic only.** The models are trained and tested on one generator family. On a different generator (the demo
  ledger) they fail (§8). Nothing here estimates real-world accuracy.
- **Fairness.** No protected attributes exist in any dataset, so nothing can be said about demographic fairness.
  Customer type was used only as an evaluation slice. Students have a higher transaction-model false-positive rate (0.32%
  vs 0.19% for retail); 67 cold-ledger false positives are student allowances. Removing sensitive fields does not make a
  model unbiased.
- **The served account model (champion) flags short histories.** About a third of negatives with under 30 days of records
  are flagged (32.7% on cold snapshots), so ACCOUNT_MODEL evidence is weakest on new accounts. It also flags 60% of
  legitimate pooling look-alikes at the cold ledger end. It was trained on the pre-correction labels. The challenger fixes
  the short-history problem but, on the validation and cold ledgers at the ledger end, flags more long-history accounts,
  victims and innocent counterparties (§7.3).
- **Narrow model misses go untraced.** A victim transfer just under the threshold seeds nothing (scenario 4); an
  uncorroborated rule flag can still pre-empt the "five largest outgoing" fallback seeds (a product decision left open).
  Other victims are surfaced in 11 of 18 several-victim scenarios on cold, so 7 still are not.
- **Protective false-victim labels** (`ml/forensics/review_protective_labels.py` →
  `ml/reports/protective_label_review_cold.json`). On the cold ledger 40 accounts with no scenario role were labelled
  `potential_victim` (40 of 1,438 such assessments). Against ground truth all 40 are false victim labels. 39 are upstream
  payers into the investigated account and 1 an "other sender"; 35 arose from investigating family-pooling look-alike
  hubs, where a relative's contribution (half their balance, to an account they never paid before, flagged by the
  model) is indistinguishable in the ledger from a scam payment. Graded on observable evidence only (fixed rubric of four
  deviations): 14 supported (≥ 3 deviations), 15 uncertain (2), 11 weak (1, usually only "a recipient it never paid
  before"). Every one leads only to urgent manual review to contact the holder; none is a suspicion label or a
  restriction. Not changed: making single-deviation upstream payers "unconfirmed" instead would be a rule change prompted
  by the cold ledger; it must be designed on the train ledger and tested on a new hold-out seed. On the hold-out ledger
  the same label occurred on 5 of 822 no-scenario-role assessments.
- **Residual suspicion on uninvolved accounts.** One no-scenario-role account per ledger was labelled intermediary (cold,
  served); the safety scan found three, one with restriction review. FUNDED_FORWARD on an investigated ordinary account
  can be a coincidence of timing.
- **Secondary victims** can look like intermediaries: 2 of 15 on the cold ledger were labelled intermediary and given
  restriction review.
- **About a third of true intermediaries end as "unknown"** (105 of 369 on cold).
- **Slow chains escape the onward rule.** Hops slower than 24 h never trigger ONWARD (by design).
- **Trace cost on hub counterparties.** Per-account history reads are not windowed: ATM and other hub accounts can pull a
  large share of the ledger (up to about a quarter of the served ledger's rows in one run). Windowing them would change
  the point-in-time features, so it needs a design change such as features precomputed at ingest.
- **Challenger threshold ties.** The challenger's isotonic plateau puts 348 validation rows exactly at its threshold, so
  its real validation precision is 0.39, below the 50% target. It is not served; a tie-aware selection is a precondition
  for promoting it (§7.4).
- **Held-out evidence is small.** Only the seed-404 hold-out is untouched for the role engine (§9); the served and cold
  ledgers influenced rules. One fresh seed of the same generator (61 victims, 6 secondary victims) cannot establish
  performance on other generators or real data, and seed 404 cannot be reused after any code change.
- **Secondary victims are hard to tell apart.** Under the original criterion 0 of 4 (served) and 2 of 6 (hold-out) get
  the exact secondary-victim role; balance-based attribution often cannot show that the traced money itself moved on when
  the account had its own savings.
- **Cross-generator.** On a different generator the models fail (§8). The distribution check marks such datasets
  unsupported, but it only covers datasets registered in `datasets.py`; any new source must be checked and validated
  before its model outputs count as evidence.
- **Other affected senders** are found only through hubs within the trace (candidates, or model-flagged payees of the
  investigated account) and are capped: 10 hubs, the 50 largest inflows per hub, 60 candidate senders, 15 reported.
- **No as-of mode.** The API has no `as_of` parameter: reports describe the ledger up to its latest record. The feature
  code supports `as_of`, which the training scripts use.
- **The AMLSim simulator itself was not run** (it needs Java 8, Maven and MASON). Only the published samples were used.
  AMLworld was not used because it needs a Kaggle login.
- **Speed.** Investigations are synchronous, about 0.2–0.8 s median locally (§11) plus the free server's wake-up time.

## 14. Reproducing everything

From the repository root, with `export PYTHONPATH=.:backend` and `PY=backend/.venv/bin/python`.

**Inputs.**

```bash
# FraudShield demo ledger (seed 42) -> data/v2_fraudshield.db; read by data_quality (external check)
$PY scripts/generate_synthetic_bank_data.py --seed 42 --output-dir data/v2_synthetic
$PY scripts/ingest_v2_data.py --input-dir data/v2_synthetic --db-url "sqlite:///data/v2_fraudshield.db" --batch-size 10000 --replace

# Forensic ledgers; each also writes its evaluation-only CSVs (incl. roles.csv) to data/v3_forensic/<ledger>/
$PY scripts/build_forensic_ledger.py --ledger demo  --db data/v3_forensic_scenarios.db   # served ledger (seed 303)
$PY scripts/build_forensic_ledger.py --ledger cold  --db data/v3_forensic_cold.db
$PY scripts/build_forensic_ledger.py --ledger train --db data/v3_forensic_train.db
```

- **PaySim:** `data/raw/PS_20174392719_1491204439457_log.csv` (Kaggle `ealaxi/paysim1`; checksum in DATASETS.md).
- **AMLSim:** the three `.tgz` samples in `data/raw/amlsim/`, extracted to `data/raw/amlsim/extracted/<sample>/` (steps in
  DATASETS.md).

**Training and evaluation.**

```bash
$PY -m ml.forensics.data_quality                                    # data quality + demo-ledger external check
$PY -m ml.forensics.train_transaction_model                         # model A (~4 min)
$PY -m ml.forensics.train_account_model                             # writes the CHALLENGER only (~5 min)
# $PY -m ml.forensics.train_account_model --promote                 # owner's decision only: see §7.4
$PY -m ml.forensics.compare_account_models                          # champion vs challenger on current labels
$PY -m ml.forensics.evaluate_investigations --ledger train          # development evaluation of the engine
$PY -m ml.forensics.evaluate_investigations --ledger cold
$PY -m ml.forensics.evaluate_investigations --ledger demo --ordinary 60
$PY -m ml.forensics.safety_scan                                     # ledger-wide safety scan (served ledger)
$PY -m ml.forensics.verify_tracing                                  # tracing verification (~7 min; --quick for a subset)
$PY -m ml.forensics.review_protective_labels --ledger cold          # every protective victim label on an uninvolved account
$PY -m ml.forensics.distribution_shift                              # dataset-level distribution check (model support state)
$PY -m ml.forensics.holdout_evaluation                              # untouched hold-out (seed 404): runs ONCE per code manifest
$PY -m ml.forensics.analyse_false_negative                          # scenario 4 diagnosis
$PY -m ml.forensics.demonstrate_scenarios                           # writes docs/SCENARIO_DEMONSTRATION.md
$PY -m ml.forensics.amlsim_graph_benchmark                          # needs data/raw/amlsim
$PY -m ml.forensics.paysim_transaction_model                        # needs the PaySim CSV; ~8 GB RAM
$PY -m pytest backend/tests ml/tests -q
```

The seeds are fixed (generator seeds 101, 202 and 303; model seed 20261031). Two runs produce identical metrics.
Library versions are recorded in each artifact's `metadata.json`.
