import { describe, it, expect } from 'vitest';
import { buildTrail, serverEnding, ServerBranch } from '../components/investigation/trail';
import { InvestigationResponse, TraceEdge } from '../types/investigation';
import fixture from './fixtures/investigation.json';

const REPORT = fixture as unknown as InvestigationResponse;
const NO_CLAIMS = /recovered|frozen|lost|stopped for good/i;

function withEdges(edges: TraceEdge[], patch: Partial<InvestigationResponse['trace']> = {}): InvestigationResponse {
  return { ...REPORT, trace: { ...REPORT.trace, edges, ...patch } };
}
const edge = (id: string) => REPORT.trace.edges.find((e) => e.transaction_id === id)!;

describe('branch endings from the dynamic investigation', () => {
  it("uses the server's ending for a branch with exactly the same transfers, in either order", () => {
    const server: ServerBranch[] = [
      // Outflow 1 (TXN-T0010 -> T0011 -> T0013)
      { transaction_ids: ['TXN-T0010', 'TXN-T0011', 'TXN-T0013'], ending: { reason: 'cash_withdrawal_recorded', detail: 'Recorded as a cash withdrawal.' } },
      // Inflow 1, listed from the root outward by the server; the trail lists it in the order the money moved.
      { transaction_ids: ['TXN-T0001'], ending: { reason: 'maximum_node_limit_reached', detail: 'Maximum account limit reached.' } },
      // A cross-link step the trace report has no branch for: it must not create one.
      { transaction_ids: ['TXN-T0010', 'TXN-T0012', 'TXN-T0001'], ending: { reason: 'joins_opposite_direction_trace', detail: 'Joins.' } },
    ];
    const trail = buildTrail(REPORT, server);
    const [o1, o2, i1] = trail.branches;
    expect(trail.branches).toHaveLength(3);
    expect(o1.ending).toMatchObject({ source: 'server', reason: 'cash_withdrawal_recorded', kind: 'no_onward', title: 'Cash withdrawal recorded', detail: 'Recorded as a cash withdrawal.' });
    expect(i1.ending).toMatchObject({ source: 'server', reason: 'maximum_node_limit_reached', title: 'Stopped at the account limit' });
    // No server branch with Outflow 2's transfers: its ending is derived locally.
    expect(o2.ending).toMatchObject({ source: 'local', kind: 'cycle' });
    // Branches still hold exactly the traced transfers.
    const used = new Set(trail.branches.flatMap((b) => b.transfers.map((t) => t.transaction_id)));
    expect([...used].sort()).toEqual(REPORT.trace.edges.map((e) => e.transaction_id).sort());
  });

  it('maps an unknown server reason to a safe generic label and keeps the code', () => {
    const e = serverEnding('some_future_reason', '');
    expect(e).toMatchObject({ kind: 'no_onward', reason: 'some_future_reason', source: 'server', title: 'Trace stops here' });
    expect(e.detail).toMatch(/says nothing about what happened to the money/);
    const trail = buildTrail(REPORT, [{ transaction_ids: ['TXN-T0001'], ending: { reason: 'brand_new', detail: 'Server text.' } }]);
    expect(trail.branches.find((b) => b.direction === 'upstream')!.ending).toMatchObject({ title: 'Trace stops here', detail: 'Server text.' });
  });

  it('labels the new opposite-direction ending', () => {
    expect(serverEnding('joins_opposite_direction_trace', 'x')).toMatchObject({ kind: 'converges', title: 'Joins the trace from the other side' });
  });

  it('ignores an empty or missing server list', () => {
    expect(buildTrail(REPORT, []).branches.map((b) => b.ending.source)).toEqual(['local', 'local', 'local']);
    expect(buildTrail(REPORT, null).branches.map((b) => b.ending.source)).toEqual(['local', 'local', 'local']);
  });
});

describe('local branch endings', () => {
  it('reads an ATM cash-out as a cash withdrawal, not as nothing found', () => {
    const t = buildTrail(REPORT);
    expect(t.branches[0].ending).toMatchObject({ reason: 'cash_withdrawal_recorded', title: 'Cash withdrawal recorded' });
    // The same transfer one hop short of the depth limit is still a cash withdrawal.
    const shallow = buildTrail({ ...REPORT, request: { ...REPORT.request, max_depth: 6 } });
    expect(shallow.branches[0].ending.reason).toBe('cash_withdrawal_recorded');
  });

  it('does not say "no further transfer found" when the account limit was reached', () => {
    // Make Outflow 1 end at ACC-M2A (hop 2) with no onward transfer, and the account limit hit.
    const edges = REPORT.trace.edges.filter((e) => e.transaction_id !== 'TXN-T0013');
    const r = withEdges(edges, { truncation_notes: ['The account limit of 200 was reached; 3 further transfer(s) to new accounts were not added.'] });
    const b = buildTrail(r).branches[0];
    expect(b.endAccountId).toBe('ACC-M2A');
    expect(b.ending.reason).toBe('maximum_node_limit_reached');
    expect(b.ending.title).not.toMatch(/No further outgoing transfer found/);
    expect(b.ending.detail).toMatch(/a transfer may exist that was not added/);
  });

  it('says when a branch joins the trace from the other side of the investigated account', () => {
    // ACC-M2A pays the employer, which the trace first reached as a sender (upstream).
    const join: TraceEdge = { ...edge('TXN-T0013'), transaction_id: 'TXN-T0099', destination_account_id: 'ACC-EMP', channel: 'UPI', converges: true, hop: 3 };
    const r = withEdges([...REPORT.trace.edges.filter((e) => e.transaction_id !== 'TXN-T0013'), join]);
    const b = buildTrail(r).branches.find((x) => x.transfers.some((t) => t.transaction_id === 'TXN-T0099'))!;
    expect(b.ending).toMatchObject({ kind: 'converges', reason: 'joins_opposite_direction_trace', title: 'Joins the trace from the other side' });
  });

  it('describes a loop through the investigated account without claiming the account is earlier on the branch', () => {
    const loop: TraceEdge = { ...edge('TXN-T0013'), transaction_id: 'TXN-T0098', destination_account_id: 'ACC-EMP', channel: 'UPI', is_cycle: true, hop: 3 };
    const r = withEdges([...REPORT.trace.edges.filter((e) => e.transaction_id !== 'TXN-T0013'), loop]);
    const b = buildTrail(r).branches.find((x) => x.transfers.some((t) => t.transaction_id === 'TXN-T0098'))!;
    expect(b.ending).toMatchObject({ kind: 'cycle', title: 'Closes a loop of payments' });
    expect(b.ending.detail).toMatch(/already reached on the other side of the trace/);
    // A loop back to an account on the same branch keeps the original wording.
    expect(buildTrail(REPORT).branches[1].ending.detail).toMatch(/already appears earlier on this branch/);
  });

  it('never claims money was recovered, frozen or lost', () => {
    const reasons = ['cycle_detected', 'already_examined_on_another_branch', 'joins_opposite_direction_trace', 'maximum_depth_reached',
      'maximum_node_limit_reached', 'per_account_limit_applied', 'cash_withdrawal_recorded', 'no_further_transaction_in_window',
      'no_earlier_transaction_in_window', 'incomplete_or_missing_data', 'unknown_x'];
    for (const r of reasons) {
      const e = serverEnding(r, '');
      expect(`${e.title} ${e.detail} ${e.shared}`).not.toMatch(NO_CLAIMS);
    }
    for (const b of buildTrail(REPORT).branches) expect(`${b.ending.title} ${b.ending.detail} ${b.ending.shared}`).not.toMatch(NO_CLAIMS);
  });
});
