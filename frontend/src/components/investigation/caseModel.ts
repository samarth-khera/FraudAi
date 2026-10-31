/** Shared, non-visual pieces of the investigation view: tones, severity helpers and the case navigation context. */
import { createContext, useContext } from 'react';
import { AccountFinding, InvestigationResponse, RoleAssessment } from '../../types/investigation';
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

export interface CaseNav {
  report: InvestigationResponse;
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
