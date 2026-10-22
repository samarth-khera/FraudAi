import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  ArrowRight,
  Network,
  Cpu,
  Lock,
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  Scale,
  ArrowUpRight,
  GitBranch,
  Layers,
} from 'lucide-react';
import { UnifiedHeader } from '../components/layout/UnifiedHeader';
import { V2Footer } from '../components/v2/V2Footer';

interface PreviewNode {
  id: string;
  hop: number;
  roleLabel: string;
  roleBadge: string;
  grossIn: string;
  grossOut: string;
  traceableIn: string;
  unforwarded: string;
  reviewState: string;
  evidenceNote: string;
  txId?: string;
}

const PREVIEW_NODES: Record<string, PreviewNode> = {
  V001: {
    id: 'V001',
    hop: 0,
    roleLabel: 'Reporting Victim (Origin)',
    roleBadge: 'REPORTING VICTIM',
    grossIn: '₹0',
    grossOut: '₹50,000',
    traceableIn: '₹0',
    unforwarded: '₹0 (Disputed Origin)',
    reviewState: 'Reporting Victim',
    evidenceNote: 'Reported unauthorized ₹50,000 UPI debit via leg T001 to initial receiver A100.',
    txId: 'T001',
  },
  A100: {
    id: 'A100',
    hop: 1,
    roleLabel: 'Reported Initial Receiver',
    roleBadge: 'HOP 1 · INITIAL RECEIVER',
    grossIn: '₹50,000',
    grossOut: '₹50,000',
    traceableIn: '₹50,000',
    unforwarded: '₹0 (100% Forwarded)',
    reviewState: 'Under Investigation',
    evidenceNote: 'Received ₹50,000 from V001 (T001) and rapidly forwarded ₹50,000 via IMPS (T002) to B200 within 15 minutes.',
    txId: 'T001',
  },
  B200: {
    id: 'B200',
    hop: 2,
    roleLabel: 'Intermediate Pass-Through Account',
    roleBadge: 'HOP 2 · INTERMEDIATE SPLIT',
    grossIn: '₹50,000',
    grossOut: '₹50,000',
    traceableIn: '₹50,000',
    unforwarded: '₹0 (Split to C300 & D400)',
    reviewState: 'Under Review',
    evidenceNote: 'Split ₹50,000 across two downstream branches: ₹30,000 UPI to C300 (T003) and ₹20,000 NEFT to D400 (T004).',
    txId: 'T002',
  },
  C300: {
    id: 'C300',
    hop: 3,
    roleLabel: 'Downstream Recipient (Commingled Flow)',
    roleBadge: 'HOP 3 · PENDING HUMAN REVIEW',
    grossIn: '₹30,000',
    grossOut: '₹15,000',
    traceableIn: '₹30,000',
    unforwarded: '₹15,000 Retained',
    reviewState: 'Under Review',
    evidenceNote: 'Retains ₹15,000 of scenario-attributed exposure after forwarding ₹10,000 to E500 (T005) and ₹5,000 to F600 (T006). Requires invoice/KYC check before any compliance action.',
    txId: 'T003',
  },
  D400: {
    id: 'D400',
    hop: 3,
    roleLabel: 'Downstream Recipient (Partial Forward)',
    roleBadge: 'HOP 3 · PENDING HUMAN REVIEW',
    grossIn: '₹20,000',
    grossOut: '₹10,000',
    traceableIn: '₹20,000',
    unforwarded: '₹10,000 Retained',
    reviewState: 'Under Review',
    evidenceNote: 'Received ₹20,000 NEFT via T004 and forwarded ₹10,000 to G700 (T007). Connection alone does not establish wrongdoing.',
    txId: 'T004',
  },
  E500: {
    id: 'E500',
    hop: 4,
    roleLabel: 'Terminal Downstream Recipient',
    roleBadge: 'HOP 4 · TERMINAL NODE',
    grossIn: '₹10,000',
    grossOut: '₹0',
    traceableIn: '₹10,000',
    unforwarded: '₹10,000 Retained',
    reviewState: 'Under Review',
    evidenceNote: 'Terminal hop receiving ₹10,000 UPI from C300 (T005). May represent a good-faith merchant or service provider.',
    txId: 'T005',
  },
  F600: {
    id: 'F600',
    hop: 4,
    roleLabel: 'Terminal Downstream Recipient',
    roleBadge: 'HOP 4 · TERMINAL NODE',
    grossIn: '₹5,000',
    grossOut: '₹0',
    traceableIn: '₹5,000',
    unforwarded: '₹5,000 Retained',
    reviewState: 'Under Review',
    evidenceNote: 'Terminal hop receiving ₹5,000 NEFT from C300 (T006). Zero automated account freeze applied.',
    txId: 'T006',
  },
  G700: {
    id: 'G700',
    hop: 4,
    roleLabel: 'Terminal Downstream Recipient',
    roleBadge: 'HOP 4 · TERMINAL NODE',
    grossIn: '₹10,000',
    grossOut: '₹0',
    traceableIn: '₹10,000',
    unforwarded: '₹10,000 Retained',
    reviewState: 'Under Review',
    evidenceNote: 'Terminal hop receiving ₹10,000 UPI from D400 (T007). Requires human verification of commercial purpose.',
    txId: 'T007',
  },
};

