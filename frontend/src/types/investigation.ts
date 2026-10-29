/** Mirrors backend/app/api/v2/investigation_schemas.py (POST /api/v2/investigations). */
import { V2AccountAssessmentResponse, V2AccountMLAssessmentResponse } from './v2';

export interface InvestigationRequest {
  account_id: string;
  start_date?: string | null;
  end_date?: string | null;
  max_depth?: number;
  max_nodes?: number;
  onward_window_hours?: number;
  trace_scope?: 'flagged' | 'all';
  max_accounts_analyzed?: number;
  /** 'separate': the report comes back without waiting for the AI analyst; fetch it from /investigations/explanation. */
  ai_explanation?: 'inline' | 'separate';
}

export interface DataSourceInfo {
  source_kind: string;
  source_name: string;
  is_synthetic: boolean;
  real_bank_data: boolean;
  authorization_reference: string | null;
  database_backend: string;
  database_label: string;
  accounts_count: number;
  transactions_count: number;
  earliest_transaction_at: string | null;
  data_as_of: string | null;
  snapshot_built_at: string | null;
  queried_at: string;
  freshness_note: string;
  disclosure: string;
}

export interface TransferFlag {
  code: string;
  explanation: string;
}

export interface TraceEdge {
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
  direction: 'downstream' | 'upstream';
  hop: number;
  evidence_type: 'observed_direct' | 'inferred_related';
  parent_transaction_id: string | null;
  minutes_from_parent: number | null;
  is_cycle: boolean;
  converges: boolean;
  flags: TransferFlag[];
}

export type GraphRole = 'investigated_account' | 'direct_recipient' | 'onward_recipient' | 'direct_sender' | 'upstream_sender';
export type RoleAssessment =
  | 'victim_candidate'
  | 'possible_intermediary'
  | 'recipient_under_review'
  | 'sender_under_review'
  | 'insufficient_evidence'
  | 'not_analyzed';

export interface TraceNode {
  account_id: string;
  customer_name: string;
  customer_type: string;
  kyc_tier: string;
  account_status: string;
  current_balance: number;
  hop_distance: number;
  graph_role: GraphRole;
  is_root: boolean;
}

export interface CounterpartySummary {
  account_id: string;
  transfers: number;
  total_amount: number;
  first_at: string;
  last_at: string;
}

export interface VictimOverview {
  account_id: string;
  customer_name: string;
  customer_type: string;
  kyc_tier: string;
  account_status: string;
  account_opened_at: string;
  current_balance: number;
  period_start: string | null;
  period_end: string | null;
  transactions_in_period: number;
  transactions_all_time: number;
  incoming_count: number;
  incoming_total: number;
  outgoing_count: number;
  outgoing_total: number;
  median_outgoing_amount: number | null;
  largest_earlier_outgoing_before_first_flag: number | null;
  first_transaction_at: string | null;
  last_transaction_at: string | null;
  top_senders: CounterpartySummary[];
  top_recipients: CounterpartySummary[];
  flagged_transfers: TraceEdge[];
}

export interface ExposureLine {
  account_id: string;
  hop: number;
  traced_in_amount: number;
  outgoing_in_window: number;
  forwarded_min: number;
  forwarded_max: number;
  lowest_balance_in_window: number | null;
}

export interface EvidenceRefs {
  transaction_ids: string[];
  account_ids: string[];
}

export type FindingKind = 'observed' | 'rule' | 'model' | 'limitation';

export interface Finding {
  finding_id: string;
  kind: FindingKind;
  subject_account_id: string | null;
  statement: string;
  evidence: EvidenceRefs;
}

