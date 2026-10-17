/**
 * Exact TypeScript definitions matching backend FastAPI schemas and domain models.
 */

export type TransactionType = 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'OTHER' | 'TRANSFER' | 'CASH_OUT' | 'PAYMENT' | 'CASH_IN' | 'DEBIT';

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
  updated_at?: string;
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

export interface GraphNode {
  id: string;
  label: string;
  role: AccountRole;
  is_synthetic: boolean;
  hop_count: number | null;
  connection_type: string | null;
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
  };
  disclaimer: string;
}

export interface TraceSummary {
  reported_amount: number;
  traceable_amount: number;
  located_amount: number;
  unlocated_amount: number;
  gross_observed_transaction_value: number;
  linked_account_count: number;
  path_count: number;
  truncated: boolean;
  cycles_detected: boolean;
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
  connection_type: string;
  hop_count: number;
  inbound_transaction_ids: string[];
  outbound_transaction_ids: string[];
  exposure: LinkedAccountExposure;
  review?: {
    review_state: ReviewState;
    evidence_quality: EvidenceQuality;
    automated_action_taken: string;
    notes?: string | null;
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

export interface TraceResult {
  case_id: string;
  summary: TraceSummary;
  linked_accounts: LinkedAccount[];
  paths: FundTracePath[];
  warnings: string[];
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

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}
