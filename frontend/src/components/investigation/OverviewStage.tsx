import React, { useMemo } from 'react';
import { ArrowRight, Database } from 'lucide-react';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { InvestigationResponse } from '../../types/investigation';
import { FLAG_LABEL } from './labels';
import { whatHappened } from './narrative';
import { useCase } from './caseModel';
import { Disclosure, IdText, Ref, StageHeading } from './ui';

const Fact: React.FC<{ label: string; value: React.ReactNode; note?: string }> = ({ label, value, note }) => (
  <div className="py-2.5 border-b border-line last:border-0 flex items-baseline justify-between gap-4">
    <dt className="text-sm text-mute">{label}</dt>
    <dd className="text-right">
      <span className="text-sm font-semibold text-ink">{value}</span>
      {note && <span className="block text-[11px] text-faint">{note}</span>}
    </dd>
  </div>
);

export const OverviewStage: React.FC<{ onFollow: () => void }> = ({ onFollow }) => {
  const { report, trail } = useCase();
  const v = report.victim;
  const story = useMemo(() => whatHappened(report, trail), [report, trail]);
  const out = trail.branches.filter((b) => b.direction === 'downstream').length;
  const inn = trail.branches.filter((b) => b.direction === 'upstream').length;

  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <section aria-labelledby="happened-h" className="panel p-6 sm:p-7">
          <h2 id="happened-h" className="font-display text-2xl font-bold text-ink">What happened</h2>
          <div className="mt-4 space-y-3 text-[17px] leading-[1.65] text-ink-soft max-w-[68ch]" data-testid="what-happened">
            {story.map((s) => (
              <p key={s}>{s}</p>
            ))}
          </div>
          <p className="mt-4 text-xs text-faint">Written from the ledger records by fixed rules, not by AI.</p>
          {trail.branches.length > 0 && (
            <button type="button" className="btn-primary mt-6" onClick={onFollow}>
              Follow the money, transfer by transfer
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </section>

        <aside aria-label="Case at a glance" className="panel p-5">
          <h3 className="text-sm font-semibold text-ink">Case at a glance</h3>
          <dl className="mt-2">
            <Fact label="Linked accounts" value={report.trace.nodes.length - 1} note={`${report.accounts.filter((a) => a.analyzed).length} accounts assessed, including this one`} />
            <Fact label="Transfers traced" value={report.trace.edges.length} />
            <Fact label="Branches" value={`${out} out, ${inn} in`} />
            <Fact label="Furthest hop reached" value={report.trace.max_depth_reached} note={`Limit ${report.request.max_depth}`} />
            <Fact label="Cycles" value={report.trace.cycles_detected} />
            <Fact label="Ledger rows read" value={report.ledger_rows_read.toLocaleString('en-IN')} />
          </dl>
        </aside>
      </div>

      <section aria-labelledby="start-h" className="space-y-4">
        <StageHeading
          title="Where the trace starts"
          lead="The transfers below are where the money trail begins. A flag means a transfer is unusual against this account’s own history; it is a reason to look, not a confirmed fraudulent event."
        />
        <p className="text-sm text-mute">{report.trace.seed_selection}</p>
        {v.flagged_transfers.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {v.flagged_transfers.map((t) => (
              <li key={t.transaction_id} className="panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl font-bold text-ink">{formatMoney(t.amount, t.currency)}</p>
                    <p className="mt-1 text-sm text-mute">
                      {t.origin_account_id === v.account_id ? 'Sent to ' : 'Received from '}
                      <Ref id={t.origin_account_id === v.account_id ? t.destination_account_id : t.origin_account_id} /> by {channelLabel(t.channel)}
                    </p>
                    <p className="text-xs text-faint mt-0.5">{formatDateTime(t.timestamp)}</p>
                  </div>
                  <Ref id={t.transaction_id} />
                </div>
                <ul className="mt-4 space-y-2">
                  {t.flags.map((f) => (
                    <li key={f.code} className="rounded-xl bg-iris-soft/60 ring-1 ring-iris-line px-3 py-2 text-sm">
                      <span className="font-semibold text-iris-deep">{FLAG_LABEL[f.code] ?? f.code}</span>
                      <span className="block text-ink-soft">{f.explanation}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-quiet px-4 py-3 text-sm text-mute">No transfer was flagged as unusual for this account in the selected period.</p>
        )}
      </section>

      <section aria-labelledby="context-h" className="grid gap-5 lg:grid-cols-2 items-start">
        <div className="panel p-5">
          <h3 id="context-h" className="text-sm font-semibold text-ink">
            Account context for <IdText>{v.account_id}</IdText>
          </h3>
          <p className="mt-0.5 text-xs text-mute">
            {v.customer_name}, {v.customer_type}, {v.kyc_tier.replace(/_/g, ' ')}, {v.account_status}. Opened {formatDateTime(v.account_opened_at)}.
          </p>
          <dl className="mt-3">
            <Fact label="Money in during the period" value={formatMoney(v.incoming_total)} note={`${v.incoming_count} transfers`} />
            <Fact label="Money out during the period" value={formatMoney(v.outgoing_total)} note={`${v.outgoing_count} transfers`} />
            <Fact label="Typical outgoing transfer" value={v.median_outgoing_amount === null ? 'Unknown' : formatMoney(v.median_outgoing_amount)} note="Median" />
            <Fact
              label="Largest earlier outgoing"
              value={v.largest_earlier_outgoing_before_first_flag === null ? 'Unknown' : formatMoney(v.largest_earlier_outgoing_before_first_flag)}
              note="Before the first flagged transfer"
            />
            <Fact label="Current balance" value={formatMoney(v.current_balance)} />
            <Fact label="Activity" value={`${formatDateTime(v.first_transaction_at)} to ${formatDateTime(v.last_transaction_at)}`} note={`${v.transactions_all_time} transfers on record`} />
          </dl>
          <Disclosure summary="Largest senders and recipients in the period" className="mt-4">
            <Counterparties report={report} />
          </Disclosure>
        </div>
        <DataSourceCard report={report} />
      </section>
    </div>
  );
};

const Counterparties: React.FC<{ report: InvestigationResponse }> = ({ report }) => {
  const v = report.victim;
  return (
    <div className="grid gap-4 sm:grid-cols-2 text-sm">
      {[
        ['Senders', v.top_senders],
        ['Recipients', v.top_recipients],
      ].map(([title, rows]) => (
        <div key={title as string}>
          <p className="text-xs font-semibold text-mute">{title as string}</p>
          {(rows as typeof v.top_senders).length ? (
            <ul className="mt-1 divide-y divide-line">
              {(rows as typeof v.top_senders).map((c) => (
                <li key={c.account_id} className="flex items-center justify-between gap-2 py-1.5">
                  <Ref id={c.account_id} />
                  <span className="text-xs text-mute">
                    {c.transfers} transfer{c.transfers === 1 ? '' : 's'}, <span className="font-semibold text-ink">{formatMoney(c.total_amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-faint">None in the period.</p>
          )}
        </div>
      ))}
    </div>
  );
};

export const DataSourceCard: React.FC<{ report: InvestigationResponse }> = ({ report }) => {
  const s = report.data_source;
  return (
    <div className="panel p-5 text-sm" data-testid="data-source">
      <h3 className="font-semibold text-ink flex items-center gap-2">
        <Database className="w-4 h-4 text-faint" aria-hidden="true" /> Data source
      </h3>
      <dl className="mt-2">
        <Fact label="Source" value={s.source_name} />
        <Fact label="Real bank data" value={s.real_bank_data ? `Yes (authorization ${s.authorization_reference})` : 'No'} />
        <Fact label="Data as of" value={formatDateTime(s.data_as_of)} />
        <Fact label="Ledger" value={`${s.accounts_count.toLocaleString('en-IN')} accounts`} note={`${s.transactions_count.toLocaleString('en-IN')} transactions`} />
        <Fact label="Queried" value={formatDateTime(s.queried_at)} />
        <Fact label="Snapshot built" value={formatDateTime(s.snapshot_built_at)} />
      </dl>
      <p className="mt-3 text-xs text-mute leading-relaxed">{s.freshness_note}</p>
    </div>
  );
};

export default OverviewStage;
