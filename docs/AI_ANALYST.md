# AI analyst (Google Gemini)

After a live investigation finishes, the server can ask Gemini to explain the result in plain language. The
explanation appears as `ai_analysis` in `POST /api/v2/investigations` and in the **AI analyst** stage of
`/investigate`. It never changes a score, amount, exposure range or finding. The browser never talks to Gemini and
never sees the key.

Code: `backend/app/services/v2/ai_analyst.py` (policy, payload, validation) and
`backend/app/services/v2/gemini_provider.py` (the only module that uses the official `google-genai` SDK).

## Production safeguards (QA remediation, 2026-11-02)

The 2026-11-01 production QA audit found the analyst live in production, requested automatically for every
investigation, anonymous and unthrottled, with an output filter that let guilt and freeze statements through
(QA-01, QA-02, QA-13). Since then:

- **Off in production unless approved twice.** With `ENVIRONMENT=production`, `GEMINI_ANALYST_ENABLED=true` alone
  does nothing: the analyst also needs `GEMINI_ANALYST_PRODUCTION_APPROVED=true`, set by an operator once the
  safeguards below are acceptable for the deployment. Without it the SDK is not even imported at startup, and a log
  line names the missing approval (never the key).
- **Generic public state.** In production every "cannot explain" configuration (switched off, waiting for
  approval, or no key) answers the same: `state: "disabled"`, message "The optional AI analyst is not available on
  this server.", no provider, model or privacy policy. A response never reveals whether a key is configured.
  Development keeps the detailed `disabled` / `not_configured` states.
- **Never automatic.** `/investigate` no longer requests an explanation. The AI stage shows **Request AI
  explanation**, and only that click sends `POST /api/v2/dynamic-investigations/explanation`. Until then nothing from
  the investigation is sent to an AI provider, and the stage says so. `POST /api/v2/investigations` now defaults to
  `ai_explanation: "separate"` as well; `"inline"` must be asked for.
- **Server-side guard on the real provider** (process-wide, in memory, never waits):
  - at most one Gemini call at a time: a concurrent request returns `unavailable / busy` at once;
  - at most `GEMINI_MAX_CALLS_PER_HOUR` calls (default 30) in any rolling hour: `unavailable / local_rate_limited`;
  - a completed explanation of the identical extract (same model, instructions and pseudonymised data) is reused
    for an hour instead of calling Gemini again. Failures are not cached.
  Per-client limits are not used: behind Render's proxy the client address is not trustworthy without configured
  forwarded-header trust, so the global limits are the reliable bound.
- **Fail-closed output safety** (see Validation): manual checks are codes from a fixed list with server wording;
  guilt, criminal-identity, certainty, punitive or restriction wording (in any spelling, including look-alike letters,
  full-width or accented characters, zero-width characters and letter-spaced words) removes a statement; in the
  summary or confidence note, or when a required section would be empty, or when more than half of the statements fail,
  the whole answer is discarded. Every ID-like token must be an alias that was sent; real-format IDs always fail.
- The advisory restriction state is no longer sent to the model at all.

**Production mitigation still pending owner approval:** setting `GEMINI_ANALYST_ENABLED=false` on the Render service
(and leaving `GEMINI_ANALYST_PRODUCTION_APPROVED` unset). The code above keeps the analyst off in production even
without that change once it is deployed, but until a new build is deployed the running service still has the
2026-11-01 behaviour.

## Render configuration

Set these on the `fraudshield-api` service (Environment tab). Adding a variable does not prove the integration
works; check `ai_analysis.state` on a real investigation afterwards.

| Variable | Required | Code default | Production (Render, 2026-10-29) |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | none | set (secret; never in a `VITE_` variable) |
| `GEMINI_ANALYST_ENABLED` | yes | off (only `true` turns it on) | `true` |
| `GEMINI_MODEL` | no | `gemini-3.8-flash` | not set (default) |
| `GEMINI_TIMEOUT_SECONDS` | no | `25` (bounded 3–300) | `180` (see Latency) |
| `GEMINI_MAX_OUTPUT_TOKENS` | no | `4096` (bounded 512–8192) | `2048` |
| `GEMINI_THINKING_LEVEL` | no | `low`; empty sends no thinking setting | `low` |
| `GEMINI_PRIVACY_POLICY` | no | `synthetic_only` | not set (default) |
| `GEMINI_ANALYST_PRODUCTION_APPROVED` | in production | off (only `true` approves) | not set (recommended: leave unset) |
| `GEMINI_MAX_CALLS_PER_HOUR` | no | `30` (bounded 1–1000) | not set |

