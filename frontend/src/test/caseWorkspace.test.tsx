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
    const modelCard = await screen.findByTestId('model-score-card');
    const ruleCard = screen.getByTestId('rule-score-card');
    // Model output is labelled as a score with its version and the served threshold, not as a probability.
    expect(within(modelCard).getByText(/Model score/)).toBeInTheDocument();
    expect(within(modelCard).getByText('v2-account-2.0.0')).toBeInTheDocument();
    expect(within(modelCard).getByText('10.1%')).toBeInTheDocument();
    expect(within(modelCard).getByText('Below the 17.5% review threshold. This does not clear the account.')).toBeInTheDocument();
    expect(within(modelCard).getByText(/not a verified probability of fraud or proof of criminal activity/)).toBeInTheDocument();
    expect(within(modelCard).queryByText(/probability of/i, { selector: 'span' })).toBeNull();
    // Rules are points, reported separately, with their own review point.
    expect(within(ruleCard).getByText('60')).toBeInTheDocument();
    expect(within(ruleCard).getByText('points of 100')).toBeInTheDocument();
    expect(within(ruleCard).getByText('Suggests review')).toBeInTheDocument();
    // Disagreement is about review suggestions, never a subtraction of incompatible scales.
    const comparison = screen.getByTestId('checks-comparison');
    expect(comparison).toHaveTextContent('The rules suggest review but the model does not');
    expect(comparison).toHaveTextContent('should not be compared directly');
    expect(screen.queryByText(/points\. Neither/)).toBeNull();
    expect(screen.getByText(/Largest transaction:/)).toBeInTheDocument();
    expect(screen.getAllByText('Raised score').length).toBeGreaterThan(0);
    // Limits sit next to the score and come from the served metadata.
    const limits = screen.getByTestId('model-limits');
    expect(limits).toHaveTextContent('found about half of suspicious accounts, and about 1 in 3 of the accounts it flagged were suspicious');
    expect(limits).toHaveTextContent('A high score does not show intent; a low score does not show innocence.');
    fireEvent.click(within(limits).getByText('How was this measured?'));
    expect(limits).toHaveTextContent('260 suspicious and 3,919 ordinary');
    expect(limits).toHaveTextContent('At the 17.5% review threshold: found 53% of suspicious accounts (recall); 33% of flags were suspicious (precision)');
    expect(limits).toHaveTextContent('flags about 5% of ordinary accounts');
    expect(limits).toHaveTextContent('do not show how the model would perform on real bank accounts');
    expect(v2Api.getMLAssessment).toHaveBeenCalledWith('ACC-000003');
  });

  it('states "suggested for review, not confirmed fraud" when the score meets the served threshold', async () => {
    mockCaseApis();
    vi.mocked(v2Api.getMLAssessment).mockResolvedValue({
      ...ML,
      risk_score: 71.3,
      risk_level: 'high',
      predicted_probability: 0.713,
      predicted_class: 'suspicious',
      model_version: 'v2-account-2.0.0',
    });
    renderCase('/cases/FS-2001?section=accounts&account=ACC-000003');
    const modelCard = await screen.findByTestId('model-score-card');
    expect(within(modelCard).getByText('71.3%')).toBeInTheDocument();
    expect(within(modelCard).getByText('v2-account-2.0.0')).toBeInTheDocument();
    expect(
      within(modelCard).getByText('At or above the 17.5% review threshold: suggested for review, not confirmed fraud.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('checks-comparison')).toHaveTextContent('Both checks suggest review. Agreement is not proof');
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
    // No fallback score and no review suggestion are invented; the rule result is still shown separately.
    const modelCard = screen.getByTestId('model-score-card');
    expect(within(modelCard).queryByText(/\d+%/)).toBeNull();
    expect(within(modelCard).queryByText(/review threshold/)).toBeNull();
    expect(within(screen.getByTestId('rule-score-card')).getByText('60')).toBeInTheDocument();
    expect(screen.queryByTestId('checks-comparison')).toBeNull();
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

  it('never shows a typed reviewer name as verified, even when the request used the API key', async () => {
    mockCaseApis();
    const audit = makeAudit();
    audit.events.push(
      {
        event_id: 5, case_id: 'FS-2001', timestamp: '2026-10-29T11:00:00', action: 'account_review_recorded',
        performed_by: 'key_holder', entity_type: 'account_review', entity_id: 'FS-2001:ACC-000005',
        details: { account_id: 'ACC-000005', new_review_state: 'under_review', reviewer_name_source: 'self_reported',
                   reviewer_identity_verified: false, request_authenticated: true, auth_method: 'api_key' },
      },
      {
        event_id: 6, case_id: 'FS-2001', timestamp: '2026-10-20T11:00:00', action: 'account_review_recorded',
        performed_by: 'legacy_key_holder', entity_type: 'account_review', entity_id: 'FS-2001:ACC-000005',
        details: { account_id: 'ACC-000005', new_review_state: 'under_review', reviewer_identity_verified: true },
      }
    );
    vi.mocked(api.getCaseAuditTrail).mockResolvedValue(audit);
    renderCase('/cases/FS-2001?section=review');
    await screen.findByText('key_holder');
    expect(screen.getAllByText(/request authorised with the server’s API key/).length).toBe(2);
    expect(screen.queryByText(/identity verified/i)).toBeNull();
    expect(screen.getAllByText(/name typed by the reviewer, not verified/).length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['open_local_development', /local server with no API key.*Reviewer names are typed, not verified/],
    ['api_key_required', /requires an API key for changes\. This browser app does not send one/],
    ['disabled_no_key_configured', /Changes are disabled on this server/],
  ] as const)('tells the reviewer how writes are protected (%s)', async (mode, text) => {
    mockCaseApis();
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', service: 's', phase: 'p', write_access: mode });
    renderCase('/cases/FS-2001?section=review');
    expect(await screen.findByTestId('write-access-notice')).toHaveTextContent(text);
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
