import React, { useState } from 'react';
import {
  ShieldAlert,
  Cpu,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
  AlertTriangle,
  Info,
  ExternalLink,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import {
  V2AccountLiveAnalysisResponse,
  V2FeatureContribution,
  V2TransactionItem,
} from '../../types/v2';

interface V2BankingDashboardRowProps {
  liveAnalysis: V2AccountLiveAnalysisResponse | null;
  transactions: V2TransactionItem[];
  onSelectTransaction: (txn: V2TransactionItem) => void;
  onViewAllTransactions: () => void;
  onSelectFeature?: (feature: V2FeatureContribution) => void;
}

export const V2BankingDashboardRow: React.FC<V2BankingDashboardRowProps> = ({
  liveAnalysis,
  transactions,
  onSelectTransaction,
  onViewAllTransactions,
  onSelectFeature,
}) => {
  const [selectedContribution, setSelectedContribution] = useState<V2FeatureContribution | null>(null);

  // Extract key values
  const mlScore = liveAnalysis?.ml_assessment?.risk_score ?? 0;
  const ruleScore = liveAnalysis?.rule_assessment?.risk_score ?? 0;
  const flowThroughRatio = liveAnalysis?.rule_assessment?.signals?.flow_through_ratio ?? 0;
  const divergence = liveAnalysis?.divergence;
  const topContributions = liveAnalysis?.ml_assessment?.top_contributions || [];

  // Recent 4 transactions
  const recentTransactions = transactions.slice(0, 4);

  // Identify peak outlier transaction
  const peakTransaction = transactions.reduce<V2TransactionItem | null>((max, curr) => {
    if (!max || curr.amount > max.amount) return curr;
    return max;
  }, null);

  // Friendly name mapping for features
  const getFeatureDisplayName = (name: string): string => {
    const mappings: Record<string, string> = {
      max_amount: 'Largest Single Transfer',
      current_balance: 'Active Current Balance',
      initial_balance: 'Starting Account Balance',
      avg_amount: 'Average Transaction Amount',
      inbound_outbound_ratio: 'Inbound vs Outbound Ratio',
      rapid_pass_through_ratio: 'Rapid Pass-Through Velocity',
      turnover_ratio: 'Account Turnover Ratio',
      unique_counterparties: 'Counterparty Diversity',
      fan_in_fan_out_ratio: 'Counterparty Flow Asymmetry',
      amount_spike_ratio: 'Amount Spike Magnitude',
      night_ratio: 'Off-Hours Activity Ratio',
      hour_variance: 'Transaction Hour Variance',
    };
    return mappings[name] || name.replace(/_/g, ' ');
  };

  // Format amount
  const formatAmount = (amt: number) => {
    return `₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };

  // SVG Gauge calculations (semi-donut or full circular donut)
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(mlScore, 100) / 100) * circumference;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* ========================================================================= */}
      {/* CARD 1: RISK & FLOW DYNAMICS (Reference: Spending Card with Donut Chart)  */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 shadow-xs flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] flex items-center justify-center text-[#EA8500]">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1A1714]">Risk & Flow Dynamics</h3>
              <p className="text-[10px] text-[#8C857B]">ML vs Rule Assessment</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#FAF7F2] text-[#6B655B] border border-[#EAE3D6]">
            {liveAnalysis ? 'Assessed' : 'Pending'}
          </span>
        </div>

        {/* Donut Chart / Radial Indicator */}
        <div className="flex flex-col items-center justify-center py-2 relative">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
              {/* Background track */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="text-[#FAF7F2] stroke-current"
                strokeWidth="10"
                fill="transparent"
              />
              {/* Rule score subtle track */}
              {liveAnalysis && (
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  className="text-[#EAE3D6] stroke-current"
                  strokeWidth="10"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference - (Math.min(ruleScore, 100) / 100) * circumference}
                  strokeLinecap="round"
                  fill="transparent"
                />
              )}
              {/* ML score active track */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="text-[#EA8500] stroke-current transition-all duration-1000 ease-out"
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={liveAnalysis ? strokeDashoffset : circumference}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>

            {/* Center score readout */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-2xl font-black text-[#1A1714] font-mono leading-none">
                {liveAnalysis ? `${mlScore.toFixed(0)}%` : '0%'}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8C857B] mt-1">
                {liveAnalysis?.ml_assessment?.risk_level || 'Risk Score'}
              </span>
            </div>
          </div>

          {/* Highlight Callout (Reference: "Rent spending is up 8.4%") */}
          <div className="w-full mt-3 bg-[#FAF7F2] rounded-2xl p-2.5 border border-[#EAE3D6] text-center">
            <span className="text-xs font-semibold text-[#1A1714]">
              {divergence?.divergence_detected
                ? '✨ Algorithm Divergence: Potential Victim Pattern'
                : liveAnalysis
                ? `✨ Score Consensus: ${liveAnalysis.ml_assessment.risk_level.toUpperCase()} Risk Profile`
                : '✨ Live Analysis pending for current session'}
            </span>
          </div>
        </div>

        {/* Bottom Legend (4 items matching reference style) */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#FAF7F2] text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#EA8500]" />
            <span className="text-[#6B655B] text-[11px]">ML Estimate:</span>
            <strong className="text-[#1A1714] font-mono text-[11px]">
              {liveAnalysis ? mlScore.toFixed(1) : '—'}
            </strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#8C857B]" />
            <span className="text-[#6B655B] text-[11px]">Rule Baseline:</span>
            <strong className="text-[#1A1714] font-mono text-[11px]">
              {liveAnalysis ? ruleScore.toFixed(1) : '—'}
            </strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            <span className="text-[#6B655B] text-[11px]">Flow-Through:</span>
            <strong className="text-[#1A1714] font-mono text-[11px]">
              {liveAnalysis ? `${(flowThroughRatio * 100).toFixed(0)}%` : '—'}
            </strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            <span className="text-[#6B655B] text-[11px]">Review:</span>
            <strong className="text-[#1A1714] text-[11px]">
              {liveAnalysis?.human_review_recommended ? 'Recommended' : 'Baseline'}
            </strong>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CARD 2: AI FEATURE CONTRIBUTIONS (Reference: Earning Card with Bars)      */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 shadow-xs flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] flex items-center justify-center text-[#EA8500]">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1A1714]">AI Feature Impact</h3>
              <p className="text-[10px] text-[#8C857B]">Local TreeSHAP Attributions</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-[#FAF7F2] text-[#6B655B] border border-[#EAE3D6]">
            @ 26 Features
          </span>
        </div>

        {/* Top Highlight (Reference: Large earning number e.g. $7,110.12) */}
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-[#1A1714] font-mono">
              {topContributions.length > 0 ? `+${topContributions[0].contribution_score.toFixed(2)}` : '0.00'}
            </span>
            <span className="text-xs font-bold text-[#EA8500]">Top Risk Factor Impact</span>
          </div>
          <p className="text-[11px] text-[#8C857B] mt-0.5">
            {topContributions.length > 0
              ? `Primary driver: ${getFeatureDisplayName(topContributions[0].feature_name)}`
              : 'Execute live analysis to view feature attributions.'}
          </p>
        </div>

        {/* Horizontal Progress Bars (Reference: Investment, Salary, Freelance, Others) */}
        <div className="space-y-3 py-1">
          {topContributions.length > 0 ? (
            topContributions.slice(0, 4).map((feat, idx) => {
              const isPositive = feat.contribution_score > 0;
              const absScore = Math.abs(feat.contribution_score);
              const maxAbs = Math.max(...topContributions.map((c) => Math.abs(c.contribution_score)), 1);
              const pctWidth = Math.min(Math.round((absScore / maxAbs) * 100), 100);

              return (
                <div
                  key={idx}
                  onClick={() => {
                    setSelectedContribution(feat);
                    onSelectFeature?.(feat);
                  }}
                  className="space-y-1 cursor-pointer group"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6B655B] group-hover:text-[#1A1714] font-medium truncate max-w-[200px]">
                      {getFeatureDisplayName(feat.feature_name)}
                    </span>
                    <span className="font-mono text-[11px] text-[#8C857B]">
                      {typeof feat.feature_value === 'number'
                        ? feat.feature_value > 1000
                          ? `₹${(feat.feature_value / 1000).toFixed(1)}k`
                          : feat.feature_value.toFixed(2)
                        : feat.feature_value}
                    </span>
                  </div>

                  {/* Horizontal Bar with active percentage badge (just like the Salary bar in the reference!) */}
                  <div className="w-full bg-[#FAF7F2] h-3 rounded-full overflow-hidden flex items-center relative border border-[#EAE3D6]/60">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        isPositive ? 'bg-[#EA8500]' : 'bg-[#10B981]'
                      }`}
                      style={{ width: `${Math.max(pctWidth, 8)}%` }}
                    />
                    <span
                      className={`absolute right-1 text-[9px] font-mono font-bold px-1 rounded ${
                        isPositive ? 'text-[#EA8500]' : 'text-[#10B981]'
                      }`}
                    >
                      {isPositive ? `+${feat.contribution_score.toFixed(2)}` : feat.contribution_score.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-6 text-center text-xs text-[#8C857B] space-y-1">
              <Sparkles className="w-6 h-6 text-[#EA8500] mx-auto opacity-50" />
              <p>Run Live Analysis to compute SHAP attributions.</p>
            </div>
          )}
        </div>

        {/* Explanation footnote */}
        <div className="pt-2 border-t border-[#FAF7F2] flex items-center justify-between text-[11px] text-[#8C857B]">
          <span>Orange (+SHAP) increases risk</span>
          <span className="text-[#10B981] font-medium">Mint (-SHAP) lowers risk</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CARD 3: RECENT TRANSACTIONS (Reference: Transactions Card with rows)       */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-[#EAE3D6] p-6 shadow-xs flex flex-col justify-between space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] flex items-center justify-center text-[#EA8500]">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1A1714]">Recent Ledger Activity</h3>
              <p className="text-[10px] text-[#8C857B]">Latest Double-Entry Records</p>
            </div>
          </div>
          <button
            onClick={onViewAllTransactions}
            className="text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors cursor-pointer flex items-center gap-1"
          >
            <span>View All</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Top Highlight Card (Reference: Asivest Subscriptions highlight card) */}
        {peakTransaction && (
          <div
            onClick={() => onSelectTransaction(peakTransaction)}
            className="bg-[#FAF7F2] hover:bg-[#F2ECE1] transition-all rounded-2xl p-3 border border-[#EAE3D6] flex items-center justify-between gap-3 cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] group-hover:scale-105 transition-transform">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#1A1714] font-mono">
                    {peakTransaction.transaction_id}
                  </span>
                  <span className="text-[10px] font-mono text-[#8C857B]">
                    ({peakTransaction.channel})
                  </span>
                </div>
                <span className="text-[10px] text-[#EA8500] font-semibold block">
                  Largest Single Transfer Observed
                </span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs font-bold text-[#EA8500] font-mono block">
                {peakTransaction.direction === 'inbound' ? '+' : '-'}
                {formatAmount(peakTransaction.amount)}
              </span>
              <span className="text-[9px] text-[#8C857B]">Inspect</span>
            </div>
          </div>
        )}

        {/* Transaction Rows (Reference: Salary Payment, Buy Macbook Pro, Refund Google Pay) */}
        <div className="space-y-2 py-1">
          {recentTransactions.map((txn, idx) => {
            const isInbound = txn.direction === 'inbound';
            return (
              <div
                key={idx}
                onClick={() => onSelectTransaction(txn)}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-[#FAF7F2] transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      isInbound ? 'bg-[#ECFDF5] text-[#10B981]' : 'bg-[#FFF7ED] text-[#EA8500]'
                    }`}
                  >
                    {isInbound ? (
                      <ArrowDownLeft className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#1A1714] font-mono block group-hover:text-[#EA8500] transition-colors">
                      {txn.counterparty_account_id}
                    </span>
                    <span className="text-[10px] text-[#8C857B] block">
                      {txn.timestamp ? new Date(txn.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Recent'} • {txn.channel}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`text-xs font-bold font-mono ${
                      isInbound ? 'text-[#10B981]' : 'text-[#EA8500]'
                    }`}
                  >
                    {isInbound ? '+' : '-'}
                    {formatAmount(txn.amount)}
                  </span>
                  <span className="text-[10px] text-[#8C857B] block font-mono">
                    {txn.status || 'SETTLED'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-[#FAF7F2] text-center">
          <button
            onClick={onViewAllTransactions}
            className="text-xs font-bold text-[#6B655B] hover:text-[#1A1714] transition-colors cursor-pointer"
          >
            Inspect all {transactions.length} records in Transaction Ledger →
          </button>
        </div>
      </div>
    </div>
  );
};
