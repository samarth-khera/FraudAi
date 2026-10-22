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

    expect(screen.getByText(/Trace the Flow/i)).toBeInTheDocument();
    expect(screen.getByText(/Protect the Innocent/i)).toBeInTheDocument();
    expect(screen.getByText('Open Investigation Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Explore Demo Case FS-1042')).toBeInTheDocument();
  });

  it('renders ModelInsightsPage with real PaySim metrics and confusion matrix', () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/ML Model Performance & Validation/i)).toBeInTheDocument();
    expect(screen.getByText('98.6%')).toBeInTheDocument();
    expect(screen.getByText('83.6%')).toBeInTheDocument();
    expect(screen.getByText('0.9828')).toBeInTheDocument();
    expect(screen.getByText('True Negatives')).toBeInTheDocument();
    expect(screen.getByText('True Positives')).toBeInTheDocument();
  });
});

describe('Unified Platform Layout Shell', () => {
  it('renders UnifiedHeader with brand, status, and all 7 core navigation links', async () => {
    const { UnifiedHeader } = await import('../components/layout/UnifiedHeader');
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <UnifiedHeader />
      </MemoryRouter>
    );

    expect(screen.getByText('FraudShield AI')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Fund Flow')).toBeInTheDocument();
    expect(screen.getByText('Cases')).toBeInTheDocument();
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
    expect(screen.getByText('FS-1042')).toBeInTheDocument();
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

