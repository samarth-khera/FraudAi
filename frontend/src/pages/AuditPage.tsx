import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  FolderGit2,
  GitFork,
  HelpCircle,
  History,
  Info,
  Layers,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import {
  AuditEvent,
  AuditQueryParams,
  AuditSummaryMetrics,
  AuditIntegrityStatus,
  GlobalAuditResponse,
} from '../types/api';

// -----------------------------------------------------------------------------
// Helper: Event Category & Plain-English Interpretation
// -----------------------------------------------------------------------------

interface EventPresentation {
  category: 'reviews' | 'case_changes' | 'traces' | 'transactions' | 'system';
  badgeLabel: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  icon: React.FC<{ className?: string }>;
  summary: string;
}

function getEventPresentation(event: AuditEvent): EventPresentation {
  const action = (event.action || '').toLowerCase();
  const details = event.details || {};

  if (action.includes('review')) {
    const verdict = details.new_review_state || details.review_state || 'adjudicated';
    const evidence = details.evidence_quality ? ` (evidence: ${details.evidence_quality})` : '';
    return {
      category: 'reviews',
      badgeLabel: 'Review Recorded',
      badgeBg: 'bg-[#FFF8F0]',
      badgeText: 'text-[#EA8500]',
      badgeBorder: 'border-[#FDE68A]',
      icon: UserCheck,
      summary: `Human adjudication: ${verdict.replace(/_/g, ' ')}${evidence}`,
    };
  }

  if (action.includes('case_created')) {
    return {
      category: 'case_changes',
      badgeLabel: 'Case Created',
      badgeBg: 'bg-[#FAF5FF]',
      badgeText: 'text-[#6B21A8]',
      badgeBorder: 'border-[#E9D5FF]',
      icon: FolderGit2,
      summary: `New investigation case initialized for origin TX ${details.origin_tx || event.entity_id}`,
    };
  }

  if (action.includes('metadata') || action.includes('status')) {
    const statusChange = details.investigation_status;
    let desc = 'Case record modified';
    if (statusChange && typeof statusChange === 'object') {
      desc = `Status changed: ${statusChange.old || 'unknown'} → ${statusChange.new || 'updated'}`;
    }
    return {
      category: 'case_changes',
      badgeLabel: 'Status Updated',
      badgeBg: 'bg-[#EFF6FF]',
      badgeText: 'text-[#1E40AF]',
      badgeBorder: 'border-[#BFDBFE]',
      icon: FileText,
      summary: desc,
    };
  }

  if (action.includes('trace')) {
    const pathCount = details.path_count ?? details.paths_count;
    const countStr = pathCount !== undefined ? ` (${pathCount} paths)` : '';
    return {
      category: 'traces',
      badgeLabel: 'Trace Persisted',
      badgeBg: 'bg-[#ECFDF5]',
      badgeText: 'text-[#065F46]',
      badgeBorder: 'border-[#A7F3D0]',
      icon: GitFork,
      summary: `Algorithmic fund trace lineage recorded${countStr}`,
    };
  }

  if (action.includes('transaction')) {
    const addedCount = details.added_count ?? 1;
    return {
      category: 'transactions',
      badgeLabel: 'Transactions Added',
      badgeBg: 'bg-[#F1F5F9]',
      badgeText: 'text-[#334155]',
      badgeBorder: 'border-[#CBD5E1]',
      icon: Layers,
      summary: `${addedCount} transaction(s) appended to investigation scope`,
    };
  }

  return {
    category: 'system',
    badgeLabel: event.action.replace(/_/g, ' '),
    badgeBg: 'bg-[#FAF7F2]',
    badgeText: 'text-[#1A1714]',
    badgeBorder: 'border-[#EAE3D6]',
    icon: Shield,
    summary: `System action recorded for ${event.entity_type} ${event.entity_id}`,
  };
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (isNaN(diffMs)) return dateStr;

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const AuditPage: React.FC = () => {
  // Data state
  const [auditData, setAuditData] = useState<GlobalAuditResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<
    'all' | 'reviews' | 'case_changes' | 'traces' | 'transactions'
  >('all');
  const [timeRange, setTimeRange] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [caseFilter, setCaseFilter] = useState<string>('');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Inspector Drawer state
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [rawJsonExpanded, setRawJsonExpanded] = useState<boolean>(false);

  // Export state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Refs for animations
  const headerRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);

  // Calculate start_date from timeRange
  const startDateStr = useMemo(() => {
    if (timeRange === 'all') return undefined;
    const now = new Date();
    if (timeRange === '24h') now.setHours(now.getHours() - 24);
    else if (timeRange === '7d') now.setDate(now.getDate() - 7);
    else if (timeRange === '30d') now.setDate(now.getDate() - 30);
    return now.toISOString();
  }, [timeRange]);

  // Active Query Parameters
  const queryParams: AuditQueryParams = useMemo(() => {
    return {
      search: searchTerm.trim() || undefined,
      category: activeCategory !== 'all' ? activeCategory : undefined,
      case_id: caseFilter.trim() || undefined,
      performed_by: actorFilter !== 'all' ? actorFilter : undefined,
      start_date: startDateStr,
      skip: (page - 1) * pageSize,
      limit: pageSize,
      sort_order: sortOrder,
    };
  }, [searchTerm, activeCategory, caseFilter, actorFilter, startDateStr, page, pageSize, sortOrder]);

  // Fetch events from backend
  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getGlobalAudit(queryParams);
      setAuditData(res);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit history from server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [queryParams]);

  // GSAP Entrance
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      if (headerRef.current) {
        gsap.from(headerRef.current, {
          opacity: 0,
          y: -12,
          duration: 0.45,
          ease: 'power2.out',
        });
      }
      if (metricsRef.current) {
        gsap.from(metricsRef.current, {
          opacity: 0,
          y: 12,
          duration: 0.5,
          delay: 0.1,
          ease: 'power2.out',
        });
      }
    });

    return () => ctx.revert();
  }, []);

  // Filter resets
  const handleResetFilters = () => {
    setSearchTerm('');
    setActiveCategory('all');
    setTimeRange('all');
    setCaseFilter('');
    setActorFilter('all');
    setSortOrder('desc');
    setPage(1);
  };

  const hasActiveFilters =
    Boolean(searchTerm) ||
    activeCategory !== 'all' ||
    timeRange !== 'all' ||
    Boolean(caseFilter) ||
    actorFilter !== 'all' ||
    sortOrder !== 'desc';

  // Client-Side CSV Export (Current Page)
  const handleExportCurrentPage = () => {
    if (!auditData || auditData.events.length === 0) return;
    setIsExporting(true);
    try {
      const headers = [
        'Event ID',
        'Timestamp (UTC)',
        'Case ID',
        'Action',
        'Performed By',
        'Entity Type',
        'Entity ID',
        'Details JSON',
      ];

      const escapeCell = (val: any): string => {
        if (val === null || val === undefined) return '""';
        let s = String(val);
        // Formula injection mitigation
        if (s && ['=', '+', '-', '@', '\t', '\r'].includes(s[0])) {
          s = `'${s}`;
        }
        return `"${s.replace(/"/g, '""')}"`;
      };

      const rows = auditData.events.map((e) => [
        escapeCell(e.event_id),
        escapeCell(e.timestamp),
        escapeCell(e.case_id),
        escapeCell(e.action),
        escapeCell(e.performed_by),
        escapeCell(e.entity_type),
        escapeCell(e.entity_id),
        escapeCell(e.details ? JSON.stringify(e.details) : ''),
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fraudshield_audit_page_${page}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNotice(`Exported ${auditData.events.length} records from current page.`);
      setTimeout(() => setExportNotice(null), 4000);
    } catch {
      setError('Failed to generate client-side CSV.');
    } finally {
      setIsExporting(false);
    }
  };

  // Backend Filtered CSV Export
  const handleExportFilteredAll = () => {
    setIsExporting(true);
    try {
      const exportUrl = api.getAuditExportUrl(queryParams);
      window.location.href = exportUrl;
      setExportNotice('Server CSV export initiated for matching records.');
      setTimeout(() => setExportNotice(null), 4000);
    } catch {
      setError('Failed to initiate server-side CSV export.');
    } finally {
      setIsExporting(false);
    }
  };

  // Pagination calculation
  const totalCount = auditData?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const currentEnd = Math.min(totalCount, page * pageSize);

  // Extract associated account ID if event targets an account
  const extractAccountId = (event: AuditEvent): string | null => {
    if (event.details?.account_id) return event.details.account_id;
    if (event.entity_type === 'account') return event.entity_id;
    if (event.entity_type === 'account_review' && event.entity_id.includes(':')) {
      return event.entity_id.split(':')[1];
    }
    return null;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8 text-[#1A1714]">
      {/* 1. Header & Governance Status */}
      <div
        ref={headerRef}
        className="p-6 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#EA8500] bg-[#FFF8F0] px-2 py-0.5 rounded-md border border-[#FDE68A]">
              GOVERNANCE &amp; PROVENANCE
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              <span>Storage: Healthy (audit_events)</span>
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
              Append-Only Enforced
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#1A1714]">
            Audit &amp; Governance
          </h1>
          <p className="text-xs sm:text-sm text-[#6B655B] max-w-2xl leading-relaxed">
            Review investigation decisions, evidence history, and recorded system activity.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {lastRefreshed && (
            <div className="text-right hidden sm:block">
              <span className="text-[10px] text-[#8C857B] font-mono block">Last Verified</span>
              <span className="font-mono text-xs font-semibold text-[#1A1714]">
                {lastRefreshed.toLocaleTimeString()}
              </span>
            </div>
          )}

          <button
            onClick={fetchEvents}
            disabled={loading}
            className="btn-secondary py-2 px-4 text-xs font-semibold shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#EA8500] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Events</span>
          </button>

          {/* Export Dropdown / Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExportFilteredAll}
              disabled={isExporting || totalCount === 0}
              className="btn-primary py-2 px-4 text-xs font-semibold shadow-xs disabled:opacity-50"
              title="Export all records matching current filter (via backend CSV stream)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleExportCurrentPage}
              disabled={isExporting || (auditData?.events.length ?? 0) === 0}
              className="btn-secondary py-2 px-3 text-[11px] font-semibold shadow-xs disabled:opacity-50 hidden sm:inline-flex items-center gap-1"
              title="Export only currently viewed page rows"
            >
              <span>Page Only</span>
            </button>
          </div>
        </div>
      </div>

      {/* Export feedback toast */}
      {exportNotice && (
        <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-xs text-[#065F46] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Error notification */}
      {error && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-[#991B1B]" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchEvents}
            className="px-3 py-1 bg-white border border-[#FECACA] rounded-lg font-semibold text-[#991B1B] hover:bg-[#FEE2E2]"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Horizontal Summary Metrics */}
      <div
        ref={metricsRef}
        className="grid grid-cols-2 lg:grid-cols-5 gap-4"
      >
        {/* Total Events */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-1">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#8C857B] block">
            Total Audit Records
          </span>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#1A1714]">
            {auditData ? auditData.summary.total_events.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-[#6B655B] block">
            {hasActiveFilters
              ? `${auditData?.total_count.toLocaleString() ?? 0} matching active filter`
              : 'All retained database records'}
          </span>
        </div>

        {/* Human Reviews */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#EA8500] block">
              Human Reviews
            </span>
            <UserCheck className="w-4 h-4 text-[#EA8500]" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#EA8500]">
            {auditData ? auditData.summary.review_decisions_count.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-[#6B655B] block">Adjudications &amp; mule verdicts</span>
        </div>

        {/* Case Changes */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#1E40AF] block">
              Case Status Changes
            </span>
            <FolderGit2 className="w-4 h-4 text-[#1E40AF]" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#1A1714]">
            {auditData ? auditData.summary.case_status_changes_count.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-[#6B655B] block">Lifecycle transitions &amp; updates</span>
        </div>

        {/* Trace Provenance */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#065F46] block">
              Trace Lineage Events
            </span>
            <GitFork className="w-4 h-4 text-[#065F46]" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#1A1714]">
            {auditData ? auditData.summary.trace_events_count.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-[#6B655B] block">Engine paths persisted</span>
        </div>

        {/* Most Recent Event */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-1 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#8C857B] block">
              Most Recent Event
            </span>
            <Clock className="w-4 h-4 text-[#8C857B]" />
          </div>
          <div className="text-base sm:text-lg font-bold font-mono text-[#1A1714] truncate">
            {auditData?.summary.most_recent_timestamp
              ? formatRelativeTime(auditData.summary.most_recent_timestamp)
              : 'None'}
          </div>
          <span className="text-[11px] text-[#8C857B] font-mono block truncate">
            {auditData?.summary.most_recent_timestamp
              ? new Date(auditData.summary.most_recent_timestamp).toISOString().slice(0, 19).replace('T', ' ')
              : 'No recorded activity'}
          </span>
        </div>
      </div>

      {/* 3. Search & Filters Toolbar */}
      <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All Events' },
                { id: 'reviews', label: 'Human Reviews' },
                { id: 'case_changes', label: 'Case Status' },
                { id: 'traces', label: 'Traces' },
                { id: 'transactions', label: 'Transactions' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  activeCategory === cat.id
                    ? 'bg-[#1A1714] text-white shadow-xs'
                    : 'text-[#6B655B] hover:text-[#1A1714]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Quick Dropdown Selectors */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Time Range Selector */}
            <select
              value={timeRange}
              onChange={(e) => {
                setTimeRange(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-semibold text-[#1A1714] focus:outline-none focus:border-[#EA8500]"
            >
              <option value="all">All Time</option>
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>

            {/* Actor Selector */}
            <select
              value={actorFilter}
              onChange={(e) => {
                setActorFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-semibold text-[#1A1714] focus:outline-none focus:border-[#EA8500]"
            >
              <option value="all">All Actors</option>
              <option value="investigator_ui">investigator_ui</option>
              <option value="tracer_service">tracer_service</option>
              <option value="system_seeder">system_seeder</option>
            </select>

            {/* Sort Order Selector */}
            <select
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-semibold text-[#1A1714] focus:outline-none focus:border-[#EA8500]"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Search Input & Secondary Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-[#EAE3D6]">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-[#8C857B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search across Case ID, Account ID, Actor, Action, or Notes..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs text-[#1A1714] placeholder-[#8C857B] focus:outline-none focus:border-[#EA8500]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C857B] hover:text-[#1A1714]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="sm:col-span-4 flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by Case (e.g. FS-1042)"
              value={caseFilter}
              onChange={(e) => {
                setCaseFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-mono text-[#1A1714] placeholder-[#8C857B] focus:outline-none focus:border-[#EA8500]"
            />
          </div>
        </div>

        {/* Active Filter Chips & Reset */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EAE3D6] flex-wrap text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[#8C857B] text-[11px] font-semibold">Active Filters:</span>
              {activeCategory !== 'all' && (
                <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-semibold flex items-center gap-1">
                  Category: {activeCategory}
                  <button onClick={() => setActiveCategory('all')}>
                    <X className="w-3 h-3 text-[#8C857B] hover:text-[#1A1714]" />
                  </button>
                </span>
              )}
              {timeRange !== 'all' && (
                <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-semibold flex items-center gap-1">
                  Time: {timeRange}
                  <button onClick={() => setTimeRange('all')}>
                    <X className="w-3 h-3 text-[#8C857B] hover:text-[#1A1714]" />
                  </button>
                </span>
              )}
              {caseFilter && (
                <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-semibold font-mono flex items-center gap-1">
                  Case: {caseFilter}
                  <button onClick={() => setCaseFilter('')}>
                    <X className="w-3 h-3 text-[#8C857B] hover:text-[#1A1714]" />
                  </button>
                </span>
              )}
              {actorFilter !== 'all' && (
                <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-semibold font-mono flex items-center gap-1">
                  Actor: {actorFilter}
                  <button onClick={() => setActorFilter('all')}>
                    <X className="w-3 h-3 text-[#8C857B] hover:text-[#1A1714]" />
                  </button>
                </span>
              )}
              {searchTerm && (
                <span className="px-2 py-0.5 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] font-semibold flex items-center gap-1">
                  Search: "{searchTerm}"
                  <button onClick={() => setSearchTerm('')}>
                    <X className="w-3 h-3 text-[#8C857B] hover:text-[#1A1714]" />
                  </button>
                </span>
              )}
            </div>

            <button
              onClick={handleResetFilters}
              className="text-[11px] font-semibold text-[#EA8500] hover:underline cursor-pointer"
            >
              Reset All Filters
            </button>
          </div>
        )}
      </div>

      {/* 4. Global Audit Timeline / Registry Table */}
      <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE3D6]">
          <div>
            <h2 className="text-base font-bold text-[#1A1714]">Recorded System &amp; Investigation History</h2>
            <p className="text-xs text-[#6B655B]">
              Ordered chronologically by server transaction timestamp. Select any row to open the full event inspector.
            </p>
          </div>
          <div className="text-right text-xs font-mono text-[#8C857B]">
            {loading ? 'Fetching...' : `${totalCount.toLocaleString()} events recorded`}
          </div>
        </div>

        {/* Loading state */}
        {loading && !auditData && (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 rounded-full border-3 border-[#EA8500] border-t-transparent animate-spin mx-auto" />
            <p className="text-xs font-mono text-[#6B655B]">Querying append-only audit trail...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && auditData && auditData.events.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <History className="w-10 h-10 text-[#8C857B] mx-auto opacity-50" />
            <div className="text-sm font-bold text-[#1A1714]">No audit events found</div>
            <p className="text-xs text-[#6B655B] max-w-md mx-auto">
              No recorded events matched the active filter criteria. Clear your search or time range filters to view all entries.
            </p>
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="mt-2 px-4 py-2 rounded-xl bg-[#1A1714] text-white text-xs font-semibold cursor-pointer"
              >
                Clear All Filters
              </button>
            )}
          </div>
        )}

        {/* Events Table */}
        {auditData && auditData.events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#EAE3D6] bg-[#FAF7F2] font-mono text-[11px] text-[#6B655B]">
                  <th className="py-3 px-3.5">ID</th>
                  <th className="py-3 px-3.5">Category &amp; Action</th>
                  <th className="py-3 px-3.5">Timestamp (UTC)</th>
                  <th className="py-3 px-3.5">Case ID</th>
                  <th className="py-3 px-3.5">Associated Entity</th>
                  <th className="py-3 px-3.5">Actor</th>
                  <th className="py-3 px-3.5">Recorded Outcome / Details</th>
                  <th className="py-3 px-3.5 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE3D6]">
                {auditData.events.map((event) => {
                  const pres = getEventPresentation(event);
                  const Icon = pres.icon;
                  const accountId = extractAccountId(event);
                  const isSelected = selectedEvent?.event_id === event.event_id;

                  return (
                    <tr
                      key={event.event_id ?? `${event.case_id}-${event.timestamp}`}
                      onClick={() => setSelectedEvent(event)}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? 'bg-[#FFF8F0]' : 'hover:bg-[#FAF7F2]'
                      }`}
                    >
                      {/* ID */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px] font-bold text-[#8C857B]">
                        #{event.event_id ?? '—'}
                      </td>

                      {/* Category & Action */}
                      <td className="py-3.5 px-3.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${pres.badgeBg} ${pres.badgeText} ${pres.badgeBorder}`}
                        >
                          <Icon className="w-3 h-3 flex-shrink-0" />
                          <span>{pres.badgeLabel}</span>
                        </span>
                      </td>

                      {/* Timestamp */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px] whitespace-nowrap">
                        <div className="font-semibold text-[#1A1714]">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </div>
                        <div className="text-[10px] text-[#8C857B]">
                          {formatRelativeTime(event.timestamp)}
                        </div>
                      </td>

                      {/* Case ID */}
                      <td className="py-3.5 px-3.5 font-mono">
                        <Link
                          to={`/cases/${encodeURIComponent(event.case_id)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-[#EA8500] hover:underline inline-flex items-center gap-1"
                        >
                          <span>{event.case_id}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                        </Link>
                      </td>

                      {/* Associated Entity */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px]">
                        {accountId ? (
                          <Link
                            to={`/accounts/${encodeURIComponent(accountId)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-bold text-[#1A1714] hover:text-[#EA8500] hover:underline inline-flex items-center gap-1"
                          >
                            <span>{accountId}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                          </Link>
                        ) : (
                          <span className="text-[#6B655B]">{event.entity_id || '—'}</span>
                        )}
                      </td>

                      {/* Actor */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714] font-semibold">
                          {event.performed_by || 'Not recorded'}
                        </span>
                      </td>

                      {/* Outcome / Details */}
                      <td className="py-3.5 px-3.5 max-w-xs text-[#6B655B] text-[11px] truncate">
                        {pres.summary}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-3.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(event);
                          }}
                          className="p-1.5 rounded-lg bg-white hover:bg-[#EAE3D6] border border-[#EAE3D6] text-[#1A1714] transition-colors"
                          title="Inspect Event"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {auditData && totalCount > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-[#EAE3D6] text-xs">
            <div className="text-[#6B655B]">
              Showing <span className="font-bold text-[#1A1714]">{currentStart}</span> to{' '}
              <span className="font-bold text-[#1A1714]">{currentEnd}</span> of{' '}
              <span className="font-bold text-[#1A1714]">{totalCount.toLocaleString()}</span> recorded events
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center">
              {/* Page Size */}
              <div className="flex items-center gap-1.5 text-xs text-[#6B655B]">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded-lg bg-[#FAF7F2] border border-[#EAE3D6] text-xs font-semibold text-[#1A1714]"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {/* Prev / Next Buttons */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-[#EAE3D6] bg-white hover:bg-[#FAF7F2] disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-4 h-4 text-[#1A1714]" />
                </button>
                <span className="px-2.5 font-mono text-xs font-semibold text-[#1A1714]">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-[#EAE3D6] bg-white hover:bg-[#FAF7F2] disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                  title="Next Page"
                >
                  <ChevronRight className="w-4 h-4 text-[#1A1714]" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. Audit Integrity & Governance Transparency Disclosure */}
      <div className="p-6 rounded-2xl bg-white border border-[#EAE3D6] shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE3D6]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#EA8500]" />
            <h3 className="text-sm font-bold text-[#1A1714]">Audit Architecture &amp; Integrity Disclosures</h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#FAF7F2] text-[#1A1714] border border-[#EAE3D6]">
            Factual Provenance
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
            <span className="font-bold text-[#1A1714] block">Persistence Architecture</span>
            <p className="text-[11px] text-[#6B655B] leading-relaxed">
              Events are stored in SQLite table <code className="text-[#EA8500] font-mono">audit_events</code> in{' '}
              <code className="text-[#1A1714] font-mono">fraudshield.db</code>. Writes are managed exclusively by the
              FastAPI repository pattern.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
            <span className="font-bold text-[#1A1714] block">Append-Only Application Model</span>
            <p className="text-[11px] text-[#6B655B] leading-relaxed">
              The application layer exposes zero update or deletion endpoints for audit records. Review decisions and
              status updates always append a new chronological record.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-1">
            <span className="font-bold text-[#1A1714] block">Server Timestamps</span>
            <p className="text-[11px] text-[#6B655B] leading-relaxed">
              Timestamps are generated at SQLite transaction commit time by the Python server UTC clock (<code className="text-[#1A1714] font-mono">utc_now()</code>), preventing client clock drift.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#FFF8F0] border border-[#FDE68A] text-xs text-[#92400E] flex items-start gap-3">
          <Info className="w-5 h-5 text-[#EA8500] flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-[#1A1714]">Data Integrity &amp; Cryptographic Limitations Note</span>
            <p className="leading-relaxed">
              While the application layer enforces append-only semantics, SQLite itself does not employ cryptographic Merkle hash-chaining, digital signatures, or write-once-read-many (WORM) hardware. For production bank deployments requiring strict compliance (e.g. SOC2, PCI-DSS, RBI-AML), audit streams should be mirrored to an immutable external ledger or append-only cloud storage (such as AWS CloudTrail or QLDB).
            </p>
          </div>
        </div>
      </div>

      {/* 6. Slide-Over Event Detail Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div
            onClick={() => setSelectedEvent(null)}
            className="absolute inset-0 bg-[#1A1714]/40 backdrop-blur-xs transition-opacity"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white border-l border-[#EAE3D6] shadow-2xl flex flex-col">
              {/* Drawer Header */}
              <div className="p-6 border-b border-[#EAE3D6] flex items-center justify-between bg-[#FAF7F2]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#1A1714] text-white">
                      EVENT #{selectedEvent.event_id ?? 'N/A'}
                    </span>
                    <span className="text-xs font-mono text-[#8C857B]">
                      {selectedEvent.case_id}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-[#1A1714]">
                    {selectedEvent.action.replace(/_/g, ' ').toUpperCase()}
                  </h3>
                </div>

                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-2 rounded-xl hover:bg-[#EAE3D6] text-[#6B655B] hover:text-[#1A1714] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
                {/* Core Facts Card */}
                <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[#8C857B] block font-mono">Timestamp (UTC)</span>
                      <span className="font-mono font-semibold text-[#1A1714]">
                        {new Date(selectedEvent.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block font-mono">Relative Age</span>
                      <span className="font-semibold text-[#1A1714]">
                        {formatRelativeTime(selectedEvent.timestamp)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block font-mono">Actor / Identity</span>
                      <span className="font-mono font-semibold text-[#1A1714]">
                        {selectedEvent.performed_by || 'Not recorded'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block font-mono">Entity Type</span>
                      <span className="font-mono font-semibold text-[#1A1714]">
                        {selectedEvent.entity_type}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Case & Account Navigation */}
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to={`/cases/${encodeURIComponent(selectedEvent.case_id)}`}
                    className="p-3 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-center font-semibold text-[#EA8500] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Open Case Dossier</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>

                  {extractAccountId(selectedEvent) && (
                    <Link
                      to={`/accounts/${encodeURIComponent(extractAccountId(selectedEvent)!)}`}
                      className="p-3 rounded-xl bg-white border border-[#EAE3D6] hover:bg-[#FAF7F2] text-center font-semibold text-[#1A1714] flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>360° Profile</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>

                {/* Structured Review Details */}
                {selectedEvent.details && (
                  <div className="space-y-4">
                    <h4 className="font-bold text-[#1A1714] text-xs uppercase tracking-wider font-mono">
                      Recorded Decision &amp; Context
                    </h4>

                    {selectedEvent.details.new_review_state && (
                      <div className="p-3.5 rounded-xl bg-[#FFF8F0] border border-[#FDE68A] space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#92400E]">Verdict Transition</span>
                          <span className="font-mono font-bold text-[#EA8500]">
                            {selectedEvent.details.old_review_state || 'none'} → {selectedEvent.details.new_review_state}
                          </span>
                        </div>
                        {selectedEvent.details.evidence_quality && (
                          <div className="text-[11px] text-[#92400E]">
                            Evidence Assessment:{' '}
                            <strong className="uppercase">{selectedEvent.details.evidence_quality}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedEvent.details.decision_reasons && selectedEvent.details.decision_reasons.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] text-[#8C857B] font-mono block">Adjudication Rationale</span>
                        <div className="flex flex-wrap gap-1">
                          {selectedEvent.details.decision_reasons.map((r: string, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FAF7F2] border border-[#EAE3D6] text-[#1A1714]"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedEvent.details.supporting_transaction_ids &&
                      selectedEvent.details.supporting_transaction_ids.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[11px] text-[#8C857B] font-mono block">
                            Supporting Transactions
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {selectedEvent.details.supporting_transaction_ids.map((txId: string) => (
                              <span
                                key={txId}
                                className="px-2 py-0.5 rounded font-mono text-[10px] bg-[#FAF7F2] border border-[#EAE3D6] text-[#6B655B]"
                              >
                                {txId}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                    {selectedEvent.details.notes && (
                      <div className="space-y-1">
                        <span className="text-[11px] text-[#8C857B] font-mono block">Investigator Notes</span>
                        <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-xs text-[#1A1714] leading-relaxed whitespace-pre-wrap">
                          {selectedEvent.details.notes}
                        </div>
                      </div>
                    )}

                    {/* Trace Path Details */}
                    {selectedEvent.details.path_count !== undefined && (
                      <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] space-y-1">
                        <span className="font-bold text-[#065F46] block">Trace Path Persistence</span>
                        <p className="text-[11px] text-[#065F46]">
                          Recorded <strong>{selectedEvent.details.path_count}</strong> distinct fund-flow propagation paths across the graph topology.
                        </p>
                      </div>
                    )}

                    {/* Case Status Change Details */}
                    {selectedEvent.details.investigation_status && (
                      <div className="p-3.5 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] space-y-1">
                        <span className="font-bold text-[#1E40AF] block">Case Lifecycle Transition</span>
                        <div className="text-[11px] text-[#1E40AF]">
                          Previous: <code>{selectedEvent.details.investigation_status.old}</code> → New:{' '}
                          <code className="font-bold">{selectedEvent.details.investigation_status.new}</code>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsible Raw JSON Payload */}
                <div className="space-y-2 pt-2 border-t border-[#EAE3D6]">
                  <button
                    onClick={() => setRawJsonExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between text-xs font-mono font-semibold text-[#6B655B] hover:text-[#1A1714]"
                  >
                    <span>Raw Persisted JSON Payload</span>
                    <span>{rawJsonExpanded ? '▲ Hide' : '▼ Show'}</span>
                  </button>

                  {rawJsonExpanded && (
                    <pre className="p-3 rounded-xl bg-[#1A1714] text-[#FAF7F2] font-mono text-[10px] overflow-x-auto leading-relaxed max-h-64">
                      {JSON.stringify(selectedEvent, null, 2)}
                    </pre>
                  )}
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-[#EAE3D6] bg-[#FAF7F2] flex items-center justify-between text-xs">
                <span className="text-[#8C857B]">Immutable Log Verification</span>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-4 py-2 rounded-xl bg-[#1A1714] text-white font-semibold"
                >
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditPage;
