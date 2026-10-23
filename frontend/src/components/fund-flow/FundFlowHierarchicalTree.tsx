import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  LocateFixed,
  Move,
  Save,
  Check,
  LayoutGrid,
  GripVertical,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Repeat,
  Shield,
  User,
  CreditCard,
  Building,
  GraduationCap,
  Sparkles,
  Layers,
  Eye,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { UnifiedTreeNode, UnifiedTreeEdge } from '../../services/unifiedFlowAdapter';

export interface FundFlowHierarchicalTreeProps {
  nodes: UnifiedTreeNode[];
  edges: UnifiedTreeEdge[];
  rootAccountId: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (node: UnifiedTreeNode | null) => void;
  onSelectEdge: (edge: UnifiedTreeEdge | null) => void;
  height?: string;
  focusTargetNodeId?: string | null;
  onFocusNodeConsumed?: () => void;
}

interface LayoutNode {
  node: UnifiedTreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
  children: string[];
  parents: string[];
  hasChildren: boolean;
  isCollapsed: boolean;
  isVisible: boolean;
}

interface LayoutEdge {
  edge: UnifiedTreeEdge;
  sourceNode: LayoutNode;
  targetNode: LayoutNode;
  pathD: string;
  midX: number;
  midY: number;
  isCycle: boolean;
  isVisible: boolean;
}

