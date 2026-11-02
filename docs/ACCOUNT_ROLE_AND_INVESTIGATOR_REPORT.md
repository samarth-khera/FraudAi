# Account-role correction and investigator report (2026-11-02)

**Verdict: FIXED AND VERIFIED** (see section 13 for the conditions behind it and section 12 for what remains open).

Code commit `8ff6c22` on branch `fix/account-role-investigator-report`. It reached `v2-rebuild` (Render backend) by
fast-forward and `main` (Vercel frontend) through PR #27, which the owner merged, followed by `98f9e4f` (a retry for
dropped connections) by fast-forward. Everything here is synthetic data; nothing describes a real person.

## 1. Summary

- **The defect was real and systemic, not two odd outputs.** Investigating `FS-EAAA344C` directly returned
  "Potential victim" in production. The same account, reached from its victim's investigation, was a "Potential
  intermediary". On the training ledger, 48.5% of intermediaries and 37.6% of attacker-controlled accounts
  investigated directly were given a victim-class role.
- **Cause: one rule in the role engine, not the models.** Both models flagged the account correctly. The
  investigated-account rules check victim evidence first, and they counted a flagged transfer as "the account's own
  money" whenever its earlier balance *could* have paid it. An account holding savings that passed on money it had
  just received was therefore read as losing its own money.
- **Fix:** a flagged transfer is no longer counted as the account's own money when the records show it passed on
  money just received from a new payer while its own earlier balance stayed intact. Existing thresholds only; no
  account IDs; no ground truth in production code; no model change.
- **Result on an untouched hold-out ledger (seed 606, evaluated once, old code measured on the same ledger):**
  intermediaries investigated directly and called victims fell from 46.3% to 13.8%, attacker-controlled accounts
  from 30.2% to 9.3%. No victim, look-alike, innocent counterparty or ordinary account was moved towards suspicion.
  In the 461-investigation measurement none of them changed at all. In the separate standard evaluation one ordinary
  account moved from "potential victim" to "insufficient evidence" (an abstention, section 12).
- **Investigator report:** every dynamic investigation now ends with a deterministic, evidence-grounded report (no
  language model). It has an executive summary, risk assessment, chronology, fund flow, a connected-account table,
  per-account recommendations (levels 1 to 4) and findings. It states: "Recommendation only. No account
  restriction, freeze or hold has been executed. Authorized institutional approval and applicable procedures are
  required."

## 2. The two accounts: what the ledger shows

Ground truth below was read **offline only**, from the evaluation columns of the served forensic ledger
(`data/v3_forensic_scenarios.db`, generator seed 303). No production code reads these columns; a test scrambles them
and checks that every output, including the report, is identical.

| Account | Scenario truth (offline) | Scenario | Expected by the owner | Matches? |
|---|---|---|---|---|
| `FS-7B7C13AB` | `victim` | SC-SPLIT-0025 | Victim / potential victim | Yes |
| `FS-EAAA344C` | `intermediary` | SC-SPLIT-0025 | Fraud-related / attacker-controlled | **Partly: see below** |

**The discrepancy, stated exactly.** The generator labels `FS-EAAA344C` an **intermediary** (the account that
received the victim's money and passed most of it on), not `attacker_controlled` (the generator's term for a
collection or cash-out end point). Both are fraud-related scenario roles, and both are the positive class of the
account behaviour model. The engine's matching candidate role is **potential intermediary**, which is what it now
returns. It is not labelled "potentially suspicious account" (the collection or cash-out role), because the records
do not show it collecting from several victims or withdrawing cash. Its recipients did that. No label was hardcoded
or relabelled.

The scenario's transfers (evaluation view):

| Time (18 Feb 2026) | From | To | Amount | Channel | Scenario tag |
|---|---|---|---|---|---|
| 20:11 | FS-7B7C13AB | FS-EAAA344C | 52,000.00 | UPI | victim_transfer |
| 20:49 | FS-EAAA344C | FS-CE13E4F4 | 41,621.41 | UPI | forward |
| 20:54 | FS-EAAA344C | FS-5635F5AF | 3,500.00 | UPI | forward |
| 22:07 | FS-5635F5AF | FS-E916C859 (cash network) | 1,500.00 | ATM cash | cash_out |
| 22:12 | FS-CE13E4F4 | FS-7C40406F (cash network) | 18,700.00 | ATM cash | cash_out |
| 23:39 | FS-EAAA344C | FS-D466702E | 3,500.00 | Card | flow_incidental (innocent counterparty) |

**`FS-EAAA344C`'s complete history** (from the ledger, as the engine sees it):

- **Volume:** 45 transfers (38 out, 7 in) from 2 Jan to 31 Mar 2026; account opened 2021.
- **Earlier pattern:** before the scenario its largest outgoing transfer was 12,800. Its balance had grown from
  22,022 to 50,336 through ordinary income (a 54,500 NEFT credit on 1 Feb, a 12,500 payment on 16 Feb and smaller
  transfers; a second 54,500 credit from the same payer followed on 1 Mar).
