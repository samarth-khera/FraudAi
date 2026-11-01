# FraudShield AI: production QA, end-to-end and security audit

**Date:** 1–2 November 2026 (UTC).
**Audited deployment:** backend `https://fraudshield-api-rpok.onrender.com`; frontend `https://fraudshield-ai-psi.vercel.app`.
**Commit:** `eacaa7e88efac250df3e1ebf39aec6c52260c704`.
**Scope:** read-only against production. Nothing was pushed, deployed, migrated, enabled or modified. No write was attempted against production, and no Gemini call was made.

Screenshots are in [`docs/screenshots/qa-2026-11-01/`](screenshots/qa-2026-11-01/). The raw API responses, logs and scripts are in the auditor's local scratch directory.

---

## A. Executive summary

**Production health: good, and verified independently.**
- **Deployment:**
  - Render deploy `dep-dbjnpdk9v7es73alam1g` is live with `eacaa7e`. It finished at 17:57:55 UTC and the Render CLI deploy list confirms it.
  - An earlier deploy of the same commit, `dep-dbjn8trm8hqs73fvs7hg`, was cancelled after its instance never started. That caused about 12 minutes of downtime (§G).
  - The live frontend contains code that only exists in this commit: the `data-support-state` banner.
- **Data:** both datasets are available and labelled synthetic. Every number checked matches a byte-equivalent rebuild of the production ledgers.
- **Tracing:** 138 production trace edges were checked against the ledger with 0 mismatches.
- **Safeguards:** all 130 production role assessments carry `human_review_required: true` and `automatic_action_taken: false`. No automatic action exists anywhere.

**Most serious issues:**
1. **QA-01 (P1): the production AI analyst is live.** This contradicts the premise of the brief.
   - Every production investigation returns `ai_analysis.state = "deferred"`. In this code that state is only possible when a non-empty `GEMINI_API_KEY` is configured.
   - As a result, the frontend automatically requests a Gemini explanation for every investigation any anonymous visitor runs.
   - The explanation endpoints are unauthenticated and unthrottled, and the AI output filter lets guilt and freeze statements through (QA-02).
2. **QA-03 (P1, accuracy): false role labels on the demonstration path.**
   - The first sample account the app suggests, `FS-10B80A33`, has no scenario role, yet it is labelled a *potential intermediary*.
   - In the showcase `FS-7B7C13AB` investigation, a collector account, `FS-7305E412`, is labelled a *potential victim*.
3. **QA-04 (P2): "read-only" production still writes.** Anonymous GETs of case pages write trace paths and audit events. This was confirmed in the production audit log.
4. **QA-05 (P2): innocent explanations are hidden.** Innocent explanations, verification steps and missing information are never shown for most connected accounts.

**Presentation readiness.**
- The core investigator workflow works end to end in a real browser, explains itself well, and keeps facts, rules, model outputs and AI apart.
- The P1 items need a decision or a small fix before a live demonstration.

**Release decision: NOT READY** (see §I for the short path to ready).

---

## B. Test coverage matrix