**Thinking level must suit the model.** `gemini-3.8-flash` accepts only `low`, `medium` and `high`. Google
documents that `minimal` "is not supported and returns an error" (HTTP 400). That exact setting caused the
2026-10-29 production failure. The server now refuses a level the configured model is documented not to accept:
it logs `AI analyst configuration problem: setting=thinking_level` at startup and reports
`unavailable / invalid_configuration` without spending a request. Models without a documented list are passed
through unchanged.

**Latency.** The default (Standard) tier's latency is documented as "seconds to minutes", and Google's own server
deadline defaults to 600 s. The SDK sends `GEMINI_TIMEOUT_SECONDS` to Gemini as that deadline (`X-Server-Timeout`).
On 2026-10-29 a valid production request (thinking `low`) reached the 55 s deadline and Gemini returned 504
(`reason=timeout http_status=504 latency_ms=54919`). So the UI no longer waits for the AI:

1. `/investigate` sends `POST /api/v2/dynamic-investigations` with `ai_explanation: "separate"`. The deterministic
   report returns at once with `ai_analysis.state = "deferred"` when an explanation could be produced, otherwise with
   the analyst's real state.
2. Only when the investigator clicks **Request AI explanation**, the page calls
   `POST /api/v2/dynamic-investigations/explanation` with the same body. The server recomputes the same report itself
   (the browser never supplies evidence), runs the analyst, and returns
   `{account_id, report_digest, data_as_of, duration_ms, ai_analysis}`.
3. The page shows the explanation only if its `report_digest` equals the displayed report's. Otherwise it reports
   that the report changed. While waiting, it shows an honest "writing the explanation…" state with elapsed seconds.

API clients that omit `ai_explanation` get `"separate"` (since 2026-11-02; it used to be `"inline"`).

A client calling the explanation endpoint must wait longer than `GEMINI_TIMEOUT_SECONDS` + 2 s (the server's hard
bound). If the client gives up first, the server's Gemini call keeps running. On 2026-10-29, a client with a 120 s cap
gave up and sent the same request again at once, so two Gemini calls overlapped. The browser UI has no client cap.

**Production results on 2026-10-29** (`ACC-000001`, synthetic ledger, `gemini-3.8-flash`, thinking `low`):

| Time (UTC) | Timeout | Result | Latency |
|---|---|---|---|
| 13:38 | 55 s | HTTP 400: thinking level `minimal` is unsupported (fixed: setting changed to `low`, now guarded in code) | 1.6 s |
| 14:02 | 55 s | HTTP 504 `DEADLINE_EXCEEDED`: no answer within the deadline | 54.9 s |
| 15:08:58 | 180 s | HTTP 504 `DEADLINE_EXCEEDED`: no answer within the deadline | 181.4 s |
| 15:10:58 | 180 s | HTTP 503 `UNAVAILABLE` (Google: "temporarily overloaded or down") | 12.9 s |

The request is valid: Google accepted its format (no 400), and its size is modest (about 17,000 characters of data,
a 939-character schema with only basic keywords, at most 2,048 output tokens). The 503 and both deadlines are Google
capacity results on the free Standard tier. They are not caused by the request, so no code change can make Gemini
answer. These runs logged only the HTTP status. Google's status, message and request ID are logged now (see below).

**Output budget.** `max_output_tokens` includes the model's thinking tokens. If the budget runs out, the analyst
reports `truncated_output`; then raise `GEMINI_MAX_OUTPUT_TOKENS` (4096 is the code default) rather than lowering
the thinking level further.

**Sampling parameters.** No `temperature`, `top_p` or `top_k` is sent: Gemini 3.6+ models ignore them, and Google
advises omitting them. The call uses `generateContent` with `response_mime_type` and `response_json_schema`;
Google documents `generateContent` as "fully supported" alongside the newer Interactions API.

**Model choice.** Google's model list (checked 2026-10-29) recommends `gemini-3.8-flash` as the stable Flash model
for new projects:
- `gemini-2.0-flash` has been shut down.
- `gemini-2.5-flash` is restricted to existing users.

If Google retires the model, the analyst reports `unavailable` with reason `model_not_found`, and you change
`GEMINI_MODEL`. No code change is needed.

## States (`ai_analysis.state`)