- **The scenario day:** 52,000 arrived from a payer that had never paid it. Within 43 minutes 45,121 (86.8%) left to
  two accounts it had never paid; both then withdrew cash. Its balance never fell below the 50,336 it held before the
  52,000 arrived (60,715 after the first transfer, 57,215 after the second).
- **Models:** the transaction model flags both outgoing transfers (calibrated 92.6% and 91.4% against a 0.13%
  threshold). The account behaviour model scores the account at 96.9% against a 5.2% threshold. Its factors: 48% of
  money received was sent on within 24 h, 59% came from one sender, 24% was sent on within 1 h.

**`FS-7B7C13AB`**:

- **The scam transfer:** 41 transfers on record. The flagged 52,000 took 69% of its 75,023 balance, went to an
  account it had never paid, and was over ten times its largest earlier transfer (5,000).
- **No inflow behind it:** nothing arrived in the 24 h before, so its own money left.
- **Model output:** the account behaviour model scores this victim at 8.9%, above its 5.2% threshold, a known false
  positive pattern for victims (section 7).

## 3. Reproduction (before the fix)

Production API, 2 Nov 2026, release code `072e4e5` (read-only requests, the same the UI sends):

| Investigation | Result for the investigated account | How it saw the other account |
|---|---|---|
| `FS-7B7C13AB` | Potential victim (urgent protective review) | `FS-EAAA344C`: **potential intermediary** (downstream hop 1, urgent manual review) |
| `FS-EAAA344C` | **Potential victim** ("Sent 2 flagged transfer(s) that were not funded by money it had just received") | `FS-7B7C13AB`: potential victim (upstream hop 1) |

The same account got the opposite role depending on whether it was the investigation root. Screenshot:
`docs/screenshots/account-role-2026-11-02/before-production/before-production-FS-EAAA344C-overview.jpg`.

## 4. Root cause

The three components were checked separately:

| Component | Version | What it said about `FS-EAAA344C` | Responsible? |
|---|---|---|---|
| Model A, transaction XGBoost | `v3-transaction-1.0.0` (38 point-in-time features) | Both outgoing transfers flagged (92.6%, 91.4%) | No |
| Model B, account behaviour XGBoost | `v3-account-1.0.0` (positive class: intermediary + attacker-controlled) | 96.9%, well above its 5.2% threshold, on pass-through factors | No |
| Rule-based role engine | `roles.py` + `engine._unfunded` | Potential victim | **Yes** |

**The rule.** For the investigated account, `roles._assess` checks victim evidence first: if at least half of its
flagged outgoing transfers were "not funded" (its own money) and they differ from its history, the account is a
potential victim, whatever else is true. `engine._unfunded` decided "funded" only when fresh inflows covered at least
70% of the transfer **and** the account's earlier balance could **not** have covered 70% of it. `FS-EAAA344C` held
50,336, enough to pay 41,621, so both forwards counted as its own money. The account-model score and the forwarding
were never weighed against it, because the victim branch returns first.

**Which of the listed causes applied:**

| Candidate cause | Finding |
|---|---|
| Protective-victim rules overriding stronger suspicious-account evidence | **Yes**, through the own-money test above |
| Root versus connected interpretation | **Yes**: the connected-account rules measure onward movement and the model flag on its onward transfers, so the same account came out as an intermediary there |
| Incorrect model features, threshold or calibration | No: both models flagged the account |
| Inadequate training examples | No evidence of it; the model scores are correct here |
| Incorrect account-role mapping | No |
| Insufficient transaction history | No: 45 transfers over 88 days |

**Why earlier evaluations missed it.** `evaluate_investigations.py` and the hold-out protocol start investigations
only from victims, look-alikes and ordinary accounts. The QA-03 measurement sampled intermediaries as roots, but
analysed only the opposite error (intermediary labels on non-intermediaries). Nothing measured scenario
intermediaries investigated directly. A new measurement, `ml/forensics/root_role_measurement.py`, now starts an
investigation from every scenario account and compares the two views of each account.

## 5. The fix

### 5.1 Role engine (`backend/app/intelligence/engine.py`, `_unfunded`)

A flagged outgoing transfer is **not** counted as the account's own money (victim evidence) when money from payers
that had not paid it at least 7 days earlier, received in the 24 h before, covers at least 70% of it, and either:

1. its earlier balance could not have covered 70% of it (the existing "funded forwarding" case, unchanged); or
2. it **passed that money on**, which needs all three of:
   - that money, not already used by its earlier flagged transfers, still covered ≥ 70% of the transfer;
   - its own earlier money was not drawn on: its balance just after the transfer is less than 2,000
     (`OWN_FUNDS_MIN`) below its balance just before that money arrived;
   - most of that money left again: within 24 h of the first such inflow its outgoing transfers (capped at the amount
     received) reached ≥ 70% of it (`INTERMEDIARY_SHARE`, as in ONWARD), or its cash withdrawals ≥ 50% (`CASH_SHARE`,
     as in CASH).

