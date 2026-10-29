# Product inventory and simplification record

This records the state of the application before the simplification on `v2-rebuild` (base commit `080a758`), how
each feature was classified, and what happened to it.

**Classification key:** CORE = essential to the investigation workflow · SUPPORTING = useful, should not dominate ·
ADVANCED = for technical users · REDUNDANT = duplicated elsewhere · BROKEN/UNVERIFIED = could not be trusted as built.

## Pages before the change

| Old route | Page | Data source | Class | Outcome |
|---|---|---|---|---|
| `/` | LandingPage: marketing hero, demo tree with hardcoded nodes, metric cards | Static data, V2 trace | REDUNDANT | Replaced by a short Home page that answers what it is, what you can do, and where to start. |
| `/guided-investigation`, `/demo` | GuidedInvestigationPage: 6-step tour | FS-1042 (V1) mixed with ACC-000001 (V2) | BROKEN | Removed and redirected to `/cases/FS-2001`. It recorded FS-1042 reviews against V2 account ACC-000001, a fabricated link (below). |
| `/app/dashboard` | DashboardPage: FS-1042 metrics and charts | V1 case APIs | REDUNDANT | Removed and redirected to `/cases/FS-1042`. Same facts appear in the case Summary. |
| `/cases`, `/app/cases` | CasesPage: metric cards, table, create-case modal | `GET/POST /api/cases` | CORE | Replaced by InvestigationsPage (ID, summary, amount, status, data source, last activity, next action, search and filter). Case creation is still in the API, not the UI (a new case needs transactions loaded separately). |
| `/cases/:id`, `/app/cases/:id` | CaseDetailPage: 5 tabs, 1,700 lines, navy-styled review panel | V1 case APIs | CORE | Replaced by CaseWorkspacePage (Summary · Money flow · Accounts & risk · Review & history). The fund-flow tree and list views are reused. |
| `/fund-flow`, `/app/fund-flow` | FundFlowPage: account or case trace explorer | V2 trace, V1 graph | ADVANCED | Kept at `/tools/fund-flow`. Fixed wrong preset labels and case links. |
| `/workspace`, `/v2` | V2SearchPage: account lookup | V2 ledger | ADVANCED | Kept at `/tools/accounts`. Fixed preset cards (see data fixes). |
| `/accounts/:id`, `/v2/accounts/:id` | V2AccountDetailPage: profile, live analysis, ledger, review tab | V2 APIs | ADVANCED | Kept at `/tools/accounts/:id`. Its fake review form was removed. |
| `/insights`, `/app/model-insights` | ModelInsightsPage: model metrics, comparison, SHAP drill-down | `GET /api/v2/models/status` | ADVANCED | Kept at `/tools/model`. |
| `/app/transaction-check` | TransactionCheckPage: PaySim scoring | `POST /api/risk/explain` | ADVANCED | Kept at `/tools/transaction-model`. Case-transaction linking removed. |
| `/audit`, `/app/audit` | AuditPage: global audit search and CSV export | `GET /api/audit` | SUPPORTING | Kept at `/tools/audit`. Account links now open the account inside its case. Each case also shows its own history. |

Every old address redirects to its new location and keeps its query string (covered by `frontend/src/test/routes.test.tsx`).

## Navigation

The header went from six items plus a "Guided Tour" button and a universal search box to **Home · Investigations ·
Tools**. The universal search was removed: it sent any `T…` ID to the PaySim tool tagged as case FS-1042. A
hardcoded `SCENARIO: FS-1042` ribbon on every page and a footer link to `/docs` (which the dev server does not
serve) were also removed.

## Data-integrity problems found and fixed

