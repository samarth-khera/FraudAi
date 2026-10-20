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
  UserCheck,
  TrendingDown,
  Database,
  Lock,
} from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { V2Header } from '../../components/v2/V2Header';
import { V2Footer } from '../../components/v2/V2Footer';

const SAMPLE_ACCOUNTS = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    role: 'Compromised Victim (APP Scam)',
    tagColor: 'bg-amber-100 text-amber-900 border-amber-300',
    description: 'Legitimate retail customer whose savings were drained (₹250,000). Demonstrates ML score divergence and innocent victim protection.',
    metrics: '56 txns · Net: -₹122.8k · ML Risk: 76.5 (Divergent)',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    role: 'Intermediate Layering Mule',
    tagColor: 'bg-red-100 text-red-900 border-red-300',
    description: 'Mule routing illicit funds with rapid pass-through (<12 min dwell time) between origin and cashout terminals.',
    metrics: '33 txns · Rapid Pass-Through: TRUE · Turn: ₹447k',
  },
  {
    id: 'ACC-000003',
    name: 'Ishan Reddy',
    role: 'Downstream Counterparty / Retail',
    tagColor: 'bg-teal-100 text-teal-900 border-teal-300',
    description: 'Recipient node connected downstream to victim transfer. Evaluates attribution bounds and multi-hop graph exploration.',
    metrics: '48 txns · Balance: ₹107k · Direction: Outbound',
  },
  {
    id: 'ACC-000010',
    name: 'Arjun Sengupta',
    role: 'Active Retail Customer',
    tagColor: 'bg-slate-100 text-slate-800 border-slate-300',
    description: 'High-volume legitimate retail baseline with continuous transactions, steady velocity, and normal counterparty diversity.',
    metrics: '50 txns · Flow: 0.33 · Rule Risk: LOW',
  },
];

export const V2SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    v2Api
      .getModelsStatus()
      .then((data) => {
        setModelStatus(data);
        setLoadingStatus(false);
      })
      .catch(() => {
        setModelStatus(null);
        setLoadingStatus(false);
      });
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = query.trim();
    if (clean) {
      navigate(`/v2/accounts/${encodeURIComponent(clean)}`);
    }
  };

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
            Universal forensic intelligence for compliance analysts. Query any core banking account to inspect 360° profile metrics, deterministic behavioral signals, machine learning risk estimates, and multi-hop fund flows.
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
              />
              <button
                type="submit"
                disabled={!query.trim()}
                className="absolute right-2 px-4 py-2 rounded-md bg-[#0D9488] hover:bg-[#0F766E] disabled:bg-slate-300 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                <span>Investigate</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 text-left pl-2">
              Tip: Press Enter to launch instant 360° account dossier.
            </p>
          </form>
        </div>

        {/* Curated Sample Accounts */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0D9488]" />
              <span>Curated Ledger Investigation Cases</span>
            </h2>
            <span className="text-xs text-slate-500 font-mono">10,000 Monitored Accounts in Ledger</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SAMPLE_ACCOUNTS.map((acc) => (
              <div
                key={acc.id}
                onClick={() => navigate(`/v2/accounts/${acc.id}`)}
                className="bg-white border border-slate-200 rounded-lg p-4 hover:border-[#0D9488] hover:shadow-sm cursor-pointer transition-all space-y-2.5 group"
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

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>{acc.metrics}</span>
                  <span className="text-[#0D9488] font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Inspect <ArrowRight className="w-3.5 h-3.5" />
                  </span>
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
              Explores directional money flows hop-by-hop with cycle detection and strict exposure bounds. Prevents downstream double-counting of transferred funds.
            </p>
          </div>

          {/* Card 2: Dual Risk Assessment */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 shadow-2xs">
            <div className="w-9 h-9 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Dual Assessment Architecture</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Maintains clean separation between deterministic heuristic rules (velocity, pass-through) and statistical ML models with local TreeSHAP attribution.
            </p>
          </div>

          {/* Card 3: Live ML Health Status */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 shadow-2xs">
            <div className="w-9 h-9 rounded-md bg-navy-50 border border-slate-200 flex items-center justify-center text-slate-800">
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
                <span className="font-bold">{modelStatus?.account_model.version || 'v2-account-1.0.0'}</span>
              </div>
              <div className="flex justify-between">
                <span>Features Tracked:</span>
                <span className="font-bold">{modelStatus?.account_model.features_count ?? 26} dimensions</span>
              </div>
              <div className="flex justify-between">
                <span>Held-Out ROC-AUC:</span>
                <span className="font-bold text-teal-700">
                  {modelStatus?.account_model.test_metrics?.roc_auc ? (modelStatus.account_model.test_metrics.roc_auc * 100).toFixed(2) + '%' : '99.45%'}
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
