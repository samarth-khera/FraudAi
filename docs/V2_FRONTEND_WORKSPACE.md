# FraudShield AI V2 — Forensic Investigation UI Documentation

## Executive Overview
Phase 5 establishes FraudShield AI V2's premium financial forensics workspace, delivering a purpose-built, audit-grade investigation suite under dedicated `/v2` routes while preserving V1 classic routes (`/app/*` and `/`) completely intact.

The workspace is engineered directly against real Phase 2 synthetic core banking ledger APIs (10,000 accounts, 350,000 transactions) and Phase 3/4 dual risk-assessment engines (Deterministic Rule Baseline + XGBoost Tabular Gradient Boosting with TreeSHAP feature attribution).

---

## Architecture & Visual System

### 1. Art Direction & Design Tokens
In compliance with tier-1 institutional risk intelligence standards, the UI eschews generic admin templates, neon gradients, and disruptive glassmorphism in favor of high-legibility, data-dense tokens:
- **Navigation & Brand Spine**: Deep Midnight Navy (`#0B1322`) with teal accents (`#2DD4BF`).
- **Investigation Canvas**: Warm Off-White (`#F5F4F0`) for sustained analyst focus.
- **Surface Elevation**: Clean stark white (`#FFFFFF`) cards with fine hairline borders (`#E2DFD7` / `#CFCBC0`) and subtle 2xs drop shadows.
- **Restrained Semantic Palette**:
  - **Teal (`#0D9488` / `#0F766E`)**: Primary actions, root accounts, directional selections, verified identities.
  - **Amber (`#D97706` / `#B45309`)**: Model score divergences, circular fund loops, audit-required states, truncation warnings.
  - **Emerald (`#059669`)**: Low risk states, inbound credits, net positive ledger balance.
  - **Crimson (`#DC2626`)**: High risk deterministic signals, outbound debits, rapid balance drains.
  - **Slate (`#475569` / `#0F172A`)**: High-contrast typography, monospace ledger identifiers, and transaction hashes.

---

## Implemented Routes & Capabilities

### A. `/v2` — Account Investigation Workspace (`V2SearchPage.tsx`)
- **Primary Search Hero**: Clean, centered account query bar supporting Enter-to-investigate with autofocus and intelligent normalization (`000001` or `acc-000001` automatically formats to `ACC-000001`).
- **Recent Investigations Bar**: Automatically tracks recently inspected accounts in `localStorage` with single-click jump and clear history actions.
- **Quick Test Chips**: Instant 1-click loading for key synthetic cases: `ACC-000001 (Victim)`, `ACC-000002 (Mule)`, `ACC-000003 (Hop 2)`, `ACC-000010 (Retail Baseline)`.
- **Curated Educational Scenarios**: 4 distinct live ledger accounts grounded in real database records:
  1. `ACC-000001` (**Aditi Joshi**): Synthetic Authorized Push Payment (APP) scam victim demonstrating model score divergence (ML: 76.5 vs Rule: 25.0) and innocent account protection safeguards.
  2. `ACC-000002` (**Sara Bhat**): Intermediate layering mule routing illicit funds with rapid pass-through (<12 min dwell time) between victim and cashout accounts.
  3. `ACC-000003` (**Ishan Reddy**): Downstream recipient counterparty evaluating multi-hop attribution bounds and hop distances.
  4. `ACC-000010` (**Arjun Sengupta**): High-volume legitimate retail baseline with steady velocity, normal counterparty diversity, and low risk scores across both engines.
- **Educational Scenario Metadata Notice**: Explicit disclaimer that ground-truth scenario tags are strictly offline validation metadata, never runtime evidence.
- **Engine Status Badge**: Real-time integration with `GET /api/v2/models/status` verifying inference readiness, active model versions (`v2-account-1.0.0`), features count (26), held-out ROC-AUC (99.45%), and institutional safety disclaimers.

### B. `/v2/accounts/:accountId` — 360° Account Intelligence (`V2AccountDetailPage.tsx`)
1. **Forensic Evidence & Governance Hierarchy Bar**:
   - Delineates 4 distinct evidentiary tiers:
     - **Tier 1: Observed Ledger Facts**: Core banking account profile, verified KYC tier, initial opening balance, current ledger balance, running balance, and transacted counterparties.
     - **Tier 2: Rule-Based Forensic Signals**: Phase 3 deterministic heuristic analysis (velocity, flow-through ratio, rapid pass-through, amount spike ratio, circular loops, dwell times).
     - **Tier 3: Statistical ML Model Predictions**: Phase 4 Tabular XGBoost gradient boosting, calibrated risk score (0–100), predicted probability, and native local TreeSHAP attribution.
     - **Tier 4: Human Compliance Adjudication**: Non-punitive decision support; automated punitive actions are strictly prohibited.
2. **Model Score Divergence & Victim Protection Banner (`V2ModelDivergenceAlert.tsx`)**:
   - Explicitly flags when ML risk score (76.5/100) conflicts with deterministic rule baseline (25.0/100) and transaction tenure.
   - Explains that an anomalous high-value single debit drains legitimate savings during an APP scam rather than routing illicit funds.
   - **Crucial Ethical Safeguard**: Prominently prohibits automated freezing, service denial, or adverse reporting without human analyst verification of destination money mules.
