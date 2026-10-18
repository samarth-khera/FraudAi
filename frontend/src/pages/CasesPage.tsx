import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  RefreshCw,
  ArrowRight,
  Filter,
  X,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import { FraudCase } from '../types/api';
import { Badge } from '../components/common/Badge';

export const CasesPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const searchParam = searchParams.get('search') || '';

  const [cases, setCases] = useState<FraudCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 10;

  const [searchTerm, setSearchTerm] = useState(searchParam);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[#D6D3CD]">
        <div>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0F766E]">
            04 / INVESTIGATION CASE REGISTRY
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0B1322] tracking-tight mt-0.5">
            Case Management
          </h1>
          <p className="text-xs text-[#475569] mt-0.5">
            Browse, triage, and initiate persistent fraud investigation dossiers backed by SQLite audit provenance.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchCases}
            disabled={loading}
            className="p-2 rounded-md bg-white border border-[#D6D3CD] text-[#0B1322] hover:bg-[#FAF9F6] transition-colors"
            title="Refresh Cases"
          >
            <RefreshCw className={`w-4 h-4 text-[#0D9488] ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-md bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Case</span>
          </button>
        </div>
      </div>

      {/* Filters & Search Row */}
      <div className="forensic-panel p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#64748B]" />
          <input
            type="text"
            placeholder="Search by case ID (FS-1042), origin TX, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-xs rounded-md bg-[#FAF9F6] border border-[#D6D3CD] focus:bg-white focus:border-[#0D9488] outline-none font-mono"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-[#64748B]" />
          <span className="text-[#475569] font-mono text-[11px] uppercase">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-[#FAF9F6] border border-[#D6D3CD] text-[#0B1322] font-mono font-semibold outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="under_investigation">Under Investigation</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-red-50 border border-red-300 text-xs text-red-900">
          {error}
        </div>
      )}

      {/* Cases Table */}
      <div className="forensic-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F5F4F0] border-b border-[#E2DFD7] text-[#475569] font-mono text-[11px] uppercase">
              <tr>
                <th className="py-3 px-4">Case ID</th>
                <th className="py-3 px-4">Origin TX</th>
                <th className="py-3 px-4">Reported Loss</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Summary</th>
                <th className="py-3 px-4">Reported Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2DFD7]">
              {filteredCases.map((c) => (
                <tr key={c.case_id} className="hover:bg-[#FAF9F6] transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-[#0F766E]">
                    <Link to={`/app/cases/${c.case_id}`} className="hover:underline">
                      {c.case_id}
                    </Link>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[#334155]">{c.reported_origin_transaction_id}</td>
                  <td className="py-3.5 px-4 font-mono font-bold text-[#0B1322] tabular-nums">
                    ₹{c.reported_amount.toLocaleString()} {c.currency}
                  </td>
                  <td className="py-3.5 px-4">
                    <Badge variant="status" value={c.investigation_status} />
                  </td>
                  <td className="py-3.5 px-4 text-[#475569] max-w-md truncate" title={c.description}>
                    {c.description}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[#64748B] whitespace-nowrap">
                    {new Date(c.reported_at).toLocaleDateString()}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Link
                      to={`/app/cases/${c.case_id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#0B1322] hover:bg-[#111C30] text-white font-semibold transition-colors"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#2DD4BF]" />
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredCases.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#64748B]">
                    No cases found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-[#FAF9F6] border-t border-[#E2DFD7] flex items-center justify-between text-xs text-[#475569] font-mono">
          <span>
            Showing {cases.length} of {totalCases} total cases
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded border border-[#D6D3CD] bg-white hover:bg-[#FAF9F6] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="font-bold text-[#0B1322]">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= totalCases}
              className="px-3 py-1 rounded border border-[#D6D3CD] bg-white hover:bg-[#FAF9F6] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Create Case Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-[#070C16]/75 flex items-center justify-center p-4">
          <div className="forensic-panel max-w-lg w-full overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-[#0B1322] text-white border-b border-[#1C2B45] flex items-center justify-between">
              <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#2DD4BF]">
                Create Investigation Case
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5">
              {createError && (
                <div className="mb-4 p-3 rounded bg-red-50 border border-red-300 text-xs text-red-900">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1322] mb-1">
                    Case ID (Unique)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. FS-2026-001"
                    value={createForm.case_id}
                    onChange={(e) => setCreateForm({ ...createForm, case_id: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded bg-[#FAF9F6] border border-[#D6D3CD] focus:bg-white focus:border-[#0D9488] outline-none font-mono"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#0B1322] mb-1">
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
                      className="w-full px-3 py-2 text-xs rounded bg-[#FAF9F6] border border-[#D6D3CD] focus:bg-white focus:border-[#0D9488] outline-none font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#0B1322] mb-1">
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
                      className="w-full px-3 py-2 text-xs rounded bg-[#FAF9F6] border border-[#D6D3CD] focus:bg-white focus:border-[#0D9488] outline-none font-mono"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B1322] mb-1">
                    Investigation Status
                  </label>
                  <select
                    value={createForm.investigation_status}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, investigation_status: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs rounded bg-[#FAF9F6] border border-[#D6D3CD] focus:bg-white focus:border-[#0D9488] outline-none font-semibold"
                  >
                    <option value="open">Open</option>
                    <option value="under_investigation">Under Investigation</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B1322] mb-1">
                    Case Description
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Summary of victim report and alleged fraudulent flow..."
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded bg-[#FAF9F6] border border-[#D6D3CD] focus:bg-white focus:border-[#0D9488] outline-none"
                    required
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-[#475569] hover:text-[#0B1322]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createLoading}
                    className="px-5 py-2 rounded bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {createLoading ? 'Creating...' : 'Save & Initiate Case'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
