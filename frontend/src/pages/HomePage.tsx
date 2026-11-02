import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CircleCheck,
  Cpu,
  Database,
  FolderOpen,
  Gavel,
  HandCoins,
  ScanSearch,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { AccountEntry } from '../components/investigation/InvestigationForm';
import { STAGES } from '../components/investigation/CaseView';
import { Stat } from '../components/ui/Stat';
import { FlowMotif } from '../components/ui/FlowMotif';
import { SectionHeader } from '../components/ui/PageHeader';
import { Pill, SkeletonBlock, caseStatusTone } from '../components/ui/StateViews';
import { CASE_STATUS_LABELS, auditActionLabel, formatDateTime, formatMoney, formatServerTime } from '../lib/format';
import { useModelStatus } from '../lib/useModelStatus';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';
import { DataSourceInfo } from '../types/investigation';
import { DatasetSummary } from '../types/dynamic';
import { FraudCase, GlobalAuditResponse } from '../types/api';
import { InvestigationModelInfo } from '../types/v2';
import { nextActionFor } from './InvestigationsPage';
import { retryRead } from '../lib/retry';

export const SAMPLE_CASE_ID = 'FS-2001';

type Part<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed' };

/** Everything the overview shows, each part loaded independently so one slow or failed request hides nothing else. */
function useOverview() {
  const [source, setSource] = useState<Part<DataSourceInfo>>({ state: 'loading' });
  const [datasets, setDatasets] = useState<Part<DatasetSummary[]>>({ state: 'loading' });
  const [cases, setCases] = useState<Part<FraudCase[]>>({ state: 'loading' });
  const [audit, setAudit] = useState<Part<GlobalAuditResponse>>({ state: 'loading' });

  useEffect(() => {
    const c = new AbortController();
    const settle = <T,>(p: Promise<T>, set: (x: Part<T>) => void) =>
      p.then((value) => !c.signal.aborted && set({ state: 'ready', value })).catch(() => !c.signal.aborted && set({ state: 'failed' }));
    // Idempotent reads: one quiet retry if the connection drops before an answer arrives.
    settle(retryRead(() => v2Api.getDataSource(c.signal), c.signal), setSource);
    settle(retryRead(() => v2Api.listDatasets(c.signal), c.signal), setDatasets);
    settle(retryRead(() => api.getCases(0, 100), c.signal).then((r) => r.cases), setCases);
    settle(retryRead(() => api.getGlobalAudit({ limit: 6, sort_order: 'desc' }), c.signal), setAudit);
    return () => c.abort();
  }, []);

  return { source, datasets, cases, audit };
}

const SUPPORT_LABEL: Record<string, { text: string; tone: 'green' | 'amber' }> = {
  validated_in_distribution: { text: 'Models validated here', tone: 'green' },
  unsupported_distribution_shift: { text: 'Models reference only', tone: 'amber' },
  unsupported_not_checked: { text: 'Models not validated', tone: 'amber' },
};

const PRINCIPLES = [
  { icon: HandCoins, title: 'Receiving money is not wrongdoing.', text: 'Accounts downstream of a complaint may belong to people who did nothing wrong.' },
  { icon: Cpu, title: 'A high score is not proof.', text: 'The account model was trained and tested only on synthetic data, and it misses cases.' },
  { icon: Gavel, title: 'Nothing happens automatically.', text: 'No account is frozen or flagged without a person recording a decision.' },
];

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

const PanelHeading: React.FC<{ icon: typeof Database; title: string; id: string; action?: React.ReactNode }> = ({ icon: Icon, title, id, action }) => (
  <div className="flex items-center justify-between gap-3">
    <h2 id={id} className="flex items-center gap-2.5 card-title">
      <span className="w-7 h-7 rounded-lg bg-iris-wash ring-1 ring-iris-line flex items-center justify-center" aria-hidden="true">
        <Icon className="w-4 h-4 text-iris" />
      </span>
      {title}
    </h2>
    {action}
  </div>
);

