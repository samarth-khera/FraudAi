import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  GitFork,
  Cpu,
  Layers,
  AlertTriangle,
  History,
  X,
  Info,
  Shield,
  Activity,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { V2Header } from '../../components/v2/V2Header';
import { V2Footer } from '../../components/v2/V2Footer';
import { V2MoneyFlowVisual } from '../../components/v2/V2MoneyFlowVisual';

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  gsap.registerPlugin(ScrollTrigger);
}

interface SampleCase {
  id: string;
  name: string;
  category: 'victim' | 'mule' | 'counterparty' | 'baseline';
  roleTag: string;
  tagColor: string;
  badgeDot: string;
  summary: string;
  activityCount: string;
  patternLabel: string;
  findingNote: string;
}

const SAMPLE_ACCOUNTS: SampleCase[] = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    category: 'victim',
    roleTag: 'Scam Victim Demo',
    tagColor: 'bg-[#FFF4E6] text-[#C05621] border-[#FCD5B5]',
    badgeDot: 'bg-[#EA8500]',
    summary: 'A customer tricked into sending money in a payment scam. Their savings were drained, but regular banking rules did not catch it — showing why AI protection matters.',
    activityCount: '56 transfers',
    patternLabel: 'Savings drained (₹250k)',
    findingNote: 'AI flagged unusual drain · Protected from wrongful freezing',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    category: 'mule',
    roleTag: 'Money Mule Demo',
    tagColor: 'bg-[#FFF0F2] text-[#BE123C] border-[#FECDD3]',
    badgeDot: 'bg-[#E11D48]',
    summary: 'A pass-through account used to move stolen money quickly (<12 minutes) before the funds can be frozen or recalled.',
    activityCount: '33 transfers',
    patternLabel: 'Rapid pass-through under 12 min',
    findingNote: 'Flagged for unusually fast transfer speed',
  },
  {
    id: 'ACC-000003',
    name: 'Ishan Reddy',
    category: 'counterparty',
    roleTag: 'Connected Account Demo',
    tagColor: 'bg-[#EBF5FF] text-[#1E40AF] border-[#BFDBFE]',
    badgeDot: 'bg-[#3B82F6]',
    summary: 'A recipient account 2 transfers down the payment chain. Shows how far the money trail goes and where investigation bounds stop.',
    activityCount: '48 transfers',
    patternLabel: '2 steps away from source',
    findingNote: 'Tracked in money map · Exposure bounded',
  },
  {
    id: 'ACC-000010',
    name: 'Arjun Sengupta',
    category: 'baseline',
    roleTag: 'Normal Account Demo',
    tagColor: 'bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]',
    badgeDot: 'bg-[#22C55E]',
    summary: 'A regular customer with everyday shopping and salary transfers. Confirms genuine customer accounts are never wrongly flagged.',
    activityCount: '50 transfers',
    patternLabel: 'Steady everyday transfers',
    findingNote: 'Low risk · Zero suspicious activity',
  },
];

export function normalizeAccountId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d{1,6}$/.test(trimmed)) {
    return `ACC-${trimmed.padStart(6, '0')}`;
  }
  if (/^acc-\d{1,6}$/i.test(trimmed)) {
    const numPart = trimmed.replace(/^acc-/i, '');
    return `ACC-${numPart.padStart(6, '0')}`;
  }
  return trimmed.toUpperCase();
}

