import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Shield,
  Search,
  Cpu,
  Menu,
  X,
  Home,
  LayoutGrid,
  Users,
  Network,
  FolderGit2,
  LineChart,
  FileCheck2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { normalizeAccountId } from '../../pages/v2/V2SearchPage';

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPaths: string[];
  exact?: boolean;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    name: 'Home',
    path: '/',
    icon: Home,
    matchPaths: ['/'],
    exact: true,
    description: 'Product overview & forensic architecture',
  },
  {
    name: 'Workspace',
    path: '/workspace',
    icon: LayoutGrid,
    matchPaths: ['/workspace', '/v2', '/app/dashboard'],
    description: 'Account search, triage queue & recent lookups',
  },
  {
    name: 'Accounts',
    path: '/v2/accounts/ACC-000001',
    icon: Users,
    matchPaths: ['/v2/accounts', '/accounts'],
    description: 'Account 360° profile, live ML & TreeSHAP',
  },
  {
    name: 'Fund Flow',
    path: '/app/fund-flow',
    icon: Network,
    matchPaths: ['/app/fund-flow', '/fund-flow'],
    description: 'Interactive multi-hop money flow graph',
  },
  {
    name: 'Cases',
    path: '/app/cases',
    icon: FolderGit2,
    matchPaths: ['/app/cases', '/cases'],
    description: 'Incident dossiers & evidence tracking',
  },
  {
    name: 'Insights',
    path: '/app/model-insights',
    icon: LineChart,
    matchPaths: ['/app/model-insights', '/insights', '/app/transaction-check'],
    description: 'XGBoost models, TreeSHAP & PaySim evaluation',
  },
  {
    name: 'Audit Trail',
    path: '/app/cases/FS-1042?tab=audit',
    icon: FileCheck2,
    matchPaths: ['/audit', 'tab=audit'],
    description: 'Immutable human adjudication & review log',
  },
];

