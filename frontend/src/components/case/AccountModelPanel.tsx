import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Cpu, Info, Scale } from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import {
  V2AccountAssessmentResponse,
  V2AccountMLAssessmentResponse,
  V2AccountProfileResponse,
  V2ModelStatusResponse,
} from '../../types/v2';
import { featureInfo } from '../../lib/featureGlossary';
import { formatDateTime, formatTime } from '../../lib/format';
import {
  COMPARISON_TEXT,
  MODEL_SCORE_LABEL,
  MODEL_SCORE_MEANING,
  RULE_SCORE_LABEL,
  RULE_SCORE_MEANING,
  accountEvaluation,
  compareChecks,
  formatModelScore,
  pct,
  plainShare,
  ruleSuggestsReview,
} from '../../lib/modelScore';
import { describeError } from '../../lib/errors';
import { ErrorState, LoadingState, Pill } from '../ui/StateViews';

interface Props {
  accountId: string;
  isReportingCustomer: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface PanelData {
  profile: Result<V2AccountProfileResponse>;
  rules: Result<V2AccountAssessmentResponse>;
  model: Result<V2AccountMLAssessmentResponse>;
  status: Result<V2ModelStatusResponse>;
  loadedAt: string;
}

const settle = <T,>(p: Promise<T>): Promise<Result<T>> =>
  p.then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error }));

const LEVEL_TONE = { low: 'green', elevated: 'amber', high: 'orange', critical: 'rose' } as const;
const LEVEL_LABEL = { low: 'Low', elevated: 'Elevated', high: 'High', critical: 'Very high' } as const;


