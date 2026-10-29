import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../../services/api';
import { AuditEvent } from '../../types/api';
import { REVIEW_STATE_LABELS, auditActionLabel, evidenceQualityLabel, formatServerTime } from '../../lib/format';
import { describeError } from '../../lib/errors';
import { EmptyState, ErrorState, LoadingState } from '../ui/StateViews';

const SYSTEM_ACTORS: Record<string, string> = {
  system_seeder: 'System (sample data loader)',
  tracer_service: 'System (money-flow calculation)',
};

export const ActorLine: React.FC<{ event: AuditEvent }> = ({ event }) => {
  const system = SYSTEM_ACTORS[event.performed_by];
  if (system) return <span>{system}</span>;
  const verified = event.details?.reviewer_identity_verified;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <UserRound className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="font-semibold text-[#1A1714]">{event.performed_by}</span>
      {verified === true ? (
        <span className="inline-flex items-center gap-1 text-[#166534]">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> identity verified by API key
        </span>
      ) : verified === false ? (
        <span>· name typed by the reviewer, not verified</span>
      ) : (
        <span>· identity verification not recorded</span>
      )}
    </span>
  );
};

const EventDetails: React.FC<{ event: AuditEvent; caseAccountIds?: string[] }> = ({ event, caseAccountIds }) => {
  const d = event.details ?? {};
  if (event.action === 'account_review_recorded') {
    const from = d.old_review_state ? REVIEW_STATE_LABELS[d.old_review_state] ?? d.old_review_state : 'none';
    const to = REVIEW_STATE_LABELS[d.new_review_state] ?? d.new_review_state;
    return (
      <div className="mt-2 space-y-1.5 text-sm">
        <p>
          <span className="font-mono font-semibold">{d.account_id}</span>: {from} → <span className="font-semibold">{to}</span>
        </p>
        {d.evidence_quality && <p className="text-xs text-[#6B655B]">Evidence: {evidenceQualityLabel(d.evidence_quality)}</p>}
        {d.notes && <p className="rounded-lg bg-[#FAF7F2] p-2.5 text-[#1A1714] whitespace-pre-wrap">{d.notes}</p>}
        {Array.isArray(d.decision_reasons) && d.decision_reasons.length > 0 && (
          <p className="text-xs text-[#6B655B]">Reasons: {d.decision_reasons.join('; ')}</p>
        )}
        {Array.isArray(d.supporting_transaction_ids) && d.supporting_transaction_ids.length > 0 && (
          <p className="text-xs text-[#6B655B]">
            Cited transfers: <span className="font-mono">{d.supporting_transaction_ids.join(', ')}</span>
          </p>
        )}
        {d.additional_info_needed && <p className="text-xs font-semibold text-[#B45309]">More information requested</p>}
        {caseAccountIds && d.account_id && !caseAccountIds.includes(d.account_id) && (
          <p className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-2.5 text-xs text-[#92400E] leading-relaxed">
            Legacy record: {d.account_id} is not part of this case’s recorded transfers. An earlier version of FraudShield
            wrongly allowed this review. It is kept unchanged as history and does not connect the account to this case.
          </p>
        )}
      </div>
    );
  }
  if (event.action === 'case_metadata_updated') {
    return (
      <ul className="mt-2 text-xs text-[#6B655B] space-y-0.5">
        {Object.entries(d).map(([k, v]) => (
          <li key={k}>
            {k.replace(/_/g, ' ')}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </li>
        ))}
      </ul>
    );
  }
  if (event.action === 'trace_paths_persisted' && typeof d.path_count === 'number') {
    return <p className="mt-1 text-xs text-[#6B655B]">{d.path_count} money-flow paths stored.</p>;
  }
  return null;
};

export const CaseHistory: React.FC<{ caseId: string; refreshKey: number; caseAccountIds?: string[] }> = ({
  caseId,
  refreshKey,
  caseAccountIds,
}) => {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .getCaseAuditTrail(caseId)
      .then((res) => setEvents(res.events))
      .catch((err) => {
        setEvents(null);
        setError(describeError(err, 'The case history could not be loaded.'));
      });
  }, [caseId]);

  useEffect(load, [load, refreshKey]);

  const visible = (events ?? [])
    .filter((e) => showSystem || e.action !== 'trace_paths_persisted')
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || (b.event_id ?? 0) - (a.event_id ?? 0));
  const hiddenCount = (events ?? []).filter((e) => e.action === 'trace_paths_persisted').length;

  return (
    <section className="rounded-2xl border border-[#EAE3D6] bg-white p-5 sm:p-6" aria-labelledby="history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-heading" className="font-display text-lg font-bold flex items-center gap-2">
          <History className="w-5 h-5 text-[#EA8500]" aria-hidden="true" />
          Case history
        </h2>
        {hiddenCount > 0 && (
          <label className="inline-flex items-center gap-2 text-xs text-[#6B655B] cursor-pointer">
            <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} className="accent-[#EA8500]" />
            Show {hiddenCount} system calculation event{hiddenCount === 1 ? '' : 's'}
          </label>
        )}
      </div>

      <div className="mt-4">
        {error && <ErrorState title="History unavailable" message={error} onRetry={load} />}
        {!error && events === null && <LoadingState label="Loading case history…" />}
        {!error && events !== null && visible.length === 0 && (
          <EmptyState title="Nothing recorded yet" message="No decisions or case changes have been recorded for this case." />
        )}
        {visible.length > 0 && (
          <ol className="relative border-l border-[#EAE3D6] ml-2 space-y-5">
            {visible.map((e) => (
              <li key={e.event_id ?? `${e.timestamp}-${e.action}`} className="pl-5 relative">
                <span
                  className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${
                    e.action === 'account_review_recorded' ? 'bg-[#EA8500]' : 'bg-[#DDD4C4]'
                  }`}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold text-sm">{auditActionLabel(e.action)}</p>
                  <time dateTime={e.timestamp} className="text-xs text-[#6B655B]">
                    {formatServerTime(e.timestamp)}
                  </time>
                </div>
                <p className="mt-0.5 text-xs text-[#6B655B]">
                  <ActorLine event={e} />
                </p>
                <EventDetails event={e} caseAccountIds={caseAccountIds} />
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="mt-5 text-xs text-[#8C857B] leading-relaxed">
        Events are added, never edited, by the application, with server timestamps (shown in your local time). The log is
        stored in the application database and is not cryptographically signed.{' '}
        <Link to="/tools/audit" className="font-semibold text-[#B45309] hover:text-[#EA8500]">
          Search all cases’ history
        </Link>
      </p>
    </section>
  );
};