| State | Meaning |
|---|---|
| `completed` | Gemini answered and the answer passed schema validation and grounding. Only this state carries `report`. |
| `disabled` | `GEMINI_ANALYST_ENABLED` is not `true`. In production also: not approved (`GEMINI_ANALYST_PRODUCTION_APPROVED`), or no key; the message is the same generic one in every such case. |
| `not_configured` | Development only: enabled, but no `GEMINI_API_KEY`. |
| `skipped_privacy_policy` | The ledger is not verified as the synthetic demo ledger, and no opt-in is set. Nothing was sent. |
| `unavailable` | The call or its output failed, or the server's guard refused it (`busy`: another explanation is being written; `local_rate_limited`: the hourly limit is reached; no request sent). Otherwise `unavailable_reason` says how: `timeout`, `rate_limited` (429 / quota), `auth_failed` (401, 403, or a 400 whose `ErrorInfo` says the key is invalid), `request_rejected` (other 4xx), `model_not_found`, `service_unavailable` (503: Google overloaded or down; try later), `upstream_error` (other 5xx or network), `blocked`, `empty_output`, `truncated_output`, `malformed_output`, `invalid_output`, `policy_violation` or `invalid_configuration` (a setting the model is documented to reject; no request sent). |
| `deferred` | Only with `ai_explanation: "separate"`: the explanation comes from `POST /api/v2/investigations/explanation`. Nothing was sent. |

The legacy `status` field (`generated` / `not_configured` / `failed` / `rejected`) is still sent for older clients.

In every state except `completed`, the investigation itself is complete and unchanged. An AI failure never fails the
request, and no AI text is shown. Browsers get a fixed message per reason, never provider error text.

## Quota and fallback

- Each investigation makes at most **one** Gemini request. The SDK's retries are off (`attempts=1`), and nothing
  retries in a loop.
- The HTTP timeout is `GEMINI_TIMEOUT_SECONDS`, with a hard `asyncio` bound 2 s above it.
- A `429` (rate limit or exhausted free-tier quota) returns `unavailable / rate_limited`. Investigations keep working
  without the explanation until the quota resets.
- The Render build forces the analyst off for its tests and startup check, so deploys never spend quota.

## Privacy policy and data minimisation

Gemini API free-tier data handling differs from paid-tier handling, so the default only ever sends synthetic data.

- **Default `GEMINI_PRIVACY_POLICY=synthetic_only`.** The server checks its own data-source configuration
  (`source_kind == synthetic_demo_ledger`, `is_synthetic` true, `real_bank_data` false). If any check fails,
  including for unknown sources, the call is skipped (`skipped_privacy_policy`). Nothing the browser sends affects
  this decision.
- **`allow_non_synthetic`** is an explicit opt-in. Set it only if your Gemini agreement (paid tier or data-processing
  terms) allows sending that data.
- **What Gemini receives** is a bounded extract of the finished report:
  - at most 40 transfers, 20 accounts, 40 findings and 20 exposure lines, and at most 30,000 characters
  - account and transfer IDs replaced by aliases (`PA-001`, `PT-001`), with the mapping kept on the server
  - times converted to minutes from the first transfer
  - no names, emails, phone numbers, UPI IDs or tax IDs, and no free text from the ledger
  - server-generated finding text, with IDs replaced and timestamps redacted
- The prompt marks the data as untrusted and states the rules: no guilt, no freezing, no new facts, cite IDs.
  `<` and `>` are escaped so text inside the data cannot close the data block.
- **What is logged:** one line per failure, for example
  `AI analyst unavailable: reason=service_unavailable http_status=503 error_type=none latency_ms=12862
  provider_status=UNAVAILABLE request_id=… provider_message="The model is overloaded. Please try again later."`
  - Always: the reason code, the numeric HTTP status, the exception class name (for unexpected failures only) and
    the latency.
  - When Google sends them: its status (`UNAVAILABLE`, `RESOURCE_EXHAUSTED`, …) and `ErrorInfo` reason (for example
    `API_KEY_INVALID`), a request-ID header, the `RetryInfo` delay, the first `QuotaFailure` quota ID, and the
    message. All are stripped to identifier characters, except the message.
  - The message is cut to 160 characters on one line. Quoted values, the configured key, key-like and other long
    opaque strings, and account and transfer IDs are removed or masked.
  - Never logged: the prompt, the payload, a raw response body, exception messages or the key. None of these
    diagnostics reach the browser, which gets the reason code and a fixed message.
  - A 504 (`DEADLINE_EXCEEDED`) means Gemini stopped at the deadline the SDK sends from `GEMINI_TIMEOUT_SECONDS`,
    so it is reported as `timeout`.
- **Startup:** when the analyst is enabled, the SDK is imported at startup so the first investigation does not pay
  for it. This is only an import: no key is needed, no request is made, and a failure there never stops the server.

## Validation

