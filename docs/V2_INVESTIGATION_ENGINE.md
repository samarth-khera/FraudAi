# FraudShield AI V2 — Phase 3: Investigation Engine, Fund Tracing & Risk Assessment

## Overview
FraudShield AI V2 replaces black-box decision models with a factual, deterministic financial forensics engine built on top of the V2 normalized ledger. The engine delivers four core forensic capabilities mounted under `/api/v2`:

1. **360° Account Profile Intelligence** (`/api/v2/accounts/{account_id}`)
2. **Chronological Ledger Exploration** (`/api/v2/accounts/{account_id}/transactions`)
3. **Forensic Multi-Hop Graph Tracing** (`/api/v2/trace`)
4. **Explainable Baseline Risk Assessment** (`/api/v2/accounts/{account_id}/assessment`)

The V1 API endpoints (`/cases`, `/tracer`, `/risk`, `/protect`) remain 100% backward-compatible and undisturbed.

---

## Architecture & Service Decomposition

```
backend/app/
├── api/
│   └── v2/
│       ├── __init__.py
│       ├── routes.py          # FastAPI routes, parameter validation, and HTTP status codes
│       └── schemas.py         # Pydantic models for profiles, transactions, graph, and risk
└── services/
    └── v2/
        ├── __init__.py
        ├── account_service.py # 360° metrics aggregation & paginated transaction extraction
        ├── graph_tracer.py    # Multi-hop BFS graph traversal, cycle-safety, and bounded exposure
        └── risk_assessment.py  # Transparent heuristic behavioral scoring & plain-language reason codes
```

---

## 1. Endpoints & API Reference

### 1.1 Account Profile (`GET /api/v2/accounts/{account_id}`)
Retrieves comprehensive customer metadata, KYC status, balances, and calculated transaction ledger summary metrics.

**Parameters:**
- `account_id` (path, string, required): Unique account identifier (e.g. `ACC-000001`).

**Summary Metrics Computed:**
- `total_incoming_txns`, `total_outgoing_txns`
- `total_incoming_amount`, `total_outgoing_amount`
- `net_flow`: `total_incoming_amount - total_outgoing_amount`
- `unique_counterparties`: Count of distinct external accounts interacted with
- `first_activity_at`, `last_activity_at`: Timestamps of first and last recorded ledger activities

**Response Example (200 OK):**
```json
{
  "account_id": "ACC-000001",
  "customer_name": "Aditi Joshi",
  "customer_type": "retail",
  "kyc_tier": "tier_2_verified",
  "phone_number": "+91 92174 00001",
  "email": "aditijoshi.0001@example.bank",
  "upi_id": "aditijoshi0001@okhdfcbank",
  "tax_identifier": "SYNTH00001P",
  "initial_balance": 300000.0,
  "current_balance": 177156.23,
  "account_opened_at": "2025-10-11T00:00:00",
  "status": "active",
  "metrics": {
    "total_incoming_txns": 23,
    "total_outgoing_txns": 33,
    "total_incoming_amount": 288043.01,
    "total_outgoing_amount": 410886.78,
    "net_flow": -122843.77,
    "unique_counterparties": 56,
    "first_activity_at": "2026-01-03T03:02:29",
    "last_activity_at": "2026-03-31T03:05:52"
  }
}
```

---

### 1.2 Account Transactions (`GET /api/v2/accounts/{account_id}/transactions`)
Returns paginated, chronologically ordered transaction history for an account.

**Parameters:**
- `account_id` (path, string, required): Unique account identifier.
- `direction` (query, string, optional): `all` (default), `incoming`, or `outgoing`.
- `page` (query, integer, optional, default: 1, min: 1): Page number.
- `limit` (query, integer, optional, default: 50, min: 1, max: 200): Records per page.

**Response Example (200 OK):**
```json
{
  "account_id": "ACC-000001",
  "total_records": 56,
  "page": 1,
  "limit": 2,
  "total_pages": 28,
  "items": [
    {
      "transaction_id": "TXN-0008601",
      "origin_account_id": "ACC-000001",
      "destination_account_id": "ACC-002867",
      "amount": 2163.53,
      "currency": "INR",
      "channel": "CARD_POS",
      "timestamp": "2026-01-03T03:02:29",
      "direction": "outgoing"
    },
    {
      "transaction_id": "TXN-0034439",
      "origin_account_id": "ACC-000001",
      "destination_account_id": "ACC-000414",
      "amount": 3620.75,
      "currency": "INR",
      "channel": "IMPS",
      "timestamp": "2026-01-09T13:34:58",
      "direction": "outgoing"
    }
  ]
}
```