| Feature | Test performed | Result | Evidence | Notes |
|---|---|---|---|---|
| Codebase vs production | `git diff` local HEAD vs `eacaa7e`; Render CLI deploy list; feature fingerprint in the live UI | PASS | Trees identical; live deploy `eacaa7e` | Only untracked old screenshots locally |
| Backend health / startup | `/health`; Render startup logs | PASS | `status ok`, `write_access disabled_no_key_configured`; startup completed at 17:57:49 | Startup log: "AI analyst SDK loaded" |
| HTTPS / TLS / redirects | `curl -v` | PASS | TLS 1.3 on both; certificates valid to Dec 2026 / Jan 2027; http→https 301/308 | |
| CORS | `Origin` header test | PASS | `access-control-allow-origin: https://fraudshield-ai-psi.vercel.app` | |
| API URL configuration | URL compiled into the production bundle | PASS | Bundle calls `fraudshield-api-rpok.onrender.com` | The README names `fraudshield-api.onrender.com`, which is an unrelated service |
| Datasets list | `GET /api/v2/datasets` | PASS | 2 datasets, both synthetic, with real counts | Model support is not listed here (QA-16) |
| Sample accounts | `GET …/sample-accounts` ×2 datasets | PASS / P3 | 6 IDs each; demo ledger takes 6.3–6.8 s on every call | QA-08 |
| Account lookup | 4 valid, 4 invalid lookups | PASS | Counts and timestamps match the ledger; cross-dataset IDs give an honest 404 | |
| Dynamic investigation | 13 production runs (11 forensic, 2 demo) | PASS (function) | All 200; reports verified (§E) | 3.4–10.1 s each (QA-08) |
| Production = verified build | Same 13 requests against a local rebuild of `eacaa7e`; digest comparison | PASS (13/13 functionally) | 9 byte-identical; 4 differ in one caution flag only | QA-09 |
| Fund tracing correctness | Every production edge checked against the ledger | PASS | 138 edges: 0 missing, 0 mismatched, 0 duplicated; depth and node limits held; 95 branches use only traced transfers | |
| Cycle handling | `FS-85B6CEC8` (loop scenario) | PASS | `cycles_detected = 1`, loop marked | |
| Restriction safeguards | All 130 production assessments | PASS | `human_review_required = true`, `automatic_action_taken = false`; no restriction review for a possible victim | |
| Innocent counterparties | Ground truth used for scoring only | PASS | 8/8 labelled *no suspicious linkage* | |
| Insufficient history | `FS-36B3099E` (API and UI) | PASS | `insufficient_evidence`; account model abstains | |
| Dataset separation / OOD | Demo ledger in API and UI | PASS | `unsupported_distribution_shift`; models marked reference-only; banner in the UI | |
| Role accuracy on demo path | Labels checked against ground truth | **FAIL** | QA-03 | |
| AI analyst state | 13 production reports | **FAIL vs brief** | `deferred`, not `not_configured` | QA-01 |
| Explanation endpoint | Unknown account and invalid payload only | PASS | 404 / 422, rejected before any AI call | Valid accounts deliberately not sent (would call Gemini) |
| Negative API tests | 27 cases | PASS | 404 / 422 / 405 with field-precise messages; docs disabled | Traversal-like IDs blocked by Render's edge with an HTML 403 |
| Write lock | Local reproduction in production mode (agent); production `/health` | PASS for write routes; **FAIL for GET side effects** | QA-04 | No write sent to production |
| UI pages (12 routes) | Visible Chrome, desktop | PASS | One `h1` per page; no page errors | |
| Responsive | 768 px and 390 px, every page | PASS | 0 px horizontal overflow on all 24 page/viewport pairs | |
| Keyboard focus | First 12 Tab stops per page | PASS | Visible focus ring on all | |
| Form labels | Visible inputs | P3 | Placeholder-only inputs on fund-flow, model and audit | QA-11 |
| Investigator journey | Sample discovery → brief → run → trail → collapse/expand → select account and transfer → affected → risk → AI → next steps → refresh → back | PASS with findings | Screenshots `A*`, `B*`, `H*`, `L*`, `O*` | QA-05, QA-06, QA-12 |
| Case FS-2001 | Summary, money flow, accounts, review | PASS | Complaint vs records separated; loss vs movement explained; "Changes are disabled on this server…" | |
| Tools | Accounts, fund-flow, model, audit, transaction model | PASS (render) / P2 | | QA-07 |
| Explanations (SHAP) | Production factors vs local TreeSHAP | PASS | Identical top factors; SHAP sum = margin to 1e-6 | |
| Temporal leakage | Code inspection plus existing tests | PASS | Strictly-before windows; no future pairs; no post-event balances | §E |
| Ground-truth separation | Inference column lists; v2 responses | PASS | No scenario or label column selected or returned | |
| Data integrity | Both production-replica ledgers | PASS | 0 duplicates, dangling refs, invalid timestamps or balance mismatches | |
| Automated suites | Backend, ML, frontend, build | PASS | 437 + 90 passed; 162 passed; build OK | §H |
| Security source audit | OWASP review (local, isolated) | 5 issues | §F | |

---

## C. Browser testing