export const AccountModelPanel: React.FC<Props> = ({ accountId, isReportingCustomer }) => {
  const [data, setData] = useState<PanelData | null>(null);

  const load = useCallback(() => {
    setData(null);
    Promise.all([
      settle(v2Api.getAccount(accountId)),
      settle(v2Api.getAssessment(accountId)),
      settle(v2Api.getMLAssessment(accountId)),
      settle(v2Api.getModelsStatus()),
    ]).then(([profile, rules, model, status]) =>
      setData({ profile, rules, model, status, loadedAt: new Date().toISOString() })
    );
  }, [accountId]);

  useEffect(load, [load]);

  if (!data) return <LoadingState label="Running automated checks on the account ledger…" />;

  if (!data.profile.ok) {
    return (
      <ErrorState
        title="Account ledger record unavailable"
        message={describeError(data.profile.error, `No synthetic-ledger record could be loaded for ${accountId}, so automated checks cannot run.`)}
        onRetry={load}
      />
    );
  }

  const profile = data.profile.value;
  const status = data.status.ok ? data.status.value : null;
  const evaluation = accountEvaluation(status);
  const rules = data.rules.ok ? data.rules.value : null;
  const model = data.model.ok ? data.model.value : null;
  // The backend applies the served threshold; the UI only explains it.
  const modelSuggests = model ? model.predicted_class === 'suspicious' : false;
  const comparison = rules && model ? compareChecks(modelSuggests, ruleSuggestsReview(rules.risk_level)) : null;
  const maxContribution = Math.max(0.0001, ...(model?.top_contributions ?? []).map((c) => Math.abs(c.contribution_score)));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-well p-4 text-sm">
        <p className="text-xs font-semibold text-faint">Synthetic ledger record</p>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <dt className="text-xs text-mute">Customer type</dt>
            <dd className="font-semibold capitalize">{profile.customer_type}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">KYC</dt>
            <dd className="font-semibold">{profile.kyc_tier.replace(/_/g, ' ').replace(/^tier (\d)/, 'Tier $1 ·')}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Ledger transactions</dt>
            <dd className="font-semibold">{profile.metrics.total_incoming_txns + profile.metrics.total_outgoing_txns}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Activity</dt>
            <dd className="font-semibold text-xs">
              {formatDateTime(profile.metrics.first_activity_at).split(',')[0]} – {formatDateTime(profile.metrics.last_activity_at).split(',')[0]}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-4" data-testid="rule-score-card">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-mute">
            <Scale className="w-3.5 h-3.5" aria-hidden="true" /> {RULE_SCORE_LABEL} <span className="font-normal">· fixed rules</span>
          </p>
          {rules ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{Math.round(rules.risk_score)}</span>
                <span className="text-xs text-mute">points of 100</span>
                <Pill tone={LEVEL_TONE[rules.risk_level]}>{LEVEL_LABEL[rules.risk_level]}</Pill>
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {ruleSuggestsReview(rules.risk_level) ? 'Suggests review' : 'Does not suggest review'}
              </p>
              <p className="mt-1 text-xs text-mute">{RULE_SCORE_MEANING}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-mute">{describeError(data.rules.ok ? null : data.rules.error, 'Rule check unavailable.')}</p>
          )}
        </div>
        <div className="rounded-xl border border-line p-4" data-testid="model-score-card">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-mute">
            <Cpu className="w-3.5 h-3.5" aria-hidden="true" /> {MODEL_SCORE_LABEL} <span className="font-normal">· machine learning</span>
            {model && <span className="font-mono font-normal">{model.model_version}</span>}
          </p>
          {model ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{formatModelScore(model.risk_score)}</span>
                <Pill tone={LEVEL_TONE[model.risk_level]}>{LEVEL_LABEL[model.risk_level]}</Pill>
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {modelSuggests
                  ? `At or above the ${evaluation.thresholdLabel ?? 'review'} review threshold: suggested for review, not confirmed fraud.`
                  : `Below the ${evaluation.thresholdLabel ?? 'review'} review threshold. This does not clear the account.`}
              </p>
              <p className="mt-1 text-xs text-mute">
                {MODEL_SCORE_MEANING} Shown on a 0–100% scale: higher means the account behaves more like the suspicious
                accounts the model learned from.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-mute">
              {describeError(data.model.ok ? null : data.model.error, 'The account model could not assess this account.')}
            </p>
          )}
        </div>
      </div>

      {comparison && (
        <p
          data-testid="checks-comparison"
          className={`rounded-xl border p-3 text-xs leading-relaxed ${
            comparison === 'model_only' || comparison === 'rules_only'
            ? 'border-warn-line bg-warn-soft text-warn'
            : 'border-line bg-well text-mute'
          }`}
        >
          {COMPARISON_TEXT[comparison]} The two scores use different scales, so their numbers should not be compared
          directly.
        </p>
      )}
      {isReportingCustomer && model && (
        <p className="rounded-xl border border-ice-line bg-ice-soft p-3 text-xs text-info leading-relaxed">
          This is the reporting customer. A sudden large payment out of an account can raise a behaviour-based score. That
          is expected for scam victims and says nothing about the customer’s conduct.
        </p>
      )}

      {model && (
        <section aria-labelledby={`why-${accountId}`} className="rounded-xl border border-line p-4">
          <h4 id={`why-${accountId}`} className="text-sm font-semibold">
            Why the model gave this score
          </h4>
          {model.top_contributions.length === 0 ? (
            <p className="mt-2 text-sm text-mute">
              The explanation could not be computed for this result, so the factors behind the score are unknown.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {model.top_contributions.map((f) => {
                const info = featureInfo(f.feature_name);
                const up = f.impact_direction === 'increases_risk';
                return (
                  <li key={f.feature_name} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">
                        {info.label}: <span className="font-semibold">{info.display(f.feature_value)}</span>
                      </span>
                      <span className={`inline-flex items-center gap-0.5 text-xs font-semibold shrink-0 ${up ? 'text-danger' : 'text-ok'}`}>
                        {up ? <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />}
                        {up ? 'Raised score' : 'Lowered score'}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-well-strong overflow-hidden" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${up ? 'bg-danger-fill' : 'bg-ok-fill'}`}
                        style={{ width: `${(Math.abs(f.contribution_score) / maxContribution) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-mute">{info.meaning}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint leading-relaxed">
            The six inputs with the largest effect on this account’s score (TreeSHAP values from the model itself). Bars
            are relative to each other.
          </p>
        </section>
      )}

      <section
        data-testid="model-limits"
        className="rounded-xl border border-line bg-well p-4 text-xs text-mute space-y-2 leading-relaxed"
      >
        <p className="flex items-center gap-1.5 font-semibold text-ink">
          <Info className="w-3.5 h-3.5" aria-hidden="true" /> About these results
        </p>
        <p>
          Computed at {formatTime(data.loadedAt)} from this account’s whole ledger history, including activity before and
          after this case’s transfers.
        </p>
        <p>
          In synthetic testing the model found {plainShare(evaluation.recall)} of suspicious accounts, and{' '}
          {plainShare(evaluation.precision)} of the accounts it flagged were suspicious. It misses cases and raises false
          alarms. A high score does not show intent; a low score does not show innocence.
        </p>
        <details className="group">
          <summary className="cursor-pointer font-semibold text-iris-deep hover:text-iris">How was this measured?</summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              Test set: {evaluation.positives ?? '—'} suspicious and {evaluation.negatives?.toLocaleString('en-IN') ?? '—'}{' '}
              ordinary synthetic accounts the model never trained on.
            </li>
            <li>
              At the {evaluation.thresholdLabel ?? '—'} review threshold: found {pct(evaluation.recall)} of suspicious
              accounts (recall); {pct(evaluation.precision)} of flags were suspicious (precision).
            </li>
            {evaluation.demoFlagRate !== null && (
              <li>
                In this app’s own ledger, where suspicious accounts are rare, it flags about {pct(evaluation.demoFlagRate)}{' '}
                of ordinary accounts, so most flags there are false alarms.
              </li>
            )}
            <li>These are results on synthetic data. They do not show how the model would perform on real bank accounts.</li>
          </ul>
        </details>
        <Link to="/tools/model" className="inline-block font-semibold text-iris-deep hover:text-iris">
          Full model evaluation →
        </Link>
      </section>
    </div>
  );
};
