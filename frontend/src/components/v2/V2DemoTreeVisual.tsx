import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { GitFork, ArrowRight, Activity, ExternalLink, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface TreeNodeData {
  id: string;
  name: string;
  type: 'retail' | 'sme' | 'student';
  kyc: string;
  balance: number;
  hop: 0 | 1 | 2;
  parentId?: string;
  txAmount?: number;
  txChannel?: string;
  txId?: string;
}

interface TreeScenario {
  rootId: string;
  label: string;
  subtitle: string;
  nodes: TreeNodeData[];
}

const TREE_SCENARIOS: Record<'victim' | 'mule', TreeScenario> = {
  victim: {
    rootId: 'ACC-000001',
    label: 'Victim Demo',
    subtitle: 'High-Value Outflow Dispersion',
    nodes: [
      // Hop 0: Root
      {
        id: 'ACC-000001',
        name: 'Aditi Joshi',
        type: 'retail',
        kyc: 'Tier-2 Verified',
        balance: 177156.23,
        hop: 0,
      },
      // Hop 1: First Transfer Recipients
      {
        id: 'ACC-000003',
        name: 'Ishan Reddy',
        type: 'retail',
        kyc: 'Tier-2 Verified',
        balance: 107228.33,
        hop: 1,
        parentId: 'ACC-000001',
        txAmount: 250000.0,
        txChannel: 'IMPS',
        txId: 'TXN-0062181',
      },
      {
        id: 'ACC-002867',
        name: 'FreshMart Express #18',
        type: 'sme',
        kyc: 'Tier-2 Verified',
        balance: 512136.07,
        hop: 1,
        parentId: 'ACC-000001',
        txAmount: 2163.53,
        txChannel: 'CARD_POS',
        txId: 'TXN-0008601',
      },
      // Hop 2: Downstream Branches from ACC-000003
      {
        id: 'ACC-002932',
        name: 'Nikhil Chatterjee',
        type: 'student',
        kyc: 'Tier-1 Basic',
        balance: 59656.63,
        hop: 2,
        parentId: 'ACC-000003',
        txAmount: 10528.14,
        txChannel: 'IMPS',
        txId: 'TXN-0006287',
      },
      {
        id: 'ACC-001945',
        name: 'BlueDart Parcel Hub #46',
        type: 'sme',
        kyc: 'Tier-2 Verified',
        balance: 409025.26,
        hop: 2,
        parentId: 'ACC-000003',
        txAmount: 1846.84,
        txChannel: 'CARD_POS',
        txId: 'TXN-0019686',
      },
      {
        id: 'ACC-007103',
        name: 'Star Cafe & Bakery #4',
        type: 'sme',
        kyc: 'Tier-2 Verified',
        balance: 237300.81,
        hop: 2,
        parentId: 'ACC-000003',
        txAmount: 2937.67,
        txChannel: 'UPI',
        txId: 'TXN-0044758',
      },
    ],
  },
  mule: {
    rootId: 'ACC-000002',
    label: 'Mule Demo',
    subtitle: 'Rapid Cash-Out & Pass-Through',
    nodes: [
      // Hop 0: Root
      {
        id: 'ACC-000002',
        name: 'Sara Bhat',
        type: 'student',
        kyc: 'Tier-1 Basic',
        balance: 95267.99,
        hop: 0,
      },
      // Hop 1: First Transfer Recipients
      {
        id: 'ACC-000009',
        name: 'Prime Digital Hub #10',
        type: 'sme',
        kyc: 'Tier-2 Verified',
        balance: 953160.79,
        hop: 1,
        parentId: 'ACC-000002',
        txAmount: 118000.0,
        txChannel: 'ATM_CASH_OUT',
        txId: 'TXN-0062239',
      },
      {
        id: 'ACC-007286',
        name: 'Varun Chatterjee',
        type: 'retail',
        kyc: 'Tier-1 Basic',
        balance: 420695.99,
        hop: 1,
        parentId: 'ACC-000002',
        txAmount: 11114.11,
        txChannel: 'UPI',
        txId: 'TXN-0053452',
      },
      // Hop 2: Downstream Branches from ACC-000009
      {
        id: 'ACC-004522',
        name: 'Rahul Patel',
        type: 'retail',
        kyc: 'Tier-1 Basic',
        balance: 194027.3,
        hop: 2,
        parentId: 'ACC-000009',
        txAmount: 12520.28,
        txChannel: 'IMPS',
        txId: 'TXN-0001737',
      },
      {
        id: 'ACC-000929',
        name: 'Neha Kumar',
        type: 'retail',
        kyc: 'Tier-1 Basic',
        balance: 121697.34,
        hop: 2,
        parentId: 'ACC-000009',
        txAmount: 12996.7,
        txChannel: 'IMPS',
        txId: 'TXN-0010604',
      },
      {
        id: 'ACC-004226',
        name: 'Sunita Chatterjee',
        type: 'retail',
        kyc: 'Tier-2 Verified',
        balance: 125758.15,
        hop: 2,
        parentId: 'ACC-000009',
        txAmount: 4605.7,
        txChannel: 'IMPS',
        txId: 'TXN-0024272',
      },
    ],
  },
};

interface V2DemoTreeVisualProps {
  onSelectAccount?: (accountId: string) => void;
  className?: string;
}

export const V2DemoTreeVisual: React.FC<V2DemoTreeVisualProps> = ({
  onSelectAccount,
  className = '',
}) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const particleRef = useRef<SVGCircleElement>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const [activeScenarioKey, setActiveScenarioKey] = useState<'victim' | 'mule'>('victim');
  const scenario = TREE_SCENARIOS[activeScenarioKey];

  // Selected node (default to primary Hop 1 node)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('ACC-000003');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Sync selected node when switching scenario
  useEffect(() => {
    if (activeScenarioKey === 'victim') {
      setSelectedNodeId('ACC-000003');
    } else {
      setSelectedNodeId('ACC-000009');
    }
  }, [activeScenarioKey]);

  const activeNodeId = hoveredNodeId || selectedNodeId;
  const activeNode = scenario.nodes.find((n) => n.id === activeNodeId) || scenario.nodes[1];

  // SVG coordinates for a 3-tier horizontal tree (viewBox: 520 x 240)
  // Column 1 (Hop 0): X = 65, Y = 120
  // Column 2 (Hop 1): X = 230, Y = [70, 170]
  // Column 3 (Hop 2): X = 415, Y = [45, 120, 195]
  const nodeCoords: Record<string, { x: number; y: number }> = {
    // Victim tree
    'ACC-000001': { x: 65, y: 120 },
    'ACC-000003': { x: 230, y: 75 },
    'ACC-002867': { x: 230, y: 175 },
    'ACC-002932': { x: 420, y: 45 },
    'ACC-001945': { x: 420, y: 120 },
    'ACC-007103': { x: 420, y: 195 },

    // Mule tree
    'ACC-000002': { x: 65, y: 120 },
    'ACC-000009': { x: 230, y: 75 },
    'ACC-007286': { x: 230, y: 175 },
    'ACC-004522': { x: 420, y: 45 },
    'ACC-000929': { x: 420, y: 120 },
    'ACC-004226': { x: 420, y: 195 },
  };

  // Build tree edges
  const edges = scenario.nodes
    .filter((n) => n.parentId)
    .map((n) => ({
      source: n.parentId!,
      target: n.id,
      amount: n.txAmount || 0,
      channel: n.txChannel || 'IMPS',
      id: n.txId || `${n.parentId}-${n.id}`,
    }));

  // Find active path to animate particle
  // If activeNode is Hop 2: path is Root -> Parent -> Target
  // If activeNode is Hop 1: path is Root -> Target
  // If activeNode is Hop 0: path is Root -> Primary Hop 1
  let particlePathD = '';
  const rootNode = scenario.nodes[0];
  const rootCoord = nodeCoords[rootNode.id] || { x: 65, y: 120 };

  if (activeNode.hop === 2 && activeNode.parentId) {
    const parentCoord = nodeCoords[activeNode.parentId] || { x: 230, y: 75 };
    const targetCoord = nodeCoords[activeNode.id] || { x: 420, y: 45 };
    particlePathD = `M ${rootCoord.x} ${rootCoord.y} C ${rootCoord.x + 80} ${rootCoord.y}, ${parentCoord.x - 80} ${parentCoord.y}, ${parentCoord.x} ${parentCoord.y} C ${parentCoord.x + 80} ${parentCoord.y}, ${targetCoord.x - 80} ${targetCoord.y}, ${targetCoord.x} ${targetCoord.y}`;
  } else if (activeNode.hop === 1) {
    const targetCoord = nodeCoords[activeNode.id] || { x: 230, y: 75 };
    particlePathD = `M ${rootCoord.x} ${rootCoord.y} C ${rootCoord.x + 80} ${rootCoord.y}, ${targetCoord.x - 80} ${targetCoord.y}, ${targetCoord.x} ${targetCoord.y}`;
  } else {
    const firstHop = scenario.nodes[1];
    const targetCoord = nodeCoords[firstHop.id] || { x: 230, y: 75 };
    particlePathD = `M ${rootCoord.x} ${rootCoord.y} C ${rootCoord.x + 80} ${rootCoord.y}, ${targetCoord.x - 80} ${targetCoord.y}, ${targetCoord.x} ${targetCoord.y}`;
  }

  // GSAP animated particle traveling along the active path
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !pathRef.current || !particleRef.current) return;

    let pathLength = 0;
    try {
      pathLength = pathRef.current.getTotalLength();
    } catch {
      return;
    }

    if (pathLength <= 0) return;

    if (tweenRef.current) tweenRef.current.kill();

    const progressObj = { t: 0 };
    tweenRef.current = gsap.to(progressObj, {
      t: 1,
      duration: activeNode.hop === 2 ? 2.6 : 1.8,
      repeat: -1,
      ease: 'power1.inOut',
      onUpdate: () => {
        if (!pathRef.current || !particleRef.current) return;
        try {
          const pt = pathRef.current.getPointAtLength(progressObj.t * pathLength);
          particleRef.current.setAttribute('cx', String(pt.x));
          particleRef.current.setAttribute('cy', String(pt.y));
        } catch {
          // ignore
        }
      },
    });

    return () => {
      if (tweenRef.current) tweenRef.current.kill();
    };
  }, [particlePathD, activeNode.id]);

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (onSelectAccount) {
      onSelectAccount(nodeId);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-7 relative overflow-hidden flex flex-col justify-between shadow-[0_4px_24px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_32px_rgba(180,150,120,0.09)] transition-shadow ${className}`}
    >
      {/* Visual Header */}
      <div className="flex items-center justify-between pb-3.5 mb-2 border-b border-[#EAE3D6]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] shadow-2xs">
            <GitFork className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs sm:text-sm text-[#1A1714]">
                Live Flow Tracer
              </span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EA8500] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#EA8500]"></span>
              </span>
            </div>
            <p className="text-[11px] text-[#6B655B]">
              Stage 3 · Directional Hop Traversal Tree
            </p>
          </div>
        </div>

        {/* Demo Root Switcher */}
        <div className="flex items-center bg-[#FAF7F2] p-1 rounded-full border border-[#EAE3D6] text-[11px] font-mono shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveScenarioKey('victim')}
            className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
              activeScenarioKey === 'victim'
                ? 'bg-white text-[#EA8500] font-bold shadow-xs border border-[#FCD5B5]'
                : 'text-[#6B655B] hover:text-[#1A1714]'
            }`}
            title="Inspect Scam Victim Demo Flow (ACC-000001)"
          >
            Victim
          </button>
          <button
            type="button"
            onClick={() => setActiveScenarioKey('mule')}
            className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
              activeScenarioKey === 'mule'
                ? 'bg-white text-[#EA8500] font-bold shadow-xs border border-[#FCD5B5]'
                : 'text-[#6B655B] hover:text-[#1A1714]'
            }`}
            title="Inspect Money Mule Demo Flow (ACC-000002)"
          >
            Mule
          </button>
        </div>
      </div>

      {/* SVG Tree Canvas (Left-to-Right Hierarchy) */}
      <div className="relative w-full aspect-[2.1/1] min-h-[220px] sm:min-h-[240px] bg-[#FAF7F2]/90 rounded-2xl border border-[#EAE3D6] p-2 select-none overflow-hidden blueprint-grid-warm">
        {/* Tier Column Labels */}
        <div className="absolute top-2 left-3 right-3 flex justify-between text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C857B] pointer-events-none px-2">
          <span>01 · Origin Account</span>
          <span className="text-center">02 · First Transfer</span>
          <span className="text-right">03 · Downstream Branches</span>
        </div>

        <svg
          viewBox="0 0 520 240"
          className="w-full h-full overflow-visible"
          aria-label="Interactive multi-hop money flow tree preview"
        >
          <defs>
            <linearGradient id="activeTreeFlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EA8500" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#D27400" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="inactiveTreeFlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EAE3D6" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#DDD4C4" stopOpacity="0.95" />
            </linearGradient>
            <filter id="particleGlowTree" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="2.5" floodColor="#EA8500" floodOpacity="0.5" />
            </filter>
            <marker
              id="treeFlowArrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 7 5 L 0 8 z" fill="#EA8500" />
            </marker>
          </defs>

          {/* All Tree Edges (Curved Bezier lines) */}
          {edges.map((edge) => {
            const srcCoord = nodeCoords[edge.source] || { x: 65, y: 120 };
            const tgtCoord = nodeCoords[edge.target] || { x: 230, y: 75 };
            const isTargetActive = activeNode.id === edge.target;
            const isParentOfActive = activeNode.parentId === edge.target;
            const isEdgeOnActivePath =
              isTargetActive || (activeNode.parentId === edge.source && activeNode.id === edge.target);

            const dx = tgtCoord.x - srcCoord.x;
            const controlOffset = dx * 0.5;
            const d = `M ${srcCoord.x} ${srcCoord.y} C ${srcCoord.x + controlOffset} ${srcCoord.y}, ${tgtCoord.x - controlOffset} ${tgtCoord.y}, ${tgtCoord.x} ${tgtCoord.y}`;

            return (
              <g key={`edge-${edge.id}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={isEdgeOnActivePath ? 'url(#activeTreeFlow)' : 'url(#inactiveTreeFlow)'}
                  strokeWidth={isEdgeOnActivePath ? '2.5' : '1.5'}
                  strokeDasharray={isEdgeOnActivePath ? undefined : '4 4'}
                  markerEnd={isEdgeOnActivePath ? 'url(#treeFlowArrow)' : undefined}
                  className="transition-all duration-300"
                />
              </g>
            );
          })}

          {/* Hidden path element for GSAP particle motion along the active path */}
          {particlePathD && (
            <path
              ref={pathRef}
              d={particlePathD}
              fill="none"
              stroke="transparent"
              strokeWidth="1"
            />
          )}

          {/* Animated Orange Particle */}
          <circle
            ref={particleRef}
            cx={rootCoord.x}
            cy={rootCoord.y}
            r="4.5"
            fill="#EA8500"
            filter="url(#particleGlowTree)"
            className="transition-opacity duration-200 pointer-events-none"
          />

          {/* Nodes */}
          {scenario.nodes.map((node) => {
            const coord = nodeCoords[node.id] || { x: 65, y: 120 };
            const isSelected = node.id === activeNode.id;
            const isRoot = node.hop === 0;

            return (
              <g
                key={`node-${node.id}`}
                transform={`translate(${coord.x}, ${coord.y})`}
                className="cursor-pointer group"
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => handleNodeClick(node.id)}
              >
                {/* Pulsing aura for Root or Selected */}
                {isSelected && (
                  <circle
                    r={isRoot ? '22' : '19'}
                    fill="#EA8500"
                    fillOpacity="0.14"
                    className="animate-pulse"
                  />
                )}
                <circle
                  r={isRoot ? '16' : '13'}
                  fill="#FFFFFF"
                  stroke={isSelected ? '#EA8500' : isRoot ? '#EA8500' : '#EAE3D6'}
                  strokeWidth={isSelected || isRoot ? '2.5' : '1.5'}
                  className="transition-all duration-200 group-hover:stroke-[#EA8500]"
                />
                <circle
                  r={isRoot ? '5.5' : '4'}
                  fill={isSelected || isRoot ? '#EA8500' : '#6B655B'}
                  className="transition-all duration-200"
                />

                {/* Node ID Label */}
                <text
                  x={isRoot ? 0 : 18}
                  y={isRoot ? -24 : -4}
                  textAnchor={isRoot ? 'middle' : 'start'}
                  className={`text-[9.5px] font-mono font-bold transition-all ${
                    isSelected ? 'fill-[#EA8500]' : 'fill-[#1A1714]'
                  }`}
                >
                  {node.id}
                </text>

                {/* Name / Transfer Amount */}
                <text
                  x={isRoot ? 0 : 18}
                  y={isRoot ? 28 : 10}
                  textAnchor={isRoot ? 'middle' : 'start'}
                  className="text-[9px] font-sans fill-[#6B655B] font-medium"
                >
                  {node.name.length > 14 ? node.name.slice(0, 13) + '…' : node.name}
                  {node.txAmount ? ` · ₹${Math.round(node.txAmount).toLocaleString('en-IN')}` : ''}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Instruction Badge */}
        <div className="absolute bottom-2 left-3 bg-[#FFFFFF]/95 backdrop-blur-xs border border-[#EAE3D6] px-2.5 py-0.5 rounded-full text-[10px] text-[#6B655B] font-mono shadow-xs">
          Hover node to trace · Click to inspect
        </div>
      </div>

      {/* Selected Node Real Telemetry Detail Strip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeNode.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="mt-3 pt-3 border-t border-[#EAE3D6] flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Activity className="w-3.5 h-3.5 text-[#EA8500]" />
            <span className="text-[#1A1714] font-semibold text-[11px] sm:text-xs">
              Selected: <span className="font-mono text-[#EA8500] font-bold">{activeNode.id}</span> ({activeNode.name})
            </span>
            {activeNode.txAmount && (
              <span className="font-mono text-[11px] text-[#C05621] bg-[#FFF4E6] px-2 py-0.5 rounded-md border border-[#FCD5B5]">
                ₹{activeNode.txAmount.toLocaleString('en-IN')} via {activeNode.txChannel}
              </span>
            )}
            <span className="text-[10px] text-[#8C857B] font-mono">
              Balance: ₹{activeNode.balance.toLocaleString('en-IN')} · {activeNode.kyc}
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigate(`/accounts/${activeNode.id}`)}
            className="text-[11px] font-bold text-[#EA8500] hover:text-[#D27400] flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Investigate {activeNode.id}</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </motion.div>
      </AnimatePresence>

      {/* Attribution Safeguard Note */}
      <div className="mt-2 text-[10px] text-[#8C857B] leading-tight font-sans">
        * Synthetic demonstration tree. Hop amounts reflect single transfers and are not aggregated into unverified totals.
      </div>
    </div>
  );
};
