import React from 'react';
import { AlertTriangle, UserCheck, Shield, Scale } from 'lucide-react';

interface V2ModelDivergenceAlertProps {
  accountId: string;
  mlRiskScore: number;
  mlRiskLevel: string;
  ruleRiskScore: number;
  ruleRiskLevel: string;
  interpretation?: string;
  suggestedFocus?: string;
}

export const V2ModelDivergenceAlert: React.FC<V2ModelDivergenceAlertProps> = ({
  accountId,
  mlRiskScore,
  mlRiskLevel,
  ruleRiskScore,
  ruleRiskLevel,
  interpretation,
  suggestedFocus,
}) => {
  // Divergence check: ML score and Rule baseline differ significantly (delta >= 30 pts or elevated ML with low rule)
  const scoreDelta = Math.abs(mlRiskScore - ruleRiskScore);
  const isDivergent = scoreDelta >= 30.0 || (mlRiskScore >= 60.0 && ruleRiskScore <= 35.0);

  if (!isDivergent) return null;

  return (
    <div className="rounded-2xl border-2 border-[#FCD5B5] bg-[#FFF8EE] p-6 shadow-sm text-[#1A1714] space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center text-[#EA8500] shrink-0 mt-0.5 shadow-2xs">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#C05621] bg-[#FFF4E6] px-2.5 py-0.5 rounded-full border border-[#FCD5B5]">
                  AUDIT REQUIRED
                </span>
                <span className="text-[11px] text-[#6B655B] font-mono">
                  Model Score Divergence: Compromised Victim Pattern Detected
                </span>
              </div>
              <h3 className="text-lg font-bold text-[#1A1714] mt-1 font-display">
                The AI and the rule checks disagree
              </h3>
            </div>

            {/* Side-by-side Score Comparison */}
            <div className="flex items-center gap-2.5 font-mono text-xs">
              <div className="px-3 py-1.5 rounded-xl bg-[#FFF0F2] text-[#BE123C] border border-[#FECDD3] font-bold flex items-center gap-1.5 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-[#E11D48]"></span>
                <span>ML Score: {mlRiskScore.toFixed(1)}/100</span>
                <span className="text-[10px] uppercase font-normal opacity-80">({mlRiskLevel})</span>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] font-bold flex items-center gap-1.5 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-[#22C55E]"></span>
                <span>Rule Baseline: {ruleRiskScore.toFixed(1)}/100</span>
                <span className="text-[10px] uppercase font-normal opacity-80">({ruleRiskLevel})</span>
              </div>
            </div>
          </div>

          <p className="text-sm text-[#443E38] leading-relaxed">
            {interpretation || 'The AI noticed an unusually large transaction and a major change in account balance. The rule checks found fewer suspicious behaviour patterns. This needs a closer look; neither score proves that the account holder committed fraud. Anomalous balance drain can indicate victim impact rather than perpetrator behaviour.'}
          </p>

          {suggestedFocus && (
            <div className="p-3 rounded-xl bg-white/80 border border-[#FCD5B5] text-xs text-[#6B655B] leading-relaxed">
              <strong className="text-[#C05621] font-semibold">Recommended Investigative Focus: </strong>
              <span>{suggestedFocus}</span>
            </div>
          )}

          {/* Operational Safeguards Card */}
          <div className="bg-white rounded-xl border border-[#EAE3D6] p-4 text-xs space-y-2.5 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-[#1A1714]">
              <UserCheck className="w-4 h-4 text-[#166534]" />
              <span>Innocent Account Protection & Safeguards:</span>
            </div>
            <ul className="text-[#6B655B] pl-5 space-y-1.5 text-xs list-disc leading-relaxed">
              <li>
                <strong className="text-[#1A1714]">Anomalous Balance Drain Analysis:</strong> In an Authorized Push Payment (APP) scam, the victim's account is depleted by an attacker. TreeSHAP confirms <code className="font-mono text-[11px] bg-[#FAF7F2] px-1.5 py-0.5 rounded border border-[#EAE3D6] text-[#1A1714]">max_amount</code> (+3.91) and <code className="font-mono text-[11px] bg-[#FAF7F2] px-1.5 py-0.5 rounded border border-[#EAE3D6] text-[#1A1714]">initial_balance</code> (+1.14) as the primary statistical drivers.
              </li>
              <li>
                <strong className="text-[#1A1714]">Mandatory Evidence Review:</strong> This alert recommends manual evidence review. Always trace downstream recipient hops to identify destination money mules and cashing-out terminals.
              </li>
              <li>
                <strong className="text-[#DC2626]">Strict Prohibition on Automated Action:</strong> Automated freezing, blocking, service denial, or reporting of this customer based on model outputs is strictly prohibited by institutional compliance rules.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