export const LandingPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>('C300');
  const activeNode = PREVIEW_NODES[selectedId] || PREVIEW_NODES.C300;

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#1A1714] flex flex-col">
      {/* Unified Platform Navigation */}
      <UnifiedHeader />

      {/* Architectural Midnight-Navy Hero + Interactive Case FS-1042 Preview */}
      <section className="blueprint-grid-dark text-white border-b border-[#1C2B45] pt-12 pb-16 lg:pt-16 lg:pb-20">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Left Column: Editorial Thesis & Primary Actions (5 cols) */}
            <div className="lg:col-span-5 space-y-6 pt-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#111C30] border border-[#1C2B45] text-[11px] font-mono text-[#2DD4BF]">
                <Scale className="w-3.5 h-3.5" />
                <span>DECISION-SUPPORT FORENSICS · ZERO AUTO-FREEZE</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.1]">
                Trace the Flow.{' '}
                <span className="text-[#2DD4BF] block mt-1">
                  Protect the Innocent.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                When financial fraud strikes, stolen funds rapidly split across UPI, IMPS, and NEFT hops—frequently landing in the accounts of legitimate merchants, gig workers, and vendors. FraudShield AI traces multi-hop fund exposure and explains pre-transaction ML signals while preventing automated blanket freezes on downstream recipients.
              </p>

              {/* Primary CTAs (preserving exact test strings) */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to="/app/dashboard"
                  className="px-5 py-3 rounded-md bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2"
                >
                  <span>Open Investigation Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/app/fund-flow"
                  className="px-5 py-3 rounded-md bg-[#111C30] hover:bg-[#1C2B45] text-white border border-[#1C2B45] text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2"
                >
                  <Network className="w-4 h-4 text-[#2DD4BF]" />
                  <span>Explore Demo Case FS-1042</span>
                </Link>
              </div>

              {/* Key Forensic Differentiators */}
              <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[#1C2B45] text-xs">
                <div>
                  <div className="font-mono text-lg font-bold text-white">₹50,000</div>
                  <div className="text-[11px] text-slate-400">Bounded Stolen Pool (vs ₹1.75L gross hops)</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold text-[#2DD4BF]">98.6%</div>
                  <div className="text-[11px] text-slate-400">Pre-TX XGBoost Precision + TreeSHAP</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold text-emerald-400">0 Freezes</div>
                  <div className="text-[11px] text-slate-400">Human-adjudicated audit trail</div>
                </div>
              </div>

              {/* Prototype Disclaimer */}
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-amber-100">Synthetic Research Prototype:</strong> Trained on PaySim mobile-money logs with synthetic multi-hop scenario <code className="font-mono">FS-1042</code>. Built strictly for human decision support.
                </span>
              </div>
            </div>

            {/* Right Column: Interactive Live Product Preview (7 cols) */}
            <div id="preview" className="lg:col-span-7 bg-[#0B1322] border border-[#1C2B45] rounded-lg overflow-hidden shadow-2xl">
              {/* Preview Top Bar */}
              <div className="px-4 py-3 bg-[#070C16] border-b border-[#1C2B45] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#2DD4BF]" />
                  <span className="font-mono text-xs font-semibold text-white">
                    INTERACTIVE TOPOLOGY PREVIEW · CASE FS-1042
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Click any node below to inspect exposure vs. gross movement
                </span>
              </div>

              {/* Interactive Multi-Hop Schematic Diagram */}
              <div className="p-4 sm:p-5 bg-[#09101D] border-b border-[#1C2B45]">
                <div className="grid grid-cols-5 gap-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider pb-2 mb-3 border-b border-[#1C2B45]/80">
                  <div>Hop 0 · Origin</div>
                  <div>Hop 1 · Initial</div>
                  <div>Hop 2 · Split</div>
                  <div>Hop 3 · Review</div>
                  <div>Hop 4 · Terminal</div>
                </div>

                <div className="grid grid-cols-5 gap-2.5 items-center">
                  {/* Hop 0 */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedId('V001')}
                      className={`w-full p-2.5 rounded text-left border transition-all ${
                        selectedId === 'V001'
                          ? 'bg-[#111C30] border-[#2DD4BF] ring-1 ring-[#2DD4BF]'
                          : 'bg-[#0B1322] border-sky-500/40 hover:border-sky-400'
                      }`}
                    >
                      <div className="font-mono font-bold text-xs text-sky-300">V001</div>
                      <div className="text-[10px] text-slate-400 truncate">Victim Origin</div>
                      <div className="font-mono text-[10px] text-white mt-1">-₹50,000</div>
                    </button>
                  </div>

                  {/* Hop 1 */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedId('A100')}
                      className={`w-full p-2.5 rounded text-left border transition-all ${
                        selectedId === 'A100'
                          ? 'bg-[#111C30] border-[#2DD4BF] ring-1 ring-[#2DD4BF]'
                          : 'bg-[#0B1322] border-red-500/50 hover:border-red-400'
                      }`}
                    >
                      <div className="font-mono font-bold text-xs text-red-300">A100</div>
                      <div className="text-[10px] text-slate-400 truncate">Initial Recv</div>
                      <div className="font-mono text-[10px] text-slate-200 mt-1">₹50k → ₹50k</div>
                    </button>
                  </div>

                  {/* Hop 2 */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedId('B200')}
                      className={`w-full p-2.5 rounded text-left border transition-all ${
                        selectedId === 'B200'
                          ? 'bg-[#111C30] border-[#2DD4BF] ring-1 ring-[#2DD4BF]'
                          : 'bg-[#0B1322] border-teal-500/40 hover:border-teal-400'
                      }`}
                    >
                      <div className="font-mono font-bold text-xs text-[#2DD4BF]">B200</div>
                      <div className="text-[10px] text-slate-400 truncate">Router Split</div>
                      <div className="font-mono text-[10px] text-slate-200 mt-1">₹30k / ₹20k</div>
                    </button>
                  </div>

                  {/* Hop 3 */}
                  <div className="space-y-2">
                    {(['C300', 'D400'] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedId(id)}
                        className={`w-full p-2 rounded text-left border transition-all ${
                          selectedId === id
                            ? 'bg-[#111C30] border-[#2DD4BF] ring-1 ring-[#2DD4BF]'
                            : 'bg-[#0B1322] border-amber-500/40 hover:border-amber-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-amber-300">{id}</span>
                          <span className="text-[9px] font-mono text-amber-200/80">REVIEW</span>
                        </div>
                        <div className="font-mono text-[10px] text-slate-300 mt-0.5">
                          {id === 'C300' ? 'Hold: ₹15,000' : 'Hold: ₹10,000'}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Hop 4 */}
                  <div className="space-y-1.5">
                    {(['E500', 'F600', 'G700'] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedId(id)}
                        className={`w-full px-2 py-1.5 rounded text-left border transition-all ${
                          selectedId === id
                            ? 'bg-[#111C30] border-[#2DD4BF] ring-1 ring-[#2DD4BF]'
                            : 'bg-[#0B1322] border-[#1C2B45] hover:border-amber-400/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-[11px] text-slate-200">{id}</span>
                          <span className="font-mono text-[10px] text-[#2DD4BF]">
                            {id === 'F600' ? '₹5k' : '₹10k'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Selected Node Live Forensic Dossier Preview */}
              <div className="p-4 sm:p-5 bg-[#0B1322] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-base font-bold text-white">{activeNode.id}</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#111C30] text-[#2DD4BF] border border-[#1C2B45]">
                      {activeNode.roleBadge}
                    </span>
                    <span className="text-xs text-slate-300">{activeNode.roleLabel}</span>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-400">
                    Automated Action: none
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-2.5 rounded bg-[#070C16] border border-[#1C2B45]">
                    <span className="text-[10px] text-slate-400 block">Observed Gross In/Out</span>
                    <span className="font-mono font-semibold text-white">
                      {activeNode.grossIn} / {activeNode.grossOut}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-[#070C16] border border-[#1C2B45]">
                    <span className="text-[10px] text-slate-400 block">Traceable Exposure In</span>
                    <span className="font-mono font-semibold text-[#2DD4BF]">
                      {activeNode.traceableIn}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-[#070C16] border border-[#1C2B45]">
                    <span className="text-[10px] text-slate-400 block">Unforwarded Exposure</span>
                    <span className="font-mono font-semibold text-amber-300">
                      {activeNode.unforwarded}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-[#070C16] border border-[#1C2B45]">
                    <span className="text-[10px] text-slate-400 block">Adjudication State</span>
                    <span className="font-mono font-semibold text-slate-200">
                      {activeNode.reviewState}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                  <p className="text-slate-300 text-[11px] flex-1 min-w-[220px]">
                    {activeNode.evidenceNote}
                  </p>
                  <div className="flex items-center gap-2">
                    {activeNode.txId && (
                      <Link
                        to={`/app/transaction-check?caseId=FS-1042&txId=${activeNode.txId}`}
                        className="px-2.5 py-1.5 rounded bg-[#111C30] hover:bg-[#1C2B45] text-[#2DD4BF] border border-[#1C2B45] font-mono text-[11px] inline-flex items-center gap-1"
                      >
                        <span>Explain {activeNode.txId}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    )}
                    <Link
                      to="/app/fund-flow"
                      className="px-3 py-1.5 rounded bg-[#0D9488] hover:bg-[#0F766E] text-white font-semibold text-[11px] inline-flex items-center gap-1"
                    >
                      <span>Inspect in Workspace</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Naive Fund Tracing Fails & How FraudShield Solves It */}
      <section id="features" className="py-16 bg-[#F5F4F0] border-b border-[#E2DFD7]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#D6D3CD] pb-6">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#0F766E]">
                01 / ARCHITECTURAL DISCIPLINE
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1322] tracking-tight mt-1">
                Built for Forensic Precision, Not Blanket Enforcement
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#475569] max-w-md">
              Every screen in FraudShield AI enforces strict separation between gross ledger movement, lineage-bounded exposure, ML transaction risk, and human compliance review.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="forensic-panel p-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#0F766E] bg-[#F0FDFA] border border-[#CCFBF1] px-2 py-0.5 rounded">
                  PILLAR 01 · GRAPH LINEAGE
                </span>
                <GitBranch className="w-5 h-5 text-[#0D9488]" />
              </div>
              <h3 className="text-base font-bold text-[#0B1322]">
                Anti-Double-Counting Fund Tracing
              </h3>
              <p className="text-xs text-[#475569] leading-relaxed">
                When ₹50,000 moves across 7 downstream legs, naive summation reports ₹1,75,000 in "tainted volume." Our NetworkX traversal bounds exposure to the ₹50,000 origin claim and tracks only unforwarded balances at each hop.
              </p>
              <div className="pt-2 border-t border-[#E2DFD7] font-mono text-[11px] text-[#0B1322] flex justify-between">
                <span>Gross Ledger Volume: ₹1,75,000</span>
                <span className="text-[#0F766E] font-bold">Bounded Pool: ₹50,000</span>
              </div>
            </div>

            <div className="forensic-panel p-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#0F766E] bg-[#F0FDFA] border border-[#CCFBF1] px-2 py-0.5 rounded">
                  PILLAR 02 · EXPLAINABLE ML
                </span>
                <Cpu className="w-5 h-5 text-[#0D9488]" />
              </div>
              <h3 className="text-base font-bold text-[#0B1322]">
                Leakage-Safe XGBoost + TreeSHAP
              </h3>
              <p className="text-xs text-[#475569] leading-relaxed">
                Post-transaction balance columns leak the settlement outcome. Our deployed pipeline scores strictly pre-transaction telemetry and decomposes every prediction into exact additive log-odds TreeSHAP contributions.
              </p>
              <div className="pt-2 border-t border-[#E2DFD7] font-mono text-[11px] text-[#0B1322] flex justify-between">
                <span>Test PR-AUC: 0.9828</span>
                <span className="text-[#0F766E] font-bold">Precision: 98.6%</span>
              </div>
            </div>

            <div className="forensic-panel p-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                  PILLAR 03 · INNOCENT PROTECTION
                </span>
                <FileCheck2 className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-base font-bold text-[#0B1322]">
                Evidence Gaps &amp; Human Adjudication
              </h3>
              <p className="text-xs text-[#475569] leading-relaxed">
                Downstream recipients are never labeled guilty or automatically frozen. Each account dossier surfaces missing KYC/invoice evidence gaps and records attributed reviewer decisions in an append-only SQLite audit trail.
              </p>
              <div className="pt-2 border-t border-[#E2DFD7] font-mono text-[11px] text-[#0B1322] flex justify-between">
                <span>Automated Freezes: 0</span>
                <span className="text-emerald-700 font-bold">100% Human Audited</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Six-Dimension Evidentiary Separation Section */}
      <section id="safeguards" className="py-16 bg-white border-b border-[#E2DFD7]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#0F766E]">
                02 / EVIDENTIARY SAFEGUARDS
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1322] tracking-tight">
                Why We Never Auto-Freeze Downstream Accounts
              </h2>
              <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
                A downstream transfer tells you where money moved—not why it moved. Freezing a Tier-3 merchant or vendor account solely because a fraudster paid them causes severe collateral harm to innocent citizens.
              </p>
              <div className="pt-2">
                <Link
                  to="/app/cases/FS-1042"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-[#0B1322] hover:bg-[#111C30] text-white text-xs font-semibold transition-colors"
                >
                  <span>Inspect Case FS-1042 Account Dossiers</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#2DD4BF]" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-md bg-[#FAF9F6] border border-[#E2DFD7] space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0B1322]">
                  <Layers className="w-4 h-4 text-[#0D9488]" />
                  <span>1. Observed Gross Movement vs. 2. Traceable Exposure</span>
                </div>
                <p className="text-xs text-[#475569] leading-relaxed">
                  Gross account inflows/outflows are displayed side-by-side with lineage-bounded stolen exposure so commingled legitimate funds are never mistaken for stolen proceeds.
                </p>
              </div>

              <div className="p-4 rounded-md bg-[#FAF9F6] border border-[#E2DFD7] space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0B1322]">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>3. Transaction Risk vs. 4. Evidence Sufficiency</span>
                </div>
                <p className="text-xs text-[#475569] leading-relaxed">
                  An XGBoost score measures pre-transaction anomaly on a single transfer leg; it never overrides missing invoice, KYC, or bank-statement verification on a recipient account.
                </p>
              </div>

              <div className="p-4 rounded-md bg-[#FAF9F6] border border-[#E2DFD7] space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0B1322]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>5. Human Review State</span>
                </div>
                <p className="text-xs text-[#475569] leading-relaxed">
                  Investigators explicitly record review status, evidence quality tier, cited transaction IDs, and written rationale before concluding an account review.
                </p>
              </div>

              <div className="p-4 rounded-md bg-[#FAF9F6] border border-[#E2DFD7] space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0B1322]">
                  <Lock className="w-4 h-4 text-[#0D9488]" />
                  <span>6. Append-Only Audit Provenance</span>
                </div>
                <p className="text-xs text-[#475569] leading-relaxed">
                  Every trace calculation, status update, and reviewer decision is permanently logged with actor identity and before/after state transitions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Unified Footer */}
      <V2Footer />
    </div>
  );
};
