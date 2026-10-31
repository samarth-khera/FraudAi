/**
 * The fund trail as an investigator reads it, built only from the investigation response.
 *
 * The server returns a flat list of traced transfers. Each transfer after the first hop names the transfer it was
 * followed from (`parent_transaction_id`), so the trace is a set of trees rooted at the investigated account: one
 * tree of money leaving it (downstream) and one of money that reached it (upstream). A branch is one root-to-leaf
 * path through a tree. Nothing here invents a transfer, an account or a link; when the data cannot say why a branch
 * stops, the ending says so.
 */
import { InvestigationResponse, TraceEdge } from '../../types/investigation';
import { formatMoney } from '../../lib/format';

export type FlowDirection = 'downstream' | 'upstream';

export interface TrailNode {
  /** 'root' for the investigated account, otherwise the transaction ID of the transfer that put this account here. */
  key: string;
  accountId: string;
  /** Downstream: the transfer that paid this account. Upstream: the transfer this account paid onward. */
  edge: TraceEdge | null;
  direction: FlowDirection | 'root';
  hop: number;
  children: TrailNode[];
}

export type EndingKind = 'cycle' | 'converges' | 'depth_limit' | 'no_onward';

export interface BranchEnding {
  kind: EndingKind;
  title: string;
  /** The full explanation for this branch. */
  detail: string;
  /** The same explanation without account names, for listing several branches that end the same way. */
  shared: string;
  /** A fact specific to this branch's last account, if the data has one. */
  extra?: string;
}

export interface Branch {
  id: string;
  direction: FlowDirection;
  /** "Outflow 1", "Inflow 2": stable, short names for the picker. */
  label: string;
  /** Transfers in the order the money moved (earliest first). */
  transfers: TraceEdge[];
  /** Accounts in the order the money passed through them. */
  accounts: string[];
  /** The far end of the branch: where outgoing money was last seen, or the earliest traced sender. */
  endAccountId: string;
  ending: BranchEnding;
}

export interface Trail {
  rootId: string;
  root: TrailNode;
  /** Children of the root that are money leaving it / reaching it. */
  downstream: TrailNode[];
  upstream: TrailNode[];
  branches: Branch[];
  edgesById: Map<string, TraceEdge>;
  /** Every transfer, earliest first. */
  chronological: TraceEdge[];
}

const byTime = (a: TraceEdge, b: TraceEdge) => a.timestamp.localeCompare(b.timestamp) || a.transaction_id.localeCompare(b.transaction_id);

/** The account a transfer leads to, walking away from the investigated account. */
export function farAccount(e: TraceEdge): string {
  return e.direction === 'downstream' ? e.destination_account_id : e.origin_account_id;
}

function ending(report: InvestigationResponse, last: TraceEdge): BranchEnding {
  const account = farAccount(last);
  const depth = report.request.max_depth;
  const window = report.request.onward_window_hours;
  const nodeLimitHit = report.trace.truncation_notes.some((n) => n.startsWith('The account limit'));
  const caveat = nodeLimitHit ? ' The account limit was reached during this trace, so some transfers may not have been added.' : '';

  if (last.is_cycle) {
    return {
      kind: 'cycle',
      title: 'Returns to an account already on this path',
      detail: `${account} already appears earlier on this branch, so the trace does not follow it again.`,
      shared: 'These accounts already appear earlier on their branch, so the trace does not follow them again.',
    };
  }
  if (last.converges) {
    return {
      kind: 'converges',
      title: 'Joins money traced on another branch',
      detail: `${account} was already reached through a different transfer. Its onward movement is followed on that branch.`,
      shared: 'These accounts were already reached through a different transfer; their onward movement is followed on that branch.',
    };
  }
  if (last.hop >= depth) {
    const line = report.exposure.per_account.find((x) => x.account_id === account);
    const unseen =
      last.direction === 'downstream' && line && line.outgoing_in_window > 0
        ? `The ledger shows ${formatMoney(line.outgoing_in_window)} leaving ${account} within the window; it was not traced further.`
        : undefined;
    const hops = `${depth} hop${depth === 1 ? '' : 's'}`;
    return {
      kind: 'depth_limit',
      title: `Stopped at the depth limit of ${hops}`,
      detail: `The trace was configured to follow money ${hops} from the investigated account, so ${account} was not followed further.${unseen ? ` ${unseen}` : ''}`,
      shared: `The trace was configured to follow money ${hops} from the investigated account, so these accounts were not followed further. Raising the depth would follow them.`,
      extra: unseen,
    };
  }
  return last.direction === 'downstream'
    ? {
        kind: 'no_onward',
        title: 'No further outgoing transfer found',
        detail: `No transfer out of ${account} was found within ${window} h of it receiving this money, in the available ledger data.${caveat}`,
        shared: `No transfer out of these accounts was found within ${window} h of them receiving the money, in the available ledger data.${caveat}`,
      }
    : {
        kind: 'no_onward',
        title: 'No earlier incoming transfer found',
        detail: `No transfer into ${account} was found within ${window} h before it paid this money on, in the available ledger data.${caveat}`,
        shared: `No transfer into these accounts was found within ${window} h before they paid the money on, in the available ledger data.${caveat}`,
      };
}