**Browser.** The real installed Google Chrome 156.0.8078.74 was used in a visible, non-headless window.
- The window was driven over the Chrome DevTools Protocol: real clicks on real buttons, real typing, and console and network capture equivalent to DevTools.
- It was automation-driven, not a human hand on the mouse.
- Exactly one network interception was in place: requests to any `/explanation` endpoint were aborted inside the test browser and counted. Without that, production would have called Gemini (QA-01). Seven such requests were blocked across the sessions.

**URLs visited:**
- `/`, `/investigate` (both datasets), `/investigate?…&account=…` (FS-10B80A33, FS-7B7C13AB, FS-36B3099E, FS-NOTREAL1, ACC-000001)
- `/cases`, `/cases/FS-2001`, `/app/dashboard` (redirects to `/cases/FS-1042`)
- `/tools`, `/tools/accounts`, `/tools/accounts/ACC-000001`, `/tools/fund-flow`, `/tools/model`, `/tools/audit`, `/tools/transaction-model`
- an unknown route (shows the not-found page)

**Workflows completed:**
- Dataset selection.
- Account discovery: clicking a sample offered by the application.
- The account brief, with its counterparty disclosure.
- The investigation run, with real step list and no fake percentage.
- All six stages.
- Trail: collapsing a node (subtree folded into "+12"), selecting an account node (opens the inspector), selecting a transfer, switching branches.
- Affected-account expansion.
- Refresh: the URL keeps account and dataset; the report is recomputed only on request, and the app says "Not stored".
- Back.
- The demo-ledger unsupported state; the low-history abstention; the unknown-account 404.
- The FS-2001 case stages, including the read-only notice.
- The tools pages.

**Console errors:** no genuine errors and no uncaught exceptions. The logged errors were the deliberately blocked explanation calls and the browser's log line for the expected 404 of the unknown-account test.

**Network errors:** none. There were no failed chunks, assets or CORS errors. The only API errors were the expected unknown-account 404s.

**Script artefacts (not product defects):**
- A mouse click on a tree node at the canvas edge was intercepted by the fixed sidebar after an automated scroll; keyboard selection worked.
- "Forward" timed out because Playwright waits for a full page load, which a single-page-app history step never fires.
- One Chrome window closed mid-run.
- Two selector misses.

All were re-tested.

**One-off:** one load of `/tools/transaction-model` took 76.6 s, with DOMContentLoaded at 73.5 s. Two isolated re-loads took 1.6 s and 1.9 s, so this was not reproducible.

**Screenshots:** [`screenshots/qa-2026-11-01/`](screenshots/qa-2026-11-01/). Full-page screenshots taken while scrolled show the fixed sidebar and banner mid-page; that is a capture artefact, as the viewport-only shots show.

---

## D. Backend / API testing

**Routes:** 32 operations are registered (from OpenAPI). These were tested against production:
- `GET /health`, `/api/v2/datasets`, `/datasets/{id}/sample-accounts`, `/datasets/{id}/accounts/{id}`
- `POST /api/v2/dynamic-investigations` (13 valid, 13 invalid)
- `POST …/explanation` (unknown account and invalid payload only)
- `/api/v2/data-source`, `/models/status`, `/accounts/{id}`, `/accounts/{id}/transactions`, `/trace`
- `/api/cases`, `/api/cases/{FS-2001, FS-1042}`, `/api/audit`

**Status codes:**

| Case | Status |
|---|---|
| Unknown account (dynamic and explanation) | 404 `account_not_found`, with an honest "only searchable inside the selected synthetic dataset" message |
| Invalid dataset | 422, naming the allowed values |
| Missing or empty `account_id` | 422 |
| Malformed JSON | 422 `JSON decode error` |
| Extra field `freeze` | 422 `Extra inputs are not permitted` |
| `max_depth` 0 / 7 | 422 (allowed 1–6) |
| `max_nodes` 0 / 201 | 422 (allowed 2–200) |
| Wrong type | 422 |
| Unsupported `ai_explanation` | 422 |
| GET on a POST route | 405 |
| `/docs`, `/openapi.json` | 404 (disabled) |
| `limit` 0 / 100000 | 422 |
| `../../etc/passwd` as `account_id` | Blocked by Render's edge with an HTML 403 page before reaching the app |

