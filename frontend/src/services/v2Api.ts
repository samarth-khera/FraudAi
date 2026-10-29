/**
 * Typed API client for FraudShield AI V2 REST endpoints.
 */

import {
  V2AccountAssessmentResponse,
  V2AccountMLAssessmentResponse,
  V2AccountProfileResponse,
  V2AccountTransactionsResponse,
  V2ModelStatusResponse,
  V2TraceGraphResponse,
} from '../types/v2';
import { DataSourceInfo, InvestigationExplanationResponse, InvestigationRequest, InvestigationResponse } from '../types/investigation';
import { API_BASE_URL } from './apiBase';

const BASE_URL = `${API_BASE_URL}/api/v2`;

export class ApiError extends Error {
  code: string;
  status: number;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorCode = 'api_error';
    let errorMessage = `Request failed with status ${res.status}`;
    let details: any = null;

    try {
      const data = await res.json();
      if (data?.error) {
        errorCode = data.error.code || errorCode;
        errorMessage = data.error.message || errorMessage;
        details = data.error.details;
      } else if (data?.detail) {
        if (typeof data.detail === 'object') {
          errorCode = data.detail.code || errorCode;
          errorMessage = data.detail.message || errorMessage;
        } else {
          errorMessage = String(data.detail);
        }
      }
    } catch {
      // Non-JSON response
    }

    throw new ApiError(res.status, errorCode, errorMessage, details);
  }

  return res.json();
}

export const v2Api = {
  /**
   * Retrieves account 360° profile, KYC tier, balances, and calculated summary metrics.
   */
  async getAccount(accountId: string): Promise<V2AccountProfileResponse> {
    const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`);
    return handleResponse<V2AccountProfileResponse>(res);
  },

  /**
   * Retrieves paginated chronological ledger transactions for an account.
   */
  async getTransactions(
    accountId: string,
    params: {
      direction?: 'all' | 'inbound' | 'outbound';
      channel?: string;
      limit?: number;
      offset?: number;
      order?: 'asc' | 'desc';
    } = {}
  ): Promise<V2AccountTransactionsResponse> {
    const query = new URLSearchParams();
    if (params.direction) query.set('direction', params.direction);
    if (params.channel) query.set('channel', params.channel);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    if (params.order) query.set('order', params.order);

    const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}/transactions?${query.toString()}`);
    return handleResponse<V2AccountTransactionsResponse>(res);
  },

  /**
   * Retrieves Phase 3 deterministic rule-based behavioral risk assessment.
   */
  async getAssessment(accountId: string): Promise<V2AccountAssessmentResponse> {
    const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}/assessment`);
    return handleResponse<V2AccountAssessmentResponse>(res);
  },

  /**
   * Retrieves Phase 4 tabular ML risk assessment with local TreeSHAP attribution.
   */
  async getMLAssessment(accountId: string): Promise<V2AccountMLAssessmentResponse> {
    const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}/ml-assessment`);
    return handleResponse<V2AccountMLAssessmentResponse>(res);
  },

  /**
   * Executes multi-hop forensic graph traversal from a root account.
   */
  async getTrace(params: {
    account_id: string;
    direction?: 'outgoing' | 'incoming' | 'both';
    max_depth?: number;
    max_nodes?: number;
    min_amount?: number;
    time_window_hours?: number;
  }): Promise<V2TraceGraphResponse> {
    const query = new URLSearchParams();
    query.set('account_id', params.account_id);
    if (params.direction) query.set('direction', params.direction);
    if (params.max_depth !== undefined) query.set('max_depth', String(params.max_depth));
    if (params.max_nodes !== undefined) query.set('max_nodes', String(params.max_nodes));
    if (params.min_amount !== undefined) query.set('min_amount', String(params.min_amount));
    if (params.time_window_hours !== undefined) query.set('time_window_hours', String(params.time_window_hours));

    const res = await fetch(`${BASE_URL}/trace?${query.toString()}`);
    return handleResponse<V2TraceGraphResponse>(res);
  },

  /**
   * Retrieves model availability, versions, feature counts, and test metrics.
   */
  async getModelsStatus(): Promise<V2ModelStatusResponse> {
    const res = await fetch(`${BASE_URL}/models/status`);
    return handleResponse<V2ModelStatusResponse>(res);
  },

  /**
   * Executes an on-demand fresh live analysis of the account's ledger and model inference.
   */
  async runLiveAnalysis(accountId: string): Promise<import('../types/v2').V2AccountLiveAnalysisResponse> {
    const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<import('../types/v2').V2AccountLiveAnalysisResponse>(res);
  },

  /**
   * Runs a victim-first investigation. Computed on the server at request time; nothing is stored.
   */
  async runInvestigation(body: InvestigationRequest, signal?: AbortSignal): Promise<InvestigationResponse> {
    const res = await fetch(`${BASE_URL}/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return handleResponse<InvestigationResponse>(res);
  },

  /**
   * AI explanation for the same investigation, recomputed on the server. Can take a minute or more.
   */
  async explainInvestigation(body: InvestigationRequest, signal?: AbortSignal): Promise<InvestigationExplanationResponse> {
    const res = await fetch(`${BASE_URL}/investigations/explanation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return handleResponse<InvestigationExplanationResponse>(res);
  },

  /**
   * Which ledger the server queries, whether it is synthetic, and how fresh it is.
   */
  async getDataSource(): Promise<DataSourceInfo> {
    const res = await fetch(`${BASE_URL}/data-source`);
    return handleResponse<DataSourceInfo>(res);
  },
};

