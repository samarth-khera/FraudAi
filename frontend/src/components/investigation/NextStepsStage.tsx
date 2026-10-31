import React, { useState } from 'react';
import { Crosshair, FileText, HelpCircle, Layers, ShieldCheck } from 'lucide-react';
import { AccountFinding, InvestigationRequest, Recommendation } from '../../types/investigation';
import { ACTION_LABEL } from './labels';
import type { Target } from './TrailTree';
import { Tone, useCase } from './caseModel';
import { Badge, IdText, Refs, StageHeading } from './ui';

const ACTION_TONE: Record<Recommendation['action'], Tone> = {
  consider_escalation: 'high',
  further_review: 'elevated',
  enhanced_monitoring: 'elevated',
  obtain_records: 'neutral',
  contact_account_holder: 'ice',
};

// The reason is the account's own evidence basis; the recommendation's uncertainty is a caveat, shown separately.
const Why: React.FC<{ r: Recommendation; accounts: AccountFinding[] }> = ({ r, accounts }) => {
    const basis = (accounts.find((a) => a.account_id === r.account_id)?.role_basis ?? []).slice(0, 1);
    return (
    <>
      {basis.length > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          <span className="font-semibold text-ink">Why: </span>
          {basis.join(' ')}
        </p>
      )}
      <p className="mt-1.5 text-sm text-mute">
        <span className="font-semibold text-ink-soft">Keep in mind: </span>
        {r.uncertainty}
      </p>
      {r.evidence.transaction_ids.length + r.evidence.account_ids.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-mute">
          Based on <Refs ids={[...r.evidence.transaction_ids, ...r.evidence.account_ids]} />
        </p>
      )}
    </>
    );
};

export const NextStepsStage: React.FC<{ onInspect: (t: Target) => void; onRerun: (r: InvestigationRequest) => void }> = ({ onInspect, onRerun }) => {
  const { report } = useCase();
  const [first, ...rest] = report.recommendations;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rest : rest.slice(0, 3);
  const depth = report.request.max_depth;
  const depthNote = report.trace.truncation_notes.find((n) => n.startsWith('The depth limit'));
  const canGoDeeper = Boolean(depthNote) && depth < 6;


  return (
    <div className="space-y-8">
      <StageHeading title="What to do next" lead="Investigation steps suggested by the evidence, most direct first. Each says why it is suggested and what it rests on." />

      <div className="rounded-2xl bg-ice-soft ring-1 ring-[#C9DBFF] px-4 py-3 text-sm text-[#1E3A8A] flex gap-2.5">
        <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
        <p>Advisory only. Nothing has been frozen, blocked or flagged. Any restriction needs an authorised institution process with documented grounds.</p>
      </div>

      {first && (
        <section aria-label="Start here" className="panel p-6 sm:p-7 relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-iris to-ice" aria-hidden="true" />
          <p className="text-sm font-semibold text-iris-deep">Start here</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={ACTION_TONE[first.action]}>{ACTION_LABEL[first.action]}</Badge>
            {first.account_id && <IdText className="text-sm font-semibold text-ink">{first.account_id}</IdText>}
          </div>
          <p className="mt-3 font-display text-xl font-semibold text-ink leading-snug max-w-3xl">{first.statement}</p>
          <Why r={first} accounts={report.accounts} />
          {first.account_id && (
            <button type="button" className="btn-primary mt-5" onClick={() => onInspect({ kind: 'account', id: first.account_id! })}>
              <Crosshair className="w-4 h-4" aria-hidden="true" /> Inspect {first.account_id}
            </button>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section aria-labelledby="then-h">
          <h3 id="then-h" className="text-sm font-semibold text-ink">Then</h3>
          <ol className="mt-3 space-y-3">
            {shown.map((r) => (
              <li key={r.recommendation_id} className="panel-quiet bg-white px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                      {r.account_id && <IdText className="text-sm font-semibold text-ink">{r.account_id}</IdText>}
                    </div>
                    <p className="mt-2 text-[15px] text-ink">{r.statement}</p>
                    <Why r={r} accounts={report.accounts} />
                  </div>
                  {r.account_id && (
                    <button type="button" className="btn-ghost shrink-0" onClick={() => onInspect({ kind: 'account', id: r.account_id! })}>
                      <Crosshair className="w-4 h-4" aria-hidden="true" /> Inspect
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {rest.length > shown.length && (
            <button type="button" className="btn-ghost mt-3" onClick={() => setShowAll(true)}>
              Show {rest.length - shown.length} more step{rest.length - shown.length === 1 ? '' : 's'}
            </button>
          )}
        </section>
      )}

      {canGoDeeper && (
        <section className="panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex gap-3">
            <Layers className="w-5 h-5 text-iris shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink">Follow the money one hop further</p>
              <p className="mt-1 text-sm text-mute max-w-2xl">{depthNote} A new run with a depth of {depth + 1} would follow them, within the same limits.</p>
            </div>
          </div>
          <button type="button" className="btn-secondary shrink-0" onClick={() => onRerun({ ...report.request, max_depth: depth + 1 })}>
            Re-run with depth {depth + 1}
          </button>
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileText className="w-4 h-4 text-faint" aria-hidden="true" /> Records to request
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            {report.records_to_request.map((u) => (
              <li key={u} className="flex gap-2">
                <span className="mt-2 w-1 h-1 rounded-full bg-faint shrink-0" aria-hidden="true" />
                {u}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <HelpCircle className="w-4 h-4 text-faint" aria-hidden="true" /> What is still unknown
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            {report.unknowns.map((u) => (
              <li key={u} className="flex gap-2">
                <span className="mt-2 w-1 h-1 rounded-full bg-faint shrink-0" aria-hidden="true" />
                {u}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="text-xs text-faint max-w-3xl">{report.disclaimer}</p>
    </div>
  );
};

export default NextStepsStage;