export const FundFlowHierarchicalTree: React.FC<FundFlowHierarchicalTreeProps> = ({
  nodes,
  edges,
  rootAccountId,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  height = '620px',
  focusTargetNodeId,
  onFocusNodeConsumed,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const particleRef = useRef<SVGCircleElement>(null);
  const gsapCtxRef = useRef<gsap.Context | null>(null);

  // Pan & Zoom State & Refs
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 40, y: 50 });
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;
  const panRef = useRef<{ x: number; y: number }>(pan);
  panRef.current = pan;

  const isPointerDownRef = useRef<boolean>(false);
  const pointerStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasMovedRef = useRef<boolean>(false);
  const touchDistanceRef = useRef<number | null>(null);

  // Collapse / Expand set (stored node IDs whose downstream branches are collapsed)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // Manual Layout Customization State & Persistence
  const [customPositions, setCustomPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [isCustomizeMode, setIsCustomizeMode] = useState<boolean>(false);
  const [isLayoutDirty, setIsLayoutDirty] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active dragged node state in customize mode
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const nodeDragStartRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    startNodeX: number;
    startNodeY: number;
    hasMoved: boolean;
  } | null>(null);

  // Storage key isolated per graph context (rootAccountId or caseId)
  const storageKey = useMemo(() => {
    return `fraudshield_fund_flow_layout_${rootAccountId || 'default'}`;
  }, [rootAccountId]);

  // Hovered edge for tooltip badge
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Adjacency maps
  const { childrenMap, parentMap, nodeLookup, edgeLookup } = useMemo(() => {
    const cMap = new Map<string, string[]>();
    const pMap = new Map<string, string[]>();
    const nMap = new Map<string, UnifiedTreeNode>();
    const eMap = new Map<string, UnifiedTreeEdge>();

    nodes.forEach((n) => {
      cMap.set(n.id, []);
      pMap.set(n.id, []);
      nMap.set(n.id, n);
    });

    edges.forEach((e) => {
      eMap.set(e.id, e);
      if (cMap.has(e.source)) {
        cMap.get(e.source)!.push(e.target);
      }
      if (pMap.has(e.target)) {
        pMap.get(e.target)!.push(e.source);
      }
    });

    return { childrenMap: cMap, parentMap: pMap, nodeLookup: nMap, edgeLookup: eMap };
  }, [nodes, edges]);

  // Load and apply saved layout positions for this context (rootAccountId / caseId)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const validPositions: Record<string, { x: number; y: number }> = {};
          let validCount = 0;
          for (const [id, pos] of Object.entries(parsed)) {
            if (
              nodeLookup.has(id) &&
              pos &&
              typeof (pos as any).x === 'number' &&
              typeof (pos as any).y === 'number'
            ) {
              validPositions[id] = pos as { x: number; y: number };
              validCount++;
            }
          }
          if (validCount > 0) {
            setCustomPositions(validPositions);
            setIsLayoutDirty(false);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('Unable to load saved layout from localStorage', err);
    }
    setCustomPositions({});
    setIsLayoutDirty(false);
  }, [storageKey, nodeLookup]);

  // Determine which nodes are hidden due to an ancestor being collapsed
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();

    const hideDescendants = (parentId: string) => {
      const children = childrenMap.get(parentId) || [];
      for (const childId of children) {
        if (!hidden.has(childId)) {
          hidden.add(childId);
          hideDescendants(childId);
        }
      }
    };

    collapsedNodes.forEach((collapsedId) => {
      hideDescendants(collapsedId);
    });

    return hidden;
  }, [collapsedNodes, childrenMap]);

  // Compute Tree Layout (Left-to-Right columns by hop)
  const { layoutNodes, layoutEdges, bounds } = useMemo(() => {
    const NODE_WIDTH = 220;
    const NODE_HEIGHT = 80;
    const X_GAP = 130;
    const Y_GAP = 32;

    // Group nodes by hop distance
    const columns = new Map<number, UnifiedTreeNode[]>();
    nodes.forEach((n) => {
      const h = Math.max(0, n.hop);
      if (!columns.has(h)) columns.set(h, []);
      columns.get(h)!.push(n);
    });

    // Sort column keys ascending (0 = root, 1 = hop 1, etc.)
    const colKeys = Array.from(columns.keys()).sort((a, b) => a - b);

    // Position assignments
    const posMap = new Map<string, { x: number; y: number }>();

    // Pass 1: Arrange nodes in each column vertically, grouping siblings
    let maxOverallY = 0;

    colKeys.forEach((hop) => {
      const colNodes = columns.get(hop)!;
      const x = 40 + hop * (NODE_WIDTH + X_GAP);

      // Sort column nodes: if hop > 0, align near parents
      if (hop > 0) {
        colNodes.sort((a, b) => {
          const pA = parentMap.get(a.id)?.[0];
          const pB = parentMap.get(b.id)?.[0];
          const pAY = pA && posMap.has(pA) ? posMap.get(pA)!.y : 0;
          const pBY = pB && posMap.has(pB) ? posMap.get(pB)!.y : 0;
          if (pAY !== pBY) return pAY - pBY;
          return a.id.localeCompare(b.id);
        });
      }

      // Place visible nodes sequentially with proper spacing
      let currentY = 40;
      colNodes.forEach((node) => {
        const isVisible = !hiddenNodeIds.has(node.id);
        if (isVisible) {
          posMap.set(node.id, { x, y: currentY });
          currentY += NODE_HEIGHT + Y_GAP;
        } else {
          // Offscreen collapsed reference
          posMap.set(node.id, { x, y: -9999 });
        }
      });

      maxOverallY = Math.max(maxOverallY, currentY);
    });

    // Pass 2: Vertically balance parents centered around their visible children,
    // but never push the root or parent far down away from the top of the canvas
    for (let i = colKeys.length - 2; i >= 0; i--) {
      const hop = colKeys[i];
      const colNodes = columns.get(hop)!;

      colNodes.forEach((parentNode) => {
        if (hiddenNodeIds.has(parentNode.id)) return;
        const visibleChildren = (childrenMap.get(parentNode.id) || []).filter(
          (cid) => !hiddenNodeIds.has(cid) && posMap.has(cid)
        );

        if (visibleChildren.length > 0) {
          const childYs = visibleChildren.map((cid) => posMap.get(cid)!.y);
          const firstChildY = Math.min(...childYs);
          const avgY = childYs.reduce((a, b) => a + b, 0) / childYs.length;
          const currentPos = posMap.get(parentNode.id)!;

          // For Hop 0 (root node), align close to first child rather than deep down
          if (hop === 0) {
            posMap.set(parentNode.id, { x: currentPos.x, y: Math.max(50, Math.min(firstChildY, 80)) });
          } else {
            // Cap centering so parent doesn't drift too far from first child
            const targetY = Math.min(avgY, firstChildY + (NODE_HEIGHT + Y_GAP) * 2);
            posMap.set(parentNode.id, { x: currentPos.x, y: Math.max(50, targetY) });
          }
        }
      });
    }

    // Resolve any vertical overlaps after centering
    colKeys.forEach((hop) => {
      const colNodes = columns
        .get(hop)!
        .filter((n) => !hiddenNodeIds.has(n.id))
        .sort((a, b) => (posMap.get(a.id)?.y || 0) - (posMap.get(b.id)?.y || 0));

      let lastY = 40;
      colNodes.forEach((node) => {
        const current = posMap.get(node.id)!;
        if (current.y < lastY) {
          posMap.set(node.id, { x: current.x, y: lastY });
          lastY += NODE_HEIGHT + Y_GAP;
        } else {
          lastY = current.y + NODE_HEIGHT + Y_GAP;
        }
      });
      maxOverallY = Math.max(maxOverallY, lastY);
    });

    // Construct LayoutNode models (using manual custom positions if set)
    const lNodes: LayoutNode[] = nodes.map((node) => {
      const autoPos = posMap.get(node.id) || { x: 40, y: 40 };
      const customPos = customPositions[node.id];
      const effectivePos = customPos || autoPos;

      const children = childrenMap.get(node.id) || [];
      const parents = parentMap.get(node.id) || [];
      const isVisible = !hiddenNodeIds.has(node.id);
      const isCollapsed = collapsedNodes.has(node.id);

      return {
        node,
        x: effectivePos.x,
        y: effectivePos.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        children,
        parents,
        hasChildren: children.length > 0,
        isCollapsed,
        isVisible,
      };
    });

    const lNodeMap = new Map<string, LayoutNode>();
    lNodes.forEach((ln) => lNodeMap.set(ln.node.id, ln));

    // Construct LayoutEdge curves (Cubic Bezier curves with dynamic direction anchors)
    const lEdges: LayoutEdge[] = [];
    edges.forEach((edge) => {
      const sNode = lNodeMap.get(edge.source);
      const tNode = lNodeMap.get(edge.target);

      if (!sNode || !tNode) return;

      const isVisible = sNode.isVisible && tNode.isVisible;

      // Smart dynamic anchor points based on relative node positions
      let startX: number;
      let startY: number;
      let endX: number;
      let endY: number;

      if (tNode.x >= sNode.x + sNode.width - 30) {
        // Target is forward (to the right of source)
        startX = sNode.x + sNode.width;
        startY = sNode.y + sNode.height / 2;
        endX = tNode.x;
        endY = tNode.y + tNode.height / 2;
      } else if (tNode.x + tNode.width <= sNode.x + 30) {
        // Target is backward (to the left of source)
        startX = sNode.x;
        startY = sNode.y + sNode.height / 2;
        endX = tNode.x + tNode.width;
        endY = tNode.y + tNode.height / 2;
      } else {
        // Target is vertically aligned or overlapping
        startX = sNode.x + sNode.width / 2;
        startY = sNode.y + (tNode.y > sNode.y ? sNode.height : 0);
        endX = tNode.x + tNode.width / 2;
        endY = tNode.y + (tNode.y > sNode.y ? 0 : tNode.height);
      }

      let pathD = '';
      let midX = (startX + endX) / 2;
      let midY = (startY + endY) / 2;

      const dx = endX - startX;

      if (edge.isCycle || (dx <= 0 && Math.abs(dx) < 60)) {
        // Loop or backward cross-link: Arch over or under with curved loop
        const loopOffset = Math.max(70, Math.abs(startY - endY) * 0.4);
        const controlY = Math.min(startY, endY) - loopOffset;
        pathD = `M ${startX} ${startY} C ${startX + 50} ${controlY}, ${endX - 50} ${controlY}, ${endX} ${endY}`;
        midX = (startX + endX) / 2;
        midY = controlY + 15;
      } else {
        // Smooth Bezier curve following card repositioning
        const curvature = Math.max(45, Math.abs(dx) * 0.45);
        const ctrl1X = startX + (dx >= 0 ? curvature : -curvature);
        const ctrl1Y = startY;
        const ctrl2X = endX - (dx >= 0 ? curvature : -curvature);
        const ctrl2Y = endY;

        pathD = `M ${startX} ${startY} C ${ctrl1X} ${ctrl1Y}, ${ctrl2X} ${ctrl2Y}, ${endX} ${endY}`;
        midX = (startX + endX) / 2;
        midY = (startY + endY) / 2;
      }

      lEdges.push({
        edge,
        sourceNode: sNode,
        targetNode: tNode,
        pathD,
        midX,
        midY,
        isCycle: edge.isCycle,
        isVisible,
      });
    });

    const maxHop = colKeys.length > 0 ? colKeys[colKeys.length - 1] : 0;
    let maxEffectiveX = 60 + (maxHop + 1) * (NODE_WIDTH + X_GAP);
    let maxEffectiveY = maxOverallY + NODE_HEIGHT;

    lNodes.forEach((ln) => {
      if (ln.isVisible) {
        maxEffectiveX = Math.max(maxEffectiveX, ln.x + ln.width + 140);
        maxEffectiveY = Math.max(maxEffectiveY, ln.y + ln.height + 120);
      }
    });

    const maxX = Math.max(900, maxEffectiveX);
    const maxY = Math.max(540, maxEffectiveY);

    return {
      layoutNodes: lNodes,
      layoutEdges: lEdges,
      bounds: { width: maxX, height: maxY },
    };
  }, [nodes, edges, childrenMap, parentMap, hiddenNodeIds, collapsedNodes, customPositions]);

  // Identify nodes and edges in the path of the selected node or edge
  const activePathElements = useMemo(() => {
    const activeNodeIds = new Set<string>();
    const activeEdgeIds = new Set<string>();

    if (selectedNodeId) {
      activeNodeIds.add(selectedNodeId);

      // Trace ancestry back to root
      const queue = [selectedNodeId];
      const visited = new Set<string>([selectedNodeId]);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const parents = parentMap.get(curr) || [];
        for (const p of parents) {
          if (!visited.has(p)) {
            visited.add(p);
            activeNodeIds.add(p);
            queue.push(p);

            // Find connecting edge
            const edge = edges.find((e) => e.source === p && e.target === curr);
            if (edge) activeEdgeIds.add(edge.id);
          }
        }
      }

      // Also highlight immediate outgoing transfers from this node
      const outEdges = edges.filter((e) => e.source === selectedNodeId);
      outEdges.forEach((e) => {
        activeEdgeIds.add(e.id);
        activeNodeIds.add(e.target);
      });
    } else if (selectedEdgeId) {
      activeEdgeIds.add(selectedEdgeId);
      const edge = edges.find((e) => e.id === selectedEdgeId);
      if (edge) {
        activeNodeIds.add(edge.source);
        activeNodeIds.add(edge.target);
      }
    }

    return { activeNodeIds, activeEdgeIds };
  }, [selectedNodeId, selectedEdgeId, edges, parentMap]);

  // Progressive drawing and particle flow via GSAP
  useEffect(() => {
    // Check user preference for reduced motion
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !svgRef.current) return;

    gsapCtxRef.current = gsap.context(() => {
      // 1. Initial progressive reveal of tree connector paths
      const paths = svgRef.current?.querySelectorAll<SVGPathElement>('.tree-edge-path');
      if (paths && paths.length > 0) {
        paths.forEach((path) => {
          if (typeof path.getTotalLength !== 'function') return;
          const length = path.getTotalLength();
          gsap.fromTo(
            path,
            { strokeDasharray: length, strokeDashoffset: length },
            {
              strokeDashoffset: 0,
              duration: 0.85,
              ease: 'power2.out',
            }
          );
        });
      }

      // 2. Animate a restrained orange particle along the active transfer path
      if (particleRef.current && (selectedEdgeId || selectedNodeId)) {
        const activeEdge = layoutEdges.find(
          (le) =>
            le.isVisible &&
            (le.edge.id === selectedEdgeId ||
              (selectedNodeId && (le.edge.source === selectedNodeId || le.edge.target === selectedNodeId)))
        );

        if (activeEdge) {
          const targetPath = svgRef.current?.querySelector<SVGPathElement>(
            `#path-${activeEdge.edge.id}`
          );

          if (targetPath && typeof targetPath.getTotalLength === 'function' && typeof targetPath.getPointAtLength === 'function') {
            const pathLen = targetPath.getTotalLength();
            const progressObj = { distance: 0 };

            gsap.to(progressObj, {
              distance: pathLen,
              duration: 2.2,
              repeat: -1,
              ease: 'power1.inOut',
              onUpdate: () => {
                if (particleRef.current && targetPath) {
                  const pt = targetPath.getPointAtLength(progressObj.distance);
                  particleRef.current.setAttribute('cx', String(pt.x));
                  particleRef.current.setAttribute('cy', String(pt.y));
                }
              },
            });
          }
        }
      }
    }, containerRef);

    return () => {
      gsapCtxRef.current?.revert();
    };
  }, [layoutEdges, selectedNodeId, selectedEdgeId]);

  // Focus selected account in the center of the viewport
  const focusNode = useCallback(
    (nodeId: string) => {
      const target = layoutNodes.find((ln) => ln.node.id === nodeId);
      if (!target || !containerRef.current) return;

      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;

      // Keep zoom comfortable and legible (0.85 to 1.15)
      const currentZoom = zoomRef.current;
      const targetZoom = Math.max(0.85, Math.min(currentZoom, 1.15));

      const targetX = cw / 2 - (target.x + target.width / 2) * targetZoom;
      const targetY = ch / 2 - (target.y + target.height / 2) * targetZoom;

      setZoom(targetZoom);
      setPan({ x: targetX, y: targetY });
    },
    [layoutNodes]
  );

  // Focus node triggered from outside (e.g. from Inspector or parent)
  useEffect(() => {
    if (focusTargetNodeId) {
      focusNode(focusTargetNodeId);
      onFocusNodeConsumed?.();
    }
  }, [focusTargetNodeId, focusNode, onFocusNodeConsumed]);

  // Check whether selected account node is currently visible in viewport
  const isSelectedNodeInView = useMemo(() => {
    if (!selectedNodeId || !containerRef.current) return true;
    const target = layoutNodes.find((ln) => ln.node.id === selectedNodeId);
    if (!target) return true;

    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;

    const screenLeft = pan.x + target.x * zoom;
    const screenRight = screenLeft + target.width * zoom;
    const screenTop = pan.y + target.y * zoom;
    const screenBottom = screenTop + target.height * zoom;

    const margin = 20;
    return (
      screenRight > margin &&
      screenLeft < cw - margin &&
      screenBottom > margin &&
      screenTop < ch - margin
    );
  }, [selectedNodeId, layoutNodes, pan, zoom]);

  // Window-level pointer tracking for rock-solid pan dragging AND node dragging in customize mode
  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      // 1. Handle node dragging when Customize Layout mode is active
      if (nodeDragStartRef.current) {
        const currentDrag = nodeDragStartRef.current;
        const dx = e.clientX - currentDrag.startX;
        const dy = e.clientY - currentDrag.startY;

        if (!currentDrag.hasMoved && Math.hypot(dx, dy) > 3) {
          currentDrag.hasMoved = true;
        }

        if (currentDrag.hasMoved) {
          const currentZoom = zoomRef.current;
          // Calculate new coordinates in tree canvas space, bounded safely
          const newX = Math.max(10, Math.round(currentDrag.startNodeX + dx / currentZoom));
          const newY = Math.max(10, Math.round(currentDrag.startNodeY + dy / currentZoom));

          setCustomPositions((prev) => ({
            ...prev,
            [currentDrag.nodeId]: { x: newX, y: newY },
          }));
          setIsLayoutDirty(true);
        }
        return;
      }

      // 2. Handle canvas background panning
      if (!isPointerDownRef.current) return;

      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;

      // Activate drag only after exceeding deliberate threshold (prevents click accidental drags)
      if (!hasMovedRef.current) {
        if (Math.hypot(dx, dy) > 4) {
          hasMovedRef.current = true;
          setIsDragging(true);
        }
      }

      if (hasMovedRef.current) {
        setPan({
          x: panStartRef.current.x + dx,
          y: panStartRef.current.y + dy,
        });
      }
    };

    const handleWindowPointerUp = () => {
      if (nodeDragStartRef.current) {
        const { nodeId, hasMoved } = nodeDragStartRef.current;
        nodeDragStartRef.current = null;
        setDraggedNodeId(null);

        // If user tapped without dragging in customize mode, select the node
        if (!hasMoved) {
          const clickedNode = nodeLookup.get(nodeId);
          if (clickedNode) {
            onSelectNode(clickedNode);
            onSelectEdge(null);
          }
        }
        return;
      }

      if (isPointerDownRef.current) {
        isPointerDownRef.current = false;
        setIsDragging(false);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [nodeLookup, onSelectNode, onSelectEdge]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only primary button
    const target = e.target as HTMLElement;

    // Never initiate background pan when interacting with node cards, buttons, or controls
    if (
      target.closest('.interactive-node-card') ||
      target.closest('button') ||
      target.closest('a') ||
      target.closest('.no-pan')
    ) {
      return;
    }

    isPointerDownRef.current = true;
    hasMovedRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...panRef.current };
  };

  // Node pointer down handler for Customize Layout mode
  const handleNodePointerDown = (
    node: UnifiedTreeNode,
    nodeX: number,
    nodeY: number,
    e: React.PointerEvent
  ) => {
    if (e.button !== 0) return; // Only primary button
    if (!isCustomizeMode) return;

    e.stopPropagation();
    nodeDragStartRef.current = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      startNodeX: nodeX,
      startNodeY: nodeY,
      hasMoved: false,
    };
    setDraggedNodeId(node.id);
  };

  // Native non-passive wheel listener on container to allow e.preventDefault() and prevent Chrome intervention warnings
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      // Prevent browser document scrolling when pointer is over the graph canvas
      e.preventDefault();

      // Trackpad two-finger pan (horizontal or vertical without ctrlKey)
      if (!e.ctrlKey && Math.abs(e.deltaX) > 0) {
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
        return;
      }

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const newZoom = Math.min(2.2, Math.max(0.35, currentZoom * zoomFactor));

      if (newZoom !== currentZoom) {
        const ratio = newZoom / currentZoom;
        const newPanX = cursorX - (cursorX - currentPan.x) * ratio;
        const newPanY = cursorY - (cursorY - currentPan.y) * ratio;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  // Helper notification feedback
  const showFeedback = (msg: string) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedbackMessage(msg);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackMessage(null);
    }, 2800);
  };

  // Save customized layout to browser localStorage
  const handleSaveLayout = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(customPositions));
      setIsLayoutDirty(false);
      showFeedback('Layout saved in browser');
    } catch (err) {
      console.error('Error saving layout to localStorage', err);
      showFeedback('Could not save layout');
    }
  };

  // Reset customized layout to standard hierarchical tree
  const handleResetLayout = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch (err) {
      console.warn('Error clearing layout from localStorage', err);
    }
    setCustomPositions({});
    setIsLayoutDirty(false);
    showFeedback('Reset to default tree layout');
  };

  // Viewport-centered step zoom buttons (+ / -)
  const zoomByStep = (factor: number) => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const centerX = cw / 2;
    const centerY = ch / 2;

    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const newZoom = Math.min(2.2, Math.max(0.35, currentZoom * factor));

    if (newZoom !== currentZoom) {
      const ratio = newZoom / currentZoom;
      const newPanX = centerX - (centerX - currentPan.x) * ratio;
      const newPanY = centerY - (centerY - currentPan.y) * ratio;
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    }
  };

  const handleZoomIn = () => zoomByStep(1.2);
  const handleZoomOut = () => zoomByStep(0.82);

  // Fit tree neatly within canvas viewport bounds
  const handleFitView = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;

    const paddingX = 80;
    const paddingY = 90;
    const availableW = Math.max(200, cw - paddingX);
    const availableH = Math.max(200, ch - paddingY);

    const scaleX = availableW / Math.max(bounds.width, 1);
    const scaleY = availableH / Math.max(bounds.height, 1);
    const newZoom = Math.min(1.15, Math.max(0.38, Math.min(scaleX, scaleY)));

    // Center tree within container
    const newPanX = (cw - bounds.width * newZoom) / 2;
    const newPanY = (ch - bounds.height * newZoom) / 2;

    setZoom(newZoom);
    setPan({ x: Math.max(20, newPanX), y: Math.max(30, newPanY) });
  }, [bounds.width, bounds.height]);

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 40, y: 50 });
    onSelectNode(null);
    onSelectEdge(null);
  };

  // Keyboard navigation shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      handleZoomIn();
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      handleZoomOut();
    } else if (e.key === '0') {
      e.preventDefault();
      handleFitView();
    } else if ((e.key === 'f' || e.key === 'F') && selectedNodeId) {
      e.preventDefault();
      focusNode(selectedNodeId);
    } else if (e.key === 'Escape') {
      onSelectNode(null);
      onSelectEdge(null);
    }
  };

  // Multi-touch pinch gestures for mobile & tablet screens
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchDistanceRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchDistanceRef.current !== null && containerRef.current) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scaleFactor = dist / touchDistanceRef.current;

      if (Math.abs(scaleFactor - 1) > 0.02) {
        const rect = containerRef.current.getBoundingClientRect();
        const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const midY = (t1.clientY + t2.clientY) / 2 - rect.top;

        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;
        const newZoom = Math.min(2.2, Math.max(0.35, currentZoom * scaleFactor));

        if (newZoom !== currentZoom) {
          const ratio = newZoom / currentZoom;
          setZoom(newZoom);
          setPan({
            x: midX - (midX - currentPan.x) * ratio,
            y: midY - (midY - currentPan.y) * ratio,
          });
          touchDistanceRef.current = dist;
        }
      }
    }
  };

  const handleTouchEnd = () => {
    touchDistanceRef.current = null;
  };

  // Reset focus to root node when root account or dataset changes
  useEffect(() => {
    setPan({ x: 40, y: 50 });
    setZoom(1);
  }, [rootAccountId]);

  // Branch collapse toggle
  const toggleCollapse = (nodeId: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleExpandAll = () => setCollapsedNodes(new Set());
  const handleCollapseAllChildren = () => {
    const parents = new Set<string>();
    nodes.forEach((n) => {
      if (n.hop === 1 && (childrenMap.get(n.id)?.length || 0) > 0) {
        parents.add(n.id);
      }
    });
    setCollapsedNodes(parents);
  };

  // Helper customer icon
  const getCustomerIcon = (customerType: string) => {
    switch (customerType?.toLowerCase()) {
      case 'corporate':
        return <Building className="w-3.5 h-3.5 text-[#6B655B]" />;
      case 'student':
        return <GraduationCap className="w-3.5 h-3.5 text-[#3B82F6]" />;
      case 'sme':
        return <CreditCard className="w-3.5 h-3.5 text-[#0F766E]" />;
      default:
        return <User className="w-3.5 h-3.5 text-[#8C857B]" />;
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ height, touchAction: 'none' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative w-full rounded-2xl border border-[#EAE3D6] bg-[#FAF7F2] overflow-hidden select-none blueprint-grid-warm shadow-xs outline-none focus:ring-1 focus:ring-[#EA8500]/40 ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Floating Canvas Action Controls Toolbar */}
      <div className="absolute top-3 right-3 flex flex-wrap items-center gap-1.5 bg-white/95 backdrop-blur-xs border border-[#EAE3D6] rounded-xl p-1.5 shadow-sm z-20">
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-1.5 rounded-lg text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2] transition-colors cursor-pointer"
          title="Zoom In (+)"
          aria-label="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-1.5 rounded-lg text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2] transition-colors cursor-pointer"
          title="Zoom Out (-)"
          aria-label="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleFitView}
          className="p-1.5 rounded-lg text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2] transition-colors cursor-pointer"
          title="Fit Tree to Screen (0)"
          aria-label="Fit View"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleResetView}
          className="p-1.5 rounded-lg text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2] transition-colors cursor-pointer"
          title="Reset Zoom & Selection"
          aria-label="Reset View"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {selectedNodeId && (
          <>
            <div className="w-px h-4 bg-[#EAE3D6] mx-0.5" />
            <button
              type="button"
              onClick={() => focusNode(selectedNodeId)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                !isSelectedNodeInView
                  ? 'bg-[#EA8500] text-white border-[#D27400] shadow-2xs font-bold animate-pulse'
                  : 'bg-[#FAF7F2] hover:bg-[#FFF4E6] text-[#6B655B] hover:text-[#EA8500] border-[#EAE3D6]'
              }`}
              title="Center Selected Account in Viewport (F)"
              aria-label="Center Selected Account"
            >
              <LocateFixed className="w-3.5 h-3.5 text-current" />
              <span className="hidden sm:inline">Center Selected</span>
            </button>
          </>
        )}

        <div className="w-px h-4 bg-[#EAE3D6] mx-0.5" />

        {/* Customize Layout Toggle */}
        <button
          type="button"
          onClick={() => setIsCustomizeMode((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            isCustomizeMode
              ? 'bg-[#EA8500] text-white border-[#D27400] shadow-2xs ring-2 ring-[#EA8500]/30 font-bold'
              : 'bg-[#FAF7F2] hover:bg-[#FFF4E6] text-[#6B655B] hover:text-[#EA8500] border-[#EAE3D6]'
          }`}
          title={isCustomizeMode ? 'Finish custom layout' : 'Customize layout by dragging nodes'}
          aria-pressed={isCustomizeMode}
          aria-label="Customize Layout"
        >
          <Move className="w-3.5 h-3.5 text-current" />
          <span>{isCustomizeMode ? 'Customizing...' : 'Customize Layout'}</span>
        </button>

        {/* Save Layout (visible when dirty or custom layout exists) */}
        {(Object.keys(customPositions).length > 0 || isLayoutDirty) && (
          <button
            type="button"
            onClick={handleSaveLayout}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
              isLayoutDirty
                ? 'bg-[#10B981] text-white border-[#059669] shadow-2xs animate-pulse font-bold'
                : 'bg-[#FAF7F2] hover:bg-[#EAF7EE] text-[#0F766E] border-[#A7F3D0]'
            }`}
            title="Save manual node positions for this graph context in browser"
            aria-label="Save Layout"
          >
            <Save className="w-3.5 h-3.5 text-current" />
            <span className="hidden sm:inline">Save Layout</span>
          </button>
        )}

        {/* Reset to Tree Layout (visible if custom positions exist) */}
        {Object.keys(customPositions).length > 0 && (
          <button
            type="button"
            onClick={handleResetLayout}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FAF7F2] hover:bg-[#FFF0F2] text-[#BE123C] border border-[#FECDD3] transition-colors cursor-pointer"
            title="Restore standard automatic tree layout"
            aria-label="Reset to Tree Layout"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-current" />
            <span className="hidden sm:inline">Reset Tree</span>
          </button>
        )}

        <div className="w-px h-4 bg-[#EAE3D6] mx-0.5" />
        <button
          type="button"
          onClick={collapsedNodes.size > 0 ? handleExpandAll : handleCollapseAllChildren}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FAF7F2] hover:bg-[#FFF4E6] text-[#6B655B] hover:text-[#EA8500] border border-[#EAE3D6] transition-colors cursor-pointer"
          title="Toggle downstream branches visibility"
        >
          {collapsedNodes.size > 0 ? 'Expand All' : 'Collapse Deep'}
        </button>
      </div>

      {/* Temporary Feedback Notification Toast */}
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 bg-[#1A1714] text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2 z-30 pointer-events-none"
          >
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <span>{feedbackMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Canvas Hop Depth Headers Ribbon */}
      <div className="absolute top-3 left-4 flex items-center gap-4 text-[11px] font-mono text-[#8C857B] pointer-events-none z-10">
        <span className="flex items-center gap-1.5 font-bold text-[#EA8500]">
          <span className="w-2 h-2 rounded-full bg-[#EA8500]" />
          ORIGIN (HOP 0)
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3 text-[#B8AF9F]" />
          <span>DIRECT RECIPIENTS (HOP 1)</span>
        </span>
        <span className="hidden sm:flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3 text-[#B8AF9F]" />
          <span>INTERMEDIARY (HOP 2+)</span>
        </span>
        {Object.keys(customPositions).length > 0 && (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#FFF4E6] text-[#C05621] border border-[#FCD5B5] flex items-center gap-1">
            <Move className="w-3 h-3 text-[#EA8500]" />
            MANUAL LAYOUT ACTIVE
          </span>
        )}
      </div>

      {/* Canvas Viewport Frame */}
      <div
        ref={canvasRef}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
          transition: isDragging ? 'none' : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {/* SVG Bezier Connection Layer */}
        <svg
          ref={svgRef}
          width={bounds.width}
          height={bounds.height}
          className="absolute inset-0 pointer-events-auto"
        >
          <defs>
            {/* Standard Directed Transfer Arrow Marker */}
            <marker
              id="tree-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#B8AF9F" />
            </marker>

            {/* Highlighted Orange Active Arrow Marker */}
            <marker
              id="tree-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="#EA8500" />
            </marker>

            {/* Cycle Loop Arrow Marker */}
            <marker
              id="tree-arrow-cycle"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#EA8500" />
            </marker>
          </defs>

          {/* Render All Traced Transaction Curves */}
          {layoutEdges.map((le) => {
            if (!le.isVisible) return null;

            const isSelected = selectedEdgeId === le.edge.id;
            const isInActivePath = activePathElements.activeEdgeIds.has(le.edge.id);
            const isHovered = hoveredEdgeId === le.edge.id;

            // Subdue lines if something else is selected
            const hasSelection = selectedNodeId !== null || selectedEdgeId !== null;
            const isSubdued = hasSelection && !isInActivePath && !isSelected;

            let strokeColor = '#D4CBBF';
            let strokeWidth = 2.2;
            let marker = 'url(#tree-arrow)';

            if (isSelected || isInActivePath) {
              strokeColor = '#EA8500';
              strokeWidth = 3.6;
              marker = 'url(#tree-arrow-active)';
            } else if (le.isCycle) {
              strokeColor = '#EA8500';
              strokeWidth = 2.4;
              marker = 'url(#tree-arrow-cycle)';
            } else if (isHovered) {
              strokeColor = '#6B655B';
              strokeWidth = 2.8;
            }

            return (
              <g
                key={le.edge.id}
                className="cursor-pointer transition-opacity duration-200"
                style={{ opacity: isSubdued ? 0.22 : 1 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdge(le.edge);
                  onSelectNode(null);
                }}
                onMouseEnter={() => setHoveredEdgeId(le.edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
              >
                {/* Invisible wide hitbox for easy clicking */}
                <path
                  d={le.pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                  strokeLinecap="round"
                />

                {/* Visible Directed Bezier Path */}
                <path
                  id={`path-${le.edge.id}`}
                  className="tree-edge-path"
                  d={le.pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={le.isCycle ? '6 4' : undefined}
                  markerEnd={marker}
                />

                {/* Edge Badge: Currency Amount & Rail pill */}
                <foreignObject
                  x={le.midX - 58}
                  y={le.midY - 14}
                  width="116"
                  height="28"
                  className="overflow-visible pointer-events-auto"
                >
                  <div
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center justify-center gap-1 shadow-2xs border transition-all ${
                      isSelected || isInActivePath
                        ? 'bg-[#FFF4E6] text-[#C05621] border-[#EA8500] scale-105 ring-2 ring-[#EA8500]/25'
                        : le.isCycle
                        ? 'bg-[#FFF8EE] text-[#C05621] border-[#FCD5B5]'
                        : 'bg-white text-[#1A1714] border-[#EAE3D6] hover:border-[#EA8500] hover:text-[#EA8500]'
                    }`}
                  >
                    {le.isCycle && <Repeat className="w-2.5 h-2.5 text-[#EA8500]" />}
                    <span>₹{le.edge.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    <span className="text-[9px] text-[#6B655B] font-normal">{le.edge.channel}</span>
                  </div>
                </foreignObject>
              </g>
            );
          })}

          {/* Traveling GSAP Orange Particle */}
          <circle
            ref={particleRef}
            r="4.5"
            fill="#EA8500"
            stroke="#FFFFFF"
            strokeWidth="1.5"
            className="filter drop-shadow-sm pointer-events-none"
            style={{ opacity: selectedEdgeId || selectedNodeId ? 1 : 0 }}
          />
        </svg>

        {/* HTML Interactive Node Cards Layer */}
        {layoutNodes.map((ln) => {
          if (!ln.isVisible) return null;

          const isSelected = selectedNodeId === ln.node.id;
          const isInActivePath = activePathElements.activeNodeIds.has(ln.node.id);
          const hasSelection = selectedNodeId !== null || selectedEdgeId !== null;
          const isSubdued = hasSelection && !isInActivePath && !isSelected;

          const hasChildren = ln.hasChildren;
          const isCollapsed = ln.isCollapsed;

          const isCurrentlyDragged = draggedNodeId === ln.node.id;

          return (
            <div
              key={ln.node.id}
              style={{
                position: 'absolute',
                left: `${ln.x}px`,
                top: `${ln.y}px`,
                width: `${ln.width}px`,
                height: `${ln.height}px`,
                opacity: isSubdued ? 0.28 : 1,
                zIndex: isCurrentlyDragged ? 40 : isSelected ? 30 : 10,
                touchAction: 'none',
              }}
              className={`pointer-events-auto transition-opacity duration-200 ${
                isCurrentlyDragged ? 'scale-[1.03] transition-transform duration-75' : ''
              }`}
            >
              <div
                onPointerDown={(e) => {
                  if (isCustomizeMode) {
                    handleNodePointerDown(ln.node, ln.x, ln.y, e);
                  } else {
                    e.stopPropagation();
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isCustomizeMode) {
                    onSelectNode(ln.node);
                    onSelectEdge(null);
                  }
                }}
                className={`interactive-node-card group relative w-full h-full bg-white rounded-xl p-2.5 flex flex-col justify-between border-2 transition-all shadow-xs select-none ${
                  isCustomizeMode
                    ? isCurrentlyDragged
                      ? 'cursor-grabbing border-[#EA8500] ring-4 ring-[#EA8500]/30 shadow-xl bg-[#FFFBF6]'
                      : 'cursor-grab border-[#EAE3D6] hover:border-[#EA8500] hover:shadow-md'
                    : isSelected
                    ? 'cursor-pointer border-[#EA8500] ring-4 ring-[#EA8500]/15 bg-[#FFFBF6]'
                    : ln.node.isRoot
                    ? 'cursor-pointer border-[#EA8500] bg-[#FFF8EE]'
                    : 'cursor-pointer border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md'
                }`}
              >
                {/* Card Top: Icon, ID & Status Badge */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isCustomizeMode && (
                      <span className="p-0.5 rounded text-[#8C857B] group-hover:text-[#EA8500] cursor-grab">
                        <GripVertical className="w-3.5 h-3.5 text-current" />
                      </span>
                    )}
                    <span
                      className={`p-1 rounded-lg shrink-0 ${
                        ln.node.isRoot
                          ? 'bg-[#EA8500] text-white'
                          : 'bg-[#FAF7F2] border border-[#EAE3D6]'
                      }`}
                    >
                      {getCustomerIcon(ln.node.customerType)}
                    </span>
                    <span className="font-mono font-bold text-xs text-[#1A1714] truncate">
                      {ln.node.id}
                    </span>
                  </div>

                  <span
                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-md border shrink-0 ${
                      ln.node.isRoot
                        ? 'bg-[#FFF4E6] text-[#C05621] border-[#FCD5B5]'
                        : ln.node.statusVariant === 'cleared'
                        ? 'bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]'
                        : ln.node.statusVariant === 'investigation'
                        ? 'bg-[#FFF0F2] text-[#BE123C] border-[#FECDD3]'
                        : 'bg-[#FAF7F2] text-[#6B655B] border-[#EAE3D6]'
                    }`}
                  >
                    {isCustomizeMode && isCurrentlyDragged ? 'Moving...' : ln.node.statusLabel}
                  </span>
                </div>

                {/* Card Bottom: Customer Name & Hop / Balance */}
                <div className="flex items-end justify-between gap-1 text-[11px] pt-1 border-t border-[#FAF7F2]">
                  <div className="truncate text-[#6B655B] font-medium leading-tight">
                    <span className="truncate block font-display text-[#1A1714]">
                      {ln.node.name}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-[#8C857B] shrink-0">
                    {ln.node.isRoot ? 'Root' : `Hop ${ln.node.hop}`}
                  </span>
                </div>

                {/* Branch Expand / Collapse Toggle Pill (on right edge) - only when not customizing */}
                {hasChildren && !isCustomizeMode && (
                  <button
                    type="button"
                    onClick={(ev) => toggleCollapse(ln.node.id, ev)}
                    title={isCollapsed ? 'Expand downstream branch' : 'Collapse downstream branch'}
                    className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shadow-xs border transition-all z-20 cursor-pointer ${
                      isCollapsed
                        ? 'bg-[#EA8500] text-white border-[#D27400] hover:scale-110'
                        : 'bg-white text-[#6B655B] border-[#EAE3D6] hover:border-[#EA8500] hover:text-[#EA8500]'
                    }`}
                  >
                    {isCollapsed ? '+' : '–'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Forensic Legend Overlay */}
      <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs border border-[#EAE3D6] rounded-xl px-3.5 py-1.5 text-[11px] text-[#6B655B] shadow-sm flex flex-wrap items-center gap-4 z-20">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3 h-3 rounded-md bg-[#FFF4E6] border-2 border-[#EA8500]" />
          <span>Root Origin</span>
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3 h-3 rounded-md bg-white border border-[#DDD4C4]" />
          <span>Counterparty</span>
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-4 h-0.5 bg-[#EA8500]" />
          <span>Selected Route</span>
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-5 h-0 border-t-2 border-dashed border-[#EA8500]" />
          <span>Cycle / Loop</span>
        </span>
      </div>

      {/* Interactive Navigation Helper Hint */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-white/95 backdrop-blur-xs border border-[#EAE3D6] rounded-xl px-3 py-1.5 text-[11px] font-mono text-[#6B655B] shadow-xs z-20 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500] shrink-0" />
        {isCustomizeMode ? (
          <span>Drag cards to rearrange · Click Save Layout when finished</span>
        ) : (
          <>
            <span className="hidden sm:inline">Scroll to zoom · Drag canvas to move · Select an account to inspect</span>
            <span className="sm:hidden">Scroll to zoom · Drag to move</span>
          </>
        )}
      </div>
    </div>
  );
};
