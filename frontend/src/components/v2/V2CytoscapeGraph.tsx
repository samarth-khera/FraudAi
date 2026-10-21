import React, { useEffect, useRef, useState, useMemo } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Info,
  List,
  Network,
  ExternalLink,
  Shield,
  CreditCard,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  X,
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
  const [tableSearch, setTableSearch] = useState('');
  const [onlySelectedNodeTransfers, setOnlySelectedNodeTransfers] = useState(false);

  // Node lookup map
  const nodeMap = useRef<Map<string, V2GraphNode>>(new Map());
  const edgeMap = useRef<Map<string, V2GraphEdge>>(new Map());

  useEffect(() => {
    nodeMap.current.clear();
    traceData.nodes.forEach((n) => nodeMap.current.set(n.account_id, n));

    edgeMap.current.clear();
    traceData.edges.forEach((e) => edgeMap.current.set(e.transaction_id, e));
  }, [traceData]);

  // Connected transfers for selected node
  const connectedTransfers = useMemo(() => {
    if (!selectedNode) return { incoming: [], outgoing: [] };
    const incoming = traceData.edges.filter((e) => e.destination_account_id === selectedNode.account_id);
    const outgoing = traceData.edges.filter((e) => e.origin_account_id === selectedNode.account_id);
    return { incoming, outgoing };
  }, [selectedNode, traceData]);

  // Highlight connected elements in Cytoscape when selectedNode changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // Remove previous highlights
      cy.elements().removeClass('highlighted-selected');
      cy.elements().removeClass('highlighted-incoming');
      cy.elements().removeClass('highlighted-outgoing');
      cy.elements().removeClass('highlighted-neighbor');
      cy.elements().removeClass('dimmed-unconnected');

      if (selectedNode) {
        const nodeId = selectedNode.account_id;
        const cyNode = cy.getElementById(nodeId);

        if (cyNode.length > 0) {
          // Dim everything first
          cy.elements().addClass('dimmed-unconnected');

          // Highlight selected node
          cyNode.removeClass('dimmed-unconnected').addClass('highlighted-selected');

          // Incoming edges & source nodes
          const inEdges = cyNode.incomers('edge');
          inEdges.removeClass('dimmed-unconnected').addClass('highlighted-incoming');
          inEdges.sources().removeClass('dimmed-unconnected').addClass('highlighted-neighbor');

          // Outgoing edges & target nodes
          const outEdges = cyNode.outgoers('edge');
          outEdges.removeClass('dimmed-unconnected').addClass('highlighted-outgoing');
          outEdges.targets().removeClass('dimmed-unconnected').addClass('highlighted-neighbor');
        }
      } else if (selectedEdge) {
        // Dim everything
        cy.elements().addClass('dimmed-unconnected');

        const cyEdge = cy.getElementById(selectedEdge.transaction_id);
        if (cyEdge.length > 0) {
          cyEdge.removeClass('dimmed-unconnected').addClass('highlighted-selected');
          cyEdge.source().removeClass('dimmed-unconnected').addClass('highlighted-neighbor');
          cyEdge.target().removeClass('dimmed-unconnected').addClass('highlighted-neighbor');
        }
      }
    });
  }, [selectedNode, selectedEdge]);

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
          // Directed transaction edge styling
          {
            selector: 'edge',
            style: {
              width: 2.2,
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
              'arrow-scale': 1.15,
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
          // Active Highlights
          {
            selector: '.highlighted-selected',
            style: {
              'border-color': '#0D9488',
              'border-width': 4,
              'background-color': '#CCFBF1',
              'line-color': '#0D9488',
              'target-arrow-color': '#0D9488',
              width: 3.5,
              'z-index': 999,
            },
          },
          {
            selector: '.highlighted-incoming',
            style: {
              'line-color': '#059669',
              'target-arrow-color': '#059669',
              width: 3.5,
              'z-index': 998,
              color: '#065F46',
              'text-background-color': '#D1FAE5',
            },
          },
          {
            selector: '.highlighted-outgoing',
            style: {
              'line-color': '#DC2626',
              'target-arrow-color': '#DC2626',
              width: 3.5,
              'z-index': 998,
              color: '#991B1B',
              'text-background-color': '#FEE2E2',
            },
          },
          {
            selector: '.highlighted-neighbor',
            style: {
              'border-color': '#475569',
              'border-width': 3,
              'background-color': '#F8FAFC',
              'z-index': 997,
            },
          },
          {
            selector: '.dimmed-unconnected',
            style: {
              opacity: 0.18,
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
    if (onSelectNode) onSelectNode(null);
    cyRef.current?.fit(undefined, 40);
  };

  const filteredEdges = useMemo(() => {
    let result = traceData.edges;

    if (onlySelectedNodeTransfers && selectedNode) {
      result = result.filter(
        (e) =>
          e.origin_account_id === selectedNode.account_id ||
          e.destination_account_id === selectedNode.account_id
      );
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      result = result.filter(
        (e) =>
          e.transaction_id.toLowerCase().includes(q) ||
          e.origin_account_id.toLowerCase().includes(q) ||
          e.destination_account_id.toLowerCase().includes(q) ||
          e.channel.toLowerCase().includes(q)
      );
    }

    return result;
  }, [traceData.edges, tableSearch, onlySelectedNodeTransfers, selectedNode]);

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
              <strong>Graph Perimeter Truncated:</strong> {traceData.truncation_reason} Increase depth or node ceiling to expand traversal.
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
          <div className="absolute top-3 right-3 flex flex-col gap-1 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-md p-1 shadow-sm z-10">
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleFit}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Fit View"
              aria-label="Fit View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleReset}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Reset Selection"
              aria-label="Reset Selection"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Legend Overlay */}
          <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-md px-3 py-2 text-[11px] text-slate-600 shadow-sm flex flex-wrap items-center gap-3 z-10">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-teal-50 border-2 border-[#0D9488]" />
              Root Investigation Account
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-white border border-slate-400" />
              Downstream Counterparty
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-600" />
              Incoming Flow (To Selected)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-red-600" />
              Outgoing Flow (From Selected)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 border-t-2 border-dashed border-amber-600" />
              Circular Transfer Loop
            </span>
          </div>

          {/* Selected Entity Inspector Drawer / Card */}
          {selectedNode && (
            <div className="absolute top-3 left-3 w-88 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto bg-white border border-slate-300 rounded-lg p-4 shadow-lg text-xs space-y-3 z-20 animate-in fade-in zoom-in-95 duration-150">
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
                  className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 cursor-pointer"
                  title="Close Inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Profile Details */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Customer Type</span>
                  <span className="capitalize text-slate-700">{selectedNode.customer_type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">KYC Status</span>
                  <span className="capitalize text-slate-700">{selectedNode.kyc_tier.replace(/_/g, ' ')}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[10px]">Current Balance</span>
                  <span className="font-bold text-slate-800 text-xs">
                    ₹{selectedNode.current_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Connected Graph Transfers */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-700">Connected Graph Transfers</span>
                  <span className="text-slate-400 font-mono">
                    {connectedTransfers.incoming.length} In / {connectedTransfers.outgoing.length} Out
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 font-mono text-[10px]">
                  {connectedTransfers.incoming.map((e) => (
                    <div
                      key={e.transaction_id}
                      className="p-1.5 rounded bg-emerald-50/70 border border-emerald-200/80 flex items-center justify-between gap-1 text-emerald-950"
                    >
                      <div className="flex items-center gap-1">
                        <ArrowDownLeft className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span className="truncate">From {e.origin_account_id}</span>
                      </div>
                      <span className="font-bold text-emerald-800 shrink-0">
                        +₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}

                  {connectedTransfers.outgoing.map((e) => (
                    <div
                      key={e.transaction_id}
                      className="p-1.5 rounded bg-red-50/70 border border-red-200/80 flex items-center justify-between gap-1 text-red-950"
                    >
                      <div className="flex items-center gap-1">
                        <ArrowUpRight className="w-3 h-3 text-red-600 shrink-0" />
                        <span className="truncate">To {e.destination_account_id}</span>
                      </div>
                      <span className="font-bold text-red-800 shrink-0">
                        -₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}

                  {connectedTransfers.incoming.length === 0 && connectedTransfers.outgoing.length === 0 && (
                    <p className="text-slate-400 italic text-[11px] py-1">No direct transfers recorded in this trace.</p>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => navigate(`/v2/accounts/${selectedNode.account_id}`)}
                  className="w-full py-1.5 px-3 rounded bg-[#0D9488] hover:bg-[#0F766E] text-white font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Open Account 360° Profile</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Selected Edge Inspector Card */}
          {selectedEdge && (
            <div className="absolute top-3 left-3 w-80 bg-white border border-slate-300 rounded-lg p-3.5 shadow-md text-xs space-y-2 z-20 animate-in fade-in zoom-in-95 duration-150">
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
                  className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-1 border-t border-slate-100 font-mono text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Channel Rail:</span>
                  <span className="text-slate-800 font-bold">{selectedEdge.channel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Timestamp:</span>
                  <span className="text-slate-700">{selectedEdge.timestamp.replace('T', ' ')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Origin Account:</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/v2/accounts/${selectedEdge.origin_account_id}`)}
                    className="text-teal-700 hover:underline font-semibold flex items-center gap-0.5"
                  >
                    <span>{selectedEdge.origin_account_id}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Destination:</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/v2/accounts/${selectedEdge.destination_account_id}`)}
                    className="text-teal-700 hover:underline font-semibold flex items-center gap-0.5"
                  >
                    <span>{selectedEdge.destination_account_id}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Alternative Tabular View ("Transfers List") */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Filter by Account or Transaction ID..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            {selectedNode && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlySelectedNodeTransfers}
                  onChange={(e) => setOnlySelectedNodeTransfers(e.target.checked)}
                  className="rounded text-[#0D9488] focus:ring-[#0D9488]"
                />
                <span>Only transfers for {selectedNode.account_id}</span>
              </label>
            )}

            <span className="text-slate-400 font-mono text-[11px]">
              Showing {filteredEdges.length} of {traceData.edges.length} transfers
            </span>
          </div>

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
                  <th className="px-3 py-2.5">Pattern</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredEdges.map((e) => (
                  <tr
                    key={e.transaction_id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedEdge(e);
                      setSelectedNode(null);
                    }}
                  >
                    <td className="px-3 py-2 text-slate-500 font-semibold">{e.hop}</td>
                    <td className="px-3 py-2 text-slate-700 font-semibold">{e.transaction_id}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/v2/accounts/${e.origin_account_id}`);
                        }}
                        className="text-teal-700 hover:underline hover:text-teal-900 cursor-pointer"
                      >
                        {e.origin_account_id}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/v2/accounts/${e.destination_account_id}`);
                        }}
                        className="text-teal-700 hover:underline hover:text-teal-900 cursor-pointer"
                      >
                        {e.destination_account_id}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-sans">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">
                        {e.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                      ₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-[11px] whitespace-nowrap">
                      {e.timestamp.replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 font-sans">
                      {e.is_cycle ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold border border-amber-300">
                          Circular Loop
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">Direct</span>
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
