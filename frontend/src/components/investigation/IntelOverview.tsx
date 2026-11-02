import React from 'react';
import { Database } from 'lucide-react';
import { formatDateTime, formatMoney } from '../../lib/format';
import { DynamicReport } from '../../types/dynamic';
import { Badge, Disclosure, IdText } from './ui';
import { ScoredTransfer } from './intel';
import { suspiciousHeading } from './narrative';
import { EvidenceTag } from '../ui/EvidenceTag';

const STATUS_TONE = {
  potential_victim: 'ice',
  suspicious_activity_victim_status_unconfirmed: 'elevated',
  no_suspicious_activity_observed: 'low',
  insufficient_evidence: 'neutral',
} as const;

/** Top of the overview for a model-driven investigation: is this account a potential victim, which transfers were
 * flagged and by what, and how much data and which models were behind it. */
export const IntelOverview: React.FC<{ intel: DynamicReport }> = ({ intel }) => {
  const v = intel.victim_assessment;
  const shown = intel.suspicious_transactions.slice(0, 3);
  const more = intel.suspicious_transactions.slice(3);
  const tm = intel.model_metadata.transaction_model;
  const am = intel.model_metadata.account_model;
  const cov = intel.data_coverage;
  // Only the investigated account's own scored transfers (older servers do not send this count, so none is shown).
  const onAccount = intel.transaction_scoring.scored_on_investigated_account;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <section aria-labelledby="assess-h" className="panel panel-sheen p-6" data-testid="victim-assessment" data-status={v.status}>
          {/* QA-12: the victim question only heads a victim-side result; forwarding or abstaining results get a neutral heading. */}
          <p className="text-sm text-mute" data-testid="assessment-question">
            {v.status === 'potential_victim' || (v.status === 'suspicious_activity_victim_status_unconfirmed' && v.role_candidate === 'suspicious_activity_victim_unconfirmed')
              ? <>Is <IdText>{v.account_id}</IdText> potentially a victim?</>
              : <>What the records show about <IdText>{v.account_id}</IdText></>}
          </p>
          <h2 id="assess-h" className="mt-1 font-display text-2xl font-bold text-ink flex flex-wrap items-center gap-x-3 gap-y-2">
            {v.label}
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[v.status]}>Account assessment</Badge>
              <EvidenceTag kind="interpretation" />
            </span>
          </h2>
          <p className="mt-2 text-[16px] text-ink-soft leading-relaxed max-w-[68ch]">{v.headline}</p>
          {v.evidence.length > 0 && (
            <div className="mt-4 rounded-xl bg-well ring-1 ring-line px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                What the records show <EvidenceTag kind="observed" />
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-soft list-disc pl-5 marker:text-faint">
                {v.evidence.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
          {(v.contradictory_evidence.length > 0 || v.uncertainty_reason) && (
            <p className="mt-3 text-sm text-mute">
              <span className="font-semibold text-ink">Keep in mind: </span>
              {[...v.contradictory_evidence, v.uncertainty_reason].filter(Boolean).join(' ')}
            </p>
          )}
        </section>

        <aside aria-label="Data and models" className="panel p-5 text-sm space-y-3" data-testid="data-coverage">
          <h3 className="font-semibold text-ink flex items-center gap-2">
            <Database className="w-4 h-4 text-iris" aria-hidden="true" /> {intel.dataset.title}
          </h3>
          <p className="text-xs text-mute">{intel.synthetic_data_notice}</p>
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-3"><dt className="text-mute">Account history</dt><dd className="font-semibold text-ink">{cov.investigated_account_transactions} transfers over {cov.history_span_days} days</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-mute">Records examined</dt><dd className="font-semibold text-ink">{cov.records_loaded.toLocaleString('en-IN')}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-mute">Accounts analysed</dt><dd className="font-semibold text-ink">{cov.accounts_analyzed} of {cov.accounts_in_trace}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-mute">Data as of</dt><dd className="font-semibold text-ink">{formatDateTime(cov.data_as_of)}</dd></div>
          </dl>
          <div className="pt-3 border-t border-line space-y-1.5 text-xs">
            <p><span className="font-semibold text-ink">Transaction model:</span> {tm.available ? `${tm.model_version}, review threshold ${((tm.threshold ?? 0) * 100).toFixed(2)}% calibrated` : `unavailable (${tm.unavailable_reason})`}</p>
            <p><span className="font-semibold text-ink">Account behaviour model:</span> {am.available ? `${am.model_version}, review threshold ${((am.threshold ?? 0) * 100).toFixed(1)}% calibrated` : `unavailable (${am.unavailable_reason})`}</p>
            {tm.available && tm.threshold_rule && (
              <p className="text-faint">
                Thresholds are the {tm.threshold_rule}, chosen on validation data. Scenario transfers are rare (about 0.4% of transfers), so a
                calibrated threshold can be low.
              </p>
            )}
            <p className="text-faint">Models were trained on a different synthetic ledger; scores are calibrated on synthetic validation data and are not probabilities that anyone committed fraud.</p>
          </div>
        </aside>
      </div>

      <section aria-labelledby="susp-h" className="space-y-3">
        <div>
          <h2 id="susp-h" className="font-display text-xl font-bold text-ink">Suspicious transactions</h2>
          <p className="text-sm text-mute">
            {intel.suspicious_transactions.length
              ? suspiciousHeading(intel)
              : `None of this account's ${onAccount !== undefined ? `${onAccount} ` : ''}scored transfers was flagged${intel.transaction_scoring.model_used_as_evidence ? " by the transaction model's review threshold or" : ' by'} a fixed rule.`}
          </p>
          {!intel.model_validation.validated_for_this_dataset && (
            <p className="mt-2 rounded-xl bg-sev-elevated-soft ring-1 ring-warn-line px-3 py-2 text-sm text-sev-elevated" data-testid="model-not-validated"
              data-support-state={intel.model_validation.support_state ?? 'unknown'}>
              {intel.model_validation.support_state === 'unsupported_distribution_shift' && (
                <strong className="font-semibold">Models unsupported on this dataset (out of distribution). </strong>
              )}
              {intel.model_validation.support_state === 'unsupported_not_checked' && (
                <strong className="font-semibold">Models not validated or checked for this dataset. </strong>
              )}
              {intel.model_validation.note}
            </p>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((t) => <ScoredTransfer key={t.transaction_id} t={t} threshold={tm.threshold} />)}
        </div>
        {!intel.suspicious_transactions.length && (intel.closest_unflagged_transfers?.length ?? 0) > 0 && (
          <div className="panel p-5" data-testid="closest-unflagged">
            <h3 className="text-sm font-semibold text-ink">Closest to the review threshold (not flagged)</h3>
            <p className="mt-1 text-xs text-mute">
              Context, not a finding: the account&rsquo;s own outgoing transfers with the highest transaction-model scores that stayed below its
              review threshold. They were not traced and are not evidence.
            </p>
            <ul className="mt-3 space-y-2">
              {intel.closest_unflagged_transfers!.map((t) => (
                <li key={t.transaction_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                  <span className="text-ink-soft">
                    <IdText>{t.transaction_id}</IdText> {formatMoney(t.amount)} to <IdText>{t.receiver_account_id}</IdText>, {formatDateTime(t.timestamp)}
                  </span>
                  <span className="text-xs text-mute">
                    Score {(t.calibrated_probability * 100).toFixed(3)}% vs threshold {(t.threshold * 100).toFixed(3)}%
                    {t.evidence_use === 'reference_only' ? ' (reference only)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {intel.uncorroborated_rule_flags.length > 0 && (
          <Disclosure summary={`${intel.uncorroborated_rule_flags.length} transfer(s) flagged by the fixed rules but not by the validated transaction model`}>
            <p className="mb-3 text-sm text-mute" data-testid="uncorroborated">
              A first rent payment or a large purchase often looks unusual against an account’s own history. On this dataset the transaction model is
              the validated detector, so these rule flags are shown but not treated as suspicious activity.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {intel.uncorroborated_rule_flags.map((t) => <ScoredTransfer key={t.transaction_id} t={t} threshold={tm.threshold} />)}
            </div>
          </Disclosure>
        )}
        {more.length > 0 && (
          <Disclosure summary={`Show ${more.length} more flagged transfer(s)`}>
            <div className="grid gap-3 lg:grid-cols-2">
              {more.map((t) => <ScoredTransfer key={t.transaction_id} t={t} threshold={tm.threshold} />)}
            </div>
          </Disclosure>
        )}
      </section>

      <Disclosure summary="How this investigation was computed">
        <ol className="space-y-2 text-sm" data-testid="processing-steps">
          {intel.processing_steps.map((s) => (
            <li key={s.step} className="flex gap-3">
              <span className="w-28 shrink-0 text-mute">{s.duration_ms} ms</span>
              <span>
                <span className="font-semibold text-ink">{s.label}.</span> <span className="text-ink-soft">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <ul className="mt-4 space-y-1 text-xs text-mute list-disc pl-4">
          {intel.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Disclosure>
    </div>
  );
};

export default IntelOverview;
