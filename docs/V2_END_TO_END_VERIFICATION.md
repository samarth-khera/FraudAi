# FraudShield AI V2 — Phase 6: End-to-End Verification & Operational Documentation

## Executive Overview
Phase 6 validates the complete end-to-end investigator workflow across FraudShield AI V2's forensic intelligence architecture and verifies 100% backward compatibility with V1 classic routes.

The verification encompasses real database queries over the 10,000-account synthetic core banking ledger, multi-hop BFS graph traversal with cycle safety, dual risk scoring (Deterministic Heuristic Rules + XGBoost Tabular Gradient Boosting with native local TreeSHAP attribution), and persistent human compliance audit trails.

---

## 1. Verified System Architecture & Setup Instructions

### Prerequisites
- Python 3.11+ / Python 3.12 with virtual environment at `backend/.venv`
- Node.js 20+ with npm

### Starting the Backend Services
```bash
cd /Users/samarthkhera56/FraudAi
source backend/.venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
- API Documentation (Swagger UI): `http://127.0.0.1:8000/docs`
- V2 Health Endpoint: `http://127.0.0.1:8000/api/v2/models/status`

### Starting the Frontend Development Server
```bash
cd /Users/samarthkhera56/FraudAi/frontend
npm run dev
```
- V2 Forensic Investigation Workspace: `http://127.0.0.1:5173/v2`
- V1 Classic Case Management: `http://127.0.0.1:5173/app/dashboard`
- Public Marketing Landing Page: `http://127.0.0.1:5173/`

---

## 2. End-to-End Investigation Workflow

### Step 1: Account Identifier Intake (`/v2`)
- The investigator enters an account ID (e.g. `ACC-000001` or shorthand `1` / `000001`).
- The search bar intelligently normalizes the input to canonical `ACC-XXXXXX` format.
- Recent investigations are preserved in local storage for instant re-access.
- Curated educational benchmark cases are filterable by typology (`Victim`, `Mule`, `Counterparty`, `Baseline`).

### Step 2: 360° Account Dossier Inspection (`/v2/accounts/:accountId`)
- **Observed Core Ledger Facts**: Verified customer KYC tier, current ledger balance (₹1,77,156.23), opening balance, net flow, and transacted counterparties.
- **Model Score Divergence Banner**:
  - Highlights divergence between ML statistical score (76.5/100, High) and deterministic rule baseline (25.0/100, Low).
  - Explains that the anomalous debit of ₹250,000 represents savings depletion during an Authorized Push Payment (APP) scam, rather than perpetrator money laundering.
  - TreeSHAP feature breakdown attributes exact marginal log-odds: `max_amount` (+3.9147), `initial_balance` (+1.1385), `current_balance` (-0.2986).
- **Rule Assessment Grid**: Audits 8 deterministic signals confirming 0 rapid pass-through (<120m), 0 structuring deposits, and 20.0x amount spike.

### Step 3: Interactive Multi-Hop Fund Tracing (`/v2/accounts/:accountId?tab=trace`)
- Renders directional Cytoscape graph canvas over `GET /api/v2/trace`.
- **Interactive Path Highlighting**: Clicking any node highlights incoming flow edges in green/teal, outgoing dispersal edges in red/amber, and dims unconnected background nodes.
- **Node Inspector Drawer**: Displays account profile, KYC tier, balance, and direct **Connected Graph Transfers** (inflows & outflows with counterparty IDs and amounts).
- **Attributed Exposure Guardrail**: Distinctly displays **Observed Ledger Movement** alongside **Attributed Exposure Ceiling** (1st-hop initial flow from root), strictly preventing downstream double-counting.

### Step 4: Human Compliance Adjudication & Audit Trail Persistence
- Investigator selects compliance determination: `Confirmed Compromised Victim (Innocent)`.
- Records rationale: *"Verified unauthorized debit during APP scam; victim credentials compromised. Dispersed to mule ACC-000002. Automated freeze prohibited."*
- Clicks **Record Finding**: The decision and timestamp are appended to the immutable local audit trail.
- Upon page reload, the state, rationale, and full chronological audit history persist seamlessly.

