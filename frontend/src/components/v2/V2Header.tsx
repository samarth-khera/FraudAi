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
    <header className="bg-white border-b border-[#E8EAED] text-[#202124] sticky top-0 z-40 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link to="/v2" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200/60 flex items-center justify-center text-teal-700 shadow-2xs transition-transform group-hover:scale-105">
              <Shield className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base tracking-tight text-[#202124]">FraudShield AI</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  V2
                </span>
              </div>
              <p className="text-[11px] text-[#727780] font-normal">Account Search & Money Flow</p>
            </div>
          </Link>
        </div>

        {/* Global Quick Search - Only rendered on detail pages */}
        {!isSearchWorkspace ? (
          <form onSubmit={handleSearch} className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="Jump to account ID (e.g. ACC-000001)..."
                className="w-full bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg pl-9 pr-12 py-1.5 text-xs text-[#202124] placeholder:text-[#727780] focus:outline-none focus:bg-white focus:border-teal-700 focus:ring-1 focus:ring-teal-700 font-mono transition-colors"
                aria-label="Account Jump Search"
              />
              {searchId && (
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[10px] font-medium bg-teal-700 text-white hover:bg-teal-800 transition-colors cursor-pointer"
                >
                  Go
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[#F8F9FA] border border-[#E5E7EB] text-xs font-mono text-[#5F6368]">
            <span className="w-2 h-2 rounded-full bg-teal-600"></span>
            <span>Forensic Search Workspace</span>
          </div>
        )}

        {/* Status & Navigation Switcher */}
        <div className="flex items-center gap-3">
          {/* Live ML Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F8F9FA] border border-[#E5E7EB] text-xs">
            <Cpu className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[#727780]">AI Engine:</span>
            {isModelReady ? (
              <span className="flex items-center gap-1.5 text-emerald-700 font-medium font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                v2-active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-700 font-medium text-[11px]">
                <AlertTriangle className="w-3 h-3" />
                Degraded
              </span>
            )}
          </div>

          {/* V1 Switcher Button */}
          <Link
            to="/app/dashboard"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E5E7EB] text-xs font-medium text-[#5F6368] hover:text-[#202124] hover:border-slate-300 hover:bg-[#F8F9FA] transition-colors"
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
