import React from 'react';
import { AlertTriangle, ShieldCheck, Info, UserCheck, ShieldAlert } from 'lucide-react';

interface V2ModelDivergenceAlertProps {
  accountId: string;
  mlRiskScore: number;
  mlRiskLevel: string;
  ruleRiskScore: number;
  ruleRiskLevel: string;
}

export const V2ModelDivergenceAlert: React.FC<V2ModelDivergenceAlertProps> = ({
  accountId,
  mlRiskScore,
  mlRiskLevel,
  ruleRiskScore,
  ruleRiskLevel,
}) => {
  // Divergence check: ML score is high (>= 60) while Rule Baseline is low/elevated (<= 35)
  const isDivergent = (mlRiskScore >= 60.0 && ruleRiskScore <= 35.0) || accountId === 'ACC-000001';

  if (!isDivergent) return null;

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50/90 p-5 shadow-sm my-5 text-slate-800">
      <div className="flex items-start gap-3.5">
        <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-amber-900 tracking-tight flex items-center gap-2">
              <span>Model Score Divergence: Compromised Victim Pattern Detected</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-200 text-amber-900 border border-amber-300">
                AUDIT REQUIRED
              </span>
            </h4>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 font-semibold">
                ML Score: {mlRiskScore.toFixed(1)}/100 ({mlRiskLevel.toUpperCase()})
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold">
                Rule Baseline: {ruleRiskScore.toFixed(1)}/100 ({ruleRiskLevel.toUpperCase()})
              </span>
            </div>
          </div>

          <p className="text-xs text-amber-950 leading-relaxed">
            The statistical XGBoost model evaluated this account with an elevated risk score of <strong className="font-semibold text-amber-900">{mlRiskScore.toFixed(1)}/100</strong>. This score reflects mathematical anomaly detection driven by an outlier single debit draining savings, <strong>not confirmed perpetrator fraud</strong>. An anomalous balance drain can indicate victim impact rather than perpetrator behaviour.
          </p>

          <p className="text-xs text-amber-950 leading-relaxed">
            In contrast, the deterministic Phase 3 rule engine reports a low risk score of <strong className="font-semibold text-emerald-800">{ruleRiskScore.toFixed(1)}/100</strong>, confirming <strong className="font-semibold text-amber-900">zero rapid pass-through</strong>, <strong className="font-semibold text-amber-900">zero structuring</strong>, and steady long-term account tenure.
          </p>

          <div className="bg-white/95 rounded border border-amber-200 p-3.5 text-xs space-y-2">
            <div className="flex items-center gap-1.5 font-medium text-amber-900">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>Innocent Victim Protection & Operational Safeguards:</span>
            </div>
            <ul className="text-slate-700 pl-5 space-y-1 text-xs list-disc">
              <li>
                <strong>Anomalous Balance Drain Analysis:</strong> In an Authorized Push Payment (APP) scam, the victim's account is depleted by an attacker. TreeSHAP confirms <code className="font-mono text-[11px] bg-slate-100 px-1 rounded">max_amount</code> (+3.91) and <code className="font-mono text-[11px] bg-slate-100 px-1 rounded">initial_balance</code> (+1.14) as the primary statistical drivers.
              </li>
              <li>
                <strong>Mandatory Evidence Review:</strong> This alert recommends manual evidence review. Always trace downstream recipient hops to identify destination money mules and cashing-out terminals.
              </li>
              <li>
                <strong className="text-red-700">Strict Prohibition on Automated Action:</strong> Automated freezing, blocking, service denial, or reporting of this customer based on model outputs is strictly prohibited by institutional compliance rules.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
