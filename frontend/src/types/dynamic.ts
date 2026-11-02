/** POST /api/v2/dynamic-investigations and the dataset endpoints (backend/app/api/v2/dynamic_schemas.py). */
import { DataSourceInfo, InvestigationResponse, TransferFlag } from './investigation';

export type DatasetId = 'demo-ledger' | 'forensic-scenarios';

export interface DatasetSummary {
  dataset_id: DatasetId;
  title: string;
  description: string;
  evaluation_labels_note: string;
  /** Whether the v3 models' outputs count as evidence on this dataset; absent on older servers. */
  model_support?: 'validated_in_distribution' | 'unsupported_distribution_shift' | 'unsupported_not_checked';
  model_note?: string;
  available: boolean;
  unavailable_reason?: string | null;
  source?: DataSourceInfo | null;
}

export interface DatasetAccount {
  dataset_id: DatasetId;
  dataset_title: string;
  account_id: string;
  exists: boolean;
  customer_type: string;
  account_opened_at: string | null;
  transactions: number;
  outgoing: number;
  incoming: number;
  first_transaction_at: string | null;
  last_transaction_at: string | null;
  history_sufficient: boolean;
  minimum_history: number;
  coverage_note: string;
  models: Record<string, { available: boolean; model_version?: string; reason?: string }>;
  synthetic: boolean;
  /** False: the models are not validated on this dataset, so their scores are shown for reference only. */
  models_validated?: boolean;
  model_note?: string;
}

export interface SampleAccounts {
  dataset_id: DatasetId;
  basis: string;
  accounts: { account_id: string; reason: string }[];
}

export interface DynamicInvestigationRequest {
  account_id: string;
  dataset_id: DatasetId;
  max_depth?: number;
  max_nodes?: number;
  onward_window_hours?: number;
  max_accounts_analyzed?: number;
  ai_explanation?: 'inline' | 'separate';
}

export interface ModelFactor {
  feature: string;
  label: string;
  value: number | null;
  contribution: number;
}

export interface TransactionAssessment {
  transaction_id: string;
  timestamp: string;
  sender_account_id: string;
  receiver_account_id: string;
  amount: number;
  currency: string | null;
  transaction_type: string;
  channel: string | null;
  model_score: number | null;
  calibrated_probability: number | null;
  model_flag: boolean;
  risk_category: 'high' | 'elevated' | 'low' | 'not_scored';
  model_factors: ModelFactor[];
  outside_training_range: boolean;
  rule_flags: TransferFlag[];
  /** 'reference_only': the model is not validated on this dataset; shown, never used as evidence. */
  evidence_use: 'evidence' | 'reference_only';
}

export type RoleCandidate =
  | 'potential_victim'
  | 'suspicious_activity_victim_unconfirmed'
  | 'potential_secondary_victim'
  | 'potential_intermediary'
  | 'potentially_suspicious_account'
  | 'no_suspicious_linkage_observed'
  | 'no_suspicious_activity_observed'
  | 'unknown_role'
  | 'cash_withdrawal_point';

export type RestrictionState =
  | 'no_restriction_recommendation'
  | 'additional_verification_recommended'
  | 'urgent_manual_review_recommended'
  | 'consider_temporary_restriction_review'
  | 'insufficient_evidence_to_recommend';

export interface Restriction {
  account_id: string;
  state: RestrictionState;
  label: string;
  rationale: string;
  supporting_evidence: string[];
  relevant_transaction_ids: string[];
  may_be_victim: boolean;
  victim_note: string | null;
  innocent_explanations: string[];
  verification_needed: string[];
  missing_information: string[];
  funds_may_still_be_held: boolean | null;
  human_review_required: true;
  automatic_action_taken: false;
}

export interface AccountModelResult {
  status: 'scored' | 'reference_only' | 'insufficient_history' | 'not_analyzed' | 'model_unavailable';
  model_version?: string | null;
  model_score?: number | null;
  calibrated_probability?: number | null;
  above_threshold?: boolean | null;
  threshold?: number | null;
  outside_training_range?: boolean | null;
  factors: ModelFactor[];
  n_transactions?: number | null;
  reason?: string | null;
}

