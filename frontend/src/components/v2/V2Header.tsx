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
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="bg-[#FFFFFF]/95 backdrop-blur-md border-b border-[#EAE3D6] text-[#1A1714] sticky top-0 z-40 shadow-[0_2px_14px_rgba(180,150,120,0.06)]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link to="/v2" className="flex items-center gap-2.5 group">
            <motion.div
              whileHover={{ scale: 1.06, rotate: 1 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              className="w-9 h-9 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] shadow-xs group-hover:bg-[#FFE8CC] group-hover:border-[#F8B378] group-hover:shadow-[0_2px_10px_rgba(234,133,0,0.22)] transition-all duration-200"
            >
              <Shield className="w-5 h-5 text-[#EA8500] transition-transform group-hover:scale-105" />
            </motion.div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                  FraudShield AI
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#FFF4E6] text-[#EA8500] border border-[#FCD5B5]">
                  V2
                </span>
              </div>
              <p className="text-[11px] text-[#6B655B] font-normal">
                Account Search & Money Flow
              </p>
            </div>
          </Link>
        </div>

        {/* Global Quick Search - Rendered on detail pages */}
        {!isSearchWorkspace ? (
          <form onSubmit={handleSearch} className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A29E]" />
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="Jump to account ID (e.g. ACC-000001)..."
                className="w-full bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl pl-9 pr-12 py-1.5 text-xs text-[#1A1714] placeholder:text-[#A8A29E] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 font-mono transition-all"
                aria-label="Account Jump Search"
              />
              {searchId && (
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-[#EA8500] hover:bg-[#D27400] text-white transition-colors cursor-pointer shadow-xs"
                >
                  Go
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-mono text-[#6B655B] shadow-2xs hover:border-[#FCD5B5] transition-colors">
            <span className="w-2 h-2 rounded-full bg-[#EA8500] animate-pulse"></span>
            <span className="font-semibold text-[11px] text-[#1A1714]">Forensic Search Workspace</span>
          </div>
        )}

        {/* Status & Navigation Switcher */}
        <div className="flex items-center gap-3">
          {/* Live ML Status Pill */}
          <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs shadow-2xs hover:border-[#DDD4C4] transition-colors">
            <Cpu className="w-3.5 h-3.5 text-[#6B655B]" />
            <span className="text-[#6B655B] font-medium text-[11px]">AI Engine:</span>
            {isModelReady ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] font-bold font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
                v2-active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FFF1F2] text-[#E11D48] border border-[#FFE4E6] font-bold text-[11px]">
                <AlertTriangle className="w-3 h-3" />
                Degraded
              </span>
            )}
          </div>

          {/* V1 Switcher Button */}
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              to="/app/dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#EAE3D6] bg-white text-xs font-bold text-[#6B655B] hover:text-[#EA8500] hover:border-[#FCD5B5] hover:bg-[#FFF4E6]/50 shadow-2xs transition-all"
              title="Switch to V1 Classic Case Management"
            >
              <span className="hidden sm:inline">V1 Classic</span>
              <ExternalLink className="w-3.5 h-3.5 text-[#A8A29E] group-hover:text-[#EA8500]" />
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.header>
  );
};
