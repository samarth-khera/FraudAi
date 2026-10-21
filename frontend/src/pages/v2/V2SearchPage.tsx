import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  GitFork,
  Cpu,
  Layers,
  AlertTriangle,
  History,
  X,
  Info,
  Shield,
} from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { V2Header } from '../../components/v2/V2Header';
import { V2Footer } from '../../components/v2/V2Footer';

interface SampleCase {
  id: string;
  name: string;
  category: 'victim' | 'mule' | 'counterparty' | 'baseline';
  roleTag: string;
  tagColor: string;
  badgeDot: string;
  summary: string;
  activityCount: string;
  patternLabel: string;
  findingNote: string;
}

const SAMPLE_ACCOUNTS: SampleCase[] = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    category: 'victim',
    roleTag: 'Scam Victim Demo',
    tagColor: 'bg-[#FFF4E6] text-[#C05621] border-[#FCD5B5]',
    badgeDot: 'bg-[#EA8500]',
    summary: 'A customer tricked into sending money in a payment scam. Their savings were drained, but regular banking rules did not catch it — showing why AI protection matters.',
    activityCount: '56 transfers',
    patternLabel: 'Savings drained (₹250k)',
    findingNote: 'AI flagged unusual drain · Protected from wrongful freezing',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    category: 'mule',
    roleTag: 'Money Mule Demo',
    tagColor: 'bg-[#FFF0F2] text-[#BE123C] border-[#FECDD3]',
    badgeDot: 'bg-[#E11D48]',
    summary: 'A pass-through account used to move stolen money quickly (<12 minutes) before the funds can be frozen or recalled.',
    activityCount: '33 transfers',
    patternLabel: 'Rapid pass-through under 12 min',
    findingNote: 'Flagged for unusually fast transfer speed',
  },
  {
    id: 'ACC-000003',
    name: 'Ishan Reddy',
    category: 'counterparty',
    roleTag: 'Connected Account Demo',
    tagColor: 'bg-[#EBF5FF] text-[#1E40AF] border-[#BFDBFE]',
    badgeDot: 'bg-[#3B82F6]',
    summary: 'A recipient account 2 transfers down the payment chain. Shows how far the money trail goes and where investigation bounds stop.',
    activityCount: '48 transfers',
    patternLabel: '2 steps away from source',
    findingNote: 'Tracked in money map · Exposure bounded',
  },
  {
    id: 'ACC-000010',
    name: 'Arjun Sengupta',
    category: 'baseline',
    roleTag: 'Normal Account Demo',
    tagColor: 'bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]',
    badgeDot: 'bg-[#22C55E]',
    summary: 'A regular customer with everyday shopping and salary transfers. Confirms genuine customer accounts are never wrongly flagged.',
    activityCount: '50 transfers',
    patternLabel: 'Steady everyday transfers',
    findingNote: 'Low risk · Zero suspicious activity',
  },
];

export function normalizeAccountId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d{1,6}$/.test(trimmed)) {
    return `ACC-${trimmed.padStart(6, '0')}`;
  }
  if (/^acc-\d{1,6}$/i.test(trimmed)) {
    const numPart = trimmed.replace(/^acc-/i, '');
    return `ACC-${numPart.padStart(6, '0')}`;
  }
  return trimmed.toUpperCase();
}

