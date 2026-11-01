/** Display pieces for the model-driven sections of a dynamic investigation (types/dynamic.ts). */
import React from 'react';
import { Cpu, ShieldAlert, ShieldCheck, ShieldQuestion, UserCheck } from 'lucide-react';
import { formatDateTime, formatMoney } from '../../lib/format';
import { AccountModelResult, EvidenceItem, Restriction, RestrictionState, RoleCandidate, TransactionAssessment } from '../../types/dynamic';
import { ROLE_TONE_V3, Tone } from './caseModel';
import { Badge, IdText, Ref } from './ui';



export const RoleBadge: React.FC<{ role: RoleCandidate; label: string }> = ({ role, label }) => <Badge tone={ROLE_TONE_V3[role]}>{label}</Badge>;

/** The transaction model's flag on a transfer, styled apart from rule badges so a model output never reads as a fixed rule. */
export const ModelFlagBadge: React.FC<{ explanation?: string }> = ({ explanation }) => (
  <Badge tone="ice" title={explanation}>
    <Cpu className="w-3 h-3" aria-hidden="true" /> Transaction model
  </Badge>
);

const pct = (x: number | null | undefined, digits = 1) => `${((x ?? 0) * 100).toFixed(digits)}%`;

/** The dynamic investigation's account model result: calibrated score against its own threshold, or why there is none. */
export const AccountModelSummary: React.FC<{ m: AccountModelResult }> = ({ m }) => {
  if (m.status !== 'scored' && m.status !== 'reference_only') {
    return <p className="text-mute">Account model: {m.reason ?? (m.status === 'not_analyzed' ? 'not analysed in this run.' : 'not available.')}</p>;
  }
  const ref = m.status === 'reference_only';
  return (
    <p data-testid="account-model-v3" data-status={m.status}>
      <Badge tone={ref ? 'neutral' : 'ice'}>Account model {pct(m.calibrated_probability)}</Badge>{' '}
      {m.threshold != null && (m.above_threshold ? `at or above its ${pct(m.threshold)} review threshold` : `below its ${pct(m.threshold)} review threshold`)}
      {ref && <span className="block mt-0.5 text-xs text-mute">Reference only, not validated on this dataset.</span>}
    </p>
  );
};

/** The account model's own factors (what moved the score; not causes). */
export const AccountModelFactors: React.FC<{ m: AccountModelResult }> = ({ m }) => (
  <ul className="space-y-1">
    {m.factors.slice(0, 5).map((f) => (
      <li key={f.feature} className="flex justify-between gap-3">
        <span className="text-ink-soft">{f.label}</span>
        <span className={f.contribution > 0 ? 'text-sev-high font-semibold' : 'text-mute'}>{f.contribution > 0 ? 'raises' : 'lowers'}</span>
      </li>
    ))}
  </ul>
);

const KIND_LABEL: Record<EvidenceItem['kind'], string> = { observed: 'Recorded fact', model: 'Model output', rule: 'Fixed rule' };
const KIND_TONE: Record<EvidenceItem['kind'], Tone> = { observed: 'fact', model: 'iris', rule: 'neutral' };

