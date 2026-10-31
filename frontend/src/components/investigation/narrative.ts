/**
 * "What happened", written from the report by fixed rules. Every number and ID comes from the response; nothing is
 * inferred beyond what the trace and the rules already state.
 */
import { InvestigationResponse } from '../../types/investigation';
import { channelLabel, formatDateTime, formatMoney } from '../../lib/format';
import { Trail } from './trail';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function whatHappened(report: InvestigationResponse, trail: Trail): string[] {
  const v = report.victim;
  const out: string[] = [];
  const flaggedOut = v.flagged_transfers.filter((t) => t.origin_account_id === v.account_id);
  const flaggedIn = v.flagged_transfers.filter((t) => t.destination_account_id === v.account_id);

  if (flaggedOut.length === 1) {
    const t = flaggedOut[0];
    out.push(
      `On ${formatDateTime(t.timestamp)}, ${v.account_id} sent ${formatMoney(t.amount, t.currency)} to ${t.destination_account_id} by ${channelLabel(t.channel)}. The rules flag this transfer as unusual for this account.`,
    );
  } else if (flaggedOut.length > 1) {
    const total = flaggedOut.reduce((s, t) => s + t.amount, 0);
    out.push(
      `${v.account_id} made ${plural(flaggedOut.length, 'transfer')} that the rules flag as unusual for this account, ${formatMoney(total)} in total, starting ${formatDateTime(flaggedOut[0].timestamp)}.`,
    );
  } else if (flaggedIn.length) {
    out.push(`${v.account_id} received ${plural(flaggedIn.length, 'transfer')} that the rules flag as unusual for this account; none of its outgoing transfers were flagged.`);
  } else {
    out.push(`No transfer was flagged as unusual for ${v.account_id}. ${report.trace.seed_selection}`);
  }

  const first = trail.downstream[0];
  if (first?.children.length) {
    const kids = first.children.map((c) => c.edge!);
    const soonest = Math.min(...kids.map((k) => k.minutes_from_parent ?? Infinity));
    const total = kids.reduce((s, k) => s + k.amount, 0);
    const when = Number.isFinite(soonest) ? `Starting ${Math.round(soonest)} min later` : 'Afterwards';
    out.push(`${when}, ${first.accountId} sent ${formatMoney(total)} on to ${plural(new Set(kids.map((k) => k.destination_account_id)).size, 'account')}.`);
  }

  const down = trail.branches.filter((b) => b.direction === 'downstream').length;
  const up = trail.branches.filter((b) => b.direction === 'upstream').length;
  if (down || up) {
    const parts = [down && plural(down, 'outflow branch', 'outflow branches'), up && plural(up, 'inflow branch', 'inflow branches')].filter(Boolean).join(' and ');
    out.push(
      `The trace follows ${parts} across ${plural(report.trace.nodes.length - 1, 'linked account')}, up to ${plural(report.trace.max_depth_reached, 'hop')} from ${v.account_id}.`,
    );
    const atLimit = trail.branches.filter((b) => b.ending.kind === 'depth_limit').length;
    const quiet = trail.branches.filter((b) => b.ending.kind === 'no_onward').length;
    const ends = [
      atLimit && `${plural(atLimit, 'branch', 'branches')} ${atLimit === 1 ? 'stops' : 'stop'} at the depth limit`,
      quiet && `${plural(quiet, 'branch', 'branches')} ${quiet === 1 ? 'shows' : 'show'} no further transfer in the data`,
    ]
      .filter(Boolean)
      .join('; ');
    if (ends) out.push(`${ends.charAt(0).toUpperCase()}${ends.slice(1)}.`);
  } else {
    out.push('No transfers could be traced from this account with the current settings.');
  }
  return out;
}
