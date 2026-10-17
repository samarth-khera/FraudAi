import React from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  ArrowRight,
  Network,
  Cpu,
  Lock,
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  GitFork,
  BarChart3,
  Users,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f8fafd] flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
              <Shield className="w-5 h-5 fill-white/20" />
            </div>
            <div>
              <span className="font-bold text-xl text-slate-900 tracking-tight flex items-center gap-1.5">
                FraudShield <span className="text-indigo-600 font-extrabold text-xs px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200">AI</span>
              </span>
              <span className="text-[11px] text-slate-500 block">Investigation & Protection Platform</span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-indigo-600 transition-colors">Core Capabilities</a>
            <a href="#workflow" className="hover:text-indigo-600 transition-colors">Investigation Flow</a>
            <a href="#safeguards" className="hover:text-indigo-600 transition-colors">Fairness Safeguards</a>
            <a href="#demo" className="hover:text-indigo-600 transition-colors">Demo Scenario</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/app/dashboard"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-semibold shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30 transition-all flex items-center gap-2"
            >
              <span>Launch Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-28 overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-indigo-400/20 via-purple-400/20 to-blue-400/20 blur-3xl -z-10 rounded-full" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50/90 border border-indigo-200/80 text-xs font-semibold text-indigo-700 mb-6 shadow-2xs">
            <Shield className="w-3.5 h-3.5" />
            <span>AI-Assisted Fraud Investigation · Innocent-Recipient Protection</span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-slate-900 tracking-tight max-w-4xl mx-auto leading-tight sm:leading-[1.12]">
            Trace the Flow.{' '}
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 bg-clip-text text-transparent">
              Protect the Innocent.
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            When financial fraud strikes, funds rapidly fragment across secondary accounts. FraudShield AI traces downstream transaction networks while preventing unfair, automated asset freezes on innocent recipients.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/app/dashboard"
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold shadow-lg shadow-indigo-500/25 hover:scale-[1.02] transition-all flex items-center gap-2.5"
            >
              <span>Open Investigation Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/app/fund-flow"
              className="px-8 py-3.5 rounded-xl glass-card hover:bg-white text-slate-800 font-semibold border border-slate-200/90 hover:border-indigo-300 transition-all flex items-center gap-2"
            >
              <Network className="w-4 h-4 text-indigo-600" />
              <span>Explore Demo Case FS-1042</span>
            </Link>
          </div>

          {/* Research Prototype Callout */}
          <div className="mt-8 max-w-xl mx-auto px-4 py-2.5 rounded-xl bg-amber-50/90 border border-amber-200/80 text-xs text-amber-900 flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              <strong>Research Prototype:</strong> Trained on synthetic PaySim financial logs with synthetic demonstration scenarios. Decision-support only.
            </span>
          </div>

          {/* Interactive Flow Hero Card */}
          <div className="mt-14 max-w-5xl mx-auto glass-card rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-200/90 text-left">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-rose-500" />
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="font-mono text-xs text-slate-500 ml-2">Case FS-1042 · Live Fund-Tracing Simulation</span>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                NetworkX DAG Engine
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 my-6">
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/60">
                <div className="text-xs text-slate-500">Reported Stolen</div>
                <div className="text-xl font-bold text-slate-900 mt-0.5">₹50,000</div>
                <div className="text-[11px] text-rose-600 mt-1 font-medium">Origin: Victim V001</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/60">
                <div className="text-xs text-slate-500">Located in Downstream</div>
                <div className="text-xl font-bold text-emerald-600 mt-0.5">₹50,000</div>
                <div className="text-[11px] text-slate-500 mt-1 font-medium">100% Accounted</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/60">
                <div className="text-xs text-slate-500">Network Depth</div>
                <div className="text-xl font-bold text-indigo-600 mt-0.5">3 Hops</div>
                <div className="text-[11px] text-slate-500 mt-1 font-medium">7 Linked Accounts</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/60">
                <div className="text-xs text-slate-500">Automated Actions</div>
                <div className="text-xl font-bold text-slate-700 mt-0.5">0 Freezes</div>
                <div className="text-[11px] text-emerald-600 mt-1 font-medium">Strict Decision-Support</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-indigo-950 text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed border border-slate-800">
              <div className="text-indigo-400 font-semibold mb-1">// Downstream Lineage Flow (FS-1042)</div>
              <div>[V001 (Victim)] ──₹50,000 UPI──► [A100 (Initial Receiver)] ──₹50,000 IMPS──► [B200 (Intermediate)]</div>
              <div className="pl-6">├──₹30,000 UPI──► [C300 (Merchant/Review)] ──₹10,000──► [E500 (Terminal)]</div>
              <div className="pl-6">│                                          └──₹5,000──► [F600 (Terminal)]</div>
              <div className="pl-6">└──₹20,000 NEFT─► [D400 (Vendor/Review)]   ──₹10,000──► [G700 (Terminal)]</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities */}
      <section id="features" className="py-20 bg-white border-y border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-2">Core Architecture</h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Evidence-based fraud forensics without innocent casualties
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-card rounded-2xl p-6 border border-slate-200/80 hover:border-indigo-300 transition-all">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-5">
                <Network className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Deterministic Fund Tracing</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                NetworkX-powered directed graph traversal that maps money velocity, intermediate hops, cycle returns, and unforwarded balances without double-counting.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-slate-200/80 hover:border-indigo-300 transition-all">
              <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-5">
                <Cpu className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Leakage-Safe ML Scoring</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                XGBoost classifier trained on 6.36M PaySim records using strict pre-transaction features only. Achieves 98.6% precision and 0.9828 PR-AUC on test data.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-slate-200/80 hover:border-indigo-300 transition-all">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-5">
                <FileCheck2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Immutable Audit Provenance</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Append-only audit trail logging every case status change, transaction batch ingestion, reviewer finding, and trace calculation for regulatory compliance.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Fairness & Ethical AI Section */}
      <section id="safeguards" className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Our Core Philosophy</span>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight mt-2 text-white">
              Why We Never Auto-Freeze Accounts
            </h2>
            <p className="mt-4 text-slate-300 text-base sm:text-lg leading-relaxed">
              In real-world fraud schemes, scammers frequently use stolen funds to purchase goods or pay legitimate merchants, maids, or gig workers. Freezing an account merely because it received funds punishes innocent bystanders.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
            <div className="p-6 rounded-2xl bg-slate-800/80 border border-slate-700">
              <div className="flex items-center gap-3 text-emerald-400 font-bold mb-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>Separation of Dimensions</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Fraud indicators, fund exposure, evidence quality, and reviewer decisions are kept as distinct, orthogonal entities. No account is ever branded "guilty" by code.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-800/80 border border-slate-700">
              <div className="flex items-center gap-3 text-indigo-400 font-bold mb-2">
                <Lock className="w-5 h-5" />
                <span>Human-Led Adjudication</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                ML scores and graph flows provide decision support to accredited compliance officers. Full reviewer accountability is retained in the append-only audit trail.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto bg-slate-950 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-indigo-500" />
            <span className="text-sm font-bold text-white">FraudShield AI</span>
            <span className="text-xs text-slate-500">· Research Prototype</span>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <Link to="/app/dashboard" className="hover:text-white transition-colors">Workspace</Link>
            <Link to="/app/fund-flow" className="hover:text-white transition-colors">Fund Explorer</Link>
            <Link to="/app/transaction-check" className="hover:text-white transition-colors">Risk Scorer</Link>
            <Link to="/app/model-insights" className="hover:text-white transition-colors">Model Metrics</Link>
          </div>

          <div className="text-xs text-slate-500">
            © 2026 FraudShield AI. Designed for fair financial forensics.
          </div>
        </div>
      </footer>
    </div>
  );
};
