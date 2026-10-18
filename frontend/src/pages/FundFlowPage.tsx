import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Network,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  GitBranch,
  Scale,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../services/api';
import { FraudCase, GraphEdge, GraphNode, GraphResponse, TraceResult } from '../types/api';
import { CytoscapeGraph } from '../components/network/CytoscapeGraph';
import { Badge } from '../components/common/Badge';
import { AccountProtectionPanel } from '../components/investigation/AccountProtectionPanel';

export const FundFlowPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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

  const fetchGraphAndTrace = async (caseId: string, depth: number, preserveSelection = false) => {
    setLoading(true);
    setError(null);
    const prevNodeId = preserveSelection ? selectedNode?.id : searchParams.get('account');
    if (!preserveSelection && !prevNodeId) {
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
      setSearchParams({ account: accountId }, { replace: true });
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header & Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[#D6D3CD]">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0F766E]">
              02 / INTERACTIVE LINEAGE TOPOLOGY
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0B1322] text-[#2DD4BF] border border-[#1C2B45]">
              DAG FLOW ENGINE
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0B1322] tracking-tight mt-0.5">
            Fund Flow Network Explorer
          </h1>
          <p className="text-xs text-[#475569] mt-0.5">
            Inspect multi-hop money dispersion, compare observed movement against lineage-bounded exposure, and record human reviews.
          </p>
        </div>

        {/* Case & View Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-[#D6D3CD]">
            <span className="text-[11px] font-mono text-[#64748B]">CASE:</span>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="text-xs font-mono font-bold text-[#0B1322] bg-transparent outline-none cursor-pointer"
            >
              {cases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} ({c.investigation_status})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-[#D6D3CD]">
            <span className="text-[11px] font-mono text-[#64748B]">DEPTH:</span>
            <select
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              className="text-xs font-mono font-bold text-[#0B1322] bg-transparent outline-none cursor-pointer"
            >
              <option value={1}>1 Hop</option>
              <option value={2}>2 Hops</option>
              <option value={5}>5 Hops</option>
              <option value={10}>10 Hops (Default)</option>
              <option value={20}>20 Hops</option>
            </select>
          </div>

          <div className="flex items-center p-0.5 rounded-md bg-[#E2DFD7]">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === 'graph' ? 'bg-[#0B1322] text-white' : 'text-[#475569] hover:text-[#0B1322]'
              }`}
            >
              Graph View
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === 'list' ? 'bg-[#0B1322] text-white' : 'text-[#475569] hover:text-[#0B1322]'
              }`}
            >
              List View
            </button>
          </div>

          <button
            onClick={() => fetchGraphAndTrace(selectedCaseId, maxDepth, true)}
            disabled={loading}
            className="p-2 rounded-md bg-white border border-[#D6D3CD] hover:bg-[#FAF9F6] text-[#0B1322] transition-colors"
            title="Reload Graph"
          >
            <RefreshCw className={`w-4 h-4 text-[#0D9488] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-md bg-red-50 border border-red-300 text-xs text-red-900 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchGraphAndTrace(selectedCaseId, maxDepth)} className="underline font-bold ml-4">
            Retry
          </button>
        </div>
      )}

      {/* Telemetry & Quick-Select Account Ribbon */}
      {traceData && (
        <div className="forensic-panel p-3.5 sm:p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pb-3 border-b border-[#E2DFD7] text-xs">
            <div>
              <span className="text-[#64748B] font-mono text-[10px] uppercase block">Reported Stolen</span>
              <span className="text-base font-bold font-mono text-[#0B1322] tabular-nums">
                ₹{traceData.summary.reported_amount.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] font-mono text-[10px] uppercase block">Traceable Pool</span>
              <span className="text-base font-bold font-mono text-[#0F766E] tabular-nums">
                ₹{traceData.summary.traceable_amount.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] font-mono text-[10px] uppercase block">Located in Network</span>
              <span className="text-base font-bold font-mono text-emerald-700 tabular-nums">
                ₹{traceData.summary.located_amount.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] font-mono text-[10px] uppercase block">Connected Accounts</span>
              <span className="text-base font-bold font-mono text-[#0B1322]">
                {traceData.summary.linked_account_count} Accounts
              </span>
            </div>
            <div>
              <span className="text-[#64748B] font-mono text-[10px] uppercase block">Active Branches</span>
              <span className="text-base font-bold font-mono text-[#0B1322]">{traceData.paths.length} Paths</span>
            </div>
          </div>

          {/* Interactive Account Jump Bar */}
          {graphData && graphData.nodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#64748B] mr-1">
                Inspect Account Node:
              </span>
              {graphData.nodes.map((n) => {
                const isSelected = selectedNode?.id === n.id;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => selectAccountById(n.id)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border transition-colors inline-flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#0B1322] text-[#2DD4BF] border-[#0D9488]'
                        : 'bg-[#FAF9F6] hover:bg-[#F0FDFA] text-[#0B1322] border-[#D6D3CD] hover:border-[#0D9488]'
                    }`}
                  >
                    <span>{n.id}</span>
                    <span className="text-[10px] opacity-75">
                      {n.role === 'reporting_victim' ? 'Victim' : `Hop ${n.hop_count ?? 1}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Centerpiece Workspace: Graph + Synchronized Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left/Main Visualizer (7 columns) */}
        <div className="lg:col-span-7 space-y-5">
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
              <div className="h-[560px] forensic-panel flex items-center justify-center text-xs font-mono text-[#64748B]">
                {loading ? 'Computing directed multi-hop topology...' : 'No graph data available.'}
              </div>
            )
          ) : (
            <div className="forensic-panel p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2DFD7]">
                <h2 className="text-sm font-bold text-[#0B1322]">Downstream Attributed Fund Paths</h2>
                <span className="text-[11px] font-mono text-[#64748B]">Click any account ID to open dossier</span>
              </div>
              <div className="space-y-3">
                {traceData?.paths.map((p) => (
                  <div key={p.path_id} className="p-4 rounded-md bg-[#FAF9F6] border border-[#E2DFD7] text-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0F766E] font-mono text-sm">{p.path_id}</span>
                      <span className="px-2 py-0.5 rounded bg-white border border-[#D6D3CD] text-[#334155] font-mono text-[10px] font-semibold">
                        Termination: {p.termination_reason}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 font-mono">
                      {p.account_ids.map((accId, i) => (
                        <React.Fragment key={`${p.path_id}-${accId}-${i}`}>
                          <button
                            type="button"
                            onClick={() => selectAccountById(accId)}
                            className={`px-2.5 py-1 rounded border transition-colors ${
                              selectedNode?.id === accId
                                ? 'bg-[#0B1322] text-[#2DD4BF] border-[#0D9488] font-bold'
                                : 'bg-white text-[#0B1322] border-[#D6D3CD] hover:border-[#0D9488]'
                            }`}
                          >
                            {accId}
                          </button>
                          {i < p.account_ids.length - 1 && <span className="text-[#64748B]">──►</span>}
                        </React.Fragment>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E2DFD7] font-mono text-[11px] text-[#475569]">
                      <div>Hops: {p.hop_count}</div>
                      <div className="tabular-nums">Max Exposed: ₹{p.max_attributable_amount?.toLocaleString() ?? 'N/A'}</div>
                      <div>Terminal: {p.terminal_account_id}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Synchronized Traced Legs Ledger */}
          {graphData && (
            <div className="forensic-panel overflow-hidden">
              <div className="px-4 py-3 bg-[#FAF9F6] border-b border-[#E2DFD7] flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono font-bold text-[#0B1322] uppercase tracking-wider">
                  Traced Legs ({graphData.edges.length} Transactions)
                </span>
                <span className="text-[11px] text-[#64748B]">
                  Click any row to highlight transfer edge or explain in TreeSHAP
                </span>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F5F4F0] border-b border-[#E2DFD7] text-[#475569] font-mono text-[11px] uppercase sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3.5">TX ID</th>
                      <th className="py-2.5 px-3.5">From</th>
                      <th className="py-2.5 px-3.5">To</th>
                      <th className="py-2.5 px-3.5">Gross Amount</th>
                      <th className="py-2.5 px-3.5">Attributed</th>
                      <th className="py-2.5 px-3.5">Rail</th>
                      <th className="py-2.5 px-3.5">Hop</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD7]">
                    {graphData.edges.map((e) => {
                      const isSelected = selectedEdge?.id === e.id;
                      return (
                        <tr
                          key={e.id}
                          onClick={() => {
                            setSelectedEdge(e);
                            setSelectedNode(null);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#F0FDFA] font-semibold' : 'hover:bg-[#FAF9F6]'
                          }`}
                        >
                          <td className="py-2.5 px-3.5 font-mono font-bold text-[#0F766E]">{e.id}</td>
                          <td className="py-2.5 px-3.5 font-mono text-[#0B1322]">{e.source}</td>
                          <td className="py-2.5 px-3.5 font-mono text-[#0B1322]">{e.target}</td>
                          <td className="py-2.5 px-3.5 font-mono font-semibold text-[#0B1322] tabular-nums">
                            ₹{e.amount.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-[#0F766E] tabular-nums">
                            {e.attributed_amount !== null ? `₹${e.attributed_amount.toLocaleString()}` : 'Uncertain'}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-[11px]">{e.transaction_type}</td>
                          <td className="py-2.5 px-3.5 font-mono text-[#64748B]">{e.hop_count ?? '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Forensic Dossier Column (5 columns) */}
        <div className="lg:col-span-5 space-y-4">
          {selectedNode ? (
            <AccountProtectionPanel
              caseId={selectedCaseId}
              accountId={selectedNode.id}
              onSelectAccount={(aid) => selectAccountById(aid)}
              onReviewUpdated={() => fetchGraphAndTrace(selectedCaseId, maxDepth, true)}
              onClose={() => setSelectedNode(null)}
            />
          ) : selectedEdge ? (
            <div className="forensic-panel p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2DFD7]">
                <div>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#0F766E] block">
                    TRACED TRANSFER LEG
                  </span>
                  <h3 className="text-base font-bold text-[#0B1322] font-mono">{selectedEdge.id}</h3>
                </div>
                <span className="px-2.5 py-0.5 rounded bg-[#0B1322] text-[#2DD4BF] text-xs font-mono font-bold border border-[#1C2B45]">
                  {selectedEdge.transaction_type}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between items-center py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Sender Account:</span>
                  <button
                    type="button"
                    onClick={() => selectAccountById(selectedEdge.source)}
                    className="font-mono font-bold text-[#0F766E] hover:underline inline-flex items-center gap-1"
                  >
                    <span>{selectedEdge.source}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Receiver Account:</span>
                  <button
                    type="button"
                    onClick={() => selectAccountById(selectedEdge.target)}
                    className="font-mono font-bold text-[#0F766E] hover:underline inline-flex items-center gap-1"
                  >
                    <span>{selectedEdge.target}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Gross Leg Amount:</span>
                  <span className="font-mono font-bold text-sm text-[#0B1322] tabular-nums">
                    ₹{selectedEdge.amount.toLocaleString()} {selectedEdge.currency}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Scenario Attributed Exposure:</span>
                  <span className="font-mono font-bold text-[#0F766E] tabular-nums">
                    {selectedEdge.attributed_amount !== null
                      ? `₹${selectedEdge.attributed_amount.toLocaleString()}`
                      : 'Not Attributed'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Hop Distance:</span>
                  <span className="font-mono font-semibold text-[#0B1322]">
                    Hop {selectedEdge.hop_count ?? 0}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Cycle Traversal Status:</span>
                  <span className="font-mono font-semibold text-[#0B1322]">
                    {selectedEdge.is_cycle_closing ? 'Cycle Closing (Halted)' : 'Acyclic Downstream Flow'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#E2DFD7]">
                  <span className="text-[#64748B]">Settlement Timestamp:</span>
                  <span className="font-mono text-[#475569]">{new Date(selectedEdge.timestamp).toLocaleString()}</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <Link
                  to={`/app/transaction-check?caseId=${encodeURIComponent(selectedCaseId)}&txId=${encodeURIComponent(selectedEdge.id)}`}
                  className="w-full py-2.5 px-3 rounded-md bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold text-center transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Score &amp; Explain in Risk Engine</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="forensic-panel p-5 space-y-4">
              <div className="flex items-start gap-3 pb-3 border-b border-[#E2DFD7]">
                <div className="p-2 rounded bg-[#F0FDFA] text-[#0F766E] border border-[#CCFBF1]">
                  <GitBranch className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0B1322]">Evidence &amp; Lineage Inspector</h3>
                  <p className="text-xs text-[#475569] leading-relaxed mt-0.5">
                    Select any account node on the canvas or in the quick-select bar below to compare gross ledger movement against traceable exposure, inspect missing KYC/invoice evidence gaps, and record a human review decision.
                  </p>
                </div>
              </div>

              {graphData && graphData.nodes.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-mono font-bold text-[#475569] uppercase tracking-wider block">
                    Connected Accounts ({graphData.nodes.length})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {graphData.nodes.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => selectAccountById(n.id)}
                        className="p-2.5 rounded-md bg-[#FAF9F6] hover:bg-[#F0FDFA] border border-[#D6D3CD] hover:border-[#0D9488] text-left transition-colors flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-mono font-bold text-xs text-[#0B1322]">{n.id}</div>
                          <div className="text-[10px] text-[#64748B] truncate max-w-[130px]">{n.label}</div>
                        </div>
                        <Badge variant="role" value={n.role} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Anti-Double-Counting Safeguard Box */}
          <div className="p-4 rounded-md bg-[#0B1322] text-slate-300 border border-[#1C2B45] text-xs space-y-1.5">
            <div className="font-mono text-[11px] font-semibold text-[#2DD4BF] flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5" />
              <span>LINEAGE &amp; ANTI-DOUBLE-COUNTING PROTOCOL</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              Downstream hop amounts are never summed into a larger stolen-fund total. Case <code className="text-white">FS-1042</code> reflects explicit scenario lineage assumptions—not legal proof of money ownership or complicity.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
