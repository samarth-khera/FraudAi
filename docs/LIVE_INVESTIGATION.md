# Live investigation engine

> Since the dynamic intelligence work, the page calls `POST /api/v2/dynamic-investigations`, which runs everything
> below (as the `investigation` section of its response) and adds model scoring, role assessment and restriction
> states on top. See [DYNAMIC_INTELLIGENCE.md](DYNAMIC_INTELLIGENCE.md). `POST /api/v2/investigations` is unchanged and
> still works on its own. Inside a dynamic investigation, step 6 runs the v2 account model only on `demo-ledger`, and
> the role engine's assessment replaces this report's escalation recommendations for the accounts it assessed.

`/investigate` in the app, `POST /api/v2/investigations` in the API. An investigator opens the account that lost
money and presses **Start fund investigation**. The server then queries the configured ledger, traces the money, assesses
every linked account and returns an evidence-referenced report. Nothing is precomputed and nothing is stored.

## What runs, in order

1. **Data source** (`app/services/v2/data_source.py`). Reads which ledger is configured and queries it for record
   counts and the latest transaction time (`data_as_of`). An unusable source stops the request with `503` and the
   exact blocker. No report is produced from fabricated data.
2. **The entered account.** It must exist, otherwise the request returns `404 account_not_found`. Its full history is loaded, and the optional
   date range selects which of its transfers start the trace.
3. **Flags** (`compute_flags`). Each transfer is compared only with the same account's earlier transfers:

   | Flag | Rule |
   |---|---|
   | `AMOUNT_ABOVE_OWN_HISTORY` | ≥ ₹10,000 and more than 2× the largest of at least 5 earlier outgoing transfers |
   | `INFLOW_ABOVE_OWN_HISTORY` | The same, for incoming transfers |
   | `BALANCE_DRAIN` | ≥ ₹25,000 and at least 50% of the balance just before it |
   | `BURST_TO_NEW_RECIPIENTS` | ≥ 3 transfers to never-paid-before recipients within 60 minutes, ≥ ₹25,000 total |
   | `RAPIDLY_FORWARDED_INFLOW` / `FORWARDS_RECENT_INFLOW` | An inflow ≥ ₹10,000 with ≥ 70% sent on within 30 minutes |

   On a sample of 600 legitimate synthetic accounts, 107 had at least one flag (mostly `AMOUNT_ABOVE_OWN_HISTORY`).
   A flag tells the investigator where to look; it is not a finding.
4. **Seeds.** By default the trace starts from the flagged outgoing transfers. It also follows incoming transfers
   that were flagged, or that arrived within the follow-on window before a flagged outgoing transfer. If nothing is
   flagged, it starts from the 5 largest transfers. `trace_scope: "all"` traces every transfer in range (50 largest
   per direction). The report states which rule applied.
5. **Trace** (`ForensicGraphTracer.trace_from_seeds`). The trace respects time order:
   - **Downstream**: each recipient's transfers *after* it received the traced money, within the follow-on window
     (default 72 h).
   - **Upstream**: each sender's receipts *before* it paid onward.

   Limits:
   - Up to 10 transfers are followed per account, the largest first.
   - Each account is expanded once.
   - Defaults are a depth of 3 hops and 200 accounts.

   An edge that returns to an account already on its own path is a **cycle**. So is an edge that reaches an account
   first reached from the other side of the entered account, when the timing lets money run all the way round (a loop
   through the entered account); a transfer found again from the other side is recorded once, as a cross-link. Every limit that cut the trace short
   is listed in `truncation_notes`. Edges touching the entered account are `observed_direct`. All others are
   `inferred_related`: the transfer is a recorded fact, but its link to the incident rests on timing.
6. **Per-account assessment.** The entered account, then direct recipients, onward recipients and senders, up to
   `max_accounts_analyzed` (25 by default). Each gets the existing rule assessment and account model (TreeSHAP)
   computed from **its own** records, once per investigation. If the model cannot load, the report says so and
   shows no model scores.
7. **Exposure.** For each downstream account, its balance is followed from the first traced receipt to the end of
   the window:
   - The lower bound on traced money that moved on uses the *lowest intermediate balance* rule: the account's own
     funds are assumed to leave first.
   - The upper bound is the smaller of what it received and what left.

   Ranges are per account and are never added across hops. The "observed downstream total" counts the same money
   each time it moves.
8. **Role labels.** Each label is backed by the facts listed in `role_basis`:

   | Label | When |
   |---|---|
   | `victim_candidate` | The entered account made flagged transfers that were not just forwarding money it had received |
   | `possible_intermediary` | A recipient whose lowest-balance lower bound shows at least 70% of its traced receipts moved on; or the entered account, when its flagged transfers only forwarded fresh inflows |
   | `recipient_under_review` / `sender_under_review` | The rules or the model suggest review, without strong onward movement |
   | `insufficient_evidence` / `not_analyzed` | Otherwise |

   Each account also gets alternative explanations, missing evidence and advisory next steps.
9. **Findings, recommendations, unknowns.**
   - Each finding has an ID and a kind: `observed`, `rule`, `model` or `limitation`. It cites only transaction and
     account IDs present in the response; a test enforces this.
   - Recommendations are advisory. Nothing freezes, blocks or flags an account.
