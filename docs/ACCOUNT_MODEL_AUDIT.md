# Account model reliability audit (29 Oct 2026)

This audit covers the account-level risk model shown in **Accounts & risk**. It does not cover the PaySim
transaction benchmark, which is separate (see the end of this document).

Status: `v2-account-1.0.0` was replaced by **`v2-account-2.0.0`**. The old artifact is kept unchanged in
`ml/artifacts/v2/account_model/` for comparison.

Reproduce everything (from the repository root):

```bash
PYTHONPATH=backend:. backend/.venv/bin/python -m ml.v2.scenario_bank        # evaluation ledger, ~1 min
PYTHONPATH=backend:. backend/.venv/bin/python -m ml.v2.account_model_eval   # evaluation + new artifact
```

Results are written to `ml/reports/account_model_v2_evaluation.json`. Two consecutive runs produced identical
results.

---

## 1. Reproduced baseline: v2-account-1.0.0

| Item | Value |
|---|---|
| Artifact | `ml/artifacts/v2/account_model/model.joblib` (XGBoost, 26 features, depth 4, 100 trees, `scale_pos_weight=5`) |
| Training script | `ml/v2/train_account_model.py`; features from `AccountFeatureBuilder` (the serving code) |
| Data | Demo ledger `data/v2_fraudshield.db`: 10,000 accounts, 5 hand-planted scenarios, one instance each |
| Split | Test = scenarios APP-001 and DORMANT-005 plus 20% of ordinary accounts; no validation set |
| Train | 8,000 accounts, 26 suspicious |
| Test | 2,000 accounts, 6 suspicious, 1,994 not |
| Threshold | Fixed at 0.5, not selected on any data |
| Score shown | Raw `predict_proba` × 100, uncalibrated |

Recomputed from the artifact and the script's own split, the results match the stored metadata exactly:
confusion matrix `[[1992, 2], [4, 2]]`, precision 0.50, recall 0.333, F1 0.40, ROC-AUC 0.9945, PR-AUC 0.4642.

**What those numbers hide.** The two "true positives" were `ACC-000009` and `ACC-000012`, ordinary busy
merchants that carry a `cashout_terminal` label (see §3). The model detected **none** of the four accounts
that actually moved scenario money: `ACC-000003` scored 0.10, `ACC-000002` 0.15, `ACC-000005` 0.13 and
`ACC-000032` 0.02. One of its two false positives was the scam victim, `ACC-000001`, at 0.76.

## 2. Why the FS-2001 forwarding accounts scored low

The record was traced through the whole pipeline. There is no aggregation, inference-order or score-conversion
bug: features recomputed by the serving builder match the training rows, the feature order matches the
booster, and the displayed percentage is `predict_proba × 100`. The low scores come from the training data:

1. **Only one training example of forwarding.** The only forwarding accounts in training were the 10
   DISPERSAL-003 mules, all near-identical clones: students, ₹25,000 in, ₹24,500 out after 15 minutes. The
   FS-2001 accounts forward ₹1.2–2.5 lakh, and `ACC-000003` is retail. A tree model fitted to 26 positives
   (14 of which never forward anything) learned those clones' specific values, not "forwarding".
2. **Generator artifacts became shortcuts.** The demo generator overwrites the opening balance of scenario
   accounts: at least ₹60,000 for feeders, ₹150,000 for shells, ₹300,000 and ₹500,000 for the two victims, and ₹120 for the dormant mule.
   It also tops up any scenario sender short of funds. `initial_balance` was the model's 4th most important
   feature; for `ACC-000003` it lowered the score.
3. **Labels that describe behaviour the data doesn't contain.** The "dormant" mule `ACC-000032` has 60 ordinary
   transactions spread over the whole period, so `dormant_awakening_detected = 0`. The 10 structuring feeders
   and 4 cycle shells each made one or two scenario transfers on top of about 60 ordinary ones; at account
   level they look ordinary.
4. **Too few test positives to measure anything.** Six test positives (two of them mislabelled) give no stable
   estimate of recall or PR-AUC.

The model was doing what it was trained to do: separate 26 labelled accounts from 7,974 others using 26
aggregate features. The inputs carry the forwarding signal (`rapid_pass_through = 1` for all three accounts),
but the training set gave it almost no varied examples of that signal.

## 3. Dataset, label and leakage findings

Confirmed defects in the demo ledger (`backend/app/data/v2/generator.py`, which this audit does not change, so
that the demo ledger and the FS-2001 fixture stay reproducible):

| Finding | Evidence | Effect |
|---|---|---|
| Ordinary busy merchants labelled `cashout_terminal` (positive) | `merchant_ids[0..2]` get the label because one scenario transfer lands in them; they have ~190 ordinary purchases each | Inflated the old test result; label noise in training |
| One `cashout_terminal` has no `scenario_id` | Line 301 sets the label only | Split treats a positive as an ordinary account (it landed in training) |
| A held-out test account is shared with a training scenario | `ACC-000009` is the APP-001 (test) cash-out and the cash-out for all 10 DISPERSAL-003 (train) mules | Test/train topology contact |
| Opening balances overwritten for scenario accounts | Lines 207, 279, 321, 362, 390, 395, and the top-up rule at line 499 | Label-correlated artifact in `initial_balance` |
| "Dormant" account not dormant | Ordinary transactions continue throughout | Label contradicts the ledger |

