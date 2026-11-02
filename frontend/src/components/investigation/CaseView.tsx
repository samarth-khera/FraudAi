import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FlaskConical, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { Presence, springSnappy } from '../../lib/motion';
import { formatDateTime } from '../../lib/format';
import { ExplanationView, InvestigationRequest, InvestigationResponse } from '../../types/investigation';
import { DynamicReport } from '../../types/dynamic';
import { AIStage, AIStatusChip } from './AIStage';
import { AffectedAccountsStage } from './AffectedAccountsStage';
import { FundTrailStage } from './FundTrailStage';
import { Inspector } from './Inspector';
import { NextStepsStage } from './NextStepsStage';
import { OverviewStage } from './OverviewStage';
import { ReportStage } from './ReportStage';
import { RiskStage } from './RiskStage';
import { branchFor, buildTrail } from './trail';
import type { Target } from './TrailTree';
import { CaseContext, CaseNav } from './caseModel';

export type Stage = 'overview' | 'trail' | 'accounts' | 'risk' | 'ai' | 'next' | 'report';

export const STAGES: { id: Stage; label: string; question: string }[] = [
  { id: 'overview', label: 'Overview', question: 'What happened, and where the trace starts' },
  { id: 'trail', label: 'Fund trail', question: 'Where the money went, transfer by transfer' },
  { id: 'accounts', label: 'Affected accounts', question: 'Who else is involved, and in what possible role' },
  { id: 'risk', label: 'Risk evidence', question: 'What the rules and the model found, and why' },
  { id: 'ai', label: 'AI analyst', question: 'A plain-language reading, kept separate' },
  { id: 'next', label: 'Next steps', question: 'What to examine next' },
  { id: 'report', label: 'Investigator report', question: 'The complete report: evidence, fund flow and per-account recommendations' },
];

