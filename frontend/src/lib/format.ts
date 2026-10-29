/**
 * Formatting helpers and plain-language labels shared by the investigation screens.
 * Labels describe a record's position or state; none of them is a verdict about a person.
 */

export function formatMoney(amount: number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-IN')}`;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Server-generated timestamps (audit events, updated_at) are UTC but sent without an offset. */
export function formatServerTime(value: string | null | undefined): string {
  if (!value) return '—';
  const hasOffset = /(Z|[+-]\d\d:?\d\d)$/.test(value);
  return formatDateTime(hasOffset ? value : `${value}Z`);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function minutesBetween(a: string, b: string): number | null {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
}

export const ROLE_LABELS: Record<string, { label: string; help: string }> = {
  reporting_victim: { label: 'Reporting customer', help: 'Made the complaint and sent the reported transfer.' },
  reported_initial_receiver: { label: 'First receiver', help: 'Received the reported transfer directly.' },
  intermediate_recipient: { label: 'Passed money on', help: 'Received money in this case and sent some onward.' },
  recipient: { label: 'Last recorded receiver', help: 'Received money in this case; no onward transfer is recorded.' },
  unknown: { label: 'Role unknown', help: 'Position in the case could not be determined.' },
};

export function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[role || 'unknown']?.label ?? 'Role unknown';
}

export const REVIEW_STATE_LABELS: Record<string, string> = {
  not_reviewed: 'No decision yet',
  reporting_victim: 'Reporting customer',
  under_review: 'Under review',
  under_investigation: 'Escalated',
  review_completed: 'Review completed',
};

/** Decisions an investigator can record. The backend accepts exactly these states. */
export const REVIEW_DECISIONS: { value: 'under_review' | 'under_investigation' | 'review_completed'; label: string; help: string }[] = [
  {
    value: 'under_review',
    label: 'Keep under review',
    help: 'More information is needed before deciding anything.',
  },
  {
    value: 'under_investigation',
    label: 'Escalate for investigation',
    help: 'The evidence justifies a deeper inquiry, such as requesting statements or contacting the bank.',
  },
  {
    value: 'review_completed',
    label: 'Review completed',
    help: 'No further action on this account is needed for this case. This is not a statement of guilt or innocence.',
  },
];

export const EVIDENCE_QUALITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'graph_connection_only', label: 'Only the recorded transfers connect this account' },
  { value: 'corroborated', label: 'Corroborated by documents or statements' },
  { value: 'synthetic_assumption', label: 'Based on the sample scenario’s assumptions' },
  { value: 'not_assessed', label: 'Not assessed yet' },
];

export function evidenceQualityLabel(value: string | null | undefined): string {
  return EVIDENCE_QUALITY_OPTIONS.find((o) => o.value === value)?.label ?? 'Not assessed yet';
}

export const CASE_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  under_investigation: 'Under investigation',
  closed: 'Closed',
};

export const CHANNEL_LABELS: Record<string, string> = {
  UPI: 'UPI',
  IMPS: 'IMPS',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  ATM_CASH_OUT: 'ATM cash-out',
  CARD_POS: 'Card payment',
  OTHER: 'Other',
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return '—';
  return CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ');
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  case_created: 'Case created',
  case_metadata_updated: 'Case details updated',
  account_review_recorded: 'Review decision recorded',
  transactions_added: 'Transactions added',
  trace_paths_persisted: 'Money flow recalculated',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

/** Seeded placeholder rows are not human decisions and must not be shown as one. */
export function isRecordedDecision(reviewerId: string | null | undefined): boolean {
  return Boolean(reviewerId) && reviewerId !== 'system_seeder';
}

export function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : text;
}
