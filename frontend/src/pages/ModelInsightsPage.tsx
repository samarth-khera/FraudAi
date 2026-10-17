import React from 'react';
import {
  Cpu,
  BarChart2,
  CheckCircle2,
  AlertTriangle,
  Info,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

export const ModelInsightsPage: React.FC = () => {
  // Real metrics observed and extracted from ml/artifacts/model_v1/metrics.json
  const testMetrics = {
    testRows: 918617,
    fraudRows: 4006,
    prevalence: '0.44%',
    threshold: 0.99828559,
    precision: 0.98586,
    recall: 0.83575,
    f1: 0.90462,
    prAuc: 0.9828,
    rocAuc: 0.9999,
    confusionMatrix: {
      tp: 3348,
      fp: 48,
      fn: 658,
      tn: 914563,
    },
  };

  const modelComparisonData = [
    {
      name: 'Baseline Dummy Prior',
      precision: 0.0,
      recall: 0.0,
      prAuc: 0.4, // scaled for chart visibility
      f1: 0.0,
    },
    {
      name: 'Deployed: XGBoost (Pre-TX Only)',
      precision: 98.6,
      recall: 83.6,
      prAuc: 98.3,
      f1: 90.5,
    },
    {
      name: 'Comparison: With Post-Balance (Leaky)',
      precision: 99.9,
      recall: 99.3,
      prAuc: 99.9,
      f1: 99.6,
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">ML Model Performance & Validation</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            Offline Test Set Evaluation
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Empirical validation metrics for model_v1:xgboost evaluated on held-out PaySim time-split test data.
        </p>
      </div>

      {/* Dataset Notice */}
      <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">Synthetic Benchmark Notice</div>
          <p className="mt-0.5 leading-relaxed text-[11px] text-amber-800">
            All metrics shown are derived from the academic <strong>PaySim mobile money simulation</strong> (6,362,620 total rows). These represent offline test set validation results on 918,617 held-out transactions, not live bank production telemetry.
          </p>
        </div>
      </div>

      {/* Key Metric Highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-5 border border-slate-200/80">
          <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Test Precision</div>
          <div className="text-3xl font-extrabold text-indigo-600 mt-1">98.6%</div>
          <div className="text-[10px] text-slate-500 mt-1">Only 48 false positives out of 3,396 flags</div>
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200/80">
          <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Test Recall</div>
          <div className="text-3xl font-extrabold text-indigo-600 mt-1">83.6%</div>
          <div className="text-[10px] text-slate-500 mt-1">Detected 3,348 of 4,006 fraud transactions</div>
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200/80">
          <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">PR-AUC</div>
          <div className="text-3xl font-extrabold text-emerald-600 mt-1">0.9828</div>
          <div className="text-[10px] text-slate-500 mt-1">Area under Precision-Recall Curve</div>
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200/80">
          <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Calibrated Threshold</div>
          <div className="text-3xl font-extrabold text-slate-900 mt-1">0.9983</div>
          <div className="text-[10px] text-slate-500 mt-1">Selected on validation set for high precision</div>
        </div>
      </div>

      {/* Confusion Matrix & Trade-offs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Confusion Matrix (5 columns) */}
        <div className="lg:col-span-5 glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Held-Out Test Confusion Matrix</h2>
            <p className="text-[11px] text-slate-500">Evaluated on 918,617 transactions (steps 379–744)</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center text-xs">
            {/* True Negatives */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">True Negatives</span>
              <span className="text-xl font-bold font-mono text-slate-900">
                {testMetrics.confusionMatrix.tn.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">Legitimate cleared</span>
            </div>

            {/* False Positives */}
            <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200">
              <span className="text-[10px] font-bold text-amber-700 uppercase block mb-1">False Positives</span>
              <span className="text-xl font-bold font-mono text-amber-900">
                {testMetrics.confusionMatrix.fp.toLocaleString()}
              </span>
              <span className="text-[10px] text-amber-600 block mt-1 font-semibold">FPR: 0.0052%</span>
            </div>

            {/* False Negatives */}
            <div className="p-4 rounded-xl bg-rose-50/80 border border-rose-200">
              <span className="text-[10px] font-bold text-rose-700 uppercase block mb-1">False Negatives</span>
              <span className="text-xl font-bold font-mono text-rose-900">
                {testMetrics.confusionMatrix.fn.toLocaleString()}
              </span>
              <span className="text-[10px] text-rose-600 block mt-1 font-semibold">Missed fraud</span>
            </div>

            {/* True Positives */}
            <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200">
              <span className="text-[10px] font-bold text-emerald-700 uppercase block mb-1">True Positives</span>
              <span className="text-xl font-bold font-mono text-emerald-900">
                {testMetrics.confusionMatrix.tp.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">Correctly flagged</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 text-[11px] text-slate-600 space-y-1">
            <span className="font-bold text-slate-800">Operational Significance:</span>
            <p className="leading-relaxed">
              By maintaining a 98.6% precision at 0.9983 threshold, human analysts investigate only 3,396 total cases while capturing 3,348 real fraud events. This prevents overwhelming compliance teams with false alarms.
            </p>
          </div>
        </div>

        {/* Model Comparison Bar Chart (7 columns) */}
        <div className="lg:col-span-7 glass-card rounded-2xl p-6 border border-slate-200/80 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Model Architecture Comparison</h2>
              <p className="text-[11px] text-slate-500">Comparing deployed pre-transaction model against baseline</p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
              PR-AUC Focused
            </span>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelComparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} fontSize={10} />
                <YAxis
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                  fontSize={11}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(v: any) => [`${v}%`, '']}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    borderColor: '#e2e8f0',
                    fontSize: '11px',
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="precision" fill="#6366f1" name="Precision %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recall" fill="#8b5cf6" name="Recall %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="prAuc" fill="#10b981" name="PR-AUC %" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="p-3 rounded-xl bg-indigo-50/80 border border-indigo-100 text-[11px] text-indigo-900 leading-relaxed">
            <strong>Why Not Deploy Post-Balance?</strong> Although the comparison model with post-transaction balance achieves higher recall (99.3%), post-balance features cannot be reliably computed in real-time before transaction clearance and create serious data leakage risks. FraudShield AI strictly deploys the leakage-safe pre-transaction model.
          </div>
        </div>
      </div>
    </div>
  );
};