**Schema and consistency:**
- Account IDs, transaction IDs and amounts in production responses equal the ledger.
- No partial report is returned as success; failures map to `investigation_failed` (code inspection).
- `/api/v2/datasets` does not include `model_support`; it is exposed per account lookup and in the report (QA-16).

---

## E. ML and forensic verification

- **Models in production:**
  - transaction `v3-transaction-1.0.0`;
  - account champion `v3-account-1.0.0`, threshold 0.052098…;
  - the challenger is not served;
  - on the demo ledger, both v3 models are reference-only (`unsupported_distribution_shift`).
- **Feature construction:**
  - **Point in time:** every historical feature uses only records strictly before the transfer (`searchsorted(…,'left')` on an `(account, time)` key), so same-second ties and the transfer itself are excluded.
  - **No future first-pairs:** pair "first seen" is computed over the extract but only counted strictly before the transfer.
  - **Per-account sums:** running sums restart per account.
  - **Forbidden inputs:** post-transaction balances and label or scenario columns are on `FORBIDDEN_INPUTS`.
  - **Realism caveat (not leakage):** `r_balance_before_log` uses the *receiver's* pre-transfer balance, which a sending bank would not normally see.
- **SHAP:** for production-displayed `TX-303-0027087`, the displayed factors match a local TreeSHAP recomputation exactly. Contributions sum to the model margin (1.879035 vs 1.879036), and model score 0.8675 and calibrated 0.7516 are identical.
- **Ground truth:**
  - The served SQLite files contain scenario columns. The dynamic engine selects an explicit column list without them, and no inference module references them.
  - v2 account and transaction responses contain no ground-truth keys.
- **Role assessments:** connected accounts in the 11 forensic production runs, against evaluation-only ground truth:

  | True role | Engine result |
  |---|---|
  | Innocent counterparty | 8/8 no linkage |
  | No scenario role | 30 no linkage, 13 cash points, 6 unknown, 2 potential victim, 1 potential intermediary (`FS-BE16A3FE`, a documented pass-through) |
  | Intermediary | 6/11 labelled intermediary or suspicious, 5 unknown |
  | Collector | 4/7 labelled, 2 unknown, **1 potential victim** (QA-03) |

- **Fund tracing:** 138 production edges match the ledger (sender, receiver, amount, timestamp). There are 0 duplicates, depth ≤ 3 and node limits are respected, 95 branches use only traced transfers, and no ending claims money was recovered, frozen or lost. The loop scenario was detected. The trail tree is left-to-right and collapsible, and each branch has a step story and an ending explanation (screenshots `B2`, `B3`).

---

## F. Security findings

The security findings come from an isolated local OWASP review plus production read-only checks.

**Authentication and authorisation:**
- Write routes (4) are guarded by `verify_write_permission` using `secrets.compare_digest`.
- In production mode with no key, all of them return 503. With a key, wrong, prefix, lowercased or Basic keys all return 401.
- The key is never logged and never reaches the frontend.
- The 7 unguarded POSTs were proven compute-only (a SQL listener saw no non-SELECT statements).
- **Exception:** three GETs write (QA-04).

**Injection, XSS and traversal:**
- **SQL:** ORM with bound parameters only; LIKE wildcards are escaped.
- **XSS:** there is no `dangerouslySetInnerHTML` or `innerHTML`, and AI text renders as React text.
- **Traversal:** no file serving; IDs are pattern-checked.
- **Deserialization:** joblib loads only checksummed build artifacts (LOW residual risk).
- Fuzzing found no error leakage (no traces, paths or SQL).

**Secrets:**
- None found in the tracked files, the 99-commit history or the built bundle; the only `VITE_*` variable is `VITE_API_URL`.
- A local `frontend/.env.local` holds a Vercel OIDC token. It is git-ignored and was never committed.
- Six tracked files contain local absolute paths, which is low risk.

**Dependencies:** `pip-audit` found nothing on the pinned set. The local venv has a stale `certifi`, but production installed `2026.10.23`. `npm audit` found 0.

