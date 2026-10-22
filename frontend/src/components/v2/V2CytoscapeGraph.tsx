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
              color: '#1A1714',
              'background-color': '#FFFFFF',
              'border-width': 2,
              'border-color': '#EAE3D6',
              width: 140,
              height: 52,
              shape: 'round-rectangle',
              'text-margin-y': 0,
              'text-max-width': '125px',
            },
          },
          // Root account styling (Warm Orange accent)
          {
            selector: 'node[?isRoot]',
            style: {
              'border-width': 3,
              'border-color': '#EA8500',
              'background-color': '#FFF4E6',
              color: '#C05621',
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
              'line-color': '#DDD4C4',
              'target-arrow-color': '#DDD4C4',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              label: 'data(label)',
              'font-size': '9px',
              'font-family': 'ui-monospace, monospace',
              'font-weight': 600,
              color: '#6B655B',
              'text-background-opacity': 0.95,
              'text-background-color': '#FFFFFF',
              'text-background-padding': '2px',
              'text-background-shape': 'roundrectangle',
              'text-rotation': 'autorotate',
              'arrow-scale': 1.15,
            },
          },
          // Cyclic edges (Amber/Orange loop)
          {
            selector: 'edge[?isCycle]',
            style: {
              width: 3.5,
              'line-color': '#EA8500',
              'target-arrow-color': '#EA8500',
              'line-style': 'dashed',
              color: '#C05621',
              'text-background-color': '#FFF4E6',
            },
          },
          // Active Highlights (Warm Orange)
          {
            selector: '.highlighted-selected',
            style: {
              'border-color': '#EA8500',
              'border-width': 4,
              'background-color': '#FFF4E6',
              'line-color': '#EA8500',
              'target-arrow-color': '#EA8500',
              width: 3.5,
              'z-index': 999,
            },
          },
          {
            selector: '.highlighted-incoming',
            style: {
              'line-color': '#22C55E',
              'target-arrow-color': '#22C55E',
              width: 3.5,
              'z-index': 998,
              color: '#166534',
              'text-background-color': '#EAF7EE',
            },
          },
          {
            selector: '.highlighted-outgoing',
            style: {
              'line-color': '#E11D48',
              'target-arrow-color': '#E11D48',
              width: 3.5,
              'z-index': 998,
              color: '#BE123C',
              'text-background-color': '#FFF0F2',
            },
          },
          {
            selector: '.highlighted-neighbor',
            style: {
              'border-color': '#6B655B',
              'border-width': 3,
              'background-color': '#FAF7F2',
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
              concentric: (node: any) => 10 - (node.data('hop') || 0),
              levelWidth: () => 1,
              minNodeSpacing: 60,
              padding: 50,
            }
          : layoutMode === 'cose'
          ? {
              name: 'cose',
              animate: false,
              nodeRepulsion: () => 450000,
              idealEdgeLength: () => 120,
              padding: 50,
            }
          : layoutMode === 'breadthfirst'
          ? {
              name: 'breadthfirst',
              directed: true,
              roots: traceData.nodes.filter((n) => n.is_root).map((n) => n.account_id),
              padding: 50,
              spacingFactor: 1.25,
            }
          : {
              name: 'circle',
              padding: 50,
            }) as any,
      });

      // Click on Node
      cy.on('tap', 'node', (evt: EventObject) => {
        const node = evt.target;
        const id = node.data('accountId');
        const v2Node = nodeMap.current.get(id);

        if (v2Node) {
          setSelectedNode(v2Node);
          setSelectedEdge(null);
          if (onSelectNode) onSelectNode(v2Node);
        } else {
          setSelectedNode({
            account_id: id,
            customer_name: node.data('name'),
            customer_type: node.data('customerType'),
            kyc_tier: node.data('kycTier'),
            current_balance: node.data('balance'),
            hop_distance: node.data('hop'),
            is_root: node.data('isRoot'),
          });
          setSelectedEdge(null);
        }
      });

      // Click on Edge
      cy.on('tap', 'edge', (evt: EventObject) => {
        const edge = evt.target;
        const id = edge.data('id');
        const v2Edge = edgeMap.current.get(id);
        if (v2Edge) {
          setSelectedEdge(v2Edge);
          setSelectedNode(null);
        }
      });

      // Tap background deselects
      cy.on('tap', (evt: EventObject) => {
        if (evt.target === cy) {
          setSelectedNode(null);
          setSelectedEdge(null);
          if (onSelectNode) onSelectNode(null);
        }
      });

      cy.ready(() => {
        cy.resize();
        cy.fit(undefined, 40);
      });

      cy.on('layoutstop', () => {
        cy.resize();
        cy.fit(undefined, 40);
      });

      cyRef.current = cy;

      const fitTimer1 = setTimeout(() => {
        if (cyRef.current) {
          cyRef.current.resize();
          cyRef.current.fit(undefined, 40);
        }
      }, 120);

      const fitTimer2 = setTimeout(() => {
        if (cyRef.current) {
          cyRef.current.resize();
          cyRef.current.fit(undefined, 40);
        }
      }, 350);

      let resizeObserver: ResizeObserver | null = null;
      if (containerRef.current && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (cyRef.current) {
            cyRef.current.resize();
            cyRef.current.fit(undefined, 40);
          }
        });
        resizeObserver.observe(containerRef.current);
      }

      return () => {
        clearTimeout(fitTimer1);
        clearTimeout(fitTimer2);
        if (resizeObserver) resizeObserver.disconnect();
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
    <div className="space-y-4">
      {/* Top Controls & Exposure Guardrail Banner */}
      <div className="bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
          {/* Exposure Totals */}
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <span className="text-[#6B655B] block text-[11px]">Observed Ledger Movement:</span>
              <span className="font-mono font-bold text-[#1A1714] text-sm sm:text-base">
                ₹{traceData.observed_total_transferred.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="border-l border-[#EAE3D6] pl-4 sm:pl-6">
              <span className="text-[#6B655B] block text-[11px] flex items-center gap-1">
                Attributed Exposure Ceiling:
                <span title="Upper bound of funds originating from root account. Downstream transfers are NOT double-counted.">
                  <Info className="w-3.5 h-3.5 text-[#EA8500]" />
                </span>
              </span>
              <span className="font-mono font-bold text-[#EA8500] text-sm sm:text-base">
                ₹{traceData.attributed_exposure_upper_bound.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="border-l border-[#EAE3D6] pl-4 sm:pl-6">
              <span className="text-[#6B655B] block text-[11px]">Explored Graph:</span>
              <span className="font-mono text-[#1A1714] font-semibold">
                {traceData.total_nodes} Accounts · {traceData.total_edges} Transfers
              </span>
            </div>
          </div>

          {/* View & Layout Toggles */}
          <div className="flex items-center gap-2.5">
            <div className="flex rounded-xl border border-[#EAE3D6] overflow-hidden bg-[#FAF7F2] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('graph')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold transition-all cursor-pointer ${
                  viewMode === 'graph'
                    ? 'bg-[#EA8500] text-white shadow-2xs'
                    : 'text-[#6B655B] hover:text-[#1A1714]'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span>Graph Canvas</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-[#EA8500] text-white shadow-2xs'
                    : 'text-[#6B655B] hover:text-[#1A1714]'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Transfers List</span>
              </button>
            </div>

            {viewMode === 'graph' && (
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as any)}
                aria-label="Graph Layout Mode"
                className="bg-white border border-[#EAE3D6] rounded-xl px-3 py-1.5 text-xs text-[#1A1714] font-medium focus:outline-none focus:border-[#EA8500] shadow-2xs cursor-pointer"
              >
                <option value="concentric">Radial Hop Perimeter</option>
                <option value="cose">Force Directed (Organic)</option>
                <option value="breadthfirst">Hierarchical Flow</option>
                <option value="circle">Circular Topology</option>
              </select>
            )}
          </div>
        </div>

        {/* Truncation Warning in Plain English */}
        {traceData.is_truncated && (
          <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-[#FFF8EE] border border-[#FCD5B5] text-[#C05621] text-xs">
            <AlertTriangle className="w-4 h-4 text-[#EA8500] shrink-0" />
            <span>
              <strong>Graph Perimeter Truncated:</strong> {traceData.truncation_reason} Increase exploration depth or node ceiling to reveal additional hops.
            </span>
          </div>
        )}
      </div>

      {/* Main Canvas / Table Area */}
      {viewMode === 'graph' ? (
        <div className="relative border border-[#EAE3D6] rounded-3xl overflow-hidden bg-[#FAF7F2] shadow-sm blueprint-grid-warm">
          {/* Cytoscape DOM container */}
          <div ref={containerRef} style={{ height }} className="w-full bg-[#FAF7F2]/80" />

          {/* Floating Canvas Controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1.5 bg-white/95 backdrop-blur-xs border border-[#EAE3D6] rounded-xl p-1.5 shadow-sm z-10">
            <button
              onClick={handleZoomIn}
              className="p-2 rounded-lg hover:bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] cursor-pointer transition-colors"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 rounded-lg hover:bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] cursor-pointer transition-colors"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleFit}
              className="p-2 rounded-lg hover:bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] cursor-pointer transition-colors"
              title="Fit View"
              aria-label="Fit View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleReset}
              className="p-2 rounded-lg hover:bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] cursor-pointer transition-colors"
              title="Reset Selection"
              aria-label="Reset Selection"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Legend Overlay */}
          <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs border border-[#EAE3D6] rounded-2xl px-4 py-2.5 text-xs text-[#6B655B] shadow-sm flex flex-wrap items-center gap-4 z-10">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-3.5 h-3.5 rounded-lg bg-[#FFF4E6] border-2 border-[#EA8500]" />
              Root Account
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-3.5 h-3.5 rounded-lg bg-white border border-[#DDD4C4]" />
              Counterparty
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-4 h-0.5 bg-[#22C55E]" />
              Incoming
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-4 h-0.5 bg-[#E11D48]" />
              Outgoing
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-5 h-0 border-t-2 border-dashed border-[#EA8500]" />
              Loop
            </span>
          </div>

          {/* Selected Entity Inspector Drawer / Card */}
          {selectedNode && (
            <div className="absolute top-3 left-3 w-88 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto bg-white border border-[#EAE3D6] rounded-2xl p-5 shadow-lg text-xs space-y-3.5 z-20 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#EA8500] font-mono">
                    {selectedNode.is_root ? 'ROOT INVESTIGATION ACCOUNT' : `HOP ${selectedNode.hop_distance} COUNTERPARTY`}
                  </span>
                  <h5 className="font-bold text-[#1A1714] text-base mt-0.5 font-display">{selectedNode.customer_name}</h5>
                  <span className="font-mono text-[#6B655B] text-xs">{selectedNode.account_id}</span>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-[#8C857B] hover:text-[#1A1714] p-1 rounded-lg hover:bg-[#FAF7F2] cursor-pointer"
                  title="Close Inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Profile Details */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#EAE3D6] font-mono text-[11px]">
                <div className="bg-[#FAF7F2] p-2 rounded-xl">
                  <span className="text-[#8C857B] block text-[10px]">Customer Type</span>
                  <span className="capitalize text-[#1A1714] font-semibold">{selectedNode.customer_type}</span>
                </div>
                <div className="bg-[#FAF7F2] p-2 rounded-xl">
                  <span className="text-[#8C857B] block text-[10px]">KYC Status</span>
                  <span className="capitalize text-[#1A1714] font-semibold">{selectedNode.kyc_tier.replace(/_/g, ' ')}</span>
                </div>
                <div className="col-span-2 bg-[#FAF7F2] p-2 rounded-xl">
                  <span className="text-[#8C857B] block text-[10px]">Current Balance</span>
                  <span className="font-bold text-[#1A1714] text-sm">
                    ₹{selectedNode.current_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Connected Graph Transfers */}
              <div className="pt-2 border-t border-[#EAE3D6] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#1A1714]">Connected Transfers</span>
                  <span className="text-[#6B655B] font-mono text-[11px]">
                    {connectedTransfers.incoming.length} In / {connectedTransfers.outgoing.length} Out
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
                  {connectedTransfers.incoming.map((e) => (
                    <div
                      key={e.transaction_id}
                      className="p-2 rounded-xl bg-[#EAF7EE] border border-[#BBF7D0] flex items-center justify-between gap-1 text-[#166534]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowDownLeft className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
                        <span className="truncate">From {e.origin_account_id}</span>
                      </div>
                      <span className="font-bold text-[#166534] shrink-0">
                        +₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}

                  {connectedTransfers.outgoing.map((e) => (
                    <div
                      key={e.transaction_id}
                      className="p-2 rounded-xl bg-[#FFF0F2] border border-[#FECDD3] flex items-center justify-between gap-1 text-[#BE123C]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowUpRight className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
                        <span className="truncate">To {e.destination_account_id}</span>
                      </div>
                      <span className="font-bold text-[#BE123C] shrink-0">
                        -₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}

                  {connectedTransfers.incoming.length === 0 && connectedTransfers.outgoing.length === 0 && (
                    <p className="text-[#8C857B] italic text-xs py-1">No direct transfers recorded in this trace window.</p>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-[#EAE3D6] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/v2/accounts/${selectedNode.account_id}`)}
                  className="w-full py-2 px-3 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                >
                  <span>Open Account 360° Profile</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Selected Edge Inspector Card */}
          {selectedEdge && (
            <div className="absolute top-3 left-3 w-80 bg-white border border-[#EAE3D6] rounded-2xl p-4 shadow-md text-xs space-y-2.5 z-20 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#EA8500] font-mono">
                    {selectedEdge.is_cycle ? 'CIRCULAR TRANSFER LOOP' : `HOP ${selectedEdge.hop} DIRECTED TRANSFER`}
                  </span>
                  <h5 className="font-mono font-bold text-[#1A1714] text-base">
                    ₹{selectedEdge.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </h5>
                  <span className="font-mono text-[#6B655B] text-[11px]">{selectedEdge.transaction_id}</span>
                </div>
                <button
                  onClick={() => setSelectedEdge(null)}
                  className="text-[#8C857B] hover:text-[#1A1714] p-1 rounded-lg hover:bg-[#FAF7F2] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-2 border-t border-[#EAE3D6] font-mono text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#6B655B]">Channel Rail:</span>
                  <span className="text-[#1A1714] font-bold">{selectedEdge.channel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B655B]">Timestamp:</span>
                  <span className="text-[#1A1714]">{selectedEdge.timestamp.replace('T', ' ')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#6B655B]">Origin Account:</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/v2/accounts/${selectedEdge.origin_account_id}`)}
                    className="text-[#EA8500] hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>{selectedEdge.origin_account_id}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#6B655B]">Destination:</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/v2/accounts/${selectedEdge.destination_account_id}`)}
                    className="text-[#EA8500] hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>{selectedEdge.destination_account_id}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Alternative Tabular View ("Transfers List") */
        <div className="bg-white border border-[#EAE3D6] rounded-3xl overflow-hidden shadow-2xs space-y-3.5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C857B]" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Filter by Account or Transaction ID..."
                className="w-full pl-9 pr-3 py-2 bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl text-xs text-[#1A1714] placeholder:text-[#8C857B] focus:outline-none focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 font-mono"
              />
            </div>

            {selectedNode && (
              <label className="flex items-center gap-2 text-xs text-[#6B655B] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlySelectedNodeTransfers}
                  onChange={(e) => setOnlySelectedNodeTransfers(e.target.checked)}
                  className="rounded text-[#EA8500] focus:ring-[#EA8500]"
                />
                <span>Only transfers for {selectedNode.account_id}</span>
              </label>
            )}

            <span className="text-[#6B655B] font-mono text-[11px]">
              Showing {filteredEdges.length} of {traceData.edges.length} transfers
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F2] border-b border-[#EAE3D6] text-[#6B655B] font-bold">
                <tr>
                  <th className="px-3.5 py-3">Hop</th>
                  <th className="px-3.5 py-3">Transaction ID</th>
                  <th className="px-3.5 py-3">Origin Account</th>
                  <th className="px-3.5 py-3">Destination Account</th>
                  <th className="px-3.5 py-3">Channel</th>
                  <th className="px-3.5 py-3 text-right">Amount</th>
                  <th className="px-3.5 py-3">Timestamp</th>
                  <th className="px-3.5 py-3">Pattern</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE3D6]/70 font-mono text-xs">
                {filteredEdges.map((e) => (
                  <tr
                    key={e.transaction_id}
                    className="hover:bg-[#FAF7F2] transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedEdge(e);
                      setSelectedNode(null);
                    }}
                  >
                    <td className="px-3.5 py-2.5 text-[#6B655B] font-semibold">{e.hop}</td>
                    <td className="px-3.5 py-2.5 text-[#1A1714] font-bold">{e.transaction_id}</td>
                    <td className="px-3.5 py-2.5">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/v2/accounts/${e.origin_account_id}`);
                        }}
                        className="text-[#EA8500] hover:underline font-semibold cursor-pointer"
                      >
                        {e.origin_account_id}
                      </button>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/v2/accounts/${e.destination_account_id}`);
                        }}
                        className="text-[#EA8500] hover:underline font-semibold cursor-pointer"
                      >
                        {e.destination_account_id}
                      </button>
                    </td>
                    <td className="px-3.5 py-2.5 font-sans">
                      <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[#6B655B] text-[11px] font-semibold">
                        {e.channel}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-bold text-[#1A1714]">
                      ₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3.5 py-2.5 text-[#6B655B] text-[11px] whitespace-nowrap">
                      {e.timestamp.replace('T', ' ')}
                    </td>
                    <td className="px-3.5 py-2.5 font-sans">
                      {e.is_cycle ? (
                        <span className="px-2 py-0.5 rounded-lg bg-[#FFF4E6] text-[#C05621] text-[11px] font-bold border border-[#FCD5B5]">
                          Circular Loop
                        </span>
                      ) : (
                        <span className="text-[#8C857B] text-[11px]">Direct Hop</span>
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
