import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  SearchCheck,
  AlertTriangle,
  Cpu,
  Info,
  ArrowRight,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  ServerCrash,
  Layers,
  Sliders,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import {
  RiskExplainResponse,
  RiskScoreRequest,
} from '../types/api';

interface LinkedTxMeta {
  transactionId: string;
}

export const TransactionCheckPage: React.FC = () => {
  const [formData, setFormData] = useState<RiskScoreRequest>({
    step: 12,
    type: 'TRANSFER',
    amount: 250000,
    oldbalanceOrg: 250000,
    oldbalanceDest: 0,
  });

  const [linkedTx, setLinkedTx] = useState<LinkedTxMeta | null>(null);
  const [contributionView, setContributionView] = useState<'engineered' | 'encoded'>('engineered');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskExplainResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const presets = [
    {
      name: 'High-Risk Transfer (Drainage Pattern)',
      desc: 'Large TRANSFER draining 100% of origin balance to zero-balance destination',
      tag: 'FULL DRAIN · TRANSFER',
      txLabel: 'PRESET-DRAIN-01',
      data: {
        step: 12,
        type: 'TRANSFER',
        amount: 250000,
        oldbalanceOrg: 250000,
        oldbalanceDest: 0,
      },
    },
    {
      name: 'Low-Risk Everyday Payment',
      desc: 'Small retail PAYMENT from healthy pre-settlement origin balance',
      tag: '6% RATIO · PAYMENT',
      txLabel: 'PRESET-PAY-02',
      data: {
        step: 35,
        type: 'PAYMENT',
        amount: 1500,
        oldbalanceOrg: 25000,
        oldbalanceDest: 50000,
      },
    },
    {
      name: 'Cash-In Depository',
      desc: 'Inbound CASH_IN deposit to existing funded customer account',
      tag: 'DEPOSIT · CASH_IN',
      txLabel: 'PRESET-CASHIN-03',
      data: {
        step: 42,
        type: 'CASH_IN',
        amount: 10000,
        oldbalanceOrg: 5000,
        oldbalanceDest: 15000,
      },
    },
  ];



  const handleInputChange = (field: keyof RiskScoreRequest, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: field === 'type' ? value : Number(value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    if (!Number.isInteger(formData.step) || formData.step < 1) {
      setError({
        code: 'validation_error',
        message: 'Step must be a positive integer (hour index >= 1 in PaySim simulation).',
      });
      setLoading(false);
      return;
    }
    if (!Number.isFinite(formData.amount) || formData.amount < 0) {
      setError({
        code: 'validation_error',
        message: 'Transaction amount must be a finite non-negative number.',
      });
      setLoading(false);
      return;
    }
    if (
      !Number.isFinite(formData.oldbalanceOrg) ||
      formData.oldbalanceOrg < 0 ||
      !Number.isFinite(formData.oldbalanceDest) ||
      formData.oldbalanceDest < 0
    ) {
      setError({
        code: 'validation_error',
        message: 'Pre-transaction balances cannot be negative or non-finite.',
      });
      setLoading(false);
      return;
    }

    try {
      const response = await api.explainRisk(formData);
      setResult(response);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: 'network_error',
          message: err?.message || 'Failed to score and explain transaction.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const maxAbsContribution = result
    ? Math.max(0.001, ...result.feature_contributions.map((c) => Math.abs(c.contribution)))
    : 1;

  const maxAbsEncoded = result
    ? Math.max(0.001, ...result.encoded_contributions.map((c) => Math.abs(c.contribution)))
    : 1;

  // Live pre-flight derived telemetry preview from form inputs
  const derivedHour = (Math.max(1, Math.trunc(formData.step || 1)) - 1) % 24;
  const derivedRatio =
    formData.oldbalanceOrg > 0
      ? (formData.amount / formData.oldbalanceOrg).toFixed(4)
      : formData.amount > 0
      ? '∞ (Zero Origin)'
      : '0.0000';
  const isFullDrain =
    formData.oldbalanceOrg > 0 && Math.abs(formData.amount - formData.oldbalanceOrg) < 1e-6;

  return (
    <div className="space-y-6">
      {/* Top Workbench Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[#D5D7E6]">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#4F33D6]">
              Tools · PaySim benchmark
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#141526] text-[#2DD4BF] border border-[#1C2B45]">
              XGBOOST + TREESHAP
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#141526] tracking-tight mt-0.5">
            Transaction model check
          </h1>
          <p className="text-xs text-[#475569] mt-0.5">
            Score one hypothetical transaction with the PaySim benchmark model and see which inputs moved the score (TreeSHAP log-odds contributions).
          </p>
        </div>

      </div>

      {/* Benchmark example selector */}
      <div className="forensic-panel p-4 space-y-3.5">
        <div className="pb-2.5 border-b border-[#DEE0EC] space-y-1.5">
          <span className="font-mono text-[11px] font-bold text-[#141526] uppercase tracking-wider">
            1. Load an example transaction
          </span>
          <p className="text-xs text-[#475569] leading-relaxed">
            This tool uses the PaySim benchmark model, trained on a public mobile-money simulation. It cannot score
            transactions from the sample cases: they come from different data, and the pre-transfer balances it needs
            are not in the case records. Use it to see how the benchmark model reacts to inputs you enter.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {presets.map((p, idx) => {
            const isSelected = linkedTx?.transactionId === p.txLabel;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setFormData(p.data);
                  setLinkedTx({ transactionId: p.txLabel });
                  setResult(null);
                  setError(null);
                }}
                className={`p-3 text-left rounded-md border transition-colors ${
                  isSelected
                    ? 'bg-[#141526] text-white border-[#6246EA]'
                    : 'bg-[#F7F7FC] hover:bg-[#F0FDFA] text-[#141526] border-[#D5D7E6] hover:border-[#6246EA]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`font-mono text-[10px] font-bold ${isSelected ? 'text-[#2DD4BF]' : 'text-[#4F33D6]'}`}>
                    {p.tag}
                  </span>
                  <span className={`font-mono text-[10px] ${isSelected ? 'text-slate-300' : 'text-[#64748B]'}`}>
                    ₹{p.data.amount.toLocaleString()}
                  </span>
                </div>
                <div className="text-xs font-bold">{p.name}</div>
                <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-slate-300' : 'text-[#64748B]'}`}>
                  {p.desc}
                </div>
              </button>
            );
          })}
        </div>

      </div>

      {/* Main Split Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pre-Transaction Telemetry Input (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="forensic-panel p-5">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="pb-3 border-b border-[#DEE0EC] flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#141526] flex items-center gap-2">
                  <SearchCheck className="w-4 h-4 text-[#6246EA]" />
                  <span>Pre-Transaction Features Schema</span>
                </h2>
                <span className="font-mono text-[10px] text-[#64748B]">5 RAW INPUTS</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="risk-step-input" className="block text-xs font-semibold text-[#141526] mb-1">
                    Simulation Step (Hour)
                  </label>
                  <input
                    id="risk-step-input"
                    type="number"
                    min="1"
                    step="1"
                    value={formData.step}
                    onChange={(e) => handleInputChange('step', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-md bg-[#F7F7FC] border border-[#D5D7E6] focus:bg-white focus:border-[#6246EA] outline-none font-mono"
                    required
                  />
                  <span className="text-[10px] font-mono text-[#64748B] mt-0.5 block">
                    hour_of_day: {derivedHour}:00 UTC
                  </span>
                </div>

                <div>
                  <label htmlFor="risk-type-select" className="block text-xs font-semibold text-[#141526] mb-1">
                    Transaction Rail / Type
                  </label>
                  <select
                    id="risk-type-select"
                    value={formData.type}
                    onChange={(e) => handleInputChange('type', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-md bg-[#F7F7FC] border border-[#D5D7E6] focus:bg-white focus:border-[#6246EA] outline-none font-mono font-semibold"
                    required
                  >
                    <option value="TRANSFER">TRANSFER</option>
                    <option value="CASH_OUT">CASH_OUT</option>
                    <option value="PAYMENT">PAYMENT</option>
                    <option value="CASH_IN">CASH_IN</option>
                    <option value="DEBIT">DEBIT</option>
                  </select>
                  <span className="text-[10px] font-mono text-[#64748B] mt-0.5 block">
                    PaySim category
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="risk-amount-input" className="block text-xs font-semibold text-[#141526] mb-1">
                  Transaction Amount (₹)
                </label>
                <input
                  id="risk-amount-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => handleInputChange('amount', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md bg-[#F7F7FC] border border-[#D5D7E6] focus:bg-white focus:border-[#6246EA] outline-none font-mono font-semibold"
                  required
                />
                <span className="text-[10px] font-mono text-[#64748B] mt-0.5 block">
                  Gross transfer value prior to settlement
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="risk-oldorg-input" className="block text-xs font-semibold text-[#141526] mb-1">
                    Origin Balance Before TX (₹)
                  </label>
                  <input
                    id="risk-oldorg-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.oldbalanceOrg}
                    onChange={(e) => handleInputChange('oldbalanceOrg', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-md bg-[#F7F7FC] border border-[#D5D7E6] focus:bg-white focus:border-[#6246EA] outline-none font-mono"
                    required
                  />
                  <span className="text-[10px] font-mono text-[#64748B] mt-0.5 block">
                    oldbalanceOrg
                  </span>
                </div>

                <div>
                  <label htmlFor="risk-olddest-input" className="block text-xs font-semibold text-[#141526] mb-1">
                    Destination Balance Before TX (₹)
                  </label>
                  <input
                    id="risk-olddest-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.oldbalanceDest}
                    onChange={(e) => handleInputChange('oldbalanceDest', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-md bg-[#F7F7FC] border border-[#D5D7E6] focus:bg-white focus:border-[#6246EA] outline-none font-mono"
                    required
                  />
                  <span className="text-[10px] font-mono text-[#64748B] mt-0.5 block">
                    oldbalanceDest
                  </span>
                </div>
              </div>

              {/* Live Derived Pre-Transaction Ratios */}
              <div className="p-3 rounded-md bg-[#F7F7FC] border border-[#DEE0EC] space-y-1.5 text-[11px] font-mono">
                <div className="flex items-center justify-between text-[#475569]">
                  <span>Amount-to-Origin Ratio:</span>
                  <span className="font-bold text-[#141526]">{derivedRatio}</span>
                </div>
                <div className="flex items-center justify-between text-[#475569]">
                  <span>Full Origin Balance Drain:</span>
                  <span className={isFullDrain ? 'font-bold text-red-700' : 'text-[#141526]'}>
                    {isFullDrain ? 'YES (100% Drain Signal)' : 'NO'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[#475569]">
                  <span>Zero Destination Balance:</span>
                  <span className={formData.oldbalanceDest === 0 ? 'font-bold text-amber-800' : 'text-[#141526]'}>
                    {formData.oldbalanceDest === 0 ? 'YES (oldbalanceDest = 0)' : 'NO'}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setFormData(presets[0].data);
                    setLinkedTx(null);
                    setResult(null);
                    setError(null);
                  }}
                  className="px-3 py-2 rounded-md border border-[#D5D7E6] bg-white hover:bg-[#F7F7FC] text-xs font-semibold text-[#475569] hover:text-[#141526] flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 px-4 rounded-md bg-[#6246EA] hover:bg-[#4F33D6] text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <span>Scoring &amp; Explaining...</span>
                  ) : (
                    <>
                      <span>Score &amp; Explain Prediction</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Leakage-Safe Constraint Notice */}
          <div className="p-4 rounded-md bg-[#141526] text-slate-300 border border-[#1C2B45] text-xs space-y-1.5">
            <div className="font-mono text-[11px] font-semibold text-[#2DD4BF] flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              <span>LEAKAGE-SAFE PRE-TRANSACTION PIPELINE</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Both <code className="text-white">/api/risk/score</code> and <code className="text-white">/api/risk/explain</code> strictly reject post-transaction balance fields (<code className="text-white">newbalanceOrig</code>, <code className="text-white">newbalanceDest</code>) and account identifiers (<code className="text-white">nameOrig</code>, <code className="text-white">nameDest</code>).
            </p>
          </div>
        </div>

        {/* Right Column: Model Score, Threshold Ruler & TreeSHAP Contributions (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {error && (
            <div
              role="alert"
              className={`p-4 rounded-md border text-xs ${
                error.code === 'model_unavailable'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-red-50 border-red-300 text-red-900'
              }`}
            >
              <div className="font-bold mb-1 flex items-center gap-1.5">
                {error.code === 'model_unavailable' ? (
                  <ServerCrash className="w-4 h-4 text-amber-700" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-700" />
                )}
                <span>
                  {error.code === 'model_unavailable'
                    ? 'Model Artifact Unavailable (503)'
                    : error.code === 'validation_error'
                    ? 'Input Validation Error (422)'
                    : `Inference Error (${error.code})`}
                </span>
              </div>
              <p>{error.message}</p>
            </div>
          )}

          {loading && (
            <div className="forensic-panel p-10 text-center space-y-3">
              <div className="w-7 h-7 rounded-full border-2 border-[#6246EA] border-t-transparent animate-spin mx-auto" />
              <div className="text-sm font-bold text-[#141526]">
                Running XGBoost Inference &amp; TreeSHAP Decomposition...
              </div>
              <p className="text-xs text-[#64748B]">
                Evaluating pre-transaction feature pipeline and computing exact log-odds contributions.
              </p>
            </div>
          )}

          {!loading && result ? (
            <div className="space-y-4">
              {/* Top Prediction & Decision-Support Banner */}
              <div className="forensic-panel overflow-hidden">
                <div className="px-5 py-3 bg-[#141526] text-white border-b border-[#1C2B45] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#2DD4BF]">
                      Prediction Summary
                    </span>
                    {linkedTx && (
                      <span className="px-2 py-0.5 rounded bg-[#111C30] text-white border border-[#1C2B45] text-[10px] font-mono font-bold">
                        TX: {linkedTx.transactionId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-[#111C30] text-slate-300 border border-[#1C2B45]">
                      {result.model_version}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#111C30] text-[#2DD4BF] border border-[#1C2B45]">
                      {result.explanation_method}
                    </span>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                    <div className="md:col-span-5 p-4 rounded-md bg-[#F7F7FC] border border-[#DEE0EC]">
                      <div className="text-[11px] font-mono uppercase text-[#64748B]">
                        Predicted Fraud Risk Score
                      </div>
                      <div
                        className={`text-4xl font-extrabold font-mono tracking-tight mt-1 ${
                          result.review_recommended ? 'text-red-600' : 'text-emerald-700'
                        }`}
                      >
                        {(result.risk_score * 100).toFixed(2)}%
                      </div>
                      <div className="text-[11px] text-[#475569] mt-1 font-mono">
                        Score: {result.risk_score.toFixed(6)} | Threshold: {result.threshold.toFixed(4)}
                      </div>
                    </div>

                    <div className="md:col-span-7">
                      <div
                        className={`p-4 rounded-md border flex items-start gap-3 ${
                          result.review_recommended
                            ? 'bg-red-50/90 border-red-300 text-red-950'
                            : 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                        }`}
                      >
                        {result.review_recommended ? (
                          <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <ShieldCheck className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="text-xs">
                          <div className="font-bold">
                            {result.review_recommended
                              ? 'Flagged for Human Investigator Review (Score ≥ Threshold)'
                              : 'Below Review Threshold (Routine Score Pattern)'}
                          </div>
                          <div className="mt-1 leading-relaxed">
                            {result.review_recommended
                              ? 'The benchmark score is at or above its threshold (chosen on validation data). This is a prompt for review, not proof of fraud.'
                              : 'The benchmark score is below its threshold. That does not show the transaction is legitimate. Automated action taken: none.'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Additive Log-Odds Equation Strip */}
                  <div className="grid grid-cols-3 gap-2.5 p-3 rounded-md bg-[#F7F7FC] border border-[#DEE0EC] text-xs font-mono">
                    <div>
                      <span className="text-[10px] font-sans text-[#64748B] block">
                        Baseline Log-Odds (base_value)
                      </span>
                      <span className="font-bold text-[#141526]">
                        {result.base_value >= 0 ? `+${result.base_value.toFixed(4)}` : result.base_value.toFixed(4)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-sans text-[#64748B] block">
                        Net Feature Shift (∑ ϕ_i)
                      </span>
                      <span className="font-bold text-[#4F33D6]">
                        {result.raw_margin - result.base_value >= 0
                          ? `+${(result.raw_margin - result.base_value).toFixed(4)}`
                          : (result.raw_margin - result.base_value).toFixed(4)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-sans text-[#64748B] block">
                        Final Log-Odds → σ(raw_margin)
                      </span>
                      <span className="font-bold text-[#141526]">
                        {result.raw_margin.toFixed(4)} → {(result.risk_score * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Local Feature Contributions Waterfall Card */}
              <div className="forensic-panel p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DEE0EC]">
                  <div>
                    <h3 className="text-sm font-bold text-[#141526] flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[#6246EA]" />
                      <span>Local Feature Contributions ({result.prediction_scale} scale)</span>
                    </h3>
                    <p className="text-[11px] text-[#64748B] mt-0.5">
                      Positive bars (+) push log-odds toward higher fraud risk; negative bars (-) push it lower.
                    </p>
                  </div>

                  <div className="flex items-center p-0.5 rounded-md bg-[#DEE0EC] text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setContributionView('engineered')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        contributionView === 'engineered'
                          ? 'bg-[#141526] text-white'
                          : 'text-[#475569] hover:text-[#141526]'
                      }`}
                    >
                      Engineered Features ({result.feature_contributions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setContributionView('encoded')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        contributionView === 'encoded'
                          ? 'bg-[#141526] text-white'
                          : 'text-[#475569] hover:text-[#141526]'
                      }`}
                    >
                      One-Hot &amp; Encoded ({result.encoded_contributions.length})
                    </button>
                  </div>
                </div>

                {contributionView === 'engineered' ? (
                  <div className="space-y-2.5" data-testid="feature-contributions-list">
                    {result.feature_contributions.map((fc) => {
                      const pct = Math.min(100, (Math.abs(fc.contribution) / maxAbsContribution) * 100);
                      const isPos = fc.direction === 'increases_risk';
                      const isNeg = fc.direction === 'decreases_risk';

                      return (
                        <div
                          key={fc.feature}
                          className="p-3 rounded-md bg-[#F7F7FC] border border-[#DEE0EC] space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-[#141526]">{fc.label}</span>
                              <code className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-[#D5D7E6] text-[#334155] font-mono">
                                {fc.feature} = {typeof fc.value === 'number' ? fc.value.toLocaleString() : fc.value}
                              </code>
                              {fc.encoding === 'one_hot_summed' && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F0FDFA] text-[#4F33D6] border border-[#CCFBF1]">
                                  One-Hot Summed
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                              {isPos ? (
                                <span className="inline-flex items-center gap-1 text-red-800 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>+{fc.contribution.toFixed(4)} (Increases Risk)</span>
                                </span>
                              ) : isNeg ? (
                                <span className="inline-flex items-center gap-1 text-[#4F33D6] bg-[#F0FDFA] px-2 py-0.5 rounded border border-[#CCFBF1]">
                                  <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>{fc.contribution.toFixed(4)} (Decreases Risk)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[#64748B] bg-[#EEEFF7] px-2 py-0.5 rounded">
                                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>0.0000 (Neutral)</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="w-full h-2 bg-[#DEE0EC] rounded-xs overflow-hidden flex">
                            <div
                              style={{ width: `${Math.max(pct, 2)}%` }}
                              className={`h-full ${
                                isPos ? 'bg-red-600' : isNeg ? 'bg-[#6246EA]' : 'bg-slate-400'
                              }`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="encoded-contributions-list">
                    {result.encoded_contributions.map((ec) => {
                      const pct = Math.min(100, (Math.abs(ec.contribution) / maxAbsEncoded) * 100);
                      const isPos = ec.contribution > 1e-9;
                      const isNeg = ec.contribution < -1e-9;
                      return (
                        <div
                          key={ec.feature}
                          className="p-2.5 rounded-md bg-[#F7F7FC] border border-[#DEE0EC] flex items-center justify-between gap-4 text-xs"
                        >
                          <div className="min-w-48 font-mono">
                            <span className="font-bold text-[#141526]">{ec.feature}</span>
                            <span className="text-[#64748B] ml-2">(val: {ec.encoded_value})</span>
                          </div>
                          <div className="flex-1 h-2 bg-[#DEE0EC] rounded-xs overflow-hidden">
                            <div
                              style={{ width: `${Math.max(pct, 2)}%` }}
                              className={`h-full ${
                                isPos ? 'bg-red-600' : isNeg ? 'bg-[#6246EA]' : 'bg-slate-400'
                              }`}
                            />
                          </div>
                          <div
                            className={`font-mono font-bold w-24 text-right ${
                              isPos ? 'text-red-700' : isNeg ? 'text-[#4F33D6]' : 'text-[#64748B]'
                            }`}
                          >
                            {ec.contribution >= 0 ? `+${ec.contribution.toFixed(4)}` : ec.contribution.toFixed(4)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="p-4 rounded-md bg-[#F7F7FC] border border-[#DEE0EC] space-y-2 text-[11px] text-[#475569]">
                  <div className="font-bold text-[#141526] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#6246EA]" />
                    <span>Feature Representation &amp; Scope Limitations</span>
                  </div>
                  <p className="leading-relaxed">{result.representation_notes}</p>
                  <ul className="list-disc pl-4 space-y-1">
                    {result.limitations.map((lim, i) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                  <div className="pt-1.5 border-t border-[#DEE0EC] text-[#64748B]">
                    <strong className="text-[#141526]">Decision-Support Disclaimer:</strong> {result.disclaimer}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            !loading && (
              <div className="forensic-panel overflow-hidden">
                <div className="px-5 py-3 bg-[#141526] text-white border-b border-[#1C2B45] flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#2DD4BF]">
                    Pre-Flight Feature Vector &amp; Calibration Preview
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    Ready for TreeSHAP Decomposition
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded bg-[#F0FDFA] text-[#4F33D6] border border-[#CCFBF1]">
                      <Sliders className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#141526]">
                        Staged Transaction Vector ({formData.type} · ₹{formData.amount.toLocaleString()})
                      </h3>
                      <p className="text-xs text-[#475569] mt-0.5 leading-relaxed">
                        Click <strong>Score &amp; Explain Prediction</strong> on the left to execute the XGBoost classifier and compute exact local TreeSHAP log-odds contributions for the staged vector below.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                    <div className="p-3 rounded bg-[#F7F7FC] border border-[#DEE0EC]">
                      <span className="text-[10px] text-[#64748B] block">step / hour_of_day</span>
                      <span className="font-bold text-[#141526]">
                        {formData.step} ({derivedHour}:00 UTC)
                      </span>
                    </div>
                    <div className="p-3 rounded bg-[#F7F7FC] border border-[#DEE0EC]">
                      <span className="text-[10px] text-[#64748B] block">type (One-Hot)</span>
                      <span className="font-bold text-[#4F33D6]">{formData.type}</span>
                    </div>
                    <div className="p-3 rounded bg-[#F7F7FC] border border-[#DEE0EC]">
                      <span className="text-[10px] text-[#64748B] block">amount_to_orig_ratio</span>
                      <span className="font-bold text-[#141526]">{derivedRatio}</span>
                    </div>
                    <div className="p-3 rounded bg-[#F7F7FC] border border-[#DEE0EC]">
                      <span className="text-[10px] text-[#64748B] block">oldbalanceOrg</span>
                      <span className="font-bold text-[#141526]">₹{formData.oldbalanceOrg.toLocaleString()}</span>
                    </div>
                    <div className="p-3 rounded bg-[#F7F7FC] border border-[#DEE0EC]">
                      <span className="text-[10px] text-[#64748B] block">oldbalanceDest</span>
                      <span className="font-bold text-[#141526]">₹{formData.oldbalanceDest.toLocaleString()}</span>
                    </div>
                    <div className="p-3 rounded bg-[#F7F7FC] border border-[#DEE0EC]">
                      <span className="text-[10px] text-[#64748B] block">Review threshold</span>
                      <span className="font-bold text-amber-800">0.9983 (99.83%)</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
