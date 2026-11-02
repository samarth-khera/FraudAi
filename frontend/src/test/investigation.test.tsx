import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '../App';
import { InvestigatePage } from '../pages/InvestigatePage';
import { toRequest, DEFAULT_FORM } from '../components/investigation/formModel';
import { buildTrail, layoutTrail, TREE } from '../components/investigation/trail';
import { suspiciousHeading, whatHappened } from '../components/investigation/narrative';
import { v2Api } from '../services/v2Api';
import { InvestigationExplanationResponse, InvestigationResponse } from '../types/investigation';
import { V2AccountProfileResponse } from '../types/v2';
import { DatasetAccount, DynamicReport } from '../types/dynamic';
import fixture from './fixtures/investigation.json';
import dynamicFixture from './fixtures/dynamic.json';
import intermediaryFixture from './fixtures/dynamic_intermediary.json';

vi.mock('../services/v2Api', () => ({
  v2Api: {
    runDynamicInvestigation: vi.fn(),
    explainDynamicInvestigation: vi.fn(),
    getDatasetAccount: vi.fn(),
    listDatasets: vi.fn(() => new Promise(() => {})),
    getSampleAccounts: vi.fn(() => new Promise(() => {})),
    getModelsStatus: vi.fn(() => new Promise(() => {})),
    getAccount: vi.fn(),
    getAssessment: vi.fn(),
    getDataSource: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const REPORT = fixture as unknown as InvestigationResponse;
const DYN = dynamicFixture as unknown as DynamicReport;
// FS-EAAA344C investigated directly (served forensic ledger), from a server that builds the investigator report.
const MID = intermediaryFixture as unknown as DynamicReport;
const run = vi.mocked(v2Api.runDynamicInvestigation);
const explain = vi.mocked(v2Api.explainDynamicInvestigation);
const getDatasetAccount = vi.mocked(v2Api.getDatasetAccount);

/** A trace report wrapped as a dynamic investigation with nothing model-flagged (consistent with its own IDs). */
function dyn(report: InvestigationResponse): DynamicReport {
  const root = report.victim.account_id;
  const restriction = {
    account_id: root, state: 'insufficient_evidence_to_recommend' as const, label: 'Insufficient evidence to recommend restriction',
    rationale: 'The evidence does not support a recommendation either way.', supporting_evidence: [], relevant_transaction_ids: [],
    may_be_victim: false, victim_note: null, innocent_explanations: [], verification_needed: [], missing_information: ['Intent is not recorded.'],
    funds_may_still_be_held: null, human_review_required: true as const, automatic_action_taken: false as const,
  };
  return {
    ...DYN,
    investigation_id: report.investigation_id,
    dataset: { ...DYN.dataset, dataset_id: 'demo-ledger', title: 'FraudShield demo ledger', source: report.data_source },
    account_summary: { ...DYN.account_summary, account_id: root },
    victim_assessment: { ...DYN.victim_assessment, account_id: root },
    suspicious_transactions: [],
    uncorroborated_rule_flags: [],
    transaction_scores: [],
    fund_trace: { ...DYN.fund_trace, branches: [] },
    affected_accounts: { potential_victims: [], potential_secondary_victims: [], potential_intermediaries: [], suspicious_accounts: [],
      ordinary_counterparties: [], unknown_roles: [], cash_withdrawal_points: [] },
    role_assessments: [],
    network_findings: [],
    restriction_recommendation: restriction,
    model_validation: { validated_for_this_dataset: false, note: 'Models are not validated on this dataset; shown for reference only.' },
    transaction_scoring: { ...DYN.transaction_scoring, model_used_as_evidence: false },
    investigation: report,
  };
}

const datasetAccount = (id: string): DatasetAccount => ({
  dataset_id: 'demo-ledger', dataset_title: 'FraudShield demo ledger', account_id: id, exists: true, customer_type: 'retail',
  account_opened_at: '2025-01-01T00:00:00', transactions: 10, outgoing: 9, incoming: 1, first_transaction_at: '2026-01-10T00:00:00',
  last_transaction_at: '2026-01-13T10:00:00', history_sufficient: true, minimum_history: 5, coverage_note: 'Enough history for the account behaviour model.',
  models: { transaction_model: { available: true, model_version: 'v3-transaction-1.0.0' }, account_model: { available: true, model_version: 'v3-account-1.0.0' } },
  synthetic: true,
});
const getAccount = vi.mocked(v2Api.getAccount);
const getAssessment = vi.mocked(v2Api.getAssessment);
const getDataSource = vi.mocked(v2Api.getDataSource);

const profile = (id: string): V2AccountProfileResponse => ({
  account_id: id,
  customer_name: 'Test Holder',
  customer_type: 'retail',
  kyc_tier: 'tier_2_verified',
  phone_number: '+91-00000-00000',
  email: 'holder@example.test',
  upi_id: 'holder@upi',
  tax_identifier: 'TAXID0000',
  initial_balance: 300000,
  current_balance: 52000,
  account_opened_at: '2025-01-01T00:00:00',
  status: 'active',
  metrics: {
    total_incoming_txns: 1,
    total_outgoing_txns: 9,
    total_incoming_amount: 60000,
    total_outgoing_amount: 268000,
    net_flow: -208000,
    unique_counterparties: 3,
    first_activity_at: '2026-01-10T00:00:00',
    last_activity_at: '2026-01-13T10:00:00',
  },
});

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
};

function renderPage(path = '/investigate') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InvestigatePage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function openBrief(id = 'ACC-VIC', extra = '') {
  renderPage(`/investigate?account=${id}${extra}`);
  return screen.findByTestId('account-brief');
}

async function showReport(report: InvestigationResponse = REPORT) {
  run.mockResolvedValueOnce(dyn(report));
  await openBrief();
  fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
  return screen.findByTestId('investigation-report');
}

const stage = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  run.mockReset();
  explain.mockReset();
  getAccount.mockReset();
  getAssessment.mockReset();
  getDataSource.mockReset();
  getDatasetAccount.mockReset();
  getDatasetAccount.mockImplementation(async (_d, id: string) => datasetAccount(id));
  getAccount.mockImplementation(async (id: string) => profile(id));
  getAssessment.mockResolvedValue(REPORT.accounts[0].rule_assessment!);
  getDataSource.mockResolvedValue(REPORT.data_source);
});

// ---------------------------------------------------------------- the trail model
describe('fund trail model', () => {
  const trail = buildTrail(REPORT);

  it('splits the trace into separate branches, each in the order the money moved', () => {
    expect(trail.branches.map((b) => b.label)).toEqual(['Outflow 1', 'Outflow 2', 'Inflow 1']);
    const [o1, o2, i1] = trail.branches;
    expect(o1.accounts).toEqual(['ACC-VIC', 'ACC-M1', 'ACC-M2A', 'ACC-ATM']);
    expect(o2.accounts).toEqual(['ACC-VIC', 'ACC-M1', 'ACC-M2B', 'ACC-M1']);
    expect(i1.accounts).toEqual(['ACC-EMP', 'ACC-VIC']);
    for (const b of trail.branches) {
      // Each transfer is the one the next was followed from, and time never runs backwards along a branch.
      b.transfers.forEach((t, i) => {
        if (i === 0) return;
        const prev = b.transfers[i - 1];
        expect(t.timestamp >= prev.timestamp).toBe(true);
        expect(b.direction === 'downstream' ? t.parent_transaction_id : prev.parent_transaction_id).toBe(
          b.direction === 'downstream' ? prev.transaction_id : t.transaction_id,
        );
      });
    }
  });

  it('invents nothing: every branch transfer is in the response, and every response transfer is on a branch', () => {
    const ids = new Set(REPORT.trace.edges.map((e) => e.transaction_id));
    const used = new Set(trail.branches.flatMap((b) => b.transfers.map((t) => t.transaction_id)));
    expect([...used].every((id) => ids.has(id))).toBe(true);
    expect([...ids].every((id) => used.has(id))).toBe(true);
  });

  it('states honestly why each branch ends', () => {
    const [o1, o2, i1] = trail.branches;
    // An ATM cash-out ends the branch as a cash withdrawal even at the depth limit (as the server orders it).
    expect(o1.ending.kind).toBe('no_onward');
    expect(o1.ending.reason).toBe('cash_withdrawal_recorded');
    expect(o1.ending.detail).toMatch(/ACC-M2A as a cash withdrawal; the ledger cannot follow cash/);
    expect(o2.ending.kind).toBe('cycle');
    expect(i1.ending.kind).toBe('no_onward');
    expect(i1.ending.detail).toMatch(/in the available ledger data/);
    for (const b of trail.branches) expect(b.ending.detail).not.toMatch(/recovered|lost|stopped for good/i);
  });

  it('lays the tree out left to right without overlapping nodes, and hides folded branches', () => {
    const layout = layoutTrail(trail, new Set());
    const root = layout.byKey.get('root')!;
    const sender = layout.byKey.get('TXN-T0001')!;
    const recipient = layout.byKey.get('TXN-T0010')!;
    expect(sender.x).toBeLessThan(root.x);
    expect(recipient.x).toBeGreaterThan(root.x);
    for (const a of layout.nodes)
      for (const b of layout.nodes)
        if (a !== b) expect(Math.abs(a.x - b.x) >= TREE.nodeW || Math.abs(a.y - b.y) >= TREE.nodeH).toBe(true);
    expect(layout.links.every((l) => l.from.x < l.to.x)).toBe(true);
    const folded = layoutTrail(trail, new Set(['TXN-T0010']));
    expect(folded.byKey.has('TXN-T0011')).toBe(false);
    expect(folded.nodes.length).toBe(3);
  });
});

// ---------------------------------------------------------------- entry and account summary
describe('form validation', () => {
  it('normalises short IDs and enforces the API limits', () => {
    expect(toRequest({ ...DEFAULT_FORM, accountId: ' 1 ' })).toMatchObject({ request: { account_id: 'ACC-000001', max_depth: 3, max_nodes: 200 } });
    expect(toRequest({ ...DEFAULT_FORM, accountId: '' })).toEqual({ error: 'Enter the account ID to investigate.' });
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC 1; DROP' })).toBe(true);
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC-1', startDate: '2026-03-01', endDate: '2026-02-01' })).toBe(true);
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC-1', maxDepth: 9 })).toBe(true);
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC-1', maxNodes: 1 })).toBe(true);
  });

  it.each([
    ['', 'Enter the account ID'],
    ['ACC 1; DROP', 'letters, numbers'],
  ])('rejects %j before any request', (value, message) => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(getAccount).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects out-of-range trace settings without starting', async () => {
    await openBrief('ACC-VIC', '&depth=9');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Trace depth must be between 1 and 6');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('input-first investigation flow', () => {
  it('shows no result and makes no request before the user acts', () => {
    renderPage();
    expect(screen.queryByTestId('investigation-report')).toBeNull();
    expect(getAccount).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('opening an account normalises the ID, reads only the account, and never starts a trace', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    await screen.findByTestId('account-brief');
    expect(screen.getByTestId('location')).toHaveTextContent('/investigate?account=ACC-000001');
    expect(getAccount).toHaveBeenCalledWith('ACC-000001', expect.any(AbortSignal));
    expect(run).not.toHaveBeenCalled();
  });

  it('a shared link shows the account summary with its settings; it never runs on its own', async () => {
    const brief = await openBrief('ACC-VIC', '&depth=4');
    expect(within(brief).getByRole('heading', { level: 1 })).toHaveTextContent('ACC-VIC');
    expect(brief).toHaveTextContent('Assessment before tracing');
    expect(brief).toHaveTextContent('Elevated');
    expect(brief).toHaveTextContent('up to 4 hops');
    expect(brief).toHaveTextContent('Synthetic demo data');
    // Contact details from the profile are not part of an investigation summary.
    expect(brief).not.toHaveTextContent('holder@example.test');
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [Object.assign(new Error('nope'), { status: 404, code: 'not_found' }), 'Account not found', false],
    [new TypeError('Failed to fetch'), 'The server could not be reached', true],
  ])('reports an account that cannot be loaded (%#)', async (err, title, retry) => {
    getDatasetAccount.mockRejectedValue(err);
    renderPage('/investigate?account=ACC-X');
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(title);
    expect(!!within(alert).queryByRole('button', { name: /Try again/ })).toBe(retry);
    // A dropped connection is read once more before the error is shown; a server answer (404) is not.
    expect(getDatasetAccount).toHaveBeenCalledTimes(retry ? 2 : 1);
    expect(run).not.toHaveBeenCalled();
  });

  it('shows an honest loading state, then the report, with one request that does not wait for the AI', async () => {
    const d = deferred<DynamicReport>();
    run.mockReturnValueOnce(d.promise);
    await openBrief('ACC-VIC', '&depth=4');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual({
      account_id: 'ACC-VIC', dataset_id: 'demo-ledger', max_depth: 4, max_nodes: 200, onward_window_hours: 72, max_accounts_analyzed: 25,
      ai_explanation: 'separate',
    });
    const status = screen.getByTestId('investigation-running');
    expect(status).toHaveTextContent('Investigating ACC-VIC');
    // The engine's steps are listed, never animated as a fake progress bar or a claimed current step.
    expect(status).toHaveTextContent('Tracing funds');
    expect(status.textContent).not.toMatch(/%|step \d/i);
    expect(screen.getByRole('button', { name: /Investigating/ })).toBeDisabled();

    d.resolve(dyn(REPORT));
    await screen.findByTestId('investigation-report');
    expect(screen.getByTestId('location')).toHaveTextContent('/investigate?account=ACC-VIC&depth=4');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Object.assign(new Error("Account 'ACC-X' is not in the configured ledger."), { status: 404, code: 'account_not_found' }), 'Account not found', "'ACC-X' is not in the configured ledger"],
    [new TypeError('Failed to fetch'), 'The server could not be reached', 'No investigation was run'],
    [Object.assign(new Error('The configured ledger has 0 accounts'), { status: 503, code: 'ledger_empty' }), 'The transaction ledger is not available', '0 accounts'],
    [Object.assign(new Error('x'), { status: 500, code: 'investigation_failed' }), 'The investigation failed', 'x'],
  ])('reports investigation errors without showing a report (%#)', async (err, title, text) => {
    run.mockRejectedValueOnce(err);
    await openBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(text);
    expect(screen.queryByTestId('investigation-report')).toBeNull();
  });

  it('a new investigation starts from scratch with a completely fresh request', async () => {
    await showReport();
    fireEvent.click(screen.getByRole('button', { name: /New investigation/ }));
    expect(screen.queryByTestId('investigation-report')).toBeNull();
    expect(screen.getByLabelText('Account ID')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'ACC-M1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    await screen.findByTestId('account-brief');
    run.mockResolvedValueOnce(dyn({ ...REPORT, investigation_id: 'INV-SECOND' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByText('Investigation INV-SECOND');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].account_id).toBe('ACC-M1');
  });
});

// ---------------------------------------------------------------- the staged report
describe('investigation stages', () => {
  it('guides through six stages in order, starting with what happened', async () => {
    await showReport();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs.map((t) => t?.replace(/^\d/, '').split(/What|Where|Who else|A plain|What to/)[0])).toEqual([
      'Overview',
      'Fund trail',
      'Affected accounts',
      'Risk evidence',
      'AI analyst',
      'Next steps',
    ]);
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
    const story = screen.getByTestId('what-happened');
    expect(story).toHaveTextContent('ACC-VIC sent ₹2,50,000 to ACC-M1');
    expect(story).toHaveTextContent('flag this transfer as unusual');
    expect(screen.getByText(/not a confirmed fraudulent event/)).toBeInTheDocument();
    expect(screen.getByText('Drained balance')).toBeInTheDocument();
    expect(screen.getByText(/Written from the ledger records by fixed rules, not by AI/)).toBeInTheDocument();
  });

  it('labels synthetic data and shows source freshness', async () => {
    await showReport();
    expect(screen.getByRole('note')).toHaveTextContent('Synthetic demo data');
    const src = screen.getByTestId('data-source');
    expect(src).toHaveTextContent(REPORT.data_source.source_name);
    expect(src).toHaveTextContent(/Real bank data\s*No/);
    expect(src).toHaveTextContent(REPORT.data_source.freshness_note);
  });

  it('drops the synthetic notice only when the source is not synthetic', async () => {
    await showReport({
      ...REPORT,
      data_source: { ...REPORT.data_source, is_synthetic: false, real_bank_data: true, authorization_reference: 'DSA-7', disclosure: 'Institution records.' },
    });
    expect(screen.queryByText('Synthetic demo data.')).toBeNull();
    expect(screen.getByTestId('data-source')).toHaveTextContent('Yes (authorization DSA-7)');
  });

  it('follows the money transfer by transfer, with the story, tree and inspector in sync', async () => {
    await showReport();
    stage(/Fund trail/);
    const story = screen.getByTestId('branch-story');
    expect(within(story).getByText('Step 1: Investigated account')).toBeInTheDocument();
    expect(within(story).getByText('Step 2: First recipient')).toBeInTheDocument();
    expect(within(story).getByText('Step 4: Onward recipient, hop 3')).toBeInTheDocument();
    expect(screen.getByTestId('branch-ending')).toHaveAttribute('data-kind', 'no_onward');
    expect(screen.getByTestId('branch-ending')).toHaveTextContent('Cash withdrawal recorded');

    // A transfer in the story opens the inspector with its ledger facts.
    fireEvent.click(within(story).getByRole('button', { name: /ACC-M1 → ACC-M2A/ }));
    const inspector = screen.getByRole('dialog', { name: '₹1,30,000' });
    expect(inspector).toHaveTextContent('TXN-T0011');
    expect(inspector).toHaveTextContent('Followed from');
    expect(inspector).toHaveTextContent('TXN-T0010');
    expect(within(story).getByRole('button', { name: /ACC-M1 → ACC-M2A/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Transfer TXN-T0011/ })).toHaveAttribute('aria-pressed', 'true');

    // Previous and next move along the branch.
    fireEvent.click(within(inspector).getByRole('button', { name: /Next transfer/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('TXN-T0013');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Previous transfer/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Previous transfer/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('TXN-T0010');

    // The recipient opens as an account, with the evidence behind its label.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Inspect recipient ACC-M1/ }));
    const m1 = REPORT.accounts.find((a) => a.account_id === 'ACC-M1')!;
    const acct = screen.getByRole('dialog');
    expect(acct).toHaveTextContent('Possible intermediary');
    expect(acct).toHaveTextContent(m1.role_basis[0]);
    expect(acct).toHaveTextContent('Could instead be');
    expect(acct).toHaveTextContent('What is not known');
    expect(within(story).getByRole('button', { name: /Step 2: First recipient/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps branches separate and switches the story when another branch is picked', async () => {
    await showReport();
    stage(/Fund trail/);
    fireEvent.click(screen.getByRole('option', { name: /Outflow 2/ }));
    expect(screen.getByTestId('branch-ending')).toHaveAttribute('data-kind', 'cycle');
    expect(within(screen.getByTestId('branch-story')).getByText('Step 3: Onward recipient, hop 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Inflow 1/ }));
    const story = screen.getByTestId('branch-story');
    expect(within(story).getByText('Step 1: Direct sender')).toBeInTheDocument();
    expect(screen.getByTestId('branch-ending')).toHaveAttribute('data-kind', 'no_onward');
    // Selecting a tree node that sits on another branch moves the story to that branch.
    fireEvent.click(screen.getByRole('button', { name: /^Account ACC-ATM/ }));
    expect(within(screen.getByTestId('branch-story')).getByText('Step 4: Onward recipient, hop 3')).toBeInTheDocument();
  });

  it('expands and collapses tree branches', async () => {
    await showReport();
    stage(/Fund trail/);
    const tree = screen.getByTestId('trail-tree');
    const fold = within(tree).getByRole('button', { name: 'Collapse the transfers after ACC-M1' });
    fireEvent.click(fold);
    expect(within(tree).queryByRole('button', { name: /^Account ACC-ATM/ })).toBeNull();
    const unfold = within(tree).getByRole('button', { name: 'Expand the transfers after ACC-M1' });
    expect(unfold).toHaveTextContent('+4');
    fireEvent.click(unfold);
    expect(within(tree).getByRole('button', { name: /^Account ACC-ATM/ })).toBeInTheDocument();
  });

  it('says where each branch ended without claiming what happened to the money', async () => {
    await showReport();
    stage(/Fund trail/);
    const groups = screen.getAllByTestId('ending-group').map((g) => g.getAttribute('data-kind'));
    // Outflow 1 now ends as a cash withdrawal, grouped apart from the inflow with nothing earlier (same kind, different title).
    expect(groups.sort()).toEqual(['cycle', 'no_onward', 'no_onward']);
    expect(screen.getByText(/A stop is not proof the money stayed, was lost or was recovered/)).toBeInTheDocument();
    expect(screen.getByText(REPORT.trace.truncation_notes[0])).toBeInTheDocument();
  });

  it('presents risk evidence by severity, with every finding and the template summary', async () => {
    await showReport();
    stage(/Risk evidence/);
    expect(screen.getByRole('region', { name: 'High severity' })).toBeInTheDocument();
    const m2a = screen.getByTestId('evidence-ACC-M2A');
    for (const part of ['What was detected', 'What it relates to', 'Evidence', 'Why it matters', 'What is not known']) expect(m2a).toHaveTextContent(part);
    // Every finding is listed, except the trace report's own model findings: a dynamic investigation's account model supersedes them.
    for (const f of REPORT.findings.filter((x) => x.kind !== 'model')) expect(document.getElementById(`finding-${f.finding_id}`)).toHaveTextContent(f.statement);
    for (const f of REPORT.findings.filter((x) => x.kind === 'model')) expect(document.getElementById(`finding-${f.finding_id}`)).toBeNull();
    expect(screen.getByTestId('v2-model-superseded')).toHaveTextContent('older account model is not shown');
    expect(screen.getByText(/not by an AI model/)).toBeInTheDocument();
    for (const s of REPORT.evidence_summary) expect(screen.getAllByText(s.question).length).toBeGreaterThan(0);
    expect(screen.getByText(/A severity is a prompt for review, not proof of fraud/)).toBeInTheDocument();
  });

  it('reports a missing model instead of showing scores', async () => {
    const reason = 'The account risk model file is missing on the server.';
    const noModel: InvestigationResponse = {
      ...REPORT,
      model_available: false,
      model_unavailable_reason: reason,
      model_review_threshold: null,
      accounts: REPORT.accounts.map((a) => ({ ...a, model_assessment: null, model_suggests_review: null, checks_disagree: null })),
    };
    // A dynamic investigation reports its own account model, so the alert follows its model metadata.
    const base = dyn(noModel);
    run.mockResolvedValueOnce({ ...base, model_metadata: { ...base.model_metadata, account_model: { available: false, purpose: 'Account behaviour', unavailable_reason: reason } } });
    await openBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    stage(/Risk evidence/);
    expect(screen.getByText(/The account model did not run/).parentElement).toHaveTextContent(reason);
    // No model score badge is shown for any account (server-written finding text is left as the server wrote it).
    expect(screen.queryByText(/^Model \d/)).toBeNull();
  });

  it('keeps next steps advisory, explains each one, and lists every recommendation', async () => {
    await showReport();
    stage(/Next steps/);
    expect(screen.getByText(/Nothing has been frozen, blocked or flagged/)).toBeInTheDocument();
    expect(screen.getByText('Start here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show 1 more step/ }));
    for (const r of REPORT.recommendations) expect(screen.getAllByText(r.statement).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Why:').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /freeze|block/i })).toBeNull();
  });

  it('offers a deeper re-run only when the depth limit cut the trace, and runs it only on request', async () => {
    await showReport();
    stage(/Next steps/);
    run.mockResolvedValueOnce(dyn({ ...REPORT, investigation_id: 'INV-DEEPER' }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-run with depth 4' }));
    await screen.findByText('Investigation INV-DEEPER');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toMatchObject({ account_id: 'ACC-VIC', max_depth: 4, ai_explanation: 'separate' });
  });
});

// ---------------------------------------------------------------- AI analyst states
describe('AI analyst stage', () => {
  const drain = REPORT.victim.flagged_transfers[0].transaction_id;

  it('says plainly when the AI analyst is turned off', async () => {
    await showReport();
    stage(/AI analyst/);
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveAttribute('data-state', 'disabled');
    expect(ai).toHaveTextContent('AI analyst: turned off');
    expect(ai).toHaveTextContent(REPORT.ai_analysis.message);
    expect(ai).toHaveTextContent('Nothing from this investigation was sent to an AI provider.');
    expect(within(ai).queryByText(/AI-generated/)).toBeNull();
    expect(screen.queryByTestId('ai-request')).toBeNull();
    expect(explain).not.toHaveBeenCalled();
  });

  it.each([
    ['not_configured', 'AI analyst: not configured', 'No Gemini API key is configured on the server.'],
    ['skipped_privacy_policy', 'AI analyst: skipped by privacy policy', 'AI analysis was skipped: the ledger is not verified as synthetic.'],
    ['unavailable', 'AI analyst: unavailable', "The AI provider's rate limit or quota was reached. The investigation results are unaffected."],
  ] as const)('shows the real %s state and keeps the deterministic report', async (state, title, message) => {
    await showReport({
      ...REPORT,
      ai_analysis: { ...REPORT.ai_analysis, state, status: state === 'unavailable' ? 'failed' : 'not_configured', message, report: null,
        unavailable_reason: state === 'unavailable' ? 'rate_limited' : null },
    });
    stage(/AI analyst/);
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveTextContent(title);
    expect(ai).toHaveTextContent(message);
    expect(within(ai).queryByText(/AI-generated/)).toBeNull();
    stage(/Risk evidence/);
    for (const f of REPORT.findings.filter((x) => x.kind !== 'model')) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();
  });

  it('renders a completed Gemini report, labelled as AI-generated, with clickable evidence', async () => {
    await showReport({
      ...REPORT,
      ai_analysis: {
        ...REPORT.ai_analysis, state: 'completed', status: 'generated', provider: 'gemini', model: 'gemini-3.8-flash',
        message: 'Written by gemini (gemini-3.8-flash) from a pseudonymised extract of this report.', pseudonymized: true,
        report: {
          summary: 'ACC-VIC made one unusual transfer that ACC-M1 moved on within minutes.',
          key_observations: [
            { text: 'The transfer drained most of the balance.', basis: 'observed', evidence_ids: [drain] },
            { text: 'The holder may have been deceived.', basis: 'hypothesis', evidence_ids: [] },
          ],
          evidence_references: [drain, 'ACC-M1', 'F-001'],
          reasoning_and_limitations: ['Balances mix funds.'],
          recommended_manual_checks: [{ text: 'Confirm authorisation with the holder.', evidence_ids: [drain] }],
          confidence_note: 'No device or login records are available.',
        },
        sections: [],
      },
    });
    stage(/AI analyst/);
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveAttribute('data-state', 'completed');
    expect(within(ai).getByText('AI-generated by gemini-3.8-flash')).toBeInTheDocument();
    for (const q of ['What happened?', 'Which movements and accounts deserve attention?', 'What would help verify it']) expect(ai).toHaveTextContent(q);
    expect(ai).toHaveTextContent('ACC-VIC made one unusual transfer');
    expect(within(ai).getByText('Cites ledger record')).toBeInTheDocument();
    expect(within(ai).getByText('Hypothesis')).toBeInTheDocument();
    expect(ai).toHaveTextContent('Balances mix funds.');
    expect(ai).toHaveTextContent('Confirm authorisation with the holder.');
    expect(ai).toHaveTextContent('Evidence completeness: No device or login records are available.');
    expect(ai).toHaveTextContent(/not from this text/);
    fireEvent.click(within(ai).getAllByRole('button', { name: drain })[0]);
    expect(document.getElementById('selection-detail')).toHaveTextContent(drain);
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    // A finding reference leads to that finding in the evidence stage.
    fireEvent.click(within(screen.getByTestId('ai-status')).getByRole('link', { name: 'F-001' }));
    expect(screen.getByRole('tab', { name: /Risk evidence/ })).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('finding-F-001')?.closest('details')).toHaveProperty('open', true);
  });

  it('still shows legacy AI sections from an older server without `state`', async () => {
    const { state: _s, report: _r, ...legacy } = REPORT.ai_analysis;
    await showReport({
      ...REPORT,
      ai_analysis: { ...legacy, status: 'generated', provider: 'test', message: 'Older server.',
        sections: [{ question: 'Q?', claims: [{ text: 'ACC-M1 forwarded funds.', kind: 'interpretation', refs: ['ACC-M1'] }] }] },
    });
    stage(/AI analyst/);
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveAttribute('data-state', 'completed');
    expect(within(ai).getByText('ACC-M1 forwarded funds.')).toBeInTheDocument();
  });
});

describe('separately requested AI explanation', () => {
  const DEFERRED: InvestigationResponse = {
    ...REPORT,
    ai_analysis: { ...REPORT.ai_analysis, state: 'deferred', status: 'not_configured', message: 'Requested separately.' },
  };
  const drain = REPORT.victim.flagged_transfers[0].transaction_id;
  const COMPLETED = {
    ...REPORT.ai_analysis, state: 'completed' as const, status: 'generated' as const, provider: 'gemini', model: 'gemini-3.8-flash',
    message: 'Written by Google Gemini (gemini-3.8-flash).', sections: [],
    report: {
      summary: 'ACC-VIC made one unusual transfer.', key_observations: [{ text: 'It drained the balance.', basis: 'observed' as const, evidence_ids: [drain] }],
      evidence_references: [drain], reasoning_and_limitations: ['Balances mix funds.'],
      recommended_manual_checks: [{ text: 'Confirm authorisation.', evidence_ids: [drain] }], confidence_note: 'No device records.',
    },
  };
  const answer = (over: Partial<InvestigationExplanationResponse> = {}): InvestigationExplanationResponse => ({
    account_id: 'ACC-VIC', report_digest: REPORT.report_digest!, data_as_of: null, duration_ms: 1, ai_analysis: COMPLETED, ...over,
  });

  /** QA-01: the explanation is only ever requested by an explicit click in the AI stage. */
  const requestIt = () => {
    stage(/AI analyst/);
    fireEvent.click(screen.getByTestId('ai-request'));
  };

  it('never requests an explanation on its own; it says so and offers the request', async () => {
    await showReport(DEFERRED);
    await new Promise((r) => setTimeout(r, 20));
    expect(explain).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /AI explanation: on request/ })).toBeInTheDocument();
    for (const st of [/Fund trail/, /Risk evidence/, /Next steps/]) stage(st);
    expect(explain).not.toHaveBeenCalled();
    stage(/AI analyst/);
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveAttribute('data-state', 'deferred');
    expect(ai).toHaveTextContent('AI analyst: available on request');
    expect(ai).toHaveTextContent('It is never generated automatically');
    expect(ai).toHaveTextContent('nothing from this investigation is sent to an AI provider');
    expect(explain).not.toHaveBeenCalled();
  });

  it('shows the report at once, keeps every stage usable while the AI writes, then shows the explanation', async () => {
    const d = deferred<InvestigationExplanationResponse>();
    explain.mockReturnValueOnce(d.promise);
    await showReport(DEFERRED);
    expect(run.mock.calls[0][0]).toMatchObject({ account_id: 'ACC-VIC', ai_explanation: 'separate' });
    expect(explain).not.toHaveBeenCalled();
    requestIt();
    stage(/Overview/);
    expect(explain).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'ACC-VIC', ai_explanation: 'separate' }), expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: /AI analyst writing/ })).toBeInTheDocument();

    stage(/Fund trail/);
    expect(screen.getByTestId('branch-story')).toBeInTheDocument();
    stage(/AI analyst/);
    const pending = screen.getByTestId('ai-status');
    expect(pending).toHaveAttribute('data-state', 'pending');
    expect(pending).toHaveTextContent('writing the explanation');
    expect(pending.textContent).not.toMatch(/%/);

    d.resolve(answer());
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'completed'));
    expect(screen.getByText('AI-generated by gemini-3.8-flash')).toBeInTheDocument();
    expect(screen.getByTestId('ai-status')).toHaveTextContent('ACC-VIC made one unusual transfer.');
    expect(run).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it('does not show an explanation of a different report', async () => {
    explain.mockResolvedValueOnce(answer({ report_digest: 'something-else' }));
    await showReport(DEFERRED);
    requestIt();
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'stale'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('different version of this report');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('reports a failed explanation request without touching the report, and retries only on request', async () => {
    explain.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await showReport(DEFERRED);
    requestIt();
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'failed'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('could not be reached for the AI explanation');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
    expect(explain).toHaveBeenCalledTimes(1);
    stage(/Risk evidence/);
    for (const f of REPORT.findings.filter((x) => x.kind !== 'model')) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();
    explain.mockResolvedValueOnce(answer());
    stage(/AI analyst/);
    fireEvent.click(screen.getByRole('button', { name: 'Try the AI explanation again' }));
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'completed'));
    expect(explain).toHaveBeenCalledTimes(2);
  });

  it('shows an unavailable explanation as unavailable', async () => {
    explain.mockResolvedValueOnce(answer({
      ai_analysis: { ...REPORT.ai_analysis, state: 'unavailable', status: 'failed', unavailable_reason: 'service_unavailable', report: null,
        message: 'The AI provider reported that it is temporarily overloaded or unavailable. The investigation results are unaffected.' },
    }));
    await showReport(DEFERRED);
    requestIt();
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'unavailable'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('temporarily overloaded or unavailable');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('abandons a pending explanation when a new investigation starts', async () => {
    let signal: AbortSignal | undefined;
    explain.mockImplementationOnce((_b, s) => {
      signal = s;
      return new Promise(() => {});
    });
    await showReport(DEFERRED);
    requestIt();
    fireEvent.click(screen.getByRole('button', { name: /New investigation/ }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('investigation-report')).toBeNull();
  });

  it('does not request an explanation when the report already carries one', async () => {
    await showReport();
    expect(explain).not.toHaveBeenCalled();
    stage(/AI analyst/);
    expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'disabled');
  });
});

// ---------------------------------------------------------------- model-driven investigation
describe('dynamic investigation', () => {
  const victim = DYN.account_summary.account_id;

  async function showDynamic() {
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce(DYN);
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    return screen.findByTestId('investigation-report');
  }

  it('looks the account up only inside the chosen dataset and shows coverage, not a prediction', async () => {
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    const brief = await screen.findByTestId('account-brief');
    expect(getDatasetAccount).toHaveBeenCalledWith('forensic-scenarios', victim, expect.any(AbortSignal));
    expect(getAccount).not.toHaveBeenCalled();
    expect(within(brief).getByTestId('history-coverage')).toHaveTextContent('Enough history');
    expect(brief).toHaveTextContent('v3-transaction-1.0.0');
    expect(brief.textContent).not.toMatch(/Potential victim|calibrated/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('reports an account that is not in the selected dataset', async () => {
    getDatasetAccount.mockRejectedValueOnce(Object.assign(new Error("Account 'FS-0' is not in the forensic scenario ledger. Account IDs can only be searched inside the selected synthetic dataset."), { status: 404, code: 'account_not_found' }));
    renderPage('/investigate?account=FS-0&dataset=forensic-scenarios');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Account not found');
    expect(alert).toHaveTextContent('only be searched inside the selected synthetic dataset');
  });

  it('flags insufficient history before anything runs', async () => {
    getDatasetAccount.mockImplementationOnce(async (_d, id) => ({ ...datasetAccount(id), transactions: 3, history_sufficient: false,
      coverage_note: 'Fewer than 5 transfers: models will abstain and report insufficient history.' }));
    renderPage('/investigate?account=FS-1&dataset=forensic-scenarios');
    expect(await screen.findByTestId('history-coverage')).toHaveTextContent('models will abstain');
  });

  it('sends one dynamic request for the chosen dataset and shows the account assessment first', async () => {
    await showDynamic();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({ account_id: victim, dataset_id: 'forensic-scenarios', ai_explanation: 'separate' });
    expect(screen.getByTestId('victim-assessment')).toHaveTextContent(DYN.victim_assessment.label);
    const flagged = screen.getAllByTestId('scored-transfer');
    expect(flagged).toHaveLength(Math.min(3, DYN.suspicious_transactions.length));
    expect(flagged[0]).toHaveTextContent('Calibrated score');
    expect(flagged[0]).toHaveTextContent(DYN.suspicious_transactions[0].model_factors[0].label);
    expect(screen.getByTestId('processing-steps')).toHaveTextContent('Tracing funds');
    expect(screen.getByTestId('data-coverage')).toHaveTextContent(DYN.dataset.title);
  });

  it('groups affected accounts by possible role, each with its own evidence and sources kept apart', async () => {
    await showDynamic();
    stage(/Affected accounts/);
    for (const [key, ids] of Object.entries(DYN.affected_accounts)) {
      if (ids.length) expect(screen.getByTestId(`group-${key}`)).toHaveTextContent(ids[0]);
    }
    const mid = DYN.role_assessments.find((a) => a.role_candidate === 'potential_intermediary')!;
    const card = document.getElementById(`role-${mid.account_id}`)!;
    expect(card).toHaveTextContent('Recorded fact');
    expect(card).toHaveTextContent('Model output');
    expect(card).toHaveTextContent('does not establish that the holder knowingly took part');
    expect(card).toHaveTextContent('How did this account become connected?');
    expect(within(card).getByTestId('restriction')).toHaveAttribute('data-state', mid.restriction.state);
    const ordinary = DYN.affected_accounts.ordinary_counterparties[0];
    expect(document.getElementById(`role-${ordinary}`)).toHaveTextContent('No restriction recommendation');
  });

  it('shows innocent explanations, verification and missing information for every connected account (QA-05)', async () => {
    await showDynamic();
    stage(/Affected accounts/);
    const withSafeguards = DYN.role_assessments.filter((a) => a.account_id !== victim && a.restriction.innocent_explanations.length > 0);
    expect(withSafeguards.length).toBeGreaterThan(0);
    for (const a of withSafeguards) {
      const card = document.getElementById(`role-${a.account_id}`)!;
      const panel = within(card).getByTestId('restriction');
      expect(within(panel).getByTestId('restriction-innocent')).toHaveTextContent(a.restriction.innocent_explanations[0]);
      if (a.restriction.missing_information.length) {
        expect(within(panel).getByTestId('restriction-missing')).toHaveTextContent(a.restriction.missing_information[0]);
      }
      if (a.restriction.verification_needed.length) {
        expect(within(panel).getByTestId('restriction-verification')).toHaveTextContent(a.restriction.verification_needed[0]);
      }
      expect(panel).toHaveTextContent('A person at the authorised institution decides');
    }
    // The same safeguards in the Inspector, for an account selected in the fund trail.
    const mid = DYN.role_assessments.find((a) => a.role_candidate === 'potential_intermediary')!;
    stage(/Fund trail/);
    fireEvent.click(within(screen.getByTestId('branch-story')).getAllByRole('button', { name: new RegExp(`^Step \\d+: .*${mid.account_id}`) })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('restriction-innocent')).toHaveTextContent(mid.restriction.innocent_explanations[0]);
    expect(within(dialog).getByTestId('restriction-missing')).toHaveTextContent(mid.restriction.missing_information[0]);
    if (mid.uncertainty_reason) expect(dialog).toHaveTextContent(mid.uncertainty_reason);
  });

  it('keeps what the records show, the interpretation and the unknowns apart for each account (QA-03)', async () => {
    await showDynamic();
    stage(/Affected accounts/);
    const mid = DYN.role_assessments.find((a) => a.role_candidate === 'potential_intermediary')!;
    const card = document.getElementById(`role-${mid.account_id}`)!;
    expect(within(card).getByTestId('block-observed')).toHaveTextContent('Recorded fact');
    const interp = within(card).getByTestId('block-interpretation');
    expect(interp).toHaveTextContent(`Possible role: ${mid.role_label}`);
    expect(interp).toHaveTextContent('not a finding about the holder');
    expect(within(card).getByTestId('block-unknown')).toHaveTextContent('Whether the holder authorised, knew about or was deceived');
    if (mid.uncertainty_reason) expect(within(card).getByTestId('block-unknown')).toHaveTextContent(mid.uncertainty_reason);
  });

  it('asks the victim question only for a victim-side result and explains what a calibrated score is (QA-12)', async () => {
    await showDynamic();
    expect(screen.getByTestId('assessment-question')).toHaveTextContent(
      DYN.victim_assessment.status === 'potential_victim' ? 'potentially a victim?' : 'What the records show about');
    const first = screen.getAllByTestId('scored-transfer')[0];
    expect(first).toHaveTextContent('A model score, not a probability of fraud');
    expect(first).toHaveTextContent(`review threshold ${((DYN.model_metadata.transaction_model.threshold ?? 0) * 100).toFixed(2)}%`);
  });

  it('gives an abstaining or forwarding result a neutral heading', async () => {
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce({ ...DYN, victim_assessment: { ...DYN.victim_assessment, status: 'insufficient_evidence', label: 'Insufficient evidence',
      role_candidate: 'unknown_role', headline: 'Its flagged outgoing transfer(s) were paid out of money it had just received.' } });
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    expect(screen.getByTestId('assessment-question')).toHaveTextContent(`What the records show about ${victim}`);
    expect(screen.getByTestId('assessment-question')).not.toHaveTextContent('victim');
  });

  it('discusses restriction with human-approval language and offers no action that changes an account', async () => {
    await showDynamic();
    stage(/Next steps/);
    const panel = screen.getAllByTestId('restriction')[0];
    expect(panel).toHaveAttribute('data-state', DYN.restriction_recommendation.state);
    expect(panel).toHaveTextContent('A person at the authorised institution decides');
    expect(panel).toHaveTextContent('took no action on this account');
    expect(screen.queryByRole('button', { name: /freeze|block|restrict|suspend/i })).toBeNull();
    // Connected-account checks come from the role assessment, so they cannot contradict it.
    const mid = DYN.role_assessments.find((a) => a.role_candidate === 'potential_intermediary')!;
    const checks = screen.getByTestId('role-next-checks');
    expect(checks).toHaveTextContent(mid.account_id);
    expect(checks).toHaveTextContent(mid.recommended_next_check);
  });

  it('keeps rule flags the validated model does not support visible, apart from the suspicious transactions', async () => {
    const t = { ...DYN.suspicious_transactions[0], transaction_id: 'TX-RULE-ONLY', model_flag: false, risk_category: 'low' as const,
      rule_flags: [{ code: 'AMOUNT_ABOVE_OWN_HISTORY', explanation: 'Far above its own earlier transfers.' }] };
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce({ ...DYN, uncorroborated_rule_flags: [t] });
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    expect(screen.getByText(/1 transfer\(s\) flagged by the fixed rules but not by the validated transaction model/)).toBeInTheDocument();
    expect(screen.getByTestId('uncorroborated')).toHaveTextContent('not treated as suspicious activity');
  });

  it('shows the closest unflagged transfers as context only when nothing was flagged', async () => {
    const near = { transaction_id: 'TX-NEAR-1', timestamp: '2026-02-01T10:00:00', receiver_account_id: 'FS-NEAR0001', amount: 6662.49,
      transaction_type: 'TRANSFER', channel: 'UPI', calibrated_probability: 0.000978, threshold: 0.001302, share_of_threshold: 0.75,
      evidence_use: 'evidence' as const };
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce({ ...DYN, suspicious_transactions: [], closest_unflagged_transfers: [near] });
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    const panel = screen.getByTestId('closest-unflagged');
    expect(panel).toHaveTextContent('TX-NEAR-1');
    expect(panel).toHaveTextContent('not a finding');
    expect(panel).toHaveTextContent('Score 0.098% vs threshold 0.130%');
  });

  it('hides the closest unflagged transfers when suspicious transactions exist', async () => {
    const near = { transaction_id: 'TX-NEAR-2', timestamp: '2026-02-01T10:00:00', receiver_account_id: 'FS-NEAR0002', amount: 10,
      transaction_type: 'TRANSFER', channel: null, calibrated_probability: 0.0001, threshold: 0.0013 };
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce({ ...DYN, closest_unflagged_transfers: [near] });
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    expect(screen.queryByTestId('closest-unflagged')).toBeNull();
  });

  it('marks model outputs as reference only on a dataset the models were not validated on', async () => {
    await showReport();
    expect(screen.getByTestId('model-not-validated')).toHaveTextContent('reference only');
  });

  it('shows the transaction model next to the rules in the transfer inspector', async () => {
    await showDynamic();
    stage(/Fund trail/);
    const t = DYN.transaction_scores.find((x) => x.model_flag)!;
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`${t.transaction_id}`) })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Flagged by the transaction model');
    expect(dialog).toHaveTextContent('Transaction model (decision-time)');
  });

  // An account the trace report calls 'Recipient under review' but the dynamic role assessment clears.
  const cleared = DYN.role_assessments.find(
    (r) => r.role_candidate === 'no_suspicious_linkage_observed' &&
      DYN.investigation.accounts.find((a) => a.account_id === r.account_id)?.role_assessment === 'recipient_under_review',
  )!;

  it('labels accounts with the dynamic role assessment in the fund trail and the risk evidence, not the trace report', async () => {
    await showDynamic();
    stage(/Fund trail/);
    fireEvent.click(screen.getAllByRole('option', { name: new RegExp(cleared.account_id) })[0]);
    const step = within(screen.getByTestId('branch-story')).getByRole('button', { name: new RegExp(`^Step \\d+: .*${cleared.account_id}`) });
    expect(step).toHaveTextContent(cleared.role_label);
    expect(step).not.toHaveTextContent('Recipient under review');

    stage(/Risk evidence/);
    const evidence = screen.getByTestId(`evidence-${cleared.account_id}`);
    expect(evidence).toHaveTextContent(cleared.role_label);
    expect(evidence).not.toHaveTextContent('Recipient under review');
    // The dynamic account model replaces the trace report's model score and its disagreement note.
    expect(within(evidence).getByTestId('account-model-v3')).toHaveAttribute('data-status', cleared.account_model.status);
    const v2 = DYN.investigation.accounts.find((a) => a.account_id === cleared.account_id)!;
    if (v2.disagreement_note) expect(evidence).not.toHaveTextContent(v2.disagreement_note);
  });

  it('keeps the transaction model out of the rule flags and shows it as a model output', async () => {
    await showDynamic();
    const t = DYN.investigation.trace.edges.find((e) => e.flags.some((f) => f.code === 'MODEL_TRANSACTION_RISK'))!;
    expect(screen.getAllByTestId('model-flag')[0]).toHaveTextContent('Transaction model');
    stage(/Fund trail/);
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(t.transaction_id) })[0]);
    const dialog = await screen.findByRole('dialog');
    const rules = within(dialog).getByTestId('rule-flags');
    expect(within(rules).getAllByRole('listitem')).toHaveLength(t.flags.length - 1);
    expect(rules).not.toHaveTextContent('Transaction model');
  });

  it('shows the AI state from an explanation response that explained nothing, instead of calling it stale', async () => {
    explain.mockResolvedValueOnce({ account_id: victim, report_digest: '', data_as_of: null, duration_ms: 0,
      ai_analysis: { ...REPORT.ai_analysis, state: 'disabled', status: 'not_configured', report: null, message: 'The AI analyst is turned off on this server.' } });
    run.mockResolvedValueOnce(DYN);
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    stage(/AI analyst/);
    expect(explain).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ai-request'));
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'disabled'));
  });

  it('makes no explanation request when the report says the analyst cannot run', async () => {
    run.mockResolvedValueOnce({ ...DYN, investigation: { ...DYN.investigation, ai_analysis: { ...DYN.investigation.ai_analysis, state: 'not_configured', status: 'not_configured' } } });
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    expect(explain).not.toHaveBeenCalled();
  });

  it('says before the run that the trace starts from the fixed rules when the models are not validated on the dataset', async () => {
    getDatasetAccount.mockImplementationOnce(async (_d, id) => ({ ...datasetAccount(id), models_validated: false, model_note: 'Shown for reference only on this ledger.' }));
    const brief = await openBrief();
    expect(brief).toHaveTextContent('The trace starts from the ones flagged by the fixed rules');
    expect(brief).not.toHaveTextContent('flagged by the model or the fixed rules');
    expect(within(brief).getByRole('list', { name: 'Model availability' })).toHaveTextContent('reference only, not validated on this dataset');
    expect(screen.getByTestId('models-reference-only')).toHaveTextContent('Shown for reference only on this ledger.');
  });

  it('says on each dataset card whether the models count as evidence there, before any account is chosen (QA-16)', async () => {
    vi.mocked(v2Api.listDatasets).mockResolvedValueOnce([
      { dataset_id: 'demo-ledger', title: 'FraudShield demo ledger', description: 'd', evaluation_labels_note: '', available: true,
        model_support: 'unsupported_distribution_shift', model_note: 'Out of distribution.' },
      { dataset_id: 'forensic-scenarios', title: 'Forensic scenario ledger', description: 'f', evaluation_labels_note: '', available: true,
        model_support: 'validated_in_distribution', model_note: 'Same generator family.' },
    ]);
    renderPage();
    expect(await screen.findByTestId('model-support-demo-ledger')).toHaveTextContent('Models reference only: out of distribution');
    expect(screen.getByTestId('model-support-forensic-scenarios')).toHaveTextContent('Models validated on this dataset');
    expect(getDatasetAccount).not.toHaveBeenCalled();
  });

  it('moves through the dataset radio group with the arrow keys and lists sample reasons as text', async () => {
    vi.mocked(v2Api.getSampleAccounts).mockResolvedValueOnce({ dataset_id: 'forensic-scenarios', basis: 'Observable activity only.',
      accounts: [{ account_id: 'FS-AAAA0001', reason: 'One transfer took 98% of its balance.' }] });
    renderPage();
    const [demo, forensic] = screen.getAllByRole('radio');
    expect(demo).toHaveAttribute('tabindex', '0');
    expect(forensic).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(demo, { key: 'ArrowRight' });
    expect(screen.getByTestId('location')).toHaveTextContent('dataset=forensic-scenarios');
    expect(screen.getAllByRole('radio')[1]).toHaveFocus();
    const sample = await screen.findByRole('button', { name: 'FS-AAAA0001' });
    expect(sample).toHaveAccessibleDescription('One transfer took 98% of its balance.');
    expect(screen.getByTestId('sample-accounts')).toHaveTextContent('One transfer took 98% of its balance.');
  });

  it('shows the account model from the role assessment even when the trace report has no rule assessment', async () => {
    const mid = DYN.role_assessments.find((a) => a.role_candidate === 'potential_intermediary')!;
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce({ ...DYN, investigation: { ...DYN.investigation,
      accounts: DYN.investigation.accounts.map((a) => (a.account_id === mid.account_id ? { ...a, rule_assessment: null } : a)) } });
    renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByTestId('investigation-report');
    stage(/Fund trail/);
    fireEvent.click(within(screen.getByTestId('branch-story')).getAllByRole('button', { name: new RegExp(`^Step \\d+: .*${mid.account_id}`) })[0]);
    const box = within(await screen.findByRole('dialog')).getByTestId('inspector-account-model');
    expect(box).toHaveTextContent(`${((mid.account_model.calibrated_probability ?? 0) * 100).toFixed(1)}%`);
    expect(screen.getByRole('dialog')).toHaveTextContent(mid.recommended_next_check);
  });

  it('says which check flagged a seed transfer: the rules, the transaction model or both', () => {
    const seed = REPORT.victim.flagged_transfers[0];
    const withFlags = (flags: typeof seed.flags): InvestigationResponse => ({
      ...REPORT, victim: { ...REPORT.victim, flagged_transfers: [{ ...seed, flags }, ...REPORT.victim.flagged_transfers.slice(1)] },
    });
    const model = { code: 'MODEL_TRANSACTION_RISK', explanation: 'At or above the threshold.' };
    const rule = seed.flags.find((f) => f.code !== 'MODEL_TRANSACTION_RISK')!;
    const story = (r: InvestigationResponse) => whatHappened(r, buildTrail(r))[0];
    expect(story(withFlags([model]))).toContain('The transaction model flags this transfer for review.');
    expect(story(withFlags([model]))).not.toContain('rules');
    expect(story(withFlags([rule]))).toContain('The rules flag this transfer as unusual');
    expect(story(withFlags([rule, model]))).toContain('and the transaction model flags it for review');
  });

  it('never mixes model-flagged and rule-only transfers in one count (QA-06)', async () => {
    // The FS-10B80A33 shape: one transfer flagged by the validated model, one flagged only by a fixed rule.
    const seed = REPORT.victim.flagged_transfers[0];
    const model = { code: 'MODEL_TRANSACTION_RISK', explanation: 'At or above the threshold.' };
    const rule = seed.flags.find((f) => f.code !== 'MODEL_TRANSACTION_RISK')!;
    const second = { ...seed, transaction_id: 'TX-RULE-ONLY', amount: 50843, timestamp: seed.timestamp, flags: [rule] };
    const mixed: InvestigationResponse = {
      ...REPORT,
      victim: { ...REPORT.victim, flagged_transfers: [{ ...seed, amount: 30124, flags: [model] }, second] },
    };
    const [line] = whatHappened(mixed, buildTrail(mixed), true);
    expect(line).toContain('made 2 flagged transfers');
    expect(line).toContain('1 transfer (₹30,124) flagged by the transaction model and 1 (₹50,843) by a fixed rule only');
    expect(line).toContain('which the validated transaction model does not support');
    expect(line).not.toMatch(/₹80,967 in total/);

    const t = { ...DYN.suspicious_transactions[0], transaction_id: 'TX-RULE-ONLY', model_flag: false, risk_category: 'low' as const,
      rule_flags: [{ code: 'AMOUNT_ABOVE_OWN_HISTORY', explanation: 'Far above its own earlier transfers.' }] };
    const one = { ...DYN, suspicious_transactions: DYN.suspicious_transactions.slice(0, 1), uncorroborated_rule_flags: [t] };
    expect(suspiciousHeading(one)).toBe(
      "1 of this account's transfers was flagged by the validated transaction model. 1 more was flagged by a fixed rule only; it is listed below and not treated as suspicious. Each was scored using only records from before it.",
    );
    const unvalidated = { ...one, transaction_scoring: { ...one.transaction_scoring, model_used_as_evidence: false } };
    expect(suspiciousHeading(unvalidated)).toContain('flagged by the fixed rules (the transaction model is not validated on this dataset');
    expect(suspiciousHeading(unvalidated)).not.toContain('transaction model or');
  });

  it('cancels the account lookups when the brief is left', async () => {
    const { unmount } = renderPage(`/investigate?account=${victim}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    const signal = getDatasetAccount.mock.calls[0][2]!;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe('routing', () => {
  it('serves the investigation page from a link and lists it in the navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/investigate?account=ACC-000001']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const brief = await screen.findByTestId('account-brief');
    expect(within(brief).getByRole('heading', { level: 1 })).toHaveTextContent('ACC-000001');
    expect(screen.getAllByRole('link', { name: 'Investigate' })[0]).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(run).not.toHaveBeenCalled());
  });
});

describe('fund trail on a small screen', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    // A phone: narrower than 768px, with reduced motion so nothing animates in the test.
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it('reads the trail as a nested list that keeps every hop, amount and reference', async () => {
    await showReport();
    stage(/Fund trail/);
    const outline = screen.getByTestId('trail-outline');
    expect(screen.queryByTestId('trail-tree')).toBeNull();
    const hop = within(outline).getByRole('button', { name: /^₹1,30,000 to ACC-M2A, TXN-T0011/ });
    expect(hop).toHaveTextContent('Hop 2');
    expect(hop).toHaveTextContent('TXN-T0011');

    // Folding an account hides what came after it, and says how much is hidden.
    fireEvent.click(within(outline).getByRole('button', { name: 'Hide the transfers after ACC-M1' }));
    expect(within(outline).queryByRole('button', { name: /^ACC-ATM/ })).toBeNull();
    const show = within(outline).getByRole('button', { name: 'Show the transfers after ACC-M1' });
    expect(show).toHaveTextContent('+4');
    fireEvent.click(show);
    expect(within(outline).getAllByRole('button', { name: /^ACC-ATM/ }).length).toBeGreaterThan(0);

    // A hop opens the same inspector as the wide tree.
    fireEvent.click(within(outline).getByRole('button', { name: /^₹1,30,000 to ACC-M2A/ }));
    expect(await screen.findByRole('dialog', { name: '₹1,30,000' })).toHaveTextContent('TXN-T0011');
  });
});

// ---------------------------------------------------------------- account role correction and the investigator report
describe('investigator report', () => {
  const mule = MID.account_summary.account_id;
  const rep = MID.investigator_report!;

  async function showMule(data: DynamicReport = MID) {
    explain.mockReturnValue(new Promise(() => {}));
    run.mockResolvedValueOnce(data);
    renderPage(`/investigate?account=${mule}&dataset=forensic-scenarios`);
    await screen.findByTestId('account-brief');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    return screen.findByTestId('investigation-report');
  }

  it('names an account that passed money on by its role, never by a victim phrase, with each item tagged by source', async () => {
    await showMule();
    const root = MID.role_assessments.find((a) => a.account_id === mule)!;
    expect(root.role_candidate).toBe('potential_intermediary');
    expect(screen.getByTestId('victim-assessment')).toHaveTextContent('Potential intermediary');
    expect(screen.getByTestId('assessment-question')).not.toHaveTextContent('victim');
    const ev = screen.getByTestId('assessment-evidence');
    expect(within(ev).getAllByText('Model output').length).toBeGreaterThan(0);
    expect(within(ev).getAllByText('Recorded fact').length).toBeGreaterThan(0);
    expect(ev).toHaveTextContent('its own earlier balance was not drawn down');
  });

  it('adds the investigator report as the final stage, every section taken from the same response', async () => {
    await showMule();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[tabs.length - 1]).toHaveTextContent('Investigator report');
    stage(/Investigator report/);
    expect(screen.getByTestId('report-notice')).toHaveTextContent(
      'Recommendation only. No account restriction, freeze or hold has been executed. Authorized institutional approval and applicable procedures are required.');
    expect(screen.getByText(rep.generator.description)).toBeInTheDocument();
    expect(rep.generator.language_model_used).toBe(false);
    expect(screen.getByTestId('report-leaning')).toHaveTextContent(rep.executive_summary.leaning_text);
    for (const h of ['Executive summary', 'Account risk assessment', 'Transaction chronology', 'Fund flow', 'Connected accounts',
      'Review and restriction recommendations', 'Findings and next steps']) {
      expect(screen.getByRole('heading', { name: new RegExp(h) })).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('report-chronology')).getAllByRole('row')).toHaveLength(rep.chronology.rows.length + 1);
    const table = screen.getByTestId('report-connected');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(rep.connected_accounts.length);
    for (const c of rep.connected_accounts) {
      const row = table.querySelector(`[data-account="${c.account_id}"]`)!;
      expect(row).toHaveTextContent(c.role_label);
      expect(row.querySelector(`[data-level="${c.level}"]`)).not.toBeNull();
    }
    expect(within(screen.getByTestId('report-hops')).getAllByRole('row')).toHaveLength(rep.fund_flow.hops.length + 1);
  });

  it('gives each connected account its own recommendation and keeps a possible victim on protective verification', async () => {
    await showMule();
    stage(/Investigator report/);
    const cards = screen.getAllByTestId('report-recommendation');
    const byAccount = new Map(cards.map((c) => [c.getAttribute('data-account'), c]));
    for (const r of rep.recommendations.filter((x) => x.level >= 2 || x.account_id === mule)) {
      const card = byAccount.get(r.account_id)!;
      expect(card).toHaveAttribute('data-level', String(r.level));
      expect(card).toHaveTextContent('Who decides');
      expect(card).toHaveTextContent('Nothing has been executed');
    }
    const victim = rep.recommendations.find((r) => r.role_candidate === 'potential_victim')!;
    expect(victim.track).toBe('protective');
    expect(byAccount.get(victim.account_id)).toHaveTextContent('Urgent protective verification');
    expect(new Set(rep.recommendations.map((r) => r.level)).size).toBeGreaterThan(1);
  });

  it('keeps evidence for a victim apart from evidence of passing money on', async () => {
    await showMule();
    stage(/Investigator report/);
    const sus = screen.getByTestId('suspicion-side-evidence');
    for (const e of rep.risk_assessment.suspicion_side_evidence) expect(sus).toHaveTextContent(e.text.slice(0, 40));
    expect(screen.getByTestId('victim-side-evidence')).toHaveTextContent('Nothing in the records shows its own money leaving');
  });

  it('offers recommendations only: no control can act on an account', async () => {
    await showMule();
    stage(/Investigator report/);
    const report = screen.getByTestId('investigator-report');
    const buttons = within(report).queryAllByRole('button').map((b) => b.textContent ?? '');
    expect(buttons.filter((t) => /freeze|hold|block|restrict|suspend/i.test(t))).toEqual([]);
    expect(within(report).getByRole('button', { name: 'Print report' })).toBeInTheDocument();
    expect(report).not.toHaveTextContent(/has been (frozen|restricted|blocked)|hold (was|has been) placed/i);
  });

  it('prints the report on request and restores the page afterwards', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await showMule();
    stage(/Investigator report/);
    fireEvent.click(screen.getByRole('button', { name: 'Print report' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveClass('print-report');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement).not.toHaveClass('print-report');
    print.mockRestore();
  });

  it('shows no report stage when the server does not provide one', async () => {
    await showMule({ ...MID, investigator_report: undefined });
    expect(screen.queryByRole('tab', { name: /Investigator report/ })).toBeNull();
  });
});
