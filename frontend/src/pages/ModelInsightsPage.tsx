import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldAlert,
  Cpu,
  Activity,
  Layers,
  Database,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Info,
  HelpCircle,
  TrendingUp,
  ArrowRight,
  Search,
  ExternalLink,
  Lock,
  BarChart3,
  GitBranch,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
} from 'recharts';
import { v2Api } from '../services/v2Api';
import { V2ModelStatusResponse, V2SingleModelInfo, V2AccountMLAssessmentResponse } from '../types/v2';
import { accountEvaluation, formatModelScore, modelThreshold, thresholdPercent } from '../lib/modelScore';

// -----------------------------------------------------------------------------
// Verified Feature Definitions & Glossaries
// -----------------------------------------------------------------------------

interface FeatureGlossaryEntry {
  name: string;
  category: 'network' | 'profile' | 'amount' | 'velocity';
  label: string;
  description: string;
}

const ACCOUNT_FEATURE_GLOSSARY: Record<string, FeatureGlossaryEntry> = {
  velocity_30d_count: {
    name: 'velocity_30d_count',
    category: 'velocity',
    label: '30-Day Transfer Frequency',
    description: 'Total transfer count involving this account over the preceding 30-day window.',
  },
  customer_type_student: {
    name: 'customer_type_student',
    category: 'profile',
    label: 'Student Account Indicator',
    description: 'Whether the account is registered as a student account.',
  },
  max_amount: {
    name: 'max_amount',
    category: 'amount',
    label: 'Peak Transaction Amount',
    description: 'Largest single inbound or outbound transaction recorded in the account history.',
  },
  initial_balance: {
    name: 'initial_balance',
    category: 'amount',
    label: 'Initial Ledger Balance',
    description: 'Baseline account ledger balance prior to observed transaction activity.',
  },
  rapid_pass_through: {
    name: 'rapid_pass_through',
    category: 'network',
    label: 'Rapid Pass-Through Flag',
    description: 'Binary signal indicating incoming funds were immediately dispersed within minutes.',
  },
  amount_spike_ratio: {
    name: 'amount_spike_ratio',
    category: 'amount',
    label: 'Amount Spike Multiple',
    description: 'Ratio between peak transfer amount and the average historical transaction volume.',
  },
  avg_amount: {
    name: 'avg_amount',
    category: 'amount',
    label: 'Average Transfer Size',
    description: 'Mean monetary value of transactions across the active observation period.',
  },
  total_transactions: {
    name: 'total_transactions',
    category: 'velocity',
    label: 'Total Lifetime Transactions',
    description: 'Cumulative transaction count across all hops and payment channels.',
  },
  flow_through_ratio: {
    name: 'flow_through_ratio',
    category: 'network',
    label: 'Flow-Through Ratio',
    description: 'Ratio of total funds sent to total funds received (values near 1.0 indicate mule pass-through).',
  },
  kyc_tier_level: {
    name: 'kyc_tier_level',
    category: 'profile',
    label: 'KYC Assurance Tier',
    description: 'Regulatory customer verification level (Tier 1 simplified to Tier 3 full biometrics).',
  },
  fan_in_ratio: {
    name: 'fan_in_ratio',
    category: 'network',
    label: 'Fan-In Senders Ratio',
    description: 'Proportion of distinct incoming senders vs total counterparties (identifies pooling accounts).',
  },
  velocity_24h_count: {
    name: 'velocity_24h_count',
    category: 'velocity',
    label: '24-Hour Velocity Burst',
    description: 'Transaction volume spike in the most recent 24-hour window.',
  },
  balance_ratio: {
    name: 'balance_ratio',
    category: 'amount',
    label: 'Current-to-Initial Balance Ratio',
    description: 'Ratio of current balance to initial baseline balance.',
  },
  fan_out_ratio: {
    name: 'fan_out_ratio',
    category: 'network',
    label: 'Fan-Out Recipients Ratio',
    description: 'Proportion of distinct outgoing recipients (identifies distribution mules).',
  },
  current_balance: {
    name: 'current_balance',
    category: 'amount',
    label: 'Current Ledger Balance',
    description: 'Present available balance recorded at inspection time.',
  },
  median_dwell_minutes: {
    name: 'median_dwell_minutes',
    category: 'velocity',
    label: 'Median Funds Dwell Time',
    description: 'Median duration funds remain in account before subsequent outbound transfer.',
  },
  velocity_7d_count: {
    name: 'velocity_7d_count',
    category: 'velocity',
    label: '7-Day Velocity Count',
    description: 'Total transfer count recorded over the preceding 7-day period.',
  },
  unique_counterparties: {
    name: 'unique_counterparties',
    category: 'network',
    label: 'Distinct Counterparties Count',
    description: 'Total unique accounts sending to or receiving funds from this entity.',
  },
  customer_type_sme: {
    name: 'customer_type_sme',
    category: 'profile',
    label: 'SME Commercial Account',
    description: 'Classification for registered small-and-medium enterprise commercial accounts.',
  },
  customer_type_retail: {
    name: 'customer_type_retail',
    category: 'profile',
    label: 'Retail Consumer Account',
    description: 'Standard retail consumer personal banking account.',
  },
  customer_type_corporate: {
    name: 'customer_type_corporate',
    category: 'profile',
    label: 'Corporate Institutional Account',
    description: 'Large enterprise corporate treasury or operational account.',
  },
  has_dwell_time: {
    name: 'has_dwell_time',
    category: 'velocity',
    label: 'Dwell Time Measurable',
    description: 'Indicator that both inbound and outbound legs exist to compute dwell duration.',
  },
  counterparty_diversity_ratio: {
    name: 'counterparty_diversity_ratio',
    category: 'network',
    label: 'Counterparty Diversity',
    description: 'Entropy of counterparty distribution across transfer volume.',
  },
  dormancy_gap_days: {
    name: 'dormancy_gap_days',
    category: 'velocity',
    label: 'Dormancy Inactivity Span',
    description: 'Longest period of inactivity in days preceding sudden reactivation.',
  },
  dormant_awakening_detected: {
    name: 'dormant_awakening_detected',
    category: 'velocity',
    label: 'Dormant Account Awakening',
    description: 'Abrupt reactivation of an inactive account with high-value transfers.',
  },
  cycle_detected: {
    name: 'cycle_detected',
    category: 'network',
    label: 'Circular Flow Topology',
    description: 'Closed circular loop detected in graph traversal (layering signature).',
  },
};

