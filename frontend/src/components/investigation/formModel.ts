import { ACCOUNT_ID_PATTERN, normalizeAccountId } from '../../lib/accountId';
import { InvestigationRequest } from '../../types/investigation';

export interface FormValues {
  accountId: string;
  startDate: string;
  endDate: string;
  maxDepth: number;
  maxNodes: number;
  windowHours: number;
  scope: 'flagged' | 'all';
  maxAccounts: number;
}

export const DEFAULT_FORM: FormValues = {
  accountId: '',
  startDate: '',
  endDate: '',
  maxDepth: 3,
  maxNodes: 200,
  windowHours: 72,
  scope: 'flagged',
  maxAccounts: 25,
};

/** Validates the form; returns an error message or the API request. Limits match the API's own. */
export function toRequest(v: FormValues): { error: string } | { request: InvestigationRequest } {
  const accountId = normalizeAccountId(v.accountId);
  if (!accountId) return { error: 'Enter the account ID to investigate.' };
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    return { error: 'Account IDs use letters, numbers, dots, dashes and underscores only (for example ACC-000001).' };
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) return { error: 'The end date must be on or after the start date.' };
  const bounded = (n: number, lo: number, hi: number, name: string) =>
    Number.isFinite(n) && n >= lo && n <= hi ? null : `${name} must be between ${lo} and ${hi}.`;
  const problem =
    bounded(v.maxDepth, 1, 6, 'Trace depth') ??
    bounded(v.maxNodes, 2, 200, 'Account limit') ??
    bounded(v.windowHours, 1, 720, 'Follow-on window') ??
    bounded(v.maxAccounts, 1, 60, 'Accounts assessed');
  if (problem) return { error: problem };
  return {
    request: {
      account_id: accountId,
      start_date: v.startDate || null,
      end_date: v.endDate || null,
      max_depth: v.maxDepth,
      max_nodes: v.maxNodes,
      onward_window_hours: v.windowHours,
      trace_scope: v.scope,
      max_accounts_analyzed: v.maxAccounts,
    },
  };
}
