import React from 'react';
import { AlertTriangle, ChevronDown, Crosshair } from 'lucide-react';
import { formatMoney } from '../../lib/format';
import { AccountFinding, AnalystSection, FindingKind } from '../../types/investigation';
import { KIND, ROLE_ASSESSMENT, splitCoded } from './labels';
import type { Target } from './TrailTree';
import { ROLE_TONE, SEVERITY_LABEL, SEVERITY_ORDER, Severity, Tone, severityOf, useCase } from './caseModel';
import { Badge, Disclosure, IdText, Refs, SeverityMeter, StageHeading } from './ui';

const KIND_TONE: Record<string, Tone> = { observed: 'fact', rule: 'iris', model: 'ice', limitation: 'neutral', interpretation: 'elevated' };

const KIND_GROUPS: { kind: FindingKind; title: string; lead: string }[] = [
  { kind: 'observed', title: 'Recorded facts', lead: 'What the ledger records, with no judgement applied.' },
  { kind: 'rule', title: 'Rule results', lead: 'Fixed, explainable rules applied to each account’s own records.' },
  { kind: 'model', title: 'Model results', lead: 'The machine-learning account model. Its scores are prompts for review.' },
  { kind: 'limitation', title: 'Limits and unknowns', lead: 'What this data cannot show, and the limits of this run.' },
];

const Part: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="min-w-0">
    <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
      <span className="w-5 h-5 rounded-full bg-iris-soft text-iris-deep text-[11px] font-bold flex items-center justify-center" aria-hidden="true">
        {n}
      </span>
      {title}
    </p>
    <div className="mt-1.5 pl-7 text-sm text-ink-soft space-y-1.5">{children}</div>
  </div>
);

