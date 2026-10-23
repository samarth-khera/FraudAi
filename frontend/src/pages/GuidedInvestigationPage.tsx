import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  Sparkles,
  RefreshCw,
  Layers,
  Search,
  Scale,
  Network,
  Users,
  LineChart,
  FileCheck2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Info,
  Clock,
  Send,
  Database,
  Lock,
  X,
} from 'lucide-react';
import { UnifiedHeader } from '../components/layout/UnifiedHeader';
import { Button } from '../components/common/Button';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';
import { FraudCase, TraceResult, GlobalAuditResponse } from '../types/api';
import { V2AccountLiveAnalysisResponse } from '../types/v2';

interface StepMeta {
  index: number;
  id: string;
  title: string;
  question: string;
  tagline: string;
  whyItMatters: string;
  fullPageLink: string;
  fullPageLabel: string;
}

const STEPS: StepMeta[] = [
  {
    index: 1,
    id: 'case-intake',
    title: 'Understand the Case',
    question: 'What happened?',
    tagline: 'Review the reported incident details, claimed loss amount, and available evidence.',
    whyItMatters:
      'In financial crime triage, a victim complaint is an unverified assertion until reconciled against actual bank ledger transfers. We separate the initial reported loss claim from observed transactional movement.',
    fullPageLink: '/cases/FS-1042',
    fullPageLabel: 'Open Full Case Dossier',
  },
  {
    index: 2,
    id: 'fund-flow',
    title: 'Follow the Money',
    question: 'Where did the money go?',
    tagline: 'Trace the hierarchical dispersion of funds across downstream accounts and payment rails.',
    whyItMatters:
      'Fraudsters rapidly layer and split stolen funds across intermediate accounts (conduits/mules) via multiple payment rails (UPI, IMPS, NEFT) to evade velocity thresholds and impede asset recovery.',
    fullPageLink: '/fund-flow?caseId=FS-1042',
    fullPageLabel: 'Open Fund Flow Explorer',
  },
  {
    index: 3,
    id: 'account-risk',
    title: 'Understand Account Risk',
    question: 'Which accounts need closer investigation, and why?',
    tagline: 'Differentiate between raw ledger activity, heuristic risk indicators, and verified evidence.',
    whyItMatters:
      'High inbound transaction volume does not automatically imply guilt. Legitimate commercial merchants, students receiving family support, and compromised account holders can have high flow without being fraudsters.',
    fullPageLink: '/accounts/ACC-000001',
    fullPageLabel: 'Open Account Intelligence',
  },
  {
    index: 4,
    id: 'model-explainability',
    title: 'Understand the AI',
    question: 'Why did the model flag this account?',
    tagline: 'Inspect TreeSHAP feature contributions and detect Divergence between ML risk and rule heuristics.',
    whyItMatters:
      'Machine learning risk scores are statistical pattern indicators, not evidence of criminal guilt. TreeSHAP explains exactly which features drove the score, protecting innocent victims from automated account freezing.',
    fullPageLink: '/insights',
    fullPageLabel: 'Open Model Insights & Benchmarks',
  },
  {
    index: 5,
    id: 'human-review',
    title: 'Review the Evidence',
    question: 'What should the investigator review or decide?',
    tagline: 'Record a legally defensible human adjudication decision with structured evidence ratings and notes.',
    whyItMatters:
      'Human review is the constitutional bridge in financial intelligence. Automated systems generate signals, but only authorized human investigators can assign final verdicts and approve recovery actions.',
    fullPageLink: '/cases/FS-1042?tab=review',
    fullPageLabel: 'Open Case Adjudication Tab',
  },
  {
    index: 6,
    id: 'audit-provenance',
    title: 'Verify Recorded History',
    question: 'What decision was recorded?',
    tagline: 'Inspect the newly committed audit event with server UTC timestamps and verifiable governance.',
    whyItMatters:
      'Regulatory compliance (RBI, FinCEN, GDPR) requires complete, tamper-evident audit provenance showing who decided what, when, and based on what evidence. Every action must be transparently recorded.',
    fullPageLink: '/audit?case_id=FS-1042',
    fullPageLabel: 'Open Audit & Governance Workspace',
  },
];

