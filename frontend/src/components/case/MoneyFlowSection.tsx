import React, { useMemo, useState } from 'react';
import { ArrowRight, GitBranch, List } from 'lucide-react';
import { FundFlowHierarchicalTree } from '../fund-flow/FundFlowHierarchicalTree';
import { FundFlowListView } from '../fund-flow/FundFlowListView';
import { UnifiedTreeEdge, UnifiedTreeNode } from '../../services/unifiedFlowAdapter';
import {
  REVIEW_STATE_LABELS,
  channelLabel,
  formatDateTime,
  formatMoney,
  isRecordedDecision,
  roleLabel,
} from '../../lib/format';
import { EmptyState, ErrorState } from '../ui/StateViews';
import { CaseSection, CaseWorkspaceData, caseTransactions, stepsFromReporter } from './caseModel';

interface Props {
  data: CaseWorkspaceData;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  onNavigate: (section: CaseSection, accountId?: string | null) => void;
}

function prefersList(): boolean {
  try {
    return window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

export const MoneyFlowSection: React.FC<Props> = ({ data, selectedAccountId, onSelectAccount, onNavigate }) => {
  const [view, setView] = useState<'diagram' | 'list'>(() => (prefersList() ? 'list' : 'diagram'));
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const c = data.caseData;

  const assessmentsById = useMemo(
    () => new Map((data.assessments?.assessments ?? []).map((a) => [a.account_id, a])),
    [data.assessments]
  );

  const flow = useMemo(() => {
    const graph = data.graph;
    if (!graph) return null;
    const root = graph.nodes.find((n) => n.role === 'reporting_victim') ?? graph.nodes[0];
    const nodes: UnifiedTreeNode[] = graph.nodes.map((n) => {
      const a = assessmentsById.get(n.id);
      const isRoot = n.id === root?.id;
      const decided = a && isRecordedDecision(a.review_status.reviewer_id);
      const state = a?.review_status.review_state ?? n.review_state ?? 'not_reviewed';
      return {
        id: n.id,
        name: roleLabel(n.role),
        hop: a ? stepsFromReporter(a) : isRoot ? 0 : (n.hop_count ?? 0) + 1,
        isRoot,
        customerType: n.role === 'reporting_victim' ? 'victim_claim' : 'monitored_account',
        kycTier: '',
        currentBalance: null,
        statusLabel: isRoot ? 'Reporter' : decided ? REVIEW_STATE_LABELS[state] ?? state : 'No decision yet',
        statusVariant: isRoot
          ? 'root'
          : !decided
          ? 'unassessed'
          : state === 'under_investigation'
          ? 'investigation'
          : state === 'review_completed'
          ? 'cleared'
          : 'review',
        roleTag: n.role,
        raw: n,
      };
    });
    const hopById = new Map(nodes.map((n) => [n.id, n.hop]));
    const edges: UnifiedTreeEdge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      amount: e.amount,
      currency: e.currency || c.currency,
      channel: e.transaction_type,
      timestamp: e.timestamp,
      hop: hopById.get(e.target) ?? 1,
      isCycle: e.is_cycle_closing,
      attributedAmount: e.attributed_amount ?? null,
      raw: e,
    }));
    return { nodes, edges, rootId: root?.id ?? '' };
  }, [data.graph, assessmentsById, c.currency]);

  if (!flow) {
    return <ErrorState title="Money flow unavailable" message={data.traceError ?? 'The money flow could not be loaded.'} />;
  }
  if (flow.edges.length === 0) {
    return (
      <EmptyState
        title="No transfers recorded"
        message="The transaction records contain no transfers for this case, so there is no money flow to show. That does not mean nothing happened; the records may be incomplete."
      />
    );
  }

  const selectedAccount = selectedAccountId ? assessmentsById.get(selectedAccountId) ?? null : null;
  const selectedEdge = selectedEdgeId ? flow.edges.find((e) => e.id === selectedEdgeId) ?? null : null;
  const summary = data.trace?.summary;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[#E4E5F0] bg-white p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold">Recorded transfers from the reporting customer</h2>
        <p className="mt-1.5 text-sm text-[#5C6079] leading-relaxed max-w-3xl">
          Each box is an account. Arrows are recorded transfers, starting from the reporting customer on the left. “Hop 2”
          means the money reached that account two transfers after leaving the customer. Select an account or a
          transfer to see its details.
        </p>
        <dl className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className="rounded-xl bg-[#EFECFF] border border-[#D7CFFF] p-3">
            <dt className="text-xs text-[#4F33D6]">Reported loss (complaint)</dt>
            <dd className="mt-0.5 font-bold">{formatMoney(c.reported_amount, c.currency)}</dd>
          </div>
          <div className="rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] p-3">
            <dt className="text-xs text-[#5C6079]">Recorded transfers</dt>
            <dd className="mt-0.5 font-bold">{flow.edges.length}</dd>
          </div>
          <div className="rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] p-3">
            <dt className="text-xs text-[#5C6079]">Accounts involved</dt>
            <dd className="mt-0.5 font-bold">{flow.nodes.length}</dd>
          </div>
          <div className="rounded-xl bg-[#F6F6FC] border border-[#E4E5F0] p-3">
            <dt className="text-xs text-[#5C6079]">Sum of all transfers*</dt>
            <dd className="mt-0.5 font-bold">{summary ? formatMoney(summary.gross_observed_transaction_value, c.currency) : '—'}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-[#868AA2]">
          *Counts the same money once per hop, so it is larger than the loss. The records do not show which rupees in
          later transfers came from the reported payment.
        </p>
      </section>

      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-3" aria-label="Money flow">
          <div className="inline-flex rounded-xl border border-[#E4E5F0] bg-white p-1" role="group" aria-label="View">
            {(
              [
                ['diagram', 'Diagram', GitBranch],
                ['list', 'List of transfers', List],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer ${
                  view === value ? 'bg-[#EFECFF] text-[#4F33D6]' : 'text-[#5C6079] hover:text-[#141526]'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {view === 'diagram' ? (
            <FundFlowHierarchicalTree
              nodes={flow.nodes}
              edges={flow.edges}
              rootAccountId={flow.rootId}
              selectedNodeId={selectedAccountId}
              selectedEdgeId={selectedEdgeId}
              onSelectNode={(node) => {
                setSelectedEdgeId(null);
                onSelectAccount(node ? node.id : null);
              }}
              onSelectEdge={(edge) => {
                setSelectedEdgeId(edge ? edge.id : null);
                if (edge) onSelectAccount(null);
              }}
              height="520px"
            />
          ) : (
            <FundFlowListView
              edges={flow.edges}
              nodes={flow.nodes}
              selectedEdgeId={selectedEdgeId}
              onSelectEdge={(edge) => {
                setSelectedEdgeId(edge ? edge.id : null);
                if (edge) onSelectAccount(null);
              }}
              onSelectNodeById={(id) => {
                setSelectedEdgeId(null);
                onSelectAccount(id);
              }}
            />
          )}
        </section>

        <aside className="rounded-2xl border border-[#E4E5F0] bg-white p-5 h-fit xl:sticky xl:top-36" aria-live="polite">
          {selectedAccount ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-[#5C6079]">Selected account</p>
                <p className="font-mono font-bold text-lg">{selectedAccount.account_id}</p>
                <p className="text-sm text-[#5C6079]">
                  {roleLabel(selectedAccount.graph_position.role)}
                  {stepsFromReporter(selectedAccount) > 0 && ` · hop ${stepsFromReporter(selectedAccount)}`}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-[#5C6079]">Received in this case</dt>
                  <dd className="font-semibold">{formatMoney(selectedAccount.observed_movement.observed_inbound_value, c.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#5C6079]">Sent on in this case</dt>
                  <dd className="font-semibold">{formatMoney(selectedAccount.observed_movement.observed_outbound_value, c.currency)}</dd>
                </div>
              </dl>
              <ul className="space-y-1.5 text-xs text-[#5C6079]">
                {caseTransactions(selectedAccount).map((t) => {
                  const inbound = t.receiver_account_id === selectedAccount.account_id;
                  return (
                    <li key={t.transaction_id} className="flex justify-between gap-2">
                      <span>
                        {inbound ? 'From' : 'To'}{' '}
                        <span className="font-mono text-[#141526]">{inbound ? t.sender_account_id : t.receiver_account_id}</span>
                      </span>
                      <span className="font-semibold text-[#141526]">
                        {inbound ? '+' : '−'}
                        {formatMoney(t.amount, t.currency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-col gap-2">
                <button type="button" className="btn-primary" onClick={() => onNavigate('accounts', selectedAccount.account_id)}>
                  Open account details
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
                {selectedAccount.graph_position.role !== 'reporting_victim' && (
                  <button type="button" className="btn-secondary" onClick={() => onNavigate('review', selectedAccount.account_id)}>
                    Record a decision
                  </button>
                )}
              </div>
            </div>
          ) : selectedEdge ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-[#5C6079]">Selected transfer</p>
              <p className="font-mono font-bold">{selectedEdge.id}</p>
              <dl className="space-y-2">
                {(
                  [
                    ['From', selectedEdge.source, true],
                    ['To', selectedEdge.target, true],
                    ['Amount', formatMoney(selectedEdge.amount, selectedEdge.currency), false],
                    ['Method', channelLabel(selectedEdge.channel), false],
                    ['Time', formatDateTime(selectedEdge.timestamp), false],
                    ['Hop', String(selectedEdge.hop), false],
                  ] as const
                ).map(([k, v, mono]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-[#5C6079]">{k}</dt>
                    <dd className={`font-semibold text-right ${mono ? 'font-mono' : ''}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" className="btn-secondary w-full" onClick={() => onSelectAccount(selectedEdge.target)}>
                Select receiving account
              </button>
            </div>
          ) : (
            <div className="text-sm text-[#5C6079]">
              <p className="font-semibold text-[#141526]">Nothing selected</p>
              <p className="mt-1">Select an account or a transfer to see what the records show about it.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
