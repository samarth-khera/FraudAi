import React from 'react';
import { AlertTriangle, UserCheck } from 'lucide-react';
import { COMPARISON_TEXT, compareChecks, formatModelScore, ruleSuggestsReview } from '../../lib/modelScore';

interface V2ModelDivergenceAlertProps {
  accountId: string;
  mlRiskScore: number;
  mlRiskLevel: string;
  /** From the backend's predicted_class, which applies the served review threshold. */
  modelSuggestsReview: boolean;
  ruleRiskScore: number;
  ruleRiskLevel: string;
  modelThresholdLabel?: string | null;
  interpretation?: string;
  suggestedFocus?: string;
}

/**
 * Shown only when exactly one of the two checks suggests review. The two scores use different scales
 * (model: 0-100% score; rules: points of 100), so they are compared by their review suggestions, never
 * by subtracting the numbers.
 */
export const V2ModelDivergenceAlert: React.FC<V2ModelDivergenceAlertProps> = ({
  accountId,
  mlRiskScore,
  mlRiskLevel,
  modelSuggestsReview,
  ruleRiskScore,
  ruleRiskLevel,
  modelThresholdLabel,
  interpretation,
  suggestedFocus,
}) => {
  const comparison = compareChecks(modelSuggestsReview, ruleSuggestsReview(ruleRiskLevel));
  if (comparison === 'both' || comparison === 'neither') return null;

  return (
    <div
      role="note"
      aria-label={`The two checks disagree about ${accountId}`}
      className="rounded-2xl border border-iris-line bg-iris-wash p-5 text-ink space-y-3"
    >
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-iris-soft border border-iris-line flex items-center justify-center text-iris shrink-0">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="space-y-2 min-w-0">
          <h3 className="font-bold font-display">The model and the fixed rules disagree about review</h3>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-white border border-line">
              Model score {formatModelScore(mlRiskScore)} ({mlRiskLevel}) ·{' '}
              {modelSuggestsReview ? 'suggests review' : `below ${modelThresholdLabel ?? 'its'} threshold`}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-line">
              Rule score {Math.round(ruleRiskScore)} points of 100 ({ruleRiskLevel}) ·{' '}
              {ruleSuggestsReview(ruleRiskLevel) ? 'suggests review' : 'does not suggest review'}
            </span>
          </div>
          <p className="text-sm text-ink-soft leading-relaxed">{interpretation || COMPARISON_TEXT[comparison]}</p>
          <p className="text-xs text-mute">
            The two scores use different scales, so their numbers should not be subtracted or compared directly.
          </p>
          {suggestedFocus && (
            <p className="text-xs text-mute">
              <strong className="text-iris-deep">Next: </strong>
              {suggestedFocus}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-mute">
            <UserCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ok" aria-hidden="true" />
            Nothing happens automatically. No account is frozen, blocked or reported because of these scores.
          </p>
        </div>
      </div>
    </div>
  );
};
