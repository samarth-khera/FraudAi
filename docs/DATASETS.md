# Datasets: sources, licences, labels and how each is used

Every dataset here is synthetic. None contains real customers or real bank transactions. Raw files and generated
ledgers are git-ignored (`data/raw/`, `*.db`, `data/**/*.csv`); only code, reports and small model artifacts are committed.

Sources are never concatenated into one training table. Each has its own adapter into the normalized schema
(`backend/app/intelligence/schema.py`), its own label meaning and its own evaluation.

| Dataset | Used for | Served by the app | Licence |
|---|---|---|---|
| Forensic scenario ledgers (this repository) | Training and evaluating the transaction model, the account model and the role engine | Yes: `forensic-scenarios` (seed 303) | Repository code |
| FraudShield demo ledger (this repository) | Default investigation dataset and sample case FS-2001; external check only | Yes: `demo-ledger` | Repository code |
| PaySim (Kaggle `ealaxi/paysim1`) | Source-specific transaction-model evaluation | No | CC BY-SA 4.0 |
| IBM AMLSim published samples | Source-specific account and graph-feature evaluation | No | Apache-2.0 |

## Normalized transaction schema

Columns produced by every adapter:

- **Identity and timing:** `transaction_id`, `timestamp` (naive UTC), `sender_account_id`, `receiver_account_id`.
- **Transfer details:** `amount`, `currency`, `transaction_type` (TRANSFER, PAYMENT, CASH_OUT, CASH_IN, DEBIT or OTHER),
  `channel`, `transaction_status`.
- **Pre-transfer balances:** `sender_balance_before` and `receiver_balance_before`. Each is NaN when the source does not
  record it.
- **Provenance:** `source_dataset`, `source_record_id`.

Two columns are evaluation-only and are never read by inference: `label` and `scenario_id`.

Missing values are kept as missing. Raw files are never rewritten, and the original record ID is kept for auditing.

`validate_transactions` behaves as follows:
- **Rejects:** duplicate IDs (every copy), invalid timestamps, non-positive or non-finite amounts, missing sender or
  receiver, unknown transaction types, and references to accounts outside a known set.
- **Counts but keeps:** self-transfers, a pre-transfer balance below the amount (contradictory), negative balances, and
  missing optional fields.

## Forensic scenario ledgers

