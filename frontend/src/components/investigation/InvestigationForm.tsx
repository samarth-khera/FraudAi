import React, { useId, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { InvestigationRequest } from '../../types/investigation';
import { FormValues, toRequest } from './formModel';

const field = 'mt-1 w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FCD5B5]';

export const InvestigationForm: React.FC<{
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: (request: InvestigationRequest) => void;
  running: boolean;
}> = ({ values, onChange, onSubmit, running }) => {
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const errId = useId();
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => onChange({ ...values, [k]: val });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = toRequest(values);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    onSubmit(result.request);
  };

  return (
    <form onSubmit={submit} noValidate className="rounded-3xl border border-[#EAE3D6] bg-white p-5 sm:p-7 shadow-[0_18px_40px_-24px_rgba(26,23,20,0.25)]">
      <label htmlFor="victim-account" className="block text-sm font-semibold text-[#1A1714]">
        Victim account ID
      </label>
      <p className="mt-0.5 text-xs text-[#6B655B]">The account whose money you want to follow. You can type 1, acc-1 or ACC-000001.</p>
      <div className="mt-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C857B]" aria-hidden="true" />
          <input
            id="victim-account"
            value={values.accountId}
            onChange={(e) => set('accountId', e.target.value)}
            placeholder="e.g. ACC-000001"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            className="w-full rounded-2xl border border-[#EAE3D6] bg-[#FAF7F2] pl-10 pr-3 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-[#FCD5B5] focus:bg-white"
          />
        </div>
        <button type="submit" className="btn-primary min-h-[3rem] px-6 text-sm" disabled={running} aria-busy={running}>
          {running ? 'Investigating…' : 'Start Investigation'}
        </button>
      </div>
      {error && (
        <p id={errId} role="alert" className="mt-2 text-sm font-medium text-[#BE123C]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        aria-expanded={advanced}
        aria-controls="advanced-settings"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6B655B] hover:text-[#1A1714]"
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        Advanced settings
        <ChevronDown className={`w-4 h-4 transition-transform ${advanced ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {advanced && (
        <div id="advanced-settings" className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <label className="block">
            <span className="font-semibold">From date</span>
            <input type="date" value={values.startDate} onChange={(e) => set('startDate', e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="font-semibold">To date</span>
            <input type="date" value={values.endDate} onChange={(e) => set('endDate', e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="font-semibold">Trace depth (hops)</span>
            <input type="number" min={1} max={6} value={values.maxDepth} onChange={(e) => set('maxDepth', Number(e.target.value))} className={field} />
          </label>
          <label className="block">
            <span className="font-semibold">Account limit</span>
            <input type="number" min={2} max={200} value={values.maxNodes} onChange={(e) => set('maxNodes', Number(e.target.value))} className={field} />
          </label>
          <label className="block">
            <span className="font-semibold">Follow-on window (hours)</span>
            <input type="number" min={1} max={720} value={values.windowHours} onChange={(e) => set('windowHours', Number(e.target.value))} className={field} />
          </label>
          <label className="block">
            <span className="font-semibold">Accounts assessed</span>
            <input type="number" min={1} max={60} value={values.maxAccounts} onChange={(e) => set('maxAccounts', Number(e.target.value))} className={field} />
          </label>
          <label className="block sm:col-span-2">
            <span className="font-semibold">Which transfers to trace</span>
            <select value={values.scope} onChange={(e) => set('scope', e.target.value as FormValues['scope'])} className={field}>
              <option value="flagged">Transfers flagged as unusual (largest if none)</option>
              <option value="all">Every transfer in the date range</option>
            </select>
          </label>
          <p className="sm:col-span-2 lg:col-span-4 text-xs text-[#6B655B]">
            The date range selects which of this account’s transfers start the trace; its full history is still used as
            the baseline. The follow-on window is how long after receiving funds an account’s transfers are followed.
          </p>
        </div>
      )}
    </form>
  );
};
