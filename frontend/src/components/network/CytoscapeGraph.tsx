import React, { useEffect, useRef, useState } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { GraphEdge, GraphNode } from '../../types/api';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Download, Layers } from 'lucide-react';

interface CytoscapeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onSelectNode?: (node: GraphNode | null) => void;
  onSelectEdge?: (edge: GraphEdge | null) => void;
  height?: string;
}

function getShortRoleTag(n: GraphNode): string {
  if (n.role === 'reporting_victim') return 'ORIGIN VICTIM';
  if (n.role === 'reported_initial_receiver') return 'HOP 1 · INITIAL';
  if (n.role === 'intermediate_recipient') return `HOP ${n.hop_count ?? 1} · ROUTER`;
  if (n.review_state === 'review_completed') return `HOP ${n.hop_count ?? '?'} · CLEARED`;
  return `HOP ${n.hop_count ?? '?'} · REVIEW`;
}

function computeHierarchicalPositions(nodes: GraphNode[], edges: GraphEdge[]): Record<string, { x: number; y: number }> {
  // Group nodes by hop_count (or topological depth from reporting_victim)
  const depthMap: Record<string, number> = {};
  nodes.forEach((n) => {
    if (n.role === 'reporting_victim') {
      depthMap[n.id] = 0;
    } else if (typeof n.hop_count === 'number') {
      // Shift by +1 if reporting_victim and initial_receiver both have hop_count 0
      depthMap[n.id] = n.role === 'reported_initial_receiver' && n.hop_count === 0 ? 1 : n.hop_count + 1;
    }
  });

  // Fallback BFS if any node lacks depth
  const adj: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  });
  const roots = nodes.filter((n) => n.role === 'reporting_victim').map((n) => n.id);
  const queue = roots.length ? [...roots] : nodes.slice(0, 1).map((n) => n.id);
  queue.forEach((r) => {
    if (depthMap[r] === undefined) depthMap[r] = 0;
  });
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currDepth = depthMap[curr] ?? 0;
    for (const nxt of adj[curr] || []) {
      if (depthMap[nxt] === undefined || depthMap[nxt] < currDepth + 1) {
        depthMap[nxt] = currDepth + 1;
        queue.push(nxt);
      }
    }
  }

  const columns: Record<number, GraphNode[]> = {};
  nodes.forEach((n) => {
    const d = depthMap[n.id] ?? 0;
    if (!columns[d]) columns[d] = [];
    columns[d].push(n);
  });

  const positions: Record<string, { x: number; y: number }> = {};
  const colKeys = Object.keys(columns)
    .map(Number)
    .sort((a, b) => a - b);

  const xStep = 235;
  const yStep = 135;

  colKeys.forEach((colIdx, i) => {
    const colNodes = columns[colIdx].sort((a, b) => a.id.localeCompare(b.id));
    const count = colNodes.length;
    colNodes.forEach((node, rowIdx) => {
      const yOffset = (rowIdx - (count - 1) / 2) * yStep;
      positions[node.id] = {
        x: 100 + i * xStep,
        y: 260 + yOffset,
      };
    });
  });

  return positions;
}

