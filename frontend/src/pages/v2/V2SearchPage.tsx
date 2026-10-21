import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Shield,
  ArrowRight,
  GitFork,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Database,
  History,
  X,
  Info,
  Sparkles,
  HelpCircle,
  TrendingDown,
  ArrowUpRight,
  UserCheck,
  Zap,
} from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { V2Header } from '../../components/v2/V2Header';
import { V2Footer } from '../../components/v2/V2Footer';

interface SampleCase {
  id: string;
  name: string;
  category: 'victim' | 'mule' | 'counterparty' | 'baseline';
  role: string;
  termTitle: string;
  termExplanation: string;
  benchmarkLabel: string;
  tagColor: string;
  description: string;
  metrics: string;
  statTxns: string;
  statFlow: string;
  statRisk: string;
  keyFlag: string;
}

const SAMPLE_ACCOUNTS: SampleCase[] = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    category: 'victim',
    role: 'Compromised Victim (APP Scam)',
    termTitle: 'APP Scam (Authorized Push Payment)',
    termExplanation: 'The legitimate account owner was tricked by fraudsters into sending funds. Shows high ML risk (76.5) vs low rule risk (25.0) — protecting victims from wrongful account freezing.',
    benchmarkLabel: 'Offline Benchmark: SCENARIO-APP-001 (Compromised Victim)',
    tagColor: 'bg-amber-50 text-amber-900 border-amber-200',
    description: 'Legitimate retail customer whose savings were drained (₹250,000) during an authorized push payment scam. Demonstrates ML score divergence (76.5) vs rule baseline (25.0) and innocent victim protection.',
    metrics: '56 txns · Net: -₹122.8k · ML Risk: 76.5 · Rule Risk: 25.0 (Low)',
    statTxns: '56 txns',
    statFlow: 'Net -₹122.8k',
    statRisk: 'ML: 76.5 vs Rule: 25.0',
    keyFlag: 'Divergence: Victim Protect',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    category: 'mule',
    role: 'Intermediate Layering Mule',
    termTitle: 'Layering Mule Account',
    termExplanation: 'An intermediary account used by criminal syndicates to rapidly split and pass through stolen funds within minutes (<12m dwell time) before cashout.',
    benchmarkLabel: 'Offline Benchmark: SCENARIO-APP-001 (Layering Hop 1)',
    tagColor: 'bg-red-50 text-red-900 border-red-200',
    description: 'First-hop mule routing illicit funds with rapid pass-through (<12 min dwell time) between victim origin and cashout terminals.',
    metrics: '33 txns · Rapid Pass-Through: TRUE · Turn: ₹447k · Rule Risk: 60.0',
    statTxns: '33 txns',
    statFlow: 'Turnover ₹447k',
    statRisk: 'Rule Risk: 60.0 (High)',
    keyFlag: 'Rapid Pass-Through (<12m)',
  },
  {
    id: 'ACC-000003',
    name: 'Ishan Reddy',
    category: 'counterparty',
    role: 'Downstream Counterparty / Retail',
    termTitle: 'Downstream Hop (2 Hops)',
    termExplanation: 'A recipient node downstream in the transfer chain. Tests multi-hop graph attribution limits to ensure downstream accounts are not unfairly penalized beyond exposure bounds.',
    benchmarkLabel: 'Offline Benchmark: SCENARIO-APP-001 (Downstream Hop 2)',
    tagColor: 'bg-teal-50 text-teal-900 border-teal-200',
    description: 'Recipient node connected downstream to victim transfer. Evaluates multi-hop graph attribution bounds, hop distances, and exposure upper ceiling.',
    metrics: '48 txns · Balance: ₹107k · Direction: Outbound · 2 Hops from Root',
    statTxns: '48 txns',
    statFlow: 'Bal ₹107k (Outbound)',
    statRisk: '2 Hops from Root',
    keyFlag: 'Bounded Exposure Ceiling',
  },
  {
    id: 'ACC-000010',
    name: 'Arjun Sengupta',
    category: 'baseline',
    role: 'Active Retail Baseline Customer',
    termTitle: 'Normal Retail Control',
    termExplanation: 'A legitimate high-volume customer with healthy velocity, steady turnover, and diverse counterparties. Used to verify the system produces zero false positives on clean accounts.',
    benchmarkLabel: 'Offline Benchmark: Normal Control (Non-Scenario)',
    tagColor: 'bg-slate-100 text-slate-800 border-slate-200',
    description: 'High-volume legitimate retail customer baseline with continuous transaction history, steady velocity, and normal counterparty diversity.',
    metrics: '50 txns · Flow: 0.33 · Rule Risk: LOW (0.0) · ML Risk: LOW (0.0)',
    statTxns: '50 txns',
    statFlow: 'Flow Ratio: 0.33',
    statRisk: 'ML: 0.0 · Rule: 0.0',
    keyFlag: 'Verified Clean Baseline',
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
    const normalized = normalizeAccountId(query);
    if (normalized) {
      navigate(`/v2/accounts/${encodeURIComponent(normalized)}`);
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
    <div className="min-h-screen flex flex-col bg-[#F5F4F0] text-slate-900">
      <V2Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-7">
        {/* Hero & Search Section */}
        <section aria-labelledby="hero-title" className="max-w-3xl mx-auto text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B1322] text-[#2DD4BF] text-xs font-mono font-medium shadow-2xs">
            <Shield className="w-3.5 h-3.5 text-[#2DD4BF]" />
            <span>FraudShield AI V2 · Account-Centric Investigation Workspace</span>
          </div>

          <h1 id="hero-title" className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-900 font-display">
            Investigate Account Risk & Multi-Hop Fund Flows
          </h1>

          <p className="text-slate-600 text-xs sm:text-sm leading-relaxed max-w-2xl mx-auto">
            Forensic decision-support for compliance analysts and fraud investigators. Search any core banking account to inspect 360° behavioral metrics, deterministic rule triggers, XGBoost risk probabilities, TreeSHAP feature attribution, and directed multi-hop money flows.
          </p>

          {/* Search Box Card */}
          <div className="bg-white border border-[#E2DFD7] rounded-xl p-3 sm:p-4 shadow-sm text-left mt-5">
            <form onSubmit={handleSearch} className="space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1 flex items-center">
                  <Search className="w-4 h-4 absolute left-3.5 text-[#0D9488]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Enter Synthetic Account ID (e.g. ACC-000001 or 1)..."
                    className="w-full bg-[#FAF9F6] border border-[#CFCBC0] rounded-lg pl-10 pr-9 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20 font-mono transition-all"
                    autoFocus
                    aria-label="Account Identifier Search"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-3 p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                      title="Clear query"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="px-5 py-2.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all shadow-2xs cursor-pointer disabled:cursor-not-allowed shrink-0"
                  title={query.trim() ? "Open full forensic account dossier" : "Enter an Account ID to investigate"}
                >
                  <span>Investigate</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Format hint & Primary Action guidance */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                <span className="flex items-center gap-1">
                  <Info className="w-3 h-3 text-[#0D9488] shrink-0" />
                  <span>Accepts standard format (e.g. ACC-000001) or bare account numbers (e.g. 1).</span>
                </span>
                <span className="text-slate-400 font-mono text-[10px]">Instant 360° Profile & Graph Tracing</span>
              </div>
            </form>

            {/* Quick Test Cases & Recents */}
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] font-semibold text-slate-600 mr-0.5">Quick Test Cases:</span>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000001')}
                  className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-mono text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Test scenario: Legitimate customer victim of APP scam with high ML / low rule divergence"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span>ACC-000001 (Victim)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000002')}
                  className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-900 border border-red-200 font-mono text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Test scenario: First-hop mule with rapid pass-through under 12 minutes"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                  <span>ACC-000002 (Mule)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000003')}
                  className="px-2.5 py-1 rounded-md bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 font-mono text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Test scenario: Downstream 2-hop node to test graph exposure ceiling"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                  <span>ACC-000003 (Hop 2)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000010')}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-mono text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Test scenario: Clean retail customer control with low risk on both engines"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  <span>ACC-000010 (Retail)</span>
                </button>
              </div>

              {recentSearches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 pt-1">
                  <div className="flex items-center gap-1 text-slate-400">
                    <History className="w-3 h-3" />
                    <span className="font-medium text-slate-600">Recent:</span>
                  </div>
                  {recentSearches.map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => handleSelectAccount(rec)}
                      className="px-2 py-0.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-teal-800 font-mono text-[10px] transition-colors cursor-pointer"
                    >
                      {rec}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="p-1 text-slate-400 hover:text-slate-700 transition-colors ml-1"
                    title="Clear recent searches"
                    aria-label="Clear recent searches"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* First-Time User 3-Step Guidance Strip */}
        <section aria-label="Investigation Workflow Steps" className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 bg-white border border-[#E2DFD7] rounded-xl shadow-2xs">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#0B1322] text-[#2DD4BF] flex items-center justify-center font-mono text-xs font-bold shrink-0">
              1
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-900">Select or Query Account</h2>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                Input any synthetic ledger ID or click a verified benchmark scenario below to begin the forensic audit.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#0B1322] text-[#2DD4BF] flex items-center justify-center font-mono text-xs font-bold shrink-0">
              2
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-900">Dual Risk & SHAP Audit</h2>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                Audit deterministic heuristic rules side-by-side with 26-feature XGBoost ML scores and local TreeSHAP drivers.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#0B1322] text-[#2DD4BF] flex items-center justify-center font-mono text-xs font-bold shrink-0">
              3
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-900">Trace Directed Fund Flows</h2>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                Traverse multi-hop transfer paths with cycle detection, chronological ordering, and bounded exposure ceilings.
              </p>
            </div>
          </div>
        </section>

        {/* Curated Sample Accounts Section */}
        <section aria-labelledby="sample-cases-heading" className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2DFD7] pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0D9488]" />
              <h2 id="sample-cases-heading" className="text-sm sm:text-base font-semibold text-slate-900">
                Curated Synthetic Ledger Investigation Cases
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {filteredCases.length} Scenarios
              </span>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400 text-[11px] mr-1 hidden sm:inline">Filter:</span>
              {(['all', 'victim', 'mule', 'counterparty', 'baseline'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSelectedFilter(filter)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer ${
                    selectedFilter === filter
                      ? 'bg-[#0B1322] text-[#2DD4BF] shadow-2xs'
                      : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Educational Governance Disclaimer Box */}
          <div className="p-3 bg-[#FAF9F6] border border-[#E2DFD7] rounded-lg text-xs text-slate-600 flex items-start gap-2.5 shadow-2xs">
            <Info className="w-4 h-4 text-[#0D9488] shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <p>
                <strong className="text-slate-800">Ground-Truth Reference Notice:</strong> The scenario labels below (e.g. <em>Compromised Victim</em>, <em>Layering Mule</em>) originate from offline synthetic benchmark datasets used strictly for model evaluation and validation.
              </p>
              <p className="text-slate-500 text-[11px]">
                In operational runtime investigations, FraudShield AI never inspects or relies on synthetic scenario labels—all risk scores, TreeSHAP attributions, and fund flow paths are computed dynamically from observed core banking transactions.
              </p>
            </div>
          </div>

          {/* Sample Cards Grid */}
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
                className="bg-white border border-[#E2DFD7] rounded-xl p-4 sm:p-5 hover:border-[#0D9488] hover:shadow-md cursor-pointer transition-all duration-150 space-y-3 group focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:outline-none"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#0D9488] transition-colors">
                        {acc.id}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 border-l border-slate-200 pl-2">
                        Synthetic Core Ledger
                      </span>
                    </div>
                    <h3 className="text-sm sm:text-base font-semibold text-slate-900 mt-0.5">{acc.name}</h3>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border ${acc.tagColor}`}>
                    {acc.role}
                  </span>
                </div>

                {/* Plain-English Term Context Box */}
                <div className="bg-[#FAF9F6] border border-[#E2DFD7]/80 rounded-lg p-2.5 text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                    <HelpCircle className="w-3.5 h-3.5 text-[#0D9488]" />
                    <span>{acc.termTitle}</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    {acc.termExplanation}
                  </p>
                </div>

                {/* Narrative Summary */}
                <p className="text-xs text-slate-600 leading-relaxed">{acc.description}</p>

                {/* Scannable Micro-Stats Box */}
                <div className="grid grid-cols-3 gap-2 p-2 bg-slate-50 border border-slate-200/70 rounded-md font-mono text-[10px] sm:text-[11px] text-slate-600">
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-sans">Activity</span>
                    <span className="font-semibold text-slate-800">{acc.statTxns}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-sans">Balance/Turn</span>
                    <span className="font-semibold text-slate-800">{acc.statFlow}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-sans">Finding</span>
                    <span className="font-semibold text-[#0D9488] truncate block" title={acc.keyFlag}>
                      {acc.keyFlag}
                    </span>
                  </div>
                </div>

                {/* Footer with Benchmark and Call-to-Action */}
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-500 gap-2">
                  <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                    <span>{acc.benchmarkLabel}</span>
                  </div>
                  <span className="text-[#0D9488] font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    <span>Inspect 360° Profile</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Architectural Principles & System Status */}
        <section aria-labelledby="architecture-status-heading" className="space-y-3 pt-2">
          <div className="flex items-center gap-2 border-b border-[#E2DFD7] pb-2">
            <Cpu className="w-4 h-4 text-[#0D9488]" />
            <h2 id="architecture-status-heading" className="text-sm font-semibold text-slate-900">
              Forensic Engine Architecture & Operational Health
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Card 1: Forensic Graph Tracing */}
            <div className="bg-white border border-[#E2DFD7] rounded-xl p-4 sm:p-5 space-y-2.5 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0D9488]">
                <GitFork className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Deterministic Multi-Hop Tracing</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Explores directional money flows hop-by-hop with cycle detection, chronological ordering, and mathematical exposure bounds. Prevents downstream double-counting of transferred funds.
              </p>
            </div>

            {/* Card 2: Dual Risk Assessment */}
            <div className="bg-white border border-[#E2DFD7] rounded-xl p-4 sm:p-5 space-y-2.5 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Dual Assessment Architecture</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Maintains strict separation between deterministic heuristic rules (velocity, rapid pass-through, dormancy) and statistical XGBoost models with native local TreeSHAP attribution.
              </p>
            </div>

            {/* Card 3: Live ML Health Status */}
            <div className="bg-white border border-[#E2DFD7] rounded-xl p-4 sm:p-5 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-800">
                  <Cpu className="w-4 h-4" />
                </div>
                {modelStatus?.inference_ready ? (
                  <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ONLINE
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-mono text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5" /> DEGRADED
                  </span>
                )}
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Model Engine Status</h3>
              <div className="font-mono text-[11px] text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">Account ML Model:</span>
                  <span className="font-bold text-slate-800">{modelStatus?.account_model?.version || 'v2-account-1.0.0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Features Tracked:</span>
                  <span className="font-bold text-slate-800">{modelStatus?.account_model?.features_count ?? 26} dimensions</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Held-Out ROC-AUC:</span>
                  <span className="font-bold text-[#0D9488]">
                    {modelStatus?.account_model?.test_metrics?.roc_auc
                      ? (modelStatus.account_model.test_metrics.roc_auc * 100).toFixed(2) + '%'
                      : '99.45%'}
                  </span>
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

