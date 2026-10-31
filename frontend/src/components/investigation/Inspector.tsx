import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Crosshair, ExternalLink, X } from 'lucide-react';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { featureInfo } from '../../lib/featureGlossary';
import { TraceEdge } from '../../types/investigation';
import { FLAG_LABEL, GRAPH_ROLE, ROLE_ASSESSMENT, splitCoded } from './labels';
import { Branch, farAccount } from './trail';
import type { Target } from './TrailTree';
import { ROLE_TONE, severityOf, useCase } from './caseModel';
import { Badge, IdText, Ref, Refs, SeverityMeter } from './ui';

const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2 border-b border-line last:border-0">
    <dt className="text-mute">{k}</dt>
    <dd className="text-ink font-medium min-w-0 break-words">{children}</dd>
  </div>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-6">
    <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
    <div className="mt-2">{children}</div>
  </section>
);

const Bullets: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-1.5 text-sm text-ink-soft">
    {items.map((t) => (
      <li key={t} className="flex gap-2">
        <span className="mt-2 w-1 h-1 rounded-full bg-faint shrink-0" aria-hidden="true" />
        <span className="min-w-0">{t}</span>
      </li>
    ))}
  </ul>
);

export const Inspector: React.FC<{
  target: Target;
  branch: Branch | null;
  onClose: () => void;
  onNavigate: (t: Target) => void;
  onFocusBranch: () => void;
}> = ({ target, branch, onClose, onNavigate, onFocusBranch }) => {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [target.kind, target.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      id="selection-detail"
      role="dialog"
      aria-modal="false"
      aria-labelledby="inspector-title"
      className="drawer-in fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-line shadow-[-24px_0_60px_-30px_rgba(72,64,140,0.35)] flex flex-col"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
        <p className="text-xs font-semibold text-faint">{target.kind === 'transfer' ? 'Transfer' : 'Account'} inspector</p>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close inspector">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 text-sm">
        {target.kind === 'transfer' ? (
          <TransferDetail id={target.id} branch={branch} headingRef={heading} onNavigate={onNavigate} onFocusBranch={onFocusBranch} />
        ) : (
          <AccountDetail id={target.id} headingRef={heading} onNavigate={onNavigate} onFocusBranch={branch ? onFocusBranch : undefined} />
        )}
      </div>
    </aside>
  );
};

