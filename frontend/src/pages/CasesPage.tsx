import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  RefreshCw,
  ArrowRight,
  Filter,
  X,
  Briefcase,
  Activity,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  IndianRupee,
  FolderGit2,
  ArrowUpDown,
  SearchX,
  Inbox,
  AlertTriangle,
  CreditCard,
  FolderPlus,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { api, ApiError } from '../services/api';
import { FraudCase } from '../types/api';

export const CasesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const pageRef = useRef<HTMLDivElement>(null);

  const [cases, setCases] = useState<FraudCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 20;

  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount_desc' | 'amount_asc' | 'case_id'>('newest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Case Modal & Feedback
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    case_id: '',
    reported_origin_transaction_id: '',
    reported_amount: 50000,
    currency: 'INR',
    investigation_status: 'under_investigation' as const,
    description: '',
    created_by: 'investigator_ui',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  };

  const fetchCases = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCases(page * limit, limit);
      setCases(res.cases || []);
      setTotalCases(res.total || (res.cases ? res.cases.length : 0));
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch case records from the server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [page]);

  // Entrance animations via GSAP
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !pageRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from('#cases-header', {
        opacity: 0,
        y: -12,
        duration: 0.5,
        ease: 'power2.out',
      });
      gsap.from('.cases-summary-card', {
        opacity: 0,
        y: 16,
        stagger: 0.08,
        duration: 0.5,
        ease: 'power2.out',
        delay: 0.1,
      });
      gsap.from('#cases-registry-card', {
        opacity: 0,
        y: 16,
        duration: 0.55,
        ease: 'power2.out',
        delay: 0.2,
      });
    }, pageRef);

    return () => ctx.revert();
  }, []);

  // Update query params when search term changes
  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    if (val.trim()) {
      setSearchParams({ search: val.trim() });
    } else {
      setSearchParams({});
    }
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setSortBy('newest');
    setSearchParams({});
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);

    const trimmedCaseId = createForm.case_id.trim();
    const trimmedOriginTx = createForm.reported_origin_transaction_id.trim();
    const trimmedDescription = createForm.description.trim();

    if (!trimmedCaseId) {
      setCreateError('Case ID is required (e.g. FS-1043).');
      setCreateLoading(false);
      return;
    }
    if (!trimmedOriginTx) {
      setCreateError('Origin Transaction ID is required (e.g. TX_9901).');
      setCreateLoading(false);
      return;
    }
    if (createForm.reported_amount <= 0 || isNaN(createForm.reported_amount)) {
      setCreateError('Reported loss amount must be greater than zero.');
      setCreateLoading(false);
      return;
    }
    if (!trimmedDescription) {
      setCreateError('Case summary description is required.');
      setCreateLoading(false);
      return;
    }

    try {
      const created = await api.createCase({
        case_id: trimmedCaseId,
        reported_origin_transaction_id: trimmedOriginTx,
        reported_amount: Number(createForm.reported_amount),
        currency: createForm.currency,
        investigation_status: createForm.investigation_status,
        description: trimmedDescription,
        created_by: createForm.created_by,
      });

      setShowCreateModal(false);
      setCreateForm({
        case_id: '',
        reported_origin_transaction_id: '',
        reported_amount: 50000,
        currency: 'INR',
        investigation_status: 'under_investigation',
        description: '',
        created_by: 'investigator_ui',
      });
      showToast(`Case ${created.case_id} registered successfully.`);
      fetchCases();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.code === '409' || err.code === 'duplicate_entity' || err.code === 'HTTP_409') {
          setCreateError(`Case ID "${trimmedCaseId}" already exists. Please choose a unique case ID.`);
        } else {
          setCreateError(err.message || `Failed to create case: ${err.code}`);
        }
      } else {
        setCreateError(err?.message || 'Failed to create case due to a network or server issue.');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  // Real data calculations for Summary Cards
  const totalCasesCount = cases.length;
  const underInvestigationCount = cases.filter(
    (c) => c.investigation_status === 'under_investigation'
  ).length;
  const openCasesCount = cases.filter(
    (c) => c.investigation_status === 'open'
  ).length;
  const closedCasesCount = cases.filter(
    (c) => c.investigation_status === 'closed'
  ).length;

  const totalReportedLoss = useMemo(() => {
    return cases.reduce((acc, c) => acc + (Number(c.reported_amount) || 0), 0);
  }, [cases]);

  // Client-side filtering & sorting
  const filteredAndSortedCases = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const result = cases.filter((c) => {
      const matchesSearch =
        !query ||
        c.case_id.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.reported_origin_transaction_id.toLowerCase().includes(query);
      const matchesStatus =
        statusFilter === 'all' || c.investigation_status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime();
        case 'oldest':
          return new Date(a.reported_at).getTime() - new Date(b.reported_at).getTime();
        case 'amount_desc':
          return (Number(b.reported_amount) || 0) - (Number(a.reported_amount) || 0);
        case 'amount_asc':
          return (Number(a.reported_amount) || 0) - (Number(b.reported_amount) || 0);
        case 'case_id':
          return a.case_id.localeCompare(b.case_id);
        default:
          return 0;
      }
    });

    return result;
  }, [cases, searchTerm, statusFilter, sortBy]);

  const isFiltered = searchTerm !== '' || statusFilter !== 'all' || sortBy !== 'newest';

  // Status badge helper
  const renderStatusBadge = (statusVal: string) => {
    switch (statusVal) {
      case 'under_investigation':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#FFF4E6] text-[#C05621] border border-[#FCD5B5] shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500] animate-pulse" />
            <span>Under Investigation</span>
          </span>
        );
      case 'open':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
            <span>Open</span>
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#EAF7EE] text-[#166534] border border-[#BBF7D0] shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
            <span>Closed</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#FAF7F2] text-[#6B655B] border border-[#EAE3D6]">
            <span>{statusVal}</span>
          </span>
        );
    }
  };

  return (
    <div ref={pageRef} className="space-y-6">
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            className="fixed top-20 right-6 z-50 bg-[#1A1714] text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2.5 border border-[#3D3730]"
          >
            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. Page Heading */}
      <div id="cases-header" className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-[#EAE3D6]">
        <div>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#EA8500]">
            04 / INVESTIGATION CASES
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-[#1A1714] tracking-tight mt-0.5">
            Case Management
          </h1>
          <p className="text-xs text-[#6B655B] mt-1 max-w-2xl leading-relaxed">
            Review reported incidents, track investigation progress, and open a case to examine its accounts and transactions.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={fetchCases}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-[#1A1714] transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            title="Refresh Cases"
            aria-label="Refresh Cases"
          >
            <RefreshCw className={`w-4 h-4 text-[#EA8500] ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs hover:shadow-sm cursor-pointer"
            aria-label="Create New Case"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Case</span>
          </button>
        </div>
      </div>

      {/* 2. Compact Horizontal Summary Cards */}
      <div id="cases-summary-grid" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Cases */}
        <div className="cases-summary-card bg-white border border-[#EAE3D6] rounded-2xl p-4 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold text-[#8C857B] uppercase tracking-wider">
              TOTAL REGISTERED
            </span>
            <span className="p-1.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[#EA8500]">
              <Briefcase className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-display text-[#1A1714]">
              {totalCasesCount}
            </span>
            <span className="text-xs text-[#6B655B]">cases</span>
          </div>
          <p className="text-[11px] text-[#8C857B] mt-0.5">
            Forensic dossiers on record
          </p>
        </div>

        {/* Cases Under Investigation */}
        <div className="cases-summary-card bg-white border border-[#EAE3D6] rounded-2xl p-4 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold text-[#8C857B] uppercase tracking-wider">
              UNDER INVESTIGATION
            </span>
            <span className="p-1.5 rounded-lg bg-[#FFF4E6] border border-[#FCD5B5] text-[#C05621]">
              <Activity className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-display text-[#C05621]">
              {underInvestigationCount}
            </span>
            <span className="text-xs text-[#6B655B]">active</span>
          </div>
          <p className="text-[11px] text-[#8C857B] mt-0.5">
            Active fund tracing & review
          </p>
        </div>

        {/* Open Cases / Awaiting Review */}
        <div className="cases-summary-card bg-white border border-[#EAE3D6] rounded-2xl p-4 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold text-[#8C857B] uppercase tracking-wider">
              OPEN / AWAITING REVIEW
            </span>
            <span className="p-1.5 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8]">
              <AlertCircle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-display text-[#1D4ED8]">
              {openCasesCount}
            </span>
            <span className="text-xs text-[#6B655B]">triaged</span>
          </div>
          <p className="text-[11px] text-[#8C857B] mt-0.5">
            {closedCasesCount > 0 ? `${closedCasesCount} closed cases` : 'Initial incident triage'}
          </p>
        </div>

        {/* Total Reported Loss */}
        <div className="cases-summary-card bg-white border border-[#EAE3D6] rounded-2xl p-4 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold text-[#8C857B] uppercase tracking-wider">
              TOTAL REPORTED LOSS
            </span>
            <span className="p-1.5 rounded-lg bg-[#FFF8EE] border border-[#FCD5B5] text-[#EA8500]">
              <IndianRupee className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-display text-[#1A1714]">
              ₹{totalReportedLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs font-mono font-medium text-[#8C857B]">INR</span>
          </div>
          <p className="text-[11px] text-[#8C857B] mt-0.5">
            Alleged victim reports (pre-trace)
          </p>
        </div>
      </div>

      {/* 3. Search, Filters, and Sorting Toolbar */}
      <div className="bg-white border border-[#EAE3D6] rounded-2xl p-3.5 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px] max-w-xl">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C857B]" />
            <input
              type="text"
              placeholder="Search by Case ID (FS-1042), Origin TX (T001), or incident summary..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-9.5 pr-8 py-2 text-xs rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none font-mono text-[#1A1714] transition-all"
              aria-label="Search cases"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8C857B] hover:text-[#1A1714] cursor-pointer"
                title="Clear Search"
                aria-label="Clear Search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filters & Sorting */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Status Dropdown */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-mono text-[10px] uppercase font-bold text-[#8C857B] hidden sm:inline">
                Status:
              </span>
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-medium text-[#1A1714] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none cursor-pointer transition-all"
                  aria-label="Filter by status"
                >
                  <option value="all">All Statuses</option>
                  <option value="under_investigation">Under Investigation</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-mono text-[10px] uppercase font-bold text-[#8C857B] hidden sm:inline">
                Sort:
              </span>
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-medium text-[#1A1714] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none cursor-pointer transition-all"
                  aria-label="Sort cases"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="amount_desc">Highest Loss</option>
                  <option value="amount_asc">Lowest Loss</option>
                  <option value="case_id">Case ID (A-Z)</option>
                </select>
              </div>
            </div>

            {/* Clear Filters Button */}
            {isFiltered && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 rounded-xl border border-[#EAE3D6] bg-white hover:bg-[#FFF0F2] text-[#BE123C] text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset filters and sorting"
                aria-label="Clear Filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Summary Status Bar */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[#8C857B] pt-2 border-t border-[#FAF7F2]">
          <span>
            Showing <strong className="text-[#1A1714]">{filteredAndSortedCases.length}</strong> of{' '}
            <strong className="text-[#1A1714]">{cases.length}</strong> cases
          </span>
          {isFiltered && (
            <span className="text-[#EA8500] font-semibold">
              Filters active · ({filteredAndSortedCases.length} matched)
            </span>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-[#FFF0F2] border border-[#FECDD3] text-xs text-[#BE123C] flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchCases}
            className="px-3 py-1 rounded-lg bg-white border border-[#FECDD3] font-semibold text-[#BE123C] hover:bg-[#FFF0F2] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* 4. Cases Registry (Desktop Table & Mobile Stacked Cards) */}
      <div id="cases-registry-card" className="bg-white border border-[#EAE3D6] rounded-2xl shadow-xs overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF7F2] border-b border-[#EAE3D6] text-[#6B655B] font-mono text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-bold">Case Identifier</th>
                <th className="py-3 px-4 font-bold">Status</th>
                <th className="py-3 px-4 font-bold">Reported Loss</th>
                <th className="py-3 px-4 font-bold">Origin Transfer</th>
                <th className="py-3 px-4 font-bold">Incident Summary</th>
                <th className="py-3 px-4 font-bold">Reported Date</th>
                <th className="py-3 px-4 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE3D6]">
              {filteredAndSortedCases.map((c) => (
                <tr
                  key={c.case_id}
                  className="hover:bg-[#FFFBF6] transition-colors group cursor-pointer"
                  onClick={() => window.location.assign(`/app/cases/${encodeURIComponent(c.case_id)}`)}
                >
                  {/* Case Identifier */}
                  <td className="py-3.5 px-4 font-mono font-bold">
                    <Link
                      to={`/app/cases/${c.case_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[#EA8500] hover:text-[#D27400] hover:underline flex items-center gap-1.5 font-bold"
                    >
                      <FolderGit2 className="w-4 h-4 shrink-0 text-[#EA8500]" />
                      <span>{c.case_id}</span>
                    </Link>
                  </td>

                  {/* Status Badge */}
                  <td className="py-3.5 px-4">
                    {renderStatusBadge(c.investigation_status)}
                  </td>

                  {/* Reported Loss */}
                  <td className="py-3.5 px-4">
                    <div className="font-mono font-bold text-xs text-[#1A1714]">
                      ₹{c.reported_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-[10px] font-mono text-[#8C857B]">
                      {c.currency} · Origin report
                    </div>
                  </td>

                  {/* Origin Transaction */}
                  <td className="py-3.5 px-4 font-mono">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714] text-[11px] font-bold">
                      <CreditCard className="w-3 h-3 text-[#8C857B]" />
                      <span>{c.reported_origin_transaction_id}</span>
                    </span>
                  </td>

                  {/* Incident Summary */}
                  <td className="py-3.5 px-4 text-[#6B655B] max-w-sm truncate" title={c.description}>
                    <span className="truncate block font-normal leading-relaxed text-[#475569]">
                      {c.description}
                    </span>
                  </td>

                  {/* Reported Date */}
                  <td className="py-3.5 px-4 font-mono text-[#8C857B] whitespace-nowrap text-[11px]">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-[#B8AF9F]" />
                      <span>
                        {new Date(c.reported_at).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </td>

                  {/* Open Case Action */}
                  <td className="py-3.5 px-4 text-right">
                    <Link
                      to={`/app/cases/${c.case_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FAF7F2] hover:bg-[#EA8500] text-[#1A1714] hover:text-white border border-[#EAE3D6] hover:border-[#D27400] text-xs font-semibold transition-all shadow-2xs group-hover:bg-[#EA8500] group-hover:text-white"
                      aria-label={`Open case dossier ${c.case_id}`}
                    >
                      <span>Open Case</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#EA8500] group-hover:text-white transition-colors" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Cards View */}
        <div className="md:hidden divide-y divide-[#EAE3D6]">
          {filteredAndSortedCases.map((c) => (
            <div
              key={c.case_id}
              className="p-4 hover:bg-[#FFFBF6] transition-colors space-y-3 cursor-pointer"
              onClick={() => window.location.assign(`/app/cases/${encodeURIComponent(c.case_id)}`)}
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/app/cases/${c.case_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono font-bold text-sm text-[#EA8500] flex items-center gap-1.5"
                >
                  <FolderGit2 className="w-4 h-4 shrink-0" />
                  <span>{c.case_id}</span>
                </Link>
                {renderStatusBadge(c.investigation_status)}
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-[#FAF7F2]">
                <div>
                  <span className="text-[10px] font-mono text-[#8C857B] uppercase block">
                    Reported Loss
                  </span>
                  <span className="font-mono font-bold text-sm text-[#1A1714]">
                    ₹{c.reported_amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}{' '}
                    <span className="text-[10px] text-[#8C857B]">{c.currency}</span>
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-mono text-[#8C857B] uppercase block">
                    Origin TX
                  </span>
                  <span className="font-mono font-semibold text-xs text-[#1A1714]">
                    {c.reported_origin_transaction_id}
                  </span>
                </div>
              </div>

              <p className="text-xs text-[#6B655B] line-clamp-2 leading-relaxed">
                {c.description}
              </p>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] font-mono text-[#8C857B] flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-[#B8AF9F]" />
                  {new Date(c.reported_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                <Link
                  to={`/app/cases/${c.case_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#EA8500] text-white text-xs font-semibold shadow-2xs"
                >
                  <span>Open Case</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Empty Search/Filter State */}
        {filteredAndSortedCases.length === 0 && !loading && cases.length > 0 && (
          <div className="py-12 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center mx-auto text-[#8C857B]">
              <SearchX className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold font-display text-[#1A1714]">
              No cases matching filter criteria
            </h3>
            <p className="text-xs text-[#6B655B] max-w-sm mx-auto">
              No cases match your active search '{searchTerm}' or status filter. Try clearing filters to view all records.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-4 py-1.5 rounded-xl bg-[#FAF7F2] hover:bg-[#FFF4E6] text-[#EA8500] border border-[#EAE3D6] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All Filters</span>
            </button>
          </div>
        )}

        {/* Zero Database Records Empty State */}
        {cases.length === 0 && !loading && !error && (
          <div className="py-16 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-center mx-auto text-[#8C857B]">
              <Inbox className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold font-display text-[#1A1714]">
              No investigation cases on record
            </h3>
            <p className="text-xs text-[#6B655B] max-w-sm mx-auto">
              There are currently no cases registered in the system. Use the button below to initiate your first case.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Case</span>
            </button>
          </div>
        )}

        {/* Loading State Shimmer */}
        {loading && (
          <div className="p-8 text-center text-[#8C857B] font-mono text-xs space-y-2">
            <RefreshCw className="w-5 h-5 mx-auto animate-spin text-[#EA8500]" />
            <p>Loading forensic case records...</p>
          </div>
        )}

        {/* Pagination Footer */}
        {totalCases > limit && (
          <div className="p-3.5 sm:p-4 bg-[#FAF7F2] border-t border-[#EAE3D6] flex items-center justify-between text-xs text-[#6B655B] font-mono">
            <span>
              Showing {filteredAndSortedCases.length} of {totalCases} total cases
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 rounded-lg border border-[#EAE3D6] bg-white hover:bg-[#FAF7F2] text-[#1A1714] disabled:opacity-40 cursor-pointer shadow-2xs font-semibold"
              >
                Previous
              </button>
              <span className="font-bold text-[#1A1714]">Page {page + 1}</span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= totalCases}
                className="px-3 py-1 rounded-lg border border-[#EAE3D6] bg-white hover:bg-[#FAF7F2] text-[#1A1714] disabled:opacity-40 cursor-pointer shadow-2xs font-semibold"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Create Investigation Case Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-[#1A1714]/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-white border border-[#EAE3D6] rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 bg-[#FAF7F2] border-b border-[#EAE3D6] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] font-bold text-[#EA8500] uppercase tracking-wider block">
                    NEW INVESTIGATION DOSSIER
                  </span>
                  <h2 className="text-base font-bold font-display text-[#1A1714]">
                    Create Investigation Case
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="p-1.5 rounded-lg text-[#8C857B] hover:text-[#1A1714] hover:bg-[#EAE3D6]/50 cursor-pointer transition-colors"
                  aria-label="Close dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5">
                {createError && (
                  <div className="mb-4 p-3 rounded-xl bg-[#FFF0F2] border border-[#FECDD3] text-xs text-[#BE123C] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{createError}</span>
                  </div>
                )}

                <form onSubmit={handleCreateSubmit} className="space-y-4">
                  {/* Case ID */}
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1714] mb-1">
                      Case Identifier <span className="text-[#EA8500]">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. FS-2026-002 or FS-1043"
                      value={createForm.case_id}
                      onChange={(e) => setCreateForm({ ...createForm, case_id: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none font-mono text-[#1A1714]"
                      required
                    />
                    <p className="text-[11px] text-[#8C857B] mt-1">
                      Unique alphanumeric code identifying this investigation.
                    </p>
                  </div>

                  {/* Origin TX & Amount */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#1A1714] mb-1">
                        Origin Transaction ID <span className="text-[#EA8500]">*</span>
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
                        className="w-full px-3 py-2 text-xs rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none font-mono text-[#1A1714]"
                        required
                      />
                      <p className="text-[11px] text-[#8C857B] mt-1">
                        Initial disputed transaction reported.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1A1714] mb-1">
                        Reported Loss (₹) <span className="text-[#EA8500]">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={createForm.reported_amount}
                        onChange={(e) =>
                          setCreateForm({ ...createForm, reported_amount: Number(e.target.value) })
                        }
                        className="w-full px-3 py-2 text-xs rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none font-mono text-[#1A1714]"
                        required
                      />
                      <p className="text-[11px] text-[#8C857B] mt-1">
                        Alleged fraudulent sum in INR.
                      </p>
                    </div>
                  </div>

                  {/* Investigation Status */}
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1714] mb-1">
                      Initial Status
                    </label>
                    <select
                      value={createForm.investigation_status}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          investigation_status: e.target.value as any,
                        })
                      }
                      className="w-full px-3 py-2 text-xs rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none text-[#1A1714] cursor-pointer"
                    >
                      <option value="under_investigation">Under Investigation (Active tracing)</option>
                      <option value="open">Open (Initial triage)</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  {/* Case Description */}
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1714] mb-1">
                      Incident Summary <span className="text-[#EA8500]">*</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Summary of victim report, alleged fraudulent hop, and counterparty context..."
                      value={createForm.description}
                      onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] focus:bg-white focus:border-[#EA8500] focus:ring-2 focus:ring-[#EA8500]/15 outline-none text-[#1A1714]"
                      required
                    />
                  </div>

                  {/* Actions */}
                  <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#FAF7F2]">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 text-xs font-semibold text-[#6B655B] hover:text-[#1A1714] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createLoading}
                      className="px-5 py-2 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {createLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Creating Case...</span>
                        </>
                      ) : (
                        <>
                          <FolderPlus className="w-4 h-4" />
                          <span>Save & Initiate Case</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