10. **Explanation.**
    - `evidence_summary` answers the nine investigator questions from fixed templates and is labelled as not AI.
    - `ai_analysis` is an optional Google Gemini explanation, added after the deterministic report is complete. It
      is off unless `GEMINI_ANALYST_ENABLED=true`, and by default it is sent only for the synthetic ledger. Gemini
      receives a pseudonymised, bounded extract, and its answer is schema-validated and grounded against this report's
      IDs. `ai_analysis.state` says what happened (`completed`, `disabled`, `not_configured`,
      `skipped_privacy_policy`, `unavailable` or `deferred`). With `ai_explanation: "separate"` the report comes back
      without waiting for the model; the explanation is fetched from `POST /api/v2/investigations/explanation` (this
      endpoint) or, as the page does, `POST /api/v2/dynamic-investigations/explanation`, which explains the dynamic role
      assessment. This endpoint always answers `deferred` in separate mode; the dynamic endpoint answers `deferred` only
      when an explanation could actually be produced, and otherwise returns the real state (`disabled`,
      `not_configured`, ...) at once. See [AI_ANALYST.md](AI_ANALYST.md).

Ground-truth labels and scenario tags are never read. A test scrambles them and checks that the report is unchanged.

## How the page presents a report

`/investigate` answers one question at a time instead of showing every section at once.

1. **Account summary** (before anything is traced). The investigator picks a dataset (`GET /api/v2/datasets`; suggested
   starting points from `GET /api/v2/datasets/{dataset}/sample-accounts`). Opening an account reads
   `GET /api/v2/datasets/{dataset}/accounts/{id}`: history coverage, model availability and whether model outputs count
   as evidence on that dataset, with no prediction. On `demo-ledger` the page also reads the account's rule assessment
   and the data source (`GET /api/v2/accounts/{id}`, `/accounts/{id}/assessment`, `/data-source`). Nothing is traced
   until **Start fund investigation** is pressed, which sends one `POST /api/v2/dynamic-investigations`. When its
   `ai_analysis.state` is `deferred`, the page then requests `POST /api/v2/dynamic-investigations/explanation`.
2. **Overview.** "What happened", written from the report by fixed rules (not AI), then the transfers where the trace
   starts. A flagged transfer is presented as a starting point, not a confirmed fraudulent event.
3. **Fund trail.** The trace is split into branches using `parent_transaction_id`: one root-to-leaf path each, in the
   order the money moved. Each branch is told step by step (account, transfer, account…), drawn as a left-to-right
   tree (senders, then the investigated account, then recipients), and every transfer and account opens an inspector.
   Each branch ends with the reason the data gives: depth or account limit, a cycle, a cash withdrawal, money already
   traced on another branch or from the other side of the investigated account, or no further transfer found in the
   window (the endings are listed in [DYNAMIC_INTELLIGENCE.md](DYNAMIC_INTELLIGENCE.md#10-fund-tracing-branch-endings-and-tracing-verification)).
   A stop is never presented as money recovered, lost or settled.
4. **Affected accounts** (dynamic investigations). Every connected account grouped by its candidate role, each with its
   evidence (recorded facts and model outputs labelled apart), what speaks against it, ten fixed questions and an
   advisory restriction state.
5. **Risk evidence.** Accounts grouped by rule severity; each answers what was detected, what it relates to, the
   evidence, why it matters and what is not known. Every finding, grouped by kind, and the template summary follow.
6. **AI analyst.** Requested separately (`ai_explanation: "separate"`) and shown only for the same `report_digest`.
   It explains the dynamic role assessment, not the older role labels. Every other stage is usable while it is pending.
7. **Next steps.** Whether a restriction should be considered (dynamic investigations; always advisory, with
   human-approval wording), then advisory recommendations, most direct first, each with the evidence it rests on. When the depth limit
   cut the trace short, a deeper re-run is offered; it runs only when pressed.

The trail model (`frontend/src/components/investigation/trail.ts`) only rearranges transfers that are in the response;
a test checks that every branch transfer is in the response and every response transfer is on a branch.

## Data source today

Deployed and local servers query `data/v2_fraudshield.db`, the **synthetic demo ledger**: 10,000 accounts and
353,393 transactions from 1 Jan to 31 Mar 2026, generated from seed 42 at build time. Every report carries a sticky
"Synthetic demo data" banner. No real bank data is monitored.

To connect an authorized institution ledger later:

1. Load the institution's records into a database in the V2 ledger schema (`scripts/ingest_v2_data.py` documents
   the columns), separate from the synthetic file.
2. Set the following in the platform's secret settings, never in Git or `VITE_` variables:
   - `FRAUDSHIELD_V2_DATABASE_URL`
   - `FRAUDSHIELD_DATA_SOURCE=authorized_institution_ledger`
   - `FRAUDSHIELD_DATA_SOURCE_NAME`
   - `FRAUDSHIELD_DATA_AUTHORIZATION_REF`
3. Re-validate the flag thresholds and the account model on that data. The model was trained only on synthetic
   scenarios.

The server refuses to start investigations in three cases:
- the source is declared authorized but has no name or authorization reference
- the source is declared authorized but still points at the synthetic file
- the source kind is unknown

## Limits worth knowing

- The request is synchronous. Locally it takes 0.1–0.5 s; a dynamic investigation takes a median of 0.2–0.8 s
  depending on the ledger (DYNAMIC_INTELLIGENCE.md §11). On Render's free plan, add about a minute when the server
  is waking from sleep. There is no job queue and none is needed at this size.
- Reports are not stored. A shared link (`/investigate?account=…`) only prefills the form, and the investigator
  presses Start again.
- Accounts beyond the depth, window, per-account or node limits are not followed. The report lists them as
  truncation notes.
