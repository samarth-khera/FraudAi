import React, { useEffect, useId, useState } from 'react';
import { ArrowLeftRight, FlaskConical, Route, SlidersHorizontal } from 'lucide-react';
import { formatDateTime, formatMoney } from '../../lib/format';
import { v2Api } from '../../services/v2Api';
import { DataSourceInfo } from '../../types/investigation';
import { V2AccountAssessmentResponse, V2AccountProfileResponse } from '../../types/v2';
import { ErrorState } from '../ui/StateViews';
import { DEFAULT_FORM, FormValues, toRequest } from './formModel';
import { TraceSettings } from './InvestigationForm';
import { splitCoded } from './labels';
import { Severity } from './caseModel';
import { IdText, SeverityMeter } from './ui';
import { InvestigationRequest } from '../../types/investigation';

interface Brief {
  profile: V2AccountProfileResponse;
  assessment: V2AccountAssessmentResponse | null;
  source: DataSourceInfo | null;
}

type Load = { state: 'loading' } | { state: 'ready'; brief: Brief } | { state: 'error'; title: string; message: string; notFound: boolean };

const Fact: React.FC<{ label: string; value: React.ReactNode; note?: string }> = ({ label, value, note }) => (
  <div>
    <dt className="text-xs text-mute">{label}</dt>
    <dd className="mt-0.5 text-[15px] font-semibold text-ink">{value}</dd>
    {note && <dd className="text-[11px] text-faint">{note}</dd>}
  </div>
);

/**
 * Stage A. What the investigator needs before tracing: who the account is, what the rules already say about it,
 * whether there is anything to trace and which data this is. Read-only lookups; the trace runs only on the button.
 */
