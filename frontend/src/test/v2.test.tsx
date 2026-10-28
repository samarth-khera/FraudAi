import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { V2ModelDivergenceAlert } from '../components/v2/V2ModelDivergenceAlert';
import { V2TreeShapBreakdown } from '../components/v2/V2TreeShapBreakdown';
import { V2SearchPage, normalizeAccountId } from '../pages/v2/V2SearchPage';
import { V2AccountDetailPage } from '../pages/v2/V2AccountDetailPage';
import { v2Api, ApiError } from '../services/v2Api';
import { V2FeatureContribution } from '../types/v2';

// Mock v2Api
vi.mock('../services/v2Api', () => ({
  v2Api: {
    getModelsStatus: vi.fn(),
    getAccount: vi.fn(),
    getAssessment: vi.fn(),
    getMLAssessment: vi.fn(),
    getTransactions: vi.fn(),
    getTrace: vi.fn(),
    runLiveAnalysis: vi.fn(),
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

describe('normalizeAccountId helper', () => {
  it('normalizes bare numbers to ACC-XXXXXX format', () => {
    expect(normalizeAccountId('1')).toBe('ACC-000001');
    expect(normalizeAccountId('000001')).toBe('ACC-000001');
    expect(normalizeAccountId('4218')).toBe('ACC-004218');
  });

  it('normalizes lowercase acc- prefix', () => {
    expect(normalizeAccountId('acc-000001')).toBe('ACC-000001');
    expect(normalizeAccountId('acc-2')).toBe('ACC-000002');
  });

  it('preserves and trims standard ACC format', () => {
    expect(normalizeAccountId('  ACC-000001  ')).toBe('ACC-000001');
    expect(normalizeAccountId('ACC-MULE-01')).toBe('ACC-MULE-01');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeAccountId('')).toBe('');
    expect(normalizeAccountId('   ')).toBe('');
  });
});

describe('V2ModelDivergenceAlert Component', () => {
  it('renders divergence alert for victim account ACC-000001 with high ML score and low rule score', () => {
    render(
      <V2ModelDivergenceAlert
        accountId="ACC-000001"
        mlRiskScore={76.5}
        mlRiskLevel="high"
        ruleRiskScore={25.0}
        ruleRiskLevel="low"
      />
    );

    expect(screen.getByText(/Model Score Divergence: Compromised Victim Pattern Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/AUDIT REQUIRED/i)).toBeInTheDocument();
    expect(screen.getByText(/ML Score: 76.5\/100/i)).toBeInTheDocument();
    expect(screen.getByText(/Rule Baseline: 25.0\/100/i)).toBeInTheDocument();
    expect(screen.getByText(/Anomalous balance drain can indicate victim impact rather than perpetrator behaviour/i)).toBeInTheDocument();
    expect(screen.getByText(/Automated freezing, blocking, service denial, or reporting of this customer based on model outputs is strictly prohibited/i)).toBeInTheDocument();
  });

  it('does NOT render when scores are consistent and non-divergent', () => {
    const { container } = render(
      <V2ModelDivergenceAlert
        accountId="ACC-NORMAL"
        mlRiskScore={20.0}
        mlRiskLevel="low"
        ruleRiskScore={15.0}
        ruleRiskLevel="low"
      />
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('V2TreeShapBreakdown Component', () => {
  const sampleContributions: V2FeatureContribution[] = [
    {
      feature_name: 'max_amount',
      feature_value: 250000.0,
      contribution_score: 3.9147,
      impact_direction: 'increases_risk',
    },
    {
      feature_name: 'current_balance',
      feature_value: 177156.23,
      contribution_score: -0.2986,
      impact_direction: 'decreases_risk',
    },
  ];

  it('renders TreeSHAP features with scores and directions', () => {
    render(<V2TreeShapBreakdown contributions={sampleContributions} />);

    expect(screen.getByText(/TreeSHAP Feature Attribution/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Largest transaction amount/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Current balance/i)[0]).toBeInTheDocument();
  });
});

describe('V2SearchPage Component', () => {
  beforeEach(() => {
    vi.mocked(v2Api.getModelsStatus).mockResolvedValue({
      account_model: {
        available: true,
        version: 'v2-account-1.0.0',
        model_type: 'XGBClassifier',
        features_count: 26,
        trained_at: '2026-10-20T14:56:12Z',
        test_metrics: { roc_auc: 0.9945 },
        limitations: 'Synthetic data',
      },
      paysim_benchmark: {
        available: true,
        version: 'v2-benchmark-1.0.0',
        model_type: 'PaySim XGBoost',
        features_count: 14,
        trained_at: '2026-10-20T14:54:45Z',
        test_metrics: { roc_auc: 1.0 },
        limitations: 'Historical benchmark',
      },
      overall_status: 'healthy',
      inference_ready: true,
      disclaimer: 'Decision support only',
    });
  });

  it('renders hero search input and curated sample cases with benchmark disclaimers', async () => {
    render(
      <MemoryRouter>
        <V2SearchPage />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText(/Enter Synthetic Account ID/i)).toBeInTheDocument();
    expect(screen.getByText(/three of them from sample case FS-2001/i)).toBeInTheDocument();
    // Ground-truth training labels are not presented as findings.
    expect(screen.queryByText(/Money Mule Demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Normal Account Demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ACC-000010 \(Normal\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Ground-Truth Reference Notice/i)).toBeInTheDocument();

    // Verify sample accounts are present
    expect(screen.getByText('ACC-000001')).toBeInTheDocument();
    expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    expect(screen.getByText('ACC-000002')).toBeInTheDocument();
    expect(screen.getByText('Sara Bhat')).toBeInTheDocument();

    // Verify Model status loads
    await waitFor(() => {
      expect(screen.getByText('ONLINE')).toBeInTheDocument();
    });
  });
});

describe('V2AccountDetailPage Component', () => {
  beforeEach(() => {
    vi.mocked(v2Api.getModelsStatus).mockResolvedValue({
      account_model: {
        available: true,
        version: 'v2-account-1.0.0',
        model_type: 'XGBClassifier',
        features_count: 26,
        trained_at: '2026-10-20T14:56:12Z',
        test_metrics: { roc_auc: 0.9945 },
        limitations: 'Synthetic data',
      },
      paysim_benchmark: {
        available: true,
        version: 'v2-benchmark-1.0.0',
        model_type: 'PaySim XGBoost',
        features_count: 14,
        trained_at: '2026-10-20T14:54:45Z',
        test_metrics: { roc_auc: 1.0 },
        limitations: 'Historical benchmark',
      },
      overall_status: 'healthy',
      inference_ready: true,
      disclaimer: 'Decision support only',
    });

    vi.mocked(v2Api.getAccount).mockResolvedValue({
      account_id: 'ACC-000001',
      customer_name: 'Aditi Joshi',
      customer_type: 'retail',
      kyc_tier: 'tier_2_verified',
      phone_number: '+91 92174 00001',
      email: 'aditijoshi.0001@example.bank',
      upi_id: 'aditijoshi0001@okhdfcbank',
      tax_identifier: 'SYNTH00001P',
      initial_balance: 300000.0,
      current_balance: 177156.23,
      account_opened_at: '2025-10-11T00:00:00',
      status: 'active',
      metrics: {
        total_incoming_txns: 23,
        total_outgoing_txns: 33,
        total_incoming_amount: 288043.01,
        total_outgoing_amount: 410886.78,
        net_flow: -122843.77,
        unique_counterparties: 56,
        first_activity_at: '2026-01-03T03:02:29',
        last_activity_at: '2026-03-31T03:05:52',
      },
    });

    vi.mocked(v2Api.getAssessment).mockResolvedValue({
      account_id: 'ACC-000001',
      risk_score: 25.0,
      risk_level: 'low',
      signals: {
        total_transactions: 56,
        velocity_24h_count: 1,
        velocity_7d_count: 8,
        velocity_30d_count: 21,
        flow_through_ratio: 1.4265,
        rapid_pass_through: false,
        median_dwell_minutes: 2.8,
        max_amount: 250000.0,
        avg_amount: 12480.89,
        amount_spike_ratio: 20.03,
        unique_counterparties: 56,
        counterparty_diversity_ratio: 1.0,
        fan_in_ratio: 0.4107,
        fan_out_ratio: 0.5893,
        dormancy_gap_days: null,
        dormant_awakening_detected: false,
        cycle_detected: false,
      },
      reason_codes: ['UNUSUAL_AMOUNT_SPIKE: Maximum transaction (250000.00) is 20.0x higher than average.'],
      evidence_gaps: ['DEVICE_TELEMETRY_UNAVAILABLE'],
      uncertainty_rating: 'low',
      recommendation: 'routine_monitoring',
      disclaimer: 'Decision support only.',
    });

    vi.mocked(v2Api.getMLAssessment).mockResolvedValue({
      account_id: 'ACC-000001',
      risk_score: 76.5,
      risk_level: 'high',
      predicted_probability: 0.7648,
      predicted_class: 'suspicious',
      model_version: 'v2-account-1.0.0',
      model_type: 'XGBClassifier',
      top_contributions: [
        {
          feature_name: 'max_amount',
          feature_value: 250000.0,
          contribution_score: 3.9147,
          impact_direction: 'increases_risk',
        },
      ],
      observable_features: { max_amount: 250000.0 },
      disclaimer: 'Decision support only.',
    });

    vi.mocked(v2Api.getTransactions).mockResolvedValue({
      account_id: 'ACC-000001',
      total: 56,
      limit: 25,
      offset: 0,
      transactions: [
        {
          transaction_id: 'TXN-0008601',
          origin_account_id: 'ACC-000001',
          destination_account_id: 'ACC-002867',
          amount: 2163.53,
          currency: 'INR',
          channel: 'CARD_POS',
          status: 'SETTLED',
          origin_balance_before: 300000.0,
          origin_balance_after: 297836.47,
          dest_balance_before: 105064.8,
          dest_balance_after: 107228.33,
          direction: 'outbound',
          counterparty_account_id: 'ACC-002867',
        },
      ],
    });

    vi.mocked(v2Api.getTrace).mockResolvedValue({
      root_account_id: 'ACC-000001',
      direction: 'outgoing',
      max_depth_configured: 3,
      max_depth_reached: 2,
      nodes: [
        {
          account_id: 'ACC-000001',
          customer_name: 'Aditi Joshi',
          customer_type: 'retail',
          kyc_tier: 'tier_2_verified',
          current_balance: 177156.23,
          hop_distance: 0,
          is_root: true,
        },
      ],
      edges: [],
      total_nodes: 1,
      total_edges: 0,
      is_truncated: false,
      truncation_reason: null,
      observed_total_transferred: 0,
      attributed_exposure_upper_bound: 0,
      attribution_status: 'observed_transfers_with_bounded_exposure',
      attribution_disclaimer: 'Bounded attribution',
    });

    vi.mocked(v2Api.runLiveAnalysis).mockResolvedValue({
      analysis_id: 'RUN-TEST-001',
      account_id: 'ACC-000001',
      analyzed_at: '2026-10-22T09:00:00Z',
      model_version: 'v2-account-1.0.0',
      ledger_snapshot: {
        transactions_examined: 56,
        latest_transaction_timestamp: '2026-03-31T03:05:52',
        first_transaction_timestamp: '2026-01-03T03:02:29',
        total_received: 288043.01,
        total_sent: 410886.78,
        current_balance: 177156.23,
      },
      rule_assessment: {
        account_id: 'ACC-000001',
        risk_score: 25.0,
        risk_level: 'low',
        signals: {
          total_transactions: 56,
          velocity_24h_count: 1,
          velocity_7d_count: 8,
          velocity_30d_count: 21,
          flow_through_ratio: 1.4265,
          rapid_pass_through: false,
          median_dwell_minutes: 2.8,
          max_amount: 250000.0,
          avg_amount: 12480.89,
          amount_spike_ratio: 20.03,
          unique_counterparties: 56,
          counterparty_diversity_ratio: 1.0,
          fan_in_ratio: 0.4107,
          fan_out_ratio: 0.5893,
          dormancy_gap_days: null,
          dormant_awakening_detected: false,
          cycle_detected: false,
        },
        reason_codes: ['UNUSUAL_AMOUNT_SPIKE: Maximum transaction (250000.00) is 20.0x higher than average.'],
        evidence_gaps: ['DEVICE_TELEMETRY_UNAVAILABLE'],
        uncertainty_rating: 'low',
        recommendation: 'routine_monitoring',
        disclaimer: 'Decision support only.',
      },
      ml_assessment: {
        account_id: 'ACC-000001',
        risk_score: 76.5,
        risk_level: 'high',
        predicted_probability: 0.7648,
        predicted_class: 'suspicious',
        model_version: 'v2-account-1.0.0',
        model_type: 'XGBClassifier',
        top_contributions: [
          {
            feature_name: 'max_amount',
            feature_value: 250000.0,
            contribution_score: 3.9147,
            impact_direction: 'increases_risk',
          },
        ],
        observable_features: { max_amount: 250000.0 },
        disclaimer: 'Decision support only.',
      },
      divergence: {
        divergence_detected: true,
        ml_score: 76.5,
        rule_score: 25.0,
        score_delta: 51.5,
        interpretation: 'Compromised Victim / Outlier Drain Disparity: Model indicates victim impact.',
        suggested_focus: 'Verify customer authorization rather than presuming perpetrator guilt.',
      },
      recommended_actions: [
        {
          action_id: 'ACT-001',
          title: 'Review High-Value Outlier Transfer of ₹250,000.00',
          priority: 'high_priority',
          action_type: 'review_large_transaction',
          rationale: 'The largest single transfer is 20.0x higher than average.',
          supporting_evidence: 'Observed peak transfer: ₹250,000.00.',
          suggested_records: 'Verify customer mandate and 2FA/OTP delivery logs.',
          remaining_uncertainty: 'One-off capital expenditures can produce identical spikes.',
        },
      ],
      evidence_gaps: ['DEVICE_TELEMETRY_UNAVAILABLE'],
      human_review_recommended: true,
      disclaimer: 'Decision support only.',
    });
  });

  it('renders initial non-predictive ledger facts with Run Live Analysis button', async () => {
    render(
      <MemoryRouter initialEntries={['/v2/accounts/ACC-000001']}>
        <Routes>
          <Route path="/v2/accounts/:accountId" element={<V2AccountDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify account name renders after loading
    await waitFor(() => {
      expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    });

    // Verify evidence hierarchy bar
    expect(screen.getByText(/Forensic Evidence Hierarchy & Separation of Concepts/i)).toBeInTheDocument();
    expect(screen.getByText(/1. Observed Ledger Facts/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Rule-Based Signals/i)).toBeInTheDocument();
    expect(screen.getByText(/3. Statistical ML Probability/i)).toBeInTheDocument();

    // Verify Honest Initial State: pending analysis, no precomputed prediction
    expect(screen.getByText(/Account Analysis Pending for Current Session/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Run Live Analysis/i })[0]).toBeInTheDocument();
    expect(screen.queryByText(/What Did the Analysis Find\?/i)).not.toBeInTheDocument();
  });

  it('triggers live analysis on demand and renders findings, meters, and recommendations', async () => {
    render(
      <MemoryRouter initialEntries={['/v2/accounts/ACC-000001']}>
        <Routes>
          <Route path="/v2/accounts/:accountId" element={<V2AccountDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    });

    // Click Run Live Analysis
    const runBtn = screen.getAllByRole('button', { name: /Run Live Analysis/i })[0];
    fireEvent.click(runBtn);

    // Verify fresh results appear
    await waitFor(() => {
      expect(screen.getByText(/What Did the Analysis Find\?/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/RUN-TEST-001/i)).toBeInTheDocument();
    expect(screen.getByText(/ML Risk Estimate/i)).toBeInTheDocument();
    expect(screen.getByText(/Rule Behavioral Baseline/i)).toBeInTheDocument();
    expect(screen.getByText(/What Should the Investigator Do Next\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Review High-Value Outlier Transfer of ₹250,000.00/i)).toBeInTheDocument();
  });

  it('does not offer a local-only review form; points to case review instead', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(
      <MemoryRouter initialEntries={['/tools/accounts/ACC-000001?tab=review']}>
        <Routes>
          <Route path="/tools/accounts/:accountId" element={<V2AccountDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    });

    expect(screen.getByText(/Review decisions are recorded inside a case/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record Finding/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open case FS-2001/i })).toHaveAttribute('href', '/cases/FS-2001?section=review');
    expect(setItem.mock.calls.some(([key]) => String(key).startsWith('fs_v2_adjudication_'))).toBe(false);
    setItem.mockRestore();
  });

  it('explains case-only accounts without inventing a link to a specific case', async () => {
    vi.spyOn(v2Api, 'getAccount').mockRejectedValue(new ApiError(404, 'Account not found'));

    render(
      <MemoryRouter initialEntries={['/tools/accounts/A100']}>
        <Routes>
          <Route path="/tools/accounts/:accountId" element={<V2AccountDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Account Not Found in Core Ledger/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Those accounts are not in the synthetic ledger/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open investigations/i })).toHaveAttribute('href', '/cases');
    expect(screen.queryByRole('link', { name: /FS-1042/i })).not.toBeInTheDocument();
  });
});


