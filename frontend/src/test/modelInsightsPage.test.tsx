import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ModelInsightsPage } from '../pages/ModelInsightsPage';
import { v2Api } from '../services/v2Api';
import { V2ModelStatusResponse, V2AccountMLAssessmentResponse } from '../types/v2';

const mockModelStatusResponse: V2ModelStatusResponse = {
  overall_status: 'healthy',
  inference_ready: true,
  disclaimer: 'Decision support only. Automated account freezing is strictly prohibited.',
  account_model: {
    available: true,
    version: 'v2-account-1.0.0',
    model_type: 'XGBClassifier (Tabular Gradient Boosting)',
    features_count: 26,
    trained_at: '2026-10-20T14:56:12Z',
    test_metrics: {
      threshold: 0.5,
      precision: 0.5,
      recall: 0.3333,
      f1_score: 0.4,
      roc_auc: 0.9945,
      pr_auc: 0.4642,
      confusion_matrix: [
        [1992, 2],
        [4, 2],
      ],
      true_negatives: 1992,
      false_positives: 2,
      false_negatives: 4,
      true_positives: 2,
    },
    limitations: 'Trained on synthetic banking network scenarios. Provides advisory decision-support only.',
    feature_importances: {
      velocity_30d_count: 0.2192,
      customer_type_student: 0.1121,
      max_amount: 0.1099,
      initial_balance: 0.1011,
      rapid_pass_through: 0.0644,
      amount_spike_ratio: 0.0521,
      avg_amount: 0.0508,
      total_transactions: 0.0431,
    },
    dataset_info: {
      source: 'V2 Synthetic Banking Ledger (SQLite)',
      strategy: 'Group-Aware Scenario Separation',
      train_accounts_count: 8000,
      test_accounts_count: 2000,
      test_suspicious_count: 6,
      test_normal_count: 1994,
      held_out_test_scenarios: ['SCENARIO-APP-001', 'SCENARIO-DORMANT-005'],
    },
    baseline_comparison: {
      baseline_name: 'Phase 3 Deterministic Rule Assessor',
      threshold: 50.0,
      precision: 0.0325,
      recall: 0.8333,
      f1_score: 0.0625,
    },
    leakage_protections: [
      'ground_truth_label strictly excluded from model inputs.',
      'scenario_id strictly excluded from model inputs.',
      'PII strictly excluded from model inputs.',
    ],
    features: ['velocity_30d_count', 'customer_type_student', 'max_amount'],
  },
  paysim_benchmark: {
    available: true,
    version: 'v2-benchmark-1.0.0',
    model_type: 'PaySim Transaction Benchmark (XGBoost)',
    features_count: 14,
    trained_at: '2026-10-20T14:54:45Z',
    test_metrics: {
      threshold: 0.65,
      precision: 0.9978,
      recall: 0.9993,
      f1_score: 0.9985,
      roc_auc: 1.0,
      pr_auc: 0.9999,
      confusion_matrix: [
        [89460, 3],
        [1, 1365],
      ],
      true_negatives: 89460,
      false_positives: 3,
      false_negatives: 1,
      true_positives: 1365,
    },
    limitations: 'PaySim dataset benchmark only. This model is trained on synthetic mobile money logs from 2017.',
    feature_importances: {
      amount_to_oldbalanceOrg_ratio: 0.3974,
      step_hour: 0.2255,
      type_PAYMENT: 0.1468,
      type_TRANSFER: 0.1026,
    },
    dataset_info: {
      source: 'PaySim Academic Mobile Money Simulation (Kaggle)',
      dataset_path: 'data/raw/PS_20174392719_1491204439457_log.csv',
      chronological_split: {
        train_steps: '1..500',
        val_steps: '501..620',
        test_steps: '621..743',
      },
    },
    baseline_comparison: null,
    leakage_protections: [
      'newbalanceOrig (post-transaction balance leakage)',
      'newbalanceDest (post-transaction balance leakage)',
    ],
    features: ['amount', 'step', 'type_TRANSFER'],
  },
};

const mockDrillAssessment: V2AccountMLAssessmentResponse = {
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
      feature_value: 250000,
      contribution_score: 3.9147,
      impact_direction: 'increases_risk',
    },
    {
      feature_name: 'initial_balance',
      feature_value: 300000,
      contribution_score: 1.1385,
      impact_direction: 'increases_risk',
    },
    {
      feature_name: 'current_balance',
      feature_value: 177156.23,
      contribution_score: -0.2986,
      impact_direction: 'decreases_risk',
    },
  ],
  observable_features: {
    max_amount: 250000,
    initial_balance: 300000,
    current_balance: 177156.23,
  },
  disclaimer: 'Decision support only. Automated account freezing is strictly prohibited.',
};