Such a transfer is reported as FUNDED_FORWARD with its own sentence: "…covered by money received in the previous 24 h
from payers that had not paid it before, and its own earlier balance was not drawn down to pay them…". The
investigated-account rules are otherwise unchanged. In particular, FUNDED_FORWARD alone still abstains (QA-03): a role
needs a second independent kind of evidence. For `FS-EAAA344C` that second kind is the account behaviour model.

**No new threshold.** 70% is `INTERMEDIARY_SHARE`, 50% is `CASH_SHARE`, 2,000 is `OWN_FUNDS_MIN`, 24 h is
`ONWARD_HOURS`, 7 days is `RECURRING_PAYER_DAYS`. No account ID, scenario name or ground-truth column is used. A test
scans all application code for account or scenario identifiers, and another runs the rule on synthetic records with
neutral IDs.

**How the rule was designed (training ledger, seed 101, only).** Each version was measured on all 1,462 roots of the
training ledger:

| Version | Intermediaries called victim | Attacker-controlled called victim | Legitimate accounts called intermediary |
|---|---|---|---|
| Before | 48.5% | 37.6% | 0 |
| v1: covered by new money, own balance intact | 6.2% | 1.1% | **4** (3 look-alikes, 1 innocent counterparty: a 1,000–10,000 payment after a family-pool payment) |
| v2: + ≥ 70% of the new money left in flagged transfers | 18.6% | 21.0% | 0 |
| v3: + any outgoing transfer, or ≥ 50% as cash, counts as leaving (probe of 540 covered transfers) | not run end to end | not run end to end | 0 in the probe |
| v4 (released): v3 with the own-balance tolerance set to `OWN_FUNDS_MIN` | **12.9%** | **11.1%** | **0** |

v1 to v3 allowed the own balance to fall by up to 30% of the transfer. An existing regression test failed on v3: a
victim whose own savings fell by 13,478 after a same-day salary from a new payer. So v4 uses the engine's existing
measure of a material own-funds loss (2,000). The hold-out ledger was generated only after v4 was frozen.

### 5.2 Evidence for and against each role (`roles.py`, display only)

- **Each evidence item carries a `side` field:** `victim` (its own money left), `suspicion` (passing money on or
  collecting it) or `context` (what it received, how new its records are).
- **Evidence pointing away from the role is listed under contradictory evidence**, as "Points the other way (model
  output | recorded fact): …". For a victim-class role that is any suspicion-side signal, e.g. the account model above
  threshold. For an intermediary or suspicious-account role it is victim-side observations (its own money paid flagged
  transfers, its own savings fell).
- **"Established records" is no longer listed against a victim-class role.** An established history is what makes a
  deviation meaningful, and the victim rules require it.
- **No role, evidence strength or restriction state reads any of this.**

### 5.3 What did not change

- **Models:** neither model, threshold nor calibration changed.
- **Engine:** the trace, the connected-account rules and the restriction thresholds are unchanged.
- **Contract:** the API is backward compatible. `investigator_report` and `EvidenceItem.side` are new optional fields;
  older clients ignore them, and the new UI handles their absence.
- **Data:** no database, migration or dataset generation change. `GEMINI_ANALYST_ENABLED` stays `false` and
  `GEMINI_ANALYST_PRODUCTION_APPROVED` stays unset.

## 6. Evaluation

Ground truth is read only by the evaluators (`ml/forensics/root_role_measurement.py`, `evaluate_investigations.py`).
Every scenario account is used as an investigation root, plus 150 ordinary accounts and 10 accounts with 1–4
transfers.

### 6.1 Training ledger (seed 101): where the rule was designed

| Investigated account (ground truth, evaluation only) | Before | After |
|---|---|---|
| Victims assessed as victim-class | 329 / 337 (97.6%) | 329 / 337 (97.6%) |
| Victims assessed as intermediary / suspicious | 0 / 337 | 0 / 337 |
| Intermediaries assessed as victim-class | 264 / 544 (48.5%) | **70 / 544 (12.9%)** |
| Intermediaries assessed as intermediary / suspicious | 240 / 544 (44.1%) | **423 / 544 (77.8%)** |
| Attacker-controlled assessed as victim-class | 68 / 181 (37.6%) | **20 / 181 (11.1%)** |
| Attacker-controlled assessed as intermediary / suspicious | 103 / 181 (56.9%) | **150 / 181 (82.9%)** |
| Secondary victims assessed as intermediary / suspicious | 2 / 24 | 2 / 24 |
| Look-alikes / innocent counterparties / ordinary (sample) assessed as intermediary / suspicious | 0 / 58, 0 / 158, 0 / 150 | 0 / 58, 0 / 158, 0 / 150 |
| Low-history accounts that abstain | 10 / 10 | 10 / 10 |
| Accounts victim-class in one view and suspicion-class in the other | 142 | **19** |
| Intermediaries reached as connected accounts and given a victim-class role | 292 of 2,128 | **48 of 2,128** |
| Restriction review for any victim, innocent, look-alike or ordinary root | 0 | 0 |