export interface EvidenceItem {
  category: string;
  kind: 'observed' | 'model' | 'rule';
  text: string;
  /** Which way it points (absent on older servers): its own money left, passing on or collecting money, or context only. */
  side?: 'victim' | 'suspicion' | 'context' | null;
}

export interface RoleAssessmentV3 {
  account_id: string;
  role_candidate: RoleCandidate;
  role_label: string;
  assessment_status: 'assessed' | 'insufficient_evidence' | 'not_analyzed';
  headline: string;
  supporting_evidence: string[];
  evidence_items: EvidenceItem[];
  contradictory_evidence: string[];
  evidence_categories: string[];
  evidence_strength: 'none' | 'weak' | 'moderate' | 'strong';
  relevant_transaction_ids: string[];
  graph_relationship: {
    position: 'investigated' | 'downstream' | 'upstream' | 'other_sender';
    hop: number | null;
    introduced_by_transaction_id: string | null;
    received_traced_amount: number;
    sent_traced_amount: number;
    forwarded_at_least: number | null;
    forwarded_at_most: number | null;
    onward_delay_minutes: number | null;
    onward_destinations: number;
    traced_paths_in: number;
    in_cycle: boolean;
    paid_suspicious_account: string | null;
  };
  account_model: AccountModelResult;
  account_model_calibrated_probability: number | null;
  data_coverage: { transactions: number; history_days_before_reached: number; analyzed: boolean };
  uncertainty_reason: string | null;
  recommended_next_check: string;
  questions: { q: string; a: string }[];
  may_be_victim: boolean;
  restriction: Restriction;
  other_sender_transaction: TransactionAssessment | null;
}

export type EndingReason =
  | 'cycle_detected'
  | 'already_examined_on_another_branch'
  | 'maximum_depth_reached'
  | 'maximum_node_limit_reached'
  | 'per_account_limit_applied'
  | 'cash_withdrawal_recorded'
  | 'no_further_transaction_in_window'
  | 'no_earlier_transaction_in_window'
  | 'incomplete_or_missing_data'
  | 'joins_opposite_direction_trace';

export interface FundBranch {
  branch_id: string;
  direction: 'downstream' | 'upstream';
  transaction_ids: string[];
  accounts: string[];
  amounts: number[];
  ending: { reason: EndingReason; detail: string };
}

export interface ModelInfo {
  available: boolean;
  purpose: string;
  unavailable_reason?: string | null;
  model_version?: string;
  family?: string;
  trained_at?: string;
  threshold?: number;
  threshold_rule?: string;
  calibration?: string;
  held_out_evaluation?: { n: number; positives: number; precision: number; recall: number; pr_auc: number; brier: number } | null;
  score_semantics?: string;
  note?: string;
}

/** The investigated account's own unflagged transfers closest to the transaction model's threshold. Context only. */
export interface ClosestUnflaggedTransfer {
  transaction_id: string;
  timestamp: string;
  receiver_account_id: string;
  amount: number;
  transaction_type: string;
  channel: string | null;
  calibrated_probability: number;
  model_score?: number | null;
  threshold: number;
  share_of_threshold?: number | null;
  evidence_use?: 'evidence' | 'reference_only';
}