const PAYSIM_FEATURE_GLOSSARY: Record<string, FeatureGlossaryEntry> = {
  amount_to_oldbalanceOrg_ratio: {
    name: 'amount_to_oldbalanceOrg_ratio',
    category: 'amount',
    label: 'Amount-to-Balance Ratio',
    description: 'Transfer amount divided by the origin sender account pre-transaction balance.',
  },
  step_hour: {
    name: 'step_hour',
    category: 'velocity',
    label: 'Hour of Day (0–23)',
    description: 'Chronological hour index within the 24-hour cycle of the transaction.',
  },
  type_PAYMENT: {
    name: 'type_PAYMENT',
    category: 'profile',
    label: 'Payment Rail',
    description: 'Standard consumer merchant point-of-sale payment transfer rail.',
  },
  type_TRANSFER: {
    name: 'type_TRANSFER',
    category: 'profile',
    label: 'Transfer Rail',
    description: 'Peer-to-peer bank transfer rail (primary vehicle for unauthorized fraud).',
  },
  amount: {
    name: 'amount',
    category: 'amount',
    label: 'Transaction Amount',
    description: 'Nominal transfer amount in simulation currency units.',
  },
  type_CASH_OUT: {
    name: 'type_CASH_OUT',
    category: 'profile',
    label: 'Cash-Out Rail',
    description: 'Agent liquidation or cash withdrawal rail (primary fraud destination).',
  },
  oldbalanceOrg: {
    name: 'oldbalanceOrg',
    category: 'amount',
    label: 'Sender Pre-TX Balance',
    description: 'Verified balance of origin sender account before transaction processing.',
  },
  type_CASH_IN: {
    name: 'type_CASH_IN',
    category: 'profile',
    label: 'Cash-In Rail',
    description: 'Deposit transaction through banking agent or cash counter.',
  },
  oldbalanceDest: {
    name: 'oldbalanceDest',
    category: 'amount',
    label: 'Receiver Pre-TX Balance',
    description: 'Verified balance of recipient account before settlement clearance.',
  },
  step: {
    name: 'step',
    category: 'velocity',
    label: 'Simulation Step Index',
    description: 'Chronological timeline step counter (1 step = 1 hour).',
  },
  is_dest_zero_balance: {
    name: 'is_dest_zero_balance',
    category: 'amount',
    label: 'Recipient Pre-Balance Zero Flag',
    description: 'Binary flag indicating receiver had zero balance prior to transfer.',
  },
  is_origin_zero_balance: {
    name: 'is_origin_zero_balance',
    category: 'amount',
    label: 'Sender Pre-Balance Zero Flag',
    description: 'Binary flag indicating sender account had zero balance prior to transfer.',
  },
  step_day: {
    name: 'step_day',
    category: 'velocity',
    label: 'Day of Week Index',
    description: 'Simulated day cycle index (step modulo 24).',
  },
  type_DEBIT: {
    name: 'type_DEBIT',
    category: 'profile',
    label: 'Debit Transaction Rail',
    description: 'Automated direct bank debit rail.',
  },
};

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

function falsePositiveRate(info: V2SingleModelInfo | null | undefined): string | null {
  const m = info?.test_metrics as Record<string, number> | null | undefined;
  const fp = m?.false_positives, tn = m?.true_negatives;
  if (typeof fp !== 'number' || typeof tn !== 'number' || fp + tn === 0) return null;
  const r = (fp / (fp + tn)) * 100;
  return `${r < 0.1 ? r.toFixed(3) : r.toFixed(1)}%`;
}

function accountTestTotal(info: V2SingleModelInfo | null | undefined): string {
  const d = info?.dataset_info as Record<string, number> | null | undefined;
  if (!d || d.test_suspicious_count === undefined || d.test_normal_count === undefined) return '—';
  return (d.test_suspicious_count + d.test_normal_count).toLocaleString('en-IN');
}

