import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Network,
  ShieldCheck,
  FileText,
  UserCheck,
  AlertTriangle,
  History,
  Download,
  CheckCircle2,
  Edit3,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../services/api';
import {
  AuditEvent,
  FraudCase,
  GraphEdge,
  GraphNode,
  GraphResponse,
  TraceResult,
  Transaction,
} from '../types/api';
import { Badge } from '../components/common/Badge';
import { CytoscapeGraph } from '../components/network/CytoscapeGraph';
import { AccountProtectionPanel } from '../components/investigation/AccountProtectionPanel';

export const CaseDetailPage: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [searchParams] = useSearchParams();

  const [caseData, setCaseData] = useState<FraudCase | null>(null);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const initialTab = (searchParams.get('tab') as 'overview' | 'transactions' | 'reviews' | 'audit') || 'overview';
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'reviews' | 'audit'>(initialTab);
  const [auditFilter, setAuditFilter] = useState<'all' | 'reviews' | 'trace'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [selectedReviewAccountId, setSelectedReviewAccountId] = useState<string | null>(
    searchParams.get('account')
  );
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  const fetchCaseDetails = async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, graph, trace, txs, audit] = await Promise.all([
        api.getCase(caseId),
        api.getCaseGraph(caseId),
        api.getCaseTrace(caseId),
        api.getCaseTransactions(caseId),
        api.getCaseAuditTrail(caseId),
      ]);
      setCaseData(c);
      setGraphData(graph);
      setTraceData(trace);
      setTransactions(txs.transactions);
      setAuditEvents(audit.events);
      if (!selectedReviewAccountId && trace.linked_accounts.length > 0) {
        const c300 = trace.linked_accounts.find((a) => a.account_id === 'C300');
        setSelectedReviewAccountId(c300 ? c300.account_id : trace.linked_accounts[0].account_id);
      }
      if (selectedNode) {
        const refreshed = graph.nodes.find((n) => n.id === selectedNode.id) || null;
        setSelectedNode(refreshed);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load case details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCaseDetails();
  }, [caseId]);

  const handleStatusChange = async (newStatus: string) => {
    if (!caseId) return;
    try {
      const updated = await api.updateCase(caseId, {
        investigation_status: newStatus,
        updated_by: 'investigator_ui',
      });
      setCaseData(updated);
      const audit = await api.getCaseAuditTrail(caseId);
      setAuditEvents(audit.events);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleExportCsv = () => {
    if (!transactions.length) return;
    const headers = ['Transaction ID', 'Timestamp', 'Sender Account', 'Receiver Account', 'Amount', 'Currency', 'Type'];
    const rows = transactions.map((t) => [
      t.transaction_id,
      t.timestamp,
      t.sender_account_id,
      t.receiver_account_id,
      t.amount,
      t.currency,
      t.transaction_type,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${caseId}_transactions.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && !caseData) {
    return (
      <div className="py-20 text-center text-[#64748B] text-xs font-mono flex flex-col items-center justify-center gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-[#0D9488]" />
        <span>Loading case dossier...</span>
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="p-8 rounded-md bg-red-50 border border-red-300 text-red-900 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-red-600 mx-auto" />
        <h2 className="text-base font-bold">Investigation Not Found</h2>
        <p className="text-xs">{error || 'Case does not exist.'}</p>
        <Link to="/app/cases" className="inline-block px-4 py-2 rounded bg-[#0B1322] text-white text-xs font-semibold">
          Return to Cases
        </Link>
      </div>
    );
  }

  const filteredAudits = auditEvents.filter((e) => {
    if (auditFilter === 'reviews') return e.action.includes('review');
    if (auditFilter === 'trace') return e.action.includes('trace');
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Executive Dossier Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#D6D3CD]">
        <div className="flex items-start gap-3">
          <Link
            to="/app/cases"
            className="mt-1 p-2 rounded-md bg-white border border-[#D6D3CD] hover:bg-[#FAF9F6] text-[#0B1322] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0F766E]">
                CASE DOSSIER
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0B1322] font-mono tracking-tight">
                {caseData.case_id}
              </h1>
              <Badge variant="status" value={caseData.investigation_status} size="md" />
            </div>
            <p className="text-xs text-[#475569] mt-1 max-w-3xl leading-relaxed">{caseData.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-[#D6D3CD]">
          <span className="text-[11px] font-mono text-[#64748B]">TRIAGE STATUS:</span>
          <select
            value={caseData.investigation_status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="text-xs font-mono font-bold text-[#0B1322] bg-transparent outline-none cursor-pointer"
          >
            <option value="open">Open</option>
            <option value="under_investigation">Under Investigation</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {reviewSuccess && (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-300 text-xs text-emerald-950 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>{reviewSuccess}</span>
          </span>
          <button onClick={() => setReviewSuccess(null)} className="text-emerald-800 font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Case Telemetry Ledger Strip */}
      <div className="forensic-panel p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
        <div>
          <span className="text-[#64748B] font-mono text-[10px] uppercase block">Reported Stolen</span>
          <span className="text-base font-bold font-mono text-[#0B1322] tabular-nums">
            ₹{caseData.reported_amount.toLocaleString()} {caseData.currency}
          </span>
        </div>
        <div>
          <span className="text-[#64748B] font-mono text-[10px] uppercase block">Bounded Traceable Pool</span>
          <span className="text-base font-bold font-mono text-[#0F766E] tabular-nums">
            ₹{(traceData?.summary.traceable_amount ?? caseData.reported_amount).toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-[#64748B] font-mono text-[10px] uppercase block">Origin Transaction</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm font-bold font-mono text-[#0B1322]">
              {caseData.reported_origin_transaction_id}
            </span>
            <Link
              to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(caseData.reported_origin_transaction_id)}`}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0B1322] text-[#2DD4BF] font-semibold hover:bg-[#111C30]"
            >
              Explain Score
            </Link>
          </div>
        </div>
        <div>
          <span className="text-[#64748B] font-mono text-[10px] uppercase block">Traced Network</span>
          <span className="text-base font-bold font-mono text-[#0B1322]">{transactions.length} Transactions</span>
        </div>
        <div>
          <span className="text-[#64748B] font-mono text-[10px] uppercase block">Audit Provenance</span>
          <span className="text-base font-bold font-mono text-[#0B1322]">{auditEvents.length} Events</span>
        </div>
      </div>

      {/* Architectural Navigation Tabs */}
      <div className="border-b border-[#D6D3CD] flex flex-wrap items-center gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'overview'
              ? 'border-[#0D9488] text-[#0B1322] bg-white font-bold rounded-t-md'
              : 'border-transparent text-[#475569] hover:text-[#0B1322]'
          }`}
        >
          <Network className="w-4 h-4 text-[#0D9488]" />
          <span>Fund Flow Graph</span>
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`px-4 py-2.5 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'transactions'
              ? 'border-[#0D9488] text-[#0B1322] bg-white font-bold rounded-t-md'
              : 'border-transparent text-[#475569] hover:text-[#0B1322]'
          }`}
        >
          <FileText className="w-4 h-4 text-[#0D9488]" />
          <span>Traced Transactions ({transactions.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('reviews')}
          className={`px-4 py-2.5 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'reviews'
              ? 'border-[#0D9488] text-[#0B1322] bg-white font-bold rounded-t-md'
              : 'border-transparent text-[#475569] hover:text-[#0B1322]'
          }`}
        >
          <UserCheck className="w-4 h-4 text-[#0D9488]" />
          <span>Account Reviews ({traceData?.linked_accounts.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2.5 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'audit'
              ? 'border-[#0D9488] text-[#0B1322] bg-white font-bold rounded-t-md'
              : 'border-transparent text-[#475569] hover:text-[#0B1322]'
          }`}
        >
          <History className="w-4 h-4 text-[#0D9488]" />
          <span>Audit Provenance ({auditEvents.length})</span>
        </button>
      </div>

      {/* Tab 1: Overview & Cytoscape Graph */}
      {activeTab === 'overview' && graphData && (
        <div className="space-y-4">
          {/* Quick-Select Account Strip */}
          <div className="forensic-panel p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#64748B] mr-1">
                Inspect Account Dossier:
              </span>
              {graphData.nodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    setSelectedNode(n);
                    setSelectedEdge(null);
                  }}
                  className={`px-2.5 py-1 rounded font-mono font-semibold border transition-colors ${
                    selectedNode?.id === n.id
                      ? 'bg-[#0B1322] text-[#2DD4BF] border-[#0D9488]'
                      : 'bg-[#FAF9F6] hover:bg-[#F0FDFA] text-[#0B1322] border-[#D6D3CD] hover:border-[#0D9488]'
                  }`}
                >
                  {n.id}
                </button>
              ))}
            </div>
            <Link
              to="/app/fund-flow"
              className="font-mono text-[11px] font-semibold text-[#0F766E] hover:underline inline-flex items-center gap-1"
            >
              <span>Open Full Screen Explorer</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className={`${selectedNode || selectedEdge ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-4`}>
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
                height="520px"
              />
              <div className="forensic-panel p-3.5 text-xs text-[#475569] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-[#0B1322]">Topology Summary:</strong> {graphData.nodes.length} nodes, {graphData.edges.length} edges.
                  {graphData.meta.cycles_detected
                    ? ' Cycles detected (traversal halted to prevent infinite loops).'
                    : ' Acyclic directed tree.'}{' '}
                  <span>Click any node to open the evidence-aware account protection panel.</span>
                </div>
              </div>
            </div>

            {(selectedNode || selectedEdge) && (
              <div className="lg:col-span-5 space-y-4">
                {selectedNode ? (
                  <AccountProtectionPanel
                    caseId={caseData.case_id}
                    accountId={selectedNode.id}
                    onSelectAccount={(aid) => {
                      const target = graphData.nodes.find((n) => n.id === aid);
                      if (target) setSelectedNode(target);
                    }}
                    onReviewUpdated={() => {
                      setReviewSuccess(`Updated evidence review for ${selectedNode.id}`);
                      fetchCaseDetails();
                    }}
                    onClose={() => setSelectedNode(null)}
                  />
                ) : selectedEdge ? (
                  <div className="forensic-panel p-5 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2DFD7]">
                      <div>
                        <h3 className="text-sm font-bold text-[#0B1322] font-mono">{selectedEdge.id}</h3>
                        <span className="text-[10px] font-mono text-[#64748B]">Traced Payment Leg</span>
                      </div>
                      <button
                        onClick={() => setSelectedEdge(null)}
                        className="text-xs font-mono text-[#475569] hover:text-[#0B1322]"
                      >
                        Close
                      </button>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-[#E2DFD7]">
                        <span className="text-[#64748B]">From:</span>
                        <span className="font-mono font-bold text-[#0B1322]">{selectedEdge.source}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[#E2DFD7]">
                        <span className="text-[#64748B]">To:</span>
                        <span className="font-mono font-bold text-[#0B1322]">{selectedEdge.target}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[#E2DFD7]">
                        <span className="text-[#64748B]">Amount:</span>
                        <span className="font-mono font-bold text-[#0B1322] tabular-nums">
                          ₹{selectedEdge.amount.toLocaleString()} {selectedEdge.currency}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(selectedEdge.id)}`}
                      className="w-full py-2.5 px-3 rounded-md bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold text-center transition-colors flex items-center justify-center gap-1.5"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Score &amp; Explain in Risk Engine</span>
                    </Link>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Traced Transactions */}
      {activeTab === 'transactions' && (
        <div className="forensic-panel overflow-hidden">
          <div className="p-4 bg-[#FAF9F6] border-b border-[#E2DFD7] flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-[#0B1322] uppercase tracking-wider">
              Chronological Transaction Network ({transactions.length} Legs)
            </span>
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded bg-white hover:bg-[#F5F4F0] text-[#0B1322] border border-[#D6D3CD] font-semibold text-xs flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-[#0D9488]" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F5F4F0] text-[#475569] font-mono text-[11px] uppercase border-b border-[#E2DFD7]">
                <tr>
                  <th className="py-2.5 px-4">Transaction ID</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Sender Account</th>
                  <th className="py-2.5 px-4">Receiver Account</th>
                  <th className="py-2.5 px-4">Amount</th>
                  <th className="py-2.5 px-4">Rail</th>
                  <th className="py-2.5 px-4 text-right">Explainable AI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2DFD7]">
                {transactions.map((t) => (
                  <tr key={t.transaction_id} className="hover:bg-[#FAF9F6]">
                    <td className="py-3 px-4 font-mono font-bold text-[#0F766E]">{t.transaction_id}</td>
                    <td className="py-3 px-4 font-mono text-[#64748B]">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="py-3 px-4 font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReviewAccountId(t.sender_account_id);
                          setActiveTab('reviews');
                        }}
                        className="text-[#0B1322] hover:text-[#0F766E] hover:underline font-semibold"
                      >
                        {t.sender_account_id}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReviewAccountId(t.receiver_account_id);
                          setActiveTab('reviews');
                        }}
                        className="text-[#0B1322] hover:text-[#0F766E] hover:underline font-semibold"
                      >
                        {t.receiver_account_id}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[#0B1322] tabular-nums">
                      ₹{t.amount.toLocaleString()} {t.currency}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[#334155]">{t.transaction_type}</td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(t.transaction_id)}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0B1322] hover:bg-[#111C30] text-[#2DD4BF] font-mono font-semibold transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Score &amp; Explain</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Account Reviews & Adjudication */}
      {activeTab === 'reviews' && traceData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 forensic-panel overflow-hidden lg:sticky lg:top-4">
            <div className="p-4 bg-[#FAF9F6] border-b border-[#E2DFD7]">
              <h2 className="text-xs font-mono font-bold text-[#0B1322] uppercase tracking-wider">
                Downstream Accounts &amp; Human Adjudication
              </h2>
              <p className="text-[11px] text-[#64748B] mt-0.5">
                Select any account row to inspect observed movement vs. traceable exposure, missing evidence gaps, and record human review decisions.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F5F4F0] text-[#475569] font-mono text-[11px] uppercase border-b border-[#E2DFD7]">
                  <tr>
                    <th className="py-2.5 px-3.5">Account ID</th>
                    <th className="py-2.5 px-3.5">Distance</th>
                    <th className="py-2.5 px-3.5">Observed In / Out</th>
                    <th className="py-2.5 px-3.5">Unforwarded Exposure</th>
                    <th className="py-2.5 px-3.5">Review State</th>
                    <th className="py-2.5 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD7]">
                  {traceData.linked_accounts.map((a) => {
                    const isSelected = selectedReviewAccountId === a.account_id;
                    return (
                      <tr
                        key={a.account_id}
                        onClick={() => setSelectedReviewAccountId(a.account_id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#F0FDFA]' : 'hover:bg-[#FAF9F6]'
                        }`}
                      >
                        <td className="py-3 px-3.5 font-mono font-bold text-[#0B1322]">{a.account_id}</td>
                        <td className="py-3 px-3.5 font-mono text-[#475569]">Hop {a.hop_count}</td>
                        <td className="py-3 px-3.5 font-mono text-[#334155] tabular-nums">
                          ₹{a.exposure.observed_inbound_value.toLocaleString()} / ₹{a.exposure.observed_outbound_value.toLocaleString()}
                        </td>
                        <td className="py-3 px-3.5 font-mono font-bold text-[#0F766E] tabular-nums">
                          ₹{a.exposure.attributed_unforwarded_amount?.toLocaleString() ?? '0'}
                        </td>
                        <td className="py-3 px-3.5">
                          <Badge variant="review" value={a.review?.review_state || 'not_reviewed'} />
                        </td>
                        <td className="py-3 px-3.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedReviewAccountId(a.account_id);
                            }}
                            className={`px-2.5 py-1 rounded font-semibold transition-colors inline-flex items-center gap-1 ${
                              isSelected
                                ? 'bg-[#0B1322] text-[#2DD4BF]'
                                : 'bg-[#FAF9F6] hover:bg-[#F0FDFA] text-[#0B1322] border border-[#D6D3CD]'
                            }`}
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Inspect &amp; Adjudicate</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-5">
            {selectedReviewAccountId ? (
              <AccountProtectionPanel
                caseId={caseData.case_id}
                accountId={selectedReviewAccountId}
                onSelectAccount={(aid) => setSelectedReviewAccountId(aid)}
                onReviewUpdated={() => {
                  setReviewSuccess(`Review recorded in audit trail for account ${selectedReviewAccountId}`);
                  fetchCaseDetails();
                }}
              />
            ) : (
              <div className="forensic-panel p-6 text-center text-xs text-[#64748B]">
                Select an account from the table to inspect evidence and record a review decision.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Append-Only Audit Trail */}
      {activeTab === 'audit' && (
        <div className="forensic-panel p-5 space-y-4">
          <div className="pb-3 border-b border-[#E2DFD7] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0B1322]">Immutable Audit Provenance</h2>
              <p className="text-xs text-[#64748B]">
                Append-only ledger of all case actions, trace runs, and human review findings.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(['all', 'reviews', 'trace'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAuditFilter(f)}
                  className={`px-2.5 py-1 rounded font-mono text-[11px] font-semibold border transition-colors ${
                    auditFilter === f
                      ? 'bg-[#0B1322] text-white border-[#0B1322]'
                      : 'bg-[#FAF9F6] text-[#475569] border-[#D6D3CD] hover:border-[#0B1322]'
                  }`}
                >
                  {f === 'all' ? `ALL (${auditEvents.length})` : f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-[#D6D3CD]">
            {filteredAudits.map((e, idx) => (
              <div key={idx} className="relative">
                <div className="absolute -left-[19px] top-2.5 w-2.5 h-2.5 rounded-full bg-[#0D9488] ring-4 ring-white" />
                <div className="p-3.5 rounded-md bg-[#FAF9F6] border border-[#E2DFD7] text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#0F766E] uppercase tracking-wider text-[11px]">
                      {e.action}
                    </span>
                    <span className="font-mono text-[#64748B] text-[10px]">
                      {new Date(e.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <div className="text-[#475569]">
                    Actor: <strong className="text-[#0B1322] font-mono">{e.performed_by}</strong> · Entity:{' '}
                    <code className="font-mono text-[#0B1322] bg-white px-1.5 py-0.5 rounded border border-[#D6D3CD]">
                      {e.entity_type} ({e.entity_id})
                    </code>
                  </div>

                  {e.details && (
                    <pre className="mt-1.5 p-2.5 rounded bg-white border border-[#E2DFD7] text-[10px] font-mono text-[#334155] overflow-x-auto">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