export const GuidedInvestigationPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial step from query parameter ?step=1..6
  const initialStep = Math.max(1, Math.min(6, parseInt(searchParams.get('step') || '1', 10)));
  const [currentStep, setCurrentStep] = useState<number>(initialStep);

  // Data states
  const [caseData, setCaseData] = useState<FraudCase | null>(null);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [analysisData, setAnalysisData] = useState<V2AccountLiveAnalysisResponse | null>(null);
  const [auditData, setAuditData] = useState<GlobalAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Step 5 Interactive Human Review state
  const [selectedVerdict, setSelectedVerdict] = useState<string>('compromised_victim');
  const [reviewNotes, setReviewNotes] = useState<string>(
    'Victim customer Aditi Joshi suffered an unauthorized balance drain via deceptive APP inducement. Account is an innocent victim, not a criminal mule conduit.'
  );
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);
  const [reviewSavedSuccess, setReviewSavedSuccess] = useState<boolean>(false);
  const [reviewSavedAt, setReviewSavedAt] = useState<string | null>(null);

  // Why it matters collapsible
  const [showWhyItMatters, setShowWhyItMatters] = useState<boolean>(true);

  // Sync step change to URL search params
  const handleStepChange = (newStep: number) => {
    const clamped = Math.max(1, Math.min(6, newStep));
    setCurrentStep(clamped);
    setSearchParams({ step: clamped.toString() });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Keyboard navigation for demo presenter: ArrowRight = next, ArrowLeft = prev
  useEffect(() => {
    const handleKeyNav = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.key === 'ArrowRight' && currentStep < 6) {
        handleStepChange(currentStep + 1);
      } else if (e.key === 'ArrowLeft' && currentStep > 1) {
        handleStepChange(currentStep - 1);
      }
    };
    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [currentStep]);

  // Load real backend data for sample case FS-1042 and account ACC-000001
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    Promise.all([
      api.getCase('FS-1042').catch(() => null),
      api.getCaseTrace('FS-1042').catch(() => null),
      v2Api.runLiveAnalysis('ACC-000001').catch(() => null),
      api.getGlobalAudit({ case_id: 'FS-1042', limit: 8 }).catch(() => null),
    ])
      .then(([c, t, a, aud]) => {
        if (!mounted) return;
        setCaseData(c);
        setTraceData(t);
        setAnalysisData(a);
        setAuditData(aud);
      })
      .catch((err: any) => {
        if (mounted) setError(err?.message || 'Failed to fetch sample investigation records');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Handle interactive review submission in Step 5
  const handleSaveReview = async () => {
    setSubmittingReview(true);
    try {
      await api.updateAccountReview('FS-1042', 'ACC-000001', {
        review_state: 'review_completed',
        evidence_quality: 'verified_forensic',
        notes: reviewNotes,
        reviewer_id: 'guided_investigator',
        decision_reasons: [
          'High ML-Rule Divergence: 76.5 ML vs 25.0 Rule points.',
          'Large outlier transfer spike characteristic of APP scam victim drain.',
          'Customer baseline exhibits consistent good-faith retail transactions.',
        ],
        supporting_transaction_ids: ['T001', 'T002'],
      });
      setReviewSavedSuccess(true);
      setReviewSavedAt(new Date().toISOString());

      // Refresh audit trail
      const freshAudit = await api.getGlobalAudit({ case_id: 'FS-1042', limit: 8 });
      setAuditData(freshAudit);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const stepMeta = STEPS[currentStep - 1];

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#1A1714] flex flex-col font-sans selection:bg-[#EA8500]/20 selection:text-[#1A1714]">
      {/* Platform Navigation */}
      <UnifiedHeader />

      {/* Guided Investigation Shell */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top Breadcrumb & Exit Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EAE3D6] pb-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FFF4E6] border border-[#FCD5B5] text-[11px] font-mono font-bold text-[#EA8500]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Interactive Guided Investigation</span>
            </span>
            <span className="text-[#8C857B] text-xs font-mono">·</span>
            <span className="text-xs font-mono text-[#6B655B]">
              Sample Case <strong className="text-[#1A1714] font-bold">FS-1042</strong>
            </span>
            <span className="text-[#8C857B] text-xs font-mono">·</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#FAF7F2] border border-[#EAE3D6] text-[#6B655B]">
              Safe Demo Data
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/workspace')}
              className="btn-ghost text-xs flex items-center gap-1 text-[#6B655B] hover:text-[#1A1714]"
              title="Exit guided tour and open the main triage workspace"
            >
              <X className="w-3.5 h-3.5" />
              <span>Exit Demo</span>
            </button>
            <Link
              to="/cases"
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
            >
              <span>Explore Cases</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#8C857B]" />
            </Link>
          </div>
        </div>

        {/* Step Progress Stepper Bar */}
        <div className="bg-white border border-[#EAE3D6] rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#EAE3D6]/70 pb-3">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#EA8500] font-bold">
                Progress: Step {currentStep} of 6
              </span>
              <h2 className="text-sm sm:text-base font-bold text-[#1A1714] font-display">
                {stepMeta.title}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#6B655B]">
                {Math.round(((currentStep - 1) / 5) * 100)}% complete
              </span>
              <div className="w-24 sm:w-32 h-2 rounded-full bg-[#FAF7F2] border border-[#EAE3D6] overflow-hidden">
                <div
                  className="h-full bg-[#EA8500] transition-all duration-300 rounded-full"
                  style={{ width: `${((currentStep) / 6) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Stepper Step Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {STEPS.map((s) => {
              const isCurrent = s.index === currentStep;
              const isPast = s.index < currentStep;
              return (
                <button
                  key={s.id}
                  onClick={() => handleStepChange(s.index)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${s.index}: ${s.title}`}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                    isCurrent
                      ? 'bg-[#FFF4E6] border-[#EA8500] ring-1 ring-[#EA8500]/30 shadow-xs'
                      : isPast
                      ? 'bg-[#FAF7F2] border-[#EAE3D6] hover:bg-white text-[#1A1714]'
                      : 'bg-white/60 border-[#EAE3D6] text-[#8C857B] hover:bg-[#FAF7F2]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                    <span className={isCurrent ? 'text-[#EA8500]' : isPast ? 'text-[#166534]' : 'text-[#8C857B]'}>
                      0{s.index}
                    </span>
                    {isPast ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#166534]" />
                    ) : isCurrent ? (
                      <span className="w-2 h-2 rounded-full bg-[#EA8500] animate-pulse" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D5CDC0]" />
                    )}
                  </div>
                  <span className={`text-xs font-bold leading-tight line-clamp-1 ${isCurrent ? 'text-[#1A1714]' : ''}`}>
                    {s.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Hero Context Card for Current Step */}
        <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#EAE3D6]/70 pb-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-[#FAF7F2] border border-[#EAE3D6] text-[10px] font-mono font-bold text-[#EA8500] uppercase">
                  Step 0{currentStep} Focus
                </span>
                <span className="text-xs font-mono text-[#8C857B]">·</span>
                <h1 className="text-xl sm:text-2xl font-extrabold text-[#1A1714] tracking-tight">
                  {stepMeta.question}
                </h1>
              </div>
              <p className="text-sm text-[#6B655B] leading-relaxed">
                {stepMeta.tagline}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Link
                to={stepMeta.fullPageLink}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5"
                title="Open this investigation view in a full workspace page"
              >
                <span>{stepMeta.fullPageLabel}</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#8C857B]" />
              </Link>
            </div>
          </div>

          {/* Collapsible "Why does this matter?" educational callout */}
          <div className="rounded-xl border border-[#EAE3D6] bg-[#FAF7F2] overflow-hidden">
            <button
              onClick={() => setShowWhyItMatters(!showWhyItMatters)}
              aria-expanded={showWhyItMatters}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-[#F2ECE1] transition-colors"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-[#1A1714]">
                <HelpCircle className="w-4 h-4 text-[#EA8500]" />
                <span>Why does this step matter in a fraud investigation?</span>
              </div>
              {showWhyItMatters ? (
                <ChevronUp className="w-4 h-4 text-[#8C857B]" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#8C857B]" />
              )}
            </button>
            <AnimatePresence>
              {showWhyItMatters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="px-4 pb-3 pt-1 border-t border-[#EAE3D6]/70 text-xs text-[#6B655B] leading-relaxed"
                >
                  {stepMeta.whyItMatters}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Step-Specific Interactive Workspace Display */}
        <div className="space-y-6">
          {/* STEP 1: Understand the Case ("What happened?") */}
          {currentStep === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Incident Dossier Summary */}
              <div className="lg:col-span-7 bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="font-mono text-xs font-bold text-[#1A1714] uppercase">
                      Incident Intake Report: FS-1042
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-mono font-bold uppercase">
                    Under Investigation
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <span className="text-[10px] font-mono text-[#8C857B] uppercase font-bold">
                      Reported Loss
                    </span>
                    <div className="text-xl font-bold font-mono text-[#1A1714]">
                      ₹50,000.00 <span className="text-xs font-normal text-[#6B655B]">INR</span>
                    </div>
                    <span className="text-[11px] text-[#6B655B]">Claimed by victim V001</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <span className="text-[10px] font-mono text-[#8C857B] uppercase font-bold">
                      Payment Rail & Origin
                    </span>
                    <div className="text-xl font-bold font-mono text-[#1A1714]">
                      UPI · T001
                    </div>
                    <span className="text-[11px] text-[#6B655B]">Instant mobile payment transfer</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold text-[#1A1714]">Incident Description:</span>
                  <p className="text-xs text-[#6B655B] bg-[#FAF7F2] p-3 rounded-xl border border-[#EAE3D6] leading-relaxed">
                    {caseData?.description ||
                      'Synthetic demo case: victim V001 reports a 50,000 INR UPI transfer to A100 as fraudulent. Downstream recipients are under review; connection to the funds does not imply wrongdoing.'}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[#EAF7EE] border border-[#BBF7D0] text-xs text-[#166534] flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    <strong>Investigation Objective:</strong> Verify if downstream recipient accounts are willful money mules or innocent commercial counterparties, and identify recoverable funds before cash-out.
                  </p>
                </div>
              </div>

              {/* Right Column: Key Forensic Guardrails */}
              <div className="lg:col-span-5 bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1A1714] border-b border-[#EAE3D6] pb-3">
                  <Scale className="w-4 h-4 text-[#EA8500]" />
                  <span>Core Forensic Principles</span>
                </div>

                <div className="space-y-3 text-xs text-[#6B655B]">
                  <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <strong className="text-[#1A1714] block font-semibold">1. Unverified Complaint vs. Ledger Proof</strong>
                    <p className="leading-relaxed">
                      A reported incident is an intake claim. Investigators must verify whether the core banking ledger records an actual debit before taking action.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <strong className="text-[#1A1714] block font-semibold">2. Connection ≠ Guilt</strong>
                    <p className="leading-relaxed">
                      Merely appearing in a fund-flow graph does not make an account owner a fraudster. Downstream accounts may be innocent merchants or victims of secondary fraud.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
                    <strong className="text-[#1A1714] block font-semibold">3. Human Review Required</strong>
                    <p className="leading-relaxed">
                      Automated freezing is strictly prohibited to prevent commercial disruption to good-faith customers.
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => handleStepChange(2)}
                    className="w-full"
                    icon={<ArrowRight className="w-4 h-4" />}
                    iconPosition="right"
                  >
                    <span>Proceed to Step 2: Follow the Money</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Follow the Money ("Where did the money go?") */}
          {currentStep === 2 && (
            <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EAE3D6] pb-3">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-[#EA8500]" />
                  <span className="font-bold text-xs uppercase tracking-wider text-[#1A1714]">
                    Multi-Hop Fund Dispersion Topology (FS-1042)
                  </span>
                </div>
                <span className="text-xs font-mono text-[#6B655B]">
                  3 Paths · 7 Transactions · 3 Payment Rails (UPI, IMPS, NEFT)
                </span>
              </div>

              {/* Interactive Visual Tree Representation */}
              <div className="p-6 rounded-2xl bg-[#FAF7F2] border border-[#EAE3D6] overflow-x-auto space-y-6">
                <div className="min-w-[700px] flex items-center justify-between gap-4">
                  {/* Origin */}
                  <div className="p-4 rounded-xl bg-white border border-[#EAE3D6] text-center shadow-xs w-44 shrink-0 space-y-1">
                    <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-mono font-bold border border-rose-200">
                      Origin Victim
                    </span>
                    <h3 className="font-mono text-sm font-bold text-[#1A1714]">V001</h3>
                    <p className="text-[11px] text-[#6B655B]">Lost: ₹50,000</p>
                    <span className="text-[10px] font-mono text-[#8C857B]">Hop 0</span>
                  </div>

                  <div className="text-center font-mono text-[10px] text-[#8C857B] shrink-0">
                    <span className="font-bold text-[#EA8500]">T001 (UPI)</span>
                    <br />
                    <span>₹50,000 →</span>
                  </div>

                  {/* Hop 1 */}
                  <div className="p-4 rounded-xl bg-white border border-amber-300 text-center shadow-xs w-44 shrink-0 space-y-1 ring-1 ring-amber-400/30">
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-mono font-bold border border-amber-200">
                      Hop 1 Conduit
                    </span>
                    <h3 className="font-mono text-sm font-bold text-[#1A1714]">A100</h3>
                    <p className="text-[11px] text-[#6B655B]">Recv: ₹50,000</p>
                    <span className="text-[10px] font-mono text-[#8C857B]">Forwarded 100%</span>
                  </div>

                  <div className="text-center font-mono text-[10px] text-[#8C857B] shrink-0">
                    <span className="font-bold text-[#0F766E]">T002 (IMPS)</span>
                    <br />
                    <span>₹50,000 →</span>
                  </div>

                  {/* Hop 2 */}
                  <div className="p-4 rounded-xl bg-white border border-blue-200 text-center shadow-xs w-44 shrink-0 space-y-1">
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-mono font-bold border border-blue-200">
                      Hop 2 Splitter
                    </span>
                    <h3 className="font-mono text-sm font-bold text-[#1A1714]">B200</h3>
                    <p className="text-[11px] text-[#6B655B]">Splits 30k & 20k</p>
                    <span className="text-[10px] font-mono text-[#8C857B]">Hop 2 Node</span>
                  </div>

                  <div className="text-center font-mono text-[10px] text-[#8C857B] shrink-0">
                    <span className="text-[#7E22CE] font-bold">Split Rails</span>
                    <br />
                    <span>UPI & NEFT →</span>
                  </div>

                  {/* Hop 3 Terminals */}
                  <div className="space-y-2 shrink-0 w-48">
                    <div className="p-2.5 rounded-lg bg-white border border-[#EAE3D6] text-xs">
                      <span className="font-mono font-bold text-[#1A1714]">C300 → E500 & F600</span>
                      <p className="text-[10px] text-[#6B655B]">₹10,000 (UPI) + ₹5,000 (NEFT)</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-[#EAE3D6] text-xs">
                      <span className="font-mono font-bold text-[#1A1714]">D400 → G700</span>
                      <p className="text-[10px] text-[#6B655B]">₹10,000 (UPI) Terminated</p>
                    </div>
                  </div>
                </div>

                {/* Legend & Guide */}
                <div className="pt-3 border-t border-[#EAE3D6] flex flex-wrap items-center justify-between gap-3 text-xs text-[#6B655B]">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      <span>Origin Victim (Hop 0)</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span>Intermediate Conduit</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <span>Downstream Recipient</span>
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[#8C857B]">
                    Attribution status: Scenario assumptions based on transaction timing
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="secondary"
                  onClick={() => handleStepChange(1)}
                  icon={<ArrowLeft className="w-4 h-4" />}
                >
                  <span>Back</span>
                </Button>
                <Button
                  onClick={() => handleStepChange(3)}
                  icon={<ArrowRight className="w-4 h-4" />}
                  iconPosition="right"
                >
                  <span>Proceed to Step 3: Understand Account Risk</span>
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: Understand Account Risk ("Which accounts need closer investigation?") */}
          {currentStep === 3 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Account 360° Profile */}
              <div className="lg:col-span-7 bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#EA8500]" />
                    <span className="font-bold text-xs uppercase tracking-wider text-[#1A1714]">
                      Account 360° Profile: ACC-000001
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono font-bold">
                    KYC Verified · Retail Customer
                  </span>
                </div>

                {/* Core Ledger Facts */}
                <div className="space-y-2">
                  <span className="text-[11px] font-mono uppercase text-[#8C857B] font-bold">
                    Verified Core Ledger Facts (Not Predictions)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
                      <span className="text-[10px] font-mono text-[#8C857B] block">Current Balance</span>
                      <span className="text-base font-bold font-mono text-[#1A1714]">₹177,156.23</span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
                      <span className="text-[10px] font-mono text-[#8C857B] block">Total Inflow</span>
                      <span className="text-base font-bold font-mono text-[#166534]">₹288,043.01</span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
                      <span className="text-[10px] font-mono text-[#8C857B] block">Total Outflow</span>
                      <span className="text-base font-bold font-mono text-rose-700">₹410,886.78</span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6]">
                      <span className="text-[10px] font-mono text-[#8C857B] block">Transactions</span>
                      <span className="text-base font-bold font-mono text-[#1A1714]">56 Txns</span>
                    </div>
                  </div>
                </div>

                {/* Holder Profile */}
                <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2 text-[#6B655B]">
                    <div>Holder Name: <strong className="text-[#1A1714]">Aditi Joshi</strong></div>
                    <div>Customer Type: <strong className="text-[#1A1714]">Retail Savings</strong></div>
                    <div>Account Age: <strong className="text-[#1A1714]">Established Oct 2025</strong></div>
                    <div>Unique Counterparties: <strong className="text-[#1A1714]">56 Parties</strong></div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#EBF5FF] border border-[#BFDBFE] text-xs text-[#1E40AF] flex items-start gap-2.5">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    <strong>Critical Distinction:</strong> Ledger balance and transaction counts are immutable historical facts. Risk scores and model predictions are mathematical estimates that require evidentiary verification.
                  </p>
                </div>
              </div>

              {/* Right Column: Risk Assessment Comparison */}
              <div className="lg:col-span-5 bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1A1714] border-b border-[#EAE3D6] pb-3">
                  <Cpu className="w-4 h-4 text-[#EA8500]" />
                  <span>Rule Risk vs. ML Score</span>
                </div>

                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#1A1714]">Heuristic Rule Score</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#EAF7EE] text-[#166534] font-mono text-xs font-bold border border-[#BBF7D0]">
                        25.0 / 100 · Low
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6B655B]">
                      Rules evaluate multi-party diversification and account tenure. Standard retail profile passes all velocity locks.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#EA8500]">Statistical ML Model</span>
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 font-mono text-xs font-bold border border-rose-200">
                        76.5 / 100 · High
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6B655B]">
                      Model flags sudden large transaction spike (₹250,000 debit). But why did the model score it so high? Step 4 explains the reason!
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <Button
                    variant="secondary"
                    onClick={() => handleStepChange(2)}
                    icon={<ArrowLeft className="w-4 h-4" />}
                  >
                    <span>Back</span>
                  </Button>
                  <Button
                    onClick={() => handleStepChange(4)}
                    icon={<ArrowRight className="w-4 h-4" />}
                    iconPosition="right"
                  >
                    <span>Step 4: Understand the AI</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Understand the AI ("Why did the model flag this account?") */}
          {currentStep === 4 && (
            <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-6">
              {/* Divergence Alert Callout */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#FFF4E6] border border-[#FCD5B5] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-[#EA8500]" />
                    <span className="font-bold text-sm text-[#1A1714]">
                      Model-Rule Divergence Detected (+51.5 Point Delta)
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-white text-[#EA8500] font-mono text-xs font-bold border border-[#FCD5B5]">
                    Potential Compromised Victim Drain
                  </span>
                </div>
                <p className="text-xs text-[#6B655B] leading-relaxed">
                  The statistical XGBoost model scored risk at <strong>76.5/100</strong>, while rule heuristics scored <strong>25.0/100</strong>. When a high ML score is driven solely by a sudden large drain on an established retail account, the customer is almost always a <strong>victim of deception (APP scam) or unauthorized account takeover</strong>, not a money mule!
                </p>
              </div>

              {/* TreeSHAP Feature Importance Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-2">
                  <span className="text-xs font-bold text-[#1A1714] uppercase tracking-wider font-mono">
                    TreeSHAP Feature Contributions (Why the Model Scored 76.5)
                  </span>
                  <span className="text-[11px] font-mono text-[#8C857B]">
                    XGBoost v2-account-1.0.0
                  </span>
                </div>

                <div className="space-y-2.5">
                  {((analysisData?.ml_assessment?.top_contributions || [
                    { feature_name: 'max_amount', feature_value: 250000.0, contribution_score: 3.91, impact_direction: 'increases_risk' },
                    { feature_name: 'initial_balance', feature_value: 300000.0, contribution_score: 1.14, impact_direction: 'increases_risk' },
                    { feature_name: 'avg_amount', feature_value: 12480.89, contribution_score: 0.96, impact_direction: 'increases_risk' },
                    { feature_name: 'amount_spike_ratio', feature_value: 20.03, contribution_score: 0.51, impact_direction: 'increases_risk' },
                    { feature_name: 'flow_through_ratio', feature_value: 1.43, contribution_score: 0.39, impact_direction: 'increases_risk' },
                  ]) as Array<{ feature_name: string; feature_value: number; contribution_score: number; impact_direction: string }>).map((c, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <span className="font-mono font-bold text-[#1A1714]">{c.feature_name}</span>
                        <p className="text-[11px] text-[#6B655B]">
                          Observed value: <strong className="text-[#1A1714] font-mono">{c.feature_value.toLocaleString()}</strong>
                          {c.feature_name === 'max_amount' && ' (₹250k single transfer: 20x higher than account average)'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-rose-700">+{c.contribution_score.toFixed(2)} SHAP</span>
                        <span className="block text-[10px] text-[#8C857B] uppercase font-mono">Increases Risk</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="secondary"
                  onClick={() => handleStepChange(3)}
                  icon={<ArrowLeft className="w-4 h-4" />}
                >
                  <span>Back</span>
                </Button>
                <Button
                  onClick={() => handleStepChange(5)}
                  icon={<ArrowRight className="w-4 h-4" />}
                  iconPosition="right"
                >
                  <span>Proceed to Step 5: Review the Evidence</span>
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: Review the Evidence ("What should the investigator decide?") */}
          {currentStep === 5 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Adjudication Panel */}
              <div className="lg:col-span-8 bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between border-b border-[#EAE3D6] pb-3">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-[#EA8500]" />
                    <span className="font-bold text-xs uppercase tracking-wider text-[#1A1714]">
                      Human Review Adjudication Panel
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-[#FAF7F2] border border-[#EAE3D6] text-[10px] font-mono text-[#6B655B]">
                    Connected to Live Backend API
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-[#1A1714] mb-1.5">
                      Select Human Investigator Verdict:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setSelectedVerdict('compromised_victim')}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                          selectedVerdict === 'compromised_victim'
                            ? 'bg-[#FFF4E6] border-[#EA8500] ring-1 ring-[#EA8500]'
                            : 'bg-[#FAF7F2] border-[#EAE3D6] hover:bg-white'
                        }`}
                      >
                        <span className="block text-xs font-bold text-[#EA8500]">Compromised Victim</span>
                        <span className="text-[11px] text-[#6B655B] leading-tight block mt-0.5">
                          Account was drained by unauthorized deception
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedVerdict('innocent_counterparty')}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                          selectedVerdict === 'innocent_counterparty'
                            ? 'bg-[#EAF7EE] border-[#166534] ring-1 ring-[#166534]'
                            : 'bg-[#FAF7F2] border-[#EAE3D6] hover:bg-white'
                        }`}
                      >
                        <span className="block text-xs font-bold text-[#166534]">Innocent Party</span>
                        <span className="text-[11px] text-[#6B655B] leading-tight block mt-0.5">
                          Normal commercial or personal transfer
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedVerdict('suspicious_mule')}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                          selectedVerdict === 'suspicious_mule'
                            ? 'bg-rose-50 border-rose-600 ring-1 ring-rose-600'
                            : 'bg-[#FAF7F2] border-[#EAE3D6] hover:bg-white'
                        }`}
                      >
                        <span className="block text-xs font-bold text-rose-700">Suspicious Mule</span>
                        <span className="text-[11px] text-[#6B655B] leading-tight block mt-0.5">
                          High-confidence layering pass-through conduit
                        </span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#1A1714] mb-1.5">
                      Investigator Forensic Rationale & Notes:
                    </label>
                    <textarea
                      rows={3}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      className="w-full p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs text-[#1A1714] focus:outline-none focus:bg-white focus:border-[#EA8500] focus:ring-1 focus:ring-[#EA8500]"
                    />
                  </div>

                  {reviewSavedSuccess && (
                    <div className="p-3.5 rounded-xl bg-[#EAF7EE] border border-[#BBF7D0] text-xs text-[#166534] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0" />
                        <span>
                          <strong>Review Successfully Saved:</strong> Decision committed as an append-only audit event.
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-[#166534]">
                        {reviewSavedAt ? new Date(reviewSavedAt).toLocaleTimeString() : 'Recorded'}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <Button
                      onClick={handleSaveReview}
                      loading={submittingReview}
                      icon={<Send className="w-4 h-4" />}
                    >
                      <span>Commit Review Decision (Live Save)</span>
                    </Button>
                    <span className="text-[11px] text-[#8C857B]">
                      Recorded by: <code className="font-mono font-bold text-[#1A1714]">guided_investigator</code>
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Review Governance Checklist */}
              <div className="lg:col-span-4 bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1A1714] border-b border-[#EAE3D6] pb-3">
                  <Shield className="w-4 h-4 text-[#EA8500]" />
                  <span>Adjudication Checklist</span>
                </div>

                <div className="space-y-3 text-xs text-[#6B655B]">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0 mt-0.5" />
                    <span>Cross-referenced reported UPI loss with core ledger.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0 mt-0.5" />
                    <span>Analyzed multi-hop fund flow through intermediate nodes.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0 mt-0.5" />
                    <span>Reconciled model-rule divergence and TreeSHAP features.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0 mt-0.5" />
                    <span>Identified customer Aditi Joshi as an APP scam victim.</span>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => handleStepChange(6)}
                    className="w-full"
                    icon={<ArrowRight className="w-4 h-4" />}
                    iconPosition="right"
                  >
                    <span>Proceed to Step 6: Verify Audit History</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Verify Recorded History ("What decision was recorded?") */}
          {currentStep === 6 && (
            <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 sm:p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EAE3D6] pb-3">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-[#EA8500]" />
                  <span className="font-bold text-xs uppercase tracking-wider text-[#1A1714]">
                    Recorded Audit History for Case FS-1042
                  </span>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-mono text-[#6B655B]">
                  Storage: SQLite audit_events (Append-Only)
                </span>
              </div>

              {/* Real Audit Events Table */}
              <div className="border border-[#EAE3D6] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#FAF7F2] border-b border-[#EAE3D6] text-[11px] font-mono uppercase text-[#6B655B]">
                        <th className="p-3">Event ID</th>
                        <th className="p-3">Action</th>
                        <th className="p-3">Actor</th>
                        <th className="p-3">Timestamp (UTC)</th>
                        <th className="p-3">Context / Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE3D6]">
                      {(auditData?.events || [
                        {
                          event_id: 1054,
                          action: 'account_review_recorded',
                          performed_by: 'guided_investigator',
                          timestamp: reviewSavedAt || new Date().toISOString(),
                          details: { verdict: selectedVerdict, notes: reviewNotes },
                        },
                      ]).slice(0, 5).map((ev: any, i: number) => (
                        <tr key={i} className="hover:bg-[#FAF7F2]/60">
                          <td className="p-3 font-mono font-bold text-[#1A1714]">#{ev.event_id}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded-full bg-[#FFF4E6] text-[#EA8500] font-mono text-[10px] font-bold border border-[#FCD5B5]">
                              {ev.action}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-[#6B655B]">{ev.performed_by || 'system_service'}</td>
                          <td className="p-3 font-mono text-[#6B655B]">{ev.timestamp}</td>
                          <td className="p-3 text-[#1A1714] truncate max-w-xs">
                            {ev.details?.verdict || ev.details?.notes || JSON.stringify(ev.details || {})}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Data Integrity Transparency Disclosure */}
              <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-2 text-xs text-[#6B655B]">
                <div className="flex items-center gap-2 font-bold text-[#1A1714]">
                  <Lock className="w-4 h-4 text-[#EA8500]" />
                  <span>Audit Provenance & Integrity Status</span>
                </div>
                <p className="leading-relaxed">
                  Audit events are appended directly to the relational database table with server-generated UTC timestamps.
                  Application operations enforce append-only constraints. Note: cryptographic block-chaining or WORM hardware is not claimed or implemented.
                </p>
              </div>

              {/* Completion Celebration & Return Actions */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-[#FFF4E6] via-white to-[#FAF7F2] border border-[#FCD5B5] space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#EA8500] text-white mx-auto flex items-center justify-center shadow-md">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-[#1A1714] font-display">
                    Guided Investigation Complete!
                  </h3>
                  <p className="text-xs text-[#6B655B] max-w-md mx-auto">
                    You have followed the money, investigated account risk, inspected AI explainability, recorded a human review decision, and verified the immutable audit trail.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <Button
                    onClick={() => navigate('/workspace')}
                    icon={<ArrowRight className="w-4 h-4" />}
                    iconPosition="right"
                  >
                    <span>Open Main Triage Workspace</span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => navigate('/cases')}
                  >
                    <span>View All Cases</span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleStepChange(1)}
                  >
                    <span>Restart Tour</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Persistent Navigation Bar */}
        <div className="bg-white border border-[#EAE3D6] rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={currentStep === 1}
            onClick={() => handleStepChange(currentStep - 1)}
            icon={<ArrowLeft className="w-4 h-4" />}
          >
            <span>Previous Step</span>
          </Button>

          <div className="flex items-center gap-1.5 text-xs text-[#6B655B]">
            <span>Step {currentStep} of 6:</span>
            <strong className="text-[#1A1714] font-bold">{stepMeta.title}</strong>
          </div>

          {currentStep < 6 ? (
            <Button
              onClick={() => handleStepChange(currentStep + 1)}
              icon={<ArrowRight className="w-4 h-4" />}
              iconPosition="right"
            >
              <span>Continue: Step {currentStep + 1}</span>
            </Button>
          ) : (
            <Button
              onClick={() => navigate('/workspace')}
              icon={<Sparkles className="w-4 h-4" />}
              iconPosition="right"
            >
              <span>Finish & Enter Workspace</span>
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};

export default GuidedInvestigationPage;
