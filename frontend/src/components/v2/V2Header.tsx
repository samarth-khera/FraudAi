import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Shield, Search, Cpu, ExternalLink, AlertTriangle } from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { normalizeAccountId } from '../../pages/v2/V2SearchPage';

export const V2Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchId, setSearchId] = useState('');
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);

  const isSearchWorkspace = !location.pathname.includes('/accounts/');

  useEffect(() => {
    v2Api.getModelsStatus()
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeAccountId(searchId);
    if (normalized) {
      navigate(`/v2/accounts/${encodeURIComponent(normalized)}`);
    }
  };

  const isModelReady = modelStatus?.inference_ready ?? false;

  return (
    <header className="bg-[#0B1322] border-b border-[#1C2B45] text-slate-100 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link to="/v2" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-md bg-[#0D9488] flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base tracking-tight text-white">FraudShield AI</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#14B8A6]/20 text-[#2DD4BF] border border-[#14B8A6]/40">
                  V2 FORENSIC
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-normal">Account Intelligence & Fund Tracing</p>
            </div>
          </Link>
        </div>

        {/* Global Quick Search - Only rendered on detail pages to avoid duplicate search on /v2 */}
        {!isSearchWorkspace ? (
          <form onSubmit={handleSearch} className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="Jump to account ID (e.g. ACC-000001)..."
                className="w-full bg-[#111C30] border border-[#1C2B45] rounded-md pl-9 pr-12 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] font-mono transition-colors"
                aria-label="Account Jump Search"
              />
              {searchId && (
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[10px] font-medium bg-[#0D9488] text-white hover:bg-[#0F766E] transition-colors cursor-pointer"
                >
                  Go
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[#111C30]/80 border border-[#1C2B45] text-xs font-mono text-slate-300">
            <span className="w-2 h-2 rounded-full bg-[#2DD4BF] animate-pulse"></span>
            <span>Forensic Search & Case Intelligence</span>
          </div>
        )}

        {/* Status & Navigation Switcher */}
        <div className="flex items-center gap-3">
          {/* Live ML Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111C30] border border-[#1C2B45] text-[11px]">
            <Cpu className="w-3.5 h-3.5 text-[#2DD4BF]" />
            <span className="text-slate-400">ML Engine:</span>
            {isModelReady ? (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                v2-account-1.0
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400 font-medium">
                <AlertTriangle className="w-3 h-3" />
                Degraded
              </span>
            )}
          </div>

          {/* V1 Switcher Button */}
          <Link
            to="/app/dashboard"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#1C2B45] text-xs font-medium text-slate-300 hover:text-white hover:border-slate-500 hover:bg-[#111C30] transition-colors"
            title="Switch to V1 Classic Case Management"
          >
            <span className="hidden sm:inline">V1 Classic</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
};
