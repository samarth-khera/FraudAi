# FraudShield AI — Phase 1 Backend

> **SYNTHETIC DEMONSTRATION DATA.** All accounts, transactions and lineage values are
> invented test fixtures. They are not real bank customers or real money movements.
> This is not production-bank software.

## Purpose

When a fraud is reported, money may hop through several accounts. Phase 1 provides a
backend foundation and a deterministic **synthetic fund-tracing engine** that creates
an investigation view of a case: which accounts received or forwarded potentially
linked funds, along which transaction paths, in what order.

Receiving money connected to a fraud does **not** make an account owner a scammer.
The system deliberately has no guilty/innocent label; fraud indicators, fund exposure,
evidence quality and review status are kept as separate concepts. Accounts are never
frozen or unfrozen automatically.

Out of scope for Phase 1: frontend, ML model, database, authentication, audit logs.

## Requirements

Python 3.10+ (developed on 3.12). Dependencies: FastAPI, Pydantic v2, NetworkX, Uvicorn, Pytest, httpx.

## Install

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

No environment file is required; there are no secrets or external services.

## Run the server

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Interactive API docs: <http://127.0.0.1:8000/docs>

## Run tests

```bash
cd backend
python -m pytest -q
```

## Layout

```
backend/
  app/
    main.py                  # app factory, error handlers
    api/routes.py            # HTTP routes (thin)
    models/domain.py         # FraudCase, Account, Transaction, FundTracePath, AccountReviewStatus, ...
    schemas/trace.py         # trace / graph / error response schemas
    services/tracer.py       # fund-tracing engine
    services/graph.py        # NetworkX -> nodes/edges
    repositories/case_repository.py  # in-memory repo from JSON (swap for PostgreSQL later)
    data/fs_1042.json        # synthetic seed data
  tests/
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/api/cases` | list cases |
| GET | `/api/cases/{case_id}` | case detail |
| GET | `/api/cases/{case_id}/transactions` | chronological traced transactions |
| GET | `/api/cases/{case_id}/graph` | nodes + edges for rendering |
| GET | `/api/cases/{case_id}/trace` | paths, per-account info, summary |

`transactions`, `graph` and `trace` accept `?max_depth=` (0–50, default 10; origin transaction = hop 0).

Errors use one shape: `{"error": {"code": "...", "message": "...", "details": null}}`
— `404 case_not_found`, `409 origin_transaction_unavailable`, `422 validation_error`.

```bash
curl localhost:8000/health
curl localhost:8000/api/cases/FS-1042/trace
curl "localhost:8000/api/cases/FS-1042/graph?max_depth=2"
```

### Trace response (abridged)

```json
{
  "case_id": "FS-1042",
  "summary": {
    "reported_amount": 50000, "traceable_amount": 50000,
    "located_amount": 50000, "unlocated_amount": 0,
    "gross_observed_transaction_value": 175000,
    "linked_account_count": 7, "path_count": 3,
    "truncated": false, "cycles_detected": false
  },
  "linked_accounts": [{
    "account_id": "C300", "connection_type": "indirect", "hop_count": 2,
    "inbound_transaction_ids": ["T003"], "outbound_transaction_ids": ["T005", "T006"],
    "exposure": {
      "observed_inbound_value": 30000, "observed_outbound_value": 15000,
      "attributed_inbound_amount": 30000, "attributed_outbound_amount": 15000,
      "attributed_unforwarded_amount": 15000, "attribution_status": "explicit"
    },
    "review": {"review_state": "under_review", "evidence_quality": "synthetic_assumption",
               "automated_action_taken": "none"}
  }],
  "paths": [{"path_id": "P1", "transaction_ids": ["T001","T002","T003","T005"],
             "hop_count": 3, "max_attributable_amount": 10000,
             "termination_reason": "end_of_records", "attribution_status": "explicit"}]
}
```

### Expected graph structure (FS-1042)

Nodes: `V001, A100, B200, C300, D400, E500, F600, G700`. Edges (`source → target`, observed amount):

```
V001 -T001-> A100  50000  UPI
A100 -T002-> B200  50000  IMPS
B200 -T003-> C300  30000  UPI
B200 -T004-> D400  20000  NEFT
C300 -T005-> E500  10000  UPI
C300 -T006-> F600   5000  NEFT
D400 -T007-> G700  10000  UPI
```

