import {
  AccountAssessmentResponse,
  CaseAccountAssessmentsResponse,
  FraudCase,
  GraphResponse,
  TraceResult,
  TracedTransaction,
} from '../../types/api';

export type CaseSection = 'summary' | 'money-flow' | 'accounts' | 'review';

export const SECTIONS: { id: CaseSection; title: string; question: string }[] = [
  { id: 'summary', title: 'Summary', question: 'What happened?' },
  { id: 'money-flow', title: 'Money flow', question: 'Where did the money go?' },
  { id: 'accounts', title: 'Accounts & risk', question: 'Which accounts need attention, and why?' },
  { id: 'review', title: 'Review & history', question: 'What has been decided?' },
];

export function parseSection(value: string | null): CaseSection {
  return SECTIONS.some((s) => s.id === value) ? (value as CaseSection) : 'summary';
}

export interface CaseWorkspaceData {
  caseData: FraudCase;
  trace: TraceResult | null;
  graph: GraphResponse | null;
  assessments: CaseAccountAssessmentsResponse | null;
  traceError: string | null;
  assessmentsError: string | null;
}

export function usesAccountLedger(c: FraudCase): boolean {
  return c.account_dataset === 'v2_synthetic_ledger';
}

/** 0 for the reporting customer, 1 for the first receiver, and so on. */
export function stepsFromReporter(a: AccountAssessmentResponse): number {
  if (a.graph_position.role === 'reporting_victim') return 0;
  return (a.graph_position.hop_count ?? 0) + 1;
}

export function originTransaction(trace: TraceResult | null): TracedTransaction | null {
  if (!trace?.traced_transactions) return null;
  return trace.traced_transactions.find((t) => t.transaction_id === trace.origin_transaction_id) ?? null;
}

export function sortedAccounts(data: CaseWorkspaceData): AccountAssessmentResponse[] {
  return [...(data.assessments?.assessments ?? [])].sort(
    (a, b) => stepsFromReporter(a) - stepsFromReporter(b) || a.account_id.localeCompare(b.account_id)
  );
}

export function caseTransactions(a: AccountAssessmentResponse): TracedTransaction[] {
  const seen = new Set<string>();
  return [...a.observed_movement.traced_inbound_transactions, ...a.observed_movement.traced_outbound_transactions]
    .filter((t) => (seen.has(t.transaction_id) ? false : (seen.add(t.transaction_id), true)))
    .sort((x, y) => x.timestamp.localeCompare(y.timestamp));
}

/** Open questions the records cannot answer, collected from the backend's own evidence gaps. */
export function openQuestions(data: CaseWorkspaceData): string[] {
  const out: string[] = [];
  const trace = data.trace;
  if (trace) {
    const unattributed = trace.summary.uncertain_account_ids?.length ?? 0;
    if (unattributed > 0) {
      out.push(
        `Which of the downstream transfers actually carry the reported money. ${unattributed} account${
          unattributed === 1 ? ' has' : 's have'
        } no fund attribution, because the records cannot show whether money was mixed with other funds.`
      );
    }
    if (trace.summary.truncated) out.push('Whether the money moved further: the trace stopped at its depth limit.');
  }
  out.push('Whether any account holder knew the money was connected to a complaint. Transfers alone cannot show intent.');
  const anyCorroborated = (data.assessments?.assessments ?? []).some(
    (a) => a.review_status.evidence_quality === 'corroborated'
  );
  if (!anyCorroborated) {
    out.push('Supporting documents such as bank statements, KYC records or the customer’s own account of events. None are recorded yet.');
  }
  return out;
}

export function recordedDecisionCount(data: CaseWorkspaceData): number {
  return data.caseData.review_progress?.decisions_recorded ?? 0;
}
