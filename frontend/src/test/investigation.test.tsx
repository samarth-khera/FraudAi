import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '../App';
import { InvestigatePage } from '../pages/InvestigatePage';
import { toRequest, DEFAULT_FORM } from '../components/investigation/formModel';
import { v2Api } from '../services/v2Api';
import { InvestigationResponse } from '../types/investigation';
import fixture from './fixtures/investigation.json';

// Cytoscape needs a real canvas; the graph is covered by the live browser check.
vi.mock('../components/investigation/InvestigationGraph', () => ({
  default: ({ onSelect }: { onSelect: (s: { type: string; id: string }) => void }) => (
    <button type="button" data-testid="investigation-graph" onClick={() => onSelect({ type: 'account', id: 'ACC-M1' })}>
      graph
    </button>
  ),
}));

vi.mock('../services/v2Api', () => ({
  v2Api: { runInvestigation: vi.fn(), explainInvestigation: vi.fn(), getModelsStatus: vi.fn(() => new Promise(() => {})) },
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

function submit(id: string) {
  fireEvent.change(screen.getByLabelText('Victim account ID'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: /Start Investigation/ }));
}

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
});

describe('form validation', () => {
  it('normalises short IDs and enforces the API limits', () => {
    expect(toRequest({ ...DEFAULT_FORM, accountId: ' 1 ' })).toMatchObject({ request: { account_id: 'ACC-000001', max_depth: 3, max_nodes: 200 } });
    expect(toRequest({ ...DEFAULT_FORM, accountId: '' })).toEqual({ error: 'Enter the account ID to investigate.' });
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC 1; DROP' })).toBe(true);
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC-1', startDate: '2026-03-01', endDate: '2026-02-01' })).toBe(true);
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC-1', maxDepth: 9 })).toBe(true);
    expect('error' in toRequest({ ...DEFAULT_FORM, accountId: 'ACC-1', maxNodes: 1 })).toBe(true);
  });

  it('shows the validation error and does not call the server', () => {
    renderPage();
    submit('');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the account ID');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('input-first investigation flow', () => {
  it('shows no result and makes no request before the user starts', () => {
    renderPage();
    expect(screen.queryByTestId('investigation-report')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('a shared link only prefills the form; it never runs on its own', () => {
    renderPage('/investigate?account=ACC-VIC&depth=4');
    expect(screen.getByLabelText('Victim account ID')).toHaveValue('ACC-VIC');
    expect(screen.getByText(/Reports are not stored/)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('shows an honest loading state, then the report, and records the settings in the URL', async () => {
    const d = deferred<InvestigationResponse>();
    run.mockReturnValueOnce(d.promise);
    renderPage();
    submit('acc-vic');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'ACC-VIC', trace_scope: 'flagged' }), expect.any(AbortSignal));
    const status = screen.getByTestId('investigation-running');
    expect(status).toHaveTextContent('Investigating ACC-VIC');
    expect(status.textContent).not.toMatch(/%|step \d/i);
    expect(screen.getByRole('button', { name: /Investigating/ })).toBeDisabled();
    expect(screen.queryByTestId('investigation-report')).toBeNull();

    d.resolve(REPORT);
    await screen.findByTestId('investigation-report');
    expect(screen.getByTestId('location')).toHaveTextContent('/investigate?account=ACC-VIC');
  });

  it('a new account triggers a completely fresh request', async () => {
    run.mockResolvedValueOnce(REPORT);
    renderPage();
    submit('ACC-VIC');
    await screen.findByTestId('investigation-report');
    fireEvent.click(screen.getByRole('button', { name: /New investigation/ }));
    expect(screen.queryByTestId('investigation-report')).toBeNull();
    expect(screen.getByLabelText('Victim account ID')).toHaveValue('');
    run.mockResolvedValueOnce({ ...REPORT, investigation_id: 'INV-SECOND' });
    submit('ACC-M1');
    await screen.findByText('Investigation INV-SECOND');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].account_id).toBe('ACC-M1');
  });

  it.each([
    [Object.assign(new Error("Account 'ACC-X' is not in the configured ledger."), { status: 404, code: 'account_not_found' }), 'Account not found', "'ACC-X' is not in the configured ledger"],
    [new TypeError('Failed to fetch'), 'The server could not be reached', 'No investigation was run'],
    [Object.assign(new Error('The configured ledger has 0 accounts'), { status: 503, code: 'ledger_empty' }), 'The transaction ledger is not available', '0 accounts'],
    [Object.assign(new Error('x'), { status: 500, code: 'investigation_failed' }), 'The investigation failed', 'x'],
  ])('reports errors without showing a report (%#)', async (err, title, text) => {
    run.mockRejectedValueOnce(err);
    renderPage();
    submit('ACC-X');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(text);
    expect(screen.queryByTestId('investigation-report')).toBeNull();
  });
});

describe('findings report', () => {
  async function showReport(report: InvestigationResponse = REPORT) {
    run.mockResolvedValueOnce(report);
    renderPage();
    submit('ACC-VIC');
    return screen.findByTestId('investigation-report');
  }

  it('labels synthetic data throughout and shows source freshness', async () => {
    await showReport();
    expect(screen.getByRole('note')).toHaveTextContent('Synthetic demo data');
    expect(screen.getAllByText('Synthetic demo data').length).toBeGreaterThanOrEqual(7);
    const src = screen.getByTestId('data-source');
    expect(src).toHaveTextContent(REPORT.data_source.source_name);
    expect(src).toHaveTextContent('Real bank data: No');
    expect(src).toHaveTextContent(REPORT.data_source.freshness_note);
  });

  it('drops the synthetic banner only when the source is not synthetic', async () => {
    await showReport({
      ...REPORT,
      data_source: { ...REPORT.data_source, is_synthetic: false, real_bank_data: true, authorization_reference: 'DSA-7', disclosure: 'Institution records.' },
    });
    expect(screen.queryByText('Synthetic demo data')).toBeNull();
    expect(screen.getByTestId('data-source')).toHaveTextContent('Yes (authorization DSA-7)');
  });

  it('renders flagged transfers, every finding with its kind, and the template summary', async () => {
    await showReport();
    const drain = REPORT.victim.flagged_transfers[0];
    expect(screen.getAllByRole('button', { name: drain.transaction_id }).length).toBeGreaterThan(0);
    expect(screen.getByText('Drained balance')).toBeInTheDocument();
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toHaveTextContent(f.statement);
    expect(screen.getByText(/not by an AI model/)).toBeInTheDocument();
    for (const s of REPORT.evidence_summary) expect(screen.getAllByText(s.question).length).toBeGreaterThan(0);
  });

  it('says plainly when the AI analyst is turned off', async () => {
    await showReport();
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
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveTextContent(title);
    expect(ai).toHaveTextContent(message);
    expect(within(ai).queryByText(/AI-generated/)).toBeNull();
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();
    expect(screen.getByText(/not by an AI model/)).toBeInTheDocument();
  });

  it('renders a completed Gemini report, labelled as AI-generated, with clickable evidence', async () => {
    const drain = REPORT.victim.flagged_transfers[0].transaction_id;
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
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveAttribute('data-state', 'completed');
    expect(within(ai).getByText('AI-generated · gemini-3.8-flash')).toBeInTheDocument();
    expect(ai).toHaveTextContent('ACC-VIC made one unusual transfer');
    expect(within(ai).getByText('Cites ledger record')).toBeInTheDocument();
    expect(within(ai).getByText('Hypothesis')).toBeInTheDocument();
    expect(ai).toHaveTextContent('Balances mix funds.');
    expect(ai).toHaveTextContent('Confirm authorisation with the holder.');
    expect(ai).toHaveTextContent('Evidence completeness: No device or login records are available.');
    expect(ai).toHaveTextContent(/not from this text/);
    fireEvent.click(within(ai).getAllByRole('button', { name: drain })[0]);
    expect(document.getElementById('selection-detail')).toHaveTextContent(drain);
    expect(within(ai).getByRole('link', { name: 'F-001' })).toHaveAttribute('href', '#finding-F-001');
    // The template summary stays separate and labelled as not AI.
    expect(screen.getByText(/not by an AI model/)).toBeInTheDocument();
  });

  it('still shows legacy AI sections from an older server without `state`', async () => {
    const { state: _s, report: _r, ...legacy } = REPORT.ai_analysis;
    await showReport({
      ...REPORT,
      ai_analysis: { ...legacy, status: 'generated', provider: 'test', message: 'Older server.',
        sections: [{ question: 'Q?', claims: [{ text: 'ACC-M1 forwarded funds.', kind: 'interpretation', refs: ['ACC-M1'] }] }] },
    });
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveAttribute('data-state', 'completed');
    expect(within(ai).getByText('ACC-M1 forwarded funds.')).toBeInTheDocument();
  });

  it('clicking a transfer shows its ledger evidence; clicking an account shows its own assessment', async () => {
    await showReport();
    const edge = REPORT.trace.edges.find((e) => e.parent_transaction_id)!;
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`${edge.origin_account_id} → ${edge.destination_account_id}`) })[0]);
    const detail = document.getElementById('selection-detail')!;
    expect(detail).toHaveTextContent(edge.transaction_id);
    expect(detail).toHaveTextContent('Followed from');
    expect(detail).toHaveTextContent(edge.parent_transaction_id!);

    fireEvent.click(screen.getByTestId('investigation-graph'));
    const m1 = REPORT.accounts.find((a) => a.account_id === 'ACC-M1')!;
    expect(detail).toHaveTextContent('Possible intermediary');
    expect(detail).toHaveTextContent(m1.role_basis[0]);
    expect(detail).toHaveTextContent('Could instead be');
  });

  it('reports a missing model instead of showing scores', async () => {
    await showReport({
      ...REPORT,
      model_available: false,
      model_unavailable_reason: 'The account risk model file is missing on the server.',
      model_review_threshold: null,
      accounts: REPORT.accounts.map((a) => ({ ...a, model_assessment: null, model_suggests_review: null, checks_disagree: null })),
    });
    expect(screen.getByText(/The account model did not run/)).toBeInTheDocument();
    expect(screen.queryByText(/Model review threshold/)).toBeNull();
  });

  it('keeps recommendations advisory', async () => {
    await showReport();
    expect(screen.getByText(/Nothing has been frozen, blocked or flagged/)).toBeInTheDocument();
    for (const r of REPORT.recommendations) expect(screen.getAllByText(r.statement).length).toBeGreaterThan(0);
  });
});

