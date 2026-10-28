import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { FraudCase } from '../../types/api';
import { CASE_STATUS_LABELS } from '../../lib/format';
import { describeError } from '../../lib/errors';
import { readReviewer, rememberReviewer, reviewerProblem } from '../../lib/reviewer';

const STATUS_HELP: Record<string, string> = {
  open: 'Reported, not yet actively worked.',
  under_investigation: 'Being actively investigated.',
  closed: 'No further work planned. Decisions and history stay available.',
};

export const CaseStatusPanel: React.FC<{ caseData: FraudCase; onChanged: () => Promise<void> | void }> = ({
  caseData,
  onChanged,
}) => {
  const [next, setNext] = useState(caseData.investigation_status);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState(readReviewer);
  const changed = next !== caseData.investigation_status;

  const save = async () => {
    const issue = reviewerProblem(reviewer);
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateCase(caseData.case_id, { investigation_status: next, updated_by: reviewer.trim() });
      rememberReviewer(reviewer.trim());
      setSavedTo(updated.investigation_status);
      setConfirming(false);
      await onChanged();
    } catch (err) {
      setError(describeError(err, 'The case status was not changed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#EAE3D6] bg-white p-5" aria-labelledby="case-status-heading">
      <h2 id="case-status-heading" className="font-semibold">Case status</h2>
      <p className="mt-1 text-sm text-[#6B655B]">
        Currently <span className="font-semibold text-[#1A1714]">{CASE_STATUS_LABELS[caseData.investigation_status]}</span>.{' '}
        {STATUS_HELP[caseData.investigation_status]}
      </p>
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <label className="flex-1">
          <span className="sr-only">New case status</span>
          <select
            value={next}
            onChange={(e) => {
              setNext(e.target.value as FraudCase['investigation_status']);
              setConfirming(false);
              setSavedTo(null);
            }}
            className="w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2.5 text-sm"
          >
            {Object.entries(CASE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!confirming ? (
          <button type="button" className="btn-secondary" disabled={!changed} onClick={() => setConfirming(true)}>
            Change status
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={save} disabled={saving} aria-busy={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : `Confirm: mark ${CASE_STATUS_LABELS[next].toLowerCase()}`}
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm max-w-xs">
            <span className="font-semibold">Changed by</span>
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              maxLength={100}
              placeholder="Your name or reviewer ID"
              className="mt-1 w-full rounded-xl border border-[#EAE3D6] bg-white px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-[#6B655B]">{STATUS_HELP[next]} The change is added to the case history.</p>
        </div>
      )}
      {savedTo && !changed && (
        <p role="status" className="mt-2 text-xs font-medium text-[#166534]">
          Saved. The server now lists this case as {CASE_STATUS_LABELS[savedTo]?.toLowerCase()}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-[#BE123C]">
          {error}
        </p>
      )}
    </section>
  );
};
