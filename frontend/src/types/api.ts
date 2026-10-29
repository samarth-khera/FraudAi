/**
 * Exact TypeScript definitions matching backend FastAPI schemas and domain models.
 */

export type TransactionType = 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'ATM_CASH_OUT' | 'OTHER' | 'TRANSFER' | 'CASH_OUT' | 'PAYMENT' | 'CASH_IN' | 'DEBIT';

export type InvestigationStatus = 'open' | 'under_investigation' | 'closed';

export type AccountRole =
  | 'reporting_victim'
  | 'reported_initial_receiver'
  | 'intermediate_recipient'
  | 'recipient'
  | 'unknown';

export type ReviewState =
  | 'not_reviewed'
  | 'reporting_victim'
  | 'under_investigation'
  | 'under_review'
  | 'review_completed';

export type EvidenceQuality =
  | 'not_assessed'
  | 'graph_connection_only'
  | 'synthetic_assumption'
  | 'corroborated';

export interface CaseLinkage {
  case_id: string;
  linkage_type: string;
}

export interface SyntheticLineage {
  case_id: string;
  attributed_amount: number;
  basis: string;
  note?: string | null;
}

export interface Transaction {
  transaction_id: string;
  timestamp: string;
  sender_account_id: string;
  receiver_account_id: string;
  amount: number;
  currency: string;
  transaction_type: string;
  case_linkage?: CaseLinkage | null;
  synthetic_lineage_metadata?: SyntheticLineage | null;
}

export interface FraudCase {
  case_id: string;
  reported_origin_transaction_id: string;
  reported_amount: number;
  currency: string;
  reported_at: string;
  investigation_status: InvestigationStatus;
  description: string;
  created_at?: string;
  updated_at?: string | null;
  /** 'case_ledger': accounts exist only in this case's records. 'v2_synthetic_ledger': accounts are synthetic-ledger records. */
  account_dataset?: 'case_ledger' | 'v2_synthetic_ledger' | string;
  dataset_note?: string;
  review_progress?: CaseReviewProgress | null;
}

export interface CaseReviewProgress {
  accounts_in_case: number;
  decisions_recorded: number;
  last_decision_at: string | null;
}

export interface CaseListResponse {
  count: number;
  total: number;
  skip: number;
  limit: number;
  cases: FraudCase[];
}

export interface TransactionListResponse {
  case_id: string;
  count: number;
  transactions: Transaction[];
  warnings?: string[];
}

export interface Account {
  account_id: string;
  label: string;
  role: AccountRole;
  is_synthetic: boolean;
}

export interface AccountReviewStatus {
  case_id: string;
  account_id: string;
  review_state: ReviewState;
  evidence_quality: EvidenceQuality;
  notes?: string | null;
  reviewer_id?: string | null;
  decision_reasons?: string[];
  supporting_transaction_ids?: string[];
  additional_info_needed?: boolean;
  automated_action_taken: string;
}

export interface AuditEvent {
  event_id?: number | null;
  case_id: string;
  timestamp: string;
  action: string;
  performed_by: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, any> | null;
}

export interface AuditTrailResponse {
  case_id: string;
  count: number;
  events: AuditEvent[];
}

export interface AuditSummaryMetrics {
  total_events: number;
  review_decisions_count: number;
  case_status_changes_count: number;
  trace_events_count: number;
  most_recent_timestamp: string | null;
  earliest_timestamp: string | null;
  distinct_cases_count: number;
  distinct_actors_count: number;
}

export interface AuditIntegrityStatus {
  storage_backend: string;
  append_only_enforced: boolean;
  cryptographic_signatures: boolean;
  server_timestamps: boolean;
  last_verified_at: string;
  integrity_disclosure: string;
}

export interface GlobalAuditResponse {
  total_count: number;
  filtered_count: number;
  skip: number;
  limit: number;
  events: AuditEvent[];
  summary: AuditSummaryMetrics;
  integrity_status: AuditIntegrityStatus;
}

export interface AuditQueryParams {
  case_id?: string;
  action?: string;
  category?: 'reviews' | 'case_changes' | 'traces' | 'transactions' | 'all';
  performed_by?: string;
  entity_type?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  skip?: number;
  limit?: number;
  sort_order?: 'desc' | 'asc';
}

export interface GraphNode {
  id: string;
  label: string;
  role: AccountRole;
  is_synthetic: boolean;
  hop_count: number | null;
  connection_type?: string | null;
  review_state: ReviewState | null;
  evidence_quality: EvidenceQuality | null;
  attributed_unforwarded_amount: number | null;
  attribution_status: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  amount: number;
  currency: string;
  transaction_type: string;
  timestamp: string;
  hop_count: number | null;
  attributed_amount: number | null;
  is_cycle_closing: boolean;
  attribution_basis?: string | null;
}

export interface GraphResponse {
  case_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    node_count: number;
    edge_count: number;
    cycles_detected: boolean;
    origin_transaction_id?: string;
    max_depth?: number;
    truncated?: boolean;
    amounts_note?: string;
  };
  disclaimer: string;
}

export interface TraceSummary {
  reported_amount: number;
  currency?: string;
  traceable_amount: number;
  located_amount: number;
  unlocated_amount: number;
  gross_observed_transaction_value: number;
  linked_account_count: number;
  traced_transaction_count?: number;
  path_count: number;
  max_depth?: number;
  truncated: boolean;
  cycles_detected: boolean;
  uncertain_account_ids?: string[];
}

export interface LinkedAccountExposure {
  observed_inbound_value: number;
  observed_outbound_value: number;
  attributed_inbound_amount: number | null;
  attributed_outbound_amount: number | null;
  attributed_unforwarded_amount: number | null;
  attribution_status: string;
}

