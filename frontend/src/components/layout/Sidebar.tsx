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
  Building2,
  CheckCircle2,
} from 'lucide-react';

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, onCloseMobile }) => {
  const navItems = [
    { name: 'Dashboard', to: '/app/dashboard', icon: LayoutDashboard },
    { name: 'Transaction Check', to: '/app/transaction-check', icon: SearchCheck },
    { name: 'Fund Flow Explorer', to: '/app/fund-flow', icon: Network },
    { name: 'Case Management', to: '/app/cases', icon: FolderGit2 },
    { name: 'Model Insights', to: '/app/model-insights', icon: Cpu },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 navy-sidebar text-slate-300 flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
                <Shield className="w-5 h-5 fill-white/20" />
              </div>
              <div>
                <span className="font-bold text-lg text-white tracking-tight flex items-center gap-1.5">
                  FraudShield <span className="text-indigo-400 font-extrabold text-xs px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60">AI</span>
                </span>
                <span className="text-[10px] text-slate-400 block tracking-tight">
                  Trace Flow · Protect Innocent
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Investigation Workspace
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom Status & Links */}
        <div className="p-4 border-t border-slate-800/80 space-y-3">
          {/* Bank mode badge */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="text-xs font-semibold text-slate-200">Investigator Mode</div>
                <div className="text-[10px] text-slate-400">Decision-Support Active</div>
              </div>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          {/* Back to marketing */}
          <Link
            to="/"
            className="flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Landing Page</span>
          </Link>

          <div className="text-center text-[10px] text-slate-400 pt-1">
            Research Prototype v0.5.0
          </div>
        </div>
      </aside>
    </>
  );
};
