/**
 * One source of truth for how the account model's output is described.
 *
 * The model returns an uncalibrated score between 0 and 1 (shown as 0-100%). It was trained on synthetic
 * labels; it is not a verified probability of fraud. Every number here comes from the served model
 * metadata (GET /api/v2/models/status); nothing is hardcoded.
 */
import { V2ModelStatusResponse, V2SingleModelInfo } from '../types/v2';

export const MODEL_SCORE_LABEL = 'Model score';
export const RULE_SCORE_LABEL = 'Rule score';

export const MODEL_SCORE_MEANING =
  'A model-generated score used to prioritise investigation. It is not a verified probability of fraud or proof of criminal activity.';

export const RULE_SCORE_MEANING =
  'Points from fixed, readable rules about timing, size and spread of transfers. "High" or above suggests review.';

/** The rule assessor's own review point: "high" and "critical" recommend manual review. */
export function ruleSuggestsReview(level: string | null | undefined): boolean {
  return level === 'high' || level === 'critical';
}

export function modelThreshold(info: V2SingleModelInfo | null | undefined): number | null {
  const t = info?.decision_threshold;
  return typeof t === 'number' && t > 0 && t < 1 ? t : null;
}

/**
 * Threshold on the 0-100% display scale, e.g. 0.1752 -> "17.5%". One decimal, like the scores, so a score
 * just above the threshold (18.2%) never displays the same number as the threshold itself.
 */
export function thresholdPercent(info: V2SingleModelInfo | null | undefined): string | null {
  const t = modelThreshold(info);
  return t === null ? null : `${(t * 100).toFixed(1)}%`;
}

/** The backend already rounds risk_score to one decimal. */
export function formatModelScore(scorePercent: number): string {
  return `${scorePercent.toFixed(1)}%`;
}

export type ReviewComparison = 'both' | 'neither' | 'model_only' | 'rules_only';

export function compareChecks(modelSuggests: boolean, rulesSuggest: boolean): ReviewComparison {
  if (modelSuggests && rulesSuggest) return 'both';
  if (modelSuggests) return 'model_only';
  if (rulesSuggest) return 'rules_only';
  return 'neither';
}

export const COMPARISON_TEXT: Record<ReviewComparison, string> = {
  both: 'Both checks suggest review. Agreement is not proof; check the transfers.',
  neither: 'Neither check suggests review. That does not clear the account.',
  model_only:
    'The model suggests review but the rules do not. They use different logic, so neither is automatically right. A large unusual payment out can also mean the holder was scammed.',
  rules_only:
    'The rules suggest review but the model does not. They use different logic, so neither is automatically right. A score below the threshold does not clear the account.',
};

export interface EvaluationSummary {
  version: string | null;
  positives: number | null;
  negatives: number | null;
  recall: number | null;
  precision: number | null;
  prAuc: number | null;
  prAucInterval: [number, number] | null;
  thresholdLabel: string | null;
  demoFlagRate: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Evaluation facts for the account model, read from served metadata only. */
export function accountEvaluation(status: V2ModelStatusResponse | null | undefined): EvaluationSummary {
  const info = status?.account_model;
  const m = (info?.test_metrics ?? {}) as Record<string, unknown>;
  const d = (info?.dataset_info ?? {}) as Record<string, unknown>;
  const ci = (m.ci95 as Record<string, unknown> | undefined)?.pr_auc;
  return {
    version: info?.version ?? null,
    positives: num(d.test_suspicious_count) ?? num(m.positives),
    negatives: num(d.test_normal_count) ?? num(m.negatives),
    recall: num(m.recall),
    precision: num(m.precision),
    prAuc: num(m.pr_auc),
    prAucInterval: Array.isArray(ci) && ci.length === 2 ? [Number(ci[0]), Number(ci[1])] : null,
    thresholdLabel: thresholdPercent(info),
    demoFlagRate: num(info?.operational_notes?.demo_ledger_flag_rate_ordinary),
  };
}

export const pct = (v: number | null | undefined): string => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');

/** "about half", "about 1 in 3", phrasing for non-technical readers. */
export function plainShare(v: number | null): string {
  if (v === null) return 'an unknown share';
  if (v >= 0.45 && v <= 0.55) return 'about half';
  const inN = Math.round(1 / v);
  if (v < 0.45 && inN >= 2 && inN <= 10) return `about 1 in ${inN}`;
  return `about ${pct(v)}`;
}

/** Level bands as the backend applies them (ml_service.risk_level_for), on the 0-100% scale. */
export function modelLevelBands(info: V2SingleModelInfo | null | undefined): string[] | null {
  const t = modelThreshold(info);
  if (t === null) return null;
  const tp = (t * 100).toFixed(1);
  const high = Math.max(50, Math.ceil(t * 100));
  return [`Low (below ${tp}%)`, `Elevated (${tp}–${high}%)`, `High (${high}–80%)`, 'Very high (80%+)'];
}
