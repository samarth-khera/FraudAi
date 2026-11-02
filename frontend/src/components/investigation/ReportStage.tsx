import React from 'react';
import { ArrowDownLeft, ArrowUpRight, FileCheck2, Printer, ShieldCheck } from 'lucide-react';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { AccountRecommendation, ChronologyRow, InvestigatorReport, ReportEvidence, ReviewTrack } from '../../types/dynamic';
import { EvidenceTag } from '../ui/EvidenceTag';
import { STRENGTH_LABEL, Tone, useCase } from './caseModel';
import { RoleBadge } from './intel';
import { serverEnding } from './trail';
import { Badge, IdText, Ref, StageHeading } from './ui';

/** Level chips always carry their words; a possible victim is shown in the calm protective tone, never a warning one. */
const levelTone = (level: number, track: ReviewTrack): Tone =>
  track === 'protective' ? 'ice' : level >= 4 ? 'critical' : level === 3 ? 'high' : level === 2 ? 'elevated' : 'neutral';

export const LevelChip: React.FC<{ level: number; label: string; track: ReviewTrack }> = ({ level, label, track }) => (
  <Badge tone={levelTone(level, track)} title={track === 'protective' ? 'Protective verification: the account may itself be a victim' : undefined}>
    <span data-level={level} data-track={track}>{label}</span>
  </Badge>
);

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`);

const Section: React.FC<{ n: number; title: string; lead?: string; children: React.ReactNode; id: string }> = ({ n, title, lead, children, id }) => (
  <section aria-labelledby={id} className="panel p-5 sm:p-6 space-y-4 break-inside-avoid-page">
    <div>
      <h3 id={id} className="font-display text-lg font-bold text-ink">
        <span className="text-faint font-semibold mr-2" aria-hidden="true">{n}</span>
        {title}
      </h3>
      {lead && <p className="mt-1 text-sm text-mute max-w-3xl">{lead}</p>}
    </div>
    {children}
  </section>
);

const Evidence: React.FC<{ items: ReportEvidence[]; empty: string }> = ({ items, empty }) =>
  items.length ? (
    <ul className="space-y-2">
      {items.map((e, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
          <EvidenceTag kind={e.kind} className="mt-0.5 shrink-0" />
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-mute">{empty}</p>
  );

const Bullets: React.FC<{ items: string[]; empty?: string }> = ({ items, empty = 'None.' }) =>
  items.length ? (
    <ul className="list-disc pl-5 space-y-1 text-sm text-ink-soft marker:text-faint">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-mute">{empty}</p>
  );

const Ids: React.FC<{ ids: string[]; empty: string }> = ({ ids, empty }) =>
  ids.length ? (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Ref key={id} id={id} />
      ))}
    </span>
  ) : (
    <span className="text-sm text-mute">{empty}</span>
  );

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="text-xs font-semibold text-mute mb-1.5">{children}</p>;

const Summary: React.FC<{ rep: InvestigatorReport; completedAt: string }> = ({ rep, completedAt }) => {
  const s = rep.executive_summary;
  return (
    <Section n={1} id="report-summary" title="Executive summary">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-mute">Investigated account</dt>
          <dd className="mt-0.5 font-semibold text-ink"><IdText>{s.account_id}</IdText></dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Dataset</dt>
          <dd className="mt-0.5 text-ink-soft">{s.dataset_title}{s.synthetic ? ' (synthetic)' : ''}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Investigation computed</dt>
          <dd className="mt-0.5 text-ink-soft">{formatDateTime(completedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Records as of</dt>
          <dd className="mt-0.5 text-ink-soft">{formatDateTime(s.data_as_of)}</dd>
        </div>
      </dl>
      <div className="rounded-xl bg-well ring-1 ring-line p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-mute">Overall candidate role</span>
          <RoleBadge role={s.candidate_role} label={s.candidate_role_label} />
          <span className="text-sm text-mute ml-1">Review priority</span>
          <LevelChip level={s.review_level} label={s.review_level_label} track={s.review_track} />
        </div>
        <p className="text-[15px] font-semibold text-ink" data-testid="report-leaning">{s.leaning_text}</p>
        <p className="text-sm text-ink-soft">{s.headline}</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <Label>Main reasons</Label>
          <Evidence items={s.main_reasons} empty="No evidence points to a role." />
          <p className="mt-2 text-xs text-mute">{STRENGTH_LABEL[s.evidence_strength as keyof typeof STRENGTH_LABEL] ?? s.evidence_strength}</p>
        </div>
        <div>
          <Label>Uncertainty and limitations</Label>
          <Bullets items={s.uncertainty} />
        </div>
      </div>
    </Section>
  );
};

const Risk: React.FC<{ rep: InvestigatorReport }> = ({ rep }) => {
  const r = rep.risk_assessment;
  const tm = r.transaction_model;
  const am = r.account_model;
  return (
    <Section n={2} id="report-risk" title="Account risk assessment" lead={r.score_note}>
      <div className="grid md:grid-cols-3 gap-4 text-sm">
        <div className="rounded-xl ring-1 ring-line p-4">
          <p className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">Transaction model</span><EvidenceTag kind="model" /></p>
          <p className="mt-1 text-xs text-mute">{tm.version ?? 'Unavailable'}{tm.threshold != null && ` · review threshold ${pct(tm.threshold)}`}</p>
          <p className="mt-2 text-ink-soft">
            {tm.available
              ? `${tm.flagged_on_account ?? 0} of ${tm.scored_on_account ?? 0} transfers of this account at or above the threshold.`
              : 'Not available: only the fixed rules were applied.'}
          </p>
          {!tm.used_as_evidence && tm.available && <p className="mt-1 text-xs text-warn">Reference only on this dataset.</p>}
          {tm.flagged_transfers.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {tm.flagged_transfers.slice(0, 4).map((t) => (
                <li key={t.transaction_id} className="text-xs text-ink-soft">
                  <Ref id={t.transaction_id} /> {t.direction === 'outgoing' ? 'to' : 'from'} <IdText>{t.counterparty}</IdText>, {formatMoney(t.amount)}, score {pct(t.calibrated_probability)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl ring-1 ring-line p-4">
          <p className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">Account model</span><EvidenceTag kind="model" /></p>
          <p className="mt-1 text-xs text-mute">{am.version ?? 'Unavailable'}{am.threshold != null && ` · review threshold ${pct(am.threshold)}`}</p>
          <p className="mt-2 text-ink-soft">
            {am.status === 'scored' || am.status === 'reference_only'
              ? `Score ${pct(am.calibrated_probability)}, ${am.above_threshold ? 'at or above' : 'below'} its threshold.`
              : am.status === 'insufficient_history'
                ? 'Too few records: the model abstains.'
                : 'Not scored in this investigation.'}
          </p>
          {am.status === 'reference_only' && <p className="mt-1 text-xs text-warn">Reference only on this dataset.</p>}
          {am.factors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-soft">
              {am.factors.map((f) => (
                <li key={f.label}>{f.label} ({f.contribution > 0 ? 'raises' : 'lowers'} the score)</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-mute">{am.positive_target}</p>
        </div>
        <div className="rounded-xl ring-1 ring-line p-4">
          <p className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">Fixed rules</span><EvidenceTag kind="rule" /></p>
          <p className="mt-2 text-ink-soft">{r.rules.role_rule}</p>
          {r.rules.flags_on_account.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-xs text-ink-soft">
              {r.rules.flags_on_account.slice(0, 4).map((f, i) => (
                <li key={i}><Ref id={f.transaction_id} /> {f.explanation}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-mute">No fixed-rule flag on this account's traced transfers.</p>
          )}
          {r.rules.uncorroborated.length > 0 && <p className="mt-2 text-xs text-mute">{r.rules.uncorroborated.length} rule flag(s) not corroborated by the validated model: shown, not used as evidence.</p>}
        </div>
      </div>
      <p className="text-xs text-mute">
        Model support for this dataset: <span className="font-semibold text-ink-soft">{r.model_support.validated_for_this_dataset ? 'validated (models count as evidence)' : 'not validated (reference only)'}</span>. {r.model_support.note}
      </p>
      <div className="grid lg:grid-cols-2 gap-5">
        <div data-testid="victim-side-evidence">
          <Label>Points to a victim (its own money left)</Label>
          <Evidence items={r.victim_side_evidence} empty="Nothing in the records shows its own money leaving." />
        </div>
        <div data-testid="suspicion-side-evidence">
          <Label>Points to passing money on or collecting it</Label>
          <Evidence items={r.suspicion_side_evidence} empty="Nothing points to passing money on or collecting it." />
        </div>
      </div>
      {r.context.length > 0 && (
        <div>
          <Label>Context only (not counted as evidence)</Label>
          <Evidence items={r.context} empty="" />
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-5">
        <div>
          <Label>Evidence against this assessment</Label>
          <Bullets items={r.contradictory_evidence} />
        </div>
        <div>
          <Label>Possible innocent explanations</Label>
          <Bullets items={r.innocent_explanations} />
        </div>
        <div>
          <Label>Missing information</Label>
          <Bullets items={r.missing_information} />
        </div>
      </div>
    </Section>
  );
};

const Balance: React.FC<{ row: ChronologyRow }> = ({ row }) =>
  row.balance_before == null ? (
    <span className="text-mute">—</span>
  ) : (
    <span className="whitespace-nowrap text-ink-soft">
      {formatMoney(row.balance_before)} → {formatMoney(row.balance_after)}
    </span>
  );

const Chronology: React.FC<{ rep: InvestigatorReport }> = ({ rep }) => {
  const c = rep.chronology;
  return (
    <Section n={3} id="report-chronology" title="Transaction chronology" lead={c.window_note}>
      <div className="overflow-x-auto scroll-fade-x -mx-1 px-1">
        <table className="data-table min-w-[760px]" data-testid="report-chronology">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Direction</th>
              <th scope="col">Counterparty</th>
              <th scope="col" className="text-right">Amount</th>
              <th scope="col">Its balance</th>
              <th scope="col">Why it is listed</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row) => (
              <tr key={row.transaction_id} data-flagged={row.flagged || undefined}>
                <td className="whitespace-nowrap text-ink-soft">
                  {formatDateTime(row.timestamp)}
                  <div className="mt-0.5"><Ref id={row.transaction_id} /></div>
                </td>
                <td className="whitespace-nowrap">
                  {row.direction === 'outgoing' ? (
                    <span className="inline-flex items-center gap-1 text-ink-soft"><ArrowUpRight className="w-3.5 h-3.5 text-iris" aria-hidden="true" />Sent</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-ink-soft"><ArrowDownLeft className="w-3.5 h-3.5 text-ice" aria-hidden="true" />Received</span>
                  )}
                  <div className="text-xs text-mute">{row.channel ?? ''}</div>
                </td>
                <td><Ref id={row.counterparty} /></td>
                <td className="text-right font-semibold text-ink whitespace-nowrap">{formatMoney(row.amount)}</td>
                <td className="text-xs"><Balance row={row} /></td>
                <td className="text-xs text-ink-soft min-w-[260px]">
                  <ul className="space-y-1">
                    {row.selected_because.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.omitted > 0 && <p className="text-xs text-mute">{c.omitted} further context transfer(s) in the window are not listed.</p>}
    </Section>
  );
};

const Path: React.FC<{ accounts: string[]; amounts: number[] }> = ({ accounts, amounts }) => (
  <span className="flex flex-wrap items-center gap-1 text-xs">
    {accounts.map((a, i) => (
      <React.Fragment key={`${a}-${i}`}>
        <IdText className="text-ink-soft">{a}</IdText>
        {i < amounts.length && <span className="text-faint">→ {formatMoney(amounts[i])} →</span>}
      </React.Fragment>
    ))}
  </span>
);

const FundFlow: React.FC<{ rep: InvestigatorReport }> = ({ rep }) => {
  const f = rep.fund_flow;
  const down = f.hops.filter((h) => h.direction === 'downstream');
  const up = f.hops.filter((h) => h.direction === 'upstream');
  return (
    <Section n={4} id="report-flow" title="Fund flow" lead={f.amount_note}>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
        <div>
          <dt className="text-xs text-mute">Flagged transfers out of {f.investigated_account}</dt>
          <dd className="mt-0.5 font-display text-xl font-bold text-ink">{formatMoney(f.flagged_outgoing_total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Traced out of {f.investigated_account}</dt>
          <dd className="mt-0.5 font-display text-xl font-bold text-ink">{formatMoney(f.traced_outgoing_total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Recipients reached</dt>
          <dd className="mt-0.5 font-display text-xl font-bold text-ink">{f.recipients.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Cash withdrawal endings</dt>
          <dd className="mt-0.5 font-display text-xl font-bold text-ink">{f.cash_endings.length}</dd>
        </div>
      </dl>
      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <Label>Where the money came from</Label>
          {f.sources.length ? (
            <ul className="space-y-1 text-sm text-ink-soft">
              {f.sources.map((s) => (
                <li key={s.transaction_id}><Ref id={s.account_id} /> paid {formatMoney(s.amount)} on {formatDateTime(s.timestamp)} (<Ref id={s.transaction_id} />)</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">The trace starts at {f.investigated_account}: no earlier payer was followed.</p>
          )}
          {f.earliest_sources.length > 0 && <p className="mt-2 text-xs text-mute">Earliest payers reached: {f.earliest_sources.map((e) => `${e.account_id} (${e.hops_before} hop(s) back)`).join(', ')}.</p>}
        </div>
        <div>
          <Label>First recipients</Label>
          {f.first_recipients.length ? (
            <ul className="space-y-1 text-sm text-ink-soft">
              {f.first_recipients.map((s) => (
                <li key={s.transaction_id}><Ref id={s.account_id} /> received {formatMoney(s.amount)} on {formatDateTime(s.timestamp)} (<Ref id={s.transaction_id} />)</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">No outgoing transfer of {f.investigated_account} was traced.</p>
          )}
        </div>
      </div>
      <div className="overflow-x-auto scroll-fade-x -mx-1 px-1">
        <table className="data-table min-w-[560px]" data-testid="report-hops">
          <thead>
            <tr>
              <th scope="col">Hop</th>
              <th scope="col">Transfers</th>
              <th scope="col" className="text-right">Amount at this hop</th>
              <th scope="col">Accounts</th>
            </tr>
          </thead>
          <tbody>
            {[...down, ...up].map((h) => (
              <tr key={`${h.direction}-${h.hop}`}>
                <td className="whitespace-nowrap text-ink-soft">{h.direction === 'downstream' ? `${h.hop} after` : `${h.hop} before`}</td>
                <td className="text-ink-soft">{h.transfers}</td>
                <td className="text-right font-semibold text-ink whitespace-nowrap">{formatMoney(h.total)}</td>
                <td><Ids ids={h.accounts} empty="—" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Label>Branches and where each ends</Label>
        <ul className="space-y-2">
          {f.branches.map((b) => (
            <li key={b.branch_id} className="rounded-xl ring-1 ring-line px-3 py-2">
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-ink">{b.branch_id}</span>
                <Badge>{serverEnding(b.ending_reason, b.ending_detail).title}</Badge>
              </p>
              <div className="mt-1"><Path accounts={b.accounts} amounts={b.amounts} /></div>
              <p className="mt-1 text-xs text-mute">{b.ending_detail}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid lg:grid-cols-2 gap-5 text-sm">
        <div>
          <Label>Cash withdrawals (the ledger cannot follow cash)</Label>
          {f.cash_endings.length ? (
            <ul className="space-y-1 text-ink-soft">
              {f.cash_endings.map((c) => (
                <li key={c.transaction_id}><Ref id={c.account_id} /> withdrew {formatMoney(c.amount)} on {formatDateTime(c.timestamp)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-mute">No traced cash withdrawal.</p>
          )}
        </div>
        <div>
          <Label>Convergence and loops</Label>
          <Bullets
            items={[
              ...f.reached_by_several_paths.map((a) => `${a} was reached by more than one traced path.`),
              ...f.convergence.map((c) => `${c.transaction_id}: ${c.from_account} paid ${formatMoney(c.amount)} to ${c.to_account}, already in the trace.`),
              ...f.cycles.map((c) => `Loop on branch ${c.branch_id}: ${c.ending_detail}`),
            ]}
            empty="No convergence or loop in the traced transfers."
          />
        </div>
      </div>
      <div>
        <Label>Untraced or open ends</Label>
        <Bullets
          items={[...f.untraced.map((u) => `${u.account_id} (branch ${u.branch_id}): ${u.detail}`), ...f.truncation_notes]}
          empty="Every branch ends in a recorded reason; none was cut short."
        />
      </div>
      {f.attribution.length > 0 && (
        <div className="overflow-x-auto scroll-fade-x -mx-1 px-1">
          <table className="data-table min-w-[640px]" data-testid="report-attribution">
            <caption className="text-left text-xs text-mute pb-2">How much of the traced money moved on from each recipient (balance-based range, per account; never added across hops)</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="text-right">Received in traced transfers</th>
                <th scope="col" className="text-right">Moved on (range)</th>
                <th scope="col" className="text-right">Kept at least</th>
                <th scope="col" className="text-right">Cash</th>
              </tr>
            </thead>
            <tbody>
              {f.attribution.map((a) => (
                <tr key={a.account_id}>
                  <td><Ref id={a.account_id} /></td>
                  <td className="text-right text-ink-soft whitespace-nowrap">{formatMoney(a.received_traced)}</td>
                  <td className="text-right text-ink-soft whitespace-nowrap">{formatMoney(a.forwarded_at_least)} – {formatMoney(a.forwarded_at_most)}</td>
                  <td className="text-right text-ink-soft whitespace-nowrap">{formatMoney(a.kept_at_least)}</td>
                  <td className="text-right text-ink-soft whitespace-nowrap">{a.cash_withdrawn ? formatMoney(a.cash_withdrawn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
};

const Connected: React.FC<{ rep: InvestigatorReport }> = ({ rep }) => (
  <Section
    n={5}
    id="report-connected"
    title="Connected accounts"
    lead="Each account is assessed on its own records. Its role in this flow (what it received and sent here) is shown apart from its independently assessed behaviour."
  >
    <div className="overflow-x-auto scroll-fade-x -mx-1 px-1">
      <table className="data-table min-w-[760px] table-fixed" data-testid="report-connected">
        <colgroup>
          <col className="w-[128px]" />
          <col className="w-[34%]" />
          <col />
          <col className="w-[27%]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Candidate role</th>
            <th scope="col">Evidence</th>
            <th scope="col">Review priority and recommended action</th>
          </tr>
        </thead>
        <tbody>
          {rep.connected_accounts.map((c) => (
            <tr key={c.account_id} data-account={c.account_id} className="align-top">
              <td className="align-top"><Ref id={c.account_id} /></td>
              <td className="align-top">
                <RoleBadge role={c.role_candidate} label={c.role_label} />
                <p className="mt-1.5 text-xs text-ink-soft"><span className="font-semibold text-mute">In this flow: </span>{c.flow_role}</p>
                <p className="mt-1 text-xs text-ink-soft"><span className="font-semibold text-mute">Own behaviour: </span>{c.behaviour}</p>
              </td>
              <td className="align-top">
                {c.evidence.length ? (
                  <ul className="space-y-1.5">
                    {c.evidence.map((e, i) => (
                      <li key={i} className="text-xs text-ink-soft">
                        <EvidenceTag kind={e.kind} className="mr-1.5 align-[1px]" />
                        {e.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-mute">No evidence points to a role.</span>
                )}
              </td>
              <td className="align-top">
                <LevelChip level={c.level} label={c.level_label} track={c.track} />
                <p className="mt-1.5 text-xs text-ink-soft">{c.recommended_action}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Section>
);

const Recommendation: React.FC<{ r: AccountRecommendation }> = ({ r }) => (
  <article className="rounded-2xl ring-1 ring-line bg-white p-4 space-y-3 break-inside-avoid" data-testid="report-recommendation" data-account={r.account_id} data-level={r.level}>
    <header className="flex flex-wrap items-center gap-2">
      <Ref id={r.account_id} />
      <RoleBadge role={r.role_candidate} label={r.role_label} />
      <LevelChip level={r.level} label={r.level_label} track={r.track} />
    </header>
    <p className="text-sm font-semibold text-ink">{r.action}</p>
    <p className="text-sm text-ink-soft">{r.reason}</p>
    {r.victim_note && <p className="text-xs text-info">{r.victim_note}</p>}
    <div className="grid md:grid-cols-2 gap-4">
      <div>
        <Label>Evidence supporting it</Label>
        <Evidence items={r.supporting_evidence} empty="No evidence points to a role." />
      </div>
      <div>
        <Label>Contradictory evidence</Label>
        <Bullets items={r.contradictory_evidence} />
      </div>
      <div>
        <Label>Possible innocent explanation</Label>
        <Bullets items={r.innocent_explanations} />
      </div>
      <div>
        <Label>Verify before any action</Label>
        <Bullets items={r.verify_before_action} />
      </div>
    </div>
    <p className="text-xs text-mute"><span className="font-semibold text-ink-soft">Who decides: </span>{r.authorised_by}</p>
    <p className="text-xs text-mute">Restriction state from the role engine: {r.restriction_label}. Nothing has been executed.</p>
  </article>
);

const Recommendations: React.FC<{ rep: InvestigatorReport }> = ({ rep }) => {
  const relevant = rep.recommendations.filter((r) => r.level >= 2 || r.account_id === rep.executive_summary.account_id);
  const routine = rep.recommendations.filter((r) => !relevant.includes(r));
  return (
    <Section n={6} id="report-recommendations" title="Review and restriction recommendations" lead="Level 1 routine review, level 2 enhanced verification, level 3 urgent manual investigation, level 4 consider a temporary restriction under institutional policy. A possible victim gets protective verification only.">
      <div className="space-y-3">
        {relevant.map((r) => (
          <Recommendation key={r.account_id} r={r} />
        ))}
      </div>
      {routine.length > 0 && (
        <p className="text-sm text-ink-soft">
          <span className="font-semibold">Level 1, routine review only ({routine.length}): </span>
          <span className="inline-flex flex-wrap gap-1 align-middle">{routine.map((r) => <Ref key={r.account_id} id={r.account_id} />)}</span>
        </p>
      )}
    </Section>
  );
};

const Findings: React.FC<{ rep: InvestigatorReport }> = ({ rep }) => {
  const f = rep.findings;
  return (
    <Section n={7} id="report-findings" title="Findings and next steps">
      <div className="grid lg:grid-cols-3 gap-5">
        <div>
          <Label>Supported by recorded evidence</Label>
          <Bullets items={f.recorded_evidence} />
        </div>
        <div>
          <Label>Supported only by model output</Label>
          <Bullets items={f.model_output_only} empty="Nothing rests on model output alone." />
        </div>
        <div>
          <Label>Still unknown</Label>
          <Bullets items={f.unknown} />
        </div>
      </div>
      <dl className="grid md:grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-xs font-semibold text-mute mb-1.5">Urgent review</dt>
          <dd><Ids ids={f.urgent_review} empty="None." /></dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-mute mb-1.5">Protective verification</dt>
          <dd><Ids ids={f.protective_verification} empty="None." /></dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-mute mb-1.5">Enhanced verification</dt>
          <dd><Ids ids={f.enhanced_verification} empty="None." /></dd>
        </div>
      </dl>
      <div>
        <Label>Records an authorized investigator should obtain</Label>
        <Bullets items={f.records_to_obtain} />
      </div>
    </Section>
  );
};

/** The final stage: the deterministic investigator report from the dynamic investigation (types/dynamic.ts). */
export const ReportStage: React.FC = () => {
  const { intel } = useCase();
  const rep = intel?.investigator_report;
  if (!intel || !rep) {
    return <p className="text-sm text-mute">This server does not provide the investigator report.</p>;
  }
  const print = () => {
    const root = document.documentElement;
    root.classList.add('print-report');
    const done = () => {
      root.classList.remove('print-report');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };
  return (
    <div id="investigator-report" className="space-y-6" data-testid="investigator-report">
      <StageHeading
        title="Investigator report"
        lead={rep.generator.description}
        aside={
          <button type="button" className="btn-secondary" onClick={print} data-print-hide>
            <Printer className="w-4 h-4" aria-hidden="true" />
            Print report
          </button>
        }
      />
      <div role="note" data-testid="report-notice" className="flex items-start gap-3 rounded-2xl bg-ice-soft ring-1 ring-ice-line px-4 py-3 text-sm text-info">
        <ShieldCheck className="w-5 h-5 shrink-0 mt-px" aria-hidden="true" />
        <p className="font-semibold">{rep.notice}</p>
      </div>
      <Summary rep={rep} completedAt={intel.completed_at} />
      <Risk rep={rep} />
      <Chronology rep={rep} />
      <FundFlow rep={rep} />
      <Connected rep={rep} />
      <Recommendations rep={rep} />
      <Findings rep={rep} />
      <section aria-labelledby="report-safeguards" className="rounded-2xl ring-1 ring-line bg-well px-5 py-4">
        <h3 id="report-safeguards" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileCheck2 className="w-4 h-4 text-iris" aria-hidden="true" />
          Safeguards
        </h3>
        <div className="mt-2"><Bullets items={rep.safeguards} /></div>
        <p className="mt-3 text-xs text-mute">
          Report {rep.report_version}, investigation {intel.investigation_id}, digest <IdText>{intel.investigation_digest}</IdText>. {intel.synthetic_data_notice}
        </p>
      </section>
    </div>
  );
};

export default ReportStage;
