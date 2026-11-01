import React from 'react';
import { Route } from 'lucide-react';
import { formatMoney, formatDuration } from '../../lib/format';
import { DynamicReport, RoleAssessmentV3 } from '../../types/dynamic';
import type { Target } from './TrailTree';
import { useCase } from './caseModel';
import { EvidenceList, RestrictionPanel, RoleBadge, ScoredTransfer } from './intel';
import { STRENGTH_LABEL } from './caseModel';
import { Disclosure, IdText, Ref, StageHeading } from './ui';

const GROUPS: { key: keyof DynamicReport['affected_accounts']; title: string; lead: string }[] = [
  { key: 'potential_victims', title: 'Potential victims', lead: 'Accounts whose own money left in transfers that differ from their history.' },
  { key: 'potential_secondary_victims', title: 'Potential secondary victims', lead: 'Passed money on, and their own savings left too: possibly exploited themselves.' },
  { key: 'potential_intermediaries', title: 'Potential intermediaries', lead: 'Received traced money and passed most of it on quickly. Knowing participation is not established.' },
  { key: 'suspicious_accounts', title: 'Potentially suspicious accounts', lead: 'Where money collected or was withdrawn, with several independent signals.' },
  { key: 'unknown_roles', title: 'Role unknown', lead: 'Not enough evidence, or mixed evidence, to describe a role.' },
  { key: 'ordinary_counterparties', title: 'No suspicious linkage observed', lead: 'Ordinary records and no flagged behaviour. This does not establish they are uninvolved.' },
  { key: 'cash_withdrawal_points', title: 'Cash withdrawal points', lead: 'ATM or cash networks recorded in the ledger. Cash cannot be followed further.' },
];

const Money: React.FC<{ v: number | null | undefined }> = ({ v }) => <>{v === null || v === undefined ? 'unknown' : formatMoney(v)}</>;

