import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  Legend,
} from 'recharts';
import { BarChart3, Filter, X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { V2TransactionItem } from '../../types/v2';

export interface HistogramBin {
  label: string;
  min: number;
  max: number;
  inboundCount: number;
  outboundCount: number;
  totalCount: number;
  totalAmount: number;
}

interface V2TransactionHistogramProps {
  transactions: V2TransactionItem[];
  selectedBin: { min: number; max: number; label: string } | null;
  onSelectBin: (bin: { min: number; max: number; label: string } | null) => void;
  flowFilter?: 'all' | 'inbound' | 'outbound';
}

export const V2TransactionHistogram: React.FC<V2TransactionHistogramProps> = ({
  transactions,
  selectedBin,
  onSelectBin,
  flowFilter = 'all',
}) => {
  // 1. Calculate dynamic bins from actual transaction records
  const bins: HistogramBin[] = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];

    // Filter by flow if specified
    const activeTxns = flowFilter === 'all'
      ? transactions
      : transactions.filter((t) => t.direction === flowFilter);

    if (activeTxns.length === 0) return [];

    // Define standard financial transaction brackets
    const tiers = [
      { label: '< ₹1k', min: 0, max: 1000 },
      { label: '₹1k - ₹5k', min: 1000, max: 5000 },
      { label: '₹5k - ₹25k', min: 5000, max: 25000 },
      { label: '₹25k - ₹100k', min: 25000, max: 100000 },
      { label: '₹100k+', min: 100000, max: Infinity },
    ];

    const resultBins: HistogramBin[] = tiers.map((t) => ({
      label: t.label,
      min: t.min,
      max: t.max,
      inboundCount: 0,
      outboundCount: 0,
      totalCount: 0,
      totalAmount: 0,
    }));

    activeTxns.forEach((txn) => {
      const amt = Number(txn.amount);
      for (const bin of resultBins) {
        if (amt >= bin.min && (bin.max === Infinity ? true : amt < bin.max)) {
          if (txn.direction === 'inbound') {
            bin.inboundCount += 1;
          } else {
            bin.outboundCount += 1;
          }
          bin.totalCount += 1;
          bin.totalAmount += amt;
          break;
        }
      }
    });

    return resultBins;
  }, [transactions, flowFilter]);

  if (!transactions || transactions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#E4E5F0] p-8 text-center text-[#5C6079]">
        <BarChart3 className="w-8 h-8 text-[#868AA2] mx-auto mb-2 opacity-50" />
        <h4 className="text-sm font-bold text-[#141526]">No Transactions Recorded</h4>
        <p className="text-xs mt-1">Transaction amount histogram requires at least one ledger movement.</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: HistogramBin = payload[0].payload;
      const isSelected = selectedBin?.label === data.label;
      return (
        <div className="bg-white border border-[#E4E5F0] rounded-xl p-3 shadow-lg text-xs font-sans">
          <div className="font-bold text-[#141526] mb-1 flex items-center justify-between gap-3">
            <span>Range: {data.label}</span>
            {isSelected && (
              <span className="text-[10px] text-[#6246EA] font-bold uppercase tracking-wider">Active Filter</span>
            )}
          </div>
          <div className="space-y-1 text-[#5C6079] font-mono text-[11px]">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1 text-[#10B981]">
                <ArrowDownLeft className="w-3 h-3" /> Inbound (Credits):
              </span>
              <strong className="text-[#141526]">{data.inboundCount}</strong>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1 text-[#6246EA]">
                <ArrowUpRight className="w-3 h-3" /> Outbound (Debits):
              </span>
              <strong className="text-[#141526]">{data.outboundCount}</strong>
            </div>
            <div className="pt-1.5 border-t border-[#E4E5F0] flex items-center justify-between gap-4 text-[#141526]">
              <span>Total Volume:</span>
              <strong className="font-bold">₹{data.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#868AA2] italic">
            Click bar to filter transaction table
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
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-[#141526] font-display flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#6246EA]" />
              Transaction Amount Histogram
            </h4>
            <span className="text-[11px] font-mono text-[#5C6079] bg-[#F6F6FC] px-2 py-0.5 rounded-full border border-[#E4E5F0]">
              {transactions.length} records analyzed
            </span>
          </div>
          <p className="text-xs text-[#5C6079] mt-0.5">
            Frequency distribution of transaction sizes. Click any bin to filter history table below.
          </p>
        </div>

        {/* Active Filter Badge */}
        {selectedBin && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#EFECFF] text-[#6246EA] border border-[#D7CFFF]">
              <Filter className="w-3 h-3" />
              <span>Filtering: {selectedBin.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectBin(null);
                }}
                className="hover:bg-[#6246EA]/10 rounded-full p-0.5 ml-0.5 transition-colors"
                title="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Histogram Chart */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bins}
            margin={{ top: 10, right: 10, left: -15, bottom: 5 }}
            onClick={(state: any) => {
              if (state && state.activePayload && state.activePayload[0]) {
                const clickedBin: HistogramBin = state.activePayload[0].payload;
                if (selectedBin?.label === clickedBin.label) {
                  onSelectBin(null);
                } else {
                  onSelectBin({
                    min: clickedBin.min,
                    max: clickedBin.max,
                    label: clickedBin.label,
                  });
                }
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#F6F6FC" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#5C6079' }}
              axisLine={{ stroke: '#E4E5F0' }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#5C6079' }}
              axisLine={{ stroke: '#E4E5F0' }}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
            />
            <Bar
              dataKey="inboundCount"
              name="Inbound (Credits)"
              stackId="a"
              fill="#10B981"
              radius={[0, 0, 0, 0]}
              cursor="pointer"
            >
              {bins.map((entry, index) => {
                const isSelected = selectedBin?.label === entry.label;
                return (
                  <Cell
                    key={`in-${index}`}
                    fill={isSelected ? '#059669' : '#10B981'}
                    opacity={selectedBin && !isSelected ? 0.35 : 1}
                  />
                );
              })}
            </Bar>
            <Bar
              dataKey="outboundCount"
              name="Outbound (Debits)"
              stackId="a"
              fill="#6246EA"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
            >
              {bins.map((entry, index) => {
                const isSelected = selectedBin?.label === entry.label;
                return (
                  <Cell
                    key={`out-${index}`}
                    fill={isSelected ? '#4F33D6' : '#6246EA'}
                    opacity={selectedBin && !isSelected ? 0.35 : 1}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer Notes */}
      <div className="flex items-center justify-between text-[11px] text-[#868AA2] pt-2 border-t border-[#F6F6FC]">
        <span>Stacked bars display credits vs debits per amount tier.</span>
        <span>Click any bar to toggle filter.</span>
      </div>
    </div>
  );
};
