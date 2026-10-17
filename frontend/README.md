# FraudShield AI — Frontend Investigation Dashboard

Interactive, fintech-grade investigation dashboard and financial network explorer for FraudShield AI.

Built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS v4**, **React Router v7**, **Lucide React**, **Recharts**, and **Cytoscape.js**.

---

## Visual Design Identity

The UI synthesizes four distinct design systems into a unified fintech experience:
1. **Application Workspace**: Very light ice-blue/lavender backdrop, white translucent surfaces with restrained glassmorphism, rounded cards, and high-contrast typography.
2. **Marketing Landing Page**: Confident headline (*"Trace the Flow. Protect the Innocent."*), purple-to-blue gradients, interactive product preview, and workflow architecture.
3. **Investigation Center**: Deep dark navy sidebar (`#0c1427`), responsive top navigation, real-time connectivity badge, and clean analyst workspaces.
4. **AI & Model Insights**: Refined dark slate surface with restrained glow, presenting real offline test metrics from the PaySim XGBoost model.

---

## Routes & Pages

| Route | Page | Description |
|---|---|---|
| `/` | **Landing Page** | Marketing showcase explaining human-in-the-loop fraud tracing, interactive preview, and research disclaimers. |
| `/app/dashboard` | **Investigation Overview** | Real-time metric cards, Recharts status breakdown, case distribution, and recent case activity table. |
| `/app/transaction-check` | **Risk Scoring** | Strict Pydantic-validated transaction scoring form connected to `/api/risk/score`, with preset scenario loaders and decision-support guidance. |
| `/app/fund-flow` | **Network Explorer** | Interactive directed Cytoscape graph of downstream transaction hops, pan/zoom/reset, account node and edge selection inspectors, and list/graph view toggle. |
| `/app/cases` | **Case Management** | Paginated case repository, case creation modal, status filtering, and search. |
| `/app/cases/:caseId` | **Case Detail** | Deep-dive case workspace: transaction table with CSV export, interactive graph, account review adjudication modal, and append-only audit trail timeline. |
| `/app/model-insights` | **Model Insights** | Real PaySim test evaluation results (98.6% precision, 83.6% recall, 0.9828 PR-AUC), confusion matrix, and model architecture comparison. |

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node 20+)
- Running FraudShield AI backend at `http://127.0.0.1:8000`

### Installation & Development

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server on port 5173
npm run dev
```

The Vite dev server proxies all `/api/*` calls directly to `http://127.0.0.1:8000`.

### Production Build & Tests

```bash
# Run unit & component tests
npm test

# Run production build
npm run build
```

---

## Core Principles & Human-in-the-Loop Safeguards

- **Decision-Support Only**: Risk scores and graph traces inform investigators; no account is ever automatically frozen.
- **Strict Validation**: All risk scoring fields adhere directly to the pre-transaction feature schema.
- **Truthful Analytics**: Only real backend data and authentic PaySim offline metrics are rendered; no synthetic production claims or fake AI assistants.
