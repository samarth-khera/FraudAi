import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, FileSearch, GitBranch, Search, Calculator } from 'lucide-react';

const TOOLS = [
  {
    to: '/tools/model',
    icon: BarChart3,
    title: 'Model performance',
    text: 'How the account model and the PaySim transaction benchmark were trained and tested, with their metrics and limits.',
    caveat: 'Test results on synthetic data. They do not describe any particular case.',
  },
  {
    to: '/tools/audit',
    icon: FileSearch,
    title: 'Audit search',
    text: 'Search and export recorded events across every case: decisions, case changes and system calculations.',
    caveat: 'Each case’s own history is already shown in its Review & history section.',
  },
  {
    to: '/tools/accounts',
    icon: Search,
    title: 'Account lookup',
    text: 'Open any of the 10,000 synthetic-ledger accounts by ID, outside a case, with its full ledger and automated checks.',
    caveat: 'Looking up an account does not connect it to a case.',
  },
  {
    to: '/tools/fund-flow',
    icon: GitBranch,
    title: 'Fund-flow explorer',
    text: 'Trace outgoing or incoming transfers from any synthetic-ledger account with adjustable depth and filters.',
    caveat: 'Follows all of an account’s transfers, not only those in a case, so most results are ordinary payments.',
  },
  {
    to: '/tools/transaction-model',
    icon: Calculator,
    title: 'Transaction model check',
    text: 'Score a single transaction with the PaySim benchmark model and see which inputs drove the score.',
    caveat: 'PaySim is a separate mobile-money simulation. Its scores say nothing about accounts in the sample cases.',
  },
];

export const ToolsPage: React.FC = () => (
  <div className="space-y-6">
    <div>
      <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">Tools</h1>
      <p className="mt-1.5 text-sm text-[#6B655B] max-w-2xl">
        Technical views for checking the models and the raw records. You do not need them to work a case; everything an
        investigation needs is inside the case itself.
      </p>
    </div>
    <ul className="grid gap-4 md:grid-cols-2">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <li key={t.to}>
            <Link to={t.to} className="card-interactive flex h-full flex-col p-5">
              <span className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-[#6B655B] flex items-center justify-center">
                  <Icon className="w-4.5 h-4.5" aria-hidden="true" />
                </span>
                <span className="font-semibold text-[#1A1714]">{t.title}</span>
              </span>
              <span className="mt-3 text-sm text-[#1A1714] leading-relaxed">{t.text}</span>
              <span className="mt-2 text-xs text-[#6B655B] leading-relaxed">{t.caveat}</span>
              <span className="mt-auto pt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#B45309]">
                Open <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  </div>
);

export default ToolsPage;
