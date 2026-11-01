# FraudShield AI: production QA remediation (2026-11-02)

Remediation of the verified findings QA-01 to QA-16 in [`PRODUCTION_QA_AUDIT_2026-11-01.md`](PRODUCTION_QA_AUDIT_2026-11-01.md),
done locally. Nothing was pushed, merged or deployed, and no production setting, environment variable or data was changed.
The real Gemini provider was never called.

## 1. Status at a glance

**Production is still running the audited code.** Every fix below exists only on the local branch
`fix/production-qa-remediation`. Until it is deployed, production still has every finding, including the live,
automatically requested AI analyst (QA-01).

**Actions awaiting the owner's approval** (none taken):

1. **Immediate mitigation for QA-01 (still pending).** Set `GEMINI_ANALYST_ENABLED=false` on the Render service
   `fraudshield-api`, leave `GEMINI_ANALYST_PRODUCTION_APPROVED` unset, and change nothing else. A Render environment
   change restarts the service: about 1–2 minutes unavailable, and the case database is re-seeded, as on every restart.
2. **Deploy the remediation:**
   - push the branch and open a PR to `main` (`gh pr merge` needs the owner);
   - fast-forward `v2-rebuild`, which Render deploys from;
   - let Vercel build `main`.

   Once deployed, the analyst stays off in production even if `GEMINI_ANALYST_ENABLED=true`. It also needs
   `GEMINI_ANALYST_PRODUCTION_APPROVED=true`, which should stay unset.
3. **After deploying,** verify the Vercel response headers (QA-15) and re-measure on Render (QA-08), using
   `scripts/demo_preflight.py`.

| QA | Sev. | Finding | Status | Production |
|---|---|---|---|---|
| QA-01 | P1 | AI analyst live in production, automatic, anonymous, unthrottled | **FIXED AND VERIFIED** | Affected until the env change or a deploy |
| QA-02 | P2 | AI output filter let guilt and freeze statements through | **FIXED AND VERIFIED** | Affected until deploy (mitigated by the env change) |
| QA-03 | P1 | False role labels on the demonstration path | **PARTIALLY FIXED** | Affected until deploy |
| QA-04 | P2 | Anonymous case GETs write to the database and audit log | **FIXED AND VERIFIED** | Affected until deploy |
| QA-05 | P2 | Innocent explanations and missing information hidden for connected accounts | **FIXED AND VERIFIED** | Affected until deploy |
| QA-06 | P2 | Overview gives contradictory flagged-transfer counts | **FIXED AND VERIFIED** | Affected until deploy |
| QA-07 | P2 | Model badge and Model performance page describe v2, not the v3 models investigations use | **FIXED AND VERIFIED** | Affected until deploy |
| QA-08 | P2 | Performance and reliability risk for a live demo | **PARTIALLY FIXED** | Cold starts remain (free plan) |
| QA-09 | P3 | `outside_training_range` differs between platforms | **FIXED AND VERIFIED** | Affected until deploy |
| QA-10 | P3 | Personal-data-shaped fields not consistently masked | **PARTIALLY FIXED** | Affected until deploy |
| QA-11 | P3 | Placeholder-only form controls | **FIXED AND VERIFIED** | Affected until deploy |
| QA-12 | P3 | Developer language and raw formatting for investigators | **FIXED AND VERIFIED** | Affected until deploy |
| QA-13 | P3 | AI grounding ignores real-format IDs | **FIXED AND VERIFIED** | Affected until deploy |
| QA-14 | P3 | Non-ASCII `X-API-Key` header gives 500 instead of 401 | **FIXED AND VERIFIED** | Affected until deploy |
| QA-15 | P3 | Security headers | **FIXED — BROWSER VERIFICATION PENDING** | API verified locally; Vercel headers only after a deploy |
| QA-16 | P3 | `GET /api/v2/datasets` omits model support | **FIXED AND VERIFIED** | Affected until deploy |

"Verified" means automated regression tests plus, where the finding is visible in the product, a walkthrough in
real, visible Google Chrome (not headless) against a production-equivalent local stack (§4).

## 2. Repository state

