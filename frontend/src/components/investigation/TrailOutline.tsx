import React from 'react';
import { ChevronDown, ShieldAlert } from 'lucide-react';
import { AccountFinding } from '../../types/investigation';
import { DynamicReport, RestrictionState } from '../../types/dynamic';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { ROLE_ASSESSMENT } from './labels';
import { Trail, TrailNode, countDescendants } from './trail';
import { REVIEW_MARK, roleDisplay } from './caseModel';
import { Badge, IdText } from './ui';
import type { Target } from './TrailTree';

/**
 * The fund trail on a phone: the same tree as a nested list, read top to bottom. Every hop keeps its amount, time,
 * channel and reference; each account keeps its assessed role and any review recommendation; branches fold and
 * unfold like the wide tree (they share the same folded set).
 */
export const TrailOutline: React.FC<{
  trail: Trail;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  selected: Target | null;
  onSelect: (t: Target) => void;
  accounts: Map<string, AccountFinding>;
  intel: DynamicReport | null;
}> = ({ trail, collapsed, onToggle, selected, onSelect, accounts, intel }) => {
  const review = (id: string) => REVIEW_MARK[intel?.role_assessments.find((r) => r.account_id === id)?.restriction.state as RestrictionState];

  // A render function, not a nested component, so React keeps the same elements (and keyboard focus) between renders.
  const level = (nodes: TrailNode[]): React.ReactNode => (
    <ul className="space-y-2">
      {nodes.map((n) => {
        const edge = n.edge!;
        const role = roleDisplay(n.accountId, accounts.get(n.accountId), intel, ROLE_ASSESSMENT);
        const folded = collapsed.has(n.key);
        const hidden = folded ? countDescendants(n) : 0;
        const transferOn = selected?.kind === 'transfer' && selected.id === edge.transaction_id;
        const accountOn = selected?.kind === 'account' && selected.id === n.accountId;
        const mark = review(n.accountId);
        return (
          <li key={n.key}>
            <button
              type="button"
              onClick={() => onSelect({ kind: 'transfer', id: edge.transaction_id })}
              aria-pressed={transferOn}
              aria-label={`${formatMoney(edge.amount, edge.currency)} ${n.direction === 'upstream' ? 'from' : 'to'} ${n.accountId}, ${edge.transaction_id}, ${formatDateTime(edge.timestamp)}`}
              className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${transferOn ? 'bg-iris-soft ring-2 ring-iris' : 'bg-white/70 ring-1 ring-line'}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold text-ink">{formatMoney(edge.amount, edge.currency)}</span>
                <span className="text-[11px] text-faint">Hop {n.hop}</span>
              </span>
              <span className="mt-0.5 block text-xs text-mute">
                {channelLabel(edge.channel)}, {formatDateTime(edge.timestamp)}
              </span>
              <span className="block font-mono text-[11px] text-iris-deep">
                {edge.transaction_id}
                {edge.evidence_type === 'inferred_related' && <span className="ml-1.5 font-sans text-faint">linked by timing</span>}
              </span>
            </button>
            <div className="mt-1.5 flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onSelect({ kind: 'account', id: n.accountId })}
                aria-pressed={accountOn}
                className={`flex-1 min-w-0 rounded-xl px-3 py-2.5 text-left transition-colors ${accountOn ? 'bg-white ring-2 ring-iris' : 'bg-white ring-1 ring-line shadow-[var(--shadow-xs)]'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <IdText className="text-[13px] font-semibold text-ink">{n.accountId}</IdText>
                  {mark && <ShieldAlert className="w-3.5 h-3.5 text-warn shrink-0" aria-hidden="true" />}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {role && <Badge tone={role.tone}>{role.label}</Badge>}
                  {mark && <Badge tone="elevated">{mark}</Badge>}
                </span>
              </button>
              {n.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => onToggle(n.key)}
                  aria-expanded={!folded}
                  aria-label={`${folded ? 'Show' : 'Hide'} the transfers after ${n.accountId}`}
                  className="shrink-0 w-11 rounded-xl bg-white ring-1 ring-line text-mute flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${folded ? '-rotate-90' : ''}`} aria-hidden="true" />
                  {folded ? `+${hidden}` : n.children.length}
                </button>
              )}
            </div>
            {!folded && n.children.length > 0 && (
              <div className="mt-2 ml-3 pl-3 border-l-2 border-dashed border-iris-line">
                {level(n.children)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5" data-testid="trail-outline">
      <div className="rounded-xl bg-[linear-gradient(135deg,#2B2378_0%,#23347F_100%)] px-4 py-3 text-white">
        <p className="text-[11px] text-[#CFC8FF]">Investigated account</p>
        <p className="font-mono text-[15px] font-semibold">{trail.rootId}</p>
      </div>
      {[
        ['Money out of the account', trail.downstream],
        ['Money into the account', trail.upstream],
      ].map(([title, nodes]) =>
        (nodes as TrailNode[]).length ? (
          <section key={title as string} aria-label={title as string}>
            <h4 className="mb-2 text-sm font-semibold text-ink">{title as string}</h4>
            {level(nodes as TrailNode[])}
          </section>
        ) : null,
      )}
    </div>
  );
};

export default TrailOutline;
