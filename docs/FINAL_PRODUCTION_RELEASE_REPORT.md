# FraudShield AI: final production release report

**Date:** 2 November 2026 (all times UTC)
**Release:** the QA remediation (`docs/PRODUCTION_QA_REMEDIATION_2026-11-02.md`) to both production platforms
**Verdict: READY WITH DISCLOSED LIMITATIONS** (see §11)

| | |
|---|---|
| Final source commit (application code deployed on both platforms) | `072e4e5c6ae17db17b16e04aa2a5509791666fab` |
| Code commit inside it | `893b4dfc9c3f4265df2cf8908fcb291543445ab6` |
| Later commits on `main` (no change to the deployed application) | `90d7b2e3cab148bf151916a183fa3176fc802309` (demo preflight hardening, §8) and the docs-only commit that adds this report |
| Branches after the release | `v2-rebuild` = `072e4e5`; `main` = the report commit (`072e4e5` → `90d7b2e` → report) |
| Previous production commit | `eacaa7e88efac250df3e1ebf39aec6c52260c704` (PR #26) |
| Backend | `https://fraudshield-api-rpok.onrender.com`: Render deploy `dep-dbk098mq1p3s73b8q840`, **live** |
| Frontend | `https://fraudshield-ai-psi.vercel.app`: Vercel production deployment `DaeJHXSVpTnbMZ9X33SPkQDu8Acf`, **success** |
| AI analyst in production | Off. `GEMINI_ANALYST_ENABLED=false` was preserved, and no Gemini request was sent |
| Recurring cost | ₹0: Render free plan and Vercel Hobby. No paid service or paid API was added |

Contents:
1. Release record
2. Git identity
3. Automated tests
4. Production API smoke test
5. Gemini suppression
6. Visible Chrome verification
7. Security headers
8. Preflight and performance
9. QA-01 to QA-16 after release
10. Remaining limitations and known risks
11. Is it ready for a live demo?
12. Evidence and artefacts

---

## 1. Release record

### Starting state

The state was checked against the remote at release time, not assumed.

| Ref | SHA before | Relation to `072e4e5` |
|---|---|---|
| `origin/main` | `eacaa7e` | ancestor; 0 behind, 2 ahead |
| `origin/v2-rebuild` | `eacaa7e` | ancestor; 0 behind, 2 ahead |
| `fix/production-qa-remediation` (local) | `072e4e5` | the release |

- **Merge check:** `git merge-tree --write-tree origin/main 072e4e5` gives tree `764208a8…`, identical to the tested commit's tree.
- **Conflicts:** none.
- **Open PRs:** PR #10 is open (VibeShield, `pytest` 9.0.3 in `backend/requirements.txt`). It shares no files with this release and was left untouched.

### Pushes

All pushes are plain, non-force fast-forwards. No history was rewritten.

| When | Branch | Change | Deployment it triggered |
|---|---|---|---|
| 03:33:48 | `v2-rebuild` | `eacaa7e..072e4e5` | Render production deploy `dep-dbk098mq1p3s73b8q840`. Vercel also built a protected preview, `7r24Ep4MT3kRT11cGX1PRZtcWRgj`, for the branch; not production |
| 03:42:25 | `main` | `eacaa7e..072e4e5` | Vercel production deployment `DaeJHXSVpTnbMZ9X33SPkQDu8Acf` |
| after verification | `main` only | `072e4e5..90d7b2e..`(this report) | One push of two commits: the preflight script and its tests (§8), then this report. Vercel rebuilds an unchanged frontend once. `v2-rebuild` stays at `072e4e5`: neither commit changes the backend runtime, so Render is not redeployed |

**Why no PR.** Both production branches could fast-forward to the exact commit that was tested. Vercel preview deployments for this project are SSO-protected (HTTP 302 to `vercel.com/sso-api`), so a PR preview could not have been inspected and would only have added a build. The feature branch was therefore not pushed.

**Order: backend first.** The new backend only adds response fields, and the old frontend already renders the new `model` evidence kind, so old frontend plus new backend was a safe intermediate state. The frontend was released only after the backend passed its production checks (§4).

### Render

| Field | Value |
|---|---|
| Service | `fraudshield-api` (`srv-dbhdkmgn74is73d3j6ag`), branch `v2-rebuild`, auto-deploy on |
| Deploy | `dep-dbk098mq1p3s73b8q840`, trigger `new_commit`, commit `072e4e5`, created 03:33:54, **live** at 03:37:45 |

What the build and deploy log shows:
- "Checking out commit 072e4e5… in branch v2-rebuild" and pinned requirements installed.
- Model-artefact integrity check passed.
- Build-time tests: **189 passed, 1 skipped**. That is identical to the previous build of `eacaa7e` at 03:10. The skip is a test that needs a locally built artefact.
- Start-up check passed: `disabled_no_key_configured v2-account-2.0.0`.
- Application start-up complete at 03:37:40.
- The service status was read with the Render CLI (`render deploys list`).

**Rollback target:** `dep-dbjvt6utlv9c73eeain0` (`eacaa7e` with the Gemini flag off). It was not needed.

### Vercel

| Field | Value |
|---|---|
| Production deployment | `DaeJHXSVpTnbMZ9X33SPkQDu8Acf` for commit `072e4e5` (GitHub commit status from the `main` push: pending 03:42:28, success 03:42:52) |
| Preview deployment | `7r24Ep4MT3kRT11cGX1PRZtcWRgj`, from the `v2-rebuild` push; not production |

Evidence that the production domain serves this deployment:
- The domain started sending the new `vercel.json` headers within 7 s of that status succeeding.
- It serves `assets/index-B90lHknd.js`, and all 12 JS chunk names match a clean local build of `072e4e5` with the production API URL. The names are content hashes, so the bundle is identical.
- The Vercel API itself was not queried: the saved CLI login on this machine had expired, and it was not refreshed.

### Production configuration

- **No environment variable was changed.** `GEMINI_ANALYST_ENABLED=false` (set by the owner before this release) is untouched.
- **`GEMINI_ANALYST_PRODUCTION_APPROVED` is not set.** The new code requires it, in addition to the flag, before any AI explanation can run in production.
- **No sync risk from the Blueprint:** `render.yaml` defines no Gemini variable and is unchanged by this release.
- **No data changed.** Public writes are disabled in production (`write_access=disabled_no_key_configured`). The audit-event total was identical before and after all smoke tests and browser runs (§4).

---

## 2. Git identity

Every commit in this release is authored and committed by the owner's established identity. No commit carries a `Co-authored-by` trailer or any AI or automation attribution.

```
commit 072e4e5c6ae17db17b16e04aa2a5509791666fab
Author:     Samarth Khera <188962529+samarth-khera@users.noreply.github.com>
Commit:     Samarth Khera <188962529+samarth-khera@users.noreply.github.com>
    Add the production QA remediation report (2026-11-02)

commit 893b4dfc9c3f4265df2cf8908fcb291543445ab6
Author:     Samarth Khera <188962529+samarth-khera@users.noreply.github.com>
Commit:     Samarth Khera <188962529+samarth-khera@users.noreply.github.com>
    Remediate production QA findings QA-01 to QA-16

commit 90d7b2e3cab148bf151916a183fa3176fc802309
Author:     Samarth Khera <188962529+samarth-khera@users.noreply.github.com>
Commit:     Samarth Khera <188962529+samarth-khera@users.noreply.github.com>
    Make the demo preflight resilient to responses cut off in transit
```

The repository's local `user.email` is not the no-reply address. The two new commits (`90d7b2e` and the report commit) therefore set the author and committer explicitly to the same no-reply identity. Both were checked with `git log --format=fuller` before pushing. No existing commit was rewritten.

---

## 3. Automated tests

The suites ran on `072e4e5` in a clean, detached worktree, set up as follows:
- The git-ignored runtime artefacts were added as copy-on-write clones: the `data/` ledgers (including the seed-42 and seed-303 ledgers that Render builds) and the four git-ignored model files.
- There was no `.env.local`, as on Vercel.
- Outbound HTTP(S) was routed to a closed local port, so no test could reach Google even by mistake.

| Suite | Command | Result |
|---|---|---|
| Backend | `python -m pytest backend/tests` | **575 passed**, 0 failed (48.7 s) |
| Machine learning | `python -m pytest ml/tests` | **90 passed**, 0 failed (43.9 s) |
| Frontend | `npx vitest run` | **172 passed** in 10 files, 0 failed |
| TypeScript | `npx tsc --noEmit -p .` | 0 errors |
| Lint (oxlint) | `npm run lint` | exit 0: 0 errors, 146 warnings (unchanged from before the remediation) |
| Production build | `npm run build` with the production `VITE_API_URL` | success; chunks identical to what Vercel serves |
| Render build check, replica | `scripts/render_build.sh` verification step, run verbatim | 190 passed with the script's own environment; 190 passed again with Render-like service variables and a placeholder key |
| Render start-up check, replica | the script's inline start-up check | passed in both environments |
| Render build check, real | Render's own build log | 189 passed, 1 skipped; start-up check passed (§1) |
| Backend, final `main` tree | `python -m pytest backend/tests` after `90d7b2e` | **582 passed**, 0 failed: the 575 above plus 7 new tests in `test_demo_preflight.py`. The local dev case database was byte-identical before and after |

The single pytest warning is a Starlette deprecation notice from the test client. `90d7b2e` touches only `scripts/demo_preflight.py` and its new test file, so the ML and frontend results above still apply.

### What the suites cover, beyond the 16 QA findings

| Area | Representative tests |
|---|---|
| Start-up, configuration, health | `test_product_integrity.py`, build start-up check |
| Dataset registry and isolation | `test_database_isolation`, `test_risk_assessment_ground_truth_isolation` |
| Multi-hop tracing, limits, cycles | `test_depth_limit`, `test_depth_limit_ending_only_where_the_account_has_a_further_transfer`, 9 cycle tests (for example `test_circular_scenario_loop_members_are_found_in_a_cycle`) |
| Point-in-time features, no future leakage | `test_adding_or_changing_future_transactions_does_not_change_earlier_predictions`, `test_feature_builder_leakage_safeguards` |
| No ground-truth or ID leakage | `test_features_do_not_change_when_account_ids_are_relabelled`, ground-truth isolation tests |
| Explainability | `test_explain_contributions_match_log_odds_and_differ_across_inputs` |
| Innocent counterparties | `test_no_innocent_counterparty_or_lookalike_is_called_suspicious_or_sent_to_restriction_review`, `test_every_role_that_can_be_wrong_carries_innocent_explanations` |
| Low-history abstention | `test_insufficient_history_abstains`, `test_incomplete_lineage_and_insufficient_evidence` |
| Out-of-distribution handling | `test_unchecked_or_shifted_datasets_never_use_models_as_evidence`, `test_dataset_support_state_matches_the_distribution_report` |
| Model output is not fact | `test_a_sentence_about_a_model_flag_is_labelled_a_model_output_not_a_recorded_fact` |
| AI safety (mock provider only) | `test_qa_remediation_ai.py`, 116 tests: the 13 audited phrasings plus paraphrases, fail-closed structure and grounding |
| Read-only cases, authorisation, errors | `test_qa_remediation_backend.py`, `test_qa_remediation_cases.py`, `test_case_management.py` |

No safeguard was weakened, no threshold was tuned for the demo, and no sample account's outcome is hard-coded.

---

## 4. Production API smoke test

**Run:** 70 read-only requests against the live backend at 03:41–03:42, after the deploy. **Result: 64 PASS, 0 FAIL, 1 INFO.**

Write endpoints were probed only with empty bodies or nonexistent case IDs, so no write was possible even in principle.

The first run of the same script had 1 FAIL (S7) and four checks that could not evaluate (S8, T1, T2, D4). All five came from the script reading the wrong field names: `total` instead of `total_count`, `ending.kind` instead of `ending.reason`, and a nonexistent trace `depth` field. The script was fixed and the whole run repeated.

| Area | Checks (all PASS unless noted) |
|---|---|
| System | `/health` ok with public writes disabled; release security headers; CORS allows only the production frontend (another origin gets HTTP 400 and no `Access-Control-Allow-Origin`); model status shows v2 for Accounts/cases and the v3 investigation models ready; both datasets available with model support stated; data source declared synthetic |
| Samples | Forensic and demo samples (6 each). Ground-truth-free, `FS-10B80A33` no longer suggested, basis says "already held". Repeat calls served from the cache |
| Accounts | Forensic brief; unknown account → 404; **dataset isolation** (each ledger's IDs → 404 in the other); unknown dataset → 422; account detail with **UPI masked** (`a******1@okhdfcbank`); paginated history; v2 inference `ACC-000003` = 71.3 (`v2-account-2.0.0`); rule assessment; read-only live analysis; unknown history → 404 |
| v2 trace | Hops within the limit; node cap honoured and reported; exposure bounded by observed totals; depth 1 honoured; `max_nodes=5` truncates and says so; depth 999 → 422 |
| Dynamic investigations | See the list below this table |
| Cases (read-only) | List; `FS-2001` overview (₹2,50,000); accounts; trace, graph, transactions and audit trail GETs; trace depth 51 → 422; account assessment wording; unknown case → 404 |
| Authorisation | Six write attempts (create, update, review, add transactions, wrong `X-API-Key`, wrong bearer token) → all 503: public writes are off |
| Audit | Filter by case; CSV export. **Audit total 2 before and 2 after the run, and still 2 after both browser runs and the parity checks: nothing was written by any GET** (QA-04) |
| Transaction model check | `TRANSFER` scored as decision support (`decision_support_only: true`, `model_v1:xgboost`); 8 feature contributions; invalid type → 422 |
| Errors | Unknown API path → JSON 404; unsupported method → 405 |
| Secrets | 0 keys, tokens, private keys or key-presence fields in any of the 70 response bodies and headers |
| AI state | Every `ai_analysis` returned in production was `disabled` |

Dynamic-investigation checks:
- **`FS-7B7C13AB`:**
  - completes as a potential victim;
  - AI off, with provider, model and latency all `null`;
  - no automatic action, human review required, restriction advisory;
  - **`FS-7305E412` is `unknown_role`**;
  - all 8 model sentences are labelled `model`, none "recorded fact";
  - 11 branches, depth 3, no transfer repeated within a branch;
  - no guilt or freeze wording;
  - innocent explanations on all 15 role assessments;
  - versions `v3-transaction-1.0.0` and `v3-account-1.0.0`.
- **`FS-10B80A33`:** abstains (`insufficient_evidence`, `unknown_role`).
- **`FS-85B6CEC8` (loop):** the loop is detected (`cycle_detected`, `joins_opposite_direction_trace`) and not followed again.
- **`FS-36B3099E`:** low history, abstains.
- **`ACC-000001` (demo):** potential victim, model not validated for the dataset.
- **Limits:** `max_depth=1` and `max_nodes=2` are both honoured and reported.
- **Validation:** bad depth, nodes, extra field, AI mode, ID or dataset → 422; unknown account → 404; malformed JSON → 422.
- **INFO, `FS-7BA8A2CC`:** still `potential_intermediary` with `urgent_manual_review_recommended`, although it has no scenario role. This is the documented residual error (§10).

---

## 5. Gemini suppression

`GEMINI_ANALYST_ENABLED=false` stayed in place. The feature was **not** re-enabled to test it, and **no real Gemini request was sent** at any point in this release.

1. **Visitor investigations do not call Gemini.**
   - Every `ai_analysis` in both smoke-test runs was `disabled`, with `provider`, `model` and `latency_ms` all `null` (9 investigations per run).
   - Every preflight investigation reported "AI analyst: disabled".
   - In Chrome, the report header reads "AI analyst: turned off" (visible in screenshots 07, 13, 15 and 52), and the AI stage itself was opened and checked.
   - The Render logs for the whole release window (03:33:00 to 04:25:02, 1,425 lines) contain 0 AI-provider lines: no "SDK loaded", no "completed"/"unavailable", no Google API host. With the flag off, the SDK is not even imported.
   - The same window has 0 errors or tracebacks and no HTTP 500. Every non-200 status was one of the deliberate test requests (§4). The only two application start-ups were the deploy and the cold start (§8).
2. **Investigations work without the AI analyst.** Full reports were produced on both datasets (§4, §6). The AI stage says: "The overview, fund trail, risk evidence and next steps are complete without it."
3. **No unsolicited explanation request.** Chrome counted every request to `/explanation` across all runs: **0** (part 1, part 2 and the re-check, at all three viewports). The UI never requests an explanation by itself.
4. **A manual explanation request while disabled is safe.**
   - `POST /api/v2/dynamic-investigations/explanation` → 200, `disabled`, provider `null`, empty report digest, **0–1 ms server time**: it returns from configuration and computes or sends nothing.
   - The v2 explanation endpoint behaves the same.
   - The response gives a generic message that does not reveal which settings or secrets the server has.
   - In the UI, the disabled stage shows no request button.
5. **Unsafe guilt claims and freeze directives are blocked server-side.** Verified with a mocked provider only, as required:
   - the 116 tests of `test_qa_remediation_ai.py`, included in the 575 above, cover all 13 audited phrasings plus paraphrases and whole-answer rejection;
   - the visible-Chrome mock-provider flow of 2 November (8/8 PASS, `docs/screenshots/qa-remediation-2026-11-02/12-mock-ai-explanation-filtered.png`) showed the unsafe sentence removed and never displayed.
6. **No secrets exposed.**
   - Live frontend: 12 JS chunks (1.8 MB) contain 0 Google, `sk-`, GitHub or Render keys, 0 private keys and no `GEMINI` string.
   - API: 70 public responses contain 0 secrets or key-presence fields.
   - Render logs: 716 lines with 0 secret-like lines.
   - Diff: 64,652 added text lines scanned before pushing: clean.
7. **Vercel actually serves the security headers** (§7).

A check before the release, against the old code with only the flag changed (03:25), already showed `disabled` with provider `null`, and an explanation request that answered in 3 ms.

---

## 6. Visible Chrome verification

**Browser:** Google Chrome 156.0.8078.74 in a **visible window** (`headless: false`). Playwright drove it over the DevTools protocol with real clicks, typing, Tab and Escape against the **deployed** frontend and backend. Every interaction was automated in that visible window; none was done by hand.

**Runs:**

| Run | Result |
|---|---|
| Part 1 | 40 PASS / 4 FAIL / 1 INFO |
| Part 2 | 17 PASS / 1 FAIL / 1 INFO |
| Next-steps re-check | 1 PASS |

**Script failures (none was a product defect):**
- **Part 1, transfer click:** clicking the first `₹amount` button timed out, because it matched an off-canvas graph label. The rest of that section did not run. Part 2 re-ran all of it using the trail's accessible names, and it passed.
- **Part 1, "Model performance tabs: 0 tabs":** the page switches views with buttons, not tabs. Part 2 clicked all three: PASS.
- **Part 1, tablet investigation:** `page.goto` waited more than 30 s for one window `load` event, and the timed-out navigation was then aborted (`net::ERR_ABORTED`, the "failed request"). Part 2 re-ran it: DOM ready and load in 424 ms, no slow request, full investigation usable. The same flow on mobile passed in part 1.
- **Part 2, "next steps":** a false positive. The check matched the negated sentence "Nothing has been frozen, blocked or flagged". The negation-aware re-check passed: advisory only, a person at the authorised institution decides, "FraudShield took no action", "never a penalty", innocent explanations, missing information, and 0 explanation requests.

### What was exercised

Screenshots are in `docs/screenshots/release-2026-11-02/`.

| Workflow | Verified by interaction | Screenshots |
|---|---|---|
| Navigation and routing | Sidebar clicks reach all 8 destinations; legacy `/app/dashboard` redirects to `FS-1042`; unknown route → not-found page | 01, 32 |
| Overview and model labels | No contradictions. Header popover names v3-transaction-1.0.0 and v3-account-1.0.0 for investigations and v2-account-2.0.0 only for Accounts/case review | 01, 02 |
| Sample selection | Forensic dataset picked; model support shown per dataset; the 6 samples need no ground truth (own-money basis) | 03 |
| Full investigation | Account brief before any score → running state with real steps (no fake %) → report | 04, 05, 06 |
| Branch expansion and transfer details | 9 outflow + 2 inflow branches with stated endings; collapse/expand; account inspector; transfer inspector (`TX-303-0046080`, ₹52,000, accounts, time, model and rule flags) | 07, 08, 09, 10 |
| Roles, evidence and innocent explanations | `FS-7305E412` "Role unknown" with the reason; its model flag badged **Model output**; `FS-EAAA344C` shows records, interpretation and unknowns separately, with innocent explanations, verification and missing information | 11, 11a |
| Risk evidence, AI off, next steps | Rules and model shown as separate evidence; AI analyst "turned off", nothing sent, no request button; next steps advisory with human review | 12, 13, 14 |
| Previously reported accounts | `FS-10B80A33` abstains, neutral heading, counts apart (QA-06); **`FS-7BA8A2CC` shown as the documented residual error**, still with no guilt or freeze wording; `FS-36B3099E` abstains | 15, 16, 17 |
| Error and empty states | Unknown account: "Account 'FS-NOTREAL1' is not in the forensic scenario ledger."; audit search with no match: empty state | 18, 30 |
| Demo ledger | Out-of-distribution banner; model reference only | 19 |
| Accounts and account detail | Search, select, detail with 4 tabs clicked | 20, 21 |
| Cases | List; open `FS-2001`; Summary (₹2,50,000), Money flow (tree), Accounts & risk, Review & history. **Read-only:** "Changes are disabled on this server…", 0 enabled save buttons | 22–26 |
| Fund-flow explorer | Trace `ACC-000003` into a hop-by-hop tree; switch view | 27 |
| Model performance | v3 panel with per-dataset support; three model views with their metrics | 28, 28b |
| Audit log | 5 labelled filters; filter by `FS-2001` | 29, 30 |
| Transaction model check | Score plus feature contributions, decision support only | 31 |
| Tablet, 768 px | 0 px horizontal overflow on 10 destinations; menu button navigation; full `FS-7B7C13AB` investigation with trail and 14 role cards, 0 overflow | 40–43 |
| Mobile, 390 px | Same checks: 0 px overflow on 10 destinations, menu works, full investigation usable, 0 overflow | 50–53 |
| Keyboard | 10 Tab stops on the overview and 15 each on Investigate, case `FS-2001` and Audit log, every one with a visible focus indicator (`walkthrough-focus-probe.json`) | 33 |

**Browser health across all runs:**
- 0 CSP violations, 0 uncaught page errors, 0 explanation requests.
- 1 console error: the expected 404 for the deliberate unknown-account lookup.
- Requests went only to the frontend, the Render API and Google Fonts (part 1: 226, 139 and 304 requests). No other host was contacted.
- **The fund-flow UI stays a clean, readable tree:** the investigated account, then its recipients, then onward hops, ending at cash withdrawals and depth limits. On mobile the step-by-step list stays readable and the graph folds into a disclosure (07, 24, 52).

---

## 7. Security headers

### Vercel (QA-15)

Response headers were read with HTTP requests to `/`, `/investigate?…`, `/cases/FS-2001`, `/tools/model`, `/assets/index-B90lHknd.js` and an unknown path. All five configured headers were present and **exactly** as in `frontend/vercel.json`. Chrome then loaded every page under this policy with 0 CSP violations.
- **Content-Security-Policy:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.onrender.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
- **X-Content-Type-Options:** `nosniff`
- **X-Frame-Options:** `DENY`
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Permissions-Policy:** `geolocation=(), microphone=(), camera=()`

Also observed:
- **HSTS:** `max-age=63072000; includeSubDomains`.
- **No inline scripts:** the served `index.html` has none.
- **API host:** `connect-src` covers the only API host in the bundle, `fraudshield-api-rpok.onrender.com`. Chrome reported 0 CSP violations.

### Render API

- **Content-Security-Policy:** `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`
- **Strict-Transport-Security:** `max-age=31536000; includeSubDomains`
- **X-Content-Type-Options:** `nosniff`
- **X-Frame-Options:** `DENY`
- **X-XSS-Protection:** `0`
- **Referrer-Policy:** present
- **CORS:** only the production frontend origin is allowed.

---

## 8. Preflight and performance

All timings are client-side from this machine (India) to Render's free instance, and are real measurements.

### `scripts/demo_preflight.py` right after the deploy (03:38, first requests to the new instance; 9/9 OK, "Ready for the demo.")

| Step | Time |
|---|---|
| `GET /health` | 0.60 s (the instance was already up after its health check) |
| models/status · datasets | 0.80 s · 4.82 s |
| demo samples: computed → cached | 6.80 s → 0.18 s |
| forensic samples: computed → cached | 2.02 s → 0.19 s |
| investigation, demo (`ACC-008782`) | 8.58 s |
| investigation, forensic (`FS-D948AB11`) | 5.74 s |

### Cold start (after more than 15 minutes with no traffic)

The last request before this measurement was at 03:52:50; the preflight ran at 04:11:00. Render's log shows a fresh process starting (application start-up complete at 04:12:28), so this was a real spin-down and spin-up. All 9 steps passed (exit 0, "Ready for the demo.").

| Step | Cold (04:11) | Warm repeat (04:13) |
|---|---|---|
| `GET /health` (wake) | **93.65 s** | 0.20 s |
| models/status · datasets | 0.81 s · 5.22 s | 0.20 s · 0.92 s |
| demo samples: computed → cached | 6.25 s → 0.20 s | 0.22 s → 0.20 s |
| forensic samples: computed → cached | 1.89 s → 0.28 s | 0.22 s → 0.20 s |
| investigation, demo · forensic | 8.64 s · 5.78 s | see below |

**One response cut off in transit.** In the warm repeat, the demo-ledger investigation's response was cut off part-way: `IncompleteRead` after 39,016 bytes of about 358 KB. The preflight then ended with a traceback (exit 1).

Render's log shows the server answered `200 OK`, kept passing its health checks, and did not restart. So this was not an application failure. Follow-up measurements against production isolated the cause:

| Client | Result |
|---|---|
| Uncompressed HTTP/1.1 (preflight and `curl --http1.1`) | 3 cut-offs in about 25 large transfers over the day. Cut at 11–39 KB. |
| HTTP/2 with compression (browsers; `curl --http2 --compressed`) | 0 failures in over 30 transfers |

- Render compresses for clients that ask, so the same response is 31.6 KB with Brotli or 33.7 KB with gzip, instead of 358 KB.
- Browsers fetch this way, which is consistent with no failures in any browser run.

**Fix:** commit `90d7b2e` makes the preflight ask for gzip and ask once more for a read-only response that is cut off. If it is cut off twice, the preflight reports a plain failure instead of a traceback.
- 7 new tests cover this; 4 of them fail against the previous script.
- The hardened preflight then passed **9/9 against production** at 04:23 (exit 0).
- The rerun of the original preflight (04:14) also passed, and three repeats of the cut-off investigation returned the full 357,993 bytes.

### Warm responses (smoke test, 70 requests)

| Request type | Median | Max |
|---|---|---|
| dynamic investigation (8) | 5.9 s | 10.9 s |
| v2 investigation | 2.0 s | 2.0 s |
| AI explanation while disabled (2) | 0.45 s | 0.67 s |
| account, case, trace, audit and sample reads | 0.19–0.25 s | 0.42 s |

### In the browser

Times from clicking "Start fund investigation" to the report:

| Account | Time |
|---|---|
| `FS-36B3099E` | 1.3 s |
| `FS-10B80A33` | 5.4 s |
| `FS-D948AB11` | 6.2 s |
| `ACC-000001` | 6.9 s |
| `FS-7BA8A2CC` | 7.4 s |
| `FS-7B7C13AB` (desktop / mobile / tablet) | 11.4 s / 13.5 s / 15.2 s |

The overview's first load took 5.5 s.

**Interpretation.**
- Investigations take seconds, not the 0.2–0.3 s seen locally, because the free instance has very little CPU. The UI shows the real steps while it works.
- There is no regression: the same `FS-7B7C13AB` investigation took 16.0 s on the previous release just before this one.
- Sample lists and reads are fast once cached.

---

## 9. QA-01 to QA-16 after release

| ID | Finding | Status | Production evidence (this release) |
|---|---|---|---|
| QA-01 | AI analyst live, automatic, anonymous, unthrottled | **FIXED AND VERIFIED** | Flag off and production gate in code; every AI state `disabled`; 0 automatic explanation requests in Chrome; 0 AI-provider log lines |
| QA-02 | AI output filter let guilt and freeze statements through | **FIXED AND VERIFIED** | Server-side fail-closed filter; mocked-provider tests and mock browser flow (§5.5); not exercisable in production while the analyst is off, by design |
| QA-03 | False role labels on the demonstration path | **PARTIALLY FIXED** | `FS-10B80A33` abstains; `FS-7305E412` "Role unknown"; model output labelled; **residual errors remain (§10)** |
| QA-04 | Anonymous case GETs write | **FIXED AND VERIFIED** | Audit total unchanged (2 → 2) across case trace, graph and transactions GETs and both browser runs |
| QA-05 | Safeguards hidden for connected accounts | **FIXED AND VERIFIED** | Inspector and affected accounts show innocent explanations, verification and missing information (09, 11) |
| QA-06 | Contradictory flagged-transfer counts | **FIXED AND VERIFIED** | `FS-10B80A33`: "1 … by the validated transaction model. 1 more … by a fixed rule only" (15) |
| QA-07 | Model badge/page described v2, not v3 | **FIXED AND VERIFIED** | Header popover and model page name the v3 models (02, 28) |
| QA-08 | Performance and reliability for a live demo | **PARTIALLY FIXED** | Preflight works in production and is now resilient to cut-off transfers; samples cached. Free-plan cold start (93.65 s) and slow CPU remain (§8) |
| QA-09 | `outside_training_range` differed between platforms | **FIXED AND VERIFIED** | Production (Render, Linux) and the release code on macOS agree exactly: **0 differences** across 49 scored transfers and 50 role assessments in 5 investigations, including all 8 `outside_training_range = true` flags, scores, flags, roles and restriction states. The macOS run used a forensic ledger rebuilt as Render builds it. A first attempt compared against a local server still running pre-release code, which showed 3 differences; it was discarded as an invalid baseline |
| QA-10 | Personal-data-shaped fields not consistently masked | **PARTIALLY FIXED** | UPI IDs masked in production (`a******1@okhdfcbank`); synthetic customer names still shown, by design |
| QA-11 | Placeholder-only form controls | **FIXED AND VERIFIED** | 5/5 audit filters and the fund-flow search have accessible names |
| QA-12 | Developer language for investigators | **FIXED AND VERIFIED** | Neutral heading for non-victim results; plain dataset notes (15, 19) |
| QA-13 | AI grounding ignored real-format IDs | **FIXED AND VERIFIED** | Mocked-provider tests; the analyst is off in production |
| QA-14 | Non-ASCII `X-API-Key` gave 500 | **FIXED AND VERIFIED** | Local regression tests. In production every write returns 503 before any key comparison, as writes are disabled |
| QA-15 | Security headers | **FIXED AND VERIFIED** | Now verified on Vercel-served pages and assets and on the API (§7); was "browser verification pending" |
| QA-16 | Dataset list omitted model support | **FIXED AND VERIFIED** | `model_support` and `model_note` in production; badges in the picker (03) |

**Totals:** 13 FIXED AND VERIFIED, 3 PARTIALLY FIXED (QA-03, QA-08, QA-10), 0 UNRESOLVED.

---

## 10. Remaining limitations and known risks

1. **Role labels can still be wrong (QA-03).** These errors are visible in production:
   - **`FS-7BA8A2CC`** has no scenario role but is shown as a *potential intermediary* with *urgent manual review* (16). Two independent kinds of evidence support the label: the account model plus funded forwarding.
   - **Untouched hold-out (seed 505):** 10 of 719 accounts with no scenario role are called *potential victims*, and 1 of the 6 served samples is a protective false-victim label.
   - **Cost of abstaining:** some correct victim labels were given up (11 of 53 on train, 10 of 30 on cold, 1 of 10 on the demo ledger), and intermediary recall on the hold-out is 87 of 113.
   - **No error rates in the UI:** error rates are not yet shown next to role labels.
   - **Mitigation:** every label is advisory and needs human review, with innocent explanations and missing information shown. No account is acted on.
2. **Free-plan performance (QA-08).**
   - The instance sleeps after 15 idle minutes, and waking it took **93.65 s** (§8).
   - Investigations take 1.3–15 s.
   - Run `scripts/demo_preflight.py` a few minutes before any demo. It is a one-shot warm-up and never calls the AI endpoints.
3. **Large uncompressed transfers can be cut off in transit.** Uncompressed HTTP/1.1 clients saw 3 cut-off responses in about 25 large transfers. Browsers (HTTP/2, compressed) were not affected in over 30 transfers, and the preflight is now hardened. If a browser ever shows a failed investigation, starting it again is safe: investigations are read-only.
4. **Synthetic customer names are shown (QA-10).** This is by design for the synthetic demo.
5. **The AI analyst is off in production.** Turning it on would need both `GEMINI_ANALYST_ENABLED=true` and `GEMINI_ANALYST_PRODUCTION_APPROVED=true`, and would use the free Gemini quota.
6. **Public writes are disabled.** Case reviews cannot be saved in the public demo, and the case database is re-seeded on every start. This is intended.
7. **Verification boundaries.**
   - The Vercel deployment ID comes from the GitHub commit status, not the Vercel API (expired CLI login).
   - Browser checks were automated in a visible Chrome window, not performed by a human hand.
   - Render's build skips one artefact-dependent test, as it did before this release.
8. **Open PR #10** (`pytest` 9.0.3) is untested with this release, so don't merge it just before a demo. Render runs pytest during its build, so a bump can change the build.
9. **Lint:** 146 oxlint warnings, all pre-existing (no errors).

---

## 11. Is it ready for a live demo?

**READY WITH DISCLOSED LIMITATIONS.**

Every critical workflow works in production on both datasets: navigation, sample selection, full investigation, trail, roles, cases, the reference tools and responsive layouts. Every safety check passed:
- human review is always required;
- no automatic action is taken;
- no guilt or freeze wording appears;
- innocent counterparties are protected;
- uncertain accounts abstain;
- model output is labelled as such;
- Gemini is off with nothing sent;
- no secrets are exposed;
- security headers are live.

It is not labelled "READY FOR LIVE DEMO" without qualification, because:
- some role labels are still wrong (§10.1), `FS-7BA8A2CC` among them;
- the free plan makes the first request after idling slow (about 94 s) and some investigations take up to 15 s.

**For the demo:**
- Run the preflight 2–5 minutes beforehand; if it reports a cut-off transfer, run it again.
- Present labels as prompts for review, which is how the product words them.
- If `FS-7BA8A2CC` comes up, use it as the honest example of a known false label.

---

## 12. Evidence and artefacts

**Preserved and verified unchanged:**
- **Original audit:** `docs/PRODUCTION_QA_AUDIT_2026-11-01.md` and its 33 screenshots. 34/34 SHA-256 identical to the hashes recorded before remediation, in the working tree and in `072e4e5`.
- **Remediation:** the report and the `qa-remediation-2026-11-02/` screenshots, unchanged since `072e4e5`.
- **`docs/screenshots/deploy-live/`:** 13 untracked PNGs of the older UI from the 29 October deployment check. No document references them.
  - **Decision:** they were inspected and deliberately left untracked and untouched.
  - **Check:** SHA-256 hashes were taken before and after the release, and all 13 files were identical afterwards (13/13).

**New in this release:** `docs/screenshots/release-2026-11-02/`:
- 49 screenshots, as listed in §6;
- `walkthrough-log.json` (part 1) and `walkthrough-part2-log.json`, holding every step, API call, console message, request host and timing;
- `walkthrough-next-steps-recheck.json` and `walkthrough-focus-probe.json`.

**Reproduction:**
- The API smoke test, Chrome walkthrough scripts, parity check and log summaries were scratch tools, deliberately kept out of the repository.
- To re-check production, use `python scripts/demo_preflight.py --base-url https://fraudshield-api-rpok.onrender.com` and the commands in §3.
