import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { GitFork, ArrowRight, Activity, ShieldCheck, Info } from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { V2TraceGraphResponse, V2GraphNode, V2GraphEdge } from '../../types/v2';

interface V2MoneyFlowVisualProps {
  onSelectAccount?: (accountId: string) => void;
  className?: string;
}

// Fallback authentic data from ACC-000001 (Victim demo) for instant initial render without layout shift
const INITIAL_NODES: V2GraphNode[] = [
  {
    account_id: 'ACC-000001',
    customer_name: 'Aditi Joshi',
    customer_type: 'retail',
    kyc_tier: 'tier_2_verified',
    current_balance: 177156.23,
    hop_distance: 0,
    is_root: true,
  },
  {
    account_id: 'ACC-002867',
    customer_name: 'FreshMart Express',
    customer_type: 'sme',
    kyc_tier: 'tier_2_verified',
    current_balance: 512136.07,
    hop_distance: 1,
    is_root: false,
  },
  {
    account_id: 'ACC-000414',
    customer_name: 'Arnav Verma',
    customer_type: 'retail',
    kyc_tier: 'tier_2_verified',
    current_balance: 15794.24,
    hop_distance: 1,
    is_root: false,
  },
  {
    account_id: 'ACC-002322',
    customer_name: 'Aditya Rao',
    customer_type: 'retail',
    kyc_tier: 'tier_1_basic',
    current_balance: 251929.43,
    hop_distance: 1,
    is_root: false,
  },
];

const INITIAL_EDGES: V2GraphEdge[] = [
  {
    transaction_id: 'TXN-0008601',
    origin_account_id: 'ACC-000001',
    destination_account_id: 'ACC-002867',
    amount: 2163.53,
    currency: 'INR',
    channel: 'CARD_POS',
    timestamp: '2026-01-03T03:02:29',
    hop: 1,
    is_cycle: false,
  },
  {
    transaction_id: 'TXN-0034439',
    origin_account_id: 'ACC-000001',
    destination_account_id: 'ACC-000414',
    amount: 3620.75,
    currency: 'INR',
    channel: 'IMPS',
    timestamp: '2026-01-09T13:34:58',
    hop: 1,
    is_cycle: false,
  },
  {
    transaction_id: 'TXN-0038614',
    origin_account_id: 'ACC-000001',
    destination_account_id: 'ACC-002322',
    amount: 6977.46,
    currency: 'INR',
    channel: 'IMPS',
    timestamp: '2026-01-10T14:07:44',
    hop: 1,
    is_cycle: false,
  },
];

