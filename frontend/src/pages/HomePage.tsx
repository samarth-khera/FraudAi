import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, FileText, GitBranch, UserSearch, ClipboardCheck, FolderOpen } from 'lucide-react';
import { SyntheticDataNote } from '../components/ui/StateViews';

export const SAMPLE_CASE_ID = 'FS-2001';

const STEPS = [
  {
    icon: FileText,
    title: 'Summary',
    text: 'Read what was reported and compare the complaint with the recorded transfer.',
  },
  {
    icon: GitBranch,
    title: 'Money flow',
    text: 'Follow the recorded transfers from the reporting customer to every account that received money.',
  },
  {
    icon: UserSearch,
    title: 'Accounts & risk',
    text: 'For each account, see what the records show and what automated checks say, with their reasons and limits.',
  },
  {
    icon: ClipboardCheck,
    title: 'Review & history',
    text: 'Record your decision and reasoning. Every decision is saved to the case history.',
  },
];

export const HomePage: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const fadeUp = (delay: number) =>
    reduceMotion
      ? {}
      : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <div className="space-y-14 sm:space-y-20">
      <section className="pt-4 sm:pt-10 max-w-3xl">
        <motion.p {...fadeUp(0)} className="text-sm font-semibold text-[#B45309]">
          Fraud investigation workspace
        </motion.p>
        <motion.h1
          {...fadeUp(0.05)}
          className="mt-3 font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-[#1A1714] leading-[1.1]"
        >
          Follow reported money across connected accounts, then record what you decide.
        </motion.h1>
        <motion.p {...fadeUp(0.1)} className="mt-5 text-base sm:text-lg text-[#6B655B] leading-relaxed">
          When a customer reports a fraudulent transfer, FraudShield AI shows where the money went next, which
          accounts may need attention and why, and keeps a history of every review decision. It supports an
          investigator’s judgement; it does not prove intent or take action on accounts.
        </motion.p>
        <motion.div {...fadeUp(0.15)} className="mt-8 flex flex-col sm:flex-row gap-3">
          <Link to={`/cases/${SAMPLE_CASE_ID}`} className="btn-primary text-sm px-6 min-h-[3rem]">
            Start sample investigation
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link to="/cases" className="btn-secondary text-sm px-6 min-h-[3rem]">
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            Open investigations
          </Link>
        </motion.div>
        <motion.div {...fadeUp(0.2)}>
          <SyntheticDataNote className="mt-4">
            The sample case, {SAMPLE_CASE_ID}, is demonstration data: a synthetic complaint about a ₹2,50,000 transfer,
            traced through a synthetic account ledger.
          </SyntheticDataNote>
        </motion.div>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className="font-display text-xl sm:text-2xl font-bold text-[#1A1714]">
          How an investigation works
        </h2>
        <p className="mt-2 text-sm text-[#6B655B] max-w-2xl">
          Every case opens in the same four sections, in this order. You can move between them at any time without
          losing your place.
        </p>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="rounded-2xl border border-[#EAE3D6] bg-white p-5">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-[#FFF4E6] text-[#EA8500] flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold text-[#8C857B]">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold text-[#1A1714]">{step.title}</h3>
                <p className="mt-1.5 text-sm text-[#6B655B] leading-relaxed">{step.text}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="limits-heading" className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 id="limits-heading" className="font-display text-xl sm:text-2xl font-bold text-[#1A1714]">
            What the results mean
          </h2>
          <p className="mt-2 text-sm text-[#6B655B] leading-relaxed max-w-xl">
            Transfers come from transaction records. Risk scores come from rules and a machine-learning model and are
            prompts for review, not findings. The workspace always labels which is which.
          </p>
        </div>
        <ul className="space-y-3 text-sm">
          {[
            ['Receiving money is not wrongdoing.', 'Accounts downstream of a complaint may belong to people who did nothing wrong.'],
            ['A high score is not proof.', 'The account model was trained and tested only on synthetic data, and it misses cases.'],
            ['Nothing happens automatically.', 'No account is frozen or flagged without a person recording a decision.'],
          ].map(([title, text]) => (
            <li key={title} className="rounded-2xl border border-[#EAE3D6] bg-[#FAF7F2] p-4">
              <p className="font-semibold text-[#1A1714]">{title}</p>
              <p className="mt-0.5 text-[#6B655B]">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-[#EAE3D6] bg-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-[#1A1714]">Looking for model metrics or the full audit log?</h2>
          <p className="mt-1 text-sm text-[#6B655B]">
            Model evaluation, audit search and other technical views are under Tools.
          </p>
        </div>
        <Link to="/tools" className="btn-secondary shrink-0">
          Open tools
        </Link>
      </section>
    </div>
  );
};

export default HomePage;