function accountTestSummary(info: V2SingleModelInfo | null | undefined): string {
  const d = info?.dataset_info as Record<string, number> | null | undefined;
  if (!d || d.test_suspicious_count === undefined || d.test_normal_count === undefined) return 'held-out test accounts';
  return `${d.test_suspicious_count.toLocaleString('en-IN')} suspicious and ${d.test_normal_count.toLocaleString('en-IN')} ordinary held-out accounts`;
}

export const ModelInsightsPage: React.FC = () => {
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [activeModelTab, setActiveModelTab] = useState<'v2_account' | 'paysim' | 'comparison'>('v2_account');

  // Explainability Drill-Down State
  const [drillAccountId, setDrillAccountId] = useState<string>('ACC-000001');
  const [drillAssessment, setDrillAssessment] = useState<V2AccountMLAssessmentResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState<boolean>(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  // Feature filter in global feature importance
  const [featureCategoryFilter, setFeatureCategoryFilter] = useState<'all' | 'network' | 'profile' | 'amount' | 'velocity'>('all');

  // GSAP animation refs
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Fetch live model status from backend
  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await v2Api.getModelsStatus();
      setModelStatus(data);
      setLastFetched(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to load model registry and evaluation metadata.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Fetch drill-down TreeSHAP account assessment
  const fetchDrillAssessment = async (targetId: string) => {
    if (!targetId.trim()) return;
    setDrillLoading(true);
    setDrillError(null);
    try {
      const assessment = await v2Api.getMLAssessment(targetId.trim());
      setDrillAssessment(assessment);
    } catch (err: any) {
      setDrillError(err?.message || `Failed to fetch ML assessment for ${targetId}.`);
      setDrillAssessment(null);
    } finally {
      setDrillLoading(false);
    }
  };

  useEffect(() => {
    if (activeModelTab === 'v2_account') {
      fetchDrillAssessment(drillAccountId);
    }
  }, [activeModelTab]);

  // GSAP Entrance
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      if (headerRef.current) {
        gsap.fromTo(
          headerRef.current,
          { opacity: 0, y: -16 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
        );
      }
    });

    return () => ctx.revert();
  }, [loading]);

  // Active Model Info
  const accountEval = accountEvaluation(modelStatus);
  const activeModelInfo: V2SingleModelInfo | null = useMemo(() => {
    if (!modelStatus) return null;
    if (activeModelTab === 'v2_account') return modelStatus.account_model;
    if (activeModelTab === 'paysim') return modelStatus.paysim_benchmark;
    return null;
  }, [modelStatus, activeModelTab]);

  // Format Feature Importance Data for Chart
  const featureChartData = useMemo(() => {
    if (!activeModelInfo || !activeModelInfo.feature_importances) return [];
    const entries = Object.entries(activeModelInfo.feature_importances);
    const glossary = activeModelTab === 'v2_account' ? ACCOUNT_FEATURE_GLOSSARY : PAYSIM_FEATURE_GLOSSARY;

    return entries
      .map(([key, val]) => {
        const item = glossary[key] || {
          name: key,
          category: 'amount',
          label: key,
          description: 'Engineered model feature.',
        };
        return {
          key,
          label: item.label,
          category: item.category,
          importance: val,
          percentage: (val * 100).toFixed(1),
          description: item.description,
        };
      })
      .filter((item) => featureCategoryFilter === 'all' || item.category === featureCategoryFilter)
      .sort((a, b) => b.importance - a.importance);
  }, [activeModelInfo, featureCategoryFilter, activeModelTab]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8 text-[#141526]">
      {/* 1. Header & Live Model Status */}
      <div
        ref={headerRef}
        className="p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#6246EA] bg-[#F5F3FF] px-2 py-0.5 rounded-md border border-[#FDE68A]">
              MODEL INTELLIGENCE
            </span>
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              <span>{modelStatus?.overall_status === 'healthy' ? 'Status: Healthy' : 'Status: Operational'}</span>
            </span>
            {modelStatus?.inference_ready && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                Inference Ready
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#141526]">
            Model Insights
          </h1>
          <p className="text-xs sm:text-sm text-[#5C6079] max-w-2xl leading-relaxed">
            Understand model performance, prediction drivers, and evaluation evidence.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastFetched && (
            <div className="text-right hidden sm:block">
              <span className="text-[10px] text-[#868AA2] font-mono block">Last Verified</span>
              <span className="font-mono text-xs font-semibold text-[#141526]">
                {lastFetched.toLocaleTimeString()}
              </span>
            </div>
          )}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="btn-secondary py-2 px-4 text-xs font-semibold shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#6246EA] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Models</span>
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-[#DC2626]" />
          <div className="space-y-1">
            <span className="font-bold">Model Registry Communication Issue</span>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* 2. Model Selector (Model Registry Tabs) */}
      <div className="p-1.5 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveModelTab('v2_account')}
          className={`flex-1 min-w-[240px] px-4 py-3 rounded-xl text-left transition-all cursor-pointer ${
            activeModelTab === 'v2_account'
              ? 'bg-[#141526] text-white shadow-xs'
              : 'hover:bg-[#F6F6FC] text-[#5C6079]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider opacity-80">
              01 / Core Forensic Model
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                activeModelTab === 'v2_account'
                  ? 'bg-[#6246EA] text-white'
                  : 'bg-[#F6F6FC] text-[#141526] border border-[#E4E5F0]'
              }`}
            >
              {modelStatus?.account_model?.version ?? 'account model'}
            </span>
          </div>
          <div className="text-sm font-bold mt-1">V2 Account-Level Fraud Model</div>
          <div className={`text-[11px] mt-0.5 ${activeModelTab === 'v2_account' ? 'text-gray-300' : 'text-[#868AA2]'}`}>
            Multi-hop network flow &amp; behavioral risk evaluation
          </div>
        </button>

        <button
          onClick={() => setActiveModelTab('paysim')}
          className={`flex-1 min-w-[240px] px-4 py-3 rounded-xl text-left transition-all cursor-pointer ${
            activeModelTab === 'paysim'
              ? 'bg-[#141526] text-white shadow-xs'
              : 'hover:bg-[#F6F6FC] text-[#5C6079]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider opacity-80">
              02 / Academic Benchmark
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                activeModelTab === 'paysim'
                  ? 'bg-[#6246EA] text-white'
                  : 'bg-[#F6F6FC] text-[#141526] border border-[#E4E5F0]'
              }`}
            >
              v2-benchmark-1.0.0
            </span>
          </div>
          <div className="text-sm font-bold mt-1">Transaction-Level PaySim Benchmark</div>
          <div className={`text-[11px] mt-0.5 ${activeModelTab === 'paysim' ? 'text-gray-300' : 'text-[#868AA2]'}`}>
            Pre-transaction baseline evaluated on academic mobile money logs
          </div>
        </button>

        <button
          onClick={() => setActiveModelTab('comparison')}
          className={`flex-1 min-w-[220px] px-4 py-3 rounded-xl text-left transition-all cursor-pointer ${
            activeModelTab === 'comparison'
              ? 'bg-[#141526] text-white shadow-xs'
              : 'hover:bg-[#F6F6FC] text-[#5C6079]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider opacity-80">
              03 / Methodology
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                activeModelTab === 'comparison'
                  ? 'bg-[#6246EA] text-white'
                  : 'bg-[#F6F6FC] text-[#141526] border border-[#E4E5F0]'
              }`}
            >
              Matrix
            </span>
          </div>
          <div className="text-sm font-bold mt-1">Model Comparison &amp; Scope</div>
          <div className={`text-[11px] mt-0.5 ${activeModelTab === 'comparison' ? 'text-gray-300' : 'text-[#868AA2]'}`}>
            Task boundaries, dataset differences, and non-conflation guardrails
          </div>
        </button>
      </div>

      {/* Model Scope Non-Conflation Banner */}
      <div className="p-4 rounded-xl bg-[#F5F3FF] border border-[#FDE68A] text-xs text-[#92400E] flex items-start gap-3">
        <Info className="w-5 h-5 text-[#6246EA] flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <span className="font-bold text-[#141526]">Methodological Separation Guardrail</span>
          <p className="leading-relaxed">
            {activeModelTab === 'v2_account'
              ? 'The V2 Account Model evaluates entity-level risk across continuous banking network topologies. It is trained strictly on group-aware scenario splits and must not be conflated with point-in-time transaction classification.'
              : activeModelTab === 'paysim'
              ? 'The PaySim Benchmark measures single-transaction fraud classification on public 2017 mobile money simulation logs. It scores single payments and does not look at accounts or money flows, so it says nothing about the account model or investigations.'
              : 'Both models serve complementary but strictly separated forensic objectives. Account-level topological metrics and single-transaction benchmark scores operate on different feature distributions.'}
          </p>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && !modelStatus && (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E4E5F0] space-y-3">
          <div className="w-8 h-8 rounded-full border-3 border-[#6246EA] border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-mono text-[#5C6079]">Inspecting model artifacts and evaluation metrics...</p>
        </div>
      )}

      {/* Active Model Views */}
      {modelStatus && (
        <div className="space-y-8">
          {activeModelTab === 'comparison' ? (
            /* Tab 3: Model Comparison Matrix */
            <div
              key="comparison"
              className="space-y-6"
            >
              <div className="p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-4">
                <div className="pb-3 border-b border-[#E4E5F0]">
                  <h2 className="text-base font-bold text-[#141526]">Architecture &amp; Scope Comparison Matrix</h2>
                  <p className="text-xs text-[#5C6079]">
                    Side-by-side analysis of deployed model architectures, task targets, and evaluation methodologies.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#E4E5F0] bg-[#F6F6FC] font-mono text-[11px] text-[#5C6079]">
                        <th className="py-3 px-4">Evaluation Dimension</th>
                        <th className="py-3 px-4 font-bold text-[#141526]">
                          V2 Account-Level Model ({modelStatus.account_model.version ?? 'unavailable'})
                        </th>
                        <th className="py-3 px-4 font-bold text-[#141526]">
                          PaySim Benchmark (v2-benchmark-1.0.0)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E5F0]">
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Forensic Task</td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          Entity-level behavioral risk &amp; mule ring detection
                        </td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          Single-transaction point-in-time fraud classification
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Algorithm</td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-[#141526]">
                          XGBClassifier (Tabular Gradient Boosting)
                        </td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-[#141526]">
                          XGBoost Tree Classifier
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Dataset Source</td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          V2 Synthetic Banking Ledger (SQLite)
                        </td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          PaySim Academic Simulation (Kaggle)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Split Strategy</td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          Group-Aware Scenario Separation (Zero scenario overlap)
                        </td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          Chronological Time-Split (Steps 1..500 train, 621..743 test)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Feature Count</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[#141526]">
                          26 engineered features
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[#141526]">
                          14 pre-transaction features
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">ROC-AUC</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[#141526]">
                          {modelStatus.account_model.test_metrics?.roc_auc ?? '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[#141526]">
                          {modelStatus.paysim_benchmark.test_metrics?.roc_auc ?? '1.000'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">PR-AUC</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[#6246EA]">
                          {modelStatus.account_model.test_metrics?.pr_auc ?? '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[#6246EA]">
                          {modelStatus.paysim_benchmark.test_metrics?.pr_auc ?? '0.9999'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Review threshold</td>
                        <td className="py-3.5 px-4 font-mono text-[#5C6079]">
                          {modelThreshold(modelStatus.account_model) ?? '—'} (chosen on validation data to maximise F2)
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#5C6079]">
                          {modelThreshold(modelStatus.paysim_benchmark) ?? '—'} (chosen on the benchmark’s validation data)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Held-Out Sample Size</td>
                        <td className="py-3.5 px-4 font-mono text-[#5C6079]">
                          {accountTestSummary(modelStatus.account_model)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#5C6079]">90,829 test transaction steps</td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Target Leakage Protections</td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          Strict exclusion of ground_truth_label, scenario tags, and PII
                        </td>
                        <td className="py-3.5 px-4 text-[#5C6079]">
                          Strict exclusion of post-transaction balances (newbalanceOrig/Dest)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-[#141526]">Explainability Method</td>
                        <td className="py-3.5 px-4 font-mono text-[#10B981]">
                          Local TreeSHAP Attribution per Account
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#10B981]">
                          TreeSHAP Margin Log-Odds Attribution
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeModelInfo ? (
            /* Tabs 1 & 2: Model Performance & Explainability */
            <div
              key={activeModelTab}
              className="space-y-8"
            >
              {/* 3. Performance Metric Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="p-5 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#868AA2] block">
                    ROC-AUC
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#141526]">
                    {activeModelInfo.test_metrics?.roc_auc ?? 'N/A'}
                  </div>
                  <span className="text-[11px] text-[#5C6079] block">Ranking quality across all thresholds (0.5 = random)</span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#6246EA] block">
                    PR-AUC (Primary)
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#6246EA]">
                    {activeModelInfo.test_metrics?.pr_auc ?? 'N/A'}
                  </div>
                  <span className="text-[11px] text-[#5C6079] block">
                    How well suspicious cases are ranked above others when they are rare
                    {activeModelTab === 'v2_account' && accountEval.prAucInterval &&
                      ` (95% interval ${accountEval.prAucInterval[0].toFixed(2)}–${accountEval.prAucInterval[1].toFixed(2)})`}
                  </span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#868AA2] block">
                    Precision
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#141526]">
                    {activeModelInfo.test_metrics?.precision !== undefined
                      ? `${(activeModelInfo.test_metrics.precision * 100).toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <span className="text-[11px] text-[#5C6079] block">Share of flagged test cases that were labelled suspicious</span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#868AA2] block">
                    Recall
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#141526]">
                    {activeModelInfo.test_metrics?.recall !== undefined
                      ? `${(activeModelInfo.test_metrics.recall * 100).toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <span className="text-[11px] text-[#5C6079] block">Share of suspicious test cases the model flagged</span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-1 col-span-2 lg:col-span-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#868AA2] block">
                    F1 Score
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#141526]">
                    {activeModelInfo.test_metrics?.f1_score !== undefined
                      ? Number(activeModelInfo.test_metrics.f1_score).toFixed(3)
                      : 'N/A'}
                  </div>
                  <span className="text-[11px] text-[#5C6079] block">Balance of precision and recall</span>
                </div>
              </div>

              <p className="text-xs text-[#5C6079] leading-relaxed -mt-4" data-testid="evaluation-scope-note">
                {activeModelTab === 'v2_account'
                  ? `Measured once on ${accountEval.positives ?? '—'} suspicious and ${accountEval.negatives?.toLocaleString('en-IN') ?? '—'} ordinary synthetic test accounts the model never trained on${
                      accountEval.prAucInterval
                        ? `; the PR-AUC 95% interval (${accountEval.prAucInterval[0].toFixed(2)}–${accountEval.prAucInterval[1].toFixed(2)}) comes from resampling whole scenarios`
                        : ''
                    }. These are estimates on synthetic data, not guarantees for any new account or for real bank data.`
                  : 'Measured on a public mobile-money simulation. These near-perfect results describe that simulation only; they say nothing about the account model or about investigations.'}
              </p>

              {/* 4. Confusion Matrix & Threshold Rationale */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: 2x2 Confusion Matrix */}
                <div className="lg:col-span-6 p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#E4E5F0]">
                    <div>
                      <h3 className="text-sm font-bold text-[#141526]">Held-Out Test Confusion Matrix</h3>
                      <p className="text-[11px] text-[#5C6079]">
                        {activeModelTab === 'v2_account'
                          ? `Evaluated on ${accountTestSummary(activeModelInfo)}`
                          : 'Evaluated on 90,829 held-out chronological transactions'}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#F6F6FC] text-[#141526] border border-[#E4E5F0]">
                      {activeModelTab === 'v2_account' ? `${accountTestTotal(activeModelInfo)} Accounts` : '90,829 TXs'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center text-xs">
                    <div className="p-4 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] space-y-1">
                      <span className="text-[10px] font-mono font-bold text-[#868AA2] uppercase block">
                        True Negatives
                      </span>
                      <span className="text-xl font-bold font-mono text-[#141526]">
                        {activeModelInfo.test_metrics?.true_negatives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[0]?.[0]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[10px] text-[#065F46] font-semibold block">
                        Ordinary, not flagged
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] space-y-1">
                      <span className="text-[10px] font-mono font-bold text-[#92400E] uppercase block">
                        False Positives
                      </span>
                      <span className="text-xl font-bold font-mono text-[#92400E]">
                        {activeModelInfo.test_metrics?.false_positives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[0]?.[1]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[10px] text-[#92400E] font-semibold block">
                        False alarms{falsePositiveRate(activeModelInfo) ? ` (${falsePositiveRate(activeModelInfo)} of ordinary cases)` : ''}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] space-y-1">
                      <span className="text-[10px] font-mono font-bold text-[#991B1B] uppercase block">
                        False Negatives
                      </span>
                      <span className="text-xl font-bold font-mono text-[#991B1B]">
                        {activeModelInfo.test_metrics?.false_negatives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[1]?.[0]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[10px] text-[#991B1B] font-semibold block">
                        Labelled suspicious, missed
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] space-y-1">
                      <span className="text-[10px] font-mono font-bold text-[#065F46] uppercase block">
                        True Positives
                      </span>
                      <span className="text-xl font-bold font-mono text-[#065F46]">
                        {activeModelInfo.test_metrics?.true_positives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[1]?.[1]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[10px] text-[#065F46] font-semibold block">
                        Labelled suspicious, flagged
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] text-[11px] text-[#5C6079] space-y-1 leading-relaxed">
                    <span className="font-bold text-[#141526] block">Operational Interpretation:</span>
                    <p>
                      {activeModelTab === 'v2_account'
                        ? `Suspicious accounts are a small minority of the test set (${accountTestSummary(activeModelInfo)}). The threshold favours recall because every flag goes to a person and nothing is automated, so false alarms are expected.`
                        : 'Evaluated across 90,829 held-out chronological transactions, the benchmark model successfully captured 1,365 of 1,366 fraud events with only 3 false-positive alerts.'}
                    </p>
                  </div>
                </div>

                {/* Right: Calibrated Threshold Rationale */}
                <div className="lg:col-span-6 p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-4">
                  <div className="pb-3 border-b border-[#E4E5F0]">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[#141526]">Review threshold</h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#F5F3FF] text-[#6246EA] border border-[#FDE68A]">
                        Fixed by the evaluation pipeline
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5C6079]">
                      {activeModelTab === 'v2_account'
                        ? 'Chosen on validation data (not the test set) to maximise F2, which counts finding suspicious accounts twice as much as avoiding false alarms. The scores themselves are not calibrated probabilities.'
                        : 'Chosen on the benchmark’s validation data during training.'}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-mono uppercase text-[#868AA2] block">Threshold (0–1 score scale)</span>
                      <div className="text-3xl font-extrabold font-mono text-[#141526]" data-testid="served-threshold">
                        {modelThreshold(activeModelInfo) ?? 'Unavailable'}
                      </div>
                      <span className="text-[11px] text-[#5C6079]">
                        {modelThreshold(activeModelInfo) !== null
                          ? `Scores at or above this (${thresholdPercent(activeModelInfo)} on the percentage scale) are suggested for human review. It is not a chance of fraud.`
                          : 'The served model did not report a threshold.'}
                      </span>
                    </div>
                    {activeModelTab === 'v2_account' && (
                      <div className="text-right">
                        <span className="text-[10px] font-mono uppercase text-[#868AA2] block">Trade-off</span>
                        <span className="px-2 py-1 rounded-md text-[11px] font-semibold bg-white border border-[#E4E5F0] text-[#141526] inline-block mt-1">
                          Favours recall (F2)
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 text-xs text-[#5C6079]">
                    <div className="p-3.5 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] space-y-1.5">
                      <span className="font-bold text-[#141526] block">Threshold Mechanics &amp; Guardrails:</span>
                      <p className="text-[11px] leading-relaxed">
                        Lowering the threshold captures more suspicious flows (higher recall) but increases false alarms on legitimate retail and student accounts. Raising the threshold reduces analyst fatigue but risks letting multi-hop mules pass uninspected.
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[11px] text-[#92400E] flex items-start gap-2.5">
                      <Sliders className="w-4 h-4 text-[#6246EA] flex-shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        <strong>Not adjustable here:</strong> the threshold can only change by re-running the evaluation pipeline (<code>ml/v2/account_model_eval.py</code>), which selects it on validation data and records it with the model.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. What Influences Predictions? — Global Feature Importance */}
              <div className="p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E5F0]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-[#6246EA] uppercase tracking-wider bg-[#F5F3FF] px-2 py-0.5 rounded border border-[#FDE68A]">
                        WHAT INFLUENCES PREDICTIONS?
                      </span>
                      <span className="text-xs font-mono text-[#868AA2]">
                        {featureChartData.length} features ranked
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-[#141526] mt-1">
                      Global Feature Importance ({activeModelInfo.model_type?.includes('PaySim') ? 'PaySim XGBoost' : 'V2 Account XGBoost'})
                    </h3>
                    <p className="text-xs text-[#5C6079]">
                      Relative contribution (gain) of each observable attribute across the trained gradient boosted trees.
                    </p>
                  </div>

                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] self-start sm:self-center">
                    {(['all', 'network', 'profile', 'amount', 'velocity'] as const).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFeatureCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                          featureCategoryFilter === cat
                            ? 'bg-[#141526] text-white'
                            : 'text-[#5C6079] hover:text-[#141526]'
                        }`}
                      >
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ranked Horizontal Bars */}
                {featureChartData.length > 0 ? (
                  <div className="space-y-3">
                    {featureChartData.map((f, idx) => (
                      <div
                        key={f.key}
                        className="p-3.5 rounded-xl bg-[#F6F6FC] hover:bg-[#F1F2F9] border border-[#E4E5F0] transition-colors space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold text-[#868AA2] w-5">
                              #{idx + 1}
                            </span>
                            <span className="font-bold text-[#141526]">{f.label}</span>
                            <code className="text-[10px] font-mono text-[#868AA2]">({f.key})</code>
                          </div>
                          <span className="font-mono font-extrabold text-[#6246EA] text-xs">
                            {f.percentage}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full h-2 rounded-full bg-[#E4E5F0] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#6246EA] transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(2, parseFloat(f.percentage) * 3))}%` }}
                          />
                        </div>

                        <p className="text-[11px] text-[#5C6079]">{f.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-[#868AA2] bg-[#F6F6FC] rounded-xl border border-[#E4E5F0]">
                    No features match the selected category filter.
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-white border border-[#E4E5F0] text-[11px] text-[#5C6079] flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-[#6246EA] flex-shrink-0 mt-0.5" />
                  <p>
                    <strong>Causation Guardrail:</strong> Global feature importance measures correlation with historical labels across the training corpus. A high importance score does not independently prove fraudulent intent or criminal wrongdoing on any individual account.
                  </p>
                </div>
              </div>

              {/* 6. Interactive Local TreeSHAP Explainability Drill-Down */}
              {activeModelTab === 'v2_account' && (
                <div className="p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E5F0]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-[#10B981] uppercase tracking-wider bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#A7F3D0]">
                          LOCAL EXPLAINABILITY
                        </span>
                        <span className="text-xs font-mono text-[#868AA2]">TreeSHAP Attribution</span>
                      </div>
                      <h3 className="text-base font-bold text-[#141526] mt-1">
                        Individual Account Prediction Explanation
                      </h3>
                      <p className="text-xs text-[#5C6079]">
                        Inspect local TreeSHAP contribution scores showing exactly which observable attributes pushed an account score higher or lower.
                      </p>
                    </div>

                    {/* Account Quick Selector Pills */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#5C6079] hidden sm:inline">Inspect:</span>
                      {['ACC-000001', 'ACC-000002', 'ACC-000003'].map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            setDrillAccountId(id);
                            fetchDrillAssessment(id);
                          }}
                          className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition-all cursor-pointer ${
                            drillAccountId === id
                              ? 'bg-[#141526] text-white shadow-xs'
                              : 'bg-[#F6F6FC] hover:bg-[#E4E5F0] text-[#141526] border border-[#E4E5F0]'
                          }`}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Account Input & Action Bar */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-[#868AA2] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={drillAccountId}
                        onChange={(e) => setDrillAccountId(e.target.value)}
                        placeholder="Enter a synthetic-ledger account ID, e.g. ACC-000001"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] text-xs font-mono text-[#141526] focus:outline-none focus:border-[#6246EA]"
                      />
                    </div>
                    <button
                      onClick={() => fetchDrillAssessment(drillAccountId)}
                      disabled={drillLoading || !drillAccountId.trim()}
                      className="px-4 py-2.5 rounded-xl bg-[#6246EA] hover:bg-[#4F33D6] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      <Cpu className={`w-3.5 h-3.5 ${drillLoading ? 'animate-spin' : ''}`} />
                      <span>Explain with TreeSHAP</span>
                    </button>
                  </div>

                  {/* Drill Assessment Result */}
                  {drillLoading && (
                    <div className="p-8 text-center text-xs text-[#5C6079] bg-[#F6F6FC] rounded-xl border border-[#E4E5F0]">
                      <div className="w-6 h-6 rounded-full border-2 border-[#6246EA] border-t-transparent animate-spin mx-auto mb-2" />
                      Computing exact TreeSHAP attribution paths for {drillAccountId}...
                    </div>
                  )}

                  {drillError && (
                    <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                      {drillError}
                    </div>
                  )}

                  {drillAssessment && !drillLoading && (
                    <div className="space-y-4">
                      {/* Prediction Summary Strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] text-xs">
                        <div>
                          <span className="text-[10px] text-[#868AA2] font-mono block">Account Target</span>
                          <span className="font-mono font-bold text-[#141526] text-sm">{drillAssessment.account_id}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#868AA2] font-mono block">Model score</span>
                          <span className="font-mono font-bold text-[#6246EA] text-sm">
                            {formatModelScore(drillAssessment.risk_score)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#868AA2] font-mono block">Review suggestion</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold inline-block font-mono ${
                              drillAssessment.predicted_class === 'suspicious'
                                ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
                                : 'bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]'
                            }`}
                          >
                            {drillAssessment.predicted_class === 'suspicious' ? 'Suggested for review' : 'Below threshold'}
                          </span>
                        </div>
                        <div className="text-right">
                          <Link
                            to={`/tools/accounts/${encodeURIComponent(drillAssessment.account_id)}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6246EA] hover:underline"
                          >
                            <span>Open 360° Profile</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>

                      {/* TreeSHAP Contribution Waterfall List */}
                      <div className="space-y-2">
                        <span className="text-xs font-bold text-[#141526] block">
                          Top Feature Attributions (TreeSHAP Log-Odds Contributions)
                        </span>
                        {drillAssessment.top_contributions.map((c) => {
                          const glossary = ACCOUNT_FEATURE_GLOSSARY[c.feature_name];
                          const increases = c.impact_direction === 'increases_risk';
                          return (
                            <div
                              key={c.feature_name}
                              className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                                increases
                                  ? 'bg-[#FFFBEB] border-[#FDE68A]'
                                  : 'bg-[#ECFDF5] border-[#A7F3D0]'
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[#141526]">
                                    {glossary?.label || c.feature_name}
                                  </span>
                                  <code className="text-[10px] font-mono text-[#868AA2]">
                                    {c.feature_name} = {typeof c.feature_value === 'number' ? c.feature_value.toLocaleString() : c.feature_value}
                                  </code>
                                </div>
                                <p className="text-[11px] text-[#5C6079]">
                                  {glossary?.description || 'Observable behavioral feature.'}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 self-start sm:self-center font-mono text-xs">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    increases ? 'bg-[#6246EA] text-white' : 'bg-[#10B981] text-white'
                                  }`}
                                >
                                  {increases ? '+ INCREASES RISK' : '- DECREASES RISK'}
                                </span>
                                <span className="font-bold text-[#141526]">
                                  {c.contribution_score > 0 ? `+${c.contribution_score}` : c.contribution_score}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 7. Dataset & Evaluation Transparency */}
              <div className="p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-4">
                <div className="pb-3 border-b border-[#E4E5F0]">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#6246EA]" />
                    <h3 className="text-sm font-bold text-[#141526]">Dataset &amp; Evaluation Provenance</h3>
                  </div>
                  <p className="text-xs text-[#5C6079]">
                    Transparent recording of training corpora, data splits, and leakage safeguards.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] space-y-2">
                    <span className="font-bold text-[#141526] block">Evaluation Cohort &amp; Source</span>
                    <div className="space-y-1 font-mono text-[11px] text-[#5C6079]">
                      <div>Source: <strong className="text-[#141526]">{activeModelInfo.dataset_info?.source || 'Verified Artifact'}</strong></div>
                      {activeModelInfo.dataset_info?.strategy && (
                        <div>Strategy: <strong className="text-[#141526]">{activeModelInfo.dataset_info.strategy}</strong></div>
                      )}
                      {activeModelInfo.dataset_info?.train_accounts_count && (
                        <div>Train Accounts: <strong className="text-[#141526]">{activeModelInfo.dataset_info.train_accounts_count.toLocaleString()}</strong></div>
                      )}
                      {activeModelInfo.dataset_info?.test_accounts_count && (
                        <div>Test Accounts: <strong className="text-[#141526]">{activeModelInfo.dataset_info.test_accounts_count.toLocaleString()}</strong></div>
                      )}
                      {activeModelInfo.dataset_info?.chronological_split && (
                        <div>Chronological Steps: <strong className="text-[#141526]">{JSON.stringify(activeModelInfo.dataset_info.chronological_split)}</strong></div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] space-y-2">
                    <span className="font-bold text-[#141526] block">Target Leakage Safeguards</span>
                    {activeModelInfo.leakage_protections && activeModelInfo.leakage_protections.length > 0 ? (
                      <ul className="space-y-1 list-disc pl-4 text-[11px] text-[#5C6079]">
                        {activeModelInfo.leakage_protections.map((prot, idx) => (
                          <li key={idx}>{prot}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-[#868AA2]">No explicit exclusions recorded.</p>
                    )}
                  </div>
                </div>

                {/* Model Limitations & Responsible AI Guardrail */}
                <div className="p-4 rounded-xl bg-[#F5F3FF] border border-[#FDE68A] text-xs text-[#92400E] space-y-1">
                  <span className="font-bold text-[#141526] flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-[#6246EA]" />
                    <span>Non-Punitive Advisory Guardrail</span>
                  </span>
                  <p className="leading-relaxed text-[11px]">
                    {activeModelInfo.limitations ||
                      'Models serve strictly as decision-support. Automated account freezing or denial of service is prohibited.'}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