1. The answer must be JSON matching a strict schema:
   - `summary`, `key_observations[{text, basis, evidence_ids}]`, `evidence_references`, `reasoning_and_limitations`,
     `recommended_manual_checks[{check, evidence_ids}]`, `confidence_note`
   - `check` is one of ten fixed codes (`MANUAL_CHECKS` in the code); the text shown is the server's reviewed
     wording for that code, never text written by the model. An unknown code rejects the answer (`invalid_output`).
   - no extra fields, and length limits on every field
2. Grounding (every statement, every ID-like token):
   - An observation with basis `observed`, `rule` or `model` must cite IDs, and every ID must have been in the
     extract; otherwise the observation is dropped.
   - Any `PA-`, `PT-` or `F-` token in the text must be an alias that was sent, in any spelling (lower case,
     typographic hyphens, extra digits). Real-format IDs (`ACC-…`, `TXN-…`, `TX-…`, `FS-…`, `CASE-…`) are never sent,
     so citing one is a fabrication or a leak and always fails.
   - In the summary or confidence note an unknown reference rejects the whole answer (`invalid_output`).
3. Safety (deterministic, after normalising Unicode compatibility forms, accents, zero-width characters, typographic
   quotes and letter-spaced words; letters from look-alike scripts such as Cyrillic always fail):
   - guilt or criminal identity or acts (guilty, fraudster, criminal, scammer, mule, accomplice, stole, laundered,
     committed fraud, ran the scheme, …), affirmed or denied;
   - punitive or restriction wording (freeze, block, suspend, restrict, seize, blacklist, deactivate, place a hold,
     prosecute, …), even when ruled out, and everyday verbs with an account, card, transfer or money as their
     object (close the account, shut down PA-002's account, PA-002 should be closed, claw back the funds, …);
   - certainty about wrongdoing (definitely, proves, beyond doubt, is fraudulent, …) unless negated ("does not
     prove", "no proof");
   - prompt-injection residue (ignore previous instructions, system prompt, …).
   A failing statement is dropped; in the summary or confidence note it discards the whole answer
   (`policy_violation`).
4. Fail closed: if every check or every limitation is dropped, or more than half of all statements are dropped, the
   whole answer is discarded (`policy_violation`).
5. Aliases are mapped back to the report's own IDs, so the UI can link each reference to its transfer, account or
   finding.

Regression tests: `backend/tests/test_qa_remediation_ai.py` (the 13 phrasings the 2026-11-01 security audit found, 38
paraphrases including obfuscated spellings, 16 ordinary evidence sentences that must pass, and the grounding cases).

## Testing

- **Regular tests** never call Gemini: an autouse fixture clears all `GEMINI_*` variables, and the tests use a fake
  provider or a stubbed SDK client. Run: `backend/.venv/bin/python -m pytest backend/tests ml/tests`.
- **Optional real smoke test.** It makes one request and spends quota, so it never runs in tests, builds or deploys:

  ```bash
  # repository root, with the synthetic ledger built and GEMINI_API_KEY already exported in your shell
  GEMINI_SMOKE_TEST=1 GEMINI_ANALYST_ENABLED=true backend/.venv/bin/python scripts/gemini_smoke_test.py ACC-000001
  ```

  It prints the state, reason, model and latency, and exits 0 only when the state is `completed`.

- **Production smoke test** (one request; spends quota):
  1. Check that the newest Render deploy is `live`, not just built, and that `GET /health` returns 200.
  2. Check that `GET /api/v2/data-source` reports `source_kind: synthetic_demo_ledger`, `is_synthetic: true` and
     `real_bank_data: false`.
  3. Check that the Render logs show no `AI analyst configuration problem` line for the current instance.
  4. Send exactly one request: `POST /api/v2/investigations/explanation` with body
     `{"account_id": "ACC-000001", "ai_explanation": "separate"}`. Alternatively, run `ACC-000001` once from
     `/investigate` and click **Request AI explanation**, which makes the same single call. (In production this needs
     `GEMINI_ANALYST_PRODUCTION_APPROVED=true` as well; see Production safeguards.)
  5. Use a client timeout longer than `GEMINI_TIMEOUT_SECONDS` + 2 s, for example 240 s for 180.
  6. Read `ai_analysis.state`, `unavailable_reason`, `model` and `latency_ms`. The log line is
     `AI analyst completed: …` or `AI analyst unavailable: reason=… http_status=… … provider_status=…`.
  7. Do not retry automatically. Fix the reported cause first:
     - On `rate_limited` (429), stop until the quota resets.
     - On `service_unavailable` (503) or `timeout`, wait for Google's capacity to recover before one new attempt.
       Do not loop.
