import React from 'react';
import { CheckCircle2, HelpCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { channelLabel, formatDateTime, formatMoney, roleLabel } from '../../lib/format';
import { ErrorState, Pill } from '../ui/StateViews';
import {
  CaseSection,
  CaseWorkspaceData,
  openQuestions,
  originTransaction,
  recordedDecisionCount,
  sortedAccounts,
  stepsFromReporter,
} from './caseModel';

interface Props {
  data: CaseWorkspaceData;
  onNavigate: (section: CaseSection, accountId?: string | null) => void;
}

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-xs text-[#5C6079]">{label}</dt>
    <dd className="mt-0.5 text-sm font-semibold text-[#141526] break-words">{children}</dd>
  </div>
);

export const CaseSummarySection: React.FC<Props> = ({ data, onNavigate }) => {
  const c = data.caseData;
  const origin = originTransaction(data.trace);
  const accounts = sortedAccounts(data);
  const downstream = accounts.filter((a) => stepsFromReporter(a) > 0);
  const maxSteps = accounts.reduce((m, a) => Math.max(m, stepsFromReporter(a)), 0);
  const amountMatches = origin ? Math.abs(origin.amount - c.reported_amount) < 0.5 : null;
  const decisions = recordedDecisionCount(data);
  const reviewable = accounts.filter((a) => a.graph_position.role !== 'reporting_victim').length;

  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6 min-w-0">
        <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5 sm:p-6" aria-labelledby="reported-heading">
          <h2 id="reported-heading" className="font-display text-lg font-bold">What was reported</h2>
          <p className="mt-2 text-sm text-[#141526] leading-relaxed">{c.description}</p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#E4E5F0] bg-[#F6F6FC] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#868AA2]">The complaint says</p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <Fact label="Amount">{formatMoney(c.reported_amount, c.currency)}</Fact>
                <Fact label="Reported on">{formatDateTime(c.reported_at)}</Fact>
                <Fact label="Disputed transfer">
                  <span className="font-mono">{c.reported_origin_transaction_id}</span>
                </Fact>
              </dl>
              <p className="mt-3 text-xs text-[#5C6079]">A claim by the customer. Not verified by itself.</p>
            </div>
            <div className="rounded-xl border border-[#E4E5F0] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#868AA2]">The transaction records show</p>
              {origin ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <Fact label="Amount">{formatMoney(origin.amount, origin.currency)}</Fact>
                    <Fact label="Sent on">{formatDateTime(origin.timestamp)}</Fact>
                    <Fact label="Method">{channelLabel(origin.transaction_type)}</Fact>
                    <Fact label="From → to">
                      <span className="font-mono">
                        {origin.sender_account_id} → {origin.receiver_account_id}
                      </span>
                    </Fact>
                  </dl>
                  <p className="mt-3 flex items-center gap-1.5 text-xs">
                    {amountMatches ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#166534]" aria-hidden="true" />
                        <span className="text-[#166534] font-medium">Recorded amount matches the complaint.</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-[#4F33D6]" aria-hidden="true" />
                        <span className="text-[#4F33D6] font-medium">Recorded amount differs from the complaint.</span>
                      </>
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-[#5C6079]">
                  {data.traceError ?? 'The disputed transfer was not found in the transaction records.'}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5 sm:p-6" aria-labelledby="found-heading">
          <h2 id="found-heading" className="font-display text-lg font-bold">What the records show so far</h2>
          {data.trace ? (
            <>
              <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Fact label="Accounts that received money">{downstream.length}</Fact>
                <Fact label="Recorded transfers">{data.trace.summary.traced_transaction_count ?? '—'}</Fact>
                <Fact label="Furthest step from customer">{maxSteps}</Fact>
                <Fact label="Total recorded movement">
                  {formatMoney(data.trace.summary.gross_observed_transaction_value, c.currency)}
                </Fact>
              </dl>
              <p className="mt-4 text-xs text-[#5C6079] leading-relaxed">
                Total recorded movement adds up every transfer, so the same money is counted again at each step. It is
                not the amount lost; the reported loss is {formatMoney(c.reported_amount, c.currency)}.
              </p>
            </>
          ) : (
            <div className="mt-3">
              <ErrorState title="Money flow unavailable" message={data.traceError ?? 'The trace could not be computed.'} />
            </div>
          )}
          {accounts.length > 0 && (
            <ul className="mt-5 divide-y divide-[#E4E5F0] border-t border-[#E4E5F0]">
              {accounts.map((a) => (
                <li key={a.account_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold">{a.account_id}</span>
                    <span className="text-[#5C6079]">{roleLabel(a.graph_position.role)}</span>
                  </span>
                  <span className="text-xs text-[#5C6079]">
                    {stepsFromReporter(a) === 0 ? 'Starting point' : `Step ${stepsFromReporter(a)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-6">
        <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5" aria-labelledby="unknown-heading">
          <h2 id="unknown-heading" className="font-semibold flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[#6246EA]" aria-hidden="true" />
            Still unknown
          </h2>
          <ul className="mt-3 space-y-2.5 text-sm text-[#5C6079] leading-relaxed list-disc pl-5">
            {openQuestions(data).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5" aria-labelledby="progress-heading">
          <h2 id="progress-heading" className="font-semibold">Review progress</h2>
          <p className="mt-2 text-sm text-[#5C6079]">
            {decisions === 0
              ? `No review decisions recorded yet. ${reviewable} account${reviewable === 1 ? '' : 's'} can be reviewed.`
              : `${decisions} decision${decisions === 1 ? '' : 's'} recorded so far.`}
          </p>
          {data.caseData.dataset_note && (
            <p className="mt-3 text-xs text-[#5C6079] leading-relaxed">
              <Pill className="mr-1.5">Data source</Pill>
              {data.caseData.dataset_note}
            </p>
          )}
          <button type="button" className="btn-primary w-full mt-4" onClick={() => onNavigate('money-flow')}>
            Trace the money
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </section>
      </aside>
    </div>
  );
};