export function buildTrail(report: InvestigationResponse): Trail {
  const rootId = report.victim.account_id;
  const edges = report.trace.edges;
  const edgesById = new Map(edges.map((e) => [e.transaction_id, e]));
  const childEdges = new Map<string, TraceEdge[]>();
  const seeds: Record<FlowDirection, TraceEdge[]> = { downstream: [], upstream: [] };
  for (const e of edges) {
    // A parent that is not in the response cannot be drawn; such a transfer starts its own tree instead of vanishing.
    if (e.parent_transaction_id && edgesById.has(e.parent_transaction_id)) {
      const list = childEdges.get(e.parent_transaction_id) ?? [];
      list.push(e);
      childEdges.set(e.parent_transaction_id, list);
    } else {
      seeds[e.direction].push(e);
    }
  }

  const toNode = (e: TraceEdge, seen: Set<string>): TrailNode => {
    const next = new Set(seen).add(e.transaction_id);
    const kids = (childEdges.get(e.transaction_id) ?? []).filter((c) => !next.has(c.transaction_id)).sort(byTime);
    return { key: e.transaction_id, accountId: farAccount(e), edge: e, direction: e.direction, hop: e.hop, children: kids.map((c) => toNode(c, next)) };
  };
  const downstream = seeds.downstream.sort(byTime).map((e) => toNode(e, new Set()));
  const upstream = seeds.upstream.sort(byTime).map((e) => toNode(e, new Set()));
  const root: TrailNode = { key: 'root', accountId: rootId, edge: null, direction: 'root', hop: 0, children: [...upstream, ...downstream] };

  const branches: Branch[] = [];
  const walk = (node: TrailNode, path: TraceEdge[], direction: FlowDirection) => {
    const here = [...path, node.edge!];
    if (node.children.length) {
      node.children.forEach((c) => walk(c, here, direction));
      return;
    }
    // `here` runs outward from the investigated account; money moved outward downstream and inward upstream.
    const transfers = direction === 'downstream' ? here : [...here].reverse();
    const accounts = [transfers[0].origin_account_id, ...transfers.map((t) => t.destination_account_id)];
    const n = branches.filter((b) => b.direction === direction).length + 1;
    branches.push({
      id: `${direction}-${n}`,
      direction,
      label: `${direction === 'downstream' ? 'Outflow' : 'Inflow'} ${n}`,
      transfers,
      accounts,
      endAccountId: farAccount(node.edge!),
      ending: ending(report, node.edge!),
    });
  };
  downstream.forEach((n) => walk(n, [], 'downstream'));
  upstream.forEach((n) => walk(n, [], 'upstream'));

  return { rootId, root, downstream, upstream, branches, edgesById, chronological: [...edges].sort(byTime) };
}

/** The branch to show for a transfer or account, preferring the current one when it contains it. */
export function branchFor(trail: Trail, target: { kind: 'transfer' | 'account'; id: string }, current?: string | null): Branch | null {
  const has = (b: Branch) =>
    target.kind === 'transfer' ? b.transfers.some((t) => t.transaction_id === target.id) : b.accounts.includes(target.id);
  const cur = trail.branches.find((b) => b.id === current);
  if (cur && has(cur)) return cur;
  return trail.branches.find(has) ?? null;
}

