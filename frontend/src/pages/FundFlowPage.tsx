import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Network,
  List,
  RefreshCw,
  Search,
  Scale,
  AlertTriangle,
  ArrowRight,
  Filter,
  CheckCircle2,
  SlidersHorizontal,
  Info,
  FolderGit2,
  Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';
import {
  adaptCaseTraceToUnified,
  adaptV2TraceToUnified,
  FlowTraceMode,
  UnifiedFlowData,
  UnifiedTreeEdge,
  UnifiedTreeNode,
} from '../services/unifiedFlowAdapter';
import { normalizeAccountId } from './v2/V2SearchPage';
import { FundFlowHierarchicalTree } from '../components/fund-flow/FundFlowHierarchicalTree';
import { FundFlowInspector } from '../components/fund-flow/FundFlowInspector';
import { FundFlowListView } from '../components/fund-flow/FundFlowListView';

const CURATED_DEMO_PRESETS = [
  { id: 'ACC-000001', label: 'Aditi Joshi (Victim Demo)', mode: 'account' as const, note: 'Scam victim drain' },
  { id: 'ACC-000002', label: 'Sara Bhat (Mule Demo)', mode: 'account' as const, note: 'Rapid pass-through (<12 min)' },
  { id: 'ACC-000003', label: 'Ishan Reddy (Hop 2)', mode: 'account' as const, note: 'Connected recipient' },
  { id: 'ACC-000010', label: 'Arjun Sengupta (Normal)', mode: 'account' as const, note: 'Everyday baseline' },
  { id: 'FS-1042', label: 'Case FS-1042 (Disputed Origin)', mode: 'case' as const, note: 'Synthetic ₹50k fraud case' },
];

