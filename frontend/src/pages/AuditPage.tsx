import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
      badgeBg: 'bg-iris-wash',
      badgeText: 'text-iris',
      badgeBorder: 'border-warn-line',
      icon: UserCheck,
      summary: `Human adjudication: ${verdict.replace(/_/g, ' ')}${evidence}`,
    };
  }

  if (action.includes('case_created')) {
    return {
      category: 'case_changes',
      badgeLabel: 'Case Created',
      badgeBg: 'bg-iris-wash',
      badgeText: 'text-iris-deep',
      badgeBorder: 'border-iris-line',
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
      badgeBg: 'bg-ice-soft',
      badgeText: 'text-info',
      badgeBorder: 'border-ice-line',
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
      badgeBg: 'bg-ok-soft',
      badgeText: 'text-ok',
      badgeBorder: 'border-ok-line',
      icon: GitFork,
      summary: `Algorithmic fund trace lineage recorded${countStr}`,
    };
  }

  if (action.includes('transaction')) {
    const addedCount = details.added_count ?? 1;
    return {
      category: 'transactions',
      badgeLabel: 'Transactions Added',
      badgeBg: 'bg-well',
      badgeText: 'text-ink-soft',
      badgeBorder: 'border-line-strong',
      icon: Layers,
      summary: `${addedCount} transaction(s) appended to investigation scope`,
    };
  }

  return {
    category: 'system',
    badgeLabel: event.action.replace(/_/g, ' '),
    badgeBg: 'bg-well',
    badgeText: 'text-ink',
    badgeBorder: 'border-line',
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
        // Formula injection mitigation (covers whitespace-padded execution and pipe/percent triggers)
        const stripped = s.trimStart();
        if (stripped && ['=', '+', '-', '@', '|', '%', '\t', '\r'].includes(stripped[0])) {
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
    <div className="space-y-8 text-ink">
      {/* 1. Header and the audit store's own integrity properties (from the API, shown once loaded) */}
      <header data-reveal className="flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div className="min-w-0 max-w-3xl">
          <h1 className="page-title">Audit log</h1>
          <p className="mt-2 lede">Every recorded decision, case change and system calculation. Search, filter and export the record.</p>
          {!auditData?.integrity_status && <div className="mt-3 h-[26px] w-72 skeleton rounded-full" aria-hidden="true" />}
          {auditData?.integrity_status && (
            <div className="mt-3 min-h-[26px] flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white ring-1 ring-line px-2.5 py-1 font-semibold text-mute">
                Storage: {auditData.integrity_status.storage_backend}
              </span>
              {auditData.integrity_status.append_only_enforced && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft ring-1 ring-ok-line px-2.5 py-1 font-semibold text-ok">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok-fill" aria-hidden="true" />
                  Append-only enforced
                </span>
              )}
              <span className="inline-flex items-center rounded-full bg-white ring-1 ring-line px-2.5 py-1 font-semibold text-mute">
                {auditData.integrity_status.cryptographic_signatures ? 'Cryptographically signed' : 'Not cryptographically signed'}
              </span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {lastRefreshed && (
            <div className="text-right hidden sm:block">
              <span className="text-[11px] text-faint block">Last refreshed</span>
              <span className="font-mono text-xs font-semibold text-ink">
                {lastRefreshed.toLocaleTimeString()}
              </span>
            </div>
          )}

          <button
            onClick={fetchEvents}
            disabled={loading}
            className="btn-secondary py-2 px-4 text-xs font-semibold shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-iris ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
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
      </header>

      {/* Export feedback toast */}
      {exportNotice && (
        <div className="p-3.5 rounded-xl bg-ok-soft border border-ok-line text-xs text-ok flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Error notification */}
      {error && (
        <div className="p-4 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-danger" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchEvents}
            className="px-3 py-1 bg-white border border-danger-line rounded-lg font-semibold text-danger hover:bg-danger-soft"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Horizontal Summary Metrics */}
      <div
        data-reveal
        className="grid grid-cols-2 lg:grid-cols-5 gap-4"
      >
        {/* Total Events */}
        <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
          <span className="text-xs font-semibold text-faint block">
            Total audit records
          </span>
          <div className="font-display text-2xl sm:text-3xl font-bold text-ink">
            {auditData ? auditData.summary.total_events.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-mute block">
            {hasActiveFilters
              ? `${auditData?.total_count.toLocaleString() ?? 0} matching active filter`
              : 'All retained database records'}
          </span>
        </div>

        {/* Human reviews */}
        <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-iris-deep block">
              Human reviews
            </span>
            <UserCheck className="w-4 h-4 text-iris" />
          </div>
          <div className="font-display text-2xl sm:text-3xl font-bold text-iris-deep">
            {auditData ? auditData.summary.review_decisions_count.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-mute block">Adjudications &amp; mule verdicts</span>
        </div>

        {/* Case Changes */}
        <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-info block">
              Case status changes
            </span>
            <FolderGit2 className="w-4 h-4 text-info" />
          </div>
          <div className="font-display text-2xl sm:text-3xl font-bold text-ink">
            {auditData ? auditData.summary.case_status_changes_count.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-mute block">Lifecycle transitions &amp; updates</span>
        </div>

        {/* Trace Provenance */}
        <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ok block">
              Trace lineage events
            </span>
            <GitFork className="w-4 h-4 text-ok" />
          </div>
          <div className="font-display text-2xl sm:text-3xl font-bold text-ink">
            {auditData ? auditData.summary.trace_events_count.toLocaleString() : '—'}
          </div>
          <span className="text-[11px] text-mute block">Engine paths persisted</span>
        </div>

        {/* Most recent event */}
        <div className="p-5 rounded-2xl bg-white border border-line shadow-xs space-y-1 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-faint block">
              Most recent event
            </span>
            <Clock className="w-4 h-4 text-faint" />
          </div>
          <div className="font-display text-base sm:text-lg font-bold text-ink truncate">
            {auditData?.summary.most_recent_timestamp
              ? formatRelativeTime(auditData.summary.most_recent_timestamp)
              : 'None'}
          </div>
          <span className="text-[11px] text-faint font-mono block truncate">
            {auditData?.summary.most_recent_timestamp
              ? new Date(auditData.summary.most_recent_timestamp).toISOString().slice(0, 19).replace('T', ' ')
              : 'No recorded activity'}
          </span>
        </div>
      </div>

      {/* 3. Search & Filters Toolbar */}
      <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-well border border-line overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All Events' },
                { id: 'reviews', label: 'Human reviews' },
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
                  ? 'bg-white text-ink ring-1 ring-line shadow-[var(--shadow-xs)]'
                  : 'text-mute hover:text-ink'
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
              aria-label="Time range"
              value={timeRange}
              onChange={(e) => {
                setTimeRange(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-well border border-line text-xs font-semibold text-ink focus:outline-none focus:border-iris"
            >
              <option value="all">All Time</option>
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>

            {/* Actor Selector */}
            <select
              aria-label="Actor"
              value={actorFilter}
              onChange={(e) => {
                setActorFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-well border border-line text-xs font-semibold text-ink focus:outline-none focus:border-iris"
            >
              <option value="all">All Actors</option>
              <option value="investigator_ui">investigator_ui</option>
              <option value="tracer_service">tracer_service</option>
              <option value="system_seeder">system_seeder</option>
            </select>

            {/* Sort Order Selector */}
            <select
              aria-label="Sort order"
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-well border border-line text-xs font-semibold text-ink focus:outline-none focus:border-iris"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Search Input & Secondary Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-line">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search audit events"
              placeholder="Search across Case ID, Account ID, Actor, Action, or Notes..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-well border border-line text-xs text-ink placeholder-faint focus:outline-none focus:border-iris"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="sm:col-span-4 flex items-center gap-2">
            <input
              type="text"
              aria-label="Filter by case ID"
              placeholder="Filter by Case (e.g. FS-1042)"
              value={caseFilter}
              onChange={(e) => {
                setCaseFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl bg-well border border-line text-xs font-mono text-ink placeholder-faint focus:outline-none focus:border-iris"
            />
          </div>
        </div>

        {/* Active Filter Chips & Reset */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-line flex-wrap text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-faint text-[11px] font-semibold">Active Filters:</span>
              {activeCategory !== 'all' && (
                <span className="px-2 py-0.5 rounded-lg bg-well border border-line text-[11px] font-semibold flex items-center gap-1">
                  Category: {activeCategory}
                  <button onClick={() => setActiveCategory('all')}>
                    <X className="w-3 h-3 text-faint hover:text-ink" />
                  </button>
                </span>
              )}
              {timeRange !== 'all' && (
                <span className="px-2 py-0.5 rounded-lg bg-well border border-line text-[11px] font-semibold flex items-center gap-1">
                  Time: {timeRange}
                  <button onClick={() => setTimeRange('all')}>
                    <X className="w-3 h-3 text-faint hover:text-ink" />
                  </button>
                </span>
              )}
              {caseFilter && (
                <span className="px-2 py-0.5 rounded-lg bg-well border border-line text-[11px] font-semibold font-mono flex items-center gap-1">
                  Case: {caseFilter}
                  <button onClick={() => setCaseFilter('')}>
                    <X className="w-3 h-3 text-faint hover:text-ink" />
                  </button>
                </span>
              )}
              {actorFilter !== 'all' && (
                <span className="px-2 py-0.5 rounded-lg bg-well border border-line text-[11px] font-semibold font-mono flex items-center gap-1">
                  Actor: {actorFilter}
                  <button onClick={() => setActorFilter('all')}>
                    <X className="w-3 h-3 text-faint hover:text-ink" />
                  </button>
                </span>
              )}
              {searchTerm && (
                <span className="px-2 py-0.5 rounded-lg bg-well border border-line text-[11px] font-semibold flex items-center gap-1">
                  Search: "{searchTerm}"
                  <button onClick={() => setSearchTerm('')}>
                    <X className="w-3 h-3 text-faint hover:text-ink" />
                  </button>
                </span>
              )}
            </div>

            <button
              onClick={handleResetFilters}
              className="text-[11px] font-semibold text-iris hover:underline cursor-pointer"
            >
              Reset All Filters
            </button>
          </div>
        )}
      </div>

      {/* 4. Global Audit Timeline / Registry Table */}
      <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div>
            <h2 className="text-base font-bold text-ink">Recorded system and investigation history</h2>
            <p className="text-xs text-mute">
              Ordered chronologically by server transaction timestamp. Select any row to open the full event inspector.
            </p>
          </div>
          <div className="text-right text-xs font-mono text-faint">
            {loading ? 'Fetching...' : `${totalCount.toLocaleString()} events recorded`}
          </div>
        </div>

        {/* Loading state */}
        {loading && !auditData && (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 rounded-full border-3 border-iris border-t-transparent animate-spin mx-auto" />
            <p className="text-xs text-mute">Loading the audit trail…</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && auditData && auditData.events.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <History className="w-10 h-10 text-faint mx-auto opacity-50" />
            <div className="text-sm font-bold text-ink">No audit events found</div>
            <p className="text-xs text-mute max-w-md mx-auto">
              No recorded events matched the active filter criteria. Clear your search or time range filters to view all entries.
            </p>
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="btn-secondary mt-2 text-xs"
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
                <tr className="border-b border-line bg-well text-xs font-semibold text-mute">
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
              <tbody className="divide-y divide-line">
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
                        isSelected ? 'bg-iris-wash' : 'hover:bg-well'
                      }`}
                    >
                      {/* ID */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px] font-bold text-faint">
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
                        <div className="font-semibold text-ink">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </div>
                        <div className="text-[11px] text-faint">
                          {formatRelativeTime(event.timestamp)}
                        </div>
                      </td>

                      {/* Case ID */}
                      <td className="py-3.5 px-3.5 font-mono">
                        <Link
                          to={`/cases/${encodeURIComponent(event.case_id)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-iris hover:underline inline-flex items-center gap-1"
                        >
                          <span>{event.case_id}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                        </Link>
                      </td>

                      {/* Associated Entity */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px]">
                        {accountId ? (
                          <Link
                            to={`/cases/${encodeURIComponent(event.case_id)}?section=accounts&account=${encodeURIComponent(accountId)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-bold text-ink hover:text-iris hover:underline inline-flex items-center gap-1"
                          >
                            <span>{accountId}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                          </Link>
                        ) : (
                          <span className="text-mute">{event.entity_id || '—'}</span>
                        )}
                      </td>

                      {/* Actor */}
                      <td className="py-3.5 px-3.5 font-mono text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-well border border-line text-ink font-semibold">
                          {event.performed_by || 'Not recorded'}
                        </span>
                      </td>

                      {/* Outcome / Details */}
                      <td className="py-3.5 px-3.5 max-w-xs text-mute text-[11px] truncate">
                        {pres.summary}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-3.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(event);
                          }}
                          className="p-1.5 rounded-lg bg-white hover:bg-line border border-line text-ink transition-colors"
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-line text-xs">
            <div className="text-mute">
              Showing <span className="font-bold text-ink">{currentStart}</span> to{' '}
              <span className="font-bold text-ink">{currentEnd}</span> of{' '}
              <span className="font-bold text-ink">{totalCount.toLocaleString()}</span> recorded events
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center">
              {/* Page Size */}
              <div className="flex items-center gap-1.5 text-xs text-mute">
                <span>Rows:</span>
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded-lg bg-well border border-line text-xs font-semibold text-ink"
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
                  className="p-1.5 rounded-lg border border-line bg-white hover:bg-well disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-4 h-4 text-ink" />
                </button>
                <span className="px-2.5 font-mono text-xs font-semibold text-ink">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-line bg-white hover:bg-well disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                  title="Next Page"
                >
                  <ChevronRight className="w-4 h-4 text-ink" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. Audit Integrity & Governance Transparency Disclosure */}
      <div className="p-6 rounded-2xl bg-white border border-line shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-iris" />
            <h3 className="text-sm font-bold text-ink">Audit Architecture &amp; Integrity Disclosures</h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-well text-ink border border-line">
            Factual Provenance
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-well border border-line space-y-1">
            <span className="font-bold text-ink block">Persistence Architecture</span>
            <p className="text-[11px] text-mute leading-relaxed">
              Events are stored in SQLite table <code className="text-iris font-mono">audit_events</code> in{' '}
              <code className="text-ink font-mono">fraudshield.db</code>. Writes are managed exclusively by the
              FastAPI repository pattern.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-well border border-line space-y-1">
            <span className="font-bold text-ink block">Append-Only Application Model</span>
            <p className="text-[11px] text-mute leading-relaxed">
              The application layer exposes zero update or deletion endpoints for audit records. Review decisions and
              status updates always append a new chronological record.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-well border border-line space-y-1">
            <span className="font-bold text-ink block">Server Timestamps</span>
            <p className="text-[11px] text-mute leading-relaxed">
              Timestamps are generated at SQLite transaction commit time by the Python server UTC clock (<code className="text-ink font-mono">utc_now()</code>), preventing client clock drift.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-iris-wash border border-warn-line text-xs text-warn flex items-start gap-3">
          <Info className="w-5 h-5 text-iris flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-ink">Data Integrity &amp; Cryptographic Limitations Note</span>
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
            className="absolute inset-0 bg-ink/40 backdrop-blur-xs transition-opacity"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white border-l border-line shadow-2xl flex flex-col">
              {/* Drawer Header */}
              <div className="p-6 border-b border-line flex items-center justify-between bg-well">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-ink text-white">
                      EVENT #{selectedEvent.event_id ?? 'N/A'}
                    </span>
                    <span className="text-xs font-mono text-faint">
                      {selectedEvent.case_id}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-ink">
                    {selectedEvent.action.replace(/_/g, ' ').toUpperCase()}
                  </h3>
                </div>

                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-2 rounded-xl hover:bg-line text-mute hover:text-ink transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
                {/* Core Facts Card */}
                <div className="p-4 rounded-xl bg-well border border-line space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-faint block font-mono">Timestamp (UTC)</span>
                      <span className="font-mono font-semibold text-ink">
                        {new Date(selectedEvent.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block font-mono">Relative Age</span>
                      <span className="font-semibold text-ink">
                        {formatRelativeTime(selectedEvent.timestamp)}
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block font-mono">Actor / Identity</span>
                      <span className="font-mono font-semibold text-ink">
                        {selectedEvent.performed_by || 'Not recorded'}
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block font-mono">Entity Type</span>
                      <span className="font-mono font-semibold text-ink">
                        {selectedEvent.entity_type}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Case & Account Navigation */}
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to={`/cases/${encodeURIComponent(selectedEvent.case_id)}`}
                    className="p-3 rounded-xl bg-white border border-line hover:bg-well text-center font-semibold text-iris flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Open Case Dossier</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>

                  {extractAccountId(selectedEvent) && (
                    <Link
                      to={`/cases/${encodeURIComponent(selectedEvent.case_id)}?section=accounts&account=${encodeURIComponent(extractAccountId(selectedEvent)!)}`}
                      className="p-3 rounded-xl bg-white border border-line hover:bg-well text-center font-semibold text-ink flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>Account in case</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>

                {/* Structured Review Details */}
                {selectedEvent.details && (
                  <div className="space-y-4">
                    <h4 className="font-bold text-ink text-xs font-mono">
                      Recorded Decision &amp; Context
                    </h4>

                    {selectedEvent.details.new_review_state && (
                      <div className="p-3.5 rounded-xl bg-iris-wash border border-warn-line space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-warn">Verdict Transition</span>
                          <span className="font-mono font-bold text-iris">
                            {selectedEvent.details.old_review_state || 'none'} → {selectedEvent.details.new_review_state}
                          </span>
                        </div>
                        {selectedEvent.details.evidence_quality && (
                          <div className="text-[11px] text-warn">
                            Evidence Assessment:{' '}
                            <strong className="">{selectedEvent.details.evidence_quality}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedEvent.details.decision_reasons && selectedEvent.details.decision_reasons.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] text-faint font-mono block">Adjudication Rationale</span>
                        <div className="flex flex-wrap gap-1">
                          {selectedEvent.details.decision_reasons.map((r: string, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-well border border-line text-ink"
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
                          <span className="text-[11px] text-faint font-mono block">
                            Supporting Transactions
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {selectedEvent.details.supporting_transaction_ids.map((txId: string) => (
                              <span
                                key={txId}
                                className="px-2 py-0.5 rounded font-mono text-[11px] bg-well border border-line text-mute"
                              >
                                {txId}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                    {selectedEvent.details.notes && (
                      <div className="space-y-1">
                        <span className="text-[11px] text-faint font-mono block">Investigator Notes</span>
                        <div className="p-3 rounded-xl bg-well border border-line text-xs text-ink leading-relaxed whitespace-pre-wrap">
                          {selectedEvent.details.notes}
                        </div>
                      </div>
                    )}

                    {/* Trace Path Details */}
                    {selectedEvent.details.path_count !== undefined && (
                      <div className="p-3.5 rounded-xl bg-ok-soft border border-ok-line space-y-1">
                        <span className="font-bold text-ok block">Trace Path Persistence</span>
                        <p className="text-[11px] text-ok">
                          Recorded <strong>{selectedEvent.details.path_count}</strong> distinct fund-flow propagation paths across the graph topology.
                        </p>
                      </div>
                    )}

                    {/* Case Status Change Details */}
                    {selectedEvent.details.investigation_status && (
                      <div className="p-3.5 rounded-xl bg-ice-soft border border-ice-line space-y-1">
                        <span className="font-bold text-info block">Case Lifecycle Transition</span>
                        <div className="text-[11px] text-info">
                          Previous: <code>{selectedEvent.details.investigation_status.old}</code> → New:{' '}
                          <code className="font-bold">{selectedEvent.details.investigation_status.new}</code>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsible Raw JSON Payload */}
                <div className="space-y-2 pt-2 border-t border-line">
                  <button
                    onClick={() => setRawJsonExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between text-xs font-mono font-semibold text-mute hover:text-ink"
                  >
                    <span>Raw Persisted JSON Payload</span>
                    <span>{rawJsonExpanded ? '▲ Hide' : '▼ Show'}</span>
                  </button>

                  {rawJsonExpanded && (
                    <pre className="p-3 rounded-xl bg-ink text-well font-mono text-[11px] overflow-x-auto leading-relaxed max-h-64">
                      {JSON.stringify(selectedEvent, null, 2)}
                    </pre>
                  )}
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-line bg-well flex items-center justify-between text-xs">
                <span className="text-faint">Append-only through the app; not tamper-proof</span>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="btn-secondary"
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
