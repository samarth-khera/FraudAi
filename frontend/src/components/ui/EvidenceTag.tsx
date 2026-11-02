import React from 'react';
import { BookOpenCheck, Cpu, HelpCircle, Lightbulb, Scale } from 'lucide-react';

/**
 * What kind of statement a piece of information is. Every screen keeps these apart, by label and icon as well as
 * colour, so a model output or an interpretation is never styled like a recorded fact.
 */
export type EvidenceKind = 'observed' | 'rule' | 'model' | 'interpretation' | 'missing';

const KIND: Record<EvidenceKind, { label: string; icon: typeof Cpu; className: string; help: string }> = {
  observed: {
    label: 'Recorded fact',
    icon: BookOpenCheck,
    className: 'bg-white text-ink-soft ring-line-strong',
    help: 'Read directly from the transaction records.',
  },
  rule: {
    label: 'Fixed rule',
    icon: Scale,
    className: 'bg-iris-wash text-iris-deep ring-iris-line',
    help: 'A fixed, documented rule matched these records.',
  },
  model: {
    label: 'Model output',
    icon: Cpu,
    className: 'bg-ice-soft text-info ring-ice-line',
    help: 'A machine-learning estimate. It can be wrong and is not proof.',
  },
  interpretation: {
    label: 'Possible interpretation',
    icon: Lightbulb,
    className: 'bg-warn-soft text-warn ring-warn-line',
    help: 'One way to read the evidence. Other explanations may fit.',
  },
  missing: {
    label: 'Not known',
    icon: HelpCircle,
    className: 'bg-well text-mute ring-line [border-style:dashed]',
    help: 'Information the records do not contain.',
  },
};

export const EvidenceTag: React.FC<{ kind: EvidenceKind; label?: string; className?: string }> = ({ kind, label, className = '' }) => {
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <span
      title={k.help}
      data-evidence-kind={kind}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ${k.className} ${className}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label ?? k.label}
    </span>
  );
};

/** A key to the evidence kinds, for pages that mix them. */
export const EvidenceLegend: React.FC<{ kinds?: EvidenceKind[]; className?: string }> = ({
  kinds = ['observed', 'rule', 'model', 'interpretation', 'missing'],
  className = '',
}) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-mute ${className}`} aria-label="How information is labelled">
    {kinds.map((k) => (
      <span key={k} className="inline-flex items-center gap-1.5">
        <EvidenceTag kind={k} />
        <span className="hidden sm:inline">{KIND[k].help}</span>
      </span>
    ))}
  </div>
);