export const UnifiedHeader: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile menu on location change or Escape key
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch model status once at header mount
  useEffect(() => {
    let mounted = true;
    v2Api
      .getModelsStatus()
      .then((status) => {
        if (mounted) setModelStatus(status);
      })
      .catch(() => {
        if (mounted) setModelStatus(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const isModelReady = modelStatus?.inference_ready ?? false;

  const isItemActive = (item: NavItem): boolean => {
    const currentPath = location.pathname;
    const currentSearch = location.search;

    if (item.exact) {
      return currentPath === item.path;
    }
    if (item.name === 'Audit Trail') {
      return currentSearch.includes('tab=audit') || currentPath === '/audit';
    }
    if (item.name === 'Cases' && currentSearch.includes('tab=audit')) {
      return false; // Highlight Audit Trail instead
    }
    return item.matchPaths.some((p) => currentPath.startsWith(p));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // 1. Account search: starts with ACC or bare number
    const normalizedAcc = normalizeAccountId(query);
    if (/^ACC-\d+/i.test(normalizedAcc)) {
      navigate(`/v2/accounts/${encodeURIComponent(normalizedAcc)}`);
      setSearchQuery('');
      return;
    }

    // 2. Case search: starts with FS-
    if (/^FS-/i.test(query)) {
      navigate(`/app/cases/${encodeURIComponent(query.toUpperCase())}`);
      setSearchQuery('');
      return;
    }

    // 3. Transaction leg: starts with T or TXN-
    if (/^(T\d+|TXN-)/i.test(query)) {
      navigate(`/app/transaction-check?caseId=FS-1042&txId=${encodeURIComponent(query.toUpperCase())}`);
      setSearchQuery('');
      return;
    }

    // 4. Default: jump to workspace search
    navigate(`/workspace?search=${encodeURIComponent(query)}`);
    setSearchQuery('');
  };

  return (
    <header className="sticky top-0 z-40 bg-[#FFFFFF]/95 backdrop-blur-md border-b border-[#EAE3D6] text-[#1A1714] shadow-[0_2px_14px_rgba(180,150,120,0.06)] transition-colors">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 sm:gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/" className="flex items-center gap-2.5 group">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              className="w-9 h-9 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] shadow-2xs group-hover:bg-[#FFE8CC] group-hover:border-[#F8B378] transition-all"
            >
              <Shield className="w-5 h-5 text-[#EA8500]" />
            </motion.div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-[#1A1714] group-hover:text-[#EA8500] transition-colors leading-tight font-display">
                  FraudShield AI
                </span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-[#FFF4E6] text-[#EA8500] border border-[#FCD5B5]">
                  V2
                </span>
              </div>
              <span className="text-[10px] text-[#8C857B] font-medium leading-tight">
                Forensic Intelligence
              </span>
            </div>
          </Link>
        </div>

        {/* Desktop Primary Navigation Bar */}
        <nav
          className="hidden xl:flex items-center gap-1 bg-[#FAF7F2] p-1 rounded-full border border-[#EAE3D6]"
          aria-label="Global navigation"
        >
          {NAV_ITEMS.map((item) => {
            const active = isItemActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`relative px-2.5 2xl:px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                  active
                    ? 'text-[#EA8500] font-bold bg-[#FFF4E6] border border-[#FCD5B5] shadow-2xs'
                    : 'text-[#6B655B] hover:text-[#1A1714] hover:bg-white/80'
                }`}
                title={item.description}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#EA8500]' : 'text-[#8C857B]'}`} />
                <span>{item.name}</span>
                {active && (
                  <motion.div
                    layoutId="activeNavPill"
                    className="absolute inset-0 rounded-full border border-[#FCD5B5] pointer-events-none"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Global Quick Search & Right Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Universal Search Bar */}
          <form onSubmit={handleSearchSubmit} className="relative hidden xl:block w-36 2xl:w-52">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C857B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search (ACC-, FS-)..."
              className="w-full bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl pl-8 pr-10 py-1.5 text-xs text-[#1A1714] placeholder:text-[#8C857B] focus:outline-none focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 font-mono transition-all"
              aria-label="Universal Search"
            />
            {searchQuery && (
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#EA8500] hover:bg-[#D27400] text-white transition-colors cursor-pointer shadow-2xs"
              >
                Go
              </button>
            )}
          </form>

          {/* AI Engine Status Pill */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs shadow-2xs shrink-0">
            <Cpu className="w-3.5 h-3.5 text-[#6B655B]" />
            <span className="text-[#6B655B] font-medium text-[11px] hidden 2xl:inline">Engine:</span>
            {isModelReady ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.2 rounded-full bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] font-bold font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                v2-active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full bg-[#FFF1F2] text-[#E11D48] border border-[#FFE4E6] font-bold text-[11px]">
                <AlertTriangle className="w-3 h-3" />
                Degraded
              </span>
            )}
          </div>

          {/* Quick Jump Pill: FS-1042 Case */}
          <Link
            to="/app/cases/FS-1042"
            className="hidden 2xl:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#FAF7F2] hover:bg-[#FFF4E6] text-[#6B655B] hover:text-[#EA8500] border border-[#EAE3D6] hover:border-[#FCD5B5] text-[11px] font-mono font-semibold transition-all shadow-2xs shrink-0"
            title="Jump to Incident Case FS-1042"
          >
            <span>FS-1042</span>
            <ArrowRight className="w-3 h-3 text-[#8C857B]" />
          </Link>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="xl:hidden p-2 rounded-xl bg-[#FAF7F2] hover:bg-[#F2ECE1] border border-[#EAE3D6] text-[#1A1714] transition-colors cursor-pointer shadow-2xs"
            aria-label={isMobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X className="w-5 h-5 text-[#EA8500]" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="xl:hidden border-t border-[#EAE3D6] bg-white/98 backdrop-blur-lg px-4 pt-3 pb-6 space-y-4 shadow-lg overflow-hidden"
          >
            {/* Mobile Search Bar */}
            <form onSubmit={handleSearchSubmit} className="relative w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C857B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Jump to Account (ACC-000001), Case (FS-1042)..."
                className="w-full bg-[#FAF7F2] border border-[#EAE3D6] rounded-xl pl-9 pr-14 py-2 text-xs text-[#1A1714] placeholder:text-[#8C857B] focus:outline-none focus:bg-white focus:border-[#EA8500] font-mono"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg text-xs font-bold bg-[#EA8500] hover:bg-[#D27400] text-white cursor-pointer"
              >
                Go
              </button>
            </form>

            {/* Mobile Navigation Links */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => {
                const active = isItemActive(item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-start gap-3 p-2.5 rounded-2xl border transition-all ${
                      active
                        ? 'bg-[#FFF4E6] border-[#FCD5B5] text-[#EA8500]'
                        : 'bg-[#FAF7F2] border-[#EAE3D6] text-[#1A1714] hover:bg-white'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        active ? 'bg-[#EA8500] text-white' : 'bg-white text-[#6B655B] border border-[#EAE3D6]'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold">{item.name}</span>
                        {active && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500]" />
                        )}
                      </div>
                      <p className="text-[11px] text-[#6B655B] truncate">{item.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Mobile Footer Status & Shortcuts */}
            <div className="pt-2 border-t border-[#EAE3D6] flex flex-wrap items-center justify-between gap-3 text-xs text-[#6B655B]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
                <span className="font-mono text-[11px]">AI Model: v2-account-1.0.0</span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/app/cases/FS-1042"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] font-mono text-[11px] font-bold text-[#1A1714] hover:bg-[#FFF4E6] hover:text-[#EA8500]"
                >
                  Case FS-1042
                </Link>
                <Link
                  to="/v2/accounts/ACC-000001"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] font-mono text-[11px] font-bold text-[#1A1714] hover:bg-[#FFF4E6] hover:text-[#EA8500]"
                >
                  ACC-000001
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
