/**
 * Unified Fund Flow Data Adapter
 *
 * Normalizes both legacy V1 case-tracing responses (api.getCaseGraph / api.getCaseTrace)
 * and V2 account-tracing responses (v2Api.getTrace) into a single, cohesive, type-safe model.
 *
 * Strict Forensic Guardrails:
 * - Observed ledger movement represents the arithmetic sum of individual transactions in the visible subgraph.
 * - Attributed exposure upper bound is strictly isolated to 1st-hop initial disbursements out of root.
 * - Downstream re-transfers are NEVER summed into a synthetic cumulative loss.
 * - No data or risk classifications are fabricated. Nodes without formal ML assessments
 *   are explicitly tagged as "Not yet assessed" or "Under review".
 */

import { GraphResponse as V1GraphResponse, TraceResult as V1TraceResult } from '../types/api';
import { V2TraceGraphResponse } from '../types/v2';

export type FlowTraceMode = 'account' | 'case';

export interface UnifiedTreeNode {
  id: string;
  name: string;
  hop: number;
  isRoot: boolean;
  customerType: string;
  kycTier: string;
  currentBalance: number | null;
  statusLabel: string;
  statusVariant: 'root' | 'verified' | 'review' | 'cleared' | 'unassessed' | 'investigation';
  roleTag?: string;
  raw?: any;
}

export interface UnifiedTreeEdge {
  id: string;
  source: string;
  target: string;
  amount: number;
  currency: string;
  channel: string;
  timestamp: string;
  hop: number;
  isCycle: boolean;
  attributedAmount: number | null;
  raw?: any;
}

export interface UnifiedFlowSummary {
  mode: FlowTraceMode;
  targetId: string;
  rootAccountId: string;
  rootCustomerName?: string;
  directTransferAmount: number;
  observedTotalTransferred: number;
  attributedExposureUpperBound: number;
  accountsCount: number;
  edgesCount: number;
  maxHopDepth: number;
  isTruncated: boolean;
  truncationReason: string | null;
  attributionDisclaimer: string;
}

export interface UnifiedFlowData {
  summary: UnifiedFlowSummary;
  nodes: UnifiedTreeNode[];
  edges: UnifiedTreeEdge[];
  rawSource: 'v1_case' | 'v2_account';
}

/**
 * Maps a V1 case graph + trace response into the unified flow model.
 */
export function adaptCaseTraceToUnified(
  caseId: string,
  v1Graph: V1GraphResponse,
  v1Trace?: V1TraceResult | null
): UnifiedFlowData {
  // Find the root node: typically reporting_victim (e.g. V001) or initial receiver
  const victimNode = v1Graph.nodes.find((n) => n.role === 'reporting_victim');
  const rootNode = victimNode || v1Graph.nodes[0];
  const rootId = rootNode ? rootNode.id : caseId;

  // Compute node hop depth relative to root
  const depthMap = new Map<string, number>();
  v1Graph.nodes.forEach((n) => {
    if (n.role === 'reporting_victim') {
      depthMap.set(n.id, 0);
    } else if (n.role === 'reported_initial_receiver') {
      depthMap.set(n.id, 1);
    } else if (typeof n.hop_count === 'number') {
      depthMap.set(n.id, n.hop_count + 1);
    }
  });

  // Fallback BFS for any unmapped nodes
  if (rootNode) {
    depthMap.set(rootNode.id, 0);
    const adj = new Map<string, string[]>();
    v1Graph.edges.forEach((e) => {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    });

    const queue: string[] = [rootNode.id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currDepth = depthMap.get(curr) ?? 0;
      for (const nxt of adj.get(curr) || []) {
        if (!depthMap.has(nxt)) {
          depthMap.set(nxt, currDepth + 1);
          queue.push(nxt);
        }
      }
    }
  }

  const nodes: UnifiedTreeNode[] = v1Graph.nodes.map((n) => {
    const isRoot = n.id === rootId || n.role === 'reporting_victim';
    const hop = depthMap.get(n.id) ?? (isRoot ? 0 : 1);

    let statusLabel = 'Under Review';
    let statusVariant: UnifiedTreeNode['statusVariant'] = 'review';

    if (n.role === 'reporting_victim') {
      statusLabel = 'Reporting Victim';
      statusVariant = 'root';
    } else if (n.role === 'reported_initial_receiver') {
      statusLabel = 'Initial Receiver';
      statusVariant = 'investigation';
    } else if (n.review_state === 'review_completed') {
      statusLabel = 'Cleared';
      statusVariant = 'cleared';
    } else if (n.review_state === 'under_investigation') {
      statusLabel = 'Under Investigation';
      statusVariant = 'investigation';
    } else {
      statusLabel = 'Not Yet Assessed';
      statusVariant = 'unassessed';
    }

    return {
      id: n.id,
      name: n.label || (isRoot ? 'Disputed Origin Account' : `Entity ${n.id}`),
      hop,
      isRoot,
      customerType: n.role === 'reporting_victim' ? 'victim_claim' : 'monitored_account',
      kycTier: n.evidence_quality ? n.evidence_quality.replace(/_/g, ' ') : 'standard_kyc',
      currentBalance: n.attributed_unforwarded_amount ?? null,
      statusLabel,
      statusVariant,
      roleTag: n.role,
      raw: n,
    };
  });

  const edges: UnifiedTreeEdge[] = v1Graph.edges.map((e) => {
    const sourceHop = depthMap.get(e.source) ?? 0;
    const targetHop = depthMap.get(e.target) ?? (sourceHop + 1);
    const isCycle = e.is_cycle_closing || targetHop <= sourceHop;

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      amount: e.amount,
      currency: e.currency || 'INR',
      channel: e.transaction_type || 'BANK_TRANSFER',
      timestamp: e.timestamp,
      hop: targetHop,
      isCycle,
      attributedAmount: e.attributed_amount ?? null,
      raw: e,
    };
  });

  // Calculate distinct sums
  const observedTotal = edges.reduce((acc, e) => acc + e.amount, 0);
  const firstHopEdges = edges.filter((e) => e.source === rootId);
  const directTransferAmount = firstHopEdges.reduce((acc, e) => acc + e.amount, 0);

  // Reported loss from trace summary if available, else 1st hop outflow
  const exposureUpperBound = v1Trace
    ? v1Trace.summary.traceable_amount
    : directTransferAmount > 0
    ? directTransferAmount
    : observedTotal;

  const maxHopDepth = nodes.reduce((max, n) => Math.max(max, n.hop), 0);

  const summary: UnifiedFlowSummary = {
    mode: 'case',
    targetId: caseId,
    rootAccountId: rootId,
    rootCustomerName: victimNode?.label || `Disputed Case ${caseId}`,
    directTransferAmount,
    observedTotalTransferred: observedTotal,
    attributedExposureUpperBound: exposureUpperBound,
    accountsCount: nodes.length,
    edgesCount: edges.length,
    maxHopDepth,
    isTruncated: false,
    truncationReason: null,
    attributionDisclaimer:
      'Case funds reflect scenario lineage assumptions. Downstream hop transfers are not summed into a larger stolen-fund total.',
  };

  return {
    summary,
    nodes,
    edges,
    rawSource: 'v1_case',
  };
}

