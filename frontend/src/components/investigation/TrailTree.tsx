import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Maximize2, Minus, Plus, ShieldAlert } from 'lucide-react';
import { AccountFinding } from '../../types/investigation';
import { DynamicReport, RestrictionState, RoleAssessmentV3 } from '../../types/dynamic';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { motionMode } from '../../lib/motion';
import { palette } from '../../lib/palette';
import { ROLE_ASSESSMENT } from './labels';
import { PlacedNode, TREE, TreeLayout, countDescendants } from './trail';
import { REVIEW_MARK, roleDisplay } from './caseModel';

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
  critical: 'bg-sev-critical',
  high: 'bg-sev-high',
  elevated: 'bg-sev-elevated',
  low: 'bg-sev-low',
  neutral: 'bg-line-strong',
};

/** "16 Jan, 10:15": enough to order transfers at a glance; the full time is in the label's title and the inspector. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Trails that have already drawn themselves once; coming back to the fund trail shows them at once. */
const drawnTrails = new WeakSet<object>();

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/**
 * Money moves left to right: senders, then the investigated account, then recipients. Transfers are the connectors,
 * labelled with their amount and time; selecting anything lights up its connections and quiets the rest.
 *
 * Solid connectors are transfers recorded with the investigated account as a party. Dashed connectors are onward links
 * the trace inferred from timing and balances: the ledger records payments, not which money was passed on.
 *
 * Motion: when the trail first appears it draws itself outward from the investigated account, one hop at a time (GSAP);
 * unfolding a branch draws only the new part. Folding and unfolding slide accounts to their new places (CSS). Nothing
 * waits for an animation: every element is clickable from the first frame, and reduced motion shows the trail at once.
 */
