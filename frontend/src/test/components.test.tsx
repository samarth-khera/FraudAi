import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TransactionCheckPage } from '../pages/TransactionCheckPage';
import { api } from '../services/api';

describe('TransactionCheckPage (PaySim benchmark tool)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders TransactionCheckPage and displays TreeSHAP feature contributions on explain', async () => {
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

  it('never loads case transactions or turns them into PaySim inputs', async () => {
    const getCaseTransactions = vi.spyOn(api, 'getCaseTransactions');
    render(
      <MemoryRouter initialEntries={['/tools/transaction-model?caseId=FS-1042&txId=T003']}>
        <TransactionCheckPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/It cannot score\s+transactions from the sample cases/i)).toBeInTheDocument();
    expect(getCaseTransactions).not.toHaveBeenCalled();
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
    // The form keeps its own example values; a case transfer ID in the URL is ignored.
    expect((document.querySelector('#risk-amount-input') as HTMLInputElement).value).toBe('250000');
  });
});