const TransferDetail: React.FC<{
  id: string;
  branch: Branch | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onNavigate: (t: Target) => void;
  onFocusBranch: () => void;
}> = ({ id, branch, headingRef, onNavigate, onFocusBranch }) => {
  const { report, trail } = useCase();
  const t: TraceEdge | undefined = trail.edgesById.get(id) ?? report.victim.flagged_transfers.find((f) => f.transaction_id === id);
  if (!t) return <p className="text-mute">This transfer is not part of the traced data.</p>;

  const steps = branch?.transfers ?? [];
  const at = steps.findIndex((s) => s.transaction_id === id);
  const prev = at > 0 ? steps[at - 1] : null;
  const next = at >= 0 && at < steps.length - 1 ? steps[at + 1] : null;
  const onward = trail.chronological.filter((e) => e.parent_transaction_id === id);
  const counterparty = t.direction === 'upstream' ? t.origin_account_id : t.destination_account_id;
  const isLast = branch && at === steps.length - 1 && branch.direction === 'downstream';
  const isFirstUp = branch && at === 0 && branch.direction === 'upstream';

  return (
    <div>
      <h3 ref={headingRef} tabIndex={-1} id="inspector-title" className="font-display text-[28px] font-bold text-ink outline-none">
        {formatMoney(t.amount, t.currency)}
      </h3>
      <p className="mt-1 text-mute">
        <IdText className="text-ink">{t.transaction_id}</IdText>, {channelLabel(t.channel)}, {formatDateTime(t.timestamp)}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={t.evidence_type === 'observed_direct' ? 'fact' : 'neutral'}>
          {t.evidence_type === 'observed_direct' ? 'Direct: the investigated account is a party' : 'Linked by timing and balance'}
        </Badge>
        {t.flags.length > 0 && <Badge tone="iris">Flagged by rules</Badge>}
        {t.is_cycle && <Badge tone="critical">Cycle</Badge>}
      </div>

      <div className="mt-5 well p-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-mute">From</p>
          <Ref id={t.origin_account_id} />
        </div>
        <ArrowRight className="w-4 h-4 text-iris shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-right">
          <p className="text-xs text-mute">To</p>
          <Ref id={t.destination_account_id} />
        </div>
      </div>

      <dl className="mt-4">
        <Row k="Transaction ID"><IdText>{t.transaction_id}</IdText></Row>
        <Row k="Time">{formatDateTime(t.timestamp)}</Row>
        <Row k="Type">{channelLabel(t.channel)}</Row>
        <Row k="Status">{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</Row>
        <Row k="Direction">{t.direction === 'downstream' ? 'Money leaving the investigated account' : 'Money reaching the investigated account'}</Row>
        <Row k="Hop">{t.hop} from {report.victim.account_id}</Row>
        {t.parent_transaction_id && <Row k="Followed from"><Ref id={t.parent_transaction_id} /></Row>}
        {t.minutes_from_parent !== null && <Row k="Time from that transfer">{Math.round(t.minutes_from_parent)} min</Row>}
        <Row k="Sender balance">{formatMoney(t.origin_balance_before)} to {formatMoney(t.origin_balance_after)}</Row>
        <Row k="Recipient balance">{formatMoney(t.dest_balance_before)} to {formatMoney(t.dest_balance_after)}</Row>
      </dl>

      {t.flags.length > 0 && (
        <Group title="Why the rules flag it">
          <ul className="space-y-2">
            {t.flags.map((f) => (
              <li key={f.code} className="rounded-xl bg-iris-soft/60 ring-1 ring-iris-line px-3 py-2">
                <p className="font-semibold text-iris-deep">{FLAG_LABEL[f.code] ?? f.code}</p>
                <p className="mt-0.5 text-ink-soft">{f.explanation}</p>
              </li>
            ))}
          </ul>
        </Group>
      )}

      <Group title={t.direction === 'downstream' ? `What ${counterparty} did next` : `Where ${counterparty}’s money came from`}>
        {onward.length ? (
          <ul className="space-y-1.5">
            {onward.map((o) => (
              <li key={o.transaction_id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <Ref id={o.transaction_id} />
                  <span className="text-mute truncate">{t.direction === 'downstream' ? `to ${o.destination_account_id}` : `from ${o.origin_account_id}`}</span>
                </span>
                <span className="font-semibold">{formatMoney(o.amount, o.currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-soft">{(isLast || isFirstUp) && branch ? branch.ending.detail : `No further transfer from ${farAccount(t)} was traced.`}</p>
        )}
      </Group>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" disabled={!prev} onClick={() => prev && onNavigate({ kind: 'transfer', id: prev.transaction_id })}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Previous transfer
        </button>
        <button type="button" className="btn-secondary" disabled={!next} onClick={() => next && onNavigate({ kind: 'transfer', id: next.transaction_id })}>
          Next transfer <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" className="btn-secondary col-span-2" onClick={() => onNavigate({ kind: 'account', id: counterparty })}>
          Inspect {t.direction === 'downstream' ? 'recipient' : 'sender'} {counterparty}
        </button>
        {branch && (
          <button type="button" className="btn-ghost col-span-2" onClick={onFocusBranch}>
            <Crosshair className="w-4 h-4" aria-hidden="true" /> Focus the trail on {branch.label.toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
};

const TransferList: React.FC<{ items: TraceEdge[]; dir: 'in' | 'out'; onNavigate: (t: Target) => void }> = ({ items, dir, onNavigate }) =>
  items.length ? (
    <ul className="space-y-1.5">
      {items.map((e) => (
        <li key={e.transaction_id}>
          <button
            type="button"
            onClick={() => onNavigate({ kind: 'transfer', id: e.transaction_id })}
            className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-well text-left"
          >
            <span className="min-w-0 truncate">
              <IdText className="text-iris-deep">{e.transaction_id}</IdText>{' '}
              <span className="text-mute">{dir === 'in' ? `from ${e.origin_account_id}` : `to ${e.destination_account_id}`}</span>
            </span>
            <span className="font-semibold shrink-0">{formatMoney(e.amount, e.currency)}</span>
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-mute">None in the traced data.</p>
  );

const AccountDetail: React.FC<{
  id: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onNavigate: (t: Target) => void;
  onFocusBranch?: () => void;
}> = ({ id, headingRef, onNavigate, onFocusBranch }) => {
  const { report, trail } = useCase();
  const a = report.accounts.find((x) => x.account_id === id);
  const node = report.trace.nodes.find((n) => n.account_id === id);
  const incoming = trail.chronological.filter((e) => e.destination_account_id === id);
  const outgoing = trail.chronological.filter((e) => e.origin_account_id === id);
  const exposure = report.exposure.per_account.find((x) => x.account_id === id);
  const notes = report.trace.truncation_notes.filter((n) => n.includes(id));
  const threshold = report.model_review_threshold;
  const role = a ? ROLE_ASSESSMENT[a.role_assessment] : null;


  return (
    <div>
      <h3 ref={headingRef} tabIndex={-1} id="inspector-title" className="font-mono text-2xl font-semibold text-ink outline-none">
        {id}
      </h3>
      {(a || node) && (
        <p className="mt-1 text-mute">
          {(a ?? node)!.customer_name}, {(a ?? node)!.customer_type}, {(a ?? node)!.kyc_tier.replace(/_/g, ' ')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {node && <Badge tone="neutral">{GRAPH_ROLE[node.graph_role]}{node.hop_distance ? `, hop ${node.hop_distance}` : ''}</Badge>}
        {a && role && <Badge tone={ROLE_TONE[a.role_assessment]} title={role.help}>{role.label}</Badge>}
      </div>
      {role && <p className="mt-2 text-ink-soft leading-relaxed">{role.help}</p>}

      {a && !a.analyzed && <p className="mt-4 rounded-xl bg-sev-elevated-soft ring-1 ring-[#F5E3A8] px-3 py-2 text-sev-elevated">{a.not_analyzed_reason}</p>}

      {a?.rule_assessment && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="well p-3">
            <p className="text-xs text-mute">Rule assessment</p>
            <div className="mt-1.5"><SeverityMeter level={severityOf(a)} /></div>
            <p className="mt-1 text-xs text-mute">{Math.round(a.rule_assessment.risk_score)} of 100 rule points</p>
          </div>
          <div className="well p-3">
            <p className="text-xs text-mute">Account model</p>
            {a.model_assessment ? (
              <>
                <p className="mt-1 font-display text-lg font-bold">{a.model_assessment.risk_score.toFixed(1)}%</p>
                <p className="text-xs text-mute">{threshold !== null ? `Review threshold ${(threshold * 100).toFixed(1)}%` : 'No threshold available'}</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-mute">{a.model_unavailable_reason ?? 'Not available'}</p>
            )}
          </div>
        </div>
      )}
      {a?.disagreement_note && <p className="mt-3 rounded-xl bg-sev-elevated-soft ring-1 ring-[#F5E3A8] px-3 py-2 text-xs text-sev-elevated">{a.disagreement_note}</p>}

      {a && a.role_basis.length > 0 && (
        <Group title="Why this label">
          <Bullets items={a.role_basis} />
        </Group>
      )}

      {a?.rule_assessment && (
        <Group title="Rule signals">
          <ul className="space-y-2">
            {a.rule_assessment.reason_codes.map((r) => {
              const s = splitCoded(r);
              return (
                <li key={r}>
                  <p className="font-semibold text-ink">{s.label}</p>
                  {s.detail && <p className="text-ink-soft">{s.detail}</p>}
                </li>
              );
            })}
          </ul>
        </Group>
      )}

      <Group title="Money into this account in the trace">
        <TransferList items={incoming} dir="in" onNavigate={onNavigate} />
      </Group>
      <Group title="Money out of this account in the trace">
        <TransferList items={outgoing} dir="out" onNavigate={onNavigate} />
      </Group>

      {exposure && (
        <Group title="How much of the traced money moved on">
          <dl>
            <Row k="Received (traced)">{formatMoney(exposure.traced_in_amount)}</Row>
            <Row k="Sent within window">{formatMoney(exposure.outgoing_in_window)}</Row>
            <Row k="Moved on">at least {formatMoney(exposure.forwarded_min)}, at most {formatMoney(exposure.forwarded_max)}</Row>
            <Row k="Lowest balance">{exposure.lowest_balance_in_window === null ? 'Unknown' : formatMoney(exposure.lowest_balance_in_window)}</Row>
          </dl>
        </Group>
      )}
      {notes.length > 0 && (
        <Group title="Trace limits for this account">
          <Bullets items={notes} />
        </Group>
      )}

      {a?.model_assessment && a.model_assessment.top_contributions.length > 0 && (
        <Group title="What moved the model score">
          <ul className="space-y-1">
            {a.model_assessment.top_contributions.slice(0, 5).map((c) => {
              const info = featureInfo(c.feature_name);
              return (
                <li key={c.feature_name} className="flex justify-between gap-3">
                  <span className="text-ink-soft">
                    {info.label} <span className="text-faint">({info.display(c.feature_value)})</span>
                  </span>
                  <span className={c.impact_direction === 'increases_risk' ? 'text-sev-high font-semibold' : 'text-mute'}>
                    {c.impact_direction === 'increases_risk' ? 'raises' : 'lowers'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Group>
      )}

      {a && (
        <>
          <Group title="What is not known">
            <Bullets items={a.missing_evidence} />
          </Group>
          <Group title="Could instead be">
            <Bullets items={a.alternative_explanations} />
          </Group>
          <Group title="Next steps (advisory)">
            <Bullets items={a.next_steps} />
          </Group>
          {a.evidence_transaction_ids.length > 0 && (
            <Group title="Evidence cited">
              <Refs ids={a.evidence_transaction_ids} />
            </Group>
          )}
        </>
      )}

      <div className="mt-6 grid gap-2">
        {onFocusBranch && (
          <button type="button" className="btn-secondary" onClick={onFocusBranch}>
            <Crosshair className="w-4 h-4" aria-hidden="true" /> Focus the trail on this account’s branch
          </button>
        )}
        <Link to={`/tools/accounts/${encodeURIComponent(id)}`} className="btn-ghost">
          Open the full account record <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
};

export default Inspector;
