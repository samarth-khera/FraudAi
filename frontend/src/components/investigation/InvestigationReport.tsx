import React, { Suspense, lazy, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Bot, Database, FlaskConical, RotateCcw, ShieldAlert } from 'lucide-react';
import { Pill } from '../ui/StateViews';
import { formatDateTime, formatMoney } from '../../lib/format';
import { featureInfo } from '../../lib/featureGlossary';
import { AccountFinding, AnalystSection, InvestigationResponse, TraceEdge, TraceNode } from '../../types/investigation';
import { ACTION_LABEL, FLAG_LABEL, GRAPH_ROLE, KIND, ROLE_ASSESSMENT } from './labels';

const InvestigationGraph = lazy(() => import('./InvestigationGraph'));

export type Selection = { type: 'account' | 'transaction'; id: string } | null;

const SECTIONS = [
  ['overview', 'Overview'],
  ['flow', 'Money flow'],
  ['accounts', 'Accounts'],
  ['exposure', 'Exposure'],
  ['findings', 'Findings'],
  ['analysis', 'Explanation'],
  ['next', 'Next steps'],
] as const;

const Section: React.FC<{ id: string; title: string; subtitle?: string; synthetic: boolean; children: React.ReactNode }> = ({
  id,
  title,
  subtitle,
  synthetic,
  children,
}) => (
  <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-32 rounded-3xl border border-[#EAE3D6] bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 id={`${id}-h`} className="font-display text-lg sm:text-xl font-bold text-[#1A1714]">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-[#6B655B] max-w-3xl">{subtitle}</p>}
      </div>
      {synthetic && <Pill tone="amber">Synthetic demo data</Pill>}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; note?: string }> = ({ label, value, note }) => (
  <div className="rounded-2xl border border-[#EAE3D6] bg-[#FAF7F2] p-4">
    <p className="text-xs font-semibold text-[#6B655B]">{label}</p>
    <p className="mt-1 font-display text-xl font-bold text-[#1A1714] tabular-nums">{value}</p>
    {note && <p className="mt-0.5 text-xs text-[#8C857B]">{note}</p>}
  </div>
);

export const InvestigationReport: React.FC<{ report: InvestigationResponse; onNew: () => void }> = ({ report, onNew }) => {
  const [selected, setSelected] = useState<Selection>(null);
  const synthetic = report.data_source.is_synthetic;
  const { victim, trace } = report;

  const txns = useMemo(() => {
    const m = new Map<string, TraceEdge>();
    for (const t of victim.flagged_transfers) m.set(t.transaction_id, t);
    for (const e of trace.edges) m.set(e.transaction_id, e);
    return m;
  }, [victim, trace]);
  const nodes = useMemo(() => new Map(trace.nodes.map((n) => [n.account_id, n])), [trace]);
  const accounts = useMemo(() => new Map(report.accounts.map((a) => [a.account_id, a])), [report]);
  const findingIds = useMemo(() => new Set(report.findings.map((f) => f.finding_id)), [report]);

  const select = (s: Selection) => {
    setSelected(s);
    document.getElementById('selection-detail')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  };

  const Ref: React.FC<{ id: string }> = ({ id }) => {
    const cls = 'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold';
    if (txns.has(id))
      return (
        <button type="button" onClick={() => select({ type: 'transaction', id })} className={`${cls} border-[#FCD5B5] bg-[#FFF4E6] text-[#B45309] hover:bg-[#FFE8CC]`}>
          {id}
        </button>
      );
    if (nodes.has(id))
      return (
        <button type="button" onClick={() => select({ type: 'account', id })} className={`${cls} border-[#BFDBFE] bg-[#EBF5FF] text-[#1E40AF] hover:bg-[#DBEAFE]`}>
          {id}
        </button>
      );
    if (findingIds.has(id))
      return (
        <a href={`#finding-${id}`} className={`${cls} border-[#EAE3D6] bg-[#FAF7F2] text-[#6B655B]`}>
          {id}
        </a>
      );
    return <span className={`${cls} border-[#EAE3D6] text-[#6B655B]`}>{id}</span>;
  };

  const Refs: React.FC<{ ids: string[] }> = ({ ids }) =>
    ids.length ? (
      <span className="inline-flex flex-wrap gap-1 align-middle">
        {ids.map((id) => (
          <Ref key={id} id={id} />
        ))}
      </span>
    ) : null;

  const directOut = trace.edges.filter((e) => e.direction === 'downstream' && e.hop === 1);
  const directIn = trace.edges.filter((e) => e.direction === 'upstream' && e.hop === 1);
  const analyzedCount = report.accounts.filter((a) => a.analyzed).length;

  return (
    <div className="space-y-6" data-testid="investigation-report">
      {synthetic && (
        <div role="note" className="sticky top-16 z-30 -mx-1 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB]/95 backdrop-blur px-4 py-2.5 text-sm text-[#92400E] flex items-center gap-2 shadow-sm">
          <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>Synthetic demo data.</strong> {report.data_source.disclosure.replace(/^Synthetic demo data\.\s*/, '')}
          </span>
        </div>
      )}

      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#B45309]">Investigation {report.investigation_id}</p>
          <h1 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-[#1A1714]">
            <span className="font-mono">{victim.account_id}</span>
            <span className="text-[#8C857B] font-semibold text-lg sm:text-xl"> · {victim.customer_name}</span>
          </h1>
          <p className="mt-1 text-sm text-[#6B655B]">
            Computed {formatDateTime(report.completed_at)} in {(report.duration_ms / 1000).toFixed(1)} s from fresh ledger queries ·{' '}
            {report.ledger_rows_read.toLocaleString('en-IN')} transaction records read · not stored
          </p>
        </div>
        <button type="button" onClick={onNew} className="btn-secondary shrink-0">
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          New investigation
        </button>
      </header>

      <nav aria-label="Report sections" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-[#EAE3D6] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B655B] hover:text-[#1A1714]">
            {label}
          </a>
        ))}
      </nav>

      {!report.model_available && (
        <div role="alert" className="rounded-2xl border border-[#FECDD3] bg-[#FFF0F2] p-4 text-sm text-[#881337] flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-[#BE123C]" aria-hidden="true" />
          <p>
            <strong>The account model did not run.</strong> {report.model_unavailable_reason} Rule results and the money trace below are
            still computed from the ledger; no model scores are shown.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------ overview */}
      <Section id="overview" title="Overview" synthetic={synthetic} subtitle={trace.seed_selection}>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label="Money in (period)" value={formatMoney(victim.incoming_total)} note={`${victim.incoming_count} transfers`} />
          <Stat label="Money out (period)" value={formatMoney(victim.outgoing_total)} note={`${victim.outgoing_count} transfers`} />
          <Stat label="Flagged as unusual" value={formatMoney(report.exposure.flagged_outgoing_total)} note={`${victim.flagged_transfers.length} transfers`} />
          <Stat label="Accounts traced" value={trace.nodes.length} note={`${analyzedCount} assessed · ${trace.cycles_detected} cycles`} />
        </div>

        {victim.flagged_transfers.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-[#1A1714]">Transfers unusual for this account</h3>
            <p className="text-xs text-[#6B655B]">Each is compared only with this account’s own earlier transfers.</p>
            <ul className="mt-2 space-y-2">
              {victim.flagged_transfers.map((t) => (
                <li key={t.transaction_id} className="rounded-2xl border border-[#FCD5B5] bg-[#FFF8F0] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Ref id={t.transaction_id} />
                    <span className="font-semibold tabular-nums">{formatMoney(t.amount, t.currency)}</span>
                    <span className="text-[#6B655B]">
                      {t.origin_account_id === victim.account_id ? `to ${t.destination_account_id}` : `from ${t.origin_account_id}`} · {t.channel} ·{' '}
                      {formatDateTime(t.timestamp)}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {t.flags.map((f) => (
                      <li key={f.code} className="text-xs text-[#6B655B]">
                        <Pill tone="orange" className="mr-1.5">{FLAG_LABEL[f.code] ?? f.code}</Pill>
                        {f.explanation}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[
            ['Largest senders in the period', victim.top_senders, ArrowDownLeft],
            ['Largest recipients in the period', victim.top_recipients, ArrowUpRight],
          ].map(([title, rows, Icon]) => {
            const list = rows as typeof victim.top_senders;
            const I = Icon as typeof ArrowDownLeft;
            return (
              <div key={title as string}>
                <h3 className="text-sm font-semibold text-[#1A1714] flex items-center gap-1.5">
                  <I className="w-4 h-4 text-[#8C857B]" aria-hidden="true" />
                  {title as string}
                </h3>
                {list.length ? (
                  <ul className="mt-2 divide-y divide-[#F1ECE3] text-sm">
                    {list.map((c) => (
                      <li key={c.account_id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="font-mono text-xs">
                          {nodes.has(c.account_id) ? <Ref id={c.account_id} /> : c.account_id}
                        </span>
                        <span className="text-xs text-[#6B655B] tabular-nums">
                          {c.transfers}× · <span className="font-semibold text-[#1A1714]">{formatMoney(c.total_amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[#8C857B]">None in the period.</p>
                )}
              </div>
            );
          })}
        </div>

        <DataSourceCard report={report} />
      </Section>

      {/* ------------------------------------------------------------ money flow */}
      <Section
        id="flow"
        title="Money flow"
        synthetic={synthetic}
        subtitle={`${directOut.length} transfer(s) traced out of the account and ${directIn.length} traced into it, followed up to ${report.request.max_depth} hop(s) within ${report.request.onward_window_hours} h of each receipt. Click an account or a transfer for its evidence.`}
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B655B] mb-3">
          <span><span className="inline-block w-4 border-t-2 border-[#EA8500] align-middle mr-1" />Money leaving the account (downstream)</span>
          <span><span className="inline-block w-4 border-t-2 border-[#2563EB] align-middle mr-1" />Money reaching it (upstream)</span>
          <span><span className="inline-block w-4 border-t-2 border-dashed border-[#6B655B] align-middle mr-1" />Linked by timing only (inferred)</span>
          <span><span className="inline-block w-4 border-t-2 border-[#BE123C] align-middle mr-1" />Cycle</span>
        </div>
        {trace.edges.length ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <p className="xl:col-span-2 -mb-2 text-xs text-[#8C857B]">Drag to pan and scroll or pinch to zoom; Fit shows the whole graph. The timeline and tables list every transfer and account.</p>
            <Suspense fallback={<div className="h-[420px] rounded-2xl border border-[#EAE3D6] bg-[#FCFBF8]" />}>
              <InvestigationGraph nodes={trace.nodes} edges={trace.edges} accounts={report.accounts} selected={selected} onSelect={setSelected} />
            </Suspense>
            <SelectionDetail
              selected={selected}
              txns={txns}
              nodes={nodes}
              accounts={accounts}
              threshold={report.model_review_threshold}
              rootId={victim.account_id}
              Ref={Ref}
            />
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#DDD4C4] bg-[#FAF7F2] p-6 text-sm text-[#6B655B]">
            No transfers were traced. {trace.seed_selection}
          </p>
        )}
        {trace.truncation_notes.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-[#92400E]">
            {trace.truncation_notes.map((n) => (
              <li key={n} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />{n}</li>
            ))}
          </ul>
        )}

        {trace.edges.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-[#1A1714]">Transfer timeline</h3>
            <ol className="mt-2 max-h-[420px] overflow-y-auto divide-y divide-[#F1ECE3] rounded-2xl border border-[#EAE3D6]">
              {trace.edges.map((e) => (
                <li key={e.transaction_id}>
                  <button
                    type="button"
                    onClick={() => select({ type: 'transaction', id: e.transaction_id })}
                    aria-pressed={selected?.id === e.transaction_id}
                    className={`w-full text-left px-3 py-2 text-xs sm:text-sm flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-[#FAF7F2] ${selected?.id === e.transaction_id ? 'bg-[#FFF4E6]' : ''}`}
                  >
                    <span className="text-[#8C857B] tabular-nums w-44 shrink-0 whitespace-nowrap">{formatDateTime(e.timestamp)}</span>
                    <span className="font-mono">{e.origin_account_id} → {e.destination_account_id}</span>
                    <span className="font-semibold tabular-nums">{formatMoney(e.amount, e.currency)}</span>
                    <span className="text-[#8C857B]">{e.channel} · hop {e.hop}</span>
                    <Pill tone={e.evidence_type === 'observed_direct' ? 'green' : 'neutral'}>
                      {e.evidence_type === 'observed_direct' ? 'Direct' : 'Inferred link'}
                    </Pill>
                    {e.is_cycle && <Pill tone="rose">Cycle</Pill>}
                    {e.flags.length > 0 && <Pill tone="orange">Flagged</Pill>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------------ accounts */}
      <Section
        id="accounts"
        title="Linked accounts"
        synthetic={synthetic}
        subtitle={`Each account is assessed from its own transaction history. Labels describe what the records show; none is a finding of guilt.${
          report.model_review_threshold !== null ? ` Model review threshold: ${(report.model_review_threshold * 100).toFixed(1)}% (${report.model_version}).` : ''
        }`}
      >
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#6B655B] border-b border-[#EAE3D6]">
                <th className="py-2 px-1 font-semibold">Account</th>
                <th className="py-2 px-1 font-semibold">Position</th>
                <th className="py-2 px-1 font-semibold">Assessment</th>
                <th className="py-2 px-1 font-semibold text-right">Rule score</th>
                <th className="py-2 px-1 font-semibold text-right">Model score</th>
                <th className="py-2 px-1 font-semibold">Checks</th>
                <th className="py-2 px-1 font-semibold text-right">Traced in</th>
                <th className="py-2 px-1 font-semibold text-right">Traced out</th>
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((a) => (
                <tr key={a.account_id} className={`border-b border-[#F1ECE3] ${selected?.id === a.account_id ? 'bg-[#FFF4E6]' : ''}`}>
                  <td className="py-2 px-1">
                    <button type="button" onClick={() => select({ type: 'account', id: a.account_id })} className="font-mono font-semibold text-[#1E40AF] hover:underline">
                      {a.account_id}
                    </button>
                    <div className="text-xs text-[#8C857B]">{a.customer_type} · {a.kyc_tier.replace(/_/g, ' ')}</div>
                  </td>
                  <td className="py-2 px-1 text-xs">{GRAPH_ROLE[a.graph_role]}{a.hop_distance ? ` · hop ${a.hop_distance}` : ''}</td>
                  <td className="py-2 px-1">
                    <Pill tone={ROLE_ASSESSMENT[a.role_assessment].tone} title={ROLE_ASSESSMENT[a.role_assessment].help}>
                      {ROLE_ASSESSMENT[a.role_assessment].label}
                    </Pill>
                  </td>
                  <td className="py-2 px-1 text-right tabular-nums">{a.rule_assessment ? `${Math.round(a.rule_assessment.risk_score)}/100` : '—'}</td>
                  <td className="py-2 px-1 text-right tabular-nums">{a.model_assessment ? `${a.model_assessment.risk_score.toFixed(1)}%` : '—'}</td>
                  <td className="py-2 px-1 text-xs">
                    {a.checks_disagree === null ? '—' : a.checks_disagree ? <Pill tone="amber">Disagree</Pill> : <span className="text-[#6B655B]">Agree</span>}
                  </td>
                  <td className="py-2 px-1 text-right tabular-nums">{a.traced_in_amount ? formatMoney(a.traced_in_amount) : '—'}</td>
                  <td className="py-2 px-1 text-right tabular-nums">{a.traced_out_amount ? formatMoney(a.traced_out_amount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!trace.edges.length && report.accounts[0] && (
          <div className="mt-4">
            <AccountDetail a={report.accounts[0]} threshold={report.model_review_threshold} Ref={Ref} />
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------------ exposure */}
      <Section id="exposure" title="Possible fund exposure" synthetic={synthetic} subtitle={report.exposure.method}>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Stat label="Flagged outgoing transfers" value={formatMoney(report.exposure.flagged_outgoing_total)} note="What the account sent in unusual transfers" />
          <Stat label="Traced outgoing transfers" value={formatMoney(report.exposure.traced_outgoing_total)} note="Transfers used to start the trace" />
          <Stat label="All traced downstream movements" value={formatMoney(report.exposure.observed_downstream_total)} note="Counts the same money each time it moves" />
        </div>
        {report.exposure.per_account.length > 0 && (
          <div className="mt-4 overflow-x-auto -mx-1">
            <table className="min-w-[620px] w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#6B655B] border-b border-[#EAE3D6]">
                  <th className="py-2 px-1 font-semibold">Account</th>
                  <th className="py-2 px-1 font-semibold text-right">Hop</th>
                  <th className="py-2 px-1 font-semibold text-right">Received (traced)</th>
                  <th className="py-2 px-1 font-semibold text-right">Moved on: at least</th>
                  <th className="py-2 px-1 font-semibold text-right">at most</th>
                  <th className="py-2 px-1 font-semibold text-right">Lowest balance</th>
                </tr>
              </thead>
              <tbody>
                {report.exposure.per_account.map((x) => (
                  <tr key={x.account_id} className="border-b border-[#F1ECE3]">
                    <td className="py-1.5 px-1"><Ref id={x.account_id} /></td>
                    <td className="py-1.5 px-1 text-right tabular-nums">{x.hop}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums">{formatMoney(x.traced_in_amount)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums">{formatMoney(x.forwarded_min)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums">{formatMoney(x.forwarded_max)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums">{x.lowest_balance_in_window === null ? '—' : formatMoney(x.lowest_balance_in_window)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="mt-3 list-disc pl-5 text-xs text-[#6B655B] space-y-0.5">
          {report.exposure.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Section>

      {/* ------------------------------------------------------------ findings */}
      <Section id="findings" title="Findings and evidence" synthetic={synthetic} subtitle="Every finding is labelled by where it comes from and cites the records behind it.">
        <div className="flex flex-wrap gap-2 mb-3">
          {(['observed', 'rule', 'model', 'limitation'] as const).map((k) => (
            <Pill key={k} tone={KIND[k].tone} title={KIND[k].help}>{KIND[k].label}: {report.findings.filter((f) => f.kind === k).length}</Pill>
          ))}
        </div>
        <ol className="space-y-2">
          {report.findings.map((f) => (
            <li key={f.finding_id} id={`finding-${f.finding_id}`} className="scroll-mt-32 rounded-2xl border border-[#EAE3D6] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-[#8C857B]">{f.finding_id}</span>
                <Pill tone={KIND[f.kind].tone} title={KIND[f.kind].help}>{KIND[f.kind].label}</Pill>
              </div>
              <p className="mt-1.5 text-[#1A1714] leading-relaxed">{f.statement}</p>
              {(f.evidence.transaction_ids.length > 0 || f.evidence.account_ids.length > 0) && (
                <p className="mt-1.5 text-xs text-[#6B655B]">
                  Evidence: <Refs ids={[...f.evidence.transaction_ids, ...f.evidence.account_ids]} />
                </p>
              )}
            </li>
          ))}
        </ol>
      </Section>

      {/* ------------------------------------------------------------ explanation */}
      <Section id="analysis" title="Explanation" synthetic={synthetic}>
        <AIStatus report={report} Refs={Refs} />
        <h3 className="mt-5 text-sm font-semibold text-[#1A1714]">Evidence summary</h3>
        <p className="text-xs text-[#6B655B]">Written by fixed templates from the findings above, not by an AI model.</p>
        <QA sections={report.evidence_summary} Refs={Refs} />
      </Section>

      {/* ------------------------------------------------------------ next steps */}
      <Section id="next" title="Recommended next steps" synthetic={synthetic}>
        <div className="rounded-2xl border border-[#BFDBFE] bg-[#EBF5FF] p-3 text-sm text-[#1E3A8A] flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>Advisory only. Nothing has been frozen, blocked or flagged. Any restriction needs an authorised institution process with documented grounds.</p>
        </div>
        <ol className="mt-3 space-y-2">
          {report.recommendations.map((r) => (
            <li key={r.recommendation_id} className="rounded-2xl border border-[#EAE3D6] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-[#8C857B]">{r.recommendation_id}</span>
                <Pill tone={r.action === 'consider_escalation' ? 'rose' : r.action === 'obtain_records' ? 'neutral' : 'amber'}>{ACTION_LABEL[r.action]}</Pill>
              </div>
              <p className="mt-1.5">{r.statement}</p>
              <p className="mt-1 text-xs text-[#6B655B]">Uncertainty: {r.uncertainty}</p>
              <p className="mt-1 text-xs text-[#6B655B]">Evidence: <Refs ids={[...r.evidence.transaction_ids, ...r.evidence.account_ids]} /></p>
            </li>
          ))}
        </ol>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">What is still unknown</h3>
            <ul className="mt-2 list-disc pl-5 text-sm text-[#6B655B] space-y-1">{report.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Records to request</h3>
            <ul className="mt-2 list-disc pl-5 text-sm text-[#6B655B] space-y-1">{report.records_to_request.map((u) => <li key={u}>{u}</li>)}</ul>
          </div>
        </div>
        <p className="mt-5 text-xs text-[#8C857B]">{report.disclaimer}</p>
      </Section>
    </div>
  );
};

const DataSourceCard: React.FC<{ report: InvestigationResponse }> = ({ report }) => {
  const s = report.data_source;
  return (
    <div className="mt-5 rounded-2xl border border-[#EAE3D6] bg-[#FCFBF8] p-4 text-sm" data-testid="data-source">
      <h3 className="font-semibold text-[#1A1714] flex items-center gap-1.5">
        <Database className="w-4 h-4 text-[#8C857B]" aria-hidden="true" />
        Data source
      </h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-xs">
        <div><dt className="text-[#8C857B] inline">Source: </dt><dd className="inline font-semibold">{s.source_name}</dd></div>
        <div><dt className="text-[#8C857B] inline">Real bank data: </dt><dd className="inline font-semibold">{s.real_bank_data ? `Yes (authorization ${s.authorization_reference})` : 'No'}</dd></div>
        <div><dt className="text-[#8C857B] inline">Data as of: </dt><dd className="inline font-semibold">{formatDateTime(s.data_as_of)}</dd></div>
        <div><dt className="text-[#8C857B] inline">Queried: </dt><dd className="inline font-semibold">{formatDateTime(s.queried_at)}</dd></div>
        <div><dt className="text-[#8C857B] inline">Ledger: </dt><dd className="inline font-semibold">{s.accounts_count.toLocaleString('en-IN')} accounts · {s.transactions_count.toLocaleString('en-IN')} transactions</dd></div>
        <div><dt className="text-[#8C857B] inline">Snapshot built: </dt><dd className="inline font-semibold">{formatDateTime(s.snapshot_built_at)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-[#6B655B]">{s.freshness_note}</p>
    </div>
  );
};

type RefsC = React.FC<{ ids: string[] }>;

const QA: React.FC<{ sections: AnalystSection[]; Refs: RefsC }> = ({ sections, Refs }) => (
  <ol className="mt-3 space-y-4">
    {sections.map((s) => (
      <li key={s.question}>
        <p className="text-sm font-semibold text-[#1A1714]">{s.question}</p>
        <ul className="mt-1.5 space-y-1.5">
          {s.claims.map((c, i) => (
            <li key={i} className="text-sm text-[#3D3833] flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Pill tone={KIND[c.kind].tone} title={KIND[c.kind].help}>{KIND[c.kind].label}</Pill>
              <span className="min-w-0">{c.text}</span>
              <Refs ids={c.refs} />
            </li>
          ))}
        </ul>
      </li>
    ))}
  </ol>
);

const AIStatus: React.FC<{ report: InvestigationResponse; Refs: RefsC }> = ({ report, Refs }) => {
  const ai = report.ai_analysis;
  const generated = ai.status === 'generated';
  return (
    <div className={`rounded-2xl border p-4 ${generated ? 'border-[#BFDBFE] bg-[#F5F9FF]' : 'border-[#EAE3D6] bg-[#FAF7F2]'}`} data-testid="ai-status">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Bot className="w-4 h-4" aria-hidden="true" />
        {generated ? `AI analyst (${ai.provider})` : 'AI analyst: not run'}
      </h3>
      <p className="mt-1 text-sm text-[#6B655B]">{ai.message}</p>
      {generated && <QA sections={ai.sections} Refs={Refs} />}
    </div>
  );
};

const AccountDetail: React.FC<{ a: AccountFinding; threshold: number | null; Ref: React.FC<{ id: string }> }> = ({ a, threshold, Ref }) => {
  const role = ROLE_ASSESSMENT[a.role_assessment];
  const ml = a.model_assessment;
  const rule = a.rule_assessment;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-mono font-bold text-base">{a.account_id}</p>
        <p className="text-xs text-[#6B655B]">{a.customer_name} · {a.customer_type} · {a.kyc_tier.replace(/_/g, ' ')} · {GRAPH_ROLE[a.graph_role]}</p>
        <Pill tone={role.tone} className="mt-2">{role.label}</Pill>
        <p className="mt-1 text-xs text-[#6B655B]">{role.help}</p>
      </div>
      {a.role_basis.length > 0 && (
        <Block title="Why this label">{a.role_basis.map((b) => <li key={b}>{b}</li>)}</Block>
      )}
      {!a.analyzed && <p className="text-xs text-[#92400E]">{a.not_analyzed_reason}</p>}
      {rule && (
        <div className="rounded-xl border border-[#EAE3D6] p-3">
          <p className="text-xs font-semibold text-[#6B655B]">Rule score <span className="text-[#1A1714] text-sm">{Math.round(rule.risk_score)}/100 · {rule.risk_level}</span></p>
          <ul className="mt-1 text-xs text-[#6B655B] list-disc pl-4 space-y-0.5">{rule.reason_codes.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {ml && (
        <div className="rounded-xl border border-[#EAE3D6] p-3">
          <p className="text-xs font-semibold text-[#6B655B]">
            Model score <span className="text-[#1A1714] text-sm">{ml.risk_score.toFixed(1)}%</span>
            {threshold !== null && <> · review threshold {(threshold * 100).toFixed(1)}%</>}
          </p>
          <p className="text-xs text-[#8C857B]">What moved this account’s score (TreeSHAP):</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {ml.top_contributions.slice(0, 5).map((c) => {
              const info = featureInfo(c.feature_name);
              return (
                <li key={c.feature_name} className="flex justify-between gap-2">
                  <span>{info.label} <span className="text-[#8C857B]">({info.display(c.feature_value)})</span></span>
                  <span className={c.impact_direction === 'increases_risk' ? 'text-[#BE123C]' : 'text-[#166534]'}>
                    {c.impact_direction === 'increases_risk' ? 'raises' : 'lowers'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {a.model_unavailable_reason && <p className="text-xs text-[#BE123C]">Model unavailable: {a.model_unavailable_reason}</p>}
      {a.disagreement_note && <p className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-2 text-xs text-[#92400E]">{a.disagreement_note}</p>}
      {a.evidence_transaction_ids.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#6B655B]">Traced transfers</p>
          <div className="mt-1 flex flex-wrap gap-1">{a.evidence_transaction_ids.map((t) => <Ref key={t} id={t} />)}</div>
        </div>
      )}
      <Block title="Could instead be">{a.alternative_explanations.map((b) => <li key={b}>{b}</li>)}</Block>
      <Block title="Missing evidence">{a.missing_evidence.map((b) => <li key={b}>{b}</li>)}</Block>
      <Block title="Next steps (advisory)">{a.next_steps.map((b) => <li key={b}>{b}</li>)}</Block>
    </div>
  );
};

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className="text-xs font-semibold text-[#6B655B]">{title}</p>
    <ul className="mt-1 list-disc pl-4 text-xs text-[#3D3833] space-y-0.5">{children}</ul>
  </div>
);

const SelectionDetail: React.FC<{
  selected: Selection;
  txns: Map<string, TraceEdge>;
  nodes: Map<string, TraceNode>;
  accounts: Map<string, AccountFinding>;
  threshold: number | null;
  rootId: string;
  Ref: React.FC<{ id: string }>;
}> = ({ selected, txns, nodes, accounts, threshold, rootId, Ref }) => {
  let body: React.ReactNode = (
    <p className="text-sm text-[#6B655B]">Select an account or a transfer in the graph, the timeline or the accounts table to see its evidence.</p>
  );
  if (selected?.type === 'account') {
    const a = accounts.get(selected.id);
    const n = nodes.get(selected.id);
    body = a ? <AccountDetail a={a} threshold={threshold} Ref={Ref} /> : n ? <p className="text-sm">{n.account_id}: in the graph but not assessed.</p> : null;
  } else if (selected?.type === 'transaction') {
    const t = txns.get(selected.id);
    if (t) {
      const row = (k: string, v: React.ReactNode) => (
        <div className="flex justify-between gap-3 py-1 border-b border-[#F1ECE3]"><dt className="text-[#8C857B]">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
      );
      body = (
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-mono font-bold">{t.transaction_id}</p>
            <Pill tone={t.evidence_type === 'observed_direct' ? 'green' : 'neutral'} className="mt-1">
              {t.evidence_type === 'observed_direct' ? `Observed: ${rootId} is a party` : 'Observed transfer; link to the case inferred from timing'}
            </Pill>
          </div>
          <dl className="text-xs">
            {row('Amount', formatMoney(t.amount, t.currency))}
            {row('From', <Ref id={t.origin_account_id} />)}
            {row('To', <Ref id={t.destination_account_id} />)}
            {row('Time', formatDateTime(t.timestamp))}
            {row('Channel', t.channel)}
            {row('Status', t.status)}
            {row('Direction', t.direction === 'downstream' ? 'Money leaving the investigated account' : 'Money reaching the investigated account')}
            {row('Hops from account', t.hop)}
            {t.parent_transaction_id && row('Followed from', <Ref id={t.parent_transaction_id} />)}
            {t.minutes_from_parent !== null && row('Time from that transfer', `${t.minutes_from_parent} min`)}
            {row('Sender balance', `${formatMoney(t.origin_balance_before)} → ${formatMoney(t.origin_balance_after)}`)}
            {row('Recipient balance', `${formatMoney(t.dest_balance_before)} → ${formatMoney(t.dest_balance_after)}`)}
            {row('Cycle', t.is_cycle ? 'Yes: returns to an account already on this path' : 'No')}
          </dl>
          {t.flags.length > 0 && (
            <Block title="Flags">{t.flags.map((f) => <li key={f.code}><strong>{FLAG_LABEL[f.code] ?? f.code}:</strong> {f.explanation}</li>)}</Block>
          )}
        </div>
      );
    }
  }
  return (
    <aside id="selection-detail" aria-live="polite" className="rounded-2xl border border-[#EAE3D6] bg-[#FCFBF8] p-4 xl:max-h-[520px] xl:overflow-y-auto scroll-mt-32">
      {body}
    </aside>
  );
};

export default InvestigationReport;