const Ledgers: React.FC<{ source: Part<DataSourceInfo>; datasets: Part<DatasetSummary[]> }> = ({ source, datasets }) => (
  <section aria-labelledby="ledger-h" className="panel panel-sheen p-5 sm:p-6 flex flex-col">
    <PanelHeading icon={Database} title="Ledgers" id="ledger-h" />
    {datasets.state === 'ready' ? (
      <ul className="mt-4 divide-y divide-line">
        {datasets.value.map((d) => {
          const support = d.model_support ? SUPPORT_LABEL[d.model_support] : null;
          return (
            <li key={d.dataset_id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-ink">{d.title}</p>
                {support && (
                  <Pill tone={support.tone} title={d.model_note}>
                    {support.text}
                  </Pill>
                )}
              </div>
              {d.source ? (
                <p className="mt-1 text-[13px] text-mute">
                  <span className="font-semibold text-ink">{d.source.accounts_count.toLocaleString('en-IN')}</span> accounts,{' '}
                  <span className="font-semibold text-ink">{d.source.transactions_count.toLocaleString('en-IN')}</span> transfers
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-mute">{d.available ? 'Available' : d.unavailable_reason ?? 'Not available on this server'}</p>
              )}
            </li>
          );
        })}
      </ul>
    ) : datasets.state === 'failed' ? (
      <p className="mt-4 text-sm text-mute">The server could not be reached. The free server sleeps when idle; it can take about a minute to wake.</p>
    ) : (
      <div className="mt-4 space-y-4" role="status" aria-label="Loading ledgers">
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
      </div>
    )}
    {source.state === 'ready' && (
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-well ring-1 ring-line p-4 text-[13px]">
        <div>
          <dt className="text-mute">Demo ledger data as of</dt>
          <dd className="mt-0.5 font-semibold text-ink">{formatDateTime(source.value.data_as_of)}</dd>
        </div>
        <div>
          <dt className="text-mute">Snapshot built</dt>
          <dd className="mt-0.5 font-semibold text-ink">{formatDateTime(source.value.snapshot_built_at)}</dd>
        </div>
        <div>
          <dt className="text-mute">Real bank data</dt>
          <dd className="mt-0.5 font-semibold text-ink">{source.value.real_bank_data ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-mute">Storage</dt>
          <dd className="mt-0.5 font-semibold text-ink">{source.value.database_backend === 'sqlite' ? 'SQLite snapshot' : source.value.database_backend}</dd>
        </div>
      </dl>
    )}
    <p className="mt-auto pt-4 text-xs text-mute leading-relaxed">
      {source.state === 'ready' && source.value.is_synthetic === false
        ? source.value.disclosure
        : 'Investigations run on a synthetic account ledger. No real customers or bank records are involved.'}
    </p>
  </section>
);

const KeyFigures: React.FC<{ cases: Part<FraudCase[]>; audit: Part<GlobalAuditResponse> }> = ({ cases, audit }) => {
  const list = cases.state === 'ready' ? cases.value : [];
  const open = list.filter((c) => c.investigation_status !== 'closed');
  const investigating = list.filter((c) => c.investigation_status === 'under_investigation').length;
  const currencies = new Set(open.map((c) => c.currency));
  const reported = open.reduce((sum, c) => sum + c.reported_amount, 0);
  const summary = audit.state === 'ready' ? audit.value.summary : null;
  const casesLoading = cases.state === 'loading';
  const auditLoading = audit.state === 'loading';
  const unavailable = 'Unavailable';

  return (
    <section aria-label="Key figures" data-reveal className="panel">
      <dl className="grid grid-cols-2 lg:grid-cols-4 [&>*]:p-5 sm:[&>*]:p-6 [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b lg:[&>*]:!border-b-0 lg:[&>*:not(:last-child)]:border-r border-line [&>*]:border-line">
        <Stat
          icon={FolderOpen}
          tone="iris"
          label="Open cases"
          loading={casesLoading}
          value={cases.state === 'failed' ? unavailable : open.length}
          note={cases.state === 'ready' ? `${investigating} under investigation` : undefined}
        />
        <Stat
          icon={HandCoins}
          tone="ice"
          label="Reported in open cases"
          loading={casesLoading}
          value={cases.state === 'failed' ? unavailable : currencies.size > 1 ? 'Mixed currencies' : formatMoney(reported, open[0]?.currency)}
          note={cases.state === 'ready' ? `As reported by the complainants, ${open.length} case${open.length === 1 ? '' : 's'}` : undefined}
        />
        <Stat
          icon={Gavel}
          label="Review decisions recorded"
          loading={auditLoading}
          value={audit.state === 'failed' ? unavailable : summary?.review_decisions_count ?? 0}
          note={summary ? 'Made by people; nothing is decided automatically' : undefined}
        />
        <Stat
          icon={ScrollText}
          label="Audit events"
          loading={auditLoading}
          value={audit.state === 'failed' ? unavailable : summary?.total_events ?? 0}
          note={summary?.most_recent_timestamp ? `Latest ${formatServerTime(summary.most_recent_timestamp)}` : undefined}
        />
      </dl>
    </section>
  );
};

const CasesPanel: React.FC<{ cases: Part<FraudCase[]> }> = ({ cases }) => (
  <section aria-labelledby="cases-h" className="panel p-5 sm:p-6 min-w-0" data-reveal>
    <PanelHeading
      icon={FolderOpen}
      title="Cases"
      id="cases-h"
      action={
        <Link to="/cases" className="inline-flex items-center gap-1 text-sm font-semibold text-iris-deep hover:text-iris">
          Open investigations <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      }
    />
    {cases.state === 'ready' && cases.value.length > 0 ? (
      <div className="mt-4 -mx-5 sm:-mx-6 overflow-x-auto">
        <table className="data-table min-w-[520px]">
          <thead>
            <tr>
              <th scope="col" className="!pl-5 sm:!pl-6">Case</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right !pr-5 sm:!pr-6">Reported</th>
            </tr>
          </thead>
          <tbody>
            {cases.value.slice(0, 6).map((c) => {
              const next = nextActionFor(c);
              return (
                <tr key={c.case_id}>
                  <td className="!pl-5 sm:!pl-6">
                    <Link to={`/cases/${encodeURIComponent(c.case_id)}?section=${next.section}`} className="group inline-flex flex-col">
                      <span className="font-mono text-[13px] font-semibold text-ink group-hover:text-iris-deep">{c.case_id}</span>
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-iris-deep">
                        {next.label}
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                    </Link>
                  </td>
                  <td>
                    <Pill tone={caseStatusTone(c.investigation_status)}>{CASE_STATUS_LABELS[c.investigation_status] ?? c.investigation_status}</Pill>
                  </td>
                  <td className="text-right whitespace-nowrap !pr-5 sm:!pr-6">
                    <span className="font-semibold text-ink">{formatMoney(c.reported_amount, c.currency)}</span>
                    <span className="block text-xs text-faint">{formatDateTime(c.reported_at)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : cases.state === 'ready' ? (
      <p className="mt-4 text-sm text-mute">No cases are stored on the server.</p>
    ) : cases.state === 'failed' ? (
      <p className="mt-4 text-sm text-mute">Cases could not be loaded. The free server can take about a minute to wake.</p>
    ) : (
      <div className="mt-4 space-y-3" role="status" aria-label="Loading cases">
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
      </div>
    )}
  </section>
);

const ActivityPanel: React.FC<{ audit: Part<GlobalAuditResponse> }> = ({ audit }) => (
  <section aria-labelledby="activity-h" className="panel p-5 sm:p-6 flex flex-col min-w-0" data-reveal>
    <PanelHeading
      icon={Activity}
      title="Recent activity"
      id="activity-h"
      action={
        <Link to="/tools/audit" className="text-sm font-semibold text-iris-deep hover:text-iris">
          Audit log
        </Link>
      }
    />
    {audit.state === 'ready' && audit.value.events.length > 0 ? (
      <ol className="mt-4 relative space-y-4 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-line">
        {audit.value.events.slice(0, 5).map((e, i) => (
          <li key={e.event_id ?? `${e.timestamp}-${i}`} className="relative pl-6">
            <span className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full bg-white ring-1 ring-line-strong flex items-center justify-center" aria-hidden="true">
              <span className="w-[5px] h-[5px] rounded-full bg-iris" />
            </span>
            <p className="text-sm font-semibold text-ink">{auditActionLabel(e.action)}</p>
            <p className="text-xs text-mute">
              <span className="font-mono">{e.case_id}</span>, {formatServerTime(e.timestamp)}
            </p>
            <p className="text-xs text-faint">By {e.performed_by === 'system_seeder' ? 'the system (demo setup)' : e.performed_by}</p>
          </li>
        ))}
      </ol>
    ) : audit.state === 'ready' ? (
      <p className="mt-4 text-sm text-mute">No events are recorded yet.</p>
    ) : audit.state === 'failed' ? (
      <p className="mt-4 text-sm text-mute">The audit log could not be loaded.</p>
    ) : (
      <div className="mt-4 space-y-3" role="status" aria-label="Loading activity">
        <SkeletonBlock className="h-9" />
        <SkeletonBlock className="h-9" />
        <SkeletonBlock className="h-9" />
      </div>
    )}
    {audit.state === 'ready' && (
      <p className="mt-auto pt-4 flex items-start gap-1.5 text-xs text-mute">
        <CircleCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ok" aria-hidden="true" />
        <span>
          {audit.value.integrity_status.append_only_enforced ? 'Append-only log with server timestamps.' : 'Server-timestamped log.'}{' '}
          {audit.value.integrity_status.cryptographic_signatures ? 'Cryptographically signed.' : 'Not cryptographically signed.'}
        </span>
      </p>
    )}
  </section>
);

const ModelLine: React.FC<{ name: string; m: InvestigationModelInfo }> = ({ name, m }) => (
  <div className="rounded-xl bg-well ring-1 ring-line px-4 py-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[13px] font-semibold text-ink">{name}</p>
      {m.available ? <Pill tone="green">Loaded</Pill> : <Pill tone="amber">Unavailable</Pill>}
    </div>
    {m.available ? (
      <>
        <p className="mt-0.5 font-mono text-xs text-mute">{m.model_version}</p>
        {m.held_out_evaluation && (
          <dl className="mt-2.5 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[11.5px] text-mute">Recall, held out</dt>
              <dd className="font-display text-lg font-bold text-ink">{pct(m.held_out_evaluation.recall)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-mute">Precision, held out</dt>
              <dd className="font-display text-lg font-bold text-ink">{pct(m.held_out_evaluation.precision)}</dd>
            </div>
          </dl>
        )}
      </>
    ) : (
      <p className="mt-1 text-xs text-warn">{m.unavailable_reason}</p>
    )}
  </div>
);

const ModelsPanel: React.FC = () => {
  const view = useModelStatus();
  const im = view.status?.investigation_models;
  return (
    <section aria-labelledby="models-h" className="panel p-5 sm:p-6 flex flex-col min-w-0" data-reveal>
      <PanelHeading
        icon={Cpu}
        title="Investigation models"
        id="models-h"
        action={
          <Link to="/tools/model" className="text-sm font-semibold text-iris-deep hover:text-iris">
            Model performance
          </Link>
        }
      />
      {im ? (
        <div className="mt-4 space-y-3">
          <ModelLine name="Transaction model" m={im.transaction_model} />
          <ModelLine name="Account behaviour model" m={im.account_model} />
          <p className="text-xs text-mute leading-relaxed">
            Held-out results on a separate synthetic ledger. Validated on the forensic scenario ledger, reference only on the demo
            ledger. A score is a reason to look, not a finding.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-mute" role="status">
          {view.state === 'checking' ? 'Checking the models…' : view.detail}
        </p>
      )}
    </section>
  );
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { source, datasets, cases, audit } = useOverview();

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px] items-stretch">
        <div data-reveal className="panel panel-sheen relative overflow-hidden p-6 sm:p-8 lg:p-10">
          <FlowMotif className="absolute -right-16 -bottom-14 w-[380px] h-[214px] opacity-45 hidden md:block" />
          <div className="relative max-w-[640px]">
            <h1 className="font-display text-[34px] sm:text-[42px] font-bold tracking-[-0.03em] leading-[1.06] text-ink">
              Follow reported money, one transfer at a time.
            </h1>
            <p className="mt-4 text-[16px] leading-relaxed text-mute max-w-[58ch]">
              Trace where an account’s money went and where it came from, see the evidence behind every risk signal, and decide what to
              examine next. FraudShield supports an investigator’s judgement; it does not prove intent or act on accounts.
            </p>
            <div className="mt-7">
              <AccountEntry compact onOpen={(id) => navigate(`/investigate?account=${encodeURIComponent(id)}`)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/investigate" className="btn-secondary">
                <ScanSearch className="w-4 h-4" aria-hidden="true" />
                Investigate an account
              </Link>
              <Link to={`/cases/${SAMPLE_CASE_ID}`} className="btn-ghost">
                Open sample case
              </Link>
            </div>
          </div>
        </div>
        <div data-reveal className="grid">
          <Ledgers source={source} datasets={datasets} />
        </div>
      </section>

      <KeyFigures cases={cases} audit={audit} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-stretch">
        <CasesPanel cases={cases} />
        <ActivityPanel audit={audit} />
      </section>

      <section className="grid gap-6 xl:grid-cols-2 items-stretch">
        <ModelsPanel />
        <section aria-labelledby="limits-heading" className="panel p-5 sm:p-6 flex flex-col" data-reveal>
          <PanelHeading icon={ShieldCheck} title="What the results mean" id="limits-heading" />
          <p className="mt-1.5 text-sm text-mute leading-relaxed">
            Transfers come from transaction records. Risk signals come from rules and a machine-learning model and are prompts for
            review, not findings. Every screen labels which is which.
          </p>
          <ul className="mt-4 divide-y divide-line">
            {PRINCIPLES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 py-3.5 first:pt-1 last:pb-0">
                <span className="w-8 h-8 rounded-xl bg-well ring-1 ring-line flex items-center justify-center shrink-0" aria-hidden="true">
                  <Icon className="w-4 h-4 text-ink-soft" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="block text-[13px] text-mute leading-relaxed">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section aria-labelledby="journey-h" data-reveal>
        <SectionHeader id="journey-h" title="How an investigation unfolds" description="One question at a time, in the order an investigator needs the answers." />
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {STAGES.map((s, i) => (
            <li key={s.id} className="relative rounded-2xl bg-white/70 ring-1 ring-line p-4">
              <span className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-iris-soft text-iris-deep ring-1 ring-iris-line text-[11px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-ink">{s.label}</span>
              </span>
              <span className="mt-2 block text-[13px] text-mute leading-snug">{s.question}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

export default HomePage;