export interface LinkedAccount {
  account_id: string;
  label?: string | null;
  role?: AccountRole;
  connection_type: string;
  hop_count: number;
  first_received_at?: string;
  inbound_transaction_ids: string[];
  outbound_transaction_ids: string[];
  path_ids?: string[];
  exposure: LinkedAccountExposure;
  review?: {
    review_state: ReviewState;
    evidence_quality: EvidenceQuality;
    automated_action_taken: string;
    notes?: string | null;
    reviewer_id?: string | null;
    decision_reasons?: string[];
    supporting_transaction_ids?: string[];
    additional_info_needed?: boolean;
  } | null;
}

export interface FundTracePath {
  path_id: string;
  account_ids: string[];
  transaction_ids: string[];
  transaction_amounts: number[];
  hop_count: number;
  started_at: string;
  ended_at: string;
  terminal_account_id: string;
  termination_reason: string;
  max_attributable_amount: number | null;
  attribution_status: string;
}

export interface TraceWarning {
  code: string;
  message: string;
  transaction_id?: string | null;
  account_id?: string | null;
}

export interface TracedTransaction {
  transaction_id: string;
  timestamp: string;
  sender_account_id: string;
  receiver_account_id: string;
  amount: number;
  currency: string;
  transaction_type: string;
  hop_count: number;
  attributed_amount: number | null;
  attribution_basis?: string | null;
  attribution_note?: string | null;
  is_cycle_closing: boolean;
}

export interface TraceResult {
  case_id: string;
  origin_transaction_id?: string;
  summary: TraceSummary;
  linked_accounts: LinkedAccount[];
  traced_transactions?: TracedTransaction[];
  paths: FundTracePath[];
  warnings: (TraceWarning | string)[];
  disclaimer: string;
}

export interface RiskScoreRequest {
  step: number;
  type: string;
  amount: number;
  oldbalanceOrg: number;
  oldbalanceDest: number;
}

export interface RiskScoreResponse {
  risk_score: number;
  threshold: number;
  review_recommended: boolean;
  model_version: string;
  feature_set: string;
  decision_support_only: boolean;
  automated_action_taken: string;
  disclaimer: string;
}

export type ContributionDirection = 'increases_risk' | 'decreases_risk' | 'neutral';
export type EncodingKind = 'one_hot_summed' | 'numeric';

export interface FeatureContribution {
  feature: string;
  label: string;
  value: number | string;
  contribution: number;
  direction: ContributionDirection;
  encoding: EncodingKind;
}

export interface EncodedFeatureContribution {
  feature: string;
  encoded_value: number;
  contribution: number;
}

export interface RiskExplainResponse extends RiskScoreResponse {
  explanation_method: string;
  prediction_scale: string;
  base_value: number;
  raw_margin: number;
  feature_contributions: FeatureContribution[];
  encoded_contributions: EncodedFeatureContribution[];
  representation_notes: string;
  limitations: string[];
}

export interface AccountGraphPosition {
  account_id: string;
  label: string;
  role: AccountRole;
  is_synthetic: boolean;
  in_traced_network: boolean;
  connection_type: string;
  hop_count: number | null;
  upstream_account_ids: string[];
  downstream_account_ids: string[];
  path_ids: string[];
  first_received_at: string | null;
  last_observed_activity_at: string | null;
}

export interface AccountObservedMovement {
  observed_inbound_value: number;
  observed_outbound_value: number;
  traced_inbound_count: number;
  traced_outbound_count: number;
  traced_inbound_transactions: TracedTransaction[];
  traced_outbound_transactions: TracedTransaction[];
  other_observed_inbound_count: number;
  other_observed_outbound_count: number;
  movement_note: string;
}

export interface AccountTraceableExposure {
  reported_case_amount: number;
  case_traceable_amount: number;
  gross_network_observed_value: number;
  attributed_inbound_amount: number | null;
  attributed_outbound_amount: number | null;
  attributed_unforwarded_amount: number | null;
  attribution_status: string;
  attribution_basis: string | null;
  attribution_assumptions: string[];
  double_counting_safeguard: string;
}

export interface AccountSignal {
  code: string;
  title: string;
  description: string;
  related_transaction_ids: string[];
  interpretation_note: string;
}

export interface AccountSupportingEvidence {
  evidence_type: string;
  summary: string;
  related_transaction_ids: string[];
}

export interface AccountEvidenceAssessment {
  evidence_sufficiency:
    | 'insufficient_evidence'
    | 'graph_connection_only'
    | 'scenario_lineage_assumed'
    | 'human_review_corroborated'
    | string;
  supporting_evidence: AccountSupportingEvidence[];
  evidence_gaps: string[];
  uncertainty_factors: string[];
  verification_guidance: string[];
  recommended_review_state: ReviewState;
  recommendation_rationale: string;
}

export interface AccountAssessmentResponse {
  case_id: string;
  account_id: string;
  graph_position: AccountGraphPosition;
  observed_movement: AccountObservedMovement;
  traceable_exposure: AccountTraceableExposure;
  observed_signals: AccountSignal[];
  paths_involving_account: FundTracePath[];
  evidence_assessment: AccountEvidenceAssessment;
  review_status: AccountReviewStatus;
  audit_history: AuditEvent[];
  warnings: TraceWarning[];
  transaction_risk_separation_note: string;
  automated_action_taken: string;
  decision_support_only: boolean;
  disclaimer: string;
}

export interface CaseAccountAssessmentsResponse {
  case_id: string;
  count: number;
  assessments: AccountAssessmentResponse[];
  disclaimer: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

