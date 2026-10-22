import React, { useState } from 'react';
import {
  ShieldAlert,
  HelpCircle,
  FileText,
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import { V2RecommendedAction } from '../../types/v2';

interface V2NextStepsRecommendationProps {
  recommendedActions: V2RecommendedAction[];
  humanReviewRecommended: boolean;
  disclaimer: string;
  onNavigateToTab?: (tab: 'trace' | 'transactions' | 'review') => void;
}

export const V2NextStepsRecommendation: React.FC<V2NextStepsRecommendationProps> = ({
  recommendedActions,
  humanReviewRecommended,
  disclaimer,
  onNavigateToTab,
}) => {
  const [expandedActionId, setExpandedActionId] = useState<string | null>(
    recommendedActions && recommendedActions.length > 0 ? recommendedActions[0].action_id : null
  );

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high_priority':
        return {
          label: 'High Priority Review',
          className: 'bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]',
        };
      case 'recommended':
        return {
          label: 'Review Recommended',
          className: 'bg-[#FFF7ED] text-[#EA580C] border-[#FDBA74]',
        };
      case 'more_evidence_needed':
        return {
          label: 'More Evidence Needed',
          className: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
        };
      case 'routine':
      default:
        return {
          label: 'Routine Monitoring',
          className: 'bg-[#ECFDF5] text-[#059669] border-[#6EE7B7]',
        };
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#EAE3D6] p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#FAF7F2] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-[#1A1714] font-display flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-[#EA8500]" />
              What Should the Investigator Do Next?
            </h3>
            {humanReviewRecommended && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FFF4E6] text-[#EA8500] border border-[#FCD5B5] uppercase tracking-wider">
                Human Review Recommended
              </span>
            )}
          </div>
          <p className="text-xs text-[#6B655B] mt-1">
            Tailored advisory actions derived from observable ledger facts, model attributions, and known data gaps.
          </p>
        </div>

        {onNavigateToTab && (
          <button
            onClick={() => onNavigateToTab('review')}
            className="self-start sm:self-center inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-[#EA8500] hover:bg-[#D27400] transition-colors shadow-xs"
          >
            <span>Record Adjudication</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Action Cards List */}
      <div className="space-y-3">
        {recommendedActions.map((action) => {
          const badge = getPriorityBadge(action.priority);
          const isExpanded = expandedActionId === action.action_id;

          return (
            <div
              key={action.action_id}
              className={`rounded-2xl border transition-all ${
                isExpanded
                  ? 'border-[#EA8500] bg-[#FFFBF5] shadow-xs'
                  : 'border-[#EAE3D6] bg-white hover:border-[#DDD4C4]'
              }`}
            >
              {/* Card Title Bar */}
              <div
                onClick={() => setExpandedActionId(isExpanded ? null : action.action_id)}
                className="p-4 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wide shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="text-sm font-bold text-[#1A1714]">
                    {action.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center text-xs text-[#6B655B]">
                  <span className="text-[11px] text-[#8C857B]">
                    {isExpanded ? 'Hide explanation' : 'View rationale & evidence'}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>

              {/* Expanded Detail Panel */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-[#FAF7F2] space-y-3 text-xs">
                  {/* Rationale */}
                  <div>
                    <span className="text-[11px] font-bold text-[#1A1714] block mb-1">
                      Why this action is recommended:
                    </span>
                    <p className="text-[#6B655B] leading-relaxed">
                      {action.rationale}
                    </p>
                  </div>

                  {/* 3-Column Supporting Context */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-[#EAE3D6]">
                    <div className="bg-white rounded-xl p-3 border border-[#EAE3D6]">
                      <span className="text-[10px] uppercase font-bold text-[#EA8500] block mb-1 flex items-center gap-1">
                        <Search className="w-3 h-3" /> Supporting Evidence
                      </span>
                      <p className="text-[#1A1714] text-[11px] leading-snug">
                        {action.supporting_evidence}
                      </p>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-[#EAE3D6]">
                      <span className="text-[10px] uppercase font-bold text-[#2563EB] block mb-1 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Additional Records Needed
                      </span>
                      <p className="text-[#1A1714] text-[11px] leading-snug">
                        {action.suggested_records}
                      </p>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-[#EAE3D6]">
                      <span className="text-[10px] uppercase font-bold text-[#8C857B] block mb-1 flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> Remaining Uncertainty
                      </span>
                      <p className="text-[#1A1714] text-[11px] leading-snug">
                        {action.remaining_uncertainty}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Non-Punitive Regulatory Notice */}
      <div className="bg-[#FAF7F2] rounded-xl p-3.5 border border-[#EAE3D6] text-[11px] text-[#6B655B] flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-[#1A1714] font-semibold">Investigator Guardrail:</strong> Recommendations represent advisory next steps for human compliance investigators. Automated account freezing, denial of banking services, or legal accusations without independent corroboration are strictly prohibited.
        </p>
      </div>
    </div>
  );
};
