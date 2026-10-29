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

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');

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
  const metrics = status?.account_model?.test_metrics as Record<string, number> | null | undefined;
  const testSuspicious = status?.account_model?.dataset_info?.test_suspicious_count as number | undefined;
  const testNormal = status?.account_model?.dataset_info?.test_normal_count as number | undefined;
  const threshold = status?.account_model?.decision_threshold ?? (typeof metrics?.threshold === 'number' ? metrics.threshold : null);
  const ops = status?.account_model?.operational_notes;
  const rules = data.rules.ok ? data.rules.value : null;
  const model = data.model.ok ? data.model.value : null;
  const disagree = rules && model ? Math.abs(rules.risk_score - model.risk_score) >= 30 : false;
  const maxContribution = Math.max(0.0001, ...(model?.top_contributions ?? []).map((c) => Math.abs(c.contribution_score)));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#EAE3D6] bg-[#FAF7F2] p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8C857B]">Synthetic ledger record</p>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <dt className="text-xs text-[#6B655B]">Customer type</dt>
            <dd className="font-semibold capitalize">{profile.customer_type}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6B655B]">KYC</dt>
            <dd className="font-semibold">{profile.kyc_tier.replace(/_/g, ' ').replace(/^tier (\d)/, 'Tier $1 ·')}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6B655B]">Ledger transactions</dt>
            <dd className="font-semibold">{profile.metrics.total_incoming_txns + profile.metrics.total_outgoing_txns}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6B655B]">Activity</dt>
            <dd className="font-semibold text-xs">
              {formatDateTime(profile.metrics.first_activity_at).split(',')[0]} – {formatDateTime(profile.metrics.last_activity_at).split(',')[0]}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#EAE3D6] p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#6B655B]">
            <Scale className="w-3.5 h-3.5" aria-hidden="true" /> Ledger rules
          </p>
          {rules ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{Math.round(rules.risk_score)}</span>
                <span className="text-xs text-[#6B655B]">/ 100</span>
                <Pill tone={LEVEL_TONE[rules.risk_level]}>{LEVEL_LABEL[rules.risk_level]}</Pill>
              </p>
              <p className="mt-1 text-xs text-[#6B655B]">Fixed, readable rules about timing, size and spread of transfers.</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[#6B655B]">{describeError(data.rules.ok ? null : data.rules.error, 'Rule check unavailable.')}</p>
          )}
        </div>
        <div className="rounded-xl border border-[#EAE3D6] p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#6B655B]">
            <Cpu className="w-3.5 h-3.5" aria-hidden="true" /> Account model {model && <span className="font-mono font-normal">{model.model_version}</span>}
          </p>
          {model ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{Math.round(model.risk_score)}%</span>
                <Pill tone={LEVEL_TONE[model.risk_level]}>{LEVEL_LABEL[model.risk_level]}</Pill>
              </p>
              <p className="mt-1 text-xs text-[#6B655B]">
                How closely this account’s behaviour resembles suspicious accounts in the synthetic training data. A
                score, not a verified probability.
                {threshold !== null && ` Accounts at ${Math.round(threshold * 100)}% or more are suggested for review.`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[#6B655B]">
              {describeError(data.model.ok ? null : data.model.error, 'The account model could not assess this account.')}
            </p>
          )}
        </div>
      </div>

      {disagree && (
        <p className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E] leading-relaxed">
          The two checks disagree by more than 30 points. Neither is authoritative; look at the underlying transfers above.
        </p>
      )}
      {isReportingCustomer && model && (
        <p className="rounded-xl border border-[#BFDBFE] bg-[#EBF5FF] p-3 text-xs text-[#1E40AF] leading-relaxed">
          This is the reporting customer. A sudden large payment out of an account can raise a behaviour-based score. That
          is expected for scam victims and says nothing about the customer’s conduct.
        </p>
      )}

      {model && (
        <section aria-labelledby={`why-${accountId}`} className="rounded-xl border border-[#EAE3D6] p-4">
          <h4 id={`why-${accountId}`} className="text-sm font-semibold">
            Why the model gave this score
          </h4>
          {model.top_contributions.length === 0 ? (
            <p className="mt-2 text-sm text-[#6B655B]">
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
                      <span className={`inline-flex items-center gap-0.5 text-xs font-semibold shrink-0 ${up ? 'text-[#BE123C]' : 'text-[#166534]'}`}>
                        {up ? <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />}
                        {up ? 'Raised score' : 'Lowered score'}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#EFECE6] overflow-hidden" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${up ? 'bg-[#F43F5E]' : 'bg-[#22C55E]'}`}
                        style={{ width: `${(Math.abs(f.contribution_score) / maxContribution) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[#6B655B]">{info.meaning}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-[#8C857B] leading-relaxed">
            The six inputs with the largest effect on this account’s score (TreeSHAP values from the model itself). Bars
            are relative to each other.
          </p>
        </section>
      )}

      <section className="rounded-xl border border-[#EAE3D6] bg-[#FAF7F2] p-4 text-xs text-[#6B655B] space-y-2 leading-relaxed">
        <p className="flex items-center gap-1.5 font-semibold text-[#1A1714]">
          <Info className="w-3.5 h-3.5" aria-hidden="true" /> About these results
        </p>
        <p>
          Computed at {formatTime(data.loadedAt)} from this account’s whole ledger history, including activity before and
          after this case’s transfers, not only the transfers in this case.
        </p>
        {metrics && (
          <p>
            On held-out synthetic test accounts
            {testSuspicious !== undefined && testNormal !== undefined
              ? ` (${testSuspicious} suspicious, ${testNormal.toLocaleString('en-IN')} ordinary)`
              : testSuspicious !== undefined
              ? ` (only ${testSuspicious} suspicious)`
              : ''}
            , at its {threshold !== null ? `${Math.round(threshold * 100)}%` : 'review'} threshold the model caught{' '}
            {pct(metrics.recall)} of suspicious accounts, and {pct(metrics.precision)} of the accounts it flagged were
            suspicious. It misses cases and raises false alarms.
          </p>
        )}
        {ops?.demo_ledger_flag_rate_ordinary !== undefined && (
          <p>
            In this app’s own ledger, where suspicious accounts are rare, it also flags about{' '}
            {pct(ops.demo_ledger_flag_rate_ordinary)} of ordinary accounts, so most flags there are false alarms.
          </p>
        )}
        <p>
          Trained and tested only on synthetic data. A high score is a reason to look closer, never a finding, and a low
          score does not clear an account.
        </p>
        <Link to="/tools/model" className="inline-block font-semibold text-[#B45309] hover:text-[#EA8500]">
          Full model evaluation →
        </Link>
      </section>
    </div>
  );
};