/** Evidence with its source kept visible, so a model output is never read as a recorded fact. */
export const EvidenceList: React.FC<{ items: EvidenceItem[]; empty?: string }> = ({ items, empty = 'Nothing recorded.' }) =>
  items.length ? (
    <ul className="space-y-2">
      {items.map((e) => (
        <li key={e.text} className="flex items-start gap-2 text-sm text-ink-soft">
          <Badge tone={KIND_TONE[e.kind]} className="mt-0.5 shrink-0">
            {KIND_LABEL[e.kind]}
          </Badge>
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-mute">{empty}</p>
  );


const RESTRICTION_ICON: Record<RestrictionState, React.FC<{ className?: string }>> = {
  no_restriction_recommendation: ShieldCheck,
  additional_verification_recommended: UserCheck,
  urgent_manual_review_recommended: ShieldAlert,
  consider_temporary_restriction_review: ShieldAlert,
  insufficient_evidence_to_recommend: ShieldQuestion,
};
const RESTRICTION_TONE: Record<RestrictionState, string> = {
  no_restriction_recommendation: 'ring-[#DCE1EB] bg-white',
  additional_verification_recommended: 'ring-[#F5E3A8] bg-[#FFFCF1]',
  urgent_manual_review_recommended: 'ring-[#FCD9C2] bg-[#FFF7F1]',
  consider_temporary_restriction_review: 'ring-[#FBCFD8] bg-[#FFF5F7]',
  insufficient_evidence_to_recommend: 'ring-line bg-white',
};

/** Advisory restriction state. Always states that a person decides and that nothing was done. */
export const RestrictionPanel: React.FC<{ r: Restriction; compact?: boolean }> = ({ r, compact }) => {
  const Icon = RESTRICTION_ICON[r.state];
  return (
    <section aria-label={`Restriction recommendation for ${r.account_id}`} className={`rounded-2xl ring-1 p-5 ${RESTRICTION_TONE[r.state]}`} data-testid="restriction" data-state={r.state}>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs text-mute">Restriction recommendation for <IdText>{r.account_id}</IdText></p>
          <p className="mt-0.5 font-semibold text-ink leading-snug">{r.label}</p>
          <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">{r.rationale}</p>
          {r.victim_note && <p className="mt-2 text-sm font-medium text-[#1D4ED8]">{r.victim_note}</p>}
        </div>
      </div>
      {!compact && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
          {r.supporting_evidence.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-ink">What supports it</h4>
              <ul className="mt-1.5 space-y-1 list-disc pl-4 text-ink-soft">
                {r.supporting_evidence.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
          {r.innocent_explanations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-ink">Innocent explanations to rule out</h4>
              <ul className="mt-1.5 space-y-1 list-disc pl-4 text-ink-soft">
                {r.innocent_explanations.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
          {r.verification_needed.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-ink">Verification needed first</h4>
              <ul className="mt-1.5 space-y-1 list-disc pl-4 text-ink-soft">
                {r.verification_needed.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold text-ink">Missing information</h4>
            <ul className="mt-1.5 space-y-1 list-disc pl-4 text-ink-soft">
              {r.missing_information.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          {r.relevant_transaction_ids.length > 0 && (
            <div className="sm:col-span-2">
              <h4 className="text-xs font-semibold text-ink">Relevant transfers</h4>
              <span className="mt-1.5 inline-flex flex-wrap gap-1">
                {r.relevant_transaction_ids.slice(0, 12).map((id) => <Ref key={id} id={id} />)}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="mt-4 pt-3 border-t border-line/70 text-xs text-mute">
        Advisory only. A person at the authorised institution decides, under its policy. FraudShield took no action on this account.
      </p>
    </section>
  );
};

const RISK_LABEL: Record<TransactionAssessment['risk_category'], string> = { high: 'High', elevated: 'Elevated', low: 'Low', not_scored: 'Not scored' };
const RISK_TONE: Record<TransactionAssessment['risk_category'], Tone> = { high: 'critical', elevated: 'elevated', low: 'low', not_scored: 'neutral' };

/** One scored transfer: what was flagged, by which check, and the model's own factors (not causes). */
export const ScoredTransfer: React.FC<{ t: TransactionAssessment }> = ({ t }) => (
  <article className="rounded-2xl ring-1 ring-line bg-white p-4" data-testid="scored-transfer">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-mute">
          <Ref id={t.transaction_id} /> <span className="ml-1">{formatDateTime(t.timestamp)}</span>
        </p>
        <p className="mt-1 font-semibold text-ink">
          {formatMoney(t.amount)} <span className="font-normal text-mute">from</span> <IdText>{t.sender_account_id}</IdText>{' '}
          <span className="font-normal text-mute">to</span> <IdText>{t.receiver_account_id}</IdText>
        </p>
        <p className="text-xs text-faint">{[t.transaction_type, t.channel].filter(Boolean).join(', ')}</p>
      </div>
      <div className="text-right">
        {t.evidence_use === 'reference_only' ? (
          <Badge tone="neutral" title="The transaction model is not validated on this dataset">Model (reference only): {RISK_LABEL[t.risk_category]}</Badge>
        ) : (
          <Badge tone={RISK_TONE[t.risk_category]}>Model: {RISK_LABEL[t.risk_category]}</Badge>
        )}
        {t.calibrated_probability !== null && (
          <p className="mt-1 text-xs text-mute" title="Share of synthetic validation transfers with this score that were scenario transfers. Not a probability that anyone committed fraud.">
            Calibrated score {(t.calibrated_probability * 100).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
    {(t.model_factors.length > 0 || t.rule_flags.length > 0) && (
      <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
        {t.model_factors.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-ink">What raised the model score{t.evidence_use === 'reference_only' ? ' (reference only)' : ''}</h4>
            <ul className="mt-1 space-y-0.5 text-ink-soft">
              {t.model_factors.map((f) => <li key={f.feature}>{f.label}</li>)}
            </ul>
          </div>
        )}
        {t.rule_flags.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-ink">Fixed rules</h4>
            <ul className="mt-1 space-y-0.5 text-ink-soft">
              {t.rule_flags.map((f) => <li key={f.code}>{f.explanation}</li>)}
            </ul>
          </div>
        )}
      </div>
    )}
    {t.outside_training_range && <p className="mt-2 text-xs text-sev-elevated">Several inputs are outside the range the model was trained on; treat the score with extra caution.</p>}
  </article>
);
