import React from 'react';
import { ArrowRight, Eye, ListChecks } from 'lucide-react';
import { AccountAssessmentResponse } from '../../types/api';
import {
  REVIEW_STATE_LABELS,
  ROLE_LABELS,
  channelLabel,
  formatDateTime,
  formatMoney,
  isRecordedDecision,
  minutesBetween,
  roleLabel,
} from '../../lib/format';
import { EmptyState, ErrorState, Pill, reviewStateTone } from '../ui/StateViews';
import { AccountModelPanel } from './AccountModelPanel';
import { CaseSection, CaseWorkspaceData, caseTransactions, sortedAccounts, stepsFromReporter, usesAccountLedger } from './caseModel';

interface Props {
  data: CaseWorkspaceData;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  onNavigate: (section: CaseSection, accountId?: string | null) => void;
}

export const ReviewStatePill: React.FC<{ a: AccountAssessmentResponse }> = ({ a }) => {
  const state = a.review_status.review_state;
  if (state === 'reporting_victim') return <Pill tone="blue">Reporting customer</Pill>;
  if (!isRecordedDecision(a.review_status.reviewer_id)) {
    return <Pill title={`Starting state: ${REVIEW_STATE_LABELS[state] ?? state}`}>No decision yet</Pill>;
  }
  return <Pill tone={reviewStateTone(state)}>{REVIEW_STATE_LABELS[state] ?? state}</Pill>;
};