export interface DynamicReport {
  investigation_id: string;
  engine_version: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  investigation_digest: string;
  dataset: { dataset_id: DatasetId; title: string; description: string; evaluation_labels_note: string; source: DataSourceInfo };
  account_summary: {
    account_id: string;
    exists: boolean;
    customer_type: string;
    transactions: number;
    outgoing: number;
    incoming: number;
    counterparties: number;
    first_transaction_at: string | null;
    last_transaction_at: string | null;
    history_sufficient: boolean;
  };
  victim_assessment: {
    account_id: string;
    status: 'potential_victim' | 'suspicious_activity_victim_status_unconfirmed' | 'no_suspicious_activity_observed' | 'insufficient_evidence';
    label: string;
    headline: string;
    role_candidate: RoleCandidate;
    evidence: string[];
    contradictory_evidence: string[];
    uncertainty_reason: string | null;
  };
  suspicious_transactions: TransactionAssessment[];
  /** Absent on older servers. Never a flag, a trace seed or evidence. */
  closest_unflagged_transfers?: ClosestUnflaggedTransfer[] | null;
  /** Flagged by the fixed rules but not by the validated transaction model: shown, not used as evidence. */
  uncorroborated_rule_flags: TransactionAssessment[];
  /** Every scored transfer in the trace (and the investigated account's history), flagged or not. */
  transaction_scores: TransactionAssessment[];
  transaction_scoring: {
    scored: number;
    /** Scored transfers the investigated account sent or received (`scored` also counts traced counterparties'). */
    scored_on_investigated_account?: number;
    flagged_by_model: number;
    flagged_on_investigated_account: number;
    model_available: boolean;
    model_used_as_evidence: boolean;
  };
  fund_trace: { branches: FundBranch[]; transactions: number; accounts: number; max_depth_reached: number; truncation_notes: string[] };
  affected_accounts: Record<
    | 'potential_victims'
    | 'potential_secondary_victims'
    | 'potential_intermediaries'
    | 'suspicious_accounts'
    | 'ordinary_counterparties'
    | 'unknown_roles'
    | 'cash_withdrawal_points',
    string[]
  >;
  role_assessments: RoleAssessmentV3[];
  network_findings: string[];
  restriction_recommendation: Restriction;
  data_coverage: {
    investigated_account_transactions: number;
    history_span_days: number;
    records_loaded: number;
    accounts_in_trace: number;
    accounts_analyzed: number;
    accounts_with_insufficient_history: string[];
    trace_truncated: boolean;
    data_as_of: string | null;
    note: string;
  };
  model_validation: {
    validated_for_this_dataset: boolean;
    note: string;
    /** Absent on older servers. Anything other than validated_in_distribution means reference only. */
    support_state?: 'validated_in_distribution' | 'unsupported_distribution_shift' | 'unsupported_not_checked';
    distribution_check?: Record<string, { in_distribution: boolean; behaviour_inputs_psi_over_0_25: number; behaviour_inputs: number }> | null;
  };
  model_metadata: { transaction_model: ModelInfo; account_model: ModelInfo; graph_analysis: ModelInfo; rules: ModelInfo };
  limitations: string[];
  processing_steps: { step: string; label: string; duration_ms: number; detail: string }[];
  synthetic_data_notice: string;
  automatic_actions_taken: string[];
  /** Absent on servers older than the investigator report. Assembled by fixed code; recommendations only. */
  investigator_report?: InvestigatorReport | null;
  investigation: InvestigationResponse;
}

