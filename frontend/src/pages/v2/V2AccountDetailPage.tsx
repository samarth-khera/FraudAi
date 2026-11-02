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
  Cpu,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { EvidenceTag } from '../../components/ui/EvidenceTag';
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
import { V2CytoscapeGraph } from '../../components/v2/V2CytoscapeGraph';
import { V2TreeShapBreakdown } from '../../components/v2/V2TreeShapBreakdown';
import { V2RiskComparisonMeters } from '../../components/v2/V2RiskComparisonMeters';
import { V2TransactionHistogram } from '../../components/v2/V2TransactionHistogram';
import { V2ActivityTimeline } from '../../components/v2/V2ActivityTimeline';
import { V2MoneyFlowComparison } from '../../components/v2/V2MoneyFlowComparison';
import { V2NextStepsRecommendation } from '../../components/v2/V2NextStepsRecommendation';
import { V2BankingHeroHeader } from '../../components/v2/V2BankingHeroHeader';
import { V2ModelDivergenceAlert } from '../../components/v2/V2ModelDivergenceAlert';
import { useModelStatus } from '../../lib/useModelStatus';
import { MODEL_SCORE_LABEL, MODEL_SCORE_MEANING, formatModelScore, modelLevelBands, thresholdPercent } from '../../lib/modelScore';