export interface AccountFinding {
  account_id: string;
  customer_name: string;
  customer_type: string;
  kyc_tier: string;
  graph_role: GraphRole;
  hop_distance: number;
  role_assessment: RoleAssessment;
  role_basis: string[];
  analyzed: boolean;
  not_analyzed_reason: string | null;
  rule_assessment: V2AccountAssessmentResponse | null;
  model_assessment: V2AccountMLAssessmentResponse | null;
  model_unavailable_reason: string | null;
  model_suggests_review: boolean | null;
  rule_suggests_review: boolean | null;
  checks_disagree: boolean | null;
  disagreement_note: string | null;
  traced_in_amount: number;
  traced_out_amount: number;
  evidence_transaction_ids: string[];
  alternative_explanations: string[];
  missing_evidence: string[];
  next_steps: string[];
}

export type ClaimKind = 'observed' | 'rule' | 'model' | 'interpretation' | 'limitation';

export interface AnalystSection {
  question: string;
  claims: { text: string; kind: ClaimKind; refs: string[] }[];
}

export type AIState = 'completed' | 'disabled' | 'not_configured' | 'skipped_privacy_policy' | 'unavailable' | 'deferred';
export type ObservationBasis = 'observed' | 'rule' | 'model' | 'hypothesis' | 'limitation';

/** Validated AI explanation; every ID in it exists in the same report. */
export interface AIReport {
  summary: string;
  key_observations: { text: string; basis: ObservationBasis; evidence_ids: string[] }[];
  evidence_references: string[];
  reasoning_and_limitations: string[];
  recommended_manual_checks: { text: string; evidence_ids: string[] }[];
  confidence_note: string;
}

export interface AIAnalysis {
  /** Absent only on servers older than the Gemini analyst; derive it from `status` there. */
  state?: AIState;
  /** @deprecated Legacy summary of `state`. */
  status: 'generated' | 'not_configured' | 'failed' | 'rejected';
  provider: string | null;
  model?: string | null;
  message: string;
  unavailable_reason?: string | null;
  privacy_policy?: string | null;
  pseudonymized?: boolean;
  report?: AIReport | null;
  sections: AnalystSection[];
  rejected_claims: number;
  latency_ms?: number | null;
}

export interface Recommendation {
  recommendation_id: string;
  account_id: string | null;
  action: 'further_review' | 'enhanced_monitoring' | 'consider_escalation' | 'obtain_records' | 'contact_account_holder';
  statement: string;
  evidence: EvidenceRefs;
  uncertainty: string;
}

export interface InvestigationResponse {
  investigation_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  request: Required<InvestigationRequest>;
  data_source: DataSourceInfo;
  model_version: string | null;
  model_review_threshold: number | null;
  model_available: boolean;
  model_unavailable_reason: string | null;
  victim: VictimOverview;
  trace: {
    nodes: TraceNode[];
    edges: TraceEdge[];
    downstream_seed_transaction_ids: string[];
    upstream_seed_transaction_ids: string[];
    seed_selection: string;
    max_depth_reached: number;
    cycles_detected: number;
    is_truncated: boolean;
    truncation_notes: string[];
    transactions_read: number;
  };
  accounts: AccountFinding[];
  findings: Finding[];
  exposure: {
    flagged_outgoing_total: number;
    traced_outgoing_total: number;
    observed_downstream_total: number;
    per_account: ExposureLine[];
    method: string;
    limitations: string[];
  };
  evidence_summary: AnalystSection[];
  ai_analysis: AIAnalysis;
  recommendations: Recommendation[];
  unknowns: string[];
  records_to_request: string[];
  ledger_rows_read: number;
  /** Digest of the deterministic report; an explanation is shown only next to a report with the same digest. */
  report_digest?: string;
  persisted: boolean;
  disclaimer: string;
}

/** POST /api/v2/investigations/explanation */
export interface InvestigationExplanationResponse {
  account_id: string;
  report_digest: string;
  data_as_of: string | null;
  duration_ms: number;
  ai_analysis: AIAnalysis;
}

/** Client-side state of the separately requested AI explanation. */
export type ExplanationView =
  | { phase: 'pending' }
  | { phase: 'done'; analysis: AIAnalysis }
  | { phase: 'stale' }
  | { phase: 'failed'; message: string };
