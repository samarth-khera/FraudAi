/**
 * Turn API failures into messages a user can act on. Server messages are shown only when the
 * backend sent a structured error code (those messages are written for users); raw exception
 * text is never surfaced.
 */
export function describeError(err: unknown, fallback: string): string {
  const e = err as { code?: string; status?: number; message?: string } | null;
  const code = e?.code ?? '';
  const status = e?.status ?? Number((code.match(/^HTTP_(\d+)$/) ?? [])[1] ?? NaN);

  if (code === 'network_error' || err instanceof TypeError) {
    return 'The FraudShield server could not be reached. Check that the backend is running on port 8000, then try again.';
  }
  if (code === 'api_error' || code.startsWith('HTTP_') || code === 'internal_server_error') {
    if (status === 502 || status === 503 || status === 504 || (status === 500 && code !== 'internal_server_error')) {
      return 'The FraudShield server could not be reached or is not responding. Check that the backend is running, then try again.';
    }
    return fallback;
  }
  return e?.message || fallback;
}

export function isNotFound(err: unknown): boolean {
  const e = err as { code?: string; status?: number } | null;
  return e?.status === 404 || e?.code === 'HTTP_404' || /not_found$/.test(e?.code ?? '');
}