**AI security:**
- Pseudonymisation was verified: 0 real IDs, timestamps or PII in prompts.
- The ledger has no free-text field, the payload is capped at 30,000 characters, and output goes through a strict schema, timeouts and a synthetic-only privacy policy.
- **Gaps:** QA-02 (guilt and freeze filter bypass) and QA-13 (grounding ignores IDs in real ledger format).

**Production privacy:**
- Data is labelled synthetic everywhere.
- Phone, email and tax ID are masked, but the UPI ID and name are returned in clear (QA-10).
- No punitive action exists. Restriction flags are pinned by `Literal` schema types and `automatic_actions_taken` has `max_length=0`.

**Production restrictions:** writes are disabled (`/health`, and the case Review stage says so), except for the GET side effect (QA-04).

**Headers:**
- The backend sets nosniff, frame-deny, referrer and permissions headers.
- There is no CSP or HSTS from the app, and the deprecated X-XSS-Protection header is still set.
- `vercel.json` sets no security headers.
- Unhandled 500 responses carry no security or CORS headers (QA-15).

---

## G. Performance and reliability

| Measure | Value |
|---|---|
| Dynamic investigation, production (13 runs) | 1.4–10.1 s (median about 6.4 s); 3.4–10.1 s excluding the low-history case; browser-observed 4.9–9.9 s; local 0.3–1.3 s |
| `/api/v2/datasets` | 6.1 s first call, then 0.9–1.2 s |
| Demo-ledger sample accounts | 6.3–6.8 s on every call (query not cached) |
| Account lookups | 0.17–0.66 s |
| Frontend page load | About 140–800 ms DOMContentLoaded (one non-reproducible 73 s outlier) |
| Cold start (free plan, observed 1 Nov) | 37–94 s to the first `/health` response |
| Deploy reliability | The first deploy of `eacaa7e` stalled at instance start and was cancelled. The old instance had already stopped, so the service was down about 12 minutes (17:22–17:34 UTC) until a request woke the previous deploy. The re-deploy succeeded. The cause is unknown; a local Docker test at 0.1 CPU / 512 MB did not reproduce it |
| Peak memory (local, same request mix) | 358 MB after 9 dynamic investigations, against a 512 MB plan |

The UI shows the real step list and an honest "server could not be reached / waking up" message, so it never stalls silently.

---

## G2. Automated test suites (local, tree identical to `eacaa7e`)

| Suite | Result |
|---|---|
| `pytest backend/tests -v` | **437 passed**, 0 failed, 1 warning (Starlette httpx deprecation) |
| `pytest ml/tests -v` | **90 passed**, 0 failed |
| `vitest run` (frontend) | **162 passed** (10 files) |
| `tsc -b` | Clean |
| `npm run lint` | 0 errors, 146 warnings (unchanged baseline) |
| `npm run build` | Succeeds |
| Render build (production, from logs) | 189 passed, 1 skipped (pre-existing `scenario-bank feature cache not built`) |

---

## H. Bug report (sorted by severity)

### QA-01: P1. The production AI analyst is live, auto-invoked for every investigation, anonymous and unthrottled

- **Feature:** AI analyst / production configuration.
- **Affects production:** yes.
- **Reproduction:**
  1. Run `POST /api/v2/dynamic-investigations` for any account.
  2. Read `investigation.ai_analysis.state`.
  3. Open any investigation in the UI and watch the network panel.
- **Expected (brief):** no Gemini key is configured, and the AI state is `not_configured`.
- **Actual:**
  - `deferred` on 13 of 13 production reports.
  - `precheck()` returns `deferred` only when `GEMINI_ANALYST_ENABLED=true` **and** a non-empty `GEMINI_API_KEY` is present. The routes always pass `provider=None`, so the key check is not bypassed (`ai_analyst.py` precheck; `dynamic_routes.py` `_dynamic`).
  - The production frontend immediately sends `POST /api/v2/dynamic-investigations/explanation`; 7 such requests were blocked in the audit browser.
  - That endpoint and `/api/v2/investigations/explanation` are unauthenticated, have no rate limit or cache, and make one Gemini call per request (SEC-05).
  - The old `/api/v2/investigations` defaults to `ai_explanation: "inline"`.