const AccountDetail: React.FC<{ a: AccountAssessmentResponse; data: CaseWorkspaceData; onNavigate: Props['onNavigate'] }> = ({
  a,
  data,
  onNavigate,
}) => {
  const c = data.caseData;
  const isReporter = a.graph_position.role === 'reporting_victim';
  const txns = caseTransactions(a);
  const firstInbound = a.observed_movement.traced_inbound_transactions[0];
  const ev = a.evidence_assessment;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-xl font-bold">{a.account_id}</h2>
          <p className="text-sm text-[#5C6079]">
            {roleLabel(a.graph_position.role)}
            {!isReporter && ` · hop ${stepsFromReporter(a)}`} — {ROLE_LABELS[a.graph_position.role]?.help}
          </p>
        </div>
        <ReviewStatePill a={a} />
      </div>

      <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5" aria-labelledby="facts-heading">
        <h3 id="facts-heading" className="font-semibold flex items-center gap-2">
          <Eye className="w-4 h-4 text-[#6246EA]" aria-hidden="true" />
          What the case records show
        </h3>
        <p className="mt-1 text-xs text-[#5C6079]">Recorded transfers only. No interpretation.</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-[#F6F6FC] p-3">
            <dt className="text-xs text-[#5C6079]">Received in this case</dt>
            <dd className="font-bold">{formatMoney(a.observed_movement.observed_inbound_value, c.currency)}</dd>
          </div>
          <div className="rounded-xl bg-[#F6F6FC] p-3">
            <dt className="text-xs text-[#5C6079]">Sent on in this case</dt>
            <dd className="font-bold">{formatMoney(a.observed_movement.observed_outbound_value, c.currency)}</dd>
          </div>
        </dl>
        {txns.length === 0 ? (
          <p className="mt-4 text-sm text-[#5C6079]">No case transfers are recorded for this account.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Transfers involving {a.account_id}</caption>
              <thead>
                <tr className="text-left text-xs text-[#5C6079] border-b border-[#E4E5F0]">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Direction</th>
                  <th className="py-2 pr-3 font-medium">Counterparty</th>
                  <th className="py-2 pr-3 font-medium">Method</th>
                  <th className="py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => {
                  const inbound = t.receiver_account_id === a.account_id;
                  const gap = !inbound && firstInbound ? minutesBetween(firstInbound.timestamp, t.timestamp) : null;
                  return (
                    <tr key={t.transaction_id} className="border-b border-[#EEEFF7] last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDateTime(t.timestamp)}
                        {gap !== null && <span className="block text-xs text-[#868AA2]">{gap} min after receiving</span>}
                      </td>
                      <td className="py-2 pr-3">{inbound ? 'Received' : 'Sent'}</td>
                      <td className="py-2 pr-3 font-mono">{inbound ? t.sender_account_id : t.receiver_account_id}</td>
                      <td className="py-2 pr-3">{channelLabel(t.transaction_type)}</td>
                      <td className="py-2 text-right font-semibold whitespace-nowrap">
                        {inbound ? '+' : '−'}
                        {formatMoney(t.amount, t.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {a.observed_signals.length > 0 && (
        <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5" aria-labelledby="signals-heading">
          <h3 id="signals-heading" className="font-semibold">Patterns noticed in these transfers</h3>
          <p className="mt-1 text-xs text-[#5C6079]">
            Rule-based observations about timing and structure. They have innocent explanations too.
          </p>
          <ul className="mt-3 space-y-3">
            {a.observed_signals.map((s) => (
              <li key={s.code} className="rounded-xl border border-[#E4E5F0] p-3.5 text-sm">
                <p className="font-semibold">{s.title}</p>
                <p className="mt-0.5 text-[#141526]">{s.description}</p>
                <p className="mt-1.5 text-xs text-[#5C6079]">{s.interpretation_note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5" aria-labelledby="auto-heading">
        <h3 id="auto-heading" className="font-semibold">Automated risk checks</h3>
        <p className="mt-1 text-xs text-[#5C6079] mb-4">
          Generated by software from the account’s behaviour. Treat them as prompts for review, separate from the facts above.
        </p>
        {usesAccountLedger(c) ? (
          <AccountModelPanel accountId={a.account_id} isReportingCustomer={isReporter} />
        ) : (
          <div className="rounded-xl border border-dashed border-[#D5D7E6] bg-[#F6F6FC] p-4 text-sm text-[#5C6079] leading-relaxed">
            <p className="font-semibold text-[#141526]">No automated account assessment for this case</p>
            <p className="mt-1">
              {a.account_id} exists only in this case’s own records. It has no history in the synthetic account ledger that
              the account model was trained on, so applying the model here would produce a meaningless score. Only the
              transfer facts and patterns above are available.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5" aria-labelledby="gaps-heading">
        <h3 id="gaps-heading" className="font-semibold flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-[#6246EA]" aria-hidden="true" />
          Missing evidence and next checks
        </h3>
        {ev.evidence_gaps.length > 0 && (
          <ul className="mt-3 list-disc pl-5 space-y-1.5 text-sm text-[#141526]">
            {ev.evidence_gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
        {ev.verification_guidance.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[#868AA2]">Suggested checks</p>
            <ul className="mt-2 list-disc pl-5 space-y-1.5 text-sm text-[#5C6079]">
              {ev.verification_guidance.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </>
        )}
        {!isReporter && (
          <button type="button" className="btn-primary mt-5" onClick={() => onNavigate('review', a.account_id)}>
            Record a decision for {a.account_id}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </section>
    </div>
  );
};

export const AccountsRiskSection: React.FC<Props> = ({ data, selectedAccountId, onSelectAccount, onNavigate }) => {
  if (!data.assessments) {
    return <ErrorState title="Account details unavailable" message={data.assessmentsError ?? 'Account assessments could not be loaded.'} />;
  }
  const accounts = sortedAccounts(data);
  if (accounts.length === 0) {
    return <EmptyState title="No connected accounts" message="No accounts are connected to this case in the transaction records." />;
  }
  const selected =
    accounts.find((a) => a.account_id === selectedAccountId) ??
    accounts.find((a) => a.graph_position.role !== 'reporting_victim') ??
    accounts[0];
  const unknownSelection = selectedAccountId && !accounts.some((a) => a.account_id === selectedAccountId);

  return (
    <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <nav aria-label="Accounts in this case" className="min-w-0 space-y-2 lg:sticky lg:top-36 h-fit">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#868AA2] px-1">Accounts in this case</p>
        <ul className="flex lg:flex-col gap-2 overflow-x-auto pb-1 lg:pb-0">
          {accounts.map((a) => {
            const active = a.account_id === selected.account_id;
            return (
              <li key={a.account_id} className="shrink-0 w-56 lg:w-auto">
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelectAccount(a.account_id)}
                  className={`w-full text-left rounded-xl border p-3 transition-all cursor-pointer ${
                    active ? 'border-[#6246EA] bg-[#FAFAFE] shadow-[0_0_0_3px_rgba(98, 70, 234,0.12)]' : 'border-[#E4E5F0] bg-white hover:border-[#6246EA]/50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">{a.account_id}</span>
                    <span className="text-xs text-[#868AA2]">{stepsFromReporter(a) === 0 ? 'Start' : `Hop ${stepsFromReporter(a)}`}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[#5C6079]">{roleLabel(a.graph_position.role)}</span>
                  <span className="mt-2 flex items-center justify-between gap-2">
                    <ReviewStatePill a={a} />
                    {a.observed_signals.length > 0 && (
                      <span className="text-xs text-[#4F33D6] font-medium">
                        {a.observed_signals.length} pattern{a.observed_signals.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 space-y-3">
        {unknownSelection && (
          <p role="alert" className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm text-[#92400E]">
            Account {selectedAccountId} is not part of this case. Showing {selected.account_id} instead.
          </p>
        )}
        <AccountDetail key={selected.account_id} a={selected} data={data} onNavigate={onNavigate} />
      </div>
    </div>
  );
};
