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

export const CytoscapeGraph: React.FC<CytoscapeGraphProps> = ({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  height = '500px',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [layoutName, setLayoutName] = useState<'breadthfirst' | 'circle' | 'cose'>('breadthfirst');

  useEffect(() => {
    if (!containerRef.current) return;

    // Build elements
    const elements = [
      ...nodes.map((n) => {
        let nodeColor = '#6366f1'; // indigo
        let borderColor = '#4338ca';

        if (n.role === 'reporting_victim') {
          nodeColor = '#0284c7'; // sky blue
          borderColor = '#0369a1';
        } else if (n.role === 'reported_initial_receiver') {
          nodeColor = '#ea580c'; // orange
          borderColor = '#c2410c';
        } else if (n.role === 'intermediate_recipient') {
          nodeColor = '#9333ea'; // purple
          borderColor = '#7e22ce';
        } else if (n.review_state === 'review_completed') {
          nodeColor = '#10b981'; // emerald
          borderColor = '#047857';
        } else if (n.review_state === 'under_review') {
          nodeColor = '#f59e0b'; // amber
          borderColor = '#b45309';
        }

        return {
          data: {
            id: n.id,
            label: `${n.id}\n(${n.label || n.role})`,
            raw: n,
            color: nodeColor,
            borderColor,
          },
        };
      }),
      ...edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: `₹${e.amount.toLocaleString()} ${e.transaction_type}`,
          raw: e,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'font-size': '11px',
            'font-family': 'Plus Jakarta Sans, sans-serif',
            'font-weight': 600,
            color: '#1e293b',
            'background-color': 'data(color)',
            'border-width': 3,
            'border-color': 'data(borderColor)',
            width: 44,
            height: 44,
            'overlay-opacity': 0,
            'transition-property': 'background-color, line-color, target-arrow-color, width, height',
            'transition-duration': 0.2,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 5,
            'border-color': '#0f172a',
            width: 52,
            height: 52,
            'background-color': '#4f46e5',
            color: '#0f172a',
            'font-size': '12px',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2.5,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '10px',
            'font-weight': 600,
            color: '#475569',
            'text-background-opacity': 0.85,
            'text-background-color': '#ffffff',
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
            'arrow-scale': 1.2,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            width: 4,
            'line-color': '#6366f1',
            'target-arrow-color': '#6366f1',
            color: '#4338ca',
            'text-background-color': '#e0e7ff',
            'arrow-scale': 1.5,
          },
        },
      ],
      layout: {
        name: layoutName,
        directed: true,
        padding: 50,
        spacingFactor: 1.3,
      },
      minZoom: 0.3,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
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
  }, [nodes, edges, layoutName]);

  // Sync selected node externally
  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.nodes().unselect();
    if (selectedNodeId) {
      const target = cyRef.current.$id(selectedNodeId);
      if (target.length) target.select();
    }
  }, [selectedNodeId]);

  // Sync selected edge externally
  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.edges().unselect();
    if (selectedEdgeId) {
      const target = cyRef.current.$id(selectedEdgeId);
      if (target.length) target.select();
    }
  }, [selectedEdgeId]);

  const handleZoomIn = () => {
    if (cyRef.current) cyRef.current.zoom(cyRef.current.zoom() * 1.25);
  };

  const handleZoomOut = () => {
    if (cyRef.current) cyRef.current.zoom(cyRef.current.zoom() * 0.8);
  };

  const handleFit = () => {
    if (cyRef.current) cyRef.current.fit(undefined, 40);
  };

  const handleReset = () => {
    if (cyRef.current) {
      cyRef.current.reset();
      cyRef.current.fit(undefined, 40);
    }
  };

  const handleExportPng = () => {
    if (!cyRef.current) return;
    const png64 = cyRef.current.png({ full: true, bg: '#ffffff', scale: 2 });
    const link = document.createElement('a');
    link.href = png64;
    link.download = `fraudshield-network-graph.png`;
    link.click();
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 bg-white/95 shadow-sm">
      {/* Floating Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 p-1 rounded-xl bg-white/90 backdrop-blur-md border border-slate-200 shadow-sm">
        <button
          onClick={handleZoomIn}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleFit}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title="Fit View"
          aria-label="Fit View"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={handleReset}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title="Reset"
          aria-label="Reset Layout"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <div className="h-4 w-px bg-slate-200 mx-0.5" />
        <button
          onClick={() =>
            setLayoutName((prev) =>
              prev === 'breadthfirst' ? 'cose' : prev === 'cose' ? 'circle' : 'breadthfirst'
            )
          }
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
          title={`Layout: ${layoutName}`}
        >
          <Layers className="w-4 h-4" />
          <span className="capitalize">{layoutName}</span>
        </button>
        <button
          onClick={handleExportPng}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title="Export PNG"
          aria-label="Export Graph as PNG"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* Graph Legend */}
      <div className="absolute bottom-4 left-4 z-10 hidden sm:flex items-center gap-3 p-2 rounded-xl bg-white/90 backdrop-blur-md border border-slate-200 shadow-sm text-[11px] text-slate-600 font-medium">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-sky-600" /> Victim
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-orange-600" /> Initial Receiver
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-purple-600" /> Intermediate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500" /> Review Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-500" /> Under Review
        </span>
      </div>

      {/* Cytoscape Canvas Container */}
      <div ref={containerRef} style={{ height, width: '100%' }} />
    </div>
  );
};