3. **Interactive Human Compliance Adjudication Panel**:
   - Compliance status selector (`Pending Analyst Review`, `Under Active Inquiry`, `Confirmed Compromised Victim (Innocent)`, `Escalated for Mule Interception`, `Cleared / Legitimate Operations`).
   - Rationale & case notes scratchpad persisting to `localStorage` per account.
   - Immutable audit logging reminder.
4. **Tabbed Investigation Views**:
   - **Tab 1: Risk Assessment & Model Intelligence**:
     - *Machine Learning Panel*: Calibrated Risk Score (0–100), Risk Level badge, Class Probability, and **Local TreeSHAP Feature Attribution** (`V2TreeShapBreakdown.tsx`) displaying exact marginal log-odds impacts (`+Δ Log-Odds`) with directional risk bars.
     - *Deterministic Rule Baseline Panel*: Heuristic Risk Score, Recommended Compliance Action, Velocity (24h), Flow-Through Ratio, Rapid Pass-Through flag, Amount Spike Multiplier, Dwell Time, Circular Loop detection, and Institutional Evidence Blindspots.
   - **Tab 2: Interactive Fund Flow Explorer (`V2CytoscapeGraph.tsx`)**:
     - Real multi-hop traversal powered by Cytoscape.js.
     - Layout selectors: **Radial Hop Perimeter (Concentric)**, Force-Directed Organic (`cose`), Hierarchical Flow (`breadthfirst`), and Circular Topology.
     - **Interactive Path Highlighting**: Clicking any node highlights incoming flow edges in green/teal, outgoing dispersal edges in red/amber, and dims unconnected background nodes.
     - **Node Inspector Drawer**: Displays account profile, KYC tier, current balance, and direct **Connected Graph Transfers** (inflows & outflows with counterparty IDs and amounts).
     - **Attributed Exposure Guardrail**: Distinctly displays **Observed Ledger Movement** alongside **Attributed Exposure Ceiling** (1st-hop initial flow from root), strictly preventing downstream double-counting.
     - Traversal parameter controls: Direction (Outbound Dispersal vs Inbound Aggregation) and Hop Depth (1 to 5 hops).
     - Alternative accessible tabular view ("Transfers List") with transaction search and node filtering.
   - **Tab 3: Transaction Ledger History**:
     - Complete dual-entry ledger records with directional badges (`INBOUND` / `OUTBOUND`), Counterparty deep-links, Rail Channels (UPI, IMPS, NEFT, CARD_POS), Transaction Amounts, and Balance After.
     - Text search filter for transaction ID or counterparty, direction filters, and pagination controls.

---

## Live Google Chrome Visual Verification

All V2 routes and states were executed and validated in genuine interactive Google Chrome sessions with recorded WebP videos and PNG screenshots:

| View / State | Route / Target | Verified Features & Rendered Artifacts |
| :--- | :--- | :--- |
| **Search Workspace** | `/v2` | Hero search, quick test chips, recent searches, model status. Screenshot: `v2_search_workspace_1792570478516.png` |
| **Victim Intelligence & Divergence** | `/v2/accounts/ACC-000001` | Evidence hierarchy, amber divergence banner (76.5 vs 25.0), TreeSHAP feature bars, rule baseline. Screenshot: `v2_account_000001_profile_1792570489050.png` |
| **Human Adjudication Recording** | `/v2/accounts/ACC-000001` | Adjudication selector, rationale notes, saved badge. Screenshot: `v2_adjudication_saved_1792570545145.png` |
| **Interactive Fund Flow Canvas** | `/v2/accounts/ACC-000001?tab=trace` | Cytoscape graph canvas, 50 nodes, directed edges, exposure bound ₹4,10,886.78. Screenshot: `fund_flow_explorer_full_1792570591580.png` |
| **Node Inspector & Connected Transfers** | `/v2/accounts/ACC-000001?tab=trace` | Node inspector drawer with connected inflows/outflows. Screenshot: `graph_fitted_1792570603405.png` |
| **Layering Mule Profile** | `/v2/accounts/ACC-000002` | Sara Bhat profile, rapid pass-through DETECTED (Rule Risk: 60.0). Screenshot: `v2_mule_account_sara_1792570654513.png` |
| **404 Account Not Found** | `/v2/accounts/ACC-UNKNOWN-999` | Clean error card with recovery CTA to search workspace. Screenshot: `v2_account_not_found_1792570670668.png` |
| **Mobile Responsive Layout** | `/v2` (390×844) | Compact mobile header, search bar, vertically stacked sample cards. Screenshot: `v2_mobile_search_workspace_1792570685336.png` |

---

## Automated Verification Suite

- **Frontend Tests (`vitest run`)**:
  - `src/test/api.test.ts` (4 passed)
  - `src/test/components.test.tsx` (5 passed)
  - `src/test/routes.test.tsx` (2 passed)
  - `src/test/v2.test.tsx` (9 passed: account normalization, divergence alert, TreeSHAP breakdown, search page, 360° intelligence, evidence hierarchy, human adjudication)
  - **Result**: `20 passed (20/20) in 1.12s`
- **Frontend Production Build**:
  - `npm run build` (`tsc -b && vite build`): Succeeded cleanly (0 errors, 333ms).
- **Backend Tests (`pytest backend/tests/`)**:
  - **Result**: `141 passed in 2.48s`
