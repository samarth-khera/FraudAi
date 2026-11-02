import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components/ui/StateViews';
import { AccountBrief } from '../components/investigation/AccountBrief';
import { CaseView, STAGES } from '../components/investigation/CaseView';
import { AccountEntry } from '../components/investigation/InvestigationForm';
import { DEFAULT_FORM, FormValues } from '../components/investigation/formModel';
import { v2Api } from '../services/v2Api';
import { ExplanationView, InvestigationRequest } from '../types/investigation';
import { DatasetId, DynamicInvestigationRequest, DynamicReport } from '../types/dynamic';
import { DatasetPicker } from '../components/investigation/DatasetPicker';
import { PageHeader } from '../components/ui/PageHeader';
import { retryRead } from '../lib/retry';

const DATASETS: DatasetId[] = ['demo-ledger', 'forensic-scenarios'];
function datasetFrom(p: URLSearchParams): DatasetId {
  const d = p.get('dataset') as DatasetId | null;
  return d && DATASETS.includes(d) ? d : 'demo-ledger';
}

/** The dynamic engine takes the trace limits; the account's whole history is always the baseline. */
function toDynamic(r: InvestigationRequest, dataset: DatasetId): DynamicInvestigationRequest {
  return {
    account_id: r.account_id,
    dataset_id: dataset,
    max_depth: r.max_depth,
    max_nodes: r.max_nodes,
    onward_window_hours: r.onward_window_hours,
    max_accounts_analyzed: r.max_accounts_analyzed,
    ai_explanation: 'separate',
  };
}

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

function paramsFromForm(f: FormValues, accountId: string, dataset: DatasetId): Record<string, string> {
  const out: Record<string, string> = { account: accountId };
  if (dataset !== 'demo-ledger') out.dataset = dataset;
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
  if (e?.code === 'account_not_found') return { title: 'Account not found', message: e.message ?? 'That account is not in the selected dataset.' };
  if (e?.code === 'dataset_unavailable') return { title: 'This dataset is not available', message: e.message ?? 'The selected dataset has not been built on this server.' };
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
  const dataset = datasetFrom(params);
  const [form, setForm] = useState<FormValues>(() => formFromParams(params));
  const [running, setRunning] = useState<InvestigationRequest | null>(null);
  const [report, setReport] = useState<DynamicReport | null>(null);
  const [explanation, setExplanation] = useState<ExplanationView | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const explainAbortRef = useRef<AbortController | null>(null);
  // The request and digest of the report on screen, so an explanation is requested for exactly that report.
  const lastRunRef = useRef<{ body: DynamicInvestigationRequest; digest?: string } | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      explainAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const start = async (request: InvestigationRequest) => {
    abortRef.current?.abort();
    explainAbortRef.current?.abort();
    lastRunRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    setElapsed(0);
    setReport(null);
    setExplanation(null);
    setError(null);
    setRunning(request);
    const settings = formFromRequest(request);
    setForm(settings);
    setParams(paramsFromForm(settings, request.account_id, dataset), { replace: true });
    // The report never waits for, or triggers, the AI analyst: an explanation is only requested when the investigator asks.
    const body = toDynamic(request, dataset);
    try {
      // Read-only on the server (nothing is stored, the result is deterministic), so a connection dropped before the
      // answer arrived is retried once, as reads are; HTTP errors and a second drop still show the error.
      const result = await retryRead(() => v2Api.runDynamicInvestigation(body, controller.signal), controller.signal);
      if (controller.signal.aborted) return;
      lastRunRef.current = { body, digest: result.investigation.report_digest };
      setReport(result);
      window.scrollTo?.({ top: 0 });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || controller.signal.aborted) return;
      setError(investigationError(err));
      return;
    } finally {
      if (abortRef.current === controller) setRunning(null);
    }
  };

  /** Explicit, investigator-initiated request for the optional AI explanation of the report on screen. */
  const requestExplanation = async () => {
    const last = lastRunRef.current;
    if (!last) return;
    explainAbortRef.current?.abort();
    const controller = new AbortController();
    explainAbortRef.current = controller;
    setExplanation({ phase: 'pending', since: Date.now() });
    try {
      const ex = await v2Api.explainDynamicInvestigation(last.body, controller.signal);
      if (controller.signal.aborted) return;
      // Only show an explanation of exactly this report (the ledger could have changed in between). An empty digest means
      // the server explained nothing (e.g. the analyst was turned off meanwhile), so its state is shown as is.
      const same = !ex.report_digest || ex.report_digest === last.digest;
      setExplanation(same ? { phase: 'done', analysis: ex.ai_analysis } : { phase: 'stale' });
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
    explainAbortRef.current?.abort();
    lastRunRef.current = null;
    setReport(null);
    setExplanation(null);
    setError(null);
    setRunning(null);
  };

  const newInvestigation = () => {
    reset();
    setForm(DEFAULT_FORM);
    setParams(dataset === 'demo-ledger' ? {} : { dataset }, { replace: true });
    window.scrollTo?.({ top: 0 });
  };

  const openAccount = (id: string) => {
    reset();
    setParams(paramsFromForm(form, id, dataset));
  };

  const chooseDataset = (d: DatasetId) => {
    reset();
    setParams(d === 'demo-ledger' ? {} : { dataset: d }, { replace: true });
  };

  if (report) {
    return (
      <div className="pb-6">
        <CaseView
          report={report.investigation}
          intel={report}
          explanation={explanation}
          onNew={newInvestigation}
          onRerun={start}
          onRequestExplanation={report.investigation.ai_analysis.state === 'deferred' ? requestExplanation : undefined}
        />
      </div>
    );
  }

  if (accountId) {
    return (
      <div className="space-y-5 pb-6">
        <AccountBrief
          key={`${dataset}:${accountId}`}
          accountId={accountId}
          datasetId={dataset}
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
    <div className="space-y-7 pb-6">
      <PageHeader
        title="Follow an account’s money, one transfer at a time."
        description="Open an account to see what the records already say about it. When you start the investigation, the server traces where its money went and came from, and walks you through the evidence one question at a time."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div data-reveal className="panel panel-sheen p-5 sm:p-7 space-y-6">
          <DatasetPicker value={dataset} onChange={chooseDataset} onPickAccount={openAccount} />
          <div className="border-t border-line pt-6">
            <AccountEntry compact initial={form.accountId} onOpen={openAccount} />
            <p className="mt-3 text-[13px] text-mute">
              Account IDs are searched only inside the selected synthetic dataset. FraudShield cannot look up real bank accounts.
            </p>
          </div>
        </div>
        <section data-reveal className="panel p-5 sm:p-6" aria-labelledby="layout-h">
          <h2 id="layout-h" className="card-title">How the results are laid out</h2>
          <ol className="mt-4 relative space-y-4 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-line" aria-label="How an investigation is laid out">
            {STAGES.map((s, i) => (
              <li key={s.id} className="relative flex gap-3">
                <span className="relative w-6 h-6 rounded-full bg-white ring-1 ring-iris-line text-iris-deep text-[11px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{s.label}</span>
                  <span className="block text-[13px] text-mute leading-snug">{s.question}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
};

export default InvestigatePage;
