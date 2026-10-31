import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, History, ScanSearch, Search, X } from 'lucide-react';
import { v2Api } from '../../services/v2Api';
import { V2ModelStatusResponse } from '../../types/v2';
import { normalizeAccountId } from '../../lib/accountId';

interface SampleAccount {
  id: string;
  name: string;
  category: 'in_case' | 'not_in_case';
  role: string;
  summary: string;
  activity: string;
}

// Facts taken from the synthetic ledger and sample case FS-2001. Ground-truth scenario labels are
// deliberately not shown: they are training labels, not findings an investigator would have.
const SAMPLE_ACCOUNTS: SampleAccount[] = [
  {
    id: 'ACC-000001',
    name: 'Aditi Joshi',
    category: 'in_case',
    role: 'FS-2001, reporting customer',
    summary: 'Sent the reported ₹2,50,000 IMPS transfer to ACC-000003 on 16 Jan 2026.',
    activity: '56 transactions',
  },
  {
    id: 'ACC-000003',
    name: 'Ishan Reddy',
    category: 'in_case',
    role: 'FS-2001, first receiver',
    summary: 'Received the reported ₹2,50,000 and sent ₹2,45,000 on to two accounts within 10 minutes.',
    activity: '54 transactions',
  },
  {
    id: 'ACC-000002',
    name: 'Sara Bhat',
    category: 'in_case',
    role: 'FS-2001, passed money on',
    summary: 'Received ₹1,20,000 from ACC-000003 and sent ₹1,18,000 onward 12 minutes later.',
    activity: '33 transactions',
  },
  {
    id: 'ACC-000004',
    name: 'Ishan Patel',
    category: 'not_in_case',
    role: 'Not in a sample case',
    summary: 'A retail account with no connection to the sample cases. Useful for comparison.',
    activity: '50 transactions',
  },
];

const RECENT_KEY = 'fs_v2_recent_accounts';

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private windows); recent lookups are a convenience only.
  }
}

export { normalizeAccountId };

export const V2SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [filter, setFilter] = useState<'all' | 'in_case' | 'not_in_case'>('all');
  const [modelStatus, setModelStatus] = useState<V2ModelStatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  useEffect(() => {
    v2Api.getModelsStatus().then(setModelStatus).catch(() => setStatusFailed(true));
  }, []);

  const open = (id: string) => {
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, 6);
    setRecent(next);
    writeRecent(next);
    navigate(`/tools/accounts/${encodeURIComponent(id)}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = normalizeAccountId(query.trim());
    if (!id) return setError('Enter an account ID, for example ACC-000001 or just 1.');
    setError('');
    open(id);
  };

  const shown = filter === 'all' ? SAMPLE_ACCOUNTS : SAMPLE_ACCOUNTS.filter((a) => a.category === filter);
  const modelLabel = statusFailed ? 'UNREACHABLE' : !modelStatus ? 'CHECKING' : modelStatus.inference_ready ? 'ONLINE' : 'UNAVAILABLE';

  return (
    <div className="space-y-10">
      <section aria-labelledby="search-heading" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div>
          <h1 id="search-heading" className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-ink">
            Look up an account
          </h1>
          <p className="mt-3 text-[17px] text-mute leading-relaxed max-w-[60ch]">
            Open any synthetic-ledger account by ID to see its transactions, its counterparties and the automated checks on its own
            history. Looking an account up does not connect it to a case.
          </p>
          <form onSubmit={submit} noValidate className="panel mt-7 p-5 sm:p-6 max-w-2xl">
            <label htmlFor="account-search" className="block text-sm font-semibold text-ink">
              Account ID
            </label>
            <div className="mt-2 flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
                <input
                  id="account-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter synthetic account ID, e.g. ACC-000001"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!error}
                  className="field !py-3 !pl-10 font-mono"
                />
              </div>
              <button type="submit" className="btn-primary min-h-[3rem] px-6">
                View account
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-2 text-sm font-medium text-sev-critical">
                {error}
              </p>
            )}
            {recent.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-mute">
                  <History className="w-3.5 h-3.5" aria-hidden="true" /> Recent
                </span>
                {recent.map((id) => (
                  <button key={id} type="button" onClick={() => open(id)} className="rounded-md bg-well ring-1 ring-line px-2 py-1 font-mono text-ink-soft hover:ring-iris-line">
                    {id}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setRecent([]);
                    writeRecent([]);
                  }}
                  className="inline-flex items-center gap-1 text-faint hover:text-ink"
                >
                  <X className="w-3 h-3" aria-hidden="true" /> Clear
                </button>
              </div>
            )}
          </form>
        </div>

        <aside className="panel p-5 text-sm">
          <h2 className="font-semibold text-ink">To follow an account’s money</h2>
          <p className="mt-1.5 text-mute leading-relaxed">
            An investigation traces where the money went, step by step, and assesses every linked account.
          </p>
          <Link to="/investigate" className="btn-secondary mt-4 w-full">
            <ScanSearch className="w-4 h-4" aria-hidden="true" /> Investigate an account
          </Link>
          <p className="mt-4 pt-4 border-t border-line text-xs text-mute flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${modelLabel === 'ONLINE' ? 'bg-[#16A34A]' : modelLabel === 'CHECKING' ? 'bg-faint' : 'bg-[#D97706]'}`} aria-hidden="true" />
            Account model <span className="font-semibold text-ink">{modelLabel}</span>
          </p>
        </aside>
      </section>

      <section aria-labelledby="samples-h" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="samples-h" className="font-display text-2xl font-bold text-ink">Example accounts</h2>
            <p className="mt-1 text-sm text-mute">Synthetic-ledger accounts, three of them from sample case FS-2001</p>
          </div>
          <div role="group" aria-label="Filter example accounts" className="flex gap-1 rounded-xl bg-white/70 ring-1 ring-line p-1 text-xs">
            {(
              [
                ['all', 'All'],
                ['in_case', 'In sample case'],
                ['not_in_case', 'Not in a case'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={`rounded-lg px-3 py-1.5 font-semibold ${filter === k ? 'bg-white text-ink shadow-[var(--shadow-float)]' : 'text-mute hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => open(a.id)} className="card-interactive w-full h-full p-5 text-left flex flex-col" aria-label={a.id}>
                <span className="font-mono text-[15px] font-semibold text-ink">{a.id}</span>
                <span className="mt-0.5 text-sm text-mute">{a.name}</span>
                <span className="mt-3 inline-flex self-start rounded-md bg-iris-soft px-2 py-0.5 text-xs font-semibold text-iris-deep ring-1 ring-inset ring-iris-line">
                  {a.role}
                </span>
                <span className="mt-3 text-sm text-ink-soft leading-relaxed">{a.summary}</span>
                <span className="mt-auto pt-4 flex items-center justify-between text-xs text-faint">
                  {a.activity}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-mute max-w-3xl">
          <strong className="text-ink font-semibold">Ground-Truth Reference Notice:</strong> All accounts, names, and transactions shown here are
          synthetic simulations created for demonstration and testing. No real customer data or real-world banking records are used.
          Roles describe where an account sits in a sample case, not a finding about it.
        </p>
      </section>
    </div>
  );
};

export default V2SearchPage;
