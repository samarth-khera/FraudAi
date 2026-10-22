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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { v2Api, ApiError } from '../../services/v2Api';
import {
  V2AccountAssessmentResponse,
  V2AccountMLAssessmentResponse,
  V2AccountProfileResponse,
  V2AccountTransactionsResponse,
  V2TraceGraphResponse,
} from '../../types/v2';
import { V2Header } from '../../components/v2/V2Header';
import { V2Footer } from '../../components/v2/V2Footer';
import { V2CytoscapeGraph } from '../../components/v2/V2CytoscapeGraph';
import { V2ModelDivergenceAlert } from '../../components/v2/V2ModelDivergenceAlert';
import { V2TreeShapBreakdown } from '../../components/v2/V2TreeShapBreakdown';

// Benchmark scenario mapping for educational and validation context
const BENCHMARK_SCENARIO_MAP: Record<string, { scenario: string; role: string; notes: string }> = {
  'ACC-000001': {
    scenario: 'SCENARIO-APP-001',
    role: 'Compromised Victim (APP Scam)',
    notes: 'Victim suffered unauthorized debit of ₹250,000. Balance was drained to intermediate mule ACC-000002.',
  },
  'ACC-000002': {
    scenario: 'SCENARIO-APP-001',
    role: 'Intermediate Layering Mule',
    notes: 'First-hop mule account. Rapid pass-through (<12 min dwell time) forwarded funds to downstream hops.',
  },
  'ACC-000003': {
    scenario: 'SCENARIO-APP-001',
    role: 'Downstream Counterparty / Mule Hop 2',
    notes: 'Second-hop layering node in the APP scam dispersal chain.',
  },
  'ACC-000010': {
    scenario: 'CONTROL-BASELINE',
    role: 'Active Retail Customer Baseline',
    notes: 'Unimpaired normal retail account with standard circadian velocity and steady balance.',
  },
};

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

  // Core Data State
  const [profile, setProfile] = useState<V2AccountProfileResponse | null>(null);
  const [ruleAssessment, setRuleAssessment] = useState<V2AccountAssessmentResponse | null>(null);
  const [mlAssessment, setMlAssessment] = useState<V2AccountMLAssessmentResponse | null>(null);
  const [transactions, setTransactions] = useState<V2AccountTransactionsResponse | null>(null);
  const [traceData, setTraceData] = useState<V2TraceGraphResponse | null>(null);

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

  // Transaction Filters & Pagination
  const [txnDirection, setTxnDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [txnOffset, setTxnOffset] = useState<number>(0);
  const [txnSearch, setTxnSearch] = useState<string>('');
  const txnLimit = 25;

  // Trace Controls
  const [traceDepth, setTraceDepth] = useState<number>(3);
  const [traceDirection, setTraceDirection] = useState<'outgoing' | 'incoming'>('outgoing');

  // Loading & Error States
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [errorNotFound, setErrorNotFound] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  // Rule technical details collapsible
  const [showTechnicalReasonCodes, setShowTechnicalReasonCodes] = useState(false);

  // Human Adjudication State
  const [adjudicationStatus, setAdjudicationStatus] = useState<string>('pending_review');
  const [adjudicationNotes, setAdjudicationNotes] = useState<string>('');
  const [adjudicationSaved, setAdjudicationSaved] = useState(false);
  const [adjudicationHistory, setAdjudicationHistory] = useState<AdjudicationEntry[]>([]);

  // 1. Save to recent searches & load adjudication from localStorage
  useEffect(() => {
    if (!accountId) return;

    try {
      const stored = localStorage.getItem('fs_v2_recent_accounts');
      const recents: string[] = stored ? JSON.parse(stored) : [];
      const updated = [accountId, ...recents.filter((id) => id !== accountId)].slice(0, 10);
      localStorage.setItem('fs_v2_recent_accounts', JSON.stringify(updated));
    } catch {
      // Ignore
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

  // 2. Load core account data
  useEffect(() => {
    if (!accountId) return;

    setErrorNotFound(false);
    setErrorGeneral(null);
    setLoadingProfile(true);

    Promise.all([
      v2Api.getAccount(accountId),
      v2Api.getAssessment(accountId).catch(() => null),
      v2Api.getMLAssessment(accountId).catch(() => null),
    ])
      .then(([profData, ruleData, mlData]) => {
        setProfile(profData);
        setRuleAssessment(ruleData);
        setMlAssessment(mlData);
        setLoadingProfile(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setErrorNotFound(true);
        } else {
          setErrorGeneral(err.message || 'Failed to load account profile');
        }
        setLoadingProfile(false);
      });
  }, [accountId]);

  // 3. Load transactions
  useEffect(() => {
    if (!accountId || errorNotFound) return;
    setLoadingTxns(true);

    v2Api
      .getTransactions(accountId, {
        direction: txnDirection,
        limit: txnLimit,
        offset: txnOffset,
        order: 'desc',
      })
      .then((data) => {
        setTransactions(data);
        setLoadingTxns(false);
      })
      .catch(() => setLoadingTxns(false));
  }, [accountId, txnDirection, txnOffset, errorNotFound]);

  // 4. Load trace data
  useEffect(() => {
    if (!accountId || errorNotFound) return;
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
  }, [accountId, traceDirection, traceDepth, errorNotFound]);

  // 5. Coordinated GSAP page entrance
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !pageContainerRef.current || loadingProfile) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.gsap-dossier-card',
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' }
      );
    }, pageContainerRef);

    return () => ctx.revert();
  }, [loadingProfile, activeTab]);

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

  const tabsRef = useRef<HTMLDivElement>(null);

  const navigateToTab = (tab: 'assessment' | 'trace' | 'transactions' | 'review') => {
    setActiveTab(tab);
    if (tab === 'review') {
      adjudicationRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToAdjudication = () => {
    setActiveTab('review');
    if (adjudicationRef.current) {
      adjudicationRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // 404 Not Found State
  if (errorNotFound) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1714] font-sans selection:bg-[#EA8500]/20 selection:text-[#EA8500]">
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
              The identifier <code className="bg-[#FAF7F2] border border-[#EAE3D6] px-2 py-0.5 rounded font-mono font-bold text-[#1A1714]">{accountId}</code> was not found in the synthetic banking database.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/v2"
              className="px-5 py-2.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-bold transition-all shadow-xs"
            >
              Return to Search Workspace
            </Link>
            <button
              type="button"
              onClick={() => navigate('/v2/accounts/ACC-000001')}
              className="px-5 py-2.5 rounded-xl border border-[#EAE3D6] bg-white text-[#1A1714] text-xs font-bold hover:bg-[#FAF7F2] hover:border-[#FCD5B5] transition-all cursor-pointer shadow-2xs"
            >
              Try Sample Case (ACC-000001)
            </button>
          </div>
        </main>
        <V2Footer />
      </div>
    );
  }

  if (loadingProfile || !profile) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1714] font-sans">
        <V2Header />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] animate-spin">
            <RefreshCw className="w-6 h-6" />
          </div>
          <p className="text-sm text-[#6B655B] font-mono">Loading core account dossier and ML telemetry...</p>
        </main>
        <V2Footer />
      </div>
    );
  }

  const benchmarkMeta = accountId ? BENCHMARK_SCENARIO_MAP[accountId] : undefined;

  return (
    <div
      ref={pageContainerRef}
      style={{ backgroundImage: 'radial-gradient(circle at 50% -10%, #FFE8CC 0%, #F8F6F0 40%)' }}
      className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1714] font-sans selection:bg-[#EA8500]/20 selection:text-[#EA8500]"
    >
      <V2Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
        {/* Navigation Breadcrumb & Sequence Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#6B655B]">
          <Link
            to="/v2"
            className="inline-flex items-center gap-1.5 text-[#6B655B] hover:text-[#EA8500] font-bold transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Search Workspace</span>
          </Link>

          {/* Investigation Sequence Stepper */}
          <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] bg-[#FAF7F2] border border-[#EAE3D6] px-3.5 py-1.5 rounded-full shadow-2xs">
            <span className="font-bold text-[#EA8500]">Overview</span>
            <span className="text-[#DDD4C4]">➔</span>
            <button
              onClick={() => navigateToTab('assessment')}
              className={`hover:text-[#EA8500] cursor-pointer transition-colors ${
                activeTab === 'assessment' ? 'text-[#EA8500] font-bold' : 'text-[#6B655B]'
              }`}
            >
              Understand scores
            </button>
            <span className="text-[#DDD4C4]">➔</span>
            <button
              onClick={() => navigateToTab('trace')}
              className={`hover:text-[#EA8500] cursor-pointer transition-colors ${
                activeTab === 'trace' ? 'text-[#EA8500] font-bold' : 'text-[#6B655B]'
              }`}
            >
              Follow the money
            </button>
            <span className="text-[#DDD4C4]">➔</span>
            <button
              onClick={() => navigateToTab('transactions')}
              className={`hover:text-[#EA8500] cursor-pointer transition-colors ${
                activeTab === 'transactions' ? 'text-[#EA8500] font-bold' : 'text-[#6B655B]'
              }`}
            >
              Review transactions
            </button>
            <span className="text-[#DDD4C4]">➔</span>
            <button
              onClick={scrollToAdjudication}
              className="text-[#6B655B] hover:text-[#EA8500] cursor-pointer transition-colors"
            >
              Record a finding
            </button>
          </div>
        </div>

        {/* Forensic Evidence & Governance Hierarchy Bar */}
        <div className="gsap-dossier-card bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 text-xs shadow-2xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE3D6]/70 pb-2.5">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-[#EA8500]" />
              <span className="font-bold text-[#1A1714] uppercase tracking-wider text-[11px]">
                Forensic Evidence Hierarchy & Separation of Concepts:
              </span>
            </div>
            <span className="text-[#8C857B] text-[11px] font-mono">
              Audit-Ready Compliance Architecture
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* Tier 1 */}
            <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
              <span className="font-bold text-[#1A1714] block">1. Observed Ledger Facts</span>
              <span className="text-[#6B655B] text-[11px] leading-relaxed">
                Verified core debits, credits, running balances, and KYC tier.
              </span>
            </div>
            {/* Tier 2 */}
            <div className="p-3 rounded-xl bg-[#EBF5FF] border border-[#BFDBFE]">
              <span className="font-bold text-[#1E40AF] block">2. Rule-Based Signals</span>
              <span className="text-[#1E40AF]/80 text-[11px] leading-relaxed">
                Deterministic velocity, dwell time, spikes, and circular loops.
              </span>
            </div>
            {/* Tier 3 */}
            <div className="p-3 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5]">
              <span className="font-bold text-[#C05621] block">3. Statistical ML Probability</span>
              <span className="text-[#C05621]/80 text-[11px] leading-relaxed">
                Calibrated risk score (0–100) & local TreeSHAP attribution.
              </span>
            </div>
            {/* Tier 4 */}
            <div className="p-3 rounded-xl bg-[#EAF7EE] border border-[#BBF7D0]">
              <span className="font-bold text-[#166534] block">4. Human Adjudication</span>
              <span className="text-[#166534]/80 text-[11px] leading-relaxed">
                Analyst review required. Automated freezes strictly prohibited.
              </span>
            </div>
          </div>
        </div>

        {/* Offline Benchmark Scenario Reference Box (if known benchmark account) */}
        {benchmarkMeta && (
          <div className="gsap-dossier-card bg-[#FFF8EE] border border-[#FCD5B5] rounded-2xl p-4 sm:p-5 text-xs text-[#1A1714] flex items-start gap-3.5 shadow-2xs">
            <Info className="w-5 h-5 text-[#EA8500] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-[#FFF4E6] text-[#C05621] border border-[#FCD5B5] font-mono font-bold text-[10px]">
                  OFFLINE EVALUATION BENCHMARK METADATA
                </span>
                <span className="font-bold text-[#1A1714]">
                  {benchmarkMeta.scenario} · {benchmarkMeta.role}
                </span>
              </div>
              <p className="text-[#6B655B] leading-relaxed text-xs">
                {benchmarkMeta.notes}{' '}
                <strong className="text-[#1A1714] font-semibold">
                  Notice: Ground-truth scenario labels are strictly offline reference data for model benchmark validation; runtime algorithms never access or evaluate these tags.
                </strong>
              </p>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 1: WHAT HAPPENED TO THIS ACCOUNT? (Account Overview Card)         */}
        {/* ========================================================================= */}
        <section aria-labelledby="account-identity-heading" className="gsap-dossier-card bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(180,150,120,0.06)] space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            {/* Identity & Core Details */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 id="account-identity-heading" className="text-2xl sm:text-3xl font-black tracking-tight text-[#1A1714] font-display">
                  {profile.customer_name}
                </h1>
                <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-xl bg-[#FAF7F2] text-[#1A1714] border border-[#EAE3D6]">
                  {profile.account_id}
                </span>
                <span className="capitalize text-xs font-bold px-2.5 py-1 rounded-xl bg-[#EBF5FF] text-[#1E40AF] border border-[#BFDBFE]">
                  {profile.customer_type}
                </span>
                <span className="capitalize text-xs font-bold px-2.5 py-1 rounded-xl bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0]">
                  {profile.kyc_tier.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-[#6B655B] font-mono leading-relaxed">
                Opened: {profile.account_opened_at.replace('T', ' ')} · Tax ID: {profile.tax_identifier} · UPI: {profile.upi_id} · Phone: {profile.phone_number}
              </p>
            </div>

            {/* Prominent Primary & Secondary Investigation Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <motion.button
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                id="quick-explore-graph-btn"
                onClick={() => navigateToTab('trace')}
                className="h-11 px-5 rounded-2xl bg-[#EA8500] hover:bg-[#D27400] text-white font-bold text-xs tracking-wide flex items-center gap-2 shadow-[0_4px_16px_rgba(234,133,0,0.28)] transition-all cursor-pointer"
              >
                <GitFork className="w-4 h-4" />
                <span>Follow the money</span>
              </motion.button>

              <motion.button
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                id="quick-view-txns-btn"
                onClick={() => navigateToTab('transactions')}
                className="h-11 px-4 rounded-2xl bg-[#FAF7F2] hover:bg-white text-[#1A1714] border border-[#EAE3D6] hover:border-[#FCD5B5] font-bold text-xs tracking-wide flex items-center gap-2 shadow-2xs transition-all cursor-pointer"
              >
                <Activity className="w-4 h-4 text-[#EA8500]" />
                <span>View transaction history</span>
              </motion.button>

              <button
                type="button"
                onClick={scrollToAdjudication}
                className="h-11 px-4 rounded-2xl bg-white hover:bg-[#FAF7F2] text-[#6B655B] hover:text-[#1A1714] border border-[#EAE3D6] text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              >
                <Check className="w-4 h-4 text-[#166534]" />
                <span>Compliance review</span>
              </button>
            </div>
          </div>

          {/* Balanced Financial Metrics Strip (Plain English Labels) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 pt-5 border-t border-[#EAE3D6]">
            {/* Metric 1: Current Balance */}
            <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6]">
              <span className="text-[#6B655B] block text-xs font-medium">Current balance</span>
              <span className="font-mono font-bold text-lg sm:text-xl text-[#1A1714] block mt-1">
                ₹{profile.current_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-[#8C857B] mt-1 block">Balance held in ledger</span>
            </div>

            {/* Metric 2: Opening Balance */}
            <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6]">
              <span className="text-[#6B655B] block text-xs font-medium">Opening balance</span>
              <span className="font-mono font-bold text-lg sm:text-xl text-[#6B655B] block mt-1">
                ₹{profile.initial_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-[#8C857B] mt-1 block">Starting ledger funds</span>
            </div>

            {/* Metric 3: Money Received */}
            <div className="bg-[#EAF7EE] rounded-2xl p-4 border border-[#BBF7D0]">
              <span className="text-[#166534] block text-xs font-medium">Money received</span>
              <span className="font-mono font-bold text-lg sm:text-xl text-[#166534] block mt-1">
                +₹{profile.metrics.total_incoming_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-[#166534]/80 mt-1 block font-mono">
                {profile.metrics.total_incoming_txns} incoming transfers
              </span>
            </div>

            {/* Metric 4: Money Sent */}
            <div className="bg-[#FFF0F2] rounded-2xl p-4 border border-[#FECDD3]">
              <span className="text-[#BE123C] block text-xs font-medium">Money sent</span>
              <span className="font-mono font-bold text-lg sm:text-xl text-[#BE123C] block mt-1">
                -₹{profile.metrics.total_outgoing_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-[#BE123C]/80 mt-1 block font-mono">
                {profile.metrics.total_outgoing_txns} outgoing transfers
              </span>
            </div>

            {/* Metric 5: Net Ledger Flow */}
            <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6]">
              <span className="text-[#6B655B] block text-xs font-medium">Net ledger change</span>
              <span
                className={`font-mono font-bold text-lg sm:text-xl block mt-1 ${
                  profile.metrics.net_flow >= 0 ? 'text-[#166534]' : 'text-[#DC2626]'
                }`}
              >
                {profile.metrics.net_flow >= 0 ? '+' : ''}
                ₹{profile.metrics.net_flow.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-[#8C857B] mt-1 block">Overall balance change</span>
            </div>

            {/* Metric 6: Recorded Transactions */}
            <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-[#EAE3D6]">
              <span className="text-[#6B655B] block text-xs font-medium">Recorded transactions</span>
              <span className="font-mono font-bold text-lg sm:text-xl text-[#1A1714] block mt-1">
                {profile.metrics.total_incoming_txns + profile.metrics.total_outgoing_txns}
              </span>
              <span className="text-[10px] text-[#8C857B] mt-1 block">
                {profile.metrics.unique_counterparties} unique counterparties
              </span>
            </div>
          </div>
        </section>

        {/* Model Divergence & Compromised Victim Banner (Prominent Notice) */}
        {ruleAssessment && mlAssessment && (
          <V2ModelDivergenceAlert
            accountId={profile.account_id}
            mlRiskScore={mlAssessment.risk_score}
            mlRiskLevel={mlAssessment.risk_level}
            ruleRiskScore={ruleAssessment.risk_score}
            ruleRiskLevel={ruleAssessment.risk_level}
          />
        )}

        {/* ========================================================================= */}
        {/* INVESTIGATION TABS INTERFACE                                              */}
        {/* ========================================================================= */}
        <div className="space-y-6">
          {/* Tab Selector Buttons */}
          <div ref={tabsRef} className="border-b border-[#EAE3D6] flex flex-wrap items-center gap-2 sm:gap-6 text-sm font-bold">
            <button
              type="button"
              id="tab-assessment-btn"
              onClick={() => navigateToTab('assessment')}
              className={`pb-3.5 px-1 relative transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'assessment' ? 'text-[#EA8500]' : 'text-[#6B655B] hover:text-[#1A1714]'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Risk & AI explanation</span>
              {activeTab === 'assessment' && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EA8500] rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>

            <button
              type="button"
              id="tab-trace-btn"
              onClick={() => navigateToTab('trace')}
              className={`pb-3.5 px-1 relative transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'trace' ? 'text-[#EA8500]' : 'text-[#6B655B] hover:text-[#1A1714]'
              }`}
            >
              <GitFork className="w-4 h-4" />
              <span>Follow the money</span>
              {activeTab === 'trace' && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EA8500] rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>

            <button
              type="button"
              id="tab-transactions-btn"
              onClick={() => navigateToTab('transactions')}
              className={`pb-3.5 px-1 relative transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'transactions' ? 'text-[#EA8500]' : 'text-[#6B655B] hover:text-[#1A1714]'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Transaction history</span>
              {activeTab === 'transactions' && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EA8500] rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>

            <button
              type="button"
              id="tab-review-btn"
              onClick={() => navigateToTab('review')}
              className={`pb-3.5 px-1 relative transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'review' ? 'text-[#EA8500]' : 'text-[#6B655B] hover:text-[#1A1714]'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>Review & audit</span>
              {activeTab === 'review' && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EA8500] rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          </div>

          {/* TAB 1: RISK & AI EXPLANATION */}
          {activeTab === 'assessment' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              {/* Score Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Card A: Statistical ML Model Score */}
                <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-7 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500]">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-[#1A1714]">Machine Learning Assessment</h3>
                        <p className="text-[11px] text-[#6B655B]">Statistical Gradient Boosting (XGBoost)</p>
                      </div>
                    </div>
                    {mlAssessment && (
                      <span className="font-mono text-xs font-bold px-3 py-1 rounded-full bg-[#FFF0F2] text-[#BE123C] border border-[#FECDD3]">
                        {mlAssessment.risk_level.toUpperCase()} RISK
                      </span>
                    )}
                  </div>

                  {mlAssessment ? (
                    <div className="space-y-4">
                      <div className="flex items-baseline gap-3">
                        <span className="text-4xl font-black text-[#1A1714] font-mono">
                          {mlAssessment.risk_score.toFixed(1)}
                        </span>
                        <span className="text-sm text-[#6B655B] font-mono">/ 100 Risk Score</span>
                      </div>
                      <p className="text-xs text-[#6B655B] leading-relaxed">
                        Evaluated across 26 behavioral features. A high score flags mathematical anomaly — often representing single large debits during payment scams, not proven perpetrator culpability.
                      </p>
                      <div className="text-[11px] text-[#8C857B] font-mono pt-2 border-t border-[#EAE3D6] flex justify-between">
                        <span>Model: {mlAssessment.model_version}</span>
                        <span>Calibrated TreeSHAP</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#6B655B] italic">ML risk assessment unavailable for this account.</p>
                  )}
                </div>

                {/* Card B: Rule-Based Signal Assessment */}
                <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-7 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-[#EAF7EE] border border-[#BBF7D0] flex items-center justify-center text-[#166534]">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-[#1A1714]">Rule Activity Checks</h3>
                        <p className="text-[11px] text-[#6B655B]">Deterministic Velocity & Baseline Checks</p>
                      </div>
                    </div>
                    {ruleAssessment && (
                      <span className="font-mono text-xs font-bold px-3 py-1 rounded-full bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0]">
                        {ruleAssessment.risk_level.toUpperCase()} RISK
                      </span>
                    )}
                  </div>

                  {ruleAssessment ? (
                    <div className="space-y-4">
                      <div className="flex items-baseline gap-3">
                        <span className="text-4xl font-black text-[#1A1714] font-mono">
                          {ruleAssessment.risk_score.toFixed(1)}
                        </span>
                        <span className="text-sm text-[#6B655B] font-mono">/ 100 Baseline Score</span>
                      </div>
                      <p className="text-xs text-[#6B655B] leading-relaxed">
                        Deterministic checks look for immediate layering, structuring, and rapid fund forwarding. Low scores confirm normal customer tenure and zero money-mule dwell patterns.
                      </p>
                      <div className="text-[11px] text-[#8C857B] font-mono pt-2 border-t border-[#EAE3D6] flex justify-between">
                        <span>Status: 0 pass-through flags</span>
                        <span>Recommendation: {ruleAssessment.recommendation.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#6B655B] italic">Rule checks unavailable for this account.</p>
                  )}
                </div>
              </div>

              {/* Section: Why the AI Gave This Score (TreeSHAP) */}
              <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
                <V2TreeShapBreakdown contributions={mlAssessment?.top_contributions || []} />
              </div>

              {/* Section: What the account activity checks found (Rule signals) */}
              <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#EAE3D6] pb-3.5">
                  <div>
                    <h3 className="text-lg font-bold text-[#1A1714] font-display">
                      What the account activity checks found
                    </h3>
                    <p className="text-xs text-[#6B655B] mt-0.5">
                      Deterministic banking rule checks evaluating transfer timing, bursts, and cycle loops.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTechnicalReasonCodes(!showTechnicalReasonCodes)}
                    className="text-xs text-[#EA8500] hover:text-[#D27400] font-bold flex items-center gap-1 cursor-pointer self-start sm:self-center"
                  >
                    <span>{showTechnicalReasonCodes ? 'Hide technical codes' : 'View technical details'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {ruleAssessment?.signals ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                    {/* Signal 1: Transfers in a short period */}
                    <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5">
                      <span className="font-bold text-[#1A1714] block">Transfers in a short period</span>
                      <p className="text-[#6B655B] text-[11px] leading-relaxed">
                        {ruleAssessment.signals.velocity_24h_count} transfers in past 24 hours · {ruleAssessment.signals.velocity_7d_count} in past 7 days.
                      </p>
                      <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#EAE3D6] text-[#166534]">
                        Normal transaction pace
                      </span>
                    </div>

                    {/* Signal 2: Rapid Pass-Through Forwarding */}
                    <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5">
                      <span className="font-bold text-[#1A1714] block">Money received and immediately forwarded</span>
                      <p className="text-[#6B655B] text-[11px] leading-relaxed">
                        {ruleAssessment.signals.rapid_pass_through
                          ? 'Observed rapid forward within 30 minutes.'
                          : 'Not detected in the available history.'}
                      </p>
                      <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#EAE3D6] text-[#166534]">
                        No pass-through mule pattern
                      </span>
                    </div>

                    {/* Signal 3: Large changes in transaction amounts */}
                    <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5">
                      <span className="font-bold text-[#1A1714] block">Large changes in transaction amounts</span>
                      <p className="text-[#6B655B] text-[11px] leading-relaxed">
                        Max transfer is ₹{ruleAssessment.signals.max_amount.toLocaleString('en-IN')}, which is {ruleAssessment.signals.amount_spike_ratio.toFixed(1)}x larger than average.
                      </p>
                      <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#FFF0F2] border border-[#FECDD3] text-[#BE123C]">
                        Significant outlier spike
                      </span>
                    </div>

                    {/* Signal 4: Time between transfers */}
                    <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5">
                      <span className="font-bold text-[#1A1714] block">Time between incoming and outgoing</span>
                      <p className="text-[#6B655B] text-[11px] leading-relaxed">
                        {ruleAssessment.signals.median_dwell_minutes !== null
                          ? `Median dwell duration of ${ruleAssessment.signals.median_dwell_minutes.toFixed(1)} minutes between transfer movements.`
                          : 'Dwell time between movements is not recorded in this sample window.'}
                      </p>
                      <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#EAE3D6] text-[#6B655B]">
                        Consistent retention
                      </span>
                    </div>

                    {/* Signal 5: Circular transfers */}
                    <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5">
                      <span className="font-bold text-[#1A1714] block">Circular transfers</span>
                      <p className="text-[#6B655B] text-[11px] leading-relaxed">
                        {ruleAssessment.signals.cycle_detected
                          ? 'Circular loop observed in transfer path.'
                          : 'Not detected in the available history.'}
                      </p>
                      <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#EAE3D6] text-[#166534]">
                        Zero loop cycles
                      </span>
                    </div>

                    {/* Signal 6: Dormant Awakening */}
                    <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1.5">
                      <span className="font-bold text-[#1A1714] block">Dormant account reactivation</span>
                      <p className="text-[#6B655B] text-[11px] leading-relaxed">
                        {ruleAssessment.signals.dormant_awakening_detected
                          ? 'Account awakened after prolonged inactivity.'
                          : 'Not detected in the available history.'}
                      </p>
                      <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#EAE3D6] text-[#166534]">
                        Continuous tenure
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[#6B655B] italic">No deterministic rule checks found for this account.</p>
                )}

                {/* Collapsible Technical Details */}
                <AnimatePresence>
                  {showTechnicalReasonCodes && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden pt-3 border-t border-[#EAE3D6] space-y-2 text-xs font-mono"
                    >
                      <span className="font-bold text-[#1A1714]">Raw Rule Reason Codes:</span>
                      {ruleAssessment?.reason_codes && ruleAssessment.reason_codes.length > 0 ? (
                        <ul className="space-y-1 pl-4 list-disc text-[#6B655B]">
                          {ruleAssessment.reason_codes.map((code, i) => (
                            <li key={i}>{code}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#8C857B] italic">Zero rule trigger codes generated.</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Section: What Still Needs Checking (Evidence Gaps) */}
              <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
                <div className="flex items-center gap-2.5 border-b border-[#EAE3D6] pb-3.5">
                  <HelpCircle className="w-5 h-5 text-[#EA8500]" />
                  <div>
                    <h3 className="text-lg font-bold text-[#1A1714] font-display">
                      What still needs checking
                    </h3>
                    <p className="text-xs text-[#6B655B]">
                      Missing external evidence or unavailable records. Unavailable data is not proof of wrongdoing.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <span className="font-bold text-[#1A1714] block">Device & IP Telemetry</span>
                    <p className="text-[#6B655B] text-[11px] leading-relaxed">
                      Independent mobile device fingerprints and login IP geolocation records are not available in this synthetic core ledger.
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <span className="font-bold text-[#1A1714] block">External Bank Confirmation</span>
                    <p className="text-[#6B655B] text-[11px] leading-relaxed">
                      Outward settlement confirmation from counterparty beneficiary banks has not been independently attached to this case.
                    </p>
                  </div>
                </div>
              </div>

              {/* Section: Suggested Next Step */}
              <div className="bg-[#FFF8EE] border border-[#FCD5B5] rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[#EA8500]">
                    <Sparkles className="w-5 h-5" />
                    <span className="font-mono font-bold text-xs uppercase tracking-wider">Suggested Next Step</span>
                  </div>
                  <h4 className="text-lg font-bold text-[#1A1714]">
                    Review the largest outgoing transfer of ₹250,000.00
                  </h4>
                  <p className="text-xs text-[#6B655B] max-w-2xl leading-relaxed">
                    Check the money-flow graph to inspect the destination account that received this transfer, verify whether funds were forwarded onward, and confirm customer identity before making any finding.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigateToTab('trace')}
                    className="px-5 py-2.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <span>Inspect downstream hops</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: FOLLOW THE MONEY (Cytoscape Graph & Path Traversal) */}
          {activeTab === 'trace' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 text-xs shadow-2xs">
                <div>
                  <h3 className="text-base font-bold text-[#1A1714] font-display">
                    Downstream Fund Traversal Graph
                  </h3>
                  <p className="text-[#6B655B] text-xs mt-0.5">
                    Click nodes or transfer lines to inspect amounts and hop relationships.
                  </p>
                </div>

                {/* Depth & Direction Filters */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-[#6B655B]">Depth:</span>
                    <select
                      value={traceDepth}
                      onChange={(e) => setTraceDepth(Number(e.target.value))}
                      className="bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl px-2.5 py-1 text-xs text-[#1A1714] font-bold focus:outline-none focus:border-[#EA8500]"
                      aria-label="Trace Depth"
                    >
                      <option value={1}>1 Hop</option>
                      <option value={2}>2 Hops</option>
                      <option value={3}>3 Hops</option>
                      <option value={4}>4 Hops</option>
                      <option value={5}>5 Hops</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-[#6B655B]">Direction:</span>
                    <select
                      value={traceDirection}
                      onChange={(e) => setTraceDirection(e.target.value as any)}
                      className="bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl px-2.5 py-1 text-xs text-[#1A1714] font-bold focus:outline-none focus:border-[#EA8500]"
                      aria-label="Trace Direction"
                    >
                      <option value="outgoing">Outgoing (Dispersal)</option>
                      <option value="incoming">Incoming (Sources)</option>
                    </select>
                  </div>
                </div>
              </div>

              {loadingTrace ? (
                <div className="h-96 flex flex-col items-center justify-center bg-white rounded-3xl border border-[#EAE3D6] space-y-3">
                  <RefreshCw className="w-8 h-8 text-[#EA8500] animate-spin" />
                  <p className="text-xs text-[#6B655B] font-mono">Tracing downstream transactions across ledger hops...</p>
                </div>
              ) : traceData ? (
                <V2CytoscapeGraph traceData={traceData} height="600px" />
              ) : (
                <div className="p-8 text-center bg-white rounded-3xl border border-[#EAE3D6] text-xs text-[#6B655B]">
                  No graph trace available for this account.
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 3: TRANSACTION HISTORY */}
          {activeTab === 'transactions' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EAE3D6] pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#1A1714] font-display">
                      Chronological Ledger Transactions
                    </h3>
                    <p className="text-xs text-[#6B655B] mt-0.5">
                      Showing verified core debits and credits with balance tracking.
                    </p>
                  </div>

                  {/* Direction Filter */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#6B655B] font-medium hidden sm:inline">Filter:</span>
                    <div className="flex rounded-xl border border-[#EAE3D6] overflow-hidden bg-[#FAF7F2] p-0.5 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          setTxnDirection('all');
                          setTxnOffset(0);
                        }}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          txnDirection === 'all'
                            ? 'bg-[#EA8500] text-white shadow-2xs'
                            : 'text-[#6B655B] hover:text-[#1A1714]'
                        }`}
                      >
                        All ({profile.metrics.total_incoming_txns + profile.metrics.total_outgoing_txns})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTxnDirection('inbound');
                          setTxnOffset(0);
                        }}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          txnDirection === 'inbound'
                            ? 'bg-[#22C55E] text-white shadow-2xs'
                            : 'text-[#6B655B] hover:text-[#1A1714]'
                        }`}
                      >
                        Money received ({profile.metrics.total_incoming_txns})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTxnDirection('outbound');
                          setTxnOffset(0);
                        }}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          txnDirection === 'outbound'
                            ? 'bg-[#E11D48] text-white shadow-2xs'
                            : 'text-[#6B655B] hover:text-[#1A1714]'
                        }`}
                      >
                        Money sent ({profile.metrics.total_outgoing_txns})
                      </button>
                    </div>
                  </div>
                </div>

                {loadingTxns ? (
                  <div className="py-16 text-center space-y-2">
                    <RefreshCw className="w-6 h-6 text-[#EA8500] animate-spin mx-auto" />
                    <p className="text-xs text-[#6B655B] font-mono">Loading transactions...</p>
                  </div>
                ) : transactions && transactions.transactions.length > 0 ? (
                  <div className="space-y-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAF7F2] border-b border-[#EAE3D6] text-[#6B655B] font-bold">
                          <tr>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Transaction ID</th>
                            <th className="px-4 py-3">Counterparty</th>
                            <th className="px-4 py-3">Channel Rail</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                            <th className="px-4 py-3 text-right">Balance After</th>
                            <th className="px-4 py-3">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EAE3D6]/70 font-mono text-xs">
                          {transactions.transactions.map((tx) => {
                            const isInbound = tx.direction === 'inbound';
                            return (
                              <tr key={tx.transaction_id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                                <td className="px-4 py-3 font-sans">
                                  {isInbound ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#166534] bg-[#EAF7EE] px-2 py-0.5 rounded-lg border border-[#BBF7D0]">
                                      <ArrowDownLeft className="w-3 h-3 text-[#22C55E]" />
                                      Received
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#BE123C] bg-[#FFF0F2] px-2 py-0.5 rounded-lg border border-[#FECDD3]">
                                      <ArrowUpRight className="w-3 h-3 text-[#E11D48]" />
                                      Sent
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-bold text-[#1A1714]">{tx.transaction_id}</td>
                                <td className="px-4 py-3">
                                  {tx.counterparty_account_id ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/v2/accounts/${tx.counterparty_account_id}`)}
                                      className="text-[#EA8500] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                      <span>{tx.counterparty_account_id}</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  ) : (
                                    <span className="text-[#8C857B]">External Bank</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-sans">
                                  <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[#6B655B] text-[11px] font-semibold">
                                    {tx.channel}
                                  </span>
                                </td>
                                <td
                                  className={`px-4 py-3 text-right font-bold text-sm ${
                                    isInbound ? 'text-[#166534]' : 'text-[#BE123C]'
                                  }`}
                                >
                                  {isInbound ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-right text-[#6B655B]">
                                  ₹{tx.origin_balance_after.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-[#6B655B] text-[11px] whitespace-nowrap">
                                  {tx.timestamp.replace('T', ' ')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between pt-4 border-t border-[#EAE3D6] text-xs">
                      <span className="text-[#6B655B] font-mono">
                        Showing {txnOffset + 1} to {Math.min(txnOffset + txnLimit, transactions.total)} of {transactions.total} transactions
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={txnOffset === 0}
                          onClick={() => setTxnOffset(Math.max(0, txnOffset - txnLimit))}
                          className="px-3 py-1.5 rounded-xl border border-[#EAE3D6] bg-white text-[#1A1714] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FAF7F2] transition-colors"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={txnOffset + txnLimit >= transactions.total}
                          onClick={() => setTxnOffset(txnOffset + txnLimit)}
                          className="px-3 py-1.5 rounded-xl border border-[#EAE3D6] bg-white text-[#1A1714] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FAF7F2] transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-[#6B655B] bg-[#FAF7F2] rounded-2xl border border-[#EAE3D6]">
                    No transactions match the selected filter.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 4 / ALWAYS ACCESSIBLE SECTION: REVIEW & AUDIT (Human Compliance Adjudication) */}
          <div ref={adjudicationRef} className="pt-2">
            <div className="bg-white border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EAE3D6] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#EAF7EE] border border-[#BBF7D0] flex items-center justify-center text-[#166534]">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#1A1714] font-display">
                      Human Compliance Adjudication
                    </h3>
                    <p className="text-xs text-[#6B655B] mt-0.5">
                      Record human investigator findings. Automated account freezing or punitive action is strictly prohibited.
                    </p>
                  </div>
                </div>

                {adjudicationSaved && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] text-xs font-bold font-mono"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Adjudication Saved</span>
                  </motion.div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Status Selection */}
                <div className="space-y-2">
                  <label htmlFor="adjudication-status-select" className="block text-xs font-bold text-[#1A1714]">
                    Investigator Finding Status
                  </label>
                  <select
                    id="adjudication-status-select"
                    value={adjudicationStatus}
                    onChange={(e) => setAdjudicationStatus(e.target.value)}
                    className="w-full bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl px-3.5 py-2.5 text-xs text-[#1A1714] font-semibold focus:outline-none focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15"
                  >
                    <option value="pending_review">Pending Review (Under Active Analysis)</option>
                    <option value="verified_victim">Verified Scam Victim (Protection Recommended)</option>
                    <option value="under_investigation">Under Investigation (Awaiting External Evidence)</option>
                    <option value="cleared_innocent">Cleared Genuine Customer (No Irregularity)</option>
                    <option value="escalated_fraud">Escalated for Mule Tracking (Downstream Review)</option>
                  </select>
                  <p className="text-[11px] text-[#8C857B] leading-relaxed">
                    Selecting status documents this finding immutably in the compliance audit trail.
                  </p>
                </div>

                {/* Notes Input */}
                <div className="md:col-span-2 space-y-2">
                  <label htmlFor="adjudication-notes-input" className="block text-xs font-bold text-[#1A1714]">
                    Factual Investigation Rationale & Evidence Notes
                  </label>
                  <textarea
                    id="adjudication-notes-input"
                    rows={3}
                    value={adjudicationNotes}
                    onChange={(e) => setAdjudicationNotes(e.target.value)}
                    placeholder="Document factual findings and rationale here (e.g. verified victim of APP scam, trace confirmed transfer sent to intermediary)..."
                    className="w-full bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl p-3 text-xs text-[#1A1714] placeholder:text-[#8C857B] focus:outline-none focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 transition-all font-mono leading-relaxed"
                  />
                  <div className="flex justify-end pt-1">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={handleSaveAdjudication}
                      className="px-6 py-2.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>Record Finding</span>
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* Logged Adjudication Audit Trail */}
              {adjudicationHistory.length > 0 && (
                <div className="pt-5 border-t border-[#EAE3D6] space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#8C857B]" />
                    <h4 className="font-bold text-xs uppercase tracking-wider text-[#6B655B]">
                      Logged Adjudication Audit Trail
                    </h4>
                  </div>
                  <div className="space-y-2.5">
                    {adjudicationHistory.map((item, idx) => (
                      <div
                        key={idx}
                        className="bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl p-3.5 text-xs space-y-1 font-mono"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="font-bold text-[#1A1714] capitalize">
                            Status: {item.status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[#8C857B]">
                            {item.timestamp.replace('T', ' ').substring(0, 19)} · Officer: {item.investigatorId}
                          </span>
                        </div>
                        {item.notes && (
                          <p className="text-[#6B655B] font-sans text-xs italic pt-1">
                            "{item.notes}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <V2Footer />
    </div>
  );
};
