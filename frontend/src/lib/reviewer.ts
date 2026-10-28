/** The reviewer name is a per-browser convenience only; the server records whatever is submitted, unverified. */
const REVIEWER_KEY = 'fraudshield.reviewerName';

export const REVIEWER_PATTERN = /^[A-Za-z0-9_\-. ]+$/;

export function readReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberReviewer(name: string): void {
  try {
    localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    // Storage unavailable (for example a private window); the name just isn't remembered.
  }
}

export function reviewerProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter your name or reviewer ID.';
  if (!REVIEWER_PATTERN.test(trimmed)) return 'Reviewer name may only use letters, numbers, spaces, dots, dashes and underscores.';
  return null;
}
