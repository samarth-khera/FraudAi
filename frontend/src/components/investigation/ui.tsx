import React from 'react';
import { ChevronDown } from 'lucide-react';
import { SEVERITY_LABEL, SEVERITY_ORDER, Severity, Tone, useCase } from './caseModel';

const TONE: Record<Tone, string> = {
  neutral: 'bg-well text-mute ring-line',
  iris: 'bg-iris-soft text-iris-deep ring-iris-line',
  ice: 'bg-ice-soft text-[#1D4ED8] ring-[#C9DBFF]',
  fact: 'bg-[#EEF4FF] text-[#334E8A] ring-[#D3E0FA]',
  critical: 'bg-sev-critical-soft text-sev-critical ring-[#FBCFD8]',
  high: 'bg-sev-high-soft text-sev-high ring-[#FCD9C2]',
  elevated: 'bg-sev-elevated-soft text-sev-elevated ring-[#F5E3A8]',
  low: 'bg-sev-low-soft text-sev-low ring-[#DCE1EB]',
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string; className?: string }> = ({
  tone = 'neutral',
  children,
  title,
  className = '',
}) => (
  <span title={title} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${TONE[tone]} ${className}`}>
    {children}
  </span>
);

/** Four bars, filled up to the level. Severity is never shown by colour alone. */
export const SeverityMeter: React.FC<{ level: Severity | null; showLabel?: boolean }> = ({ level, showLabel = true }) => {
  const filled = level ? 4 - SEVERITY_ORDER.indexOf(level) : 0;
  const colour = level ? { critical: 'bg-sev-critical', high: 'bg-sev-high', elevated: 'bg-sev-elevated', low: 'bg-sev-low' }[level] : '';
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={level ? `Rule severity: ${SEVERITY_LABEL[level]}` : 'Not assessed'}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`w-[4px] rounded-sm ${i < filled ? colour : 'bg-line-strong'}`} style={{ height: 6 + i * 2.5 }} />
        ))}
      </span>
      {showLabel && <span className="text-xs font-semibold text-ink-soft">{level ? SEVERITY_LABEL[level] : 'Not assessed'}</span>}
    </span>
  );
};

export const Disclosure: React.FC<{
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  id?: string;
}> = ({ summary, children, defaultOpen, className = '', id }) => (
  <details id={id} open={defaultOpen} className={`group rounded-2xl border border-line bg-white ${className}`}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-ink hover:bg-well [&::-webkit-details-marker]:hidden">
      <span className="min-w-0">{summary}</span>
      <ChevronDown className="w-4 h-4 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="px-4 pb-4">{children}</div>
  </details>
);

export const StageHeading: React.FC<{ title: string; lead?: React.ReactNode; aside?: React.ReactNode }> = ({ title, lead, aside }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="max-w-3xl">
      <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
      {lead && <p className="mt-1.5 text-[15px] leading-relaxed text-mute">{lead}</p>}
    </div>
    {aside}
  </div>
);

// ---------------------------------------------------------------- evidence references

/** An evidence ID from the report. Transfers and accounts open the inspector; findings jump to the evidence list. */
export const Ref: React.FC<{ id: string }> = ({ id }) => {
  const nav = useCase();
  const base = 'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ring-1 ring-inset transition-colors';
  if (nav.trail.edgesById.has(id) || nav.report.victim.flagged_transfers.some((t) => t.transaction_id === id)) {
    return (
      <button type="button" onClick={() => nav.openTransfer(id)} className={`${base} bg-iris-soft text-iris-deep ring-iris-line hover:bg-[#E4DDFF]`} title="Open this transfer">
        {id}
      </button>
    );
  }
  if (nav.report.trace.nodes.some((n) => n.account_id === id)) {
    return (
      <button type="button" onClick={() => nav.openAccount(id)} className={`${base} bg-ice-soft text-[#1D4ED8] ring-[#C9DBFF] hover:bg-[#DCE8FF]`} title="Open this account">
        {id}
      </button>
    );
  }
  if (nav.report.findings.some((f) => f.finding_id === id)) {
    return (
      <a href={`#finding-${id}`} onClick={(e) => { e.preventDefault(); nav.openFinding(id); }} className={`${base} bg-well text-mute ring-line hover:text-ink`}>
        {id}
      </a>
    );
  }
  return <span className={`${base} bg-well text-mute ring-line`}>{id}</span>;
};

export const Refs: React.FC<{ ids: string[] }> = ({ ids }) =>
  ids.length ? (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => (
        <Ref key={id} id={id} />
      ))}
    </span>
  ) : null;

export const IdText: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`font-mono text-[0.92em] tracking-tight ${className}`}>{children}</span>
);
