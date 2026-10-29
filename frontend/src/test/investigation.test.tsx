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
  v2Api: { runInvestigation: vi.fn(), getModelsStatus: vi.fn(() => new Promise(() => {})) },
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

  it('says plainly that the AI analyst did not run', async () => {
    await showReport();
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveTextContent('AI analyst: not run');
    expect(ai).toHaveTextContent(REPORT.ai_analysis.message);
  });

  it('shows AI claims only when generated, with their references', async () => {
    await showReport({
      ...REPORT,
      ai_analysis: { status: 'generated', provider: 'test', message: 'AI-generated interpretation.', rejected_claims: 0,
        sections: [{ question: 'Q?', claims: [{ text: 'ACC-M1 forwarded funds.', kind: 'interpretation', refs: ['ACC-M1'] }] }] },
    });
    const ai = screen.getByTestId('ai-status');
    expect(ai).toHaveTextContent('AI analyst (test)');
    expect(within(ai).getByText('ACC-M1 forwarded funds.')).toBeInTheDocument();
    expect(within(ai).getByRole('button', { name: 'ACC-M1' })).toBeInTheDocument();
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
