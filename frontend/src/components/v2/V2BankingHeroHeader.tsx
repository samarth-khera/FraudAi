import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, ArrowDownLeft, ArrowUpRight, Check, Copy, Eye, EyeOff, GitFork, Layers, RefreshCw, Sparkles, Users, Wallet } from 'lucide-react';
import { V2AccountLiveAnalysisResponse, V2AccountProfileResponse } from '../../types/v2';
import { springSnappy } from '../../lib/motion';

type Tab = 'assessment' | 'trace' | 'transactions' | 'review';

interface V2BankingHeroHeaderProps {
  profile: V2AccountProfileResponse | null;
  liveAnalysis: V2AccountLiveAnalysisResponse | null;
  isAnalyzing: boolean;
  onRunLiveAnalysis: () => void;
  onNavigateTab: (tab: Tab) => void;
  activeTab: Tab;
  transactionCount: number;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'assessment', label: 'Overview and analysis' },
  { id: 'trace', label: 'Follow the money' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'review', label: 'Review' },
];

const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const words = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null);

const Figure: React.FC<{ icon: typeof Wallet; iconClass: string; label: string; value: React.ReactNode; note: React.ReactNode; aside?: React.ReactNode }> = ({
  icon: Icon,
  iconClass,
  label,
  value,
  note,
  aside,
}) => (
  <div className="min-w-0 px-0 lg:px-5 lg:first:pl-0 lg:border-l lg:first:border-l-0 border-line">
    <dt className="flex items-center justify-between gap-2 text-[13px] font-medium text-mute">
      <span className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${iconClass}`} aria-hidden="true" />
        {label}
      </span>
      {aside}
    </dt>
    <dd className="mt-1.5 font-display text-[22px] font-bold tracking-tight text-ink truncate">{value}</dd>
    <dd className="text-xs text-faint truncate">{note}</dd>
  </div>
);

/** The top of an account's page: who it is, what can be done with it, its ledger figures and its sections. */
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
    navigator.clipboard?.writeText(profile.account_id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const initials = (profile?.customer_name ?? '')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('');

  return (
    <div className="space-y-4">
      <section data-reveal aria-label="Account" className="panel panel-sheen p-5 sm:p-6">
        <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <span
              className="w-12 h-12 rounded-2xl bg-gradient-to-br from-iris to-ice text-white flex items-center justify-center font-display font-bold text-base shrink-0 shadow-[0_8px_18px_-10px_rgba(101,88,232,0.8)]"
              aria-hidden="true"
            >
              {initials || '·'}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="page-title !text-[26px] sm:!text-[30px]">{profile?.customer_name ?? 'Account'}</h1>
                {profile?.status && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft text-ok ring-1 ring-ok-line px-2.5 py-0.5 text-xs font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok-fill" aria-hidden="true" />
                    Account {profile.status}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-line px-2 py-1 font-mono text-[12.5px] font-semibold text-ink hover:ring-iris-line transition-colors cursor-pointer"
                  title="Copy the account ID"
                >
                  {profile?.account_id}
                  {copiedId ? <Check className="w-3.5 h-3.5 text-ok" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5 text-faint" aria-hidden="true" />}
                  <span className="sr-only">{copiedId ? 'Copied' : 'Copy the account ID'}</span>
                </button>
                <span className="rounded-full bg-well ring-1 ring-line px-2.5 py-1 font-semibold text-mute">INR</span>
                {words(profile?.customer_type) && <span className="rounded-full bg-well ring-1 ring-line px-2.5 py-1 font-semibold text-mute">{words(profile?.customer_type)} customer</span>}
                {words(profile?.kyc_tier) && <span className="rounded-full bg-well ring-1 ring-line px-2.5 py-1 font-semibold text-mute">KYC {words(profile?.kyc_tier)?.toLowerCase()}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button id="btn-run-live-analysis" type="button" onClick={onRunLiveAnalysis} disabled={isAnalyzing} className="btn-primary">
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Analysing the ledger and model…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  {liveAnalysis ? 'Re-run live analysis' : 'Run live analysis'}
                </>
              )}
            </button>
            <button type="button" onClick={() => onNavigateTab('trace')} className="btn-secondary">
              <GitFork className="w-4 h-4 text-iris" aria-hidden="true" />
              Follow the money
            </button>
            <button type="button" onClick={() => onNavigateTab('transactions')} className="btn-secondary">
              <Layers className="w-4 h-4 text-mute" aria-hidden="true" />
              View transactions ({transactionCount})
            </button>
          </div>
        </div>

        <dl className="mt-6 pt-5 border-t border-line grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-5">
          <Figure
            icon={Wallet}
            iconClass="text-iris"
            label="Current balance"
            value={balanceVisible ? money(profile?.current_balance ?? 0) : '₹ ••••••'}
            note={`Opening balance ${money(profile?.initial_balance ?? 0)}`}
            aside={
              <button
                type="button"
                onClick={() => setBalanceVisible(!balanceVisible)}
                className="text-faint hover:text-ink transition-colors p-0.5 rounded cursor-pointer"
                aria-label={balanceVisible ? 'Hide balance' : 'Show balance'}
                title={balanceVisible ? 'Hide balance' : 'Show balance'}
              >
                {balanceVisible ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
            }
          />
          <Figure
            icon={ArrowDownLeft}
            iconClass="text-ice-deep"
            label="Money received"
            value={`+${money(profile?.metrics.total_incoming_amount ?? 0)}`}
            note={`${profile?.metrics.total_incoming_txns ?? 0} incoming transfers`}
          />
          <Figure
            icon={ArrowUpRight}
            iconClass="text-iris"
            label="Money sent"
            value={`−${money(profile?.metrics.total_outgoing_amount ?? 0)}`}
            note={`${profile?.metrics.total_outgoing_txns ?? 0} outgoing transfers`}
          />
          <Figure icon={Activity} iconClass="text-mute" label="Ledger activity" value={transactionCount} note="Recorded movements" />
          <Figure icon={Users} iconClass="text-mute" label="Counterparties" value={profile?.metrics.unique_counterparties ?? 0} note="Distinct accounts paid or paid by" />
        </dl>
      </section>

      <div
        data-reveal
        role="tablist"
        aria-label="Account investigation sections"
        className="flex gap-1 overflow-x-auto no-scrollbar rounded-2xl bg-[rgba(255,255,255,0.78)] backdrop-blur-xl ring-1 ring-line p-1.5 shadow-[var(--shadow-xs)]"
      >
        {TABS.map((t) => {
          const on = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onNavigateTab(t.id)}
              className={`relative isolate flex-1 min-w-max inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors duration-150 cursor-pointer ${
                on ? 'text-ink' : 'text-mute hover:text-ink hover:bg-white/80'
              }`}
            >
              {on && (
                <motion.span
                  layoutId="account-tab"
                  transition={springSnappy}
                  className="absolute inset-0 -z-10 rounded-xl bg-white ring-1 ring-line shadow-[var(--shadow-float)]"
                  aria-hidden="true"
                />
              )}
              {t.label}
              {t.id === 'transactions' && (
                <span className={`rounded-full px-1.5 text-[11px] font-mono ${on ? 'bg-iris-soft text-iris-deep' : 'bg-well text-mute'}`}>{transactionCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default V2BankingHeroHeader;
