import React, { useEffect, useState } from 'react';
import {
  Network,
  ListFilter,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Info,
  Clock,
  User,
  ArrowUpRight,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { FraudCase, GraphEdge, GraphNode, GraphResponse, TraceResult } from '../types/api';
import { CytoscapeGraph } from '../components/network/CytoscapeGraph';
import { Badge } from '../components/common/Badge';

export const FundFlowPage: React.FC = () => {
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('FS-1042');
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [maxDepth, setMaxDepth] = useState<number>(10);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load cases list on mount
  useEffect(() => {
    api
      .getCases(0, 50)
      .then((res) => {
        setCases(res.cases);
        if (res.cases.length > 0 && !res.cases.some((c) => c.case_id === selectedCaseId)) {
          setSelectedCaseId(res.cases[0].case_id);
        }
      })
      .catch((err) => {
        setError(err?.message || 'Failed to fetch cases list.');
      });
  }, []);

  // Fetch graph & trace when selectedCaseId or maxDepth changes
  const fetchGraphAndTrace = async (caseId: string, depth: number) => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    try {
      const [graph, trace] = await Promise.all([
        api.getCaseGraph(caseId, depth),
        api.getCaseTrace(caseId, depth),
      ]);
      setGraphData(graph);
      setTraceData(trace);
    } catch (err: any) {
      setError(err?.message || 'Failed to load fund flow data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      fetchGraphAndTrace(selectedCaseId, maxDepth);
    }
  }, [selectedCaseId, maxDepth]);

  return (
    <div className="space-y-6">
      {/* Top Header & Case Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Fund Flow Network Explorer</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              DAG Flow Engine
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Explore directional money paths, intermediate recipient hops, and exposure balances.
          </p>
        </div>

        {/* Case & View Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Select Case */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500">Case:</span>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="text-xs font-bold text-slate-900 bg-transparent outline-none cursor-pointer"
            >
              {cases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} ({c.investigation_status})
                </option>
              ))}
            </select>
          </div>

          {/* Depth Selector */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-semibold text-slate-500">Max Depth:</span>
            <select
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              className="text-xs font-bold text-slate-900 bg-transparent outline-none cursor-pointer"
            >
              <option value={1}>1 Hop</option>
              <option value={2}>2 Hops</option>
              <option value={5}>5 Hops</option>
              <option value={10}>10 Hops (Default)</option>
              <option value={20}>20 Hops</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-slate-200/80">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                viewMode === 'graph' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Graph View
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              List View
            </button>
          </div>

          <button
            onClick={() => fetchGraphAndTrace(selectedCaseId, maxDepth)}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 shadow-2xs transition-colors"
            title="Reload Graph"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchGraphAndTrace(selectedCaseId, maxDepth)} className="underline font-bold ml-4">
            Retry
          </button>
        </div>
      )}

      {/* Top Case Metrics Summary Banner */}
      {traceData && (
        <div className="glass-card rounded-2xl p-4 border border-slate-200/80 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div>
            <span className="text-slate-500 block text-[11px]">Reported Stolen</span>
            <span className="text-base font-bold text-slate-900">
              ₹{traceData.summary.reported_amount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Traceable Amount</span>
            <span className="text-base font-bold text-indigo-600">
              ₹{traceData.summary.traceable_amount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Located in Network</span>
            <span className="text-base font-bold text-emerald-600">
              ₹{traceData.summary.located_amount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Connected Accounts</span>
            <span className="text-base font-bold text-slate-900">
              {traceData.summary.linked_account_count} Accounts
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Fund Flow Paths</span>
            <span className="text-base font-bold text-slate-900">{traceData.paths.length} Active Paths</span>
          </div>
        </div>
      )}

      {/* Main Workspace: Graph / List & Details Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Visualizer / List (8 columns) */}
        <div className="lg:col-span-8 space-y-4">
          {viewMode === 'graph' ? (
            graphData ? (
              <CytoscapeGraph
                nodes={graphData.nodes}
                edges={graphData.edges}
                selectedNodeId={selectedNode?.id}
                selectedEdgeId={selectedEdge?.id}
                onSelectNode={(node) => {
                  setSelectedNode(node);
                  setSelectedEdge(null);
                }}
                onSelectEdge={(edge) => {
                  setSelectedEdge(edge);
                  setSelectedNode(null);
                }}
                height="560px"
              />
            ) : (
              <div className="h-[560px] rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-xs text-slate-400">
                {loading ? 'Calculating fund paths...' : 'No graph data available.'}
              </div>
            )
          ) : (
            /* List View of All Traced Paths */
            <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4">
              <h2 className="text-sm font-bold text-slate-900">Downstream Attributed Fund Paths</h2>
              <div className="space-y-3">
                {traceData?.paths.map((p) => (
                  <div key={p.path_id} className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-700 font-mono text-sm">{p.path_id}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-semibold">
                        Termination: {p.termination_reason}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-600 font-mono">
                      <span>{p.account_ids.join(' ──► ')}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/40 text-[11px] text-slate-500">
                      <div>Hops: {p.hop_count}</div>
                      <div>Max Amount: ₹{p.max_attributable_amount?.toLocaleString() ?? 'N/A'}</div>
                      <div>Terminal: {p.terminal_account_id}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transactions Table Underneath */}
          {graphData && (
            <div className="glass-card rounded-2xl overflow-hidden border border-slate-200/80">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Traced Legs ({graphData.edges.length} Transactions)
                </span>
                <span className="text-[11px] text-slate-500">Click row to highlight edge</span>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200/60 text-slate-500 font-semibold sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">TX ID</th>
                      <th className="py-2.5 px-3">From</th>
                      <th className="py-2.5 px-3">To</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Hop</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {graphData.edges.map((e) => (
                      <tr
                        key={e.id}
                        onClick={() => {
                          setSelectedEdge(e);
                          setSelectedNode(null);
                        }}
                        className={`cursor-pointer transition-colors ${
                          selectedEdge?.id === e.id ? 'bg-indigo-50 font-semibold' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono text-indigo-600">{e.id}</td>
                        <td className="py-2 px-3 font-mono">{e.source}</td>
                        <td className="py-2 px-3 font-mono">{e.target}</td>
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          ₹{e.amount.toLocaleString()}
                        </td>
                        <td className="py-2 px-3">{e.transaction_type}</td>
                        <td className="py-2 px-3 text-slate-500">{e.hop_count ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Account / Transaction Detail Sidebar (4 columns) */}
        <div className="lg:col-span-4 space-y-4">
          {selectedNode ? (
            /* Account Detail Card */
            <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 font-mono">{selectedNode.id}</h3>
                    <span className="text-[10px] text-slate-500 block">{selectedNode.label}</span>
                  </div>
                </div>
                <Badge variant="role" value={selectedNode.role} />
              </div>

              {/* Exposure metrics */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Structural Role:</span>
                  <span className="font-semibold text-slate-900 capitalize">{selectedNode.role.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Hop Distance:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedNode.hop_count !== null ? `Hop ${selectedNode.hop_count}` : 'Origin / Direct'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Unforwarded Attributed:</span>
                  <span className="font-bold text-indigo-700">
                    ₹{selectedNode.attributed_unforwarded_amount?.toLocaleString() ?? '0'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Review State:</span>
                  <Badge variant="review" value={selectedNode.review_state || 'not_reviewed'} />
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Evidence Quality:</span>
                  <span className="font-semibold text-slate-700 capitalize">
                    {selectedNode.evidence_quality?.replace('_', ' ') || 'Not Assessed'}
                  </span>
                </div>
              </div>

              {/* Innocent Protection Disclaimer */}
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/70 text-[11px] text-amber-900 leading-relaxed">
                <strong>Fairness Protection:</strong> Merely receiving downstream funds does not imply complicity. Legitimate merchants or contractors may hold unforwarded amounts.
              </div>
            </div>
          ) : selectedEdge ? (
            /* Transaction Detail Card */
            <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-mono">{selectedEdge.id}</h3>
                  <span className="text-[10px] text-slate-500">Payment Leg</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-200">
                  {selectedEdge.transaction_type}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">From Account:</span>
                  <span className="font-mono font-bold text-slate-800">{selectedEdge.source}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">To Account:</span>
                  <span className="font-mono font-bold text-slate-800">{selectedEdge.target}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Amount:</span>
                  <span className="font-bold text-base text-slate-900">
                    ₹{selectedEdge.amount.toLocaleString()} {selectedEdge.currency}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Attributed Amount:</span>
                  <span className="font-semibold text-indigo-600">
                    ₹{selectedEdge.attributed_amount?.toLocaleString() ?? 'Scenario Attribution'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Cycle Status:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedEdge.is_cycle_closing ? 'Cycle Closing (Halted)' : 'Downstream Flow'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Timestamp:</span>
                  <span className="text-slate-600">{new Date(selectedEdge.timestamp).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Default Instruction Card */
            <div className="glass-card rounded-2xl p-6 border border-slate-200/80 text-center text-slate-400 space-y-3">
              <Network className="w-10 h-10 mx-auto text-slate-300" />
              <div className="text-sm font-semibold text-slate-700">Network Element Inspector</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Click any account node in the graph to view exposure & review status, or click any connecting arrow to view transaction leg details.
              </p>
            </div>
          )}

          {/* Scenario Disclaimer Note */}
          <div className="p-4 rounded-2xl bg-slate-100/90 border border-slate-200 text-xs text-slate-600 space-y-1">
            <span className="font-bold text-slate-800 block">Synthetic Scenario Note:</span>
            <p className="text-[11px] leading-relaxed">
              Case FS-1042 contains demonstration transactions. Lineage metadata reflects scenario assumptions, not proof of money ownership.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