export const RiskStage: React.FC<{ onInspect: (t: Target) => void }> = ({ onInspect }) => {
  const { report } = useCase();
  const groups: { key: Severity | 'none'; label: string; items: AccountFinding[] }[] = [
    ...SEVERITY_ORDER.map((s) => ({ key: s, label: SEVERITY_LABEL[s], items: report.accounts.filter((a) => severityOf(a) === s) })),
    { key: 'none' as const, label: 'Not assessed', items: report.accounts.filter((a) => !severityOf(a)) },
  ].filter((g) => g.items.length);

  return (
    <div className="space-y-8">
      <StageHeading
        title="Risk evidence"
        lead="Accounts in the trace, grouped by the rules’ severity for each one. Open an account to see what was detected, the records behind it, why it matters and what is still unknown. A severity is a prompt for review, not proof of fraud."
      />

      <div className="flex flex-wrap gap-2 text-xs" aria-label="How to read the evidence">
        <Badge tone="fact">Observed fact: recorded in the ledger</Badge>
        <Badge tone="iris">Rule signal: a fixed calculation</Badge>
        <Badge tone="ice">Model output: a statistical score</Badge>
        <Badge tone="neutral">AI explanation: separate tab, never used here</Badge>
      </div>

      {!report.model_available && (
        <div role="alert" className="rounded-2xl bg-sev-critical-soft ring-1 ring-[#FBCFD8] px-4 py-3 text-sm text-[#881337] flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-sev-critical" aria-hidden="true" />
          <p>
            <strong>The account model did not run.</strong> {report.model_unavailable_reason} Rule results and the money trace are still computed from the
            ledger; no model scores are shown.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key} aria-label={`${g.label} severity`}>
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-ink">
              {g.key !== 'none' ? <SeverityMeter level={g.key} showLabel={false} /> : null}
              {g.label} <span className="font-normal text-faint">{g.items.length} account{g.items.length === 1 ? '' : 's'}</span>
            </h3>
            <ul className="mt-2.5 space-y-2.5">
              {g.items.map((a) => (
                <li key={a.account_id}>
                  <AccountEvidence a={a} onInspect={onInspect} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="findings-h" className="space-y-3">
        <div>
          <h3 id="findings-h" className="font-display text-xl font-bold text-ink">All findings</h3>
          <p className="mt-1 text-sm text-mute">Every statement in the report, labelled by where it comes from, with the records it cites.</p>
        </div>
        {KIND_GROUPS.map((k) => {
          const list = report.findings.filter((f) => f.kind === k.kind);
          if (!list.length) return null;
          return (
            <Disclosure
              key={k.kind}
              summary={
                <span className="flex items-center gap-2">
                  <Badge tone={KIND_TONE[k.kind]}>{KIND[k.kind].label}</Badge> {k.title} <span className="font-normal text-faint">{list.length}</span>
                </span>
              }
            >
              <p className="text-xs text-mute">{k.lead}</p>
              <ol className="mt-3 space-y-2.5">
                {list.map((f) => (
                  <li key={f.finding_id} id={`finding-${f.finding_id}`} className="scroll-mt-28 rounded-xl ring-1 ring-line px-3.5 py-3">
                    <p className="text-sm text-ink leading-relaxed">
                      <IdText className="text-faint mr-2">{f.finding_id}</IdText>
                      {f.statement}
                    </p>
                    {f.evidence.transaction_ids.length + f.evidence.account_ids.length > 0 && (
                      <p className="mt-2 text-xs text-mute flex flex-wrap items-center gap-1.5">
                        Evidence <Refs ids={[...f.evidence.transaction_ids, ...f.evidence.account_ids]} />
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Disclosure>
          );
        })}
      </section>

      <Disclosure summary="The nine investigator questions, answered from the records">
        <p className="text-xs text-mute">Written by fixed templates from the findings above, not by an AI model.</p>
        <QA sections={report.evidence_summary} />
      </Disclosure>
    </div>
  );
};

const AccountEvidence: React.FC<{ a: AccountFinding; onInspect: (t: Target) => void }> = ({ a, onInspect }) => {
  const { report } = useCase();
  const role = ROLE_ASSESSMENT[a.role_assessment];
  const rule = a.rule_assessment;
  const signals = (rule?.reason_codes ?? []).map(splitCoded).filter((s) => s.code !== 'NORMAL_ACTIVITY');
  const related = report.findings.filter((f) => f.subject_account_id === a.account_id && f.kind !== 'limitation');
  const recommendation = rule ? splitCoded(rule.recommendation) : null;
  const threshold = report.model_review_threshold;

  return (
    <details className="group panel overflow-hidden" data-testid={`evidence-${a.account_id}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 hover:bg-well/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <IdText className="text-[15px] font-semibold text-ink">{a.account_id}</IdText>
            <Badge tone={ROLE_TONE[a.role_assessment]}>{role.label}</Badge>
          </span>
          <span className="mt-1 block text-xs text-mute truncate">
            {signals.length ? signals.map((s) => s.label).join(', ') : a.analyzed ? 'No rule signal' : a.not_analyzed_reason}
          </span>
        </span>
        <span className="hidden sm:block text-right shrink-0">
          <span className="block text-xs text-faint">Traced in</span>
          <span className="text-sm font-semibold">{a.traced_in_amount ? formatMoney(a.traced_in_amount) : 'None'}</span>
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-line px-4 py-4 grid gap-5 md:grid-cols-2">
        <Part n={1} title="What was detected">
          {signals.length ? (
            <ul className="space-y-1.5">
              {signals.map((s) => (
                <li key={s.label}>
                  <Badge tone="iris">{s.label}</Badge>
                  {s.detail && <span className="block mt-0.5">{s.detail}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No rule signal fired for this account.</p>
          )}
          {a.model_assessment && (
            <p>
              <Badge tone="ice">Model {a.model_assessment.risk_score.toFixed(1)}%</Badge>{' '}
              {threshold !== null && (a.model_suggests_review ? `at or above the ${(threshold * 100).toFixed(1)}% review threshold` : `below the ${(threshold * 100).toFixed(1)}% review threshold`)}
            </p>
          )}
          {a.disagreement_note && <p className="text-sev-elevated">{a.disagreement_note}</p>}
        </Part>
        <Part n={2} title="What it relates to">
          <p>
            <IdText className="text-ink">{a.account_id}</IdText>, {a.customer_type}, {a.kyc_tier.replace(/_/g, ' ')}
            {a.hop_distance ? `, ${a.hop_distance} hop${a.hop_distance === 1 ? '' : 's'} from the investigated account` : ''}.
          </p>
          {a.evidence_transaction_ids.length > 0 && <Refs ids={a.evidence_transaction_ids} />}
        </Part>
        <Part n={3} title="Evidence">
          <ul className="space-y-1">
            {a.role_basis.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {related.map((f) => (
            <p key={f.finding_id} className="text-xs">
              <Badge tone={KIND_TONE[f.kind]}>{KIND[f.kind].label}</Badge> {f.statement}
            </p>
          ))}
        </Part>
        <Part n={4} title="Why it matters">
          <p>{role.help}</p>
          {recommendation && (
            <p>
              The rules suggest <strong className="text-ink">{recommendation.label.toLowerCase()}</strong>
              {recommendation.detail ? `: ${recommendation.detail}` : '.'}
            </p>
          )}
        </Part>
        <div className="md:col-span-2">
          <Part n={5} title="What is not known">
            <ul className="space-y-1">
              {a.missing_evidence.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {a.alternative_explanations.length > 0 && (
              <p className="text-mute">
                <span className="font-semibold text-ink-soft">Could instead be: </span>
                {a.alternative_explanations.join(' ')}
              </p>
            )}
          </Part>
        </div>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => onInspect({ kind: 'account', id: a.account_id })}>
            <Crosshair className="w-4 h-4" aria-hidden="true" /> Show in the fund trail
          </button>
        </div>
      </div>
    </details>
  );
};

export const QA: React.FC<{ sections: AnalystSection[] }> = ({ sections }) => (
  <ol className="mt-3 space-y-4">
    {sections.map((s) => (
      <li key={s.question}>
        <p className="text-sm font-semibold text-ink">{s.question}</p>
        <ul className="mt-1.5 space-y-1.5">
          {s.claims.map((c, i) => (
            <li key={i} className="text-sm text-ink-soft flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Badge tone={KIND_TONE[c.kind] ?? 'neutral'} title={KIND[c.kind].help}>
                {KIND[c.kind].label}
              </Badge>
              <span className="min-w-0">{c.text}</span>
              <Refs ids={c.refs} />
            </li>
          ))}
        </ul>
      </li>
    ))}
  </ol>
);

export default RiskStage;
