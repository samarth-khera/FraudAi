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
    tagColor: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
    badgeDot: 'bg-[#DC2626]',
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
    tagColor: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
    badgeDot: 'bg-[#DC2626]',
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
    tagColor: 'bg-[#F0EAFE] text-[#6D28D9] border-[#DDD6FE]',
    badgeDot: 'bg-[#6D28D9]',
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
    tagColor: 'bg-[#E2F4ED] text-[#187C70] border-[#C8E7DC]',
    badgeDot: 'bg-[#187C70]',
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

        // Stage 3: ScrollTrigger for Example Accounts Header
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

        // Stage 4: ScrollTrigger for Capabilities
        gsap.fromTo(
          '.gsap-cap-card',
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.1,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-cap-section',
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
      className="min-h-screen flex flex-col bg-[#F5F7F6] text-[#18221F] font-sans selection:bg-[#E2F4ED] selection:text-[#187C70]"
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
              <div className="gsap-hero-badge inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E2F4ED] border border-[#C8E7DC] text-[#187C70] text-xs font-semibold shadow-2xs">
                <Shield className="w-3.5 h-3.5 text-[#187C70]" />
                <span>Stage 1 · Account Search & Money Flow</span>
              </div>

              {/* Masked Headline for Upward Reveal */}
              <div className="overflow-hidden py-1">
                <h1
                  id="search-heading"
                  className="gsap-hero-title text-3xl sm:text-4xl lg:text-[42px] font-black tracking-tight text-[#18221F] font-display leading-[1.15]"
                >
                  Look up an account
                </h1>
              </div>

              {/* Plain English Subtitle */}
              <p className="gsap-hero-desc text-[#66736D] text-sm sm:text-base leading-relaxed max-w-xl font-normal">
                Enter a demo account ID to see its transactions, connected accounts, unusual activity, and the AI's assessment.
              </p>

              {/* Search Card Console */}
              <div className="gsap-search-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-6 sm:p-8 shadow-[0_4px_20px_-2px_rgba(24,124,112,0.06),0_2px_6px_-1px_rgba(0,0,0,0.03)] text-left relative overflow-hidden">
                {/* Top Bar inside Card */}
                <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[#E1E7E3] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#187C70] animate-pulse"></span>
                    <span className="font-mono font-bold tracking-wider uppercase text-[#66736D] text-[11px]">
                      Account Repository Lookup
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-[#66736D] bg-[#F0F4F2] border border-[#E1E7E3] px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#187C70]"></span>
                    <span>Core Ledger: Live</span>
                  </div>
                </div>

                <form onSubmit={handleSearch} className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div
                      className={`relative flex-1 flex items-center rounded-2xl transition-all ${
                        isInputFocused
                          ? 'ring-4 ring-[#187C70]/15 border-[#187C70] bg-[#FFFFFF]'
                          : 'border-[#E1E7E3] bg-[#F0F4F2]'
                      } border`}
                    >
                      <Search
                        className={`w-5 h-5 absolute left-4 pointer-events-none transition-colors ${
                          isInputFocused ? 'text-[#187C70]' : 'text-[#8E9B95]'
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
                        className="w-full h-14 bg-transparent rounded-2xl pl-12 pr-12 text-sm sm:text-base text-[#18221F] placeholder:text-[#8E9B95] focus:outline-none font-mono transition-all"
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
                            className="absolute right-4 p-1 text-[#66736D] hover:text-[#18221F] transition-colors cursor-pointer rounded-lg hover:bg-[#E1E7E3]"
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
                      className="group h-14 px-8 rounded-2xl bg-[#187C70] hover:bg-[#12675D] text-[#FFFFFF] font-bold text-sm tracking-wide shadow-[0_4px_16px_rgba(24,124,112,0.25)] hover:shadow-[0_6px_20px_rgba(24,124,112,0.35)] flex items-center justify-center gap-2.5 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#187C70] focus-visible:ring-offset-2 transition-all"
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
                        <p className="text-xs text-[#DC2626] flex items-center gap-1.5 pt-1 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{searchError}</span>
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Guidance Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#66736D] pt-3 border-t border-[#E1E7E3]">
                    <span className="flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-[#187C70] shrink-0" />
                      <span>Tip: Type an account ID like ACC-000001, or just 1.</span>
                    </span>
                    <span className="text-[#8E9B95] text-[11px] font-semibold">
                      Instant transaction review & AI checks
                    </span>
                  </div>
                </form>

                {/* Quick Demo Shortcuts */}
                <div className="mt-4 pt-3.5 border-t border-[#E1E7E3] space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-[#66736D] text-xs">Quick examples:</span>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000001')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#FEE2E2] hover:bg-[#FECACA] text-[#DC2626] border border-[#FECACA] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Demo: Scam victim account"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]"></span>
                      <span>ACC-000001 (Victim)</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000002')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#FEE2E2] hover:bg-[#FECACA] text-[#DC2626] border border-[#FECACA] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Demo: Pass-through money mule"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]"></span>
                      <span>ACC-000002 (Mule)</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000003')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#F0EAFE] hover:bg-[#E9D5FF] text-[#6D28D9] border border-[#DDD6FE] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Demo: Connected downstream recipient"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#6D28D9]"></span>
                      <span>ACC-000003 (Hop 2)</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectAccount('ACC-000010')}
                      className="gsap-shortcut-chip h-7 sm:h-8 px-3 rounded-full bg-[#E2F4ED] hover:bg-[#C8E7DC] text-[#187C70] border border-[#C8E7DC] font-mono text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Demo: Normal everyday customer"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#187C70]"></span>
                      <span>ACC-000010 (Normal)</span>
                    </motion.button>
                  </div>

                  {/* Recent Searches */}
                  {recentSearches.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#66736D] pt-1">
                      <div className="flex items-center gap-1.5 text-[#8E9B95] font-semibold">
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
                          className="h-6 px-3 rounded-full bg-[#F0F4F2] hover:bg-[#E1E7E3] text-[#18221F] border border-[#E1E7E3] font-mono text-xs font-semibold transition-all cursor-pointer shadow-2xs"
                        >
                          {rec}
                        </motion.button>
                      ))}
                      <button
                        type="button"
                        onClick={clearRecentSearches}
                        className="p-1 text-[#8E9B95] hover:text-[#18221F] transition-colors ml-1 cursor-pointer rounded-md hover:bg-[#F0F4F2]"
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
                className="shadow-[0_4px_20px_-2px_rgba(24,124,112,0.06),0_2px_6px_-1px_rgba(0,0,0,0.03)]"
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
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-[#187C70] bg-[#E2F4ED] px-3 py-1 rounded-full border border-[#C8E7DC]">
                Stage 2 · How Investigation Works
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-[#18221F] font-display mt-2">
                How investigation works
              </h2>
            </div>
            <span className="text-xs text-[#66736D] font-semibold">
              Sequential 3-step verification model
            </span>
          </div>

          {/* Progressive Connecting Line between steps on desktop */}
          <div className="hidden md:block w-full h-1 bg-[#E1E7E3] rounded-full overflow-hidden my-2">
            <div className="gsap-step-connector h-full bg-gradient-to-r from-[#187C70] via-[#2DD4BF] to-[#6D28D9] rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
            {/* Step 1 */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-step-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-7 space-y-4 shadow-[0_2px_8px_rgba(24,34,31,0.03)] hover:border-[#187C70]/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#E2F4ED] text-[#187C70] border border-[#C8E7DC] flex items-center justify-center font-bold text-sm shadow-2xs">
                    01
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#8E9B95] uppercase tracking-wider">
                    Step 1
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#18221F]">1. Find an account</h3>
                <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed mt-2 font-normal">
                  Enter an account ID or pick one of the demo examples to see its profile.
                </p>
              </div>

              {/* Sub-panel visual preview tile */}
              <div className="p-3 bg-[#F0F4F2] border border-[#E1E7E3] rounded-2xl flex items-center gap-2 text-xs text-[#66736D]">
                <Search className="w-3.5 h-3.5 text-[#187C70]" />
                <span className="font-mono font-semibold text-[#18221F]">Search Account ID</span>
                <span className="text-[#8E9B95]">· Instant Lookup</span>
              </div>
            </motion.div>

            {/* Step 2 */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-step-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-7 space-y-4 shadow-[0_2px_8px_rgba(24,34,31,0.03)] hover:border-[#6D28D9]/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#F0EAFE] text-[#6D28D9] border border-[#DDD6FE] flex items-center justify-center font-bold text-sm shadow-2xs">
                    02
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#8E9B95] uppercase tracking-wider">
                    Step 2
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#18221F]">2. Review its activity</h3>
                <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed mt-2 font-normal">
                  See past transfers, unusual spending patterns, and what the AI noticed.
                </p>
              </div>

              {/* Sub-panel visual preview tile */}
              <div className="p-3 bg-[#F0F4F2] border border-[#E1E7E3] rounded-2xl flex items-center gap-2 text-xs text-[#66736D]">
                <Activity className="w-3.5 h-3.5 text-[#6D28D9]" />
                <span className="font-semibold text-[#18221F]">56 transfers</span>
                <span className="text-[#8E9B95]">· Anomaly checks</span>
              </div>
            </motion.div>

            {/* Step 3 */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-step-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-7 space-y-4 shadow-[0_2px_8px_rgba(24,34,31,0.03)] hover:border-[#187C70]/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#E7F0FC] text-[#1D4ED8] border border-[#CFE0F8] flex items-center justify-center font-bold text-sm shadow-2xs">
                    03
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#8E9B95] uppercase tracking-wider">
                    Step 3
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#18221F]">3. Follow the money</h3>
                <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed mt-2 font-normal">
                  Explore connected accounts and trace where outgoing transfers went next.
                </p>
              </div>

              {/* Sub-panel visual preview tile */}
              <div className="p-3 bg-[#F0F4F2] border border-[#E1E7E3] rounded-2xl flex items-center gap-2 text-xs text-[#66736D]">
                <GitFork className="w-3.5 h-3.5 text-[#187C70]" />
                <span className="font-semibold text-[#18221F]">Multi-hop traversal</span>
                <span className="text-[#8E9B95]">· Stolen fund path</span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* STAGE 3: TRY AN EXAMPLE ACCOUNT (Framer Motion Filter & 2-Col Grid)       */}
        {/* ========================================================================= */}
        <section aria-labelledby="examples-heading" className="gsap-examples-section space-y-6">
          <div className="gsap-examples-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E1E7E3] pb-5">
            <div>
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-[#66736D] bg-[#F0F4F2] px-3 py-1 rounded-full border border-[#E1E7E3]">
                Stage 3 · Curated Case Scenarios
              </span>
              <h2 id="examples-heading" className="text-xl sm:text-2xl font-black text-[#18221F] font-display mt-2">
                Try an example account
              </h2>
              <p className="text-xs sm:text-sm text-[#66736D] mt-1 font-normal">
                Curated Synthetic Ledger Investigation Cases to explore how the system works
              </p>
            </div>

            {/* Framer Motion Animated Filter Pills */}
            <div className="flex items-center gap-1.5 p-1 bg-[#F0F4F2] border border-[#E1E7E3] rounded-2xl shadow-2xs text-xs flex-wrap">
              <span className="text-[#8E9B95] text-xs px-2 hidden sm:inline font-semibold">Filter:</span>
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
                    className="relative h-8 px-3.5 rounded-xl text-xs font-bold transition-colors cursor-pointer inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#187C70]"
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeFilterPill"
                        className="absolute inset-0 bg-[#FFFFFF] rounded-xl shadow-[0_2px_8px_rgba(24,34,31,0.08)] border border-[#E1E7E3]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span
                      className={`relative z-10 transition-colors ${
                        isSelected ? 'text-[#187C70] font-black' : 'text-[#66736D] hover:text-[#18221F]'
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
                  className="bg-[#FFFFFF] border border-[#E1E7E3] hover:border-[#187C70]/50 rounded-3xl p-7 sm:p-8 shadow-[0_2px_12px_rgba(24,34,31,0.04)] hover:shadow-[0_8px_28px_rgba(24,124,112,0.08)] cursor-pointer transition-all duration-300 flex flex-col justify-between space-y-6 group focus-visible:ring-2 focus-visible:ring-[#187C70] focus-visible:outline-none relative"
                >
                  <div className="space-y-4">
                    {/* Header: ID, Name, Tag */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#18221F] group-hover:text-[#187C70] transition-colors">
                            {acc.id}
                          </span>
                          <span className="text-[11px] text-[#8E9B95] font-medium">· Synthetic Scenario</span>
                        </div>
                        <h3 className="text-xl font-black text-[#18221F] mt-1 font-display tracking-tight">
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
                    <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed font-normal">
                      {acc.summary}
                    </p>

                    {/* Activity Stats Panel */}
                    <div className="p-4 sm:p-5 bg-[#F0F4F2] border border-[#E1E7E3] rounded-2xl space-y-2.5 text-xs">
                      <div className="flex items-center justify-between text-[#66736D]">
                        <span className="font-medium">Activity volume:</span>
                        <span className="font-bold text-[#18221F] font-mono">{acc.activityCount}</span>
                      </div>
                      <div className="flex items-center justify-between text-[#66736D]">
                        <span className="font-medium">What happened:</span>
                        <span className="font-semibold text-[#18221F]">{acc.patternLabel}</span>
                      </div>
                      <div className="flex items-center justify-between text-[#66736D] pt-2.5 border-t border-[#E1E7E3]">
                        <span className="font-medium">Key takeaway:</span>
                        <span className="font-semibold text-[#18221F]">{acc.findingNote}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Bottom: Secondary Action Button */}
                  <div className="pt-4 border-t border-[#E1E7E3] flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[#8E9B95] font-semibold">
                      Synthetic Test Scenario
                    </span>
                    <motion.span
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-[#187C70] bg-[#E2F4ED] border border-[#C8E7DC] group-hover:bg-[#187C70] group-hover:text-[#FFFFFF] transition-all shadow-2xs"
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
          <div className="p-5 bg-[#FFFFFF] border border-[#E1E7E3] rounded-2xl text-xs text-[#66736D] flex items-start gap-3.5 shadow-2xs">
            <Info className="w-4 h-4 text-[#187C70] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-[#18221F] font-bold">Ground-Truth Reference Notice:</strong> All accounts, names, and transactions shown above are synthetic simulations created for demonstration and testing. No real customer data or real-world banking records are used.
            </p>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* STAGE 4: SYSTEM CAPABILITIES & ENGINE STATUS                             */}
        {/* ========================================================================= */}
        <section aria-labelledby="status-heading" className="gsap-cap-section space-y-4 pt-2">
          <div className="flex items-center justify-between border-b border-[#E1E7E3] pb-3">
            <div>
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-[#66736D] bg-[#F0F4F2] px-3 py-1 rounded-full border border-[#E1E7E3]">
                System Infrastructure · Telemetry
              </span>
              <h2 id="status-heading" className="text-xl sm:text-2xl font-black text-[#18221F] font-display mt-2">
                System capabilities & engine status
              </h2>
            </div>
            <span className="text-xs text-[#8E9B95] font-semibold">Real-time status</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
            {/* Card 1: Money Flow Chain */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-cap-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-7 space-y-3.5 shadow-[0_2px_8px_rgba(24,34,31,0.03)] hover:border-[#187C70]/40 transition-all"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#E2F4ED] border border-[#C8E7DC] flex items-center justify-center text-[#187C70] shadow-2xs">
                <GitFork className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#18221F]">Follow the money chain</h3>
              <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed font-normal">
                See how funds move between accounts step-by-step, helping you trace stolen money without losing track of the transfer path.
              </p>
            </motion.div>

            {/* Card 2: Double-Check Every Alert */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-cap-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-7 space-y-3.5 shadow-[0_2px_8px_rgba(24,34,31,0.03)] hover:border-[#6D28D9]/40 transition-all"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#F0EAFE] border border-[#DDD6FE] flex items-center justify-center text-[#6D28D9] shadow-2xs">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#18221F]">Double-check every alert</h3>
              <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed font-normal">
                Combines standard banking rules with AI pattern detection so you can spot both obvious rule breaks and subtle fraud signals.
              </p>
            </motion.div>

            {/* Card 3: AI Engine Status */}
            <motion.div
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="gsap-cap-card bg-[#FFFFFF] border border-[#E1E7E3] rounded-3xl p-7 space-y-3.5 shadow-[0_2px_8px_rgba(24,34,31,0.03)] hover:border-[#187C70]/40 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#E7F0FC] border border-[#CFE0F8] flex items-center justify-center text-[#1D4ED8] shadow-2xs">
                    <Cpu className="w-5 h-5" />
                  </div>
                  {modelStatus?.inference_ready ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#187C70] bg-[#E2F4ED] px-3.5 py-1 rounded-full border border-[#C8E7DC]">
                      <span className="w-2 h-2 rounded-full bg-[#187C70] animate-pulse"></span>
                      <span>ONLINE</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#DC2626] bg-[#FEE2E2] px-3.5 py-1 rounded-full border border-[#FECACA]">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>DEGRADED</span>
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold text-[#18221F]">Model Engine Status</h3>
                <p className="text-xs sm:text-sm text-[#66736D] leading-relaxed mt-1 font-normal">
                  Ready to analyze accounts and check for suspicious transfer patterns.
                </p>
              </div>

              <div className="text-xs text-[#66736D] pt-3.5 border-t border-[#E1E7E3] space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-[#8E9B95]">Account ML Model:</span>
                  <span className="font-bold text-[#18221F]">
                    {modelStatus?.account_model?.version || 'v2-account-1.0.0'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8E9B95]">Features Tracked:</span>
                  <span className="font-bold text-[#18221F]">
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