| Problem | Where | Fix |
|---|---|---|
| FS-1042 (accounts `V001`…`G700`) and the V2 ledger (`ACC-…`) were linked by a hardcoded special case that auto-created `ACC-000001` and let it be reviewed under FS-1042. | `sql_case_repository.update_account_review`, GuidedInvestigationPage | Special case removed. Reviews require the account to be in the case. A test verifies that cross-dataset reviews are rejected. |
| No sample case could honestly show account-level model results. | — | Added FS-2001, derived from the V2 ledger by a label-free rule with the ledger’s own IDs. Cases declare `account_dataset` explicitly (`app/data/case_sources.py`), and the UI calls the account model only for `v2_synthetic_ledger` cases. |
| The PaySim tool turned case transfers into PaySim inputs with invented balances (`oldbalanceOrg = amount`, `oldbalanceDest = 0`) and showed the score as "linked to" the case. | TransactionCheckPage, FundFlowInspector | Removed. The tool now states that it cannot score case transactions. |
| The account page's "Record Finding" form saved only to browser `localStorage` under a hardcoded `INV-COMPLIANCE-01`, then showed "Saved to Audit Trail". | V2AccountDetailPage | Removed. The page now points to the case review, which persists on the server. |
| The account page linked any unknown account to "Open Incident Dossier (FS-1042)". | V2AccountDetailPage | Now links to the investigations list. |
| Account-lookup presets showed training labels as findings ("Money Mule Demo") and were wrong: `ACC-000010` was shown as "Arjun Sengupta (Normal) · Zero suspicious activity", but the ledger record is Meera Bhat, labelled a mule feeder. `ACC-000003` was called "2 steps away" but is the first receiver. | V2SearchPage, FundFlowPage | Replaced with neutral facts from the records. |
| `review_completed` was shown as "Cleared". | unifiedFlowAdapter | Now "Review completed". |
| Every case page view wrote a `trace_paths_persisted` audit event (1,259 in the local DB), burying real decisions. | `save_trace_paths` | The event is written only when the traced paths change. The case history hides system events by default. |
| Seeded placeholder review rows (`system_seeder`) were shown like human decisions. | Case UI | Shown as "No decision yet". Decision counts use only `account_review_recorded` events. |
| Model status was "healthy" whenever the model file existed, even if it could not load. Error messages exposed server file paths. The header claimed a "rule fallback". | `ml_service.get_model_status`, header | Readiness now comes from a real load attempt, and `status_detail` gives the reason. Paths stay in server logs only. The header shows Model ready, Model unavailable or Server unreachable, with the reason. |
| Audit timestamps (naive UTC) were displayed as local time. | UI | Converted correctly. |

## Components removed (no remaining importers after the rebuild)

`LandingPage`, `GuidedInvestigationPage`, `DashboardPage`, `CasesPage`, `CaseDetailPage`, `Header`, `Sidebar`,
`CytoscapeGraph`, `V2BankingDashboardRow`, `V2DemoTreeVisual`, `AccountProtectionPanel`, `common/Button`,
`common/Badge`, `common/MetricCard`. Their tests were removed with them (`casesPage`, `caseDetailPage` and
`guidedInvestigationPage` tests, plus the Badge, MetricCard and AccountProtectionPanel cases). Tests that asserted
the removed misbehaviour (the local-only review, the FS-1042 dossier link, PaySim case deep links) were rewritten
to assert the corrected behaviour. New coverage is in `caseWorkspace.test.tsx` and `routes.test.tsx`, and on the
backend in `test_product_integrity.py`.

No backend endpoint, database, dataset or model artifact was removed.

## Demo-readiness acceptance (29 Oct 2026)

| Finding | Fix |
|---|---|
| The documented `alembic upgrade head` crashed (`NameError: os` in `alembic/env.py`). The existing migration test injected a URL and never reached that code path. | Added the import, plus a test that runs migrations through `DATABASE_URL` the way the README does. |
| The backend test suite wrote audit events (and, in earlier runs, test reviews) into the local demo database. | `tests/conftest.py` now points the case database at a temporary file before the app is imported. |
| Four ML tests failed when run from `backend/` (paths relative to the repo root), although `ml/README.md` documents that command. | The paths are now resolved from the repository root. |
| Legacy FS-1042 reviews of `ACC-000001` looked like valid current reviews. | The case history labels reviews of accounts outside the case's transfers as **Legacy record**. The stored records are unchanged. |
| The main JavaScript bundle was 1,789 KB, mostly cytoscape (415 KB), recharts (~330 KB with its dependencies) and gsap (111 KB). | The six Tools pages are lazy-loaded. The main bundle is now 598 KB (190 KB gzipped), and cytoscape and recharts load only on Tools account and model pages. |

## Account model audit (29 Oct 2026)

The account model was audited and replaced (`v2-account-1.0.0` → `v2-account-2.0.0`). Root cause, label defects,
evaluation design and results are in [`ACCOUNT_MODEL_AUDIT.md`](ACCOUNT_MODEL_AUDIT.md).
