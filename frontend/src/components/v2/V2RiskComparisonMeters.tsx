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
        return { text: 'text-[#DC2626]', bg: 'bg-[#FEF2F2]', border: 'border-[#FCA5A5]', bar: 'bg-[#DC2626]' };
      case 'high':
        return { text: 'text-[#EA580C]', bg: 'bg-[#FFF7ED]', border: 'border-[#FDBA74]', bar: 'bg-[#EA580C]' };
      case 'elevated':
        return { text: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', border: 'border-[#FCD34D]', bar: 'bg-[#D97706]' };
      case 'low':
      default:
        return { text: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#6EE7B7]', bar: 'bg-[#059669]' };
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
            activeScoreDetail === 'ml' ? 'border-[#6246EA] ring-2 ring-[#6246EA]/20' : 'border-[#E4E5F0]'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#EFECFF] flex items-center justify-center text-[#6246EA]">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#141526]">{MODEL_SCORE_LABEL} (machine learning)</h4>
                <p className="text-[11px] text-[#5C6079]">Model {mlAssessment.model_version}</p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${mlColor.bg} ${mlColor.text} ${mlColor.border}`}>
              {mlAssessment.risk_level} Risk
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-extrabold text-[#141526] font-mono">
              {formatModelScore(mlAssessment.risk_score)}
            </span>
          </div>
          <p className="text-xs font-medium text-[#141526] mb-2">
            {modelSuggests
              ? `At or above the ${thresholdLabel ?? 'review'} review threshold: suggested for review, not confirmed fraud.`
              : `Below the ${thresholdLabel ?? 'review'} review threshold. This does not clear the account.`}
          </p>

          {/* Meter Bar */}
          <div className="w-full bg-[#F6F6FC] rounded-full h-2.5 overflow-hidden border border-[#E4E5F0] mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${mlColor.bar}`}
              style={{ width: `${Math.min(Math.max(mlAssessment.risk_score, 0), 100)}%` }}
            />
          </div>

          {bands && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-[#868AA2]">
              {bands.map((b) => (
                <span key={b}>{b}</span>
              ))}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-[#F6F6FC] flex items-center justify-between text-xs text-[#5C6079]">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-[#6246EA]" />
              <span>Learned from synthetic examples</span>
            </span>
            <span className="text-[#6246EA] font-medium flex items-center gap-0.5">
              {activeScoreDetail === 'ml' ? 'Hide details' : 'Inspect inputs'}
              {activeScoreDetail === 'ml' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {/* Rule-Based Risk Meter */}
        <div
          onClick={() => setActiveScoreDetail(activeScoreDetail === 'rule' ? null : 'rule')}
          className={`bg-white rounded-2xl border p-5 cursor-pointer transition-all hover:shadow-md ${
            activeScoreDetail === 'rule' ? 'border-[#6246EA] ring-2 ring-[#6246EA]/20' : 'border-[#E4E5F0]'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#F6F6FC] flex items-center justify-center text-[#5C6079]">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#141526]">{RULE_SCORE_LABEL} (fixed rules)</h4>
                <p className="text-[11px] text-[#5C6079]">Deterministic ledger heuristics</p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${ruleColor.bg} ${ruleColor.text} ${ruleColor.border}`}>
              {ruleAssessment.risk_level} Risk
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-extrabold text-[#141526] font-mono">
              {ruleAssessment.risk_score.toFixed(1)}
            </span>
            <span className="text-xs font-medium text-[#5C6079]">points of 100</span>
          </div>

          {/* Meter Bar */}
          <div className="w-full bg-[#F6F6FC] rounded-full h-2.5 overflow-hidden border border-[#E4E5F0] mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${ruleColor.bar}`}
              style={{ width: `${Math.min(Math.max(ruleAssessment.risk_score, 0), 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#868AA2]">
            <span>Low (0-25)</span>
            <span>Elevated (26-55)</span>
            <span>High (56-80)</span>
            <span>Critical (81+)</span>
          </div>

          <div className="mt-3 pt-3 border-t border-[#F6F6FC] flex items-center justify-between text-xs text-[#5C6079]">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-[#5C6079]" />
              <span>Transparent mathematical signals</span>
            </span>
            <span className="text-[#6246EA] font-medium flex items-center gap-0.5">
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
            className="overflow-hidden bg-[#F6F6FC] rounded-2xl border border-[#E4E5F0] p-4 text-xs text-[#141526]"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-bold text-[#141526] flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-[#6246EA]" />
                How the ML Risk Score was Calculated
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveScoreDetail(null);
                }}
                className="text-[#5C6079] hover:text-[#141526] font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-[#5C6079] mb-2 leading-relaxed">
              The model reads 26 features from the account’s ledger activity (amount spikes, velocity, flow-through, dormancy and
              others) and produces a score. {MODEL_SCORE_MEANING}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#E4E5F0]">
              <div>
                <span className="text-[#868AA2] block text-[10px] uppercase font-mono">Unrounded score</span>
                <span className="font-mono font-bold text-[#141526]">{(mlAssessment.predicted_probability * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-[#868AA2] block text-[10px] uppercase font-mono">Model Type</span>
                <span className="font-mono font-bold text-[#141526]">{mlAssessment.model_type}</span>
              </div>
              <div>
                <span className="text-[#868AA2] block text-[10px] uppercase font-mono">Review suggestion</span>
                <span className="font-mono font-bold text-[#141526]">{modelSuggests ? 'Suggested' : 'Below threshold'}</span>
              </div>
              <div>
                <span className="text-[#868AA2] block text-[10px] uppercase font-mono">TreeSHAP Drivers</span>
                <span className="font-mono font-bold text-[#6246EA]">{mlAssessment.top_contributions?.length || 0} features</span>
              </div>
            </div>
          </motion.div>
        )}

        {activeScoreDetail === 'rule' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-[#F6F6FC] rounded-2xl border border-[#E4E5F0] p-4 text-xs text-[#141526]"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-bold text-[#141526] flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-[#5C6079]" />
                Rule-Based Heuristic Contributing Signals
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveScoreDetail(null);
                }}
                className="text-[#5C6079] hover:text-[#141526] font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-[#5C6079] mb-2 leading-relaxed">
              Fixed rules add points for observable ledger signals; each point is tied to a transaction fact. “High” (56+) or above suggests review.
            </p>
            <div className="space-y-1.5 pt-2 border-t border-[#E4E5F0]">
              {ruleAssessment.reason_codes.map((rc, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <span className="text-[#6246EA] font-bold mt-0.5">•</span>
                  <span className="text-[#141526]">{rc}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Divergence Notification if Scores Disagree */}
      {(divergence.checks_disagree ?? divergence.divergence_detected) && (
        <div className="bg-[#F5F3FF] border border-[#D7CFFF] rounded-2xl p-4 text-xs text-[#141526] flex items-start gap-3">
          <div className="w-7 h-7 rounded-xl bg-[#6246EA]/10 flex items-center justify-center shrink-0 text-[#6246EA] mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#4F33D6] uppercase tracking-wide text-[11px]">
                The two checks disagree about review
              </span>
            </div>
            <p className="text-[#5C6079] leading-relaxed">
              {divergence.interpretation}
            </p>
            <p className="text-[#4F33D6] font-medium pt-0.5">
              Recommended Investigator Focus: {divergence.suggested_focus}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