describe('routing', () => {
  it('serves the investigation page and lists it in the navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/investigate?account=ACC-000001']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Victim account ID')).toHaveValue('ACC-000001');
    expect(screen.getAllByRole('link', { name: 'Investigate' })[0]).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(run).not.toHaveBeenCalled());
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

  async function startDeferred() {
    run.mockResolvedValueOnce(DEFERRED);
    renderPage();
    submit('ACC-VIC');
    await screen.findByTestId('investigation-report');
  }

  it('shows the report at once, then the explanation for the same report', async () => {
    const d = deferred<import('../types/investigation').InvestigationExplanationResponse>();
    explain.mockReturnValueOnce(d.promise);
    await startDeferred();
    expect(run.mock.calls[0][0]).toMatchObject({ account_id: 'ACC-VIC', ai_explanation: 'separate' });
    expect(explain).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'ACC-VIC', ai_explanation: 'separate' }), expect.any(AbortSignal));
    const pending = screen.getByTestId('ai-status');
    expect(pending).toHaveAttribute('data-state', 'pending');
    expect(pending).toHaveTextContent('writing the explanation');
    expect(pending.textContent).not.toMatch(/%/);
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();

    d.resolve({ account_id: 'ACC-VIC', report_digest: REPORT.report_digest!, data_as_of: null, duration_ms: 1, ai_analysis: COMPLETED });
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'completed'));
    expect(screen.getByText('AI-generated · gemini-3.8-flash')).toBeInTheDocument();
    expect(screen.getByTestId('ai-status')).toHaveTextContent('ACC-VIC made one unusual transfer.');
  });

  it('does not show an explanation of a different report', async () => {
    explain.mockResolvedValueOnce({ account_id: 'ACC-VIC', report_digest: 'something-else', data_as_of: null, duration_ms: 1, ai_analysis: COMPLETED });
    await startDeferred();
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'stale'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('different version of this report');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('reports a failed explanation request without touching the report', async () => {
    explain.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await startDeferred();
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'failed'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('could not be reached for the AI explanation');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
    for (const f of REPORT.findings) expect(document.getElementById(`finding-${f.finding_id}`)).toBeInTheDocument();
  });

  it('shows an unavailable explanation as unavailable', async () => {
    explain.mockResolvedValueOnce({ account_id: 'ACC-VIC', report_digest: REPORT.report_digest!, data_as_of: null, duration_ms: 1,
      ai_analysis: { ...REPORT.ai_analysis, state: 'unavailable', status: 'failed', unavailable_reason: 'timeout', report: null,
        message: 'The AI provider did not answer within the time limit. The investigation results are unaffected.' } });
    await startDeferred();
    await waitFor(() => expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'unavailable'));
    expect(screen.getByTestId('ai-status')).toHaveTextContent('did not answer within the time limit');
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('abandons a pending explanation when a new investigation starts', async () => {
    let signal: AbortSignal | undefined;
    explain.mockImplementationOnce((_b, s) => { signal = s; return new Promise(() => {}); });
    await startDeferred();
    fireEvent.click(screen.getByRole('button', { name: /New investigation/ }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('investigation-report')).toBeNull();
  });

  it('does not request an explanation when the report already carries one', async () => {
    run.mockResolvedValueOnce(REPORT);
    renderPage();
    submit('ACC-VIC');
    await screen.findByTestId('investigation-report');
    expect(explain).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'disabled');
  });
});
