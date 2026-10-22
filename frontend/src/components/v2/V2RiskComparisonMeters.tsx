import React, { useState } from 'react';
import { Shield, Cpu, HelpCircle, AlertTriangle, ChevronDown, ChevronUp, Scale, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { V2AccountAssessmentResponse, V2AccountMLAssessmentResponse, V2ModelDivergenceInfo } from '../../types/v2';

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
            activeScoreDetail === 'ml' ? 'border-[#EA8500] ring-2 ring-[#EA8500]/20' : 'border-[#EAE3D6]'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#FFF4E6] flex items-center justify-center text-[#EA8500]">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#1A1714]">ML Risk Estimate</h4>
                <p className="text-[11px] text-[#6B655B]">Model {mlAssessment.model_version}</p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${mlColor.bg} ${mlColor.text} ${mlColor.border}`}>
              {mlAssessment.risk_level} Risk
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-extrabold text-[#1A1714] font-mono">
              {mlAssessment.risk_score.toFixed(1)}
            </span>
            <span className="text-xs font-medium text-[#6B655B]">/ 100</span>
          </div>

          {/* Meter Bar */}
          <div className="w-full bg-[#FAF7F2] rounded-full h-2.5 overflow-hidden border border-[#EAE3D6] mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${mlColor.bar}`}
              style={{ width: `${Math.min(Math.max(mlAssessment.risk_score, 0), 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#8C857B]">
            <span>Low (0-29)</span>
            <span>Elevated (30-69)</span>
            <span>High (70-89)</span>
            <span>Critical (90+)</span>
          </div>

          <div className="mt-3 pt-3 border-t border-[#FAF7F2] flex items-center justify-between text-xs text-[#6B655B]">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-[#EA8500]" />
              <span>Statistical pattern classifier</span>
            </span>
            <span className="text-[#EA8500] font-medium flex items-center gap-0.5">
              {activeScoreDetail === 'ml' ? 'Hide details' : 'Inspect inputs'}
              {activeScoreDetail === 'ml' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {/* Rule-Based Risk Meter */}
        <div
          onClick={() => setActiveScoreDetail(activeScoreDetail === 'rule' ? null : 'rule')}
          className={`bg-white rounded-2xl border p-5 cursor-pointer transition-all hover:shadow-md ${
            activeScoreDetail === 'rule' ? 'border-[#EA8500] ring-2 ring-[#EA8500]/20' : 'border-[#EAE3D6]'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#FAF7F2] flex items-center justify-center text-[#6B655B]">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#1A1714]">Rule Behavioral Baseline</h4>
                <p className="text-[11px] text-[#6B655B]">Deterministic ledger heuristics</p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${ruleColor.bg} ${ruleColor.text} ${ruleColor.border}`}>
              {ruleAssessment.risk_level} Risk
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-extrabold text-[#1A1714] font-mono">
              {ruleAssessment.risk_score.toFixed(1)}
            </span>
            <span className="text-xs font-medium text-[#6B655B]">/ 100</span>
          </div>

          {/* Meter Bar */}
          <div className="w-full bg-[#FAF7F2] rounded-full h-2.5 overflow-hidden border border-[#EAE3D6] mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${ruleColor.bar}`}
              style={{ width: `${Math.min(Math.max(ruleAssessment.risk_score, 0), 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#8C857B]">
            <span>Low (0-25)</span>
            <span>Elevated (26-55)</span>
            <span>High (56-80)</span>
            <span>Critical (81+)</span>
          </div>

          <div className="mt-3 pt-3 border-t border-[#FAF7F2] flex items-center justify-between text-xs text-[#6B655B]">
            <span className="flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-[#6B655B]" />
              <span>Transparent mathematical signals</span>
            </span>
            <span className="text-[#EA8500] font-medium flex items-center gap-0.5">
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
            className="overflow-hidden bg-[#FAF7F2] rounded-2xl border border-[#EAE3D6] p-4 text-xs text-[#1A1714]"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-bold text-[#1A1714] flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-[#EA8500]" />
                How the ML Risk Score was Calculated
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveScoreDetail(null);
                }}
                className="text-[#6B655B] hover:text-[#1A1714] font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-[#6B655B] mb-2 leading-relaxed">
              The model evaluates 26 runtime features extracted directly from ledger activity (e.g. amount spikes, velocity, flow-through ratios, dormancy).
              It computes non-linear interaction terms to predict the probability that the account matches high-risk laundering or takeover patterns.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#EAE3D6]">
              <div>
                <span className="text-[#8C857B] block text-[10px] uppercase font-mono">Raw Probability</span>
                <span className="font-mono font-bold text-[#1A1714]">{(mlAssessment.predicted_probability * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-[#8C857B] block text-[10px] uppercase font-mono">Model Type</span>
                <span className="font-mono font-bold text-[#1A1714]">{mlAssessment.model_type}</span>
              </div>
              <div>
                <span className="text-[#8C857B] block text-[10px] uppercase font-mono">Prediction Class</span>
                <span className="font-mono font-bold uppercase text-[#1A1714]">{mlAssessment.predicted_class}</span>
              </div>
              <div>
                <span className="text-[#8C857B] block text-[10px] uppercase font-mono">TreeSHAP Drivers</span>
                <span className="font-mono font-bold text-[#EA8500]">{mlAssessment.top_contributions?.length || 0} features</span>
              </div>
            </div>
          </motion.div>
        )}

        {activeScoreDetail === 'rule' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-[#FAF7F2] rounded-2xl border border-[#EAE3D6] p-4 text-xs text-[#1A1714]"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-bold text-[#1A1714] flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-[#6B655B]" />
                Rule-Based Heuristic Contributing Signals
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveScoreDetail(null);
                }}
                className="text-[#6B655B] hover:text-[#1A1714] font-medium"
              >
                Close
              </button>
            </div>
            <p className="text-[#6B655B] mb-2 leading-relaxed">
              The rule engine applies deterministic compliance thresholds to observable ledger movements. Every point added or deducted is tied to a verifiable transaction fact.
            </p>
            <div className="space-y-1.5 pt-2 border-t border-[#EAE3D6]">
              {ruleAssessment.reason_codes.map((rc, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <span className="text-[#EA8500] font-bold mt-0.5">•</span>
                  <span className="text-[#1A1714]">{rc}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Divergence Notification if Scores Disagree */}
      {divergence.divergence_detected && (
        <div className="bg-[#FFF8EE] border border-[#FCD5B5] rounded-2xl p-4 text-xs text-[#1A1714] flex items-start gap-3">
          <div className="w-7 h-7 rounded-xl bg-[#EA8500]/10 flex items-center justify-center shrink-0 text-[#EA8500] mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#C05621] uppercase tracking-wide text-[11px]">
                Score Divergence Detected ({divergence.score_delta} pt delta)
              </span>
            </div>
            <p className="text-[#6B655B] leading-relaxed">
              {divergence.interpretation}
            </p>
            <p className="text-[#C05621] font-medium pt-0.5">
              Recommended Investigator Focus: {divergence.suggested_focus}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