export const V2SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'victim' | 'mule' | 'counterparty' | 'baseline'>('all');
  const [searchError, setSearchError] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);

  // 1. Fetch live ML model engine telemetry and saved recents
  useEffect(() => {
    v2Api
      .getModelsStatus()
      .then((data) => {
        setModelStatus(data);
      })
      .catch(() => {
        setModelStatus(null);
      });

    try {
      const stored = localStorage.getItem('fs_v2_recent_accounts');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, 5));
        }
      }
    } catch {
      // Ignore localStorage read errors
    }
  }, []);

  // 2. Coordinated GSAP First-Load Entrance Choreography & Scroll Storytelling
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !containerRef.current) return;

    const ctx = gsap.context(() => {
      // Hero Entrance Timeline
      const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      heroTl
        .fromTo(
          '.gsap-hero-badge',
          { opacity: 0, y: -8, scale: 0.95 },
          { opacity: 1, y: 0, scale: 1, duration: 0.4 }
        )
        .fromTo(
          '.gsap-hero-title',
          { yPercent: 100, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 0.55, ease: 'power3.out' },
          '-=0.15'
        )
        .fromTo(
          '.gsap-hero-desc',
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.45 },
          '-=0.3'
        )
        .fromTo(
          '.gsap-search-card',
          { opacity: 0, y: 18, scale: 0.985 },
          { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.12)' },
          '-=0.25'
        )
        .fromTo(
          '.gsap-flow-card',
          { opacity: 0, x: 20, scale: 0.98 },
          { opacity: 1, x: 0, scale: 1, duration: 0.65, ease: 'power3.out' },
          '-=0.45'
        )
        .fromTo(
          '.gsap-shortcut-chip',
          { opacity: 0, scale: 0.92, y: 6 },
          { opacity: 1, scale: 1, y: 0, duration: 0.35, stagger: 0.04, ease: 'back.out(1.2)' },
          '-=0.3'
        );

      // Stage 2: ScrollTrigger for Workflow Steps with Progressive Connector Line
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        gsap.fromTo(
          '.gsap-step-card',
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.12,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-workflow-section',
              start: 'top 85%',
              toggleActions: 'play none none none',
            },
          }
        );

        gsap.fromTo(
          '.gsap-step-connector',
          { scaleX: 0, transformOrigin: 'left center' },
          {
            scaleX: 1,
            duration: 0.8,
            ease: 'power2.inOut',
            scrollTrigger: {
              trigger: '.gsap-workflow-section',
              start: 'top 80%',
              toggleActions: 'play none none none',
            },
          }
        );

        // Stage 4: ScrollTrigger for Example Accounts Header
        gsap.fromTo(
          '.gsap-examples-header',
          { opacity: 0, y: 18 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-examples-section',
              start: 'top 88%',
              toggleActions: 'play none none none',
            },
          }
        );
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError('');
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchError('Please enter an account ID (e.g. ACC-000001 or just 1)');
      return;
    }
    const normalized = normalizeAccountId(trimmed);
    if (normalized) {
      navigate(`/v2/accounts/${encodeURIComponent(normalized)}`);
    } else {
      setSearchError('Please enter a valid account ID, such as ACC-000001 or a number like 1.');
    }
  };

  const handleSelectAccount = (id: string) => {
    navigate(`/v2/accounts/${encodeURIComponent(id)}`);
  };

  const clearRecentSearches = () => {
    try {
      localStorage.removeItem('fs_v2_recent_accounts');
      setRecentSearches([]);
    } catch {
      // Ignore
    }
  };

  const filteredCases =
    selectedFilter === 'all'
      ? SAMPLE_ACCOUNTS
      : SAMPLE_ACCOUNTS.filter((c) => c.category === selectedFilter);

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1C1917] font-sans selection:bg-[#EA8500]/20 selection:text-[#EA8500]"
    >
      <V2Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-12 sm:space-y-16">
        {/* ========================================================================= */}
        {/* STAGE 1: HERO & SEARCH CONSOLE WITH SIGNATURE MONEY FLOW VISUAL          */}
        {/* ========================================================================= */}
        <section aria-labelledby="search-heading" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-8 items-start">
            {/* Left Column: Headline & Elevated Search Console */}
            <div className="lg:col-span-7 space-y-5">
              {/* Subtle System Status Pill */}
              <div className="gsap-hero-badge inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#FFFFFF] border border-[#EAE3D6] text-[#78716C] text-xs font-semibold shadow-xs">
                <Shield className="w-3.5 h-3.5 text-[#EA8500]" />
                <span>Stage 1 · Forensic Account Investigation</span>
              </div>

              {/* Masked Headline for Upward Reveal */}
              <div className="overflow-hidden py-1">
                <h1
                  id="search-heading"
                  className="gsap-hero-title text-3xl sm:text-4xl lg:text-[42px] font-black tracking-tight text-[#1C1917] font-display leading-[1.15]"
                >
                  Look up an account
                </h1>
              </div>

              {/* Plain English Subtitle */}
              <p className="gsap-hero-desc text-[#78716C] text-sm sm:text-base leading-relaxed max-w-xl font-normal">
                Enter a demo account ID to see its transactions, connected accounts, unusual activity, and the AI's assessment.
              </p>

              {/* Search Card Console */}
              <div className="gsap-search-card bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_32px_rgba(180,150,120,0.09)] transition-shadow text-left relative overflow-hidden">
                {/* Top Bar inside Card */}
                <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[#F2ECE2] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#EA8500] animate-pulse"></span>
                    <span className="font-mono font-bold tracking-wider uppercase text-[#78716C] text-[11px]">
                      Account Repository Lookup
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-[#78716C] bg-[#FAF7F2] border border-[#EBE4D8] px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
                    <span>Core Ledger: Live</span>
                  </div>
                </div>

                <form onSubmit={handleSearch} className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div
                      className={`relative flex-1 flex items-center rounded-2xl transition-all ${
                        isInputFocused
                          ? 'ring-4 ring-[#EA8500]/15 border-[#EA8500] bg-[#FFFFFF]'
                          : 'border-[#EAE3D6] bg-[#FAF7F2]'
                      } border`}
                    >
                      <Search
                        className={`w-5 h-5 absolute left-4 pointer-events-none transition-colors ${
                          isInputFocused ? 'text-[#EA8500]' : 'text-[#A8A29E]'
                        }`}
                      />
                      <input
                        id="account-search-input"
                        type="text"
                        value={query}
                        onFocus={() => setIsInputFocused(true)}
                        onBlur={() => setIsInputFocused(false)}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          if (searchError) setSearchError('');
                        }}
                        placeholder="Enter synthetic account ID, e.g. ACC-000001"
                        className="w-full h-14 bg-transparent rounded-2xl pl-12 pr-12 text-sm sm:text-base text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none font-mono transition-all"
                        autoFocus
                        aria-label="Account Identifier Search"
                      />
                      <AnimatePresence>
                        {query && (
                          <motion.button
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            type="button"
                            onClick={() => setQuery('')}
                            className="absolute right-4 p-1 text-[#A8A29E] hover:text-[#1C1917] transition-colors cursor-pointer rounded-lg hover:bg-[#EAE3D6]/50"
                            title="Clear input"
                            aria-label="Clear input text"
                          >
                            <X className="w-4 h-4" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>

                    <motion.button
                      type="submit"
                      whileHover={{ y: -2, scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: 'spring', stiffness: 450, damping: 25 }}
                      className="group h-14 px-8 rounded-2xl bg-[#EA8500] hover:bg-[#D96D00] text-white font-bold text-sm tracking-wide shadow-[0_6px_20px_rgba(234,133,0,0.32)] hover:shadow-[0_8px_25px_rgba(234,133,0,0.42)] flex items-center justify-center gap-2.5 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA8500] focus-visible:ring-offset-2 transition-all"
                      title="Open account investigation"
                    >
                      <span>View account</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1.5 transition-transform" />
                    </motion.button>
                  </div>

                  <AnimatePresence>
                    {searchError && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -4 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -4 }}
                        className="overflow-hidden"
                      >
                        <p className="text-xs text-rose-600 flex items-center gap-1.5 pt-1 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{searchError}</span>
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Guidance Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#78716C] pt-3 border-t border-[#F2ECE2]">
                    <span className="flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-[#EA8500] shrink-0" />
                      <span>Tip: Type an account ID like ACC-000001, or just 1.</span>
                    </span>
                    <span className="text-[#A8A29E] text-[11px] font-semibold">
                      Instant transaction review & AI checks
                    </span>
                  </div>
                </form>

                {/* Quick Demo Shortcuts */}
                <div className="mt-4 pt-3.5 border-t border-[#F2ECE2] space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-[#78716C] text-xs">Quick examples:</span>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000001')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#FFF4E6] hover:bg-[#FFE8CC] text-[#C05621] border border-[#FCD5B5] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Demo: Scam victim account"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500]"></span>
                      <span>ACC-000001 (Victim)</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000002')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#FFF0F2] hover:bg-[#FFE4E6] text-[#BE123C] border border-[#FECDD3] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Demo: Pass-through money mule"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48]"></span>
                      <span>ACC-000002 (Mule)</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000003')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#EBF5FF] hover:bg-[#DBEAFE] text-[#1E40AF] border border-[#BFDBFE] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Demo: Connected downstream recipient"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]"></span>
                      <span>ACC-000003 (Hop 2)</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000010')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#EAF7EE] hover:bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Demo: Normal everyday customer"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
                      <span>ACC-000010 (Normal)</span>
                    </motion.button>
                  </div>

                  {/* Recent Searches */}
                  {recentSearches.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#78716C] pt-1">
                      <div className="flex items-center gap-1.5 text-[#A8A29E] font-semibold">
                        <History className="w-3.5 h-3.5" />
                        <span>Recent:</span>
                      </div>
                      {recentSearches.map((rec) => (
                        <motion.button
                          key={rec}
                          type="button"
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => handleSelectAccount(rec)}
                          className="h-6 px-3 rounded-full bg-[#FAF7F2] hover:bg-[#EAE3D6] text-[#44403C] border border-[#EAE3D6] font-mono text-xs font-semibold transition-all cursor-pointer shadow-xs"
                        >
                          {rec}
                        </motion.button>
                      ))}
                      <button
                        type="button"
                        onClick={clearRecentSearches}
                        className="p-1 text-[#A8A29E] hover:text-[#1C1917] transition-colors ml-1 cursor-pointer rounded-md hover:bg-[#FAF7F2]"
                        title="Clear recent searches"
                        aria-label="Clear recent searches"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Signature Animated Money-Flow Visual */}
            <div className="lg:col-span-5 gsap-flow-card flex flex-col justify-stretch">
              <V2MoneyFlowVisual
                onSelectAccount={handleSelectAccount}
                className="shadow-[0_4px_24px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_32px_rgba(180,150,120,0.09)] transition-shadow"
              />
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* STAGE 2: HOW IT WORKS (Scroll Storytelling with Progressive Connector)    */}
        {/* ========================================================================= */}
        <section aria-label="How it works" className="gsap-workflow-section space-y-5 relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-1 gap-2">
            <div>
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-[#EA8500] bg-[#FFF4E6] px-3 py-1 rounded-full border border-[#FCD5B5]">
                Stage 2 · Forensic Audit Workflow
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-[#1C1917] font-display mt-2">
                How investigation works
              </h2>
            </div>
            <span className="text-xs text-[#A8A29E] font-semibold">
              Sequential 3-step verification model
            </span>
          </div>

          {/* Progressive Connecting Line between steps on desktop */}
          <div className="hidden md:block w-full h-1 bg-[#EAE3D6] rounded-full overflow-hidden my-2">
            <div className="gsap-step-connector h-full bg-gradient-to-r from-[#EA8500] via-[#C05621] to-[#22C55E] rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
            {/* Step 1 */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-step-card bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-7 space-y-4 shadow-[0_4px_20px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_28px_rgba(180,150,120,0.1)] hover:border-[#EA8500]/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#EBF5FF] text-[#1E40AF] border border-[#BFDBFE] flex items-center justify-center font-black text-sm shadow-xs">
                    01
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#A8A29E] uppercase tracking-wider">
                    Step 1
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#1C1917]">1. Find an account</h3>
                <p className="text-xs sm:text-sm text-[#78716C] leading-relaxed mt-2 font-normal">
                  Enter an account ID or pick one of the demo examples to see its profile.
                </p>
              </div>

              {/* Sub-panel visual preview tile */}
              <div className="p-3 bg-[#FAF7F2] border border-[#EBE4D8] rounded-2xl flex items-center gap-2 text-xs text-[#78716C]">
                <Search className="w-3.5 h-3.5 text-[#EA8500]" />
                <span className="font-mono font-semibold text-[#1C1917]">Search Account ID</span>
                <span className="text-[#A8A29E]">· Instant Lookup</span>
              </div>
            </motion.div>

            {/* Step 2 */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-step-card bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-7 space-y-4 shadow-[0_4px_20px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_28px_rgba(180,150,120,0.1)] hover:border-[#EA8500]/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#F4EFFE] text-[#6B46C1] border border-[#E4D7FC] flex items-center justify-center font-black text-sm shadow-xs">
                    02
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#A8A29E] uppercase tracking-wider">
                    Step 2
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#1C1917]">2. Review its activity</h3>
                <p className="text-xs sm:text-sm text-[#78716C] leading-relaxed mt-2 font-normal">
                  See past transfers, unusual spending patterns, and what the AI noticed.
                </p>
              </div>

              {/* Sub-panel visual preview tile */}
              <div className="p-3 bg-[#FAF7F2] border border-[#EBE4D8] rounded-2xl flex items-center gap-2 text-xs text-[#78716C]">
                <Activity className="w-3.5 h-3.5 text-[#6B46C1]" />
                <span className="font-semibold text-[#1C1917]">56 transfers</span>
                <span className="text-[#A8A29E]">· Anomaly checks</span>
              </div>
            </motion.div>

            {/* Step 3 */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-step-card bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-7 space-y-4 shadow-[0_4px_20px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_28px_rgba(180,150,120,0.1)] hover:border-[#EA8500]/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#FFF4E6] text-[#EA8500] border border-[#FCD5B5] flex items-center justify-center font-black text-sm shadow-xs">
                    03
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#A8A29E] uppercase tracking-wider">
                    Step 3
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#1C1917]">3. Follow the money</h3>
                <p className="text-xs sm:text-sm text-[#78716C] leading-relaxed mt-2 font-normal">
                  Explore connected accounts and trace where outgoing transfers went next.
                </p>
              </div>

              {/* Sub-panel visual preview tile */}
              <div className="p-3 bg-[#FAF7F2] border border-[#EBE4D8] rounded-2xl flex items-center gap-2 text-xs text-[#78716C]">
                <GitFork className="w-3.5 h-3.5 text-[#EA8500]" />
                <span className="font-semibold text-[#1C1917]">Multi-hop traversal</span>
                <span className="text-[#A8A29E]">· Stolen fund path</span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* STAGE 3: TRY AN EXAMPLE ACCOUNT (Framer Motion Filter & 2-Col Grid)       */}
        {/* ========================================================================= */}
        <section aria-labelledby="examples-heading" className="gsap-examples-section space-y-6">
          <div className="gsap-examples-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EAE3D6] pb-5">
            <div>
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-[#78716C] bg-[#FAF7F2] px-3 py-1 rounded-full border border-[#EAE3D6]">
                Stage 3 · Curated Case Scenarios
              </span>
              <h2 id="examples-heading" className="text-xl sm:text-2xl font-black text-[#1C1917] font-display mt-2">
                Try an example account
              </h2>
              <p className="text-xs sm:text-sm text-[#78716C] mt-1 font-normal">
                Curated Synthetic Ledger Investigation Cases to explore how the system works
              </p>
            </div>

            {/* Framer Motion Animated Filter Pills */}
            <div className="flex items-center gap-1.5 p-1 bg-[#FFFFFF] border border-[#EAE3D6] rounded-2xl shadow-xs text-xs flex-wrap">
              <span className="text-[#A8A29E] text-xs px-2 hidden sm:inline font-semibold">Filter:</span>
              {(['all', 'victim', 'mule', 'counterparty', 'baseline'] as const).map((filter) => {
                const label =
                  filter === 'all'
                    ? 'All (4)'
                    : filter === 'victim'
                    ? 'Victim'
                    : filter === 'mule'
                    ? 'Mule'
                    : filter === 'counterparty'
                    ? 'Connected'
                    : 'Normal';

                const isSelected = selectedFilter === filter;

                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setSelectedFilter(filter)}
                    className="relative h-8 px-3.5 rounded-xl text-xs font-bold transition-colors cursor-pointer inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA8500]"
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeFilterPill"
                        className="absolute inset-0 bg-[#EA8500] rounded-xl shadow-[0_2px_8px_rgba(234,133,0,0.3)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span
                      className={`relative z-10 transition-colors ${
                        isSelected ? 'text-white' : 'text-[#78716C] hover:text-[#1C1917]'
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2-Column Responsive Cards Grid with Framer Motion Layout Animation */}
          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-7">
            <AnimatePresence mode="popLayout">
              {filteredCases.map((acc) => (
                <motion.div
                  key={acc.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -10 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  whileHover={{ y: -4 }}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectAccount(acc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectAccount(acc.id);
                    }
                  }}
                  className="bg-[#FFFFFF] border border-[#EAE3D6] hover:border-[#EA8500]/60 rounded-3xl p-7 sm:p-8 shadow-[0_4px_24px_rgba(180,150,120,0.06)] hover:shadow-[0_12px_36px_rgba(180,150,120,0.12)] cursor-pointer transition-all duration-300 flex flex-col justify-between space-y-6 group focus-visible:ring-2 focus-visible:ring-[#EA8500] focus-visible:outline-none relative"
                >
                  <div className="space-y-4">
                    {/* Header: ID, Name, Pastel Tag */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#1C1917] group-hover:text-[#EA8500] transition-colors">
                            {acc.id}
                          </span>
                          <span className="text-[11px] text-[#A8A29E] font-medium">· Synthetic Scenario</span>
                        </div>
                        <h3 className="text-xl font-black text-[#1C1917] mt-1 font-display tracking-tight">
                          {acc.name}
                        </h3>
                      </div>

                      <motion.span
                        whileHover={{ scale: 1.04 }}
                        className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 shrink-0 ${acc.tagColor}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${acc.badgeDot}`}></span>
                        <span>{acc.roleTag}</span>
                      </motion.span>
                    </div>

                    {/* Summary Description */}
                    <p className="text-xs sm:text-sm text-[#57534E] leading-relaxed font-normal">
                      {acc.summary}
                    </p>

                    {/* Activity Stats Panel */}
                    <div className="p-4 sm:p-5 bg-[#FAF7F2] border border-[#EBE4D8] rounded-2xl space-y-2.5 text-xs">
                      <div className="flex items-center justify-between text-[#78716C]">
                        <span className="font-medium">Activity volume:</span>
                        <span className="font-bold text-[#1C1917] font-mono">{acc.activityCount}</span>
                      </div>
                      <div className="flex items-center justify-between text-[#78716C]">
                        <span className="font-medium">What happened:</span>
                        <span className="font-semibold text-[#1C1917]">{acc.patternLabel}</span>
                      </div>
                      <div className="flex items-center justify-between text-[#78716C] pt-2.5 border-t border-[#EAE3D6]">
                        <span className="font-medium">Key takeaway:</span>
                        <span className="font-semibold text-[#1C1917]">{acc.findingNote}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Bottom: Secondary Action Button */}
                  <div className="pt-4 border-t border-[#F2ECE2] flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[#A8A29E] font-semibold">
                      Synthetic Test Scenario
                    </span>
                    <motion.span
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-[#EA8500] bg-[#FFF4E6] border border-[#FCD5B5] group-hover:bg-[#EA8500] group-hover:text-white transition-all shadow-xs"
                    >
                      <span>View account</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </motion.span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          {/* Simple Ground Truth Disclaimer */}
          <div className="p-5 bg-[#FFFFFF] border border-[#EAE3D6] rounded-2xl text-xs text-[#57534E] flex items-start gap-3.5 shadow-xs">
            <Info className="w-4 h-4 text-[#EA8500] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-[#1C1917] font-bold">Ground-Truth Reference Notice:</strong> All accounts, names, and transactions shown above are synthetic simulations created for demonstration and testing. No real customer data or real-world banking records are used.
            </p>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* STAGE 4: SYSTEM CAPABILITIES & ENGINE STATUS                             */}
        {/* ========================================================================= */}
        <section aria-labelledby="status-heading" className="space-y-4 pt-2">
          <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-3">
            <div>
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-[#78716C] bg-[#FAF7F2] px-3 py-1 rounded-full border border-[#EAE3D6]">
                System Infrastructure · Telemetry
              </span>
              <h2 id="status-heading" className="text-xl sm:text-2xl font-black text-[#1C1917] font-display mt-2">
                System capabilities & engine status
              </h2>
            </div>
            <span className="text-xs text-[#A8A29E] font-semibold">Real-time status</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
            {/* Card 1: Money Flow Chain */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-7 space-y-3.5 shadow-[0_4px_20px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_28px_rgba(180,150,120,0.1)] transition-all"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] shadow-xs">
                <GitFork className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1C1917]">Follow the money chain</h3>
              <p className="text-xs sm:text-sm text-[#78716C] leading-relaxed font-normal">
                See how funds move between accounts step-by-step, helping you trace stolen money without losing track of the transfer path.
              </p>
            </motion.div>

            {/* Card 2: Double-Check Every Alert */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-7 space-y-3.5 shadow-[0_4px_20px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_28px_rgba(180,150,120,0.1)] transition-all"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#EBF5FF] border border-[#BFDBFE] flex items-center justify-center text-[#2563EB] shadow-xs">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1C1917]">Double-check every alert</h3>
              <p className="text-xs sm:text-sm text-[#78716C] leading-relaxed font-normal">
                Combines standard banking rules with AI pattern detection so you can spot both obvious rule breaks and subtle fraud signals.
              </p>
            </motion.div>

            {/* Card 3: AI Engine Status */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="bg-[#FFFFFF] border border-[#EAE3D6] rounded-3xl p-7 space-y-3.5 shadow-[0_4px_20px_rgba(180,150,120,0.06)] hover:shadow-[0_8px_28px_rgba(180,150,120,0.1)] transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#78716C] shadow-xs">
                    <Cpu className="w-5 h-5" />
                  </div>
                  {modelStatus?.inference_ready ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#166534] bg-[#EAF7EE] px-3.5 py-1 rounded-full border border-[#BBF7D0]">
                      <span className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse"></span>
                      <span>ONLINE</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 px-3.5 py-1 rounded-full border border-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>DEGRADED</span>
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold text-[#1C1917]">Model Engine Status</h3>
                <p className="text-xs sm:text-sm text-[#78716C] leading-relaxed mt-1 font-normal">
                  Ready to analyze accounts and check for suspicious transfer patterns.
                </p>
              </div>

              <div className="text-xs text-[#78716C] pt-3.5 border-t border-[#F2ECE2] space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-[#A8A29E]">Account ML Model:</span>
                  <span className="font-bold text-[#1C1917]">
                    {modelStatus?.account_model?.version || 'v2-account-1.0.0'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A8A29E]">Features Tracked:</span>
                  <span className="font-bold text-[#1C1917]">
                    {modelStatus?.account_model?.features_count ?? 26} dimensions
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <V2Footer />
    </div>
  );
};