### 6.2 Untouched hold-out (seed 606): evaluated once, after the code was frozen

`ml/forensics/holdout_evaluation.py --ledger holdout_2026_11_roles --roots` fingerprints the inference code, model
artifacts, generator and evaluators (manifest `c841060a743ec2bd`, 20 files). It refuses to re-run on changed code;
the committed code still matches the manifest. Seed 606 was never used for design, tuning or thresholds. The old
production code was measured on the same ledger afterwards as a baseline (`*_before.json`).

| Investigated account (ground truth, evaluation only) | Old production code | New code |
|---|---|---|
| Victims assessed as victim-class | 75 / 82 (91.5%) | 75 / 82 (91.5%) |
| Victims assessed as intermediary / suspicious | 1 / 82 | 1 / 82 (the same account, see section 12) |
| Intermediaries assessed as victim-class | 57 / 123 (46.3%) | **17 / 123 (13.8%)** |
| Intermediaries assessed as intermediary / suspicious | 43 / 123 (35.0%) | **72 / 123 (58.5%)** |
| Attacker-controlled assessed as victim-class | 13 / 43 (30.2%) | **4 / 43 (9.3%)** |
| Attacker-controlled assessed as intermediary / suspicious | 22 / 43 (51.2%) | **30 / 43 (69.8%)** |
| Secondary victims assessed as intermediary / suspicious | 1 / 7 | 1 / 7 (the same account) |
| Look-alikes / innocent counterparties / ordinary (sample) assessed as intermediary / suspicious | 0 / 10, 0 / 36, 0 / 150 | 0 / 10, 0 / 36, 0 / 150 |
| Low-history accounts that abstain | 10 / 10 | 10 / 10 |
| Accounts victim-class in one view and suspicion-class in the other | 23 | **2** |
| Intermediaries reached as connected accounts and given a victim-class role | 64 of 545 | **16 of 545** |
| Restriction review for any victim, innocent, look-alike or ordinary root | 0 | 0 |
| Innocent counterparties reached as connected accounts and called intermediary / suspicious | 0 of 75 | 0 of 75 |

**Account by account.** 51 of 461 roots changed role.

- **50 were intermediaries or attacker-controlled accounts:**
  - 37 moved from a victim-class role to potential intermediary;
  - 12 moved to role unknown (abstention, one kind of evidence);
  - 1 moved from potential victim to "suspicious activity, victim status unconfirmed".
- **The 51st** is secondary victim `FS-9870CD3B`, which moved from potential victim to role unknown (section 12).
- **No victim, look-alike, innocent counterparty or ordinary root changed.**

The standard hold-out evaluation (`evaluate_investigations`: 127 investigations of victims, look-alikes, a different
sample of 60 ordinary accounts and one low-history account) is identical under old and new code in every safety count
and every connected-account role. One case differs: ordinary account `FS-99D50ADC` moved from "potential victim"
(urgent protective review) to "insufficient evidence" (role unknown, report level 2 enhanced verification). Its one
flagged payment passed on money it had just received. The code commit's message ("unchanged account by account")
refers to the 461-root measurement; this exception is the precise statement.

**False positives and false negatives by role on the hold-out, new code** (roots; "suspicion" = potential
intermediary or potentially suspicious account):

| Truth | Victim-class | Suspicion | Unknown | No activity |
|---|---|---|---|---|
| Victim (82) | 75 | 1 | 2 | 4 |
| Secondary victim (7) | 5 | 1 | 1 | 0 |
| Intermediary (123) | 17 | 72 | 30 | 4 |
| Attacker-controlled (43) | 4 | 30 | 7 | 2 |
| Innocent counterparty (36) | 4 | 0 | 3 | 29 |
| Look-alike (10) | 0 | 0 | 6 | 4 |
| Ordinary sample (150) | 5 | 0 | 22 | 123 |

### 6.3 Served ledger (seed 303): what production investigates

**Not a hold-out:** the two target accounts come from it, and earlier rule work used its accounts as examples. It shows
what changes for users of the live product. Every scenario account was investigated with the old production code and
with the new code (`ml/reports/root_role_measurement_demo_served_before.json`, `..._after.json`):

| Investigated account (ground truth, evaluation only) | Old production code | New code |
|---|---|---|
| Victims assessed as victim-class | 57 / 61 (93.4%) | 57 / 61 (93.4%) |
| Victims assessed as intermediary / suspicious | 0 / 61 | 0 / 61 |
| Intermediaries assessed as victim-class | 59 / 118 (50.0%) | **11 / 118 (9.3%)** |
| Intermediaries assessed as intermediary / suspicious | 42 / 118 (35.6%) | **77 / 118 (65.2%)** |
| Attacker-controlled assessed as victim-class | 15 / 34 (44.1%) | **6 / 34 (17.6%)** |
| Attacker-controlled assessed as intermediary / suspicious | 12 / 34 (35.3%) | **18 / 34 (52.9%)** |
| Secondary victims / look-alikes / innocent counterparties / ordinary (sample) assessed as intermediary / suspicious | 0 / 4, 0 / 10, 0 / 30, 0 / 150 | 0 / 4, 0 / 10, 0 / 30, 0 / 150 |
| Accounts victim-class in one view and suspicion-class in the other | 33 | **4** |
| Safety counts (restriction reviews, innocent counterparties called suspicious) | identical | identical |

