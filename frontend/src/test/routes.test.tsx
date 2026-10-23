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
  });

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
});

