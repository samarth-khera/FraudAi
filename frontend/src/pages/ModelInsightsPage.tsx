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
import { InvestigationModelsPanel } from '../components/models/InvestigationModelsPanel';
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
    <div className="space-y-8 text-ink">
      {/* 1. Header and live model status (from the API) */}
      <header data-reveal className="flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div className="min-w-0 max-w-3xl">
          <h1 className="page-title">Model performance</h1>
          <p className="mt-2 lede">How each model was trained and tested, what moves its scores, and where its output counts as evidence.</p>
          {!modelStatus && <div className="mt-3 h-[26px] w-48 skeleton rounded-full" aria-hidden="true" />}
          {modelStatus && (
            <div className="mt-3 min-h-[26px] flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ring-1 ${
                  modelStatus.overall_status === 'healthy' ? 'bg-ok-soft text-ok ring-ok-line' : 'bg-warn-soft text-warn ring-warn-line'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${modelStatus.overall_status === 'healthy' ? 'bg-ok-fill' : 'bg-warn-fill'}`} aria-hidden="true" />
                <span>{modelStatus.overall_status === 'healthy' ? 'Status: Healthy' : `Status: ${modelStatus.overall_status.replace(/_/g, ' ')}`}</span>
              </span>
              {modelStatus.inference_ready && (
                <span className="inline-flex items-center rounded-full bg-ice-soft ring-1 ring-ice-line px-2.5 py-1 font-semibold text-info">Inference ready</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {lastFetched && (
            <div className="text-right hidden sm:block">
              <span className="text-[11px] text-faint block">Last checked</span>
              <span className="font-mono text-xs font-semibold text-ink">
                {lastFetched.toLocaleTimeString()}
              </span>
            </div>
          )}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="btn-secondary py-2 px-4 text-xs font-semibold shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-iris ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-danger-fill" />
          <div className="space-y-1">
            <span className="font-bold">The model status could not be loaded</span>
            <p>{error}</p>
          </div>
        </div>
      )}

      <InvestigationModelsPanel status={modelStatus} />

      {modelStatus && (
        <>
      {/* 2. Model Selector (Model Registry Tabs) */}
      <div className="p-1.5 rounded-2xl bg-white border border-line shadow-xs flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveModelTab('v2_account')}
          className={`flex-1 min-w-[240px] px-4 py-3 rounded-xl text-left transition-all cursor-pointer ${
            activeModelTab === 'v2_account'
            ? 'bg-white text-ink ring-2 ring-iris shadow-[var(--shadow-float)]'
            : 'hover:bg-well text-mute'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-faint">
              Used by the Accounts tool and case review
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[11px] font-mono font-bold ${
                activeModelTab === 'v2_account'
                ? 'bg-white text-ink ring-1 ring-line shadow-[var(--shadow-xs)]'
                : 'bg-well text-ink border border-line'
              }`}
            >
              {modelStatus?.account_model?.version ?? 'account model'}
            </span>
          </div>
          <div className="text-sm font-bold mt-1">V2 account-level fraud model</div>
          <div className={`text-[11px] mt-0.5 ${activeModelTab === 'v2_account' ? 'text-mute' : 'text-faint'}`}>
            Multi-hop network flow &amp; behavioral risk evaluation
          </div>
        </button>

        <button
          onClick={() => setActiveModelTab('paysim')}
          className={`flex-1 min-w-[240px] px-4 py-3 rounded-xl text-left transition-all cursor-pointer ${
            activeModelTab === 'paysim'
            ? 'bg-white text-ink ring-2 ring-iris shadow-[var(--shadow-float)]'
            : 'hover:bg-well text-mute'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-faint">
              Public benchmark
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[11px] font-mono font-bold ${
                activeModelTab === 'paysim'
                ? 'bg-white text-ink ring-1 ring-line shadow-[var(--shadow-xs)]'
                : 'bg-well text-ink border border-line'
              }`}
            >
              v2-benchmark-1.0.0
            </span>
          </div>
          <div className="text-sm font-bold mt-1">Transaction-level PaySim benchmark</div>
          <div className={`text-[11px] mt-0.5 ${activeModelTab === 'paysim' ? 'text-mute' : 'text-faint'}`}>
            Pre-transaction baseline evaluated on academic mobile money logs
          </div>
        </button>

        <button
          onClick={() => setActiveModelTab('comparison')}
          className={`flex-1 min-w-[220px] px-4 py-3 rounded-xl text-left transition-all cursor-pointer ${
            activeModelTab === 'comparison'
            ? 'bg-white text-ink ring-2 ring-iris shadow-[var(--shadow-float)]'
            : 'hover:bg-well text-mute'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-faint">
              Methodology
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[11px] font-mono font-bold ${
                activeModelTab === 'comparison'
                ? 'bg-white text-ink ring-1 ring-line shadow-[var(--shadow-xs)]'
                : 'bg-well text-ink border border-line'
              }`}
            >
              Matrix
            </span>
          </div>
          <div className="text-sm font-bold mt-1">Model comparison and scope</div>
          <div className={`text-[11px] mt-0.5 ${activeModelTab === 'comparison' ? 'text-mute' : 'text-faint'}`}>
            Task boundaries, dataset differences, and non-conflation guardrails
          </div>
        </button>
      </div>

      {/* Model Scope Non-Conflation Banner */}
      <div className="p-4 rounded-xl bg-iris-wash border border-warn-line text-xs text-warn flex items-start gap-3">
        <Info className="w-5 h-5 text-iris flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <span className="font-bold text-ink">Keep the models apart</span>
          <p className="leading-relaxed">
            {activeModelTab === 'v2_account'
              ? 'The V2 Account Model evaluates entity-level risk across continuous banking network topologies. It is trained strictly on group-aware scenario splits and must not be conflated with point-in-time transaction classification.'
              : activeModelTab === 'paysim'
              ? 'The PaySim Benchmark measures single-transaction fraud classification on public 2017 mobile money simulation logs. It scores single payments and does not look at accounts or money flows, so it says nothing about the account model or investigations.'
              : 'Both models serve complementary but strictly separated forensic objectives. Account-level topological metrics and single-transaction benchmark scores operate on different feature distributions.'}
          </p>
        </div>
      </div>
        </>
      )}

      {/* Loading Skeleton */}
      {loading && !modelStatus && (
        <div className="p-12 text-center bg-white rounded-2xl border border-line space-y-3">
          <div className="w-8 h-8 rounded-full border-3 border-iris border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-mute">Loading the model artifacts and evaluation metrics…</p>
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
              <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
                <div className="pb-3 border-b border-line">
                  <h2 className="text-base font-bold text-ink">Architecture and scope, side by side</h2>
                  <p className="text-xs text-mute">
                    Side-by-side analysis of deployed model architectures, task targets, and evaluation methodologies.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-line bg-well font-mono text-[11px] text-mute">
                        <th className="py-3 px-4">Evaluation Dimension</th>
                        <th className="py-3 px-4 font-bold text-ink">
                          V2 Account-Level Model ({modelStatus.account_model.version ?? 'unavailable'})
                        </th>
                        <th className="py-3 px-4 font-bold text-ink">
                          PaySim Benchmark (v2-benchmark-1.0.0)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Forensic Task</td>
                        <td className="py-3.5 px-4 text-mute">
                          Entity-level behavioral risk &amp; mule ring detection
                        </td>
                        <td className="py-3.5 px-4 text-mute">
                          Single-transaction point-in-time fraud classification
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Algorithm</td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-ink">
                          XGBClassifier (Tabular Gradient Boosting)
                        </td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-ink">
                          XGBoost Tree Classifier
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Dataset Source</td>
                        <td className="py-3.5 px-4 text-mute">
                          V2 Synthetic Banking Ledger (SQLite)
                        </td>
                        <td className="py-3.5 px-4 text-mute">
                          PaySim Academic Simulation (Kaggle)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Split Strategy</td>
                        <td className="py-3.5 px-4 text-mute">
                          Group-Aware Scenario Separation (Zero scenario overlap)
                        </td>
                        <td className="py-3.5 px-4 text-mute">
                          Chronological Time-Split (Steps 1..500 train, 621..743 test)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Feature Count</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-ink">
                          26 engineered features
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-ink">
                          14 pre-transaction features
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">ROC-AUC</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-ink">
                          {modelStatus.account_model.test_metrics?.roc_auc ?? '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-ink">
                          {modelStatus.paysim_benchmark.test_metrics?.roc_auc ?? '1.000'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">PR-AUC</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-iris">
                          {modelStatus.account_model.test_metrics?.pr_auc ?? '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-iris">
                          {modelStatus.paysim_benchmark.test_metrics?.pr_auc ?? '0.9999'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Review threshold</td>
                        <td className="py-3.5 px-4 font-mono text-mute">
                          {modelThreshold(modelStatus.account_model) ?? '—'} (chosen on validation data to maximise F2)
                        </td>
                        <td className="py-3.5 px-4 font-mono text-mute">
                          {modelThreshold(modelStatus.paysim_benchmark) ?? '—'} (chosen on the benchmark’s validation data)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Held-Out Sample Size</td>
                        <td className="py-3.5 px-4 font-mono text-mute">
                          {accountTestSummary(modelStatus.account_model)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-mute">90,829 test transaction steps</td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Target Leakage Protections</td>
                        <td className="py-3.5 px-4 text-mute">
                          Strict exclusion of ground_truth_label, scenario tags, and PII
                        </td>
                        <td className="py-3.5 px-4 text-mute">
                          Strict exclusion of post-transaction balances (newbalanceOrig/Dest)
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 px-4 font-semibold text-ink">Explainability Method</td>
                        <td className="py-3.5 px-4 font-mono text-ok">
                          Local TreeSHAP Attribution per Account
                        </td>
                        <td className="py-3.5 px-4 font-mono text-ok">
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
                <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
                  <span className="text-[11px] font-mono font-bold text-faint block">
                    ROC-AUC
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-ink">
                    {activeModelInfo.test_metrics?.roc_auc ?? 'N/A'}
                  </div>
                  <span className="text-[11px] text-mute block">Ranking quality across all thresholds (0.5 = random)</span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
                  <span className="text-[11px] font-mono font-bold text-iris block">
                    PR-AUC (Primary)
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-iris">
                    {activeModelInfo.test_metrics?.pr_auc ?? 'N/A'}
                  </div>
                  <span className="text-[11px] text-mute block">
                    How well suspicious cases are ranked above others when they are rare
                    {activeModelTab === 'v2_account' && accountEval.prAucInterval &&
                      ` (95% interval ${accountEval.prAucInterval[0].toFixed(2)}–${accountEval.prAucInterval[1].toFixed(2)})`}
                  </span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
                  <span className="text-[11px] font-mono font-bold text-faint block">
                    Precision
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-ink">
                    {activeModelInfo.test_metrics?.precision !== undefined
                      ? `${(activeModelInfo.test_metrics.precision * 100).toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <span className="text-[11px] text-mute block">Share of flagged test cases that were labelled suspicious</span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
                  <span className="text-[11px] font-mono font-bold text-faint block">
                    Recall
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-ink">
                    {activeModelInfo.test_metrics?.recall !== undefined
                      ? `${(activeModelInfo.test_metrics.recall * 100).toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <span className="text-[11px] text-mute block">Share of suspicious test cases the model flagged</span>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1 col-span-2 lg:col-span-1">
                  <span className="text-[11px] font-mono font-bold text-faint block">
                    F1 Score
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-ink">
                    {activeModelInfo.test_metrics?.f1_score !== undefined
                      ? Number(activeModelInfo.test_metrics.f1_score).toFixed(3)
                      : 'N/A'}
                  </div>
                  <span className="text-[11px] text-mute block">Balance of precision and recall</span>
                </div>
              </div>

              <p className="text-xs text-mute leading-relaxed -mt-4" data-testid="evaluation-scope-note">
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
                <div className="lg:col-span-6 p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-line">
                    <div>
                      <h3 className="text-sm font-bold text-ink">Held-Out Test Confusion Matrix</h3>
                      <p className="text-[11px] text-mute">
                        {activeModelTab === 'v2_account'
                          ? `Evaluated on ${accountTestSummary(activeModelInfo)}`
                          : 'Evaluated on 90,829 held-out chronological transactions'}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-well text-ink border border-line">
                      {activeModelTab === 'v2_account' ? `${accountTestTotal(activeModelInfo)} Accounts` : '90,829 TXs'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center text-xs">
                    <div className="p-4 rounded-xl bg-well border border-line space-y-1">
                      <span className="text-[11px] font-mono font-bold text-faint block">
                        True Negatives
                      </span>
                      <span className="text-xl font-bold font-mono text-ink">
                        {activeModelInfo.test_metrics?.true_negatives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[0]?.[0]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[11px] text-ok font-semibold block">
                        Ordinary, not flagged
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-warn-soft border border-warn-line space-y-1">
                      <span className="text-[11px] font-mono font-bold text-warn block">
                        False Positives
                      </span>
                      <span className="text-xl font-bold font-mono text-warn">
                        {activeModelInfo.test_metrics?.false_positives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[0]?.[1]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[11px] text-warn font-semibold block">
                        False alarms{falsePositiveRate(activeModelInfo) ? ` (${falsePositiveRate(activeModelInfo)} of ordinary cases)` : ''}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-danger-soft border border-danger-line space-y-1">
                      <span className="text-[11px] font-mono font-bold text-danger block">
                        False Negatives
                      </span>
                      <span className="text-xl font-bold font-mono text-danger">
                        {activeModelInfo.test_metrics?.false_negatives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[1]?.[0]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[11px] text-danger font-semibold block">
                        Labelled suspicious, missed
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-ok-soft border border-ok-line space-y-1">
                      <span className="text-[11px] font-mono font-bold text-ok block">
                        True Positives
                      </span>
                      <span className="text-xl font-bold font-mono text-ok">
                        {activeModelInfo.test_metrics?.true_positives?.toLocaleString() ??
                          activeModelInfo.test_metrics?.confusion_matrix?.[1]?.[1]?.toLocaleString() ??
                          'N/A'}
                      </span>
                      <span className="text-[11px] text-ok font-semibold block">
                        Labelled suspicious, flagged
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-well border border-line text-[11px] text-mute space-y-1 leading-relaxed">
                    <span className="font-bold text-ink block">Operational Interpretation:</span>
                    <p>
                      {activeModelTab === 'v2_account'
                        ? `Suspicious accounts are a small minority of the test set (${accountTestSummary(activeModelInfo)}). The threshold favours recall because every flag goes to a person and nothing is automated, so false alarms are expected.`
                        : 'Evaluated across 90,829 held-out chronological transactions, the benchmark model successfully captured 1,365 of 1,366 fraud events with only 3 false-positive alerts.'}
                    </p>
                  </div>
                </div>

                {/* Right: Calibrated Threshold Rationale */}
                <div className="lg:col-span-6 p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
                  <div className="pb-3 border-b border-line">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-ink">Review threshold</h3>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-iris-wash text-iris border border-warn-line">
                        Fixed by the evaluation pipeline
                      </span>
                    </div>
                    <p className="text-[11px] text-mute">
                      {activeModelTab === 'v2_account'
                        ? 'Chosen on validation data (not the test set) to maximise F2, which counts finding suspicious accounts twice as much as avoiding false alarms. The scores themselves are not calibrated probabilities.'
                        : 'Chosen on the benchmark’s validation data during training.'}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-well border border-line flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-mono text-faint block">Threshold (0–1 score scale)</span>
                      <div className="text-3xl font-bold font-mono text-ink" data-testid="served-threshold">
                        {modelThreshold(activeModelInfo) ?? 'Unavailable'}
                      </div>
                      <span className="text-[11px] text-mute">
                        {modelThreshold(activeModelInfo) !== null
                          ? `Scores at or above this (${thresholdPercent(activeModelInfo)} on the percentage scale) are suggested for human review. It is not a chance of fraud.`
                          : 'The served model did not report a threshold.'}
                      </span>
                    </div>
                    {activeModelTab === 'v2_account' && (
                      <div className="text-right">
                        <span className="text-[11px] font-mono text-faint block">Trade-off</span>
                        <span className="px-2 py-1 rounded-md text-[11px] font-semibold bg-white border border-line text-ink inline-block mt-1">
                          Favours recall (F2)
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 text-xs text-mute">
                    <div className="p-3.5 rounded-xl bg-well border border-line space-y-1.5">
                      <span className="font-bold text-ink block">Threshold Mechanics &amp; Guardrails:</span>
                      <p className="text-[11px] leading-relaxed">
                        Lowering the threshold captures more suspicious flows (higher recall) but increases false alarms on legitimate retail and student accounts. Raising the threshold reduces analyst fatigue but risks letting multi-hop mules pass uninspected.
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-warn-soft border border-warn-line text-[11px] text-warn flex items-start gap-2.5">
                      <Sliders className="w-4 h-4 text-iris flex-shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        <strong>Not adjustable here:</strong> the threshold can only change by re-running the evaluation pipeline (<code>ml/v2/account_model_eval.py</code>), which selects it on validation data and records it with the model.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. What Influences Predictions? — Global Feature Importance */}
              <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-iris bg-iris-wash px-2 py-0.5 rounded border border-warn-line">
                        WHAT INFLUENCES PREDICTIONS?
                      </span>
                      <span className="text-xs font-mono text-faint">
                        {featureChartData.length} features ranked
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-ink mt-1">
                      Global Feature Importance ({activeModelInfo.model_type?.includes('PaySim') ? 'PaySim XGBoost' : 'V2 Account XGBoost'})
                    </h3>
                    <p className="text-xs text-mute">
                      Relative contribution (gain) of each observable attribute across the trained gradient boosted trees.
                    </p>
                  </div>

                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-1.5 p-1 rounded-xl bg-well border border-line self-start sm:self-center">
                    {(['all', 'network', 'profile', 'amount', 'velocity'] as const).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFeatureCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                          featureCategoryFilter === cat
                          ? 'bg-white text-ink ring-1 ring-line shadow-[var(--shadow-xs)]'
                          : 'text-mute hover:text-ink'
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
                        className="p-3.5 rounded-xl bg-well hover:bg-well border border-line transition-colors space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-faint w-5">
                              #{idx + 1}
                            </span>
                            <span className="font-bold text-ink">{f.label}</span>
                            <code className="text-[11px] font-mono text-faint">({f.key})</code>
                          </div>
                          <span className="font-mono font-bold text-iris text-xs">
                            {f.percentage}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full h-2 rounded-full bg-line overflow-hidden">
                          <div
                            className="h-full rounded-full bg-iris transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(2, parseFloat(f.percentage) * 3))}%` }}
                          />
                        </div>

                        <p className="text-[11px] text-mute">{f.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-faint bg-well rounded-xl border border-line">
                    No features match the selected category filter.
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-white border border-line text-[11px] text-mute flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-iris flex-shrink-0 mt-0.5" />
                  <p>
                    <strong>Causation Guardrail:</strong> Global feature importance measures correlation with historical labels across the training corpus. A high importance score does not independently prove fraudulent intent or criminal wrongdoing on any individual account.
                  </p>
                </div>
              </div>

              {/* 6. Interactive Local TreeSHAP Explainability Drill-Down */}
              {activeModelTab === 'v2_account' && (
                <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-ok bg-ok-soft px-2 py-0.5 rounded border border-ok-line">
                          LOCAL EXPLAINABILITY
                        </span>
                        <span className="text-xs font-mono text-faint">TreeSHAP Attribution</span>
                      </div>
                      <h3 className="text-base font-bold text-ink mt-1">
                        Individual Account Prediction Explanation
                      </h3>
                      <p className="text-xs text-mute">
                        Inspect local TreeSHAP contribution scores showing exactly which observable attributes pushed an account score higher or lower.
                      </p>
                    </div>

                    {/* Account Quick Selector Pills */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-mute hidden sm:inline">Inspect:</span>
                      {['ACC-000001', 'ACC-000002', 'ACC-000003'].map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            setDrillAccountId(id);
                            fetchDrillAssessment(id);
                          }}
                          className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition-all cursor-pointer ${
                            drillAccountId === id
                            ? 'bg-white text-ink ring-2 ring-iris shadow-[var(--shadow-float)]'
                            : 'bg-well hover:bg-line text-ink border border-line'
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
                      <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={drillAccountId}
                        onChange={(e) => setDrillAccountId(e.target.value)}
                        aria-label="Account ID to explain"
                        placeholder="Enter a synthetic-ledger account ID, e.g. ACC-000001"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-well border border-line text-xs font-mono text-ink focus:outline-none focus:border-iris"
                      />
                    </div>
                    <button
                      onClick={() => fetchDrillAssessment(drillAccountId)}
                      disabled={drillLoading || !drillAccountId.trim()}
                      className="btn-primary text-xs"
                    >
                      <Cpu className={`w-3.5 h-3.5 ${drillLoading ? 'animate-spin' : ''}`} />
                      <span>Explain with TreeSHAP</span>
                    </button>
                  </div>

                  {/* Drill Assessment Result */}
                  {drillLoading && (
                    <div className="p-8 text-center text-xs text-mute bg-well rounded-xl border border-line">
                      <div className="w-6 h-6 rounded-full border-2 border-iris border-t-transparent animate-spin mx-auto mb-2" />
                      Computing exact TreeSHAP attribution paths for {drillAccountId}...
                    </div>
                  )}

                  {drillError && (
                    <div className="p-4 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger">
                      {drillError}
                    </div>
                  )}

                  {drillAssessment && !drillLoading && (
                    <div className="space-y-4">
                      {/* Prediction Summary Strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-well border border-line text-xs">
                        <div>
                          <span className="text-[11px] text-faint font-mono block">Account Target</span>
                          <span className="font-mono font-bold text-ink text-sm">{drillAssessment.account_id}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-faint font-mono block">Model score</span>
                          <span className="font-mono font-bold text-iris text-sm">
                            {formatModelScore(drillAssessment.risk_score)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-faint font-mono block">Review suggestion</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold inline-block font-mono ${
                              drillAssessment.predicted_class === 'suspicious'
                              ? 'bg-danger-soft text-danger border border-danger-line'
                              : 'bg-ok-soft text-ok border border-ok-line'
                            }`}
                          >
                            {drillAssessment.predicted_class === 'suspicious' ? 'Suggested for review' : 'Below threshold'}
                          </span>
                        </div>
                        <div className="text-right">
                          <Link
                            to={`/tools/accounts/${encodeURIComponent(drillAssessment.account_id)}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-iris hover:underline"
                          >
                            <span>Open 360° Profile</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>

                      {/* TreeSHAP Contribution Waterfall List */}
                      <div className="space-y-2">
                        <span className="text-xs font-bold text-ink block">
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
                                ? 'bg-warn-soft border-warn-line'
                                : 'bg-ok-soft border-ok-line'
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-ink">
                                    {glossary?.label || c.feature_name}
                                  </span>
                                  <code className="text-[11px] font-mono text-faint">
                                    {c.feature_name} = {typeof c.feature_value === 'number' ? c.feature_value.toLocaleString() : c.feature_value}
                                  </code>
                                </div>
                                <p className="text-[11px] text-mute">
                                  {glossary?.description || 'Observable behavioral feature.'}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 self-start sm:self-center font-mono text-xs">
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                    increases ? 'bg-iris text-white' : 'bg-ice-deep text-white'
                                  }`}
                                >
                                  {increases ? '+ INCREASES RISK' : '- DECREASES RISK'}
                                </span>
                                <span className="font-bold text-ink">
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
              <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
                <div className="pb-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-iris" />
                    <h3 className="text-sm font-bold text-ink">Dataset &amp; Evaluation Provenance</h3>
                  </div>
                  <p className="text-xs text-mute">
                    Transparent recording of training corpora, data splits, and leakage safeguards.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-well border border-line space-y-2">
                    <span className="font-bold text-ink block">Evaluation Cohort &amp; Source</span>
                    <div className="space-y-1 font-mono text-[11px] text-mute">
                      <div>Source: <strong className="text-ink">{activeModelInfo.dataset_info?.source || 'Verified Artifact'}</strong></div>
                      {activeModelInfo.dataset_info?.strategy && (
                        <div>Strategy: <strong className="text-ink">{activeModelInfo.dataset_info.strategy}</strong></div>
                      )}
                      {activeModelInfo.dataset_info?.train_accounts_count && (
                        <div>Train Accounts: <strong className="text-ink">{activeModelInfo.dataset_info.train_accounts_count.toLocaleString()}</strong></div>
                      )}
                      {activeModelInfo.dataset_info?.test_accounts_count && (
                        <div>Test Accounts: <strong className="text-ink">{activeModelInfo.dataset_info.test_accounts_count.toLocaleString()}</strong></div>
                      )}
                      {activeModelInfo.dataset_info?.chronological_split && (
                        <div>Chronological Steps: <strong className="text-ink">{JSON.stringify(activeModelInfo.dataset_info.chronological_split)}</strong></div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-well border border-line space-y-2">
                    <span className="font-bold text-ink block">Target Leakage Safeguards</span>
                    {activeModelInfo.leakage_protections && activeModelInfo.leakage_protections.length > 0 ? (
                      <ul className="space-y-1 list-disc pl-4 text-[11px] text-mute">
                        {activeModelInfo.leakage_protections.map((prot, idx) => (
                          <li key={idx}>{prot}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-faint">No explicit exclusions recorded.</p>
                    )}
                  </div>
                </div>

                {/* Model Limitations & Responsible AI Guardrail */}
                <div className="p-4 rounded-xl bg-iris-wash border border-warn-line text-xs text-warn space-y-1">
                  <span className="font-bold text-ink flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-iris" />
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
