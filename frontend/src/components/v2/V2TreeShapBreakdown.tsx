import React from 'react';
import { TrendingUp, TrendingDown, HelpCircle, Activity } from 'lucide-react';
import { V2FeatureContribution } from '../../types/v2';

interface V2TreeShapBreakdownProps {
  contributions: V2FeatureContribution[];
}

const FEATURE_LABEL_MAP: Record<string, string> = {
  max_amount: 'Max Transaction Amount',
  initial_balance: 'Opening Account Balance',
  current_balance: 'Current Account Balance',
  avg_amount: 'Average Transaction Amount',
  amount_spike_ratio: 'Max/Avg Amount Spike Ratio',
  flow_through_ratio: 'Flow-Through Drainage Ratio',
  rapid_pass_through: 'Rapid Pass-Through (<30m)',
  median_dwell_minutes: 'Median Dwell Time (Minutes)',
  total_transactions: 'Total Recorded Transactions',
  velocity_24h_count: '24-Hour Transaction Burst',
  velocity_7d_count: '7-Day Velocity',
  velocity_30d_count: '30-Day Activity Frequency',
  unique_counterparties: 'Unique External Counterparties',
  counterparty_diversity_ratio: 'Counterparty Diversity',
  fan_in_ratio: 'Fan-In Ratio (Inflows/Total)',
  fan_out_ratio: 'Fan-Out Ratio (Outflows/Total)',
  dormancy_gap_days: 'Account Inactivity Duration',
  dormant_awakening_detected: 'Dormant Account Awakening',
  cycle_detected: 'Circular Fund Loop Detected',
  kyc_tier_level: 'KYC Verification Tier',
};

function formatFeatureValue(name: string, value: number): string {
  if (name.includes('amount') || name.includes('balance')) {
    return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  if (name.includes('ratio')) {
    return `${value.toFixed(2)}x`;
  }
  if (name.includes('detected') || name.includes('rapid_pass_through')) {
    return value > 0 ? 'Detected (Yes)' : 'Not Observed (No)';
  }
  if (name.includes('count') || name.includes('transactions') || name.includes('counterparties')) {
    return value.toLocaleString();
  }
  if (name.includes('minutes') || name.includes('days')) {
    return value >= 0 ? `${value.toFixed(1)} units` : 'N/A';
  }
  return String(value);
}

export const V2TreeShapBreakdown: React.FC<V2TreeShapBreakdownProps> = ({ contributions }) => {
  if (!contributions || contributions.length === 0) {
    return (
      <div className="text-xs text-slate-500 py-3 italic">
        No local feature attribution available for this prediction.
      </div>
    );
  }

  const maxAbsScore = Math.max(...contributions.map((c) => Math.abs(c.contribution_score)), 1.0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-medium text-slate-700 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[#0D9488]" />
          Key Driving Behavioral Features (Local TreeSHAP)
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          Shapley Value (Δ Log-Odds)
        </span>
      </div>

      <div className="space-y-2">
        {contributions.map((c, idx) => {
          const isRiskIncrease = c.impact_direction === 'increases_risk' || c.contribution_score > 0;
          const absScore = Math.abs(c.contribution_score);
          const barWidth = Math.min(Math.round((absScore / maxAbsScore) * 100), 100);
          const friendlyLabel = FEATURE_LABEL_MAP[c.feature_name] || c.feature_name.replace(/_/g, ' ');

          return (
            <div
              key={idx}
              className="bg-white border border-slate-200/80 rounded-md p-2.5 text-xs hover:border-slate-300 transition-colors shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  {isRiskIncrease ? (
                    <TrendingUp className="w-3.5 h-3.5 text-crimson-600 shrink-0" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                  )}
                  <span className="font-medium text-slate-800">{friendlyLabel}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    ({formatFeatureValue(c.feature_name, c.feature_value)})
                  </span>
                </div>
                <div className="flex items-center gap-1 font-mono text-[11px] font-semibold">
                  <span
                    className={
                      isRiskIncrease
                        ? 'text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200'
                        : 'text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200'
                    }
                  >
                    {c.contribution_score > 0 ? `+${c.contribution_score.toFixed(4)}` : c.contribution_score.toFixed(4)}
                  </span>
                </div>
              </div>

              {/* Proportional Contribution Bar */}
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isRiskIncrease ? 'bg-red-500' : 'bg-teal-500'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400 italic">
        * TreeSHAP explains why the model made this specific prediction by calculating exact marginal contributions across all XGBoost decision trees.
      </p>
    </div>
  );
};
