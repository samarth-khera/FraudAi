/**
 * Plain-language meaning of each input to the account-level model (v2-account).
 * Definitions follow backend/app/services/v2/risk_assessment.py and feature_builder.py.
 * They describe what a feature measures, not whether its value is good or bad.
 */

interface FeatureInfo {
  label: string;
  meaning: string;
  format?: (v: number) => string;
}

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const yesNo = (v: number) => (v >= 0.5 ? 'Yes' : 'No');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const count = (v: number) => Math.round(v).toLocaleString('en-IN');

const GLOSSARY: Record<string, FeatureInfo> = {
  customer_type_retail: { label: 'Customer type: retail', meaning: 'Whether the account is registered as a retail customer.', format: yesNo },
  customer_type_student: { label: 'Customer type: student', meaning: 'Whether the account is registered as a student account.', format: yesNo },
  customer_type_sme: { label: 'Customer type: small business', meaning: 'Whether the account is registered as a small business.', format: yesNo },
  customer_type_corporate: { label: 'Customer type: corporate', meaning: 'Whether the account is registered as a corporate customer.', format: yesNo },
  kyc_tier_level: { label: 'KYC level', meaning: 'Identity-verification tier (1 basic, 2 verified, 3 enhanced).', format: (v) => `Tier ${Math.round(v)}` },
  initial_balance: { label: 'Opening balance', meaning: 'Balance when the account entered the ledger.', format: inr },
  current_balance: { label: 'Current balance', meaning: 'Balance after the latest recorded transaction.', format: inr },
  balance_ratio: { label: 'Current vs. opening balance', meaning: 'Current balance divided by opening balance.', format: (v) => `${v.toFixed(2)}×` },
  total_transactions: { label: 'Total transactions', meaning: 'Number of transactions recorded for the account.', format: count },
  velocity_24h_count: { label: 'Transactions in the last 24 hours', meaning: 'Count in the 24 hours before the account’s latest transaction.', format: count },
  velocity_7d_count: { label: 'Transactions in the last 7 days', meaning: 'Count in the 7 days before the account’s latest transaction.', format: count },
  velocity_30d_count: { label: 'Transactions in the last 30 days', meaning: 'Count in the 30 days before the account’s latest transaction.', format: count },
  flow_through_ratio: { label: 'Money out vs. money in', meaning: 'Total sent divided by total received. Near 100% means most money received was sent on.', format: pct },
  rapid_pass_through: { label: 'Quick forwarding', meaning: 'At least 70% of a receipt over ₹1,000 was sent on within 30 minutes.', format: yesNo },
  median_dwell_minutes: { label: 'Typical time before forwarding', meaning: 'Median minutes between a receipt and the next outgoing transfer (−1 when none).', format: (v) => (v < 0 ? 'None observed' : `${Math.round(v)} min`) },
  has_dwell_time: { label: 'Forwarding observed', meaning: 'Whether any receipt was followed by an outgoing transfer within 30 minutes.', format: yesNo },
  max_amount: { label: 'Largest transaction', meaning: 'The single largest transaction amount.', format: inr },
  avg_amount: { label: 'Average transaction', meaning: 'The average transaction amount.', format: inr },
  amount_spike_ratio: { label: 'Largest vs. average transaction', meaning: 'How many times larger the biggest transaction is than the average.', format: (v) => `${v.toFixed(1)}×` },
  unique_counterparties: { label: 'Distinct counterparties', meaning: 'Number of different accounts it sent to or received from.', format: count },
  counterparty_diversity_ratio: { label: 'Counterparty variety', meaning: 'Distinct counterparties divided by total transactions.', format: pct },
  fan_in_ratio: { label: 'Share of incoming transactions', meaning: 'Incoming transactions as a share of all transactions.', format: pct },
  fan_out_ratio: { label: 'Share of outgoing transactions', meaning: 'Outgoing transactions as a share of all transactions.', format: pct },
  dormancy_gap_days: { label: 'Inactive gap before a large transfer', meaning: 'Days of inactivity before a transfer over ₹50,000 (0 when none).', format: (v) => `${Math.round(v)} days` },
  dormant_awakening_detected: { label: 'Large transfer after inactivity', meaning: 'A transfer over ₹50,000 followed more than 45 days of inactivity.', format: yesNo },
  cycle_detected: { label: 'Money sent back and forth', meaning: 'It both sent to and received from at least two of the same accounts.', format: yesNo },
};

export function featureInfo(name: string): { label: string; meaning: string; display: (v: number) => string } {
  const info = GLOSSARY[name];
  return {
    label: info?.label ?? name.replace(/_/g, ' '),
    meaning: info?.meaning ?? 'No description is available for this input.',
    display: info?.format ?? ((v: number) => String(v)),
  };
}