Graph response shape: `{case_id, nodes:[{id,label,role,hop_count,review_state,evidence_quality,
attributed_unforwarded_amount,...}], edges:[{id,source,target,amount,currency,transaction_type,
timestamp,hop_count,attributed_amount,is_cycle_closing}], meta, disclaimer}`.

Assumed unforwarded attribution at the end of the records: C300 15,000; D400 10,000;
E500 10,000; F600 5,000; G700 10,000 (= 50,000).

## Fund-tracing assumptions and limitations

- **Synthetic lineage is an assumption.** `synthetic_lineage_metadata` on each seeded
  transaction states how much of it is assumed to derive from FS-1042. It is not proof of
  real money ownership. Without explicit lineage, attribution is reported as *uncertain*
  (`null`), never guessed.
- **Downstream** = a later transaction (strictly later timestamp) whose sender is the
  receiver of the previous leg. Real systems also need balances and commingling analysis.
- **No double counting.** Observed transaction values are per-leg ledger values. The same
  funds move once per hop, so summing them is *not* the fraud amount.
  `gross_observed_transaction_value` is exposed only for transparency and labelled as such.
  `traceable_amount` comes from the origin lineage (capped at the reported amount).
- **Unobserved money is not assumed spent.** An account's `attributed_unforwarded_amount`
  is just attributed inflow minus attributed outflow observed in the records; it does not
  mean the money was kept, hidden or spent.
- **Safety:** cycles (including returns to the victim) are recorded as cycle-closing and not
  expanded; depth limit and path cap bound traversal; identical duplicate IDs are
  de-duplicated, conflicting duplicates are quarantined (if the origin, the trace fails
  with 409); self-transfers are ignored; lineage exceeding the observed amount or naming
  another case is treated as uncertain; over-attribution is flagged as ambiguous.
- A graph connection alone does not establish criminal involvement. Review states and
  evidence quality are human-workflow fields; no model predictions or accuracy metrics exist.
- Data is held in memory from JSON; no persistence, authentication or audit logging yet.

## ML risk scoring (Phase 2 integration)

`POST /api/risk/score` scores ONE transaction with the trained XGBoost model saved by
`python -m ml.train` (`ml/artifacts/model_v1/`). The model is loaded **once at startup**
(never retrained). If artifacts are missing/invalid, the endpoint returns **503** and the
tracing endpoints keep working. Override the artifact folder with `FRAUDSHIELD_MODEL_DIR`.

Train first (needs the PaySim CSV, see `ml/README.md`), then start the server:

```bash
backend/.venv/bin/python -m ml.train          # from repo root
cd backend && .venv/bin/uvicorn app.main:app --port 8000
```

Request fields are exactly the saved `pre_transaction` feature schema (checked at load; a
mismatch or any post-transaction/leaky feature makes the model unavailable). Unknown/extra
fields (e.g. `newbalanceOrig`, account IDs), missing fields, strings instead of numbers,
negative values, NaN and Infinity all return 422.

```bash
curl -s -X POST localhost:8000/api/risk/score -H "Content-Type: application/json" -d \
  "{\"step\": 12, \"type\": \"TRANSFER\", \"amount\": 250000, \"oldbalanceOrg\": 250000, \"oldbalanceDest\": 0}"
```

```json
{
  "risk_score": 0.9996846914291382,
  "threshold": 0.9982855916023254,
  "review_recommended": true,
  "model_version": "model_v1:xgboost",
  "feature_set": "pre_transaction",
  "decision_support_only": true,
  "automated_action_taken": "none",
  "disclaimer": "Decision support only. ..."
}
```

(Output observed from the real saved model on this synthetic example.) `review_recommended` is
`risk_score >= threshold`, where the threshold was selected on validation data. The result is
decision support for human review: it is not a finding of guilt or innocence and no account is
ever frozen or otherwise acted on automatically. Errors: `422 validation_error`,
`503 model_unavailable` (no paths or stack traces are returned), `500 scoring_failed`.

Backend tests that need a model train a tiny one from generated data in a temp folder; they do
not need the real artifact. Install ML dependencies with `pip install -r ../ml/requirements.txt`.
