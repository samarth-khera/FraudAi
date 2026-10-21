import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { GitFork, ArrowRight, ShieldCheck, Activity, RefreshCw } from 'lucide-react';
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

  const [rootAccountId, setRootAccountId] = useState<'ACC-000001' | 'ACC-000002'>('ACC-000001');
  const [nodes, setNodes] = useState<V2GraphNode[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<V2GraphEdge[]>(INITIAL_EDGES);
  const [selectedDestId, setSelectedDestId] = useState<string>('ACC-000414');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  // Origin node sits at (80, 120)
  // Up to 3 downstream nodes sit at (380, 50), (380, 120), (380, 190)
  const rootNode = nodes.find((n) => n.is_root) || nodes[0] || INITIAL_NODES[0];
  const downstreamNodes = nodes.filter((n) => n.account_id !== rootNode.account_id).slice(0, 3);

  const originCoords = { x: 74, y: 120 };
  const destCoordsList = [
    { x: 396, y: 48 },
    { x: 396, y: 120 },
    { x: 396, y: 192 },
  ];

  // Active path selection
  const activeDestId = hoveredNodeId || selectedDestId || (downstreamNodes[0]?.account_id ?? '');
  const activeEdge = edges.find(
    (e) => e.destination_account_id === activeDestId || e.origin_account_id === activeDestId
  );
  const activeDestNode = downstreamNodes.find((n) => n.account_id === activeDestId);

  // GSAP Particle Flow along active path
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !containerRef.current) return;

    const activePathEl = pathRefs.current[activeDestId];
    if (!activePathEl || !particleRef.current) return;

    let pathLength = 0;
    try {
      pathLength = activePathEl.getTotalLength();
    } catch {
      return;
    }

    if (pathLength <= 0) return;

    const progressObj = { t: 0 };
    const ctx = gsap.context(() => {
      gsap.to(progressObj, {
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
      ctx.revert();
    };
  }, [activeDestId, nodes, edges]);

  return (
    <div
      ref={containerRef}
      className={`v2-card p-6 sm:p-7 relative overflow-hidden flex flex-col justify-between ${className}`}
    >
      {/* Visual Header */}
      <div className="flex items-center justify-between pb-3.5 mb-2 border-b border-[#F2ECE2]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500]">
            <GitFork className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs sm:text-sm text-[#1C1917]">
                Live Flow Tracer
              </span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EA8500] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#EA8500]"></span>
              </span>
            </div>
            <p className="text-[11px] text-[#78716C]">
              Forensic Multi-Hop Transaction Path
            </p>
          </div>
        </div>

        {/* Demo Root Switcher */}
        <div className="flex items-center bg-[#FAF7F2] p-0.5 rounded-full border border-[#EAE3D6] text-[11px] font-mono">
          <button
            type="button"
            onClick={() => setRootAccountId('ACC-000001')}
            className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
              rootAccountId === 'ACC-000001'
                ? 'bg-[#EA8500] text-white font-bold shadow-xs'
                : 'text-[#78716C] hover:text-[#1C1917]'
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
                ? 'bg-[#EA8500] text-white font-bold shadow-xs'
                : 'text-[#78716C] hover:text-[#1C1917]'
            }`}
            title="Inspect Money Mule Demo Flow"
          >
            Mule
          </button>
        </div>
      </div>

      {/* SVG Flow Canvas */}
      <div className="relative w-full aspect-[2/1] min-h-[200px] sm:min-h-[220px] bg-[#FAF7F2]/60 rounded-2xl border border-[#EAE3D6]/70 p-2 select-none">
        <svg
          viewBox="0 0 480 240"
          className="w-full h-full overflow-visible"
          aria-label="Interactive money flow visualization"
        >
          <defs>
            <linearGradient id="activeFlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EA8500" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#EA8500" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="inactiveFlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#D6CEBF" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#D6CEBF" stopOpacity="0.6" />
            </linearGradient>
            <filter id="particleGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Connection Curves */}
          {downstreamNodes.map((destNode, idx) => {
            const destCoord = destCoordsList[idx] || { x: 396, y: 120 };
            const isSelected = destNode.account_id === activeDestId;
            const controlOffset = 160;
            const d = `M ${originCoords.x} ${originCoords.y} C ${originCoords.x + controlOffset} ${originCoords.y}, ${destCoord.x - controlOffset} ${destCoord.y}, ${destCoord.x} ${destCoord.y}`;

            return (
              <g key={`edge-${destNode.account_id}`}>
                {/* Background path line */}
                <path
                  d={d}
                  fill="none"
                  stroke={isSelected ? 'url(#activeFlowGradient)' : 'url(#inactiveFlowGradient)'}
                  strokeWidth={isSelected ? '3' : '1.5'}
                  strokeDasharray={isSelected ? 'none' : '4 4'}
                  className="transition-all duration-300"
                />
                {/* Hidden reference path for GSAP particle tracking */}
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

          {/* Animated Particle traveling along selected path */}
          <circle
            ref={particleRef}
            cx={originCoords.x}
            cy={originCoords.y}
            r="5"
            fill="#EA8500"
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
            <circle r="22" fill="#EA8500" fillOpacity="0.12" className="animate-pulse" />
            <circle r="16" fill="#FFFFFF" stroke="#EA8500" strokeWidth="2.5" />
            <circle r="6" fill="#EA8500" />
            <text
              y="-24"
              textAnchor="middle"
              className="text-[10px] font-mono font-bold fill-[#1C1917]"
            >
              Origin: {rootNode.account_id}
            </text>
            <text
              y="30"
              textAnchor="middle"
              className="text-[10px] font-sans fill-[#78716C] font-medium"
            >
              {rootNode.customer_name.split(' ')[0]} (Source)
            </text>
          </g>

          {/* Downstream Nodes */}
          {downstreamNodes.map((destNode, idx) => {
            const destCoord = destCoordsList[idx] || { x: 396, y: 120 };
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
                  fill={isSelected ? '#EA8500' : '#FAF7F2'}
                  fillOpacity={isSelected ? '0.15' : '0.8'}
                  className="transition-all duration-200"
                />
                <circle
                  r="13"
                  fill="#FFFFFF"
                  stroke={isSelected ? '#EA8500' : '#D6CEBF'}
                  strokeWidth={isSelected ? '2.5' : '1.5'}
                  className="transition-all duration-200 group-hover:stroke-[#EA8500]"
                />
                <circle
                  r="4.5"
                  fill={isSelected ? '#EA8500' : '#78716C'}
                  className="transition-all duration-200"
                />

                {/* Account ID Label */}
                <text
                  x="20"
                  y="-4"
                  className={`text-[10px] font-mono font-bold transition-all ${
                    isSelected ? 'fill-[#EA8500]' : 'fill-[#1C1917]'
                  }`}
                >
                  ID: {destNode.account_id}
                </text>

                {/* Name & Transfer Amount Label */}
                <text
                  x="20"
                  y="10"
                  className="text-[9.5px] font-sans fill-[#78716C] font-normal"
                >
                  {destNode.customer_name}
                  {matchingEdge ? ` · ₹${matchingEdge.amount.toLocaleString('en-IN')}` : ''}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Instruction Overlay Badge */}
        <div className="absolute top-2.5 left-3 bg-[#FFFFFF]/90 backdrop-blur-xs border border-[#EAE3D6] px-2.5 py-0.5 rounded-full text-[10px] text-[#78716C] font-mono shadow-xs">
          Hover node to trace · Click to inspect
        </div>
      </div>

      {/* Real Telemetry Strip for Selected Node */}
      <div className="mt-3 pt-3 border-t border-[#F2ECE2] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#EA8500]" />
          <span className="text-[#1C1917] font-semibold text-[11px] sm:text-xs">
            Path: {rootNode.customer_name.split(' ')[0]} ➔{' '}
            <span className="text-[#EA8500] font-bold">
              {activeDestNode ? activeDestNode.customer_name : 'Counterparty'}
            </span>
          </span>
          {activeEdge && (
            <span className="font-mono text-[11px] text-[#78716C] bg-[#FAF7F2] px-2 py-0.5 rounded-md border border-[#EAE3D6]">
              ₹{activeEdge.amount.toLocaleString('en-IN')} ({activeEdge.channel})
            </span>
          )}
        </div>

        {activeDestNode && (
          <button
            type="button"
            onClick={() => onSelectAccount && onSelectAccount(activeDestNode.account_id)}
            className="text-[11px] font-bold text-[#EA8500] hover:text-[#D27400] flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Open {activeDestNode.account_id}</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
