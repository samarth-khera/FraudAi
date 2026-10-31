import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { api } from '../services/api';
import { FraudCase } from '../types/api';
import {
  CASE_STATUS_LABELS,
  formatDateTime,
  formatMoney,
  formatServerTime,
  firstSentence,
} from '../lib/format';
import { describeError } from '../lib/errors';
import { EmptyState, ErrorState, LoadingState, Pill, SyntheticDataNote, caseStatusTone } from '../components/ui/StateViews';

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'under_investigation', label: 'Under investigation' },
  { value: 'closed', label: 'Closed' },
];

export function nextActionFor(c: FraudCase): { label: string; section: string } {
  const decisions = c.review_progress?.decisions_recorded ?? 0;
  if (c.investigation_status === 'closed') return { label: 'View recorded history', section: 'review' };
  if (decisions === 0) return { label: 'Start: read the summary', section: 'summary' };
  return {
    label: `Continue review · ${decisions} decision${decisions === 1 ? '' : 's'} recorded`,
    section: 'review',
  };
}

function datasetLabel(c: FraudCase): string {
  return c.account_dataset === 'v2_synthetic_ledger' ? 'Synthetic account ledger' : 'Case records only';
}

export const InvestigationsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';

  const [cases, setCases] = useState<FraudCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setCases(null);
    api
      .getCases(0, 100)
      .then((res) => setCases(res.cases))
      .catch((err) => setError(describeError(err, 'The case list could not be loaded.')));
  }, []);

  useEffect(load, [load]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const visible = useMemo(() => {
    if (!cases) return [];
    const q = query.trim().toLowerCase();
    return cases.filter(
      (c) =>
        (status === 'all' || c.investigation_status === status) &&
        (!q || c.case_id.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    );
  }, [cases, query, status]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Cases</h1>
        <p className="mt-1.5 text-sm text-[#5C6079]">
          Each case starts from one reported transfer. Open a case to trace the money and record review decisions.
        </p>
        <SyntheticDataNote className="mt-2" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1">
          <span className="sr-only">Search cases</span>
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#868AA2]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search by case ID or description"
            className="w-full rounded-xl border border-[#E4E5F0] bg-white pl-10 pr-3 py-2.5 text-sm placeholder:text-[#868AA2] focus:border-[#6246EA]"
          />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
            className="w-full sm:w-auto rounded-xl border border-[#E4E5F0] bg-white px-3 py-2.5 text-sm font-medium"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <ErrorState title="Cases could not be loaded" message={error} onRetry={load} />}
      {!error && cases === null && <LoadingState label="Loading cases…" />}
      {!error && cases !== null && cases.length === 0 && (
        <EmptyState title="No cases yet" message="No investigation cases are stored on the server." />
      )}
      {!error && cases !== null && cases.length > 0 && visible.length === 0 && (
        <EmptyState
          title="No cases match"
          message="Try a different search or status filter."
          action={
            <button type="button" className="btn-secondary" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          }
        />
      )}

      {visible.length > 0 && (
        <ul className="space-y-3" aria-label="Cases">
          {visible.map((c) => {
            const next = nextActionFor(c);
            const lastActivity = c.review_progress?.last_decision_at ?? c.updated_at ?? null;
            return (
              <li key={c.case_id}>
                <Link
                  to={`/cases/${encodeURIComponent(c.case_id)}?section=${next.section}`}
                  className="card-interactive block p-5"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-[#141526]">{c.case_id}</span>
                        <Pill tone={caseStatusTone(c.investigation_status)}>
                          {CASE_STATUS_LABELS[c.investigation_status] ?? c.investigation_status}
                        </Pill>
                        <Pill>{datasetLabel(c)}</Pill>
                      </div>
                      <p className="mt-2 text-sm text-[#141526] leading-relaxed">{firstSentence(c.description)}</p>
                      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#5C6079]">
                        <div>
                          <dt className="inline">Reported amount: </dt>
                          <dd className="inline font-semibold text-[#141526]">{formatMoney(c.reported_amount, c.currency)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Reported: </dt>
                          <dd className="inline">{formatDateTime(c.reported_at)}</dd>
                        </div>
                        {lastActivity && (
                          <div>
                            <dt className="inline">
                              {c.review_progress?.last_decision_at ? 'Last decision: ' : 'Last updated: '}
                            </dt>
                            <dd className="inline">{formatServerTime(lastActivity)}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#4F33D6] shrink-0">
                      {next.label}
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default InvestigationsPage;