- **Evidence:** saved production responses; Render log ("AI analyst SDK loaded at startup"); code path. The key's validity was **not** tested, because that would require a Gemini call.
- **Impact:**
  - Every visitor investigation spends Gemini quota (or money, if the key is billed).
  - The endpoint can be scripted anonymously.
  - Unvalidated AI statements (QA-02) are shown to visitors.
- **Probable cause:** a key is set in the Render dashboard, contrary to the stated configuration.
- **Suggested fix (owner decision; no change made):**
  - Either remove the key, or set `GEMINI_ANALYST_ENABLED=false` in production.
  - Or keep it, and add per-client rate limiting, caching by `report_digest`, a global concurrency cap, and an `"inline"` → `"separate"` default.

### QA-02: P2. The AI output filter lets guilt assertions and freeze/block directives through

- **Feature:** AI analyst validation.
- **Affects production:** yes, because the analyst is live (QA-01).
- **Evidence:** local adversarial fake-provider tests (security audit). 9 of 13 paraphrases were accepted and displayed with `rejected_claims=0`, for example:
  - "is the fraudster behind this scheme";
  - "Freeze ACC-… immediately";
  - "We recommend freezing account …".

  The filter is three narrow regexes (`ai_analyst.py:425-433`), while `docs/AI_ANALYST.md` promises such statements are dropped.
- **Mitigating:** no attacker-controlled text reaches the prompt, the output is labelled AI, and nothing acts on it.
- **Fix:**
  - Broader guilt and restriction-verb detection on every field.
  - An enumerated `recommended_manual_checks`.
  - Regression tests for these paraphrases.

### QA-03: P1 (per this audit's taxonomy: incorrect role assessment). False role labels on the demonstration path

- **Feature:** role engine. This is a measured model and rule error class, not a code regression.
- **Reproduction:**
  1. Open `/investigate`, choose *Forensic scenario ledger*, and click the **first suggested sample, `FS-10B80A33`**. Start the investigation.
  2. Separately, investigate `FS-7B7C13AB` and open *Affected accounts*.
- **Expected:** an ordinary account isn't called an intermediary; a collector isn't called a victim.
- **Actual:**
  1. `FS-10B80A33`, which has no scenario role in the ground truth, is labelled **potential intermediary** with *additional verification*. The single reason is FUNDED_FORWARD on `TX-303-0027087`. The victim card meanwhile reads "Suspicious activity detected, victim status unconfirmed".
  2. `FS-7305E412`, an attacker-controlled collector in SC-DIRECT-0002, is labelled **potential victim** with *urgent review*. The trigger was an ordinary first-time p2p payment (`TX-303-0043807`, ₹12,500, 16 Feb) to `FS-EAAA344C`, two weeks before its collector activity.
- **Evidence:** `screenshots/qa-2026-11-01/A5-overview.png`, `H4-affected-row-open.png`; production JSON; ground truth used for scoring only.
- **Context:** both are documented error classes. Protective false-victim labels occurred on 40 of 1,438 uninvolved accounts in the cold evaluation. FUNDED_FORWARD on ordinary roots appears in the safety scan.
- **Fix:**
  - Don't feed the sample picker accounts with known false outcomes. Better, choose samples that illustrate each scenario.
  - Make single-kind FUNDED_FORWARD "unconfirmed" rather than "potential intermediary" (design on the train ledger, then test on a new hold-out).
  - Show the error rates next to role labels.

### QA-04: P2. Anonymous GETs write to the database and audit log while production is "read-only"

- **Feature:** v1 case API.
- **Affects production:** yes, confirmed.
- **Reproduction:** open `/cases/FS-2001` (any visitor), then `GET /api/audit`.
- **Expected:** no writes while `write_access = disabled_no_key_configured`.
- **Actual:** the production audit log shows `trace_paths_persisted` by `tracer_service` for FS-2001 at 18:17:42 and FS-1042 at 18:20:35 UTC.
  - **Disclosure:** both events were created by this audit's page views.
  - `GET /api/cases/{id}/trace|graph|transactions` → `save_trace_paths` (`routes.py:122-136`, `sql_case_repository.py:681-722`).
  - Locally, alternating `max_depth` forced a DELETE and INSERT plus a new audit row on **every** request. That makes this an unauthenticated, cross-site-triggerable write path.
