import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Shield,
  ArrowLeft,
  Calendar,
  CreditCard,
  User,
  Activity,
  Layers,
  GitFork,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  TrendingDown,
  TrendingUp,
  Download,
  Filter,
  RefreshCw,
  Clock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Info,
  UserCheck,
  Search,
  Save,
  Check,
  ArrowRight,
  FileText,
  Scale,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldAlert,
  Play,
  RotateCcw,
  Copy,
  Wallet,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { v2Api, ApiError } from '../../services/v2Api';
import {
  V2AccountAssessmentResponse,
  V2AccountLiveAnalysisResponse,
  V2AccountMLAssessmentResponse,
  V2AccountProfileResponse,
  V2AccountTransactionsResponse,
  V2TraceGraphResponse,
  V2TransactionItem,
} from '../../types/v2';
import { V2Header } from '../../components/v2/V2Header';
import { V2Footer } from '../../components/v2/V2Footer';
import { V2CytoscapeGraph } from '../../components/v2/V2CytoscapeGraph';
import { V2TreeShapBreakdown } from '../../components/v2/V2TreeShapBreakdown';
import { V2RiskComparisonMeters } from '../../components/v2/V2RiskComparisonMeters';
import { V2TransactionHistogram } from '../../components/v2/V2TransactionHistogram';
import { V2ActivityTimeline } from '../../components/v2/V2ActivityTimeline';
import { V2MoneyFlowComparison } from '../../components/v2/V2MoneyFlowComparison';
import { V2NextStepsRecommendation } from '../../components/v2/V2NextStepsRecommendation';
import { V2BankingHeroHeader } from '../../components/v2/V2BankingHeroHeader';
import { V2BankingDashboardRow } from '../../components/v2/V2BankingDashboardRow';

interface AdjudicationEntry {
  status: string;
  notes: string;
  timestamp: string;
  investigatorId: string;
}

