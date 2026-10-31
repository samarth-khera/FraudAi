import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FlaskConical, RotateCcw } from 'lucide-react';
import { formatDateTime } from '../../lib/format';
import { ExplanationView, InvestigationRequest, InvestigationResponse } from '../../types/investigation';
import { AIStage, AIStatusChip } from './AIStage';
import { FundTrailStage } from './FundTrailStage';
import { Inspector } from './Inspector';
import { NextStepsStage } from './NextStepsStage';
import { OverviewStage } from './OverviewStage';
import { RiskStage } from './RiskStage';
import { branchFor, buildTrail } from './trail';
import type { Target } from './TrailTree';
import { CaseContext, CaseNav } from './caseModel';

export type Stage = 'overview' | 'trail' | 'risk' | 'ai' | 'next';

export const STAGES: { id: Stage; label: string; question: string }[] = [
  { id: 'overview', label: 'Overview', question: 'What happened, and where the trace starts' },
  { id: 'trail', label: 'Fund trail', question: 'Where the money went, transfer by transfer' },
  { id: 'risk', label: 'Risk evidence', question: 'What the rules and the model found, and why' },
  { id: 'ai', label: 'AI analyst', question: 'A plain-language reading, kept separate' },
  { id: 'next', label: 'Next steps', question: 'What to examine next' },
];

export const CaseView: React.FC<{
  report: InvestigationResponse;
  explanation: ExplanationView | null;
  onNew: () => void;
  onRerun: (r: InvestigationRequest) => void;
}> = ({ report, explanation, onNew, onRerun }) => {
  const trail = useMemo(() => buildTrail(report), [report]);
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
      trail,
      openTransfer: (id) => select({ kind: 'transfer', id }),
      openAccount: (id) => select({ kind: 'account', id }),
      openFinding: (id) => {
        setInspecting(false);
        setStage('risk');
        setFindingToShow(id);
      },
    }),
    [report, trail, select],
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
    const n = STAGES.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setStage(STAGES[to].id);
    tabs.current[to]?.focus();
  };

  const idx = STAGES.findIndex((s) => s.id === stage);
  const nextStage = STAGES[idx + 1];
  const synthetic = report.data_source.is_synthetic;

  return (
    <CaseContext.Provider value={nav}>
      <div className="space-y-6" data-testid="investigation-report">
        {synthetic && (
          <div role="note" className="sticky top-16 lg:top-4 z-30 rounded-xl bg-[rgba(254,249,231,0.94)] backdrop-blur ring-1 ring-[#F5E3A8] px-4 py-2 text-[13px] text-[#7A4B05] flex items-center gap-2 shadow-sm">
            <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Synthetic demo data.</strong> {report.data_source.disclosure.replace(/^Synthetic demo data\.\s*/, '')}
            </span>
          </div>
        )}

        <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-mute">Investigation {report.investigation_id}</p>
            <h1 className="mt-1 font-display text-3xl sm:text-4xl font-bold text-ink tracking-tight">
              <span>{report.victim.account_id}</span>
              <span className="ml-3 text-xl sm:text-2xl font-medium text-faint">{report.victim.customer_name}</span>
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
        </header>

        <div role="tablist" aria-label="Investigation stages" className="flex gap-1 overflow-x-auto no-scrollbar rounded-2xl bg-white/70 ring-1 ring-line p-1.5">
          {STAGES.map((s, i) => {
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
                className={`flex-1 min-w-[132px] rounded-xl px-3.5 py-2.5 text-left transition-all ${on ? 'bg-white shadow-[var(--shadow-float)] ring-1 ring-line' : 'hover:bg-white/80'}`}
              >
                <span className={`flex items-center gap-2 text-sm font-semibold ${on ? 'text-ink' : 'text-mute'}`}>
                  <span
                    className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${on ? 'bg-gradient-to-br from-iris to-ice text-white' : 'bg-well text-faint ring-1 ring-line'}`}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  {s.label}
                </span>
                <span className="mt-0.5 hidden xl:block text-[11px] text-faint truncate">{s.question}</span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`stage-${stage}`} aria-labelledby={`tab-${stage}`} key={stage} className="rise-in">
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
          {stage === 'risk' && <RiskStage onInspect={showInTrail} />}
          {stage === 'ai' && <AIStage ai={report.ai_analysis} explanation={explanation} />}
          {stage === 'next' && <NextStepsStage onInspect={showInTrail} onRerun={onRerun} />}
        </div>

        {nextStage && (
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={() => go(nextStage.id)}>
              Continue: {nextStage.label}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {inspecting && target && (
        <Inspector
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
    </CaseContext.Provider>
  );
};

export default CaseView;