---

### 1.3 Forensic Graph Tracing Engine (`GET /api/v2/trace`)
Performs multi-hop breadth-first traversal starting from a root account, tracking money flows across intermediate hops, branching fan-outs, and cyclic loops.

**Parameters:**
- `account_id` (query, string, required): Originating or destination root account.
- `direction` (query, string, optional): `outgoing` (default) or `incoming`.
- `max_depth` (query, integer, optional, default: 3, min: 1, max: 6): Maximum hop distance.
- `max_nodes` (query, integer, optional, default: 50, min: 5, max: 200): Safety ceiling for total node expansion.
- `max_edges_per_node` (query, integer, optional, default: 25, min: 1, max: 100): Prevents combinatorial explosion on high-degree merchant nodes.

**Forensic Principles & Guardrails:**
1. **Cycle Detection**: When a path circles back to an already visited account, an edge is emitted with `is_cycle: true`, but the target account is not re-queued for traversal. This prevents infinite loops while fully preserving the observed cross-link.
2. **Safe Truncation**: When `max_nodes` is reached, traversal halts gracefully. `is_truncated: true` and an explicit `truncation_reason` (e.g. `"Configured max_nodes limit of 50 accounts reached."`) are returned.
3. **No Downstream Double-Counting**:
   - `observed_total_transferred`: The simple sum of all transaction amounts across all edges in the graph.
   - `attributed_exposure_upper_bound`: The initial outflow directly leaving the root account (Hop 1). Downstream re-transfers are intermediate movements of these initial funds and are never summed as cumulative loss.
   - `attribution_disclaimer`: Explains that once funds commingle with existing balances, downstream attribution becomes probabilistic rather than guaranteed.

**Response Example (200 OK):**
```json
{
  "root_account_id": "ACC-000001",
  "direction": "outgoing",
  "max_depth": 2,
  "nodes": [
    {
      "account_id": "ACC-000001",
      "customer_name": "Aditi Joshi",
      "customer_type": "retail",
      "kyc_tier": "tier_2_verified",
      "current_balance": 177156.23,
      "hop_distance": 0,
      "is_root": true
    },
    {
      "account_id": "ACC-002867",
      "customer_name": "Ishan Reddy",
      "customer_type": "retail",
      "kyc_tier": "tier_2_verified",
      "current_balance": 107228.33,
      "hop_distance": 1,
      "is_root": false
    }
  ],
  "edges": [
    {
      "transaction_id": "TXN-0008601",
      "origin_account_id": "ACC-000001",
      "destination_account_id": "ACC-002867",
      "amount": 2163.53,
      "currency": "INR",
      "channel": "CARD_POS",
      "timestamp": "2026-01-03T03:02:29",
      "hop": 1,
      "is_cycle": false
    }
  ],
  "total_nodes": 2,
  "total_edges": 1,
  "is_truncated": false,
  "truncation_reason": null,
  "observed_total_transferred": 2163.53,
  "attributed_exposure_upper_bound": 2163.53,
  "attribution_status": "observed_transfers_with_bounded_exposure",
  "attribution_disclaimer": "Observed total transferred represents the sum of all individual ledger movements across hops. Attributed exposure upper bound represents the initial flow from/to root. Downstream re-transfers must never be summed as additional stolen funds. Attribution through mixed balances is inherently uncertain."
}
```

---

### 1.4 Baseline Account Risk Assessment (`GET /api/v2/accounts/{account_id}/assessment`)
A deterministic, rule-based behavioral risk assessment module designed for explainability and regulatory auditability.

**Risk Signals Evaluated:**
| Signal | Computation | Rationale / Threshold |
| :--- | :--- | :--- |
| **Transaction Velocity** | Count of transactions in last 24h, 7d, and 30d relative to latest account activity. | Rapid surges indicate automated or bot-driven laundering activity (`>10` in 24h). |
| **Rapid Pass-Through** | Outgoing amount / incoming amount ratio combined with median time delta (dwell minutes). | Mule accounts typically retain funds for less than 120 minutes with a flow-through ratio $> 0.85$. |
| **Amount Spike** | Maximum transaction amount divided by average transaction amount. | Sudden disproportionate spikes ($> 5.0\times$) suggest abnormal account utilization. |
| **Counterparty Diversity** | Distinct counterparties divided by total transactions. | High fan-out or low counterparty reuse. |
| **Fan-In / Fan-Out Ratio** | Incoming txns / total txns and Outgoing txns / total txns. | Severe asymmetry ($> 0.85$) highlights funnel accounts or disbursement nodes. |
| **Dormant Awakening** | Gap in days between account opening / early activity and sudden high velocity. | Vintage accounts suddenly activated for illicit transfers ($> 60$ days dormancy). |
| **Circular Flow** | Detection of funds returning to the same counterparty within multi-hop graph. | Layering and wash-trading indicator. |

