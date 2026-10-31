import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Wallet, Activity, ShieldAlert, Info, Scale } from 'lucide-react';

interface V2MoneyFlowComparisonProps {
  totalReceived: number;
  totalSent: number;
  currentBalance: number;
  initialBalance: number;
  totalTransactions: number;
  uniqueCounterparties: number;
  flowThroughRatio?: number;
}

export const V2MoneyFlowComparison: React.FC<V2MoneyFlowComparisonProps> = ({
  totalReceived,
  totalSent,
  currentBalance,
  initialBalance,
  totalTransactions,
  uniqueCounterparties,
  flowThroughRatio,
}) => {
  const netFlow = totalReceived - totalSent;
  const isNetPositive = netFlow >= 0;

  // Max for proportional visual
  const maxFlow = Math.max(totalReceived, totalSent, 1);
  const receivedPct = Math.round((totalReceived / maxFlow) * 100);
  const sentPct = Math.round((totalSent / maxFlow) * 100);

  const calculatedFlowThrough = flowThroughRatio !== undefined
    ? flowThroughRatio
    : (totalReceived > 0 ? totalSent / totalReceived : 0);

  return (
    <div className="bg-white rounded-2xl border border-[#E4E5F0] p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#F6F6FC] pb-3">
        <div>
          <h4 className="text-sm font-bold text-[#141526] font-display flex items-center gap-2">
            <Scale className="w-4 h-4 text-[#6246EA]" />
            Money Received vs Money Sent
          </h4>
          <p className="text-xs text-[#5C6079] mt-0.5">
            Cumulative financial velocity and ledger balance reconciliation from recorded transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[#5C6079] bg-[#F6F6FC] px-2.5 py-1 rounded-full border border-[#E4E5F0]">
            Flow-Through: {(calculatedFlowThrough * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 4-Card Metric Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Money Received */}
        <div className="bg-[#F6F6FC] rounded-xl p-3.5 border border-[#E4E5F0]">
          <div className="flex items-center justify-between text-[#10B981] mb-1.5">
            <span className="text-[11px] font-medium text-[#5C6079]">Total Received</span>
            <div className="w-6 h-6 rounded-lg bg-[#EAF7EE] flex items-center justify-center">
              <ArrowDownLeft className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg font-bold text-[#141526] font-mono">
            ₹{totalReceived.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#5C6079]">Inbound credit transfers</span>
        </div>

        {/* Money Sent */}
        <div className="bg-[#F6F6FC] rounded-xl p-3.5 border border-[#E4E5F0]">
          <div className="flex items-center justify-between text-[#6246EA] mb-1.5">
            <span className="text-[11px] font-medium text-[#5C6079]">Total Sent</span>
            <div className="w-6 h-6 rounded-lg bg-[#EFECFF] flex items-center justify-center">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg font-bold text-[#141526] font-mono">
            ₹{totalSent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#5C6079]">Outbound debit transfers</span>
        </div>

        {/* Net Flow */}
        <div className="bg-[#F6F6FC] rounded-xl p-3.5 border border-[#E4E5F0]">
          <div className="flex items-center justify-between text-[#5C6079] mb-1.5">
            <span className="text-[11px] font-medium text-[#5C6079]">Net Movement</span>
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isNetPositive ? 'bg-[#EAF7EE] text-[#10B981]' : 'bg-[#FFF0F2] text-[#E11D48]'}`}>
              {isNetPositive ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            </div>
          </div>
          <div className={`text-lg font-bold font-mono ${isNetPositive ? 'text-[#10B981]' : 'text-[#E11D48]'}`}>
            {isNetPositive ? '+' : ''}₹{netFlow.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#5C6079]">Received minus sent</span>
        </div>

        {/* Current Balance */}
        <div className="bg-[#F6F6FC] rounded-xl p-3.5 border border-[#E4E5F0]">
          <div className="flex items-center justify-between text-[#6246EA] mb-1.5">
            <span className="text-[11px] font-medium text-[#5C6079]">Current Balance</span>
            <div className="w-6 h-6 rounded-lg bg-[#EFECFF] flex items-center justify-center text-[#6246EA]">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg font-bold text-[#141526] font-mono">
            ₹{currentBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#5C6079]">Opened at ₹{initialBalance.toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* Comparative Flow Proportion Bars */}
      <div className="space-y-3 bg-[#F6F6FC] p-4 rounded-xl border border-[#E4E5F0]/70">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1.5 font-medium text-[#141526]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
              Inbound Transfers (Money Received)
            </span>
            <span className="font-mono font-bold text-[#10B981]">
              ₹{totalReceived.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-[#E4E5F0]">
            <div
              className="h-full bg-[#10B981] rounded-full transition-all duration-500"
              style={{ width: `${receivedPct}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1.5 font-medium text-[#141526]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#6246EA]" />
              Outbound Transfers (Money Sent)
            </span>
            <span className="font-mono font-bold text-[#6246EA]">
              ₹{totalSent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-[#E4E5F0]">
            <div
              className="h-full bg-[#6246EA] rounded-full transition-all duration-500"
              style={{ width: `${sentPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Forensic Distinction Notice */}
      <div className="flex items-start gap-2.5 text-xs text-[#5C6079] bg-white rounded-xl p-3 border border-[#E4E5F0]">
        <Info className="w-4 h-4 text-[#6246EA] shrink-0 mt-0.5" />
        <p className="leading-relaxed text-[11px]">
          <strong className="text-[#141526] font-semibold">Forensic Ledger Distinction:</strong> Transaction totals reflect cumulative historical money velocity over the account's entire ledger history. Current ledger balance reflects instantaneous remaining funds after settling all debits and credits. Downstream re-transfers through intermediary mule hops must not be double-counted as separate primary thefts.
        </p>
      </div>
    </div>
  );
};
