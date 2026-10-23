import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
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
  Search,
  Filter,
  Check,
  ChevronRight,
  ChevronDown,
  Info,
  Calendar,
  CreditCard,
  Building,
  Users,
  Layers,
  Sparkles,
  ExternalLink,
  Shield,
  Clock,
  ArrowRightLeft,
  GitBranch,
  Eye,
  SlidersHorizontal,
  X,
  AlertCircle,
  TrendingDown,
  FileSearch,
  HelpCircle,
  Share2,
  Activity,
  Maximize2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { api } from '../services/api';
import {
  AuditEvent,
  FraudCase,
  GraphEdge,
  GraphNode,
  GraphResponse,
  TraceResult,
  Transaction,
  AccountAssessmentResponse,
} from '../types/api';
import { Badge } from '../components/common/Badge';
import { FundFlowHierarchicalTree } from '../components/fund-flow/FundFlowHierarchicalTree';
import { adaptCaseTraceToUnified, UnifiedTreeNode, UnifiedTreeEdge } from '../services/unifiedFlowAdapter';
import { AccountProtectionPanel } from '../components/investigation/AccountProtectionPanel';

type InvestigationTab = 'overview' | 'flow' | 'transactions' | 'accounts' | 'review';

export const CaseDetailPage: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  // Core Data States
  const [caseData, setCaseData] = useState<FraudCase | null>(null);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [accountAssessments, setAccountAssessments] = useState<AccountAssessmentResponse[]>([]);

  // Navigation & Tab State
  const tabParam = searchParams.get('tab');
  const getInitialTab = (): InvestigationTab => {
    if (tabParam === 'transactions') return 'transactions';
    if (tabParam === 'accounts' || tabParam === 'evidence') return 'accounts';
    if (tabParam === 'reviews' || tabParam === 'review' || tabParam === 'audit') return 'review';
    if (tabParam === 'flow' || tabParam === 'fund-flow' || tabParam === 'graph') return 'flow';
    return 'overview';
  };
  const [activeTab, setActiveTab] = useState<InvestigationTab>(getInitialTab());

  // UI & Loading States
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Inspector & Selection States
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedReviewAccountId, setSelectedReviewAccountId] = useState<string>(
    searchParams.get('account') || 'C300'
  );

  // Fund Flow View Mode
  const [flowViewMode, setFlowViewMode] = useState<'tree' | 'paths'>('tree');

  // Transaction Tab Filtering & Search
  const [txSearch, setTxSearch] = useState('');
  const [txRailFilter, setTxRailFilter] = useState<'all' | 'UPI' | 'IMPS' | 'NEFT'>('all');
  const [selectedTxRow, setSelectedTxRow] = useState<Transaction | null>(null);

  // Accounts Tab Filtering & Search
  const [accSearch, setAccSearch] = useState('');
  const [accStatusFilter, setAccStatusFilter] = useState<'all' | 'under_review' | 'cleared' | 'not_reviewed'>('all');

  // Audit Tab Filter
  const [auditFilter, setAuditFilter] = useState<'all' | 'reviews' | 'trace' | 'case'>('all');

  // Fetch Case Details
  const fetchCaseDetails = async (isManualRefresh = false) => {
    if (!caseId) return;
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [c, graph, trace, txs, audit, accs] = await Promise.all([
        api.getCase(caseId),
        api.getCaseGraph(caseId),
        api.getCaseTrace(caseId),
        api.getCaseTransactions(caseId),
        api.getCaseAuditTrail(caseId),
        api.getCaseAccountAssessments(caseId).catch(() => ({ assessments: [] })),
      ]);

      setCaseData(c);
      setGraphData(graph);
      setTraceData(trace);
      setTransactions(txs.transactions);
      setAuditEvents(audit.events);
      if (accs?.assessments) {
        setAccountAssessments(accs.assessments);
      }

      // Default review account if none selected
      if (!selectedReviewAccountId && trace.linked_accounts.length > 0) {
        const c300 = trace.linked_accounts.find((a) => a.account_id === 'C300');
        setSelectedReviewAccountId(c300 ? c300.account_id : trace.linked_accounts[0].account_id);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load investigation dossier.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCaseDetails();
  }, [caseId]);

  // Keep URL search params in sync with active tab
  const switchTab = (tab: InvestigationTab, accountId?: string) => {
    setActiveTab(tab);
    if (accountId) setSelectedReviewAccountId(accountId);
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    if (accountId) params.set('account', accountId);
    setSearchParams(params, { replace: true });
  };

  // GSAP Entrance Animation
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
    if (!prefersReducedMotion && containerRef.current && !loading && caseData) {
      const ctx = gsap.context(() => {
        gsap.from('.case-dossier-header', {
          opacity: 0,
          y: 12,
          duration: 0.45,
          ease: 'power2.out',
        });
        gsap.from('.case-metric-card', {
          opacity: 0,
          y: 14,
          duration: 0.45,
          stagger: 0.08,
          ease: 'power2.out',
          delay: 0.1,
        });
        gsap.from('.case-tabs-bar', {
          opacity: 0,
          y: 8,
          duration: 0.35,
          ease: 'power2.out',
          delay: 0.25,
        });
      }, containerRef);
      return () => ctx.revert();
    }
  }, [loading, Boolean(caseData)]);

  // Triage Status Change Handler
  const handleStatusChange = async (newStatus: string) => {
    if (!caseId || !caseData) return;
    setStatusUpdating(true);
    try {
      const updated = await api.updateCase(caseId, {
        investigation_status: newStatus,
        updated_by: 'lead_investigator_ui',
      });
      setCaseData(updated);
      setFeedbackToast({
        message: `Case ${caseId} triage status updated to ${newStatus.replace(/_/g, ' ')}.`,
        type: 'success',
      });
      const audit = await api.getCaseAuditTrail(caseId);
      setAuditEvents(audit.events);
    } catch (err: any) {
      setFeedbackToast({
        message: `Failed to update triage status: ${err.message}`,
        type: 'error',
      });
    } finally {
      setStatusUpdating(false);
    }
  };

  // Export CSV Handler
  const handleExportCsv = () => {
    if (!transactions.length) return;
    const headers = ['Transaction ID', 'Timestamp', 'Sender Account', 'Receiver Account', 'Amount', 'Currency', 'Type', 'Hop'];
    const rows = transactions.map((t) => [
      t.transaction_id,
      t.timestamp,
      t.sender_account_id,
      t.receiver_account_id,
      t.amount,
      t.currency,
      t.transaction_type,
      (t as any).hop_count ?? (t as any).hop ?? 1,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${caseId || 'case'}_transactions.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setFeedbackToast({
      message: `Exported ${transactions.length} transactions to CSV.`,
      type: 'success',
    });
  };

  // Unified Flow Tree Adapter
  const unifiedFlow = useMemo(() => {
    if (!caseData || !graphData) return null;
    return adaptCaseTraceToUnified(caseData.case_id, graphData, traceData);
  }, [caseData, graphData, traceData]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const matchesRail = txRailFilter === 'all' || t.transaction_type.toUpperCase() === txRailFilter;
      const q = txSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.transaction_id.toLowerCase().includes(q) ||
        t.sender_account_id.toLowerCase().includes(q) ||
        t.receiver_account_id.toLowerCase().includes(q);
      return matchesRail && matchesSearch;
    });
  }, [transactions, txRailFilter, txSearch]);

  // Connected Accounts List with Details
  const connectedAccountsList = useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes.map((node) => {
      const assessment = accountAssessments.find((a) => a.account_id === node.id);
      const linked = traceData?.linked_accounts.find((a) => a.account_id === node.id);
      return {
        id: node.id,
        role: node.role,
        hop: node.hop_count ?? (node.role === 'reporting_victim' ? 0 : 1),
        isVictim: node.role === 'reporting_victim',
        isInitialReceiver: node.role === 'reported_initial_receiver',
        reviewState: assessment?.review_status?.review_state || linked?.review?.review_state || 'under_review',
        observedIn: assessment?.observed_movement?.observed_inbound_value ?? (linked?.exposure?.observed_inbound_value ?? 0),
        observedOut: assessment?.observed_movement?.observed_outbound_value ?? (linked?.exposure?.observed_outbound_value ?? 0),
        attributedUnforwarded: assessment?.traceable_exposure?.attributed_unforwarded_amount ?? (linked?.exposure?.attributed_unforwarded_amount ?? 0),
        evidenceSufficiency: assessment?.evidence_assessment?.evidence_sufficiency || 'scenario_lineage_assumed',
        evidenceGaps: assessment?.evidence_assessment?.evidence_gaps || [
          'External documentation (invoice or KYC) not verified.',
        ],
      };
    });
  }, [graphData, traceData, accountAssessments]);

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return connectedAccountsList.filter((acc) => {
      const matchesStatus = accStatusFilter === 'all' || acc.reviewState === accStatusFilter;
      const q = accSearch.toLowerCase().trim();
      const matchesSearch = !q || acc.id.toLowerCase().includes(q) || acc.role.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [connectedAccountsList, accStatusFilter, accSearch]);

  // Filtered Audits
  const filteredAudits = useMemo(() => {
    return auditEvents.filter((e) => {
      if (auditFilter === 'reviews') return e.action.includes('review');
      if (auditFilter === 'trace') return e.action.includes('trace');
      if (auditFilter === 'case') return e.action.includes('case');
      return true;
    });
  }, [auditEvents, auditFilter]);

  // Selected Node Details for Fund Flow Inspector
  const selectedNodeInfo = useMemo(() => {
    if (!selectedNodeId || !graphData) return null;
    const node = graphData.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return null;
    const acc = connectedAccountsList.find((a) => a.id === selectedNodeId);
    return { ...node, ...acc };
  }, [selectedNodeId, graphData, connectedAccountsList]);

  // Selected Edge Details for Fund Flow Inspector
  const selectedEdgeInfo = useMemo(() => {
    if (!selectedEdgeId || !graphData) return null;
    return graphData.edges.find((e) => e.id === selectedEdgeId) || null;
  }, [selectedEdgeId, graphData]);

  // Loading State
  if (loading && !caseData) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4 text-center px-4">
        <div className="w-10 h-10 rounded-2xl bg-white border border-[#EAE3D6] flex items-center justify-center shadow-xs">
          <RefreshCw className="w-5 h-5 text-[#EA8500] animate-spin" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#1A1714]">Loading Investigation Dossier</h2>
          <p className="text-xs text-[#6B655B] mt-1 font-mono">Retrieving forensic topology &amp; audit provenance for {caseId}...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error || !caseData) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4">
        <div className="bg-white rounded-2xl border border-red-200 p-8 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-200">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-[#1A1714]">Investigation Case Not Found</h2>
            <p className="text-xs text-[#6B655B] leading-relaxed max-w-sm mx-auto">
              {error || `Case ID "${caseId}" could not be located in the forensic database.`}
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Link
              to="/cases"
              className="px-4 py-2 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Case Management</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Toast Feedback */}
      <AnimatePresence>
        {feedbackToast && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-xs font-medium flex items-center gap-2.5 backdrop-blur-md ${
              feedbackToast.type === 'success'
                ? 'bg-emerald-50/95 border-emerald-300 text-emerald-950'
                : 'bg-red-50/95 border-red-300 text-red-950'
            }`}
          >
            {feedbackToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedbackToast.message}</span>
            <button
              onClick={() => setFeedbackToast(null)}
              className="ml-2 text-[#6B655B] hover:text-[#1A1714]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Breadcrumb Navigation Strip */}
      <div className="flex items-center justify-between text-xs text-[#6B655B]">
        <Link
          to="/cases"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B655B] hover:text-[#EA8500] transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-[#6B655B] group-hover:text-[#EA8500] transition-colors" />
          <span>Back to Case Management</span>
        </Link>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[#8C857B]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Active Forensic Dossier</span>
          <span>·</span>
          <span>FastAPI + SQLite Core</span>
        </div>
      </div>

      {/* Case Header Card */}
      <div className="case-dossier-header bg-white rounded-2xl border border-[#EAE3D6] p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[11px] font-mono font-semibold text-[#EA8500] tracking-wider uppercase bg-[#FFF7ED] border border-[#FFEDD5] px-2.5 py-0.5 rounded-md">
                04 / CASE DOSSIER
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] font-mono tracking-tight">
                {caseData.case_id}
              </h1>
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                  caseData.investigation_status === 'under_investigation'
                    ? 'bg-[#FFF7ED] text-[#C2410C] border-[#FFEDD5]'
                    : caseData.investigation_status === 'open'
                    ? 'bg-[#F0FDF4] text-[#15803D] border-[#DCFCE7]'
                    : 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    caseData.investigation_status === 'under_investigation'
                      ? 'bg-[#EA8500] animate-pulse'
                      : caseData.investigation_status === 'open'
                      ? 'bg-[#16A34A]'
                      : 'bg-[#64748B]'
                  }`}
                />
                <span className="capitalize">{caseData.investigation_status.replace(/_/g, ' ')}</span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-[#475569] leading-relaxed max-w-3xl">
              {caseData.description}
            </p>

            {/* Quick Context Tags */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono text-[#6B655B]">
              <span className="inline-flex items-center gap-1 bg-[#FAF7F2] border border-[#EAE3D6] px-2 py-0.5 rounded-md">
                <Calendar className="w-3 h-3 text-[#EA8500]" />
                <span>Reported: {new Date(caseData.reported_at).toLocaleString()}</span>
              </span>
              <span className="inline-flex items-center gap-1 bg-[#FAF7F2] border border-[#EAE3D6] px-2 py-0.5 rounded-md">
                <CreditCard className="w-3 h-3 text-[#EA8500]" />
                <span>Origin TX: <strong className="text-[#1A1714]">{caseData.reported_origin_transaction_id}</strong></span>
              </span>
              <span className="inline-flex items-center gap-1 bg-[#FAF7F2] border border-[#EAE3D6] px-2 py-0.5 rounded-md">
                <Shield className="w-3 h-3 text-[#EA8500]" />
                <span>Bounded Traceable Pool: <strong className="text-[#1A1714]">₹{caseData.reported_amount.toLocaleString()} {caseData.currency}</strong></span>
              </span>
            </div>
          </div>

          {/* Action Header Controls */}
          <div className="flex flex-wrap items-center gap-2.5 self-start shrink-0">
            {/* Triage Status Dropdown */}
            <div className="flex items-center gap-2 bg-[#FAF7F2] px-3 py-1.5 rounded-xl border border-[#EAE3D6]">
              <span className="text-[11px] font-mono text-[#6B655B] font-medium">TRIAGE:</span>
              <select
                value={caseData.investigation_status}
                disabled={statusUpdating}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="text-xs font-mono font-bold text-[#1A1714] bg-transparent outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="under_investigation">Under Investigation</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => fetchCaseDetails(true)}
              disabled={refreshing}
              title="Refresh Case Dossier"
              className="p-2 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#EA8500]' : ''}`} />
            </button>

            {/* CSV Export Button */}
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#1A1714] font-semibold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-[#EA8500]" />
              <span>Export CSV</span>
            </button>

            {/* Primary Action Button */}
            <button
              onClick={() => switchTab('review', 'C300')}
              className="px-4 py-2 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              <span>Review Evidence</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards Row (4 Compact Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Reported Loss */}
        <div className="case-metric-card bg-white rounded-2xl border border-[#EAE3D6] p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-mono uppercase text-[#6B655B] font-semibold tracking-wider block">
              Reported Loss
            </span>
            <div className="text-xl font-bold font-mono text-[#1A1714] mt-1 tabular-nums">
              ₹{caseData.reported_amount.toLocaleString()} <span className="text-xs font-normal text-[#6B655B]">{caseData.currency}</span>
            </div>
            <span className="text-[11px] text-[#8C857B] mt-0.5 block">
              Origin transfer complaint
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#FFF7ED] border border-[#FFEDD5] flex items-center justify-center text-[#EA8500]">
            <CreditCard className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Connected Accounts */}
        <div className="case-metric-card bg-white rounded-2xl border border-[#EAE3D6] p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-mono uppercase text-[#6B655B] font-semibold tracking-wider block">
              Connected Accounts
            </span>
            <div className="text-xl font-bold font-mono text-[#1A1714] mt-1">
              {graphData?.nodes.length || 8} <span className="text-xs font-normal text-[#6B655B]">entities</span>
            </div>
            <span className="text-[11px] text-[#8C857B] mt-0.5 block">
              1 victim, 1 receiver, 6 hops
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#1A1714]">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Traced Transactions */}
        <div className="case-metric-card bg-white rounded-2xl border border-[#EAE3D6] p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-mono uppercase text-[#6B655B] font-semibold tracking-wider block">
              Traced Network
            </span>
            <div className="text-xl font-bold font-mono text-[#1A1714] mt-1">
              {transactions.length} <span className="text-xs font-normal text-[#6B655B]">transactions</span>
            </div>
            <span className="text-[11px] text-[#8C857B] mt-0.5 block">
              Multi-hop ledger paths
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#1A1714]">
            <ArrowRightLeft className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Investigation Status */}
        <div className="case-metric-card bg-white rounded-2xl border border-[#EAE3D6] p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-mono uppercase text-[#6B655B] font-semibold tracking-wider block">
              Current Status
            </span>
            <div className="text-base font-bold text-[#1A1714] mt-1 capitalize flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EA8500] animate-pulse" />
              <span>{caseData.investigation_status.replace(/_/g, ' ')}</span>
            </div>
            <span className="text-[11px] text-[#8C857B] mt-0.5 block">
              {auditEvents.length} immutable audit logs
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#FFF7ED] border border-[#FFEDD5] flex items-center justify-center text-[#EA8500]">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 5 Investigation Navigation Tabs */}
      <div className="case-tabs-bar bg-white rounded-2xl border border-[#EAE3D6] p-1.5 shadow-xs flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => switchTab('overview')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-[#1A1714] text-white shadow-xs'
              : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2]'
          }`}
        >
          <FileText className="w-4 h-4 text-[#EA8500]" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => switchTab('flow')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'flow'
              ? 'bg-[#1A1714] text-white shadow-xs'
              : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2]'
          }`}
        >
          <Network className="w-4 h-4 text-[#EA8500]" />
          <span>Fund Flow Tree</span>
        </button>

        <button
          onClick={() => switchTab('transactions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'transactions'
              ? 'bg-[#1A1714] text-white shadow-xs'
              : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2]'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4 text-[#EA8500]" />
          <span>Transactions ({transactions.length})</span>
        </button>

        <button
          onClick={() => switchTab('accounts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'accounts'
              ? 'bg-[#1A1714] text-white shadow-xs'
              : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2]'
          }`}
        >
          <Building className="w-4 h-4 text-[#EA8500]" />
          <span>Accounts &amp; Evidence ({graphData?.nodes.length || 8})</span>
        </button>

        <button
          onClick={() => switchTab('review')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'review'
              ? 'bg-[#1A1714] text-white shadow-xs'
              : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-[#FAF7F2]'
          }`}
        >
          <UserCheck className="w-4 h-4 text-[#EA8500]" />
          <span>Review &amp; Audit ({auditEvents.length})</span>
        </button>
      </div>

      {/* TAB CONTENT SECTIONS */}

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* Left Panel: What happened? (7 Columns) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Incident Summary Card */}
            <div className="bg-white rounded-2xl border border-[#EAE3D6] p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#FAF7F2]">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#FFF7ED] border border-[#FFEDD5] flex items-center justify-center text-[#EA8500]">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#1A1714]">Reported Incident Summary</h3>
                    <span className="text-[11px] text-[#6B655B]">Victim complaint &amp; origin transfer context</span>
                  </div>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#FAF7F2] text-[#6B655B] border border-[#EAE3D6]">
                  REF: {caseData.case_id}
                </span>
              </div>

              {/* Quotation Style Incident Box */}
              <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1A1714]">
                  <span className="w-2 h-2 rounded-full bg-[#EA8500]" />
                  <span>Victim Statement &amp; Forensic Intake Record</span>
                </div>
                <p className="text-xs text-[#475569] leading-relaxed italic">
                  "{caseData.description}"
                </p>
              </div>

              {/* Origin Payment Leg Sub-Card */}
              <div className="p-4 rounded-xl bg-white border border-[#EAE3D6] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1A1714] font-mono">
                    Origin Transaction: {caseData.reported_origin_transaction_id}
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-[#EA8500] bg-[#FFF7ED] px-2 py-0.5 rounded border border-[#FFEDD5]">
                    UPI TRANSFER
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-[#8C857B] font-mono block">Sender (Victim)</span>
                    <span className="font-mono font-bold text-[#1A1714]">V001</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#8C857B] font-mono block">Initial Receiver</span>
                    <span className="font-mono font-bold text-[#1A1714]">A100</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#8C857B] font-mono block">Reported Amount</span>
                    <span className="font-mono font-bold text-[#1A1714] tabular-nums">
                      ₹{caseData.reported_amount.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#8C857B] font-mono block">Settlement Time</span>
                    <span className="font-mono text-[#6B655B] text-[11px]">
                      12 Jan 2026, 10:22
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#FAF7F2] flex items-center justify-between">
                  <span className="text-[11px] text-[#6B655B]">
                    Single transaction pre-transfer model evaluation
                  </span>
                  <Link
                    to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(caseData.reported_origin_transaction_id)}`}
                    className="text-xs font-semibold text-[#EA8500] hover:text-[#D27400] inline-flex items-center gap-1 font-mono"
                  >
                    <span>Explain Score in Risk Engine</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Chronological Incident Milestones (Timeline) */}
            <div className="bg-white rounded-2xl border border-[#EAE3D6] p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-[#FAF7F2]">
                <div className="w-8 h-8 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#1A1714]">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1A1714]">Case Milestones &amp; Multi-Hop Progression</h3>
                  <span className="text-[11px] text-[#6B655B]">Chronological sequence of verified ledger events</span>
                </div>
              </div>

              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-px before:bg-[#EAE3D6]">
                {/* Milestone 1 */}
                <div className="relative">
                  <div className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-[#EA8500] ring-4 ring-white" />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1A1714]">1. Origin Fraudulent Debit</span>
                      <span className="font-mono text-[11px] text-[#8C857B]">12 Jan 2026, 10:22</span>
                    </div>
                    <p className="text-xs text-[#6B655B] leading-relaxed">
                      Victim account <strong className="text-[#1A1714] font-mono">V001</strong> transferred ₹50,000 via UPI (T001) to reported initial receiver <strong className="text-[#1A1714] font-mono">A100</strong>.
                    </p>
                  </div>
                </div>

                {/* Milestone 2 */}
                <div className="relative">
                  <div className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-[#EA8500] ring-4 ring-white" />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1A1714]">2. Immediate Pass-Through (Hop 1)</span>
                      <span className="font-mono text-[11px] text-[#8C857B]">12 Jan 2026, 10:25</span>
                    </div>
                    <p className="text-xs text-[#6B655B] leading-relaxed">
                      Account <strong className="text-[#1A1714] font-mono">A100</strong> immediately forwarded ₹50,000 via IMPS (T002) to intermediary account <strong className="text-[#1A1714] font-mono">B200</strong> within 3 minutes of receipt.
                    </p>
                  </div>
                </div>

                {/* Milestone 3 */}
                <div className="relative">
                  <div className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-[#EA8500] ring-4 ring-white" />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1A1714]">3. Downstream Split &amp; Layering (Hop 2)</span>
                      <span className="font-mono text-[11px] text-[#8C857B]">12 Jan 2026, 10:30</span>
                    </div>
                    <p className="text-xs text-[#6B655B] leading-relaxed">
                      Account <strong className="text-[#1A1714] font-mono">B200</strong> split the funds into two outward legs: ₹30,000 via UPI (T003) to <strong className="text-[#1A1714] font-mono">C300</strong>, and ₹20,000 via IMPS (T004) to <strong className="text-[#1A1714] font-mono">D400</strong>.
                    </p>
                  </div>
                </div>

                {/* Milestone 4 */}
                <div className="relative">
                  <div className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-[#16A34A] ring-4 ring-white" />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1A1714]">4. Incident Registered in Triage</span>
                      <span className="font-mono text-[11px] text-[#8C857B]">12 Jan 2026, 10:35</span>
                    </div>
                    <p className="text-xs text-[#6B655B] leading-relaxed">
                      Formal complaint lodged by victim V001; case dossier FS-1042 generated with automated multi-hop tracing bounded to 10 hops.
                    </p>
                  </div>
                </div>

                {/* Milestone 5 */}
                <div className="relative">
                  <div className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-[#64748B] ring-4 ring-white" />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1A1714]">5. Terminal Hop Disbursements (Hop 3)</span>
                      <span className="font-mono text-[11px] text-[#8C857B]">12 Jan 2026, 10:40–10:50</span>
                    </div>
                    <p className="text-xs text-[#6B655B] leading-relaxed">
                      Further partial disbursements traced to endpoint accounts <strong className="text-[#1A1714] font-mono">E500</strong> (₹10,000), <strong className="text-[#1A1714] font-mono">F600</strong> (₹5,000), and <strong className="text-[#1A1714] font-mono">G700</strong> (₹10,000).
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Factual Safeguards & Findings Card */}
            <div className="bg-[#FAF7F2] rounded-2xl border border-[#EAE3D6] p-5 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[#EA8500] shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-[#1A1714]">Anti-Double-Counting &amp; Evidentiary Safeguards</h4>
                  <p className="text-[#6B655B] leading-relaxed">
                    Gross observed ledger transfer volume across all 7 traced legs is <strong className="text-[#1A1714]">₹1,75,000 INR</strong>, whereas reported victim loss is strictly <strong className="text-[#1A1714]">₹50,000 INR</strong>.
                    FraudShield AI strictly isolates exposure: downstream re-transfers are never summed into an inflated stolen total. Receiving funds linked to an upstream report does not establish criminal complicity.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: What needs attention? (5 Columns) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Suggested Next Step Card */}
            <div className="bg-gradient-to-br from-white to-[#FFF7ED] rounded-2xl border-2 border-[#EA8500]/40 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#EA8500]">
                <Sparkles className="w-4 h-4 text-[#EA8500]" />
                <span className="uppercase tracking-wider font-mono text-[11px]">Suggested Next Step</span>
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-[#1A1714]">
                  Examine Hop 2 Account C300 (₹30,000 Unforwarded Exposure)
                </h4>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Account C300 received ₹30,000 from B200 and retains the highest unforwarded attributed balance. Verify whether C300 holds legitimate commercial invoices or merchant KYC before taking formal compliance action.
                </p>
              </div>
              <button
                onClick={() => switchTab('review', 'C300')}
                className="w-full py-2.5 px-4 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <UserCheck className="w-4 h-4" />
                <span>Adjudicate Account C300 Now</span>
              </button>
            </div>

            {/* Outstanding Evidence Gaps Card */}
            <div className="bg-white rounded-2xl border border-[#EAE3D6] p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2.5 border-b border-[#FAF7F2]">
                <FileSearch className="w-4 h-4 text-[#EA8500]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#1A1714] font-mono">
                  Outstanding Evidence Gaps
                </h4>
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1A1714]">Missing Commercial Invoice</span>
                    <span className="text-[10px] font-mono text-[#C2410C] bg-[#FFF7ED] px-1.5 py-0.5 rounded border border-[#FFEDD5]">
                      ACC: C300
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B655B]">
                    No receipt or matching purchase order recorded to justify the ₹30,000 inflow from B200.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1A1714]">Uncorroborated KYC Tier</span>
                    <span className="text-[10px] font-mono text-[#C2410C] bg-[#FFF7ED] px-1.5 py-0.5 rounded border border-[#FFEDD5]">
                      ACC: B200
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B655B]">
                    Intermediary hop B200 exhibits high pass-through velocity without full biometric KYC corroboration.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1A1714]">Bank Session Verification</span>
                    <span className="text-[10px] font-mono text-[#6B655B] bg-white px-1.5 py-0.5 rounded border border-[#EAE3D6]">
                      ACC: A100
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B655B]">
                    Determine whether A100 outbound IMPS was initiated from an authorized IP session or automated API key.
                  </p>
                </div>
              </div>
            </div>

            {/* Connected Accounts Needing Review */}
            <div className="bg-white rounded-2xl border border-[#EAE3D6] p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-[#FAF7F2]">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#EA8500]" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1A1714] font-mono">
                    Accounts Requiring Review ({traceData?.linked_accounts.length || 7})
                  </h4>
                </div>
                <button
                  onClick={() => switchTab('accounts')}
                  className="text-[11px] text-[#EA8500] hover:underline font-semibold"
                >
                  View All
                </button>
              </div>

              <div className="space-y-2">
                {connectedAccountsList
                  .filter((a) => !a.isVictim)
                  .map((acc) => (
                    <div
                      key={acc.id}
                      className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 font-mono">
                        <span className="font-bold text-[#1A1714]">{acc.id}</span>
                        <span className="text-[10px] text-[#8C857B]">Hop {acc.hop}</span>
                        <span className="text-[10px] font-semibold text-[#EA8500]">
                          ₹{acc.attributedUnforwarded.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="review" value={acc.reviewState} />
                        <button
                          onClick={() => switchTab('review', acc.id)}
                          className="px-2 py-0.5 rounded-lg bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#1A1714] text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Review →
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Recent Audit Provenance (Preview) */}
            <div className="bg-white rounded-2xl border border-[#EAE3D6] p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-[#FAF7F2]">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#EA8500]" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1A1714] font-mono">
                    Recent Case Activity
                  </h4>
                </div>
                <button
                  onClick={() => switchTab('review')}
                  className="text-[11px] text-[#EA8500] hover:underline font-semibold"
                >
                  Full Log
                </button>
              </div>

              <div className="space-y-2 text-xs">
                {auditEvents.slice(0, 3).map((event, idx) => (
                  <div key={idx} className="p-2 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] space-y-0.5 font-mono text-[11px]">
                    <div className="flex items-center justify-between text-[#8C857B]">
                      <span className="text-[#EA8500] font-bold uppercase">{event.action}</span>
                      <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[#1A1714] truncate">
                      By <strong>{event.performed_by}</strong> on {event.entity_id}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* TAB 2: FUND FLOW TREE */}
      {activeTab === 'flow' && unifiedFlow && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          {/* Subheader Toolbar */}
          <div className="bg-white rounded-2xl border border-[#EAE3D6] p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-[#EA8500] uppercase tracking-wider">
                TOPOLOGY:
              </span>
              <span className="text-[#1A1714] font-medium">
                {graphData?.nodes.length || 8} Accounts · {graphData?.edges.length || 7} Payment Legs · Max Depth 3 Hops · Acyclic Directed Tree
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* View Mode Toggle */}
              <div className="flex items-center bg-[#FAF7F2] p-1 rounded-xl border border-[#EAE3D6]">
                <button
                  onClick={() => setFlowViewMode('tree')}
                  className={`px-3 py-1 rounded-lg font-semibold text-xs transition-colors cursor-pointer ${
                    flowViewMode === 'tree'
                      ? 'bg-white text-[#1A1714] shadow-xs'
                      : 'text-[#6B655B] hover:text-[#1A1714]'
                  }`}
                >
                  Interactive Tree
                </button>
                <button
                  onClick={() => setFlowViewMode('paths')}
                  className={`px-3 py-1 rounded-lg font-semibold text-xs transition-colors cursor-pointer ${
                    flowViewMode === 'paths'
                      ? 'bg-white text-[#1A1714] shadow-xs'
                      : 'text-[#6B655B] hover:text-[#1A1714]'
                  }`}
                >
                  Path Breakdown
                </button>
              </div>

              <Link
                to={`/fund-flow?case=${encodeURIComponent(caseData.case_id)}`}
                className="px-3 py-1.5 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#EA8500] font-semibold text-xs inline-flex items-center gap-1 transition-colors shadow-xs"
              >
                <span>Fullscreen Explorer</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {flowViewMode === 'tree' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Tree Canvas */}
              <div className={`${selectedNodeInfo || selectedEdgeInfo ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
                <FundFlowHierarchicalTree
                  nodes={unifiedFlow.nodes}
                  edges={unifiedFlow.edges}
                  rootAccountId={unifiedFlow.summary.rootAccountId}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onSelectNode={(node) => {
                    setSelectedNodeId(node ? node.id : null);
                    setSelectedEdgeId(null);
                  }}
                  onSelectEdge={(edge) => {
                    setSelectedEdgeId(edge ? edge.id : null);
                    setSelectedNodeId(null);
                  }}
                  height="540px"
                />
              </div>

              {/* Node / Edge Inspector Drawer */}
              {(selectedNodeInfo || selectedEdgeInfo) && (
                <div className="lg:col-span-4 bg-white rounded-2xl border border-[#EAE3D6] p-5 shadow-xs space-y-4">
                  {selectedNodeInfo ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-[#FAF7F2]">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-xl bg-[#FFF7ED] border border-[#FFEDD5] flex items-center justify-center text-[#EA8500]">
                            <Building className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-[#1A1714] font-mono">{selectedNodeInfo.id}</h3>
                            <span className="text-[11px] text-[#6B655B] capitalize">{selectedNodeInfo.role.replace(/_/g, ' ')}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedNodeId(null)}
                          className="text-[#8C857B] hover:text-[#1A1714] p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
                          <span className="text-[10px] text-[#8C857B] font-mono block">Hop Distance</span>
                          <span className="font-mono font-bold text-[#1A1714]">Hop {selectedNodeInfo.hop}</span>
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
                          <span className="text-[10px] text-[#8C857B] font-mono block">Review Status</span>
                          <Badge variant="review" value={selectedNodeInfo.reviewState || 'not_reviewed'} />
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5 text-xs">
                        <span className="font-bold text-[#1A1714] block">Observed Ledger Movement</span>
                        <div className="flex justify-between font-mono">
                          <span className="text-[#6B655B]">Gross Inbound:</span>
                          <span className="font-bold text-[#1A1714]">₹{(selectedNodeInfo.observedIn ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-mono">
                          <span className="text-[#6B655B]">Gross Outbound:</span>
                          <span className="font-bold text-[#1A1714]">₹{(selectedNodeInfo.observedOut ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-mono pt-1 border-t border-[#EAE3D6]">
                          <span className="text-[#EA8500] font-semibold">Attributed Exposure:</span>
                          <span className="font-bold text-[#EA8500]">₹{(selectedNodeInfo.attributedUnforwarded ?? 0).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2">
                        <button
                          onClick={() => switchTab('review', selectedNodeInfo.id)}
                          className="w-full py-2.5 px-3 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                        >
                          <UserCheck className="w-4 h-4" />
                          <span>Adjudicate in Review &amp; Audit</span>
                        </button>
                        <Link
                          to={`/accounts/${encodeURIComponent(selectedNodeInfo.id)}`}
                          className="w-full py-2 px-3 rounded-xl bg-white hover:bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <span>Open Account 360° Profile</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  ) : selectedEdgeInfo ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-[#FAF7F2]">
                        <div>
                          <h3 className="text-sm font-bold text-[#1A1714] font-mono">{selectedEdgeInfo.id}</h3>
                          <span className="text-[11px] text-[#6B655B]">Traced Payment Leg</span>
                        </div>
                        <button
                          onClick={() => setSelectedEdgeId(null)}
                          className="text-[#8C857B] hover:text-[#1A1714] p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between py-1 border-b border-[#FAF7F2]">
                          <span className="text-[#6B655B]">From:</span>
                          <span className="font-mono font-bold text-[#1A1714]">{selectedEdgeInfo.source}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-[#FAF7F2]">
                          <span className="text-[#6B655B]">To:</span>
                          <span className="font-mono font-bold text-[#1A1714]">{selectedEdgeInfo.target}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-[#FAF7F2]">
                          <span className="text-[#6B655B]">Amount:</span>
                          <span className="font-mono font-bold text-[#1A1714] tabular-nums">
                            ₹{selectedEdgeInfo.amount.toLocaleString()} {selectedEdgeInfo.currency}
                          </span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-[#FAF7F2]">
                          <span className="text-[#6B655B]">Payment Rail:</span>
                          <span className="font-mono font-bold text-[#EA8500]">{selectedEdgeInfo.transaction_type}</span>
                        </div>
                      </div>

                      <Link
                        to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(selectedEdgeInfo.id)}`}
                        className="w-full py-2.5 px-3 rounded-xl bg-[#1A1714] hover:bg-[#2C2723] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <ShieldCheck className="w-4 h-4 text-[#EA8500]" />
                        <span>Score &amp; Explain in Risk Engine</span>
                      </Link>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            /* Path Breakdown Mode */
            <div className="bg-white rounded-2xl border border-[#EAE3D6] p-6 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#1A1714]">Linear Multi-Hop Flow Paths</h3>
                <p className="text-xs text-[#6B655B] mt-0.5">
                  Sequential ledger paths tracing the ₹50,000 origin transfer from victim V001 to downstream endpoints.
                </p>
              </div>

              <div className="space-y-3">
                {/* Path 1 */}
                <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#1A1714]">
                    <span>PATH 1: V001 → A100 → B200 → C300 → E500</span>
                    <span className="text-[#EA8500]">₹10,000 Terminal</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#6B655B]">
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">V001 (Victim)</span>
                    <span>→ T001 (₹50k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">A100 (Hop 1)</span>
                    <span>→ T002 (₹50k IMPS) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">B200 (Hop 2)</span>
                    <span>→ T003 (₹30k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">C300 (Hop 2)</span>
                    <span>→ T005 (₹10k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-[#FFF7ED] border border-[#FFEDD5] text-[#C2410C] font-bold">E500 (Hop 3)</span>
                  </div>
                </div>

                {/* Path 2 */}
                <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#1A1714]">
                    <span>PATH 2: V001 → A100 → B200 → C300 → F600</span>
                    <span className="text-[#EA8500]">₹5,000 Terminal</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#6B655B]">
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">V001 (Victim)</span>
                    <span>→ T001 (₹50k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">A100 (Hop 1)</span>
                    <span>→ T002 (₹50k IMPS) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">B200 (Hop 2)</span>
                    <span>→ T003 (₹30k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">C300 (Hop 2)</span>
                    <span>→ T006 (₹5k NEFT) →</span>
                    <span className="px-2 py-0.5 rounded bg-[#FFF7ED] border border-[#FFEDD5] text-[#C2410C] font-bold">F600 (Hop 3)</span>
                  </div>
                </div>

                {/* Path 3 */}
                <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#1A1714]">
                    <span>PATH 3: V001 → A100 → B200 → D400 → G700</span>
                    <span className="text-[#EA8500]">₹10,000 Terminal</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#6B655B]">
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">V001 (Victim)</span>
                    <span>→ T001 (₹50k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">A100 (Hop 1)</span>
                    <span>→ T002 (₹50k IMPS) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">B200 (Hop 2)</span>
                    <span>→ T004 (₹20k IMPS) →</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#EAE3D6]">D400 (Hop 2)</span>
                    <span>→ T007 (₹10k UPI) →</span>
                    <span className="px-2 py-0.5 rounded bg-[#FFF7ED] border border-[#FFEDD5] text-[#C2410C] font-bold">G700 (Hop 3)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* TAB 3: TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-2xl border border-[#EAE3D6] shadow-xs overflow-hidden space-y-4"
        >
          {/* Toolbar Header */}
          <div className="p-4 bg-[#FAF7F2] border-b border-[#EAE3D6] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search Bar */}
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8C857B]" />
                <input
                  type="text"
                  placeholder="Filter by TX, sender, receiver..."
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-white border border-[#EAE3D6] text-xs focus:outline-none focus:border-[#EA8500] font-mono text-[#1A1714]"
                />
              </div>

              {/* Payment Rail Filter */}
              <div className="flex items-center bg-white p-1 rounded-xl border border-[#EAE3D6] text-xs">
                {(['all', 'UPI', 'IMPS', 'NEFT'] as const).map((rail) => (
                  <button
                    key={rail}
                    onClick={() => setTxRailFilter(rail)}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      txRailFilter === rail
                        ? 'bg-[#1A1714] text-white shadow-xs'
                        : 'text-[#6B655B] hover:text-[#1A1714]'
                    }`}
                  >
                    {rail === 'all' ? 'All Rails' : rail}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#6B655B]">
                Showing {filteredTransactions.length} of {transactions.length} legs
              </span>
              <button
                onClick={handleExportCsv}
                className="px-3 py-1.5 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#1A1714] font-semibold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5 text-[#EA8500]" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F2] text-[#6B655B] font-mono text-[11px] uppercase border-b border-[#EAE3D6]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Transaction ID</th>
                  <th className="py-3 px-4 font-semibold">Settlement Time</th>
                  <th className="py-3 px-4 font-semibold">Sender Account</th>
                  <th className="py-3 px-4 font-semibold">Receiver Account</th>
                  <th className="py-3 px-4 font-semibold">Amount (INR)</th>
                  <th className="py-3 px-4 font-semibold">Payment Rail</th>
                  <th className="py-3 px-4 font-semibold">Hop</th>
                  <th className="py-3 px-4 font-semibold text-right">Explainable AI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE3D6]">
                {filteredTransactions.map((t) => (
                  <tr
                    key={t.transaction_id}
                    onClick={() => setSelectedTxRow(selectedTxRow?.transaction_id === t.transaction_id ? null : t)}
                    className={`hover:bg-[#FAF7F2] transition-colors cursor-pointer ${
                      selectedTxRow?.transaction_id === t.transaction_id ? 'bg-[#FFF7ED]' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-[#EA8500]">
                      {t.transaction_id}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[#6B655B]">
                      {new Date(t.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          switchTab('review', t.sender_account_id);
                        }}
                        className="text-[#1A1714] hover:text-[#EA8500] hover:underline font-bold"
                      >
                        {t.sender_account_id}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          switchTab('review', t.receiver_account_id);
                        }}
                        className="text-[#1A1714] hover:text-[#EA8500] hover:underline font-bold"
                      >
                        {t.receiver_account_id}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-[#1A1714] tabular-nums">
                      ₹{t.amount.toLocaleString()} {t.currency}
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714]">
                        {t.transaction_type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[#6B655B]">
                      Hop {(t as any).hop_count ?? (t as any).hop ?? 1}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/app/transaction-check?caseId=${encodeURIComponent(caseData.case_id)}&txId=${encodeURIComponent(t.transaction_id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#1A1714] hover:bg-[#2C2723] text-white font-mono font-semibold text-[11px] transition-colors shadow-xs"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#EA8500]" />
                        <span>Score &amp; Explain</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredTransactions.length === 0 && (
            <div className="py-12 text-center space-y-2">
              <Search className="w-6 h-6 text-[#8C857B] mx-auto" />
              <p className="text-xs text-[#6B655B]">No transactions match your search filter.</p>
              <button
                onClick={() => {
                  setTxSearch('');
                  setTxRailFilter('all');
                }}
                className="text-xs text-[#EA8500] font-semibold hover:underline"
              >
                Clear Filters
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* TAB 4: ACCOUNTS & EVIDENCE */}
      {activeTab === 'accounts' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-2xl border border-[#EAE3D6] shadow-xs overflow-hidden space-y-4"
        >
          {/* Accounts Header Toolbar */}
          <div className="p-4 bg-[#FAF7F2] border-b border-[#EAE3D6] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8C857B]" />
                <input
                  type="text"
                  placeholder="Filter by account ID or role..."
                  value={accSearch}
                  onChange={(e) => setAccSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-white border border-[#EAE3D6] text-xs focus:outline-none focus:border-[#EA8500] font-mono text-[#1A1714]"
                />
              </div>

              <div className="flex items-center bg-white p-1 rounded-xl border border-[#EAE3D6] text-xs">
                {(['all', 'under_review', 'cleared', 'not_reviewed'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setAccStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer capitalize ${
                      accStatusFilter === st
                        ? 'bg-[#1A1714] text-white shadow-xs'
                        : 'text-[#6B655B] hover:text-[#1A1714]'
                    }`}
                  >
                    {st.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            <span className="text-xs font-mono text-[#6B655B]">
              Showing {filteredAccounts.length} of {connectedAccountsList.length} connected accounts
            </span>
          </div>

          {/* Accounts Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F2] text-[#6B655B] font-mono text-[11px] uppercase border-b border-[#EAE3D6]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Account ID</th>
                  <th className="py-3 px-4 font-semibold">Role in Case</th>
                  <th className="py-3 px-4 font-semibold">Observed In / Out</th>
                  <th className="py-3 px-4 font-semibold">Unforwarded Exposure</th>
                  <th className="py-3 px-4 font-semibold">Evidence Sufficiency</th>
                  <th className="py-3 px-4 font-semibold">Review State</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE3D6]">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-[#FAF7F2] transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#1A1714]">
                      <Link
                        to={`/accounts/${encodeURIComponent(acc.id)}`}
                        className="hover:text-[#EA8500] hover:underline"
                      >
                        {acc.id}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 font-mono capitalize text-[#6B655B]">
                      {acc.role.replace(/_/g, ' ')} (Hop {acc.hop})
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[#1A1714] tabular-nums">
                      ₹{acc.observedIn.toLocaleString()} / ₹{acc.observedOut.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-[#EA8500] tabular-nums">
                      ₹{acc.attributedUnforwarded.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#6B655B]">
                      {acc.evidenceSufficiency.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant="review" value={acc.reviewState} />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/accounts/${encodeURIComponent(acc.id)}`}
                          className="px-2.5 py-1 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#1A1714] text-[11px] font-semibold transition-colors"
                        >
                          Account 360°
                        </Link>
                        <button
                          onClick={() => switchTab('review', acc.id)}
                          className="px-2.5 py-1 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-[11px] font-semibold transition-colors cursor-pointer shadow-xs"
                        >
                          Adjudicate →
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* TAB 5: REVIEW & AUDIT */}
      {activeTab === 'review' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Account Selector Pill Strip */}
          <div className="bg-white rounded-2xl border border-[#EAE3D6] p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#1A1714]">
                Select Downstream Account to Adjudicate
              </span>
              <span className="text-[11px] text-[#6B655B]">
                Active Target: <strong className="text-[#EA8500] font-mono">{selectedReviewAccountId}</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {connectedAccountsList
                .filter((a) => !a.isVictim)
                .map((a) => {
                  const isSelected = selectedReviewAccountId === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setSelectedReviewAccountId(a.id)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-[#1A1714] text-white border-[#1A1714] shadow-xs'
                          : 'bg-[#FAF7F2] text-[#1A1714] border-[#EAE3D6] hover:border-[#EA8500]'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-[#EA8500]' : 'bg-[#8C857B]'}`} />
                      <span>{a.id}</span>
                      <span className="text-[10px] opacity-70">₹{a.attributedUnforwarded.toLocaleString()}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Adjudication Panel & Audit Provenance Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 Cols: Account Protection & Review Form */}
            <div className="lg:col-span-7 space-y-4">
              <AccountProtectionPanel
                caseId={caseData.case_id}
                accountId={selectedReviewAccountId}
                onSelectAccount={(aid) => setSelectedReviewAccountId(aid)}
                onReviewUpdated={() => {
                  setFeedbackToast({
                    message: `Human review decision recorded for ${selectedReviewAccountId} and saved to audit trail.`,
                    type: 'success',
                  });
                  fetchCaseDetails();
                }}
              />
            </div>

            {/* Right 5 Cols: Immutable Audit Provenance */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-[#EAE3D6] p-5 shadow-xs space-y-4 sticky top-6">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#FAF7F2]">
                <div>
                  <h3 className="text-sm font-bold text-[#1A1714]">Immutable Audit Provenance</h3>
                  <span className="text-[11px] text-[#6B655B]">Permanent log of all investigator findings</span>
                </div>

                {/* Audit Filters */}
                <div className="flex items-center bg-[#FAF7F2] p-1 rounded-xl border border-[#EAE3D6] text-xs">
                  {(['all', 'reviews', 'trace'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setAuditFilter(filter)}
                      className={`px-2 py-0.5 rounded-lg font-mono text-[10px] font-semibold transition-colors cursor-pointer uppercase ${
                        auditFilter === filter
                          ? 'bg-[#1A1714] text-white shadow-xs'
                          : 'text-[#6B655B] hover:text-[#1A1714]'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chronological Audit Timeline */}
              <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
                {filteredAudits.map((event, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5 text-xs font-mono"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#EA8500] uppercase text-[11px]">
                        {event.action}
                      </span>
                      <span className="text-[10px] text-[#8C857B]">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-[#6B655B] text-[11px]">
                      Actor: <strong className="text-[#1A1714]">{event.performed_by}</strong> · Target: <code className="bg-white px-1 py-0.5 rounded border border-[#EAE3D6] text-[#1A1714]">{event.entity_id}</code>
                    </div>

                    {event.details && (
                      <pre className="mt-1 p-2 rounded-lg bg-white border border-[#EAE3D6] text-[10px] text-[#475569] overflow-x-auto leading-tight">
                        {JSON.stringify(event.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
