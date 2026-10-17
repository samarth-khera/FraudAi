import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FolderGit2,
  Plus,
  Search,
  RefreshCw,
  ArrowRight,
  Filter,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import { FraudCase } from '../types/api';
import { Badge } from '../components/common/Badge';

export const CasesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParam = searchParams.get('search') || '';

  const [cases, setCases] = useState<FraudCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 10;

  const [searchTerm, setSearchTerm] = useState(searchParam);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Case Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    case_id: '',
    reported_origin_transaction_id: '',
    reported_amount: 50000,
    currency: 'INR',
    investigation_status: 'open',
    description: '',
    created_by: 'investigator_ui',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCases(page * limit, limit);
      setCases(res.cases);
      setTotalCases(res.total);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch cases list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [page]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);

    if (!createForm.case_id.trim()) {
      setCreateError('Case ID is required');
      setCreateLoading(false);
      return;
    }

    try {
      await api.createCase(createForm);
      setShowCreateModal(false);
      setCreateForm({
        case_id: '',
        reported_origin_transaction_id: '',
        reported_amount: 50000,
        currency: 'INR',
        investigation_status: 'open',
        description: '',
        created_by: 'investigator_ui',
      });
      fetchCases();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setCreateError(`${err.code}: ${err.message}`);
      } else {
        setCreateError(err?.message || 'Failed to create case');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const filteredCases = cases.filter((c) => {
    const matchesSearch =
      c.case_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.reported_origin_transaction_id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.investigation_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Title & Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Case Management</h1>
          <p className="text-xs text-slate-500 mt-1">
            Browse, triage, and initiate persistent fraud investigation records.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchCases}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
            title="Refresh Cases"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Case</span>
          </button>
        </div>
      </div>

      {/* Filters & Search Row */}
      <div className="glass-card rounded-2xl p-4 border border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by case ID, TX ID, or summary..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-slate-500 font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="under_investigation">Under Investigation</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Cases Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-slate-200/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200/60 text-slate-500 font-semibold">
              <tr>
                <th className="py-3 px-4">Case ID</th>
                <th className="py-3 px-4">Origin TX</th>
                <th className="py-3 px-4">Reported Loss</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCases.map((c) => (
                <tr key={c.case_id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-indigo-700">
                    <Link to={`/app/cases/${c.case_id}`} className="hover:underline">
                      {c.case_id}
                    </Link>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{c.reported_origin_transaction_id}</td>
                  <td className="py-3 px-4 font-bold text-slate-900">
                    ₹{c.reported_amount.toLocaleString()} {c.currency}
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant="status" value={c.investigation_status} />
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs truncate" title={c.description}>
                    {c.description}
                  </td>
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {new Date(c.reported_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/app/cases/${c.case_id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition-colors"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredCases.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    No cases found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {cases.length} of {totalCases} total cases
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="font-semibold text-slate-700">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= totalCases}
              className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Create Case Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">Create Investigation Case</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Case ID (Unique)
                </label>
                <input
                  type="text"
                  placeholder="e.g. FS-2026-001"
                  value={createForm.case_id}
                  onChange={(e) => setCreateForm({ ...createForm, case_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Origin Transaction ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TX_9901"
                    value={createForm.reported_origin_transaction_id}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        reported_origin_transaction_id: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Reported Stolen Amount (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={createForm.reported_amount}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, reported_amount: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Investigation Status
                </label>
                <select
                  value={createForm.investigation_status}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, investigation_status: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none"
                >
                  <option value="open">Open</option>
                  <option value="under_investigation">Under Investigation</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Case Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Summary of victim report and alleged fraudulent flow..."
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 outline-none"
                  required
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 disabled:opacity-50"
                >
                  {createLoading ? 'Creating...' : 'Save & Initiate Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