export const V2AccountDetailPage: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const adjudicationRef = useRef<HTMLDivElement>(null);
  const modelInfo = useModelStatus().status?.account_model;
  const modelThresholdLabel = thresholdPercent(modelInfo);
  const modelBands = modelLevelBands(modelInfo);
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

  }, [accountId]);

  // 2. Load Core Non-Predictive Account Facts & Ledger Movements on Mount
  useEffect(() => {
    if (!accountId) return;

    setErrorNotFound(false);
    setErrorGeneral(null);
    setLoadingProfile(true);
    // Crucial: Reset state to prevent data from leaking between different account views
    setProfile(null);
    setTransactions(null);
    setTraceData(null);
    setLiveAnalysis(null); // Reset predictive results for new account until explicit run!
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
        // Show the server's own reason (model unavailable, or another 503); never assume one.
        setAnalysisError(err.message || 'The server could not run the analysis right now.');
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
      <div className="flex flex-col">
        <div className="max-w-4xl w-full mx-auto px-4 py-16 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-iris-soft border border-iris-line flex items-center justify-center text-iris shadow-sm">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-ink font-display">
              Account not found in the ledger
            </h2>
            <p className="text-sm text-mute max-w-md mx-auto">
              The identifier <code className="bg-well border border-line px-2 py-0.5 rounded font-mono font-bold text-ink">{accountId}</code> was not found in the V2 core banking ledger.
            </p>
            <p className="text-xs text-faint max-w-md mx-auto leading-relaxed">
              Some cases keep their own account records (for example, A100 in case FS-1042). Those accounts are not in the synthetic ledger; open them from their case instead.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/cases"
              className="btn-primary"
            >
              Open investigations
            </Link>
            <Link
              to="/tools/accounts"
              className="px-5 py-2.5 rounded-xl bg-white hover:bg-well border border-line text-ink text-xs font-bold transition-all shadow-xs"
            >
              Return to Search Workspace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Loading Profile State
  if (loadingProfile) {
    return (
      <div className="flex flex-col">
        <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-16 flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-iris-soft border border-iris-line flex items-center justify-center text-iris animate-spin">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold text-ink">Loading the account</h3>
            <p className="text-xs text-mute font-mono">Querying account balances and transaction ledger for {accountId}...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={pageContainerRef} className="flex flex-col">

      {/* Main Workspace Container: 1280-1360px desktop width */}
      <div className="w-full space-y-6">
        
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

        {/* How the evidence on this page is layered: a real sequence, from recorded facts to a person's decision. */}
        <section data-reveal aria-labelledby="layers-h" className="rounded-2xl bg-white/75 ring-1 ring-line px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
          <h2 id="layers-h" className="text-[13px] font-semibold text-ink shrink-0">How the evidence on this page is layered</h2>
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-mute">
            <li className="inline-flex items-center gap-1.5"><EvidenceTag kind="observed" label="1. Recorded facts" /></li>
            <li aria-hidden="true" className="text-faint">→</li>
            <li className="inline-flex items-center gap-1.5"><EvidenceTag kind="rule" label="2. Fixed rules" /></li>
            <li aria-hidden="true" className="text-faint">→</li>
            <li className="inline-flex items-center gap-1.5"><EvidenceTag kind="model" label="3. Model score (machine learning)" /></li>
            <li aria-hidden="true" className="text-faint">→</li>
            <li className="inline-flex items-center gap-1 rounded-md bg-iris-soft ring-1 ring-iris-line px-1.5 py-0.5 text-[11px] font-semibold text-iris-deep">4. Human review (in a case)</li>
          </ol>
        </section>

        <div ref={tabsRef} className="hidden" />

        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW & RISK INTELLIGENCE                                       */}
        {/* ========================================================================= */}
        {activeTab === 'assessment' && (
          <div data-reveal className="space-y-6">

            {/* Error Banner if live analysis failed */}
            {analysisError && (
              <div className="bg-danger-soft border border-danger-line rounded-2xl p-4 text-xs text-danger-fill flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <strong className="font-bold">The live analysis failed: </strong>
                  <span>{analysisError}</span>
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* ROW B — ANALYSIS RESULT                                               */}
            {/* ===================================================================== */}

            {/* Case B1: Analysis Not Yet Run */}
            {!liveAnalysis && !isAnalyzing && (
              <div className="bg-white rounded-2xl border border-line p-8 sm:p-10 text-center shadow-xs space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-iris-soft border border-iris-line flex items-center justify-center text-iris mx-auto shadow-sm">
                  <Sparkles className="w-8 h-8" />
                </div>

                <div className="max-w-2xl mx-auto space-y-2">
                  <h3 className="text-2xl font-bold text-ink font-display">
                    Account analysis has not been run yet
                  </h3>
                  <p className="text-sm text-mute leading-relaxed">
                    The analysis reads this account’s ledger now: it computes 26 behavioural features, checks the fixed rules and scores the account with the account model, with TreeSHAP attributions for the score.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <button
                    onClick={handleRunLiveAnalysis}
                    className="btn-primary px-6"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Run live analysis</span>
                  </button>
                </div>

                <div className="max-w-xl mx-auto pt-4 border-t border-well text-xs text-faint leading-relaxed flex items-center justify-center gap-2">
                  <Shield className="w-4 h-4 text-ok" />
                  <span>Ledger status: <strong className="text-ink font-mono">{allTxns.length} transactions</strong> ready for real-time evaluation.</span>
                </div>
              </div>
            )}

            {/* Case B2: Analyzing in Progress */}
            {isAnalyzing && (
              <div className="bg-white rounded-2xl border border-line p-12 text-center shadow-xs space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-iris-soft border border-iris-line flex items-center justify-center text-iris mx-auto animate-spin">
                  <RefreshCw className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-ink">Analysing the account’s ledger</h3>
                <p className="text-xs text-mute max-w-md mx-auto leading-relaxed">
                  Extracting 26 behavioral features from {allTxns.length} transactions, computing rule signals, evaluating XGBoost inference, and generating native TreeSHAP local attributions...
                </p>
              </div>
            )}

            {/* Case B3: Analysis Completed - Side-by-Side ML & Rule Findings */}
            {liveAnalysis && (
              <div className="bg-white rounded-2xl border border-line p-6 sm:p-7 shadow-xs space-y-5">
                {/* Header with Run Metadata */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-well pb-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xl sm:text-2xl font-bold text-ink font-display">
                        What the analysis found
                      </h2>
                      <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-ok-soft text-ok border border-ok-line ">
                        Analysis Complete
                      </span>
                    </div>
                    <p className="text-xs text-mute mt-1">
                      Freshly computed evaluation of {liveAnalysis.ledger_snapshot.transactions_examined} ledger records completed at {new Date(liveAnalysis.analyzed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-mute self-start sm:self-center">
                    <span className="px-2.5 py-1 rounded-xl bg-well border border-line">
                      Run: <strong className="text-ink">{liveAnalysis.analysis_id}</strong>
                    </span>
                    <span className="px-2.5 py-1 rounded-xl bg-well border border-line">
                      Model: <strong className="text-ink">{liveAnalysis.model_version}</strong>
                    </span>
                    <span className="px-2.5 py-1 rounded-xl bg-well border border-line">
                      Examined: <strong className="text-ink">{liveAnalysis.ledger_snapshot.transactions_examined} txns</strong>
                    </span>
                  </div>
                </div>

                {/* Side-by-Side Score Cards (ML Score and Rule Score) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* ML Risk Score Card */}
                  <div className="bg-well rounded-2xl p-5 border border-line space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-iris-soft flex items-center justify-center text-iris">
                          <Cpu className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-ink block">{MODEL_SCORE_LABEL} (machine learning)</span>
                          <span className="text-[11px] text-mute font-mono">{liveAnalysis.ml_assessment.model_version} · 26 ledger features</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        liveAnalysis.ml_assessment.risk_level === 'high' || liveAnalysis.ml_assessment.risk_level === 'critical'
                        ? 'bg-danger-soft text-danger-fill border border-danger-line'
                        : liveAnalysis.ml_assessment.risk_level === 'elevated'
                        ? 'bg-warn-soft text-sev-high border border-sev-high-line'
                        : 'bg-ok-soft text-ok border border-ok-line'
                      }`}>
                        {liveAnalysis.ml_assessment.risk_level} Risk
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-ink font-mono">
                        {formatModelScore(liveAnalysis.ml_assessment.risk_score)}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-ink">
                      {liveAnalysis.ml_assessment.predicted_class === 'suspicious'
                        ? `At or above the ${modelThresholdLabel ?? 'review'} review threshold: suggested for review, not confirmed fraud.`
                        : `Below the ${modelThresholdLabel ?? 'review'} review threshold. This does not clear the account.`}
                    </p>
                    <p className="text-[11px] text-mute leading-relaxed">{MODEL_SCORE_MEANING}</p>

                    {/* Calibrated Meter */}
                    <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-line">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          liveAnalysis.ml_assessment.risk_level === 'high' || liveAnalysis.ml_assessment.risk_level === 'critical'
                          ? 'bg-danger-fill'
                          : liveAnalysis.ml_assessment.risk_level === 'elevated'
                          ? 'bg-iris'
                          : 'bg-ok'
                        }`}
                        style={{ width: `${Math.min(Math.max(liveAnalysis.ml_assessment.risk_score, 0), 100)}%` }}
                      />
                    </div>

                    {modelBands && (
                      <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-faint font-mono">
                        {modelBands.map((b) => (
                          <span key={b}>{b}</span>
                        ))}
                      </div>
                    )}

                    <p className="text-xs text-mute leading-relaxed pt-1 border-t border-line/60">
                      Statistical pattern model evaluating multi-dimensional transfer velocity, burst volume, and balance depletion dynamics.
                    </p>
                  </div>

                  {/* Rule Behavioral Baseline Card */}
                  <div className="bg-well rounded-2xl p-5 border border-line space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-mute border border-line">
                          <Scale className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-ink block">Rule Deterministic Check</span>
                          <span className="text-[11px] text-mute font-mono">Observable heuristics</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        liveAnalysis.rule_assessment.risk_level === 'high' || liveAnalysis.rule_assessment.risk_level === 'critical'
                        ? 'bg-danger-soft text-danger-fill border border-danger-line'
                        : liveAnalysis.rule_assessment.risk_level === 'elevated'
                        ? 'bg-warn-soft text-sev-high border border-sev-high-line'
                        : 'bg-ok-soft text-ok border border-ok-line'
                      }`}>
                        {liveAnalysis.rule_assessment.risk_level} Risk
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-ink font-mono">
                        {liveAnalysis.rule_assessment.risk_score.toFixed(1)}
                      </span>
                      <span className="text-sm font-medium text-mute font-mono">points of 100</span>
                      <span className="ml-auto text-xs font-mono text-mute">
                        Uncertainty: <strong className=" text-ink">{liveAnalysis.rule_assessment.uncertainty_rating}</strong>
                      </span>
                    </div>

                    {/* Calibrated Meter */}
                    <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-line">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          liveAnalysis.rule_assessment.risk_level === 'high' || liveAnalysis.rule_assessment.risk_level === 'critical'
                          ? 'bg-danger-fill'
                          : liveAnalysis.rule_assessment.risk_level === 'elevated'
                          ? 'bg-iris'
                          : 'bg-ok'
                        }`}
                        style={{ width: `${Math.min(Math.max(liveAnalysis.rule_assessment.risk_score, 0), 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-faint font-mono">
                      <span>Low (0-25)</span>
                      <span>Elevated (26-55)</span>
                      <span>High (56-80)</span>
                      <span>Critical (81+)</span>
                    </div>

                    <p className="text-xs text-mute leading-relaxed pt-1 border-t border-line/60">
                      Deterministic compliance rules evaluating observable transaction thresholds, burst velocity, and flow-through ratios.
                    </p>
                  </div>
                </div>

                {/* Plain-English Summary of Finding */}
                <div className="bg-well rounded-2xl p-4 sm:p-5 border border-line space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-iris" />
                    <h4 className="text-xs font-bold text-ink ">
                      The finding in plain words
                    </h4>
                  </div>
                  <p className="text-sm text-ink-soft leading-relaxed">
                    {liveAnalysis.divergence?.interpretation ||
                      `The model score is ${formatModelScore(liveAnalysis.ml_assessment.risk_score)} (${liveAnalysis.ml_assessment.risk_level}); the fixed rules gave ${liveAnalysis.rule_assessment.risk_score.toFixed(0)} points of 100 (${liveAnalysis.rule_assessment.risk_level}). The two use different scales. Assessment evaluated ${liveAnalysis.ledger_snapshot.transactions_examined} ledger movements. Neither score constitutes proof of fraud; follow recommended investigative steps before taking any action.`}
                  </p>
                </div>

                {/* Model Divergence Alert Component */}
                <V2ModelDivergenceAlert
                  accountId={accountId || ''}
                  mlRiskScore={liveAnalysis.ml_assessment.risk_score}
                  mlRiskLevel={liveAnalysis.ml_assessment.risk_level}
                  modelSuggestsReview={liveAnalysis.ml_assessment.predicted_class === 'suspicious'}
                  ruleRiskScore={liveAnalysis.rule_assessment.risk_score}
                  ruleRiskLevel={liveAnalysis.rule_assessment.risk_level}
                  modelThresholdLabel={modelThresholdLabel}
                  interpretation={liveAnalysis.divergence?.interpretation}
                  suggestedFocus={liveAnalysis.divergence?.suggested_focus}
                />
              </div>
            )}

            {/* ===================================================================== */}
            {/* ROW C — RISK AND ACTIVITY CHARTS (BALANCED 2X2 GRID)                  */}
            {/* ===================================================================== */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-ink font-display flex items-center gap-2">
                    <Activity className="w-5 h-5 text-iris" />
                    Risk & Activity Analytics
                  </h3>
                  <p className="text-xs text-mute">
                    Balanced forensic visualizations. Clicking any histogram bin or timeline date filters transactions immediately.
                  </p>
                </div>
                {(selectedHistogramBin || selectedTimelineDate) && (
                  <button
                    onClick={() => {
                      setSelectedHistogramBin(null);
                      setSelectedTimelineDate(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-well border border-line text-xs font-bold text-iris transition-colors shadow-2xs self-start sm:self-center cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Chart Filter</span>
                  </button>
                )}
              </div>

              {/* 2x2 Balanced Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Chart 1: Risk Comparison */}
                {liveAnalysis ? (
                  <V2RiskComparisonMeters
                    mlAssessment={liveAnalysis.ml_assessment}
                    ruleAssessment={liveAnalysis.rule_assessment}
                    divergence={liveAnalysis.divergence}
                  />
                ) : (
                  <div className="bg-white rounded-2xl border border-line p-6 flex flex-col justify-between space-y-4 shadow-2xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-iris-soft flex items-center justify-center text-iris">
                        <Scale className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-ink">Model score and rule score</h4>
                        <p className="text-xs text-mute">Two independent checks, read side by side</p>
                      </div>
                    </div>
                    <div className="py-8 text-center space-y-3">
                      <p className="text-xs text-mute max-w-sm mx-auto leading-relaxed">
                        Run Live Analysis to compute and compare the 26-feature ML statistical risk score against deterministic rule thresholds.
                      </p>
                      <button
                        onClick={handleRunLiveAnalysis}
                        className="btn-primary text-xs"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Run live analysis</span>
                      </button>
                    </div>
                    <div className="pt-3 border-t border-well flex items-center justify-between text-[11px] text-faint font-mono">
                      <span>Low: 0–29</span>
                      <span>Elevated: 30–69</span>
                      <span>High: 70+</span>
                    </div>
                  </div>
                )}

                {/* Chart 2: Transaction Amount Histogram */}
                <V2TransactionHistogram
                  transactions={allTxns}
                  selectedBin={selectedHistogramBin}
                  onSelectBin={(bin) => {
                    setSelectedHistogramBin(bin);
                    if (bin) setTxnPage(0);
                  }}
                />

                {/* Chart 3: Activity Timeline */}
                <V2ActivityTimeline
                  transactions={allTxns}
                  selectedDate={selectedTimelineDate}
                  onSelectDate={(date) => {
                    setSelectedTimelineDate(date);
                    if (date) setTxnPage(0);
                  }}
                />

                {/* Chart 4: Money Received vs. Money Sent */}
                <V2MoneyFlowComparison
                  totalReceived={liveAnalysis ? liveAnalysis.ledger_snapshot.total_received : (profile?.metrics.total_incoming_amount ?? 0)}
                  totalSent={liveAnalysis ? liveAnalysis.ledger_snapshot.total_sent : (profile?.metrics.total_outgoing_amount ?? 0)}
                  currentBalance={liveAnalysis ? liveAnalysis.ledger_snapshot.current_balance : (profile?.current_balance ?? 0)}
                  initialBalance={profile?.initial_balance || 0}
                  totalTransactions={liveAnalysis ? liveAnalysis.ledger_snapshot.transactions_examined : allTxns.length}
                  uniqueCounterparties={profile?.metrics.unique_counterparties || 0}
                  flowThroughRatio={liveAnalysis ? liveAnalysis.rule_assessment.signals.flow_through_ratio : ((profile?.metrics.total_incoming_amount ?? 0) > 0 ? (profile?.metrics.total_outgoing_amount ?? 0) / (profile?.metrics.total_incoming_amount ?? 1) : 0)}
                />
              </div>

              {/* Interactive Chart Filter Preview Drawer (shown when histogram or timeline filter is active) */}
              {(selectedHistogramBin || selectedTimelineDate) && (
                <div className="bg-white rounded-2xl border-2 border-iris/30 p-5 shadow-xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-well pb-3">
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-iris" />
                      <span className="text-xs font-bold text-ink">
                        Filtered Transactions Preview:
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-iris-soft text-iris border border-iris-line">
                        {selectedHistogramBin ? `Amount: ${selectedHistogramBin.label}` : `Date: ${selectedTimelineDate}`}
                      </span>
                      <span className="text-xs text-mute font-mono">
                        ({filteredTransactions.length} of {allTxns.length} records)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveTab('transactions')}
                        className="inline-flex items-center gap-1 text-xs font-bold text-iris hover:text-iris-deep transition-colors cursor-pointer"
                      >
                        <span>View in Full Ledger Tab</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedHistogramBin(null);
                          setSelectedTimelineDate(null);
                        }}
                        className="p-1 rounded-lg text-faint hover:text-ink hover:bg-well transition-colors cursor-pointer"
                        title="Clear filter"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Quick table of matching transactions */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-line text-faint">
                          <th className="py-2 px-3">Transaction ID</th>
                          <th className="py-2 px-3">Date & Time</th>
                          <th className="py-2 px-3">Flow</th>
                          <th className="py-2 px-3">Counterparty</th>
                          <th className="py-2 px-3">Channel</th>
                          <th className="py-2 px-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-well">
                        {filteredTransactions.slice(0, 5).map((txn) => (
                          <tr key={txn.transaction_id} className="hover:bg-well transition-colors">
                            <td className="py-2 px-3 font-bold text-ink">{txn.transaction_id}</td>
                            <td className="py-2 px-3 text-mute font-sans">
                              {new Date(txn.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                txn.direction === 'inbound' ? 'bg-ok-soft text-ok' : 'bg-iris-soft text-iris'
                              }`}>
                                {txn.direction}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-ink">{txn.counterparty_account_id}</td>
                            <td className="py-2 px-3 text-mute text-[11px]">{txn.channel}</td>
                            <td className={`py-2 px-3 text-right font-bold ${
                              txn.direction === 'inbound' ? 'text-ok' : 'text-iris'
                            }`}>
                              {txn.direction === 'inbound' ? '+' : '-'}₹{Number(txn.amount).toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* ===================================================================== */}
            {/* ROW D — AI EXPLANATION & NEXT STEPS                                   */}
            {/* ===================================================================== */}
            {liveAnalysis ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Why the AI gave this score (TreeSHAP) */}
                <V2TreeShapBreakdown
                  contributions={liveAnalysis.ml_assessment.top_contributions || []}
                />

                {/* Right: What to examine next */}
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
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-line p-6 space-y-3 shadow-xs">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-iris" />
                    <h4 className="text-base font-bold text-ink font-display">
                      Why the model gave this score (TreeSHAP attributions)
                    </h4>
                  </div>
                  <p className="text-xs text-mute leading-relaxed">
                    Interactive TreeSHAP local contribution charts will display mathematical feature weights once live analysis evaluates this account's 26 behavioral features.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={handleRunLiveAnalysis}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-well hover:bg-well-strong border border-line text-xs font-bold text-ink transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-iris" />
                      <span>Run Live Analysis to compute TreeSHAP</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-line p-6 space-y-3 shadow-xs">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-iris" />
                    <h4 className="text-base font-bold text-ink font-display">
                      What to examine next
                    </h4>
                  </div>
                  <p className="text-xs text-mute leading-relaxed">
                    Evidence-based advisory actions, supporting signals, and recommended regulatory safeguards will be populated upon completing live analysis.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => setActiveTab('trace')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-well hover:bg-well-strong border border-line text-xs font-bold text-ink transition-colors cursor-pointer"
                    >
                      <GitFork className="w-3.5 h-3.5 text-iris" />
                      <span>Explore Fund Flow Trace</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: FOLLOW THE MONEY (GRAPH TRACE)                                     */}
        {/* ========================================================================= */}
        {activeTab === 'trace' && (
          <div data-reveal className="space-y-6">
            <div className="bg-white rounded-2xl border border-line p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-well pb-4">
                <div>
                  <h3 className="text-base font-bold text-ink font-display flex items-center gap-2">
                    <GitFork className="w-5 h-5 text-iris" />
                    Multi-Hop Forensic Fund Tracer
                  </h3>
                  <p className="text-xs text-mute mt-0.5">
                    Traverse connected accounts and follow money flows across multi-hop counterparty edges.
                  </p>
                </div>

                {/* Depth & Direction Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-mute">
                    <span>Flow:</span>
                    <select
                      value={traceDirection}
                      onChange={(e) => setTraceDirection(e.target.value as any)}
                      className="px-2.5 py-1 rounded-xl bg-well border border-line text-xs font-bold text-ink"
                    >
                      <option value="outgoing">Outbound (Follow Dispersal)</option>
                      <option value="incoming">Inbound (Follow Origin)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-mute">
                    <span>Hops:</span>
                    <select
                      value={traceDepth}
                      onChange={(e) => setTraceDepth(Number(e.target.value))}
                      className="px-2.5 py-1 rounded-xl bg-well border border-line text-xs font-bold text-ink"
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
                <div className="h-96 rounded-2xl bg-well border border-line flex flex-col items-center justify-center space-y-2">
                  <RefreshCw className="w-6 h-6 text-iris animate-spin" />
                  <span className="text-xs text-mute">Traversing multi-hop transaction graph...</span>
                </div>
              ) : traceData ? (
                <V2CytoscapeGraph
                  traceData={traceData}
                  onSelectNode={(node) => {
                    if (node && node.account_id && node.account_id !== accountId) {
                      navigate(`/tools/accounts/${encodeURIComponent(node.account_id)}`);
                    }
                  }}
                />
              ) : (
                <div className="h-64 rounded-2xl bg-well border border-line flex items-center justify-center text-xs text-mute">
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
          <div data-reveal className="space-y-6">
            <div className="bg-white rounded-2xl border border-line p-6 shadow-xs space-y-4">
              {/* Header and Filter Controls */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-well pb-4">
                <div>
                  <h3 className="text-base font-bold text-ink font-display flex items-center gap-2">
                    <Layers className="w-5 h-5 text-iris" />
                    Account Transaction Ledger
                  </h3>
                  <p className="text-xs text-mute mt-0.5">
                    Showing {filteredTransactions.length} of {allTxns.length} recorded movements. Synchronized with active chart selections.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Direction Tabs */}
                  <div className="inline-flex rounded-xl bg-well border border-line p-0.5 text-xs font-medium">
                    <button
                      onClick={() => setTxnDirection('all')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        txnDirection === 'all' ? 'bg-white font-bold text-ink shadow-2xs' : 'text-mute'
                      }`}
                    >
                      All ({allTxns.length})
                    </button>
                    <button
                      onClick={() => setTxnDirection('inbound')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        txnDirection === 'inbound' ? 'bg-white font-bold text-ok shadow-2xs' : 'text-mute'
                      }`}
                    >
                      Credits
                    </button>
                    <button
                      onClick={() => setTxnDirection('outbound')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        txnDirection === 'outbound' ? 'bg-white font-bold text-iris shadow-2xs' : 'text-mute'
                      }`}
                    >
                      Debits
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-faint" />
                    <input
                      type="text"
                      placeholder="Search txn ID, counterparty..."
                      value={txnSearch}
                      onChange={(e) => {
                        setTxnSearch(e.target.value);
                        setTxnPage(0);
                      }}
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-well border border-line text-xs text-ink placeholder-faint focus:outline-none focus:border-iris w-52"
                    />
                  </div>
                </div>
              </div>

              {/* Active Linked Filters Bar */}
              {hasActiveFilters && (
                <div className="bg-well rounded-xl p-3 border border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-mute font-medium flex items-center gap-1">
                      <Filter className="w-3.5 h-3.5 text-iris" /> Active Filters:
                    </span>

                    {selectedHistogramBin && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-iris-line text-iris font-mono text-[11px]">
                        <span>Amount: {selectedHistogramBin.label}</span>
                        <button onClick={() => setSelectedHistogramBin(null)} className="hover:text-ink">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}

                    {selectedTimelineDate && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-ice-line text-ice-deep font-mono text-[11px]">
                        <span>Date: {selectedTimelineDate}</span>
                        <button onClick={() => setSelectedTimelineDate(null)} className="hover:text-ink">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}

                    {txnDirection !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-line text-ink font-mono text-[11px]">
                        <span>Direction: {txnDirection}</span>
                        <button onClick={() => setTxnDirection('all')} className="hover:text-ink">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                  </div>

                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-iris hover:text-iris-deep font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset All Filters</span>
                  </button>
                </div>
              )}

              {/* Transactions Table */}
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-well text-mute font-medium border-b border-line">
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
                  <tbody className="divide-y divide-line">
                    {paginatedTransactions.length > 0 ? (
                      paginatedTransactions.map((t) => {
                        const isInbound = t.direction === 'inbound';
                        const isSelected = selectedTxnForDetail?.transaction_id === t.transaction_id;
                        return (
                          <tr
                            key={t.transaction_id}
                            className={`transition-colors hover:bg-well/60 ${isSelected ? 'bg-iris-wash' : ''}`}
                          >
                            <td className="py-3 px-4 font-mono font-bold text-ink">
                              {t.transaction_id}
                            </td>
                            <td className="py-3 px-4 font-mono text-mute">
                              {new Date(t.timestamp).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                                  isInbound
                                  ? 'bg-ok-soft text-ok border-ok-line'
                                  : 'bg-iris-soft text-iris border-iris-line'
                                }`}
                              >
                                {isInbound ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                <span>{t.direction}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <Link
                                to={`/tools/accounts/${encodeURIComponent(t.counterparty_account_id)}`}
                                className="font-mono text-iris hover:underline font-medium"
                              >
                                {t.counterparty_account_id}
                              </Link>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold">
                              <span className={isInbound ? 'text-ok' : 'text-ink'}>
                                {isInbound ? '+' : '-'}₹{t.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-mute">
                              {t.channel}
                            </td>
                            <td className="py-3 px-4 font-mono text-mute">
                              ₹{(isInbound ? t.dest_balance_after : t.origin_balance_after).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setSelectedTxnForDetail(isSelected ? null : t)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-well text-mute hover:text-ink border border-line"
                              >
                                {isSelected ? 'Hide' : 'Details'}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-xs text-mute italic">
                          No transactions match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-mute pt-2">
                  <span>
                    Page {txnPage + 1} of {totalPages} ({filteredTransactions.length} items)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setTxnPage((p) => Math.max(0, p - 1))}
                      disabled={txnPage === 0}
                      className="px-3 py-1.5 rounded-xl border border-line bg-white text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-well"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setTxnPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={txnPage >= totalPages - 1}
                      className="px-3 py-1.5 rounded-xl border border-line bg-white text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-well"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Transaction Detail Panel if selected */}
              {selectedTxnForDetail && (
                <div className="bg-well rounded-2xl border border-line p-4 text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink">Transaction Details: {selectedTxnForDetail.transaction_id}</span>
                      <span className="font-mono text-mute">({selectedTxnForDetail.status})</span>
                    </div>
                    <button onClick={() => setSelectedTxnForDetail(null)} className="text-mute hover:text-ink">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px]">
                    <div>
                      <span className="text-faint block text-[11px]">Origin Account</span>
                      <Link to={`/tools/accounts/${selectedTxnForDetail.origin_account_id}`} className="text-iris hover:underline font-bold">
                        {selectedTxnForDetail.origin_account_id}
                      </Link>
                    </div>
                    <div>
                      <span className="text-faint block text-[11px]">Destination Account</span>
                      <Link to={`/tools/accounts/${selectedTxnForDetail.destination_account_id}`} className="text-iris hover:underline font-bold">
                        {selectedTxnForDetail.destination_account_id}
                      </Link>
                    </div>
                    <div>
                      <span className="text-faint block text-[11px]">Origin Balance Delta</span>
                      <span className="text-ink">
                        ₹{selectedTxnForDetail.origin_balance_before.toLocaleString()} → ₹{selectedTxnForDetail.origin_balance_after.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block text-[11px]">Destination Balance Delta</span>
                      <span className="text-ink">
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
          <div ref={adjudicationRef} className="space-y-6">
            <div className="bg-white rounded-2xl border border-line p-6 sm:p-8 shadow-xs space-y-4 max-w-3xl">
              <h3 className="text-lg font-bold text-ink">Review decisions are recorded inside a case</h3>
              <p className="text-sm text-mute leading-relaxed">
                This page looks up an account on its own, outside any investigation. A decision about an account only makes
                sense in the context of a specific complaint, so FraudShield records decisions in a case’s Review &amp; history
                section, where they are saved on the server with the reviewer’s reasoning.
              </p>
              <p className="text-sm text-mute leading-relaxed">
                Accounts ACC-000001, ACC-000002, ACC-000003, ACC-000005, ACC-000009 and ACC-000012 appear in sample case FS-2001.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/cases/FS-2001?section=review" className="btn-primary">Open case FS-2001</Link>
                <Link to="/cases" className="btn-secondary">All investigations</Link>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