Leakage checks that **passed**:

- `ground_truth_label`, `scenario_id`, `scenario_tag`, `is_suspicious_scenario`, PII and the rule score are
  not model inputs (`FEATURE_NAMES`; tested).
- The feature schema in the artifacts equals the serving builder's list and the booster's input order (tested).
- The feature builder has no fitted transformations (no scaler or encoder state), so there is nothing to fit
  on the wrong split.
- The PaySim benchmark has its own artifacts, features and data source and does not share inputs with the
  account model (tested).

Process issues fixed in the new pipeline: there was no validation split, the threshold was never selected on
data, and the test set was the only evaluation.

## 4. New evaluation data: the scenario bank

`ml/v2/scenario_bank.py` reuses the demo generator's accounts and ordinary activity and plants many randomised
scenario instances into a **separate** ledger (`data/v2_model_eval/v2_model_eval.db`, git-ignored, seed
20261029). The demo ledger is untouched.

| Kind | Families (instances) | Notes |
|---|---|---|
| Positive, seen | APP layering (60), fan-out dispersal (30), structuring (20), dormant awakening (40) | Randomised amounts, delays (3–60 min), 1–3 hops, 4–14 mules, feeder counts |
| Positive, **test only** | Cyclic round-tripping (15), slow layering (25) | Behaviour never seen in training; slow layering waits 2–10 hours, so the 30-minute forwarding flag does not fire |
| Hard negatives | Salary then rent within minutes (300), parent-to-student fees (150), dormant account reactivated by a payout (100, half moved on quickly), merchant settlement sweeps (60) | Legitimate behaviour that looks like forwarding |
| Victims | One per layering, dispersal and slow-layering instance | Negative |

**Label rule.** Positive means an account used to receive and pass on, cash out or structure scenario funds
(`mule_*`, `dormant_awakened_mule`, `shell_roundtripper`). Victims and hard negatives are negative. Cash
withdrawals go to three external sink accounts, which are excluded.

**Artifact safeguards (tested):**

- No positive account's opening balance is altered. Downstream amounts are computed from what an account
  actually received.
- Dormant accounts have no activity before they awaken.
- No account plays a role in two scenario instances. Payers and landlords come from a reserved pool.
- Mules are drawn from students and retail customers in their population proportions. An earlier draft drew
  mules from students at 40–60% (population: ~18%). That made "student" the second-strongest feature and
  inflated PR-AUC from 0.38 to 0.57. It was corrected before any result was used.

**Split.** Every account of a scenario instance shares one split (deterministic hash of the instance ID, seed
7). Seen families are split 60/20/20; the two unseen families are test-only. Ordinary accounts are split 60/20/20
by account.

| Split | Accounts | Positives | Negatives | Scenario instances |
|---|---|---|---|---|
| Train | 11,940 | 511 | 11,429 | 104 |
| Validation | 3,881 | 157 | 3,724 | 23 |
| Test (locked) | 4,179 | **260** | 3,919 | 63 |

Test positives by family: APP layering 20, dormant 9, fan-out 50, structuring 11, cyclic (unseen) 72, slow
layering (unseen) 98. The seen-family part of the test (90 positives from 24 instances) is still small;
per-family figures for dormant (9) and structuring (11) are anecdotal.

Prevalence is about 6%, far higher than real life, so precision here overstates precision at realistic rates
(see §6).

## 5. Model comparison on the locked test set

Each model's threshold was chosen on **validation** by maximising F2 (recall weighted twice precision, because
every flag goes to a person and nothing is automated). XGBoost settings were chosen among 12 candidates by
validation PR-AUC. The test set was scored once, after all choices were fixed. The 95% intervals come from a
bootstrap that resamples whole scenario instances.

Test: 260 positives, 3,919 negatives.

| Model | Threshold | Precision | Recall | F1 | PR-AUC (95% CI) | ROC-AUC | Confusion `[[TN, FP], [FN, TP]]` |
|---|---|---|---|---|---|---|---|
| **v2-account-2.0.0** (XGBoost, depth 6, 400 trees) | 0.175 | 0.326 | 0.535 | 0.405 | **0.377** (0.289–0.473) | 0.760 | `[[3632, 287], [121, 139]]` |
| Logistic regression (same features) | 0.621 | 0.279 | 0.569 | 0.375 | 0.312 (0.237–0.394) | 0.767 | `[[3537, 382], [112, 148]]` |
| v2-account-1.0.0 at validation threshold | 0.002 | 0.136 | 0.739 | 0.230 | 0.220 (0.148–0.301) | 0.766 | `[[2698, 1221], [68, 192]]` |
| v2-account-1.0.0 at its production 0.5 | 0.5 | 0.387 | 0.092 | 0.150 | 0.220 | 0.766 | `[[3881, 38], [236, 24]]` |
| Rule baseline | 45/100 | 0.119 | 0.285 | 0.168 | 0.103 (0.070–0.142) | 0.604 | `[[3370, 549], [186, 74]]` |

