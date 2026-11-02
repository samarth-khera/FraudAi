/** True for a request that never got an answer (dropped or refused connection), as opposed to an HTTP error. */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err as { code?: string } | null)?.code === 'network_error';
}

/**
 * Runs an idempotent read, and runs it once more if the connection was dropped before any answer arrived. The free
 * hosting tier occasionally closes a connection mid-request; a second attempt usually succeeds at once. HTTP errors,
 * aborts and a second network failure are passed on unchanged, so error states still appear when the server is down.
 */
export async function retryRead<T>(read: () => Promise<T>, signal?: AbortSignal, delayMs = 400): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (!isNetworkFailure(err) || signal?.aborted) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (signal?.aborted) throw err;
    return read();
  }
}
