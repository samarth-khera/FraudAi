import {
  AccountAssessmentResponse,
  AccountReviewStatus,
  AuditTrailResponse,
  CaseAccountAssessmentsResponse,
  CaseListResponse,
  FraudCase,
  GlobalAuditResponse,
  AuditQueryParams,
  GraphResponse,
  RiskExplainResponse,
  RiskScoreRequest,
  RiskScoreResponse,
  TraceResult,
  Transaction,
  TransactionListResponse,
} from '../types/api';

const BASE_URL = import.meta.env.VITE_API_URL || '';

/** How the server protects write endpoints (GET /health). This browser app never sends an API key. */
export type WriteAccessMode = 'api_key_required' | 'open_local_development' | 'disabled_no_key_configured';

export class ApiError extends Error {
  code: string;
  details?: any;

  constructor(message: string, code: string = 'api_error', details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        // Non-JSON response
      }

      const code = errorBody?.error?.code || errorBody?.detail?.code || `HTTP_${res.status}`;
      const message =
        errorBody?.error?.message ||
        (typeof errorBody?.detail === 'string' ? errorBody.detail : errorBody?.detail?.message) ||
        `Request failed with status ${res.status}`;
      const details = errorBody?.error?.details || errorBody?.detail?.details;

      throw new ApiError(message, code, details);
    }
    return (await res.json()) as T;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(err?.message || 'Network request failed', 'network_error');
  }
}

export const api = {
  // Health
  getHealth: () =>
    request<{ status: string; service: string; phase: string; write_access?: WriteAccessMode }>('/health'),

  // Cases
  getCases: (skip: number = 0, limit: number = 50) =>
    request<CaseListResponse>(`/api/cases?skip=${skip}&limit=${limit}`),

  getCase: (caseId: string) => request<FraudCase>(`/api/cases/${encodeURIComponent(caseId)}`),

  createCase: (payload: {
    case_id: string;
    reported_origin_transaction_id: string;
    reported_amount: number;
    currency?: string;
    reported_at?: string;
    investigation_status?: string;
    description: string;
    created_by?: string;
  }) =>
    request<FraudCase>('/api/cases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCase: (
    caseId: string,
    payload: {
      investigation_status?: string;
      description?: string;
      updated_by?: string;
    }
  ) =>
    request<FraudCase>(`/api/cases/${encodeURIComponent(caseId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Transactions
  getCaseTransactions: (caseId: string, maxDepth: number = 10) =>
    request<TransactionListResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/transactions?max_depth=${maxDepth}`
    ),

  addCaseTransactions: (
    caseId: string,
    transactions: Transaction[],
    addedBy: string = 'analyst_ui'
  ) =>
    request<Transaction[]>(`/api/cases/${encodeURIComponent(caseId)}/transactions`, {
      method: 'POST',
      body: JSON.stringify({ transactions, added_by: addedBy }),
    }),

  // Graph & Trace
  getCaseGraph: (caseId: string, maxDepth: number = 10) =>
    request<GraphResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/graph?max_depth=${maxDepth}`
    ),

  getCaseTrace: (caseId: string, maxDepth: number = 10) =>
    request<TraceResult>(
      `/api/cases/${encodeURIComponent(caseId)}/trace?max_depth=${maxDepth}`
    ),

  // Account Review & Evidence-Aware Assessment
  getCaseAccountAssessments: (caseId: string, maxDepth: number = 10) =>
    request<CaseAccountAssessmentsResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/accounts?max_depth=${maxDepth}`
    ),

  getAccountAssessment: (caseId: string, accountId: string, maxDepth: number = 10) =>
    request<AccountAssessmentResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/accounts/${encodeURIComponent(accountId)}/assessment?max_depth=${maxDepth}`
    ),

  updateAccountReview: (
    caseId: string,
    accountId: string,
    payload: {
      review_state: string;
      evidence_quality?: string;
      notes?: string;
      reviewer_id?: string;
      decision_reasons?: string[];
      supporting_transaction_ids?: string[];
      additional_info_needed?: boolean;
    }
  ) =>
    request<AccountReviewStatus>(
      `/api/cases/${encodeURIComponent(caseId)}/accounts/${encodeURIComponent(accountId)}/review`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  // Audit Trail
  getCaseAuditTrail: (caseId: string) =>
    request<AuditTrailResponse>(`/api/cases/${encodeURIComponent(caseId)}/audit-trail`),

  getGlobalAudit: (params?: AuditQueryParams) => {
    const query = new URLSearchParams();
    if (params) {
      if (params.case_id) query.set('case_id', params.case_id);
      if (params.action) query.set('action', params.action);
      if (params.category && params.category !== 'all') query.set('category', params.category);
      if (params.performed_by) query.set('performed_by', params.performed_by);
      if (params.entity_type) query.set('entity_type', params.entity_type);
      if (params.search) query.set('search', params.search);
      if (params.start_date) query.set('start_date', params.start_date);
      if (params.end_date) query.set('end_date', params.end_date);
      if (params.skip !== undefined) query.set('skip', String(params.skip));
      if (params.limit !== undefined) query.set('limit', String(params.limit));
      if (params.sort_order) query.set('sort_order', params.sort_order);
    }
    const qStr = query.toString();
    return request<GlobalAuditResponse>(`/api/audit${qStr ? `?${qStr}` : ''}`);
  },

  getAuditExportUrl: (params?: AuditQueryParams) => {
    const query = new URLSearchParams();
    if (params) {
      if (params.case_id) query.set('case_id', params.case_id);
      if (params.action) query.set('action', params.action);
      if (params.category && params.category !== 'all') query.set('category', params.category);
      if (params.performed_by) query.set('performed_by', params.performed_by);
      if (params.entity_type) query.set('entity_type', params.entity_type);
      if (params.search) query.set('search', params.search);
      if (params.start_date) query.set('start_date', params.start_date);
      if (params.end_date) query.set('end_date', params.end_date);
      if (params.sort_order) query.set('sort_order', params.sort_order);
    }
    const qStr = query.toString();
    return `${BASE_URL}/api/audit/export.csv${qStr ? `?${qStr}` : ''}`;
  },

  // Risk Scoring & Explainable AI
  scoreRisk: (payload: RiskScoreRequest) =>
    request<RiskScoreResponse>('/api/risk/score', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  explainRisk: (payload: RiskScoreRequest) =>
    request<RiskExplainResponse>('/api/risk/explain', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