| | Start | End |
|---|---|---|
| Branch | `feat/dynamic-fraud-intelligence` | `fix/production-qa-remediation` (new, local only, created from `origin/main` = `eacaa7e`) |
| Commit | `4b58711fb7bad223cc785b8ec0c55ea1985b327c` | Code, tests and evidence: `893b4dfc9c3f4265df2cf8908fcb291543445ab6`. This report is committed on top of it as the branch's last commit; that SHA is in the hand-over message (`git log -1`). |
| `origin/main` | `eacaa7e88efac250df3e1ebf39aec6c52260c704` (same tree as `4b58711`, verified with `git diff --stat`) | unchanged; nothing pushed |

Start `git status --short`:

```
?? docs/PRODUCTION_QA_AUDIT_2026-11-01.md
?? docs/screenshots/deploy-live/
?? docs/screenshots/qa-2026-11-01/
```

Expected end `git status --short` after the two local commits (the earlier deployment screenshots are not part of
this work and stay untracked):

```
?? docs/screenshots/deploy-live/
```

- **Commit identity:** both commits are authored and committed by `Samarth Khera
  <188962529+samarth-khera@users.noreply.github.com>`, with no co-author trailer.
- **Audit artefacts committed unchanged:** the original QA audit report and its 33 screenshots
  (`docs/screenshots/qa-2026-11-01/`) are in the code commit. All 34 files were re-checked against the SHA-256 hashes
  recorded before remediation: 34 of 34 are identical.
- **New evidence location:** new screenshots are in `docs/screenshots/qa-remediation-2026-11-02/`, separate from the
  originals.

## 3. Test results (final code)

| Suite | Command | Result |
|---|---|---|
| Backend | `backend/.venv/bin/python -m pytest backend/tests` | **575 passed**, 0 failed (437 at `4b58711`; 138 new) |
| ML | `… -m pytest ml/tests` | **90 passed**, 0 failed (unchanged) |
| Frontend unit and component | `npx vitest run` | **172 passed** in 10 files, 0 failed (162 at `4b58711`; 10 new) |
| TypeScript | `npx tsc --noEmit -p .` | 0 errors |
| Lint (oxlint) | `npm run lint` | exit 0: 146 warnings, 0 errors (identical to `4b58711`: 146 warnings, 0 errors; no new findings) |
| Production build | `npm run build` (with `VITE_API_URL` set) | success |

**New test files:**
- `backend/tests/test_qa_remediation_ai.py` (116 tests: QA-01, QA-02, QA-13);
- `backend/tests/test_qa_remediation_backend.py` (15 tests: QA-03, QA-06, QA-07, QA-08, QA-09, QA-10, QA-12,
  QA-15, QA-16);
- `backend/tests/test_qa_remediation_cases.py` (7 tests: QA-04, QA-14);
- 10 new frontend tests in `investigation.test.tsx`, `routes.test.tsx` and `modelInsightsPage.test.tsx`.

**Existing tests that asserted the old, defective behaviour** were changed deliberately; each change is explained in
the test itself:

| Test | Old assertion | Why it changed |
|---|---|---|
| `test_trace_persists_trace_paths` → `test_trace_view_is_computed_and_stores_nothing` | A GET writes trace paths | That write is QA-04 |
| `test_negated_restriction_language_is_kept` (renamed) | Negated freeze wording passes | The explanation must not discuss restriction at all, not even to rule it out |
| `test_investigated_victim_and_unfunded_flags`; `test_forwarder_gets_a_documented_category_not_an_injected_onward` (last assertion) | FUNDED_FORWARD alone makes an intermediary | That is the QA-03 `FS-10B80A33` mechanism |
| 13 inline-mode AI tests in `test_v2_ai_analyst.py` | Relied on the old `inline` default | They now pass `ai_explanation="inline"` explicitly, because the default is now `separate` |
| Two payload assertions in `test_v3_ai_and_v2_model.py` | The restriction state is sent to the model | It is no longer sent |

I also checked that the new tests catch the defects. Run against the `4b58711` versions of `routes.py` and `auth.py`,
5 of the 7 QA-04/QA-14 tests fail. The other two pass on old code, because on old code the page view itself had
already written the trace.

## 4. Real Chrome verification (local, production-equivalent)

### Stack

- **Frontend:** production build (`vite build`, `VITE_API_URL=http://127.0.0.1:8001`) on `:4173`. It is served by a
  small static server that applies the exact headers from `frontend/vercel.json`, with one difference:
  `connect-src https://*.onrender.com` is replaced by the local API origin, so the page can reach the local backend.
