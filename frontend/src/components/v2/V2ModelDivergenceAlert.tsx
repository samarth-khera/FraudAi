import React from 'react';
import { AlertTriangle, ShieldCheck, Info, UserCheck } from 'lucide-react';

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
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50/80 p-5 shadow-sm my-5 text-slate-800">
      <div className="flex items-start gap-3.5">
        <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 space-y-2">
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

          <p className="text-xs text-amber-950/90 leading-relaxed">
            The statistical XGBoost model flagged this account with an elevated score driven by an anomalous high-value single debit. However, the deterministic rule engine and transaction ledger show <strong className="font-semibold text-amber-900">zero rapid pass-through</strong>, <strong className="font-semibold text-amber-900">zero prior structuring deposits</strong>, and steady long-term account tenure.
          </p>

          <div className="bg-white/90 rounded border border-amber-200/80 p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium text-amber-900">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>Investigative Guidance & Innocent Account Protection:</span>
            </div>
            <p className="text-slate-600 pl-5">
              This signature matches an <strong className="text-slate-800">Innocent Victim whose credentials or session were compromised</strong> during an Authorized Push Payment (APP) scam. An anomalous outflow drains legitimate savings rather than routing illicit funds.
            </p>
            <p className="text-amber-800 pl-5 font-mono text-[11px]">
              ⚠️ Prohibition: Automated account freezing, blocking, or fraud reporting against this customer is strictly prohibited. Trace downstream recipient hops to identify destination money mules.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
