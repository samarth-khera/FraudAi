import React, { useState } from 'react';
import {
  Sparkles,
  GitFork,
  Layers,
  ArrowUpRight,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Cpu,
  Shield,
  ShieldAlert,
  Search,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { V2AccountLiveAnalysisResponse, V2AccountProfileResponse, V2TransactionItem } from '../../types/v2';

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

  // ML and Rule scores if analyzed
  const mlScore = liveAnalysis?.ml_assessment?.risk_score;
  const mlLevel = liveAnalysis?.ml_assessment?.risk_level || 'pending';
  const ruleScore = liveAnalysis?.rule_assessment?.risk_score;
  const ruleLevel = liveAnalysis?.rule_assessment?.risk_level || 'pending';

  return (
    <div className="space-y-5">
      {/* 1. TOP HEADER NAVIGATION BAR (Reference: Avatar + Greeting on Left, Pill Nav in Center, Action Icons on Right) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/70 backdrop-blur-md rounded-2xl px-5 py-3 border border-[#EAE3D6] shadow-2xs">
        {/* Left: Avatar + Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#EA8500] to-[#FFA733] text-white flex items-center justify-center font-bold text-sm shadow-xs border-2 border-white">
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
              <span className="text-xs text-[#8C857B] font-medium">Account Dossier</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span className="text-[11px] font-mono font-semibold text-[#166534] bg-[#EAF7EE] px-2 py-0.2 rounded-full border border-[#BBF7D0]">
                {profile?.status || 'Active'}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-extrabold text-[#1A1714] font-display tracking-tight leading-tight">
              {profile?.customer_name || 'Aditi Joshi'}
            </h1>
          </div>
        </div>

        {/* Center: Horizontal Pill Navigation (Reference: Overview, Wealth, Cards, Tools) */}
        <div className="flex items-center gap-1.5 bg-[#FAF7F2] p-1 rounded-full border border-[#EAE3D6] self-start md:self-center overflow-x-auto max-w-full scrollbar-none">
          <button
            onClick={() => onNavigateTab('assessment')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'assessment'
                ? 'bg-[#EA8500] text-white shadow-xs'
                : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-white/80'
            }`}
          >
            Overview & Analytics
          </button>
          <button
            onClick={() => onNavigateTab('trace')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'trace'
                ? 'bg-[#EA8500] text-white shadow-xs'
                : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-white/80'
            }`}
          >
            Follow the Money
          </button>
          <button
            onClick={() => onNavigateTab('transactions')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'transactions'
                ? 'bg-[#EA8500] text-white shadow-xs'
                : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-white/80'
            }`}
          >
            <span>Transaction Ledger</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'transactions' ? 'bg-white/30 text-white' : 'bg-[#EAE3D6] text-[#6B655B]'
              }`}
            >
              {transactionCount}
            </span>
          </button>
          <button
            onClick={() => onNavigateTab('review')}
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'review'
                ? 'bg-[#EA8500] text-white shadow-xs'
                : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-white/80'
            }`}
          >
            Compliance & Audit
          </button>
        </div>

        {/* Right: Search & Alert Icons (Reference: Search icon + Notification badge) */}
        <div className="flex items-center gap-2 self-end md:self-center">
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#6B655B] bg-[#FAF7F2] px-2.5 py-1 rounded-xl border border-[#EAE3D6]">
            <span>ID:</span>
            <strong className="text-[#1A1714]">{profile?.account_id}</strong>
          </div>
        </div>
      </div>

      {/* 2. ROW 1: THE TWO HERO CARDS (Reference: 62% Primary Balance Card + 38% Featured Action Card) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* LEFT HERO CARD (~62% width = 7/12 or 8/12 cols): Active Balance & Actions */}
        <div className="md:col-span-7 xl:col-span-8 bg-white rounded-3xl border border-[#EAE3D6] p-6 sm:p-7 shadow-xs flex flex-col justify-between space-y-6 relative overflow-hidden">
          {/* Top row inside card: Currency/Tags on left, Account number with copy icon on right */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FAF7F2] text-[#1A1714] border border-[#EAE3D6]">
                <span>🇮🇳</span>
                <span>INR</span>
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FAF7F2] text-[#6B655B] border border-[#EAE3D6]">
                {profile?.customer_type ? profile.customer_type.toUpperCase() : 'RETAIL'}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0]">
                {profile?.kyc_tier ? profile.kyc_tier.replace(/_/g, ' ').toUpperCase() : 'TIER 2 VERIFIED'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8C857B] font-medium">Account Number</span>
              <button
                onClick={handleCopyId}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#FAF7F2] hover:bg-[#F2ECE1] border border-[#EAE3D6] font-mono text-xs font-bold text-[#1A1714] transition-colors cursor-pointer"
                title="Copy Account ID"
              >
                <span>{profile?.account_id}</span>
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#8C857B]" />
                )}
              </button>
            </div>
          </div>

          {/* Middle section: Active Balance with visibility toggle */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-[#6B655B]">
              <span>Active Ledger Balance</span>
              <button
                onClick={() => setBalanceVisible(!balanceVisible)}
                className="text-[#8C857B] hover:text-[#1A1714] transition-colors p-0.5 rounded cursor-pointer"
                title={balanceVisible ? 'Hide Balance' : 'Show Balance'}
              >
                {balanceVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#1A1714] font-mono tracking-tight">
                {balanceVisible
                  ? `₹${currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '₹ ••••••••'}
              </span>
              <span className="text-xs font-medium text-[#8C857B] font-mono">
                Initial: ₹{initialBalance.toLocaleString('en-IN')}
              </span>
            </div>

            {/* Quick in/out flow strip */}
            <div className="flex flex-wrap items-center gap-4 pt-2 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                <span className="text-[#6B655B]">Received:</span>
                <strong className="text-[#10B981]">
                  +₹{totalReceived.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </strong>
              </div>
              <span className="text-[#DDD4C4]">•</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#EA8500]" />
                <span className="text-[#6B655B]">Sent:</span>
                <strong className="text-[#EA8500]">
                  -₹{totalSent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </strong>
              </div>
              <span className="text-[#DDD4C4]">•</span>
              <div className="flex items-center gap-1.5 text-[#6B655B]">
                <span>Entities:</span>
                <strong className="text-[#1A1714]">{profile?.metrics.unique_counterparties || 0}</strong>
              </div>
            </div>
          </div>

          {/* Bottom row: Action Buttons (Reference: Primary action, secondary actions, and circular arrow button) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#FAF7F2]">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Primary Action Button: Run Live Analysis */}
              <button
                id="btn-run-live-analysis"
                onClick={onRunLiveAnalysis}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#EA8500] hover:bg-[#D27400] disabled:bg-[#EA8500]/50 text-white font-bold text-xs sm:text-sm transition-all shadow-xs hover:shadow hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
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

              {/* Secondary Action: Trace Fund Flow */}
              <button
                onClick={() => onNavigateTab('trace')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-[#FAF7F2] hover:bg-[#F2ECE1] border border-[#EAE3D6] text-[#1A1714] font-semibold text-xs sm:text-sm transition-all cursor-pointer"
              >
                <GitFork className="w-4 h-4 text-[#EA8500]" />
                <span>Trace Flow</span>
              </button>

              {/* Secondary Action: View Ledger */}
              <button
                onClick={() => onNavigateTab('transactions')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-[#FAF7F2] hover:bg-[#F2ECE1] border border-[#EAE3D6] text-[#1A1714] font-semibold text-xs sm:text-sm transition-all cursor-pointer"
              >
                <Layers className="w-4 h-4 text-[#6B655B]" />
                <span>View Ledger</span>
              </button>
            </div>

            {/* Circular quick action button (Reference: circle arrow button on bottom right) */}
            <button
              onClick={() => onNavigateTab('trace')}
              className="w-10 h-10 rounded-full bg-[#FFF4E6] hover:bg-[#EA8500] text-[#EA8500] hover:text-white border border-[#FCD5B5] flex items-center justify-center transition-all cursor-pointer shadow-2xs group"
              title="Open Full Flow Graph"
            >
              <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </div>
        </div>

        {/* RIGHT FEATURED CARD (~38% width = 5/12 or 4/12 cols): Live Risk & Model Intelligence */}
        {/* Styled after the vibrant featured card in the reference (rewards/points in ref, risk intelligence here) */}
        <div className="md:col-span-5 xl:col-span-4 bg-gradient-to-br from-[#FFF5EA] via-[#FFEEDC] to-[#FFE4C9] rounded-3xl border-2 border-[#EA8500]/30 p-6 sm:p-7 shadow-xs flex flex-col justify-between space-y-5 relative overflow-hidden">
          {/* Subtle decorative watermark shield */}
          <div className="absolute -right-6 -bottom-6 w-36 h-36 opacity-10 pointer-events-none text-[#EA8500]">
            <Shield className="w-full h-full fill-current" />
          </div>

          {/* Top row: Priority badge + status */}
          <div className="flex items-center justify-between relative z-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-[#EA8500] text-white shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>{liveAnalysis ? 'MODEL ACTIVE' : 'INTELLIGENCE READY'}</span>
            </span>

            <span className="text-xs font-mono font-semibold text-[#8C857B]">
              v2-account-1.0.0
            </span>
          </div>

          {/* Middle: ML Model Prediction */}
          <div className="space-y-1 relative z-10">
            <span className="text-xs font-semibold text-[#6B655B] block">
              {liveAnalysis ? 'ML Model Prediction' : 'Account Intelligence Status'}
            </span>
            <div className="flex items-baseline gap-3">
              {liveAnalysis ? (
                <>
                  <span className="text-3xl sm:text-4xl font-black text-[#1A1714] font-mono">
                    {mlScore !== undefined ? mlScore.toFixed(1) : '—'}
                  </span>
                  <span className="text-xs text-[#6B655B] font-mono">/ 100</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                      mlLevel === 'high' || mlLevel === 'critical'
                        ? 'bg-[#FEF2F2] text-[#DC2626] border border-[#FCA5A5]'
                        : mlLevel === 'elevated'
                        ? 'bg-[#FFF7ED] text-[#EA580C] border border-[#FDBA74]'
                        : 'bg-[#ECFDF5] text-[#059669] border border-[#6EE7B7]'
                    }`}
                  >
                    {mlLevel}
                  </span>
                </>
              ) : (
                <div className="py-1">
                  <span className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] font-display">
                    Pending Analysis
                  </span>
                  <p className="text-xs text-[#6B655B] mt-0.5">
                    Click "Run Live Analysis" to evaluate 26 ledger features.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom: Two Inset Sub-cards (Reference: Delibix Points & Voucher sub-cards) */}
          <div className="grid grid-cols-2 gap-3 relative z-10 pt-2">
            <div className="bg-white/85 backdrop-blur-sm rounded-2xl p-3 border border-[#EAE3D6] space-y-0.5 shadow-2xs">
              <span className="text-[10px] font-bold text-[#8C857B] uppercase block">Rule Engine</span>
              <div className="flex items-baseline justify-between">
                <span className="text-base font-extrabold text-[#1A1714] font-mono">
                  {ruleScore !== undefined ? `${ruleScore.toFixed(1)}` : 'Ready'}
                </span>
                <span className="text-[10px] font-semibold text-[#6B655B] uppercase">
                  {ruleLevel !== 'pending' ? ruleLevel : 'Signals'}
                </span>
              </div>
            </div>

            <div className="bg-white/85 backdrop-blur-sm rounded-2xl p-3 border border-[#EAE3D6] space-y-0.5 shadow-2xs">
              <span className="text-[10px] font-bold text-[#8C857B] uppercase block">Ledger Scope</span>
              <div className="flex items-baseline justify-between">
                <span className="text-base font-extrabold text-[#1A1714] font-mono">
                  {transactionCount}
                </span>
                <span className="text-[10px] font-semibold text-[#6B655B]">Txns</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
