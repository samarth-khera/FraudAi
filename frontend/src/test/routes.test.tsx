import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '../pages/LandingPage';
import { ModelInsightsPage } from '../pages/ModelInsightsPage';

describe('Page Rendering', () => {
  it('renders LandingPage with headline and CTA buttons', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Follow the money/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Understand the risk/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Guided Investigation/i)).toBeInTheDocument();
    expect(screen.getByText(/Explore the Workspace/i)).toBeInTheDocument();
    expect(screen.getByText('Search Account')).toBeInTheDocument();
  }, 15000);

  it('renders GuidedInvestigationPage with step 1 and context', async () => {
    const { GuidedInvestigationPage } = await import('../pages/GuidedInvestigationPage');
    render(
      <MemoryRouter>
        <GuidedInvestigationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Interactive Guided Investigation')).toBeInTheDocument();
    expect(screen.getByText('What happened?')).toBeInTheDocument();
    expect(screen.getAllByText('Understand the Case').length).toBeGreaterThan(0);
    expect(screen.getByText(/Proceed to Step 2/i)).toBeInTheDocument();
  });

  it('renders ModelInsightsPage with model registry and architecture tabs', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Model Insights')).toBeInTheDocument();
    expect(screen.getByText('MODEL INTELLIGENCE')).toBeInTheDocument();
    expect(screen.getByText('V2 Account-Level Fraud Model')).toBeInTheDocument();
    expect(screen.getByText('Transaction-Level PaySim Benchmark')).toBeInTheDocument();
    expect(screen.getByText('Model Comparison & Scope')).toBeInTheDocument();
  });

  it('renders AuditPage with governance header and summary metrics', async () => {
    const { AuditPage } = await import('../pages/AuditPage');
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Audit & Governance')).toBeInTheDocument();
    expect(screen.getByText('GOVERNANCE & PROVENANCE')).toBeInTheDocument();
    expect(screen.getByText('Refresh Events')).toBeInTheDocument();
  });
});

describe('Unified Platform Layout Shell', () => {
  it('renders UnifiedHeader with brand, status, and task-oriented navigation links', async () => {
    const { UnifiedHeader } = await import('../components/layout/UnifiedHeader');
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <UnifiedHeader />
      </MemoryRouter>
    );

    expect(screen.getByText('FraudShield AI')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Investigations')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Fund Flow')).toBeInTheDocument();
    expect(screen.getByText('Model Insights')).toBeInTheDocument();
    expect(screen.getByText('Audit History')).toBeInTheDocument();
    expect(screen.getAllByText('Guided Tour').length).toBeGreaterThan(0);
  });

  it('renders AppLayout with UnifiedHeader, evidentiary safeguard protocol, and footer', async () => {
    const { AppLayout } = await import('../components/layout/AppLayout');
    render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <AppLayout />
      </MemoryRouter>
    );

    expect(screen.getByText('FraudShield AI')).toBeInTheDocument();
    expect(screen.getByText(/Evidentiary Safeguard Protocol/i)).toBeInTheDocument();
    expect(screen.getByText(/Automated account freezing is strictly prohibited/i)).toBeInTheDocument();
    expect(screen.getByText(/Ethical AI & Compliance Safeguard/i)).toBeInTheDocument();
  });

  it('renders UnifiedHeader with v2-active engine status pill when model status is healthy', async () => {
    const { v2Api } = await import('../services/v2Api');
    vi.spyOn(v2Api, 'getModelsStatus').mockResolvedValueOnce({
      account_model: {
        available: true,
        version: 'v2-account-1.0.0',
        model_type: 'XGBClassifier',
        features_count: 26,
        trained_at: null,
        test_metrics: null,
        limitations: null,
      },
      paysim_benchmark: {
        available: true,
        version: 'v2-benchmark-1.0.0',
        model_type: 'XGBClassifier',
        features_count: 14,
        trained_at: null,
        test_metrics: null,
        limitations: null,
      },
      overall_status: 'healthy',
      inference_ready: true,
      disclaimer: 'Advisory only',
    });

    const { UnifiedHeader } = await import('../components/layout/UnifiedHeader');
    render(
      <MemoryRouter>
        <UnifiedHeader />
      </MemoryRouter>
    );

    const activeBadge = await screen.findByText('v2-active');
    expect(activeBadge).toBeInTheDocument();
    expect(activeBadge.closest('a')).toHaveAttribute('href', '/insights');
  });

  it('renders UnifiedHeader with Degraded badge linking to /insights when inference_ready is false', async () => {
    const { v2Api } = await import('../services/v2Api');
    vi.spyOn(v2Api, 'getModelsStatus').mockResolvedValueOnce({
      account_model: {
        available: false,
        version: null,
        model_type: null,
        features_count: null,
        trained_at: null,
        test_metrics: null,
        limitations: null,
      },
      paysim_benchmark: {
        available: false,
        version: null,
        model_type: null,
        features_count: null,
        trained_at: null,
        test_metrics: null,
        limitations: null,
      },
      overall_status: 'degraded_missing_account_model',
      inference_ready: false,
      disclaimer: 'Advisory only',
    });

    const { UnifiedHeader } = await import('../components/layout/UnifiedHeader');
    render(
      <MemoryRouter>
        <UnifiedHeader />
      </MemoryRouter>
    );

    const degradedBadge = await screen.findByText('Degraded');
    expect(degradedBadge).toBeInTheDocument();
    expect(degradedBadge.closest('a')).toHaveAttribute('href', '/insights');
  });

  it('renders UnifiedHeader with Offline badge when backend connection fails', async () => {
    const { v2Api } = await import('../services/v2Api');
    vi.spyOn(v2Api, 'getModelsStatus').mockRejectedValueOnce(new Error('Network error: connection refused'));

    const { UnifiedHeader } = await import('../components/layout/UnifiedHeader');
    render(
      <MemoryRouter>
        <UnifiedHeader />
      </MemoryRouter>
    );

    const offlineBadge = await screen.findByText('Offline');
    expect(offlineBadge).toBeInTheDocument();
  });
});

