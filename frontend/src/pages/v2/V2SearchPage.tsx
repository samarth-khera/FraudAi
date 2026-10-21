import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
  ExternalLink,
  Sparkles,
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
  benchmarkLabel: string;
  tagColor: string;
  description: string;
  metrics: string;
}

const SAMPLE_ACCOUNTS: SampleCase[] = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    category: 'victim',
    role: 'Compromised Victim (APP Scam)',
    benchmarkLabel: 'Offline Benchmark: SCENARIO-APP-001 (Compromised Victim)',
    tagColor: 'bg-amber-100 text-amber-900 border-amber-300',
    description: 'Legitimate retail customer whose savings were drained (₹250,000) during an authorized push payment scam. Demonstrates ML score divergence (76.5) vs rule baseline (25.0) and innocent victim protection.',
    metrics: '56 txns · Net: -₹122.8k · ML Risk: 76.5 · Rule Risk: 25.0 (Low)',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    category: 'mule',
    role: 'Intermediate Layering Mule',
    benchmarkLabel: 'Offline Benchmark: SCENARIO-APP-001 (Layering Hop 1)',
    tagColor: 'bg-red-100 text-red-900 border-red-300',
    description: 'First-hop mule routing illicit funds with rapid pass-through (<12 min dwell time) between victim origin and cashout terminals.',
    metrics: '33 txns · Rapid Pass-Through: TRUE · Turn: ₹447k · Rule Risk: 60.0',
  },
  {
    id: 'ACC-000003',
    name: 'Ishan Reddy',
    category: 'counterparty',
    role: 'Downstream Counterparty / Retail',
    benchmarkLabel: 'Offline Benchmark: SCENARIO-APP-001 (Downstream Hop 2)',
    tagColor: 'bg-teal-100 text-teal-900 border-teal-300',
    description: 'Recipient node connected downstream to victim transfer. Evaluates multi-hop graph attribution bounds, hop distances, and exposure upper ceiling.',
    metrics: '48 txns · Balance: ₹107k · Direction: Outbound · 2 Hops from Root',
  },
  {
    id: 'ACC-000010',
    name: 'Arjun Sengupta',
    category: 'baseline',
    role: 'Active Retail Baseline Customer',
    benchmarkLabel: 'Offline Benchmark: Normal Control (Non-Scenario)',
    tagColor: 'bg-slate-100 text-slate-800 border-slate-300',
    description: 'High-volume legitimate retail customer baseline with continuous transaction history, steady velocity, and normal counterparty diversity.',
    metrics: '50 txns · Flow: 0.33 · Rule Risk: LOW (0.0) · ML Risk: LOW (0.0)',
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        {/* Hero Section */}
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B1322] text-[#2DD4BF] text-xs font-mono font-medium shadow-2xs">
            <Shield className="w-3.5 h-3.5" />
            <span>FraudShield AI V2 · Account-Centric Investigation Workspace</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 font-display">
            Investigate Account Risk & Multi-Hop Fund Flows
          </h1>

          <p className="text-slate-600 text-sm leading-relaxed max-w-2xl mx-auto">
            Universal forensic intelligence for compliance analysts and financial crime investigators. Query any core banking account to inspect 360° profile metrics, deterministic behavioral signals, calibrated machine learning risk estimates, and multi-hop fund flows.
          </p>

          {/* Search Box */}
          <form onSubmit={handleSearch} className="max-w-xl mx-auto mt-6">
            <div className="relative flex items-center shadow-sm">
              <Search className="w-5 h-5 absolute left-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter Synthetic Account ID (e.g. ACC-000001)..."
                className="w-full bg-white border-2 border-slate-300 rounded-lg pl-12 pr-28 py-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20 font-mono transition-all"
                autoFocus
                aria-label="Account Identifier Search"
              />
              <button
                type="submit"
                disabled={!query.trim()}
                className="absolute right-2 px-4 py-2 rounded-md bg-[#0D9488] hover:bg-[#0F766E] disabled:bg-slate-300 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer disabled:cursor-not-allowed"
              >
                <span>Investigate</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Helper Chips */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5 text-slate-500">
                <span className="text-[11px] font-medium text-slate-400">Quick Test Cases:</span>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000001')}
                  className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-mono text-[11px] transition-colors"
                >
                  ACC-000001 (Victim)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000002')}
                  className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-900 border border-red-200 font-mono text-[11px] transition-colors"
                >
                  ACC-000002 (Mule)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000003')}
                  className="px-2 py-0.5 rounded bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 font-mono text-[11px] transition-colors"
                >
                  ACC-000003 (Hop 2)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAccount('ACC-000010')}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-mono text-[11px] transition-colors"
                >
                  ACC-000010 (Retail)
                </button>
              </div>

              {recentSearches.length > 0 && (
                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  <History className="w-3 h-3 text-slate-400" />
                  <span>Recent:</span>
                  {recentSearches.map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => handleSelectAccount(rec)}
                      className="text-teal-700 hover:underline font-mono"
                    >
                      {rec}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-slate-400 hover:text-slate-600 ml-1"
                    title="Clear recent searches"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Curated Sample Accounts Section */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0D9488]" />
              <h2 className="text-base font-semibold text-slate-900">
                Curated Synthetic Ledger Investigation Cases
              </h2>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400 text-[11px] mr-1 hidden sm:inline">Filter:</span>
              {(['all', 'victim', 'mule', 'counterparty', 'baseline'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSelectedFilter(filter)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                    selectedFilter === filter
                      ? 'bg-[#0B1322] text-[#2DD4BF]'
                      : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Educational Governance Disclaimer Box */}
          <div className="p-3 bg-white/70 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2.5 shadow-2xs">
            <Info className="w-4 h-4 text-[#0D9488] shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-relaxed">
              <p>
                <strong className="text-slate-800">Ground-Truth Reference Notice:</strong> The scenario labels below (e.g. <em>Compromised Victim</em>, <em>Layering Mule</em>) originate from offline synthetic benchmark datasets used strictly for model evaluation and validation.
              </p>
              <p className="text-slate-500 text-[11px]">
                In operational runtime investigations, FraudShield AI never inspects or relies on synthetic scenario labels—all risk scores, TreeSHAP attributions, and fund flow paths are computed dynamically from observed core banking transactions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredCases.map((acc) => (
              <div
                key={acc.id}
                onClick={() => handleSelectAccount(acc.id)}
                className="bg-white border border-slate-200 rounded-lg p-5 hover:border-[#0D9488] hover:shadow-sm cursor-pointer transition-all space-y-3 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-bold text-slate-800 group-hover:text-[#0D9488] transition-colors">
                      {acc.id}
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900">{acc.name}</h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${acc.tagColor}`}>
                    {acc.role}
                  </span>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">{acc.description}</p>

                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-500 gap-2">
                  <span>{acc.metrics}</span>
                  <span className="text-[#0D9488] font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Inspect 360° Profile <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>

                <div className="pt-1 text-[10px] font-mono text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                  <span>{acc.benchmarkLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Architectural Principles & System Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
          {/* Card 1: Forensic Graph Tracing */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 shadow-2xs">
            <div className="w-9 h-9 rounded-md bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
              <GitFork className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Deterministic Multi-Hop Tracing</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Explores directional money flows hop-by-hop with cycle detection, chronological ordering, and mathematical exposure bounds. Prevents downstream double-counting of transferred funds.
            </p>
          </div>

          {/* Card 2: Dual Risk Assessment */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 shadow-2xs">
            <div className="w-9 h-9 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Dual Assessment Architecture</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Maintains strict separation between deterministic heuristic rules (velocity, rapid pass-through, dormancy) and statistical XGBoost models with native local TreeSHAP attribution.
            </p>
          </div>

          {/* Card 3: Live ML Health Status */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 shadow-2xs">
            <div className="w-9 h-9 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-800">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Model Engine Status</h3>
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
            <div className="font-mono text-[11px] text-slate-600 space-y-1">
              <div className="flex justify-between">
                <span>Account ML Model:</span>
                <span className="font-bold">{modelStatus?.account_model?.version || 'v2-account-1.0.0'}</span>
              </div>
              <div className="flex justify-between">
                <span>Features Tracked:</span>
                <span className="font-bold">{modelStatus?.account_model?.features_count ?? 26} dimensions</span>
              </div>
              <div className="flex justify-between">
                <span>Held-Out ROC-AUC:</span>
                <span className="font-bold text-teal-700">
                  {modelStatus?.account_model?.test_metrics?.roc_auc
                    ? (modelStatus.account_model.test_metrics.roc_auc * 100).toFixed(2) + '%'
                    : '99.45%'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <V2Footer />
    </div>
  );
};
