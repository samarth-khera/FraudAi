import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  GitFork,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  History,
  X,
  Info,
  ShieldCheck,
  Activity,
  Check,
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
    tagColor: 'bg-amber-50 text-amber-900 border-amber-200',
    badgeDot: 'bg-amber-500',
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
    tagColor: 'bg-rose-50 text-rose-900 border-rose-200',
    badgeDot: 'bg-rose-500',
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
    tagColor: 'bg-teal-50 text-teal-900 border-teal-200',
    badgeDot: 'bg-teal-500',
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
    tagColor: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    badgeDot: 'bg-emerald-500',
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
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] text-slate-900 font-sans">
      <V2Header />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
        {/* Hero & Search Card (Inspired by Reference 2 clean financial dashboard) */}
        <section aria-labelledby="search-heading" className="space-y-4 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 text-teal-400 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
            <span>FraudShield AI · Account Investigation</span>
          </div>

          <h1 id="search-heading" className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 font-display">
            Look up an account
          </h1>

          <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
            Enter a demo account ID to see its transaction history, connected accounts, unusual activity, and the AI's assessment.
          </p>

          {/* Search Card Container */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-xs text-left mt-6 max-w-3xl mx-auto">
            <form onSubmit={handleSearch} className="space-y-3">
              <label htmlFor="account-search-input" className="block text-xs font-semibold text-slate-700">
                Search account
              </label>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1 flex items-center">
                  <Search className="w-4 h-4 absolute left-3.5 text-slate-400" />
                  <input
                    id="account-search-input"
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (searchError) setSearchError('');
                    }}
                    placeholder="Enter synthetic account ID, e.g. ACC-000001"
                    className="w-full bg-slate-50/70 border border-slate-200 rounded-xl pl-10 pr-9 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 font-mono transition-all"
                    autoFocus
                    aria-label="Account Identifier Search"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-3 p-1 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                      title="Clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer shrink-0"
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

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span className="flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                  <span>Tip: Type an account ID like ACC-000001, or just the number 1. You can also pick a demo example below.</span>
                </span>
                <span className="text-slate-400 text-[11px]">Instant transaction review & AI checks</span>
              </div>
            </form>

            {/* Quick Example Chips & History */}
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-500 text-xs">Quick examples:</span>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000001')}
                  className="px-3 py-1 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Demo: Scam victim account"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span>ACC-000001 (Victim)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000002')}
                  className="px-3 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Demo: Pass-through money mule"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  <span>ACC-000002 (Mule)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000003')}
                  className="px-3 py-1 rounded-full bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Demo: Connected downstream recipient"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                  <span>ACC-000003 (Hop 2)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000010')}
                  className="px-3 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 font-mono text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Demo: Normal everyday customer"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>ACC-000010 (Normal)</span>
                </button>
              </div>

              {recentSearches.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 pt-1">
                  <div className="flex items-center gap-1 text-slate-400">
                    <History className="w-3.5 h-3.5" />
                    <span>Recent:</span>
                  </div>
                  {recentSearches.map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => handleSelectAccount(rec)}
                      className="px-2.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-xs transition-colors cursor-pointer"
                    >
                      {rec}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="p-1 text-slate-400 hover:text-slate-600 transition-colors ml-1 cursor-pointer"
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

        {/* 3-Step Visual Workflow (Requirement 4) */}
        <section aria-label="How it works" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              How it works
            </h2>
            <span className="text-xs text-slate-400">3 simple steps</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-2 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-teal-400 flex items-center justify-center font-bold text-xs">
                1
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Find an account</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter an account ID or pick one of the demo examples to see its profile.
              </p>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-2 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-teal-400 flex items-center justify-center font-bold text-xs">
                2
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Review its activity</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                See past transfers, unusual spending patterns, and what the AI noticed.
              </p>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-2 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-teal-400 flex items-center justify-center font-bold text-xs">
                3
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Follow the money</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Explore connected accounts and trace where outgoing transfers went next.
              </p>
            </div>
          </div>
        </section>

        {/* Try an Example Section (Requirement 3) */}
        <section aria-labelledby="examples-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 id="examples-heading" className="text-base sm:text-lg font-bold text-slate-900">
                Try an example account
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Curated Synthetic Ledger Investigation Cases to explore how the system works
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400 text-xs mr-1 hidden sm:inline">Filter:</span>
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
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Example Cards Grid (Clean layout inspired by Reference 2) */}
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
                className="bg-white border border-slate-200/90 rounded-2xl p-5 hover:border-slate-400 hover:shadow-md cursor-pointer transition-all duration-150 flex flex-col justify-between space-y-4 group focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
              >
                <div className="space-y-3">
                  {/* Card Header: ID, Name, Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900 group-hover:text-teal-700 transition-colors">
                          {acc.id}
                        </span>
                        <span className="text-[11px] text-slate-400">· Demo Case</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 mt-0.5">{acc.name}</h3>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${acc.tagColor}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${acc.badgeDot}`}></span>
                      <span>{acc.roleTag}</span>
                    </span>
                  </div>

                  {/* Understandable Description */}
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {acc.summary}
                  </p>

                  {/* Scannable Highlights Grid */}
                  <div className="p-3 bg-slate-50/80 border border-slate-100 rounded-xl space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-500">Activity volume:</span>
                      <span className="font-semibold text-slate-800">{acc.activityCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-500">What happened:</span>
                      <span className="font-medium text-slate-800">{acc.patternLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200/60">
                      <span className="text-slate-500">Key takeaway:</span>
                      <span className="font-medium text-teal-800">{acc.findingNote}</span>
                    </div>
                  </div>
                </div>

                {/* Card Action */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-400 text-[11px]">Click to inspect</span>
                  <span className="text-slate-900 font-semibold flex items-center gap-1 group-hover:text-teal-700 group-hover:translate-x-0.5 transition-all">
                    <span>View account</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Simple Ground Truth Disclaimer */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-slate-700">Ground-Truth Reference Notice:</strong> All accounts, names, and transactions shown above are synthetic simulations created for demonstration and testing. No real customer data or real-world banking records are used.
            </p>
          </div>
        </section>

        {/* Simplified Capabilities & System Status (Requirement 1 & 6) */}
        <section aria-labelledby="status-heading" className="space-y-3 pt-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 id="status-heading" className="text-xs font-bold uppercase tracking-wider text-slate-500">
              System capabilities & engine status
            </h2>
            <span className="text-xs text-slate-400">Real-time status</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card 1: Money Flow Chain */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-2 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
                <GitFork className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Follow the money chain</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                See how funds move between accounts step-by-step, helping you trace stolen money without losing track of the transfer path.
              </p>
            </div>

            {/* Card 2: Double-Check Every Alert */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-2 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Double-check every alert</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Combines standard banking rules with AI pattern detection so you can spot both obvious rule breaks and subtle fraud signals.
              </p>
            </div>

            {/* Card 3: AI Engine Status */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-2 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-800">
                    <Cpu className="w-4 h-4" />
                  </div>
                  {modelStatus?.inference_ready ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      <span>ONLINE</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>DEGRADED</span>
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-semibold text-slate-900">Model Engine Status</h3>
                <p className="text-xs text-slate-600 leading-relaxed mt-1">
                  Ready to analyze accounts and check for suspicious transfer patterns.
                </p>
              </div>

              <div className="text-xs text-slate-500 pt-2 border-t border-slate-100 space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Account ML Model:</span>
                  <span className="font-semibold text-slate-800">{modelStatus?.account_model?.version || 'v2-account-1.0.0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Features Tracked:</span>
                  <span className="font-semibold text-slate-800">{modelStatus?.account_model?.features_count ?? 26} dimensions</span>
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
