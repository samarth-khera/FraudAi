import React from 'react';
import {
  AlertTriangle,
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
      prAuc: 0.4,
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
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-[#D6D3CD]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0F766E]">
            05 / OFFLINE MODEL VALIDATION
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0B1322] text-[#2DD4BF] border border-[#1C2B45]">
            TIME-SPLIT EVALUATION
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#0B1322] tracking-tight mt-0.5">
          ML Model Performance &amp; Validation
        </h1>
        <p className="text-xs text-[#475569] mt-0.5">
          Empirical validation metrics for <code className="font-mono">model_v1:xgboost</code> evaluated on 918,617 held-out PaySim time-split transactions.
        </p>
      </div>

      {/* Dataset Notice */}
      <div className="p-4 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">Synthetic Benchmark Notice</div>
          <p className="mt-0.5 leading-relaxed text-[11px] text-amber-900">
            All metrics shown are derived from the academic <strong>PaySim mobile money simulation</strong> (6,362,620 total rows). These represent offline test set validation results on 918,617 held-out transactions, not live bank production telemetry.
          </p>
        </div>
      </div>

      {/* Key Metric Highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="forensic-panel p-5 border-t-2 border-t-[#0D9488]">
          <div className="text-[11px] text-[#64748B] font-mono font-semibold uppercase tracking-wider">Test Precision</div>
          <div className="text-3xl font-extrabold font-mono text-[#0B1322] mt-1">98.6%</div>
          <div className="text-[11px] text-[#475569] mt-1">Only 48 false positives out of 3,396 flags</div>
        </div>

        <div className="forensic-panel p-5 border-t-2 border-t-[#0D9488]">
          <div className="text-[11px] text-[#64748B] font-mono font-semibold uppercase tracking-wider">Test Recall</div>
          <div className="text-3xl font-extrabold font-mono text-[#0F766E] mt-1">83.6%</div>
          <div className="text-[11px] text-[#475569] mt-1">Detected 3,348 of 4,006 fraud transactions</div>
        </div>

        <div className="forensic-panel p-5 border-t-2 border-t-emerald-600">
          <div className="text-[11px] text-[#64748B] font-mono font-semibold uppercase tracking-wider">PR-AUC</div>
          <div className="text-3xl font-extrabold font-mono text-emerald-700 mt-1">0.9828</div>
          <div className="text-[11px] text-[#475569] mt-1">Area under Precision-Recall Curve</div>
        </div>

        <div className="forensic-panel p-5 border-t-2 border-t-amber-600">
          <div className="text-[11px] text-[#64748B] font-mono font-semibold uppercase tracking-wider">Calibrated Threshold</div>
          <div className="text-3xl font-extrabold font-mono text-[#0B1322] mt-1">0.9983</div>
          <div className="text-[11px] text-[#475569] mt-1">Selected on validation set for high precision</div>
        </div>
      </div>

      {/* Confusion Matrix & Trade-offs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 forensic-panel p-5 space-y-4">
          <div className="pb-3 border-b border-[#E2DFD7]">
            <h2 className="text-sm font-bold text-[#0B1322]">Held-Out Test Confusion Matrix</h2>
            <p className="text-[11px] text-[#64748B]">Evaluated on 918,617 transactions (steps 379–744)</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center text-xs">
            <div className="p-4 rounded bg-[#FAF9F6] border border-[#D6D3CD]">
              <span className="text-[10px] font-mono font-bold text-[#64748B] uppercase block mb-1">True Negatives</span>
              <span className="text-xl font-bold font-mono text-[#0B1322]">
                {testMetrics.confusionMatrix.tn.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-700 block mt-1 font-semibold">Legitimate cleared</span>
            </div>

            <div className="p-4 rounded bg-amber-50 border border-amber-300">
              <span className="text-[10px] font-mono font-bold text-amber-800 uppercase block mb-1">False Positives</span>
              <span className="text-xl font-bold font-mono text-amber-950">
                {testMetrics.confusionMatrix.fp.toLocaleString()}
              </span>
              <span className="text-[10px] text-amber-800 block mt-1 font-semibold">FPR: 0.0052%</span>
            </div>

            <div className="p-4 rounded bg-red-50 border border-red-300">
              <span className="text-[10px] font-mono font-bold text-red-800 uppercase block mb-1">False Negatives</span>
              <span className="text-xl font-bold font-mono text-red-950">
                {testMetrics.confusionMatrix.fn.toLocaleString()}
              </span>
              <span className="text-[10px] text-red-800 block mt-1 font-semibold">Missed fraud</span>
            </div>

            <div className="p-4 rounded bg-emerald-50 border border-emerald-300">
              <span className="text-[10px] font-mono font-bold text-emerald-800 uppercase block mb-1">True Positives</span>
              <span className="text-xl font-bold font-mono text-emerald-950">
                {testMetrics.confusionMatrix.tp.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-800 block mt-1 font-semibold">Correctly flagged</span>
            </div>
          </div>

          <div className="p-3.5 rounded bg-[#FAF9F6] border border-[#E2DFD7] text-[11px] text-[#475569] space-y-1">
            <span className="font-bold text-[#0B1322] block">Operational Significance:</span>
            <p className="leading-relaxed">
              By maintaining 98.6% precision at the 0.9983 threshold, human analysts investigate 3,396 flagged transactions while capturing 3,348 real fraud events—minimizing false-alarm fatigue.
            </p>
          </div>
        </div>

        <div className="lg:col-span-7 forensic-panel p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E2DFD7]">
            <div>
              <h2 className="text-sm font-bold text-[#0B1322]">Model Architecture Comparison</h2>
              <p className="text-[11px] text-[#64748B]">Comparing deployed pre-transaction model against leaky post-balance benchmark</p>
            </div>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#F0FDFA] text-[#0F766E] border border-[#CCFBF1]">
              PR-AUC Focused
            </span>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelComparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2DFD7" />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#CFCBC0' }} fontSize={10} />
                <YAxis
                  tickLine={false}
                  axisLine={{ stroke: '#CFCBC0' }}
                  fontSize={11}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(v: any) => [`${v}%`, '']}
                  contentStyle={{
                    backgroundColor: '#0B1322',
                    color: '#F8FAFC',
                    borderRadius: '6px',
                    borderColor: '#1C2B45',
                    fontSize: '11px',
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="precision" fill="#0B1322" name="Precision %" radius={[3, 3, 0, 0]} />
                <Bar dataKey="recall" fill="#0D9488" name="Recall %" radius={[3, 3, 0, 0]} />
                <Bar dataKey="prAuc" fill="#D97706" name="PR-AUC %" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="p-3.5 rounded bg-[#0B1322] text-slate-300 border border-[#1C2B45] text-[11px] leading-relaxed">
            <strong className="text-[#2DD4BF]">Why Not Deploy Post-Balance?</strong> Although the comparison model with post-transaction balance achieves higher recall (99.3%), post-balance features cannot be reliably computed before settlement clearance and introduce severe target leakage. FraudShield AI strictly deploys the leakage-safe pre-transaction model.
          </div>
        </div>
      </div>
    </div>
  );
};