58 of 417 roots changed. 57 were intermediaries or attacker-controlled accounts moving away from a victim-class role
(to potential intermediary or role unknown). One innocent counterparty moved from "potential victim" to "role unknown"
(an abstention).

## 7. Models: why nothing was retrained or promoted

- **No model change was needed.** For this defect both models were right and the role engine overrode them.
  Retraining would not have changed the investigated-account victim branch.
- **The account model is not a victim-versus-fraud classifier.** Its positive class is intermediary + attacker-
  controlled behaviour. It flags some victims too (`FS-7B7C13AB` at 8.9% against 5.2%), presumably because one large
  outflow resembles pass-through. The report now lists such a score as evidence pointing the other way, never as
  support for a victim role.
- **The challenger `v3-account-1.1.0` was reviewed and not promoted.** Its stored champion/challenger analysis
  (`ml/reports/account_model_champion_challenger.json`) shows a higher ledger-end false-positive rate than the
  champion: 11.6% vs 9.4% on the cold ledger, and 11.6% vs 8.5% on validation. The main cause is an isotonic
  calibration plateau at its threshold. It would not have changed this defect either. Promotion stays the owner's
  decision (docs/DYNAMIC_INTELLIGENCE.md §7.4); no accuracy claim is made from two accounts.

## 8. Investigator report

### 8.1 What it is

`backend/app/intelligence/report.py` builds `investigator_report` inside every dynamic investigation. It is fixed
code, not a language model, and it says so (`generator.language_model_used: false`). It works with the AI analyst
disabled; a test replaces the AI analyst with one that fails if called. It copies roles, evidence and restriction
states from the role engine and assigns nothing itself, except the review level below. It holds no wall-clock values,
so `investigation_digest` covers it.

| Section | Contents |
|---|---|
| Executive summary | Account, dataset, time computed (from the response), records as of; candidate role; review level; which reading the evidence favours (victim / intermediary / suspicious account / none / undetermined); main reasons with their source; uncertainty and limitations |
| Account risk assessment | Transaction model, account model and fixed rules in separate panels (versions, thresholds, flagged transfers, factors); model support state for the dataset; evidence strength; evidence pointing to a victim vs evidence of passing money on or collecting it; context only; contradictory evidence; innocent explanations; missing information; "A model score … is not the probability that anyone committed fraud" |
| Transaction chronology | The investigated account's flagged and traced transfers plus 24 h of context: time, direction, counterparty, amount, its balance before and after, and why each is listed (model flag with score and threshold, rule flag, own money vs money just received, traced branch) |
| Fund flow | Where the money came from, first recipients, every hop's transfers, amount and accounts, every branch and its ending, cash withdrawals, convergence and loops, open ends, and per-recipient balance-based attribution (received, moved on as a range, kept at least, cash). Hop amounts are never added together |
| Connected accounts | One row per account: candidate role; its role **in this flow** apart from its **own behaviour** (account model, its own flagged transfers); evidence with source; review priority and recommended action |
| Recommendations | One per account: level, action, reason, supporting and contradictory evidence, innocent explanation, what to verify before any action, who decides, the engine's restriction state, "Nothing has been executed" |
| Findings | Supported by recorded evidence; supported only by model output; still unknown; accounts for urgent review, protective verification and enhanced verification; records an authorized investigator should obtain |
| Safeguards | Fixed statements (section 8.3) |

### 8.2 Review levels

Each level is a fixed mapping of the role engine's restriction state:

| Level | When | Who decides |
|---|---|---|
| 1 Routine review | No suspicious linkage or activity; cash points; unknown role with no independent evidence | Routine monitoring |
| 2 Enhanced verification | Unknown role with ≥ 1 independent kind of evidence; additional verification; **any account whose only support is model output** | A fraud analyst at the account-holding institution |
| 3 Urgent manual investigation | Urgent manual review for an intermediary or suspicious-account candidate, with at least one recorded fact | The fraud investigation lead at the institution |
| 4 Consider temporary restriction under institutional policy | The engine's `consider_temporary_restriction_review` (≥ 3 independent kinds, or 2 with traced funds possibly still held), with at least one recorded fact | An authorized decision-maker at the institution, under its policy and applicable law. FraudShield cannot place a hold |
| Protective verification (level 2 or 3) | Any account that may itself be a victim | The holder's institution, with the holder contacted through a verified channel. Never level 4, never a penalty |

### 8.3 Restriction safeguards

- **Nothing is ever executed.** No API route can freeze, hold, block, restrict or suspend anything (a test enumerates
  the routes). `automatic_actions_taken` is always empty, every restriction state carries
  `automatic_action_taken: false`, and every recommendation carries `action_executed: false`.
