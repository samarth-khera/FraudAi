/** Shared, non-visual pieces of the investigation view: tones, severity helpers and the case navigation context. */
import { createContext, useContext } from 'react';
import { AccountFinding, InvestigationResponse, RoleAssessment } from '../../types/investigation';
import { DynamicReport, RestrictionState, RoleCandidate } from '../../types/dynamic';
import { Trail } from './trail';

export type Tone = 'neutral' | 'iris' | 'ice' | 'fact' | 'critical' | 'high' | 'elevated' | 'low';

export type Severity = 'critical' | 'high' | 'elevated' | 'low';
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'elevated', 'low'];
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', elevated: 'Elevated', low: 'Low' };

/** Rule-assessed severity: the deterministic rules' risk level for the account, not a verdict. */
export function severityOf(a: AccountFinding | undefined | null): Severity | null {
  return (a?.rule_assessment?.risk_level as Severity | undefined) ?? null;
}

export const ROLE_TONE: Record<RoleAssessment, Tone> = {
  victim_candidate: 'ice',
  possible_intermediary: 'high',
  recipient_under_review: 'elevated',
  sender_under_review: 'elevated',
  insufficient_evidence: 'low',
  not_analyzed: 'neutral',
};

export const ROLE_TONE_V3: Record<RoleCandidate, Tone> = {
  potential_victim: 'ice',
  suspicious_activity_victim_unconfirmed: 'ice',
  potential_secondary_victim: 'ice',
  potential_intermediary: 'high',
  potentially_suspicious_account: 'critical',
  no_suspicious_linkage_observed: 'low',
  no_suspicious_activity_observed: 'low',
  unknown_role: 'neutral',
  cash_withdrawal_point: 'neutral',
};

/**
 * The role shown for an account anywhere in the case. A dynamic investigation's role assessment supersedes the trace
 * report's simpler label, so the fund trail, the inspector and the affected-accounts stage never disagree.
 */
export function roleDisplay(
  id: string,
  finding: AccountFinding | undefined | null,
  intel: DynamicReport | null,
  traceLabels: Record<RoleAssessment, { label: string; help: string }>,
): { label: string; tone: Tone; help: string } | null {
  const ra = intel?.role_assessments.find((x) => x.account_id === id);
  if (ra) return { label: ra.role_label, tone: ROLE_TONE_V3[ra.role_candidate], help: ra.headline };
  if (!finding) return null;
  const t = traceLabels[finding.role_assessment];
  return { label: t.label, tone: ROLE_TONE[finding.role_assessment], help: t.help };
}

export const STRENGTH_LABEL ={ none: 'No supporting evidence', weak: 'Weak evidence (one source)', moderate: 'Moderate evidence (two sources)', strong: 'Strong evidence (three or more sources)' } as const;

export interface CaseNav {
  report: InvestigationResponse;
  /** Model-driven sections of a dynamic investigation; null for a trace-only report. */
  intel: DynamicReport | null;
  trail: Trail;
  openTransfer: (id: string) => void;
  openAccount: (id: string) => void;
  openFinding: (id: string) => void;
}

export const CaseContext = createContext<CaseNav | null>(null);

export function useCase(): CaseNav {
  const nav = useContext(CaseContext);
  if (!nav) throw new Error('useCase outside CaseContext');
  return nav;
}

/** Restriction states that ask a person to review the account. Shown as a marker, never as a verdict. */
export const REVIEW_MARK: Partial<Record<RestrictionState, string>> = {
  additional_verification_recommended: 'Verification recommended',
  urgent_manual_review_recommended: 'Urgent review recommended',
  consider_temporary_restriction_review: 'Restriction review recommended',
};
