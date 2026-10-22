import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  Compass,
} from 'lucide-react';
import { UnifiedHeader } from '../components/layout/UnifiedHeader';
import { V2Footer } from '../components/v2/V2Footer';
import { V2MoneyFlowVisual } from '../components/v2/V2MoneyFlowVisual';

interface ScenarioPreview {
  id: string;
  name: string;
  type: string;
  balance: string;
  kyc: string;
  mlScore: number;
  ruleScore: number;
  diagnosis: string;
  diagnosisColor: 'orange' | 'amber' | 'emerald';
  description: string;
  keyFeature: string;
  recommendedAction: string;
}

const PREVIEW_SCENARIOS: ScenarioPreview[] = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    type: 'Retail Customer',
    balance: '₹1,77,156.23',
    kyc: 'Tier-2 Verified',
    mlScore: 76.5,
    ruleScore: 25.0,
    diagnosis: 'Potential Scam Victim',
    diagnosisColor: 'orange',
    description:
      'High pre-transaction ML anomaly caused by rapid outflow velocity after prolonged dormancy. Established KYC and low rule score indicate customer was coerced rather than acting as a perpetrator.',
    keyFeature: 'Outbound velocity surge (+18.4 log-odds TreeSHAP)',
    recommendedAction: 'Freeze disputed transaction leg, DO NOT freeze customer account.',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    type: 'Pass-Through Account',
    balance: '₹24,510.80',
    kyc: 'Tier-1 Basic',
    mlScore: 84.2,
    ruleScore: 75.0,
    diagnosis: 'Probable Money Mule',
    diagnosisColor: 'amber',
    description:
      'Dual-engine agreement: both XGBoost and heuristic rules flag immediate 98% pass-through within 12 minutes of receipt. Minimal residual balance and mismatched KYC tier.',
    keyFeature: 'Zero retention ratio & rapid dispersion to 4 counterparties',
    recommendedAction: 'Place account under compliance hold and request source of funds.',
  },
  {
    id: 'ACC-002867',
    name: 'FreshMart Express',
    type: 'SME Retail Merchant',
    balance: '₹5,12,136.07',
    kyc: 'Tier-2 Verified (GSTIN Validated)',
    mlScore: 18.2,
    ruleScore: 10.0,
    diagnosis: 'Innocent Downstream Merchant',
    diagnosisColor: 'emerald',
    description:
      'Received ₹2,163.53 from a victim account via CARD_POS during ordinary business hours. Operating history spanning 3+ years with steady commercial inflows.',
    keyFeature: 'Regular POS merchant volume; zero anomalous forwarding',
    recommendedAction: 'Safeguard account against collateral freeze; isolate single disputed invoice.',
  },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState(0);
  const activeScenario = PREVIEW_SCENARIOS[selectedScenarioIndex];

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
        y: 18,
        duration: 0.7,
        stagger: 0.1,
        ease: 'power2.out',
      });
      gsap.from('.hero-visual-enter', {
        opacity: 0,
        scale: 0.98,
        duration: 0.85,
        delay: 0.2,
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
        {/* 2. Hero Section: Follow the Money. Understand the Risk. */}
        <section
          ref={heroRef}
          className="relative pt-8 pb-16 sm:pt-12 sm:pb-20 border-b border-[#EAE3D6] overflow-hidden"
        >
          {/* Subtle warm ambient backdrop aura */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[450px] bg-gradient-to-b from-[#EA8500]/6 via-[#FAF7F2] to-transparent pointer-events-none rounded-full blur-3xl -z-10" />

          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 xl:gap-14 items-center">
              {/* Left Column: Hero Content (6 cols on lg) */}
              <div className="lg:col-span-6 space-y-6">
                {/* Eyebrow / Synthetic Data Status Tag */}
                <div className="hero-enter inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#EAE3D6] text-[11px] font-mono text-[#6B655B] shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-[#EA8500] animate-pulse" />
                  <span className="font-semibold text-[#1A1714]">SYNTHETIC BENCHMARK ENVIRONMENT</span>
                  <span className="text-[#C5BDB0]">·</span>
                  <span>10,000 Accounts</span>
                </div>

                {/* Main Headline */}
                <div className="hero-enter space-y-2">
                  <h1 className="text-3xl sm:text-5xl xl:text-[54px] font-extrabold tracking-tight text-[#1A1714] leading-[1.12]">
                    Follow the money.{' '}
                    <span className="text-[#EA8500] block mt-1">
                      Understand the risk.
                    </span>
                  </h1>
                  <p className="text-xs font-mono font-medium tracking-wide uppercase text-[#8C857B] pt-1">
                    Trace the flow. Protect the innocent.
                  </p>
                </div>

                {/* Supporting Text */}
                <p className="hero-enter text-base sm:text-lg text-[#6B655B] leading-relaxed max-w-xl">
                  Investigate account activity, discover where funds moved, and understand what the AI noticed—all in one workspace.
                </p>

                {/* Primary & Secondary Call to Actions */}
                <div className="hero-enter flex flex-wrap items-center gap-3.5 pt-2">
                  <Link
                    to="/workspace"
                    className="px-6 py-3.5 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-sm font-bold tracking-tight shadow-[0_4px_16px_rgba(234,133,0,0.28)] hover:shadow-[0_6px_22px_rgba(234,133,0,0.38)] transition-all inline-flex items-center gap-2 cursor-pointer active:scale-[0.98]"
                  >
                    <span>Start Investigation</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    to="/accounts/ACC-000001"
                    className="px-5 py-3.5 rounded-xl bg-white hover:bg-[#FAF7F2] text-[#1A1714] border border-[#EAE3D6] text-sm font-semibold shadow-2xs hover:border-[#D5CDC0] transition-all inline-flex items-center gap-2 cursor-pointer active:scale-[0.98]"
                  >
                    <Sparkles className="w-4 h-4 text-[#EA8500]" />
                    <span>Explore a Demo</span>
                  </Link>
                </div>

                {/* Quick Account Triage Chips */}
                <div className="hero-enter pt-3 border-t border-[#EAE3D6]/80 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[11px] font-mono text-[#8C857B] uppercase tracking-wider">
                    Quick Demos:
                  </span>
                  <Link
                    to="/accounts/ACC-000001"
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#EAE3D6] text-[11px] font-mono text-[#1A1714] hover:border-[#EA8500] hover:text-[#EA8500] transition-colors"
                  >
                    ACC-000001 <span className="text-[#8C857B] font-sans">(Victim)</span>
                  </Link>
                  <Link
                    to="/accounts/ACC-000002"
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#EAE3D6] text-[11px] font-mono text-[#1A1714] hover:border-[#EA8500] hover:text-[#EA8500] transition-colors"
                  >
                    ACC-000002 <span className="text-[#8C857B] font-sans">(Mule)</span>
                  </Link>
                  <Link
                    to="/accounts/ACC-000007"
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#EAE3D6] text-[11px] font-mono text-[#1A1714] hover:border-[#EA8500] hover:text-[#EA8500] transition-colors"
                  >
                    ACC-000007 <span className="text-[#8C857B] font-sans">(Merchant)</span>
                  </Link>
                </div>

                {/* Safeguard & Forensic Thesis */}
                <div className="hero-enter p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs text-[#6B655B] flex items-start gap-2.5">
                  <Scale className="w-4 h-4 text-[#EA8500] flex-shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    <strong className="text-[#1A1714] font-semibold">Forensic Principle:</strong> Automated account freezing is strictly prohibited. Connected accounts are reviewed by human investigators to prevent collateral harm to good-faith businesses.
                  </p>
                </div>
              </div>

              {/* Right Column: Animated Money-Flow Preview (6 cols on lg) */}
              <div className="lg:col-span-6 hero-visual-enter">
                <div className="relative">
                  {/* Outer subtle shadow frame */}
                  <div className="absolute -inset-1.5 bg-gradient-to-r from-[#EA8500]/15 to-amber-200/20 rounded-[28px] blur-xs -z-10" />

                  {/* Reused authentic V2 Money Flow Visual */}
                  <V2MoneyFlowVisual
                    onSelectAccount={(accId) => navigate(`/accounts/${accId}`)}
                    className="w-full shadow-lg"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Section A — How It Works (3 Guided Steps) */}
        <section className="py-16 sm:py-20 bg-white border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            {/* Header */}
            <div className="max-w-2xl space-y-3">
              <span className="font-mono text-xs font-bold text-[#EA8500] bg-[#FFF4E6] border border-[#FCD5B5] px-2.5 py-1 rounded-full uppercase tracking-wider">
                Guided Workflow
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                How an investigation unfolds
              </h2>
              <p className="text-sm sm:text-base text-[#6B655B] leading-relaxed">
                Move methodically from initial account triage to root-cause behavioral explanations and multi-hop fund recovery without guesswork.
              </p>
            </div>

            {/* 3 Balanced Column Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              {/* Step 1 */}
              <motion.div
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                className="p-7 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] hover:border-[#EA8500]/60 transition-all flex flex-col justify-between shadow-2xs group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#EA8500] bg-white border border-[#EAE3D6] px-2.5 py-1 rounded-lg">
                      STEP 01
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                      <Search className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A1714]">
                    Find an account
                  </h3>
                  <p className="text-sm text-[#6B655B] leading-relaxed">
                    Search a demo account to see its profile and recorded transactions. Filter accounts by verified KYC tiers, triage states, and observed ledger balances.
                  </p>
                </div>
                <div className="pt-6 mt-6 border-t border-[#EAE3D6]">
                  <Link
                    to="/workspace"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors"
                  >
                    <span>Open Triage Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </motion.div>

              {/* Step 2 */}
              <motion.div
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                className="p-7 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] hover:border-[#EA8500]/60 transition-all flex flex-col justify-between shadow-2xs group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#EA8500] bg-white border border-[#EAE3D6] px-2.5 py-1 rounded-lg">
                      STEP 02
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                      <Cpu className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A1714]">
                    Review the activity
                  </h3>
                  <p className="text-sm text-[#6B655B] leading-relaxed">
                    Run an analysis to see unusual patterns, the AI's assessment, and what influenced its score. Inspect TreeSHAP contribution waterfalls and divergence alerts.
                  </p>
                </div>
                <div className="pt-6 mt-6 border-t border-[#EAE3D6]">
                  <Link
                    to="/accounts/ACC-000001"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors"
                  >
                    <span>Run Live Analysis Demo</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </motion.div>

              {/* Step 3 */}
              <motion.div
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                className="p-7 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] hover:border-[#EA8500]/60 transition-all flex flex-col justify-between shadow-2xs group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#EA8500] bg-white border border-[#EAE3D6] px-2.5 py-1 rounded-lg">
                      STEP 03
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                      <GitBranch className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A1714]">
                    Follow the money
                  </h3>
                  <p className="text-sm text-[#6B655B] leading-relaxed">
                    Explore connected accounts and inspect the transactions that moved funds onward. Trace multi-hop transfers to identify intermediary pass-through mules vs genuine recipients.
                  </p>
                </div>
                <div className="pt-6 mt-6 border-t border-[#EAE3D6]">
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

        {/* 4. Section B — What You Can Investigate (Core Capabilities) */}
        <section className="py-16 sm:py-20 bg-[#F8F6F0] border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="max-w-2xl space-y-3">
                <span className="font-mono text-xs font-bold text-[#EA8500] bg-[#FFF4E6] border border-[#FCD5B5] px-2.5 py-1 rounded-full uppercase tracking-wider">
                  Platform Capabilities
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                  What you can investigate
                </h2>
                <p className="text-sm sm:text-base text-[#6B655B]">
                  Every feature is backed by real PaySim benchmark telemetry, verified APIs, and human decision-support safeguards.
                </p>
              </div>
              <Link
                to="/workspace"
                className="inline-flex items-center gap-2 text-xs font-bold text-[#EA8500] hover:text-[#D27400] transition-colors self-start md:self-end"
              >
                <span>View all 10,000 accounts</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {/* 5 Capability Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Card 1: Account History */}
              <Link
                to="/accounts/ACC-000001"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Account History & Profile
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Examine lifetime balance, customer KYC verification tier, business classification, and full historical transaction ledgers across UPI, IMPS, and NEFT channels.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>Explore Account 360°</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Card 2: Fresh AI Risk Analysis */}
              <Link
                to="/accounts/ACC-000001"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <Activity className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Fresh AI Risk Analysis
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Zero stale or hardcoded predictions. Execute live on-demand inference combining pre-transaction XGBoost models with deterministic heuristic rule engines.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>Run Live Inference</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Card 3: Interactive Tracing */}
              <Link
                to="/fund-flow"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <GitBranch className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Interactive Transaction Tracing
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Visualize multi-hop fund dissemination. Our lineage-bounded traversal bounds exposure to the origin claim to eliminate misleading volume double-counting.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>Explore Cytoscape Canvas</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Card 4: Explainable TreeSHAP */}
              <Link
                to="/insights"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <BarChart3 className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Explainable Model Predictions
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Never trust an opaque black-box score. Every prediction decomposes into exact additive log-odds feature contributions with TreeSHAP waterfall charts.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>View PR-AUC & Matrix</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>

              {/* Card 5: Evidence Review & Decisions */}
              <Link
                to="/cases"
                className="p-6 rounded-2xl bg-white border border-[#EAE3D6] hover:border-[#EA8500]/60 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer md:col-span-2 lg:col-span-2"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500] group-hover:bg-[#FFF4E6] group-hover:border-[#FCD5B5] transition-colors">
                    <FileCheck2 className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714] group-hover:text-[#EA8500] transition-colors">
                    Evidence Review & Human Decisions
                  </h3>
                  <p className="text-xs text-[#6B655B] leading-relaxed">
                    Structured case dossiers separate gross ledger movements from verifiable stolen exposure. Compliance officers document cited invoices, mark evidence completeness, and record irreversible decisions in an immutable audit trail.
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#8C857B]">
                  <span>Open Case Management Dossiers</span>
                  <ArrowUpRight className="w-4 h-4 text-[#EA8500] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </Link>
            </div>
          </div>
        </section>

        {/* 5. Section C — Interactive Investigation Preview (Realistic Case Triage) */}
        <section className="py-16 sm:py-20 bg-white border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            {/* Header */}
            <div className="max-w-2xl space-y-3">
              <span className="font-mono text-xs font-bold text-[#EA8500] bg-[#FFF4E6] border border-[#FCD5B5] px-2.5 py-1 rounded-full uppercase tracking-wider">
                Interactive Triage Walkthrough
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                How selecting an account reveals the full picture
              </h2>
              <p className="text-sm sm:text-base text-[#6B655B] leading-relaxed">
                Click through three distinct synthetic account scenarios to observe how dual-engine scoring and contextual evidence separate innocent victims from pass-through mules.
              </p>
            </div>

            {/* Interactive Scenario Tabs & Detail Card */}
            <div className="space-y-6">
              {/* Tab Selector */}
              <div className="flex flex-wrap gap-2.5">
                {PREVIEW_SCENARIOS.map((sc, idx) => {
                  const isSelected = selectedScenarioIndex === idx;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setSelectedScenarioIndex(idx)}
                      className={`px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                        isSelected
                          ? 'bg-[#1A1714] text-white border-[#1A1714] shadow-xs'
                          : 'bg-[#FAF7F2] text-[#6B655B] border-[#EAE3D6] hover:bg-white hover:text-[#1A1714]'
                      }`}
                    >
                      <span className="font-mono text-[11px] opacity-80">{sc.id}</span>
                      <span>{sc.name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                          sc.diagnosisColor === 'orange'
                            ? 'bg-[#FFF4E6] text-[#EA8500]'
                            : sc.diagnosisColor === 'amber'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {sc.diagnosis}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Active Scenario Card Preview */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeScenario.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                  className="p-6 sm:p-8 rounded-3xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-6 shadow-sm"
                >
                  {/* Top Stats Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-6 border-b border-[#EAE3D6]">
                    <div>
                      <span className="text-[11px] font-mono text-[#8C857B] block uppercase tracking-wider">
                        Observed Balance
                      </span>
                      <span className="text-lg font-mono font-bold text-[#1A1714] mt-0.5 block">
                        {activeScenario.balance}
                      </span>
                      <span className="text-[11px] text-[#6B655B]">{activeScenario.type}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-mono text-[#8C857B] block uppercase tracking-wider">
                        KYC Tier
                      </span>
                      <span className="text-sm font-semibold text-[#1A1714] mt-1 block">
                        {activeScenario.kyc}
                      </span>
                      <span className="text-[11px] text-emerald-600 font-medium">Identity verified</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-mono text-[#8C857B] block uppercase tracking-wider">
                        Dual-Engine Scores
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-sm font-bold text-[#EA8500]">
                          ML: {activeScenario.mlScore}
                        </span>
                        <span className="text-[#C5BDB0]">/</span>
                        <span className="font-mono text-sm font-bold text-[#1A1714]">
                          Rule: {activeScenario.ruleScore}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#8C857B]">Pre-TX telemetry</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-mono text-[#8C857B] block uppercase tracking-wider">
                        AI Diagnosis
                      </span>
                      <span className="text-sm font-bold text-[#EA8500] mt-1 block">
                        {activeScenario.diagnosis}
                      </span>
                      <span className="text-[11px] text-[#8C857B]">Human sign-off required</span>
                    </div>
                  </div>

                  {/* Narrative & Key Findings */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    <div className="lg:col-span-8 space-y-3">
                      <h4 className="text-sm font-bold text-[#1A1714] flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[#EA8500]" />
                        <span>Behavioral Analysis & Evidence Assessment</span>
                      </h4>
                      <p className="text-sm text-[#6B655B] leading-relaxed">
                        {activeScenario.description}
                      </p>
                      <div className="pt-2 text-xs font-mono text-[#1A1714] bg-white p-3 rounded-xl border border-[#EAE3D6] flex items-center gap-2">
                        <span className="font-bold text-[#EA8500]">Top Attribution:</span>
                        <span>{activeScenario.keyFeature}</span>
                      </div>
                    </div>

                    <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-[#EAE3D6] space-y-3 self-stretch flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#8C857B] block">
                          Recommended Next Step
                        </span>
                        <p className="text-xs font-semibold text-[#1A1714] leading-snug">
                          {activeScenario.recommendedAction}
                        </p>
                      </div>

                      <Link
                        to={`/accounts/${activeScenario.id}`}
                        className="w-full py-2.5 rounded-xl bg-[#1A1714] hover:bg-[#332F2A] text-white text-xs font-bold text-center transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <span>Open Full Dossier</span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#EA8500]" />
                      </Link>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* 6. Section D — Evidence and Safety (Ethical Safeguards in Plain English) */}
        <section className="py-16 sm:py-20 bg-[#F8F6F0] border-b border-[#EAE3D6]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            {/* Header */}
            <div className="max-w-2xl space-y-3">
              <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
                Ethical AI & Compliance Safeguards
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1A1714] tracking-tight">
                Built to protect innocent account holders
              </h2>
              <p className="text-sm sm:text-base text-[#6B655B] leading-relaxed">
                Financial fraud tracking should never inflict collateral damage on good-faith merchants, gig workers, and families. Here is how FraudShield guarantees fairness:
              </p>
            </div>

            {/* 5 Safeguard Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Safeguard 1 */}
              <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] space-y-3">
                <div className="w-8 h-8 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  1. An AI score is not proof of fraud
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  A high model probability indicates behavioral anomaly against baseline transaction distributions. It is an invitation to investigate, never an automated judgment of guilt.
                </p>
              </div>

              {/* Safeguard 2 */}
              <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] space-y-3">
                <div className="w-8 h-8 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  2. Connected accounts are not automatically guilty
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Receiving funds from a tainted source does not make a downstream vendor a criminal. Fraudsters frequently purchase legitimate groceries, fuel, and services using stolen money.
                </p>
              </div>

              {/* Safeguard 3 */}
              <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] space-y-3">
                <div className="w-8 h-8 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <Layers className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  3. Missing evidence and uncertainty are visible
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Unknown KYC verification, absent invoices, and pending bank statements are explicitly flagged as evidence gaps rather than assumed to be criminal evasion.
                </p>
              </div>

              {/* Safeguard 4 */}
              <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] space-y-3">
                <div className="w-8 h-8 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <UserCheck className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  4. Human investigators make the final decision
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  Automated blanket account freezing is strictly prohibited. Every compliance restriction requires human reviewer sign-off, recorded in an append-only audit trail.
                </p>
              </div>

              {/* Safeguard 5 */}
              <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] space-y-3 md:col-span-2 lg:col-span-2">
                <div className="w-8 h-8 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center text-[#EA8500]">
                  <Database className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1714]">
                  5. Synthetic demonstration environment
                </h3>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  All customer names, bank accounts, and transactions on this platform are synthetically generated from the PaySim research benchmark. No real individual's banking privacy or credit standing is evaluated.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 7. Section E — Final Call to Action */}
        <section className="py-20 sm:py-24 bg-white">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="p-10 sm:p-14 lg:p-16 rounded-3xl bg-[#FAF7F2] border border-[#EAE3D6] text-center space-y-6 relative overflow-hidden shadow-sm">
              <div className="max-w-2xl mx-auto space-y-3">
                <span className="font-mono text-xs font-bold text-[#EA8500] uppercase tracking-wider">
                  Get Started
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#1A1714] tracking-tight">
                  Ready to follow the money?
                </h2>
                <p className="text-sm sm:text-base text-[#6B655B] leading-relaxed">
                  Search across 10,000 synthetic demo accounts, inspect multi-hop fund flow trees, or explore our pre-configured forensic incident cases.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
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

      {/* 8. Unified Platform Footer */}
      <V2Footer />
    </div>
  );
};
