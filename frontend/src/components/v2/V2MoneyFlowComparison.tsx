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
    <div className="bg-white rounded-2xl border border-line p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-well pb-3">
        <div>
          <h4 className="text-sm font-bold text-ink font-display flex items-center gap-2">
            <Scale className="w-4 h-4 text-iris" />
            Money Received vs Money Sent
          </h4>
          <p className="text-xs text-mute mt-0.5">
            Cumulative financial velocity and ledger balance reconciliation from recorded transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-mute bg-well px-2.5 py-1 rounded-full border border-line">
            Flow-Through: {(calculatedFlowThrough * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 4-Card Metric Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Money Received */}
        <div className="bg-well rounded-xl p-3.5 border border-line">
          <div className="flex items-center justify-between text-ok mb-1.5">
            <span className="text-[11px] font-medium text-mute">Total Received</span>
            <div className="w-6 h-6 rounded-lg bg-ok-soft flex items-center justify-center">
              <ArrowDownLeft className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg font-bold text-ink font-mono">
            ₹{totalReceived.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-mute">Inbound credit transfers</span>
        </div>

        {/* Money Sent */}
        <div className="bg-well rounded-xl p-3.5 border border-line">
          <div className="flex items-center justify-between text-iris mb-1.5">
            <span className="text-[11px] font-medium text-mute">Total Sent</span>
            <div className="w-6 h-6 rounded-lg bg-iris-soft flex items-center justify-center">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg font-bold text-ink font-mono">
            ₹{totalSent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-mute">Outbound debit transfers</span>
        </div>

        {/* Net Flow */}
        <div className="bg-well rounded-xl p-3.5 border border-line">
          <div className="flex items-center justify-between text-mute mb-1.5">
            <span className="text-[11px] font-medium text-mute">Net Movement</span>
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isNetPositive ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
              {isNetPositive ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            </div>
          </div>
          <div className={`text-lg font-bold font-mono ${isNetPositive ? 'text-ok' : 'text-danger'}`}>
            {isNetPositive ? '+' : ''}₹{netFlow.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-mute">Received minus sent</span>
        </div>

        {/* Current Balance */}
        <div className="bg-well rounded-xl p-3.5 border border-line">
          <div className="flex items-center justify-between text-iris mb-1.5">
            <span className="text-[11px] font-medium text-mute">Current Balance</span>
            <div className="w-6 h-6 rounded-lg bg-iris-soft flex items-center justify-center text-iris">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg font-bold text-ink font-mono">
            ₹{currentBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-mute">Opened at ₹{initialBalance.toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* Comparative Flow Proportion Bars */}
      <div className="space-y-3 bg-well p-4 rounded-xl border border-line/70">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <span className="w-2.5 h-2.5 rounded-full bg-ok" />
              Inbound Transfers (Money Received)
            </span>
            <span className="font-mono font-bold text-ok">
              ₹{totalReceived.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-line">
            <div
              className="h-full bg-ok rounded-full transition-all duration-500"
              style={{ width: `${receivedPct}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <span className="w-2.5 h-2.5 rounded-full bg-iris" />
              Outbound Transfers (Money Sent)
            </span>
            <span className="font-mono font-bold text-iris">
              ₹{totalSent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-line">
            <div
              className="h-full bg-iris rounded-full transition-all duration-500"
              style={{ width: `${sentPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Forensic Distinction Notice */}
      <div className="flex items-start gap-2.5 text-xs text-mute bg-white rounded-xl p-3 border border-line">
        <Info className="w-4 h-4 text-iris shrink-0 mt-0.5" />
        <p className="leading-relaxed text-[11px]">
          <strong className="text-ink font-semibold">Forensic Ledger Distinction:</strong> Transaction totals reflect cumulative historical money velocity over the account's entire ledger history. Current ledger balance reflects instantaneous remaining funds after settling all debits and credits. Downstream re-transfers through intermediary mule hops must not be double-counted as separate primary thefts.
        </p>
      </div>
    </div>
  );
};