- **A model score alone never raises an account above level 2** (`model_only: true`). Levels 3 and 4 need a recorded
  fact.
- **Receiving money is never evidence of a role.** Each recipient is assessed on its own records; on the
  `FS-EAAA344C` investigation the 17 connected accounts get levels 3, 2 and 1, not one verdict.
- **A possible victim gets protective verification only.**
- **The report never claims a hold was placed.** A test scans it for executed-action wording, and the notice is
  fixed.

### 8.4 UI

- **Final stage:** "Investigator report" is the seventh stage of `/investigate`, shown when the server provides the
  report.
- **Print:** "Print report" prints exactly the rendered report; the sidebar, top bar, case header, stage tabs and
  footer are hidden in print. No other export is offered.
- **Overview:** an intermediary or suspicious-account root is named by its role ("Potential intermediary"), and each
  evidence line carries its source tag.
- **Affected accounts and the inspector:** each evidence item says which way it points.
- **AI analyst:** stays a separate, visibly disabled stage in production.

Screenshots: `docs/screenshots/account-role-2026-11-02/local-release/` (notice, summary, risk, chronology, fund flow,
connected accounts, recommendations, findings and safeguards at 1440 px; victim views; 390 px views; print view).

## 9. Automated tests

| Suite | Result |
|---|---|
| Backend (`backend/tests`) | **601 passed** (582 before + 19 new in `test_account_role_investigator_report.py`) |
| ML (`ml/tests`) | **90 passed** |
| Frontend (Vitest) | **190 passed** (182 before + 7 report and overview tests + 1 retry test from `98f9e4f`) |
| TypeScript (`tsc -p tsconfig.app.json`) | 0 errors |
| Lint (oxlint) | 0 errors, 145 warnings (unchanged from the previous release) |
| Render build check (`render_build.sh` startup block, run locally) | Passed |
| Render build on deploy (its pytest subset and startup check) | Passed (deploy `dep-dbk5qn15efls73emef4g` went live) |

The 18 required regression checks map to these backend tests (frontend tests cover the UI side):

| # | Requirement | Test |
|---|---|---|
| 1 | FS-7B7C13AB victim, confirmed by offline truth | `test_known_victim_is_assessed_as_a_potential_victim` |
| 2 | FS-EAAA344C fraud-related, confirmed by offline truth | `test_known_intermediary_is_not_presented_as_a_victim` |
| 3 | Both investigated individually | the two above |
| 4 | Both as connected accounts | `test_each_account_appears_as_a_connected_account_of_the_other` |
| 5 | Root and connected views consistent | `test_root_and_connected_views_agree_for_both_accounts` |
| 6 | Innocent counterparties protected | `test_innocent_counterparty_stays_protected` (+ the existing served-ledger safety test) |
| 7 | Low history abstains | `test_low_history_account_abstains` |
| 8 | Unsupported dataset stays reference-only | `test_models_stay_reference_only_on_an_unsupported_dataset` |
| 9 | No ground-truth leakage | `test_scrambled_ground_truth_changes_nothing` (+ existing source scan) |
| 10 | No ID-based exceptions | `test_no_account_id_or_scenario_name_appears_in_inference_code`, `test_the_rule_works_on_records_without_those_ids` |
| 11 | Independent recommendations for recipients | `test_downstream_recipients_get_independent_recommendations` |
| 12 | Nothing rests on a model score alone | `test_a_model_score_alone_never_raises_a_level_above_two`, `test_no_recommendation_rests_on_model_output_alone` |
| 13 | No automatic hold or freeze | `test_nothing_is_ever_executed` |
| 14 | Report matches the API response | `test_report_sections_match_the_api_response` |
| 15 | Attribution without double counting | `test_amounts_are_attributed_per_hop_and_never_added_across_hops` |
| 16 | Safe with Gemini disabled | `test_report_is_built_with_the_ai_analyst_disabled` |
| 17 | Missing data and contradictions shown | `test_missing_data_and_contradictory_evidence_are_shown` |
| 18 | Never claims a hold was executed | `test_report_never_claims_a_hold_was_executed` |

## 10. Chrome verification

### 10.1 Production-equivalent local release

- **Setup:** the minified build (`npm run build`, served by `vite preview` on :4173) against the release backend on
  :8000. The backend ran with `ENVIRONMENT=production`, writes disabled, Gemini off, and outbound requests blocked by a
  dead proxy, on scratch copies of the ledgers.
- **Browser:** a visible (non-headless) Google Chrome window driven by `role_journeys.cjs`.
- **Result: 63 of 63 checks passed**, with 0 console errors, 0 failed requests and 5 real investigation calls, all
  200 (`docs/screenshots/account-role-2026-11-02/local-release/local-chrome-journeys.json`).

