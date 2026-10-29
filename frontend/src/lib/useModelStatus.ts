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

export function useModelStatus(): ModelStatusView {
  const [status, setStatus] = useState<V2ModelStatusResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      v2Api
        .getModelsStatus()
        .then((s) => {
          if (!active) return;
          setStatus(s);
          setFailed(false);
          timer = setTimeout(check, 60000);
        })
        .catch(() => {
          if (!active) return;
          setStatus(null);
          setFailed(true);
          timer = setTimeout(check, 10000);
        });
    };
    check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return describeModelStatus(status, failed);
}