export const CytoscapeGraph: React.FC<CytoscapeGraphProps> = ({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  height = '540px',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [layoutMode, setLayoutMode] = useState<'hierarchy' | 'breadthfirst' | 'circle'>('hierarchy');

  useEffect(() => {
    if (!containerRef.current) return;

    const presetPositions = computeHierarchicalPositions(nodes, edges);

    const elements = [
      ...nodes.map((n) => {
        let bgColor = '#FFFFFF';
        let borderColor = '#D97706'; // amber under review
        let textColor = '#0B1322';

        if (n.role === 'reporting_victim') {
          bgColor = '#F0F9FF';
          borderColor = '#0284C7';
          textColor = '#0C4A6E';
        } else if (n.role === 'reported_initial_receiver') {
          bgColor = '#FEF2F2';
          borderColor = '#DC2626';
          textColor = '#7F1D1D';
        } else if (n.role === 'intermediate_recipient') {
          bgColor = '#F0FDFA';
          borderColor = '#0D9488';
          textColor = '#115E59';
        } else if (n.review_state === 'review_completed') {
          bgColor = '#ECFDF5';
          borderColor = '#059669';
          textColor = '#064E3B';
        } else {
          bgColor = '#FFFBEB';
          borderColor = '#D97706';
          textColor = '#78350F';
        }

        const roleTag = getShortRoleTag(n);

        return {
          data: {
            id: n.id,
            label: `${n.id}\n${roleTag}`,
            raw: n,
            bgColor,
            borderColor,
            textColor,
          },
          position: presetPositions[n.id] || { x: 100, y: 200 },
        };
      }),
      ...edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: `${e.id} · ₹${e.amount.toLocaleString()} ${e.transaction_type}`,
          raw: e,
        },
      })),
    ];

    const layoutConfig =
      layoutMode === 'hierarchy'
        ? {
            name: 'preset',
            padding: 48,
            fit: true,
          }
        : layoutMode === 'breadthfirst'
        ? {
            name: 'breadthfirst',
            directed: true,
            padding: 50,
            spacingFactor: 1.45,
          }
        : {
            name: 'circle',
            padding: 50,
          };

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            width: 122,
            height: 48,
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '112px',
            'font-size': '10.5px',
            'font-family': 'JetBrains Mono, monospace',
            'font-weight': 700,
            'line-height': 1.35,
            color: 'data(textColor)',
            'background-color': 'data(bgColor)',
            'border-width': 2,
            'border-color': 'data(borderColor)',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3.5,
            'border-color': '#0D9488',
            'background-color': '#0B1322',
            color: '#2DD4BF',
            width: 130,
            height: 52,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2.2,
            'line-color': '#94A3B8',
            'target-arrow-color': '#64748B',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '9.5px',
            'font-family': 'JetBrains Mono, monospace',
            'font-weight': 600,
            color: '#0B1322',
            'text-background-opacity': 0.96,
            'text-background-color': '#FFFFFF',
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            'text-border-width': 1,
            'text-border-color': '#D6D3CD',
            'text-border-opacity': 1,
            'text-rotation': 'none',
            'text-margin-y': -10,
            'arrow-scale': 1.15,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            width: 3.5,
            'line-color': '#0D9488',
            'target-arrow-color': '#0D9488',
            color: '#FFFFFF',
            'text-background-color': '#0B1322',
            'text-border-color': '#0D9488',
            'arrow-scale': 1.35,
          },
        },
      ],
      layout: layoutConfig,
      minZoom: 0.35,
      maxZoom: 2.2,
    });

    cy.on('tap', 'node', (evt: EventObject) => {
      const raw = evt.target.data('raw');
      if (onSelectNode) onSelectNode(raw);
    });

    cy.on('tap', 'edge', (evt: EventObject) => {
      const raw = evt.target.data('raw');
      if (onSelectEdge) onSelectEdge(raw);
    });

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        if (onSelectNode) onSelectNode(null);
        if (onSelectEdge) onSelectEdge(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [nodes, edges, layoutMode]);

  // Sync selected node externally & re-fit canvas if split-pane resized
  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.nodes().unselect();
    if (selectedNodeId) {
      const target = cyRef.current.$id(selectedNodeId);
      if (target.length) target.select();
    }
    const timer = setTimeout(() => {
      if (cyRef.current) {
        cyRef.current.resize();
        cyRef.current.fit(undefined, 28);
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [selectedNodeId]);

  // Sync selected edge externally & re-fit canvas if split-pane resized
  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.edges().unselect();
    if (selectedEdgeId) {
      const target = cyRef.current.$id(selectedEdgeId);
      if (target.length) target.select();
    }
    const timer = setTimeout(() => {
      if (cyRef.current) {
        cyRef.current.resize();
        cyRef.current.fit(undefined, 28);
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [selectedEdgeId]);

  const handleZoomIn = () => {
    if (cyRef.current) cyRef.current.zoom(cyRef.current.zoom() * 1.2);
  };

  const handleZoomOut = () => {
    if (cyRef.current) cyRef.current.zoom(cyRef.current.zoom() * 0.82);
  };

  const handleFit = () => {
    if (cyRef.current) cyRef.current.fit(undefined, 44);
  };

  const handleReset = () => {
    if (cyRef.current) {
      cyRef.current.reset();
      cyRef.current.fit(undefined, 44);
    }
  };

  const handleExportPng = () => {
    if (!cyRef.current) return;
    const png64 = cyRef.current.png({ full: true, bg: '#FAF9F6', scale: 2 });
    const link = document.createElement('a');
    link.href = png64;
    link.download = `fraudshield-network-graph.png`;
    link.click();
  };

  return (
    <div className="forensic-panel overflow-hidden flex flex-col">
      {/* Top Canvas Control Bar */}
      <div className="px-3.5 py-2 bg-[#0B1322] text-white border-b border-[#1C2B45] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#2DD4BF]" />
          <span className="font-mono text-[11px] font-semibold tracking-wider uppercase text-slate-200">
            Directed Hop-Lineage Topology ({nodes.length} Accounts · {edges.length} Legs)
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-[#111C30] rounded transition-colors"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-[#111C30] rounded transition-colors"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFit}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-[#111C30] rounded transition-colors"
            title="Fit View"
            aria-label="Fit View"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-[#111C30] rounded transition-colors"
            title="Reset"
            aria-label="Reset Layout"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="h-3.5 w-px bg-[#1C2B45] mx-1" />
          <button
            onClick={() =>
              setLayoutMode((prev) =>
                prev === 'hierarchy' ? 'breadthfirst' : prev === 'breadthfirst' ? 'circle' : 'hierarchy'
              )
            }
            className="px-2 py-1 text-slate-200 hover:text-white bg-[#111C30] hover:bg-[#1C2B45] border border-[#1C2B45] rounded transition-colors flex items-center gap-1 text-[11px] font-mono"
            title={`Layout: ${layoutMode}`}
          >
            <Layers className="w-3 h-3 text-[#2DD4BF]" />
            <span className="capitalize">{layoutMode}</span>
          </button>
          <button
            onClick={handleExportPng}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-[#111C30] rounded transition-colors"
            title="Export PNG"
            aria-label="Export Graph as PNG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Cytoscape Blueprint Canvas */}
      <div className="relative blueprint-grid">
        <div ref={containerRef} style={{ height, width: '100%' }} />
      </div>

      {/* Bottom Forensic Legend Strip */}
      <div className="px-4 py-2.5 bg-white border-t border-[#E2DFD7] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#334155] font-medium">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-sky-100 border-2 border-sky-600" />
            <span>Origin Victim</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-red-100 border-2 border-red-600" />
            <span>Initial Receiver (Hop 1)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-teal-100 border-2 border-[#0D9488]" />
            <span>Intermediate Router</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-100 border-2 border-amber-600" />
            <span>Under Human Review</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-100 border-2 border-emerald-600" />
            <span>Review Completed</span>
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#64748B]">
          Click any node or edge to synchronize dossier &amp; ledger
        </span>
      </div>
    </div>
  );
};
