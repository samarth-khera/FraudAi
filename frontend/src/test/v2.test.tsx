import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { V2ModelDivergenceAlert } from '../components/v2/V2ModelDivergenceAlert';
import { V2TreeShapBreakdown } from '../components/v2/V2TreeShapBreakdown';
import { V2SearchPage } from '../pages/v2/V2SearchPage';
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
    expect(screen.getByText(/Automated account freezing, blocking, or fraud reporting against this customer is strictly prohibited/i)).toBeInTheDocument();
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

  it('renders hero search input and curated sample cases', async () => {
    render(
      <MemoryRouter>
        <V2SearchPage />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText(/Enter Synthetic Account ID/i)).toBeInTheDocument();
    expect(screen.getByText(/Curated Ledger Investigation Cases/i)).toBeInTheDocument();

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
