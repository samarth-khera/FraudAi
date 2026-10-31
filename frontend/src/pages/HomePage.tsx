import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Database, FolderOpen, Users } from 'lucide-react';
import { AccountEntry } from '../components/investigation/InvestigationForm';
import { STAGES } from '../components/investigation/CaseView';
import { formatDateTime } from '../lib/format';
import { useModelStatus } from '../lib/useModelStatus';
import { v2Api } from '../services/v2Api';
import { DataSourceInfo } from '../types/investigation';

export const SAMPLE_CASE_ID = 'FS-2001';

const LedgerStatus: React.FC = () => {
  const [source, setSource] = useState<DataSourceInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const model = useModelStatus();

  useEffect(() => {
    let live = true;
    v2Api
      .getDataSource()
      .then((s) => live && setSource(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="ledger-h" className="panel p-5">
      <h2 id="ledger-h" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Database className="w-4 h-4 text-faint" aria-hidden="true" /> Ledger and model
      </h2>
      {source ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <dt className="text-xs text-mute">Accounts</dt>
            <dd className="mt-0.5 font-display text-2xl font-bold">{source.accounts_count.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Transactions</dt>
            <dd className="mt-0.5 font-display text-2xl font-bold">{source.transactions_count.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Data as of</dt>
            <dd className="mt-0.5 text-sm font-semibold">{formatDateTime(source.data_as_of)}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Account model</dt>
            <dd className="mt-0.5 text-sm font-semibold">{model.label}</dd>
          </div>
        </dl>
      ) : failed ? (
        <p className="mt-3 text-sm text-mute">The server could not be reached. The free server sleeps when idle; it can take about a minute to wake.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3" role="status" aria-label="Loading ledger status">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-well animate-pulse" />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-mute leading-relaxed">
        {source?.is_synthetic === false
          ? source.disclosure
          : 'Investigations run on a synthetic account ledger. No real customers or bank records are involved.'}
      </p>
    </section>
  );
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-14">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] items-start pt-2">
        <div className="rise-in">
          <h1 className="font-display text-4xl sm:text-[56px] font-bold tracking-tight text-ink leading-[1.02] max-w-[16ch]">
            Follow reported money, one transfer at a time.
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-mute max-w-[58ch]">
            FraudShield traces where an account’s money went and where it came from, shows the evidence behind every risk signal, and
            suggests what to examine next. It supports an investigator’s judgement; it does not prove intent or act on accounts.
          </p>
          <div className="mt-8 max-w-2xl">
            <AccountEntry onOpen={(id) => navigate(`/investigate?account=${encodeURIComponent(id)}`)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/investigate" className="btn-ghost">
              Investigate an account
            </Link>
            <Link to={`/cases/${SAMPLE_CASE_ID}`} className="btn-ghost">
              Open sample case
            </Link>
          </div>
        </div>
        <LedgerStatus />
      </section>

      <section aria-labelledby="journey-h">
        <h2 id="journey-h" className="font-display text-2xl font-bold text-ink">How an investigation unfolds</h2>
        <p className="mt-1.5 text-[15px] text-mute max-w-2xl">One question at a time, in the order an investigator needs the answers.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((s, i) => (
            <li key={s.id} className="panel-quiet bg-white/70 p-4">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-iris to-ice text-white text-xs font-bold flex items-center justify-center" aria-hidden="true">
                {i + 1}
              </span>
              <p className="mt-3 font-semibold text-ink">{s.label}</p>
              <p className="mt-1 text-sm text-mute leading-relaxed">{s.question}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link to="/cases" className="card-interactive p-5 flex items-start gap-4">
          <span className="w-10 h-10 rounded-xl bg-iris-soft text-iris flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              Open investigations <ArrowRight className="w-4 h-4 text-faint" aria-hidden="true" />
            </span>
            <span className="mt-1 block text-sm text-mute">Saved cases built from customer complaints, with every review decision and its history.</span>
          </span>
        </Link>
        <Link to="/tools/accounts" className="card-interactive p-5 flex items-start gap-4">
          <span className="w-10 h-10 rounded-xl bg-ice-soft text-ice flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              Look up an account <ArrowRight className="w-4 h-4 text-faint" aria-hidden="true" />
            </span>
            <span className="mt-1 block text-sm text-mute">Any ledger account’s full history and automated checks, outside an investigation.</span>
          </span>
        </Link>
      </section>

      <section aria-labelledby="limits-heading" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <h2 id="limits-heading" className="font-display text-2xl font-bold text-ink">What the results mean</h2>
          <p className="mt-2 text-[15px] text-mute leading-relaxed max-w-xl">
            Transfers come from transaction records. Risk signals come from rules and a machine-learning model and are prompts for
            review, not findings. Every screen labels which is which.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3 text-sm">
          {[
            ['Receiving money is not wrongdoing.', 'Accounts downstream of a complaint may belong to people who did nothing wrong.'],
            ['A high score is not proof.', 'The account model was trained and tested only on synthetic data, and it misses cases.'],
            ['Nothing happens automatically.', 'No account is frozen or flagged without a person recording a decision.'],
          ].map(([title, text]) => (
            <li key={title} className="panel p-4">
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-1 text-mute">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default HomePage;
