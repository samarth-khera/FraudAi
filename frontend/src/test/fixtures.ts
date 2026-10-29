import {
  AccountAssessmentResponse,
  AuditTrailResponse,
  CaseAccountAssessmentsResponse,
  FraudCase,
  GraphResponse,
  TraceResult,
  TracedTransaction,
} from '../types/api';
import { V2AccountAssessmentResponse, V2AccountMLAssessmentResponse, V2AccountProfileResponse, V2ModelStatusResponse } from '../types/v2';

export const tx = (id: string, ts: string, from: string, to: string, amount: number, type: string, hop: number): TracedTransaction => ({
  transaction_id: id,
  timestamp: ts,
  sender_account_id: from,
  receiver_account_id: to,
  amount,
  currency: 'INR',
  transaction_type: type,
  hop_count: hop,
  attributed_amount: hop === 0 ? amount : null,
  is_cycle_closing: false,
});

export const TXNS = [
  tx('TXN-0062181', '2026-01-16T10:15:00', 'ACC-000001', 'ACC-000003', 250000, 'IMPS', 0),
  tx('TXN-0062200', '2026-01-16T10:23:00', 'ACC-000003', 'ACC-000002', 120000, 'UPI', 1),
  tx('TXN-0062205', '2026-01-16T10:25:00', 'ACC-000003', 'ACC-000005', 125000, 'UPI', 1),
];

export function makeCase(over: Partial<FraudCase> = {}): FraudCase {
  return {
    case_id: 'FS-2001',
    reported_origin_transaction_id: 'TXN-0062181',
    reported_amount: 250000,
    currency: 'INR',
    reported_at: '2026-01-16T11:40:00',
    investigation_status: 'open',
    description: 'Sample complaint: customer ACC-000001 reports being persuaded by a caller to send 250,000 INR. More text.',
    updated_at: '2026-10-28T16:58:03',
    account_dataset: 'v2_synthetic_ledger',
    dataset_note: 'Transactions in this case are copied from the synthetic account ledger.',
    review_progress: { accounts_in_case: 4, decisions_recorded: 0, last_decision_at: null },
    ...over,
  };
}

export function makeTrace(): TraceResult {
  return {
    case_id: 'FS-2001',
    origin_transaction_id: 'TXN-0062181',
    summary: {
      reported_amount: 250000,
      traceable_amount: 250000,
      located_amount: 0,
      unlocated_amount: 250000,
      gross_observed_transaction_value: 495000,
      linked_account_count: 3,
      traced_transaction_count: 3,
      path_count: 2,
      truncated: false,
      cycles_detected: false,
      uncertain_account_ids: ['ACC-000003', 'ACC-000002', 'ACC-000005'],
    },
    linked_accounts: [],
    traced_transactions: TXNS,
    paths: [],
    warnings: [],
    disclaimer: 'Synthetic',
  };
}

export function makeGraph(): GraphResponse {
  const node = (id: string, role: any, hop: number | null) => ({
    id,
    label: id,
    role,
    is_synthetic: true,
    hop_count: hop,
    review_state: null,
    evidence_quality: null,
    attributed_unforwarded_amount: null,
    attribution_status: null,
  });
  return {
    case_id: 'FS-2001',
    nodes: [
      node('ACC-000001', 'reporting_victim', null),
      node('ACC-000003', 'reported_initial_receiver', 0),
      node('ACC-000002', 'recipient', 1),
      node('ACC-000005', 'recipient', 1),
    ],
    edges: TXNS.map((t) => ({
      id: t.transaction_id,
      source: t.sender_account_id,
      target: t.receiver_account_id,
      amount: t.amount,
      currency: 'INR',
      transaction_type: t.transaction_type,
      timestamp: t.timestamp,
      hop_count: t.hop_count,
      attributed_amount: t.attributed_amount,
      is_cycle_closing: false,
    })),
    meta: { node_count: 4, edge_count: 3, cycles_detected: false },
    disclaimer: 'Synthetic',
  };
}

export function makeAssessment(
  accountId: string,
  role: AccountAssessmentResponse['graph_position']['role'],
  hop: number | null,
  inbound: TracedTransaction[],
  outbound: TracedTransaction[],
  review: Partial<AccountAssessmentResponse['review_status']> = {}
): AccountAssessmentResponse {
  return {
    case_id: 'FS-2001',
    account_id: accountId,
    graph_position: {
      account_id: accountId,
      label: accountId,
      role,
      is_synthetic: true,
      in_traced_network: true,
      connection_type: 'direct',
      hop_count: hop,
      upstream_account_ids: [],
      downstream_account_ids: [],
      path_ids: [],
      first_received_at: inbound[0]?.timestamp ?? null,
      last_observed_activity_at: null,
    },
    observed_movement: {
      observed_inbound_value: inbound.reduce((s, t) => s + t.amount, 0),
      observed_outbound_value: outbound.reduce((s, t) => s + t.amount, 0),
      traced_inbound_count: inbound.length,
      traced_outbound_count: outbound.length,
      traced_inbound_transactions: inbound,
      traced_outbound_transactions: outbound,
      other_observed_inbound_count: 0,
      other_observed_outbound_count: 0,
      movement_note: '',
    },
    traceable_exposure: {
      reported_case_amount: 250000,
      case_traceable_amount: 250000,
      gross_network_observed_value: 495000,
      attributed_inbound_amount: null,
      attributed_outbound_amount: null,
      attributed_unforwarded_amount: null,
      attribution_status: 'uncertain_missing_lineage',
      attribution_basis: null,
      attribution_assumptions: [],
      double_counting_safeguard: '',
    },
    observed_signals:
      accountId === 'ACC-000003'
        ? [
            {
              code: 'rapid_pass_through',
              title: 'Rapid Outbound Forwarding Observed',
              description: 'Outbound transfer TXN-0062200 occurred 8.0 minute(s) after inbound transfer TXN-0062181.',
              related_transaction_ids: ['TXN-0062181', 'TXN-0062200'],
              interpretation_note: 'Timing alone does not establish account-holder intent.',
            },
          ]
        : [],
    paths_involving_account: [],
    evidence_assessment: {
      evidence_sufficiency: 'insufficient_evidence',
      supporting_evidence: [],
      evidence_gaps: ['No corroborated external documentation has been recorded yet.'],
      uncertainty_factors: [],
      verification_guidance: ['Obtain ledger balance history.'],
      recommended_review_state: 'under_review',
      recommendation_rationale: '',
    },
    review_status: {
      case_id: 'FS-2001',
      account_id: accountId,
      review_state: role === 'reporting_victim' ? 'reporting_victim' : 'not_reviewed',
      evidence_quality: 'not_assessed',
      reviewer_id: 'system_seeder',
      automated_action_taken: 'none',
      ...review,
    },
    audit_history: [],
    warnings: [],
    transaction_risk_separation_note: '',
    automated_action_taken: 'none',
    decision_support_only: true,
    disclaimer: '',
  };
}

