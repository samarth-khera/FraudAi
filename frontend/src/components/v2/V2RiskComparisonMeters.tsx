import React, { useState } from 'react';
import { Shield, Cpu, HelpCircle, AlertTriangle, ChevronDown, ChevronUp, Scale, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { V2AccountAssessmentResponse, V2AccountMLAssessmentResponse, V2ModelDivergenceInfo } from '../../types/v2';
import { useModelStatus } from '../../lib/useModelStatus';
import {
  MODEL_SCORE_LABEL,
  MODEL_SCORE_MEANING,
  RULE_SCORE_LABEL,
  formatModelScore,
  modelLevelBands,
  thresholdPercent,
} from '../../lib/modelScore';

interface V2RiskComparisonMetersProps {
  mlAssessment: V2AccountMLAssessmentResponse;
  ruleAssessment: AccountAssessmentResponseLike;
  divergence: V2ModelDivergenceInfo;
}

interface AccountAssessmentResponseLike {
  risk_score: number;
  risk_level: 'low' | 'elevated' | 'high' | 'critical' | string;
  signals: any;
  reason_codes: string[];
  evidence_gaps: string[];
  uncertainty_rating: string;
  recommendation: string;
}

export const V2RiskComparisonMeters: React.FC<V2RiskComparisonMetersProps> = ({
  mlAssessment,
  ruleAssessment,
  divergence,
}) => {
  const [activeScoreDetail, setActiveScoreDetail] = useState<'ml' | 'rule' | null>(null);
  const modelInfo = useModelStatus().status?.account_model;
  const thresholdLabel = thresholdPercent(modelInfo);
  const bands = modelLevelBands(modelInfo);
  const modelSuggests = mlAssessment.predicted_class === 'suspicious';

  const getRiskColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'critical':
        return { text: 'text-danger-fill', bg: 'bg-danger-soft', border: 'border-danger-line', bar: 'bg-danger-fill' };
      case 'high':
        return { text: 'text-sev-high', bg: 'bg-warn-soft', border: 'border-sev-high-line', bar: 'bg-sev-high' };
      case 'elevated':
        return { text: 'text-warn-fill', bg: 'bg-warn-soft', border: 'border-warn-line', bar: 'bg-warn-fill' };
      case 'low':
      default:
        return { text: 'text-ok', bg: 'bg-ok-soft', border: 'border-ok-line', bar: 'bg-ok' };
    }
  };

  const mlColor = getRiskColor(mlAssessment.risk_level);
  const ruleColor = getRiskColor(ruleAssessment.risk_level);

  return (
    <div className="space-y-4">
      {/* Side-by-Side Risk Meters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ML Risk Score Meter */}
        <div
          onClick={() => setActiveScoreDetail(activeScoreDetail === 'ml' ? null : 'ml')}
          className={`bg-white rounded-2xl border p-5 cursor-pointer transition-all hover:shadow-md ${
            activeScoreDetail === 'ml' ? 'border-iris ring-2 ring-iris/20' : 'border-line'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-iris-soft flex items-center justify-center text-iris">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">{MODEL_SCORE_LABEL} (machine learning)</h4>
                <p className="text-[11px] text-mute">Model {mlAssessment.model_version}</p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${mlColor.bg} ${mlColor.text} ${mlColor.border}`}>
              {mlAssessment.risk_level} Risk
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-ink font-mono">
              {formatModelScore(mlAssessment.risk_score)}
            </span>
          </div>
          <p className="text-xs font-medium text-ink mb-2">
            {modelSuggests
              ? `At or above the ${thresholdLabel ?? 'review'} review threshold: suggested for review, not confirmed fraud.`
              : `Below the ${thresholdLabel ?? 'review'} review threshold. This does not clear the account.`}
          </p>

          {/* Meter Bar */}
          <div className="w-full bg-well rounded-full h-2.5 overflow-hidden border border-line mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${mlColor.bar}`}
              style={{ width: `${Math.min(Math.max(mlAssessment.risk_score, 0), 100)}%` }}
            />
          </div>

          {bands && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-faint">
              {bands.map((b) => (
                <span key={b}>{b}</span>
              ))}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-well flex items-center justify-between text-xs text-mute">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-iris" />
              <span>Learned from synthetic examples</span>
            </span>
            <span className="text-iris font-medium flex items-center gap-0.5">
              {activeScoreDetail === 'ml' ? 'Hide details' : 'Inspect inputs'}
              {activeScoreDetail === 'ml' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {/* Rule-Based Risk Meter */}
        <div
          onClick={() => setActiveScoreDetail(activeScoreDetail === 'rule' ? null : 'rule')}
          className={`bg-white rounded-2xl border p-5 cursor-pointer transition-all hover:shadow-md ${
            activeScoreDetail === 'rule' ? 'border-iris ring-2 ring-iris/20' : 'border-line'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-well flex items-center justify-center text-mute">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">{RULE_SCORE_LABEL} (fixed rules)</h4>
                <p className="text-[11px] text-mute">Deterministic ledger heuristics</p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${ruleColor.bg} ${ruleColor.text} ${ruleColor.border}`}>
              {ruleAssessment.risk_level} Risk
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-ink font-mono">
              {ruleAssessment.risk_score.toFixed(1)}
            </span>
            <span className="text-xs font-medium text-mute">points of 100</span>
          </div>

          {/* Meter Bar */}
          <div className="w-full bg-well rounded-full h-2.5 overflow-hidden border border-line mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${ruleColor.bar}`}
              style={{ width: `${Math.min(Math.max(ruleAssessment.risk_score, 0), 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-faint">
            <span>Low (0-25)</span>
            <span>Elevated (26-55)</span>
            <span>High (56-80)</span>
            <span>Critical (81+)</span>
          </div>

          <div className="mt-3 pt-3 border-t border-well flex items-center justify-between text-xs text-mute">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-mute" />
              <span>Transparent mathematical signals</span>
            </span>
            <span className="text-iris font-medium flex items-center gap-0.5">
              {activeScoreDetail === 'rule' ? 'Hide details' : 'Inspect signals'}
              {activeScoreDetail === 'rule' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Technical Detail Panels */}
      <AnimatePresence>
        {activeScoreDetail === 'ml' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-well rounded-2xl border border-line p-4 text-xs text-ink"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-bold text-ink flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-iris" />
                How the ML Risk Score was Calculated
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveScoreDetail(null);
                }}
                className="text-mute hover:text-ink font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-mute mb-2 leading-relaxed">
              The model reads 26 features from the account’s ledger activity (amount spikes, velocity, flow-through, dormancy and
              others) and produces a score. {MODEL_SCORE_MEANING}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-line">
              <div>
                <span className="text-faint block text-[11px] font-mono">Unrounded score</span>
                <span className="font-mono font-bold text-ink">{(mlAssessment.predicted_probability * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-faint block text-[11px] font-mono">Model Type</span>
                <span className="font-mono font-bold text-ink">{mlAssessment.model_type}</span>
              </div>
              <div>
                <span className="text-faint block text-[11px] font-mono">Review suggestion</span>
                <span className="font-mono font-bold text-ink">{modelSuggests ? 'Suggested' : 'Below threshold'}</span>
              </div>
              <div>
                <span className="text-faint block text-[11px] font-mono">TreeSHAP Drivers</span>
                <span className="font-mono font-bold text-iris">{mlAssessment.top_contributions?.length || 0} features</span>
              </div>
            </div>
          </motion.div>
        )}

        {activeScoreDetail === 'rule' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-well rounded-2xl border border-line p-4 text-xs text-ink"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-bold text-ink flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-mute" />
                Rule-Based Heuristic Contributing Signals
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveScoreDetail(null);
                }}
                className="text-mute hover:text-ink font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-mute mb-2 leading-relaxed">
              Fixed rules add points for observable ledger signals; each point is tied to a transaction fact. “High” (56+) or above suggests review.
            </p>
            <div className="space-y-1.5 pt-2 border-t border-line">
              {ruleAssessment.reason_codes.map((rc, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <span className="text-iris font-bold mt-0.5">•</span>
                  <span className="text-ink">{rc}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Divergence Notification if Scores Disagree */}
      {(divergence.checks_disagree ?? divergence.divergence_detected) && (
        <div className="bg-iris-wash border border-iris-line rounded-2xl p-4 text-xs text-ink flex items-start gap-3">
          <div className="w-7 h-7 rounded-xl bg-iris/10 flex items-center justify-center shrink-0 text-iris mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-iris-deep text-[11px]">
                The two checks disagree about review
              </span>
            </div>
            <p className="text-mute leading-relaxed">
              {divergence.interpretation}
            </p>
            <p className="text-iris-deep font-medium pt-0.5">
              Recommended Investigator Focus: {divergence.suggested_focus}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
