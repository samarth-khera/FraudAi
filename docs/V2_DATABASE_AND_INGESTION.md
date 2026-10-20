# FraudShield AI V2: Database Schema, ORM & Data Ingestion Guide
**Phase 2 Persistence & Forensic Ledger Architecture**

---

## 1. Architectural Overview

FraudShield AI V2 establishes an isolated, high-throughput relational persistence layer designed for sub-second investigative account lookups, continuous double-entry ledger navigation, and multi-hop graph fund-tracing.

### 1.1 Legacy Isolation & Database Separation
* **Legacy V1 Database**: `backend/fraudshield.db` (contains V1 demo cases like `FS-1042`).
* **V2 Database Target**: `data/v2_fraudshield.db` (by default) or configured via `FRAUDSHIELD_V2_DATABASE_URL`.
* **Safety Guard**: `backend/app/db/v2/session.py` strictly prevents V2 operations from running against `backend/fraudshield.db` via `validate_not_v1_database()`, raising an explicit `ValueError` if any legacy path is supplied.

---

## 2. Database Schema & Entities

The schema is defined in [`backend/app/db/v2/models.py`](file:///Users/samarthkhera56/FraudAi/backend/app/db/v2/models.py).

```mermaid
erDiagram
    ACCOUNTS ||--o{ TRANSACTIONS : "outgoing (origin_account_id)"
    ACCOUNTS ||--o{ TRANSACTIONS : "incoming (destination_account_id)"

    ACCOUNTS {
        string account_id PK "Indexed primary key (e.g. ACC-000001)"
        string customer_name "Indexed customer/business name"
        string customer_type "Indexed category: retail, student, sme, corporate"
        string kyc_tier "Indexed verification level: tier_1_basic, tier_2_verified, tier_3_enhanced"
        string phone_number "Indexed contact phone"
        string email "Indexed contact email"
        string upi_id "Indexed VPA handle"
        string tax_identifier "Indexed tax ID (PAN)"
        float initial_balance "Opening balance (Check: >= 0)"
        float current_balance "Current ledger balance (Check: >= 0)"
        datetime account_opened_at "Account inception date"
        string status "Indexed status: active, dormant, suspended"
        string scenario_id "Indexed scenario identifier (optional)"
        string ground_truth_label "Indexed benchmark label"
        datetime created_at "Record ingestion timestamp"
    }

    TRANSACTIONS {
        string transaction_id PK "Indexed primary key (e.g. TXN-0000001)"
        datetime timestamp "Indexed UTC execution timestamp"
        string origin_account_id FK "Indexed origin account (RESTRICT on delete)"
        string destination_account_id FK "Indexed destination account (RESTRICT on delete)"
        float amount "Transaction amount (Check: > 0)"
        string currency "ISO currency code (default: INR)"
        string channel "Indexed rail: UPI, IMPS, NEFT, RTGS, CARD_POS, ATM_CASH_OUT, INTERNAL"
        string status "Indexed status: COMPLETED"
        float origin_balance_before "Check: >= 0"
        float origin_balance_after "Check: >= 0"
        float dest_balance_before "Check: >= 0"
        float dest_balance_after "Check: >= 0"
        string scenario_id "Indexed scenario identifier (optional)"
        string scenario_tag "Indexed stage tag"
        boolean is_suspicious_scenario "Indexed ground-truth flag"
        datetime created_at "Record ingestion timestamp"
    }
```

### 2.1 Indexing Strategy
To optimize forensic traversal and account search:
* `idx_txn_origin_timestamp`: Composite index on `(origin_account_id, timestamp)` for rapid retrieval of an account's outbound ledger history.
* `idx_txn_dest_timestamp`: Composite index on `(destination_account_id, timestamp)` for rapid retrieval of inbound funding streams.
* `idx_txn_scenario`: Composite index on `(scenario_id, is_suspicious_scenario)` for benchmarking detection models.
* B-tree indexes on `accounts.customer_name`, `accounts.upi_id`, `accounts.phone_number`, and `accounts.email` for instant typeahead search.

### 2.2 Ground-Truth Isolation
`ground_truth_label`, `scenario_id`, `scenario_tag`, and `is_suspicious_scenario` are explicitly tagged as evaluation ground truth. The ORM models provide a `.to_dict(include_ground_truth=False)` method to prevent future machine learning feature pipelines from accidentally leaking benchmark answers into model training sets.

---

## 3. High-Throughput Ingestion Pipeline

The ingestion pipeline is implemented in [`backend/app/db/v2/ingestion.py`](file:///Users/samarthkhera56/FraudAi/backend/app/db/v2/ingestion.py) and exposed via [`scripts/ingest_v2_data.py`](file:///Users/samarthkhera56/FraudAi/scripts/ingest_v2_data.py).

### 3.1 Key Engineering Safeguards
1. **Streaming Chunks**: Reads CSV files row-by-row using streaming iterators and executes batch inserts (default 10,000 rows/batch), maintaining low memory consumption regardless of dataset size.
2. **Referential Pre-Validation**: Caches unique account identifiers in memory ($O(1)$ lookup) to guarantee that zero orphan transactions can ever be submitted to the database.
3. **Atomic Transaction Rollback**: All inserts execute within a single transaction boundary (`with Session(engine) as session:`). Any constraint failure, invalid timestamp, duplicate identifier, or unhandled exception immediately triggers a full database rollback.
4. **Accidental Overwrite Protection**: The script automatically aborts if the V2 database already contains data. Reruns require the explicit `--replace` flag.

### 3.2 CLI Ingestion Command

```bash
# Ingest the full synthetic dataset into the V2 database (with explicit replacement)
backend/.venv/bin/python scripts/ingest_v2_data.py --input-dir data/v2_synthetic --batch-size 10000 --replace
```

---

## 4. Measured Full-Dataset Verification Results

* **Hardware & Runtime**: Local macOS, Python 3.12.4, SQLite 3 with Write-Ahead Logging (`PRAGMA journal_mode=WAL`).
* **Source CSV Files**:
  * `data/v2_synthetic/accounts.csv` (1.91 MB, 10,001 rows)
  * `data/v2_synthetic/transactions.csv` (53.16 MB, 353,394 rows)
* **Measured Ingestion Performance**:
  * Accounts Ingested: **10,000**
  * Transactions Ingested: **353,393**
  * Total Ingestion Time: **11.36 seconds** (~31,100 records/second)
  * SQLite Database Size: **183.59 MB** (including all primary keys, foreign keys, and indexes)
* **Database Integrity Checks**:
  * `PRAGMA foreign_key_check`: **0 violations** (100% referential integrity).
  * Check Constraint Violations: **0** (all balances $\ge 0$, amounts $> 0$).
  * Distinct Scenarios Verified in DB: **5** (`SCENARIO-APP-001`, `SCENARIO-STRUCT-002`, `SCENARIO-DISPERSAL-003`, `SCENARIO-CYCLE-004`, `SCENARIO-DORMANT-005`).
* **Measured Query Performance**:
  * Account 360° Profile & 50 Most Recent Ledger Transactions: **6.73 ms**
  * Full Database Table Count (`COUNT(*)` over 353,393 rows): **99.06 ms**

---

## 5. PostgreSQL Migration Configuration

To switch the V2 persistence layer to PostgreSQL in enterprise production:
1. Set the environment variable:
   ```bash
   export FRAUDSHIELD_V2_DATABASE_URL="postgresql+psycopg2://user:password@localhost:5432/fraudshield_v2"
   ```
2. Run the ingestion pipeline or migrations:
   ```bash
   backend/.venv/bin/python scripts/ingest_v2_data.py --db-url "$FRAUDSHIELD_V2_DATABASE_URL" --input-dir data/v2_synthetic
   ```
No application code modifications are required.
