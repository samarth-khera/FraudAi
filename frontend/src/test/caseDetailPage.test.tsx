import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CaseDetailPage } from '../pages/CaseDetailPage';
import { api } from '../services/api';

const mockCase = {
  case_id: 'FS-1042',
  reported_origin_transaction_id: 'T001',
  reported_amount: 50000.0,
  currency: 'INR',
  reported_at: '2026-01-12T10:35:00',
  investigation_status: 'under_investigation',
  description: 'Synthetic demo case: victim V001 reports a 50,000 INR UPI transfer to A100 as fraudulent.',
};

const mockGraph = {
  nodes: [
    {
      id: 'V001',
      label: 'Victim V001',
      role: 'reporting_victim' as const,
      is_synthetic: true,
      hop_count: 0,
      connection_type: 'direct_hop' as const,
      review_state: 'reporting_victim' as const,
      evidence_quality: 'corroborated' as const,
      attributed_unforwarded_amount: 0.0,
      attribution_status: 'explicit' as const,
    },
    {
      id: 'A100',
      label: 'Receiver A100',
      role: 'reported_initial_receiver' as const,
      is_synthetic: true,
      hop_count: 0,
      connection_type: 'direct_hop' as const,
      review_state: 'under_investigation' as const,
      evidence_quality: 'synthetic_assumption' as const,
      attributed_unforwarded_amount: 0.0,
      attribution_status: 'explicit' as const,
    },
    {
      id: 'B200',
      label: 'Hop 1 B200',
      role: 'intermediate_recipient' as const,
      is_synthetic: true,
      hop_count: 1,
      connection_type: 'direct_hop' as const,
      review_state: 'under_review' as const,
      evidence_quality: 'synthetic_assumption' as const,
      attributed_unforwarded_amount: 0.0,
      attribution_status: 'explicit' as const,
    },
    {
      id: 'C300',
      label: 'Merchant C300',
      role: 'downstream_recipient' as const,
      is_synthetic: true,
      hop_count: 2,
      connection_type: 'indirect_hop' as const,
      review_state: 'under_review' as const,
      evidence_quality: 'synthetic_assumption' as const,
      attributed_unforwarded_amount: 30000.0,
      attribution_status: 'explicit' as const,
    },
  ],
  edges: [
    {
      id: 'T001',
      source: 'V001',
      target: 'A100',
      amount: 50000,
      currency: 'INR',
      transaction_type: 'UPI',
      timestamp: '2026-01-12T10:22:00',
      hop_count: 0,
      attributed_amount: 50000,
      is_cycle_closing: false,
    },
    {
      id: 'T002',
      source: 'A100',
      target: 'B200',
      amount: 50000,
      currency: 'INR',
      transaction_type: 'IMPS',
      timestamp: '2026-01-12T10:25:00',
      hop_count: 1,
      attributed_amount: 50000,
      is_cycle_closing: false,
    },
    {
      id: 'T003',
      source: 'B200',
      target: 'C300',
      amount: 30000,
      currency: 'INR',
      transaction_type: 'UPI',
      timestamp: '2026-01-12T10:30:00',
      hop_count: 2,
      attributed_amount: 30000,
      is_cycle_closing: false,
    },
  ],
  meta: { node_count: 4, edge_count: 3 },
};

const mockTrace = {
  case_id: 'FS-1042',
  origin_transaction: {
    transaction_id: 'T001',
    timestamp: '2026-01-12T10:22:00',
    sender_account_id: 'V001',
    receiver_account_id: 'A100',
    amount: 50000,
    currency: 'INR',
    transaction_type: 'UPI',
    hop_count: 0,
    attributed_amount: 50000,
    attribution_basis: 'origin_report',
    is_cycle_closing: false,
  },
  linked_accounts: [
    {
      account_id: 'A100',
      hop_count: 1,
      exposure: {
        observed_inbound_value: 50000,
        observed_outbound_value: 50000,
        attributed_unforwarded_amount: 0,
      },
      review: {
        review_state: 'under_investigation' as const,
        evidence_quality: 'synthetic_assumption' as const,
        notes: 'Initial receiver',
      },
    },
    {
      account_id: 'B200',
      hop_count: 2,
      exposure: {
        observed_inbound_value: 50000,
        observed_outbound_value: 50000,
        attributed_unforwarded_amount: 0,
      },
      review: {
        review_state: 'under_review' as const,
        evidence_quality: 'synthetic_assumption' as const,
        notes: 'Pass through',
      },
    },
    {
      account_id: 'C300',
      hop_count: 3,
      exposure: {
        observed_inbound_value: 30000,
        observed_outbound_value: 0,
        attributed_unforwarded_amount: 30000,
      },
      review: {
        review_state: 'under_review' as const,
        evidence_quality: 'synthetic_assumption' as const,
        notes: 'Awaiting invoice',
      },
    },
  ],
  paths: [],
  summary: {
    total_hops: 2,
    traceable_amount: 50000,
    unforwarded_exposure: 30000,
    cycles_detected: false,
  },
  warnings: [],
};

