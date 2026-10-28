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

The site has two main destinations, **Home** and **Investigations**, plus a secondary **Tools** area.

Every case opens in the same four sections. The case ID stays at the top, and the section and selected account
are kept in the page address, so refresh, back/forward and shared links all return to the same place.

| Section | Question it answers | What you see |
|---|---|---|
| **1. Summary** | What happened? | The complaint side by side with the recorded transfer (and whether they match), what the records show so far, and a list of what is **still unknown**. |
| **2. Money flow** | Where did the money go? | A left-to-right diagram (or a plain list) of recorded transfers from the reporting customer. Select an account or a transfer to see amounts, payment method, time and hop. |
| **3. Accounts & risk** | Which accounts need attention, and why? | For each account: the recorded facts, rule-based patterns (such as quick forwarding), automated risk checks with their reasons and limits, and missing evidence. |
| **4. Review & history** | What has been decided? | Record a decision with your reasoning (you confirm it before it is saved), change the case status, and read the case history. |

### Starting the sample investigation

Open the site and choose **Start sample investigation**. That opens case **FS-2001**:

- A synthetic complaint: customer `ACC-000001` says a caller persuaded them to send **₹2,50,000** by IMPS to `ACC-000003`.
- The records show `ACC-000003` sent ₹2,45,000 on to two accounts within 10 minutes, and both of those made ATM cash-outs shortly after.
- Try this: open `ACC-000003` in **Accounts & risk**. The ledger rules score it **high (60/100)**, but the account model scores it **low (10%)**. Then open `ACC-000001`, the reporting customer, whom the model scores **76.5%**. The workspace explains why neither score is a finding.
- Record a decision in **Review & history**, refresh the page, and check that it is still there in the history.

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
| **Account model** (`v2-account-1.0.0`) | An XGBoost model over 26 behaviour features. Shows the six inputs that moved the score most (TreeSHAP), explained in plain words. | Accounts in the synthetic account ledger only. |
| **Rule-based patterns** | Observations from the case’s own transfers, such as forwarding within minutes or splitting payments. | Every case. |

Both automated checks run on an account’s **whole ledger history** (including activity after the case),
computed when you open the account.

**How good is the account model?** On held-out synthetic test accounts at its 50% threshold, it caught
**33%** of suspicious accounts, and **50%** of the accounts it flagged were suspicious (ROC-AUC 0.99). The test
set held only **6 suspicious accounts**, so these figures are rough. It misses cases and raises false alarms.
The sample case’s scenario was held out of training, so its scores are out-of-sample.

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
PYTHONPATH=backend:. backend/.venv/bin/python ml/v2/train_account_model.py
PYTHONPATH=. backend/.venv/bin/python ml/v2/paysim_benchmark.py   # needs the PaySim CSV in data/raw/
```

### Running the tests

```bash
backend/.venv/bin/python -m pytest backend/tests -q   # run from the repository root
backend/.venv/bin/python -m pytest ml/tests -q
cd frontend && npm test && npm run build
```

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
- **Small model test set.** The account model’s test results rest on 6 suspicious accounts.
- **Reviewer identity is not verified.** Without an API key configured (`ADMIN_API_KEY`), the reviewer
  name is whatever is typed. The history labels it as unverified. Production use would need sign-in and roles.
- **Audit history is append-only in the application, not tamper-proof.** Events are stored in SQLite with
  server timestamps. They are not cryptographically signed or hash-chained.
- **Older local data.** A database used with earlier builds may contain a review of `ACC-000001` under FS-1042
  (made through a since-removed shortcut that linked the two datasets). It is kept as recorded history. New
  reviews are only accepted for accounts that are actually in the case.
- **Case creation** is available through the API (`POST /api/cases`) but not in the interface, because a new
  case also needs its transactions loaded.
- **Large frontend bundle** (~1.8 MB before compression). Code splitting has not been done.

---

## Further documentation

- [`backend/README.md`](backend/README.md): database schema and API details
- [`ml/README.md`](ml/README.md) and [`docs/V2_ML_MODELS.md`](docs/V2_ML_MODELS.md): model training and evaluation
- [`docs/PRODUCT_INVENTORY.md`](docs/PRODUCT_INVENTORY.md): what changed in the simplification and why
- Interactive API docs: <http://localhost:8000/docs> (development only)