/** Plain-language role of an account at a given position on a branch. */
export function stepTitle(branch: Branch, index: number, rootId: string): string {
  const id = branch.accounts[index];
  if (id === rootId) return 'Investigated account';
  if (branch.direction === 'downstream') return index === 1 ? 'First recipient' : `Onward recipient, hop ${index}`;
  const hopsBefore = branch.accounts.length - 1 - index;
  if (hopsBefore === 1) return 'Direct sender';
  return index === 0 ? 'Earliest traced sender' : `Earlier sender, hop ${hopsBefore}`;
}

export function countDescendants(node: TrailNode): number {
  return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

// ---------------------------------------------------------------- tree layout (left to right, in the direction money moved)
export const TREE = { nodeW: 184, nodeH: 62, colW: 284, rowH: 82, pad: 28 } as const;

export interface PlacedNode {
  node: TrailNode;
  x: number;
  y: number;
}

export interface PlacedLink {
  edge: TraceEdge;
  /** Left and right ends, so every connector reads left to right. */
  from: PlacedNode;
  to: PlacedNode;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  width: number;
  height: number;
  byKey: Map<string, PlacedNode>;
}

export function layoutTrail(trail: Trail, collapsed: ReadonlySet<string>): TreeLayout {
  const rows = new Map<string, number>();
  const visible = (n: TrailNode) => (collapsed.has(n.key) ? [] : n.children);

  const assign = (nodes: TrailNode[], counter: { next: number }) => {
    for (const n of nodes) {
      const kids = visible(n);
      if (!kids.length) {
        rows.set(n.key, counter.next++);
      } else {
        assign(kids, counter);
        rows.set(n.key, (rows.get(kids[0].key)! + rows.get(kids[kids.length - 1].key)!) / 2);
      }
    }
  };
  const down = { next: 0 };
  const up = { next: 0 };
  assign(trail.downstream, down);
  assign(trail.upstream, up);

  // Line the root up with the middle of both sides, shifting whichever side is shorter.
  const centre = (side: TrailNode[]) => (side.length ? (rows.get(side[0].key)! + rows.get(side[side.length - 1].key)!) / 2 : null);
  const cDown = centre(trail.downstream);
  const cUp = centre(trail.upstream);
  const rootRow = Math.max(cDown ?? 0, cUp ?? 0);
  const shift = (side: TrailNode[], c: number | null) => {
    if (c === null) return;
    const delta = rootRow - c;
    const move = (n: TrailNode) => {
      rows.set(n.key, rows.get(n.key)! + delta);
      visible(n).forEach(move);
    };
    side.forEach(move);
  };
  shift(trail.downstream, cDown);
  shift(trail.upstream, cUp);
  rows.set('root', rootRow);

  let maxUpHop = 0;
  const all: TrailNode[] = [trail.root];
  const collect = (n: TrailNode) => {
    for (const c of visible(n)) {
      all.push(c);
      if (c.direction === 'upstream') maxUpHop = Math.max(maxUpHop, c.hop);
      collect(c);
    }
  };
  collect(trail.root);

  const byKey = new Map<string, PlacedNode>();
  let maxCol = 0;
  let maxRow = 0;
  for (const n of all) {
    const col = (n.direction === 'upstream' ? -n.hop : n.hop) + maxUpHop;
    const row = rows.get(n.key) ?? 0;
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    byKey.set(n.key, { node: n, x: TREE.pad + col * TREE.colW, y: TREE.pad + row * TREE.rowH });
  }

  const links: PlacedLink[] = [];
  const link = (parent: TrailNode) => {
    for (const c of visible(parent)) {
      const p = byKey.get(parent.key)!;
      const k = byKey.get(c.key)!;
      links.push(c.direction === 'upstream' ? { edge: c.edge!, from: k, to: p } : { edge: c.edge!, from: p, to: k });
      link(c);
    }
  };
  link(trail.root);

  return {
    nodes: [...byKey.values()],
    links,
    width: TREE.pad * 2 + maxCol * TREE.colW + TREE.nodeW,
    height: TREE.pad * 2 + maxRow * TREE.rowH + TREE.nodeH,
    byKey,
  };
}
