/**
 * "What happened", written from the report by fixed rules. Every number and ID comes from the response; nothing is
 * inferred beyond what the trace and the rules already state.
 */
import { InvestigationResponse, TransferFlag } from '../../types/investigation';
import { DynamicReport } from '../../types/dynamic';
import { channelLabel, formatDateTime, formatMoney, formatDuration } from '../../lib/format';
import { Trail } from './trail';
import { MODEL_FLAG_CODE } from './labels';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Which check flagged these transfers: the fixed rules, the transaction model, or both. Never one for the other. */
function flagSource(ts: { flags: TransferFlag[] }[]): 'rules' | 'model' | 'both' {
  const model = ts.some((t) => t.flags.some((f) => f.code === MODEL_FLAG_CODE));
  const rules = ts.some((t) => t.flags.some((f) => f.code !== MODEL_FLAG_CODE));
  return model && rules ? 'both' : model ? 'model' : 'rules';
}

const ONE_FLAG = {
  rules: 'The rules flag this transfer as unusual for this account.',
  model: 'The transaction model flags this transfer for review.',
  both: 'The rules flag this transfer as unusual for this account, and the transaction model flags it for review.',
};
const MANY_FLAGGED = {
  rules: 'that the rules flag as unusual for this account',
  model: 'that the transaction model flags for review',
  both: 'that the rules, the transaction model or both flag for review',
};

const byModel = (t: { flags: TransferFlag[] }) => t.flags.some((f) => f.code === MODEL_FLAG_CODE);

/** `modelIsEvidence`: the transaction model is validated on this dataset, so a transfer only a fixed rule flags is
 *  not treated as suspicious (the overview lists it separately); the story then counts the two kinds apart. */
export function whatHappened(report: InvestigationResponse, trail: Trail, modelIsEvidence = false): string[] {
  const v = report.victim;
  const out: string[] = [];
  const flaggedOut = v.flagged_transfers.filter((t) => t.origin_account_id === v.account_id);
  const flaggedIn = v.flagged_transfers.filter((t) => t.destination_account_id === v.account_id);

  if (flaggedOut.length === 1) {
    const t = flaggedOut[0];
    out.push(
      `On ${formatDateTime(t.timestamp)}, ${v.account_id} sent ${formatMoney(t.amount, t.currency)} to ${t.destination_account_id} by ${channelLabel(t.channel)}. ${ONE_FLAG[flagSource([t])]}`,
    );
  } else if (flaggedOut.length > 1) {
    const total = flaggedOut.reduce((s, t) => s + t.amount, 0);
    const model = flaggedOut.filter(byModel);
    const ruleOnly = flaggedOut.filter((t) => !byModel(t));
    const start = `starting ${formatDateTime(flaggedOut[0].timestamp)}`;
    if (model.length && ruleOnly.length) {
      // Never one total that mixes the two: say how many each check flagged, and what each amounts to.
      const sum = (ts: typeof flaggedOut) => formatMoney(ts.reduce((s, t) => s + t.amount, 0));
      out.push(
        `${v.account_id} made ${plural(flaggedOut.length, 'flagged transfer')}, ${start}: ${plural(model.length, 'transfer')} (${sum(model)}) ` +
          `flagged by the transaction model and ${ruleOnly.length} (${sum(ruleOnly)}) by a fixed rule only` +
          (modelIsEvidence ? ', which the validated transaction model does not support.' : '.'),
      );
    } else {
      out.push(
        `${v.account_id} made ${plural(flaggedOut.length, 'transfer')} ${MANY_FLAGGED[flagSource(flaggedOut)]}, ${formatMoney(total)} in total, ${start}.`,
      );
    }
  } else if (flaggedIn.length) {
    out.push(`${v.account_id} received ${plural(flaggedIn.length, 'transfer')} ${MANY_FLAGGED[flagSource(flaggedIn)]}; none of its outgoing transfers were flagged.`);
  } else {
    out.push(`No transfer was flagged as unusual for ${v.account_id}. ${report.trace.seed_selection}`);
  }

  const first = trail.downstream[0];
  if (first?.children.length) {
    const kids = first.children.map((c) => c.edge!);
    const soonest = Math.min(...kids.map((k) => k.minutes_from_parent ?? Infinity));
    const total = kids.reduce((s, k) => s + k.amount, 0);
    const when = Number.isFinite(soonest) ? `Starting ${formatDuration(soonest)} later` : 'Afterwards';
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

/** Counts each check's flags apart: with a validated model, the list holds the model's flags only, and transfers only a
 *  fixed rule flags are counted separately (they are shown below, not treated as suspicious). */
export function suspiciousHeading(intel: DynamicReport): string {
  const n = intel.suspicious_transactions.length;
  const was = (k: number) => (k === 1 ? 'was' : 'were');
  const scored = 'Each was scored using only records from before it.';
  if (!intel.transaction_scoring.model_used_as_evidence) {
    return `${n} of this account's transfers ${was(n)} flagged by the fixed rules (the transaction model is not validated on this dataset, so its scores are reference only). ${scored}`;
  }
  const r = intel.uncorroborated_rule_flags.length;
  const more = r ? ` ${r} more ${was(r)} flagged by a fixed rule only; ${r === 1 ? 'it is' : 'they are'} listed below and not treated as suspicious.` : '';
  return `${n} of this account's transfers ${was(n)} flagged by the validated transaction model.${more} ${scored}`;
}