export const FundFlowPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read URL query params with graceful fallbacks
  const urlCaseId = searchParams.get('caseId');
  const urlAccount = searchParams.get('account');
  const urlDirection = (searchParams.get('direction') as 'outgoing' | 'incoming' | 'both') || 'outgoing';
  const urlDepth = Number(searchParams.get('depth')) || 2;
  const urlView = (searchParams.get('view') as 'graph' | 'list') || 'graph';

  // Mode: if caseId is explicitly provided and no account, or if user explicitly chose case mode
  const initialMode: FlowTraceMode = urlCaseId && !urlAccount ? 'case' : 'account';
  const initialTarget = urlCaseId || urlAccount || 'ACC-000001';

  // State
  const [traceMode, setTraceMode] = useState<FlowTraceMode>(initialMode);
  const [targetId, setTargetId] = useState<string>(initialTarget);
  const [searchQuery, setSearchQuery] = useState<string>(initialTarget);
  const [direction, setDirection] = useState<'outgoing' | 'incoming' | 'both'>(urlDirection);
  const [maxDepth, setMaxDepth] = useState<number>(urlDepth);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>(urlView);

  // Loaded Data
  const [flowData, setFlowData] = useState<UnifiedFlowData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Selected Elements
  const [selectedNode, setSelectedNode] = useState<UnifiedTreeNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<UnifiedTreeEdge | null>(null);
  const [focusTargetNodeId, setFocusTargetNodeId] = useState<string | null>(null);

  // Update URL Search Params synchronously
  const syncUrlParams = useCallback(
    (newParams: { mode?: FlowTraceMode; id?: string; dir?: string; depth?: number; view?: string }) => {
      const p = new URLSearchParams(searchParams);
      const m = newParams.mode ?? traceMode;
      const target = newParams.id ?? targetId;
      const dir = newParams.dir ?? direction;
      const d = newParams.depth ?? maxDepth;
      const v = newParams.view ?? viewMode;

      if (m === 'case') {
        p.set('caseId', target);
        p.delete('account');
      } else {
        p.set('account', target);
        p.delete('caseId');
      }
      p.set('direction', dir);
      p.set('depth', String(d));
      p.set('view', v);

      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams, traceMode, targetId, direction, maxDepth, viewMode]
  );

  // Main Data Fetcher
  const fetchFlowData = useCallback(
    async (mode: FlowTraceMode, id: string, dir: 'outgoing' | 'incoming' | 'both', depth: number) => {
      setLoading(true);
      setError(null);

      try {
        if (mode === 'case') {
          // Fetch V1 Case Graph & Trace
          const [v1Graph, v1Trace] = await Promise.all([
            api.getCaseGraph(id, depth),
            api.getCaseTrace(id, depth).catch(() => null),
          ]);

          const unified = adaptCaseTraceToUnified(id, v1Graph, v1Trace);
          setFlowData(unified);

          // Keep selection if previously selected
          setSelectedNode((prev) => (prev ? unified.nodes.find((n) => n.id === prev.id) || null : null));
          setSelectedEdge((prev) => (prev ? unified.edges.find((e) => e.id === prev.id) || null : null));
        } else {
          // Fetch V2 Account Trace
          const normalizedId = normalizeAccountId(id) || 'ACC-000001';
          const v2Res = await v2Api.getTrace({
            account_id: normalizedId,
            direction: dir,
            max_depth: Math.min(6, depth),
            max_nodes: 60,
          });

          const unified = adaptV2TraceToUnified(v2Res);
          setFlowData(unified);

          setSelectedNode((prev) => (prev ? unified.nodes.find((n) => n.id === prev.id) || null : null));
          setSelectedEdge((prev) => (prev ? unified.edges.find((e) => e.id === prev.id) || null : null));
        }
      } catch (err: any) {
        console.error('Fund flow fetch error:', err);
        setError(
          err?.message ||
            (mode === 'account'
              ? `Account '${id}' was not found in the V2 ledger.`
              : `Case '${id}' could not be loaded.`)
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Trigger fetch when target or controls change
  useEffect(() => {
    fetchFlowData(traceMode, targetId, direction, maxDepth);
  }, [traceMode, targetId, direction, maxDepth, fetchFlowData]);

  // Handle Search Submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    if (query.toUpperCase().startsWith('FS-') || query.toUpperCase().startsWith('CASE-')) {
      const formattedCase = query.toUpperCase();
      setTraceMode('case');
      setTargetId(formattedCase);
      syncUrlParams({ mode: 'case', id: formattedCase });
    } else {
      const normalized = normalizeAccountId(query);
      setTraceMode('account');
      setTargetId(normalized);
      setSearchQuery(normalized);
      syncUrlParams({ mode: 'account', id: normalized });
    }
  };

  // Quick Preset Selection
  const handleSelectPreset = (preset: typeof CURATED_DEMO_PRESETS[0]) => {
    setTraceMode(preset.mode);
    setTargetId(preset.id);
    setSearchQuery(preset.id);
    setSelectedNode(null);
    setSelectedEdge(null);
    syncUrlParams({ mode: preset.mode, id: preset.id });
  };

  // Select account node by ID (e.g. from table or inspector)
  const handleSelectNodeById = (accountId: string) => {
    if (!flowData) return;
    const node = flowData.nodes.find((n) => n.id === accountId);
    if (node) {
      setSelectedNode(node);
      setSelectedEdge(null);
      setFocusTargetNodeId(accountId);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Page Header & Ethical Safeguard Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#EAE3D6]">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#EA8500]">
              FUND FLOW EXPLORER · HIERARCHICAL TREE
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#FFF4E6] text-[#C05621] border border-[#FCD5B5]">
              {traceMode === 'account' ? 'ACCOUNT TRACE (V2)' : 'CASE TRACE (FS-1042)'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1A1714] font-display tracking-tight mt-1">
            Follow the money
          </h1>
          <p className="text-xs sm:text-sm text-[#6B655B] mt-1 max-w-2xl leading-relaxed">
            See where money moved from an account, inspect connected recipients, and follow each transfer step by step.
          </p>
        </div>

        {/* View Mode & Reload Controls */}
        <div className="flex items-center gap-2 self-start md:self-end">
          <div className="flex rounded-xl border border-[#EAE3D6] overflow-hidden bg-[#FAF7F2] p-0.5 text-xs" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'graph'}
              onClick={() => {
                setViewMode('graph');
                syncUrlParams({ view: 'graph' });
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold transition-all cursor-pointer ${
                viewMode === 'graph'
                  ? 'bg-[#EA8500] text-white shadow-2xs'
                  : 'text-[#6B655B] hover:text-[#1A1714]'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Tree Graph</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              onClick={() => {
                setViewMode('list');
                syncUrlParams({ view: 'list' });
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-[#EA8500] text-white shadow-2xs'
                  : 'text-[#6B655B] hover:text-[#1A1714]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Transfers List</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => fetchFlowData(traceMode, targetId, direction, maxDepth)}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#1A1714] transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            title="Reload Flow"
            aria-label="Reload Flow Data"
          >
            <RefreshCw className={`w-4 h-4 text-[#EA8500] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Contextual Guidance: How to read the money flow tree */}
      <div className="p-3.5 rounded-2xl bg-white border border-[#EAE3D6] text-xs space-y-2 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#1A1714] flex items-center gap-1.5">
            <Info className="w-4 h-4 text-[#EA8500]" />
            <span>How to navigate and interpret this money flow tree:</span>
          </span>
          <span className="font-mono text-[11px] text-[#8C857B]">Left-to-Right Hierarchy</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[#6B655B] text-[11px] leading-relaxed">
          <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
            <strong className="text-[#1A1714] block font-semibold mb-0.5">1. Nodes = Accounts</strong>
            Cards represent accounts in the core ledger. Badges distinguish root victims, conduits, and downstream recipients.
          </div>
          <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
            <strong className="text-[#1A1714] block font-semibold mb-0.5">2. Arrows = Transfers</strong>
            Lines show direction and payment rails (UPI, IMPS, NEFT) with transferred amount and attribution share.
          </div>
          <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
            <strong className="text-[#1A1714] block font-semibold mb-0.5">3. Hop Distance</strong>
            Hops count steps from the root. Intermediate nodes with low dwell time indicate potential layering conduits.
          </div>
          <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
            <strong className="text-[#1A1714] block font-semibold mb-0.5">4. Inspect & Open</strong>
            Click any account node to open the side inspector, view counterparty details, or launch full Account Intelligence.
          </div>
        </div>
      </div>

      {/* Ethical Safeguard Notice */}
      <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FFFBF6] border border-[#FCD5B5] text-xs text-[#C05621]">
        <Scale className="w-4 h-4 text-[#EA8500] shrink-0" />
        <span className="leading-tight">
          <strong>Fairness Safeguard:</strong> An account's connection to a suspicious transfer does not prove wrongdoing. All findings require appropriate review.
        </span>
      </div>

      {/* 2. Interactive Trace Controls Toolbar */}
      <div className="bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Target Search & Mode Toggle */}
          <div className="flex flex-wrap items-center gap-2.5 flex-1 max-w-xl">
            {/* Mode Selector Pill Toggle */}
            <div className="flex rounded-xl border border-[#EAE3D6] bg-[#FAF7F2] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setTraceMode('account');
                  setTargetId('ACC-000001');
                  setSearchQuery('ACC-000001');
                  syncUrlParams({ mode: 'account', id: 'ACC-000001' });
                }}
                className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  traceMode === 'account'
                    ? 'bg-white text-[#EA8500] shadow-2xs font-bold border border-[#EAE3D6]'
                    : 'text-[#6B655B] hover:text-[#1A1714]'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Account Root</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTraceMode('case');
                  setTargetId('FS-1042');
                  setSearchQuery('FS-1042');
                  syncUrlParams({ mode: 'case', id: 'FS-1042' });
                }}
                className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  traceMode === 'case'
                    ? 'bg-white text-[#EA8500] shadow-2xs font-bold border border-[#EAE3D6]'
                    : 'text-[#6B655B] hover:text-[#1A1714]'
                }`}
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>Case FS-1042</span>
              </button>
            </div>

            {/* Root Search Form */}
            <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C857B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={traceMode === 'account' ? 'Enter Account ID (e.g. ACC-000001)...' : 'Enter Case ID (e.g. FS-1042)...'}
                className="w-full pl-9 pr-14 py-2 bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl text-xs text-[#1A1714] font-mono focus:outline-none focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-[#EA8500] hover:bg-[#D27400] text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                Trace
              </button>
            </form>
          </div>

          {/* Flow Direction & Depth Controls */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Flow Direction Toggle */}
            <div className="flex items-center gap-1.5 bg-[#FAF7F2] px-2 py-1 rounded-xl border border-[#EAE3D6]">
              <span className="text-[11px] font-mono text-[#8C857B] pl-1">FLOW:</span>
              {(['outgoing', 'incoming', 'both'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => {
                    setDirection(dir);
                    syncUrlParams({ dir });
                  }}
                  className={`px-2 py-0.5 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                    direction === dir
                      ? 'bg-white text-[#EA8500] shadow-2xs border border-[#EAE3D6] font-bold'
                      : 'text-[#6B655B] hover:text-[#1A1714]'
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>

            {/* Depth Selector */}
            <div className="flex items-center gap-2 bg-[#FAF7F2] px-3 py-1.5 rounded-xl border border-[#EAE3D6]">
              <span className="text-[11px] font-mono text-[#8C857B]">HOPS:</span>
              <select
                value={maxDepth}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  setMaxDepth(d);
                  syncUrlParams({ depth: d });
                }}
                className="text-xs font-mono font-bold text-[#1A1714] bg-transparent outline-none cursor-pointer"
                aria-label="Max Hop Depth"
              >
                <option value={1}>1 Hop (Direct)</option>
                <option value={2}>2 Hops (Default)</option>
                <option value={3}>3 Hops</option>
                <option value={4}>4 Hops</option>
                <option value={5}>5 Hops</option>
              </select>
            </div>
          </div>
        </div>

        {/* Curated Demo Account Jump Ribbon */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#FAF7F2] text-xs">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#8C857B] mr-1">
            Demo Presets:
          </span>
          {CURATED_DEMO_PRESETS.map((preset) => {
            const isActive = targetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-2.5 py-1 rounded-xl text-xs font-mono font-semibold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-[#FFF4E6] text-[#C05621] border-[#EA8500] shadow-2xs font-bold ring-2 ring-[#EA8500]/15'
                    : 'bg-[#FAF7F2] hover:bg-white text-[#6B655B] hover:text-[#1A1714] border-[#EAE3D6]'
                }`}
              >
                <span>{preset.id}</span>
                <span className="text-[10px] font-normal opacity-80 hidden sm:inline">({preset.note})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchFlowData(traceMode, targetId, direction, maxDepth)}
            className="underline font-bold text-red-900 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* 3. Summary Metrics Strip */}
      {flowData && (
        <div className="bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
            <div>
              <span className="text-[#8C857B] font-mono text-[10px] uppercase block">Origin Account</span>
              <span className="text-sm sm:text-base font-bold font-mono text-[#1A1714] truncate block">
                {flowData.summary.rootAccountId}
              </span>
              <span className="text-[10px] text-[#6B655B] truncate block">
                {flowData.summary.rootCustomerName}
              </span>
            </div>

            <div>
              <span className="text-[#8C857B] font-mono text-[10px] uppercase block">
                Direct Outflow (Hop 1)
              </span>
              <span className="text-sm sm:text-base font-bold font-mono text-[#1A1714] tabular-nums">
                ₹{flowData.summary.directTransferAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-[#6B655B] block">Initial disbursement</span>
            </div>

            <div>
              <span className="text-[#8C857B] font-mono text-[10px] uppercase flex items-center gap-1">
                Attributed Exposure
                <span title="Initial flow originating from root. Downstream re-transfers are not added to this exposure total.">
                  <Info className="w-3 h-3 text-[#EA8500]" />
                </span>
              </span>
              <span className="text-sm sm:text-base font-bold font-mono text-[#EA8500] tabular-nums">
                ₹{flowData.summary.attributedExposureUpperBound.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-[#6B655B] block">Bounded scenario exposure</span>
            </div>

            <div>
              <span className="text-[#8C857B] font-mono text-[10px] uppercase block">Ledger Movement</span>
              <span className="text-sm sm:text-base font-bold font-mono text-[#1A1714] tabular-nums">
                ₹{flowData.summary.observedTotalTransferred.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[10px] text-[#6B655B] block">All visible legs summed</span>
            </div>

            <div>
              <span className="text-[#8C857B] font-mono text-[10px] uppercase block">Explored Scope</span>
              <span className="text-sm sm:text-base font-bold font-mono text-[#1A1714]">
                {flowData.summary.accountsCount} Accs · {flowData.summary.edgesCount} Legs
              </span>
              <span className="text-[10px] text-[#6B655B] block">
                Max Hop {flowData.summary.maxHopDepth} reached
              </span>
            </div>
          </div>

          {/* Truncation Notice (if perimeter hit configured limits) */}
          {flowData.summary.isTruncated && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#FFF8EE] border border-[#FCD5B5] text-[#C05621] text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#EA8500] shrink-0" />
                <span>
                  <strong>Exploration Perimeter Truncated:</strong> {flowData.summary.truncationReason}
                </span>
              </div>
              {maxDepth < 5 && (
                <button
                  type="button"
                  onClick={() => {
                    const newDepth = Math.min(5, maxDepth + 1);
                    setMaxDepth(newDepth);
                    syncUrlParams({ depth: newDepth });
                  }}
                  className="px-2.5 py-1 bg-[#EA8500] text-white font-bold rounded-lg text-xs hover:bg-[#D27400] transition-colors shrink-0 cursor-pointer"
                >
                  Increase to {maxDepth + 1} Hops
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Main Workspace: Hierarchical Tree / List + Synchronized Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left/Main Flow Visualizer (7-8 columns on desktop) */}
        <div className="lg:col-span-8 space-y-4">
          {viewMode === 'graph' ? (
            flowData ? (
              <FundFlowHierarchicalTree
                nodes={flowData.nodes}
                edges={flowData.edges}
                rootAccountId={flowData.summary.rootAccountId}
                selectedNodeId={selectedNode?.id || null}
                selectedEdgeId={selectedEdge?.id || null}
                focusTargetNodeId={focusTargetNodeId}
                onFocusNodeConsumed={() => setFocusTargetNodeId(null)}
                onSelectNode={(node) => {
                  setSelectedNode(node);
                  setSelectedEdge(null);
                }}
                onSelectEdge={(edge) => {
                  setSelectedEdge(edge);
                  setSelectedNode(null);
                }}
                height="600px"
              />
            ) : (
              <div className="h-[560px] rounded-2xl border border-[#EAE3D6] bg-white flex flex-col items-center justify-center text-xs font-mono text-[#8C857B] gap-2">
                <RefreshCw className={`w-5 h-5 text-[#EA8500] ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Building hierarchical money flow tree...' : 'No flow records found.'}</span>
              </div>
            )
          ) : flowData ? (
            <FundFlowListView
              edges={flowData.edges}
              nodes={flowData.nodes}
              selectedEdgeId={selectedEdge?.id || null}
              onSelectEdge={(edge) => {
                setSelectedEdge(edge);
                setSelectedNode(null);
              }}
              onSelectNodeById={handleSelectNodeById}
            />
          ) : (
            <div className="p-8 text-center text-xs text-[#8C857B]">Loading transactions list...</div>
          )}
        </div>

        {/* Right Forensic Dossier Inspector (4 columns on desktop, stacks below on mobile) */}
        <div className="lg:col-span-4">
          <FundFlowInspector
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            allEdges={flowData?.edges || []}
            allNodes={flowData?.nodes || []}
            onSelectNode={(node) => {
              setSelectedNode(node);
              setSelectedEdge(null);
            }}
            onSelectEdge={(edge) => {
              setSelectedEdge(edge);
              setSelectedNode(null);
            }}
            onClose={() => {
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
            mode={traceMode}
            caseId={targetId}
            onFocusNode={(nodeId) => setFocusTargetNodeId(nodeId)}
          />
        </div>
      </div>
    </div>
  );
};

export default FundFlowPage;
