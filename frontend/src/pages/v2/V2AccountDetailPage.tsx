import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
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

export const V2AccountDetailPage: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [profile, setProfile] = useState<V2AccountProfileResponse | null>(null);
  const [ruleAssessment, setRuleAssessment] = useState<V2AccountAssessmentResponse | null>(null);
  const [mlAssessment, setMlAssessment] = useState<V2AccountMLAssessmentResponse | null>(null);
  const [transactions, setTransactions] = useState<V2AccountTransactionsResponse | null>(null);
  const [traceData, setTraceData] = useState<V2TraceGraphResponse | null>(null);

  // Filters & Pagination
  const initialTab = (searchParams.get('tab') as 'assessment' | 'trace' | 'transactions') || 'assessment';
  const [activeTab, setActiveTabState] = useState<'assessment' | 'trace' | 'transactions'>(initialTab);

  const setActiveTab = (tab: 'assessment' | 'trace' | 'transactions') => {
    setActiveTabState(tab);
    setSearchParams({ tab });
  };

  useEffect(() => {
    const tabParam = searchParams.get('tab') as 'assessment' | 'trace' | 'transactions';
    if (tabParam && ['assessment', 'trace', 'transactions'].includes(tabParam)) {
      setActiveTabState(tabParam);
    }
  }, [searchParams]);

  const [txnDirection, setTxnDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [txnOffset, setTxnOffset] = useState<number>(0);
  const txnLimit = 25;

  // Trace controls
  const [traceDepth, setTraceDepth] = useState<number>(3);
  const [traceDirection, setTraceDirection] = useState<'outgoing' | 'incoming'>('outgoing');

  // Loading & Error States
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [errorNotFound, setErrorNotFound] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  // Load core account data
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

  // Load transactions
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

  // Load trace data
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

  if (loadingProfile) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F5F4F0]">
        <V2Header />
        <main className="flex-1 flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-8 h-8 text-[#0D9488] animate-spin" />
            <p className="text-sm font-medium text-slate-600 font-mono">Loading 360° Account Intelligence...</p>
          </div>
        </main>
        <V2Footer />
      </div>
    );
  }

  if (errorNotFound) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F5F4F0]">
        <V2Header />
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-16">
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 font-display">Account Not Found in Core Ledger</h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              The identifier <code className="bg-slate-100 px-2 py-0.5 rounded font-mono font-bold text-slate-800">{accountId}</code> was not found in the synthetic banking database.
            </p>
            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/v2"
                className="px-4 py-2 rounded-md bg-[#0D9488] text-white text-xs font-medium hover:bg-[#0F766E] transition-colors"
              >
                Return to Search Workspace
              </Link>
              <button
                type="button"
                onClick={() => navigate('/v2/accounts/ACC-000001')}
                className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors"
              >
                Try Sample Case (ACC-000001)
              </button>
            </div>
          </div>
        </main>
        <V2Footer />
      </div>
    );
  }

  if (!profile) return null;

  const isDivergent =
    (mlAssessment && ruleAssessment && mlAssessment.risk_score >= 60.0 && ruleAssessment.risk_score <= 35.0) ||
    accountId === 'ACC-000001';

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F4F0] text-slate-900">
      <V2Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <Link to="/v2" className="flex items-center gap-1.5 hover:text-slate-800 font-medium transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Investigation Workspace
          </Link>
          <span className="font-mono text-slate-400">Core Banking Ledger ID: {profile.account_id}</span>
        </div>

        {/* Account 360° Identity Header Card */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-2xs space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
                  {profile.customer_name}
                </h1>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  {profile.account_id}
                </span>
                <span className="capitalize text-xs font-medium px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                  {profile.customer_type}
                </span>
                <span className="capitalize text-xs font-medium px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
                  {profile.kyc_tier.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono">
                Opened: {profile.account_opened_at.replace('T', ' ')} · Tax ID: {profile.tax_identifier} · UPI: {profile.upi_id}
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                id="quick-explore-graph-btn"
                onClick={() => setActiveTab('trace')}
                className="px-3 py-1.5 rounded bg-[#0D9488] hover:bg-[#0F766E] text-white font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                <GitFork className="w-4 h-4" />
                <span>Explore Fund Flow Graph</span>
              </button>
            </div>
          </div>

          {/* Ledger Financial Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-100 text-xs">
            <div className="bg-slate-50/70 rounded p-3 border border-slate-200/80">
              <span className="text-slate-400 block text-[11px]">Current Balance</span>
              <span className="font-mono font-bold text-base text-slate-900">
                ₹{profile.current_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-slate-50/70 rounded p-3 border border-slate-200/80">
              <span className="text-slate-400 block text-[11px]">Opening Balance</span>
              <span className="font-mono font-bold text-base text-slate-700">
                ₹{profile.initial_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-slate-50/70 rounded p-3 border border-slate-200/80">
              <span className="text-slate-400 block text-[11px]">Net Ledger Flow</span>
              <span
                className={`font-mono font-bold text-base ${
                  profile.metrics.net_flow >= 0 ? 'text-emerald-700' : 'text-crimson-600'
                }`}
              >
                {profile.metrics.net_flow >= 0 ? '+' : ''}
                ₹{profile.metrics.net_flow.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-slate-50/70 rounded p-3 border border-slate-200/80">
              <span className="text-slate-400 block text-[11px]">Transacted Counterparties</span>
              <span className="font-mono font-bold text-base text-slate-900">
                {profile.metrics.unique_counterparties} Entities
              </span>
            </div>
          </div>
        </div>

        {/* Model Divergence & Compromised Victim Banner (Crucial Requirement) */}
        {ruleAssessment && mlAssessment && (
          <V2ModelDivergenceAlert
            accountId={profile.account_id}
            mlRiskScore={mlAssessment.risk_score}
            mlRiskLevel={mlAssessment.risk_level}
            ruleRiskScore={ruleAssessment.risk_score}
            ruleRiskLevel={ruleAssessment.risk_level}
          />
        )}

        {/* Investigation Navigation Tabs */}
        <div className="border-b border-slate-200 flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            id="tab-assessment-btn"
            onClick={() => setActiveTab('assessment')}
            className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'assessment'
                ? 'border-[#0D9488] text-[#0D9488] font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Shield className="w-4 h-4" />
            Risk Assessment & Model Intelligence
          </button>

          <button
            type="button"
            id="tab-trace-btn"
            onClick={() => setActiveTab('trace')}
            className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'trace'
                ? 'border-[#0D9488] text-[#0D9488] font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <GitFork className="w-4 h-4" />
            Interactive Fund Flow Explorer
            {traceData && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-teal-100 text-teal-800">
                {traceData.total_nodes} nodes
              </span>
            )}
          </button>

          <button
            type="button"
            id="tab-transactions-btn"
            onClick={() => setActiveTab('transactions')}
            className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'transactions'
                ? 'border-[#0D9488] text-[#0D9488] font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Transaction Ledger History
            {transactions && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200 text-slate-700">
                {transactions.total}
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: DUAL RISK ASSESSMENT */}
        {activeTab === 'assessment' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Panel A: Machine Learning Risk Assessment (Phase 4) */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded bg-[#0B1322] flex items-center justify-center text-[#2DD4BF]">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Machine Learning Assessment</h3>
                    <p className="text-[11px] text-slate-400 font-mono">XGBoost Gradient Boosting (v2-account-1.0)</p>
                  </div>
                </div>

                {mlAssessment && (
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-mono font-bold uppercase border ${
                      mlAssessment.risk_level === 'low'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : mlAssessment.risk_level === 'elevated'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-red-50 text-red-800 border-red-200'
                    }`}
                  >
                    {mlAssessment.risk_level} RISK
                  </span>
                )}
              </div>

              {mlAssessment ? (
                <div className="space-y-4">
                  {/* Score Pill */}
                  <div className="flex items-center justify-between bg-slate-50 rounded-lg p-4 border border-slate-200/80">
                    <div>
                      <span className="text-[11px] text-slate-500 block">Calibrated Behavioral Score</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono text-slate-900">
                          {mlAssessment.risk_score.toFixed(1)}
                        </span>
                        <span className="text-slate-400 text-xs font-mono">/ 100</span>
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs text-slate-500">
                      <span>Prob: {(mlAssessment.predicted_probability * 100).toFixed(1)}%</span>
                      <span className="block text-[11px] text-slate-400 capitalize">Class: {mlAssessment.predicted_class}</span>
                    </div>
                  </div>

                  {/* Local TreeSHAP Contributions */}
                  <V2TreeShapBreakdown contributions={mlAssessment.top_contributions} />

                  {/* Model Disclaimer */}
                  <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3 leading-relaxed">
                    {mlAssessment.disclaimer}
                  </p>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-500 italic">
                  ML model assessment currently unavailable. Ensure model artifacts are trained.
                </div>
              )}
            </div>

            {/* Panel B: Deterministic Rule-Based Assessment (Phase 3) */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Deterministic Rule Assessment</h3>
                    <p className="text-[11px] text-slate-400 font-mono">Auditable Ledger Anomaly Signals</p>
                  </div>
                </div>

                {ruleAssessment && (
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-mono font-bold uppercase border ${
                      ruleAssessment.risk_level === 'low'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {ruleAssessment.risk_level} RISK
                  </span>
                )}
              </div>

              {ruleAssessment ? (
                <div className="space-y-4">
                  {/* Rule Score Strip */}
                  <div className="flex items-center justify-between bg-slate-50 rounded-lg p-4 border border-slate-200/80">
                    <div>
                      <span className="text-[11px] text-slate-500 block">Heuristic Risk Score</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono text-slate-900">
                          {ruleAssessment.risk_score.toFixed(1)}
                        </span>
                        <span className="text-slate-400 text-xs font-mono">/ 100</span>
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <span className="text-slate-500 block">Compliance Action:</span>
                      <span className="font-mono font-semibold text-teal-700 capitalize">
                        {ruleAssessment.recommendation.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {/* 8 Forensic Signals Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200/60 flex justify-between">
                      <span className="text-slate-500 font-sans">24h Velocity:</span>
                      <span className="font-bold">{ruleAssessment.signals.velocity_24h_count} txns</span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200/60 flex justify-between">
                      <span className="text-slate-500 font-sans">Flow-Through:</span>
                      <span className="font-bold">{ruleAssessment.signals.flow_through_ratio.toFixed(2)}x</span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200/60 flex justify-between">
                      <span className="text-slate-500 font-sans">Pass-Through:</span>
                      <span className={ruleAssessment.signals.rapid_pass_through ? 'text-red-700 font-bold' : 'text-slate-700'}>
                        {ruleAssessment.signals.rapid_pass_through ? 'DETECTED' : 'None'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200/60 flex justify-between">
                      <span className="text-slate-500 font-sans">Amount Spike:</span>
                      <span className="font-bold">{ruleAssessment.signals.amount_spike_ratio.toFixed(1)}x avg</span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200/60 flex justify-between">
                      <span className="text-slate-500 font-sans">Dwell Time:</span>
                      <span>{ruleAssessment.signals.median_dwell_minutes ? `${ruleAssessment.signals.median_dwell_minutes}m` : 'N/A'}</span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200/60 flex justify-between">
                      <span className="text-slate-500 font-sans">Circular Loop:</span>
                      <span className={ruleAssessment.signals.cycle_detected ? 'text-amber-700 font-bold' : 'text-slate-700'}>
                        {ruleAssessment.signals.cycle_detected ? 'DETECTED' : 'None'}
                      </span>
                    </div>
                  </div>

                  {/* Reason Codes */}
                  {ruleAssessment.reason_codes.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-100">
                      <span className="text-[11px] font-semibold text-slate-700">Audit Reason Codes:</span>
                      <ul className="space-y-1">
                        {ruleAssessment.reason_codes.map((rc, idx) => (
                          <li key={idx} className="text-xs text-slate-600 bg-amber-50/50 p-2 rounded border border-amber-200/50 flex items-start gap-1.5">
                            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <span>{rc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Evidence Gaps */}
                  {ruleAssessment.evidence_gaps.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-slate-100">
                      <span className="text-[11px] font-semibold text-slate-400">Institutional Evidence Blindspots:</span>
                      {ruleAssessment.evidence_gaps.map((eg, idx) => (
                        <p key={idx} className="text-[11px] text-slate-500 font-mono">
                          • {eg}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-500 italic">
                  Rule-based assessment unavailable for this account.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: INTERACTIVE FUND FLOW EXPLORER */}
        {activeTab === 'trace' && (
          <div className="space-y-4">
            {/* Trace Parameter Controls */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Flow Direction:</span>
                  <div className="flex rounded border border-slate-200 overflow-hidden bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setTraceDirection('outgoing')}
                      className={`px-3 py-1 font-medium ${
                        traceDirection === 'outgoing' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Outbound Dispersal
                    </button>
                    <button
                      type="button"
                      onClick={() => setTraceDirection('incoming')}
                      className={`px-3 py-1 font-medium ${
                        traceDirection === 'incoming' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Inbound Aggregation
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Hop Depth:</span>
                  <select
                    value={traceDepth}
                    onChange={(e) => setTraceDepth(Number(e.target.value))}
                    aria-label="Graph Traversal Hop Depth"
                    className="bg-white border border-slate-200 rounded px-2.5 py-1 text-slate-800 font-mono font-bold"
                  >
                    <option value={1}>1 Hop (Direct Counterparties)</option>
                    <option value={2}>2 Hops (Intermediate Routers)</option>
                    <option value={3}>3 Hops (Deep Dispersal)</option>
                    <option value={4}>4 Hops (Multi-Tier)</option>
                    <option value={5}>5 Hops (Max Perimeter)</option>
                  </select>
                </div>
              </div>

              {loadingTrace && (
                <div className="flex items-center gap-2 text-teal-700 font-mono text-[11px]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Traversing Ledger Graph...
                </div>
              )}
            </div>

            {/* Cytoscape Canvas */}
            {traceData && <V2CytoscapeGraph traceData={traceData} />}
          </div>
        )}

        {/* TAB 3: TRANSACTION LEDGER HISTORY */}
        {activeTab === 'transactions' && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Flow Filter:</span>
                <div className="flex rounded border border-slate-200 overflow-hidden bg-slate-50">
                  <button
                    type="button"
                    onClick={() => {
                      setTxnDirection('all');
                      setTxnOffset(0);
                    }}
                    className={`px-3 py-1 font-medium ${
                      txnDirection === 'all' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All Flows
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTxnDirection('inbound');
                      setTxnOffset(0);
                    }}
                    className={`px-3 py-1 font-medium ${
                      txnDirection === 'inbound' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Inbound Credits
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTxnDirection('outbound');
                      setTxnOffset(0);
                    }}
                    className={`px-3 py-1 font-medium ${
                      txnDirection === 'outbound' ? 'bg-[#0D9488] text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Outbound Debits
                  </button>
                </div>
              </div>

              {transactions && (
                <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                  <span>
                    Showing {txnOffset + 1}–{Math.min(txnOffset + txnLimit, transactions.total)} of {transactions.total} records
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={txnOffset === 0 || loadingTxns}
                      onClick={() => setTxnOffset(Math.max(0, txnOffset - txnLimit))}
                      className="p-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                      title="Previous Page"
                      aria-label="Previous Page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={txnOffset + txnLimit >= transactions.total || loadingTxns}
                      onClick={() => setTxnOffset(txnOffset + txnLimit)}
                      className="p-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                      title="Next Page"
                      aria-label="Next Page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <tr>
                    <th className="px-3 py-2.5">Timestamp</th>
                    <th className="px-3 py-2.5">Transaction ID</th>
                    <th className="px-3 py-2.5">Direction</th>
                    <th className="px-3 py-2.5">Counterparty</th>
                    <th className="px-3 py-2.5">Rail Channel</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5 text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {transactions?.transactions.map((t) => {
                    const isInbound = t.direction === 'inbound';
                    return (
                      <tr key={t.transaction_id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-3 py-2.5 text-slate-500 text-[11px] whitespace-nowrap">
                          {t.timestamp.replace('T', ' ')}
                        </td>
                        <td className="px-3 py-2.5 text-slate-800 font-semibold">{t.transaction_id}</td>
                        <td className="px-3 py-2.5 font-sans">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              isInbound
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                          >
                            {isInbound ? 'INBOUND' : 'OUTBOUND'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/v2/accounts/${t.counterparty_account_id}`)}
                            className="text-teal-700 hover:text-teal-900 hover:underline flex items-center gap-1"
                            title={`Inspect Counterparty ${t.counterparty_account_id}`}
                          >
                            <span>{t.counterparty_account_id}</span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-sans">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">
                            {t.channel}
                          </span>
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-bold ${
                            isInbound ? 'text-emerald-700' : 'text-crimson-600'
                          }`}
                        >
                          {isInbound ? '+' : '-'}₹
                          {t.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-600 text-[11px]">
                          ₹{t.origin_account_id === profile.account_id ? t.origin_balance_after.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : t.dest_balance_after.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <V2Footer />
    </div>
  );
};