export const V2MoneyFlowVisual: React.FC<V2MoneyFlowVisualProps> = ({
  onSelectAccount,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const particleRef = useRef<SVGCircleElement>(null);
  const pathRefs = useRef<{ [key: string]: SVGPathElement | null }>({});
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const [rootAccountId, setRootAccountId] = useState<'ACC-000001' | 'ACC-000002'>('ACC-000001');
  const [nodes, setNodes] = useState<V2GraphNode[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<V2GraphEdge[]>(INITIAL_EDGES);
  const [selectedDestId, setSelectedDestId] = useState<string>('ACC-000414');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);

  // Fetch real forensic trace data for selected root demo account
  useEffect(() => {
    let active = true;
    setLoading(true);

    try {
      const tracePromise = v2Api.getTrace?.({
        account_id: rootAccountId,
        direction: 'outgoing',
        max_depth: 1,
        max_nodes: 4,
      });

      if (tracePromise && typeof tracePromise.then === 'function') {
        tracePromise
          .then((data: V2TraceGraphResponse) => {
            if (!active) return;
            if (data?.nodes && data.nodes.length > 1 && data?.edges && data.edges.length > 0) {
              const rootNode = data.nodes.find((n) => n.account_id === rootAccountId) || data.nodes[0];
              const destNodes = data.nodes.filter((n) => n.account_id !== rootNode.account_id).slice(0, 3);
              const topEdges = data.edges
                .filter((e) => destNodes.some((dn) => dn.account_id === e.destination_account_id))
                .slice(0, 3);

              setNodes([rootNode, ...destNodes]);
              setEdges(topEdges);
              if (destNodes.length > 0) {
                setSelectedDestId(destNodes[0].account_id);
              }
            }
          })
          .catch(() => {
            // Fallback to static authentic demo dataset if backend unreachable
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }

    return () => {
      active = false;
    };
  }, [rootAccountId]);

  // Coordinates mapping on an SVG viewBox of 480 x 240
  const rootNode = nodes.find((n) => n.is_root) || nodes[0] || INITIAL_NODES[0];
  const downstreamNodes = nodes.filter((n) => n.account_id !== rootNode.account_id).slice(0, 3);

  const originCoords = { x: 74, y: 120 };
  const destCoordsList = [
    { x: 348, y: 48 },
    { x: 348, y: 120 },
    { x: 348, y: 192 },
  ];

  // Active path selection
  const activeDestId = hoveredNodeId || selectedDestId || (downstreamNodes[0]?.account_id ?? '');
  const activeEdge = edges.find(
    (e) => e.destination_account_id === activeDestId || e.origin_account_id === activeDestId
  );
  const activeDestNode = downstreamNodes.find((n) => n.account_id === activeDestId);

  // Progressive Path Line Reveal & Particle Flow with Scroll Settle
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!containerRef.current) return;

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setIsRevealed(true);
              if (tweenRef.current) tweenRef.current.play();
            } else {
              if (tweenRef.current) tweenRef.current.pause();
            }
          });
        },
        { threshold: 0.15 }
      );
      observer.observe(containerRef.current);
    } else {
      setIsRevealed(true);
    }

    if (prefersReducedMotion) {
      setIsRevealed(true);
      return () => {
        if (observer) observer.disconnect();
      };
    }

    const activePathEl = pathRefs.current[activeDestId];
    if (!activePathEl || !particleRef.current) {
      return () => {
        if (observer) observer.disconnect();
      };
    }

    let pathLength = 0;
    try {
      pathLength = activePathEl.getTotalLength();
    } catch {
      return () => {
        if (observer) observer.disconnect();
      };
    }

    if (pathLength <= 0) {
      return () => {
        if (observer) observer.disconnect();
      };
    }

    const progressObj = { t: 0 };
    const ctx = gsap.context(() => {
      tweenRef.current = gsap.to(progressObj, {
        t: 1,
        duration: 2.2,
        repeat: -1,
        ease: 'power1.inOut',
        onUpdate: () => {
          if (!activePathEl || !particleRef.current) return;
          try {
            const point = activePathEl.getPointAtLength(progressObj.t * pathLength);
            particleRef.current.setAttribute('cx', String(point.x));
            particleRef.current.setAttribute('cy', String(point.y));
          } catch {
            // Ignore SVG calculation during resize
          }
        },
      });
    }, containerRef);

    return () => {
      if (observer) observer.disconnect();
      if (tweenRef.current) tweenRef.current.kill();
      ctx.revert();
    };
  }, [activeDestId, nodes, edges]);

  return (
    <div
      ref={containerRef}
      className={`bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-6 sm:p-7 relative overflow-hidden flex flex-col justify-between shadow-[0_4px_20px_-2px_rgba(24,124,112,0.06),0_2px_6px_-1px_rgba(0,0,0,0.03)] ${className}`}
    >
      {/* Visual Header */}
      <div className="flex items-center justify-between pb-3.5 mb-2 border-b border-[#E1E7E3]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-[#E2F4ED] border border-[#C8E7DC] flex items-center justify-center text-[#187C70]">
            <GitFork className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs sm:text-sm text-[#18221F]">
                Live Flow Tracer
              </span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#187C70] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#187C70]"></span>
              </span>
            </div>
            <p className="text-[11px] text-[#66736D]">
              Stage 3 · Directional Hop Traversal
            </p>
          </div>
        </div>

        {/* Demo Root Switcher */}
        <div className="flex items-center bg-[#F0F4F2] p-0.5 rounded-full border border-[#E1E7E3] text-[11px] font-mono">
          <button
            type="button"
            onClick={() => setRootAccountId('ACC-000001')}
            className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
              rootAccountId === 'ACC-000001'
                ? 'bg-[#FFFFFF] text-[#187C70] font-bold shadow-xs border border-[#C8E7DC]'
                : 'text-[#66736D] hover:text-[#18221F]'
            }`}
            title="Inspect Scam Victim Demo Flow"
          >
            Victim
          </button>
          <button
            type="button"
            onClick={() => setRootAccountId('ACC-000002')}
            className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
              rootAccountId === 'ACC-000002'
                ? 'bg-[#FFFFFF] text-[#187C70] font-bold shadow-xs border border-[#C8E7DC]'
                : 'text-[#66736D] hover:text-[#18221F]'
            }`}
            title="Inspect Money Mule Demo Flow"
          >
            Mule
          </button>
        </div>
      </div>

      {/* SVG Flow Canvas */}
      <div className="relative w-full aspect-[2/1] min-h-[210px] sm:min-h-[230px] bg-[#F0F4F2]/70 rounded-2xl border border-[#E1E7E3] p-2 select-none overflow-hidden blueprint-grid-light">
        <svg
          viewBox="0 0 480 240"
          className="w-full h-full overflow-visible"
          aria-label="Interactive money flow visualization"
        >
          <defs>
            <linearGradient id="activeFlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#187C70" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#2DD4BF" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="inactiveFlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#D1D8D4" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#D1D8D4" stopOpacity="0.9" />
            </linearGradient>
            <filter id="particleGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#187C70" floodOpacity="0.35" />
            </filter>
            {/* Directional Arrow Marker */}
            <marker
              id="flowArrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 7 5 L 0 8 z" fill="#187C70" />
            </marker>
          </defs>

          {/* Connection Curves */}
          {downstreamNodes.map((destNode, idx) => {
            const destCoord = destCoordsList[idx] || { x: 348, y: 120 };
            const isSelected = destNode.account_id === activeDestId;
            const controlOffset = 135;
            const d = `M ${originCoords.x} ${originCoords.y} C ${originCoords.x + controlOffset} ${originCoords.y}, ${destCoord.x - controlOffset} ${destCoord.y}, ${destCoord.x} ${destCoord.y}`;

            return (
              <g key={`edge-${destNode.account_id}`}>
                {/* Visual Path Line */}
                <path
                  d={d}
                  fill="none"
                  stroke={isSelected ? 'url(#activeFlowGradient)' : 'url(#inactiveFlowGradient)'}
                  strokeWidth={isSelected ? '2.5' : '1.5'}
                  strokeDasharray={isSelected ? 'none' : '4 4'}
                  markerEnd={isSelected ? 'url(#flowArrow)' : undefined}
                  className="transition-all duration-300"
                />
                {/* Hidden tracking path for particle motion */}
                <path
                  ref={(el) => {
                    pathRefs.current[destNode.account_id] = el;
                  }}
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="1"
                />
              </g>
            );
          })}

          {/* Animated Teal Particle traveling along selected path */}
          <circle
            ref={particleRef}
            cx={originCoords.x}
            cy={originCoords.y}
            r="4.5"
            fill="#187C70"
            filter="url(#particleGlow)"
            className="transition-opacity duration-200"
          />

          {/* Origin Node (Root) */}
          <g
            transform={`translate(${originCoords.x}, ${originCoords.y})`}
            className="cursor-pointer"
            onClick={() => onSelectAccount && onSelectAccount(rootNode.account_id)}
          >
            {/* Pulsing radar aura */}
            <circle r="22" fill="#187C70" fillOpacity="0.12" className="animate-pulse" />
            <circle r="16" fill="#FFFFFF" stroke="#187C70" strokeWidth="2.5" />
            <circle r="5" fill="#187C70" />
            <text
              y="-24"
              textAnchor="middle"
              className="text-[10px] font-mono font-bold fill-[#18221F]"
            >
              Origin: {rootNode.account_id}
            </text>
            <text
              y="30"
              textAnchor="middle"
              className="text-[10px] font-sans fill-[#66736D] font-medium"
            >
              {rootNode.customer_name.split(' ')[0]} (Source)
            </text>
          </g>

          {/* Downstream Nodes */}
          {downstreamNodes.map((destNode, idx) => {
            const destCoord = destCoordsList[idx] || { x: 348, y: 120 };
            const isSelected = destNode.account_id === activeDestId;
            const matchingEdge = edges.find((e) => e.destination_account_id === destNode.account_id);

            return (
              <g
                key={`node-${destNode.account_id}`}
                transform={`translate(${destCoord.x}, ${destCoord.y})`}
                className="cursor-pointer group"
                onMouseEnter={() => setHoveredNodeId(destNode.account_id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  setSelectedDestId(destNode.account_id);
                  if (onSelectAccount) onSelectAccount(destNode.account_id);
                }}
              >
                {/* Node Target Halo */}
                <circle
                  r={isSelected ? '20' : '15'}
                  fill={isSelected ? '#187C70' : '#E2F4ED'}
                  fillOpacity={isSelected ? '0.15' : '0.5'}
                  className="transition-all duration-200"
                />
                <circle
                  r="13"
                  fill="#FFFFFF"
                  stroke={isSelected ? '#187C70' : '#E1E7E3'}
                  strokeWidth={isSelected ? '2.5' : '1.5'}
                  className="transition-all duration-200 group-hover:stroke-[#187C70]"
                />
                <circle
                  r="4"
                  fill={isSelected ? '#187C70' : '#8E9B95'}
                  className="transition-all duration-200"
                />

                {/* Account ID Label */}
                <text
                  x="20"
                  y="-4"
                  className={`text-[10px] font-mono font-bold transition-all ${
                    isSelected ? 'fill-[#187C70]' : 'fill-[#18221F]'
                  }`}
                >
                  ID: {destNode.account_id}
                </text>

                {/* Name & Transfer Amount Label */}
                <text
                  x="20"
                  y="10"
                  className="text-[9.5px] font-sans fill-[#66736D] font-normal"
                >
                  {destNode.customer_name}
                  {matchingEdge ? ` · ₹${matchingEdge.amount.toLocaleString('en-IN')}` : ''}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Instruction Overlay Badge */}
        <div className="absolute top-2.5 left-3 bg-[#FFFFFF]/90 backdrop-blur-xs border border-[#E1E7E3] px-2.5 py-0.5 rounded-full text-[10px] text-[#66736D] font-mono shadow-2xs">
          Hover node to trace · Click to inspect
        </div>
      </div>

      {/* Real Telemetry Strip for Selected Node with Smooth Framer Motion Transition */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeDestId}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="mt-3 pt-3 border-t border-[#E1E7E3] flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[#187C70]" />
            <span className="text-[#18221F] font-semibold text-[11px] sm:text-xs">
              Path: {rootNode.customer_name.split(' ')[0]} ➔{' '}
              <span className="text-[#187C70] font-bold">
                {activeDestNode ? activeDestNode.customer_name : 'Counterparty'}
              </span>
            </span>
            {activeEdge && (
              <span className="font-mono text-[11px] text-[#187C70] bg-[#E2F4ED] px-2.5 py-0.5 rounded-md border border-[#C8E7DC]">
                ₹{activeEdge.amount.toLocaleString('en-IN')} ({activeEdge.channel})
              </span>
            )}
          </div>

          {activeDestNode && (
            <button
              type="button"
              onClick={() => onSelectAccount && onSelectAccount(activeDestNode.account_id)}
              className="text-[11px] font-bold text-[#187C70] hover:text-[#12675D] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>Open {activeDestNode.account_id}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Attribution Safeguard Notice */}
      <div className="mt-2.5 text-[10px] text-[#8E9B95] leading-tight font-sans">
        * Illustrative trace simulation from synthetic ledger data. Hop amounts reflect single transfers and are not aggregated into unverified totals.
      </div>
    </div>
  );
};