These come from `ml/forensics/generator.py`, version `forensic-scenarios-1.0.0`. The design rules and the 12 patterns
are in [DYNAMIC_INTELLIGENCE.md](DYNAMIC_INTELLIGENCE.md#4-the-forensic-scenario-generator). Counts are from
`ml/reports/data_quality_v3.json`.

| Ledger | Seed | Days | Accounts | Transactions | Scenario transfers | Held-out variants | Use |
|---|---|---|---|---|---|---|---|
| `train` | 101 | 120 | 10,195 | 450,424 | 1,678 | no | Model training (days 0–83), validation (84–101), temporal test (102–119); role-rule development |
| `cold` | 202 | 120 | 6,819 (6,818 with transfers) | 299,828 | 1,330 | yes | Cold-account test: disjoint IDs, held-out variants. Models scored once; the engine was also run before and after the final role-rule changes |
| `demo` | 303 | 90 | 2,676 | 88,623 | 333 | yes | Served as `forensic-scenarios`. No model was trained or selected on it, but some role rules and one demonstration criterion were shaped by it, so its role results are not fully held out |

Each ledger is deterministic from its seed, and a test checks this. Rebuild one with
`python scripts/build_forensic_ledger.py --ledger <name> --db <path>`.

**Labels**
- **Transaction label (`is_suspicious_scenario`):** the transfer is a step of a planted scenario flow. That covers the
  victim's transfer, forwarding, cash-out, the takeover transfer and the secondary-victim drain. Incidental purchases
  made with scam money are not positive.
- **Account role:** stored in `data/v3_forensic/<ledger>/roles.csv` (account, scenario, role, `materialised`). The
  database's `ground_truth_label` keeps the first role an account played. Role definitions are in `ROLE_DEFINITIONS`.
  Only evaluators read these; the app never does.

**The corrected "materialised" rule.** Roles are planned before the generator knows whether every leg can be funded
(unfundable legs are skipped), so some planned roles never happen. A role is materialised only when the transfers that
define it exist for that same scenario:

| Role | Materialised when |
|---|---|
| `intermediary` | it both received AND sent money of its scenario (one that only received it behaved as a plain recipient) |
| `victim` | it sent money of its scenario |
| `secondary_victim` | its own drain transfer exists (without it the account only forwarded) |
| `attacker_controlled`, `innocent_counterparty` | it received money of its scenario |
| `lookalike_legitimate` and others | any transfer of its scenario |

The previous rule counted a role whenever the account appeared in any scenario transfer. Transactions are unchanged;
only `roles.csv` changed.

| Ledger | Planned roles | Materialised, previous rule | Materialised, corrected rule |
|---|---|---|---|
| `train` | 1,528 | 1,329 | 1,305 |
| `cold` | 1,150 | 1,000 | 978 |
| `demo` | 300 | 263 | 257 |

Materialised by role (corrected rule), train / cold / demo: intermediary 544 / 426 / 118; victim 337 / 246 / 61;
attacker_controlled 181 / 133 / 34; innocent_counterparty 161 / 118 / 30; lookalike_legitimate 58 / 39 / 10;
secondary_victim 24 / 16 / 4.

The served account model `v3-account-1.0.0` was trained before this correction, on planned roles; the challenger
`v3-account-1.1.0` uses the corrected rule (see [DYNAMIC_INTELLIGENCE.md](DYNAMIC_INTELLIGENCE.md#7-models-b-and-c-account-behaviour)).

## FraudShield demo ledger

This is `backend/app/data/v2/generator.py` with seed 42: 10,000 accounts and 353,393 transactions with five planted
single scenarios. Its label defects are documented in [ACCOUNT_MODEL_AUDIT.md](ACCOUNT_MODEL_AUDIT.md) §3, such as
merchants labelled as cash-out terminals.

**How the v3 models perform here.** This ledger comes from a different generator, so it is used only as an external
check (`ml/reports/data_quality_v3.json`, `demo_ledger_external_check`):
- Transaction model `v3-transaction-1.0.0`: precision 1.1%, recall 64% and PR-AUC 0.058 on 353,393 transfers (42
  positives).
- Account model `v3-account-1.0.0` (the served champion), scored as of the ledger end: precision 1.3%, recall 62% and
  PR-AUC 0.051 on 10,000 accounts (29 positives: the demo generator's mule and shell labels).

On this dataset the dynamic investigation therefore shows model outputs for reference only. Findings there rest on the
fixed rules and recorded facts.

## PaySim

| Item | Value |
|---|---|
| Source | Kaggle `ealaxi/paysim1`, by E. A. Lopez-Rojas; paper: Lopez-Rojas, Elmir & Axelsson, *PaySim: A financial mobile money simulator for fraud detection*, EMSS 2016 |
| Licence | CC BY-SA 4.0 (Kaggle dataset metadata) |
| File | `data/raw/PS_20174392719_1491204439457_log.csv`, SHA-256 `16910f90577b0d981bf8ff289714510bb89bc71bff7d3f220f024e287e4eea6b` |
| Rows | 6,362,620; 11 columns; no missing values; no duplicate rows |
| Label | `isFraud`: 8,213 rows (0.129%), all of them TRANSFER (4,097) or CASH_OUT (4,116) |
| Not features | `isFlaggedFraud` (16 rows; the simulator's own rule flag), `newbalanceOrig` and `newbalanceDest` (written after the transfer), and all names |

**Adapter (`ml/forensics/adapters.py:paysim`):**
- `step`, an hour index with no calendar date, is mapped to a base date of 2017-01-01. Because that date is arbitrary,
  `is_weekend` is not used as a feature on PaySim.
- `type` is mapped to `transaction_type`.
- Merchant (`M…`) balances are always 0 in PaySim, because the simulator does not track them. They become NaN
  (unknown), not 0.

**Findings that limit its use:**
- **No sender history:** 99.85% of senders appear once, so PaySim cannot support per-sender history or account-level
  investigation.
- **The label is nearly one simulator mechanic:** 97.8% of fraud rows move exactly the sender's whole balance, against
  0.0001% of other rows. That is how the simulator generates fraud, so near-perfect PaySim scores describe the
  simulator.

The existing benchmark in `ml/v2/paysim_benchmark.py` subsamples its validation and test splits. The new evaluation
(`ml/forensics/paysim_transaction_model.py`) keeps their real prevalence.

## IBM AMLSim

| Item | Value |
|---|---|
| Source | https://github.com/IBM/AMLSim, `sample/` at commit `7338a4bcb1af9bcfea2201ad7daccfe2a4d569ca` |
| Licence | Apache-2.0 |
| Files | `20K_cycle200.tgz` (`da85ffd2…72ae20`), `20K_fanin200.tgz` (`e2479ab7…f1b`), `20K_fanin200cycle200.tgz` (`f187bc57…319`) |
| Content | 20,000 accounts and about 118,000 transactions per sample, as `sourceNodeId, targetNodeId, value, time` |
| Label | Node-level `isFraud`: the account belongs to a generated laundering pattern (945 for cycles, 954 for fan-in) |
| Not available | Transaction labels, transaction types, balances and pattern IDs. `fraudStep` is post-event and never a feature |

**Getting the files:**

```bash
mkdir -p data/raw/amlsim/extracted
for s in 20K_cycle200 20K_fanin200 20K_fanin200cycle200; do
  curl -L -o data/raw/amlsim/$s.tgz \
    https://github.com/IBM/AMLSim/raw/7338a4bcb1af9bcfea2201ad7daccfe2a4d569ca/sample/$s.tgz
  tar -xzf data/raw/amlsim/$s.tgz -C data/raw/amlsim/extracted   # creates data/raw/amlsim/extracted/$s/
done
shasum -a 256 data/raw/amlsim/*.tgz   # compare with ml/reports/amlsim_graph_benchmark.json
```

Each archive contains a folder named after the sample with `nodes.csv` and `transactions.csv`, which the adapter reads
from `data/raw/amlsim/extracted/<sample>/`.

**Usable for:** account-level and graph-feature evaluation (`ml/forensics/amlsim_graph_benchmark.py`).

**Not usable for:**
- **Transaction-model training:** the samples have no transaction labels.
- **Role evaluation:** there are no victim or intermediary roles.

Running the AMLSim simulator itself would need Java 8, Maven and the MASON jar. Maven was not available here, so only
the published samples were used.

Pattern membership in a synthetic generator is not proof that a human account holder knowingly took part. The samples
share one background graph (the same node IDs), so cross-sample tests are not account-disjoint, and the report says so.

## Not used

- **IBM "Transactions for Anti Money Laundering" (AMLworld, Kaggle):** downloading needs a Kaggle account and API
  token, and none was available.
- **Real bank data:** none is used and none is needed. The app refuses to label an unauthorized source as institution
  data (`backend/app/services/v2/data_source.py`).
