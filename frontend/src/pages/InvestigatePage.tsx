import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components/ui/StateViews';
import { AccountBrief } from '../components/investigation/AccountBrief';
import { CaseView, STAGES } from '../components/investigation/CaseView';
import { AccountEntry } from '../components/investigation/InvestigationForm';
import { DEFAULT_FORM, FormValues } from '../components/investigation/formModel';
import { v2Api } from '../services/v2Api';
import { ExplanationView, InvestigationRequest, InvestigationResponse } from '../types/investigation';

/** Settings live in the URL so a link can be shared; the investigation itself only runs on an explicit click. */
function formFromParams(p: URLSearchParams): FormValues {
  const num = (k: string, d: number) => (p.get(k) !== null && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : d);
  return {
    accountId: p.get('account') ?? '',
    startDate: p.get('from') ?? '',
    endDate: p.get('to') ?? '',
    maxDepth: num('depth', DEFAULT_FORM.maxDepth),
    maxNodes: num('nodes', DEFAULT_FORM.maxNodes),
    windowHours: num('window', DEFAULT_FORM.windowHours),
    scope: p.get('scope') === 'all' ? 'all' : 'flagged',
    maxAccounts: num('assess', DEFAULT_FORM.maxAccounts),
  };
}

function paramsFromForm(f: FormValues, accountId: string): Record<string, string> {
  const out: Record<string, string> = { account: accountId };
  if (f.startDate) out.from = f.startDate;
  if (f.endDate) out.to = f.endDate;
  if (f.maxDepth !== DEFAULT_FORM.maxDepth) out.depth = String(f.maxDepth);
  if (f.maxNodes !== DEFAULT_FORM.maxNodes) out.nodes = String(f.maxNodes);
  if (f.windowHours !== DEFAULT_FORM.windowHours) out.window = String(f.windowHours);
  if (f.scope !== DEFAULT_FORM.scope) out.scope = f.scope;
  if (f.maxAccounts !== DEFAULT_FORM.maxAccounts) out.assess = String(f.maxAccounts);
  return out;
}

function formFromRequest(r: InvestigationRequest): FormValues {
  return {
    accountId: r.account_id,
    startDate: r.start_date ?? '',
    endDate: r.end_date ?? '',
    maxDepth: r.max_depth ?? DEFAULT_FORM.maxDepth,
    maxNodes: r.max_nodes ?? DEFAULT_FORM.maxNodes,
    windowHours: r.onward_window_hours ?? DEFAULT_FORM.windowHours,
    scope: r.trace_scope ?? DEFAULT_FORM.scope,
    maxAccounts: r.max_accounts_analyzed ?? DEFAULT_FORM.maxAccounts,
  };
}

function investigationError(err: unknown): { title: string; message: string } {
  const e = err as { code?: string; message?: string; status?: number };
  if (err instanceof TypeError || e?.code === 'network_error') {
    return {
      title: 'The server could not be reached',
      message: 'No investigation was run. The free server sleeps when idle and can take about a minute to wake; try again shortly.',
    };
  }
  if (e?.code === 'account_not_found') return { title: 'Account not found', message: e.message ?? 'That account is not in the ledger.' };
  if (e?.code === 'validation_error') return { title: 'Check the settings', message: 'The server rejected one of the settings. Check the account ID and the trace settings.' };
  if (e?.code?.startsWith('data_source') || e?.code?.startsWith('ledger_')) {
    return { title: 'The transaction ledger is not available', message: e.message ?? 'The configured data source could not be used.' };
  }
  if (e?.code === 'investigation_failed') return { title: 'The investigation failed', message: e.message ?? 'No report was produced.' };
  return { title: 'The investigation failed', message: 'No report was produced. Try again; if it keeps failing, the server log has the cause.' };
}

