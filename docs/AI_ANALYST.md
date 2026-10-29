# AI analyst (Google Gemini)

After a live investigation finishes, the server can ask Gemini to explain the result in plain language. The
explanation appears as `ai_analysis` in `POST /api/v2/investigations` and in the **Explanation** section of
`/investigate`. It never changes a score, amount, exposure range or finding. The browser never talks to Gemini and
never sees the key.

Code: `backend/app/services/v2/ai_analyst.py` (policy, payload, validation) and
`backend/app/services/v2/gemini_provider.py` (the only module that uses the official `google-genai` SDK).

## Render configuration

Set these on the `fraudshield-api` service (Environment tab). Adding a variable does not prove the integration
works; check `ai_analysis.state` on a real investigation afterwards.

| Variable | Required | Value |
|---|---|---|
| `GEMINI_API_KEY` | yes | Secret; already set. Never put it in a `VITE_` variable. |
| `GEMINI_ANALYST_ENABLED` | yes | `true` to turn the analyst on. Anything else means off. |
| `GEMINI_MODEL` | no | Default `gemini-3.8-flash` |
| `GEMINI_TIMEOUT_SECONDS` | no | Default `25` (bounded 3–60) |
| `GEMINI_MAX_OUTPUT_TOKENS` | no | Default `4096` (bounded 512–8192) |
| `GEMINI_THINKING_LEVEL` | no | Default `low`; empty sends no thinking setting |
| `GEMINI_PRIVACY_POLICY` | no | Default `synthetic_only`; see below |

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
| `disabled` | `GEMINI_ANALYST_ENABLED` is not `true`. |
| `not_configured` | Enabled, but no `GEMINI_API_KEY`. |
| `skipped_privacy_policy` | The ledger is not verified as the synthetic demo ledger, and no opt-in is set. Nothing was sent. |
| `unavailable` | The call or its output failed. `unavailable_reason` says how: `timeout`, `rate_limited` (429 / quota), `auth_failed`, `request_rejected`, `model_not_found`, `upstream_error`, `blocked`, `empty_output`, `truncated_output`, `malformed_output`, `invalid_output` or `policy_violation`. |

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
- **What is logged:** the state or reason code, the provider's numeric HTTP status (for example
  `reason=timeout http_status=504`), the exception class name for unexpected failures, the model and the latency.
  The prompt, payload, provider text, exception messages and key are never logged. A 504 (`DEADLINE_EXCEEDED`)
  means Gemini stopped at the deadline the SDK sends from `GEMINI_TIMEOUT_SECONDS`, so it is reported as `timeout`.
- **Startup:** when the analyst is enabled, the SDK is imported at startup so the first investigation does not pay
  for it. This is only an import: no key is needed, no request is made, and a failure there never stops the server.

## Validation

1. The answer must be JSON matching a strict schema:
   - `summary`, `key_observations[{text, basis, evidence_ids}]`, `evidence_references`, `reasoning_and_limitations`,
     `recommended_manual_checks[{text, evidence_ids}]`, `confidence_note`
   - no extra fields, and length limits on every field
2. Grounding:
   - An observation with basis `observed`, `rule` or `model` must cite IDs, and every ID must have been in the
     extract; otherwise the observation is dropped.
   - Unknown references are omitted.
   - A summary or confidence note that mentions an unknown ID rejects the whole answer.
3. Statements asserting guilt or directing a freeze, block or closure are dropped. In the summary, they reject the
   whole answer (`policy_violation`).
4. Aliases are mapped back to the report's own IDs, so the UI can link each reference to its transfer, account or
   finding.

## Testing

- **Regular tests** never call Gemini: an autouse fixture clears all `GEMINI_*` variables, and the tests use a fake
  provider or a stubbed SDK client. Run: `backend/.venv/bin/python -m pytest backend/tests ml/tests`.
- **Optional real smoke test.** It makes one request and spends quota, so it never runs in tests, builds or deploys:

  ```bash
  # repository root, with the synthetic ledger built and GEMINI_API_KEY already exported in your shell
  GEMINI_SMOKE_TEST=1 GEMINI_ANALYST_ENABLED=true backend/.venv/bin/python scripts/gemini_smoke_test.py ACC-000001
  ```

  It prints the state, reason, model and latency, and exits 0 only when the state is `completed`.

- **Checking the deployment.** Run one investigation on the live site, then read the Explanation section, or
  `ai_analysis.state` / `unavailable_reason` in the API response.
