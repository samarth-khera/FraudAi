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
