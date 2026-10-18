import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Badge } from '../components/common/Badge';
import { MetricCard } from '../components/common/MetricCard';
import { AccountProtectionPanel } from '../components/investigation/AccountProtectionPanel';
import { TransactionCheckPage } from '../pages/TransactionCheckPage';
import { api } from '../services/api';
import { Shield } from 'lucide-react';

describe('Common & Investigation Components', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Badge with formatted label and variant styling', () => {
    const { rerender } = render(<Badge variant="status" value="under_investigation" />);
    expect(screen.getByText('Under Investigation')).toBeInTheDocument();

    rerender(<Badge variant="review" value="review_completed" />);
    expect(screen.getByText('Review Completed')).toBeInTheDocument();

    rerender(<Badge variant="risk" value="fraud_reported" />);
    expect(screen.getByText('Fraud Reported')).toBeInTheDocument();
  });

  it('renders MetricCard with title, value, change indicator, and subtitle', () => {
    render(
      <MetricCard
        title="Reported Exposure"
        value="₹50,000"
        change="+12.5%"
        changeType="warning"
        subtitle="Synthetic origin"
        icon={<Shield data-testid="test-icon" />}
      />
    );

    expect(screen.getByText('Reported Exposure')).toBeInTheDocument();
    expect(screen.getByText('₹50,000')).toBeInTheDocument();
    expect(screen.getByText('+12.5%')).toBeInTheDocument();
    expect(screen.getByText('Synthetic origin')).toBeInTheDocument();
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('renders AccountProtectionPanel distinguishing observed movement from traceable exposure and submits human review', async () => {
    const mockAssessment = {
      case_id: 'FS-1042',
      account_id: 'ACC-MERCH-301',
      graph_position: {
        account_id: 'ACC-MERCH-301',
        label: 'Synthetic Merchant A',
        role: 'downstream_recipient' as const,
        is_synthetic: true,
        in_traced_network: true,
        connection_type: 'indirect_hop',
        hop_count: 2,
        upstream_account_ids: ['ACC-MULE-102'],
        downstream_account_ids: [],
        path_ids: ['FS-1042-P1'],
        first_received_at: '2026-03-30T10:12:00Z',
        last_observed_activity_at: '2026-03-30T10:12:00Z',
      },
      observed_movement: {
        observed_inbound_value: 45000,
        observed_outbound_value: 0,
        traced_inbound_count: 1,
        traced_outbound_count: 0,
        traced_inbound_transactions: [
          {
            transaction_id: 'TX-1002',
            timestamp: '2026-03-30T10:12:00Z',
            sender_account_id: 'ACC-MULE-102',
            receiver_account_id: 'ACC-MERCH-301',
            amount: 45000,
            currency: 'INR',
            transaction_type: 'UPI',
            hop_count: 2,
            attributed_amount: 30000,
            attribution_basis: 'explicit_scenario_lineage_metadata',
            attribution_note: 'Explicit scenario lineage.',
            is_cycle_closing: false,
          },
        ],
        traced_outbound_transactions: [],
        other_observed_inbound_count: 0,
        other_observed_outbound_count: 0,
        movement_note: 'Gross observed transfers across all case legs.',
      },
      traceable_exposure: {
        reported_case_amount: 50000,
        case_traceable_amount: 50000,
        gross_network_observed_value: 112000,
        attributed_inbound_amount: 30000,
        attributed_outbound_amount: 0,
        attributed_unforwarded_amount: 30000,
        attribution_status: 'scenario_attributed',
        attribution_basis: 'explicit_scenario_lineage_metadata',
        attribution_assumptions: ['Explicit scenario lineage assumption.'],
        double_counting_safeguard: 'Downstream hop amounts are never summed into a larger stolen-fund total.',
      },
      observed_signals: [
        {
          code: 'unforwarded_attributed_balance',
          title: 'Holds Unforwarded Attributed Balance',
          description: 'Account retains ₹30,000 of scenario-attributed exposure.',
          related_transaction_ids: ['TX-1002'],
          interpretation_note: 'May reflect legitimate goods or services sold in good faith.',
        },
      ],
      paths_involving_account: [],
      evidence_assessment: {
        evidence_sufficiency: 'scenario_lineage_assumed' as const,
        supporting_evidence: [
          {
            evidence_type: 'traced_ledger_leg',
            summary: 'Observed incoming payment leg TX-1002.',
            related_transaction_ids: ['TX-1002'],
          },
        ],
        evidence_gaps: ['No external KYC, invoice, or bank statement verified.'],
        uncertainty_factors: ['Lineage relies on synthetic scenario metadata.'],
        verification_guidance: ['Request commercial invoice before any manual compliance decision.'],
        recommended_review_state: 'under_review' as const,
        recommendation_rationale: 'Verify commercial invoice before clearing.',
      },
      review_status: {
        account_id: 'ACC-MERCH-301',
        review_state: 'not_reviewed' as const,
        evidence_quality: 'not_assessed' as const,
        automated_action_taken: 'none',
        notes: null,
        reviewer_id: null,
        updated_at: null,
        decision_reasons: [],
        supporting_transaction_ids: [],
        additional_info_needed: false,
      },
      audit_history: [],
      warnings: [],
      transaction_risk_separation_note: 'Transaction risk scores do not prove account guilt.',
      automated_action_taken: 'none',
      decision_support_only: true,
      disclaimer: 'Receiving downstream funds does not establish complicity or fraud.',
    };

    vi.spyOn(api, 'getAccountAssessment').mockResolvedValue(mockAssessment);
    const updateSpy = vi.spyOn(api, 'updateAccountReview').mockResolvedValue({
      case_id: 'FS-1042',
      account: mockAssessment.review_status,
      disclaimer: 'Recorded.',
    });

    render(
      <MemoryRouter>
        <AccountProtectionPanel caseId="FS-1042" accountId="ACC-MERCH-301" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('ACC-MERCH-301')).toBeInTheDocument();
    });

    // Verify distinction between gross observed movement (45,000) and traceable exposure (30,000)
    expect(screen.getByText('1. Observed Ledger Movement')).toBeInTheDocument();
    expect(screen.getByText('2. Traceable Fund Exposure')).toBeInTheDocument();
    expect(screen.getByText('Holds Unforwarded Attributed Balance')).toBeInTheDocument();
    expect(screen.getByText(/No external KYC, invoice, or bank statement verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Request commercial invoice/i)).toBeInTheDocument();

    // Submit a human review decision
    const notesInput = screen.getByPlaceholderText(/Document specific findings/i);
    fireEvent.change(notesInput, { target: { value: 'Verified merchant invoice #INV-301' } });
    fireEvent.click(screen.getByRole('button', { name: /Record Human Review Decision/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        'FS-1042',
        'ACC-MERCH-301',
        expect.objectContaining({
          notes: 'Verified merchant invoice #INV-301',
        })
      );
    });
  });

  it('renders TransactionCheckPage and displays TreeSHAP feature contributions on explain', async () => {
    vi.spyOn(api, 'getCaseTransactions').mockResolvedValue({
      case_id: 'FS-1042',
      count: 0,
      transactions: [],
      disclaimer: 'Synthetic',
    });
    vi.spyOn(api, 'explainRisk').mockResolvedValue({
      risk_score: 0.9999,
      threshold: 0.5,
      review_recommended: true,
      model_version: 'model_v1',
      feature_set: 'candidate_no_post_balance',
      decision_support_only: true,
      automated_action_taken: 'none',
      explanation_method: 'TreeSHAP (XGBoost pred_contribs on log-odds margin)',
      prediction_scale: 'log_odds',
      base_value: -7.521,
      raw_margin: 9.812,
      feature_contributions: [
        {
          feature: 'amount_to_orig_balance_ratio',
          label: 'Amount to Sender Balance Ratio',
          value: 1.0,
          contribution: 11.42,
          direction: 'increases_risk',
          encoding: 'numeric',
        },
        {
          feature: 'step',
          label: 'Simulation Time Step (Hours)',
          value: 1,
          contribution: -0.45,
          direction: 'decreases_risk',
          encoding: 'numeric',
        },
      ],
      encoded_contributions: [],
      representation_notes: 'One-hot encoded type indicators summed.',
      limitations: ['Statistical signal only.'],
      disclaimer: 'Statistical decision-support signal only.',
    });

    render(
      <MemoryRouter>
        <TransactionCheckPage />
      </MemoryRouter>
    );

    const submitBtn = screen.getByRole('button', { name: /Score & Explain Prediction/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Local Feature Contributions/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Amount to Sender Balance Ratio')).toBeInTheDocument();
    expect(screen.getByText(/\+11\.4200/)).toBeInTheDocument();
    expect(screen.getByText(/-0\.4500/)).toBeInTheDocument();
    expect(screen.getByText(/Statistical decision-support signal only/i)).toBeInTheDocument();
  });
});

