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

  // Human Review Form State
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
      <div className="glass-card rounded-2xl p-6 border border-slate-200/80 text-center space-y-2 text-xs text-slate-500">
        <div className="w-6 h-6 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mx-auto" />
        <div>Loading evidence-aware assessment for {accountId}...</div>
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-2">
        <div className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Corroborated by Human Review</span>
          </span>
        );
      case 'insufficient_evidence':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Insufficient Evidence / Uncertain Lineage</span>
          </span>
        );
      case 'graph_connection_only':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <GitBranch className="w-3.5 h-3.5" />
            <span>Graph Connection Only</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Info className="w-3.5 h-3.5" />
            <span>Scenario Lineage Assumed (Unverified)</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-4" data-testid="account-protection-panel">
      {/* 1. Header & Graph Position Card */}
      <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <User className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 font-mono">{pos.account_id}</h3>
                <Badge variant="role" value={pos.role} />
              </div>
              <span className="text-xs text-slate-500 block">{pos.label}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <Badge variant="review" value={rev.review_state} />
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-semibold"
                >
                  Close
                </button>
              )}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Automated Action: <strong>{assessment.automated_action_taken}</strong>
            </span>
          </div>
        </div>

        {/* Structural Position Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-500 block">Connection Type</span>
            <span className="font-bold text-slate-800 capitalize">
              {pos.connection_type.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-500 block">Hop Distance</span>
            <span className="font-bold text-slate-800">
              {pos.hop_count !== null ? `Hop ${pos.hop_count}` : 'Origin / N/A'}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-500 block">Upstream Senders</span>
            <div className="font-mono font-bold text-slate-800 flex flex-wrap gap-1 mt-0.5">
              {pos.upstream_account_ids.length > 0 ? (
                pos.upstream_account_ids.map((uid) => (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => onSelectAccount && onSelectAccount(uid)}
                    className="text-indigo-600 hover:underline"
                  >
                    {uid}
                  </button>
                ))
              ) : (
                <span className="text-slate-400">None</span>
              )}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] text-slate-500 block">Downstream Receivers</span>
            <div className="font-mono font-bold text-slate-800 flex flex-wrap gap-1 mt-0.5">
              {pos.downstream_account_ids.length > 0 ? (
                pos.downstream_account_ids.map((did) => (
                  <button
                    key={did}
                    type="button"
                    onClick={() => onSelectAccount && onSelectAccount(did)}
                    className="text-indigo-600 hover:underline"
                  >
                    {did}
                  </button>
                ))
              ) : (
                <span className="text-slate-400">None (Terminal)</span>
              )}
            </div>
          </div>
        </div>

        {/* Separation of Observed Movement vs. Traceable Fund Exposure */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Gross Observed Movement */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
            <div className="font-bold text-slate-800 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-slate-600" />
                <span>1. Observed Ledger Movement</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">
                Gross Transfers
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-[10px] text-slate-500 block">
                  Observed Inbound ({mov.traced_inbound_count} legs)
                </span>
                <span className="text-sm font-bold text-slate-900">
                  ₹{mov.observed_inbound_value.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">
                  Observed Outbound ({mov.traced_outbound_count} legs)
                </span>
                <span className="text-sm font-bold text-slate-900">
                  ₹{mov.observed_outbound_value.toLocaleString()}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">{mov.movement_note}</p>
          </div>

          {/* Lineage-Bounded Traceable Exposure */}
          <div className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-200/80 space-y-2 text-xs">
            <div className="font-bold text-indigo-950 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-indigo-600" />
                <span>2. Traceable Fund Exposure</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono">
                {exp.attribution_status}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <span className="text-[10px] text-slate-500 block">Attributed In</span>
                <span className="text-sm font-bold text-indigo-900">
                  {exp.attributed_inbound_amount !== null
                    ? `₹${exp.attributed_inbound_amount.toLocaleString()}`
                    : 'Uncertain'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Attributed Out</span>
                <span className="text-sm font-bold text-indigo-900">
                  {exp.attributed_outbound_amount !== null
                    ? `₹${exp.attributed_outbound_amount.toLocaleString()}`
                    : 'Uncertain'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Unforwarded</span>
                <span className="text-sm font-bold text-indigo-700">
                  {exp.attributed_unforwarded_amount !== null
                    ? `₹${exp.attributed_unforwarded_amount.toLocaleString()}`
                    : 'Uncertain'}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-indigo-900/80 leading-relaxed">
              {exp.double_counting_safeguard}
            </p>
          </div>
        </div>

        {/* Related Inbound & Outbound Transactions with Direct Link to Explainable AI */}
        {allAccountTxs.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
              <span>Traced Transactions Involving {pos.account_id}</span>
              <span className="text-[10px] text-slate-500">
                Select leg to inspect or explain in ML Risk Engine
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {allAccountTxs.map((t) => {
                const isInbound = t.receiver_account_id === pos.account_id;
                const stepVal = new Date(t.timestamp).getUTCHours() + 1 || 11;
                const explainUrl = `/app/transaction-check?txId=${encodeURIComponent(
                  t.transaction_id
                )}&caseId=${encodeURIComponent(caseId)}&amount=${t.amount}&type=${encodeURIComponent(
                  t.transaction_type
                )}&step=${stepVal}&sender=${encodeURIComponent(
                  t.sender_account_id
                )}&receiver=${encodeURIComponent(t.receiver_account_id)}`;

                return (
                  <div
                    key={`${t.transaction_id}-${isInbound ? 'in' : 'out'}`}
                    onClick={() => onSelectTransaction && onSelectTransaction(t.transaction_id)}
                    className="p-2.5 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 flex flex-wrap items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isInbound
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-sky-50 text-sky-800 border border-sky-200'
                        }`}
                      >
                        {isInbound ? 'INBOUND' : 'OUTBOUND'}
                      </span>
                      <span className="font-mono font-bold text-indigo-700">{t.transaction_id}</span>
                      <span className="font-mono text-slate-600">
                        {t.sender_account_id} → {t.receiver_account_id}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="font-bold text-slate-900">
                          ₹{t.amount.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-500 ml-1">
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
                        className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-[11px] inline-flex items-center gap-1"
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

      {/* 2. Evidence Assessment, Signals, Uncertainty & Verification Guidance */}
      <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-indigo-600" />
            <h4 className="text-sm font-bold text-slate-900">
              3. Evidence Quality, Signals & Uncertainty Safeguards
            </h4>
          </div>
          {renderSufficiencyBadge(ev.evidence_sufficiency)}
        </div>

        {/* Observed Structural & Timing Signals */}
        {signals.length > 0 && (
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Observed Structural & Timing Signals (Not Proof of Intent):
            </span>
            <div className="space-y-2">
              {signals.map((sig) => (
                <div
                  key={sig.code}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{sig.title}</span>
                    <span className="font-mono text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                      {sig.related_transaction_ids.join(', ')}
                    </span>
                  </div>
                  <p className="text-slate-700">{sig.description}</p>
                  <p className="text-[11px] text-slate-500 italic">{sig.interpretation_note}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Supporting Evidence vs. Explicit Evidence Gaps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-emerald-50/40 border border-emerald-200/70 space-y-1.5">
            <div className="font-bold text-emerald-950">Available Supporting Evidence</div>
            {ev.supporting_evidence.length > 0 ? (
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-emerald-900">
                {ev.supporting_evidence.map((item, i) => (
                  <li key={i}>
                    <strong>[{item.evidence_type.replace(/_/g, ' ')}]</strong> {item.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-slate-500">No corroborating evidence recorded yet.</p>
            )}
          </div>

          <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-1.5">
            <div className="font-bold text-amber-950 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Explicit Evidence Gaps & Uncertainty</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-900">
              {ev.evidence_gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
              {ev.uncertainty_factors.map((u, i) => (
                <li key={`u-${i}`}>{u}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Recommended Human Verification Steps */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-900">
              Recommended Next Investigation Steps (Suggested State:{' '}
              <code className="text-indigo-700">{ev.recommended_review_state}</code>)
            </span>
          </div>
          <p className="text-[11px] text-slate-600">{ev.recommendation_rationale}</p>
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700 pt-1">
            {ev.verification_guidance.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>

        {/* Separation of ML Transaction Score vs Account Evidence */}
        <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 text-[11px] text-indigo-950 leading-relaxed">
          <strong>Model Score vs. Account Evidence Separation:</strong>{' '}
          {assessment.transaction_risk_separation_note}
        </div>
      </div>

      {/* 3. Human-Review Adjudication Form */}
      <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-4 text-xs">
        <div className="pb-2 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              4. Record Human Investigator Review Decision
            </h4>
            <p className="text-[11px] text-slate-500">
              Logs an append-only audit event with reviewer identity, reasons, and supporting transactions. Never triggers automatic account freezing.
            </p>
          </div>
        </div>

        {saveMessage && (
          <div
            role="status"
            className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{saveMessage}</span>
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <form onSubmit={handleSubmitReview} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="rev-state-select" className="block font-semibold text-slate-700 mb-1">
                Review Status
              </label>
              <select
                id="rev-state-select"
                value={reviewState}
                onChange={(e) => setReviewState(e.target.value as ReviewState)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800"
              >
                <option value="not_reviewed">Not Reviewed</option>
                <option value="under_review">Under Review</option>
                <option value="under_investigation">Under Investigation</option>
                <option value="review_completed">Review Completed</option>
                <option value="reporting_victim">Reporting Victim</option>
              </select>
            </div>

            <div>
              <label htmlFor="rev-quality-select" className="block font-semibold text-slate-700 mb-1">
                Evidence Quality
              </label>
              <select
                id="rev-quality-select"
                value={evidenceQuality}
                onChange={(e) => setEvidenceQuality(e.target.value as EvidenceQuality)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800"
              >
                <option value="not_assessed">Not Assessed</option>
                <option value="graph_connection_only">Graph Connection Only</option>
                <option value="synthetic_assumption">Synthetic Assumption</option>
                <option value="corroborated">Corroborated (Verified Docs)</option>
              </select>
            </div>

            <div>
              <label htmlFor="rev-reviewer-input" className="block font-semibold text-slate-700 mb-1">
                Reviewer Identity
              </label>
              <input
                id="rev-reviewer-input"
                type="text"
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                placeholder="e.g. analyst_meera"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono"
                required
              />
            </div>
          </div>

          {/* Decision Reasons */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">
              Reasons for Review Decision
            </label>
            <div className="space-y-1.5">
              {PRESET_DECISION_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-start gap-2 p-2 rounded-lg bg-slate-50/80 border border-slate-200/60 cursor-pointer hover:bg-slate-100/70"
                >
                  <input
                    type="checkbox"
                    checked={selectedReasons.includes(reason)}
                    onChange={() => toggleReason(reason)}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600"
                  />
                  <span className="text-[11px] text-slate-700">{reason}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Add custom decision reason..."
                className="flex-1 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
              />
              <button
                type="button"
                onClick={addCustomReason}
                className="px-3 py-1.5 rounded-xl bg-slate-200/80 hover:bg-slate-300/80 text-slate-800 font-semibold text-xs"
              >
                + Add Reason
              </button>
            </div>
          </div>

          {/* Supporting Transactions */}
          {allAccountTxs.length > 0 && (
            <div className="space-y-1.5">
              <span className="block font-semibold text-slate-700">
                Cite Supporting Transactions
              </span>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set(allAccountTxs.map((t) => t.transaction_id))).map((tid) => {
                  const checked = selectedTxIds.includes(tid);
                  return (
                    <button
                      key={tid}
                      type="button"
                      onClick={() => toggleTxId(tid)}
                      className={`px-2.5 py-1 rounded-lg font-mono text-xs border transition-colors ${
                        checked
                          ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      {checked ? `✓ ${tid}` : tid}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Additional Info Needed Checkbox */}
          <label className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/70 cursor-pointer">
            <input
              type="checkbox"
              checked={additionalInfoNeeded}
              onChange={(e) => setAdditionalInfoNeeded(e.target.checked)}
              className="rounded border-amber-300 text-amber-600"
            />
            <span className="text-xs font-semibold text-amber-950">
              Additional external information needed (e.g., invoice, KYC verification, bank statement) before concluding review
            </span>
          </label>

          {/* Review Notes */}
          <div>
            <label htmlFor="rev-notes-textarea" className="block font-semibold text-slate-700 mb-1">
              Investigator Notes & Evidence Rationale
            </label>
            <textarea
              id="rev-notes-textarea"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Document specific findings, invoice references, or remaining verification gaps..."
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={savingReview}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 disabled:opacity-50"
            >
              {savingReview ? 'Recording Review...' : 'Record Human Review Decision'}
            </button>
          </div>
        </form>
      </div>

      {/* 4. Account-Specific Audit History */}
      <div className="glass-card rounded-2xl p-5 border border-slate-200/80 space-y-3 text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="font-bold text-slate-900 flex items-center gap-1.5">
            <History className="w-4 h-4 text-indigo-600" />
            <span>Account Review Audit History ({audits.length})</span>
          </span>
        </div>

        {audits.length > 0 ? (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {audits.map((evItem, idx) => (
              <div
                key={evItem.event_id || idx}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700">{evItem.action}</span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(evItem.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="text-slate-600">
                  Reviewer: <strong className="text-slate-900">{evItem.performed_by}</strong>
                </div>
                {evItem.details && (
                  <div className="text-[11px] text-slate-700 space-y-0.5 pt-1 border-t border-slate-200/60">
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
                          Supporting TXs: {evItem.details.supporting_transaction_ids.join(', ')}
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            No human review decisions have been recorded for {pos.account_id} yet.
          </p>
        )}
      </div>
    </div>
  );
};
