import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Search, Menu, AlertCircle, ArrowUpRight } from 'lucide-react';
import { api } from '../../services/api';

interface HeaderProps {
  onOpenMobileMenu?: () => void;
  title?: string;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let mounted = true;
    api
      .getHealth()
      .then(() => {
        if (mounted) setBackendStatus('online');
      })
      .catch(() => {
        if (mounted) setBackendStatus('offline');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim().toUpperCase();
    if (!query) return;

    if (query.startsWith('FS-')) {
      navigate(`/app/cases/${encodeURIComponent(query)}`);
    } else if (/^T\d+/i.test(query)) {
      navigate(`/app/transaction-check?caseId=FS-1042&txId=${encodeURIComponent(query)}`);
    } else {
      navigate(`/app/cases?search=${encodeURIComponent(query)}`);
    }
  };

  const getSectionLabel = () => {
    const p = location.pathname;
    if (p.includes('/fund-flow')) return '02 / MULTI-HOP FUND TRACE';
    if (p.includes('/transaction-check')) return '03 / PRE-TRANSACTION RISK & TREESHAP';
    if (p.includes('/cases/')) return '04 / CASE INVESTIGATION DOSSIER';
    if (p.includes('/cases')) return '04 / CASE REGISTRY';
    if (p.includes('/model-insights')) return '05 / MODEL VALIDATION METRICS';
    return '01 / INVESTIGATION BRIEF';
  };

  return (
    <header className="sticky top-0 z-30 h-14 bg-white border-b border-[#E2DFD7] px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-1.5 text-[#0B1322] hover:bg-[#F5F4F0] rounded border border-[#E2DFD7] transition-colors"
          aria-label="Open sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="hidden sm:flex items-center gap-2 text-xs">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-[#0F766E] bg-[#F0FDFA] border border-[#CCFBF1] px-2 py-0.5 rounded">
            {getSectionLabel()}
          </span>
        </div>
      </div>

      {/* Global Search & Quick-Jump Shortcuts */}
      <div className="flex-1 max-w-xl flex items-center gap-2">
        <form onSubmit={handleSearchSubmit} className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#64748B]" />
            <input
              type="text"
              placeholder="Jump to case (FS-1042), tx leg (T001), or search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs bg-[#FAF9F6] hover:bg-white focus:bg-white border border-[#D6D3CD] focus:border-[#0D9488] text-[#0B1322] placeholder:text-[#64748B] transition-colors outline-none font-mono"
            />
          </div>
        </form>

        <div className="hidden xl:flex items-center gap-1.5 text-[11px] font-mono">
          <Link
            to="/app/cases/FS-1042"
            className="px-2 py-1 rounded bg-[#FAF9F6] hover:bg-[#F0FDFA] text-[#334155] hover:text-[#0F766E] border border-[#E2DFD7] hover:border-[#0D9488]/40 transition-colors inline-flex items-center gap-1"
            title="Jump to Case FS-1042 Dossier"
          >
            <span>FS-1042</span>
            <ArrowUpRight className="w-3 h-3" />
          </Link>
          <Link
            to="/app/transaction-check?caseId=FS-1042&txId=T001"
            className="px-2 py-1 rounded bg-[#FAF9F6] hover:bg-[#F0FDFA] text-[#334155] hover:text-[#0F766E] border border-[#E2DFD7] hover:border-[#0D9488]/40 transition-colors inline-flex items-center gap-1"
            title="Explain Origin Leg T001"
          >
            <span>TX:T001</span>
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Right System Telemetry & Analyst Identity */}
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-semibold border ${
            backendStatus === 'online'
              ? 'bg-emerald-50/90 text-emerald-800 border-emerald-300'
              : backendStatus === 'offline'
              ? 'bg-red-50 text-red-800 border-red-300'
              : 'bg-[#FAF9F6] text-[#64748B] border-[#E2DFD7]'
          }`}
        >
          {backendStatus === 'online' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              <span className="hidden sm:inline">Backend API Live</span>
            </>
          ) : backendStatus === 'offline' ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-red-600" />
              <span className="hidden sm:inline">Backend Offline</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
              <span className="hidden sm:inline">Connecting...</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 pl-2.5 border-l border-[#E2DFD7]">
          <div className="w-7 h-7 rounded bg-[#0B1322] text-[#2DD4BF] border border-[#1C2B45] flex items-center justify-center font-mono font-bold text-[11px]">
            RS
          </div>
          <div className="text-left hidden md:block">
            <div className="text-xs font-semibold text-[#0B1322] leading-none">Rahul Sharma</div>
            <div className="text-[10px] font-mono text-[#64748B] mt-0.5">Lead Forensic Analyst</div>
          </div>
        </div>
      </div>
    </header>
  );
};