export const TrailTree: React.FC<{
  layout: TreeLayout;
  rootId: string;
  /** The investigated customer's name, shown on the root. */
  rootName?: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Transfers and accounts to bring forward; null keeps everything at full strength. */
  emphasis: { edges: Set<string>; accounts: Set<string> } | null;
  selected: Target | null;
  onSelect: (t: Target) => void;
  accounts: Map<string, AccountFinding>;
  /** Model-driven role assessments; when present they supersede the trace report's labels. */
  intel?: DynamicReport | null;
  /** Fit the view to these node keys whenever `focusToken` changes. */
  focusKeys: string[] | null;
  focusToken: number;
  /** Identity of the trail being drawn (stable for one investigation), so its entrance plays only once. */
  drawKey?: object;
  /** Controls shown in the panel's top bar, beside the zoom buttons (the branch picker). */
  toolbar?: React.ReactNode;
}> = ({ layout, rootId, rootName, collapsed, onToggle, emphasis, selected, onSelect, accounts, intel = null, focusKeys, focusToken, drawKey, toolbar }) => {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 520 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  /** Node keys on screen after the last drawing, so unfolding animates only what is new. */
  const drawn = useRef<Set<string> | null>(null);

  const assessments = useMemo(() => new Map<string, RoleAssessmentV3>((intel?.role_assessments ?? []).map((r) => [r.account_id, r])), [intel]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 520 });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitBox = useCallback(
    (box: { x0: number; y0: number; x1: number; y1: number }, maxScale = 1, rise = 0.5, minScale = MIN) => {
      const pad = 40;
      const w = box.x1 - box.x0 + pad * 2;
      const h = box.y1 - box.y0 + pad * 2;
      const scale = clamp(Math.min(size.w / w, size.h / h, maxScale), Math.max(MIN, minScale), MAX);
      const wide = (box.x1 - box.x0) * scale > size.w - pad * 2;
      setView({
        scale,
        // Too wide to show at a readable size: start from the left, where the money starts; the rest is a pan away.
        x: wide ? pad - box.x0 * scale : (size.w - (box.x1 - box.x0) * scale) / 2 - box.x0 * scale,
        // `rise` < 0.5 places a short, wide branch in the upper part of the view, where it is read first.
        y: Math.max(pad, (size.h - (box.y1 - box.y0) * scale) * rise) - box.y0 * scale,
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
    if (nodes.length) fitBox(boxOf(nodes), 1.1, 0.32, 0.78);
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

  // The drawing (GSAP). First appearance: the investigated account, then each hop outward, connectors first.
  // Later layouts (a branch unfolded): only the accounts and connectors that were not on screen before.
  useLayoutEffect(() => {
    const el = canvas.current;
    const before = drawn.current;
    const now = new Set(layout.nodes.map((n) => n.node.key));
    drawn.current = now;
    if (!el || motionMode() !== 'full') return;
    if (!before && drawKey && drawnTrails.has(drawKey)) return;
    const fresh = layout.nodes.filter((n) => !before || !before.has(n.node.key));
    if (!fresh.length) return;
    const first = !before;
    const marked = first && drawKey ? (drawnTrails.add(drawKey), true) : false;
    const baseHop = first ? 0 : Math.min(...fresh.map((n) => n.node.hop)) - 1;

    let tl: gsap.core.Timeline | null = null;
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl = timeline;
      for (const p of fresh) {
        const { node } = p;
        const step = first ? node.hop : node.hop - baseHop;
        const at = node.key === 'root' ? 0 : 0.14 + (step - 1) * 0.2;
        const card = el.querySelector(`[data-node="${esc(node.key)}"]`);
        if (node.key !== 'root') {
          const link = el.querySelector<SVGPathElement>(`[data-link="${esc(node.key)}"]`);
          const label = el.querySelector(`[data-label="${esc(node.key)}"]`);
          if (link) {
            if (link.dataset.inferred) {
              timeline.from(link, { opacity: 0, duration: 0.4, clearProps: 'opacity' }, at);
            } else {
              const len = link.getTotalLength?.() || 300;
              timeline.fromTo(link, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.42, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset' }, at);
            }
          }
          if (label) timeline.from(label, { opacity: 0, scale: 0.9, duration: 0.3, clearProps: 'opacity,transform' }, at + 0.2);
        }
        if (card) {
          timeline.from(
            card,
            { opacity: 0, x: node.direction === 'upstream' ? 12 : node.key === 'root' ? 0 : -12, scale: node.key === 'root' ? 0.95 : 1, duration: 0.38, clearProps: 'opacity,transform' },
            node.key === 'root' ? 0 : at + 0.24,
          );
        }
      }
    }, el);
    return () => {
      ctx.revert();
      // Under StrictMode's double run, the second run must see the same "before" and draw again.
      drawn.current = before;
      // StrictMode's immediate re-run (nothing played yet) must still draw; a finished drawing stays remembered.
      if (marked && drawKey && (tl?.progress() ?? 0) < 1) drawnTrails.delete(drawKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

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

  const dim = (lit: boolean) => (emphasis && !lit ? 'opacity-[0.28]' : 'opacity-100');

  return (
    <div className="relative rounded-2xl border border-line bg-white shadow-[var(--shadow-float)] overflow-hidden" data-testid="trail-tree">
      <div className="flex items-center gap-3 border-b border-line bg-[linear-gradient(180deg,#FBFBFF_0%,#F7F8FD_100%)] px-3 py-2.5">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="flex gap-1 shrink-0 rounded-xl bg-white p-1 ring-1 ring-line shadow-[var(--shadow-xs)]">
          <button type="button" className="btn-icon !w-8 !h-8 !shadow-none !border-transparent" onClick={() => zoom(1.2)} aria-label="Zoom in">
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon !w-8 !h-8 !shadow-none !border-transparent" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
            <Minus className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon !w-8 !h-8 !shadow-none !border-transparent" onClick={fitAll} aria-label="Fit the whole trail">
            <Maximize2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={viewport}
        className={`blueprint-grid relative h-[clamp(460px,64vh,600px)] touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          ref={canvas}
          className={`absolute left-0 top-0 origin-top-left ${dragging ? '' : 'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'}`}
          style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id="trail-flow" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor={palette.iris} />
                <stop offset="1" stopColor={palette.ice} />
              </linearGradient>
            </defs>
            {layout.links.map(({ edge, from, to }) => {
              const x1 = from.x + TREE.nodeW;
              const y1 = from.y + TREE.nodeH / 2;
              const x2 = to.x;
              const y2 = to.y + TREE.nodeH / 2;
              const mx = (x1 + x2) / 2;
              const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
              const lit = !emphasis || emphasis.edges.has(edge.transaction_id);
              const chosen = selected?.kind === 'transfer' && selected.id === edge.transaction_id;
              const inferred = edge.evidence_type === 'inferred_related';
              return (
                <path
                  key={edge.transaction_id}
                  data-link={edge.transaction_id}
                  data-inferred={inferred ? '1' : undefined}
                  d={d}
                  style={{ d: `path("${d}")` } as React.CSSProperties}
                  className="trail-link"
                  stroke={lit ? 'url(#trail-flow)' : palette.quiet}
                  strokeWidth={chosen ? 4 : lit && emphasis ? 3 : 2.25}
                  strokeDasharray={inferred ? '7 6' : undefined}
                  opacity={lit ? 1 : 0.6}
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
              <div key={edge.transaction_id} className={`trail-pos absolute left-0 top-0 z-[1] ${dim(lit)}`} style={{ transform: `translate(${cx}px, ${cy}px)` }}>
                <button
                  type="button"
                  data-label={edge.transaction_id}
                  onClick={() => onSelect({ kind: 'transfer', id: edge.transaction_id })}
                  aria-label={`Transfer ${edge.transaction_id}: ${formatMoney(edge.amount, edge.currency)} from ${edge.origin_account_id} to ${edge.destination_account_id}, ${formatDateTime(edge.timestamp)}`}
                  aria-pressed={chosen}
                  title={`${edge.transaction_id}, ${channelLabel(edge.channel)}, ${formatDateTime(edge.timestamp)}`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-center whitespace-nowrap leading-tight transition-[box-shadow,background-color,color] duration-150 ${
                    chosen
                    ? 'bg-ink text-white shadow-[var(--shadow-lift)]'
                    : edge.flags.length
                    ? 'bg-white text-iris-deep ring-1 ring-iris shadow-[var(--shadow-xs)] hover:ring-2'
                    : 'bg-white text-ink-soft ring-1 ring-line-strong shadow-[var(--shadow-xs)] hover:ring-iris-line'
                  }`}
                >
                  <span className="block text-[12.5px] font-semibold">
                    {formatMoney(edge.amount, edge.currency)}
                    {edge.is_cycle && <span className={`ml-1 ${chosen ? 'text-white' : 'text-sev-critical'}`}>cycle</span>}
                  </span>
                  <span className={`block text-[11px] font-medium ${chosen ? 'text-white/75' : 'text-faint'}`}>{shortTime(edge.timestamp)}</span>
                </button>
              </div>
            );
          })}

          {layout.nodes.map((p) => {
            const { node } = p;
            const isRoot = node.key === 'root';
            const finding = accounts.get(node.accountId);
            const role = roleDisplay(node.accountId, finding, intel, ROLE_ASSESSMENT);
            const tone = role?.tone ?? 'neutral';
            const lit = !emphasis || emphasis.accounts.has(node.accountId);
            const chosen = selected?.kind === 'account' && selected.id === node.accountId;
            const hidden = collapsed.has(node.key) ? countDescendants(node) : 0;
            const side = node.direction === 'upstream' ? 'left' : 'right';
            const review = REVIEW_MARK[assessments.get(node.accountId)?.restriction.state as RestrictionState];
            return (
              <div
                key={node.key}
                className={`trail-pos absolute left-0 top-0 z-[2] ${dim(lit)}`}
                style={{ width: TREE.nodeW, height: TREE.nodeH, transform: `translate(${p.x}px, ${p.y}px)` }}
              >
                <div data-node={node.key} className="h-full w-full">
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'account', id: node.accountId })}
                    onFocus={() => reveal(p)}
                    aria-pressed={chosen}
                    aria-label={`Account ${node.accountId}${isRoot ? ', investigated account' : ''}${role ? `, ${role.label}` : ''}${review ? `, ${review.toLowerCase()}` : ''}`}
                    className={`h-full w-full rounded-[14px] px-4 py-3 text-left transition-[box-shadow,background-color,transform] duration-150 ${
                      isRoot
                      ? 'bg-[linear-gradient(135deg,#2B2378_0%,#23347F_100%)] text-white shadow-[var(--shadow-lift)] ring-1 ring-white/10 hover:-translate-y-px'
                      : chosen
                      ? 'bg-white ring-2 ring-iris shadow-[var(--shadow-lift)]'
                      : 'bg-white ring-1 ring-line shadow-[var(--shadow-float)] hover:ring-iris-line hover:-translate-y-px'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`font-mono text-[14px] font-semibold tracking-tight ${isRoot ? 'text-white' : 'text-ink'}`}>{node.accountId}</span>
                      {review && !isRoot && <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-warn" aria-hidden="true" />}
                    </span>
                    <span className={`mt-1 flex items-center gap-1.5 text-[12.5px] ${isRoot ? 'text-[#CFC8FF]' : 'text-ink-soft'}`}>
                      {isRoot ? (
                        'Investigated account'
                      ) : (
                        <>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone] ?? 'bg-line-strong'}`} aria-hidden="true" />
                          <span className="truncate">{role?.label ?? 'Not assessed'}</span>
                        </>
                      )}
                    </span>
                    <span className={`mt-0.5 block truncate text-[12px] ${isRoot ? 'text-white/70' : review ? 'text-warn font-medium' : 'text-faint'}`}>
                      {isRoot
                        ? rootName ?? ' '
                        : review ??
                          (node.edge ? `${node.direction === 'upstream' ? 'Sent' : 'Received'} ${formatMoney(node.edge.amount, node.edge.currency)}` : ' ')}
                    </span>
                  </button>
                  {!isRoot && node.children.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onToggle(node.key)}
                      aria-expanded={!hidden}
                      aria-label={`${hidden ? 'Expand' : 'Collapse'} the transfers after ${node.accountId}`}
                      className={`absolute top-1/2 -translate-y-1/2 ${side === 'right' ? '-right-3' : '-left-3'} min-w-6 h-6 px-1.5 rounded-full text-[11px] font-semibold shadow-[var(--shadow-xs)] transition-colors ${
                        hidden ? 'bg-iris text-white ring-1 ring-iris-deep' : 'bg-white text-mute ring-1 ring-line-strong hover:text-iris-deep hover:ring-iris'
                      }`}
                    >
                      {hidden ? `+${hidden}` : '−'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-well/70 px-4 py-2.5 text-[11.5px] text-mute">
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="6" aria-hidden="true">
            <line x1="1" y1="3" x2="25" y2="3" stroke="url(#trail-flow-key)" strokeWidth="2.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="trail-flow-key" x1="0" x2="1">
                <stop offset="0" stopColor={palette.iris} />
                <stop offset="1" stopColor={palette.ice} />
              </linearGradient>
            </defs>
          </svg>
          Transfer with the investigated account
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="6" aria-hidden="true">
            <line x1="1" y1="3" x2="25" y2="3" stroke={palette.iris} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />
          </svg>
          Onward link inferred from timing and balances
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-warn" aria-hidden="true" />
          Review recommended (a person decides)
        </span>
        <span className="ml-auto hidden lg:inline text-faint">Senders left, recipients right. Drag to pan; Ctrl or ⌘ and scroll to zoom.</span>
      </div>
      <p className="sr-only">Fund trail centred on {rootId}. Senders are to the left of it, recipients to the right.</p>
    </div>
  );
};

export default TrailTree;