Recall by family (new model at 0.175): APP layering 70%, fan-out 34%, structuring 64%, dormant 100%; unseen
families: slow layering 59%, cyclic 47%. Seen-family PR-AUC 0.260; unseen-family PR-AUC 0.286.

False-flag rates among negatives (new model): ordinary accounts 5.7%, merchant sweeps 0%, victims 24%,
legitimate dormant reactivation 35%, salary-then-rent 48%, **student fee payments 74%**.

**Reading this.** The retrained model ranks accounts better than every alternative, and its PR-AUC interval
does not overlap the rule baseline's. Its interval only just separates from the old model's. Even so, about
two thirds of its flags are wrong and it misses about half of the suspicious accounts. Students forwarding a
parent's money to a school, and salaried people paying rent within minutes, look like mules at account level;
the 26 aggregate features do not include who the counterparties are.

## 6. External check on the app's own ledger

Not used for any choice. The 3 mislabelled `cashout_terminal` merchants are excluded; 29 positives and 9,968
negatives remain.

| | New model (threshold 0.175) | Old model at 0.5 |
|---|---|---|
| Positives flagged | 23 of 29 | 25 of 29, **but 25 of those 29 were in its training data** |
| Ordinary accounts flagged | 541 of 9,968 (5.4%) | 3 |
| Precision | 4.1% | not comparable (in-sample) |

FS-2001 accounts (live API, scores as shown in the app):

| Account | Role in case | Old model | New model | Rule score |
|---|---|---|---|---|
| ACC-000001 | Reporting customer | 76.5% (would be flagged) | 7.2%, low | 25 |
| ACC-000003 | First receiver | 10.1% | 71.3%, high | 60 |
| ACC-000005 | Passed money on | 12.6% | 38.2%, elevated | 60 |
| ACC-000002 | Passed money on | 15.4% | 18.2%, elevated (just above the 17.5% threshold) | 60 |
| ACC-000009 / ACC-000012 | Busy merchants (mislabelled) | 65.8% / 77.4% | 0.0% / 0.0% | 40 / 75 |

These were not tuning targets; four accounts are an illustration, not evidence.

## 7. What changed in the product

- The backend serves `ml/artifacts/v2/account_model_v2/`. The threshold (0.1752) is read from the artifact's
  metadata. `predicted_class` and the risk level are anchored to it: below the threshold is "low"; from the
  threshold to 50% is "elevated"; 50–80% "high"; 80%+ "very high".
- The model status endpoint adds `decision_threshold`, `score_semantics` and `operational_notes` (the
  demo-ledger false-alarm rate).
- The Accounts & risk panel and Tools → Model performance now show the served threshold, test counts and
  demo-ledger false-alarm rate instead of hardcoded figures.
- Rule results, model results, recorded transfers, the PaySim benchmark and human decisions remain separate in
  the UI.

## 8. Claims the product can and cannot make

Can say:

- The account model ranks synthetic suspicious accounts above ordinary ones better than the rules or the
  previous model, on a held-out test of 260 suspicious accounts from 63 scenario instances, including two
  behaviour families it never trained on.
- A score at or above 18% means "suggested for review", nothing more.

Must not say:

- That scores are probabilities of fraud. They are uncalibrated scores learned from synthetic labels (test
  Brier score 0.049).
- That the model finds most suspicious accounts. It catches about half on the synthetic test.
- That a flag is likely correct. On the app's own ledger about 1 flag in 25 was a planted scenario account.
- That a low score clears an account.
- Anything about corporate accounts. No scenario in either generator involves a corporate account, so the
  model treats being corporate as a strong sign of normality (its top feature). That is an artifact of the
  synthetic data.
- Anything about real banks. All of this is synthetic data, designed to stress the model.

## 9. The PaySim benchmark

Unchanged and separate: a transaction-level model on a public mobile-money simulation (`ml/artifacts/v2/paysim_benchmark/`).
Its near-perfect scores describe that simulation only and are never applied to cases or used as evidence about
the account model.

## 10. Open issues

- Seen-family test positives (90) and per-family counts (dormant 9, structuring 11) remain small.
- Prevalence in the scenario bank (~6%) is unrealistic, so precision there is optimistic.
- Account-level aggregate features cannot tell who the counterparties are. That is the main reason legitimate
  fee and rent payments are confused with mule forwarding. Counterparty or graph features would be the next
  step, but that is new modelling work and was not done here.
- The demo-generator label defects in §3 remain in the demo ledger (left as is so the demo ledger and FS-2001
  stay reproducible). They no longer influence training.
- The new model binary is git-ignored like all model binaries; a fresh clone must run the two commands above.
