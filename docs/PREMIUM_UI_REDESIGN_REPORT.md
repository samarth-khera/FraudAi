# FraudShield AI: premium UI redesign report

Date: 2 November 2026
Scope: frontend only (`frontend/src`). No backend, API contract, model, scoring, threshold, role logic, tracing, dataset, database,
authentication, security policy, environment variable or production data was changed.

## Verdict

**PREMIUM UI COMPLETE — VERIFIED**

The redesign is implemented in the real application, released to production through the normal fast-forward path, and
verified in a visible Google Chrome window against the live API: 35 of 35 checks passed on the final production build
([§9](#9-real-chrome-verification)). Limitations are listed in [§12](#12-known-limitations); none of them affects a
workflow, a calculation or a safeguard.

| | |
|---|---|
| Branch | `feat/premium-fraudshield-ui` |
| Code commits | `a9a2830` redesign, `5fcf576` layout shift and tablet fixes, `197b4e3` dropped-connection retry, `c2b308e` audit and transaction-check labels |
| Released to `main` | `dc15b4b` → `c2b308e` by fast-forward pushes (no force, no rewritten history) |
| `v2-rebuild` (Render) | unchanged at `072e4e5`; latest Render deploy still `dep-dbk098mq1p3s73b8q840` (no backend deploy) |
| Vercel previews | `5Qi1B7z3N8MU7SrHCF3xspptdwFJ` (`5fcf576`), `Ac1XCWBN7Qm8w1sEWWc9tk4Yhdfu` (`197b4e3`), `2sWm5hbvjpGnLuumrWWxFuJRnXoP` (`c2b308e`): all built successfully |
| Vercel production | `FUdCxPCo5MxvvZs4cmnhYd1FEomk` (`5fcf576`), `FEXqctgXJfRKQ6CG1XAR6Tf5WMVs` (`197b4e3`), `J6prunB2VsmWa6o6KZBV7ZNbp5Jb` (`c2b308e`) |
| Live site | https://fraudshield-ai-psi.vercel.app (main bundle `index-3keoucX7.js`, identical to a local build of `c2b308e`) |
| Commit identity | author and committer `Samarth Khera <188962529+samarth-khera@users.noreply.github.com>`; GitHub attributes every commit to `samarth-khera`; no co-author or AI attribution |

## 1. What changed, in one paragraph

The interface now reads as one product. A token-based design system replaces about 2,300 hardcoded colours. A foldable
sidebar, a breadcrumb top bar and a focus-trapped mobile drawer form one shell for every route. The Overview is an executive
dashboard built only from existing API data. The investigation workspace leads with a fund-flow tree that draws itself
outward from the investigated account, shows amount and time on every transfer, and marks inferred links and review
recommendations; on phones it becomes a nested list that keeps every hop. Evidence is labelled by kind everywhere: recorded
fact, fixed rule, model output, possible interpretation, not known. Motion is restrained, consistent and never in the way;
reduced motion is respected, and nothing waits for an animation.

## 2. Design system

All tokens live in `frontend/src/index.css` (`@theme`); chart and graph libraries read the same values from
`frontend/src/lib/palette.ts`.

**Colour**

| Role | Token | Value | Use |
|---|---|---|---|
| Canvas | `canvas`, `canvas-2` | `#F5F6FF`, `#EEF1FE` | application background (lavender ice), sidebar wash |
| Surface | `panel`, `well`, `well-strong` | `#FFFFFF`, `#F7F8FD`, `#EEF0F8` | floating panels, recessed areas |
| Lines | `line`, `line-strong` | `#E5E7F2`, `#D5D9E8` | hairlines, inputs |
| Ink | `ink`, `ink-soft`, `mute`, `faint` | `#17182B`, `#34374E`, `#575E7D`, `#646A88` | text hierarchy |
| Accent | `iris`, `iris-deep`, `iris-soft`, `iris-wash`, `iris-line` | `#6558E8`, `#4B3DD0`, … | primary accent (indigo-violet) |
| Accent | `ice`, `ice-deep`, `ice-soft`, `ice-line`, `info` | `#4385F5`, `#1F5FCF`, … | secondary accent (blue) |
| Meaning | `ok`, `warn`, `danger` (+ `-fill`, `-soft`, `-line`) | `#157A42`, `#8F5806`, `#B3163F` | verified, review, severe |
| Rule severity | `sev-critical/high/elevated/low` | unchanged | risk labels only |

Rules that the code follows:
- The violet-to-blue gradient means **money in motion** and appears only on fund-trail connectors, the primary action and
  the "you are here" marker in navigation.
- Green is used only for verified or validated states (models validated on a dataset, append-only audit, account active).
  Money received is blue and money sent violet, so neither direction reads as "good". A SHAP factor that lowers a score is
  blue, not green.
- Amber means a person should review; red is kept for genuinely severe states. No colour on its own implies guilt or an
  action, and every coloured state also has words.
- Contrast (WCAG): body and label text are AA on every surface they use (`mute` 6.4:1 and `faint` 4.8:1 on white;
  `iris` 5.1:1; `ice` is used for fills and icons only, `ice-deep` 5.8:1 for text).

**Type.** Schibsted Grotesk (kept: already a deliberate, readable choice) with IBM Plex Mono for identifiers only (account,
case and transaction IDs, model versions, feature names). One scale: page title 28 to 32px, section title 20px, card title
15px, lede 15px, labels 13px, meta 12px, metrics 28px. Sentence case throughout; the older pages' all-caps tracked labels,
black weights and title-case headings were converted (with their tests).

**Surfaces and depth.** Panels have a 16px radius (inner wells 12px, controls 10 to 12px), a hairline border and a soft
lavender-tinted shadow; hover lifts by 2px. Component classes (`panel`, `btn-primary`, `btn-secondary`, `btn-ghost`,
`btn-icon`, `field`, `data-table`, `skeleton`, type classes) sit in the `components` cascade layer, so utilities compose with
them instead of being silently overridden.

**Shared components.** `PageHeader` and `SectionHeader`, `Stat` (KPI value with label and context), `EvidenceTag` and
`EvidenceLegend` (the five evidence kinds, each with icon, words and a tooltip), `FlowMotif`, refreshed `LoadingState`,
`ErrorState`, `EmptyState`, `Pill` and a `SkeletonBlock`.

**Codemods.** Two scripted passes made the system consistent before page work: 2,278 hardcoded colour utilities in 43 files
became token utilities, and the older pages' type dialect (uppercase tracked labels, `font-black`, `rounded-3xl`, 9 to 10px
text) was harmonised. Dark "neon" surfaces on the transaction check were replaced.

## 3. Application shell (every route)

- **Sidebar** (large screens): brand, Workspace and Reference groups, active item on a white plate with a short violet-to-blue
  bar that slides between items (Motion `layoutId`), model status with its server explanation in a popover, the synthetic
  data notice, and a fold control. Folded (76px) it shows icons with tooltips; the choice is remembered per browser
  (storage failures are ignored). Small laptops (1024 to 1199px) start folded when nothing is stored.
- **Top bar**: breadcrumbs (Workspace › Cases, Cases › FS-2001, Reference › Audit log, Investigate › ACC-000001) and the
  dataset context ("Synthetic forensic scenario ledger" on a forensic investigation). On phones the trail appears under the
  menu bar for nested pages.
- **Mobile drawer**: a modal drawer over a dimmed page; focus moves into it, Tab stays inside, Escape and the scrim close it,
  focus returns to the menu button, and page scroll is locked while it is open.
- **Pages**: the document title follows the route ("FS-2001 – Cases – FraudShield AI"); a new page starts at the top while
  Back and Forward keep the browser's scroll restoration; the skip link is the first Tab stop.

## 4. Routes and components redesigned

| Route | What changed |
|---|---|
| `/` Overview | Executive dashboard from existing endpoints only: account entry with the subject motif, both ledgers with counts and model-validation status and data freshness, key figures (open cases, reported amount in open cases, review decisions recorded, audit events), cases table with next steps, recent audit activity with the log's integrity properties, investigation models with held-out results labelled as such, what the results mean, and the investigation sequence. Each panel loads and fails independently. |
| `/investigate` | Page header, dataset radio cards with check state and validation badges, account entry, starting-point chips, the result layout as a sequence. |
| `/investigate?account=…` | Account brief: monospace account header, assessment, activity and traceability panels, a call-to-action panel; honest running state (steps listed, no fake progress). |
| Investigation report | Header with investigation reference and timing; synthetic-data note; sticky stage tabs with a sliding Motion indicator and arrow-key navigation; each stage rises in on change; inspector as a Motion drawer. Victim assessment is tagged "Possible interpretation" with its evidence under "Recorded fact". |
| Fund trail | See §5. |
| `/cases` | Page header, unified search and filter fields, case cards with a clear next-step chip. |
| `/cases/:id` | Monospace case header with status and dataset pills and a key-figure block (reported loss, review decisions), sticky section navigation with sliding indicator, prev/next. Read-only behaviour unchanged. |
| `/tools/accounts` | Page header, lookup panel, example accounts with filter. |
| `/tools/accounts/:id` | Account hero: initials mark, name, status, copyable ID, currency/type/KYC pills, actions, five ledger figures; segmented section tabs; the evidence layering (recorded facts → fixed rules → model score → human review) shown with the shared evidence tags; hardcoded fallback names removed. |
| `/tools/model` | Header and API-driven status chips (a degraded status is shown as such, no longer as "Operational"), model cards with a white active plate instead of a black card; tabs appear only with data, so nothing jumps. |
| `/tools/audit` | Header with the store's integrity properties from `integrity_status` (replacing fixed "Healthy" text), sans labels, segmented filters. |
| `/tools/fund-flow` | Header, plain-language controls and summary labels, reserved space while the first trace loads. |
| `/tools/transaction-model` | Header with model pills, light surfaces in place of the dark neon panels, sans labels. |
| `/tools`, not-found, footer | Shared header, icon cards, refreshed footer. |

## 5. Investigation workspace and the fund-flow tree

**Structure.** The tree panel now leads the Fund trail stage: branch chips (Out and In) sit in the panel's toolbar next to
zoom and fit, the canvas follows, and a legend explains the marks. The step-by-step branch story and the branch summary sit
under it side by side.

**Nodes** (226 × 82): account ID, assessed role with tone dot, then either the amount received or sent on the path, or the
review recommendation ("Verification recommended", "Urgent review recommended", "Restriction review recommended") with a
shield marker. The investigated account is the dark anchor with the customer's name.

**Connectors.** Amount and short time ("16 Jan, 10:23") on every transfer, full reference and channel in the tooltip and
inspector; flagged transfers have an iris ring; cycles are marked. **Solid** connectors are transfers recorded with the
investigated account as a party; **dashed** connectors are onward links inferred from timing and balances. This is the
observed-versus-inferred distinction made visible.

**Interaction.** Drag to pan, Ctrl or ⌘ + scroll to zoom, zoom buttons and fit; fold and unfold branches (+N shows what is
hidden); selecting an account or transfer lights up its connections and opens the inspector; keyboard focus keeps the focused
node on screen. The first fit frames the first branch in the upper part of the view and never below a readable scale (on
tablets it starts from the investigated account; the rest is a pan away).

**Motion.** On first appearance the trail draws itself outward from the investigated account: the root, then each hop's
connectors draw (GSAP stroke animation), labels fade in and accounts slide in from the side the money comes from. The whole
sequence takes about one second for three hops and is shown once per investigation. Unfolding draws only the new part;
folding and unfolding slide accounts to their new places (CSS transform transitions) and connectors follow (CSS `d`
transitions where the browser supports them). Every element is clickable from the first frame.

**Phones.** Below 768px the tree becomes a nested list read top to bottom: every hop keeps its amount, channel, time,
reference and a "linked by timing" note for inferred links; every account keeps its role and review recommendation; branches
fold with the same state as the wide tree; each row opens the same inspector.

## 6. Motion architecture

| | GSAP 3.15 (+ ScrollTrigger) | Motion (framer-motion 14.5) |
|---|---|---|
| Owns | orchestrated sequences | component-level presence and feedback |
| Where | `lib/motion/reveal.ts` (page, section and data-arrival reveals), `TrailTree` (the drawing), `FlowMotif` (overview motif) | sidebar and stage tab indicators (`layoutId`), mobile drawer, model status popover, inspector drawer, account tabs |
| Animates | `opacity`, `transform` of `[data-reveal]` wrappers; SVG stroke dash offset; inner node wrappers | `x`, `opacity`, `scale` of drawers, popovers and indicator plates |

The two never animate the same element: reveal targets are plain wrappers, node positions use CSS transforms on an outer
wrapper while GSAP animates an inner one, and Motion components are never marked for reveal.

**One reveal system.** `AppLayout` runs `useRevealSystem` once. A MutationObserver finds every `[data-reveal]` element added
to the page (route changes, data arriving, stage switches). Elements on screen rise in at once in document order with a
short stagger (header first, then sections; 0.5 s, `expo.out`, at most 0.36 s of stagger); elements below the fold get a
one-shot ScrollTrigger. Nested marked elements defer to the outer one. Focus moving into a hidden section reveals it
immediately; triggers are killed when their element leaves; positions are refreshed after layout changes; stopping the
system clears every inline style. The page's earlier one-off GSAP entrances (model, audit and account pages) were replaced
by it.

**Reduced motion and safety.** `motionMode()` reads `prefers-reduced-motion`: under reduced motion nothing is hidden for an
entrance, the trail appears at once and Motion keeps fades only (`MotionConfig reducedMotion="user"`); without media queries
(tests, server rendering) nothing animates and presence exits are immediate. GSAP work runs inside `gsap.context()` and is
reverted on unmount; ScrollTrigger is registered lazily. Print styles force every revealed element visible.

**Performance.** Only `opacity`, `transform` and SVG stroke properties animate; there is no continuous animation, and blur is
limited to the sticky bars. Layout shift measured in Chrome (cumulative, during load) is 0 to 0.005 on the key pages in
production and at most 0.025 on any page (it was up to 0.375 before the fixes in `5fcf576`). The main JavaScript chunk grew
from 766.8 KB to 849.9 KB (gzip 232.0 KB to 261.5 KB, +29.5 KB), mostly GSAP and ScrollTrigger moving into the main chunk;
CSS grew from 71.5 KB to 83.3 KB.

## 7. Accessibility

- Visible focus ring (2px iris outline) on every interactive element; the first 14 Tab stops of the Overview were checked.
- Skip link first; one `h1` per page (checked on all 13 routes at all four widths); landmarks for main, sidebar, breadcrumbs,
  and both navigation groups.
- Tabs keep `role="tab"` with arrow-key, Home and End support; the drawer is a modal dialog with a focus trap and Escape;
  the inspector is a labelled dialog; status popovers close with Escape and outside clicks.
- Evidence kinds, review recommendations and severities are always written, not only coloured.
- Contrast as listed in §2.

## 8. Tests, types, lint and build

| Check | Result |
|---|---|
| Frontend unit tests (Vitest) | **182 passed** in 11 files (172 before; 10 new) |
| TypeScript (`tsc -b`) | 0 errors |
| Lint (oxlint) | 0 errors, 145 warnings (146 before; none added) |
| Production build (`npm run build`) | passes; 12 content-hashed chunks |
| Backend tests | 582 passed (unchanged; no backend file changed) |
| ML tests | 90 passed (unchanged) |

New tests (`src/test/premiumShell.test.tsx`, `src/test/investigation.test.tsx`): route titles and breadcrumbs, document
titles, sidebar folding and persistence, drawer Escape and focus return, reveals never hiding content without motion,
evidence labels, Overview figures from the API and its failure states, the dropped-connection retry, and the phone fund-trail
list (hierarchy, amounts, references, folding, inspector).

Tests changed because visible copy changed (title case to sentence case, page titles aligned with navigation):
`v2.test.tsx`, `auditPage.test.tsx` (status chips now come from the API, checked after load), `modelInsightsPage.test.tsx`.
The account-lookup outage test in `investigation.test.tsx` now fails persistently and asserts the retry. `setup.ts` makes
Motion animations instant in tests.

## 9. Real Chrome verification

A visible Google Chrome 156 window (`headless: false`), driven by Playwright, on real data. Nothing was mocked; the browser
sent only reads (production writes are disabled anyway). The same 35-check script ran in four places:

| Run | Target | Result |
|---|---|---|
| Local development | Vite dev server + release-code backend on a production-identical ledger | 34 of 34 (first run: 33, layout shift too high, fixed in `5fcf576`) |
| Local production build | the minified build of `5fcf576` (`vite preview`) + the same backend | 35 of 35 |
| Production, `197b4e3` | https://fraudshield-ai-psi.vercel.app + https://fraudshield-api-rpok.onrender.com | 35 of 35 (an earlier run of `5fcf576` found one dropped API connection; fixed by `197b4e3`) |
| **Production, final `c2b308e`** | same | **35 of 35** (0 console errors, 0 failed requests, 0 CSP violations) |

What the 35 checks cover:
- All 13 routes (including the not-found page) at **1440 × 900, 1280 × 800, 768 × 1024 and 390 × 844**: no horizontal
  overflow, exactly one `h1`, and no section left hidden after scrolling through the page.
- Layout shift under 0.1 on Overview, account brief, case and model pages.
- All 8 sidebar links: destination, active marker and document title.
- Browser Back and Forward across Overview, Cases and a case, with content shown.
- Case workspace journey through all four sections.
- Model status popover (server explanation, Escape).
- Sidebar fold, persistence across reload, unfold.
- Keyboard: focus rings on the first 14 Tab stops; skip link first.
- A complete investigation: dataset picker (forensic ledger starting points), account brief, run, arrow-key stage tabs, the
  fund trail finishing its drawing with every account visible and inferred links dashed, branch picker, tree account to
  inspector (evidence labels present, Escape closes), fold and unfold, zoom and fit, every stage rendering content, and no AI
  explanation request sent (Gemini stays off).
- Account details: live analysis runs; every section tab opens.
- Reference tools: model tabs, audit filters, fund-flow list view, transaction model check scoring.
- Mobile drawer: focus starts inside, Tab stays inside, Escape closes and returns focus, a link navigates and closes it.
- Reduced motion: no section hidden for an entrance; the fund trail appears at once.
- No page errors, no console errors, no failed requests (other than cancelled ones), no Content-Security-Policy violations.

Also verified on production: the live bundle is byte-for-byte the local build of `c2b308e` with the production
`VITE_API_URL` (all 12 chunk names identical), and all six security headers (CSP, HSTS, nosniff, frame denial, referrer and
permissions policies) are served on pages and assets.

**Dropped connections.** On the first production run, one request in about 150 ended with `ERR_CONNECTION_CLOSED` (the
datasets list), and the Overview showed "server could not be reached" for that panel. A 12-load check reproduced it (1 drop
in 60 requests); 100 multiplexed HTTP/2 requests from curl did not, so it is a browser-to-free-host connection race, not a
slow or failing endpoint (each answers in under a second). `197b4e3` reads once more after a dropped connection (never after
an HTTP error or an abort). With it, 12 production Overview loads saw 2 dropped attempts and **0 panels showing an error**;
Chrome still logs each dropped attempt as a console error.

**Vercel previews.** Every pushed commit built successfully as a preview (IDs above). Preview URLs require a Vercel login and
their origin is not in the API's CORS allow-list (the API answers a preflight from any origin other than the production site
with HTTP 400), so a preview cannot load data in a browser without changing Render's configuration, which was out of scope.
The identical production build was therefore verified locally against the release backend before each release, and the
deployed site was verified after it.