- **Backend:** `ENVIRONMENT=production` on `:8001`, with the production configuration replicated:
  - `GEMINI_ANALYST_ENABLED=true` and a dummy key that is not a real secret;
  - no `GEMINI_ANALYST_PRODUCTION_APPROVED`;
  - no `ADMIN_API_KEY`, so writes are disabled.

  It runs on a copy of the case database.
- **Untouched:** the existing development servers on `:8000` and `:5173` were neither used nor stopped.
- **Browser:** Google Chrome, visible window, driven by Playwright with the system Chrome executable. Nothing was
  blocked: explanation requests were only counted.

### Result: 22 of 22 checks passed, on the final code

These are the screenshots `01`–`10` and `walkthrough-log.json`.

| Check | Result |
|---|---|
| Dataset cards show model support before an account is chosen | `Models reference only: out of distribution` / `Models validated on this dataset` (QA-16) |
| Suggested samples | `FS-10B80A33` gone; the basis states the own-money criterion (QA-03, QA-08) |
| `FS-10B80A33` | **Insufficient evidence**, role unknown, heading "What the records show about FS-10B80A33". Was "potential intermediary" with additional verification (QA-03, QA-12) |
| `FS-10B80A33` counts | "1 … was flagged by the validated transaction model. 1 more was flagged by a fixed rule only …" and "made 2 flagged transfers …: 1 transfer (₹30,124) flagged by the transaction model and 1 (₹50,843) by a fixed rule only" (QA-06) |
| AI stage (production gate closed) | "The optional AI analyst is not available on this server … Nothing from this investigation was sent to an AI provider", no request button (QA-01) |
| `FS-7305E412` in the `FS-7B7C13AB` investigation | **Role unknown**: "Not called a potential victim: the payment took less than 50% of its balance at the time". Was "potential victim" with urgent review (QA-03) |
| Model flag on `FS-7305E412`'s own transfer | Badge **Model output**; it was mislabelled "Recorded fact" (QA-03, see §5) |
| `FS-EAAA344C` row | Innocent explanations, verification needed and missing information visible; separate "What the records show" / "Interpretation" / "Unknown" blocks (QA-05, QA-03) |
| Account Inspector for `FS-EAAA344C` | Same safeguards (QA-05) |
| Model status popover | `v3-transaction-1.0.0` and `v3-account-1.0.0` for investigations; `v2-account-2.0.0` only for the Accounts tool and case review (QA-07) |
| Model performance page | Leads with "Models behind investigations (v3)" and per-dataset support (QA-07) |
| Demo ledger `ACC-000001` | Banner `unsupported_distribution_shift`; heading "flagged by the fixed rules (the transaction model is not validated on this dataset …)"; model note without file paths or "PSI" (QA-06, QA-12) |
| Case pages `FS-2001` and `FS-1042`, every stage | 10 GETs to trace and graph. A digest of every row of every case-database table before and after the walkthrough is **identical** (QA-04) |
| Audit page and fund-flow search | Every control found by its accessible name (QA-11) |
| Whole walkthrough | **0** explanation requests, **0** CSP violations reported by Chrome, **0** console errors |

### First run of the walkthrough (before the final evidence-label fix)

- 21 checks passed.
- The Inspector check failed because of my script, not the product: it clicked the first step button mentioning
  `FS-EAAA344C`, which in the real data is a transfer step, so it opened the transfer inspector.
- Opening the account from its tree node passed. That selector is used in the final run above.

### AI request flow, against a local mock provider (screenshots `11`–`12`, `ai-flow-log.json`)

**How it was set up.** The analyst stays off in production unless approved, and the real provider must not be called.
So I ran the same application in production mode with `GEMINI_ANALYST_PRODUCTION_APPROVED=true`, and with the Gemini
SDK module replaced by a deterministic **mock** (`GEMINI_MODEL=local-mock-provider`). The UI's "Written by Google
Gemini (local-mock-provider)" text is the real wiring's wording; the text itself came from the mock.

| Check | Result |
|---|---|
| Report loaded with the analyst enabled and approved | **0** explanation requests; header chip "AI explanation: on request"; stage says "never generated automatically" |
| One click on **Request AI explanation** | Exactly **1** request |
| Planted unsafe statement ("… is the fraudster behind this scheme; freeze it today.") | Removed and counted ("1 statement(s) … removed"), never shown |
| Manual checks | Show the server's fixed wording |
| The same report explained again | Served from the server cache ("Reused from an identical earlier request"). The mock provider was called **once** for the two requests (server log) |

