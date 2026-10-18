import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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

  const [caseData, setCaseData] = useState<FraudCase | null>(null);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'reviews' | 'audit'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [selectedReviewAccountId, setSelectedReviewAccountId] = useState<string | null>(null);
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
        setSelectedReviewAccountId(trace.linked_accounts[0].account_id);
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
      <div className="py-20 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
        <span>Loading case dossier...</span>
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="p-8 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
        <h2 className="text-base font-bold">Investigation Not Found</h2>
        <p className="text-xs">{error || 'Case does not exist.'}</p>
        <Link to="/app/cases" className="inline-block px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold">
          Return to Cases
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <Link
            to="/app/cases"
            className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900 font-mono tracking-tight">{caseData.case_id}</h1>
              <Badge variant="status" value={caseData.investigation_status} size="md" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{caseData.description}</p>
          </div>
        </div>

        {/* Change Status Dropdown */}
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-slate-500 font-medium">Triage Status:</span>
          <select
            value={caseData.investigation_status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-800 shadow-2xs outline-none"
          >
            <option value="open">Open</option>
            <option value="under_investigation">Under Investigation</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {reviewSuccess && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{reviewSuccess}</span>
          </span>
          <button onClick={() => setReviewSuccess(null)} className="text-emerald-700 font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Case Metrics Bar */}
      <div className="glass-card rounded-2xl p-4 border border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <span className="text-slate-500 block text-[11px]">Reported Stolen</span>
          <span className="text-base font-bold text-slate-900 tabular-nums">
            ₹{caseData.reported_amount.toLocaleString()} {caseData.currency}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">Origin Transaction</span>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold font-mono text-indigo-700">
              {caseData.reported_origin_transaction_id}
            </span>
            <Link
              to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(caseData.reported_origin_transaction_id)}`}
              className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 hover:bg-indigo-100"
            >
              Explain Score
            </Link>
          </div>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">Traced Legs</span>
          <span className="text-base font-bold text-slate-900">{transactions.length} Transactions</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">Audit Events Logged</span>
          <span className="text-base font-bold text-slate-900">{auditEvents.length} Events</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 flex items-center gap-4 text-xs font-semibold text-slate-600">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'overview'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent hover:text-slate-900'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Fund Flow Graph</span>
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'transactions'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Traced Transactions ({transactions.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('reviews')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'reviews'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent hover:text-slate-900'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Account Reviews ({traceData?.linked_accounts.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'audit'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Audit Provenance ({auditEvents.length})</span>
        </button>
      </div>

      {/* Tab 1: Overview & Cytoscape Graph */}
      {activeTab === 'overview' && graphData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
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
            <div className="p-4 rounded-2xl bg-white border border-slate-200/80 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>Graph Insights:</strong> {graphData.nodes.length} nodes, {graphData.edges.length} edges.
                {graphData.meta.cycles_detected
                  ? ' Cycles detected (traversal halted to prevent infinite loops).'
                  : ' Acyclic tree.'}{' '}
                <span className="text-slate-500">Click any node to open the evidence-aware account protection panel.</span>
              </div>
              <Link to="/app/fund-flow" className="text-indigo-600 font-semibold hover:underline">
                Open Full Screen Explorer →
              </Link>
            </div>
          </div>

          {(selectedNode || selectedEdge) && (
            <div className="lg:col-span-5 space-y-4">
              {selectedNode ? (
                <AccountProtectionPanel
                  caseId={caseData.case_id}
                  accountId={selectedNode.id}
                  onReviewUpdated={() => {
                    setReviewSuccess(`Updated evidence review for ${selectedNode.id}`);
                    fetchCaseDetails();
                  }}
                  onClose={() => setSelectedNode(null)}
                />
              ) : selectedEdge ? (
                <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 font-mono">{selectedEdge.id}</h3>
                      <span className="text-[10px] text-slate-500">Traced Payment Leg</span>
                    </div>
                    <button
                      onClick={() => setSelectedEdge(null)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Close
                    </button>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">From:</span>
                      <span className="font-mono font-bold text-slate-800">{selectedEdge.source}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">To:</span>
                      <span className="font-mono font-bold text-slate-800">{selectedEdge.target}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Amount:</span>
                      <span className="font-bold text-slate-900 tabular-nums">
                        ₹{selectedEdge.amount.toLocaleString()} {selectedEdge.currency}
                      </span>
                    </div>
                  </div>
                  <Link
                    to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(selectedEdge.id)}`}
                    className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold text-center transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Score & Explain in Risk Engine</span>
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Traced Transactions */}
      {activeTab === 'transactions' && (
        <div className="glass-card rounded-2xl overflow-hidden border border-slate-200/80 space-y-2">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              Chronological Transaction Network
            </span>
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200/60">
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
              <tbody className="divide-y divide-slate-100">
                {transactions.map((t) => (
                  <tr key={t.transaction_id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 font-mono font-bold text-indigo-700">{t.transaction_id}</td>
                    <td className="py-2.5 px-4 text-slate-500">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="py-2.5 px-4 font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReviewAccountId(t.sender_account_id);
                          setActiveTab('reviews');
                        }}
                        className="text-slate-800 hover:text-indigo-700 hover:underline font-semibold"
                      >
                        {t.sender_account_id}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReviewAccountId(t.receiver_account_id);
                          setActiveTab('reviews');
                        }}
                        className="text-slate-800 hover:text-indigo-700 hover:underline font-semibold"
                      >
                        {t.receiver_account_id}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-900 tabular-nums">
                      ₹{t.amount.toLocaleString()} {t.currency}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">{t.transaction_type}</td>
                    <td className="py-2.5 px-4 text-right">
                      <Link
                        to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(t.transaction_id)}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Score & Explain</span>
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 glass-card rounded-2xl overflow-hidden border border-slate-200/80 h-fit">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Downstream Accounts & Human Adjudication
                </h2>
                <p className="text-[11px] text-slate-500">
                  Select any account to inspect observed movement vs. traceable exposure, missing evidence gaps, and record human review decisions.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200/60">
                  <tr>
                    <th className="py-2.5 px-4">Account ID</th>
                    <th className="py-2.5 px-4">Distance</th>
                    <th className="py-2.5 px-4">Observed In / Out</th>
                    <th className="py-2.5 px-4">Unforwarded Exposure</th>
                    <th className="py-2.5 px-4">Review State</th>
                    <th className="py-2.5 px-4">Evidence Quality</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {traceData.linked_accounts.map((a) => (
                    <tr
                      key={a.account_id}
                      onClick={() => setSelectedReviewAccountId(a.account_id)}
                      className={`cursor-pointer transition-colors ${
                        selectedReviewAccountId === a.account_id ? 'bg-indigo-50/70' : 'hover:bg-slate-50/60'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{a.account_id}</td>
                      <td className="py-2.5 px-4 text-slate-600">Hop {a.hop_count}</td>
                      <td className="py-2.5 px-4 text-slate-600 tabular-nums">
                        ₹{a.exposure.observed_inbound_value.toLocaleString()} / ₹{a.exposure.observed_outbound_value.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-indigo-700 tabular-nums">
                        ₹{a.exposure.attributed_unforwarded_amount?.toLocaleString() ?? '0'}
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant="review" value={a.review?.review_state || 'not_reviewed'} />
                      </td>
                      <td className="py-2.5 px-4 capitalize text-slate-600">
                        {a.review?.evidence_quality?.replace('_', ' ') || 'Not Assessed'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedReviewAccountId(a.account_id);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition-colors flex items-center gap-1 ml-auto"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Inspect & Adjudicate</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-5">
            {selectedReviewAccountId ? (
              <AccountProtectionPanel
                caseId={caseData.case_id}
                accountId={selectedReviewAccountId}
                onReviewUpdated={() => {
                  setReviewSuccess(`Review recorded in audit trail for account ${selectedReviewAccountId}`);
                  fetchCaseDetails();
                }}
              />
            ) : (
              <div className="glass-card rounded-2xl p-6 border border-slate-200/80 text-center text-xs text-slate-500">
                Select an account from the table to inspect evidence and record a review decision.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Append-Only Audit Trail */}
      {activeTab === 'audit' && (
        <div className="glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4">
          <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Immutable Audit Provenance</h2>
              <p className="text-xs text-slate-500">
                Append-only historical ledger of all investigation actions and reviewer findings.
              </p>
            </div>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {auditEvents.length} Recorded Events
            </span>
          </div>

          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {auditEvents.map((e, idx) => (
              <div key={idx} className="relative">
                <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-white" />
                <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/60 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 uppercase tracking-wider font-mono text-[11px] text-indigo-700">
                      {e.action}
                    </span>
                    <span className="text-slate-400 text-[10px]">{new Date(e.timestamp).toLocaleString()}</span>
                  </div>

                  <div className="text-slate-600">
                    Performed by <strong className="text-slate-900">{e.performed_by}</strong> on entity{' '}
                    <code className="text-slate-800">{e.entity_type} ({e.entity_id})</code>
                  </div>

                  {e.details && (
                    <pre className="mt-2 p-2 rounded bg-white border border-slate-200 text-[10px] font-mono text-slate-700 overflow-x-auto">
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