export const V2SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'victim' | 'mule' | 'counterparty' | 'baseline'>('all');
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    v2Api
      .getModelsStatus()
      .then((data) => {
        setModelStatus(data);
      })
      .catch(() => {
        setModelStatus(null);
      });

    try {
      const stored = localStorage.getItem('fs_v2_recent_accounts');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, 5));
        }
      }
    } catch {
      // Ignore localStorage read errors
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError('');
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchError('Please enter an account ID (e.g. ACC-000001 or just 1)');
      return;
    }
    const normalized = normalizeAccountId(trimmed);
    if (normalized) {
      navigate(`/v2/accounts/${encodeURIComponent(normalized)}`);
    } else {
      setSearchError('Please enter a valid account ID, such as ACC-000001 or a number like 1.');
    }
  };

  const handleSelectAccount = (id: string) => {
    navigate(`/v2/accounts/${encodeURIComponent(id)}`);
  };

  const clearRecentSearches = () => {
    try {
      localStorage.removeItem('fs_v2_recent_accounts');
      setRecentSearches([]);
    } catch {
      // Ignore
    }
  };

  const filteredCases = selectedFilter === 'all'
    ? SAMPLE_ACCOUNTS
    : SAMPLE_ACCOUNTS.filter((c) => c.category === selectedFilter);

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F2E8] text-[#242424] font-sans">
      <V2Header />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
        {/* Hero & Search Card (Warm finance dashboard style matching reference) */}
        <section aria-labelledby="search-heading" className="space-y-4 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFFEFA] border border-[#E8E0D4] text-[#737373] text-xs font-medium shadow-2xs">
            <Shield className="w-3.5 h-3.5 text-[#EA8500]" />
            <span>FraudShield AI · Account Investigation</span>
          </div>

          <h1 id="search-heading" className="text-3xl sm:text-4xl font-bold tracking-tight text-[#242424] font-display">
            Look up an account
          </h1>

          <p className="text-[#737373] text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
            Enter a demo account ID to see its transaction history, connected accounts, unusual activity, and the AI's assessment.
          </p>

          {/* Search Card Container */}
          <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-5 sm:p-7 shadow-[0_4px_20px_rgba(180,150,120,0.06)] text-left mt-6 max-w-3xl mx-auto">
            <form onSubmit={handleSearch} className="space-y-3">
              <label htmlFor="account-search-input" className="block text-xs font-semibold text-[#242424]">
                Search account
              </label>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1 flex items-center">
                  <Search className="w-4 h-4 absolute left-3.5 text-[#8C8C8C]" />
                  <input
                    id="account-search-input"
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (searchError) setSearchError('');
                    }}
                    placeholder="Enter synthetic account ID, e.g. ACC-000001"
                    className="w-full bg-[#F7F2E8] border border-[#E8E0D4] rounded-xl pl-10 pr-9 py-3 text-sm text-[#242424] placeholder:text-[#8C8C8C] focus:outline-none focus:bg-[#FFFEFA] focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 font-mono transition-all"
                    autoFocus
                    aria-label="Account Identifier Search"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-3 p-1 text-[#8C8C8C] hover:text-[#242424] transition-colors cursor-pointer"
                      title="Clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-[#EA8500] hover:bg-[#D96D00] text-white font-medium text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer shrink-0"
                  title="Open account investigation"
                >
                  <span>View account</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {searchError && (
                <p className="text-xs text-rose-600 flex items-center gap-1.5 pt-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{searchError}</span>
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#737373] pt-2 border-t border-[#F2ECE2]">
                <span className="flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-[#EA8500] shrink-0" />
                  <span>Tip: Type an account ID like ACC-000001, or just the number 1. You can also pick a demo example below.</span>
                </span>
                <span className="text-[#8C8C8C] text-[11px]">Instant transaction review & AI checks</span>
              </div>
            </form>

            {/* Quick Example Chips & History */}
            <div className="mt-4 pt-3 border-t border-[#F2ECE2] space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-[#737373] text-xs">Quick examples:</span>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000001')}
                  className="px-3 py-1 rounded-full bg-[#FFF4E6] hover:bg-[#FFE8CC] text-[#C05621] border border-[#FCD5B5] font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Demo: Scam victim account"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500]"></span>
                  <span>ACC-000001 (Victim)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000002')}
                  className="px-3 py-1 rounded-full bg-[#FFF0F2] hover:bg-[#FFE4E6] text-[#BE123C] border border-[#FECDD3] font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Demo: Pass-through money mule"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48]"></span>
                  <span>ACC-000002 (Mule)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000003')}
                  className="px-3 py-1 rounded-full bg-[#EBF5FF] hover:bg-[#DBEAFE] text-[#1E40AF] border border-[#BFDBFE] font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Demo: Connected downstream recipient"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]"></span>
                  <span>ACC-000003 (Hop 2)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000010')}
                  className="px-3 py-1 rounded-full bg-[#EAF7EE] hover:bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Demo: Normal everyday customer"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
                  <span>ACC-000010 (Normal)</span>
                </button>
              </div>

              {recentSearches.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#737373] pt-1">
                  <div className="flex items-center gap-1 text-[#8C8C8C]">
                    <History className="w-3.5 h-3.5" />
                    <span>Recent:</span>
                  </div>
                  {recentSearches.map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => handleSelectAccount(rec)}
                      className="px-2.5 py-0.5 rounded-full bg-[#F7F2E8] hover:bg-[#EFE9DF] text-[#444444] border border-[#E8E0D4] font-mono text-xs transition-colors cursor-pointer"
                    >
                      {rec}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="p-1 text-[#8C8C8C] hover:text-[#242424] transition-colors ml-1 cursor-pointer"
                    title="Clear recent searches"
                    aria-label="Clear recent searches"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 3-Step Visual Workflow (Warm cards matching reference) */}
        <section aria-label="How it works" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#737373]">
              How it works
            </h2>
            <span className="text-xs text-[#8C8C8C]">3 simple steps</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-4 sm:p-5 space-y-2.5 shadow-[0_2px_10px_rgba(180,150,120,0.04)]">
              <div className="w-9 h-9 rounded-xl bg-[#EBF3FC] text-[#2B6CB0] border border-[#CFE2FA] flex items-center justify-center font-bold text-xs">
                1
              </div>
              <h3 className="text-sm font-semibold text-[#242424]">1. Find an account</h3>
              <p className="text-xs text-[#737373] leading-relaxed">
                Enter an account ID or pick one of the demo examples to see its profile.
              </p>
            </div>

            <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-4 sm:p-5 space-y-2.5 shadow-[0_2px_10px_rgba(180,150,120,0.04)]">
              <div className="w-9 h-9 rounded-xl bg-[#F4EFFE] text-[#6B46C1] border border-[#E4D7FC] flex items-center justify-center font-bold text-xs">
                2
              </div>
              <h3 className="text-sm font-semibold text-[#242424]">2. Review its activity</h3>
              <p className="text-xs text-[#737373] leading-relaxed">
                See past transfers, unusual spending patterns, and what the AI noticed.
              </p>
            </div>

            <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-4 sm:p-5 space-y-2.5 shadow-[0_2px_10px_rgba(180,150,120,0.04)]">
              <div className="w-9 h-9 rounded-xl bg-[#FFF4E6] text-[#EA8500] border border-[#FCD5B5] flex items-center justify-center font-bold text-xs">
                3
              </div>
              <h3 className="text-sm font-semibold text-[#242424]">3. Follow the money</h3>
              <p className="text-xs text-[#737373] leading-relaxed">
                Explore connected accounts and trace where outgoing transfers went next.
              </p>
            </div>
          </div>
        </section>

        {/* Try an Example Section (Warm cards inspired by reference) */}
        <section aria-labelledby="examples-heading" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E8E0D4] pb-3">
            <div>
              <h2 id="examples-heading" className="text-base sm:text-lg font-bold text-[#242424]">
                Try an example account
              </h2>
              <p className="text-xs text-[#737373] mt-0.5">
                Curated Synthetic Ledger Investigation Cases to explore how the system works
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <span className="text-[#8C8C8C] text-xs mr-1 hidden sm:inline">Filter:</span>
              {(['all', 'victim', 'mule', 'counterparty', 'baseline'] as const).map((filter) => {
                const label = filter === 'all'
                  ? 'All (4)'
                  : filter === 'victim'
                  ? 'Victim'
                  : filter === 'mule'
                  ? 'Mule'
                  : filter === 'counterparty'
                  ? 'Connected'
                  : 'Normal';

                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setSelectedFilter(filter)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                      selectedFilter === filter
                        ? 'bg-[#EA8500] text-white shadow-2xs'
                        : 'bg-[#FFFEFA] text-[#737373] hover:text-[#242424] hover:bg-[#F7F2E8] border border-[#E8E0D4]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Example Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredCases.map((acc) => (
              <div
                key={acc.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectAccount(acc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectAccount(acc.id);
                  }
                }}
                className="bg-[#FFFEFA] border border-[#E8E0D4] hover:border-[#D96D00]/60 rounded-2xl p-5 shadow-[0_2px_10px_rgba(180,150,120,0.04)] hover:shadow-md cursor-pointer transition-all duration-150 flex flex-col justify-between space-y-4 group focus-visible:ring-2 focus-visible:ring-[#EA8500] focus-visible:outline-none"
              >
                <div className="space-y-3">
                  {/* Card Header: ID, Name, Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#242424] group-hover:text-[#EA8500] transition-colors">
                          {acc.id}
                        </span>
                        <span className="text-[11px] text-[#8C8C8C]">· Demo Case</span>
                      </div>
                      <h3 className="text-base font-semibold text-[#242424] mt-0.5">{acc.name}</h3>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${acc.tagColor}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${acc.badgeDot}`}></span>
                      <span>{acc.roleTag}</span>
                    </span>
                  </div>

                  {/* Understandable Description */}
                  <p className="text-xs sm:text-sm text-[#555555] leading-relaxed">
                    {acc.summary}
                  </p>

                  {/* Scannable Highlights Grid */}
                  <div className="p-3 bg-[#FAF7F2] border border-[#EFE9DF] rounded-xl space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-[#737373]">
                      <span>Activity volume:</span>
                      <span className="font-semibold text-[#242424]">{acc.activityCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-[#737373]">
                      <span>What happened:</span>
                      <span className="font-medium text-[#242424]">{acc.patternLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-[#737373] pt-1 border-t border-[#E8E0D4]/70">
                      <span>Key takeaway:</span>
                      <span className="font-medium text-[#242424]">{acc.findingNote}</span>
                    </div>
                  </div>
                </div>

                {/* Card Action */}
                <div className="pt-2 border-t border-[#F2ECE2] flex items-center justify-between text-xs">
                  <span className="text-[#8C8C8C] text-[11px]">Click to inspect</span>
                  <span className="text-[#EA8500] font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-all">
                    <span>View account</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Simple Ground Truth Disclaimer */}
          <div className="p-3.5 bg-[#FFFEFA] border border-[#E8E0D4] rounded-xl text-xs text-[#737373] flex items-start gap-2.5 shadow-2xs">
            <Info className="w-4 h-4 text-[#EA8500] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-[#242424]">Ground-Truth Reference Notice:</strong> All accounts, names, and transactions shown above are synthetic simulations created for demonstration and testing. No real customer data or real-world banking records are used.
            </p>
          </div>
        </section>

        {/* Simplified Capabilities & System Status */}
        <section aria-labelledby="status-heading" className="space-y-3 pt-2">
          <div className="flex items-center justify-between border-b border-[#E8E0D4] pb-2">
            <h2 id="status-heading" className="text-xs font-bold uppercase tracking-wider text-[#737373]">
              System capabilities & engine status
            </h2>
            <span className="text-xs text-[#8C8C8C]">Real-time status</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Card 1: Money Flow Chain */}
            <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-4 sm:p-5 space-y-2 shadow-[0_2px_10px_rgba(180,150,120,0.04)]">
              <div className="w-9 h-9 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500]">
                <GitFork className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-[#242424]">Follow the money chain</h3>
              <p className="text-xs text-[#737373] leading-relaxed">
                See how funds move between accounts step-by-step, helping you trace stolen money without losing track of the transfer path.
              </p>
            </div>

            {/* Card 2: Double-Check Every Alert */}
            <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-4 sm:p-5 space-y-2 shadow-[0_2px_10px_rgba(180,150,120,0.04)]">
              <div className="w-9 h-9 rounded-xl bg-[#EBF3FC] border border-[#CFE2FA] flex items-center justify-center text-[#2B6CB0]">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-[#242424]">Double-check every alert</h3>
              <p className="text-xs text-[#737373] leading-relaxed">
                Combines standard banking rules with AI pattern detection so you can spot both obvious rule breaks and subtle fraud signals.
              </p>
            </div>

            {/* Card 3: AI Engine Status */}
            <div className="bg-[#FFFEFA] border border-[#E8E0D4] rounded-2xl p-4 sm:p-5 space-y-2 shadow-[0_2px_10px_rgba(180,150,120,0.04)] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-xl bg-[#F7F2E8] border border-[#E8E0D4] flex items-center justify-center text-[#737373]">
                    <Cpu className="w-4 h-4" />
                  </div>
                  {modelStatus?.inference_ready ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-[#166534] bg-[#EAF7EE] px-2.5 py-0.5 rounded-full border border-[#BBF7D0]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
                      <span>ONLINE</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>DEGRADED</span>
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-semibold text-[#242424]">Model Engine Status</h3>
                <p className="text-xs text-[#737373] leading-relaxed mt-1">
                  Ready to analyze accounts and check for suspicious transfer patterns.
                </p>
              </div>

              <div className="text-xs text-[#737373] pt-2 border-t border-[#F2ECE2] space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-[#8C8C8C]">Account ML Model:</span>
                  <span className="font-semibold text-[#242424]">{modelStatus?.account_model?.version || 'v2-account-1.0.0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8C8C8C]">Features Tracked:</span>
                  <span className="font-semibold text-[#242424]">{modelStatus?.account_model?.features_count ?? 26} dimensions</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <V2Footer />
    </div>
  );
};