## 5. Findings: cause, change, tests, evidence

### QA-01: production AI analyst live, automatic, anonymous, unthrottled — FIXED AND VERIFIED

**Root cause.** `precheck()` returned `deferred` whenever `GEMINI_ANALYST_ENABLED=true` and a key existed, and the
production service had both. `InvestigatePage` then requested the explanation automatically after every report. The
explanation endpoints had no limit or cache. The old `POST /api/v2/investigations` defaulted to `inline`.
Production messages also distinguished "turned off" from "no key configured".

**Change (`backend/app/services/v2/ai_analyst.py`):**

- **Production gate.** With `ENVIRONMENT=production`, the analyst needs `GEMINI_ANALYST_PRODUCTION_APPROVED=true` as
  well as `GEMINI_ANALYST_ENABLED=true`. Otherwise it stays off, and the SDK is not even imported at startup. The log
  names the missing approval, never the key.
- **Generic public state.** In production, "off", "not approved" and "no key" all return the same
  `state: "disabled"`, message "The optional AI analyst is not available on this server.", with no provider, model or
  privacy policy. Development keeps the detailed states.
- **Process-wide guard on the real provider** (`ExplanationGuard`; it never waits or holds a worker):
  - one call at a time (`busy`);
  - a rolling hourly budget (`GEMINI_MAX_CALLS_PER_HOUR`, default 30; `local_rate_limited`);
  - a one-hour cache of completed explanations of the identical extract. Failures are not cached.
- **Endpoint behaviour.**
  - `POST /api/v2/investigations` now defaults to `ai_explanation: "separate"`.
  - Both explanation endpoints return at once without recomputing the investigation when the analyst cannot run.
  - An unknown account is still a 404.

**Change (frontend):**
- `InvestigatePage` never requests an explanation by itself.
- `AIStage` offers **Request AI explanation** only when the server says one can be produced, and says what would be
  sent and that nothing was sent until then. A failed request can be retried only by a click.
- The disabled state says plainly that nothing was sent.

**Not done.** Per-client rate limiting: behind Render's proxy the client address cannot be trusted without configured
forwarded-header trust, so the global limits are the reliable bound. This is documented in `docs/AI_ANALYST.md`.

**Tests:**
- `test_qa_remediation_ai.py`: gate, approval value, the generic state for 5 production configurations, development
  states, production endpoints, the `separate` default, no recompute when disabled, cache reuse, failures not cached,
  hourly budget and concurrency, guard release on provider errors, guard on the real provider path, and logs;
- frontend: no automatic request, manual request, retry only on click, and the disabled message.

**Evidence:** §4 (both walkthroughs).

**Production:** the mitigation `GEMINI_ANALYST_ENABLED=false` is **still pending your approval**.

### QA-02: AI output filter bypassed — FIXED AND VERIFIED

**Root cause.** Three narrow regular expressions, a free-text `recommended_manual_checks` field, and no
fail-closed rule.

**Change (`ai_analyst.py`):**

1. **Structural.**
   - `recommended_manual_checks` is now an enumerated `check` code from 10 fixed checks (`MANUAL_CHECKS`).
   - The text shown is the server's reviewed wording, so a recommendation can never carry a directive.
   - An unknown code rejects the answer.
2. **Normalisation.** Before matching, the text is normalised: NFKC, combining accents stripped, zero-width and
   soft-hyphen characters removed, typographic hyphens and quotes normalised, and letter-spaced words joined.
   Letters from look-alike scripts (for example Cyrillic `е`) always fail.
