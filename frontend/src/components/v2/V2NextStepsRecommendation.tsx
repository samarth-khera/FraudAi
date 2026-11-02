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
          className: 'bg-danger-soft text-danger-fill border-danger-line',
        };
      case 'recommended':
        return {
          label: 'Review Recommended',
          className: 'bg-warn-soft text-sev-high border-sev-high-line',
        };
      case 'more_evidence_needed':
        return {
          label: 'More Evidence Needed',
          className: 'bg-ice-soft text-ice-deep border-ice-line',
        };
      case 'routine':
      default:
        return {
          label: 'Routine Monitoring',
          className: 'bg-ok-soft text-ok border-ok-line',
        };
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-line p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-well pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-ink font-display flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-iris" />
              What should the investigator do next?
            </h3>
            {humanReviewRecommended && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-iris-soft text-iris border border-iris-line ">
                Human Review Recommended
              </span>
            )}
          </div>
          <p className="text-xs text-mute mt-1">
            Tailored advisory actions derived from observable ledger facts, model attributions, and known data gaps.
          </p>
        </div>

        {onNavigateToTab && (
          <button
            onClick={() => onNavigateToTab('review')}
            className="btn-primary self-start sm:self-center min-h-0 px-3.5 py-1.5 text-xs"
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
                ? 'border-iris bg-well shadow-xs'
                : 'border-line bg-white hover:border-line-strong'
              }`}
            >
              {/* Card Title Bar */}
              <div
                onClick={() => setExpandedActionId(isExpanded ? null : action.action_id)}
                className="p-4 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="text-sm font-bold text-ink">
                    {action.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center text-xs text-mute">
                  <span className="text-[11px] text-faint">
                    {isExpanded ? 'Hide explanation' : 'View rationale & evidence'}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>

              {/* Expanded Detail Panel */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-well space-y-3 text-xs">
                  {/* Rationale */}
                  <div>
                    <span className="text-[11px] font-bold text-ink block mb-1">
                      Why this action is recommended:
                    </span>
                    <p className="text-mute leading-relaxed">
                      {action.rationale}
                    </p>
                  </div>

                  {/* 3-Column Supporting Context */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-line">
                    <div className="bg-white rounded-xl p-3 border border-line">
                      <span className="text-[11px] font-bold text-iris block mb-1 flex items-center gap-1">
                        <Search className="w-3 h-3" /> Supporting Evidence
                      </span>
                      <p className="text-ink text-[11px] leading-snug">
                        {action.supporting_evidence}
                      </p>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-line">
                      <span className="text-[11px] font-bold text-ice-deep block mb-1 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Additional Records Needed
                      </span>
                      <p className="text-ink text-[11px] leading-snug">
                        {action.suggested_records}
                      </p>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-line">
                      <span className="text-[11px] font-bold text-faint block mb-1 flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> Remaining Uncertainty
                      </span>
                      <p className="text-ink text-[11px] leading-snug">
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
      <div className="bg-well rounded-xl p-3.5 border border-line text-[11px] text-mute flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-ok shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-ink font-semibold">Investigator Guardrail:</strong> Recommendations represent advisory next steps for human compliance investigators. Automated account freezing, denial of banking services, or legal accusations without independent corroboration are strictly prohibited.
        </p>
      </div>
    </div>
  );
};
