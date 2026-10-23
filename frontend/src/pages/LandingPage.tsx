import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import {
  Shield,
  ArrowRight,
  Search,
  Activity,
  GitBranch,
  Cpu,
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  Scale,
  ArrowUpRight,
  Lock,
  Layers,
  Sparkles,
  UserCheck,
  ShieldAlert,
  BarChart3,
  HelpCircle,
  Database,
  Info,
  LayoutGrid,
} from 'lucide-react';
import { UnifiedHeader } from '../components/layout/UnifiedHeader';
import { V2Footer } from '../components/v2/V2Footer';
import { V2DemoTreeVisual } from '../components/v2/V2DemoTreeVisual';

export const normalizeAccountId = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) {
    return `ACC-${trimmed.padStart(6, '0')}`;
  }
  if (/^acc-\d+$/i.test(trimmed)) {
    const digits = trimmed.replace(/^acc-/i, '');
    return `ACC-${digits.padStart(6, '0')}`;
  }
  return trimmed.toUpperCase();
};

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const [searchInput, setSearchInput] = useState('');

  // Handle hero search submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      const normalized = normalizeAccountId(searchInput);
      navigate(`/accounts/${normalized}`);
    } else {
      navigate('/workspace');
    }
  };

  // GSAP subtle hero entrance animation with reduced-motion respect
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !heroRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from('.hero-enter', {
        opacity: 0,
        y: 16,
        duration: 0.65,
        stagger: 0.08,
        ease: 'power2.out',
      });
      gsap.from('.hero-tree-enter', {
        opacity: 0,
        scale: 0.98,
        duration: 0.8,
        delay: 0.15,
        ease: 'power2.out',
      });
    }, heroRef);

    return () => ctx.revert();
  }, []);

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#1A1714] flex flex-col font-sans selection:bg-[#EA8500]/20 selection:text-[#1A1714]">
      {/* 1. Unified Platform Navigation Shell */}
      <UnifiedHeader />

      <main className="flex-1">
        {/* 2. Hero Section: Polished Horizontal Desktop Layout */}
        <section
          ref={heroRef}
          className="relative pt-6 pb-14 sm:pt-10 sm:pb-18 border-b border-[#EAE3D6] overflow-hidden"
        >
          {/* Subtle warm ambient backdrop aura */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1360px] h-[450px] bg-gradient-to-b from-[#EA8500]/6 via-[#FAF7F2] to-transparent pointer-events-none rounded-full blur-3xl -z-10" />

          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 xl:gap-10 items-start">
              {/* Left Column: Headline, Description & Interactive Search Box (6 cols) */}
              <div className="lg:col-span-6 space-y-5">
                {/* Stage 1 Pill & Status Indicator */}
                <div className="hero-enter inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#EAE3D6] text-[11px] font-mono text-[#6B655B] shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-[#EA8500] animate-pulse" />
                  <span className="font-semibold text-[#1A1714]">Financial Crime Investigation Platform</span>
                  <span className="text-[#C5BDB0]">·</span>
                  <span className="text-[#166534] font-bold">Demo Ledger: Live (10k Accounts)</span>
                </div>

                {/* Main Headline (Phase 1 Approved Messaging) */}
                <div className="hero-enter space-y-2">
                  <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#1A1714] leading-[1.12]">
                    Follow the money.{' '}
                    <span className="text-[#EA8500] block mt-1">
                      Understand the risk. Investigate with evidence.
                    </span>
                  </h1>
                </div>

                {/* Supporting Text (Phase 1 Approved Plain-English Messaging) */}
                <p className="hero-enter text-sm sm:text-base text-[#6B655B] leading-relaxed max-w-xl">
                  FraudShield AI helps investigators trace suspicious money movement across connected accounts, understand AI-generated risk signals, review available evidence, and record investigation decisions.
                </p>

                {/* Prominent Action CTAs (Phase 1 Primary & Secondary) */}
                <div className="hero-enter flex flex-wrap items-center gap-3 pt-1">
                  <Link
                    to="/guided-investigation"
                    className="btn-primary text-sm py-3 px-5 sm:px-6 rounded-xl font-bold flex items-center gap-2 shadow-md hover:shadow-lg"
                  >
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>Start Guided Investigation</span>
                    <ArrowRight className="w-4 h-4 text-white" />
                  </Link>

                  <Link
                    to="/workspace"
                    className="btn-secondary text-sm py-3 px-5 rounded-xl font-semibold flex items-center gap-2"
                  >
                    <LayoutGrid className="w-4 h-4 text-[#6B655B]" />
                    <span>Explore the Workspace</span>
                  </Link>
                </div>

                {/* Demonstration Data & Forensic Transparency Indicator */}
                <div className="hero-enter p-3 rounded-xl bg-white border border-[#EAE3D6] text-xs text-[#6B655B] flex items-start gap-2.5 shadow-2xs">
                  <Scale className="w-4 h-4 text-[#EA8500] shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    <strong className="text-[#1A1714] font-semibold">Demonstration Mode:</strong> Sample investigation uses synthetic financial records. AI risk scores provide advisory decision support; mathematical anomalies are not legal proof of criminal activity.
                  </p>
                </div>

                {/* Account Repository Lookup Card */}
                <div className="hero-enter bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#8C857B]">
                    <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#1A1714]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500]" />
                      Direct Account Search
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#FAF7F2] border border-[#EAE3D6] text-[10px]">
                      Search 10,000 Accounts
                    </span>
                  </div>

                  {/* Search Input Bar */}
                  <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-[#8C857B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Enter synthetic account ID, e.g. ACC-000001"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-mono text-[#1A1714] placeholder-[#8C857B] focus:outline-none focus:border-[#EA8500] focus:ring-1 focus:ring-[#EA8500] transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn-primary py-2 px-4 rounded-xl text-xs font-bold"
                    >
                      <span>Search Account</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </form>

                  {/* Quick Examples Pills */}
                  <div className="pt-2 border-t border-[#EAE3D6]/80 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#8C857B] mr-1">
                      Sample entities:
                    </span>
                    <Link
                      to="/accounts/ACC-000001"
                      className="px-2 py-0.5 rounded-md bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-mono text-[#1A1714] hover:border-[#EA8500] hover:text-[#EA8500] transition-colors flex items-center gap-1"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500]" />
                      <span>ACC-000001 (Victim Drain)</span>
                    </Link>
                    <Link
                      to="/accounts/ACC-000002"
                      className="px-2 py-0.5 rounded-md bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-mono text-[#1A1714] hover:border-[#EA8500] hover:text-[#EA8500] transition-colors flex items-center gap-1"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>ACC-000002 (Mule Conduit)</span>
                    </Link>
                    <Link
                      to="/cases/FS-1042"
                      className="px-2 py-0.5 rounded-md bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-mono text-[#1A1714] hover:border-[#EA8500] hover:text-[#EA8500] transition-colors flex items-center gap-1"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span>Case FS-1042 (UPI Theft)</span>
                    </Link>
                  </div>
                </div>
              </div>

              {/* Right Column: Animated Fund-Flow Tree Preview (6 cols) */}
              <div className="lg:col-span-6 hero-tree-enter">
                <V2DemoTreeVisual
                  onSelectAccount={(accId) => navigate(`/accounts/${accId}`)}
                  className="w-full shadow-lg"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. Section 2 — Explain How FraudShield Works (3 Balanced Columns) */}
        <section className="py-14 sm:py-18 bg-white border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-[#EAE3D6] pb-4">
              <div className="space-y-1">
                <span className="font-mono text-xs font-bold text-[#EA8500] uppercase tracking-wider">
                  STAGE 2 · HOW INVESTIGATION WORKS
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                  How investigation works
                </h2>
              </div>
              <span className="text-xs font-mono text-[#8C857B]">
                Sequential 3-step verification model
              </span>
            </div>

            {/* 3 Balanced Horizontally Aligned Columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              {/* Column 01: Find an account */}
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.18 } }}
                className="p-6 sm:p-7 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] hover:border-[#EA8500]/60 transition-all flex flex-col justify-between shadow-2xs group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#EA8500] bg-white border border-[#EAE3D6] px-2.5 py-1 rounded-lg">
                      01 · STEP 1
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                      <Search className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A1714]">
                    1. Find an account
                  </h3>
                  <p className="text-sm text-[#6B655B] leading-relaxed">
                    Search an account and review its available profile and transaction history.
                  </p>
                </div>
                <div className="pt-5 mt-5 border-t border-[#EAE3D6]">
                  <Link
                    to="/workspace"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors"
                  >
                    <span>Open Triage Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </motion.div>

              {/* Column 02: Review the activity */}
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.18 } }}
                className="p-6 sm:p-7 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] hover:border-[#EA8500]/60 transition-all flex flex-col justify-between shadow-2xs group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#EA8500] bg-white border border-[#EAE3D6] px-2.5 py-1 rounded-lg">
                      02 · STEP 2
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                      <Cpu className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A1714]">
                    2. Review the activity
                  </h3>
                  <p className="text-sm text-[#6B655B] leading-relaxed">
                    Run an analysis to see unusual patterns, the AI's assessment, and what influenced its score.
                  </p>
                </div>
                <div className="pt-5 mt-5 border-t border-[#EAE3D6]">
                  <Link
                    to="/accounts/ACC-000001"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors"
                  >
                    <span>Run Live Analysis Demo</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </motion.div>

              {/* Column 03: Follow the money */}
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.18 } }}
                className="p-6 sm:p-7 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] hover:border-[#EA8500]/60 transition-all flex flex-col justify-between shadow-2xs group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#EA8500] bg-white border border-[#EAE3D6] px-2.5 py-1 rounded-lg">
                      03 · STEP 3
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                      <GitBranch className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A1714]">
                    3. Follow the money
                  </h3>
                  <p className="text-sm text-[#6B655B] leading-relaxed">
                    Explore connected accounts and inspect where transfers went next.
                  </p>
                </div>
                <div className="pt-5 mt-5 border-t border-[#EAE3D6]">
                  <Link
                    to="/fund-flow"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors"
                  >
                    <span>Inspect Fund Lineage</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 4. Section 3 — Compact Capabilities Section */}
        <section className="py-14 sm:py-18 bg-[#F8F6F0] border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#EAE3D6] pb-4">
              <div className="space-y-1">
                <span className="font-mono text-xs font-bold text-[#EA8500] uppercase tracking-wider">
                  STAGE 3 · CORE PLATFORM CAPABILITIES
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                  Forensic capabilities built for financial integrity
                </h2>
              </div>
              <Link
                to="/workspace"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors"
              >
                <span>View all 10,000 accounts</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* 4 Balanced Capability Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Capability 1: Account Intelligence */}
              <Link
                to="/accounts/ACC-000001"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Account Intelligence
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Examine 360° account dossiers, customer KYC tiers, business classifications, and historical ledger transactions across UPI, IMPS, and NEFT.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>View Account 360°</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Capability 2: Explainable AI */}
              <Link
                to="/insights"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Explainable AI
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Dual-engine scoring: XGBoost pre-transaction inference decomposed into exact additive log-odds TreeSHAP contributions, benchmarked against PaySim.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>View PR-AUC & Matrix</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Capability 3: Fund-Flow Tracing */}
              <Link
                to="/fund-flow"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <GitBranch className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Fund-Flow Tracing
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Interactive multi-hop lineage graph. Bounds exposure to the origin claim to eliminate misleading volume double-counting across downstream hops.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>Explore Lineage Canvas</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Capability 4: Evidence & Human Review */}
              <Link
                to="/cases"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <FileCheck2 className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Evidence & Human Review
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Structured case files separating observed movements from evidence sufficiency. Human compliance decisions recorded in an append-only audit trail.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>Open Case Management</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>
            </div>
          </div>
        </section>

        {/* 5. Section 4 — Trust-and-Safety Section */}
        <section className="py-14 sm:py-18 bg-white border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            {/* Header */}
            <div className="max-w-2xl space-y-2">
              <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
                Trust, Safety & Fairness Protocol
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                Decision support without collateral harm
              </h2>
              <p className="text-sm text-[#6B655B] leading-relaxed">
                FraudShield is designed to empower human investigators with actionable intelligence while preventing unjust automated penalties on legitimate citizens.
              </p>
            </div>

            {/* Safeguard Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="p-5 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2.5">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  Risk scores are decision signals, not proof
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  An AI risk estimate highlights statistical anomalies against baseline distributions. It is an alert for human review, never an automated determination of guilt.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2.5">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  Connected accounts are not automatically guilty
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Receiving funds from a suspicious source does not make a merchant or vendor a fraudster. Good-faith merchants regularly sell goods to unknown customers.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2.5">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <Layers className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  Missing evidence & uncertainty must be visible
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Pending KYC verification, absent commercial invoices, and unverified bank statements are surfaced as explicit evidence gaps rather than assumed criminal evasion.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2.5">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <UserCheck className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  Human investigators make the final decision
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Automated blanket account freezing is strictly prohibited. Every compliance restriction requires human reviewer sign-off recorded in an append-only audit trail.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2.5 md:col-span-2 lg:col-span-2">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <Database className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  Synthetic demonstration environment
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  All customer names, bank accounts, and transactions on this platform are synthetically generated from the PaySim research benchmark. No real customer privacy or credit standing is ever evaluated.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Section 5 — Final Call to Action */}
        <section className="py-16 sm:py-20 bg-white">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="p-10 sm:p-12 lg:p-14 rounded-3xl bg-[#FAF7F2] border border-[#EAE3D6] text-center space-y-6 relative overflow-hidden shadow-sm">
              <div className="max-w-2xl mx-auto space-y-3">
                <span className="font-mono text-xs font-bold text-[#EA8500] uppercase tracking-wider">
                  Get Started
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#1A1714] tracking-tight">
                  Ready to start an investigation?
                </h2>
                <p className="text-sm sm:text-base text-[#6B655B] leading-relaxed">
                  Search across 10,000 synthetic demo accounts, inspect multi-hop fund flow trees, or review active forensic cases.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 pt-1">
                <Link
                  to="/workspace"
                  className="px-7 py-3.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-sm font-bold shadow-[0_4px_16px_rgba(234,133,0,0.28)] hover:shadow-[0_6px_22px_rgba(234,133,0,0.38)] transition-all inline-flex items-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <span>Start Investigation</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/cases/FS-1042"
                  className="px-6 py-3.5 rounded-xl bg-white hover:bg-[#FAF7F2] text-[#1A1714] border border-[#EAE3D6] text-sm font-semibold transition-all inline-flex items-center gap-2 cursor-pointer shadow-2xs hover:border-[#D5CDC0]"
                >
                  <FileCheck2 className="w-4 h-4 text-[#EA8500]" />
                  <span>Explore Demo Case FS-1042</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 7. Unified Platform Footer */}
      <V2Footer />
    </div>
  );
};
