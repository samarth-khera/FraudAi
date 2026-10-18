import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Network,
  ShieldCheck,
  User,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { FraudCase, GraphEdge, GraphNode, GraphResponse, TraceResult } from '../types/api';
import { CytoscapeGraph } from '../components/network/CytoscapeGraph';
import { Badge } from '../components/common/Badge';
import { AccountProtectionPanel } from '../components/investigation/AccountProtectionPanel';

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
  const fetchGraphAndTrace = async (caseId: string, depth: number, preserveSelection = false) => {
    setLoading(true);
    setError(null);
    const prevNodeId = preserveSelection ? selectedNode?.id : null;
    if (!preserveSelection) {
      setSelectedNode(null);
      setSelectedEdge(null);
    }
    try {
      const [graph, trace] = await Promise.all([
        api.getCaseGraph(caseId, depth),
        api.getCaseTrace(caseId, depth),
      ]);
      setGraphData(graph);
      setTraceData(trace);
      if (prevNodeId) {
        const refreshedNode = graph.nodes.find((n) => n.id === prevNodeId) || null;
        setSelectedNode(refreshedNode);
      }
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

  const selectAccountById = (accountId: string) => {
    if (!graphData) return;
    const node = graphData.nodes.find((n) => n.id === accountId);
    if (node) {
      setSelectedNode(node);
      setSelectedEdge(null);
    }
  };

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
            Explore directional money paths, intermediate recipient hops, and evidence-aware account assessments.
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
            onClick={() => fetchGraphAndTrace(selectedCaseId, maxDepth, true)}
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
            <span className="text-base font-bold text-slate-900 tabular-nums">
              ₹{traceData.summary.reported_amount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Traceable Amount</span>
            <span className="text-base font-bold text-indigo-600 tabular-nums">
              ₹{traceData.summary.traceable_amount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Located in Network</span>
            <span className="text-base font-bold text-emerald-600 tabular-nums">
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
        {/* Main Visualizer / List (7 columns) */}
        <div className="lg:col-span-7 space-y-4">
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
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Downstream Attributed Fund Paths</h2>
                <span className="text-[11px] text-slate-500">Click any account ID to open evidence assessment</span>
              </div>
              <div className="space-y-3">
                {traceData?.paths.map((p) => (
                  <div key={p.path_id} className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-700 font-mono text-sm">{p.path_id}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-semibold">
                        Termination: {p.termination_reason}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-slate-600 font-mono">
                      {p.account_ids.map((accId, i) => (
                        <React.Fragment key={`${p.path_id}-${accId}-${i}`}>
                          <button
                            type="button"
                            onClick={() => selectAccountById(accId)}
                            className={`px-2 py-0.5 rounded border transition-colors ${
                              selectedNode?.id === accId
                                ? 'bg-indigo-600 text-white border-indigo-700 font-bold'
                                : 'bg-white text-slate-800 border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            {accId}
                          </button>
                          {i < p.account_ids.length - 1 && <span className="text-slate-400">──►</span>}
                        </React.Fragment>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/40 text-[11px] text-slate-500">
                      <div>Hops: {p.hop_count}</div>
                      <div className="tabular-nums">Max Amount: ₹{p.max_attributable_amount?.toLocaleString() ?? 'N/A'}</div>
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
                <span className="text-[11px] text-slate-500">Click row to inspect transaction leg or explain in Risk Engine</span>
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
                        <td className="py-2 px-3 font-semibold text-slate-900 tabular-nums">
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

        {/* Account / Transaction Detail Sidebar (5 columns) */}
        <div className="lg:col-span-5 space-y-4">
          {selectedNode ? (
            <AccountProtectionPanel
              caseId={selectedCaseId}
              accountId={selectedNode.id}
              onReviewUpdated={() => fetchGraphAndTrace(selectedCaseId, maxDepth, true)}
              onClose={() => setSelectedNode(null)}
            />
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
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">From Account:</span>
                  <button
                    type="button"
                    onClick={() => selectAccountById(selectedEdge.source)}
                    className="font-mono font-bold text-indigo-700 hover:underline"
                  >
                    {selectedEdge.source} →
                  </button>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">To Account:</span>
                  <button
                    type="button"
                    onClick={() => selectAccountById(selectedEdge.target)}
                    className="font-mono font-bold text-indigo-700 hover:underline"
                  >
                    {selectedEdge.target} →
                  </button>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Gross Leg Amount:</span>
                  <span className="font-bold text-base text-slate-900 tabular-nums">
                    ₹{selectedEdge.amount.toLocaleString()} {selectedEdge.currency}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Scenario Attributed Amount:</span>
                  <span className="font-semibold text-indigo-600 tabular-nums">
                    {selectedEdge.attributed_amount !== null
                      ? `₹${selectedEdge.attributed_amount.toLocaleString()}`
                      : 'Not Attributed'}
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

              <div className="pt-2 flex flex-col gap-2">
                <Link
                  to={`/app/transaction-check?caseId=${encodeURIComponent(selectedCaseId)}&txId=${encodeURIComponent(selectedEdge.id)}`}
                  className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold text-center transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Score & Explain in Risk Engine</span>
                </Link>
              </div>
            </div>
          ) : (
            /* Default Instruction Card + Quick Account Selector */
            <div className="glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4">
              <div className="text-center text-slate-400 space-y-2">
                <Network className="w-10 h-10 mx-auto text-slate-300" />
                <div className="text-sm font-semibold text-slate-700">Evidence & Network Inspector</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Click any account node in the graph to inspect observed movement vs. traceable exposure, missing evidence gaps, and human review decisions.
                </p>
              </div>

              {graphData && graphData.nodes.length > 0 && (
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                    Quick-Select Connected Account
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {graphData.nodes.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          setSelectedNode(n);
                          setSelectedEdge(null);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 text-[11px] font-mono font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{n.id}</span>
                        <Badge variant="role" value={n.role} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scenario Disclaimer Note */}
          <div className="p-4 rounded-2xl bg-slate-100/90 border border-slate-200 text-xs text-slate-600 space-y-1">
            <span className="font-bold text-slate-800 block">Anti-Double-Counting & Fairness Safeguard:</span>
            <p className="text-[11px] leading-relaxed">
              Downstream hop amounts are never summed into a larger stolen-fund total. Case FS-1042 contains synthetic demonstration transactions where lineage metadata reflects scenario assumptions, not legal proof of money ownership.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