describe('ModelInsightsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(v2Api, 'getModelsStatus').mockResolvedValue(mockModelStatusResponse);
    vi.spyOn(v2Api, 'getMLAssessment').mockResolvedValue(mockDrillAssessment);
  });

  it('renders header, live status, and 3 architecture tabs', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Model Insights')).toBeInTheDocument();
    expect(screen.getByText('MODEL INTELLIGENCE')).toBeInTheDocument();
    expect(screen.getByText(/Understand model performance, prediction drivers/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Status: Healthy')).toBeInTheDocument();
      expect(screen.getByText('Inference Ready')).toBeInTheDocument();
    });

    expect(screen.getByText('V2 Account-Level Fraud Model')).toBeInTheDocument();
    expect(screen.getByText('Transaction-Level PaySim Benchmark')).toBeInTheDocument();
    expect(screen.getByText('Model Comparison & Scope')).toBeInTheDocument();
  });

  it('renders V2 Account Model performance metrics and confusion matrix', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('0.9945')).toBeInTheDocument(); // ROC-AUC
      expect(screen.getByText('0.4642')).toBeInTheDocument(); // PR-AUC
      expect(screen.getByText('50.0%')).toBeInTheDocument(); // Precision
      expect(screen.getByText('33.3%')).toBeInTheDocument(); // Recall
      expect(screen.getByText('0.400')).toBeInTheDocument(); // F1 Score
    });

    // Confusion matrix counts
    expect(screen.getByText('1,992')).toBeInTheDocument(); // TN
    expect(screen.getByText('True Negatives')).toBeInTheDocument();
    expect(screen.getByText('False Positives')).toBeInTheDocument();
    expect(screen.getByText('Missed Fraud')).toBeInTheDocument();
    expect(screen.getByText('Correctly Flagged')).toBeInTheDocument();
  });

  it('renders global feature importance ranked list', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('0.9945')).toBeInTheDocument();
    });

    expect(screen.getByText(/WHAT INFLUENCES PREDICTIONS/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Global Feature Importance/i).length).toBeGreaterThan(0);
    expect(screen.getByText('30-Day Transfer Frequency')).toBeInTheDocument();
    expect(screen.getByText('21.9%')).toBeInTheDocument();
    expect(screen.getByText('Student Account Indicator')).toBeInTheDocument();
    expect(screen.getByText('11.2%')).toBeInTheDocument();
  });

  it('switches to PaySim Benchmark tab and renders its metrics and confusion matrix', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('V2 Account-Level Fraud Model')).toBeInTheDocument();
    });

    // Switch to PaySim tab
    const paySimTab = screen.getByText('Transaction-Level PaySim Benchmark');
    fireEvent.click(paySimTab);

    await waitFor(() => {
      expect(screen.getByText('0.9999')).toBeInTheDocument(); // PR-AUC
      expect(screen.getByText('99.8%')).toBeInTheDocument(); // Precision (0.9978 -> 99.8%)
      expect(screen.getByText('99.9%')).toBeInTheDocument(); // Recall (0.9993 -> 99.9%)
      expect(screen.getByText('0.999')).toBeInTheDocument(); // F1 (0.9985 -> 0.999)
    });

    // PaySim confusion matrix
    expect(screen.getByText('89,460')).toBeInTheDocument();
    expect(screen.getByText('1,365')).toBeInTheDocument();
  });

  it('switches to Comparison Matrix tab and displays side-by-side comparison', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Comparison & Scope')).toBeInTheDocument();
    });

    const compTab = screen.getByText('Model Comparison & Scope');
    fireEvent.click(compTab);

    await waitFor(() => {
      expect(screen.getByText('Architecture & Scope Comparison Matrix')).toBeInTheDocument();
      expect(screen.getByText('Evaluation Dimension')).toBeInTheDocument();
      expect(screen.getByText('Group-Aware Scenario Separation (Zero scenario overlap)')).toBeInTheDocument();
      expect(screen.getByText('Chronological Time-Split (Steps 1..500 train, 621..743 test)')).toBeInTheDocument();
    });
  });

  it('renders interactive TreeSHAP local explainability drill-down', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('LOCAL EXPLAINABILITY')).toBeInTheDocument();
      expect(screen.getByText('Individual Account Prediction Explanation')).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.getByText('76.5 / 100')).toBeInTheDocument();
        expect(screen.getByText('SUSPICIOUS')).toBeInTheDocument();
        expect(screen.getByText('+3.9147')).toBeInTheDocument();
        expect(screen.getAllByText('+ INCREASES RISK').length).toBeGreaterThan(0);
        expect(screen.getAllByText('- DECREASES RISK').length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );
  });

  it('handles refresh action and calls getModelsStatus', async () => {
    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Refresh Models')).toBeInTheDocument();
    });

    const refreshBtn = screen.getByText('Refresh Models');
    fireEvent.click(refreshBtn);

    expect(v2Api.getModelsStatus).toHaveBeenCalledTimes(2);
  });

  it('handles API error state gracefully', async () => {
    vi.spyOn(v2Api, 'getModelsStatus').mockRejectedValueOnce(new Error('Network connection timeout'));

    render(
      <MemoryRouter>
        <ModelInsightsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Registry Communication Issue')).toBeInTheDocument();
      expect(screen.getByText('Network connection timeout')).toBeInTheDocument();
    });
  });
});
