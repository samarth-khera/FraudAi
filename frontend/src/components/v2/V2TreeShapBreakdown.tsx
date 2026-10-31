import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, HelpCircle, Info, ChevronRight, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { V2FeatureContribution } from '../../types/v2';

interface V2TreeShapBreakdownProps {
  contributions: V2FeatureContribution[];
}

const FEATURE_LABEL_MAP: Record<string, { title: string; subtitle: string; explanation: string }> = {
  max_amount: {
    title: 'Largest transaction amount',
    subtitle: 'max_amount',
    explanation: 'A single high-value transfer significantly above typical activity patterns pushed the AI risk score substantially higher.',
  },
  initial_balance: {
    title: 'Starting balance',
    subtitle: 'initial_balance',
    explanation: 'The opening balance recorded when the account joined the ledger, establishing historical capital context.',
  },
  current_balance: {
    title: 'Current balance',
    subtitle: 'current_balance',
    explanation: 'Remaining funds after recent transactions. A depleted balance following a high debit often indicates a drained victim.',
  },
  avg_amount: {
    title: 'Average transaction amount',
    subtitle: 'avg_amount',
    explanation: 'The historical average transfer size against which anomalous spikes are compared.',
  },
  amount_spike_ratio: {
    title: 'Transaction spike ratio',
    subtitle: 'amount_spike_ratio',
    explanation: 'Measures how many times higher the peak transfer was compared to historical spending habits.',
  },
  flow_through_ratio: {
    title: 'Inflow to outflow ratio',
    subtitle: 'flow_through_ratio',
    explanation: 'Compares total outgoing transfers against incoming credits to detect rapid drainage or pass-through conduit routing.',
  },
  rapid_pass_through: {
    title: 'Rapid pass-through (<30 min)',
    subtitle: 'rapid_pass_through',
    explanation: 'Flags whether deposits are immediately forwarded to another recipient within 30 minutes, typical of layering mules.',
  },
  median_dwell_minutes: {
    title: 'Median dwell time',
    subtitle: 'median_dwell_minutes',
    explanation: 'The median minutes funds remain in the account before moving outward.',
  },
  total_transactions: {
    title: 'Total transactions count',
    subtitle: 'total_transactions',
    explanation: 'Total number of ledger transactions recorded for this account.',
  },
  velocity_24h_count: {
    title: '24-hour transaction count',
    subtitle: 'velocity_24h_count',
    explanation: 'Sudden high transaction velocity within a 24-hour window.',
  },
  velocity_7d_count: {
    title: '7-day transaction count',
    subtitle: 'velocity_7d_count',
    explanation: 'Weekly activity rate establishing baseline customer behavior.',
  },
  velocity_30d_count: {
    title: '30-day transaction count',
    subtitle: 'velocity_30d_count',
    explanation: 'Monthly transfer density tracking regular payroll or bill cycles.',
  },
  unique_counterparties: {
    title: 'Unique counterparties count',
    subtitle: 'unique_counterparties',
    explanation: 'Number of distinct senders or receivers who interacted with this account.',
  },
  counterparty_diversity_ratio: {
    title: 'Counterparty diversity ratio',
    subtitle: 'counterparty_diversity_ratio',
    explanation: 'Ratio of unique counterparties relative to total transaction count.',
  },
  fan_in_ratio: {
    title: 'Fan-in incoming ratio',
    subtitle: 'fan_in_ratio',
    explanation: 'Proportion of transactions representing incoming deposits.',
  },
  fan_out_ratio: {
    title: 'Fan-out outgoing ratio',
    subtitle: 'fan_out_ratio',
    explanation: 'Proportion of transactions representing outgoing payments.',
  },
  dormancy_gap_days: {
    title: 'Dormancy inactivity gap',
    subtitle: 'dormancy_gap_days',
    explanation: 'Days of complete inactivity preceding sudden reactivation.',
  },
  dormant_awakening_detected: {
    title: 'Dormant account awakening',
    subtitle: 'dormant_awakening_detected',
    explanation: 'Flags when a historically quiet account suddenly resumes high-value transfers.',
  },
  cycle_detected: {
    title: 'Circular transfer detected',
    subtitle: 'cycle_detected',
    explanation: 'Identifies circular fund routing back to originating entities.',
  },
  kyc_tier_level: {
    title: 'KYC verification tier',
    subtitle: 'kyc_tier_level',
    explanation: 'Customer due diligence verification level on file.',
  },
  balance_ratio: {
    title: 'Balance retention ratio',
    subtitle: 'balance_ratio',
    explanation: 'Ratio of current balance to initial starting balance.',
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
    return value > 0 ? 'Active' : 'Inactive';
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
  const [selectedFeature, setSelectedFeature] = useState<string | null>(
    contributions && contributions.length > 0 ? contributions[0].feature_name : null
  );

  if (!contributions || contributions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#E4E5F0] p-6 text-center text-xs text-[#5C6079] italic">
        No TreeSHAP feature contributions available for this model inference run.
      </div>
    );
  }

  // Format data for Recharts horizontal BarChart
  const chartData = contributions.map((c) => {
    const meta = FEATURE_LABEL_MAP[c.feature_name] || {
      title: c.feature_name.replace(/_/g, ' '),
      subtitle: c.feature_name,
      explanation: 'Behavioral dimension analyzed by the gradient boosting model.',
    };
    return {
      rawName: c.feature_name,
      displayName: meta.title,
      score: c.contribution_score,
      featureValue: c.feature_value,
      impact: c.impact_direction,
      formattedVal: formatFeatureValue(c.feature_name, c.feature_value),
      meta,
    };
  });

  const activeFeatureObj = contributions.find((c) => c.feature_name === selectedFeature) || contributions[0];
  const activeMeta = FEATURE_LABEL_MAP[activeFeatureObj?.feature_name || ''] || {
    title: activeFeatureObj?.feature_name?.replace(/_/g, ' ') || 'Feature',
    subtitle: activeFeatureObj?.feature_name || '',
    explanation: 'Behavioral feature analyzed by the ML model.',
  };

  const CustomShapTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isPositive = data.score > 0;
      return (
        <div className="bg-white border border-[#E4E5F0] rounded-xl p-3 shadow-lg text-xs font-sans">
          <div className="font-bold text-[#141526] mb-1">
            {data.displayName}
          </div>
          <div className="text-[11px] text-[#5C6079] font-mono space-y-1">
            <div>
              Observed Value: <strong className="text-[#141526]">{data.formattedVal}</strong>
            </div>
            <div>
              SHAP Attribution:{' '}
              <strong className={isPositive ? 'text-[#6246EA]' : 'text-[#10B981]'}>
                {isPositive ? `+${data.score.toFixed(4)}` : data.score.toFixed(4)}
              </strong>
            </div>
            <div className="text-[10px] text-[#868AA2] pt-1 border-t border-[#F6F6FC]">
              {isPositive ? 'Pushed risk estimate higher' : 'Reduced risk estimate'}
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E4E5F0] p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#F6F6FC] pb-3">
        <div>
          <h4 className="text-sm font-bold text-[#141526] font-display flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#6246EA]" />
            TreeSHAP Feature Attribution (Why the Model Gave This Score)
          </h4>
          <p className="text-xs text-[#5C6079] mt-0.5">
            Local SHAP contributions explain which observable features pushed the risk estimate higher or lower.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] font-medium text-[#5C6079] shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#6246EA]" />
            <span>Increases Risk (+)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
            <span>Decreases Risk (-)</span>
          </span>
        </div>
      </div>

      {/* Horizontal Bar Chart */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 5, right: 30, left: 140, bottom: 5 }}
            onClick={(state: any) => {
              if (state && state.activePayload && state.activePayload[0]) {
                setSelectedFeature(state.activePayload[0].payload.rawName);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#F6F6FC" horizontal={false} />
            <XAxis
              type="number"
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fill: '#5C6079' }}
              axisLine={{ stroke: '#E4E5F0' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              tick={{ fontSize: 11, fill: '#141526', fontWeight: 500 }}
              axisLine={{ stroke: '#E4E5F0' }}
              tickLine={false}
              width={135}
            />
            <Tooltip content={<CustomShapTooltip />} />
            <ReferenceLine x={0} stroke="#868AA2" strokeWidth={1.5} />
            <Bar dataKey="score" radius={[4, 4, 4, 4]} cursor="pointer">
              {chartData.map((entry, index) => {
                const isSelected = selectedFeature === entry.rawName;
                const isPositive = entry.score > 0;
                return (
                  <Cell
                    key={`shap-${index}`}
                    fill={isPositive ? (isSelected ? '#4F33D6' : '#6246EA') : (isSelected ? '#059669' : '#10B981')}
                    stroke={isSelected ? '#141526' : 'transparent'}
                    strokeWidth={isSelected ? 1.5 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Selected Feature Explanation Card */}
      {activeFeatureObj && (
        <div className="bg-[#F6F6FC] rounded-xl p-4 border border-[#E4E5F0] text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${activeFeatureObj.contribution_score > 0 ? 'bg-[#6246EA]' : 'bg-[#10B981]'}`} />
              <strong className="text-sm font-bold text-[#141526]">{activeMeta.title}</strong>
              <span className="font-mono text-[11px] text-[#868AA2]">({activeMeta.subtitle})</span>
            </div>
            <div className="flex items-center gap-3 font-mono">
              <span className="text-[#5C6079]">
                Observed: <strong className="text-[#141526] font-semibold">{formatFeatureValue(activeFeatureObj.feature_name, activeFeatureObj.feature_value)}</strong>
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full font-bold text-xs border ${
                  activeFeatureObj.contribution_score > 0
                    ? 'bg-[#EFECFF] text-[#6246EA] border-[#D7CFFF]'
                    : 'bg-[#EAF7EE] text-[#10B981] border-[#BBF7D0]'
                }`}
              >
                SHAP: {activeFeatureObj.contribution_score > 0 ? `+${activeFeatureObj.contribution_score.toFixed(4)}` : activeFeatureObj.contribution_score.toFixed(4)}
              </span>
            </div>
          </div>
          <p className="text-[#5C6079] leading-relaxed">
            {activeMeta.explanation}
          </p>
        </div>
      )}

      {/* Interactive Feature Selectors */}
      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#F6F6FC]">
        <span className="text-[11px] text-[#868AA2] self-center mr-1">Select feature:</span>
        {contributions.map((c) => {
          const isSelected = selectedFeature === c.feature_name;
          const meta = FEATURE_LABEL_MAP[c.feature_name] || { title: c.feature_name };
          return (
            <button
              key={c.feature_name}
              onClick={() => setSelectedFeature(c.feature_name)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                isSelected
                  ? 'bg-[#6246EA] text-white shadow-xs'
                  : 'bg-[#F6F6FC] text-[#5C6079] hover:bg-[#E4E5F0] hover:text-[#141526]'
              }`}
            >
              {meta.title}
            </button>
          );
        })}
      </div>
    </div>
  );
};
