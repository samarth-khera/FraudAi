import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GuidedInvestigationPage } from '../pages/GuidedInvestigationPage';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';

// Mock api services
vi.mock('../services/api', () => ({
  api: {
    getCase: vi.fn(),
    getCaseTrace: vi.fn(),
    updateAccountReview: vi.fn(),
    getGlobalAudit: vi.fn(),
  },
}));

vi.mock('../services/v2Api', () => ({
  v2Api: {
    getModelsStatus: vi.fn().mockResolvedValue({ inference_ready: true }),
    getAccount: vi.fn(),
    runLiveAnalysis: vi.fn(),
  },
}));

const mockCase = {
  case_id: 'FS-1042',
  reported_origin_transaction_id: 'T001',
  reported_amount: 50000.0,
  currency: 'INR',
  reported_at: '2026-01-12T10:35:00',
  investigation_status: 'under_investigation',
  description: 'Synthetic demo case: victim V001 reports a 50,000 INR UPI transfer to A100 as fraudulent.',
};

const mockTrace = {
  case_id: 'FS-1042',
  linked_accounts: [
    { account_id: 'V001', role: 'victim', hop_count: 0, exposure: { observed_outbound_value: 50000.0 } },
    { account_id: 'A100', role: 'conduit', hop_count: 1, exposure: { observed_inbound_value: 50000.0 } },
    { account_id: 'B200', role: 'splitter', hop_count: 2, exposure: { observed_inbound_value: 50000.0 } },
  ],
  traced_transactions: [
    { transaction_id: 'T001', sender_account_id: 'V001', receiver_account_id: 'A100', amount: 50000.0, transaction_type: 'UPI' },
  ],
  paths: [],
};

const mockAnalysis = {
  analysis_id: 'RUN-DEMO-01',
  account_id: 'ACC-000001',
  rule_assessment: {
    risk_score: 25.0,
    risk_level: 'low',
    signals: { max_amount: 250000.0 },
    reason_codes: ['UNUSUAL_AMOUNT_SPIKE'],
  },
  ml_assessment: {
    risk_score: 76.5,
    risk_level: 'high',
    predicted_class: 'suspicious',
    top_contributions: [
      { feature_name: 'max_amount', feature_value: 250000.0, contribution_score: 3.91, impact_direction: 'increases_risk' },
    ],
  },
  divergence: {
    divergence_detected: true,
    ml_score: 76.5,
    rule_score: 25.0,
    score_delta: 51.5,
    interpretation: 'Compromised Victim / Outlier Drain Disparity',
  },
};

const mockAudit = {
  total_count: 1,
  filtered_count: 1,
  events: [
    {
      event_id: 1054,
      case_id: 'FS-1042',
      timestamp: '2026-10-23T16:50:00Z',
      action: 'account_review_recorded',
      performed_by: 'guided_investigator',
      details: { verdict: 'compromised_victim', notes: 'Victim drain' },
    },
  ],
  summary: {
    total_events: 1,
    review_decisions_count: 1,
    case_status_changes_count: 0,
    trace_events_count: 0,
    most_recent_timestamp: '2026-10-23T16:50:00Z',
    earliest_timestamp: '2026-10-23T16:50:00Z',
    distinct_cases_count: 1,
    distinct_actors_count: 1,
  },
  integrity_status: {
    storage_backend: 'SQLite Relational (audit_events)',
    append_only_enforced: true,
    cryptographic_signatures: false,
    server_timestamps: true,
    last_verified_at: '2026-10-23T16:50:00Z',
    integrity_disclosure: 'Application-enforced append-only audit trail in SQLite.',
  },
};

