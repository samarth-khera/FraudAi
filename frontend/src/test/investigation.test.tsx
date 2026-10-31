import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '../App';
import { InvestigatePage } from '../pages/InvestigatePage';
import { toRequest, DEFAULT_FORM } from '../components/investigation/formModel';
import { buildTrail, layoutTrail, TREE } from '../components/investigation/trail';
import { v2Api } from '../services/v2Api';
import { InvestigationExplanationResponse, InvestigationResponse } from '../types/investigation';
import { V2AccountProfileResponse } from '../types/v2';
import fixture from './fixtures/investigation.json';

vi.mock('../services/v2Api', () => ({
  v2Api: {
    runInvestigation: vi.fn(),
    explainInvestigation: vi.fn(),
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
const run = vi.mocked(v2Api.runInvestigation);
const explain = vi.mocked(v2Api.explainInvestigation);
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
  run.mockResolvedValueOnce(report);
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
    expect(o1.ending.kind).toBe('depth_limit');
    expect(o1.ending.detail).toMatch(/ACC-ATM was not followed further/);
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
    expect(getAccount).toHaveBeenCalledWith('ACC-000001');
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
    getAccount.mockRejectedValueOnce(err);
    renderPage('/investigate?account=ACC-X');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(!!within(alert).queryByRole('button', { name: /Try again/ })).toBe(retry);
    expect(run).not.toHaveBeenCalled();
  });

  it('shows an honest loading state, then the report, with one request that does not wait for the AI', async () => {
    const d = deferred<InvestigationResponse>();
    run.mockReturnValueOnce(d.promise);
    await openBrief('ACC-VIC', '&depth=4');
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({ account_id: 'ACC-VIC', max_depth: 4, trace_scope: 'flagged', ai_explanation: 'separate' });
    const status = screen.getByTestId('investigation-running');
    expect(status).toHaveTextContent('Investigating ACC-VIC');
    expect(status.textContent).not.toMatch(/%|step \d/i);
    expect(screen.getByRole('button', { name: /Investigating/ })).toBeDisabled();

    d.resolve(REPORT);
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
    run.mockResolvedValueOnce({ ...REPORT, investigation_id: 'INV-SECOND' });
    fireEvent.click(screen.getByRole('button', { name: 'Start fund investigation' }));
    await screen.findByText('Investigation INV-SECOND');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].account_id).toBe('ACC-M1');
  });
});

// ---------------------------------------------------------------- the staged report
describe('investigation stages', () => {
  it('guides through five stages in order, starting with what happened', async () => {
    await showReport();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs.map((t) => t?.replace(/^\d/, '').split(/What|Where|A plain|What to/)[0])).toEqual([
      'Overview',
      'Fund trail',
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
    expect(screen.getByTestId('branch-ending')).toHaveAttribute('data-kind', 'depth_limit');

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
    expect(groups.sort()).toEqual(['cycle', 'depth_limit', 'no_onward']);
    expect(screen.getByText(/A stop is not proof the money stayed, was lost or was recovered/)).toBeInTheDocument();
    expect(screen.getByText(REPORT.trace.truncation_notes[0])).toBeInTheDocument();
  });

  it('presents risk evidence by severity, with every finding and the template summary', async () => {
    await showReport();
    stage(/Risk evidence/);
    expect(screen.getByRole('region', { name: 'High severity' })).toBeInTheDocument();
    const m2a = screen.getByTestId('evidence-ACC-M2A');
    for (const part of ['What was detected', 'What it relates to', 'Evidence', 'Why it matters', 'What is not known']) expect(m2a).toHaveTextContent(part);
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toHaveTextContent(f.statement);
    expect(screen.getByText(/not by an AI model/)).toBeInTheDocument();
    for (const s of REPORT.evidence_summary) expect(screen.getAllByText(s.question).length).toBeGreaterThan(0);
    expect(screen.getByText(/A severity is a prompt for review, not proof of fraud/)).toBeInTheDocument();
  });

  it('reports a missing model instead of showing scores', async () => {
    await showReport({
      ...REPORT,
      model_available: false,
      model_unavailable_reason: 'The account risk model file is missing on the server.',
      model_review_threshold: null,
      accounts: REPORT.accounts.map((a) => ({ ...a, model_assessment: null, model_suggests_review: null, checks_disagree: null })),
    });
    stage(/Risk evidence/);
    expect(screen.getByText(/The account model did not run/)).toBeInTheDocument();
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
    run.mockResolvedValueOnce({ ...REPORT, investigation_id: 'INV-DEEPER' });
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
    expect(within(ai).queryByText(/AI-generated/)).toBeNull();
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
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();
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

  it('shows the report at once, keeps every stage usable while the AI writes, then shows the explanation', async () => {
    const d = deferred<InvestigationExplanationResponse>();
    explain.mockReturnValueOnce(d.promise);
    await showReport(DEFERRED);
    expect(run.mock.calls[0][0]).toMatchObject({ account_id: 'ACC-VIC', ai_explanation: 'separate' });
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
    stage(/AI analyst/);
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'stale'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('different version of this report');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('reports a failed explanation request without touching the report', async () => {
    explain.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await showReport(DEFERRED);
    stage(/AI analyst/);
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'failed'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('could not be reached for the AI explanation');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
    stage(/Risk evidence/);
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();
  });

  it('shows an unavailable explanation as unavailable', async () => {
    explain.mockResolvedValueOnce(answer({
      ai_analysis: { ...REPORT.ai_analysis, state: 'unavailable', status: 'failed', unavailable_reason: 'service_unavailable', report: null,
        message: 'The AI provider reported that it is temporarily overloaded or unavailable. The investigation results are unaffected.' },
    }));
    await showReport(DEFERRED);
    stage(/AI analyst/);
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