const mockTransactions = {
  case_id: 'FS-1042',
  count: 3,
  transactions: [
    {
      transaction_id: 'T001',
      id: 'T001',
      sender_account_id: 'V001',
      receiver_account_id: 'A100',
      amount: 50000,
      currency: 'INR',
      transaction_type: 'UPI',
      timestamp: '2026-01-12T10:22:00',
      hop_count: 0,
      attributed_amount: 50000,
      is_cycle_closing: false,
    },
    {
      transaction_id: 'T002',
      id: 'T002',
      sender_account_id: 'A100',
      receiver_account_id: 'B200',
      amount: 50000,
      currency: 'INR',
      transaction_type: 'IMPS',
      timestamp: '2026-01-12T10:25:00',
      hop_count: 1,
      attributed_amount: 50000,
      is_cycle_closing: false,
    },
    {
      transaction_id: 'T003',
      id: 'T003',
      sender_account_id: 'B200',
      receiver_account_id: 'C300',
      amount: 30000,
      currency: 'INR',
      transaction_type: 'UPI',
      timestamp: '2026-01-12T10:30:00',
      hop_count: 2,
      attributed_amount: 30000,
      is_cycle_closing: false,
    },
  ],
  warnings: [],
};

const mockAudit = {
  case_id: 'FS-1042',
  count: 2,
  events: [
    {
      event_id: 'EV-001',
      timestamp: '2026-01-12T10:35:00',
      action: 'case_created',
      performed_by: 'system_seeder',
      entity_type: 'case',
      entity_id: 'FS-1042',
      details: { reported_amount: 50000 },
    },
    {
      event_id: 'EV-002',
      timestamp: '2026-01-12T10:45:00',
      action: 'account_review_updated',
      performed_by: 'lead_investigator_raj',
      entity_type: 'account',
      entity_id: 'FS-1042:C300',
      details: { review_state: 'under_review' },
    },
  ],
};

const mockAccountAssessment = {
  case_id: 'FS-1042',
  account_id: 'C300',
  graph_position: {
    account_id: 'C300',
    label: 'Merchant C300',
    role: 'downstream_recipient' as const,
    is_synthetic: true,
    in_traced_network: true,
    connection_type: 'indirect_hop' as const,
    hop_count: 2,
    upstream_account_ids: ['B200'],
    downstream_account_ids: [],
    path_ids: ['P1'],
  },
  observed_movement: {
    observed_inbound_value: 30000,
    observed_outbound_value: 0,
    traced_inbound_count: 1,
    traced_outbound_count: 0,
    traced_inbound_transactions: [mockGraph.edges[2]],
    traced_outbound_transactions: [],
    other_observed_inbound_count: 0,
    other_observed_outbound_count: 0,
    movement_note: 'Gross observed transfers across all case legs.',
  },
  traceable_exposure: {
    reported_case_amount: 50000,
    case_traceable_amount: 50000,
    gross_network_observed_value: 130000,
    attributed_inbound_amount: 30000,
    attributed_outbound_amount: 0,
    attributed_unforwarded_amount: 30000,
    attribution_status: 'scenario_attributed' as const,
    attribution_basis: 'explicit_scenario_lineage_metadata',
    attribution_assumptions: ['Scenario assumption.'],
    double_counting_safeguard: 'Sequential transfers are not summed.',
  },
  observed_signals: [
    {
      code: 'unforwarded_attributed_balance',
      title: 'Holds Unforwarded Attributed Balance',
      description: 'Account retains ₹30,000 of scenario-attributed exposure.',
      related_transaction_ids: ['T003'],
      interpretation_note: 'May reflect legitimate goods or services sold.',
    },
  ],
  paths_involving_account: [],
  evidence_assessment: {
    evidence_sufficiency: 'scenario_lineage_assumed' as const,
    supporting_evidence: [
      {
        evidence_type: 'traced_ledger_leg',
        summary: 'Incoming leg T003.',
        related_transaction_ids: ['T003'],
      },
    ],
    evidence_gaps: ['No external KYC or commercial invoice attached.'],
    uncertainty_factors: ['Graph connection does not imply wrongdoing.'],
    verification_guidance: ['Request commercial invoice before any action.'],
    recommended_review_state: 'under_review' as const,
    recommendation_rationale: 'Verify invoice before concluding.',
  },
  review_status: {
    account_id: 'C300',
    case_id: 'FS-1042',
    review_state: 'under_review' as const,
    evidence_quality: 'synthetic_assumption' as const,
    notes: 'Awaiting invoice',
    reviewer_id: 'investigator_ui',
    decision_reasons: [],
    supporting_transaction_ids: [],
    additional_info_needed: false,
    automated_action_taken: 'none',
  },
  audit_history: [],
  warnings: [],
  transaction_risk_separation_note: 'Risk scores do not establish guilt.',
  automated_action_taken: 'none',
  decision_support_only: true,
  disclaimer: 'Decision support only.',
};

