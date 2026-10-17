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

- [`frontend/`](frontend/): React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, and Cytoscape.js interactive dashboard.
- [`backend/`](backend/): FastAPI application, SQLAlchemy database models, Alembic migrations, NetworkX fund-tracing engine, and REST APIs.
- [`ml/`](ml/): PaySim model training pipeline, feature schema definitions, and model evaluation routines.
- [`data/`](data/): Raw and synthetic dataset specifications.

---

## Quickstart

### 1. Backend Setup & Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run migrations and start server
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup & Run

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### 3. Testing Across the Stack

```bash
# Backend tests (78 tests)
cd backend && .venv/bin/python -m pytest tests -v

# ML pipeline tests (29 tests)
cd ml && ../backend/.venv/bin/python -m pytest tests -v

# Frontend tests (6 tests & typecheck)
cd frontend && npm test && npm run build
```

See [`frontend/README.md`](frontend/README.md), [`backend/README.md`](backend/README.md), and [`ml/README.md`](ml/README.md) for full endpoint specifications, database architecture, and training details.

