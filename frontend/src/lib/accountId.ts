/** Accepts "1", "acc-1" or "ACC-000001" and returns the ledger's ACC-XXXXXX form; other IDs are trimmed and upper-cased. */
export function normalizeAccountId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d{1,6}$/.test(trimmed)) {
    return `ACC-${trimmed.padStart(6, '0')}`;
  }
  if (/^acc-\d{1,6}$/i.test(trimmed)) {
    const numPart = trimmed.replace(/^acc-/i, '');
    return `ACC-${numPart.padStart(6, '0')}`;
  }
  return trimmed.toUpperCase();
}

/** Same rule the API enforces on account IDs. */
export const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_\-.]{1,64}$/;