## 10. Responsive results

| Width | Layout |
|---|---|
| 1440 × 900 | Sidebar expanded; Overview in two-column rows; fund trail beside its toolbar, story and summary side by side. |
| 1280 × 800 | Same layout; key-figure labels wrap instead of truncating. |
| 768 × 1024 | Top bar with menu drawer; single-column panels; the wide tree with a readable starting scale and pan. |
| 390 × 844 | Menu drawer; stacked panels; full-width actions; the nested fund-trail list; horizontally scrolling tab rows with an edge fade. |

No horizontal overflow on any route at any of the four widths (checked in Chrome on production).

## 11. Before and after

Screenshots are in `docs/screenshots/premium-ui-2026-11-02/`. `before/` was captured from `dc15b4b` before any change, and
`after/` from `5fcf576`, with the same script, states and data. The audit and transaction-check images were recaptured from
`c2b308e`, the only later commit that changed what a page looks like. Desktop is 1440 × 900 and mobile 390 × 844 (2×).
`-full` files are full pages.

| Page | Before | After |
|---|---|---|
| Overview | [desktop](screenshots/premium-ui-2026-11-02/before/01-overview-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/before/01-overview-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/01-overview-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/01-overview-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/after/01-overview-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/01-overview-mobile.jpg) |
| Investigate | [desktop](screenshots/premium-ui-2026-11-02/before/02-investigate-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/02-investigate-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/02-investigate-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/02-investigate-mobile.jpg) |
| Investigate, forensic ledger | [desktop](screenshots/premium-ui-2026-11-02/before/03-investigate-forensic-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/03-investigate-forensic-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/03-investigate-forensic-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/03-investigate-forensic-mobile.jpg) |
| Account brief | [desktop](screenshots/premium-ui-2026-11-02/before/04-account-brief-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/04-account-brief-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/04-account-brief-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/04-account-brief-mobile.jpg) |
| Investigation overview | [desktop](screenshots/premium-ui-2026-11-02/before/05-investigation-overview-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/before/05-investigation-overview-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/05-investigation-overview-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/05-investigation-overview-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/after/05-investigation-overview-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/05-investigation-overview-mobile.jpg) |
| Fund trail | [desktop](screenshots/premium-ui-2026-11-02/before/06-fund-trail-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/before/06-fund-trail-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/06-fund-trail-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/06-fund-trail-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/after/06-fund-trail-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/06-fund-trail-mobile.jpg) |
| Inspector | [desktop](screenshots/premium-ui-2026-11-02/before/07-inspector-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/07-inspector-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/07-inspector-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/07-inspector-mobile.jpg) |
| Cases | [desktop](screenshots/premium-ui-2026-11-02/before/08-cases-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/08-cases-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/08-cases-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/08-cases-mobile.jpg) |
| Case workspace | [desktop](screenshots/premium-ui-2026-11-02/before/09-case-workspace-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/before/09-case-workspace-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/09-case-workspace-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/09-case-workspace-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/after/09-case-workspace-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/09-case-workspace-mobile.jpg) |
| Accounts | [desktop](screenshots/premium-ui-2026-11-02/before/10-accounts-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/10-accounts-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/10-accounts-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/10-accounts-mobile.jpg) |
| Account details | [desktop](screenshots/premium-ui-2026-11-02/before/11-account-detail-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/before/11-account-detail-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/11-account-detail-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/11-account-detail-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/after/11-account-detail-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/11-account-detail-mobile.jpg) |
| Fund-flow explorer | [desktop](screenshots/premium-ui-2026-11-02/before/12-fund-flow-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/12-fund-flow-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/12-fund-flow-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/12-fund-flow-mobile.jpg) |
| Model performance | [desktop](screenshots/premium-ui-2026-11-02/before/13-model-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/before/13-model-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/13-model-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/13-model-desktop.jpg), [full](screenshots/premium-ui-2026-11-02/after/13-model-desktop-full.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/13-model-mobile.jpg) |
| Audit log | [desktop](screenshots/premium-ui-2026-11-02/before/14-audit-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/14-audit-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/14-audit-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/14-audit-mobile.jpg) |
| Transaction model check | [desktop](screenshots/premium-ui-2026-11-02/before/15-transaction-model-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/15-transaction-model-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/15-transaction-model-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/15-transaction-model-mobile.jpg) |
| Reference tools | [desktop](screenshots/premium-ui-2026-11-02/before/16-tools-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/before/16-tools-mobile.jpg) | [desktop](screenshots/premium-ui-2026-11-02/after/16-tools-desktop.jpg), [mobile](screenshots/premium-ui-2026-11-02/after/16-tools-mobile.jpg) |

