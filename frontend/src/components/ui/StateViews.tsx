import React from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export const LoadingState: React.FC<{ label: string; className?: string }> = ({ label, className = '' }) => (
  <div role="status" aria-live="polite" className={`flex items-center gap-3 py-10 justify-center text-sm text-[#6B655B] ${className}`}>
    <span className="w-4 h-4 rounded-full border-2 border-[#EA8500] border-t-transparent animate-spin" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export const ErrorState: React.FC<{
  title: string;
  message: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}> = ({ title, message, onRetry, children }) => (
  <div role="alert" className="rounded-2xl border border-[#FECDD3] bg-[#FFF0F2] p-5 text-sm text-[#881337]">
    <div className="flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 shrink-0 text-[#BE123C] mt-0.5" aria-hidden="true" />
      <div className="space-y-2 min-w-0">
        <p className="font-semibold text-[#1A1714]">{title}</p>
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
  <div className="rounded-2xl border border-dashed border-[#DDD4C4] bg-[#FAF7F2] p-8 text-center">
    <Inbox className="w-6 h-6 mx-auto text-[#8C857B]" aria-hidden="true" />
    <p className="mt-3 font-semibold text-[#1A1714]">{title}</p>
    <p className="mt-1 text-sm text-[#6B655B] max-w-md mx-auto">{message}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

type PillTone = 'neutral' | 'orange' | 'green' | 'blue' | 'rose' | 'amber';

const TONES: Record<PillTone, string> = {
  neutral: 'bg-[#FAF7F2] text-[#6B655B] border-[#EAE3D6]',
  orange: 'bg-[#FFF4E6] text-[#B45309] border-[#FCD5B5]',
  green: 'bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]',
  blue: 'bg-[#EBF5FF] text-[#1E40AF] border-[#BFDBFE]',
  rose: 'bg-[#FFF0F2] text-[#BE123C] border-[#FECDD3]',
  amber: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]',
};

export const Pill: React.FC<{ tone?: PillTone; children: React.ReactNode; title?: string; className?: string }> = ({
  tone = 'neutral',
  children,
  title,
  className = '',
}) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}
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
  <p className={`text-xs text-[#6B655B] ${className}`}>
    <span className="font-semibold text-[#1A1714]">Demonstration data.</span>{' '}
    {children ?? 'Every account, transaction and complaint here is synthetic. No real customers or bank records are involved.'}
  </p>
);
