/** The v3 models behind every Investigate-page investigation, kept apart from the older v2 models this page also shows. */
import React from 'react';
import { InvestigationModelInfo, V2ModelStatusResponse } from '../../types/v2';

const SUPPORT: Record<string, string> = {
  validated_in_distribution: 'Validated (same generator family, inputs in distribution)',
  unsupported_distribution_shift: 'Reference only: out of distribution',
  unsupported_not_checked: 'Reference only: not validated or checked',
};

const pct = (x: number | null | undefined, digits = 1) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);

const ModelCard: React.FC<{ title: string; m: InvestigationModelInfo }> = ({ title, m }) => (
  <div className="rounded-xl border border-[#E4E5F0] p-4" data-testid="v3-model-card">
    <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#6246EA]">{title}</p>
    {m.available ? (
      <>
        <p className="mt-1 text-sm font-bold text-[#141526]">{m.model_version}</p>
        <p className="text-xs text-[#5C6079]">{m.purpose}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-[#868AA2]">Review threshold</dt>
          <dd className="font-semibold">{pct(m.threshold, m.threshold != null && m.threshold < 0.01 ? 2 : 1)} calibrated</dd>
          {m.held_out_evaluation && (
            <>
              <dt className="text-[#868AA2]">Held-out precision</dt>
              <dd className="font-semibold">{pct(m.held_out_evaluation.precision)}</dd>
              <dt className="text-[#868AA2]">Held-out recall</dt>
              <dd className="font-semibold">{pct(m.held_out_evaluation.recall)}</dd>
              <dt className="text-[#868AA2]">Held-out PR-AUC</dt>
              <dd className="font-semibold">{m.held_out_evaluation.pr_auc != null ? m.held_out_evaluation.pr_auc.toFixed(3) : '—'}</dd>
            </>
          )}
        </dl>
        {m.held_out_evaluation && (
          <p className="mt-2 text-[11px] text-[#868AA2]">
            Held-out results on a separate synthetic ledger ({m.held_out_evaluation.n?.toLocaleString('en-IN')} cases,{' '}
            {m.held_out_evaluation.positives?.toLocaleString('en-IN')} scenario cases).
          </p>
        )}
      </>
    ) : (
      <p className="mt-1 text-sm text-[#991B1B]">Unavailable: {m.unavailable_reason}</p>
    )}
  </div>
);

export const InvestigationModelsPanel: React.FC<{ status: V2ModelStatusResponse | null }> = ({ status }) => {
  const im = status?.investigation_models;
  if (!im) return null;
  return (
    <section className="p-6 rounded-2xl bg-white border border-[#E4E5F0] shadow-xs space-y-4" aria-labelledby="v3-models-h" data-testid="investigation-models">
      <div>
        <h2 id="v3-models-h" className="text-base font-bold text-[#141526]">Models behind investigations (v3)</h2>
        <p className="mt-1 text-xs sm:text-sm text-[#5C6079] max-w-3xl">
          Every investigation on the Investigate page uses these two models. The v2 models further down this page are older models used
          by the Accounts tool, the case review and the transaction model check; they are not used in investigations.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ModelCard title="Transaction model" m={im.transaction_model} />
        <ModelCard title="Account behaviour model" m={im.account_model} />
      </div>
      <div>
        <h3 className="text-xs font-semibold text-[#141526]">Where their outputs count as evidence</h3>
        <ul className="mt-1.5 space-y-1 text-xs text-[#5C6079]">
          {im.datasets.map((d) => (
            <li key={d.dataset_id} data-testid={`v3-support-${d.dataset_id}`}>
              <span className="font-semibold text-[#141526]">{d.title}:</span> {SUPPORT[d.model_support] ?? d.model_support}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-[#868AA2]">
          Calibrated scores are the rate at which synthetic validation cases with that score were scenario cases. They are not
          probabilities that anyone committed fraud.
        </p>
      </div>
    </section>
  );
};

export default InvestigationModelsPanel;
