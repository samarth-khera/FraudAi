import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  Shield,
  LayoutDashboard,
  SearchCheck,
  Network,
  FolderGit2,
  Cpu,
  ArrowLeft,
  Scale,
  ArrowUpRight,
} from 'lucide-react';

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, onCloseMobile }) => {
  const navItems = [
    { code: '01', name: 'Investigation Brief', to: '/app/dashboard', icon: LayoutDashboard, sub: 'Exposure & Triage' },
    { code: '02', name: 'Fund Flow Graph', to: '/app/fund-flow', icon: Network, sub: 'Multi-Hop Lineage' },
    { code: '03', name: 'Transaction Check', to: '/app/transaction-check', icon: SearchCheck, sub: 'XGBoost + TreeSHAP' },
    { code: '04', name: 'Case Dossiers', to: '/app/cases', icon: FolderGit2, sub: 'Adjudication & Audit' },
    { code: '05', name: 'Model Validation', to: '/app/model-insights', icon: Cpu, sub: 'PaySim Benchmarks' },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-[#070C16]/75 z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 navy-sidebar text-slate-300 flex flex-col justify-between transition-transform duration-200 ease-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="px-5 h-16 border-b border-[#1C2B45] flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded-md bg-[#0D9488] flex items-center justify-center text-white border border-[#2DD4BF]/40">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-sm text-white tracking-tight flex items-center gap-1.5">
                  <span>FraudShield</span>
                  <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#111C30] text-[#2DD4BF] border border-[#1C2B45]">
                    AI
                  </span>
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                  Forensic Workbench
                </span>
              </div>
            </Link>
          </div>

          {/* Active Investigation Context Module */}
          <div className="p-3.5 mx-3 mt-4 rounded-md bg-[#0B1322] border border-[#1C2B45]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#2DD4BF] font-semibold">
                Active Dossier
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                FS-1042
              </span>
            </div>
            <div className="text-xs font-semibold text-white">
              Origin Loss: <span className="font-mono text-[#2DD4BF]">₹50,000</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              V001 → A100 · 3 Hops · 7 Accounts
            </div>
            <div className="mt-2.5 pt-2 border-t border-[#1C2B45] flex items-center justify-between text-[11px]">
              <Link
                to="/app/fund-flow"
                onClick={onCloseMobile}
                className="text-[#2DD4BF] hover:underline font-medium inline-flex items-center gap-1"
              >
                <span>Trace Graph</span>
                <ArrowUpRight className="w-3 h-3" />
              </Link>
              <Link
                to="/app/cases/FS-1042"
                onClick={onCloseMobile}
                className="text-slate-300 hover:text-white font-medium"
              >
                Open Case →
              </Link>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="px-3 py-4 space-y-1">
            <div className="px-2.5 pb-1.5 text-[10px] font-mono font-semibold tracking-widest text-slate-500 uppercase">
              Investigation Modules
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    `flex items-center justify-between px-3 py-2.5 rounded-md text-xs transition-colors border-l-2 ${
                      isActive
                        ? 'border-[#14B8A6] bg-[#111C30] text-white font-semibold'
                        : 'border-transparent text-slate-400 hover:text-slate-100 hover:bg-[#0B1322]'
                    }`
                  }
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 flex-shrink-0 text-[#2DD4BF]" />
                    <div className="truncate">
                      <div className="leading-tight">{item.name}</div>
                      <div className="text-[10px] text-slate-500 font-normal leading-tight mt-0.5">
                        {item.sub}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 ml-2">{item.code}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom Safeguard Status & Return Link */}
        <div className="p-3.5 border-t border-[#1C2B45] space-y-2.5 bg-[#050911]">
          <div className="p-2.5 rounded-md bg-[#0B1322] border border-[#1C2B45] flex items-start gap-2.5">
            <Scale className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-slate-200">Zero Auto-Freeze</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                Human review required. Connection ≠ guilt.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between px-1 pt-0.5">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Product Overview</span>
            </Link>
            <span className="font-mono text-[10px] text-slate-500">v0.7</span>
          </div>
        </div>
      </aside>
    </>
  );
};
