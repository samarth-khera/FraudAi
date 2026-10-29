/**
 * Plain-language labels for investigation results. Role labels describe what the records show about an account's
 * position in the traced money flow; none of them is a finding of guilt.
 */
import { AIState, ClaimKind, FindingKind, GraphRole, ObservationBasis, RoleAssessment } from '../../types/investigation';

type Tone = 'neutral' | 'orange' | 'green' | 'blue' | 'rose' | 'amber';

export const ROLE_ASSESSMENT: Record<RoleAssessment, { label: string; tone: Tone; help: string }> = {
  victim_candidate: {
    label: 'Victim candidate',
    tone: 'blue',
    help: 'Made transfers that are unusual for this account. The ledger cannot show whether they were authorised.',
  },
  possible_intermediary: {
    label: 'Possible intermediary',
    tone: 'rose',
    help: 'Passed most of the traced funds on soon after receiving them. Consistent with a mule account, or with ordinary payments.',
  },
  recipient_under_review: {
    label: 'Recipient under review',
    tone: 'amber',
    help: 'Received traced funds and at least one automated check suggests review. Not proof of anything.',
  },
  sender_under_review: {
    label: 'Sender under review',
    tone: 'amber',
    help: 'Sent funds into the traced flow and at least one automated check suggests review.',
  },
  insufficient_evidence: {
    label: 'Insufficient evidence',
    tone: 'neutral',
    help: 'Linked to the flow, but the records do not support a stronger label.',
  },
  not_analyzed: {
    label: 'Not analysed',
    tone: 'neutral',
    help: 'In the graph but beyond the number of accounts assessed in this run.',
  },
};

export const GRAPH_ROLE: Record<GraphRole, string> = {
  investigated_account: 'Investigated account',
  direct_recipient: 'Direct recipient',
  onward_recipient: 'Onward recipient',
  direct_sender: 'Direct sender',
  upstream_sender: 'Earlier sender',
};

export const KIND: Record<FindingKind | ClaimKind, { label: string; tone: Tone; help: string }> = {
  observed: { label: 'Observed', tone: 'green', help: 'A fact recorded in the ledger.' },
  rule: { label: 'Rule', tone: 'orange', help: 'Result of a fixed, explainable rule applied to the records.' },
  model: { label: 'Model', tone: 'blue', help: 'Output of the machine-learning account model.' },
  limitation: { label: 'Unknown / limit', tone: 'neutral', help: 'Something the records cannot show, or a limit of this run.' },
  interpretation: { label: 'Interpretation', tone: 'amber', help: 'A reading of the evidence, not a recorded fact.' },
};

export const FLAG_LABEL: Record<string, string> = {
  AMOUNT_ABOVE_OWN_HISTORY: 'Far above own history',
  INFLOW_ABOVE_OWN_HISTORY: 'Inflow far above own history',
  BALANCE_DRAIN: 'Drained balance',
  BURST_TO_NEW_RECIPIENTS: 'Burst to new recipients',
  RAPIDLY_FORWARDED_INFLOW: 'Forwarded within 30 min',
  FORWARDS_RECENT_INFLOW: 'Forwards money just received',
};

export const ACTION_LABEL: Record<string, string> = {
  further_review: 'Further review',
  enhanced_monitoring: 'Enhanced monitoring',
  consider_escalation: 'Consider escalation',
  obtain_records: 'Obtain records',
  contact_account_holder: 'Contact account holder',
};

export const AI_STATE: Record<AIState, { title: string; tone: Tone }> = {
  completed: { title: 'AI analyst', tone: 'blue' },
  disabled: { title: 'AI analyst: turned off', tone: 'neutral' },
  not_configured: { title: 'AI analyst: not configured', tone: 'neutral' },
  skipped_privacy_policy: { title: 'AI analyst: skipped by privacy policy', tone: 'amber' },
  unavailable: { title: 'AI analyst: unavailable', tone: 'rose' },
};

export const BASIS: Record<ObservationBasis, { label: string; tone: Tone }> = {
  observed: { label: 'Cites ledger record', tone: 'green' },
  rule: { label: 'Cites rule result', tone: 'orange' },
  model: { label: 'Cites model output', tone: 'blue' },
  hypothesis: { label: 'Hypothesis', tone: 'amber' },
  limitation: { label: 'Limitation', tone: 'neutral' },
};
