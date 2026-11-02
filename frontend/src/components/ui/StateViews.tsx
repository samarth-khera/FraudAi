import React from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export const LoadingState: React.FC<{ label: string; className?: string }> = ({ label, className = '' }) => (
  <div role="status" aria-live="polite" className={`flex items-center gap-3 py-12 justify-center text-sm text-mute ${className}`}>
    <span className="relative w-5 h-5" aria-hidden="true">
      <span className="absolute inset-0 rounded-full border-2 border-iris-soft" />
      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-iris border-r-ice animate-spin" />
    </span>
    <span>{label}</span>
  </div>
);

/** Placeholder blocks in the shape of the content that is loading. */
export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => <span className={`skeleton block ${className}`} aria-hidden="true" />;

export const ErrorState: React.FC<{
  title: string;
  message: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}> = ({ title, message, onRetry, children }) => (
  <div role="alert" className="rounded-2xl border border-danger-line bg-danger-soft/70 p-5 text-sm text-danger shadow-[var(--shadow-xs)]">
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-xl bg-white ring-1 ring-danger-line flex items-center justify-center shrink-0" aria-hidden="true">
        <AlertTriangle className="w-[18px] h-[18px] text-danger" />
      </span>
      <div className="space-y-2 min-w-0 pt-0.5">
        <p className="font-semibold text-ink">{title}</p>
        <p className="leading-relaxed">{message}</p>
        {children}
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-secondary mt-1">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </div>
  </div>
);

export const EmptyState: React.FC<{ title: string; message: string; action?: React.ReactNode }> = ({
  title,
  message,
  action,
}) => (
  <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 p-10 text-center">
    <span className="mx-auto w-11 h-11 rounded-2xl bg-iris-wash ring-1 ring-iris-line flex items-center justify-center" aria-hidden="true">
      <Inbox className="w-5 h-5 text-iris" />
    </span>
    <p className="mt-3 font-semibold text-ink">{title}</p>
    <p className="mt-1 text-sm text-mute max-w-md mx-auto">{message}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

type PillTone = 'neutral' | 'orange' | 'green' | 'blue' | 'rose' | 'amber';

const TONES: Record<PillTone, string> = {
  neutral: 'bg-well text-mute border-line',
  orange: 'bg-iris-soft text-iris-deep border-iris-line',
  green: 'bg-ok-soft text-ok border-ok-line',
  blue: 'bg-ice-soft text-info border-ice-line',
  rose: 'bg-danger-soft text-danger border-danger-line',
  amber: 'bg-warn-soft text-warn border-warn-line',
};

export const Pill: React.FC<{ tone?: PillTone; children: React.ReactNode; title?: string; className?: string }> = ({
  tone = 'neutral',
  children,
  title,
  className = '',
}) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-xs font-semibold leading-4 whitespace-nowrap ${TONES[tone]} ${className}`}
  >
    {children}
  </span>
);

export function reviewStateTone(state: string | null | undefined): PillTone {
  switch (state) {
    case 'under_investigation':
      return 'rose';
    case 'under_review':
      return 'amber';
    case 'review_completed':
      return 'green';
    case 'reporting_victim':
      return 'blue';
    default:
      return 'neutral';
  }
}

export function caseStatusTone(status: string | null | undefined): PillTone {
  if (status === 'closed') return 'neutral';
  if (status === 'under_investigation') return 'orange';
  return 'blue';
}

export const SyntheticDataNote: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className = '', children }) => (
  <p className={`text-xs text-mute ${className}`}>
    <span className="font-semibold text-ink">Demonstration data.</span>{' '}
    {children ?? 'Every account, transaction and complaint here is synthetic. No real customers or bank records are involved.'}
  </p>
);