describe('GuidedInvestigationPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getCase as any).mockResolvedValue(mockCase);
    (api.getCaseTrace as any).mockResolvedValue(mockTrace);
    (v2Api.runLiveAnalysis as any).mockResolvedValue(mockAnalysis);
    (api.getGlobalAudit as any).mockResolvedValue(mockAudit);
    (api.updateAccountReview as any).mockResolvedValue({
      review_state: 'review_completed',
      evidence_quality: 'verified_forensic',
      notes: 'Test note',
      reviewer_id: 'guided_investigator',
    });
  });

  it('renders step 1 by default with case intake information and question', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Interactive Guided Investigation')).toBeInTheDocument();
    expect(screen.getAllByText(/Step 1 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('What happened?')).toBeInTheDocument();
    expect(screen.getAllByText('Understand the Case').length).toBeGreaterThan(0);
    expect(screen.getByText(/₹50,000.00/i)).toBeInTheDocument();
    expect(screen.getByText(/UPI · T001/i)).toBeInTheDocument();
    expect(screen.getByText(/Why does this step matter/i)).toBeInTheDocument();
  });

  it('navigates to step 2 (Follow the Money) and renders fund flow topology', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    const proceedBtn = screen.getByText(/Proceed to Step 2: Follow the Money/i);
    fireEvent.click(proceedBtn);

    expect(screen.getAllByText(/Step 2 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Where did the money go?')).toBeInTheDocument();
    expect(screen.getAllByText('Follow the Money').length).toBeGreaterThan(0);
    expect(screen.getByText(/Multi-Hop Fund Dispersion Topology/i)).toBeInTheDocument();
    expect(screen.getByText('V001')).toBeInTheDocument();
    expect(screen.getByText('A100')).toBeInTheDocument();
    expect(screen.getByText('B200')).toBeInTheDocument();
  });

  it('navigates to step 3 (Understand Account Risk) and renders ledger facts', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation?step=3']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Step 3 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Which accounts need closer investigation, and why?')).toBeInTheDocument();
    expect(screen.getAllByText('Understand Account Risk').length).toBeGreaterThan(0);
    expect(screen.getByText(/Account 360° Profile: ACC-000001/i)).toBeInTheDocument();
    expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    expect(screen.getByText('₹177,156.23')).toBeInTheDocument();
  });

  it('navigates to step 4 (Understand the AI) and renders divergence alert and SHAP', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation?step=4']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Step 4 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Why did the model flag this account?')).toBeInTheDocument();
    expect(screen.getAllByText('Understand the AI').length).toBeGreaterThan(0);
    expect(screen.getByText(/Model-Rule Divergence Detected/i)).toBeInTheDocument();
    expect(screen.getAllByText(/TreeSHAP Feature Contributions/i).length).toBeGreaterThan(0);
    expect(screen.getByText('max_amount')).toBeInTheDocument();
  });

  it('navigates to step 5 (Review the Evidence) and commits human review via API', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation?step=5']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Step 5 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('What should the investigator review or decide?')).toBeInTheDocument();
    expect(screen.getAllByText('Review the Evidence').length).toBeGreaterThan(0);
    expect(screen.getByText('Compromised Victim')).toBeInTheDocument();

    const saveBtn = screen.getByText(/Commit Review Decision/i);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.updateAccountReview).toHaveBeenCalledWith(
        'FS-1042',
        'ACC-000001',
        expect.objectContaining({
          review_state: 'review_completed',
          reviewer_id: 'guided_investigator',
        })
      );
    });

    expect(await screen.findByText(/Review Successfully Saved/i)).toBeInTheDocument();
  });

  it('navigates to step 6 (Verify Recorded History) and renders audit records and integrity status', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation?step=6']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Step 6 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('What decision was recorded?')).toBeInTheDocument();
    expect(screen.getAllByText('Verify Recorded History').length).toBeGreaterThan(0);
    expect(screen.getByText(/Recorded Audit History for Case FS-1042/i)).toBeInTheDocument();
    expect(screen.getByText(/Storage: SQLite audit_events/i)).toBeInTheDocument();
    expect(screen.getByText(/Guided Investigation Complete!/i)).toBeInTheDocument();
  });

  it('allows stepping backwards with Previous Step button', async () => {
    render(
      <MemoryRouter initialEntries={['/guided-investigation?step=2']}>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Step 2 of 6/i).length).toBeGreaterThan(0);
    const prevBtn = screen.getByText('Previous Step');
    fireEvent.click(prevBtn);

    expect(screen.getAllByText(/Step 1 of 6/i).length).toBeGreaterThan(0);
    expect(screen.getByText('What happened?')).toBeInTheDocument();
  });
});
