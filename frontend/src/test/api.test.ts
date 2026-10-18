import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from '../services/api';

describe('API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles successful API responses correctly', async () => {
    const mockHealth = { status: 'ok', service: 'fraudshield-ai-backend', phase: '1-synthetic' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockHealth,
    } as Response);

    const res = await api.getHealth();
    expect(res).toEqual(mockHealth);
    expect(global.fetch).toHaveBeenCalledWith(
      '/health',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('throws ApiError with extracted code and message on error responses', async () => {
    const errorBody = {
      error: {
        code: 'case_not_found',
        message: "Case 'FS-9999' not found.",
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => errorBody,
    } as Response);

    await expect(api.getCase('FS-9999')).rejects.toThrow(ApiError);
    await expect(api.getCase('FS-9999')).rejects.toMatchObject({
      code: 'case_not_found',
      message: "Case 'FS-9999' not found.",
    });
  });

  it('calls POST /api/risk/explain with validated payload and returns feature contributions', async () => {
    const mockExplain = {
      risk_score: 0.9999,
      threshold: 0.5,
      review_recommended: true,
      model_version: 'model_v1',
      feature_set: 'candidate_no_post_balance',
      decision_support_only: true,
      automated_action_taken: 'none',
      explanation_method: 'TreeSHAP (XGBoost pred_contribs on log-odds margin)',
      prediction_scale: 'log_odds',
      base_value: -7.52,
      raw_margin: 9.81,
      feature_contributions: [
        {
          feature: 'amount_to_orig_balance_ratio',
          label: 'Amount-to-Sender-Balance Ratio',
          value: 1.0,
          contribution: 11.4,
          direction: 'increases_risk' as const,
          encoding: 'numeric' as const,
        },
      ],
      encoded_contributions: [],
      representation_notes: 'One-hot encoded type indicators summed.',
      limitations: ['Statistical signal only.'],
      disclaimer: 'Decision support only.',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockExplain,
    } as Response);

    const payload = {
      step: 1,
      type: 'TRANSFER',
      amount: 50000,
      oldbalanceOrg: 50000,
      oldbalanceDest: 0,
    };
    const res = await api.explainRisk(payload);
    expect(res.explanation_method).toContain('TreeSHAP');
    expect(res.feature_contributions[0].feature).toBe('amount_to_orig_balance_ratio');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/risk/explain',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    );
  });

  it('calls GET /api/cases/{caseId}/accounts/{accountId}/assessment and returns evidence assessment', async () => {
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
        observed_inbound_value: 30000,
        observed_outbound_value: 0,
        traced_inbound_count: 1,
        traced_outbound_count: 0,
        traced_inbound_transactions: [],
        traced_outbound_transactions: [],
        other_observed_inbound_count: 0,
        other_observed_outbound_count: 0,
        movement_note: 'Gross ledger movement.',
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
        double_counting_safeguard: 'Never sum downstream hops.',
      },
      observed_signals: [],
      paths_involving_account: [],
      evidence_assessment: {
        evidence_sufficiency: 'scenario_lineage_assumed',
        supporting_evidence: [],
        evidence_gaps: ['No external KYC verified.'],
        uncertainty_factors: ['Synthetic scenario metadata.'],
        verification_guidance: ['Verify merchant invoice before any manual action.'],
        recommended_review_state: 'under_review' as const,
        recommendation_rationale: 'Verify commercial invoice.',
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
      transaction_risk_separation_note: 'Model score is separate from account evidence.',
      automated_action_taken: 'none',
      decision_support_only: true,
      disclaimer: 'Do not automatically freeze accounts.',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockAssessment,
    } as Response);

    const res = await api.getAccountAssessment('FS-1042', 'ACC-MERCH-301');
    expect(res.account_id).toBe('ACC-MERCH-301');
    expect(res.traceable_exposure.attributed_unforwarded_amount).toBe(30000);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cases/FS-1042/accounts/ACC-MERCH-301/assessment?max_depth=10',
      expect.any(Object)
    );
  });
});

