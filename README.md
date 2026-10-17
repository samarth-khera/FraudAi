# FraudShield AI

FraudShield AI is an intelligent fraud investigation, fund-tracing, and innocent-recipient protection platform.

When a reported fraud occurs, money frequently moves across multiple intermediary accounts. FraudShield AI traces the downstream transaction network, separating fraud risk, fund exposure, evidence quality, and reviewer decisions to support fair, evidence-based financial crime investigations.

---

## Key Features

- **Downstream Fund-Tracing Engine**: Deterministic directed graph traversal with NetworkX computing paths, hops, cycle detection, and unforwarded exposure attribution.
- **Persistent Case Management**: SQLAlchemy 2.0 ORM with SQLite (local) and PostgreSQL compatibility; Alembic schema migrations.
- **Append-Only Audit Trail**: Full historical provenance tracking all case creations, transaction additions, metadata edits, reviewer notes, and trace calculations.
- **PaySim ML Risk Scoring**: Leakage-safe XGBoost pre-transaction fraud classifier integrated via `POST /api/risk/score`.
- **Innocent-Recipient Safeguards**: Strict policy of never auto-freezing accounts or issuing automated verdicts of guilt.

---

## Project Structure

- [`backend/`](backend/): FastAPI application, SQLAlchemy database models, Alembic migrations, NetworkX fund-tracing engine, and REST APIs.
- [`ml/`](ml/): PaySim model training pipeline, feature schema definitions, and model evaluation routines.
- [`data/`](data/): Raw and synthetic dataset specifications.

---

## Quickstart

### 1. Backend Setup & Tests

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run migrations and start server
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 2. Testing

```bash
# Run backend test suite (78 tests)
cd backend && .venv/bin/python -m pytest tests -v

# Run ML test suite (29 tests)
cd ml && ../backend/.venv/bin/python -m pytest tests -v
```

See [`backend/README.md`](backend/README.md) and [`ml/README.md`](ml/README.md) for full endpoint specifications, database architecture, and training details.