---

## 3. Comparative Entity Analysis

| Metric | Compromised Victim (`ACC-000001`) | Layering Mule (`ACC-000002`) | Legitimate Retail Baseline (`ACC-000010`) |
| :--- | :--- | :--- | :--- |
| **Customer Name** | Aditi Joshi | Sara Bhat | Arjun Sengupta |
| **Customer Type** | Retail (Tier 2 Verified) | Retail (Tier 2 Verified) | Retail (Tier 2 Verified) |
| **Current Balance** | ₹1,77,156.23 | ₹2,104.50 | ₹1,24,500.00 |
| **Total Recorded Txns** | 56 transactions | 33 transactions | 50 transactions |
| **Deterministic Rule Risk** | **25.0 / 100 (Low)** | **60.0 / 100 (Elevated)** | **0.0 / 100 (Low)** |
| **Rapid Pass-Through** | **Not Observed (False)** | **DETECTED (True, <12m dwell)** | **Not Observed (False)** |
| **Flow-Through Ratio** | 1.43x | 0.99x (99% dispersed) | 0.33x (High retention) |
| **Machine Learning Risk** | **76.5 / 100 (Statistical Outlier)** | **62.4 / 100 (Elevated)** | **0.0 / 100 (Low)** |
| **Divergence Warning** | **Active (Audit Required)** | None (Scores aligned) | None (Scores aligned) |
| **Recommended Action** | Evidence Review / Victim Protection | Priority Mule Interception | Routine Monitoring |

---

## 4. Edge Cases & Error Recovery Verification

1. **Unknown Account Identifier (`/v2/accounts/ACC-UNKNOWN-999`)**:
   - Clean 404 error page displayed with explicit message: *"Account Not Found in Core Ledger"*.
   - Recovery actions provided: "Return to Search Workspace" and "Try Sample Case (ACC-000001)".
2. **Graph Perimeter Truncation**:
   - Traversal ceiling (50 nodes max) triggers explicit alert: *"Graph Perimeter Truncated: Configured max_nodes limit reached."*
3. **Mobile Viewport Optimization (390×844)**:
   - Header, hero search input, quick test chips, and stacked sample cards scale cleanly without horizontal scroll blowout.

---

## 5. V1 Classic Backward Compatibility Verification

- **Marketing Landing Page (`/`)**: 100% operational with brand hero, feature highlights, and app launch links.
- **Case Management Dossier (`/app/cases/FS-1042`)**: 100% operational with case details, audit history timeline, pinned evidence, and graph canvas undisturbed.
- **Transaction Checker (`/app/transaction-check`)**: PaySim benchmark model inference operational.

---

## 6. Verification Test Suite Results

```bash
# Frontend Tests (Vitest)
npm --prefix frontend test -- --run
# Result: 21 passed (21/21) in 1.16s

# Frontend Production Build
npm --prefix frontend run build
# Result: 0 errors in 329ms (387.70 kB gzip)

# Backend Tests (Pytest)
backend/.venv/bin/pytest backend/tests/
# Result: 141 passed in 2.15s
```

---

## 7. Known Limitations & Regulatory Ethical Boundaries

1. **Synthetic Data Provenance**: Training datasets and topological scenarios originate from reproducible synthetic simulation (`scripts/generate_synthetic_bank_data.py`). They do not represent real human financial records.
2. **Advisory Decision Support Only**: Algorithmic outputs (both rule heuristic and XGBoost gradient boosting) are decision-support signals designed to prioritize human review queues.
3. **Strict Prohibition on Automated Punitive Actions**: Automated freezing of accounts, denying consumer access, or blocking payment cards based solely on ML outputs is strictly prohibited by institutional policy.
