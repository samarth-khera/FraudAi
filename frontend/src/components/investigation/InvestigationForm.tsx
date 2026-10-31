import React, { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { ACCOUNT_ID_PATTERN, normalizeAccountId } from '../../lib/accountId';
import { FormValues } from './formModel';

/** The first step: which account to look at. Opening it only reads the account; nothing is traced yet. */
export const AccountEntry: React.FC<{ initial?: string; onOpen: (accountId: string) => void; compact?: boolean }> = ({ initial = '', onOpen, compact }) => {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = normalizeAccountId(value);
    if (!id) return setError('Enter the account ID to investigate.');
    if (!ACCOUNT_ID_PATTERN.test(id)) return setError('Account IDs use letters, numbers, dots, dashes and underscores only (for example ACC-000001).');
    setError(null);
    onOpen(id);
  };

  return (
    <form onSubmit={submit} noValidate className={compact ? '' : 'panel p-5 sm:p-6'}>
      <label htmlFor="account-id" className="block text-sm font-semibold text-ink">
        Account ID
      </label>
      <p className="mt-0.5 text-xs text-mute">The account whose money you want to follow. You can type 1, acc-1 or ACC-000001.</p>
      <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            id="account-id"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ACC-000001"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            className="field !py-3 !pl-10 font-mono text-base"
          />
        </div>
        <button type="submit" className="btn-primary min-h-[3rem] px-6">
          Open account
        </button>
      </div>
      {error && (
        <p id={errId} role="alert" className="mt-2 text-sm font-medium text-sev-critical">
          {error}
        </p>
      )}
    </form>
  );
};

/** Trace settings. Limits match the API's own; `toRequest` validates them before anything is sent. */
export const TraceSettings: React.FC<{ values: FormValues; onChange: (v: FormValues) => void }> = ({ values, onChange }) => {
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => onChange({ ...values, [k]: val });
  const label = 'block text-sm';
  const name = 'font-semibold text-ink';
  return (
    <div id="advanced-settings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className={label}>
        <span className={name}>From date</span>
        <input type="date" value={values.startDate} onChange={(e) => set('startDate', e.target.value)} className="field mt-1" />
      </label>
      <label className={label}>
        <span className={name}>To date</span>
        <input type="date" value={values.endDate} onChange={(e) => set('endDate', e.target.value)} className="field mt-1" />
      </label>
      <label className={label}>
        <span className={name}>Trace depth (hops)</span>
        <input type="number" min={1} max={6} value={values.maxDepth} onChange={(e) => set('maxDepth', Number(e.target.value))} className="field mt-1" />
      </label>
      <label className={label}>
        <span className={name}>Account limit</span>
        <input type="number" min={2} max={200} value={values.maxNodes} onChange={(e) => set('maxNodes', Number(e.target.value))} className="field mt-1" />
      </label>
      <label className={label}>
        <span className={name}>Follow-on window (hours)</span>
        <input type="number" min={1} max={720} value={values.windowHours} onChange={(e) => set('windowHours', Number(e.target.value))} className="field mt-1" />
      </label>
      <label className={label}>
        <span className={name}>Accounts assessed</span>
        <input type="number" min={1} max={60} value={values.maxAccounts} onChange={(e) => set('maxAccounts', Number(e.target.value))} className="field mt-1" />
      </label>
      <label className={`${label} sm:col-span-2`}>
        <span className={name}>Which transfers to trace</span>
        <select value={values.scope} onChange={(e) => set('scope', e.target.value as FormValues['scope'])} className="field mt-1">
          <option value="flagged">Transfers flagged as unusual (largest if none)</option>
          <option value="all">Every transfer in the date range</option>
        </select>
      </label>
      <p className="sm:col-span-2 lg:col-span-4 text-xs text-mute">
        The date range selects which of this account’s transfers start the trace; its full history is still the baseline. The follow-on
        window is how long after receiving funds an account’s transfers are followed.
      </p>
    </div>
  );
};
