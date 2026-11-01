import { useEffect, useState } from 'react';
import { v2Api } from '../services/v2Api';
import { V2ModelStatusResponse } from '../types/v2';

export type ModelStatusState = 'checking' | 'ready' | 'unavailable' | 'server_unreachable';

export interface ModelStatusView {
  state: ModelStatusState;
  label: string;
  detail: string;
  status: V2ModelStatusResponse | null;
}

/** Maps the backend's model status to what the UI may claim. Never reports "ready" without inference_ready. */
export function describeModelStatus(status: V2ModelStatusResponse | null, failed: boolean): ModelStatusView {
  if (failed) {
    return {
      state: 'server_unreachable',
      label: 'Server unreachable',
      detail: 'The FraudShield server did not respond. Case data and model results cannot load until it is running.',
      status: null,
    };
  }
  if (!status) {
    return { state: 'checking', label: 'Checking model', detail: 'Checking whether the account model is loaded…', status: null };
  }
  const im = status.investigation_models;
  if (im) {
    // Investigations run on the v3 models; the v2 account model only serves the Accounts tool and the case review.
    const tm = im.transaction_model.model_version ?? 'transaction model';
    const am = im.account_model.model_version ?? 'account model';
    const v2 = status.inference_ready
      ? ` The Accounts tool and case review use the older account model ${status.account_model?.version ?? 'v2'}.`
      : ' The older v2 account model used by the Accounts tool and case review is not loaded.';
    if (im.ready) {
      return {
        state: 'ready',
        label: 'Models ready',
        detail: `Investigations use the transaction model ${tm} and the account behaviour model ${am}: validated on the forensic scenario ledger, reference only on the demo ledger.${v2}`,
        status,
      };
    }
    return {
      state: 'unavailable',
      label: 'Models unavailable',
      detail: `The investigation models are not loaded (${im.transaction_model.unavailable_reason ?? im.account_model.unavailable_reason ?? 'unknown reason'}). Fund tracing and the fixed rules still work.${v2}`,
      status,
    };
  }
  if (status.inference_ready) {
    const version = status.account_model?.version ?? 'account model';
    return {
      state: 'ready',
      label: 'Model ready',
      detail: status.status_detail || `Account model ${version} is loaded and can assess synthetic-ledger accounts.`,
      status,
    };
  }
  return {
    state: 'unavailable',
    label: 'Model unavailable',
    detail:
      (status.status_detail || 'The account model is not loaded.') +
      ' Case records, money flow and reviews still work; model assessments will not be shown.',
    status,
  };
}

type Snapshot = { status: V2ModelStatusResponse | null; failed: boolean };

// One poller shared by every component that shows the model status (sidebar, top bar, overview), so the server
// gets one status request per interval however many indicators are on screen.
const EMPTY: Snapshot = { status: null, failed: false };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<(s: Snapshot) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function poll() {
  const gen = generation;
  v2Api
    .getModelsStatus()
    .then((s) => publish(gen, { status: s, failed: false }, 60000))
    .catch(() => publish(gen, { status: null, failed: true }, 10000));
}

function publish(gen: number, next: Snapshot, retryMs: number) {
  if (gen !== generation || !listeners.size) return;
  snapshot = next;
  listeners.forEach((l) => l(next));
  clearTimeout(timer);
  timer = setTimeout(poll, retryMs);
}

export function useModelStatus(): ModelStatusView {
  const [snap, setSnap] = useState<Snapshot>(snapshot);

  useEffect(() => {
    listeners.add(setSnap);
    if (listeners.size === 1) poll();
    return () => {
      listeners.delete(setSnap);
      if (!listeners.size) {
        // Nobody is watching: stop polling and forget the last answer, so the next viewer starts fresh.
        clearTimeout(timer);
        generation += 1;
        snapshot = EMPTY;
      }
    };
  }, []);

  return describeModelStatus(snap.status, snap.failed);
}
