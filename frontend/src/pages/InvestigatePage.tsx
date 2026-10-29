import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components/ui/StateViews';
import { InvestigationForm } from '../components/investigation/InvestigationForm';
import { DEFAULT_FORM, FormValues } from '../components/investigation/formModel';
import { InvestigationReport } from '../components/investigation/InvestigationReport';
import { v2Api } from '../services/v2Api';
import { ExplanationView, InvestigationRequest, InvestigationResponse } from '../types/investigation';

/** Form settings live in the URL so a link can be shared; the investigation itself only runs on an explicit click. */
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

function paramsFromRequest(r: InvestigationRequest): Record<string, string> {
  const out: Record<string, string> = { account: r.account_id };
  if (r.start_date) out.from = r.start_date;
  if (r.end_date) out.to = r.end_date;
  if (r.max_depth !== DEFAULT_FORM.maxDepth) out.depth = String(r.max_depth);
  if (r.max_nodes !== DEFAULT_FORM.maxNodes) out.nodes = String(r.max_nodes);
  if (r.onward_window_hours !== DEFAULT_FORM.windowHours) out.window = String(r.onward_window_hours);
  if (r.trace_scope !== DEFAULT_FORM.scope) out.scope = String(r.trace_scope);
  if (r.max_accounts_analyzed !== DEFAULT_FORM.maxAccounts) out.assess = String(r.max_accounts_analyzed);
  return out;
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
  if (e?.code === 'validation_error') return { title: 'Check the settings', message: 'The server rejected one of the settings. Check the account ID and the advanced settings.' };
  if (e?.code?.startsWith('data_source') || e?.code?.startsWith('ledger_')) {
    return { title: 'The transaction ledger is not available', message: e.message ?? 'The configured data source could not be used.' };
  }
  if (e?.code === 'investigation_failed') return { title: 'The investigation failed', message: e.message ?? 'No report was produced.' };
  return { title: 'The investigation failed', message: 'No report was produced. Try again; if it keeps failing, the server log has the cause.' };
}

export const InvestigatePage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<FormValues>(() => formFromParams(params));
  const [running, setRunning] = useState<InvestigationRequest | null>(null);
  const [report, setReport] = useState<InvestigationResponse | null>(null);
  const [explanation, setExplanation] = useState<ExplanationView | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [fromLink, setFromLink] = useState(() => Boolean(params.get('account')));

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
    setFromLink(false);
    setElapsed(0);
    setReport(null);
    setExplanation(null);
    setError(null);
    setRunning(request);
    setParams(paramsFromRequest(request), { replace: true });
    // The report is returned without waiting for the AI analyst, which can take minutes; the explanation follows.
    const body: InvestigationRequest = { ...request, ai_explanation: 'separate' };
    let result: InvestigationResponse;
    try {
      result = await v2Api.runInvestigation(body, controller.signal);
      if (controller.signal.aborted) return;
      setReport(result);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || controller.signal.aborted) return;
      setError(investigationError(err));
      return;
    } finally {
      if (abortRef.current === controller) setRunning(null);
    }
    if (result.ai_analysis.state !== 'deferred') return;
    setExplanation({ phase: 'pending' });
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
            ? 'The server could not be reached for the AI explanation. The report above is complete.'
            : 'The AI explanation request failed. The report above is complete.',
      });
    }
  };

  const newInvestigation = () => {
    abortRef.current?.abort();
    setReport(null);
    setExplanation(null);
    setError(null);
    setRunning(null);
    setForm(DEFAULT_FORM);
    setParams({}, { replace: true });
    window.scrollTo?.({ top: 0 });
  };

  if (report) {
    return (
      <div className="pb-10">
        <InvestigationReport report={report} onNew={newInvestigation} explanation={explanation} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pt-2 sm:pt-8 pb-10">
      <div>
        <p className="text-sm font-semibold text-[#B45309]">Live investigation</p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1A1714] leading-tight">
          Follow a victim’s money through the ledger.
        </h1>
        <p className="mt-3 text-base text-[#6B655B] leading-relaxed">
          Enter the account that lost money. When you start, the server queries the transaction ledger, flags transfers that
          are unusual for that account, traces where the funds went and where they came from, and assesses every linked
          account on its own records. Nothing is precomputed, and nothing is stored.
        </p>
      </div>

      <InvestigationForm values={form} onChange={setForm} onSubmit={start} running={Boolean(running)} />

      {fromLink && !running && !error && (
        <p role="status" className="text-sm text-[#6B655B]">
          Settings loaded from the link. Reports are not stored, so press <strong>Start Investigation</strong> to compute a fresh one.
        </p>
      )}

      {running && (
        <div role="status" aria-live="polite" className="rounded-3xl border border-[#EAE3D6] bg-white p-6 flex items-start gap-4" data-testid="investigation-running">
          <span className="mt-1 w-5 h-5 rounded-full border-2 border-[#EA8500] border-t-transparent animate-spin shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-[#1A1714]">
              Investigating <span className="font-mono">{running.account_id}</span>… {elapsed > 0 && <span className="text-[#8C857B] font-normal tabular-nums">{elapsed} s</span>}
            </p>
            <p className="mt-1 text-sm text-[#6B655B]">
              The server is querying the ledger and running the checks. The report appears when it has finished.
              {elapsed >= 10 && ' If the free server was asleep, the first request can take about a minute.'}
            </p>
          </div>
        </div>
      )}

      {error && !running && <ErrorState title={error.title} message={error.message} />}
    </div>
  );
};

export default InvestigatePage;
