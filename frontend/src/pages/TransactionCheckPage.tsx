import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
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
  Link2,
  ServerCrash,
  Layers,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import {
  RiskExplainResponse,
  RiskScoreRequest,
  TracedTransaction,
} from '../types/api';

interface LinkedTxMeta {
  transactionId: string;
  caseId: string;
  sender?: string;
  receiver?: string;
  originalRail?: string;
}

function mapRailToPaySimType(rail: string): string {
  const upper = (rail || '').toUpperCase();
  if (['CASH_IN', 'CASH_OUT', 'DEBIT', 'PAYMENT', 'TRANSFER'].includes(upper)) {
    return upper;
  }
  // UPI / IMPS / NEFT / RTGS peer/account transfers map to TRANSFER in PaySim's pre_transaction schema
  return 'TRANSFER';
}

function deriveStepFromTimestamp(ts?: string): number {
  if (!ts) return 11;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 11;
  return d.getUTCHours() + 1;
}

export const TransactionCheckPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [formData, setFormData] = useState<RiskScoreRequest>({
    step: 12,
    type: 'TRANSFER',
    amount: 250000,
    oldbalanceOrg: 250000,
    oldbalanceDest: 0,
  });

  const [linkedTx, setLinkedTx] = useState<LinkedTxMeta | null>(null);
  const [caseTransactions, setCaseTransactions] = useState<TracedTransaction[]>([]);
  const [contributionView, setContributionView] = useState<'engineered' | 'encoded'>('engineered');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskExplainResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const presets = [
    {
      name: 'High-Risk Transfer (Drainage Pattern)',
      desc: 'Large TRANSFER draining full origin balance to zero-balance destination',
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
      desc: 'Small retail PAYMENT from healthy origin balance',
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
      desc: 'Inbound CASH_IN deposit to existing customer account',
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

  // Load FS-1042 transactions so investigator can link directly to a case transaction
  useEffect(() => {
    api
      .getCaseTransactions('FS-1042')
      .then((res) => {
        setCaseTransactions((res.transactions as unknown as TracedTransaction[]) || []);
      })
      .catch(() => {
        // Non-blocking if case list isn't loaded
      });
  }, []);

  // Hydrate from URL query params when navigated from FundFlowPage or CaseDetailPage
  useEffect(() => {
    const txId = searchParams.get('txId');
    const caseId = searchParams.get('caseId') || 'FS-1042';
    const amountParam = searchParams.get('amount');
    const typeParam = searchParams.get('type');
    const stepParam = searchParams.get('step');
    const senderParam = searchParams.get('sender');
    const receiverParam = searchParams.get('receiver');

    if (txId && amountParam) {
      const amt = Number(amountParam);
      const stepNum = stepParam ? Math.max(1, Math.round(Number(stepParam))) : 11;
      const mappedType = mapRailToPaySimType(typeParam || 'TRANSFER');
      if (Number.isFinite(amt) && amt >= 0) {
        setFormData({
          step: stepNum,
          type: mappedType,
          amount: amt,
          oldbalanceOrg: amt,
          oldbalanceDest: 0,
        });
        setLinkedTx({
          transactionId: txId,
          caseId,
          sender: senderParam || undefined,
          receiver: receiverParam || undefined,
          originalRail: typeParam || undefined,
        });
      }
    }
  }, [searchParams]);

  const handleSelectCaseTx = (tx: TracedTransaction) => {
    const mappedType = mapRailToPaySimType(tx.transaction_type);
    const stepNum = deriveStepFromTimestamp(tx.timestamp);
    setFormData({
      step: stepNum,
      type: mappedType,
      amount: tx.amount,
      oldbalanceOrg: tx.amount,
      oldbalanceDest: 0,
    });
    setLinkedTx({
      transactionId: tx.transaction_id,
      caseId: 'FS-1042',
      sender: tx.sender_account_id,
      receiver: tx.receiver_account_id,
      originalRail: tx.transaction_type,
    });
    setResult(null);
    setError(null);
  };

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
    ? Math.max(
        0.001,
        ...result.feature_contributions.map((c) => Math.abs(c.contribution))
      )
    : 1;

  const maxAbsEncoded = result
    ? Math.max(
        0.001,
        ...result.encoded_contributions.map((c) => Math.abs(c.contribution))
      )
    : 1;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Explainable Transaction Risk Scoring
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              XGBoost + TreeSHAP
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Score single pre-transaction parameters and inspect exact additive log-odds feature contributions.
          </p>
        </div>

        {linkedTx && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50/90 border border-indigo-200 text-xs text-indigo-900">
            <Link2 className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
            <span>
              Linked to <strong>{linkedTx.transactionId}</strong>
              {linkedTx.sender && linkedTx.receiver ? ` (${linkedTx.sender} → ${linkedTx.receiver})` : ''}
              {linkedTx.originalRail ? ` [${linkedTx.originalRail}]` : ''}
            </span>
            <Link
              to={`/app/cases/${linkedTx.caseId}`}
              className="ml-1 underline font-semibold text-indigo-700 hover:text-indigo-900"
            >
              Case {linkedTx.caseId}
            </Link>
            <button
              type="button"
              onClick={() => {
                setLinkedTx(null);
                setSearchParams({});
              }}
              className="ml-1 text-[10px] text-slate-500 hover:text-slate-800 font-bold"
              title="Unlink transaction"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Preset & Case Transaction Selector Bar */}
      <div className="glass-card rounded-2xl p-4 border border-slate-200/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            1. Load Benchmark Scenario or Link Case FS-1042 Transaction:
          </span>
          {caseTransactions.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="case-tx-select" className="text-[11px] font-semibold text-slate-600">
                Link Case FS-1042 Leg:
              </label>
              <select
                id="case-tx-select"
                value={linkedTx?.transactionId || ''}
                onChange={(e) => {
                  const found = caseTransactions.find((t) => t.transaction_id === e.target.value);
                  if (found) handleSelectCaseTx(found);
                }}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-mono font-semibold text-slate-800"
              >
                <option value="">-- Select Case Transaction --</option>
                {caseTransactions.map((t) => (
                  <option key={t.transaction_id} value={t.transaction_id}>
                    {t.transaction_id}: {t.sender_account_id} → {t.receiver_account_id} (₹{t.amount.toLocaleString()} {t.transaction_type})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {presets.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setFormData(p.data);
                setLinkedTx({ transactionId: p.txLabel, caseId: 'FS-1042' });
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
        {/* Input Form Panel (5 columns) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="glass-card rounded-2xl p-6 border border-slate-200/80">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <h2 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
                <SearchCheck className="w-4 h-4 text-indigo-600" />
                <span>Pre-Transaction Features Schema</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="risk-step-input" className="block text-xs font-semibold text-slate-700 mb-1">
                    Simulation Step (Hour)
                  </label>
                  <input
                    id="risk-step-input"
                    type="number"
                    min="1"
                    step="1"
                    value={formData.step}
                    onChange={(e) => handleInputChange('step', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-500">
                    Derived hour_of_day: {((Math.max(1, formData.step) - 1) % 24)}:00
                  </span>
                </div>

                <div>
                  <label htmlFor="risk-type-select" className="block text-xs font-semibold text-slate-700 mb-1">
                    Transaction Rail / Type
                  </label>
                  <select
                    id="risk-type-select"
                    value={formData.type}
                    onChange={(e) => handleInputChange('type', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none"
                    required
                  >
                    <option value="TRANSFER">TRANSFER</option>
                    <option value="CASH_OUT">CASH_OUT</option>
                    <option value="PAYMENT">PAYMENT</option>
                    <option value="CASH_IN">CASH_IN</option>
                    <option value="DEBIT">DEBIT</option>
                  </select>
                  <span className="text-[10px] text-slate-500">PaySim transaction category</span>
                </div>
              </div>

              <div>
                <label htmlFor="risk-amount-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  Transaction Amount (₹)
                </label>
                <input
                  id="risk-amount-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => handleInputChange('amount', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none font-mono"
                  required
                />
                <span className="text-[10px] text-slate-500">Gross transfer value</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="risk-oldorg-input" className="block text-xs font-semibold text-slate-700 mb-1">
                    Origin Balance Before TX (₹)
                  </label>
                  <input
                    id="risk-oldorg-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.oldbalanceOrg}
                    onChange={(e) => handleInputChange('oldbalanceOrg', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none font-mono"
                    required
                  />
                  <span className="text-[10px] text-slate-500">Sender balance pre-settlement</span>
                </div>

                <div>
                  <label htmlFor="risk-olddest-input" className="block text-xs font-semibold text-slate-700 mb-1">
                    Destination Balance Before TX (₹)
                  </label>
                  <input
                    id="risk-olddest-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.oldbalanceDest}
                    onChange={(e) => handleInputChange('oldbalanceDest', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none font-mono"
                    required
                  />
                  <span className="text-[10px] text-slate-500">Receiver balance pre-settlement</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setFormData(presets[0].data);
                    setLinkedTx(null);
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
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <span>Scoring & Explaining...</span>
                  ) : (
                    <>
                      <span>Score & Explain Prediction</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Feature Constraint Card */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-900 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="w-4 h-4 text-indigo-600" />
              <span>Leakage-Safe Pre-Transaction Pipeline</span>
            </div>
            <p className="text-[11px] text-indigo-800 leading-relaxed">
              Both <code>/api/risk/score</code> and <code>/api/risk/explain</code> strictly reject post-transaction balance fields (<code>newbalanceOrig</code>, <code>newbalanceDest</code>) and account identifiers (<code>nameOrig</code>, <code>nameDest</code>).
            </p>
          </div>
        </div>

        {/* Prediction & Explainability Results Display (7 columns) */}
        <div className="lg:col-span-7 space-y-4">
          {error && (
            <div
              role="alert"
              className={`p-4 rounded-2xl border text-xs ${
                error.code === 'model_unavailable'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <div className="font-bold mb-1 flex items-center gap-1.5">
                {error.code === 'model_unavailable' ? (
                  <ServerCrash className="w-4 h-4 text-amber-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
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
            <div className="glass-card rounded-2xl p-10 border border-slate-200/80 text-center space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mx-auto" />
              <div className="text-sm font-semibold text-slate-700">
                Running XGBoost Inference & TreeSHAP Decomposition...
              </div>
              <p className="text-xs text-slate-500">
                Evaluating pre-transaction pipeline and calculating exact local log-odds feature contributions.
              </p>
            </div>
          )}

          {!loading && result ? (
            <div className="space-y-4">
              {/* Top Score & Decision Support Card */}
              <div className="glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Prediction Summary
                    </span>
                    {linkedTx && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono font-bold">
                        TX: {linkedTx.transactionId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      Model: {result.model_version}
                    </span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                      {result.explanation_method}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  {/* Score */}
                  <div className="md:col-span-5 text-center md:text-left p-4 rounded-xl bg-slate-50/80 border border-slate-200/60">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Predicted Fraud Risk Score
                    </div>
                    <div
                      className={`text-4xl font-extrabold tracking-tight mt-1 ${
                        result.review_recommended ? 'text-rose-600' : 'text-emerald-600'
                      }`}
                    >
                      {(result.risk_score * 100).toFixed(2)}%
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">
                      Score: {result.risk_score.toFixed(6)} | Threshold: {result.threshold.toFixed(4)}
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div className="md:col-span-7">
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
                            ? 'Flagged for Human Investigator Review (Score ≥ Threshold)'
                            : 'Below Review Threshold (Routine Score Pattern)'}
                        </div>
                        <div className="mt-1 opacity-90 leading-relaxed">
                          {result.review_recommended
                            ? 'Statistical risk signal exceeds the validation-calibrated threshold. This is a prioritization signal for human review, not proof of fraud.'
                            : 'Statistical risk score is below the calibrated review threshold. Automated action taken: none.'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Log-Odds Additive Equation Bar */}
                <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-xs font-mono">
                  <div>
                    <span className="text-[10px] font-sans text-slate-500 block">
                      Baseline Log-Odds (base_value)
                    </span>
                    <span className="font-bold text-slate-800">
                      {result.base_value >= 0 ? `+${result.base_value.toFixed(4)}` : result.base_value.toFixed(4)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-slate-500 block">
                      Net Feature Shift (∑ ϕ_i)
                    </span>
                    <span className="font-bold text-indigo-700">
                      {result.raw_margin - result.base_value >= 0
                        ? `+${(result.raw_margin - result.base_value).toFixed(4)}`
                        : (result.raw_margin - result.base_value).toFixed(4)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-slate-500 block">
                      Final Log-Odds → σ(raw_margin)
                    </span>
                    <span className="font-bold text-slate-900">
                      {result.raw_margin.toFixed(4)} → {(result.risk_score * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Local Feature Contributions Bar Chart Card */}
              <div className="glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-indigo-600" />
                      <span>Local Feature Contributions ({result.prediction_scale} scale)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Positive bars (+) push the model output toward higher fraud risk; negative bars (-) push it lower.
                    </p>
                  </div>

                  {/* Toggle Engineered vs Encoded */}
                  <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/80 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setContributionView('engineered')}
                      className={`px-2.5 py-1 rounded-lg transition-colors ${
                        contributionView === 'engineered'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Engineered Features ({result.feature_contributions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setContributionView('encoded')}
                      className={`px-2.5 py-1 rounded-lg transition-colors ${
                        contributionView === 'encoded'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      One-Hot & Encoded ({result.encoded_contributions.length})
                    </button>
                  </div>
                </div>

                {contributionView === 'engineered' ? (
                  <div className="space-y-3" data-testid="feature-contributions-list">
                    {result.feature_contributions.map((fc) => {
                      const pct = Math.min(100, (Math.abs(fc.contribution) / maxAbsContribution) * 100);
                      const isPos = fc.direction === 'increases_risk';
                      const isNeg = fc.direction === 'decreases_risk';

                      return (
                        <div
                          key={fc.feature}
                          className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/60 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{fc.label}</span>
                              <code className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700 font-mono">
                                {fc.feature} = {typeof fc.value === 'number' ? fc.value.toLocaleString() : fc.value}
                              </code>
                              {fc.encoding === 'one_hot_summed' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  One-Hot Summed
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                              {isPos ? (
                                <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>+{fc.contribution.toFixed(4)} (Increases Risk)</span>
                                </span>
                              ) : isNeg ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                  <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>{fc.contribution.toFixed(4)} (Decreases Risk)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>0.0000 (Neutral)</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Diverging Horizontal Bar */}
                          <div className="w-full h-2.5 bg-slate-200/70 rounded-full overflow-hidden flex">
                            <div
                              style={{ width: `${Math.max(pct, 2)}%` }}
                              className={`h-full rounded-full ${
                                isPos
                                  ? 'bg-rose-500'
                                  : isNeg
                                  ? 'bg-emerald-500'
                                  : 'bg-slate-400'
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
                          className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-between gap-4 text-xs"
                        >
                          <div className="min-w-48 font-mono">
                            <span className="font-bold text-slate-800">{ec.feature}</span>
                            <span className="text-slate-500 ml-2">(val: {ec.encoded_value})</span>
                          </div>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              style={{ width: `${Math.max(pct, 2)}%` }}
                              className={`h-full rounded-full ${
                                isPos ? 'bg-rose-500' : isNeg ? 'bg-emerald-500' : 'bg-slate-400'
                              }`}
                            />
                          </div>
                          <div
                            className={`font-mono font-bold w-24 text-right ${
                              isPos ? 'text-rose-700' : isNeg ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {ec.contribution >= 0 ? `+${ec.contribution.toFixed(4)}` : ec.contribution.toFixed(4)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Representation & Limitations Notes */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-[11px] text-slate-600">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Feature Representation & Scope Limitations</span>
                  </div>
                  <p className="leading-relaxed">{result.representation_notes}</p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-600">
                    {result.limitations.map((lim, i) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                  <div className="pt-1 border-t border-slate-200/70 text-slate-500">
                    <strong>Decision-Support Disclaimer:</strong> {result.disclaimer}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            !loading && (
              <div className="glass-card rounded-2xl p-10 border border-slate-200/80 text-center text-slate-400 space-y-2">
                <Cpu className="w-10 h-10 mx-auto text-slate-300" />
                <div className="text-sm font-semibold text-slate-600">
                  Awaiting Transaction Parameters
                </div>
                <div className="text-xs max-w-sm mx-auto leading-relaxed">
                  Select a preset or Case FS-1042 transaction above, or enter pre-transaction parameters and click <strong>Score & Explain Prediction</strong> to inspect the real-time XGBoost risk score and TreeSHAP feature contributions.
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
