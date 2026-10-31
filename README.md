# FraudShield AI

**Follow reported money across connected accounts, then record what you decide.**

FraudShield AI is a workspace for fraud investigators. When a customer reports a fraudulent transfer, it shows
where the money went next, which connected accounts may need attention and why, and keeps a history of every
review decision.

It supports an investigator’s judgement. It does **not** prove anyone’s intent, decide guilt, or freeze,
block or flag any account by itself.

> **Everything here is synthetic demonstration data.** No real customers, banks or transactions are involved.

---

## Who it is for

- **Investigators** working a reported fraud: tracing funds, reviewing connected accounts, recording decisions.
- **Reviewers and supervisors** checking what was decided, by whom, and on what evidence.
- **Technical reviewers** who want to inspect the models and raw records (under **Tools**).

---

## The investigation workflow

The sidebar has four main destinations, **Overview**, **Investigate**, **Accounts** and **Cases**, plus a **Reference** group (fund-flow explorer, model performance, audit log, transaction model check).

### Live investigation (Investigate)

Open an account (for example `ACC-000001`, or just `1`) to see its summary, then press **Start fund investigation**. The server
queries the ledger at that moment and returns a report. It contains the account's transfers that are unusual for it,
the money flow traced in both directions with time order respected, and each linked account assessed on its own
records by the rules and the model. It also gives a balance-based exposure range, findings labelled
*observed / rule / model / limit* that cite transaction IDs, and advisory next steps. The page walks through it in five
stages (overview, fund trail, risk evidence, AI analyst, next steps); the fund trail follows each branch transfer by
transfer, with an inspector for every transfer and account. Nothing is precomputed or stored, and the report says plainly that the data is synthetic. When enabled on the
server, a Google Gemini explanation is added after the checks finish. It is labelled as AI-generated, cites the
report's own records and never changes a score, and the report states plainly when it did not run.
Details: [docs/LIVE_INVESTIGATION.md](docs/LIVE_INVESTIGATION.md) and [docs/AI_ANALYST.md](docs/AI_ANALYST.md).

### Case workspace (Investigations)

Every case opens in the same four sections. The case ID stays at the top, and the section and selected account
are kept in the page address, so refresh, back/forward and shared links all return to the same place.

| Section | Question it answers | What you see |
|---|---|---|
| **1. Summary** | What happened? | The complaint side by side with the recorded transfer (and whether they match), what the records show so far, and a list of what is **still unknown**. |
| **2. Money flow** | Where did the money go? | A left-to-right diagram (or a plain list) of recorded transfers from the reporting customer. Select an account or a transfer to see amounts, payment method, time and hop. |
| **3. Accounts & risk** | Which accounts need attention, and why? | For each account: the recorded facts, rule-based patterns (such as quick forwarding), automated risk checks with their reasons and limits, and missing evidence. |
| **4. Review & history** | What has been decided? | Record a decision with your reasoning (you confirm it before it is saved), change the case status, and read the case history. |

### Starting the sample investigation

Open the site and choose **Open sample case**. That opens case **FS-2001**:

- A synthetic complaint: customer `ACC-000001` says a caller persuaded them to send **₹2,50,000** by IMPS to `ACC-000003`.
- The records show `ACC-000003` sent ₹2,45,000 on to two accounts within 10 minutes, and both of those made ATM cash-outs shortly after.
- Try this: open `ACC-000003` in **Accounts & risk**. The fixed rules give it **60 points of 100 (high)** and the account model a **model score of 71.3% (high)**. Then open `ACC-000002`: rules 60 points, model score **18.2% (elevated)**, just over the model’s **17.5%** review threshold. The workspace explains why neither score is a finding.
- Record a decision in **Review & history**, refresh the page, and check that it is still there in the history.

