import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CaseWorkspacePage } from '../pages/CaseWorkspacePage';
import { InvestigationsPage, nextActionFor } from '../pages/InvestigationsPage';
import { api, ApiError } from '../services/api';
import { v2Api, ApiError as V2ApiError } from '../services/v2Api';
import {
  ML,
  MODEL_STATUS,
  PROFILE,
  RULES,
  makeAssessments,
  makeAudit,
  makeCase,
  makeGraph,
  makeTrace,
} from './fixtures';

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
};

function renderCase(path = '/cases/FS-2001') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cases/:caseId" element={<CaseWorkspacePage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

function mockCaseApis(caseOver = {}) {
  vi.spyOn(api, 'getCase').mockResolvedValue(makeCase(caseOver));
  vi.spyOn(api, 'getCaseTrace').mockResolvedValue(makeTrace());
  vi.spyOn(api, 'getCaseGraph').mockResolvedValue(makeGraph());
  vi.spyOn(api, 'getCaseAccountAssessments').mockResolvedValue(makeAssessments());
  vi.spyOn(api, 'getCaseAuditTrail').mockResolvedValue(makeAudit());
  vi.spyOn(v2Api, 'getAccount').mockResolvedValue(PROFILE);
  vi.spyOn(v2Api, 'getAssessment').mockResolvedValue(RULES);
  vi.spyOn(v2Api, 'getMLAssessment').mockResolvedValue(ML);
  vi.spyOn(v2Api, 'getModelsStatus').mockResolvedValue(MODEL_STATUS);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('InvestigationsPage', () => {
  it('lists cases with amount, data source and a next action', async () => {
    vi.spyOn(api, 'getCases').mockResolvedValue({
      count: 2,
      total: 2,
      skip: 0,
      limit: 100,
      cases: [
        makeCase(),
        makeCase({
          case_id: 'FS-1042',
          reported_amount: 50000,
          account_dataset: 'case_ledger',
          investigation_status: 'under_investigation',
          description: 'Synthetic demo case: victim V001 reports a transfer.',
          review_progress: { accounts_in_case: 8, decisions_recorded: 2, last_decision_at: '2026-10-23T13:19:22' },
        }),
      ],
    });
    render(
      <MemoryRouter>
        <InvestigationsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/Loading cases/i)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Cases' });
    expect(within(list).getByText('FS-2001')).toBeInTheDocument();
    expect(within(list).getByText('Synthetic account ledger')).toBeInTheDocument();
    expect(within(list).getByText('Case records only')).toBeInTheDocument();
    expect(within(list).getByText(/Continue review · 2 decisions recorded/)).toBeInTheDocument();
    expect(within(list).getByText('Start: read the summary').closest('a')).toHaveAttribute('href', '/cases/FS-2001?section=summary');
  });

  it('filters by search text and shows a clear empty state', async () => {
    vi.spyOn(api, 'getCases').mockResolvedValue({ count: 1, total: 1, skip: 0, limit: 100, cases: [makeCase()] });
    render(
      <MemoryRouter>
        <InvestigationsPage />
      </MemoryRouter>
    );
    await screen.findByText('FS-2001');
    fireEvent.change(screen.getByPlaceholderText(/Search by case ID/i), { target: { value: 'nothing-matches' } });
    expect(screen.getByText('No cases match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('FS-2001')).toBeInTheDocument();
  });

  it('explains a server outage without inventing cases', async () => {
    vi.spyOn(api, 'getCases').mockRejectedValue(new ApiError('Network request failed', 'network_error'));
    render(
      <MemoryRouter>
        <InvestigationsPage />
      </MemoryRouter>
    );
    expect(await screen.findByText(/could not be reached/i)).toBeInTheDocument();
    expect(screen.queryByText('FS-2001')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('derives next actions from recorded decisions only', () => {
    expect(nextActionFor(makeCase()).section).toBe('summary');
    expect(nextActionFor(makeCase({ investigation_status: 'closed' })).label).toMatch(/history/);
  });
});

describe('CaseWorkspacePage', () => {
  it('summary separates the complaint from the recorded transfer and lists unknowns', async () => {
    mockCaseApis();
    renderCase();
    expect(await screen.findByRole('heading', { level: 1, name: 'FS-2001' })).toBeInTheDocument();
    expect(screen.getByText('The complaint says')).toBeInTheDocument();
    expect(screen.getByText('The transaction records show')).toBeInTheDocument();
    expect(screen.getByText(/Recorded amount matches the complaint/)).toBeInTheDocument();
    expect(screen.getByText(/It is\s+not the amount lost/)).toBeInTheDocument();
    expect(screen.getByText('Still unknown')).toBeInTheDocument();
    expect(screen.getByText(/3 accounts have no fund attribution/)).toBeInTheDocument();
  });

  it('keeps the case and selected account in the URL when moving between sections', async () => {
    mockCaseApis();
    renderCase('/cases/FS-2001?section=money-flow');
    await screen.findByRole('heading', { name: /Recorded transfers from the reporting customer/ });
    const sections = () => within(screen.getByRole('navigation', { name: 'Investigation sections' }));
    fireEvent.click(sections().getByRole('button', { name: /Accounts & risk/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cases/FS-2001?section=accounts'));
    fireEvent.click(screen.getByRole('button', { name: /ACC-000005/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('account=ACC-000005'));
    fireEvent.click(sections().getByRole('button', { name: /Review & history/ }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/cases/FS-2001?section=review&account=ACC-000005')
    );
    expect(screen.getByRole('combobox', { name: /Account/ })).toHaveValue('ACC-000005');
  });

  it('accounts section shows facts, the real model output and its limits for ledger-backed cases', async () => {
    mockCaseApis();
    renderCase('/cases/FS-2001?section=accounts&account=ACC-000003');
    expect(await screen.findByText('What the case records show')).toBeInTheDocument();
    expect(screen.getByText('8 min after receiving')).toBeInTheDocument();
    expect(screen.getByText('Rapid Outbound Forwarding Observed')).toBeInTheDocument();
    expect(await screen.findByText('10%')).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText(/The two checks disagree/)).toBeInTheDocument();
    expect(screen.getByText(/Largest transaction:/)).toBeInTheDocument();
    expect(screen.getAllByText('Raised score').length).toBeGreaterThan(0);
    expect(screen.getByText(/caught 33% of suspicious/)).toBeInTheDocument();
    expect(v2Api.getMLAssessment).toHaveBeenCalledWith('ACC-000003');
  });

  it('never calls the account model for case-only datasets', async () => {
    mockCaseApis({ case_id: 'FS-1042', account_dataset: 'case_ledger' });
    renderCase('/cases/FS-1042?section=accounts&account=ACC-000003');
    expect(await screen.findByText(/No automated account assessment for this case/)).toBeInTheDocument();
    expect(v2Api.getMLAssessment).not.toHaveBeenCalled();
  });

  it('shows the model-unavailable reason instead of a score', async () => {
    mockCaseApis();
    vi.mocked(v2Api.getMLAssessment).mockRejectedValue(
      new V2ApiError(503, 'model_unavailable', 'The account risk model file is missing on the server.')
    );
    renderCase('/cases/FS-2001?section=accounts&account=ACC-000003');
    expect(await screen.findByText(/model file is missing/)).toBeInTheDocument();
    expect(screen.queryByText('Why the model gave this score')).not.toBeInTheDocument();
  });

  it('records a decision only after confirmation and a real server response', async () => {
    mockCaseApis();
    let resolveSave: (v: any) => void = () => {};
    const update = vi.spyOn(api, 'updateAccountReview').mockReturnValue(new Promise((r) => (resolveSave = r)));
    renderCase('/cases/FS-2001?section=review&account=ACC-000003');
    await screen.findByText('Record a review decision');

    fireEvent.click(screen.getByRole('button', { name: /Review before saving/ }));
    expect(screen.getByText('Choose a decision.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Escalate for investigation/));
    fireEvent.change(screen.getByPlaceholderText(/What did you look at/), { target: { value: 'Forwarded 245,000 within ten minutes.' } });
    fireEvent.change(screen.getByPlaceholderText('Your name or reviewer ID'), { target: { value: 'analyst_1' } });
    fireEvent.click(screen.getByLabelText(/TXN-0062200/));
    fireEvent.click(screen.getByRole('button', { name: /Review before saving/ }));

    const confirm = screen.getByRole('region', { name: 'Confirm decision' });
    expect(within(confirm).getByText('Escalate for investigation')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: /Save decision/ }));
    expect(update).toHaveBeenCalledWith('FS-2001', 'ACC-000003', expect.objectContaining({
      review_state: 'under_investigation',
      reviewer_id: 'analyst_1',
      notes: 'Forwarded 245,000 within ten minutes.',
      supporting_transaction_ids: ['TXN-0062200'],
    }));
    // No success message until the server answers.
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
    resolveSave({ case_id: 'FS-2001', account_id: 'ACC-000003', review_state: 'under_investigation', evidence_quality: 'graph_connection_only', automated_action_taken: 'none' });
    expect(await screen.findByText(/The server recorded/)).toBeInTheDocument();
    await waitFor(() => expect(api.getCase).toHaveBeenCalledTimes(2));
  });

  it('shows the failure and no success message when saving fails', async () => {
    mockCaseApis();
    vi.spyOn(api, 'updateAccountReview').mockRejectedValue(new ApiError("Account 'ACC-000003' is not associated with Case 'FS-2001'.", 'account_not_in_case_scope'));
    renderCase('/cases/FS-2001?section=review&account=ACC-000003');
    await screen.findByText('Record a review decision');
    fireEvent.click(screen.getByLabelText(/Keep under review/));
    fireEvent.change(screen.getByPlaceholderText(/What did you look at/), { target: { value: 'Need bank statements first.' } });
    fireEvent.change(screen.getByPlaceholderText('Your name or reviewer ID'), { target: { value: 'analyst_1' } });
    fireEvent.click(screen.getByRole('button', { name: /Review before saving/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save decision/ }));
    expect(await screen.findByText('Decision not saved')).toBeInTheDocument();
    expect(screen.getByText(/is not associated with Case/)).toBeInTheDocument();
    expect(screen.queryByText(/The server recorded/)).not.toBeInTheDocument();
  });

  it('history shows recorded decisions, marks unverified identity and hides system noise by default', async () => {
    mockCaseApis();
    renderCase('/cases/FS-2001?section=review');
    expect(await screen.findByText('Review decision recorded')).toBeInTheDocument();
    expect(screen.getByText(/name typed by the reviewer, not verified/)).toBeInTheDocument();
    expect(screen.getByText('System (sample data loader)')).toBeInTheDocument();
    expect(screen.queryByText('Money flow recalculated')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Show 1 system calculation event/));
    expect(screen.getByText('Money flow recalculated')).toBeInTheDocument();
    expect(screen.getByText(/not cryptographically signed/)).toBeInTheDocument();
  });

  it('labels a recorded review of an account outside the case as a legacy record without hiding it', async () => {
    mockCaseApis();
    const audit = makeAudit();
    audit.events.push({
      event_id: 4,
      case_id: 'FS-2001',
      timestamp: '2026-10-23T19:37:45',
      action: 'account_review_recorded',
      performed_by: 'SecAnalyst01',
      entity_type: 'account_review',
      entity_id: 'FS-2001:A100',
      details: { account_id: 'A100', old_review_state: null, new_review_state: 'review_completed', notes: 'Old review' },
    });
    vi.mocked(api.getCaseAuditTrail).mockResolvedValue(audit);
    renderCase('/cases/FS-2001?section=review');
    expect(await screen.findByText(/Legacy record: A100 is not part of this case/)).toBeInTheDocument();
    expect(screen.getByText('Old review')).toBeInTheDocument();
    // Older events have no verification flag; that is stated, not guessed.
    expect(screen.getByText(/identity verification not recorded/)).toBeInTheDocument();
    // In-scope reviews are not flagged.
    expect(screen.queryByText(/Legacy record: ACC-000002/)).not.toBeInTheDocument();
  });

  it('shows a clear history error with retry', async () => {
    mockCaseApis();
    vi.mocked(api.getCaseAuditTrail).mockRejectedValue(new ApiError('Network request failed', 'network_error'));
    renderCase('/cases/FS-2001?section=review');
    expect(await screen.findByText('History unavailable')).toBeInTheDocument();
  });

  it('treats unknown or malformed case IDs as not found', async () => {
    vi.spyOn(api, 'getCase').mockRejectedValue(new ApiError("Case 'FS-9999' not found.", 'case_not_found'));
    renderCase('/cases/FS-9999');
    expect(await screen.findByText('Case FS-9999 was not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All investigations/ })).toHaveAttribute('href', '/cases');
  });

  it('warns when the URL names an account outside the case', async () => {
    mockCaseApis();
    renderCase('/cases/FS-2001?section=accounts&account=A100');
    expect(await screen.findByText(/Account A100 is not part of this case/)).toBeInTheDocument();
  });
});