- **Mitigating:** Render's disk is ephemeral and re-seeded on restart.
- **Fix:**
  - Make the GETs compute-only, and persist only through a guarded POST.
  - Add a test that production-mode GETs write nothing.

### QA-05: P2. Innocent explanations, verification steps and missing information are hidden for most connected accounts

- **Feature:** Affected-accounts stage and Inspector.
- **Reproduction:** investigate `FS-7B7C13AB`, open *Affected accounts*, expand any account, or select an account in the trail.
- **Expected:** for each account, the alternative innocent explanations and missing information (a core safeguard in the brief).
- **Actual:** both views render `RestrictionPanel compact` (`AffectedAccountsStage.tsx:111`, `Inspector.tsx:282`), which hides:
  - *What supports it*;
  - *Innocent explanations to rule out*;
  - *Verification needed*;
  - *Missing information*.

  The API returns them (for example 2 innocent explanations per intermediary or unknown role). They appear only in *Next steps*, and only for the investigated account and for connected accounts with urgent or restriction review, inside a collapsed panel.
- **Evidence:** API JSON; `O2-intermediary-open.png`; `intel.tsx:98-128`.
- **Fix:** show at least the innocent explanations and missing information in the affected-account rows and the Inspector.

### QA-06: P2. The overview gives contradictory counts of flagged transfers

- **Feature:** Overview stage.
- **Reproduction:** investigate `FS-10B80A33`.
- **Actual:**
  - *Suspicious transactions* says "**1** of this account's transfers were flagged by the transaction model or the fixed rules".
  - *What happened* says "made **2** transfers that the rules, the transaction model or both flag for review, **₹80,967** in total".
  - *Where the trace starts* traces both.
- **Cause:** the second transfer (₹50,843) is flagged only by a fixed rule the validated model doesn't support, so it moves to a collapsed "flagged by the fixed rules but not by the validated transaction model" panel. The first sentence is then false, and the narrative total mixes the two.
- **Evidence:** `A5-overview.png`.
- **Fix:**
  - Word the heading as "flagged by the validated transaction model".
  - Make the narrative say "1 flagged by the model, 1 by a fixed rule only".

### QA-07: P2. The model-status badge and the *Model performance* page describe the v2 model, not the models that run investigations

- **Reproduction:** click **Model ready** in the sidebar; open `/tools/model`.
- **Actual:**
  - The badge says "Account model **v2-account-2.0.0** is loaded and can assess synthetic-ledger accounts" (from `/api/v2/models/status`).
  - The *Model performance* page mentions only `v2-account`, with no `v3-transaction` or `v3-account`.
  - Every Investigate-page result uses v3 models.
- **Evidence:** `H4-affected-row-open.png` (popover); `page-model.png`.
- **Fix:** report the v3 models (versions, validation, support state) in the badge and on the model page, or label them clearly as v2-only.

### QA-08: P2. Performance and reliability risk for a live demo

- **Evidence:** §G.
  - Investigations take 3.4–10.1 s on production.
  - Demo-ledger sample accounts take 6.3–6.8 s per call (uncached full scan).
  - Free-plan cold starts take 37–94 s.
  - The first deploy of this commit caused about 12 minutes of downtime.
- **Fix:**
  - Cache or precompute sample accounts at build time.
  - Warm the service before a demo.
  - Consider a paid instance (more CPU) or zero-downtime deploys.

### QA-09: P3. `outside_training_range` differs between platforms for the same data

- **Evidence:** 4 of 13 production reports differ from the local build only in this flag, on hub `FS-C4E89947` (and `FS-2E84BB6C`).
  - `distinct_recipients_log = log1p(2) = 1.0986122886681096` falls one ULP below the stored bound `1.0986122886681098`.
  - The check uses a strict `<` comparison, so the result decides whether a third input counts as out of range.
- **Fix:** compare with a tolerance, or use inclusive bounds.

### QA-10: P3. Personal-data-shaped fields are not consistently masked

