import React, { useEffect, useRef, useState } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Layers,
  AlertTriangle,
  ArrowRight,
  Info,
  List,
  Network,
  ExternalLink,
  Shield,
  CreditCard,
} from 'lucide-react';
import { V2GraphEdge, V2GraphNode, V2TraceGraphResponse } from '../../types/v2';
import { useNavigate } from 'react-router-dom';

interface V2CytoscapeGraphProps {
  traceData: V2TraceGraphResponse;
  onSelectNode?: (node: V2GraphNode | null) => void;
  height?: string;
}

export const V2CytoscapeGraph: React.FC<V2CytoscapeGraphProps> = ({
  traceData,
  onSelectNode,
  height = '560px',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const navigate = useNavigate();

  const [selectedNode, setSelectedNode] = useState<V2GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<V2GraphEdge | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [layoutMode, setLayoutMode] = useState<'concentric' | 'cose' | 'breadthfirst' | 'circle'>('concentric');

  // Node lookup map
  const nodeMap = useRef<Map<string, V2GraphNode>>(new Map());
  const edgeMap = useRef<Map<string, V2GraphEdge>>(new Map());

  useEffect(() => {
    nodeMap.current.clear();
    traceData.nodes.forEach((n) => nodeMap.current.set(n.account_id, n));

    edgeMap.current.clear();
    traceData.edges.forEach((e) => edgeMap.current.set(e.transaction_id, e));
  }, [traceData]);

  useEffect(() => {
    if (!containerRef.current || viewMode !== 'graph') return;

    // Convert V2 nodes to Cytoscape elements
    const elements: any[] = [];
    const nodeIds = new Set<string>();

    traceData.nodes.forEach((n) => {
      nodeIds.add(n.account_id);
      elements.push({
        group: 'nodes',
        data: {
          id: n.account_id,
          label: `${n.customer_name}\n${n.account_id}`,
          name: n.customer_name,
          accountId: n.account_id,
          balance: n.current_balance,
          isRoot: n.is_root,
          hop: n.hop_distance,
          customerType: n.customer_type,
          kycTier: n.kyc_tier,
        },
      });
    });

    // Check for any edge whose source or destination was truncated by max_nodes limit
    traceData.edges.forEach((e) => {
      if (!nodeIds.has(e.origin_account_id)) {
        nodeIds.add(e.origin_account_id);
        elements.push({
          group: 'nodes',
          data: {
            id: e.origin_account_id,
            label: `Perimeter Node\n${e.origin_account_id}`,
            name: 'Perimeter Entity (Truncated Hop)',
            accountId: e.origin_account_id,
            balance: 0,
            isRoot: false,
            hop: e.hop,
            customerType: 'external',
            kycTier: 'unmonitored',
          },
        });
      }

      if (!nodeIds.has(e.destination_account_id)) {
        nodeIds.add(e.destination_account_id);
        elements.push({
          group: 'nodes',
          data: {
            id: e.destination_account_id,
            label: `Perimeter Node\n${e.destination_account_id}`,
            name: 'Perimeter Entity (Truncated Hop)',
            accountId: e.destination_account_id,
            balance: 0,
            isRoot: false,
            hop: e.hop,
            customerType: 'external',
            kycTier: 'unmonitored',
          },
        });
      }

      elements.push({
        group: 'edges',
        data: {
          id: e.transaction_id,
          source: e.origin_account_id,
          target: e.destination_account_id,
          amount: e.amount,
          channel: e.channel,
          isCycle: e.is_cycle,
          label: `₹${e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n${e.channel}`,
        },
      });
    });

    try {
      const cy = cytoscape({
      container: containerRef.current,
      elements,
      boxSelectionEnabled: false,
      autounselectify: false,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'font-family': 'ui-sans-serif, system-ui, sans-serif',
            'font-size': '10px',
            'font-weight': 600,
            color: '#0F172A',
            'background-color': '#FFFFFF',
            'border-width': 2,
            'border-color': '#94A3B8',
            width: 140,
            height: 52,
            shape: 'round-rectangle',
            'text-margin-y': 0,
            'text-max-width': '125px',
          },
        },
        // Root account styling (Teal accent)
        {
          selector: 'node[?isRoot]',
          style: {
            'border-width': 3,
            'border-color': '#0D9488',
            'background-color': '#F0FDFA',
            color: '#0F766E',
            width: 155,
            height: 60,
            'font-size': '11px',
            'font-weight': 700,
          },
        },
        // Selected node highlight
        {
          selector: 'node:selected',
          style: {
            'border-color': '#2563EB',
            'border-width': 4,
            'background-color': '#EFF6FF',
          },
        },
        // Directed transaction edge styling
        {
          selector: 'edge',
          style: {
            width: 2.5,
            'line-color': '#94A3B8',
            'target-arrow-color': '#94A3B8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '9px',
            'font-family': 'ui-monospace, monospace',
            'font-weight': 600,
            color: '#334155',
            'text-background-opacity': 0.95,
            'text-background-color': '#FFFFFF',
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
            'arrow-scale': 1.2,
          },
        },
        // Cyclic edges (Amber/Red loop)
        {
          selector: 'edge[?isCycle]',
          style: {
            width: 3.5,
            'line-color': '#D97706',
            'target-arrow-color': '#D97706',
            'line-style': 'dashed',
            color: '#B45309',
            'text-background-color': '#FEF3C7',
          },
        },
        // Selected edge highlight
        {
          selector: 'edge:selected',
          style: {
            width: 4,
            'line-color': '#2563EB',
            'target-arrow-color': '#2563EB',
          },
        },
      ],
      layout: (layoutMode === 'concentric'
        ? {
            name: 'concentric',
            concentric: (node: any) => (node.data('isRoot') ? 10 : Math.max(1, 6 - (node.data('hop') || 1))),
            levelWidth: () => 1,
            padding: 40,
            spacingFactor: 1.15,
            avoidOverlap: true,
            minNodeSpacing: 30,
          }
        : layoutMode === 'cose'
        ? {
            name: 'cose',
            animate: false,
            padding: 40,
            nodeRepulsion: 450000,
            idealEdgeLength: 100,
          }
        : layoutMode === 'circle'
        ? {
            name: 'circle',
            padding: 40,
            avoidOverlap: true,
          }
        : {
            name: 'breadthfirst',
            directed: true,
            padding: 40,
            spacingFactor: 1.2,
            avoidOverlap: true,
          }) as any,
    });

    cyRef.current = cy;

    // Node click handler
    cy.on('tap', 'node', (evt: EventObject) => {
      const accId = evt.target.data('id');
      const node = nodeMap.current.get(accId) || null;
      setSelectedNode(node);
      setSelectedEdge(null);
      if (onSelectNode) onSelectNode(node);
    });

    // Edge click handler
    cy.on('tap', 'edge', (evt: EventObject) => {
      const txnId = evt.target.data('id');
      const edge = edgeMap.current.get(txnId) || null;
      setSelectedEdge(edge);
      setSelectedNode(null);
    });

    // Background click handler
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        setSelectedNode(null);
        setSelectedEdge(null);
        if (onSelectNode) onSelectNode(null);
      }
    });

    const timer = setTimeout(() => {
      if (cyRef.current) {
        cyRef.current.resize();
        cyRef.current.fit(undefined, 30);
      }
    }, 150);

    const resizeObserver = new ResizeObserver(() => {
      if (cyRef.current) {
        cyRef.current.resize();
      }
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  } catch (err) {
      console.error('Cytoscape graph initialization error:', err);
    }
  }, [traceData, layoutMode, viewMode]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 40);
  const handleReset = () => {
    setSelectedNode(null);
    setSelectedEdge(null);
    cyRef.current?.fit(undefined, 40);
  };

  return (
    <div className="space-y-3">
      {/* Top Controls & Exposure Guardrail Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Exposure Totals */}
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-slate-500 block text-[11px]">Observed Ledger Movement:</span>
              <span className="font-mono font-bold text-slate-800 text-sm">
                ₹{traceData.observed_total_transferred.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="border-l border-slate-200 pl-4">
              <span className="text-slate-500 block text-[11px] flex items-center gap-1">
                Attributed Exposure Ceiling:
                <span title="Upper bound of funds originating from root account. Downstream transfers are NOT double-counted.">
                  <Info className="w-3 h-3 text-slate-400" />
                </span>
              </span>
              <span className="font-mono font-bold text-teal-700 text-sm">
                ₹{traceData.attributed_exposure_upper_bound.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="border-l border-slate-200 pl-4">
              <span className="text-slate-500 block text-[11px]">Explored Graph:</span>
              <span className="font-mono text-slate-700 font-semibold">
                {traceData.total_nodes} Accounts · {traceData.total_edges} Transfers
              </span>
            </div>
          </div>

          {/* View & Layout Toggles */}
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-slate-200 overflow-hidden bg-slate-50 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode('graph')}
                className={`px-2.5 py-1 flex items-center gap-1 font-medium transition-colors ${
                  viewMode === 'graph' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                Graph Canvas
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 flex items-center gap-1 font-medium transition-colors ${
                  viewMode === 'table' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Transfers List
              </button>
            </div>

            {viewMode === 'graph' && (
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as any)}
                aria-label="Graph Layout Mode"
                className="bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 font-medium focus:outline-none focus:border-[#0D9488]"
              >
                <option value="concentric">Radial Hop Perimeter</option>
                <option value="cose">Force Directed (Organic)</option>
                <option value="breadthfirst">Hierarchical Flow</option>
                <option value="circle">Circular Topology</option>
              </select>
            )}
          </div>
        </div>

        {/* Truncation Warning */}
        {traceData.is_truncated && (
          <div className="mt-2.5 flex items-center gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Graph Truncated:</strong> {traceData.truncation_reason} Increase max depth or node limits to expand further.
            </span>
          </div>
        )}
      </div>

      {/* Main Canvas / Table Area */}
      {viewMode === 'graph' ? (
        <div className="relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50 shadow-inner">
          {/* Cytoscape DOM container */}
          <div ref={containerRef} style={{ height }} className="w-full bg-[#FAF9F6]" />

          {/* Floating Canvas Controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-md p-1 shadow-sm">
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleFit}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900"
              title="Fit View"
              aria-label="Fit View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleReset}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900"
              title="Reset Selection"
              aria-label="Reset Selection"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Legend Overlay */}
          <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-md px-3 py-2 text-[11px] text-slate-600 shadow-sm flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-teal-50 border-2 border-[#0D9488]" />
              Root Account
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-white border border-slate-400" />
              Downstream Hop
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 border-t-2 border-dashed border-amber-600" />
              Circular Transfer Loop
            </span>
          </div>

          {/* Selected Entity Inspector Card */}
          {selectedNode && (
            <div className="absolute top-3 left-3 w-80 bg-white border border-slate-300 rounded-lg p-3.5 shadow-md text-xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    {selectedNode.is_root ? 'ROOT INVESTIGATION ACCOUNT' : `HOP ${selectedNode.hop_distance} COUNTERPARTY`}
                  </span>
                  <h5 className="font-semibold text-slate-900 text-sm">{selectedNode.customer_name}</h5>
                  <span className="font-mono text-slate-500 text-[11px]">{selectedNode.account_id}</span>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-slate-400 hover:text-slate-600 text-base font-bold leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Type</span>
                  <span className="capitalize text-slate-700">{selectedNode.customer_type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">KYC Tier</span>
                  <span className="capitalize text-slate-700">{selectedNode.kyc_tier.replace(/_/g, ' ')}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[10px]">Balance</span>
                  <span className="font-bold text-slate-800">
                    ₹{selectedNode.current_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/v2/accounts/${selectedNode.account_id}`)}
                className="w-full mt-2 py-1.5 px-3 rounded bg-[#0D9488] hover:bg-[#0F766E] text-white font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>Open Account 360° Profile</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {selectedEdge && (
            <div className="absolute top-3 left-3 w-80 bg-white border border-slate-300 rounded-lg p-3.5 shadow-md text-xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    {selectedEdge.is_cycle ? 'CIRCULAR TRANSFER LOOP' : `HOP ${selectedEdge.hop} DIRECTED TRANSFER`}
                  </span>
                  <h5 className="font-mono font-bold text-slate-900 text-sm">
                    ₹{selectedEdge.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </h5>
                  <span className="font-mono text-slate-500 text-[11px]">{selectedEdge.transaction_id}</span>
                </div>
                <button
                  onClick={() => setSelectedEdge(null)}
                  className="text-slate-400 hover:text-slate-600 text-base font-bold leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="pt-1 border-t border-slate-100 font-mono text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Channel:</span>
                  <span className="text-slate-800 font-bold">{selectedEdge.channel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Timestamp:</span>
                  <span className="text-slate-700">{selectedEdge.timestamp.replace('T', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Origin:</span>
                  <span className="text-teal-700 font-semibold">{selectedEdge.origin_account_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Destination:</span>
                  <span className="text-teal-700 font-semibold">{selectedEdge.destination_account_id}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Alternative Tabular View */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <tr>
                  <th className="px-3 py-2.5">Hop</th>
                  <th className="px-3 py-2.5">Transaction ID</th>
                  <th className="px-3 py-2.5">Origin Account</th>
                  <th className="px-3 py-2.5">Destination Account</th>
                  <th className="px-3 py-2.5">Channel</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Timestamp</th>
                  <th className="px-3 py-2.5">Loop</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {traceData.edges.map((e) => (
                  <tr key={e.transaction_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-slate-500 font-semibold">{e.hop}</td>
                    <td className="px-3 py-2 text-slate-700">{e.transaction_id}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => navigate(`/v2/accounts/${e.origin_account_id}`)}
                        className="text-teal-700 hover:underline hover:text-teal-900"
                      >
                        {e.origin_account_id}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => navigate(`/v2/accounts/${e.destination_account_id}`)}
                        className="text-teal-700 hover:underline hover:text-teal-900"
                      >
                        {e.destination_account_id}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-sans">
                        {e.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                      ₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-[11px]">{e.timestamp.replace('T', ' ')}</td>
                    <td className="px-3 py-2">
                      {e.is_cycle && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-sans font-semibold">
                          Cycle
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
