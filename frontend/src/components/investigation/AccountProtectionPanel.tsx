import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  User,
  ShieldCheck,
  AlertTriangle,
  Info,
  Activity,
  Scale,
  FileSearch,
  CheckCircle2,
  History,
  HelpCircle,
  ArrowUpRight,
  GitBranch,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  AccountAssessmentResponse,
  EvidenceQuality,
  ReviewState,
} from '../../types/api';
import { Badge } from '../common/Badge';

interface AccountProtectionPanelProps {
  caseId: string;
  accountId: string;
  maxDepth?: number;
  initialAssessment?: AccountAssessmentResponse | null;
  onSelectAccount?: (accountId: string) => void;
  onSelectTransaction?: (transactionId: string) => void;
  onReviewUpdated?: () => void;
  onClose?: () => void;
}

const PRESET_DECISION_REASONS = [
  'Verified commercial invoice / merchant order matching transfer amount',
  'Confirmed customer KYC and regular counterparty relationship',
  'Lineage is incomplete or commingled; insufficient evidence to attribute funds',
  'Rapid pass-through observed; awaiting bank statement & session verification',
  'Reported initial receiver of disputed origin transfer; under active investigation',
];

export const AccountProtectionPanel: React.FC<AccountProtectionPanelProps> = ({
  caseId,
  accountId,
  maxDepth = 10,
  initialAssessment = null,
  onSelectAccount,
  onSelectTransaction,
  onReviewUpdated,
  onClose,
}) => {
  const [assessment, setAssessment] = useState<AccountAssessmentResponse | null>(
    initialAssessment && initialAssessment.account_id === accountId ? initialAssessment : null
  );
  const [loading, setLoading] = useState<boolean>(!assessment);
  const [error, setError] = useState<string | null>(null);

  const [reviewState, setReviewState] = useState<ReviewState>('under_review');
  const [evidenceQuality, setEvidenceQuality] = useState<EvidenceQuality>('not_assessed');
  const [reviewerId, setReviewerId] = useState<string>('investigator_ui');
  const [notes, setNotes] = useState<string>('');
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [customReason, setCustomReason] = useState<string>('');
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);
  const [additionalInfoNeeded, setAdditionalInfoNeeded] = useState<boolean>(false);

  const [savingReview, setSavingReview] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hydrateFormFromAssessment = (data: AccountAssessmentResponse) => {
    const rev = data.review_status;
    setReviewState(rev.review_state || data.evidence_assessment.recommended_review_state || 'under_review');
    setEvidenceQuality(rev.evidence_quality || 'not_assessed');
    setReviewerId(rev.reviewer_id || 'investigator_ui');
    setNotes(rev.notes || '');
    setSelectedReasons(rev.decision_reasons || []);
    setSelectedTxIds(rev.supporting_transaction_ids || []);
    setAdditionalInfoNeeded(Boolean(rev.additional_info_needed));
  };

  const fetchAssessment = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAccountAssessment(caseId, accountId, maxDepth);
      setAssessment(data);
      hydrateFormFromAssessment(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load account assessment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialAssessment && initialAssessment.account_id === accountId) {
      setAssessment(initialAssessment);
      hydrateFormFromAssessment(initialAssessment);
      setLoading(false);
    } else {
      fetchAssessment();
    }
    setSaveMessage(null);
    setSaveError(null);
  }, [caseId, accountId, maxDepth, initialAssessment]);

  const toggleReason = (reason: string) => {
    setSelectedReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
  };

  const addCustomReason = () => {
    const trimmed = customReason.trim();
    if (trimmed && !selectedReasons.includes(trimmed)) {
      setSelectedReasons((prev) => [...prev, trimmed]);
      setCustomReason('');
    }
  };

  const toggleTxId = (txId: string) => {
    setSelectedTxIds((prev) =>
      prev.includes(txId) ? prev.filter((id) => id !== txId) : [...prev, txId]
    );
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingReview(true);
    setSaveMessage(null);
    setSaveError(null);

    const finalReasons = [...selectedReasons];
    if (customReason.trim() && !finalReasons.includes(customReason.trim())) {
      finalReasons.push(customReason.trim());
    }

    try {
      await api.updateAccountReview(caseId, accountId, {
        review_state: reviewState,
        evidence_quality: evidenceQuality,
        reviewer_id: reviewerId.trim() || 'investigator_ui',
        notes: notes.trim() || undefined,
        decision_reasons: finalReasons,
        supporting_transaction_ids: selectedTxIds,
        additional_info_needed: additionalInfoNeeded,
      });
      setCustomReason('');
      setSaveMessage(`Human review recorded and logged to audit trail for ${accountId}.`);
      await fetchAssessment();
      if (onReviewUpdated) onReviewUpdated();
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save human review.');
    } finally {
      setSavingReview(false);
    }
  };

  if (loading && !assessment) {
    return (
      <div className="forensic-panel p-6 text-center space-y-2 text-xs font-mono text-[#64748B]">
        <div className="w-6 h-6 rounded-full border-2 border-[#0D9488] border-t-transparent animate-spin mx-auto" />
        <div>Loading evidence-aware dossier for {accountId}...</div>
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="p-4 rounded-md bg-red-50 border border-red-300 text-xs text-red-900 space-y-2">
        <div className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <span>Assessment Unavailable</span>
        </div>
        <p>{error || 'Could not load account assessment.'}</p>
      </div>
    );
  }

  const {
    graph_position: pos,
    observed_movement: mov,
    traceable_exposure: exp,
    observed_signals: signals,
    evidence_assessment: ev,
    review_status: rev,
    audit_history: audits,
  } = assessment;

  const allAccountTxs = [
    ...mov.traced_inbound_transactions,
    ...mov.traced_outbound_transactions,
  ];

  const renderSufficiencyBadge = (suff: string) => {
    switch (suff) {
      case 'human_review_corroborated':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Corroborated by Human Review</span>
          </span>
        );
      case 'insufficient_evidence':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Insufficient Evidence / Uncertain Lineage</span>
          </span>
        );
      case 'graph_connection_only':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#F5F4F0] text-[#334155] border border-[#D6D3CD]">
            <GitBranch className="w-3.5 h-3.5" />
            <span>Graph Connection Only</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300">
            <Info className="w-3.5 h-3.5" />
            <span>Scenario Lineage Assumed (Unverified)</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-4" data-testid="account-protection-panel">
      {/* 1. Midnight-Navy Account Dossier Header & Structural Position */}
      <div className="forensic-panel overflow-hidden">
        <div className="p-4 bg-[#0B1322] text-white border-b border-[#1C2B45] flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[#111C30] text-[#2DD4BF] flex items-center justify-center border border-[#1C2B45]">
              <User className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white font-mono">{pos.account_id}</h3>
                <Badge variant="role" value={pos.role} />
              </div>
              <span className="text-[11px] text-slate-300 block">{pos.label}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <Badge variant="review" value={rev.review_state} />
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-2 py-0.5 rounded bg-[#111C30] hover:bg-[#1C2B45] text-slate-200 border border-[#1C2B45] text-[11px] font-mono font-semibold"
                >
                  Close
                </button>
              )}
            </div>
            <span className="text-[10px] text-emerald-400 font-mono">
              Automated Action: <strong>{assessment.automated_action_taken}</strong>
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Structural Position Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded bg-[#FAF9F6] border border-[#E2DFD7]">
              <span className="text-[10px] font-mono text-[#64748B] block">Connection</span>
              <span className="font-bold text-[#0B1322] capitalize">
                {pos.connection_type.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="p-2.5 rounded bg-[#FAF9F6] border border-[#E2DFD7]">
              <span className="text-[10px] font-mono text-[#64748B] block">Hop Distance</span>
              <span className="font-mono font-bold text-[#0B1322]">
                {pos.hop_count !== null ? `Hop ${pos.hop_count}` : 'Origin / N/A'}
              </span>
            </div>
            <div className="p-2.5 rounded bg-[#FAF9F6] border border-[#E2DFD7]">
              <span className="text-[10px] font-mono text-[#64748B] block">Upstream</span>
              <div className="font-mono font-bold text-[#0B1322] flex flex-wrap gap-1 mt-0.5">
                {pos.upstream_account_ids.length > 0 ? (
                  pos.upstream_account_ids.map((uid, idx) => (
                    <button
                      key={`up-${uid}-${idx}`}
                      type="button"
                      onClick={() => onSelectAccount && onSelectAccount(uid)}
                      className="text-[#0F766E] hover:underline"
                    >
                      {uid}
                    </button>
                  ))
                ) : (
                  <span className="text-[#64748B]">None</span>
                )}
              </div>
            </div>
            <div className="p-2.5 rounded bg-[#FAF9F6] border border-[#E2DFD7]">
              <span className="text-[10px] font-mono text-[#64748B] block">Downstream</span>
              <div className="font-mono font-bold text-[#0B1322] flex flex-wrap gap-1 mt-0.5">
                {pos.downstream_account_ids.length > 0 ? (
                  pos.downstream_account_ids.map((did, idx) => (
                    <button
                      key={`down-${did}-${idx}`}
                      type="button"
                      onClick={() => onSelectAccount && onSelectAccount(did)}
                      className="text-[#0F766E] hover:underline"
                    >
                      {did}
                    </button>
                  ))
                ) : (
                  <span className="text-[#64748B]">Terminal</span>
                )}
              </div>
            </div>
          </div>

          {/* 1. Observed Ledger Movement vs. 2. Traceable Fund Exposure */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-md bg-[#FAF9F6] border border-[#D6D3CD] space-y-2 text-xs">
              <div className="font-bold text-[#0B1322] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#475569]" />
                  <span>1. Observed Ledger Movement</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-[#D6D3CD] text-[#475569]">
                  Gross Transfers
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
                <div>
                  <span className="text-[10px] font-sans text-[#64748B] block">
                    Inbound ({mov.traced_inbound_count} legs)
                  </span>
                  <span className="text-sm font-bold text-[#0B1322] tabular-nums">
                    ₹{mov.observed_inbound_value.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-sans text-[#64748B] block">
                    Outbound ({mov.traced_outbound_count} legs)
                  </span>
                  <span className="text-sm font-bold text-[#0B1322] tabular-nums">
                    ₹{mov.observed_outbound_value.toLocaleString()}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#475569] leading-relaxed">{mov.movement_note}</p>
            </div>

            <div className="p-3.5 rounded-md bg-[#F0FDFA] border border-[#99F6E4] space-y-2 text-xs">
              <div className="font-bold text-[#0B1322] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-[#0D9488]" />
                  <span>2. Traceable Fund Exposure</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-[#99F6E4] text-[#0F766E]">
                  {exp.attribution_status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 font-mono">
                <div>
                  <span className="text-[10px] font-sans text-[#475569] block">Attributed In</span>
                  <span className="text-sm font-bold text-[#0B1322] tabular-nums">
                    {exp.attributed_inbound_amount !== null
                      ? `₹${exp.attributed_inbound_amount.toLocaleString()}`
                      : 'Uncertain'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-sans text-[#475569] block">Attributed Out</span>
                  <span className="text-sm font-bold text-[#0B1322] tabular-nums">
                    {exp.attributed_outbound_amount !== null
                      ? `₹${exp.attributed_outbound_amount.toLocaleString()}`
                      : 'Uncertain'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-sans text-[#475569] block">Unforwarded</span>
                  <span className="text-sm font-bold text-[#0F766E] tabular-nums">
                    {exp.attributed_unforwarded_amount !== null
                      ? `₹${exp.attributed_unforwarded_amount.toLocaleString()}`
                      : 'Uncertain'}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#115E59] leading-relaxed">
                {exp.double_counting_safeguard}
              </p>
            </div>
          </div>

          {/* Traced Transactions Involving This Account */}
          {allAccountTxs.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-xs font-bold text-[#0B1322] flex items-center justify-between">
                <span>Traced Transactions Involving {pos.account_id}</span>
                <span className="text-[10px] font-mono text-[#64748B]">
                  Jump to TreeSHAP Risk Engine
                </span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {allAccountTxs.map((t, idx) => {
                  const txId = t.transaction_id || (t as any).id || `tx-${idx}`;
                  const isInbound = (t.receiver_account_id || (t as any).target) === pos.account_id;
                  const stepVal = new Date(t.timestamp).getUTCHours() + 1 || 11;
                  const explainUrl = `/app/transaction-check?txId=${encodeURIComponent(
                    txId
                  )}&caseId=${encodeURIComponent(caseId)}&amount=${t.amount}&type=${encodeURIComponent(
                    t.transaction_type
                  )}&step=${stepVal}&sender=${encodeURIComponent(
                    t.sender_account_id || (t as any).source || ''
                  )}&receiver=${encodeURIComponent(t.receiver_account_id || (t as any).target || '')}`;

                  return (
                    <div
                      key={`${txId}-${isInbound ? 'in' : 'out'}-${idx}`}
                      onClick={() => onSelectTransaction && onSelectTransaction(txId)}
                      className="p-2.5 rounded bg-[#FAF9F6] border border-[#E2DFD7] hover:border-[#0D9488] flex flex-wrap items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2 font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isInbound
                              ? 'bg-amber-50 text-amber-900 border border-amber-300'
                              : 'bg-sky-50 text-sky-900 border border-sky-300'
                          }`}
                        >
                          {isInbound ? 'INBOUND' : 'OUTBOUND'}
                        </span>
                        <span className="font-bold text-[#0F766E]">{t.transaction_id}</span>
                        <span className="text-[#475569]">
                          {t.sender_account_id} → {t.receiver_account_id}
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="text-right font-mono">
                          <span className="font-bold text-[#0B1322]">
                            ₹{t.amount.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-[#64748B] ml-1">
                            (Attr:{' '}
                            {t.attributed_amount !== null
                              ? `₹${t.attributed_amount.toLocaleString()}`
                              : 'Uncertain'}
                            )
                          </span>
                        </div>
                        <Link
                          to={explainUrl}
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-1 rounded bg-[#0B1322] hover:bg-[#111C30] text-[#2DD4BF] font-mono font-semibold text-[11px] inline-flex items-center gap-1"
                          title="Open in Explainable Risk Scoring"
                        >
                          <span>Explain TX</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Evidence Assessment, Signals & Uncertainty Safeguards */}
      <div className="forensic-panel p-4 space-y-3.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E2DFD7]">
          <div className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-[#0D9488]" />
            <h4 className="text-sm font-bold text-[#0B1322]">
              3. Evidence Quality, Signals &amp; Uncertainty Safeguards
            </h4>
          </div>
          {renderSufficiencyBadge(ev.evidence_sufficiency)}
        </div>

        {signals.length > 0 && (
          <div className="space-y-2">
            <span className="text-[10px] font-mono font-bold text-[#64748B] uppercase tracking-wider block">
              Observed Structural &amp; Timing Signals (Not Proof of Intent)
            </span>
            <div className="space-y-2">
              {signals.map((sig, idx) => (
                <div
                  key={`${sig.code}-${idx}`}
                  className="p-3 rounded bg-[#FAF9F6] border border-[#E2DFD7] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#0B1322]">{sig.title}</span>
                    <span className="font-mono text-[10px] text-[#0F766E] bg-[#F0FDFA] border border-[#CCFBF1] px-1.5 py-0.5 rounded">
                      {sig.related_transaction_ids.join(', ')}
                    </span>
                  </div>
                  <p className="text-[#334155]">{sig.description}</p>
                  <p className="text-[11px] text-[#64748B] italic">{sig.interpretation_note}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-emerald-50/60 border border-emerald-200 space-y-1.5">
            <div className="font-bold text-emerald-950">Available Supporting Evidence</div>
            {ev.supporting_evidence.length > 0 ? (
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-emerald-900">
                {ev.supporting_evidence.map((item, i) => (
                  <li key={`supp-${i}`}>
                    <strong>[{item.evidence_type.replace(/_/g, ' ')}]</strong> {item.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[#64748B]">No corroborating evidence recorded yet.</p>
            )}
          </div>

          <div className="p-3 rounded bg-amber-50/80 border border-amber-300 space-y-1.5">
            <div className="font-bold text-amber-950 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
              <span>Explicit Evidence Gaps &amp; Uncertainty</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-950">
              {ev.evidence_gaps.map((gap, i) => (
                <li key={`gap-${i}`}>{gap}</li>
              ))}
              {ev.uncertainty_factors.map((u, i) => (
                <li key={`uncert-${i}`}>{u}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="p-3 rounded bg-[#FAF9F6] border border-[#E2DFD7] space-y-1.5">
          <span className="font-bold text-[#0B1322] block">
            Recommended Next Investigation Steps (Suggested State:{' '}
            <code className="font-mono text-[#0F766E]">{ev.recommended_review_state}</code>)
          </span>
          <p className="text-[11px] text-[#475569]">{ev.recommendation_rationale}</p>
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#334155] pt-0.5">
            {ev.verification_guidance.map((g, i) => (
              <li key={`guide-${i}`}>{g}</li>
            ))}
          </ul>
        </div>

        <div className="p-2.5 rounded bg-[#0B1322] text-slate-300 border border-[#1C2B45] text-[11px] leading-relaxed">
          <strong className="text-[#2DD4BF]">Model Score vs. Account Evidence Separation:</strong>{' '}
          {assessment.transaction_risk_separation_note}
        </div>
      </div>

      {/* 3. Human-Review Adjudication Form */}
      <div className="forensic-panel p-4 space-y-3.5 text-xs">
        <div className="pb-2.5 border-b border-[#E2DFD7]">
          <h4 className="text-sm font-bold text-[#0B1322]">
            4. Record Human Investigator Review Decision
          </h4>
          <p className="text-[11px] text-[#64748B]">
            Appends an attributed audit trail record with reviewer identity, cited transactions, and rationale. Never triggers automated freezing.
          </p>
        </div>

        {saveMessage && (
          <div
            role="status"
            className="p-3 rounded bg-emerald-50 border border-emerald-300 text-emerald-950 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0" />
            <span>{saveMessage}</span>
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="p-3 rounded bg-red-50 border border-red-300 text-red-900 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-red-700 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <form onSubmit={handleSubmitReview} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label htmlFor="rev-state-select" className="block font-semibold text-[#0B1322] mb-1">
                Review Status
              </label>
              <select
                id="rev-state-select"
                value={reviewState}
                onChange={(e) => setReviewState(e.target.value as ReviewState)}
                className="w-full px-2.5 py-2 rounded bg-[#FAF9F6] border border-[#D6D3CD] text-xs font-semibold text-[#0B1322]"
              >
                <option value="not_reviewed">Not Reviewed</option>
                <option value="under_review">Under Review</option>
                <option value="under_investigation">Under Investigation</option>
                <option value="review_completed">Review Completed</option>
                <option value="reporting_victim">Reporting Victim</option>
              </select>
            </div>

            <div>
              <label htmlFor="rev-quality-select" className="block font-semibold text-[#0B1322] mb-1">
                Evidence Quality
              </label>
              <select
                id="rev-quality-select"
                value={evidenceQuality}
                onChange={(e) => setEvidenceQuality(e.target.value as EvidenceQuality)}
                className="w-full px-2.5 py-2 rounded bg-[#FAF9F6] border border-[#D6D3CD] text-xs font-semibold text-[#0B1322]"
              >
                <option value="not_assessed">Not Assessed</option>
                <option value="graph_connection_only">Graph Connection Only</option>
                <option value="synthetic_assumption">Synthetic Assumption</option>
                <option value="corroborated">Corroborated (Verified Docs)</option>
              </select>
            </div>

            <div>
              <label htmlFor="rev-reviewer-input" className="block font-semibold text-[#0B1322] mb-1">
                Reviewer Identity
              </label>
              <input
                id="rev-reviewer-input"
                type="text"
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                placeholder="e.g. analyst_meera"
                className="w-full px-2.5 py-2 rounded bg-[#FAF9F6] border border-[#D6D3CD] text-xs font-mono"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-[#0B1322]">
              Reasons for Review Decision
            </label>
            <div className="space-y-1.5">
              {PRESET_DECISION_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-start gap-2 p-2 rounded bg-[#FAF9F6] border border-[#E2DFD7] cursor-pointer hover:border-[#0D9488]"
                >
                  <input
                    type="checkbox"
                    checked={selectedReasons.includes(reason)}
                    onChange={() => toggleReason(reason)}
                    className="mt-0.5 rounded border-[#D6D3CD] text-[#0D9488]"
                  />
                  <span className="text-[11px] text-[#334155]">{reason}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Add custom decision reason..."
                className="flex-1 px-3 py-1.5 rounded bg-[#FAF9F6] border border-[#D6D3CD] text-xs"
              />
              <button
                type="button"
                onClick={addCustomReason}
                className="px-3 py-1.5 rounded bg-[#EFECE6] hover:bg-[#E2DFD7] text-[#0B1322] font-semibold text-xs border border-[#D6D3CD]"
              >
                + Add Reason
              </button>
            </div>
          </div>

          {allAccountTxs.length > 0 && (
            <div className="space-y-1.5">
              <span className="block font-semibold text-[#0B1322]">
                Cite Supporting Transactions
              </span>
              <div className="flex flex-wrap gap-2">
                {Array.from(
                  new Set(
                    allAccountTxs
                      .map((t, idx) => t.transaction_id || (t as any).id || `tx-${idx}`)
                      .filter(Boolean)
                  )
                ).map((tid) => {
                  const checked = selectedTxIds.includes(tid);
                  return (
                    <button
                      key={tid}
                      type="button"
                      onClick={() => toggleTxId(tid)}
                      className={`px-2.5 py-1 rounded font-mono text-xs border transition-colors ${
                        checked
                          ? 'bg-[#0B1322] text-[#2DD4BF] border-[#0D9488] font-bold'
                          : 'bg-[#FAF9F6] text-[#334155] border-[#D6D3CD] hover:border-[#0D9488]'
                      }`}
                    >
                      {checked ? `✓ ${tid}` : tid}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 p-2.5 rounded bg-amber-50/70 border border-amber-300 cursor-pointer">
            <input
              type="checkbox"
              checked={additionalInfoNeeded}
              onChange={(e) => setAdditionalInfoNeeded(e.target.checked)}
              className="rounded border-amber-400 text-amber-700"
            />
            <span className="text-xs font-semibold text-amber-950">
              Additional external information needed (invoice, KYC verification, bank statement) before concluding review
            </span>
          </label>

          <div>
            <label htmlFor="rev-notes-textarea" className="block font-semibold text-[#0B1322] mb-1">
              Investigator Notes &amp; Evidence Rationale
            </label>
            <textarea
              id="rev-notes-textarea"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Document specific findings, invoice references, or remaining verification gaps..."
              className="w-full px-3 py-2 rounded bg-[#FAF9F6] border border-[#D6D3CD] text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={savingReview}
              className="btn-primary py-2.5 px-5 text-xs font-semibold shadow-xs"
            >
              {savingReview ? 'Recording Review...' : 'Record Human Review Decision'}
            </button>
          </div>
        </form>
      </div>

      {/* 4. Account-Specific Audit History */}
      <div className="forensic-panel p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-[#E2DFD7]">
          <span className="font-bold text-[#0B1322] flex items-center gap-1.5">
            <History className="w-4 h-4 text-[#EA8500]" />
            <span>Account Review Audit History ({audits.length})</span>
          </span>
        </div>

        {audits.length > 0 ? (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {audits.map((evItem, idx) => (
              <div
                key={evItem.event_id || idx}
                className="p-3 rounded bg-[#FAF9F6] border border-[#E2DFD7] space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[#0F766E]">{evItem.action}</span>
                  <span className="text-[10px] font-mono text-[#64748B]">
                    {new Date(evItem.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="text-[#475569]">
                  Reviewer: <strong className="text-[#0B1322] font-mono">{evItem.performed_by}</strong>
                </div>
                {evItem.details && (
                  <div className="text-[11px] text-[#334155] space-y-0.5 pt-1 border-t border-[#E2DFD7]">
                    {evItem.details.new_review_state && (
                      <div>
                        State: <code>{evItem.details.old_review_state || 'none'}</code> →{' '}
                        <code className="font-bold">{evItem.details.new_review_state}</code> | Quality:{' '}
                        <code>{evItem.details.evidence_quality}</code>
                      </div>
                    )}
                    {evItem.details.notes && <div>Notes: {evItem.details.notes}</div>}
                    {Array.isArray(evItem.details.decision_reasons) &&
                      evItem.details.decision_reasons.length > 0 && (
                        <div>Reasons: {evItem.details.decision_reasons.join('; ')}</div>
                      )}
                    {Array.isArray(evItem.details.supporting_transaction_ids) &&
                      evItem.details.supporting_transaction_ids.length > 0 && (
                        <div>
                          Supporting TXs: <code>{evItem.details.supporting_transaction_ids.join(', ')}</code>
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[#64748B] text-[11px]">
            No human review events recorded specifically for {pos.account_id} yet.
          </p>
        )}
      </div>
    </div>
  );
};
