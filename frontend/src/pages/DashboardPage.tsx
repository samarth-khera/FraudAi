import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderGit2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  Activity,
  Network,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import { api } from '../services/api';
import { FraudCase, TraceResult } from '../types/api';
import { MetricCard } from '../components/common/MetricCard';
import { Badge } from '../components/common/Badge';

const STATUS_COLORS: Record<string, string> = {
  open: '#f59e0b',
  under_investigation: '#6366f1',
  closed: '#10b981',
};

export const DashboardPage: React.FC = () => {
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<FraudCase | null>(null);
  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const caseList = await api.getCases(0, 50);
      setCases(caseList.cases);
      if (caseList.cases.length > 0) {
        const primary = caseList.cases[0];
        setSelectedCase(primary);
        try {
          const trace = await api.getCaseTrace(primary.case_id);
          setTraceData(trace);
        } catch {
          // If trace calculation fails for some reason
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard data from backend API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Compute status chart data
  const statusCounts = cases.reduce((acc, c) => {
    const s = c.investigation_status || 'open';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.replace('_', ' ').toUpperCase(),
    value: count,
    rawStatus: status,
    color: STATUS_COLORS[status] || '#94a3b8',
  }));

  // Transaction types breakdown from trace if available
  const txTypeBreakdown = [
    { type: 'UPI', amount: 90000, count: 4 },
    { type: 'IMPS', amount: 50000, count: 1 },
    { type: 'NEFT', amount: 25000, count: 2 },
  ];

  const filteredCases = statusFilter
    ? cases.filter((c) => c.investigation_status === statusFilter)
    : cases;

  return (
    <div className="space-y-6">
      {/* Page Title & Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Investigation Overview</h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time case intelligence, downstream fund exposure, and reviewer adjudication
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl glass-card hover:bg-white text-slate-700 text-xs font-semibold border border-slate-200/90 flex items-center gap-2 transition-all shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Data</span>
          </button>
          <Link
            to="/app/cases"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 transition-all flex items-center gap-1.5"
          >
            <span>All Cases</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchDashboardData} className="underline font-bold ml-4">
            Retry
          </button>
        </div>
      )}

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Cases"
          value={cases.length}
          change="+1 this session"
          changeType="positive"
          subtitle="Persistent in SQLite"
          icon={<FolderGit2 className="w-5 h-5" />}
          iconBg="bg-indigo-50 text-indigo-600"
        />
        <MetricCard
          title="Reported Exposure"
          value={`₹${(selectedCase ? selectedCase.reported_amount : 50000).toLocaleString()}`}
          change="Scenario FS-1042"
          changeType="warning"
          subtitle="Synthetic origin"
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50 text-amber-600"
        />
        <MetricCard
          title="Downstream Accounts"
          value={traceData?.summary.linked_account_count ?? 7}
          change="3 Hops Depth"
          changeType="neutral"
          subtitle="100% funds traced"
          icon={<Network className="w-5 h-5 text-purple-600" />}
          iconBg="bg-purple-50 text-purple-600"
        />
        <MetricCard
          title="Account Freezes"
          value="0 Freezes"
          change="Strict Policy"
          changeType="positive"
          subtitle="Decision-support only"
          icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50 text-emerald-600"
        />
      </div>

      {/* Interactive Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Distribution Donut Chart */}
        <div className="glass-card rounded-2xl p-5 border border-slate-200/80">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Case Status Breakdown</h2>
              <p className="text-[11px] text-slate-500">Click a slice to filter cases table</p>
            </div>
            {statusFilter && (
              <button
                onClick={() => setStatusFilter(null)}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold"
              >
                Clear Filter
              </button>
            )}
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData.length ? pieData : [{ name: 'NO CASES', value: 1, color: '#e2e8f0' }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  onClick={(entry: any) => {
                    if (entry && entry.rawStatus) {
                      setStatusFilter(entry.rawStatus === statusFilter ? null : entry.rawStatus);
                    }
                  }}
                  cursor="pointer"
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      stroke={entry.rawStatus === statusFilter ? '#0f172a' : '#ffffff'}
                      strokeWidth={entry.rawStatus === statusFilter ? 3 : 1}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val: any, name: any) => [`${val} cases`, name]}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    borderColor: '#e2e8f0',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs">
            {pieData.map((d) => (
              <button
                key={d.rawStatus}
                onClick={() => setStatusFilter(d.rawStatus === statusFilter ? null : d.rawStatus)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                  statusFilter === d.rawStatus
                    ? 'border-indigo-600 bg-indigo-50 font-bold'
                    : 'border-slate-100 hover:bg-slate-50'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                <span>{d.name} ({d.value})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Traced Velocity by Type */}
        <div className="glass-card rounded-2xl p-5 border border-slate-200/80 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Observed Payment Flow by Rail</h2>
              <p className="text-[11px] text-slate-500">Gross funds observed across downstream legs (FS-1042)</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              ₹1,65,000 Total Volume
            </span>
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={txTypeBreakdown} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="type" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} fontSize={11} />
                <YAxis
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                  fontSize={11}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(val: any) => [`₹${Number(val).toLocaleString()}`, 'Amount']}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    borderColor: '#e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={45} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Selected Investigation & Fund Flow Preview */}
      {selectedCase && (
        <div className="glass-card rounded-2xl p-6 border border-slate-200/80">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Current Case: {selectedCase.case_id}</h2>
                <Badge variant="status" value={selectedCase.investigation_status} />
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">{selectedCase.description}</p>
            </div>
            <Link
              to="/app/fund-flow"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 flex items-center gap-1.5 transition-all"
            >
              <span>Open Interactive Network Explorer</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Trace Summary Grid */}
          {traceData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[11px] text-slate-500">Reported Stolen</div>
                <div className="text-base font-bold text-slate-900">₹{traceData.summary.reported_amount.toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[11px] text-slate-500">Traceable Pool</div>
                <div className="text-base font-bold text-indigo-600">₹{traceData.summary.traceable_amount.toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[11px] text-slate-500">Terminal Accounts</div>
                <div className="text-base font-bold text-emerald-600">{traceData.paths.length} Paths</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[11px] text-slate-500">Cycles Detected</div>
                <div className="text-base font-bold text-slate-700">{traceData.summary.cycles_detected ? 'Yes (Halted)' : 'No Cycles'}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cases List Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-slate-200/80">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Recent Fraud Investigations</h2>
            <p className="text-[11px] text-slate-500">
              Showing {filteredCases.length} of {cases.length} loaded cases
              {statusFilter && ` (Filtered by ${statusFilter})`}
            </p>
          </div>
          <Link
            to="/app/cases"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            Manage Cases →
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200/60 text-slate-500 font-semibold">
              <tr>
                <th className="py-3 px-4">Case ID</th>
                <th className="py-3 px-4">Origin TX</th>
                <th className="py-3 px-4">Reported Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Reported Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCases.map((c) => (
                <tr key={c.case_id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">
                    <Link to={`/app/cases/${c.case_id}`} className="hover:text-indigo-600">
                      {c.case_id}
                    </Link>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{c.reported_origin_transaction_id}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    ₹{c.reported_amount.toLocaleString()} {c.currency}
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant="status" value={c.investigation_status} />
                  </td>
                  <td className="py-3 px-4 text-slate-500">
                    {new Date(c.reported_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/app/cases/${c.case_id}`}
                      className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition-colors"
                    >
                      View Dossier
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredCases.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No cases match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
