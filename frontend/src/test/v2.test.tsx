import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { V2ModelDivergenceAlert } from '../components/v2/V2ModelDivergenceAlert';
import { V2TreeShapBreakdown } from '../components/v2/V2TreeShapBreakdown';
import { V2SearchPage, normalizeAccountId } from '../pages/v2/V2SearchPage';
import { V2AccountDetailPage } from '../pages/v2/V2AccountDetailPage';
import { v2Api } from '../services/v2Api';
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

    expect(screen.getByText(/Key Driving Behavioral Features/i)).toBeInTheDocument();
    expect(screen.getByText(/Max Transaction Amount/i)).toBeInTheDocument();
    expect(screen.getByText('+3.9147')).toBeInTheDocument();
    expect(screen.getByText(/Current Account Balance/i)).toBeInTheDocument();
    expect(screen.getByText('-0.2986')).toBeInTheDocument();
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
    expect(screen.getByText(/Curated Synthetic Ledger Investigation Cases/i)).toBeInTheDocument();
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
  });

  it('renders 360° account dossier with evidence hierarchy, tabs, and human adjudication panel', async () => {
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

    // Verify offline benchmark metadata notice for ACC-000001
    expect(screen.getByText(/OFFLINE EVALUATION BENCHMARK METADATA/i)).toBeInTheDocument();
    expect(screen.getByText(/SCENARIO-APP-001 · Compromised Victim/i)).toBeInTheDocument();

    // Verify divergence banner is present
    expect(screen.getByText(/Model Score Divergence: Compromised Victim Pattern Detected/i)).toBeInTheDocument();

    // Verify Human Adjudication Panel
    expect(screen.getByText(/Human Compliance Adjudication/i)).toBeInTheDocument();
    expect(screen.getByText(/Record Finding/i)).toBeInTheDocument();
  });

  it('records human adjudication finding and renders audit trail entry', async () => {
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

    // Enter notes in textarea
    const notesInput = screen.getByPlaceholderText(/Document factual findings/i);
    fireEvent.change(notesInput, { target: { value: 'Verified legitimate customer victim of APP scam.' } });

    // Click Record Finding
    const recordBtn = screen.getByRole('button', { name: /Record Finding/i });
    fireEvent.click(recordBtn);

    // Verify Audit Trail is rendered
    await waitFor(() => {
      expect(screen.getByText(/Logged Adjudication Audit Trail/i)).toBeInTheDocument();
      expect(screen.getByText(/"Verified legitimate customer victim of APP scam."/i)).toBeInTheDocument();
    });
  });
});