3. **Rule families:**
   - guilt, criminal identity or criminal acts, affirmed or denied;
   - punitive or restriction wording, including when ruled out;
   - everyday verbs with an account, card, transfer or money as their object ("close the account", "PA-002 should be
     closed");
   - certainty about wrongdoing, except when negated ("does not prove", "no proof");
   - prompt-injection residue.
4. **Fail closed.** The whole answer is discarded when:
   - the summary or confidence note fails a rule;
   - every check or every limitation is removed; or
   - more than half of all statements are removed.
5. **Model input and instructions.** The advisory restriction state is no longer sent to the model, and the system
   instruction lists the banned vocabulary.

**Tests:**
- the 13 phrasings the 2026-11-01 security audit used (9 of which were shown before), each as the summary (answer
  discarded), as an observation and as a limitation (statement removed and counted);
- 38 paraphrases, including obfuscated spellings, all detected;
- 16 ordinary evidence sentences that must still pass, all pass;
- the fail-closed thresholds;
- the enumerated checks.

**Evidence:** §4, mock flow.

### QA-03: false role labels on the demonstration path — PARTIALLY FIXED

**Root causes** (traced in `backend/app/intelligence/roles.py`):

1. **`FS-10B80A33`.** The investigated-account branch called an account a `potential_intermediary` when FUNDED_FORWARD
   was its only kind of evidence.
2. **`FS-7305E412`.** An "other sender" (found by looking at other payments into a traced hub) became a
   `potential_victim` on its model-flagged, "unfunded", deviating payment. Two problems:
   - "Unfunded" only meant that the balance *could* have covered the payment. Intermediaries with large balances
     passed money on and still qualified.
   - Nothing required a material loss: `FS-7305E412`'s ₹12,500 was 30% of its balance.

**Measured on the train ledger first** (design ledger; ground truth read only by the evaluation scripts
`ml/forensics/qa03_role_measurement.py` and `ml/forensics/qa03_sample_outcomes.py`):

- **Investigated accounts labelled potential intermediary on FUNDED_FORWARD alone:** 4. Three were wrong (a victim, a
  legitimate look-alike, an account without a scenario role) and one was right. All 122 labels with ≥ 2 kinds of
  evidence were right.
- **Other senders labelled potential victim:** 102, of which 49 were intermediaries.
  - All 49 had received at least the payment's amount in the 24 h before it; no true victim had received more than 69%.
  - The audit's suggested condition, "the hub passed the payment on", would have removed 47 of the 53 true victims, so
    it was rejected.

**Change (rules designed on train only, using the engine's existing thresholds):**

- **Investigated account.** FUNDED_FORWARD as the only independent kind of evidence abstains:
  - role `unknown_role`, status "Insufficient evidence", restriction `insufficient_evidence_to_recommend`;
  - the observation stays listed, with an explicit uncertainty reason.
- **Other senders.** `potential_victim` additionally needs:
  - the money received in the previous 24 h covered < 70% of the payment (`INTERMEDIARY_SHARE`); and
  - the payment took ≥ 50% of its balance (`OWN_FUNDS_SHARE`).

  Otherwise `unknown_role`, with the missing condition named. The engine computes both shares from recorded transfers
  only.
- **Sample accounts (ground-truth-free).** The rule chooses established personal accounts with a large transfer that
  took ≥ 50% of a balance they already held, not money just received, largest first.
  - On train it gives 5 scenario victims and 1 legitimate look-alike, all assessed in line with their role.
  - Ranking by share of balance, the first candidate tried, gave mostly ordinary small payments.
- **UI.** Each connected account now shows separate "What the records show", "Interpretation" ("Possible role …;
  not a finding about the holder") and "Unknown" blocks, in the affected-account rows and the Inspector.
- **Evidence labels (display only).** A supporting sentence stating a model's output ("Its own transfer … is flagged by
  the transaction model") was labelled "Recorded fact"; it is now "Model output".
- **Guarantees.** No account ID is hard-coded anywhere. A test asserts that the sample query never touches scenario or
  label columns.

**Results, same method before and after.** Train is the design ledger; cold and demo had been looked at in earlier work.

| Ledger | Investigated "potential intermediary": wrong labels | Other-sender "potential victim" |
|---|---|---|
| Train (849 roots) | 3 wrong single-kind labels → 0 (1 correct single-kind label lost) | 102 (49 intermediaries) → 42 (0 intermediaries; 11 of 53 true victims lost) |
| Cold (773 roots) | 1 wrong single-kind label → 0; 2 multi-kind errors unchanged | 79 (48 intermediaries, 1 no role) → 20 (all victims; 10 of 30 true victims lost) |
| Demo / served (509 roots) | 0 wrong before or after (2 correct single-kind labels lost) | 92 (81 intermediaries, 1 attacker-controlled = `FS-7305E412`) → 9 (all victims; 1 of 10 lost) |

**Suggested samples on the served ledger.**
- **Previous list:** `FS-10B80A33` first.
  - 1 investigation produced an ordinary account labelled potential victim (protective direction).
  - 1 sample was a true victim.
- **New list:**
  - two victims and a secondary victim, labelled potential victims;
  - two legitimate look-alikes, "Insufficient evidence";
  - one intermediary labelled potential victim (protective direction).

  Same contradiction count (1 of 6), but the list now illustrates real scenarios, and no sample leads to a
  suspicious-direction label.

**Untouched evaluation.**
- **Why a new seed.** Seed 404 was evaluated under the earlier code, and `holdout_evaluation.py` now correctly refuses
  to run it again. I added ledger `holdout_2026_11` (seed 505, same size and mix) after the QA-03 rules were frozen.
- **Run.** I evaluated it exactly once (`ml/reports/holdout_evaluation_holdout_2026_11.json`, 125 investigations,
  manifest `2f12b680…`).
- **Results:**
  - victims labelled potential victim: 47 of 54 (87.0%), with suspicious activity detected in 92.6%;
  - **0** innocent counterparties or accounts without a scenario role labelled intermediary or suspicious, and
    **0** restriction reviews for them;
  - **0** attacker-controlled accounts or intermediaries labelled potential victim;
  - 10 of 719 accounts without a scenario role labelled potential victim (protective direction);
  - intermediary recall within traces: 87 of 113.
- **Protocol disclosure.** After this run I made one display-only change to `engine.py`, the "Model output" evidence
  label above. The current manifest therefore differs from the evaluated one in that file only.
  - That field is read by no rule.
  - Run on 62 investigations (565 assessments) of the served ledger, not the hold-out, the change left every role,
    status, restriction state, category, strength and evidence text identical. Only 17 labels changed, all on
    model-flag sentences.

**Why "partially".**
- The two audited mechanisms are fixed: both accounts are verified in the browser, the error classes are measured, and
  0 such labels remain on the untouched ledger.
- Residual errors remain and are documented, not hidden:
  - protective false-victim labels (10 of 719 on the untouched ledger; 1 of the 6 served samples);
  - two-kind intermediary labels on uninvolved accounts. On cold 2 of 101; on the served ledger `FS-7BA8A2CC` (no
    scenario role, account model plus funded forwarding) is still a potential intermediary with urgent manual review.
    No train evidence supports tightening further; on train all two-kind labels were right.
- The recall cost above is the price of abstaining.
- Error rates are not yet shown next to role labels in the UI, which the audit also suggested.

### QA-04: case GETs write — FIXED AND VERIFIED

**Root cause.** `_run_trace()` in `backend/app/api/routes.py` called `repo.save_trace_paths()` on every
`GET /api/cases/{id}/trace|graph|transactions`. The repository's review-scope check reads those stored paths.

**Change:**
- The GETs only compute.
- The authorised review write (`PUT …/accounts/{id}/review`, behind `verify_write_permission`) stores the trace at the
  deepest depth a page can request, before recording the review. An account seen in the trace at any depth stays in
  scope, and storing (and its audit event) happens only on that guarded write.

**Tests** (`test_qa_remediation_cases.py`, each with a digest of every row of every table before and after):
- GETs at alternating depths change nothing;
- an authorised review of an account that is only reachable through the trace works with no prior page view;
- unrelated accounts stay out of scope;
- a production write without a key is refused and nothing is stored.

**Evidence:** §4 (database identical after the real-browser case visits).

### QA-05: safeguards hidden for connected accounts — FIXED AND VERIFIED

**Change (`frontend/src/components/investigation/intel.tsx`).** `RestrictionPanel compact` now always shows innocent
explanations, verification needed and missing information. It leaves out only what the surrounding view already shows
(supporting evidence and the transfer list). The uncertainty reason is shown in the new "Unknown" block. The
left-to-right tree is unchanged.

**Tests:** every connected account with innocent explanations shows them, its missing information and its
verification steps, in the rows and in the Inspector.

**Evidence:** screenshots `05`, `06`, `06b`.

### QA-06: contradictory counts — FIXED AND VERIFIED

**Root cause.** With a validated model, `suspicious_transactions` holds model flags only, and rule-only flags move to
a separate list. The heading still said "flagged by the transaction model or the fixed rules", and the narrative
summed both kinds.

**Change:**
- **Heading:** "N … flagged by the validated transaction model. M more … by a fixed rule only; … not treated as
  suspicious". Without a validated model: "flagged by the fixed rules (the transaction model is not validated …)".
- **Narrative:** gives each check's count and amount separately.

**Tests:** a backend invariant (disjoint lists, model flags only), and a frontend test of the exact `FS-10B80A33`
shape.

**Evidence:** screenshots `02`, `09`.

### QA-07: v2 model described instead of v3 — FIXED AND VERIFIED

**Change:**
- `GET /api/v2/models/status` adds `investigation_models` (the v3 transaction and account models: versions, thresholds,
  held-out results, readiness, and per-dataset support) and `account_model_scope`.
- The header badge now reads "Models ready" (or "Models unavailable") from the v3 models. It names
  `v3-transaction-1.0.0` and `v3-account-1.0.0`, and says `v2-account-2.0.0` serves only the Accounts tool and case
  review.
- The Model performance page leads with "Models behind investigations (v3)". The v2 tab is relabelled "Accounts tool &
  case review".

**Tests:** backend, header, model page, and the unavailable case.

**Evidence:** screenshots `07`, `08`.

### QA-08: performance and reliability — PARTIALLY FIXED

**Profiling.** The sample-accounts query scans every large transfer on every call; it is uncached, and on Render took
6.3–6.8 s per call.

**Change:**
- Samples are cached per dataset, database and latest transfer time, for at most 15 minutes. The ledgers are read-only
  at run time.
- New `scripts/demo_preflight.py`, a one-shot warm-up and report:
  - waits for `/health`;
  - reads the model status and datasets;
  - computes and re-reads the samples;
  - runs one investigation per dataset.

  It never calls an explanation endpoint, never writes, and is not a keep-alive (no background pings).
- Cold starts, the 0.1-CPU latency and the preflight are documented in `README.md`.

**Measurements** (this Mac, local, production mode; Render was not re-measured because that needs a deploy):

| Request | Before (old code, `:8000`) | After: cold (fresh process) | After: warm |
|---|---|---|---|
| `GET /api/v2/datasets` | 0.53 s first, then 0.04–0.05 s | 0.26 s | 0.04 s |
| Demo-ledger sample accounts | 1.19 s first, then 0.33–0.36 s on **every** call | 1.07 s (computed once) | 0.00 s (cached) |
| Forensic sample accounts | 0.28 s first, then 0.08–0.09 s every call | 0.08 s | 0.00 s |
| Dynamic investigation | n/a | 0.24 s (`FS-D948AB11`), 0.32 s (`ACC-008782`) | 0.21 s, 0.32 s |
| Preflight overall | n/a | 9 of 9 steps OK; `/health` answered after 5.1 s (process start) | 9 of 9 OK |

**Why "partially".**
- The free plan still sleeps (37–94 s to wake, measured on 2026-11-01).
- Investigations on Render's 0.1 CPU still take seconds.
- The first sample request per process still computes.

Those need a paid instance or the preflight before a demo. Production timings must be re-measured after a deploy.

### QA-09: training-range flag differs by platform — FIXED AND VERIFIED

**Change (`backend/app/intelligence/models.py`).** Inclusive bounds with a relative tolerance of 1e-9. A value one
floating-point step beyond a stored bound is the same number computed on another platform.

**Tests:** the exact audit values, `log1p(2)` against `1.0986122886681098`, one step either side, a real excess, and
NaN.

### QA-10: personal-data fields — PARTIALLY FIXED

**Change.** `upi_id` is masked like an e-mail address (`a******1@okhdfcbank`); the payment-provider suffix is kept.

**Why "partially".** `customer_name` is still returned and shown by design: investigators work with names, and all
data is synthetic. If a non-synthetic source were ever configured, names and all reads would need authentication.

**Tests:** an API test of the masking.

### QA-11: placeholder-only controls — FIXED AND VERIFIED

**Change.** Accessible names added to the six audit-page controls, the fund-flow search and the model-page search.

**Evidence:** §4, every control found by its label in Chrome.

### QA-12: developer language and formatting — FIXED AND VERIFIED

**Change:**
- the dataset model notes are in plain language (no "PSI", no repository paths; the sources stay in code comments);
- rule amounts use rupees with Indian grouping (`₹2,50,000`, shared `formatting.inr`);
- the victim question heads only a victim-side result, otherwise "What the records show about …";
- every calibrated score shows the review threshold and "A model score, not a probability of fraud".

**Tests:** backend rupee formatting on the rule that printed `250000.00`; frontend heading and score text.

**Evidence:** screenshots `02`, `09`.

### QA-13: grounding ignored real-format IDs — FIXED AND VERIFIED

**Change.** Every `PA-`, `PT-` or `F-` token must be an alias that was sent, in any spelling (lower case, typographic
hyphens, extra digits). Real-format IDs (`ACC-`, `TXN-`, `TX-`, `FS-`, `CASE-`, `SC-`) always fail. Aliases are
mapped back in any accepted spelling.

**Tests:** the audit's cases `PT-777`, `PT-1234`, `TXN-0099999`, `ACC-000777` and `FS-DEADBEEF`, plus more, in a
statement (removed) and in the summary (answer rejected).

### QA-14: non-ASCII `X-API-Key` gives 500 — FIXED AND VERIFIED

**Change.** The key is compared as UTF-8 bytes (`backend/app/api/auth.py`).

**Tests:** three non-ASCII headers return 401 `unauthorized`, and the database is unchanged.

### QA-15: security headers — FIXED — BROWSER VERIFICATION PENDING

**Change (API, `backend/app/main.py`):**
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'` (the optional API docs paths
  excepted);
- HSTS in production;
- `X-XSS-Protection: 0`;
- an innermost error middleware, so an unhandled 500 keeps both the security and the CORS headers.

**Change (frontend, `frontend/vercel.json`).** CSP (`script-src 'self'`, Google Fonts, `connect-src`
`https://*.onrender.com`, `frame-ancestors 'none'`), HSTS, nosniff, `X-Frame-Options`, `Referrer-Policy` and
`Permissions-Policy`.

**Verified:**
- API headers by tests and `curl`, including a forced 500 with CORS;
- in real Chrome, the configured frontend policy, served locally with the local API origin, produced **0** CSP
  violations and 0 console errors.

**Pending.** That Vercel serves these headers, and that the production `connect-src` value works against the real
Render origin, can only be checked after a frontend deploy.

### QA-16: datasets list without model support — FIXED AND VERIFIED

**Change.** `GET /api/v2/datasets` returns `model_support` and `model_note`, and each dataset card shows a tag.

**Tests:** API and picker.

**Evidence:** screenshot `01`.

## 6. Files changed

**Backend:**
- `backend/app/services/v2/ai_analyst.py`, `investigation.py`, `account_service.py`, `risk_assessment.py`, and new
  `formatting.py`;
- `backend/app/api/routes.py`, `auth.py`, `v2/routes.py`, `v2/dynamic_routes.py`, `v2/schemas.py`,
  `v2/dynamic_schemas.py`, `v2/investigation_schemas.py`;
- `backend/app/intelligence/roles.py`, `engine.py`, `models.py`, `datasets.py`;
- `backend/app/main.py`.

**Frontend:**
- `InvestigatePage`, `CaseView`, `AIStage`, `labels`, `intel`, `AffectedAccountsStage`, `Inspector`, `IntelOverview`,
  `OverviewStage`, `narrative`, `DatasetPicker`;
- new `components/models/InvestigationModelsPanel`, `useModelStatus`, `UnifiedHeader`, `ModelInsightsPage`,
  `AuditPage`, `FundFlowPage`;
- types; `vercel.json`.

**ML and scripts:**
- `ml/forensics/generator.py` (seed-505 ledger), `holdout_evaluation.py` (`--ledger`);
- new `qa03_role_measurement.py`, `qa03_sample_outcomes.py`;
- new `scripts/demo_preflight.py`.

**Docs:** `docs/AI_ANALYST.md`, `docs/DYNAMIC_INTELLIGENCE.md`, `README.md`, and this report.

**Reports** (`ml/reports/`):
- `qa03_role_measurement_{train,cold,demo}[_before].json`;
- `qa03_sample_outcomes_{train,demo}.json`;
- `holdout_evaluation_holdout_2026_11.json`;
- `investigation_eval_holdout_2026_11.json`.

**Tests:** the three new backend files; updated backend and frontend tests (§3).

## 7. Remaining risks

- **Production is unchanged** until the pending actions in §1 are approved and carried out.
- **QA-03 residual labels** (§5), including `FS-7BA8A2CC`, and the recall cost of abstaining. Role labels remain
  candidates for human review: every restriction state still requires human review and takes no automatic action.
- **Free-plan limits:** cold starts and low CPU.
- **Not checked in a browser:** the AI request flow with the real provider. Only a mock was used, by design; the real
  provider must stay unapproved in production.
- **Re-check after deploy:** Vercel header delivery.