| Journey | What was checked |
|---|---|
| A, victim (`FS-7B7C13AB`) | Potential victim, the victim question, its own evidence (no model output as victim support); report notice exact; leaning "victim"; protective level 3; `FS-EAAA344C` seen from it as potential intermediary level 3; protective recommendation decided with the holder |
| B, suspected attacker (`FS-EAAA344C`) | Account brief shows its 45-transfer history; potential intermediary, never a victim phrase; evidence tagged by source; fund trail shows both first recipients; risk evidence renders; chronology (52,000 in, 41,621 and 3,500 out) with reasons; hop 1 = 45,121 to two recipients; models and rules shown apart; no victim-side evidence |
| C, connected accounts | All 15 non-cash connected accounts opened one by one in the inspector, each matching the report's role; levels 3, 2 and 1 present; `FS-CE13E4F4` investigated directly gets its own assessment |
| D, final report | All seven sections; every recommendation names who decides and says nothing was executed; no control that could act on an account; no executed-hold wording; "No language model wrote it"; print calls the browser print, sets and clears the print class; print view hides sidebar and tabs; arrow keys move between stages; back and forward |
| Small screen | 390 × 844 with reduced motion: overview and report without page-level overflow, notice visible, fund trail in outline form |

### 10.2 Production

**API, after the backend release** (Render deploy `dep-dbk5qn15efls73emef4g`, commit `8ff6c22`):

| Investigation | Investigated account | The other account, seen from it | Report |
|---|---|---|---|
| `FS-7B7C13AB` | Potential victim, urgent protective review | `FS-EAAA344C`: potential intermediary, urgent manual review | Level 3: Urgent protective verification |
| `FS-EAAA344C` | **Potential intermediary** (ACCOUNT_MODEL + FUNDED_FORWARD), urgent manual review | `FS-7B7C13AB`: potential victim | Level 3: Urgent manual investigation |

Further checks on the live API:

- **AI analyst:** `disabled` in both responses.
- **Automatic actions:** `automatic_actions_taken` is empty.
- **Report:** `language_model_used: false`, and the notice is exact.
- **Digests:** production's `investigation_digest` equals the local release's for both accounts (`a3e19f7be7215702ce19c4f6`,
  `e9676b9ebedae90bf6689ece`). The digest covers every deterministic section, the report included, so the live
  output is byte for byte what was verified locally.

**Frontend:**

- **Bundle:** the live bundle `index-DN45fCpw.js` is the file a local build with
  `VITE_API_URL=https://fraudshield-api-rpok.onrender.com` produces.
- **Security headers:** all six (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy) are still served.

**Chrome against https://fraudshield-ai-psi.vercel.app** (visible window, same script as 10.1):

- **Run 1: 56 of 56 checks that ran passed, then the run stopped.** At the 390 px step the investigation request for
  `FS-EAAA344C` received its headers and then lost the connection (`net::ERR_CONNECTION_CLOSED`). That is the free
  host's known behaviour (about 1 in 30–60 requests in the previous release's measurements), and reads already retried
  for it. The page showed "The server could not be reached … try again shortly" with the start button still
  available. The compressed response is about 30 KB (the report added about 32% to the uncompressed size). Two
  further direct requests completed normally; one drop does not show that the size caused it.
- **Run 2: 63 of 63 checks passed**, with 0 console errors, 0 failed requests and 19 API responses
  (`docs/screenshots/account-role-2026-11-02/production/production-chrome-journeys-run2.json`).
- **Follow-up:** the investigation request is read-only on the server, so commit `98f9e4f` retries it once on a
  dropped connection, as reads are; HTTP errors and a second drop still show the error.
- **Run 3, on the final build** (Vercel `5zoXAoF8xhr2pBCpR63mfeurEdKX`; live bundle `index-DkDR0ihu.js`, identical to
  the local production build): **63 of 63 checks passed**, with 0 console errors and 0 failed requests. All five live
  investigation calls answered 200 (`production/production-chrome-journeys-run3-final-build.json`). The production
  screenshots in `docs/screenshots/account-role-2026-11-02/production/` are from this run.

## 11. Release

| Step | Result |
|---|---|
| Branch | `fix/account-role-investigator-report` from `main` `71e5901` |
| Code commit | `8ff6c22`. Author and committer `Samarth Khera <188962529+samarth-khera@users.noreply.github.com>`; GitHub shows `samarth-khera` for both; no AI attribution |
| Vercel previews | Built successfully: `7Vfhxm5mkCxtzGFTv8UCXJbrCRNE` (branch) and `Ckkk6JmVp52N981Y9LGZyJiH6rDS` (`v2-rebuild` push). As before, previews need a Vercel login and the API accepts only the production origin, so the identical build was verified locally (10.1) |
| Backend | `v2-rebuild` fast-forwarded `072e4e5` → `8ff6c22` (no force). Render deploy `dep-dbk5qn15efls73emef4g` built, ran its test subset and startup check, and went live at 09:56:23 UTC. Previous deploy `dep-dbk098mq1p3s73b8q840` is the rollback target |
| Frontend | The owner opened and merged PR #27 at 09:52:33 UTC, creating merge commit `1d5dc06`, whose tree is identical to `8ff6c22`. Vercel production deployment `7JFk5hG8zn7VooPcQo6qMSsDk25u` was live at 09:53:21 UTC, about 3 minutes before the backend. The frontend was safe on the old backend: the report stage appears only when the server sends a report, and the overview falls back to the older fields |
| Follow-up | `98f9e4f` (retry the read-only investigation once on a dropped connection; frontend only), `main` fast-forwarded `1d5dc06` → `98f9e4f`; `v2-rebuild` stays at `8ff6c22` |
| Report | This document, its screenshots and the served-ledger measurements, committed after the production checks; `main` fast-forwarded to it (the frontend bundle is unchanged by a docs commit) |
| Unchanged | Render configuration and environment (`GEMINI_ANALYST_ENABLED=false`, `GEMINI_ANALYST_PRODUCTION_APPROVED` unset); production data; no paid service; `docs/screenshots/deploy-live/` (untracked, untouched); no force push |

