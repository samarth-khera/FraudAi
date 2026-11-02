import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { springSnappy } from '../lib/motion';
import { api } from '../services/api';
import { CASE_STATUS_LABELS, formatMoney } from '../lib/format';
import { describeError, isNotFound } from '../lib/errors';
import { ErrorState, LoadingState, Pill, SkeletonBlock, caseStatusTone } from '../components/ui/StateViews';
import { CaseSection, CaseWorkspaceData, SECTIONS, parseSection, usesAccountLedger } from '../components/case/caseModel';
import { CaseSummarySection } from '../components/case/CaseSummarySection';
import { MoneyFlowSection } from '../components/case/MoneyFlowSection';
import { AccountsRiskSection } from '../components/case/AccountsRiskSection';
import { ReviewHistorySection } from '../components/case/ReviewHistorySection';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: CaseWorkspaceData };

export const CaseWorkspacePage: React.FC = () => {
  const { caseId = '' } = useParams<{ caseId: string }>();
  const [params, setParams] = useSearchParams();
  const section = parseSection(params.get('section'));
  const selectedAccountId = params.get('account');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const reduceMotion = useReducedMotion();
  const topRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setState({ kind: 'loading' });
      try {
        const caseData = await api.getCase(caseId);
        const [trace, graph, assessments] = await Promise.allSettled([
          api.getCaseTrace(caseId),
          api.getCaseGraph(caseId),
          api.getCaseAccountAssessments(caseId),
        ]);
        const failed = (r: PromiseSettledResult<unknown>, what: string) =>
          r.status === 'rejected' ? describeError(r.reason, `The ${what} could not be loaded.`) : null;
        setState({
          kind: 'ready',
          data: {
            caseData,
            trace: trace.status === 'fulfilled' ? trace.value : null,
            graph: graph.status === 'fulfilled' ? graph.value : null,
            assessments: assessments.status === 'fulfilled' ? assessments.value : null,
            traceError: failed(trace, 'money flow') ?? failed(graph, 'money flow diagram'),
            assessmentsError: failed(assessments, 'account assessments'),
          },
        });
      } catch (err) {
        // A malformed ID is rejected by validation before lookup; to the user it is the same as "no such case".
        if (isNotFound(err) || (err as { code?: string })?.code === 'validation_error') setState({ kind: 'not_found' });
        else setState({ kind: 'error', message: describeError(err, 'This case could not be loaded.') });
      }
    },
    [caseId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const navigate = useCallback(
    (next: CaseSection, accountId?: string | null) => {
      const p = new URLSearchParams(params);
      p.set('section', next);
      if (accountId !== undefined) {
        if (accountId) p.set('account', accountId);
        else p.delete('account');
      }
      setParams(p);
      if (next !== section) topRef.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    },
    [params, setParams, section, reduceMotion]
  );

  const selectAccount = useCallback(
    (accountId: string | null) => {
      const p = new URLSearchParams(params);
      if (accountId) p.set('account', accountId);
      else p.delete('account');
      setParams(p, { replace: true });
    },
    [params, setParams]
  );

  if (state.kind === 'loading') {
    return (
      <div key="loading" className="space-y-6">
        <LoadingState label={`Loading case ${caseId}…`} className="!py-4 !justify-start" />
        <SkeletonBlock className="h-10 w-56" />
        <SkeletonBlock className="h-12 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonBlock className="h-40" />
          <SkeletonBlock className="h-40" />
          <SkeletonBlock className="h-40" />
        </div>
      </div>
    );
  }
  if (state.kind === 'not_found') {
    return (
      <div className="max-w-xl space-y-4">
        <ErrorState
          title={`Case ${caseId} was not found`}
          message="No case with this ID is stored on the server. Check the ID, or choose a case from the list."
        />
        <Link to="/cases" className="btn-secondary">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          All investigations
        </Link>
      </div>
    );
  }
  if (state.kind === 'error') {
    return <ErrorState title="This case could not be loaded" message={state.message} onRetry={() => load()} />;
  }

  const { data } = state;
  const c = data.caseData;
  const index = SECTIONS.findIndex((s) => s.id === section);
  const prev = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];

  return (
    <div key="ready" ref={topRef} className="space-y-6 scroll-mt-24">
      <header data-reveal className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-mute">Synthetic demonstration case</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title font-mono !text-[30px] sm:!text-[34px] !tracking-[-0.02em]">{c.case_id}</h1>
            <Pill tone={caseStatusTone(c.investigation_status)}>{CASE_STATUS_LABELS[c.investigation_status] ?? c.investigation_status}</Pill>
            <Pill title={c.dataset_note}>{usesAccountLedger(c) ? 'Synthetic account ledger' : 'Case records only'}</Pill>
          </div>
        </div>
        <dl className="flex gap-6 shrink-0 rounded-2xl bg-white/80 ring-1 ring-line px-5 py-3 shadow-[var(--shadow-xs)]">
          <div>
            <dt className="text-xs text-mute">Reported loss</dt>
            <dd className="font-display text-xl font-bold text-ink">{formatMoney(c.reported_amount, c.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Review decisions</dt>
            <dd className="font-display text-xl font-bold text-ink">{c.review_progress?.decisions_recorded ?? 0}</dd>
          </div>
        </dl>
      </header>

      <nav
        data-reveal
        aria-label="Investigation sections"
        className="sticky top-16 lg:top-[3.75rem] z-30 -mx-4 sm:mx-0 px-4 sm:px-1.5 py-1.5 bg-canvas/90 backdrop-blur-xl sm:rounded-2xl sm:ring-1 sm:ring-line sm:bg-[rgba(255,255,255,0.78)] sm:shadow-[var(--shadow-xs)]"
      >
        <ol className="flex gap-1 overflow-x-auto no-scrollbar">
          {SECTIONS.map((s, i) => {
            const active = s.id === section;
            return (
              <li key={s.id} className="shrink-0 sm:flex-1">
                <button
                  type="button"
                  onClick={() => navigate(s.id)}
                  aria-current={active ? 'step' : undefined}
                  title={s.question}
                  className={`relative isolate w-full rounded-xl px-3.5 py-2 text-left transition-colors duration-150 cursor-pointer ${
                    active ? 'text-ink' : 'text-mute hover:text-ink hover:bg-white/80'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={reduceMotion ? undefined : 'case-section'}
                      className="absolute inset-0 -z-10 rounded-xl bg-white ring-1 ring-line shadow-[var(--shadow-float)]"
                      transition={springSnappy}
                    />
                  )}
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${
                        active ? 'bg-gradient-to-br from-iris to-ice text-white' : 'bg-well text-faint ring-1 ring-line'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm font-semibold whitespace-nowrap">{s.title}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div key={section} data-reveal className="min-h-[50vh]">
        {section === 'summary' && <CaseSummarySection data={data} onNavigate={navigate} />}
        {section === 'money-flow' && (
          <MoneyFlowSection data={data} selectedAccountId={selectedAccountId} onSelectAccount={selectAccount} onNavigate={navigate} />
        )}
        {section === 'accounts' && (
          <AccountsRiskSection data={data} selectedAccountId={selectedAccountId} onSelectAccount={selectAccount} onNavigate={navigate} />
        )}
        {section === 'review' && (
          <ReviewHistorySection
            data={data}
            selectedAccountId={selectedAccountId}
            onSelectAccount={selectAccount}
            onRecorded={() => load({ quiet: true })}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        {prev ? (
          <button type="button" className="btn-ghost" onClick={() => navigate(prev.id)}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {prev.title}
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button type="button" className="btn-primary" onClick={() => navigate(next.id)}>
            Next: {next.title}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

export default CaseWorkspacePage;