// ---------------------------------------------------------------- investigator report (backend app/intelligence/report.py)
export type ReviewTrack = 'protective' | 'suspicion' | 'routine';
export interface ReportEvidence {
  kind: 'observed' | 'model' | 'rule';
  text: string;
}
export interface ChronologyRow {
  transaction_id: string;
  timestamp: string;
  direction: 'outgoing' | 'incoming';
  counterparty: string;
  amount: number;
  channel: string | null;
  balance_before: number | null;
  balance_after: number | null;
  model_flag: boolean;
  calibrated_probability: number | null;
  evidence_use: 'evidence' | 'reference_only' | null;
  rule_flags: string[];
  flagged: boolean;
  traced: boolean;
  branch_ids: string[];
  selected_because: string[];
}
export interface FlowTransfer {
  account_id: string;
  transaction_id: string;
  amount: number;
  timestamp: string;
  channel: string | null;
}
export interface ReportBranch {
  branch_id: string;
  direction: 'downstream' | 'upstream';
  accounts: string[];
  amounts: number[];
  transaction_ids: string[];
  ending_reason: EndingReason;
  ending_detail: string;
}
export interface ConnectedAccountRow {
  account_id: string;
  role_candidate: RoleCandidate;
  role_label: string;
  assessment_status: string;
  position: string;
  hop: number | null;
  flow_role: string;
  behaviour: string;
  evidence: ReportEvidence[];
  evidence_strength: string;
  level: 1 | 2 | 3 | 4;
  level_label: string;
  track: ReviewTrack;
  recommended_action: string;
  next_check: string;
  may_be_victim: boolean;
}
export interface AccountRecommendation {
  account_id: string;
  role_candidate: RoleCandidate;
  role_label: string;
  level: 1 | 2 | 3 | 4;
  level_label: string;
  track: ReviewTrack;
  model_only: boolean;
  action: string;
  reason: string;
  supporting_evidence: ReportEvidence[];
  contradictory_evidence: string[];
  innocent_explanations: string[];
  verify_before_action: string[];
  authorised_by: string;
  victim_note: string | null;
  restriction_state: RestrictionState;
  restriction_label: string;
  action_executed: false;
}
export interface InvestigatorReport {
  report_version: string;
  generator: { kind: 'deterministic'; language_model_used: false; description: string };
  notice: string;
  executive_summary: {
    account_id: string;
    dataset_id: string;
    dataset_title: string;
    data_as_of: string | null;
    synthetic: boolean;
    candidate_role: RoleCandidate;
    candidate_role_label: string;
    assessment_status: string;
    headline: string;
    review_level: 1 | 2 | 3 | 4;
    review_level_label: string;
    review_track: ReviewTrack;
    leaning: 'victim' | 'intermediary' | 'suspicious_account' | 'none' | 'undetermined';
    leaning_text: string;
    main_reasons: ReportEvidence[];
    evidence_strength: string;
    uncertainty: string[];
  };
  risk_assessment: {
    transaction_model: {
      available: boolean;
      version: string | null;
      threshold: number | null;
      used_as_evidence: boolean;
      scored_on_account: number | null;
      flagged_on_account: number | null;
      flagged_transfers: {
        transaction_id: string;
        timestamp: string;
        direction: 'outgoing' | 'incoming';
        counterparty: string;
        amount: number;
        calibrated_probability: number | null;
        factors: string[];
      }[];
    };
    account_model: {
      available: boolean;
      version: string | null;
      status: string | null;
      calibrated_probability: number | null;
      threshold: number | null;
      above_threshold: boolean | null;
      factors: { label: string; contribution: number }[];
      positive_target: string;
    };
    rules: { flags_on_account: { transaction_id: string; code: string; explanation: string }[]; uncorroborated: string[]; role_rule: string };
    model_support: { state: string; validated_for_this_dataset: boolean; note: string };
    evidence_strength: string;
    victim_side_evidence: ReportEvidence[];
    suspicion_side_evidence: ReportEvidence[];
    context: ReportEvidence[];
    contradictory_evidence: string[];
    innocent_explanations: string[];
    missing_information: string[];
    score_note: string;
  };
  chronology: {
    rows: ChronologyRow[];
    window_note: string;
    omitted: number;
    model_threshold: number | null;
    model_evidence_use: 'evidence' | 'reference_only';
  };
  fund_flow: {
    investigated_account: string;
    flagged_outgoing_total: number | null;
    traced_outgoing_total: number | null;
    sources: FlowTransfer[];
    earliest_sources: { account_id: string; branch_id: string; hops_before: number }[];
    first_recipients: FlowTransfer[];
    hops: { direction: 'downstream' | 'upstream'; hop: number; transfers: number; total: number; accounts: string[] }[];
    recipients: string[];
    attribution: {
      account_id: string;
      hop: number | null;
      role_label: string | null;
      received_traced: number | null;
      forwarded_at_least: number | null;
      forwarded_at_most: number | null;
      kept_at_least: number | null;
      cash_withdrawn: number;
    }[];
    branches: ReportBranch[];
    cycles: ReportBranch[];
    convergence: { transaction_id: string; from_account: string; to_account: string; amount: number }[];
    reached_by_several_paths: string[];
    cash_endings: { account_id: string; cash_point: string; transaction_id: string; amount: number; timestamp: string }[];
    untraced: { branch_id: string; account_id: string; last_amount: number | null; reason: EndingReason; detail: string }[];
    truncation_notes: string[];
    method: string | null;
    amount_note: string;
  };
  connected_accounts: ConnectedAccountRow[];
  recommendations: AccountRecommendation[];
  findings: {
    recorded_evidence: string[];
    model_output_only: string[];
    unknown: string[];
    urgent_review: string[];
    enhanced_verification: string[];
    protective_verification: string[];
    no_action: string[];
    records_to_obtain: string[];
  };
  safeguards: string[];
}