export const CaseView: React.FC<{
  report: InvestigationResponse;
  intel?: DynamicReport | null;
  explanation: ExplanationView | null;
  onNew: () => void;
  onRerun: (r: InvestigationRequest) => void;
  /** Present only when the server can produce an explanation; nothing is requested until the investigator asks. */
  onRequestExplanation?: () => void;
}> = ({ report, intel = null, explanation, onNew, onRerun, onRequestExplanation }) => {
  // Branch endings come from the dynamic investigation of the same account when it is present (matched by transfers).
  const serverBranches = intel && intel.account_summary?.account_id === report.victim.account_id ? intel.fund_trace?.branches : null;
  const trail = useMemo(() => buildTrail(report, serverBranches), [report, serverBranches]);
  // The affected-accounts stage needs the model-driven sections, and the investigator report needs a server that
  // builds it; a trace-only report has five stages.
  const stages = useMemo(
    () => STAGES.filter((s) => (s.id !== 'accounts' || intel) && (s.id !== 'report' || intel?.investigator_report)),
    [intel],
  );
  const [stage, setStage] = useState<Stage>('overview');
  const [branchId, setBranchId] = useState<string | null>(trail.branches[0]?.id ?? null);
  const [target, setTarget] = useState<Target | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Open the tree framed on the first branch: the whole two-sided trail rarely fits at a readable size.
  const [focus, setFocus] = useState<{ keys: string[] | null; token: number }>(() => ({
    keys: trail.branches[0] ? ['root', ...trail.branches[0].transfers.map((t) => t.transaction_id)] : null,
    token: 0,
  }));
  const [findingToShow, setFindingToShow] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const branch = trail.branches.find((b) => b.id === branchId) ?? null;

  const focusOn = useCallback(
    (branchToShow = branch) => {
      if (!branchToShow) return;
      const keys = branchToShow.transfers.map((t) => t.transaction_id);
      // Expand anything folded along the branch so the whole path is visible.
      setCollapsed((c) => new Set([...c].filter((k) => !keys.includes(k))));
      setFocus((f) => ({ keys: ['root', ...keys], token: f.token + 1 }));
    },
    [branch],
  );

  const select = useCallback(
    (t: Target) => {
      setTarget(t);
      setInspecting(true);
      const b = branchFor(trail, t, branchId);
      if (b) setBranchId(b.id);
    },
    [trail, branchId],
  );

  const showInTrail = useCallback(
    (t: Target) => {
      select(t);
      setStage('trail');
      const b = branchFor(trail, t, branchId);
      if (b) focusOn(b);
    },
    [select, trail, branchId, focusOn],
  );

  const nav: CaseNav = useMemo(
    () => ({
      report,
      intel,
      trail,
      openTransfer: (id) => select({ kind: 'transfer', id }),
      openAccount: (id) => select({ kind: 'account', id }),
      openFinding: (id) => {
        setInspecting(false);
        setStage('risk');
        setFindingToShow(id);
      },
    }),
    [report, intel, trail, select],
  );

  // A finding lives inside a closed disclosure on the evidence stage: open it, then bring it into view.
  useEffect(() => {
    if (!findingToShow || stage !== 'risk') return;
    const el = document.getElementById(`finding-${findingToShow}`);
    const details = el?.closest('details');
    if (details) details.open = true;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setFindingToShow(null);
  }, [findingToShow, stage]);

  const go = (s: Stage) => {
    setStage(s);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = stages.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setStage(stages[to].id);
    tabs.current[to]?.focus();
  };

  const idx = stages.findIndex((s) => s.id === stage);
  const nextStage = stages[idx + 1];
  const synthetic = report.data_source.is_synthetic;

  return (
    <CaseContext.Provider value={nav}>
      <div className="space-y-6" data-testid="investigation-report">
        <header data-reveal data-print-hide className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] text-mute">
                Investigation {intel?.investigation_id ?? report.investigation_id}
                {intel && <span className="ml-1.5 text-faint">in the {intel.dataset.title.toLowerCase()}</span>}
              </p>
              <h1 className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="page-title !text-[30px] sm:!text-[36px] font-mono !tracking-[-0.02em]">{report.victim.account_id}</span>
                <span className="font-display text-xl sm:text-2xl font-medium text-faint">{report.victim.customer_name}</span>
              </h1>
              <p className="mt-1.5 text-sm text-mute">
                Computed {formatDateTime(report.completed_at)} in {(report.duration_ms / 1000).toFixed(1)} s from fresh ledger queries. Not stored.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <AIStatusChip ai={report.ai_analysis} explanation={explanation} onOpen={() => go('ai')} />
              <button type="button" onClick={onNew} className="btn-secondary">
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                New investigation
              </button>
            </div>
          </div>
          {synthetic && (
            <div role="note" className="flex items-start gap-2.5 rounded-xl bg-warn-soft/80 ring-1 ring-warn-line px-4 py-2.5 text-[13px] text-warn">
              <FlaskConical className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />
              <span>
                <strong>Synthetic {intel && intel.dataset.dataset_id !== 'demo-ledger' ? 'data' : 'demo data'}.</strong>{' '}
                {report.data_source.disclosure.replace(/^Synthetic[^.]*\.\s*/, '')}
              </span>
            </div>
          )}
        </header>

        <div
          data-reveal
          role="tablist"
          data-print-hide
          aria-label="Investigation stages"
          className="sticky top-16 lg:top-[3.75rem] z-30 flex gap-1 overflow-x-auto no-scrollbar rounded-2xl bg-[rgba(255,255,255,0.78)] backdrop-blur-xl ring-1 ring-line p-1.5 shadow-[var(--shadow-xs)]"
        >
          {stages.map((s, i) => {
            const on = s.id === stage;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                id={`tab-${s.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`stage-${s.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setStage(s.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                title={s.question}
                className={`relative isolate flex-1 min-w-max rounded-xl px-3.5 py-2 text-left transition-colors duration-150 ${on ? '' : 'hover:bg-white/80'}`}
              >
                {on && (
                  <motion.span
                    layoutId="stage-tab"
                    transition={springSnappy}
                    className="absolute inset-0 -z-10 rounded-xl bg-white shadow-[var(--shadow-float)] ring-1 ring-line"
                    aria-hidden="true"
                  />
                )}
                <span className={`flex items-center gap-2 text-sm font-semibold ${on ? 'text-ink' : 'text-mute'}`}>
                  <span
                    className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${on ? 'bg-gradient-to-br from-iris to-ice text-white' : 'bg-well text-faint ring-1 ring-line'}`}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap">{s.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`stage-${stage}`} aria-labelledby={`tab-${stage}`} key={stage} data-reveal className="scroll-mt-32">
          {stage === 'overview' && <OverviewStage onFollow={() => go('trail')} />}
          {stage === 'trail' && (
            <FundTrailStage
              branch={branch}
              onPickBranch={(id) => {
                setBranchId(id);
                setTarget(null);
                focusOn(trail.branches.find((b) => b.id === id));
              }}
              target={target}
              onSelect={select}
              collapsed={collapsed}
              onToggle={(k) =>
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
              onFocusBranch={() => focusOn()}
              focusKeys={focus.keys}
              focusToken={focus.token}
            />
          )}
          {stage === 'accounts' && <AffectedAccountsStage onInspect={showInTrail} />}
          {stage === 'risk' && <RiskStage onInspect={showInTrail} />}
          {stage === 'ai' && <AIStage ai={report.ai_analysis} explanation={explanation} onRequest={onRequestExplanation} />}
          {stage === 'next' && <NextStepsStage onInspect={showInTrail} onRerun={onRerun} />}
          {stage === 'report' && <ReportStage />}
        </div>

        {nextStage && (
          <div className="flex justify-end border-t border-line pt-5" data-print-hide>
            <button type="button" className="btn-secondary" onClick={() => go(nextStage.id)}>
              Continue: {nextStage.label}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <Presence>
        {inspecting && target && (
          <Inspector
            key="inspector"
            target={target}
            branch={branch}
            onClose={() => setInspecting(false)}
            onNavigate={select}
            onFocusBranch={() => {
              setStage('trail');
              focusOn();
            }}
          />
        )}
      </Presence>
    </CaseContext.Provider>
  );
};

export default CaseView;
