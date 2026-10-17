import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  SearchCheck,
  AlertTriangle,
  Cpu,
  Info,
  Sparkles,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import { RiskScoreRequest, RiskScoreResponse } from '../types/api';

export const TransactionCheckPage: React.FC = () => {
  const [formData, setFormData] = useState<RiskScoreRequest>({
    step: 12,
    type: 'TRANSFER',
    amount: 250000,
    oldbalanceOrg: 250000,
    oldbalanceDest: 0,
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    {
      name: 'High-Risk Transfer (Drainage Pattern)',
      desc: 'Large TRANSFER draining full balance to new destination',
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
      desc: 'Small grocery or retail payment from healthy balance',
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
      desc: 'Inbound cash deposit to existing customer account',
      data: {
        step: 42,
        type: 'CASH_IN',
        amount: 10000,
        oldbalanceOrg: 5000,
        oldbalanceDest: 15000,
      },
    },
  ];

  const handleInputChange = (field: keyof RiskScoreRequest, value: any) => {
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

    // Client-side pre-validation
    if (formData.step < 1) {
      setError('Step must be a positive integer (hour index in PaySim simulation)');
      setLoading(false);
      return;
    }
    if (formData.amount <= 0) {
      setError('Amount must be strictly greater than 0');
      setLoading(false);
      return;
    }
    if (formData.oldbalanceOrg < 0 || formData.oldbalanceDest < 0) {
      setError('Initial account balances cannot be negative');
      setLoading(false);
      return;
    }

    try {
      const response = await api.scoreRisk(formData);
      setResult(response);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(err?.message || 'Failed to score transaction. Backend model may be unavailable.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Real-Time Risk Scoring</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            XGBoost v1
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Evaluate individual pre-transaction parameters against the trained PaySim ML pipeline.
        </p>
      </div>

      {/* Preset selector buttons */}
      <div className="glass-card rounded-2xl p-4 border border-slate-200/80">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2.5">
          Load Pre-Configured Test Scenarios:
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {presets.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setFormData(p.data);
                setResult(null);
                setError(null);
              }}
              className="p-3 text-left rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all group"
            >
              <div className="text-xs font-bold text-slate-900 group-hover:text-indigo-700">
                {p.name}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Input Form Panel */}
        <div className="lg:col-span-7 glass-card rounded-2xl p-6 border border-slate-200/80">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
              <SearchCheck className="w-4 h-4 text-indigo-600" />
              <span>Pre-Transaction Features Schema</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Simulation Step (Hour)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formData.step}
                  onChange={(e) => handleInputChange('step', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  required
                />
                <span className="text-[10px] text-slate-600">Timeline step (1 - 744 in PaySim)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Transaction Rail / Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => handleInputChange('type', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  required
                >
                  <option value="TRANSFER">TRANSFER</option>
                  <option value="CASH_OUT">CASH_OUT</option>
                  <option value="PAYMENT">PAYMENT</option>
                  <option value="CASH_IN">CASH_IN</option>
                  <option value="DEBIT">DEBIT</option>
                </select>
                <span className="text-[10px] text-slate-600">Financial transfer mechanism</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Transaction Amount (₹)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none font-mono"
                required
              />
              <span className="text-[10px] text-slate-600">Gross transfer amount</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Origin Balance Before TX (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.oldbalanceOrg}
                  onChange={(e) => handleInputChange('oldbalanceOrg', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none font-mono"
                  required
                />
                <span className="text-[10px] text-slate-600">Sender starting ledger balance</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Destination Balance Before TX (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.oldbalanceDest}
                  onChange={(e) => handleInputChange('oldbalanceDest', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none font-mono"
                  required
                />
                <span className="text-[10px] text-slate-600">Recipient starting ledger balance</span>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setFormData(presets[0].data);
                  setResult(null);
                  setError(null);
                }}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <span>Evaluating...</span>
                ) : (
                  <>
                    <span>Execute Inference</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Prediction Results Display */}
        <div className="lg:col-span-5 space-y-4">
          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
              <div className="font-bold mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Inference Error</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          {result ? (
            <div className="glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Model Output
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  {result.model_version}
                </span>
              </div>

              {/* Score Display */}
              <div className="text-center py-4">
                <div className="text-xs text-slate-500 mb-1">Predicted Fraud Probability</div>
                <div
                  className={`text-5xl font-extrabold tracking-tight ${
                    result.review_recommended ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                >
                  {(result.risk_score * 100).toFixed(2)}%
                </div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono">
                  Exact: {result.risk_score.toFixed(6)} (Threshold: {result.threshold.toFixed(6)})
                </div>
              </div>

              {/* Review Recommendation */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  result.review_recommended
                    ? 'bg-rose-50/80 border-rose-200 text-rose-900'
                    : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                }`}
              >
                {result.review_recommended ? (
                  <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="text-xs">
                  <div className="font-bold">
                    {result.review_recommended
                      ? 'Human Review Recommended'
                      : 'Routine Activity Pattern'}
                  </div>
                  <div className="mt-0.5 opacity-90">
                    {result.review_recommended
                      ? 'Calculated risk score exceeds calibrated threshold. Case flag queued for compliance evaluation.'
                      : 'Calculated risk score is well below suspicious threshold. Normal transaction parameters.'}
                  </div>
                </div>
              </div>

              {/* Safeguard Disclaimer */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-[11px] text-slate-500 leading-relaxed">
                <strong>Decision-Support Notice:</strong> {result.disclaimer}
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-8 border border-slate-200/80 text-center text-slate-400 space-y-2">
              <Cpu className="w-10 h-10 mx-auto text-slate-300" />
              <div className="text-sm font-semibold text-slate-600">Awaiting Transaction Parameters</div>
              <div className="text-xs max-w-xs mx-auto">
                Fill in the pre-transaction features and execute inference to see the real-time XGBoost probability output.
              </div>
            </div>
          )}

          {/* Feature Constraint Card */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-900 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="w-4 h-4 text-indigo-600" />
              <span>Leakage-Safe Architecture</span>
            </div>
            <p className="text-[11px] text-indigo-800 leading-relaxed">
              This endpoint strictly rejects post-transaction features (e.g. <code>newbalanceOrig</code>) to prevent data leakage. Account identifiers (<code>nameOrig</code>, <code>nameDest</code>) are never used as model inputs to prevent demographic bias.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
