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
- **Surface Elevation**: Clean stark white (`#FFFFFF`) cards with fine hairline borders (`#E2E8F0` / `#CBD5E1`) and subtle 2xs drop shadows.
- **Restrained Semantic Palette**:
  - **Teal (`#0D9488` / `#0F766E`)**: Primary actions, root accounts, directional selections, verified identities.
  - **Amber (`#D97706` / `#B45309`)**: Model score divergences, circular fund loops, audit-required states, truncation warnings.
  - **Emerald (`#059669`)**: Low risk states, inbound credits, net positive ledger balance.
  - **Crimson (`#DC2626`)**: High risk deterministic signals, outbound debits, rapid balance drains.
  - **Slate (`#475569` / `#0F172A`)**: High-contrast typography, monospace ledger identifiers, and transaction hashes.

---

## Implemented Routes & Capabilities

### A. `/v2` — Account Investigation Workspace (`V2SearchPage.tsx`)
- **Primary Search Hero**: Clean, centered account query bar supporting Enter-to-investigate with autofocus and format validation (`ACC-XXXXXX`).
- **Curated Educational Scenarios**: 4 distinct live ledger accounts grounded in real database records:
  1. `ACC-000001` (**Aditi Joshi**): Synthetic Authorized Push Payment (APP) scam victim demonstrating model score divergence (ML: 76.5 vs Rule: 25.0) and innocent account protection safeguards.
  2. `ACC-000002` (**Sara Bhat**): Intermediate layering mule routing illicit funds with rapid pass-through (<12 min dwell time) between victim and cashout accounts.
  3. `ACC-000003` (**Ishan Reddy**): Downstream recipient counterparty evaluating multi-hop attribution bounds and hop distances.
  4. `ACC-000010` (**Arjun Sengupta**): High-volume legitimate retail baseline with steady velocity, normal counterparty diversity, and low risk scores across both engines.
- **Engine Status Badge**: Real-time integration with `GET /api/v2/models/status` verifying inference readiness, active model versions (`v2-account-1.0.0`), and institutional safety disclaimers.

### B. `/v2/accounts/:accountId` — 360° Account Intelligence (`V2AccountDetailPage.tsx`)
1. **Core Identity & Financial Summary Strip**:
   - Customer profile: Name, Account ID, Customer Type (Retail, Student, Business), KYC Tier (Tier 1 Basic, Tier 2 Verified, Tier 3 Enhanced), Tax Identifier, and UPI VPA.
   - Financial ledger metrics: Current Balance, Initial Opening Balance, Net Ledger Flow (`+` / `-`), and Count of Unique Transacted Counterparties.
2. **Model Score Divergence & Victim Protection Banner (`V2ModelDivergenceAlert.tsx`)**:
   - Explicitly flags when ML risk score (e.g. 76.5/100) conflicts with deterministic rule baseline (25.0/100) and transaction tenure.
   - Clarifies that an anomalous high-value single debit drains legitimate savings during an APP scam rather than routing illicit funds.
   - **Crucial Ethical Safeguard**: Prominently prohibits automated freezing, service denial, or adverse reporting without human analyst verification of destination money mules.
3. **Tabbed Investigation Views**:
   - **Tab 1: Risk Assessment & Model Intelligence**:
     - *Machine Learning Panel*: Calibrated Risk Score (0–100), Risk Level badge, Class Probability, and **Local TreeSHAP Feature Attribution** (`V2TreeShapBreakdown.tsx`) displaying exact marginal log-odds impacts (`+Δ Log-Odds`) with directional risk bars.
     - *Deterministic Rule Baseline Panel*: Heuristic Risk Score, Recommended Compliance Action, Velocity (24h), Flow-Through Ratio, Rapid Pass-Through flag, Amount Spike Multiplier, Dwell Time, Circular Loop detection, and Institutional Evidence Blindspots.
   - **Tab 2: Interactive Fund Flow Explorer (`V2CytoscapeGraph.tsx`)**:
     - Real multi-hop traversal powered by Cytoscape.js.
     - Layout selectors: **Radial Hop Perimeter (Concentric)**, Force-Directed Organic (`cose`), Hierarchical Flow (`breadthfirst`), and Circular Topology.
     - **Attributed Exposure Guardrail**: Distinctly displays **Observed Ledger Movement** (sum of all transfers across hops) alongside **Attributed Exposure Ceiling** (1st-hop initial flow from root), strictly preventing downstream double-counting.
     - Traversal parameter controls: Direction (Outbound Dispersal vs Inbound Aggregation) and Hop Depth (1 to 5 hops).
     - Node selection inspector drawer and edge inspection overlays.
     - Alternative accessible tabular view ("Transfers List") for keyboard and screen-reader accessibility.
   - **Tab 3: Transaction Ledger History**:
     - Complete dual-entry ledger records with directional badges (`INBOUND` / `OUTBOUND`), Counterparty deep-links, Rail Channels (UPI, IMPS, NEFT, RTGS), Transaction Amounts, and Balance After.
     - Direction filtering (`All Flows`, `Inbound Credits`, `Outbound Debits`) and pagination controls.

---

## Live Google Chrome Visual Verification

All V2 routes and states were executed and validated in genuine headless/interactive Google Chrome sessions:

| View / State | Route / Target | Verified Features & Rendered Artifacts |
| :--- | :--- | :--- |
| **Search Workspace** | `/v2` | Search bar, curated cards, live ML status pill. Screenshot: `v2_search_workspace_1792509355740.png` |
| **Victim Intelligence & Divergence** | `/v2/accounts/ACC-000001` | Amber divergence banner (76.5 vs 25.0), TreeSHAP feature bars, rule baseline. Screenshot: `v2_account_assessment_aditi_1792509369350.png` |
| **Interactive Fund Flow Canvas** | `/v2/accounts/ACC-000001?tab=trace` | Radial concentric graph, 50 nodes, directed edges, exposure bound ₹4,10,886.78. Screenshot: `v2_fund_flow_canvas_centered_1792510634095.png` |
| **Transaction Ledger** | `/v2/accounts/ACC-000001?tab=transactions` | 56 records, flow filters, balance after, counterparty links. Screenshot: `v2_transaction_ledger_history_1792509931257.png` |
| **Layering Mule Profile** | `/v2/accounts/ACC-000002` | Sara Bhat profile, rapid pass-through DETECTED (Rule Risk: 60.0). Screenshot: `v2_mule_account_sara_1792509940547.png` |
| **404 Account Not Found** | `/v2/accounts/ACC-NONEXISTENT` | Clean error card with recovery CTA to search workspace. Screenshot: `v2_account_not_found_1792509950020.png` |
| **Mobile Responsive Layout** | `/v2` (390×844) | Compact mobile header, search bar, vertically stacked sample cards. Screenshot: `v2_mobile_search_workspace_1792509961539.png` |
| **V1 Backward Compatibility** | `/app/fund-flow` | V1 classic interface completely untouched and functional. Screenshot: `v1_classic_dashboard_1792509464825.png` |

---

## Automated Verification Suite

- **Frontend Tests (`vitest run`)**:
  - `src/test/api.test.ts` (4 passed)
  - `src/test/components.test.tsx` (5 passed)
  - `src/test/routes.test.tsx` (2 passed)
  - `src/test/v2.test.tsx` (4 passed)
  - **Result**: `15 passed (15/15) in 1.85s`
- **Frontend Production Build**:
  - `npm run build` (`tsc -b && vite build`): Succeeded cleanly (0 errors, 475ms).
- **Backend Tests (`pytest backend/tests/`)**:
  - **Result**: `141 passed in 3.43s`
