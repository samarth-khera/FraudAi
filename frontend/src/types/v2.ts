/**
 * TypeScript definitions for FraudShield AI V2 Forensic APIs.
 */

export interface V2SummaryMetrics {
  total_incoming_txns: number;
  total_outgoing_txns: number;
  total_incoming_amount: number;
  total_outgoing_amount: number;
  net_flow: number;
  unique_counterparties: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
}

export interface V2AccountProfile {
  account_id: string;
  customer_name: string;
  customer_type: 'retail' | 'student' | 'sme' | 'corporate' | string;
  kyc_tier: 'tier_1_basic' | 'tier_2_verified' | 'tier_3_enhanced' | string;
  phone_number: string;
  email: string;
  upi_id: string;
  tax_identifier: string;
  initial_balance: number;
  current_balance: number;
  account_opened_at: string;
  status: string;
  metrics: V2SummaryMetrics;
}

export type V2AccountProfileResponse = V2AccountProfile;

export interface V2TransactionItem {
  transaction_id: string;
  timestamp: string;
  origin_account_id: string;
  destination_account_id: string;
  amount: number;
  currency: string;
  channel: string;
  status: string;
  origin_balance_before: number;
  origin_balance_after: number;
  dest_balance_before: number;
  dest_balance_after: number;
  direction: 'inbound' | 'outbound';
  counterparty_account_id: string;
}

export interface V2AccountTransactionsResponse {
  account_id: string;
  total: number;
  limit: number;
  offset: number;
  transactions: V2TransactionItem[];
}

export interface V2RiskSignalValues {
  total_transactions: number;
  velocity_24h_count: number;
  velocity_7d_count: number;
  velocity_30d_count: number;
  flow_through_ratio: number;
  rapid_pass_through: boolean;
  median_dwell_minutes: number | null;
  max_amount: number;
  avg_amount: number;
  amount_spike_ratio: number;
  unique_counterparties: number;
  counterparty_diversity_ratio: number;
  fan_in_ratio: number;
  fan_out_ratio: number;
  dormancy_gap_days: number | null;
  dormant_awakening_detected: boolean;
  cycle_detected: boolean;
}

export interface V2AccountAssessmentResponse {
  account_id: string;
  risk_score: number;
  risk_level: 'low' | 'elevated' | 'high' | 'critical';
  signals: V2RiskSignalValues;
  reason_codes: string[];
  evidence_gaps: string[];
  uncertainty_rating: 'low' | 'medium' | 'high';
  recommendation: string;
  disclaimer: string;
}

export interface V2FeatureContribution {
  feature_name: string;
  feature_value: number;
  contribution_score: number;
  impact_direction: 'increases_risk' | 'decreases_risk';
}

export interface V2AccountMLAssessmentResponse {
  account_id: string;
  risk_score: number;
  risk_level: 'low' | 'elevated' | 'high' | 'critical';
  predicted_probability: number;
  predicted_class: 'suspicious' | 'legitimate';
  model_version: string;
  model_type: string;
  top_contributions: V2FeatureContribution[];
  observable_features: Record<string, number>;
  disclaimer: string;
}

export interface V2SingleModelInfo {
  available: boolean;
  version: string | null;
  model_type: string | null;
  features_count: number | null;
  trained_at: string | null;
  test_metrics: Record<string, any> | null;
  limitations: string | null;
  feature_importances?: Record<string, number> | null;
  dataset_info?: Record<string, any> | null;
  baseline_comparison?: Record<string, any> | null;
  leakage_protections?: string[] | null;
  features?: string[] | null;
  /** Review threshold selected on validation data (0-1). Scores at or above it are "suspicious". */
  decision_threshold?: number | null;
  score_semantics?: string | null;
  operational_notes?: {
    demo_ledger_ordinary_accounts?: number;
    demo_ledger_flag_rate_ordinary?: number;
    demo_ledger_positive_accounts?: number;
    demo_ledger_positives_flagged?: number;
    demo_ledger_precision?: number;
    note?: string;
  } | null;
}

export interface V2ModelStatusResponse {
  account_model: V2SingleModelInfo;
  paysim_benchmark: V2SingleModelInfo;
  overall_status: string;
  inference_ready: boolean;
  status_detail?: string | null;
  disclaimer: string;
}

export interface V2GraphNode {
  account_id: string;
  customer_name: string;
  customer_type: string;
  kyc_tier: string;
  current_balance: number;
  hop_distance: number;
  is_root: boolean;
}

export interface V2GraphEdge {
  transaction_id: string;
  origin_account_id: string;
  destination_account_id: string;
  amount: number;
  currency: string;
  channel: string;
  timestamp: string;
  hop: number;
  is_cycle: boolean;
}

export interface V2TraceGraphResponse {
  root_account_id: string;
  direction: 'outgoing' | 'incoming' | 'both';
  max_depth_configured: number;
  max_depth_reached: number;
  nodes: V2GraphNode[];
  edges: V2GraphEdge[];
  total_nodes: number;
  total_edges: number;
  is_truncated: boolean;
  truncation_reason: string | null;
  observed_total_transferred: number;
  attributed_exposure_upper_bound: number;
  attribution_status: string;
  attribution_disclaimer: string;
}

export interface V2RecommendedAction {
  action_id: string;
  title: string;
  priority: 'high_priority' | 'recommended' | 'routine' | 'more_evidence_needed';
  action_type: string;
  rationale: string;
  supporting_evidence: string;
  suggested_records: string;
  remaining_uncertainty: string;
}

export interface V2LedgerSnapshotInfo {
  transactions_examined: number;
  latest_transaction_timestamp: string | null;
  first_transaction_timestamp: string | null;
  total_received: number;
  total_sent: number;
  current_balance: number;
}

export interface V2ModelDivergenceInfo {
  divergence_detected: boolean;
  ml_score: number;
  rule_score: number;
  score_delta: number;
  interpretation: string;
  suggested_focus: string;
}

export interface V2AccountLiveAnalysisResponse {
  analysis_id: string;
  account_id: string;
  analyzed_at: string;
  model_version: string;
  ledger_snapshot: V2LedgerSnapshotInfo;
  rule_assessment: V2AccountAssessmentResponse;
  ml_assessment: V2AccountMLAssessmentResponse;
  divergence: V2ModelDivergenceInfo;
  recommended_actions: V2RecommendedAction[];
  evidence_gaps: string[];
  human_review_recommended: boolean;
  disclaimer: string;
}

