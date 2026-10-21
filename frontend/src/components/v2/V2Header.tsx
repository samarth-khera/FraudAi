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
    <header className="bg-white/90 backdrop-blur-md border-b border-[#E5E8F2] text-[#191A24] sticky top-0 z-40 shadow-[0_4px_20px_-4px_rgba(112,40,245,0.04)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link to="/v2" className="flex items-center gap-2.5 group">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7028F5] to-[#4F86FF] flex items-center justify-center text-white shadow-sm shadow-[#7028F5]/30 transition-transform"
            >
              <Shield className="w-5 h-5 transition-transform" />
            </motion.div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-[#191A24]">
                  FraudShield AI
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EDE4FF] text-[#7028F5] border border-[#DDD6FE]">
                  V2
                </span>
              </div>
              <p className="text-[11px] text-[#73798B] font-normal">
                Account Search & Money Flow
              </p>
            </div>
          </Link>
        </div>

        {/* Global Quick Search - Only rendered on detail pages */}
        {!isSearchWorkspace ? (
          <form onSubmit={handleSearch} className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="Jump to account ID (e.g. ACC-000001)..."
                className="w-full bg-[#F7F8FD] border border-[#E5E8F2] rounded-xl pl-9 pr-12 py-1.5 text-xs text-[#191A24] placeholder:text-[#9CA3AF] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#7028F5] focus:ring-2 focus:ring-[#7028F5]/20 font-mono transition-all"
                aria-label="Account Jump Search"
              />
              {searchId && (
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-gradient-to-r from-[#7028F5] to-[#4F86FF] text-white hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                >
                  Go
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#F7F8FD] border border-[#E5E8F2] text-xs font-mono text-[#73798B] shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-[#7028F5] animate-pulse"></span>
            <span className="font-semibold text-[11px] text-[#191A24]">Forensic Search Workspace</span>
          </div>
        )}

        {/* Status & Navigation Switcher */}
        <div className="flex items-center gap-3">
          {/* Live ML Status Pill */}
          <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#F7F8FD] border border-[#E5E8F2] text-xs shadow-2xs">
            <Cpu className="w-3.5 h-3.5 text-[#73798B]" />
            <span className="text-[#73798B] font-medium text-[11px]">AI Engine:</span>
            {isModelReady ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#E2F5EB] text-[#059669] font-bold font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#059669]"></span>
                v2-active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FFF1F2] text-[#E11D48] font-bold text-[11px]">
                <AlertTriangle className="w-3 h-3" />
                Degraded
              </span>
            )}
          </div>

          {/* V1 Switcher Button */}
          <Link
            to="/app/dashboard"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#E5E8F2] bg-white text-xs font-bold text-[#73798B] hover:text-[#7028F5] hover:border-[#7028F5]/30 hover:bg-[#F2EEFF]/40 shadow-2xs transition-all active:scale-[0.98]"
            title="Switch to V1 Classic Case Management"
          >
            <span className="hidden sm:inline">V1 Classic</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#9CA3AF]" />
          </Link>
        </div>
      </div>
    </header>
  );
};