export const V2AccountDetailPage: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const adjudicationRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Core Ledger Facts
  const [profile, setProfile] = useState<V2AccountProfileResponse | null>(null);
  const [transactions, setTransactions] = useState<V2AccountTransactionsResponse | null>(null);
  const [traceData, setTraceData] = useState<V2TraceGraphResponse | null>(null);

  // Live Analysis State (Strictly derived from fresh live analysis on demand)
  const [liveAnalysis, setLiveAnalysis] = useState<V2AccountLiveAnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  // Tab State
  const initialTab = (searchParams.get('tab') as 'assessment' | 'trace' | 'transactions' | 'review') || 'assessment';
  const [activeTab, setActiveTabState] = useState<'assessment' | 'trace' | 'transactions' | 'review'>(initialTab);

  const setActiveTab = (tab: 'assessment' | 'trace' | 'transactions' | 'review') => {
    setActiveTabState(tab);
    setSearchParams({ tab });
  };

  useEffect(() => {
    const tabParam = searchParams.get('tab') as 'assessment' | 'trace' | 'transactions' | 'review';
    if (tabParam && ['assessment', 'trace', 'transactions', 'review'].includes(tabParam)) {
      setActiveTabState(tabParam);
    }
  }, [searchParams]);

  // Transaction Filters & Interactive Chart Linkage
  const [txnDirection, setTxnDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [txnSearch, setTxnSearch] = useState<string>('');
  const [txnPage, setTxnPage] = useState<number>(0);
  const pageSize = 20;

  // Linked Chart Filters
  const [selectedHistogramBin, setSelectedHistogramBin] = useState<{ min: number; max: number; label: string } | null>(null);
  const [selectedTimelineDate, setSelectedTimelineDate] = useState<string | null>(null);
  const [selectedTxnForDetail, setSelectedTxnForDetail] = useState<V2TransactionItem | null>(null);

  // Trace Controls
  const [traceDepth, setTraceDepth] = useState<number>(3);
  const [traceDirection, setTraceDirection] = useState<'outgoing' | 'incoming'>('outgoing');

  // Loading & Error States
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
  const [loadingTrace, setLoadingTrace] = useState<boolean>(false);
  const [loadingTxns, setLoadingTxns] = useState<boolean>(false);
  const [errorNotFound, setErrorNotFound] = useState<boolean>(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  // Human Adjudication State
  const [adjudicationStatus, setAdjudicationStatus] = useState<string>('pending_review');
  const [adjudicationNotes, setAdjudicationNotes] = useState<string>('');
  const [adjudicationSaved, setAdjudicationSaved] = useState<boolean>(false);
  const [adjudicationHistory, setAdjudicationHistory] = useState<AdjudicationEntry[]>([]);

  // 1. Initial Load: Save to recents & load adjudication history from localStorage
  useEffect(() => {
    if (!accountId) return;

    try {
      const stored = localStorage.getItem('fs_v2_recent_accounts');
      const recents: string[] = stored ? JSON.parse(stored) : [];
      const updated = [accountId, ...recents.filter((id) => id !== accountId)].slice(0, 10);
      localStorage.setItem('fs_v2_recent_accounts', JSON.stringify(updated));
    } catch {
      // Ignore localStorage errors
    }

    try {
      const adjKey = `fs_v2_adjudication_${accountId}`;
      const savedAdj = localStorage.getItem(adjKey);
      if (savedAdj) {
        const parsed = JSON.parse(savedAdj);
        setAdjudicationStatus(parsed.status || 'pending_review');
        setAdjudicationNotes(parsed.notes || '');
        if (Array.isArray(parsed.history)) {
          setAdjudicationHistory(parsed.history);
        } else if (parsed.timestamp) {
          setAdjudicationHistory([
            {
              status: parsed.status,
              notes: parsed.notes,
              timestamp: parsed.timestamp,
              investigatorId: parsed.investigatorId || 'INV-COMPLIANCE-01',
            },
          ]);
        }
      } else {
        setAdjudicationStatus('pending_review');
        setAdjudicationNotes('');
        setAdjudicationHistory([]);
      }
    } catch {
      // Ignore
    }
  }, [accountId]);

  // 2. Load Core Non-Predictive Account Facts & Ledger Movements on Mount
  useEffect(() => {
    if (!accountId) return;

    setErrorNotFound(false);
    setErrorGeneral(null);
    setLoadingProfile(true);
    setLiveAnalysis(null); // Crucial: Reset predictive results for new account until explicit run!
    setSelectedHistogramBin(null);
    setSelectedTimelineDate(null);
    setSelectedTxnForDetail(null);

    Promise.all([
      v2Api.getAccount(accountId),
      v2Api.getTransactions(accountId, { limit: 200, order: 'desc' }).catch(() => null),
    ])
      .then(([profData, txnsData]) => {
        setProfile(profData);
        setTransactions(txnsData);
        setLoadingProfile(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setErrorNotFound(true);
        } else {
          setErrorGeneral(err.message || 'Failed to load account ledger facts');
        }
        setLoadingProfile(false);
      });
  }, [accountId]);

  // 3. Load Trace Graph when on trace tab
  useEffect(() => {
    if (!accountId || errorNotFound || activeTab !== 'trace') return;
    setLoadingTrace(true);

    v2Api
      .getTrace({
        account_id: accountId,
        direction: traceDirection,
        max_depth: traceDepth,
        max_nodes: 50,
      })
      .then((data) => {
        setTraceData(data);
        setLoadingTrace(false);
      })
      .catch(() => setLoadingTrace(false));
  }, [accountId, traceDirection, traceDepth, activeTab, errorNotFound]);

  // 4. Coordinated GSAP page entrance
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !pageContainerRef.current || loadingProfile) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.gsap-fade-in',
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power2.out' }
      );
    }, pageContainerRef);

    return () => ctx.revert();
  }, [loadingProfile, liveAnalysis]);

  // 5. Trigger Fresh Live Analysis
  const handleRunLiveAnalysis = async () => {
    if (!accountId || isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const result = await v2Api.runLiveAnalysis(accountId);
      setLiveAnalysis(result);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 503) {
        setAnalysisError('Model Unavailable: XGBoost model binary is not loaded on server. Run training pipeline first.');
      } else if (err instanceof ApiError && err.status === 404) {
        setAnalysisError(`Account '${accountId}' not found in core database.`);
      } else {
        setAnalysisError(err?.message || 'Failed to complete live account analysis.');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCopyId = () => {
    if (!accountId) return;
    navigator.clipboard.writeText(accountId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSaveAdjudication = () => {
    if (!accountId) return;
    try {
      const adjKey = `fs_v2_adjudication_${accountId}`;
      const newEntry: AdjudicationEntry = {
        status: adjudicationStatus,
        notes: adjudicationNotes,
        timestamp: new Date().toISOString(),
        investigatorId: 'INV-COMPLIANCE-01',
      };
      const updatedHistory = [newEntry, ...adjudicationHistory];
      localStorage.setItem(
        adjKey,
        JSON.stringify({
          status: adjudicationStatus,
          notes: adjudicationNotes,
          timestamp: newEntry.timestamp,
          investigatorId: newEntry.investigatorId,
          history: updatedHistory,
        })
      );
      setAdjudicationHistory(updatedHistory);
      setAdjudicationSaved(true);
      setTimeout(() => setAdjudicationSaved(false), 3000);
    } catch {
      // Ignore
    }
  };

  // 6. Interactive Linked Filtering of Transactions Table
  const allTxns = transactions?.transactions || [];

  const filteredTransactions = useMemo(() => {
    return allTxns.filter((txn) => {
      // Flow direction filter
      if (txnDirection !== 'all' && txn.direction !== txnDirection) {
        return false;
      }
      // Histogram bin filter
      if (selectedHistogramBin) {
        const amt = Number(txn.amount);
        if (amt < selectedHistogramBin.min) return false;
        if (selectedHistogramBin.max !== Infinity && amt >= selectedHistogramBin.max) return false;
      }
      // Timeline date filter
      if (selectedTimelineDate) {
        const dateStr = txn.timestamp.split('T')[0];
        if (dateStr !== selectedTimelineDate) return false;
      }
      // Text search filter
      if (txnSearch.trim()) {
        const q = txnSearch.toLowerCase();
        const matchesId = txn.transaction_id.toLowerCase().includes(q);
        const matchesCp = txn.counterparty_account_id.toLowerCase().includes(q);
        const matchesChannel = txn.channel.toLowerCase().includes(q);
        if (!matchesId && !matchesCp && !matchesChannel) return false;
      }
      return true;
    });
  }, [allTxns, txnDirection, selectedHistogramBin, selectedTimelineDate, txnSearch]);

  const totalPages = Math.ceil(filteredTransactions.length / pageSize);
  const paginatedTransactions = filteredTransactions.slice(
    txnPage * pageSize,
    (txnPage + 1) * pageSize
  );

  const clearAllFilters = () => {
    setSelectedHistogramBin(null);
    setSelectedTimelineDate(null);
    setTxnDirection('all');
    setTxnSearch('');
    setTxnPage(0);
  };

  const hasActiveFilters = Boolean(selectedHistogramBin || selectedTimelineDate || txnDirection !== 'all' || txnSearch.trim());

  // 404 Not Found State
  if (errorNotFound) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1714] font-sans">
        <V2Header />
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-16 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] shadow-sm">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-[#1A1714] font-display">
              Account Not Found in Core Ledger
            </h2>
            <p className="text-sm text-[#6B655B] max-w-md mx-auto">
              The identifier <code className="bg-[#FAF7F2] border border-[#EAE3D6] px-2 py-0.5 rounded font-mono font-bold text-[#1A1714]">{accountId}</code> was not found in the V2 ledger database.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/v2"
              className="px-5 py-2.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-bold transition-all shadow-xs"
            >
              Return to Search Workspace
            </Link>
          </div>
        </main>
        <V2Footer />
      </div>
    );
  }

  // Loading Profile State
  if (loadingProfile) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1714] font-sans">
        <V2Header />
        <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-16 flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] animate-spin">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold text-[#1A1714]">Loading Account Ledger Profile</h3>
            <p className="text-xs text-[#6B655B] font-mono">Querying account balances and transaction ledger for {accountId}...</p>
          </div>
        </div>
        <V2Footer />
      </div>
    );
  }

  return (
    <div ref={pageContainerRef} className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1714] font-sans selection:bg-[#EA8500]/20 selection:text-[#EA8500]">
      <V2Header />

      {/* Main Workspace Container: 1280-1360px desktop width */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Breadcrumb & Navigation Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#6B655B]">
          <div className="flex items-center gap-2">
            <Link
              to="/v2"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#EAE3D6] text-[#6B655B] hover:text-[#1A1714] hover:border-[#DDD4C4] transition-all font-medium shadow-2xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Search</span>
            </Link>
            <span className="text-[#8C857B]">/</span>
            <span className="font-mono font-medium text-[#1A1714]">{accountId}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#8C857B]">Workspace Mode:</span>
            <span className="px-2 py-0.5 rounded-md bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-mono font-semibold text-[#1A1714]">
              V2 Financial Forensics
            </span>
          </div>
        </div>

        {/* Reference Dashboard: Header Navigation and Hero Row A */}
        <V2BankingHeroHeader
          profile={profile}
          liveAnalysis={liveAnalysis}
          isAnalyzing={isAnalyzing}
          onRunLiveAnalysis={handleRunLiveAnalysis}
          onNavigateTab={setActiveTab}
          activeTab={activeTab}
          transactionCount={(profile?.metrics.total_incoming_txns || 0) + (profile?.metrics.total_outgoing_txns || 0)}
        />

        {/* Evidence Hierarchy Guiding Notice */}
        <div className="bg-white rounded-2xl border border-[#EAE3D6] p-4 text-xs text-[#6B655B] flex flex-col md:flex-row md:items-center justify-between gap-3 gsap-fade-in shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#EA8500]" />
            <strong className="text-[#1A1714] font-bold">Forensic Evidence Hierarchy & Separation of Concepts:</strong>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <span className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714]">
              1. Observed Ledger Facts
            </span>
            <span className="text-[#8C857B]">→</span>
            <span className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714]">
              2. Rule-Based Signals
            </span>
            <span className="text-[#8C857B]">→</span>
            <span className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714]">
              3. Statistical ML Probability
            </span>
            <span className="text-[#8C857B]">→</span>
            <span className="px-2.5 py-1 rounded-lg bg-[#FFF4E6] border border-[#FCD5B5] text-[#EA8500] font-bold">
              4. Human Review & Adjudication
            </span>
          </div>
        </div>

        <div ref={tabsRef} className="hidden" />

        {/* ========================================================================= */}
        {/* TAB 1: ANALYSIS & RISK INTELLIGENCE                                       */}
        {/* ========================================================================= */}
        {activeTab === 'assessment' && (
          <div className="space-y-6 gsap-fade-in">

            {/* Error Banner if live analysis failed */}
            {analysisError && (
              <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-2xl p-4 text-xs text-[#DC2626] flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <strong className="font-bold">Live Analysis Execution Error: </strong>
                  <span>{analysisError}</span>
                </div>
              </div>
            )}

            {/* Case A: Before Fresh Live Analysis is Run */}
            {!liveAnalysis && !isAnalyzing && (
              <div className="space-y-6">
                <div className="bg-white rounded-3xl border border-[#EAE3D6] p-8 sm:p-12 text-center shadow-xs space-y-6">
                  <div className="w-20 h-20 rounded-3xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] mx-auto shadow-sm">
                    <Sparkles className="w-10 h-10" />
                  </div>

                  <div className="max-w-2xl mx-auto space-y-2">
                    <h3 className="text-2xl font-extrabold text-[#1A1714] font-display">
                      Account Analysis Pending for Current Session
                    </h3>
                    <p className="text-sm text-[#6B655B] leading-relaxed">
                      Analyse this account's recorded activity, check for unusual patterns, estimate risk, and explain what an investigator should review.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button
                      onClick={handleRunLiveAnalysis}
                      className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl bg-[#EA8500] hover:bg-[#D27400] text-white font-bold text-sm transition-all shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Run Live Analysis</span>
                    </button>
                  </div>

                  {/* Honest initial state note */}
                  <div className="max-w-xl mx-auto pt-4 border-t border-[#FAF7F2] text-xs text-[#8C857B] leading-relaxed">
                    <p>
                      <strong className="text-[#6B655B]">Honest Initial State Guarantee:</strong> No precomputed, stale, or synthetic demo scores are displayed. Clicking "Run Live Analysis" calculates fresh feature vectors from the latest ledger transactions and runs the loaded XGBoost model with TreeSHAP.
                    </p>
                  </div>
                </div>

                {/* Reference Dashboard Row 2: 3 Side-by-Side Cards (Pending Baseline) */}
                <V2BankingDashboardRow
                  liveAnalysis={null}
                  transactions={allTxns}
                  onSelectTransaction={(txn) => setSelectedTxnForDetail(txn)}
                  onViewAllTransactions={() => setActiveTab('transactions')}
                />
              </div>
            )}

            {/* Case B: Analyzing in Progress */}
            {isAnalyzing && (
              <div className="bg-white rounded-3xl border border-[#EAE3D6] p-12 text-center shadow-xs space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] mx-auto animate-spin">
                  <RefreshCw className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-[#1A1714]">Analyzing Account Ledger</h3>
                <p className="text-xs text-[#6B655B] max-w-md mx-auto leading-relaxed">
                  Extracting 26 behavioral features, calculating rule signals, running XGBoost inference and calculating native TreeSHAP local attributions...
                </p>
              </div>
            )}

            {/* Case C: Analysis Completed - Full Interactive Report */}
            {liveAnalysis && (
              <div className="space-y-6">
                
                {/* 1. "What did the analysis find?" Prominent Summary Card */}
                <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 sm:p-8 shadow-xs space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#FAF7F2] pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl sm:text-2xl font-black text-[#1A1714] font-display">
                          What Did the Analysis Find?
                        </h2>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] uppercase tracking-wider">
                          Analysis Complete
                        </span>
                      </div>
                      <p className="text-xs text-[#6B655B] mt-1">
                        Freshly computed evaluation of {liveAnalysis.ledger_snapshot.transactions_examined} ledger records completed at {new Date(liveAnalysis.analyzed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#6B655B] self-start sm:self-center">
                      <span className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6]">
                        Run: <strong>{liveAnalysis.analysis_id}</strong>
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6]">
                        Model: <strong>{liveAnalysis.model_version}</strong>
                      </span>
                    </div>
                  </div>

                  {/* High Level Key Findings Strip */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6] space-y-1">
                      <span className="text-[11px] font-bold text-[#8C857B] uppercase block">ML Statistical Score</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-extrabold text-[#1A1714] font-mono">
                          {liveAnalysis.ml_assessment.risk_score.toFixed(1)}
                        </span>
                        <span className="text-xs text-[#6B655B]">/ 100</span>
                        <span className="text-xs font-bold uppercase text-[#EA8500]">({liveAnalysis.ml_assessment.risk_level})</span>
                      </div>
                      <p className="text-[#6B655B] text-[11px]">
                        Predicted class: <strong className="uppercase text-[#1A1714]">{liveAnalysis.ml_assessment.predicted_class}</strong>
                      </p>
                    </div>

                    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6] space-y-1">
                      <span className="text-[11px] font-bold text-[#8C857B] uppercase block">Rule Behavioral Score</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-extrabold text-[#1A1714] font-mono">
                          {liveAnalysis.rule_assessment.risk_score.toFixed(1)}
                        </span>
                        <span className="text-xs text-[#6B655B]">/ 100</span>
                        <span className="text-xs font-bold uppercase text-[#6B655B]">({liveAnalysis.rule_assessment.risk_level})</span>
                      </div>
                      <p className="text-[#6B655B] text-[11px]">
                        Uncertainty rating: <strong className="uppercase text-[#1A1714]">{liveAnalysis.rule_assessment.uncertainty_rating}</strong>
                      </p>
                    </div>

                    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6] space-y-1">
                      <span className="text-[11px] font-bold text-[#8C857B] uppercase block">Human Review Status</span>
                      <div className="flex items-center gap-2 pt-1">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border uppercase tracking-wider ${
                          liveAnalysis.human_review_recommended
                            ? 'bg-[#FFF4E6] text-[#EA8500] border-[#FCD5B5]'
                            : 'bg-[#EAF7EE] text-[#10B981] border-[#BBF7D0]'
                        }`}>
                          {liveAnalysis.human_review_recommended ? 'Review Recommended' : 'Routine Baseline'}
                        </span>
                      </div>
                      <p className="text-[#6B655B] text-[11px] pt-1">
                        {liveAnalysis.recommended_actions.length} actionable investigation steps identified.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Reference Dashboard Row 2: 3 Side-by-Side Cards (Live Evaluated) */}
                <V2BankingDashboardRow
                  liveAnalysis={liveAnalysis}
                  transactions={allTxns}
                  onSelectTransaction={(txn) => setSelectedTxnForDetail(txn)}
                  onViewAllTransactions={() => setActiveTab('transactions')}
                />

                {/* 3. Side-by-Side Overall Risk Comparison Meters */}
                <V2RiskComparisonMeters
                  mlAssessment={liveAnalysis.ml_assessment}
                  ruleAssessment={liveAnalysis.rule_assessment}
                  divergence={liveAnalysis.divergence}
                />

                {/* 4. Balanced 2-Column Responsive Grid for Interactive Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Chart A: Transaction Amount Histogram with Click-to-Filter */}
                  <V2TransactionHistogram
                    transactions={allTxns}
                    selectedBin={selectedHistogramBin}
                    onSelectBin={(bin) => {
                      setSelectedHistogramBin(bin);
                      if (bin) {
                        setTxnPage(0);
                      }
                    }}
                  />

                  {/* Chart B: Activity Timeline with Click-to-Filter */}
                  <V2ActivityTimeline
                    transactions={allTxns}
                    selectedDate={selectedTimelineDate}
                    onSelectDate={(date) => {
                      setSelectedTimelineDate(date);
                      setTxnPage(0);
                    }}
                  />
                </div>

                {/* 5. Balanced 2-Column Responsive Grid: TreeSHAP (Left) + Next Steps (Right) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Chart D: TreeSHAP Horizontal Waterfall Contribution Chart */}
                  <V2TreeShapBreakdown
                    contributions={liveAnalysis.ml_assessment.top_contributions || []}
                  />

                  {/* Recommendations Section */}
                  <V2NextStepsRecommendation
                    recommendedActions={liveAnalysis.recommended_actions}
                    humanReviewRecommended={liveAnalysis.human_review_recommended}
                    disclaimer={liveAnalysis.disclaimer}
                    onNavigateToTab={(tab) => {
                      setActiveTab(tab);
                      if (tab === 'review') {
                        adjudicationRef.current?.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                  />
                </div>

                {/* 6. Money Received vs Money Sent Comparative Reconciler */}
                <V2MoneyFlowComparison
                  totalReceived={liveAnalysis.ledger_snapshot.total_received}
                  totalSent={liveAnalysis.ledger_snapshot.total_sent}
                  currentBalance={liveAnalysis.ledger_snapshot.current_balance}
                  initialBalance={profile?.initial_balance || 0}
                  totalTransactions={liveAnalysis.ledger_snapshot.transactions_examined}
                  uniqueCounterparties={profile?.metrics.unique_counterparties || 0}
                  flowThroughRatio={liveAnalysis.rule_assessment.signals.flow_through_ratio}
                />
              </div>
            )}

            {/* Exploratory non-predictive visualizations available even before analysis */}
            {!liveAnalysis && !isAnalyzing && allTxns.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-2">
                  <h4 className="text-sm font-bold text-[#1A1714]">Exploratory Non-Predictive Ledger Visualizations</h4>
                  <span className="text-xs text-[#6B655B]">Derived strictly from observable ledger records</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <V2TransactionHistogram
                    transactions={allTxns}
                    selectedBin={selectedHistogramBin}
                    onSelectBin={(bin) => setSelectedHistogramBin(bin)}
                  />
                  <V2ActivityTimeline
                    transactions={allTxns}
                    selectedDate={selectedTimelineDate}
                    onSelectDate={(date) => setSelectedTimelineDate(date)}
                  />
                </div>
              </div>
            )}

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: FOLLOW THE MONEY (GRAPH TRACE)                                     */}
        {/* ========================================================================= */}
        {activeTab === 'trace' && (
          <div className="space-y-6 gsap-fade-in">
            <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#FAF7F2] pb-4">
                <div>
                  <h3 className="text-base font-bold text-[#1A1714] font-display flex items-center gap-2">
                    <GitFork className="w-5 h-5 text-[#EA8500]" />
                    Multi-Hop Forensic Fund Tracer
                  </h3>
                  <p className="text-xs text-[#6B655B] mt-0.5">
                    Traverse connected accounts and follow money flows across multi-hop counterparty edges.
                  </p>
                </div>

                {/* Depth & Direction Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-[#6B655B]">
                    <span>Flow:</span>
                    <select
                      value={traceDirection}
                      onChange={(e) => setTraceDirection(e.target.value as any)}
                      className="px-2.5 py-1 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-bold text-[#1A1714]"
                    >
                      <option value="outgoing">Outbound (Follow Dispersal)</option>
                      <option value="incoming">Inbound (Follow Origin)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-[#6B655B]">
                    <span>Hops:</span>
                    <select
                      value={traceDepth}
                      onChange={(e) => setTraceDepth(Number(e.target.value))}
                      className="px-2.5 py-1 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-bold text-[#1A1714]"
                    >
                      <option value={1}>1 Hop</option>
                      <option value={2}>2 Hops</option>
                      <option value={3}>3 Hops</option>
                      <option value={4}>4 Hops</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Cytoscape Graph Container */}
              {loadingTrace ? (
                <div className="h-96 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] flex flex-col items-center justify-center space-y-2">
                  <RefreshCw className="w-6 h-6 text-[#EA8500] animate-spin" />
                  <span className="text-xs text-[#6B655B]">Traversing multi-hop transaction graph...</span>
                </div>
              ) : traceData ? (
                <V2CytoscapeGraph
                  traceData={traceData}
                  onSelectNode={(node) => {
                    if (node && node.account_id && node.account_id !== accountId) {
                      navigate(`/v2/accounts/${encodeURIComponent(node.account_id)}`);
                    }
                  }}
                />
              ) : (
                <div className="h-64 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-xs text-[#6B655B]">
                  No connected counterparty graph available for this account.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: TRANSACTION LEDGER WITH LINKED FILTERING                           */}
        {/* ========================================================================= */}
        {activeTab === 'transactions' && (
          <div className="space-y-6 gsap-fade-in">
            <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 shadow-xs space-y-4">
              {/* Header and Filter Controls */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#FAF7F2] pb-4">
                <div>
                  <h3 className="text-base font-bold text-[#1A1714] font-display flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[#EA8500]" />
                    Account Transaction Ledger
                  </h3>
                  <p className="text-xs text-[#6B655B] mt-0.5">
                    Showing {filteredTransactions.length} of {allTxns.length} recorded movements. Synchronized with active chart selections.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Direction Tabs */}
                  <div className="inline-flex rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] p-0.5 text-xs font-medium">
                    <button
                      onClick={() => setTxnDirection('all')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        txnDirection === 'all' ? 'bg-white font-bold text-[#1A1714] shadow-2xs' : 'text-[#6B655B]'
                      }`}
                    >
                      All ({allTxns.length})
                    </button>
                    <button
                      onClick={() => setTxnDirection('inbound')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        txnDirection === 'inbound' ? 'bg-white font-bold text-[#10B981] shadow-2xs' : 'text-[#6B655B]'
                      }`}
                    >
                      Credits
                    </button>
                    <button
                      onClick={() => setTxnDirection('outbound')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        txnDirection === 'outbound' ? 'bg-white font-bold text-[#EA8500] shadow-2xs' : 'text-[#6B655B]'
                      }`}
                    >
                      Debits
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8C857B]" />
                    <input
                      type="text"
                      placeholder="Search txn ID, counterparty..."
                      value={txnSearch}
                      onChange={(e) => {
                        setTxnSearch(e.target.value);
                        setTxnPage(0);
                      }}
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs text-[#1A1714] placeholder-[#8C857B] focus:outline-none focus:border-[#EA8500] w-52"
                    />
                  </div>
                </div>
              </div>

              {/* Active Linked Filters Bar */}
              {hasActiveFilters && (
                <div className="bg-[#FAF7F2] rounded-xl p-3 border border-[#EAE3D6] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[#6B655B] font-medium flex items-center gap-1">
                      <Filter className="w-3.5 h-3.5 text-[#EA8500]" /> Active Filters:
                    </span>

                    {selectedHistogramBin && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-[#FCD5B5] text-[#EA8500] font-mono text-[11px]">
                        <span>Amount: {selectedHistogramBin.label}</span>
                        <button onClick={() => setSelectedHistogramBin(null)} className="hover:text-[#1A1714]">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}

                    {selectedTimelineDate && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-[#BFDBFE] text-[#2563EB] font-mono text-[11px]">
                        <span>Date: {selectedTimelineDate}</span>
                        <button onClick={() => setSelectedTimelineDate(null)} className="hover:text-[#1A1714]">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}

                    {txnDirection !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-[#EAE3D6] text-[#1A1714] font-mono text-[11px]">
                        <span>Direction: {txnDirection}</span>
                        <button onClick={() => setTxnDirection('all')} className="hover:text-[#1A1714]">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                  </div>

                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-[#EA8500] hover:text-[#D27400] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset All Filters</span>
                  </button>
                </div>
              )}

              {/* Transactions Table */}
              <div className="overflow-x-auto rounded-2xl border border-[#EAE3D6]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF7F2] text-[#6B655B] font-medium border-b border-[#EAE3D6]">
                    <tr>
                      <th className="py-3 px-4">Transaction ID</th>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Direction</th>
                      <th className="py-3 px-4">Counterparty</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Balance After</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE3D6]">
                    {paginatedTransactions.length > 0 ? (
                      paginatedTransactions.map((t) => {
                        const isInbound = t.direction === 'inbound';
                        const isSelected = selectedTxnForDetail?.transaction_id === t.transaction_id;
                        return (
                          <tr
                            key={t.transaction_id}
                            className={`transition-colors hover:bg-[#FAF7F2]/60 ${isSelected ? 'bg-[#FFF8EE]' : ''}`}
                          >
                            <td className="py-3 px-4 font-mono font-bold text-[#1A1714]">
                              {t.transaction_id}
                            </td>
                            <td className="py-3 px-4 font-mono text-[#6B655B]">
                              {new Date(t.timestamp).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wider ${
                                  isInbound
                                    ? 'bg-[#EAF7EE] text-[#10B981] border-[#BBF7D0]'
                                    : 'bg-[#FFF4E6] text-[#EA8500] border-[#FCD5B5]'
                                }`}
                              >
                                {isInbound ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                <span>{t.direction}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <Link
                                to={`/v2/accounts/${encodeURIComponent(t.counterparty_account_id)}`}
                                className="font-mono text-[#EA8500] hover:underline font-medium"
                              >
                                {t.counterparty_account_id}
                              </Link>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold">
                              <span className={isInbound ? 'text-[#10B981]' : 'text-[#1A1714]'}>
                                {isInbound ? '+' : '-'}₹{t.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[#6B655B]">
                              {t.channel}
                            </td>
                            <td className="py-3 px-4 font-mono text-[#6B655B]">
                              ₹{(isInbound ? t.dest_balance_after : t.origin_balance_after).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setSelectedTxnForDetail(isSelected ? null : t)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] border border-[#EAE3D6]"
                              >
                                {isSelected ? 'Hide' : 'Details'}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-xs text-[#6B655B] italic">
                          No transactions match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-[#6B655B] pt-2">
                  <span>
                    Page {txnPage + 1} of {totalPages} ({filteredTransactions.length} items)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setTxnPage((p) => Math.max(0, p - 1))}
                      disabled={txnPage === 0}
                      className="px-3 py-1.5 rounded-xl border border-[#EAE3D6] bg-white text-[#1A1714] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FAF7F2]"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setTxnPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={txnPage >= totalPages - 1}
                      className="px-3 py-1.5 rounded-xl border border-[#EAE3D6] bg-white text-[#1A1714] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FAF7F2]"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Transaction Detail Panel if selected */}
              {selectedTxnForDetail && (
                <div className="bg-[#FAF7F2] rounded-2xl border border-[#EAE3D6] p-4 text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#1A1714]">Transaction Details: {selectedTxnForDetail.transaction_id}</span>
                      <span className="font-mono text-[#6B655B]">({selectedTxnForDetail.status})</span>
                    </div>
                    <button onClick={() => setSelectedTxnForDetail(null)} className="text-[#6B655B] hover:text-[#1A1714]">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px]">
                    <div>
                      <span className="text-[#8C857B] block uppercase text-[10px]">Origin Account</span>
                      <Link to={`/v2/accounts/${selectedTxnForDetail.origin_account_id}`} className="text-[#EA8500] hover:underline font-bold">
                        {selectedTxnForDetail.origin_account_id}
                      </Link>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block uppercase text-[10px]">Destination Account</span>
                      <Link to={`/v2/accounts/${selectedTxnForDetail.destination_account_id}`} className="text-[#EA8500] hover:underline font-bold">
                        {selectedTxnForDetail.destination_account_id}
                      </Link>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block uppercase text-[10px]">Origin Balance Delta</span>
                      <span className="text-[#1A1714]">
                        ₹{selectedTxnForDetail.origin_balance_before.toLocaleString()} → ₹{selectedTxnForDetail.origin_balance_after.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block uppercase text-[10px]">Destination Balance Delta</span>
                      <span className="text-[#1A1714]">
                        ₹{selectedTxnForDetail.dest_balance_before.toLocaleString()} → ₹{selectedTxnForDetail.dest_balance_after.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: COMPLIANCE & HUMAN ADJUDICATION                                   */}
        {/* ========================================================================= */}
        {activeTab === 'review' && (
          <div ref={adjudicationRef} className="space-y-6 gsap-fade-in">
            <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 sm:p-8 shadow-xs space-y-6">
              <div className="border-b border-[#FAF7F2] pb-4">
                <h3 className="text-lg font-bold text-[#1A1714] font-display flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-[#EA8500]" />
                  Human Compliance Adjudication
                </h3>
                <p className="text-xs text-[#6B655B] mt-0.5">
                  Record official human review decisions. Algorithm outputs provide decision support and require human oversight.
                </p>
              </div>

              {/* Adjudication Form */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-[#1A1714] block mb-1">
                      Adjudication Finding Status
                    </label>
                    <select
                      value={adjudicationStatus}
                      onChange={(e) => setAdjudicationStatus(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-bold text-[#1A1714] focus:outline-none focus:border-[#EA8500]"
                    >
                      <option value="pending_review">Pending Additional Review</option>
                      <option value="verified_legitimate_victim">Verified Legitimate Customer (Compromised/Victim)</option>
                      <option value="confirmed_mule_conduit">Confirmed Money Mule Conduit</option>
                      <option value="escalated_for_legal_subpoena">Escalated for Law Enforcement Subpoena</option>
                      <option value="cleared_routine">Cleared — Standard Retail Behavior</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#1A1714] block mb-1">
                      Investigator Case Notes
                    </label>
                    <textarea
                      rows={4}
                      placeholder="Document factual findings, customer contact logs, and rationale for this determination..."
                      value={adjudicationNotes}
                      onChange={(e) => setAdjudicationNotes(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs text-[#1A1714] placeholder-[#8C857B] focus:outline-none focus:border-[#EA8500]"
                    />
                  </div>

                  <button
                    onClick={handleSaveAdjudication}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-bold transition-all shadow-xs"
                  >
                    <Save className="w-4 h-4" />
                    <span>Record Finding</span>
                  </button>

                  {adjudicationSaved && (
                    <span className="text-xs text-[#10B981] font-bold inline-flex items-center gap-1 ml-3">
                      <CheckCircle2 className="w-4 h-4" /> Saved to Audit Trail
                    </span>
                  )}
                </div>

                {/* Audit Trail List */}
                <div className="bg-[#FAF7F2] rounded-2xl border border-[#EAE3D6] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-2">
                    <span className="text-xs font-bold text-[#1A1714]">Logged Adjudication Audit Trail</span>
                    <span className="text-[11px] font-mono text-[#6B655B]">{adjudicationHistory.length} records</span>
                  </div>

                  {adjudicationHistory.length > 0 ? (
                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                      {adjudicationHistory.map((item, idx) => (
                        <div key={idx} className="bg-white rounded-xl p-3 border border-[#EAE3D6] text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#EA8500] uppercase text-[10px]">
                              {item.status.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] font-mono text-[#8C857B]">
                              {new Date(item.timestamp).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <p className="text-[#1A1714] text-[11px]">"{item.notes}"</p>
                          <div className="text-[10px] text-[#8C857B] font-mono">By: {item.investigatorId}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#6B655B] italic py-4 text-center">
                      No previous human adjudications recorded for this account.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      <V2Footer />
    </div>
  );
};
