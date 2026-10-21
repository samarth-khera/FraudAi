import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Shield, Search, Cpu, ExternalLink, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
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
    v2Api
      .getModelsStatus()
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
    <header className="bg-[#0B0F14]/90 backdrop-blur-md border-b border-[#293543] text-[#F3F6F8] sticky top-0 z-40 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link to="/v2" className="flex items-center gap-2.5 group">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-9 h-9 rounded-xl bg-[#19232F] border border-[#293543] flex items-center justify-center text-[#C8F169] shadow-xs transition-colors group-hover:border-[#C8F169]/50 group-hover:bg-[#1F2E0F]/40"
            >
              <Shield className="w-5 h-5 text-[#C8F169]" />
            </motion.div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-[#F3F6F8]">
                  FraudShield AI
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#19232F] text-[#C8F169] border border-[#293543]">
                  V2
                </span>
              </div>
              <p className="text-[11px] text-[#9CAAB6] font-normal">
                Account Search & Money Flow
              </p>
            </div>
          </Link>
        </div>

        {/* Global Quick Search - Only rendered on detail pages */}
        {!isSearchWorkspace ? (
          <form onSubmit={handleSearch} className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CAAB6]" />
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="Jump to account ID (e.g. ACC-000001)..."
                className="w-full bg-[#131A23] border border-[#293543] rounded-xl pl-9 pr-12 py-1.5 text-xs text-[#F3F6F8] placeholder:text-[#627181] focus:outline-none focus:bg-[#19232F] focus:border-[#C8F169] focus:ring-2 focus:ring-[#C8F169]/20 font-mono transition-all"
                aria-label="Account Jump Search"
              />
              {searchId && (
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[10px] font-bold bg-[#C8F169] text-[#0B0F14] hover:bg-[#D7F68B] transition-colors cursor-pointer"
                >
                  Go
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#131A23] border border-[#293543] text-xs font-mono text-[#9CAAB6] shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-[#C8F169] animate-pulse"></span>
            <span className="font-semibold text-[11px]">Forensic Search Workspace</span>
          </div>
        )}

        {/* Status & Navigation Switcher */}
        <div className="flex items-center gap-3">
          {/* Live ML Status Pill */}
          <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#131A23] border border-[#293543] text-xs shadow-xs">
            <Cpu className="w-3.5 h-3.5 text-[#9CAAB6]" />
            <span className="text-[#9CAAB6] font-semibold text-[11px]">AI Engine:</span>
            {isModelReady ? (
              <span className="inline-flex items-center gap-1.5 text-[#C8F169] font-bold font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#C8F169]"></span>
                v2-active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[#FF6B77] font-bold text-[11px]">
                <AlertTriangle className="w-3 h-3" />
                Degraded
              </span>
            )}
          </div>

          {/* V1 Switcher Button */}
          <Link
            to="/app/dashboard"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#293543] bg-[#131A23] text-xs font-bold text-[#9CAAB6] hover:text-[#F3F6F8] hover:border-[#C8F169]/40 hover:bg-[#19232F] shadow-xs transition-all active:scale-[0.98]"
            title="Switch to V1 Classic Case Management"
          >
            <span className="hidden sm:inline">V1 Classic</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#9CAAB6]" />
          </Link>
        </div>
      </div>
    </header>
  );
};
