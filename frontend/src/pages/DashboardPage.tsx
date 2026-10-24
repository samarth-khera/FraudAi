import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Shield,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Search,
  FolderGit2,
  Network,
  Users,
  LineChart,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Scale,
  ExternalLink,
  ChevronRight,
  Cpu,
  Layers,
} from 'lucide-react';
import { api } from '../services/api';
import { FraudCase, TraceResult } from '../types/api';
import { Button } from '../components/common/Button';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();

  const [cases, setCases] = useState<FraudCase[]>([]);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const caseList = await api.getCases(0, 20);
      setCases(caseList.cases || []);

      if (caseList.cases && caseList.cases.length > 0) {
        const primary = caseList.cases[0];
        try {
          const trace = await api.getCaseTrace(primary.case_id);
          setTraceData(trace);
        } catch {
          // Non-blocking trace fallback
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load live workspace data from backend API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const openCases = cases.filter(
    (c) => c.investigation_status === 'under_investigation' || c.investigation_status === 'open'
  );

  const accountsAwaitingReview = (traceData?.linked_accounts || []).filter(
    (a) => a.review?.review_state !== 'review_completed'
  );

  return (
    <div className="space-y-8 font-sans text-[#1A1714]">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-[#EAE3D6]">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#EA8500]">
              Triage Workspace & Overview
            </span>
            <span className="text-[#8C857B] text-xs font-mono">·</span>
            <span className="px-2 py-0.5 rounded-full bg-white border border-[#EAE3D6] text-[10px] font-mono text-[#6B655B]">
              Real Backend Data
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight mt-1 font-display">
            Investigation Overview
          </h1>
          <p className="text-xs sm:text-sm text-[#6B655B] mt-1 max-w-2xl leading-relaxed">
            Follow money movement, review prioritized cases, inspect AI explainability, and record verified investigation decisions.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            onClick={fetchDashboardData}
            loading={loading}
            icon={<RefreshCw className="w-3.5 h-3.5 text-[#EA8500]" />}
          >
            <span>Refresh</span>
          </Button>
          <Link to="/guided-investigation" className="btn-primary flex items-center gap-1.5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span>Start Guided Tour</span>
          </Link>
        </div>
      </div>

      {/* Error state if API fails */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchDashboardData}>
            Retry
          </Button>
        </div>
      )}

      {/* SECTION 1: WHAT CAN I DO HERE? (Obvious Action Entry Points) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#EA8500]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#1A1714] font-mono">
              1. What can I do here?
            </h2>
          </div>
          <span className="text-xs text-[#8C857B] font-mono">Select a workflow</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Guided Investigation */}
          <Link
            to="/guided-investigation"
            className="p-5 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500] hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] group-hover:scale-105 transition-transform">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                Start Guided Investigation
              </h3>
              <p className="text-xs text-[#6B655B] leading-relaxed">
                Take an interactive 3-minute step-by-step tour through sample case FS-1042: intake, fund flow, AI scoring, and review.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#EAE3D6] flex items-center justify-between text-xs font-bold text-[#EA8500]">
              <span>Launch 6-Step Tour</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 2: Account Intelligence */}
          <Link
            to="/workspace"
            className="p-5 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500] hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#6B655B] group-hover:bg-[#FFF4E6] group-hover:text-[#EA8500] transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                Investigate an Account
              </h3>
              <p className="text-xs text-[#6B655B] leading-relaxed">
                Search across 10,000 synthetic core accounts, inspect 360° transaction histories, and trigger on-demand ML inference.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#EAE3D6] flex items-center justify-between text-xs font-bold text-[#6B655B] group-hover:text-[#EA8500]">
              <span>Search Accounts</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 3: Cases & Dossiers */}
          <Link
            to="/cases"
            className="p-5 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500] hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#6B655B] group-hover:bg-[#FFF4E6] group-hover:text-[#EA8500] transition-colors">
                <FolderGit2 className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                Incident Dossiers
              </h3>
              <p className="text-xs text-[#6B655B] leading-relaxed">
                Review active fraud incidents, inspect reported loss claims vs. ledger facts, and record evidence-backed adjudications.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#EAE3D6] flex items-center justify-between text-xs font-bold text-[#6B655B] group-hover:text-[#EA8500]">
              <span>View All Cases</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 4: Model Insights & Explainability */}
          <Link
            to="/insights"
            className="p-5 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500] hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#6B655B] group-hover:bg-[#FFF4E6] group-hover:text-[#EA8500] transition-colors">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                Model Explainability
              </h3>
              <p className="text-xs text-[#6B655B] leading-relaxed">
                Understand XGBoost feature contributions via TreeSHAP, evaluate PaySim benchmarks, and verify model limitations.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#EAE3D6] flex items-center justify-between text-xs font-bold text-[#6B655B] group-hover:text-[#EA8500]">
              <span>Inspect AI Models</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        </div>
      </section>

      {/* SECTION 2: WHAT NEEDS MY ATTENTION? (Real Open Cases & Pending Reviews) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#1A1714] font-mono">
              2. What needs my attention?
            </h2>
          </div>
          <span className="text-xs text-[#8C857B] font-mono">
            {openCases.length} Active Incident{openCases.length !== 1 ? 's' : ''} in Queue
          </span>
        </div>

        {/* Real Cases Attention Table */}
        <div className="bg-white border border-[#EAE3D6] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 bg-[#FAF7F2] border-b border-[#EAE3D6] flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-bold text-[#1A1714] flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-[#EA8500]" />
              Active Incident Queue (Backend Sourced)
            </span>
            <span className="text-[#6B655B] font-mono text-[11px]">
              {accountsAwaitingReview.length} connected accounts awaiting human review in sample case
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#EAE3D6] text-[11px] font-mono uppercase text-[#6B655B] bg-white">
                  <th className="p-3.5">Case ID</th>
                  <th className="p-3.5">Reported Loss</th>
                  <th className="p-3.5">Origin Leg</th>
                  <th className="p-3.5">Investigation Status</th>
                  <th className="p-3.5">Reported Description</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE3D6]">
                {cases.slice(0, 5).map((c) => (
                  <tr key={c.case_id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                    <td className="p-3.5 font-mono font-bold text-[#1A1714]">
                      <Link to={`/cases/${c.case_id}`} className="hover:text-[#EA8500] hover:underline">
                        {c.case_id}
                      </Link>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-[#1A1714]">
                      ₹{c.reported_amount.toLocaleString()} <span className="text-[10px] text-[#6B655B] font-normal">{c.currency}</span>
                    </td>
                    <td className="p-3.5 font-mono text-[#6B655B]">
                      {c.reported_origin_transaction_id}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono font-bold uppercase">
                        {c.investigation_status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3.5 text-[#6B655B] max-w-xs truncate" title={c.description}>
                      {c.description}
                    </td>
                    <td className="p-3.5 text-right">
                      <Link
                        to={`/cases/${c.case_id}`}
                        className="btn-secondary py-1 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <span>Open Dossier</span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#8C857B]" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-[#FAF7F2] border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#6B655B]">
            <span>Showing active registered cases from database.</span>
            <Link to="/cases" className="font-bold text-[#EA8500] hover:underline flex items-center gap-1">
              <span>View all cases</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION 3: WHAT CAN I UNDERSTAND FROM THE RESULTS? (Investigative Layers) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#166534]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#1A1714] font-mono">
              3. What can I understand from the results?
            </h2>
          </div>
          <span className="text-xs text-[#8C857B] font-mono">Forensic Intelligence Layers</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Layer 1: Fund Dispersion */}
          <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-[#EA8500]">01 · MONEY FLOW</span>
              <Network className="w-4 h-4 text-[#EA8500]" />
            </div>
            <h3 className="text-base font-bold text-[#1A1714]">
              Multi-Hop Flow Attribution
            </h3>
            <p className="text-xs text-[#6B655B] leading-relaxed">
              Trace how funds split and layer across payment rails (UPI, IMPS, NEFT). Exposure is bounded to the reported loss to avoid misleading double-counting.
            </p>
            <div className="pt-2">
              <Link to="/fund-flow" className="text-xs font-bold text-[#EA8500] hover:underline flex items-center gap-1">
                <span>Explore Fund Flow Graph</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Layer 2: Model Explainability */}
          <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-[#EA8500]">02 · AI SIGNALS</span>
              <Cpu className="w-4 h-4 text-[#EA8500]" />
            </div>
            <h3 className="text-base font-bold text-[#1A1714]">
              Model-Rule Divergence
            </h3>
            <p className="text-xs text-[#6B655B] leading-relaxed">
              Detect when statistical ML risk diverges from rule baselines. TreeSHAP reveals if a high score is driven by a victim balance drain rather than mule conduit behavior.
            </p>
            <div className="pt-2">
              <Link to="/insights" className="text-xs font-bold text-[#EA8500] hover:underline flex items-center gap-1">
                <span>View Model Insights</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Layer 3: Audit Provenance */}
          <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-[#EA8500]">03 · GOVERNANCE</span>
              <FileCheck2 className="w-4 h-4 text-[#EA8500]" />
            </div>
            <h3 className="text-base font-bold text-[#1A1714]">
              Recorded Audit Provenance
            </h3>
            <p className="text-xs text-[#6B655B] leading-relaxed">
              Every investigator review, triage update, and trace path is recorded in an append-only relational log with server UTC timestamps for regulatory compliance.
            </p>
            <div className="pt-2">
              <Link to="/audit" className="text-xs font-bold text-[#EA8500] hover:underline flex items-center gap-1">
                <span>Open Audit Workspace</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default DashboardPage;
