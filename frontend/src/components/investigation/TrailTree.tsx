import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { AccountFinding } from '../../types/investigation';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { ROLE_ASSESSMENT } from './labels';
import { PlacedNode, TREE, TreeLayout, countDescendants } from './trail';
import { ROLE_TONE } from './caseModel';

export type Target = { kind: 'transfer' | 'account'; id: string };

interface View {
  scale: number;
  x: number;
  y: number;
}

const MIN = 0.35;
const MAX = 1.6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const TONE_DOT: Record<string, string> = {
  ice: 'bg-ice',
  high: 'bg-sev-high',
  elevated: 'bg-sev-elevated',
  low: 'bg-sev-low',
  neutral: 'bg-line-strong',
};

/**
 * Money moves left to right: senders, then the investigated account, then recipients. Transfers are the connectors,
 * labelled with their amount; selecting anything lights up its connections and quiets the rest.
 */
export const TrailTree: React.FC<{
  layout: TreeLayout;
  rootId: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Transfers and accounts to bring forward; null keeps everything at full strength. */
  emphasis: { edges: Set<string>; accounts: Set<string> } | null;
  selected: Target | null;
  onSelect: (t: Target) => void;
  accounts: Map<string, AccountFinding>;
  /** Fit the view to these node keys whenever `focusToken` changes. */
  focusKeys: string[] | null;
  focusToken: number;
}> = ({ layout, rootId, collapsed, onToggle, emphasis, selected, onSelect, accounts, focusKeys, focusToken }) => {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 460 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 460 });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitBox = useCallback(
    (box: { x0: number; y0: number; x1: number; y1: number }, maxScale = 1) => {
      const pad = 36;
      const w = box.x1 - box.x0 + pad * 2;
      const h = box.y1 - box.y0 + pad * 2;
      const scale = clamp(Math.min(size.w / w, size.h / h, maxScale), MIN, MAX);
      setView({
        scale,
        x: (size.w - (box.x1 - box.x0) * scale) / 2 - box.x0 * scale,
        y: (size.h - (box.y1 - box.y0) * scale) / 2 - box.y0 * scale,
      });
    },
    [size],
  );

  const boxOf = (nodes: PlacedNode[]) => ({
    x0: Math.min(...nodes.map((n) => n.x)),
    y0: Math.min(...nodes.map((n) => n.y)),
    x1: Math.max(...nodes.map((n) => n.x + TREE.nodeW)),
    y1: Math.max(...nodes.map((n) => n.y + TREE.nodeH)),
  });

  const fitAll = useCallback(() => fitBox({ x0: 0, y0: 0, x1: layout.width, y1: layout.height }), [fitBox, layout.width, layout.height]);

  // Fit the focused branch when there is one, otherwise the whole trail: on first render, when the viewport or the
  // trail changes size, and whenever a branch is focused.
  useEffect(() => {
    const nodes = (focusKeys ?? []).map((k) => layout.byKey.get(k)).filter((n): n is PlacedNode => Boolean(n));
    if (nodes.length) fitBox(boxOf(nodes), 1.1);
    else fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, layout.width, layout.height, focusToken]);

  // Ctrl/Cmd + wheel zooms around the pointer; a plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const scale = clamp(v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN, MAX);
        return { scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoom = (factor: number) =>
    setView((v) => {
      const scale = clamp(v.scale * factor, MIN, MAX);
      const cx = size.w / 2;
      const cy = size.h / 2;
      return { scale, x: cx - ((cx - v.x) * scale) / v.scale, y: cy - ((cy - v.y) * scale) / v.scale };
    });

  /** Keyboard users: keep the focused node on screen. */
  const reveal = (n: PlacedNode) =>
    setView((v) => {
      const left = n.x * v.scale + v.x;
      const top = n.y * v.scale + v.y;
      const right = left + TREE.nodeW * v.scale;
      const bottom = top + TREE.nodeH * v.scale;
      let { x, y } = v;
      if (left < 12) x += 12 - left;
      if (right > size.w - 12) x -= right - (size.w - 12);
      if (top < 12) y += 12 - top;
      if (bottom > size.h - 12) y -= bottom - (size.h - 12);
      return x === v.x && y === v.y ? v : { ...v, x, y };
    });

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const dim = (lit: boolean) => (emphasis && !lit ? 'opacity-30' : 'opacity-100');

  return (
    <div className="relative rounded-2xl border border-line bg-[#FAFAFE] overflow-hidden" data-testid="trail-tree">
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <button type="button" className="btn-icon" onClick={() => zoom(1.2)} aria-label="Zoom in">
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" className="btn-icon" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" className="btn-icon" onClick={fitAll} aria-label="Fit the whole trail">
          <Maximize2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <p className="absolute left-4 top-3.5 z-10 text-xs text-faint pointer-events-none select-none">
        Drag to pan. Ctrl or ⌘ and scroll to zoom.
      </p>
      <div
        ref={viewport}
        className={`blueprint-grid relative h-[480px] touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className={`absolute left-0 top-0 origin-top-left ${dragging ? '' : 'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'}`}
          style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id="trail-flow" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#6246EA" />
                <stop offset="1" stopColor="#3B82F6" />
              </linearGradient>
            </defs>
            {layout.links.map(({ edge, from, to }) => {
              const x1 = from.x + TREE.nodeW;
              const y1 = from.y + TREE.nodeH / 2;
              const x2 = to.x;
              const y2 = to.y + TREE.nodeH / 2;
              const mx = (x1 + x2) / 2;
              const lit = !emphasis || emphasis.edges.has(edge.transaction_id);
              const chosen = selected?.kind === 'transfer' && selected.id === edge.transaction_id;
              return (
                <path
                  key={edge.transaction_id}
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                  className="trail-link"
                  stroke={lit ? 'url(#trail-flow)' : '#C9CCDD'}
                  strokeWidth={chosen ? 4 : lit && emphasis ? 3 : 2}
                  opacity={lit ? 1 : 0.55}
                />
              );
            })}
          </svg>

          {layout.links.map(({ edge, from, to }) => {
            const cx = (from.x + TREE.nodeW + to.x) / 2;
            const cy = (from.y + to.y + TREE.nodeH) / 2;
            const lit = !emphasis || emphasis.edges.has(edge.transaction_id);
            const chosen = selected?.kind === 'transfer' && selected.id === edge.transaction_id;
            return (
              <button
                key={edge.transaction_id}
                type="button"
                onClick={() => onSelect({ kind: 'transfer', id: edge.transaction_id })}
                aria-label={`Transfer ${edge.transaction_id}: ${formatMoney(edge.amount, edge.currency)} from ${edge.origin_account_id} to ${edge.destination_account_id}`}
                aria-pressed={chosen}
                title={`${edge.transaction_id} · ${channelLabel(edge.channel)} · ${formatDateTime(edge.timestamp)}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all ${dim(lit)} ${
                  chosen
                    ? 'bg-ink text-white shadow-[var(--shadow-lift)]'
                    : edge.flags.length
                      ? 'bg-white text-iris-deep ring-1 ring-iris shadow-sm hover:ring-2'
                      : 'bg-white text-ink-soft ring-1 ring-line-strong shadow-sm hover:ring-iris-line'
                }`}
                style={{ left: cx, top: cy }}
              >
                {formatMoney(edge.amount, edge.currency)}
                {edge.is_cycle && <span className="ml-1 text-sev-critical">cycle</span>}
              </button>
            );
          })}

          {layout.nodes.map((p) => {
            const { node } = p;
            const isRoot = node.key === 'root';
            const finding = accounts.get(node.accountId);
            const role = finding ? ROLE_ASSESSMENT[finding.role_assessment] : null;
            const tone = finding ? ROLE_TONE[finding.role_assessment] : 'neutral';
            const lit = !emphasis || emphasis.accounts.has(node.accountId);
            const chosen = selected?.kind === 'account' && selected.id === node.accountId;
            const hidden = collapsed.has(node.key) ? countDescendants(node) : 0;
            const side = node.direction === 'upstream' ? 'left' : 'right';
            return (
              <div key={node.key} className={`absolute transition-opacity ${dim(lit)}`} style={{ left: p.x, top: p.y, width: TREE.nodeW, height: TREE.nodeH }}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'account', id: node.accountId })}
                  onFocus={() => reveal(p)}
                  aria-pressed={chosen}
                  aria-label={`Account ${node.accountId}${isRoot ? ', investigated account' : ''}${role ? `, ${role.label}` : ''}`}
                  className={`h-full w-full rounded-2xl px-3.5 text-left transition-all ${
                    isRoot
                      ? 'bg-gradient-to-br from-[#2B1F7A] to-[#1E2F7A] text-white shadow-[var(--shadow-lift)]'
                      : chosen
                        ? 'bg-white ring-2 ring-iris shadow-[var(--shadow-lift)]'
                        : 'bg-white ring-1 ring-line shadow-[var(--shadow-float)] hover:ring-iris-line'
                  }`}
                >
                  <span className={`block font-mono text-[13px] font-semibold ${isRoot ? 'text-white' : 'text-ink'}`}>{node.accountId}</span>
                  <span className={`mt-1 flex items-center gap-1.5 text-[11px] ${isRoot ? 'text-[#C9C2FF]' : 'text-mute'}`}>
                    {isRoot ? (
                      'Investigated account'
                    ) : (
                      <>
                        <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[tone] ?? 'bg-line-strong'}`} aria-hidden="true" />
                        <span className="truncate">{role?.label ?? 'Not assessed'}</span>
                      </>
                    )}
                  </span>
                </button>
                {!isRoot && node.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggle(node.key)}
                    aria-expanded={!hidden}
                    aria-label={`${hidden ? 'Expand' : 'Collapse'} the transfers after ${node.accountId}`}
                    className={`absolute top-1/2 -translate-y-1/2 ${side === 'right' ? '-right-3' : '-left-3'} min-w-6 h-6 px-1 rounded-full bg-white ring-1 ring-line-strong text-[11px] font-semibold text-mute hover:text-iris-deep hover:ring-iris shadow-sm`}
                  >
                    {hidden ? `+${hidden}` : '−'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="sr-only">Fund trail centred on {rootId}. Senders are to the left of it, recipients to the right.</p>
    </div>
  );
};

export default TrailTree;
