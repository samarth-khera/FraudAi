import React, { useMemo } from 'react';
import { ArrowDown, CircleStop, Crosshair, GitFork, Repeat, Waypoints } from 'lucide-react';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { FLAG_LABEL, ROLE_ASSESSMENT } from './labels';
import { Branch, EndingKind, TrailNode, layoutTrail, stepTitle } from './trail';
import { Target, TrailTree } from './TrailTree';
import { ROLE_TONE, severityOf, useCase } from './caseModel';
import { Badge, Disclosure, IdText, SeverityMeter, StageHeading } from './ui';

const ENDING_ICON: Record<EndingKind, React.FC<{ className?: string }>> = {
  cycle: Repeat,
  converges: GitFork,
  depth_limit: CircleStop,
  no_onward: CircleStop,
};

/** The accounts on a branch other than the investigated one, in the order the money reached them. */
function path(b: Branch, rootId: string): string {
  return b.accounts.filter((a) => a !== rootId).join(' › ');
}

export const FundTrailStage: React.FC<{
  branch: Branch | null;
  onPickBranch: (id: string) => void;
  target: Target | null;
  onSelect: (t: Target) => void;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onFocusBranch: () => void;
  focusKeys: string[] | null;
  focusToken: number;
}> = ({ branch, onPickBranch, target, onSelect, collapsed, onToggle, onFocusBranch, focusKeys, focusToken }) => {
  const { report, trail } = useCase();
  const accounts = useMemo(() => new Map(report.accounts.map((a) => [a.account_id, a])), [report]);
  const layout = useMemo(() => layoutTrail(trail, collapsed), [trail, collapsed]);
  const outflows = trail.branches.filter((b) => b.direction === 'downstream');
  const inflows = trail.branches.filter((b) => b.direction === 'upstream');

  const emphasis = useMemo(() => {
    if (!branch && !target) return null;
    const edges = new Set<string>(branch?.transfers.map((t) => t.transaction_id) ?? []);
    const accs = new Set<string>(branch?.accounts ?? []);
    if (target?.kind === 'account') {
      accs.add(target.id);
      for (const e of trail.chronological) {
        if (e.origin_account_id === target.id || e.destination_account_id === target.id) {
          edges.add(e.transaction_id);
          accs.add(e.origin_account_id);
          accs.add(e.destination_account_id);
        }
      }
    } else if (target?.kind === 'transfer') {
      const e = trail.edgesById.get(target.id);
      if (e) {
        edges.add(e.transaction_id);
        accs.add(e.origin_account_id);
        accs.add(e.destination_account_id);
      }
    }
    return { edges, accounts: accs };
  }, [branch, target, trail]);

  if (!trail.branches.length) {
    return (
      <div className="space-y-6">
        <StageHeading title="Follow the money" />
        <div className="panel p-8 text-center max-w-2xl mx-auto">
          <Waypoints className="w-7 h-7 mx-auto text-faint" aria-hidden="true" />
          <p className="mt-3 font-semibold text-ink">No transfers were traced</p>
          <p className="mt-1 text-sm text-mute">{report.trace.seed_selection}</p>
          <p className="mt-1 text-sm text-mute">Try a wider date range, a longer follow-on window or tracing every transfer in the settings, then start a new investigation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StageHeading
        title="Follow the money"
        lead={`Each branch is one path the money can be followed along, transfer by transfer, up to ${report.request.max_depth} hops and within ${report.request.onward_window_hours} h of each receipt. Branches are separate paths, not one continuous chain.`}
      />

      <div className="space-y-4">
        {[
          ['Money out of the account', outflows],
          ['Money into the account', inflows],
        ].map(([title, list]) =>
          (list as Branch[]).length ? (
            <div key={title as string}>
              <h3 className="text-sm font-semibold text-ink">
                {title as string} <span className="font-normal text-faint">{(list as Branch[]).length} branch{(list as Branch[]).length === 1 ? '' : 'es'}</span>
              </h3>
              <div className="mt-2 flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" role="listbox" aria-label={title as string}>
                {(list as Branch[]).map((b) => {
                  const on = branch?.id === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => onPickBranch(b.id)}
                      className={`shrink-0 w-[240px] rounded-2xl px-4 py-3 text-left transition-all ${
                        on ? 'bg-white ring-2 ring-iris shadow-[var(--shadow-lift)]' : 'bg-white/70 ring-1 ring-line hover:ring-iris-line hover:bg-white'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">{b.label}</span>
                        <span className="text-xs text-faint">{b.transfers.length} transfer{b.transfers.length === 1 ? '' : 's'}</span>
                      </span>
                      <span className="mt-1.5 block font-mono text-[11px] leading-relaxed text-mute">{path(b, trail.rootId)}</span>
                      <span className="mt-1.5 block text-xs text-ink-soft">{b.ending.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null,
        )}
      </div>

      {/* Wide screens: story beside the tree. Otherwise the tree gets the full width and the story sits under it. */}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start">
        {branch && (
          <div className="order-2 2xl:order-1 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-1 items-start">
            <BranchStory branch={branch} target={target} onSelect={onSelect} onFocusBranch={onFocusBranch} />
            <BranchSummary branch={branch} />
          </div>
        )}
        <div className="order-1 2xl:order-2 min-w-0 space-y-3 2xl:sticky 2xl:top-6">
          <div className="hidden md:block">
            <TrailTree
              layout={layout}
              rootId={trail.rootId}
              collapsed={collapsed}
              onToggle={onToggle}
              emphasis={emphasis}
              selected={target}
              onSelect={onSelect}
              accounts={accounts}
              focusKeys={focusKeys}
              focusToken={focusToken}
            />
          </div>
          <div className="md:hidden">
            <Disclosure summary="Every traced transfer, as a tree">
              <Outline nodes={[trail.root]} onSelect={onSelect} />
            </Disclosure>
          </div>
          <p className="text-xs text-faint leading-relaxed">
            Transfers next to the investigated account are recorded with it as a party. Links further out come from timing and
            balances: the ledger records payments, not which money was passed on.
          </p>
        </div>
      </div>

      <Endings />
    </div>
  );
};

const BranchStory: React.FC<{ branch: Branch; target: Target | null; onSelect: (t: Target) => void; onFocusBranch: () => void }> = ({
  branch,
  target,
  onSelect,
  onFocusBranch,
}) => {
  const { report, trail } = useCase();
  const accounts = new Map(report.accounts.map((a) => [a.account_id, a]));
  const Icon = ENDING_ICON[branch.ending.kind];

  return (
    <section aria-label={`${branch.label}, step by step`} className="panel p-4 sm:p-5" data-testid="branch-story">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ink">{branch.label}</h3>
        <button type="button" className="btn-ghost" onClick={onFocusBranch}>
          <Crosshair className="w-4 h-4" aria-hidden="true" /> Focus in trail
        </button>
      </div>
      <ol className="mt-4">
        {branch.accounts.map((id, i) => {
          const a = accounts.get(id);
          const t = branch.transfers[i];
          const accountOn = target?.kind === 'account' && target.id === id;
          const transferOn = t && target?.kind === 'transfer' && target.id === t.transaction_id;
          const role = a ? ROLE_ASSESSMENT[a.role_assessment] : null;
          return (
            <li key={`${id}-${i}`}>
              <button
                type="button"
                onClick={() => onSelect({ kind: 'account', id })}
                aria-pressed={accountOn}
                className={`w-full rounded-xl px-3.5 py-3 text-left transition-all ${
                  id === trail.rootId
                    ? 'bg-gradient-to-br from-[#2B1F7A] to-[#1E2F7A] text-white'
                    : accountOn
                      ? 'bg-iris-soft ring-2 ring-iris'
                      : 'bg-well ring-1 ring-line hover:ring-iris-line'
                }`}
              >
                <span className={`block text-[11px] font-semibold ${id === trail.rootId ? 'text-[#C9C2FF]' : 'text-faint'}`}>
                  Step {i + 1}: {stepTitle(branch, i, trail.rootId)}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={`font-mono text-[15px] font-semibold ${id === trail.rootId ? 'text-white' : 'text-ink'}`}>{id}</span>
                  {a && id !== trail.rootId && <SeverityMeter level={severityOf(a)} showLabel={false} />}
                </span>
                {a && role && id !== trail.rootId && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={ROLE_TONE[a.role_assessment]}>{role.label}</Badge>
                  </span>
                )}
              </button>

              {t && (
                <div className="relative pl-7 py-2">
                  <span className="absolute left-[13px] top-0 bottom-0 w-[2px] rounded bg-gradient-to-b from-iris to-ice" aria-hidden="true" />
                  <ArrowDown className="absolute left-[7px] bottom-0.5 w-3.5 h-3.5 text-ice" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'transfer', id: t.transaction_id })}
                    aria-pressed={transferOn}
                    aria-label={`${t.origin_account_id} → ${t.destination_account_id}: ${formatMoney(t.amount, t.currency)}, ${t.transaction_id}`}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition-all ${
                      transferOn ? 'bg-white ring-2 ring-iris shadow-[var(--shadow-float)]' : 'bg-white ring-1 ring-line hover:ring-iris-line'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-base font-bold text-ink">{formatMoney(t.amount, t.currency)}</span>
                      <span className="text-[11px] text-faint">Transfer {i + 1}, hop {t.hop}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-mute">
                      <IdText className="text-iris-deep">{t.transaction_id}</IdText> {channelLabel(t.channel)}, {formatDateTime(t.timestamp)}
                    </span>
                    {(t.minutes_from_parent !== null || t.flags.length > 0) && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {t.minutes_from_parent !== null && i > 0 && branch.direction === 'downstream' && (
                          <Badge tone="neutral">{Math.round(t.minutes_from_parent)} min after the previous transfer</Badge>
                        )}
                        {t.flags.map((f) => (
                          <Badge key={f.code} tone="iris">{FLAG_LABEL[f.code] ?? f.code}</Badge>
                        ))}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 rounded-xl border border-dashed border-line-strong px-3.5 py-3" data-testid="branch-ending" data-kind={branch.ending.kind}>
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon className="w-4 h-4 text-mute" aria-hidden="true" /> {branch.ending.title}
        </p>
        <p className="mt-1 text-sm text-mute leading-relaxed">{branch.ending.detail}</p>
      </div>
    </section>
  );
};

/** The branch in numbers: what entered it, what reached its far end, how long that took and how it ends. */
const BranchSummary: React.FC<{ branch: Branch }> = ({ branch }) => {
  const first = branch.transfers[0];
  const last = branch.transfers[branch.transfers.length - 1];
  const minutes = Math.round((new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 60000);
  const span = minutes < 120 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
  return (
    <section aria-label={`${branch.label} in brief`} className="panel p-5 2xl:hidden">
      <h3 className="text-sm font-semibold text-ink">{branch.label} in brief</h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
        <div>
          <dt className="text-xs text-mute">First transfer</dt>
          <dd className="mt-0.5 font-display text-xl font-bold">{formatMoney(first.amount, first.currency)}</dd>
          <dd className="text-xs text-faint">{formatDateTime(first.timestamp)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Reached {branch.direction === 'downstream' ? branch.endAccountId : branch.accounts[branch.accounts.length - 1]}</dt>
          <dd className="mt-0.5 font-display text-xl font-bold">{formatMoney(last.amount, last.currency)}</dd>
          <dd className="text-xs text-faint">{formatDateTime(last.timestamp)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Time from first to last transfer</dt>
          <dd className="mt-0.5 text-[15px] font-semibold">{branch.transfers.length > 1 ? span : 'One transfer'}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Accounts on this path</dt>
          <dd className="mt-0.5 text-[15px] font-semibold">{branch.accounts.length}</dd>
        </div>
      </dl>
      <p className="mt-4 pt-4 border-t border-line text-xs text-faint leading-relaxed">
        Amounts are the recorded transfers. Whether the same money moved on is inferred from timing and balances.
      </p>
    </section>
  );
};

const Outline: React.FC<{ nodes: TrailNode[]; onSelect: (t: Target) => void }> = ({ nodes, onSelect }) => (
  <ul className="space-y-1.5 text-sm">
    {nodes.map((n) => (
      <li key={n.key}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {n.edge && (
            <button type="button" className="text-iris-deep font-semibold" onClick={() => onSelect({ kind: 'transfer', id: n.edge!.transaction_id })}>
              {n.direction === 'upstream' ? '←' : '→'} {formatMoney(n.edge.amount, n.edge.currency)}
            </button>
          )}
          <button type="button" className="font-mono font-semibold text-ink" onClick={() => onSelect({ kind: 'account', id: n.accountId })}>
            {n.accountId}
          </button>
        </div>
        {n.children.length > 0 && (
          <div className="ml-3 mt-1.5 border-l-2 border-iris-line pl-3">
            <Outline nodes={n.children} onSelect={onSelect} />
          </div>
        )}
      </li>
    ))}
  </ul>
);

function groupEndings(branches: Branch[]) {
  const groups = new Map<string, { key: string; kind: EndingKind; title: string; shared: string; branches: Branch[] }>();
  for (const b of branches) {
    const key = `${b.ending.kind}:${b.direction}:${b.ending.title}`;
    const g = groups.get(key) ?? { key, kind: b.ending.kind, title: b.ending.title, shared: b.ending.shared, branches: [] };
    g.branches.push(b);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Stage E: how every branch ends, and what the money-movement totals can and cannot say. */
const Endings: React.FC = () => {
  const { report, trail } = useCase();
  const ex = report.exposure;
  return (
    <section aria-labelledby="endings-h" className="space-y-4">
      <div>
        <h3 id="endings-h" className="font-display text-xl font-bold text-ink">Where the traced money ended</h3>
        <p className="mt-1 text-sm text-mute max-w-3xl">
          Where each branch stops in the available data. A stop is not proof the money stayed, was lost or was recovered.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {groupEndings(trail.branches).map((g) => (
          <li key={g.key} className="panel p-4" data-testid="ending-group" data-kind={g.kind}>
            <p className="text-sm font-semibold text-ink">{g.title}</p>
            <p className="mt-1 text-xs text-mute leading-relaxed">{g.shared}</p>
            <ul className="mt-3 space-y-1.5">
              {g.branches.map((b) => (
                <li key={b.id} className="text-sm">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="text-mute">{b.label}</span>
                    <span className="text-faint">ends at</span>
                    <IdText className="font-semibold text-ink">{b.endAccountId}</IdText>
                  </span>
                  {b.ending.extra && <span className="block text-xs text-sev-elevated">{b.ending.extra}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {report.trace.truncation_notes.length > 0 && (
        <div className="rounded-2xl bg-sev-elevated-soft ring-1 ring-[#F5E3A8] px-4 py-3 text-sm text-sev-elevated">
          <p className="font-semibold">Limits that cut this trace short</p>
          <ul className="mt-1 space-y-1">
            {report.trace.truncation_notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <Disclosure summary="Possible fund exposure, per account">
        <p className="text-sm text-mute">{ex.method}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ['Flagged outgoing', ex.flagged_outgoing_total, 'What the account sent in transfers flagged as unusual'],
            ['Traced outgoing', ex.traced_outgoing_total, 'Transfers used to start the trace'],
            ['All traced downstream movements', ex.observed_downstream_total, 'Counts the same money each time it moves'],
          ].map(([k, v, note]) => (
            <div key={k as string} className="well p-3">
              <p className="text-xs text-mute">{k as string}</p>
              <p className="mt-0.5 font-display text-lg font-bold">{formatMoney(v as number)}</p>
              <p className="text-[11px] text-faint">{note as string}</p>
            </div>
          ))}
        </div>
        {ex.per_account.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[600px] w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-mute border-b border-line">
                  <th className="py-2 pr-2 font-semibold">Account</th>
                  <th className="py-2 px-2 font-semibold text-right">Hop</th>
                  <th className="py-2 px-2 font-semibold text-right">Received (traced)</th>
                  <th className="py-2 px-2 font-semibold text-right">Moved on, at least</th>
                  <th className="py-2 px-2 font-semibold text-right">At most</th>
                  <th className="py-2 pl-2 font-semibold text-right">Lowest balance</th>
                </tr>
              </thead>
              <tbody>
                {ex.per_account.map((x) => (
                  <tr key={x.account_id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2"><IdText>{x.account_id}</IdText></td>
                    <td className="py-2 px-2 text-right">{x.hop}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(x.traced_in_amount)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(x.forwarded_min)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(x.forwarded_max)}</td>
                    <td className="py-2 pl-2 text-right">{x.lowest_balance_in_window === null ? 'Unknown' : formatMoney(x.lowest_balance_in_window)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="mt-3 space-y-1 text-xs text-mute">
          {ex.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
};

export default FundTrailStage;