export function makeAssessments(): CaseAccountAssessmentsResponse {
  return {
    case_id: 'FS-2001',
    count: 4,
    disclaimer: '',
    assessments: [
      makeAssessment('ACC-000001', 'reporting_victim', null, [], [TXNS[0]]),
      makeAssessment('ACC-000003', 'reported_initial_receiver', 0, [TXNS[0]], [TXNS[1], TXNS[2]]),
      makeAssessment('ACC-000002', 'recipient', 1, [TXNS[1]], []),
      makeAssessment('ACC-000005', 'recipient', 1, [TXNS[2]], []),
    ],
  };
}

export function makeAudit(): AuditTrailResponse {
  return {
    case_id: 'FS-2001',
    count: 3,
    events: [
      { event_id: 1, case_id: 'FS-2001', timestamp: '2026-10-28T10:00:00', action: 'case_created', performed_by: 'system_seeder', entity_type: 'case', entity_id: 'FS-2001', details: {} },
      { event_id: 2, case_id: 'FS-2001', timestamp: '2026-10-28T10:00:01', action: 'trace_paths_persisted', performed_by: 'tracer_service', entity_type: 'trace_paths', entity_id: 'FS-2001', details: { path_count: 2 } },
      {
        event_id: 3,
        case_id: 'FS-2001',
        timestamp: '2026-10-28T11:00:00',
        action: 'account_review_recorded',
        performed_by: 'analyst_1',
        entity_type: 'account_review',
        entity_id: 'FS-2001:ACC-000002',
        details: { account_id: 'ACC-000002', old_review_state: 'not_reviewed', new_review_state: 'under_review', notes: 'Waiting for statements', reviewer_identity_verified: false },
      },
    ],
  };
}

export const PROFILE: V2AccountProfileResponse = {
  account_id: 'ACC-000003',
  customer_name: 'Ishan Reddy',
  customer_type: 'retail',
  kyc_tier: 'tier_2_verified',
  phone_number: '+91 ••••',
  email: 'i•••@example.com',
  upi_id: 'x@upi',
  tax_identifier: '••••',
  initial_balance: 44287,
  current_balance: 107228,
  account_opened_at: '2025-06-01T00:00:00',
  status: 'active',
  metrics: {
    total_incoming_txns: 20,
    total_outgoing_txns: 34,
    total_incoming_amount: 0,
    total_outgoing_amount: 0,
    net_flow: 0,
    unique_counterparties: 54,
    first_activity_at: '2026-01-01T00:00:00',
    last_activity_at: '2026-03-30T00:00:00',
  },
};

export const RULES: V2AccountAssessmentResponse = {
  account_id: 'ACC-000003',
  risk_score: 62,
  risk_level: 'elevated',
  signals: {} as any,
  reason_codes: [],
  evidence_gaps: [],
  uncertainty_rating: 'medium',
  recommendation: '',
  disclaimer: '',
};

export const ML: V2AccountMLAssessmentResponse = {
  account_id: 'ACC-000003',
  risk_score: 10.1,
  risk_level: 'low',
  predicted_probability: 0.101,
  predicted_class: 'legitimate',
  model_version: 'v2-account-1.0.0',
  model_type: 'XGBClassifier',
  top_contributions: [
    { feature_name: 'max_amount', feature_value: 250000, contribution_score: 3.65, impact_direction: 'increases_risk' },
    { feature_name: 'initial_balance', feature_value: 44287.15, contribution_score: -1.45, impact_direction: 'decreases_risk' },
  ],
  observable_features: {},
  disclaimer: '',
};

export const MODEL_STATUS: V2ModelStatusResponse = {
  account_model: {
    available: true,
    version: 'v2-account-1.0.0',
    model_type: 'XGBClassifier',
    features_count: 26,
    trained_at: null,
    test_metrics: { precision: 0.3263, recall: 0.5346, threshold: 0.1752 },
    limitations: null,
    dataset_info: { test_suspicious_count: 260, test_normal_count: 3919 },
    decision_threshold: 0.1752,
    operational_notes: { demo_ledger_flag_rate_ordinary: 0.0543 },
  },
  paysim_benchmark: { available: true, version: 'b', model_type: null, features_count: null, trained_at: null, test_metrics: null, limitations: null },
  overall_status: 'healthy',
  inference_ready: true,
  disclaimer: '',
};
