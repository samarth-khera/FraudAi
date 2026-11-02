import React, { useEffect, useId, useState } from 'react';
import { ArrowLeftRight, ArrowRight, FlaskConical, Route, SlidersHorizontal } from 'lucide-react';
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
import { DatasetAccount, DatasetId } from '../../types/dynamic';

interface Brief {
  /** History coverage in the chosen dataset; always present once loaded. */
  ds: DatasetAccount;
  /** Demo-ledger profile and rule assessment (the other dataset has no profile endpoint). */
  profile: V2AccountProfileResponse | null;
  assessment: V2AccountAssessmentResponse | null;
  source: DataSourceInfo | null;
}

// The engine's own steps (backend/app/intelligence/engine.py). Listed, not animated: no step is claimed as current.
const RUN_STEPS = [
  'Loading account history',
  'Generating historical features',
  'Detecting suspicious transactions',
  'Tracing funds',
  'Examining counterparties',
  'Preparing investigation results',
];

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
  datasetId?: DatasetId;
  form: FormValues;
  onFormChange: (v: FormValues) => void;
  onStart: (r: InvestigationRequest) => void;
  onChangeAccount: () => void;
  running: boolean;
  elapsed: number;
}> = ({ accountId, datasetId = 'demo-ledger', form, onFormChange, onStart, onChangeAccount, running, elapsed }) => {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errId = useId();

  useEffect(() => {
    // Aborted on unmount or when the account, dataset or attempt changes, so stale lookups stop and never land.
    const controller = new AbortController();
    const { signal } = controller;
    setLoad({ state: 'loading' });
    const demo = datasetId === 'demo-ledger';
    const none = Promise.resolve(null);
    Promise.allSettled([
      v2Api.getDatasetAccount(datasetId, accountId, signal),
      demo ? v2Api.getAccount(accountId, signal) : none,
      demo ? v2Api.getAssessment(accountId, signal) : none,
      demo ? v2Api.getDataSource(signal) : none,
    ]).then(([d, p, a, s]) => {
      if (signal.aborted) return;
      if (d.status === 'rejected') {
        const e = d.reason as { code?: string; status?: number; message?: string };
        const notFound = e?.status === 404;
        setLoad({
          state: 'error',
          notFound,
          title: notFound ? 'Account not found' : d.reason instanceof TypeError ? 'The server could not be reached' : 'The account could not be loaded',
          message: notFound
            ? e?.message ?? `${accountId} is not in the selected dataset.`
            : d.reason instanceof TypeError
              ? 'The free server sleeps when idle and can take about a minute to wake. Try again shortly.'
              : e?.message ?? 'Try again; if it keeps failing, the server log has the cause.',
        });
        return;
      }
      setLoad({
        state: 'ready',
        brief: {
          ds: d.value,
          profile: p.status === 'fulfilled' ? p.value : null,
          assessment: a.status === 'fulfilled' ? a.value : null,
          source: s.status === 'fulfilled' ? s.value : null,
        },
      });
    });
    return () => controller.abort();
  }, [accountId, datasetId, attempt]);

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
      <div key="loading" className="space-y-5" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-sm text-mute">
          <span className="relative w-4 h-4" aria-hidden="true">
            <span className="absolute inset-0 rounded-full border-2 border-iris-soft" />
            <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-iris border-r-ice animate-spin" />
          </span>
          Loading <IdText className="text-ink">{accountId}</IdText>…
        </div>
        <span className="skeleton block h-10 w-72" aria-hidden="true" />
        <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel p-5 space-y-3">
              <span className="skeleton block h-4 w-40" />
              <span className="skeleton block h-8 w-28" />
              <span className="skeleton block h-3 w-full" />
              <span className="skeleton block h-3 w-3/4" />
            </div>
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

  const { ds, profile: p, assessment: a, source: s } = load.brief;
  const signals = (a?.reason_codes ?? []).map(splitCoded).filter((x) => x.code !== 'NORMAL_ACTIVITY');
  const settingsChanged = JSON.stringify({ ...form, accountId: '' }) !== JSON.stringify({ ...DEFAULT_FORM, accountId: '' });
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'None');
  const models = Object.entries(ds.models);
  // Older servers do not send models_validated; treat that as validated, as before.
  const modelsValidated = ds.models_validated !== false;

  return (
    <div key="ready" className="space-y-5" data-testid="account-brief">
      <header data-reveal className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-mute">Account under investigation in the {ds.dataset_title.toLowerCase()}</p>
          <h1 className="mt-1.5 page-title !text-[32px] sm:!text-[40px] font-mono !tracking-[-0.02em]">{ds.account_id}</h1>
          <p className="mt-1.5 text-[15px] text-mute">
            {p ? `${p.customer_name}, ${p.customer_type} customer, ${p.kyc_tier.replace(/_/g, ' ')}, account ${p.status}` : `${ds.customer_type} account, synthetic`}
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={onChangeAccount}>
          <ArrowLeftRight className="w-4 h-4" aria-hidden="true" /> Change account
        </button>
      </header>

      <div data-reveal className="grid gap-4 lg:grid-cols-3 items-start">
        {a ? (
          <section aria-labelledby="sev-h" className="panel p-5">
            <h2 id="sev-h" className="text-sm font-semibold text-ink">Assessment before tracing</h2>
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
          </section>
        ) : (
          <section aria-labelledby="cov-h" className="panel p-5" data-testid="history-coverage">
            <h2 id="cov-h" className="text-sm font-semibold text-ink">Available history</h2>
            <p className="mt-3 font-display text-3xl font-bold text-ink">{ds.transactions}</p>
            <p className="text-xs text-mute">transfers on record ({ds.outgoing} out, {ds.incoming} in)</p>
            <p className={`mt-3 text-sm ${ds.history_sufficient ? 'text-ink-soft' : 'text-sev-elevated font-medium'}`}>{ds.coverage_note}</p>
            <p className="mt-3 text-[11px] text-faint">No prediction is shown before the investigation runs.</p>
          </section>
        )}

        <section aria-labelledby="act-h" className="panel p-5">
          <h2 id="act-h" className="text-sm font-semibold text-ink">Account activity</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {p ? (
              <>
                <Fact label="Balance" value={formatMoney(p.current_balance)} />
                <Fact label="Opened" value={new Date(p.account_opened_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} />
                <Fact label="Money in" value={formatMoney(p.metrics.total_incoming_amount)} note={`${p.metrics.total_incoming_txns} transfers`} />
                <Fact label="Money out" value={formatMoney(p.metrics.total_outgoing_amount)} note={`${p.metrics.total_outgoing_txns} transfers`} />
                <Fact label="Counterparties" value={p.metrics.unique_counterparties} />
                <Fact label="Last activity" value={p.metrics.last_activity_at ? formatDateTime(p.metrics.last_activity_at) : 'None'} />
              </>
            ) : (
              <>
                <Fact label="Incoming" value={ds.incoming} note="transfers" />
                <Fact label="Outgoing" value={ds.outgoing} note="transfers" />
                <Fact label="First record" value={day(ds.first_transaction_at)} />
                <Fact label="Last record" value={day(ds.last_transaction_at)} />
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="trace-h" className="panel p-5 flex flex-col">
          <h2 id="trace-h" className="text-sm font-semibold text-ink flex items-center gap-2">
            <Route className="w-4 h-4 text-iris" aria-hidden="true" /> What can be traced
          </h2>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            {ds.transactions === 0
              ? 'This account has no transfers on record, so there is nothing to trace.'
              : modelsValidated
                ? `${ds.outgoing} outgoing and ${ds.incoming} incoming transfers are on record. Each is scored by the transaction model from earlier records only; the trace starts from the ones flagged by the model or the fixed rules, or the largest if none are.`
                : `${ds.outgoing} outgoing and ${ds.incoming} incoming transfers are on record. The trace starts from the ones flagged by the fixed rules, or the largest if none are. The models are not validated on this dataset, so their scores are shown for reference only.`}
          </p>
          <p className="mt-2 text-xs text-mute">
            Follows money up to {form.maxDepth} hop{form.maxDepth === 1 ? '' : 's'}, within {form.windowHours} h of each receipt
            {settingsChanged ? ' (custom settings)' : ''}.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-mute" aria-label="Model availability">
            {models.map(([name, m]) => (
              <li key={name}>
                {name === 'transaction_model' ? 'Transaction model' : 'Account behaviour model'}:{' '}
                <span className={m.available ? 'font-semibold text-ink' : 'font-semibold text-sev-elevated'}>{m.available ? m.model_version : 'unavailable'}</span>
                {m.available && !modelsValidated && ' (reference only, not validated on this dataset)'}
              </li>
            ))}
          </ul>
          {!modelsValidated && ds.model_note && (
            <p className="mt-2 text-xs text-sev-elevated" data-testid="models-reference-only">
              {ds.model_note}
            </p>
          )}
          <p className="mt-auto pt-4 text-xs text-mute flex items-start gap-1.5">
            <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sev-elevated" aria-hidden="true" />
            <span>
              {s ? `${s.is_synthetic ? 'Synthetic demo data. ' : ''}${s.source_name}, as of ${formatDateTime(s.data_as_of)}. Real bank data: ${s.real_bank_data ? 'yes' : 'no'}.` : `Synthetic data. ${ds.dataset_title}. Real bank data: no.`}
            </span>
          </p>
        </section>
      </div>

      <div data-reveal className="panel panel-sheen relative overflow-hidden p-5 sm:p-6">
        <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-iris to-ice" aria-hidden="true" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="max-w-2xl">
            <p className="card-title !text-base">Ready to investigate</p>
            <p className="mt-0.5 text-sm text-mute">
              The server reads this account’s history now, scores each transfer, traces where the money went and came from, and assesses every
              connected account on its own records. Nothing is precomputed, stored or acted on.
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
            <button type="button" className="btn-primary min-h-[2.875rem] px-6 text-[15px]" onClick={start} disabled={running} aria-busy={running} aria-describedby={formError ? errId : undefined}>
              {running ? 'Investigating…' : 'Start fund investigation'}
              {!running && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
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
            <TraceSettings values={form} onChange={onFormChange} limitsOnly />
          </div>
        )}
        {running && (
          <div role="status" aria-live="polite" className="mt-5 pt-5 border-t border-line flex items-start gap-3 rise-in" data-testid="investigation-running">
            <span className="relative mt-0.5 w-4 h-4 shrink-0" aria-hidden="true">
              <span className="absolute inset-0 rounded-full border-2 border-iris-soft" />
              <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-iris border-r-ice animate-spin" />
            </span>
            <div className="text-sm">
              <p className="font-semibold text-ink">
                Investigating <IdText>{accountId}</IdText>… {elapsed > 0 && <span className="font-normal text-faint">{elapsed} s</span>}
              </p>
              <p className="mt-0.5 text-mute">
                The server runs these steps in one request; the time each one took appears in the report.
                {elapsed >= 10 && ' If the free server was asleep, the first request can take about a minute.'}
              </p>
              <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-xs text-ink-soft" aria-label="Steps being run">
                {RUN_STEPS.map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-iris-line shrink-0" aria-hidden="true" />
                    {x}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountBrief;