**Advisory Score & Categories:**
- `0 - 29`: **Low** (Consistent with normal personal or commercial banking activity).
- `30 - 69`: **Medium** (Elevated behavioral anomalies warranting analyst review).
- `70 - 100`: **High** (Multiple concurrent red flags indicating potential mule or laundering behavior).

**Evidence Limitations & Safeguards:**
- **No Ground-Truth Leakage**: The scoring algorithm **never** inspects `ground_truth_label`, `scenario_id`, `scenario_tag`, or `is_suspicious_scenario`. Doing so in production is impossible and mathematically dishonest.
- **Innocent Account Protection**: Merely having a transaction link to a high-risk entity does not automatically raise an innocent account's risk score to high. Scores evaluate the account's *own* behavior.
- **Evidence Gaps**: Every assessment explicitly surfaces what the bank *does not* know (e.g., absence of IP geolocation, device MAC address, or cash ATM terminal tracking).
- **No Automated Actions**: Output is strictly advisory decision-support. Automated freezing, account termination, or credit blocking is strictly prohibited by design.

**Response Example (200 OK):**
```json
{
  "account_id": "ACC-000001",
  "risk_score": 25.0,
  "risk_level": "low",
  "signals": {
    "total_transactions": 56,
    "velocity_24h_count": 1,
    "velocity_7d_count": 8,
    "velocity_30d_count": 21,
    "flow_through_ratio": 1.4265,
    "rapid_pass_through": false,
    "median_dwell_minutes": 2.8,
    "max_amount": 250000.0,
    "avg_amount": 12480.89,
    "amount_spike_ratio": 20.03,
    "unique_counterparties": 56,
    "counterparty_diversity_ratio": 1.0,
    "fan_in_ratio": 0.4107,
    "fan_out_ratio": 0.5893,
    "dormancy_gap_days": null,
    "dormant_awakening_detected": false,
    "cycle_detected": false
  },
  "reason_codes": [
    "UNUSUAL_AMOUNT_SPIKE: Maximum transaction (250000.00) is 20.0x higher than average."
  ],
  "evidence_gaps": [
    "DEVICE_TELEMETRY_UNAVAILABLE: Session IP, device fingerprint, and MAC addresses are not captured in current core banking data.",
    "EXTERNAL_PERIMETER_BLINDSPOT: Downstream transactions terminating at ATM or external banks cannot be verified."
  ],
  "uncertainty_rating": "low",
  "recommendation": "routine_monitoring: Consistent with standard personal or commercial customer baseline.",
  "disclaimer": "Decision support only. Heuristic behavioral risk scores evaluate mathematical anomalies in transaction timing and velocity. They do not constitute legal proof of culpability or intent. Automated punitive actions or account freezing are strictly prohibited."
}
```

---

## 2. Test Coverage & Verification

The suite was executed with `pytest backend/tests/`:
- Total tests: **132 passing** in 3.74 seconds.
- V1 regression: 100% passing across `test_account_protection.py`, `test_api.py`, `test_case_management.py`, `test_risk.py`, and `test_tracer.py`.
- V2 database & generator: 100% passing across `test_v2_synthetic_generator.py` and `test_v2_database_and_ingestion.py`.
- V2 intelligence & tracing: 100% passing across `test_v2_intelligence_and_tracing.py` (10 tests covering profile summaries, direction filters, pagination, graph cycles, depth truncation, node limits, exposure bound calculations, 404 validation, and ground-truth isolation).

## 3. Live Browser Verification
Live automated Chrome browser testing confirmed:
- `http://127.0.0.1:8000/docs`: Interactive FastAPI Swagger UI executes and renders all V2 endpoints with status 200 and 404.
- `http://127.0.0.1:8000/api/v2/accounts/ACC-000001/assessment`: Real-time behavioral risk scoring and explainability codes.
- `http://127.0.0.1:8000/api/v2/trace`: Correct multi-hop traversal with safe node limits and bounded exposure.
- `http://127.0.0.1:5173/` and `http://127.0.0.1:5173/app/cases/FS-1042`: V1 frontend application renders cleanly with zero console regressions.