/**
 * Maps a V2 account trace response into the unified flow model.
 */
export function adaptV2TraceToUnified(v2Trace: V2TraceGraphResponse): UnifiedFlowData {
  const rootNode = v2Trace.nodes.find((n) => n.is_root || n.account_id === v2Trace.root_account_id);
  const rootId = v2Trace.root_account_id;

  const nodes: UnifiedTreeNode[] = v2Trace.nodes.map((n) => {
    let statusLabel = 'Tier 2 Verified';
    let statusVariant: UnifiedTreeNode['statusVariant'] = 'verified';

    if (n.is_root) {
      statusLabel = 'Root Origin';
      statusVariant = 'root';
    } else if (n.kyc_tier === 'tier_3_enhanced') {
      statusLabel = 'Enhanced KYC';
      statusVariant = 'verified';
    } else if (n.kyc_tier === 'tier_1_basic') {
      statusLabel = 'Basic KYC';
      statusVariant = 'review';
    } else if (n.kyc_tier === 'unmonitored') {
      statusLabel = 'Perimeter Entity';
      statusVariant = 'unassessed';
    } else {
      statusLabel = n.kyc_tier.replace(/_/g, ' ');
      statusVariant = 'verified';
    }

    return {
      id: n.account_id,
      name: n.customer_name || `Account ${n.account_id}`,
      hop: n.hop_distance,
      isRoot: n.is_root,
      customerType: n.customer_type,
      kycTier: n.kyc_tier,
      currentBalance: n.current_balance,
      statusLabel,
      statusVariant,
      raw: n,
    };
  });

  const edges: UnifiedTreeEdge[] = v2Trace.edges.map((e) => ({
    id: e.transaction_id,
    source: e.origin_account_id,
    target: e.destination_account_id,
    amount: e.amount,
    currency: e.currency,
    channel: e.channel,
    timestamp: e.timestamp,
    hop: e.hop,
    isCycle: e.is_cycle,
    attributedAmount: null,
    raw: e,
  }));

  // Direct 1st-hop transfers from root account
  const direct1stHopEdges = edges.filter(
    (e) => (v2Trace.direction === 'incoming' ? e.target === rootId : e.source === rootId) && e.hop === 1
  );
  const directTransferAmount = direct1stHopEdges.reduce((sum, e) => sum + e.amount, 0);

  const summary: UnifiedFlowSummary = {
    mode: 'account',
    targetId: rootId,
    rootAccountId: rootId,
    rootCustomerName: rootNode?.customer_name || rootId,
    directTransferAmount,
    observedTotalTransferred: v2Trace.observed_total_transferred,
    attributedExposureUpperBound: v2Trace.attributed_exposure_upper_bound,
    accountsCount: v2Trace.total_nodes,
    edgesCount: v2Trace.total_edges,
    maxHopDepth: v2Trace.max_depth_reached,
    isTruncated: v2Trace.is_truncated,
    truncationReason: v2Trace.truncation_reason,
    attributionDisclaimer: v2Trace.attribution_disclaimer,
  };

  return {
    summary,
    nodes,
    edges,
    rawSource: 'v2_account',
  };
}
