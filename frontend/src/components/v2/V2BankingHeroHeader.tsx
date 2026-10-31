import React, { useState } from 'react';
import {
  Sparkles,
  GitFork,
  Layers,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Shield,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  Users,
  Wallet,
} from 'lucide-react';
import { V2AccountLiveAnalysisResponse, V2AccountProfileResponse } from '../../types/v2';

interface V2BankingHeroHeaderProps {
  profile: V2AccountProfileResponse | null;
  liveAnalysis: V2AccountLiveAnalysisResponse | null;
  isAnalyzing: boolean;
  onRunLiveAnalysis: () => void;
  onNavigateTab: (tab: 'assessment' | 'trace' | 'transactions' | 'review') => void;
  activeTab: 'assessment' | 'trace' | 'transactions' | 'review';
  transactionCount: number;
}

export const V2BankingHeroHeader: React.FC<V2BankingHeroHeaderProps> = ({
  profile,
  liveAnalysis,
  isAnalyzing,
  onRunLiveAnalysis,
  onNavigateTab,
  activeTab,
  transactionCount,
}) => {
  const [copiedId, setCopiedId] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);

  const handleCopyId = () => {
    if (!profile?.account_id) return;
    navigator.clipboard.writeText(profile.account_id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const currentBalance = profile?.current_balance ?? 0;
  const initialBalance = profile?.initial_balance ?? 0;
  const totalReceived = profile?.metrics.total_incoming_amount ?? 0;
  const totalSent = profile?.metrics.total_outgoing_amount ?? 0;
  const incomingTxns = profile?.metrics.total_incoming_txns ?? 0;
  const outgoingTxns = profile?.metrics.total_outgoing_txns ?? 0;
  const uniqueCounterparties = profile?.metrics.unique_counterparties ?? 0;

  return (
    <div className="space-y-4">
      {/* 1. TOP NAVIGATION & IDENTITY BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/80 backdrop-blur-md rounded-2xl px-5 py-3 border border-[#E4E5F0] shadow-2xs">
        {/* Left: Customer Avatar & Identity */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#6246EA] to-[#8B74F5] text-white flex items-center justify-center font-bold text-sm shadow-xs border-2 border-white">
            {profile?.customer_name
              ? profile.customer_name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')
              : 'AJ'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#868AA2] font-medium">Account Dossier</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span className="text-[11px] font-mono font-semibold text-[#166534] bg-[#EAF7EE] px-2 py-0.2 rounded-full border border-[#BBF7D0]">
                {profile?.status || 'Active'}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-extrabold text-[#141526] font-display tracking-tight leading-tight">
              {profile?.customer_name || 'Aditi Joshi'}
            </h1>
          </div>
        </div>

        {/* Center: Horizontal Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Account investigation sections"
          className="flex items-center gap-1.5 bg-[#F6F6FC] p-1 rounded-full border border-[#E4E5F0] self-start md:self-center overflow-x-auto max-w-full scrollbar-none"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'assessment'}
            onClick={() => onNavigateTab('assessment')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'assessment'
                ? 'bg-[#6246EA] text-white shadow-xs'
                : 'text-[#5C6079] hover:text-[#141526] hover:bg-white/80'
            }`}
          >
            Overview & Analytics
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'trace'}
            onClick={() => onNavigateTab('trace')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'trace'
                ? 'bg-[#6246EA] text-white shadow-xs'
                : 'text-[#5C6079] hover:text-[#141526] hover:bg-white/80'
            }`}
          >
            Follow the Money
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'transactions'}
            onClick={() => onNavigateTab('transactions')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'transactions'
                ? 'bg-[#6246EA] text-white shadow-xs'
                : 'text-[#5C6079] hover:text-[#141526] hover:bg-white/80'
            }`}
          >
            <span>Transaction Ledger</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'transactions' ? 'bg-white/30 text-white' : 'bg-[#E4E5F0] text-[#5C6079]'
              }`}
            >
              {transactionCount}
            </span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'review'}
            onClick={() => onNavigateTab('review')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'review'
                ? 'bg-[#6246EA] text-white shadow-xs'
                : 'text-[#5C6079] hover:text-[#141526] hover:bg-white/80'
            }`}
          >
            Compliance & Audit
          </button>
        </div>

        {/* Right: Account ID & Fast Copy */}
        <div className="flex items-center gap-2 self-end md:self-center">
          <button
            onClick={handleCopyId}
            className="flex items-center gap-1.5 text-xs font-mono text-[#5C6079] hover:text-[#141526] bg-[#F6F6FC] hover:bg-[#EEEFF7] px-2.5 py-1 rounded-xl border border-[#E4E5F0] transition-colors cursor-pointer"
            title="Click to copy account ID"
          >
            <span className="text-[#868AA2]">ID:</span>
            <strong className="text-[#141526]">{profile?.account_id}</strong>
            {copiedId ? (
              <Check className="w-3.5 h-3.5 text-[#10B981]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#868AA2]" />
            )}
          </button>
        </div>
      </div>

      {/* 2. ROW A: ACCOUNT OVERVIEW & PRIMARY ACTIONS */}
      <div className="bg-white rounded-3xl border border-[#E4E5F0] p-6 sm:p-7 shadow-xs space-y-6">
        {/* Top Action and Category Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#F6F6FC] pb-5">
          {/* Identity & Verification Badges */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#F6F6FC] text-[#141526] border border-[#E4E5F0]">
              <span>🇮🇳</span>
              <span>INR</span>
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#F6F6FC] text-[#5C6079] border border-[#E4E5F0] uppercase tracking-wide">
              {profile?.customer_type ? profile.customer_type.toUpperCase() : 'RETAIL'}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] uppercase tracking-wide">
              {profile?.kyc_tier ? profile.kyc_tier.replace(/_/g, ' ').toUpperCase() : 'TIER 2 VERIFIED'}
            </span>
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-[#868AA2] bg-[#F6F6FC] px-3 py-1 rounded-full border border-[#E4E5F0]">
              <span>Account:</span>
              <strong className="text-[#141526]">{profile?.account_id}</strong>
            </div>
          </div>

          {/* Primary & Secondary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Primary Action: Run Live Analysis */}
            <button
              id="btn-run-live-analysis"
              onClick={onRunLiveAnalysis}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#6246EA] hover:bg-[#4F33D6] disabled:bg-[#6246EA]/60 text-white font-bold text-xs sm:text-sm transition-all shadow-xs hover:shadow hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Analyzing Ledger & Model...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-current" />
                  <span>{liveAnalysis ? 'Re-run Live Analysis' : 'Run Live Analysis'}</span>
                </>
              )}
            </button>

            {/* Secondary Action: Follow the Money */}
            <button
              onClick={() => onNavigateTab('trace')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-[#F6F6FC] hover:bg-[#EEEFF7] border border-[#E4E5F0] text-[#141526] font-semibold text-xs sm:text-sm transition-all cursor-pointer"
            >
              <GitFork className="w-4 h-4 text-[#6246EA]" />
              <span>Follow the Money</span>
            </button>

            {/* Secondary Action: View Transactions */}
            <button
              onClick={() => onNavigateTab('transactions')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-[#F6F6FC] hover:bg-[#EEEFF7] border border-[#E4E5F0] text-[#141526] font-semibold text-xs sm:text-sm transition-all cursor-pointer"
            >
              <Layers className="w-4 h-4 text-[#5C6079]" />
              <span>View Transactions ({transactionCount})</span>
            </button>
          </div>
        </div>

        {/* Horizontal Metrics Summary Strip: 5 Balanced Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* 1. Active Balance */}
          <div className="bg-[#F6F6FC] rounded-2xl p-4 border border-[#E4E5F0] space-y-1.5 transition-all hover:border-[#D5D7E6]">
            <div className="flex items-center justify-between text-xs text-[#5C6079]">
              <span className="font-medium flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-[#6246EA]" />
                Current Balance
              </span>
              <button
                onClick={() => setBalanceVisible(!balanceVisible)}
                className="text-[#868AA2] hover:text-[#141526] transition-colors p-0.5 rounded cursor-pointer"
                title={balanceVisible ? 'Hide Balance' : 'Show Balance'}
              >
                {balanceVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#141526] font-display tracking-tight">
              {balanceVisible
                ? `₹${currentBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                : '₹ ••••••••'}
            </div>
            <span className="text-[11px] text-[#868AA2] font-mono block truncate">
              Initial: ₹{initialBalance.toLocaleString('en-IN')}
            </span>
          </div>

          {/* 2. Money Received */}
          <div className="bg-[#F6F6FC] rounded-2xl p-4 border border-[#E4E5F0] space-y-1.5 transition-all hover:border-[#D5D7E6]">
            <div className="flex items-center justify-between text-xs text-[#5C6079]">
              <span className="font-medium flex items-center gap-1.5">
                <ArrowDownLeft className="w-3.5 h-3.5 text-[#10B981]" />
                Money Received
              </span>
              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#141526] font-display tracking-tight">
              +₹{totalReceived.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[11px] text-[#5C6079] block truncate">
              {incomingTxns} inbound credits
            </span>
          </div>

          {/* 3. Money Sent */}
          <div className="bg-[#F6F6FC] rounded-2xl p-4 border border-[#E4E5F0] space-y-1.5 transition-all hover:border-[#D5D7E6]">
            <div className="flex items-center justify-between text-xs text-[#5C6079]">
              <span className="font-medium flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5 text-[#6246EA]" />
                Money Sent
              </span>
              <span className="w-2 h-2 rounded-full bg-[#6246EA]" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#141526] font-display tracking-tight">
              -₹{totalSent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[11px] text-[#5C6079] block truncate">
              {outgoingTxns} outbound debits
            </span>
          </div>

          {/* 4. Transaction Count */}
          <div className="bg-[#F6F6FC] rounded-2xl p-4 border border-[#E4E5F0] space-y-1.5 transition-all hover:border-[#D5D7E6]">
            <div className="flex items-center justify-between text-xs text-[#5C6079]">
              <span className="font-medium flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#5C6079]" />
                Ledger Activity
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#141526] font-display tracking-tight">
              {transactionCount}
            </div>
            <span className="text-[11px] text-[#5C6079] block truncate">
              Recorded movements
            </span>
          </div>

          {/* 5. Counterparties */}
          <div className="bg-[#F6F6FC] rounded-2xl p-4 border border-[#E4E5F0] space-y-1.5 transition-all hover:border-[#D5D7E6]">
            <div className="flex items-center justify-between text-xs text-[#5C6079]">
              <span className="font-medium flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#5C6079]" />
                Counterparties
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#141526] font-display tracking-tight">
              {uniqueCounterparties}
            </div>
            <span className="text-[11px] text-[#5C6079] block truncate">
              Connected endpoints
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