## 12. Known limitations

- **One victim on the hold-out is still called a potential intermediary, unchanged from the old code:**
  `FS-D11B8F34`, an account-takeover victim.
  - **What the records show:** its first salary in the ledger (68,638) arrived the day before the takeover, while its
    balance was 933.
  - **Why it is misread:** the ledger starts on 1 January, so the employer has no earlier payment on record and counts
    as a new payer. The takeover transfers then read as forwarding money just received, under the old "own balance
    could not have covered it" path that this change did not touch.
  - **Fix needed:** recognising a first salary needs payer information the ledger does not have.
- **Planned secondary victims: two cases.**
  - **`FS-C9E94D85`** is called a potential intermediary, as before. Its records show plain pass-through (164,500 in,
    120,000 out three hours later).
  - **`FS-9870CD3B`** moved from potential victim to role unknown. Only its forwarding transfer is flagged, and the fix
    now reads that correctly as forwarding. Its drained savings were never flagged, so the engine cannot see the
    victim side.
  - In both, the generator's "secondary victim" drain is not visible as separate own-money loss.
- **Remaining misreadings of fraud-side accounts.** On the hold-out, 13.8% of intermediaries and 9.3% of
  attacker-controlled accounts investigated directly still get a victim-class role. The rule recognises passing money
  on only within 24 h of receiving it, and only when the account's own balance was not drawn down by 2,000 or more.
  Accounts that pass money on more slowly, or mix it with their own money, keep the earlier reading; no wider window
  was tried, because it would need its own evaluation. Another 30 intermediaries abstain (role unknown), which is the
  intended behaviour when only one kind of evidence exists.
- **Abstention instead of a protective label for three legitimate accounts across the evaluations.** These are hold-out
  secondary victim `FS-9870CD3B`, hold-out ordinary account `FS-99D50ADC`, and one served-ledger innocent counterparty.
  Each moved from "potential victim" to "role unknown": its flagged payment passed on money it had just received. None
  became a suspicion role or got a restriction review. Each now gets report level 2 (enhanced verification) instead of
  urgent protective verification.
- **Connected recipients.** The two accounts `FS-EAAA344C` paid (`FS-CE13E4F4`, `FS-5635F5AF`, intermediaries in the
  scenario) are "role unknown" at level 2 (enhanced verification), not intermediaries.
  - `FS-CE13E4F4` withdrew 45% of what it received as cash, under the 50% CASH threshold, and its other signals are
    model outputs.
  - The report flags both for enhanced verification rather than accusing them on model output.
- **An account's role in this flow can differ from its role elsewhere.** `FS-7305E412` is attacker-controlled in a
  different scenario. Here it paid 12,500 of its own money to `FS-EAAA344C` in an ordinary transfer unlike its
  history, so the upstream rules call it a potential victim, a protective label. The report shows its account-model
  score (98.4%) under its own behaviour and as evidence pointing the other way.
- **Account-model false positives on victims** remain (section 7). The report keeps them out of victim support.
- **Docstring.** The module docstring of `roles.py` still describes FUNDED_FORWARD in its original form. The precise
  rule is in `engine._unfunded` and docs/DYNAMIC_INTELLIGENCE.md. It was left unchanged so the committed code
  matches the hold-out manifest.
- **Synthetic only.** All rates are on one synthetic generator family and say nothing about real-world accuracy. The
  improvement is measured on hundreds of scenario accounts, not claimed from the two examples.

## 13. Verdict

**FIXED AND VERIFIED.** Conditions met:

- **Known victim:** `FS-7B7C13AB` is a potential victim from both directions, with protective verification only.
- **Known fraud-related account:** `FS-EAAA344C` is a potential intermediary from both directions and is no longer
  presented as a victim. "Intermediary" is the role its scenario evidence supports; it is not attacker-controlled.
- **Cause:** fixed in the rule, not the label, and measured on an untouched hold-out against the old code. No victim,
  look-alike, innocent or ordinary account moved towards suspicion or got a restriction review; three legitimate
  accounts across all evaluations moved from a protective label to an abstention (section 12).
- **Investigator report:** complete, deterministic and recommendation-only.
- **Verification:** automated suites green, the local release verified in Chrome, and production verified after
  release (section 10.2).
