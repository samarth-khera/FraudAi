import React, { useState } from 'react';
import { TrendingUp, TrendingDown, HelpCircle, Activity, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { V2FeatureContribution } from '../../types/v2';

interface V2TreeShapBreakdownProps {
  contributions: V2FeatureContribution[];
}

const FEATURE_LABEL_MAP: Record<string, { title: string; subtitle: string; explanation: string }> = {
  max_amount: {
    title: 'Largest transaction amount',
    subtitle: 'Max Transaction Amount',
    explanation: 'A single high-value transfer significantly above typical activity patterns pushed the AI risk score substantially higher.',
  },
  initial_balance: {
    title: 'Balance when account was first recorded',
    subtitle: 'Opening Account Balance',
    explanation: 'The initial balance provides baseline context for how much capital was normally kept in this account over time.',
  },
  current_balance: {
    title: 'Current account balance',
    subtitle: 'current_balance',
    explanation: 'Remaining funds after recent transactions. A near-zero balance after a large debit often indicates a depleted victim account.',
  },
  avg_amount: {
    title: 'Average transaction amount',
    subtitle: 'Average Transaction Amount',
    explanation: 'The historical typical transfer size against which unusual spikes are measured.',
  },
  amount_spike_ratio: {
    title: 'Max/average amount spike ratio',
    subtitle: 'Amount Spike Ratio',
    explanation: 'Measures how many times larger the peak transfer was compared to ordinary spending habits.',
  },
  flow_through_ratio: {
    title: 'Ratio of outgoing to incoming funds',
    subtitle: 'Flow-Through Drainage Ratio',
    explanation: 'Compares total outgoing money against incoming deposits to see if money is being rapidly drained.',
  },
  rapid_pass_through: {
    title: 'Rapid pass-through (<30 min)',
    subtitle: 'Immediate Forwarding Check',
    explanation: 'Whether deposits are immediately forwarded to another recipient within minutes, typical of layering money mules.',
  },
  median_dwell_minutes: {
    title: 'Median dwell time between transfers',
    subtitle: 'Median Dwell Time (Minutes)',
    explanation: 'The typical minutes funds stay in the account before moving outward.',
  },
  total_transactions: {
    title: 'Total recorded transactions',
    subtitle: 'Transaction Volume',
    explanation: 'The total number of ledger movements recorded in this investigation window.',
  },
  velocity_24h_count: {
    title: 'Transactions in 24 hours',
    subtitle: '24-Hour Transaction Burst',
    explanation: 'Sudden bursts of transfers in a single day can signal account takeover or scam dispersal.',
  },
  velocity_7d_count: {
    title: '7-day transaction frequency',
    subtitle: '7-Day Velocity',
    explanation: 'Weekly activity rate used to establish steady-state baseline behavior.',
  },
  velocity_30d_count: {
    title: '30-day activity frequency',
    subtitle: '30-Day Activity Frequency',
    explanation: 'Monthly transfer density tracking regular payroll or bill cycles.',
  },
  unique_counterparties: {
    title: 'Unique external counterparties',
    subtitle: 'Counterparty Breadth',
    explanation: 'How many different senders or receivers interacted with this account.',
  },
  counterparty_diversity_ratio: {
    title: 'Counterparty diversity ratio',
    subtitle: 'Counterparty Diversity',
    explanation: 'Ratio of unique counterparties to total transactions.',
  },
  fan_in_ratio: {
    title: 'Fan-in ratio (inflows/total)',
    subtitle: 'Incoming Transfer Concentration',
    explanation: 'Proportion of transactions representing incoming deposits.',
  },
  fan_out_ratio: {
    title: 'Fan-out ratio (outflows/total)',
    subtitle: 'Outgoing Transfer Concentration',
    explanation: 'Proportion of transactions representing outgoing payments.',
  },
  dormancy_gap_days: {
    title: 'Account inactivity duration',
    subtitle: 'Inactivity Gap',
    explanation: 'Days of dormancy before a sudden resumption of large movements.',
  },
  dormant_awakening_detected: {
    title: 'Dormant account awakening',
    subtitle: 'Sudden Reactivation',
    explanation: 'Signals when an account with zero recent activity suddenly begins moving substantial funds.',
  },
  cycle_detected: {
    title: 'Circular fund loop detected',
    subtitle: 'Circular Transaction Loop',
    explanation: 'Identifies whether funds cycled back to the originating sender through intermediaries.',
  },
  kyc_tier_level: {
    title: 'KYC verification tier',
    subtitle: 'Customer Verification Level',
    explanation: 'Identity verification status and account limits on file.',
  },
};

function formatFeatureValue(name: string, value: number): string {
  if (name.includes('amount') || name.includes('balance')) {
    return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  if (name.includes('ratio')) {
    return `${value.toFixed(2)}x`;
  }
  if (name.includes('detected') || name.includes('rapid_pass_through')) {
    return value > 0 ? 'Detected' : 'Not Observed';
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
  const [selectedFeature, setSelectedFeature] = useState<string | null>('max_amount');
  const [showExplanation, setShowExplanation] = useState<boolean>(true);

  if (!contributions || contributions.length === 0) {
    return (
      <div className="text-xs text-[#6B655B] py-4 italic bg-[#FAF7F2] rounded-xl border border-[#EAE3D6] p-4 text-center">
        No local feature attribution available for this prediction.
      </div>
    );
  }

  const maxAbsScore = Math.max(...contributions.map((c) => Math.abs(c.contribution_score)), 1.0);

  return (
    <div className="space-y-4">
      {/* Header with Title and Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#EAE3D6] pb-3">
        <div>
          <h4 className="text-base font-bold text-[#1A1714] font-display flex items-center gap-2">
            <span>Why the AI gave this score</span>
            <span className="text-[11px] font-mono font-medium text-[#6B655B] bg-[#FAF7F2] px-2.5 py-0.5 rounded-full border border-[#EAE3D6]">
              Key Driving Behavioral Features
            </span>
          </h4>
          <p className="text-xs text-[#6B655B] mt-0.5">
            Click any feature row below to inspect its observed value and impact on the score.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] font-medium text-[#6B655B] shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EA8500]"></span>
            <span>Pushes the score higher</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]"></span>
            <span>Pushes the score lower</span>
          </span>
        </div>
      </div>

      {/* Feature Contributions List */}
      <div className="space-y-2.5">
        {contributions.map((c) => {
          const isRiskIncrease = c.impact_direction === 'increases_risk' || c.contribution_score > 0;
          const absScore = Math.abs(c.contribution_score);
          const barWidth = Math.min(Math.round((absScore / maxAbsScore) * 100), 100);
          const meta = FEATURE_LABEL_MAP[c.feature_name] || {
            title: c.feature_name.replace(/_/g, ' '),
            subtitle: c.feature_name,
            explanation: 'Behavioral dimension tracked by the machine learning model.',
          };
          const isSelected = selectedFeature === c.feature_name;

          return (
            <motion.div
              key={c.feature_name}
              whileHover={{ y: -1 }}
              transition={{ duration: 0.15 }}
              onClick={() => setSelectedFeature(isSelected ? null : c.feature_name)}
              className={`rounded-2xl p-4 cursor-pointer transition-all border ${
                isSelected
                  ? isRiskIncrease
                    ? 'border-[#FCD5B5] bg-[#FFF8EE] shadow-sm ring-2 ring-[#EA8500]/20'
                    : 'border-[#BBF7D0] bg-[#F0FDF4] shadow-sm ring-2 ring-[#22C55E]/20'
                  : 'border-[#EAE3D6] bg-white hover:border-[#DDD4C4] shadow-2xs'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                <div className="flex items-start sm:items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${
                      isRiskIncrease ? 'bg-[#FFF0F2] text-[#E11D48]' : 'bg-[#EAF7EE] text-[#166534]'
                    }`}
                  >
                    {isRiskIncrease ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#1A1714]">{meta.title}</span>
                      <span className="font-mono text-[11px] text-[#8C857B] hidden md:inline">
                        ({meta.subtitle})
                      </span>
                    </div>
                    <div className="text-xs text-[#6B655B] font-mono mt-0.5">
                      Observed value: <strong className="text-[#1A1714] font-semibold">{formatFeatureValue(c.feature_name, c.feature_value)}</strong>
                    </div>
                  </div>
                </div>

                {/* Score Chip */}
                <div className="flex items-center gap-2 self-end sm:self-center font-mono">
                  <span
                    className={`px-3 py-1 rounded-xl text-xs font-bold border shadow-2xs ${
                      isRiskIncrease
                        ? 'bg-[#FFF4E6] text-[#C05621] border-[#FCD5B5]'
                        : 'bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]'
                    }`}
                  >
                    {c.contribution_score > 0
                      ? `+${c.contribution_score.toFixed(4)}`
                      : c.contribution_score.toFixed(4)}
                  </span>
                </div>
              </div>

              {/* Proportional Diverging Contribution Bar */}
              <div className="w-full bg-[#FAF7F2] rounded-full h-2 overflow-hidden border border-[#EAE3D6]/70">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isRiskIncrease
                      ? 'bg-gradient-to-r from-[#EA8500] to-[#E11D48]'
                      : 'bg-gradient-to-r from-[#22C55E] to-[#10B981]'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* Detailed Explanation Drawer on Click */}
              <AnimatePresence>
                {isSelected && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden pt-3 mt-3 border-t border-[#EAE3D6]/80 text-xs text-[#6B655B]"
                  >
                    <div className="flex items-start gap-2 bg-white/80 p-3 rounded-xl border border-[#EAE3D6]/60">
                      <Info className="w-4 h-4 text-[#EA8500] shrink-0 mt-0.5" />
                      <div>
                        <p className="leading-relaxed text-[#1A1714]">
                          {meta.explanation}
                        </p>
                        <p className="text-[11px] text-[#8C857B] mt-1">
                          TreeSHAP contribution weighting of {c.contribution_score > 0 ? `+${c.contribution_score.toFixed(4)}` : c.contribution_score.toFixed(4)} log-odds shifts the predicted risk distribution towards <span className="font-semibold">{isRiskIncrease ? 'higher suspicion' : 'lower suspicion'}</span>.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Expandable Notice */}
      <div className="bg-[#FAF7F2] rounded-xl border border-[#EAE3D6] p-3 text-xs text-[#6B655B] flex items-start gap-2.5">
        <HelpCircle className="w-4 h-4 text-[#EA8500] shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          These values show which recorded features influenced the model's prediction. They do not prove that fraud occurred or establish the account holder's intent.
        </p>
      </div>
    </div>
  );
};
