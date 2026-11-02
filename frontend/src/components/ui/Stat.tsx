import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * One measured value: what it is, the number, and the context needed to read it. Values always come from the API; the
 * component never derives or rounds them on its own.
 */
export const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'iris' | 'ice' | 'ok' | 'warn';
  loading?: boolean;
  className?: string;
}> = ({ label, value, note, icon: Icon, tone = 'neutral', loading = false, className = '' }) => {
  const chip = {
    neutral: 'bg-well text-mute ring-line',
    iris: 'bg-iris-soft text-iris-deep ring-iris-line',
    ice: 'bg-ice-soft text-ice-deep ring-ice-line',
    ok: 'bg-ok-soft text-ok ring-ok-line',
    warn: 'bg-warn-soft text-warn ring-warn-line',
  }[tone];
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="flex items-center gap-2 text-[13px] font-medium text-mute">
        {Icon && (
          <span className={`inline-flex w-6 h-6 items-center justify-center rounded-lg ring-1 ring-inset ${chip}`} aria-hidden="true">
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-2">
        {loading ? <span className="skeleton block h-8 w-28" aria-hidden="true" /> : <span className="metric block truncate">{value}</span>}
      </dd>
      {note && <dd className="mt-1 text-xs leading-snug text-faint">{loading ? <span className="skeleton block h-3 w-36" aria-hidden="true" /> : note}</dd>}
    </div>
  );
};