describe('CaseDetailPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getCase').mockResolvedValue(mockCase);
    vi.spyOn(api, 'getCaseGraph').mockResolvedValue(mockGraph);
    vi.spyOn(api, 'getCaseTrace').mockResolvedValue(mockTrace as any);
    vi.spyOn(api, 'getCaseTransactions').mockResolvedValue(mockTransactions as any);
    vi.spyOn(api, 'getCaseAuditTrail').mockResolvedValue(mockAudit as any);
    vi.spyOn(api, 'getCaseAccountAssessments').mockResolvedValue({
      case_id: 'FS-1042',
      count: 1,
      assessments: [mockAccountAssessment as any],
      disclaimer: 'test',
    });
    vi.spyOn(api, 'getAccountAssessment').mockResolvedValue(mockAccountAssessment as any);
  });

  it('renders case header, breadcrumb, status, and summary metrics', async () => {
    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('FS-1042')).toBeInTheDocument();
    });

    expect(screen.getByText(/Back to Case Management/i)).toBeInTheDocument();
    expect(screen.getByText(/04 \/ CASE DOSSIER/i)).toBeInTheDocument();
    expect(screen.getByText('T001')).toBeInTheDocument();
    expect(screen.getByText(/Reported Loss/i)).toBeInTheDocument();
    expect(screen.getByText(/Connected Accounts/i)).toBeInTheDocument();
    expect(screen.getByText(/Traced Network/i)).toBeInTheDocument();
  });

  it('displays overview tab with incident summary, origin transfer, and milestones', async () => {
    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Reported Incident Summary/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Origin Transaction: T001/i)).toBeInTheDocument();
    expect(screen.getByText(/Case Milestones & Multi-Hop Progression/i)).toBeInTheDocument();
    expect(screen.getByText(/1\. Origin Fraudulent Debit/i)).toBeInTheDocument();
    expect(screen.getByText(/Anti-Double-Counting & Evidentiary Safeguards/i)).toBeInTheDocument();
    expect(screen.getByText(/Suggested Next Step/i)).toBeInTheDocument();
  });

  it('switches to Fund Flow tab and displays tree topology and view modes', async () => {
    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Fund Flow Tree/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Fund Flow Tree/i }));

    await waitFor(() => {
      expect(screen.getByText(/TOPOLOGY:/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Interactive Tree/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Path Breakdown/i })).toBeInTheDocument();

    // Toggle Path Breakdown
    fireEvent.click(screen.getByRole('button', { name: /Path Breakdown/i }));
    expect(screen.getByText(/Linear Multi-Hop Flow Paths/i)).toBeInTheDocument();
    expect(screen.getByText(/PATH 1: V001 → A100 → B200 → C300 → E500/i)).toBeInTheDocument();
  });

  it('switches to Transactions tab, filters by rail, and searches', async () => {
    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Transactions \(3\)/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Transactions \(3\)/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Filter by TX, sender, receiver/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText('T001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('T002')).toBeInTheDocument();
    expect(screen.getByText('T003')).toBeInTheDocument();

    // Filter by IMPS
    fireEvent.click(screen.getByRole('button', { name: /^IMPS$/i }));
    expect(screen.queryByRole('cell', { name: 'T001' })).not.toBeInTheDocument();
    expect(screen.getByText('T002')).toBeInTheDocument();

    // Search for nonexistent
    const searchInput = screen.getByPlaceholderText(/Filter by TX, sender, receiver/i);
    fireEvent.change(searchInput, { target: { value: 'XYZ_NO_MATCH' } });
    expect(screen.getByText(/No transactions match your search filter/i)).toBeInTheDocument();
  });

  it('switches to Accounts & Evidence tab and displays connected entities', async () => {
    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Accounts & Evidence/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Accounts & Evidence/i }));

    await waitFor(() => {
      expect(screen.getByText('V001')).toBeInTheDocument();
    });

    expect(screen.getByText('A100')).toBeInTheDocument();
    expect(screen.getByText('B200')).toBeInTheDocument();
    expect(screen.getByText('C300')).toBeInTheDocument();
  });

  it('switches to Review & Audit tab and renders adjudication panel', async () => {
    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Review & Audit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Review & Audit/i }));

    await waitFor(() => {
      expect(screen.getByText(/Select Downstream Account to Adjudicate/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Immutable Audit Provenance/i)).toBeInTheDocument();
    expect(screen.getByText(/lead_investigator_raj/i)).toBeInTheDocument();
  });

  it('updates case triage status via API', async () => {
    const updateSpy = vi.spyOn(api, 'updateCase').mockResolvedValue({
      ...mockCase,
      investigation_status: 'closed',
    });

    render(
      <MemoryRouter initialEntries={['/cases/FS-1042']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Under Investigation')).toBeInTheDocument();
    });

    const select = screen.getByDisplayValue('Under Investigation');
    fireEvent.change(select, { target: { value: 'closed' } });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('FS-1042', {
        investigation_status: 'closed',
        updated_by: 'lead_investigator_ui',
      });
    });
  });

  it('renders not found error state when case does not exist', async () => {
    vi.spyOn(api, 'getCase').mockRejectedValue(new Error('Case not found'));

    render(
      <MemoryRouter initialEntries={['/cases/NONEXISTENT']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Investigation Case Not Found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Return to Case Management/i)).toBeInTheDocument();
  });
});
