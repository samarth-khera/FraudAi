import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Clock, Filter, X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { V2TransactionItem } from '../../types/v2';

export interface TimelineDataPoint {
  dateKey: string;
  displayDate: string;
  inboundAmount: number;
  outboundAmount: number;
  inboundCount: number;
  outboundCount: number;
  totalTransactions: number;
}

interface V2ActivityTimelineProps {
  transactions: V2TransactionItem[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

export const V2ActivityTimeline: React.FC<V2ActivityTimelineProps> = ({
  transactions,
  selectedDate,
  onSelectDate,
}) => {
  // Group transactions by date
  const timelineData: TimelineDataPoint[] = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];

    const map = new Map<string, TimelineDataPoint>();

    // Sort ascending by timestamp
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    sorted.forEach((txn) => {
      const d = new Date(txn.timestamp);
      if (isNaN(d.getTime())) return;

      const dateKey = txn.timestamp.split('T')[0];
      const displayDate = d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });

      if (!map.has(dateKey)) {
        map.set(dateKey, {
          dateKey,
          displayDate,
          inboundAmount: 0,
          outboundAmount: 0,
          inboundCount: 0,
          outboundCount: 0,
          totalTransactions: 0,
        });
      }

      const point = map.get(dateKey)!;
      const amt = Number(txn.amount);
      if (txn.direction === 'inbound') {
        point.inboundAmount += amt;
        point.inboundCount += 1;
      } else {
        point.outboundAmount += amt;
        point.outboundCount += 1;
      }
      point.totalTransactions += 1;
    });

    return Array.from(map.values());
  }, [transactions]);

  if (!transactions || transactions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#E4E5F0] p-8 text-center text-[#5C6079]">
        <Clock className="w-8 h-8 text-[#868AA2] mx-auto mb-2 opacity-50" />
        <h4 className="text-sm font-bold text-[#141526]">No Activity Recorded</h4>
        <p className="text-xs mt-1">Timeline visualization requires transaction activity.</p>
      </div>
    );
  }

  const formatYAxis = (val: number) => {
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(0)}k`;
    return `₹${val}`;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: TimelineDataPoint = payload[0].payload;
      const isSelected = selectedDate === data.dateKey;
      return (
        <div className="bg-white border border-[#E4E5F0] rounded-xl p-3 shadow-lg text-xs font-sans">
          <div className="font-bold text-[#141526] mb-1 flex items-center justify-between gap-3">
            <span>Date: {data.displayDate} ({data.dateKey})</span>
            {isSelected && (
              <span className="text-[10px] text-[#6246EA] font-bold uppercase tracking-wider">Filtered</span>
            )}
          </div>
          <div className="space-y-1 text-[#5C6079] font-mono text-[11px]">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1 text-[#10B981]">
                <ArrowDownLeft className="w-3 h-3" /> Received ({data.inboundCount} txns):
              </span>
              <strong className="text-[#141526]">₹{data.inboundAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1 text-[#6246EA]">
                <ArrowUpRight className="w-3 h-3" /> Sent ({data.outboundCount} txns):
              </span>
              <strong className="text-[#141526]">₹{data.outboundAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
            </div>
            <div className="pt-1.5 border-t border-[#E4E5F0] flex items-center justify-between gap-4 text-[#141526]">
              <span>Day Activity Total:</span>
              <strong className="font-bold">{data.totalTransactions} transactions</strong>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#868AA2] italic">
            Click data point to filter transaction list to this day
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
              <Clock className="w-4 h-4 text-[#6246EA]" />
              Account Activity Timeline
            </h4>
            <span className="text-[11px] font-mono text-[#5C6079] bg-[#F6F6FC] px-2 py-0.5 rounded-full border border-[#E4E5F0]">
              {timelineData.length} active dates
            </span>
          </div>
          <p className="text-xs text-[#5C6079] mt-0.5">
            Chronological money flow over time. Click any period to filter transactions to that date.
          </p>
        </div>

        {/* Active Date Filter */}
        {selectedDate && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#EFECFF] text-[#6246EA] border border-[#D7CFFF]">
              <Filter className="w-3 h-3" />
              <span>Date: {selectedDate}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectDate(null);
                }}
                className="hover:bg-[#6246EA]/10 rounded-full p-0.5 ml-0.5 transition-colors"
                title="Clear date filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Area Chart */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={timelineData}
            margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
            onClick={(state: any) => {
              if (state && state.activePayload && state.activePayload[0]) {
                const pt: TimelineDataPoint = state.activePayload[0].payload;
                if (selectedDate === pt.dateKey) {
                  onSelectDate(null);
                } else {
                  onSelectDate(pt.dateKey);
                }
              }
            }}
          >
            <defs>
              <linearGradient id="colorOutbound" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6246EA" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6246EA" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorInbound" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F6F6FC" vertical={false} />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 11, fill: '#5C6079' }}
              axisLine={{ stroke: '#E4E5F0' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatYAxis}
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
            <Area
              type="monotone"
              dataKey="inboundAmount"
              name="Inbound Received (₹)"
              stroke="#10B981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorInbound)"
              cursor="pointer"
            />
            <Area
              type="monotone"
              dataKey="outboundAmount"
              name="Outbound Sent (₹)"
              stroke="#6246EA"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorOutbound)"
              cursor="pointer"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer Notes */}
      <div className="flex items-center justify-between text-[11px] text-[#868AA2] pt-2 border-t border-[#F6F6FC]">
        <span>Spikes represent concentration of value movements on specific dates.</span>
        <span>Click any date point to view its transactions.</span>
      </div>
    </div>
  );
};
