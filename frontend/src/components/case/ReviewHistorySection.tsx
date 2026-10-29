import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2 } from 'lucide-react';
import { api, WriteAccessMode } from '../../services/api';
import { AccountAssessmentResponse, AccountReviewStatus } from '../../types/api';
import {
  EVIDENCE_QUALITY_OPTIONS,
  REVIEW_DECISIONS,
  REVIEW_STATE_LABELS,
  evidenceQualityLabel,
  formatMoney,
  isRecordedDecision,
  roleLabel,
} from '../../lib/format';
import { describeError } from '../../lib/errors';
import { readReviewer, rememberReviewer, reviewerProblem } from '../../lib/reviewer';
import { CaseStatusPanel } from './CaseStatusPanel';
import { EmptyState, ErrorState } from '../ui/StateViews';
import { CaseHistory } from './CaseHistory';
import { ReviewStatePill } from './AccountsRiskSection';
import { CaseWorkspaceData, caseTransactions, sortedAccounts } from './caseModel';

interface Props {
  data: CaseWorkspaceData;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  onRecorded: () => Promise<void> | void;
}

type Decision = (typeof REVIEW_DECISIONS)[number]['value'];

const ReviewForm: React.FC<{
  caseId: string;
  account: AccountAssessmentResponse;
  onRecorded: (saved: AccountReviewStatus) => void;
}> = ({ caseId, account, onRecorded }) => {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [evidenceQuality, setEvidenceQuality] = useState('graph_connection_only');
  const [rationale, setRationale] = useState('');
  const [moreInfo, setMoreInfo] = useState(false);
  const [reviewer, setReviewer] = useState(readReviewer);
  const [cited, setCited] = useState<string[]>([]);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const txns = caseTransactions(account);
  const rev = account.review_status;
  const hasDecision = isRecordedDecision(rev.reviewer_id) && rev.review_state !== 'reporting_victim';

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!decision) p.push('Choose a decision.');
    if (rationale.trim().length < 10) p.push('Explain your reasoning in at least 10 characters.');
    const reviewerIssue = reviewerProblem(reviewer);
    if (reviewerIssue) p.push(reviewerIssue);
    return p;
  }, [decision, rationale, reviewer]);

  const decisionInfo = REVIEW_DECISIONS.find((d) => d.value === decision);

  const save = async () => {
    if (!decision) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateAccountReview(caseId, account.account_id, {
        review_state: decision,
        evidence_quality: evidenceQuality,
        notes: rationale.trim(),
        reviewer_id: reviewer.trim(),
        decision_reasons: [],
        supporting_transaction_ids: cited,
        additional_info_needed: moreInfo,
      });
      rememberReviewer(reviewer.trim());
      onRecorded(saved);
    } catch (err) {
      setError(describeError(err, 'The decision was not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#EAE3D6] bg-[#FAF7F2] p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8C857B]">Current recorded decision</p>
        {hasDecision ? (
          <div className="mt-1.5 space-y-1">
            <p>
              <span className="font-semibold">{REVIEW_STATE_LABELS[rev.review_state] ?? rev.review_state}</span> by{' '}
              <span className="font-semibold">{rev.reviewer_id}</span> · {evidenceQualityLabel(rev.evidence_quality)}
            </p>
            {rev.notes && <p className="text-[#6B655B] whitespace-pre-wrap">“{rev.notes}”</p>}
          </div>
        ) : (
          <p className="mt-1.5 text-[#6B655B]">No decision has been recorded for this account yet.</p>
        )}
      </div>

      <div className="rounded-xl border border-[#EAE3D6] p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8C857B]">Evidence to consider</p>
        <ul className="mt-2 space-y-1.5 text-[#1A1714]">
          <li>
            Received {formatMoney(account.observed_movement.observed_inbound_value)} and sent on{' '}
            {formatMoney(account.observed_movement.observed_outbound_value)} in this case.
          </li>
          {account.observed_signals.map((s) => (
            <li key={s.code}>{s.description}</li>
          ))}
          {account.evidence_assessment.evidence_gaps.slice(0, 2).map((g) => (
            <li key={g} className="text-[#6B655B]">
              Gap: {g}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[#6B655B]">
          The automated checks in Accounts &amp; risk are also available, but they are not evidence on their own.
        </p>
      </div>

      {step === 'edit' ? (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (problems.length === 0) setStep('confirm');
          }}
          noValidate
        >
          <fieldset>
            <legend className="text-sm font-semibold">Decision</legend>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {REVIEW_DECISIONS.map((d) => (
                <label
                  key={d.value}
                  className={`rounded-xl border p-3.5 cursor-pointer transition-all ${
                    decision === d.value ? 'border-[#EA8500] bg-[#FFFBF6] shadow-[0_0_0_3px_rgba(234,133,0,0.12)]' : 'border-[#EAE3D6] hover:border-[#EA8500]/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="decision"
                      value={d.value}
                      checked={decision === d.value}
                      onChange={() => setDecision(d.value)}
                      className="accent-[#EA8500]"
                    />
                    <span className="text-sm font-semibold">{d.label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-[#6B655B] leading-relaxed">{d.help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="font-semibold">How strong is the evidence?</span>
              <select
                value={evidenceQuality}
                onChange={(e) => setEvidenceQuality(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2.5 text-sm"
              >
                {EVIDENCE_QUALITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-semibold">Reviewer</span>
              <input
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                maxLength={100}
                placeholder="Your name or reviewer ID"
                autoComplete="name"
                className="mt-1.5 w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2.5 text-sm"
              />
              <span className="mt-1 block text-xs text-[#8C857B]">Recorded as typed. Without sign-in it is not verified.</span>
            </label>
          </div>

          <label className="block text-sm">
            <span className="font-semibold">Reasoning</span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder="What did you look at, and why does it support this decision?"
              className="mt-1.5 w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2.5 text-sm"
            />
          </label>

          {txns.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold">Transfers you relied on (optional)</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {txns.map((t) => {
                  const on = cited.includes(t.transaction_id);
                  return (
                    <label
                      key={t.transaction_id}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs cursor-pointer ${
                        on ? 'border-[#EA8500] bg-[#FFF4E6]' : 'border-[#EAE3D6] bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setCited((p) => (on ? p.filter((x) => x !== t.transaction_id) : [...p, t.transaction_id]))}
                        className="accent-[#EA8500]"
                      />
                      <span className="font-mono">{t.transaction_id}</span>
                      <span className="text-[#6B655B]">{formatMoney(t.amount, t.currency)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={moreInfo} onChange={(e) => setMoreInfo(e.target.checked)} className="accent-[#EA8500]" />
            More information is needed (for example statements or KYC documents)
          </label>

          {touched && problems.length > 0 && (
            <ul role="alert" className="rounded-xl border border-[#FECDD3] bg-[#FFF0F2] p-3 text-sm text-[#881337] list-disc pl-8">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <button type="submit" className="btn-primary">
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
            Review before saving
          </button>
        </form>
      ) : (
        <div className="rounded-xl border-2 border-[#FCD5B5] bg-[#FFFBF6] p-5 space-y-4" role="region" aria-label="Confirm decision">
          <p className="font-semibold">Confirm this decision</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-[#6B655B]">Case</dt>
            <dd className="font-mono font-semibold">{caseId}</dd>
            <dt className="text-[#6B655B]">Account</dt>
            <dd className="font-mono font-semibold">{account.account_id}</dd>
            <dt className="text-[#6B655B]">Decision</dt>
            <dd className="font-semibold">{decisionInfo?.label}</dd>
            <dt className="text-[#6B655B]">Evidence</dt>
            <dd>{evidenceQualityLabel(evidenceQuality)}</dd>
            <dt className="text-[#6B655B]">Reviewer</dt>
            <dd>{reviewer.trim()}</dd>
            <dt className="text-[#6B655B]">Reasoning</dt>
            <dd className="whitespace-pre-wrap">{rationale.trim()}</dd>
            {cited.length > 0 && (
              <>
                <dt className="text-[#6B655B]">Cited transfers</dt>
                <dd className="font-mono">{cited.join(', ')}</dd>
              </>
            )}
            {moreInfo && (
              <>
                <dt className="text-[#6B655B]">Follow-up</dt>
                <dd>More information needed</dd>
              </>
            )}
          </dl>
          <p className="text-xs text-[#6B655B]">
            Saving adds a permanent entry to the case history. It does not freeze, block or notify any account.
          </p>
          {error && <ErrorState title="Decision not saved" message={error} />}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={save} disabled={saving} aria-busy={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save decision'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStep('edit')} disabled={saving}>
              Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const WRITE_ACCESS_TEXT: Record<WriteAccessMode, { tone: string; text: string }> = {
  open_local_development: {
    tone: 'border-[#EAE3D6] bg-[#FAF7F2] text-[#6B655B]',
    text: 'This is a local server with no API key, so anyone who can reach it can record decisions. Reviewer names are typed, not verified.',
  },
  api_key_required: {
    tone: 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]',
    text: 'This server requires an API key for changes. This browser app does not send one, so saving will be refused; use an API client that holds the key. Reviewer names are still typed, not verified.',
  },
  disabled_no_key_configured: {
    tone: 'border-[#FECDD3] bg-[#FFF0F2] text-[#881337]',
    text: 'Changes are disabled on this server because it runs in production mode without an API key.',
  },
};

const WriteAccessNotice: React.FC<{ mode: WriteAccessMode | null }> = ({ mode }) => {
  if (!mode || !WRITE_ACCESS_TEXT[mode]) return null;
  const { tone, text } = WRITE_ACCESS_TEXT[mode];
  return (
    <p data-testid="write-access-notice" className={`mt-3 rounded-xl border p-3 text-xs leading-relaxed ${tone}`}>
      {text}
    </p>
  );
};

export const ReviewHistorySection: React.FC<Props> = ({ data, selectedAccountId, onSelectAccount, onRecorded }) => {
  const [historyKey, setHistoryKey] = useState(0);
  const [saved, setSaved] = useState<{ accountId: string; state: string } | null>(null);
  const reviewable = sortedAccounts(data).filter((a) => a.graph_position.role !== 'reporting_victim');
  const selected = reviewable.find((a) => a.account_id === selectedAccountId) ?? null;

  useEffect(() => {
    if (saved && saved.accountId !== selectedAccountId) setSaved(null);
  }, [selectedAccountId, saved]);

  const [writeAccess, setWriteAccess] = useState<WriteAccessMode | null>(null);
  useEffect(() => {
    let active = true;
    api
      .getHealth()
      .then((h) => active && setWriteAccess(h.write_access ?? null))
      .catch(() => active && setWriteAccess(null));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#EAE3D6] bg-white p-5 sm:p-6" aria-labelledby="review-heading">
        <h2 id="review-heading" className="font-display text-lg font-bold">Record a review decision</h2>
        <p className="mt-1 text-sm text-[#6B655B]">
          Decisions are yours. FraudShield records them with your reasoning; it never decides or acts on its own.
        </p>
        <WriteAccessNotice mode={writeAccess} />

        {!data.assessments ? (
          <div className="mt-4">
            <ErrorState title="Accounts unavailable" message={data.assessmentsError ?? 'Account details could not be loaded.'} />
          </div>
        ) : reviewable.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No accounts to review" message="No connected accounts are recorded for this case." />
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <label className="block text-sm max-w-md">
              <span className="font-semibold">Account</span>
              <select
                value={selected?.account_id ?? ''}
                onChange={(e) => onSelectAccount(e.target.value || null)}
                className="mt-1.5 w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2.5 text-sm font-mono"
              >
                <option value="">Choose an account…</option>
                {reviewable.map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.account_id} — {roleLabel(a.graph_position.role)}
                    {isRecordedDecision(a.review_status.reviewer_id) ? ` (${REVIEW_STATE_LABELS[a.review_status.review_state]})` : ''}
                  </option>
                ))}
              </select>
            </label>

            {saved && selected && saved.accountId === selected.account_id && (
              <div role="status" className="rounded-xl border border-[#BBF7D0] bg-[#EAF7EE] p-4 text-sm text-[#166534] flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>
                  Saved. The server recorded <span className="font-semibold">{REVIEW_STATE_LABELS[saved.state] ?? saved.state}</span> for{' '}
                  <span className="font-mono font-semibold">{saved.accountId}</span>. It now appears in the case history below.
                </span>
              </div>
            )}

            {selected ? (
              <>
                <div className="flex items-center gap-2">
                  <ReviewStatePill a={selected} />
                </div>
                <ReviewForm
                  key={`${selected.account_id}-${historyKey}`}
                  caseId={data.caseData.case_id}
                  account={selected}
                  onRecorded={async (rev) => {
                    setSaved({ accountId: rev.account_id, state: rev.review_state });
                    await onRecorded();
                    setHistoryKey((k) => k + 1);
                  }}
                />
              </>
            ) : (
              <p className="text-sm text-[#6B655B]">Choose an account to see its evidence and record a decision.</p>
            )}
          </div>
        )}
      </section>

      <CaseStatusPanel
        caseData={data.caseData}
        onChanged={async () => {
          await onRecorded();
          setHistoryKey((k) => k + 1);
        }}
      />

      <CaseHistory
        caseId={data.caseData.case_id}
        refreshKey={historyKey}
        caseAccountIds={data.assessments ? data.assessments.assessments.map((x) => x.account_id) : undefined}
      />
    </div>
  );
};