- **Actual:** `/api/v2/accounts/{id}` returns `upi_id` in clear (for example `aditijoshi0001@okhdfcbank`, a real bank handle suffix) and `customer_name`. Phone, email and tax ID are masked.
- **Note:** synthetic data, so not a privacy breach today. It would be P1 if a non-synthetic data source were ever configured, because reads are unauthenticated.

### QA-11: P3. Placeholder-only form controls

- **Affected:** the fund-flow search, the model page search, and the audit filters (6 controls).
- **Fix:** add `aria-label` or `<label>`.

### QA-12: P3. Developer language and formatting in investigator-facing text

- **Examples:**
  - The demo brief cites "PSI > 0.25" and repository file paths (`ml/reports/distribution_shift.json`).
  - A rule signal prints the raw amount "250000.00" without ₹ or digit grouping.
  - The victim card for forwarding accounts explains forwarding under the heading "Is … potentially a victim?".
  - Large "calibrated score 75.2%" values sit next to a "0.13%" threshold. The meaning is explained in a side panel, but it's easily misread as a probability of fraud.

### QA-13: P3. AI grounding ignores real-format IDs

- **Actual:** text citing `ACC-000777`, `TXN-…`, `FS-…` or 4-digit aliases passes validation (SEC-03).

### QA-14: P3. A non-ASCII `X-API-Key` header causes a 500 instead of a 401

- **Note:** it fails closed, but it logs a traceback (SEC-04). It only matters if a key is configured.

### QA-15: P3. Security headers

- No CSP or HSTS from the app, and the deprecated X-XSS-Protection header is set.
- `vercel.json` sets no headers.
- Unhandled 500s lack security and CORS headers.

### QA-16: P3. `GET /api/v2/datasets` omits the model support state

- The support state appears only after an account lookup, so the dataset picker can't warn before an account is chosen.

**Not defects (verified):**
- The not-found page; the legacy redirects (`/app/dashboard` → `FS-1042`, which exists).
- Masking of phone, email and tax ID.
- "Counterparties 56" for ACC-000001: the ledger has 56 distinct counterparties.
- Refresh behaviour: the URL keeps state, and the app states that reports are not stored.
- Render's edge blocking traversal-like IDs with an HTML 403 (not the API's JSON error format).

---

## I. Final release decision

**NOT READY.**

The core of the product is sound and verified in production:
- The investigation engine reproduces the verified build exactly.
- Traces match the ledger.
- Every restriction is advisory and needs human review.
- Innocent counterparties weren't accused in any production run.
- Out-of-distribution data is labelled.
- The UI is honest about uncertainty.

It is not ready because:
- **QA-01:** the AI analyst is live with an unthrottled anonymous path to Gemini, and its output filter can be bypassed (QA-02).
- **QA-03:** the demonstration path shows false role labels on the first suggested sample and in the showcase case.
- **QA-04:** "read-only" production writes via GET.

**Shortest path to READY WITH MINOR ISSUES:**
1. Decide the AI configuration: turn it off in production, or add rate limiting and caching (QA-01). Harden the filter (QA-02).
2. Make the case GETs compute-only (QA-04).
3. Pick sample and demo accounts whose outcomes are correct, and show error rates next to role labels (QA-03).
4. Show innocent explanations and missing information for connected accounts (QA-05).
5. Fix the overview count wording (QA-06) and the v2-vs-v3 model labelling (QA-07).
6. Warm the backend before any live demonstration (QA-08).

---

### Audit limitations

- **Browser method:** the browser was real visible Chrome, but driven by automation rather than a human.
- **Accessibility depth:** colour contrast was not measured with a contrast tool.
- **Server lifecycle:** wake-from-sleep was observed earlier in the day but not forced again. The Vercel deployment metadata wasn't accessible (no CLI); the frontend build was identified from feature fingerprints.
- **Gemini:** never called. The key's validity and the real AI output quality are therefore unverified.
- **Writes:** no write or bypass was attempted against production; write-lock behaviour was verified locally in production mode.
- **Audit side effect:** this audit's page views created two `trace_paths_persisted` audit rows in production (QA-04). They're harmless and are removed on restart.