const AccountCard: React.FC<{ a: RoleAssessmentV3; onInspect: (t: Target) => void; inTrace: boolean }> = ({ a, onInspect, inTrace }) => {
  const g = a.graph_relationship;
  const m = a.account_model;
  return (
    <Disclosure
      id={`role-${a.account_id}`}
      summary={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <IdText className="text-ink">{a.account_id}</IdText>
          <RoleBadge role={a.role_candidate} label={a.role_label} />
          <span className="text-xs font-normal text-mute">{a.headline}</span>
        </span>
      }
    >
      <div className="space-y-5 pt-1" data-testid={`role-card-${a.account_id}`}>
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div>
            <h4 className="text-xs font-semibold text-ink">How it is connected</h4>
            <p className="mt-1 text-ink-soft">
              {g.position === 'downstream' && <>Received <Money v={g.received_traced_amount} /> {g.hop} hop(s) after the investigated account.</>}
              {g.position === 'upstream' && <>Paid <Money v={g.sent_traced_amount} /> into the traced flow {g.hop} hop(s) before it.</>}
              {g.position === 'other_sender' && <>Sent a flagged transfer to <IdText>{g.paid_suspicious_account}</IdText>, an account in the trace.</>}
              {g.position === 'investigated' && <>The investigated account.</>}
            </p>
            {g.introduced_by_transaction_id && (
              <p className="mt-1 text-xs text-mute">
                Introduced by <Ref id={g.introduced_by_transaction_id} />
              </p>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-ink">What happened after</h4>
            <p className="mt-1 text-ink-soft">
              {g.onward_destinations ? `Paid ${g.onward_destinations} account(s) onward` : 'No onward transfer in the trace'}
              {g.onward_delay_minutes !== null && `, first after ${formatDuration(g.onward_delay_minutes)}`}.
            </p>
            {g.forwarded_at_most !== null && g.received_traced_amount > 0 && (
              <p className="mt-1 text-xs text-mute">
                Balance-based range of traced money that moved on: <Money v={g.forwarded_at_least} /> to <Money v={g.forwarded_at_most} />
              </p>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-ink">Account behaviour model</h4>
            <p className="mt-1 text-ink-soft">
              {m.status === 'scored' || m.status === 'reference_only'
                ? `${m.status === 'reference_only' ? 'Reference only (not validated on this dataset): ' : ''}${m.above_threshold ? 'at or above' : 'below'} its review threshold (calibrated score ${((m.calibrated_probability ?? 0) * 100).toFixed(1)}%).`
                : m.status === 'insufficient_history'
                  ? 'Abstained: fewer than 5 transfers on record.'
                  : m.status === 'not_analyzed'
                    ? 'Not analysed in this run.'
                    : 'Unavailable.'}
            </p>
            {m.factors.length > 0 && <p className="mt-1 text-xs text-mute">Main factors: {m.factors.map((f) => f.label).join('; ')}.</p>}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-ink">Evidence for this role</h4>
            <p className="text-xs text-mute">{STRENGTH_LABEL[a.evidence_strength]}</p>
            <div className="mt-2">
              <EvidenceList items={a.evidence_items} empty="No supporting evidence found in the available data." />
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink">Against it, and what is unknown</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-soft list-disc pl-4">
              {a.contradictory_evidence.map((c) => <li key={c}>{c}</li>)}
              {a.uncertainty_reason && <li>{a.uncertainty_reason}</li>}
              {!a.contradictory_evidence.length && !a.uncertainty_reason && <li>Whether the holder authorised or knew about these transfers.</li>}
            </ul>
          </div>
        </div>

        {a.other_sender_transaction && <ScoredTransfer t={a.other_sender_transaction} />}

        <Disclosure summary="The ten questions for this account">
          <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 text-sm">
            {a.questions.map((x) => (
              <div key={x.q}>
                <dt className="font-semibold text-ink">{x.q}</dt>
                <dd className="text-ink-soft">{x.a}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>

        <RestrictionPanel r={a.restriction} compact />

        <div className="flex flex-wrap gap-2">
          <p className="text-sm text-ink-soft flex-1 min-w-[220px]">
            <span className="font-semibold text-ink">Next check:</span> {a.recommended_next_check}
          </p>
          {inTrace && (
            <button type="button" className="btn-secondary" onClick={() => onInspect({ kind: 'account', id: a.account_id })}>
              <Route className="w-4 h-4" aria-hidden="true" /> Show in fund trail
            </button>
          )}
        </div>
      </div>
    </Disclosure>
  );
};

/** Stage: every account the trace reached, grouped by its possible role, each with its own evidence. */
export const AffectedAccountsStage: React.FC<{ onInspect: (t: Target) => void }> = ({ onInspect }) => {
  const { intel, report } = useCase();
  if (!intel) return null;
  const byId = new Map(intel.role_assessments.map((a) => [a.account_id, a]));
  const inTrace = new Set(report.trace.nodes.map((n) => n.account_id));
  const total = intel.role_assessments.length - 1;
  return (
    <div className="space-y-6">
      <StageHeading
        title="Affected accounts"
        lead={`${total} connected account(s), each assessed on its own records. Roles are candidates for human review, assigned by documented rules; being paid from a suspicious flow is never enough on its own.`}
      />
      {intel.network_findings.length > 0 && (
        <section aria-label="Network findings" className="panel p-5">
          <h3 className="text-sm font-semibold text-ink">Network findings</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft list-disc pl-4">
            {intel.network_findings.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      )}
      {GROUPS.map((g) => {
        const ids = intel.affected_accounts[g.key] ?? [];
        if (!ids.length) return null;
        return (
          <section key={g.key} aria-labelledby={`grp-${g.key}`} className="space-y-3" data-testid={`group-${g.key}`}>
            <div>
              <h3 id={`grp-${g.key}`} className="font-display text-lg font-bold text-ink">
                {g.title} <span className="text-faint font-medium">({ids.length})</span>
              </h3>
              <p className="text-sm text-mute">{g.lead}</p>
            </div>
            <div className="space-y-2">
              {ids.map((id) => {
                const a = byId.get(id);
                return a ? <AccountCard key={id} a={a} onInspect={onInspect} inTrace={inTrace.has(id)} /> : null;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default AffectedAccountsStage;
