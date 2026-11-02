import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Database } from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { retryRead } from '../../lib/retry';
import { DatasetId, DatasetSummary, SampleAccounts } from '../../types/dynamic';

const FALLBACK: Pick<DatasetSummary, 'dataset_id' | 'title' | 'description'>[] = [
  { dataset_id: 'demo-ledger', title: 'FraudShield demo ledger', description: 'The ledger used across FraudShield. Account IDs look like ACC-000001.' },
  { dataset_id: 'forensic-scenarios', title: 'Forensic scenario ledger', description: 'A separate synthetic ledger with documented scenario patterns. Account IDs look like FS-1A2B3C4D.' },
];

/** Which synthetic dataset to search, and a few starting points. Suggestions come from observable activity only. */
export const DatasetPicker: React.FC<{ value: DatasetId; onChange: (d: DatasetId) => void; onPickAccount: (id: string) => void }> = ({
  value,
  onChange,
  onPickAccount,
}) => {
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [loaded, setLoaded] = useState<SampleAccounts | null>(null);
  const radios = useRef(new Map<DatasetId, HTMLButtonElement>());
  const idBase = useId();
  // Suggestions are shown only for the dataset they were loaded for.
  const samples = loaded && loaded.dataset_id === value ? loaded : null;

  useEffect(() => {
    const c = new AbortController();
    retryRead(() => v2Api.listDatasets(c.signal), c.signal).then(setDatasets).catch(() => setDatasets(null));
    return () => c.abort();
  }, []);

  useEffect(() => {
    if (value === 'demo-ledger') return;
    const c = new AbortController();
    retryRead(() => v2Api.getSampleAccounts(value, c.signal), c.signal).then(setLoaded).catch(() => undefined);
    return () => c.abort();
  }, [value]);

  const list = datasets ?? FALLBACK.map((d) => ({ ...d, available: true, evaluation_labels_note: '' }) as DatasetSummary);
  // Radio group keyboard pattern: one tab stop (the selected dataset), arrow keys move the selection and focus.
  const tabStop = list.find((d) => d.dataset_id === value && d.available)?.dataset_id ?? list.find((d) => d.available)?.dataset_id;
  const onArrow = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let k = 1; k < list.length; k++) {
      const d = list[(((i + step * k) % list.length) + list.length) % list.length];
      if (!d.available) continue;
      onChange(d.dataset_id);
      radios.current.get(d.dataset_id)?.focus();
      return;
    }
  };
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Dataset</legend>
        <p className="mt-0.5 text-xs text-mute">Both are synthetic ledgers. Each keeps its own accounts and its own model validation.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Dataset">
          {list.map((d, i) => {
            const on = d.dataset_id === value;
            return (
              <button
                key={d.dataset_id}
                ref={(el) => {
                  if (el) radios.current.set(d.dataset_id, el);
                  else radios.current.delete(d.dataset_id);
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={d.dataset_id === tabStop ? 0 : -1}
                disabled={!d.available}
                onClick={() => onChange(d.dataset_id)}
                onKeyDown={(e) => onArrow(e, i)}
                className={`relative text-left rounded-2xl p-4 pr-10 transition-[box-shadow,background-color] duration-150 ${
                  on ? 'bg-white ring-2 ring-iris shadow-[var(--shadow-float)]' : 'bg-white/70 ring-1 ring-line hover:ring-iris-line hover:bg-white'
                } disabled:opacity-60`}
              >
                <span
                  className={`absolute right-3.5 top-3.5 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${on ? 'bg-iris text-white' : 'ring-1 ring-line-strong bg-white'}`}
                  aria-hidden="true"
                >
                  {on && <Check className="w-3 h-3" strokeWidth={3} />}
                </span>
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Database className={`w-4 h-4 ${on ? 'text-iris' : 'text-faint'}`} aria-hidden="true" />
                  {d.title}
                </span>
                <span className="mt-1 block text-xs text-mute leading-relaxed">{d.description}</span>
                {d.source && (
                  <span className="mt-2 block text-[11px] text-faint">
                    {d.source.accounts_count.toLocaleString('en-IN')} accounts, {d.source.transactions_count.toLocaleString('en-IN')} transfers, synthetic
                  </span>
                )}
                {d.model_support && (
                  <span
                    className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                      d.model_support === 'validated_in_distribution' ? 'bg-ok-soft text-ok ring-ok-line' : 'bg-sev-elevated-soft text-sev-elevated ring-warn-line'
                    }`}
                    data-testid={`model-support-${d.dataset_id}`}
                    title={d.model_note}
                  >
                    {d.model_support === 'validated_in_distribution'
                      ? 'Models validated on this dataset'
                      : d.model_support === 'unsupported_distribution_shift'
                        ? 'Models reference only: out of distribution'
                        : 'Models reference only: not validated'}
                  </span>
                )}
                {!d.available && d.unavailable_reason && <span className="mt-2 block text-[11px] text-sev-elevated">{d.unavailable_reason}</span>}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="text-sm text-mute">
        {value === 'demo-ledger' ? (
          <p>
            New here? Try{' '}
            <button type="button" className="font-mono font-semibold text-iris-deep hover:text-iris underline-offset-2 hover:underline" onClick={() => onPickAccount('ACC-000001')}>
              ACC-000001
            </button>{' '}
            from the synthetic demo ledger.
          </p>
        ) : samples && samples.accounts.length > 0 ? (
          <div>
            <p>Starting points with notable activity (not findings):</p>
            <ul className="mt-2 space-y-1.5" data-testid="sample-accounts">
              {samples.accounts.map((a, i) => (
                <li key={a.account_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <button
                    type="button"
                    aria-describedby={`${idBase}-reason-${i}`}
                    className="rounded-lg bg-white ring-1 ring-line px-2 py-1 font-mono text-xs font-semibold text-iris-deep shadow-[var(--shadow-xs)] transition-colors hover:ring-iris hover:bg-iris-wash"
                    onClick={() => onPickAccount(a.account_id)}
                  >
                    {a.account_id}
                  </button>
                  <span id={`${idBase}-reason-${i}`} className="text-xs text-mute">
                    {a.reason}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-faint">{samples.basis}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DatasetPicker;