See [Presenting the demo](#presenting-the-demo) for a step-by-step script.

A second sample, **FS-1042** (a ₹50,000 complaint), uses older case-only records. It has no account-level model
results, and the workspace says so rather than inventing them.

---

## What the numbers mean

- **Reported loss** is what the complaint claims. It is a claim until checked.
- **Recorded transfers** are facts from transaction records.
- **Sum of all transfers** adds up every hop, so the same money is counted again at each step. It is always
  shown separately from the loss and is never presented as the amount stolen.
- **Fund attribution:** the records cannot show which rupees in later transfers came from the reported
  payment (money can be mixed with other funds). Downstream accounts are therefore marked *unattributed*, not
  assumed to hold stolen money.
- **Receiving money in a case is not wrongdoing.** Missing data is not evidence either way.

### The automated risk checks

| Check | What it is | Where it applies |
|---|---|---|
| **Ledger rules** | Fixed, readable rules about timing, size and spread of transfers (0–100). | Accounts in the synthetic account ledger. |
| **Account model** (`v2-account-2.0.0`) | An XGBoost model over 26 behaviour features. Shows the six inputs that moved the score most (TreeSHAP), explained in plain words. | Accounts in the synthetic account ledger only. |
| **Rule-based patterns** | Observations from the case’s own transfers, such as forwarding within minutes or splitting payments. | Every case. |

Both automated checks run on an account’s **whole ledger history** (including activity after the case),
computed when you open the account.

**How good is the account model?** The model was rebuilt on 29 Oct 2026 after an audit
([`docs/ACCOUNT_MODEL_AUDIT.md`](docs/ACCOUNT_MODEL_AUDIT.md)) found that the previous version had been trained
on 26 suspicious accounts and tested on 6, and had in fact missed every money-forwarding account it was tested on.

The current version was tested on a separate synthetic ledger it never trained on: **260 suspicious and 3,919
ordinary accounts**, including two kinds of suspicious behaviour it never saw in training. A model score of
**17.5% or more** (0.1752 on the model’s 0–1 scale) means “suggested for review”; that threshold was chosen on
separate validation data. At that threshold:

- it caught about **half** of the suspicious accounts (53%, 139 of 260);
- about **one in three** of its flags were suspicious (33%); the rest were legitimate accounts that behave
  similarly, such as students paying fees from a parent’s transfer or people paying rent as soon as their
  salary lands;
- on this app’s own ledger, where suspicious accounts are much rarer, it flags about **5% of ordinary accounts**,
  so **most flags there are false alarms** (about 1 in 25 flags was a planted scenario account).

It still ranks accounts better than the ledger rules (precision-recall score 0.38 against 0.10) and the previous
model (0.22). The score is **not** a probability that an account is fraudulent: it is learned from synthetic
labels and has not been calibrated against real outcomes. The synthetic data never puts a corporate account in a
scenario, so the model tells you nothing about corporate accounts.

In plain terms: use the score as one prompt among several. A high score is never a finding, and a low score
never clears an account.

**Reading the two scores.** The **rule score** is points out of 100 from fixed rules; “high” (56+) or above
suggests review. The **model score** is a percentage from the machine-learning model; at or above its review
threshold it suggests review. They use different scales, so the workspace compares whether each one suggests
review, never the difference between the numbers. When they disagree, neither is automatically right: look at
the transfers and the model’s listed factors.

### What the PaySim benchmark does and does not prove

The **PaySim benchmark** is a separate transaction-level model trained on a public mobile-money simulation
(near-perfect scores on that simulation’s test split). It shows that the modelling pipeline works on a known
public dataset. It says **nothing** about accounts or transfers in the sample cases: different data, different
features, and the case records lack the balances it needs. It is available under
**Tools → Transaction model check** for experimentation only, and is never applied to a case.

---

## Where things are

| Address | Page |
|---|---|
| `/` | Home |
| `/cases` | Investigations: search and filter cases, see each one’s next action |
| `/cases/:caseId?section=summary\|money-flow\|accounts\|review&account=…` | Case workspace |
| `/tools` | Tools hub |
| `/tools/model` | Model performance and evaluation (account model and PaySim benchmark) |
| `/tools/audit` | Audit search and CSV export across all cases |
| `/tools/accounts`, `/tools/accounts/:id` | Look up any synthetic-ledger account outside a case |
| `/tools/fund-flow` | Fund-flow explorer for any account or case |
| `/tools/transaction-model` | PaySim benchmark scoring for hypothetical transactions |

Older addresses (`/guided-investigation`, `/demo`, `/app/*`, `/insights`, `/audit`, `/fund-flow`,
`/workspace`, `/v2/...`, `/accounts/:id`) redirect to their new locations and keep their query strings.

---

## Running it locally

**Prerequisites:** Python 3.12, Node.js 20+.

### 1. Backend (API on port 8000)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --port 8000
```

On startup the backend creates its tables and seeds both sample cases (FS-1042 and FS-2001). Seeding is
idempotent and never overwrites recorded decisions.

### 2. Frontend (site on port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server forwards `/api` requests to the backend.

### 3. Data and model files (not in git)

The synthetic account ledger (`data/v2_fraudshield.db`) and model binaries (`*.joblib`) are git-ignored. Without them:

- FS-1042 still works fully. FS-2001’s summary, money flow and reviews still work, because its transfers are
  stored with the case.
- Account profiles and automated checks report **unavailable**. The header shows **Model unavailable** with
  the reason, and no score is invented.

To rebuild them from the repository root:

```bash
backend/.venv/bin/python scripts/generate_synthetic_bank_data.py --seed 42
backend/.venv/bin/python scripts/ingest_v2_data.py --input-dir data/v2_synthetic --batch-size 10000 --replace
PYTHONPATH=backend:. backend/.venv/bin/python -m ml.v2.scenario_bank        # evaluation ledger (data/v2_model_eval/)
PYTHONPATH=backend:. backend/.venv/bin/python -m ml.v2.account_model_eval   # trains v2-account-2.0.0 + evaluation report
PYTHONPATH=. backend/.venv/bin/python ml/v2/paysim_benchmark.py   # needs the PaySim CSV in data/raw/
```

### Running the tests

```bash
backend/.venv/bin/python -m pytest backend/tests -q   # from the repository root (or `pytest -q` inside backend/)
backend/.venv/bin/python -m pytest ml/tests -q
cd frontend && npm test && npm run build
```

Backend tests use a temporary database, so running them never changes the local demo database.

---

## How the sample case FS-2001 was built

FS-2001 is generated by [`scripts/build_v2_sample_case.py`](scripts/build_v2_sample_case.py) from the synthetic
account ledger:

1. Start from one ledger transfer (`TXN-0062181`).
2. For every account that received money in the case, include each outgoing transfer it made within
   **6 hours** of receiving it, up to 4 hops.

The rule never reads the ledger’s ground-truth columns (scenario tags, suspicious flags, account labels), so
the case cannot leak the answer. Transaction and account IDs are the ledger’s own, which is the explicit link
that lets the workspace show ledger profiles and model results for these accounts. A backend test checks
that the stored fixture still matches the ledger and is reproducible by the rule. Only the complaint wording
and report time were written for the demo.

Account roles in a case (reporting customer, first receiver, passed money on, last recorded receiver)
describe position in the money flow only.

---

## Limitations

- **Synthetic data only.** Real payment systems, fraud patterns and customer behaviour differ.
- **Model evaluated on synthetic data only.** The account model’s test set has 260 suspicious accounts, but
  some behaviour families are still small (9–11 accounts), the synthetic suspicious rate (~6%) is far above real
  life, and the account-level features cannot see who the counterparties are. See
  [`docs/ACCOUNT_MODEL_AUDIT.md`](docs/ACCOUNT_MODEL_AUDIT.md).
- **Reviewer identity is never verified.** Reviewer names are typed by the user and recorded as self-reported.
  An API key (`ADMIN_API_KEY`) only controls whether changes are accepted; it does not prove who typed the
  name. Without a key the server accepts changes from anyone who can reach it, so run it locally only. See
  [`backend/README.md`](backend/README.md#write-access-and-reviewer-identity).
- **Audit history is append-only in the application, not tamper-proof.** Events are stored in SQLite with
  server timestamps. They are not cryptographically signed or hash-chained.
- **Older local data.** A database used with earlier builds may contain reviews of `ACC-000001` under FS-1042
  (made through a since-removed shortcut that linked the two datasets). They are kept unchanged as history, and
  the case history labels them **Legacy record** because that account is not part of FS-1042’s transfers. They
  still count towards the case’s “decisions recorded” total. New reviews are only accepted for accounts that are
  actually in the case.
- **Case creation** is available through the API (`POST /api/cases`) but not in the interface, because a new
  case also needs its transactions loaded.
- **Tools pages load separately.** The main journey downloads about 600 KB of JavaScript (190 KB compressed).
  Opening an account page under Tools downloads a further ~950 KB, mostly the graph and chart libraries.

---

## Presenting the demo

**Before you start:** run the backend and frontend (above) and open <http://localhost:5173>. The header should
show **Model ready**. If it shows **Model unavailable** or **Server unreachable**, click it to see why.

**Designated demonstration account: `ACC-000003`** in case **FS-2001** (the first receiver of the reported
transfer). It shows every part of the workspace: recorded facts, rule patterns, two automated checks that
disagree, and a review decision.

1. **Home:** read the one-paragraph explanation, then click **Open sample case**.
2. **Summary:** point out the complaint (₹2,50,000) next to the recorded transfer, the “matches” check, and the
   **Still unknown** list.
3. **Money flow:** show the five transfers from left to right. Explain that the *sum of all transfers*
   (₹7,36,000) counts the same money at each hop and is not the loss. Click `ACC-000003`.
4. **Open account details** (Accounts & risk): `ACC-000003` forwarded ₹2,45,000 within 10 minutes. The ledger
   rules give it **60 points of 100 (high)**; the model score is **71.3% (high)**. Read the “Why the model gave
   this score” factors and the “About these results” limits aloud, especially that most flags on this ledger
   are false alarms.
5. Click `ACC-000002`: rules 60 points, model score **18.2% (elevated)**, barely over the 17.5% review threshold.
   Then click `ACC-000001`, the reporting customer: model score **7.2% (low)**. Use these to explain that the score is a prompt
   to look closer, not a verdict either way.
6. **Review & history:** choose `ACC-000003`, pick a decision, write your reasoning, type your name, click
   **Review before saving**, then **Save decision**. The green message appears only after the server confirms.
7. Refresh the browser. The decision and its history entry are still there. Use Back and Forward to show the
   case and account stay selected.
8. Optional: open **FS-1042** → Accounts & risk to show that a case without ledger records gets **no** model
   score, with an explanation instead.

**What not to claim.** Do not say the model “found” the FS-2001 accounts: four accounts prove nothing, and the
model misses about half of suspicious accounts in testing. Do not say a flag means wrongdoing: on this app’s
ledger most flags are false alarms. Do not present the PaySim benchmark’s near-perfect scores as evidence about
cases or about the account model.

### Records already in the local demo database

Reviews are permanent history, so earlier test runs remain visible. In the current local database
(`backend/fraudshield.db`, not in git):

| Case | Account | Recorded by | What it is |
|---|---|---|---|
| FS-1042 | C300 | `investigator_ui` | Two early test reviews (“under review”). Valid: C300 is in the case. |
| FS-1042 | ACC-000001 | `test_investigator`, `SecAnalyst01` | Legacy reviews from the removed cross-dataset shortcut. Shown with a **Legacy record** label. |
| FS-2001 | ACC-000002 | `chrome_verification` | Browser verification review (“keep under review”), 28 Oct 2026. |
| FS-2001 | ACC-000003 | `acceptance_check` | Acceptance-test review, 29 Oct 2026. A live demo adds a newer decision on top. |
| FS-2001 | ACC-000003 | `trust_check` | Score-clarity browser check (“escalate for investigation”), 29 Oct 2026. |
| FS-2001 | ACC-000012 | `hardening_check` | Write-access browser check (“keep under review”), 29 Oct 2026. |

To present from a clean history, stop the backend, move `backend/fraudshield.db` somewhere safe (keep it;
it is the record), and start the backend again: it recreates the database with only the two sample cases.

---

## Deployment (Render + Vercel)

The public deployment is a **read-only demo** on free plans:

| Part | Where | How it is built |
|---|---|---|
| Backend (FastAPI) | Render web service `fraudshield-api` from [`render.yaml`](render.yaml) | `scripts/render_build.sh`: pinned dependencies, model binaries fetched from the `models-2026-10-29` GitHub release and verified by SHA-256 ([`deploy/model_artifacts.json`](deploy/model_artifacts.json)), the synthetic ledger regenerated from seed 42, integrity tests and a startup check. |
| Frontend (Vite) | Vercel project with root directory `frontend/` | `npm run build`, SPA fallback in [`frontend/vercel.json`](frontend/vercel.json). |

Environment variables:

| Where | Variable | Value |
|---|---|---|
| Render | `ENVIRONMENT` | `production` (set by the Blueprint): write endpoints are refused because no API key is configured |
| Render | `ENABLE_API_DOCS` | `false` |
| Render | `CORS_ALLOWED_ORIGINS` | the Vercel production URL, e.g. `https://<project>.vercel.app` |
| Render | `PYTHON_VERSION` | `3.12.4` |
| Render | `GEMINI_API_KEY` | secret, for the optional AI analyst (never a `VITE_` variable) |
| Render | `GEMINI_ANALYST_ENABLED` | `true` to turn the AI analyst on (off otherwise); model, timeout and privacy settings in [docs/AI_ANALYST.md](docs/AI_ANALYST.md) |
| Vercel | `VITE_API_URL` | the Render URL, e.g. `https://fraudshield-api.onrender.com` (the build fails without it) |

Why read-only: a Render web service's disk is wiped on every deploy and restart, and the app has no safe way to
let the public write (the browser app must never receive the API key). The ledger and models are rebuilt at build
time and the case database is re-seeded at start, so nothing needs to persist. Recording decisions in a public
deployment would need a persistent database (Render Postgres or a paid disk) plus real user authentication.

Free-plan limits: the backend sleeps after about 15 minutes without traffic and takes roughly a minute to wake;
the header shows “Server unreachable” until it does.

## Further documentation

- [`backend/README.md`](backend/README.md): database schema and API details
- [`docs/LIVE_INVESTIGATION.md`](docs/LIVE_INVESTIGATION.md): how a live investigation is computed, its data source and limits
- [`docs/AI_ANALYST.md`](docs/AI_ANALYST.md): the Gemini AI analyst: configuration, privacy policy, states, quota and smoke test
- [`ml/README.md`](ml/README.md) and [`docs/V2_ML_MODELS.md`](docs/V2_ML_MODELS.md): model training and evaluation
- [`docs/PRODUCT_INVENTORY.md`](docs/PRODUCT_INVENTORY.md): what changed in the simplification and why
- Interactive API docs: <http://localhost:8000/docs> (development only)