export const InvestigatePage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account')?.trim() || '';
  const [form, setForm] = useState<FormValues>(() => formFromParams(params));
  const [running, setRunning] = useState<InvestigationRequest | null>(null);
  const [report, setReport] = useState<InvestigationResponse | null>(null);
  const [explanation, setExplanation] = useState<ExplanationView | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const start = async (request: InvestigationRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setElapsed(0);
    setReport(null);
    setExplanation(null);
    setError(null);
    setRunning(request);
    const settings = formFromRequest(request);
    setForm(settings);
    setParams(paramsFromForm(settings, request.account_id), { replace: true });
    // The report is returned without waiting for the AI analyst, which can take minutes; the explanation follows.
    const body: InvestigationRequest = { ...request, ai_explanation: 'separate' };
    let result: InvestigationResponse;
    try {
      result = await v2Api.runInvestigation(body, controller.signal);
      if (controller.signal.aborted) return;
      setReport(result);
      window.scrollTo?.({ top: 0 });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || controller.signal.aborted) return;
      setError(investigationError(err));
      return;
    } finally {
      if (abortRef.current === controller) setRunning(null);
    }
    if (result.ai_analysis.state !== 'deferred') return;
    setExplanation({ phase: 'pending', since: Date.now() });
    try {
      const ex = await v2Api.explainInvestigation(body, controller.signal);
      if (controller.signal.aborted) return;
      // Only show an explanation of exactly this report (the ledger could have changed in between).
      setExplanation(ex.report_digest === result.report_digest ? { phase: 'done', analysis: ex.ai_analysis } : { phase: 'stale' });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || controller.signal.aborted) return;
      setExplanation({
        phase: 'failed',
        message:
          err instanceof TypeError
            ? 'The server could not be reached for the AI explanation. The rest of the investigation is complete.'
            : 'The AI explanation request failed. The rest of the investigation is complete.',
      });
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setReport(null);
    setExplanation(null);
    setError(null);
    setRunning(null);
  };

  const newInvestigation = () => {
    reset();
    setForm(DEFAULT_FORM);
    setParams({}, { replace: true });
    window.scrollTo?.({ top: 0 });
  };

  const openAccount = (id: string) => {
    reset();
    setParams(paramsFromForm(form, id));
  };

  if (report) {
    return (
      <div className="pb-6">
        <CaseView report={report} explanation={explanation} onNew={newInvestigation} onRerun={start} />
      </div>
    );
  }

  if (accountId) {
    return (
      <div className="space-y-5 pb-6">
        <AccountBrief
          key={accountId}
          accountId={accountId}
          form={form}
          onFormChange={setForm}
          onStart={start}
          onChangeAccount={newInvestigation}
          running={Boolean(running)}
          elapsed={elapsed}
        />
        {error && !running && <ErrorState title={error.title} message={error.message} />}
      </div>
    );
  }

  return (
    <div className="max-w-5xl pb-6">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-ink leading-[1.05]">
            Follow an account’s money, one transfer at a time.
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-mute max-w-[60ch]">
            Open an account to see what the records already say about it. When you start the investigation, the server traces where its
            money went and came from, and walks you through the evidence one question at a time.
          </p>
          <div className="mt-8">
            <AccountEntry initial={form.accountId} onOpen={openAccount} />
          </div>
          <p className="mt-3 text-sm text-mute">
            New here? Try{' '}
            <button type="button" className="font-mono font-semibold text-iris-deep hover:text-iris underline-offset-2 hover:underline" onClick={() => openAccount('ACC-000001')}>
              ACC-000001
            </button>{' '}
            from the synthetic demo ledger.
          </p>
        </div>
        <ol className="panel p-5 space-y-4" aria-label="How an investigation is laid out">
          {STAGES.map((s, i) => (
            <li key={s.id} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-iris-soft text-iris-deep text-xs font-bold flex items-center justify-center shrink-0" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink">{s.label}</span>
                <span className="block text-xs text-mute">{s.question}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

export default InvestigatePage;
