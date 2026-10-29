import React, { useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Maximize2 } from 'lucide-react';
import { AccountFinding, TraceEdge, TraceNode } from '../../types/investigation';
import { formatMoney } from '../../lib/format';
import type { Selection } from './InvestigationReport';

const ROLE_COLOR: Record<string, { bg: string; border: string }> = {
  victim_candidate: { bg: '#EBF5FF', border: '#1E40AF' },
  possible_intermediary: { bg: '#FFF0F2', border: '#BE123C' },
  recipient_under_review: { bg: '#FFFBEB', border: '#B45309' },
  sender_under_review: { bg: '#FFFBEB', border: '#B45309' },
  insufficient_evidence: { bg: '#FFFFFF', border: '#A8A196' },
  not_analyzed: { bg: '#FAF7F2', border: '#DDD4C4' },
};

/** Column x by signed hop (earlier senders left, recipients right), rows spread evenly per column. */
function positions(nodes: TraceNode[], edges: TraceEdge[]): Record<string, { x: number; y: number }> {
  const sign: Record<string, number> = {};
  for (const e of edges) {
    const other = e.direction === 'downstream' ? e.destination_account_id : e.origin_account_id;
    if (sign[other] === undefined) sign[other] = e.direction === 'downstream' ? 1 : -1;
  }
  const columns = new Map<number, TraceNode[]>();
  for (const n of nodes) {
    const col = n.is_root ? 0 : n.hop_distance * (sign[n.account_id] ?? 1);
    columns.set(col, [...(columns.get(col) ?? []), n]);
  }
  const out: Record<string, { x: number; y: number }> = {};
  columns.forEach((list, col) => {
    list.forEach((n, i) => {
      out[n.account_id] = { x: col * 190, y: (i - (list.length - 1) / 2) * 72 };
    });
  });
  return out;
}

export const InvestigationGraph: React.FC<{
  nodes: TraceNode[];
  edges: TraceEdge[];
  accounts: AccountFinding[];
  selected: Selection;
  onSelect: (s: Selection) => void;
}> = ({ nodes, edges, accounts, selected, onSelect }) => {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!ref.current) return;
    const roleOf = new Map(accounts.map((a) => [a.account_id, a.role_assessment]));
    const pos = positions(nodes, edges);
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...nodes.map((n) => {
          const c = ROLE_COLOR[roleOf.get(n.account_id) ?? 'not_analyzed'];
          return {
            data: { id: n.account_id, label: n.account_id, bg: c.bg, border: c.border, root: n.is_root ? 1 : 0 },
            position: pos[n.account_id],
          };
        }),
        ...edges.map((e) => ({
          data: {
            id: e.transaction_id,
            source: e.origin_account_id,
            target: e.destination_account_id,
            label: formatMoney(e.amount, e.currency),
            color: e.is_cycle ? '#BE123C' : e.direction === 'downstream' ? '#EA8500' : '#2563EB',
            dashed: e.evidence_type === 'inferred_related' ? 1 : 0,
            width: Math.max(1.5, Math.min(7, Math.log10(Math.max(e.amount, 10)) - 1)),
          },
        })),
      ],
      layout: { name: 'preset', fit: true, padding: 36 },
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            width: 124,
            height: 40,
            'background-color': 'data(bg)',
            'border-width': 2,
            'border-color': 'data(border)',
            label: 'data(label)',
            'font-size': 13,
            'font-family': 'IBM Plex Mono, monospace',
            'font-weight': 600,
            color: '#1A1714',
            'text-valign': 'center',
            'text-halign': 'center',
          },
        },
        { selector: 'node[root = 1]', style: { 'border-width': 4, width: 140, height: 46, 'font-size': 14 } },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            'min-zoomed-font-size': 7,
            color: '#6B655B',
            'text-background-color': '#FFFFFF',
            'text-background-opacity': 0.9,
            'text-background-padding': '2px',
            'text-rotation': 'autorotate',
          },
        },
        { selector: 'edge[dashed = 1]', style: { 'line-style': 'dashed' } },
        { selector: '.picked', style: { 'overlay-color': '#EA8500', 'overlay-opacity': 0.18, 'overlay-padding': 6 } },
      ],
    });
    // A fitted wide graph can be too small to read on narrow screens: start on the investigated account instead.
    const root = cy.nodes('[root = 1]');
    if (cy.zoom() < 0.6 && root.nonempty()) {
      cy.zoom(0.75);
      cy.center(root);
    }
    cy.on('tap', 'node', (evt) => onSelectRef.current({ type: 'account', id: evt.target.id() }));
    cy.on('tap', 'edge', (evt) => onSelectRef.current({ type: 'transaction', id: evt.target.id() }));
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, accounts]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('picked');
    if (selected) cy.getElementById(selected.id).addClass('picked');
  }, [selected]);

  return (
    <div className="relative">
      <div
        ref={ref}
        role="img"
        aria-label={`Money-flow graph: ${nodes.length} accounts and ${edges.length} transfers. Use the account and transfer lists below for keyboard access.`}
        className="h-[420px] sm:h-[520px] w-full rounded-2xl border border-[#EAE3D6] bg-[#FCFBF8]"
        data-testid="investigation-graph"
      />
      <button
        type="button"
        onClick={() => cyRef.current?.fit(undefined, 36)}
        className="absolute top-3 right-3 btn-secondary text-xs px-2.5 py-1.5"
        aria-label="Fit graph to view"
      >
        <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
        Fit
      </button>
    </div>
  );
};

export default InvestigationGraph;