export const AccountBrief: React.FC<{
  accountId: string;
  form: FormValues;
  onFormChange: (v: FormValues) => void;
  onStart: (r: InvestigationRequest) => void;
  onChangeAccount: () => void;
  running: boolean;
  elapsed: number;
}> = ({ accountId, form, onFormChange, onStart, onChangeAccount, running, elapsed }) => {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errId = useId();

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    Promise.allSettled([v2Api.getAccount(accountId), v2Api.getAssessment(accountId), v2Api.getDataSource()]).then(([p, a, s]) => {
      if (!live) return;
      if (p.status === 'rejected') {
        const e = p.reason as { code?: string; status?: number; message?: string };
        const notFound = e?.status === 404;
        setLoad({
          state: 'error',
          notFound,
          title: notFound ? 'Account not found' : p.reason instanceof TypeError ? 'The server could not be reached' : 'The account could not be loaded',
          message: notFound
            ? `${accountId} is not in the configured ledger. Check the ID (for example ACC-000001).`
            : p.reason instanceof TypeError
              ? 'The free server sleeps when idle and can take about a minute to wake. Try again shortly.'
              : e?.message ?? 'Try again; if it keeps failing, the server log has the cause.',
        });
        return;
      }
      setLoad({
        state: 'ready',
        brief: { profile: p.value, assessment: a.status === 'fulfilled' ? a.value : null, source: s.status === 'fulfilled' ? s.value : null },
      });
    });
    return () => {
      live = false;
    };
  }, [accountId, attempt]);

  const start = () => {
    const result = toRequest({ ...form, accountId });
    if ('error' in result) {
      setFormError(result.error);
      setSettingsOpen(true);
      return;
    }
    setFormError(null);
    onStart(result.request);
  };

  if (load.state === 'loading') {
    return (
      <div className="panel p-8" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-sm text-mute">
          <span className="w-4 h-4 rounded-full border-2 border-iris border-t-transparent animate-spin" aria-hidden="true" />
          Loading <IdText className="text-ink">{accountId}</IdText>…
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-well animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (load.state === 'error') {
    return (
      <ErrorState title={load.title} message={load.message} onRetry={load.notFound ? undefined : () => setAttempt((n) => n + 1)}>
        <button type="button" className="btn-secondary mt-1" onClick={onChangeAccount}>
          Choose another account
        </button>
      </ErrorState>
    );
  }

  const { profile: p, assessment: a, source: s } = load.brief;
  const m = p.metrics;
  const signals = (a?.reason_codes ?? []).map(splitCoded).filter((x) => x.code !== 'NORMAL_ACTIVITY');
  const settingsChanged = JSON.stringify({ ...form, accountId: '' }) !== JSON.stringify({ ...DEFAULT_FORM, accountId: '' });

  return (
    <div className="space-y-5" data-testid="account-brief">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-mute">Account under investigation</p>
          <h1 className="mt-1 font-display text-4xl sm:text-5xl font-bold tracking-tight text-ink">{p.account_id}</h1>
          <p className="mt-2 text-[15px] text-mute">
            {p.customer_name}, {p.customer_type} customer, {p.kyc_tier.replace(/_/g, ' ')}, account {p.status}
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={onChangeAccount}>
          <ArrowLeftRight className="w-4 h-4" aria-hidden="true" /> Change account
        </button>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="sev-h" className="panel p-5">
          <h2 id="sev-h" className="text-sm font-semibold text-ink">Assessment before tracing</h2>
          {a ? (
            <>
              <div className="mt-3 flex items-end justify-between gap-3">
                <SeverityMeter level={a.risk_level as Severity} />
                <span className="text-xs text-mute">{Math.round(a.risk_score)} of 100 rule points</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {signals.length ? (
                  signals.slice(0, 3).map((x) => (
                    <li key={x.label}>
                      <span className="font-semibold text-ink">{x.label}</span>
                      {x.detail && <span className="block text-xs text-mute">{x.detail}</span>}
                    </li>
                  ))
                ) : (
                  <li className="text-mute">No rule signal on this account’s own history.</li>
                )}
              </ul>
              <p className="mt-3 text-[11px] text-faint">From this account’s own records only. A severity is a prompt for review, not proof.</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-mute">The rule assessment is not available right now. The investigation will compute it.</p>
          )}
        </section>

        <section aria-labelledby="act-h" className="panel p-5">
          <h2 id="act-h" className="text-sm font-semibold text-ink">Account activity</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Balance" value={formatMoney(p.current_balance)} />
            <Fact label="Opened" value={new Date(p.account_opened_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} />
            <Fact label="Money in" value={formatMoney(m.total_incoming_amount)} note={`${m.total_incoming_txns} transfers`} />
            <Fact label="Money out" value={formatMoney(m.total_outgoing_amount)} note={`${m.total_outgoing_txns} transfers`} />
            <Fact label="Counterparties" value={m.unique_counterparties} />
            <Fact label="Last activity" value={m.last_activity_at ? formatDateTime(m.last_activity_at) : 'None'} />
          </dl>
        </section>

        <section aria-labelledby="trace-h" className="panel p-5 flex flex-col">
          <h2 id="trace-h" className="text-sm font-semibold text-ink flex items-center gap-2">
            <Route className="w-4 h-4 text-iris" aria-hidden="true" /> What can be traced
          </h2>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            {m.total_outgoing_txns + m.total_incoming_txns === 0
              ? 'This account has no transfers on record, so there is nothing to trace.'
              : `${m.total_outgoing_txns} outgoing and ${m.total_incoming_txns} incoming transfers are on record. The trace starts from the ones the rules flag as unusual, or the largest if none are.`}
          </p>
          <p className="mt-2 text-xs text-mute">
            Follows money up to {form.maxDepth} hop{form.maxDepth === 1 ? '' : 's'}, within {form.windowHours} h of each receipt
            {settingsChanged ? ' (custom settings)' : ''}.
          </p>
          {s && (
            <p className="mt-auto pt-4 text-xs text-mute flex items-start gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sev-elevated" aria-hidden="true" />
              <span>
                {s.is_synthetic ? 'Synthetic demo data. ' : ''}
                {s.source_name}, as of {formatDateTime(s.data_as_of)}. Real bank data: {s.real_bank_data ? 'yes' : 'no'}.
              </span>
            </p>
          )}
        </section>
      </div>

      <div className="panel p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="max-w-2xl">
            <p className="font-semibold text-ink">Ready to follow the money</p>
            <p className="mt-0.5 text-sm text-mute">
              The server queries the ledger now, traces where the money went and came from, and assesses every linked account on its own
              records. Nothing is precomputed or stored.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              className="btn-secondary"
              aria-expanded={settingsOpen}
              aria-controls="advanced-settings"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" /> Trace settings
            </button>
            <button type="button" className="btn-primary min-h-[2.75rem] px-6" onClick={start} disabled={running} aria-busy={running} aria-describedby={formError ? errId : undefined}>
              {running ? 'Investigating…' : 'Start fund investigation'}
            </button>
          </div>
        </div>
        {formError && (
          <p id={errId} role="alert" className="mt-3 text-sm font-medium text-sev-critical">
            {formError}
          </p>
        )}
        {settingsOpen && (
          <div className="mt-5 pt-5 border-t border-line rise-in">
            <TraceSettings values={form} onChange={onFormChange} />
          </div>
        )}
        {running && (
          <div role="status" aria-live="polite" className="mt-5 pt-5 border-t border-line flex items-start gap-3" data-testid="investigation-running">
            <span className="mt-0.5 w-4 h-4 rounded-full border-2 border-iris border-t-transparent animate-spin shrink-0" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-semibold text-ink">
                Investigating <IdText>{accountId}</IdText>… {elapsed > 0 && <span className="font-normal text-faint">{elapsed} s</span>}
              </p>
              <p className="mt-0.5 text-mute">
                The server is querying the ledger and running the checks. The report appears when it has finished.
                {elapsed >= 10 && ' If the free server was asleep, the first request can take about a minute.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountBrief;