Laptop and tablet captures are in `laptop-tablet/`. Production verification captures are in `verification/`: the trail
mid-drawing, the inspector, the folded sidebar with a tooltip, the mobile drawer, the reduced-motion trail, the account
analysis and the case review section. The two JSON logs there are the production and local production-build runs.

## 12. Known limitations

1. **Vercel previews were built, not browsed.** They require a Vercel login and their origin is outside the API's CORS
   allow-list (§9). The identical build was verified locally and in production instead.
2. **Bundle size** grew by 29.5 KB gzipped (GSAP and ScrollTrigger now in the main chunk, §6).
3. **Safari** was not tested. Safari does not transition the SVG `d` property, so connectors there will jump while accounts
   slide when a branch folds or unfolds. Chrome was tested at four widths, and Firefox supports the transition.
4. **Reference pages were harmonised, not rebuilt.** Model performance, Audit log, Fund-flow explorer, Transaction model
   check and the account page's inner sections share the shell, header, tokens, controls and type dialect. Their dense inner
   panels keep their previous structure; the fund-flow explorer keeps its own tree component and the account page's "Follow
   the money" tab its Cytoscape graph.
5. **Free-host connection drops** still happen at the network level. Reads recover through the retry, but Chrome logs each
   dropped attempt as a console error. A cold start takes about 74 to 94 s on the first request.
6. **Full-page screenshot tools that do not scroll** will capture below-the-fold sections before they are revealed. Print
   styles force everything visible, and the reveal never applies under reduced motion.
7. Lint warnings (145) are pre-existing patterns; no new warning was added.
8. The AI analyst stays off in production (`GEMINI_ANALYST_ENABLED=false`); no explanation request was sent during any
   check.

## 13. Safeguards preserved

- Human review is required; no automatic action; nothing is frozen or flagged by the interface.
- Innocent counterparties are protected; accounts can abstain.
- Model output is labelled as model output, interpretations as possible interpretations, gaps as not known.
- The trace stays a left-to-right tree, not a force-directed network.
- No API contract, calculation or threshold changed; no data was hardcoded in place of API data (two hardcoded fallback
  values in the account header were removed).
