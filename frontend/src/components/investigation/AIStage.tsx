import React, { useEffect, useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { AIAnalysis, AIState, ExplanationView } from '../../types/investigation';
import { AI_STATE, BASIS } from './labels';
import { QA } from './RiskStage';
import { Tone } from './caseModel';
import { Badge, Refs, StageHeading } from './ui';

/** Older servers send only the legacy `status`. */
export function aiState(ai: AIAnalysis): AIState {
  if (ai.state) return ai.state;
  return ai.status === 'generated' ? 'completed' : ai.status === 'not_configured' ? 'not_configured' : 'unavailable';
}

const BASIS_TONE: Record<string, Tone> = { observed: 'fact', rule: 'iris', model: 'ice', hypothesis: 'elevated', limitation: 'neutral' };

export function useElapsed(since: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

/** Compact status for the case header, so a pending explanation is visible from every stage. */
export const AIStatusChip: React.FC<{ ai: AIAnalysis; explanation: ExplanationView | null; onOpen: () => void }> = ({ ai, explanation, onOpen }) => {
  const pending = explanation?.phase === 'pending';
  const seconds = useElapsed(pending ? explanation.since : undefined, pending);
  let label: string;
  let dot = 'bg-faint';
  if (pending) {
    label = `AI analyst writing${seconds ? `, ${seconds} s` : ''}`;
    dot = 'bg-iris animate-pulse';
  } else if (explanation?.phase === 'stale' || explanation?.phase === 'failed') {
    label = 'AI analyst unavailable';
    dot = 'bg-sev-elevated';
  } else {
    const s = aiState(explanation?.phase === 'done' ? explanation.analysis : ai);
    label = s === 'completed' ? 'AI explanation ready' : AI_STATE[s].title;
    dot = s === 'completed' ? 'bg-iris' : s === 'unavailable' ? 'bg-sev-elevated' : 'bg-faint';
  }
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:ring-iris-line">
      <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
  );
};

const Pending: React.FC<{ since?: number }> = ({ since }) => {
  const seconds = useElapsed(since, true);
  return (
    <div role="status" aria-live="polite" className="panel p-6" data-testid="ai-status" data-state="pending">
      <p className="flex items-center gap-3 font-semibold text-ink">
        <span className="w-4 h-4 rounded-full border-2 border-iris border-t-transparent animate-spin" aria-hidden="true" />
        AI analyst: writing the explanation… {seconds > 0 && <span className="font-normal text-faint">{seconds} s</span>}
      </p>
      <p className="mt-2 text-sm text-mute max-w-2xl">
        Every other stage of this investigation is complete and can be used now. Gemini can take a minute or more; its explanation will
        appear here, and nothing in the report changes when it does.
      </p>
    </div>
  );
};

const Block: React.FC<{ q: string; children: React.ReactNode }> = ({ q, children }) => (
  <section className="py-5 border-b border-line last:border-0">
    <h3 className="text-[15px] font-semibold text-ink">{q}</h3>
    <div className="mt-2 text-[15px] leading-relaxed text-ink-soft">{children}</div>
  </section>
);

export const AIStage: React.FC<{ ai: AIAnalysis; explanation: ExplanationView | null }> = ({ ai: reportAI, explanation }) => {
  const heading = (
    <StageHeading
      title="AI analyst"
      lead="A plain-language reading of the evidence by Google Gemini, from a pseudonymised extract of this report. It is shown only after it passes validation against this exact report, and it never changes a score, amount or finding."
    />
  );

  if (explanation?.phase === 'pending') {
    return (
      <div className="space-y-6">
        {heading}
        <Pending since={explanation.since} />
      </div>
    );
  }
  if (explanation?.phase === 'stale' || explanation?.phase === 'failed') {
    return (
      <div className="space-y-6">
        {heading}
        <div className="panel p-6" data-testid="ai-status" data-state={explanation.phase}>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            <Bot className="w-5 h-5 text-faint" aria-hidden="true" /> AI analyst: unavailable
            <Badge tone="elevated">{explanation.phase === 'stale' ? 'report changed' : 'request failed'}</Badge>
          </p>
          <p className="mt-2 text-sm text-mute max-w-2xl">
            {explanation.phase === 'stale'
              ? 'The explanation was for a different version of this report (the ledger changed in between), so it is not shown. Run the investigation again.'
              : explanation.message}
          </p>
        </div>
      </div>
    );
  }

  const ai = explanation?.phase === 'done' ? explanation.analysis : reportAI;
  const state = aiState(ai);
  const r = state === 'completed' ? ai.report : null;

  if (!r) {
    return (
      <div className="space-y-6">
        {heading}
        <div className="panel p-6" data-testid="ai-status" data-state={state}>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            <Bot className="w-5 h-5 text-faint" aria-hidden="true" /> {AI_STATE[state].title}
            <Badge tone={state === 'unavailable' ? 'elevated' : 'neutral'}>{state.replace(/_/g, ' ')}</Badge>
          </p>
          <p className="mt-2 text-sm text-mute max-w-2xl">{ai.message}</p>
          {state === 'completed' && ai.sections.length > 0 && <QA sections={ai.sections} />}
          {state !== 'completed' && (
            <p className="mt-4 text-sm text-ink-soft">The overview, fund trail, risk evidence and next steps are complete without it.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {heading}
      <article className="panel overflow-hidden" data-testid="ai-status" data-state="completed">
        <header className="px-6 py-4 bg-gradient-to-r from-iris-soft to-ice-soft border-b border-line flex flex-wrap items-center gap-2">
          <Sparkles className="w-4 h-4 text-iris" aria-hidden="true" />
          <span className="text-sm font-semibold text-ink">AI-generated by {ai.model ?? ai.provider}</span>
          <span className="text-xs text-mute">{ai.message}</span>
        </header>
        <div className="px-6">
          <Block q="What happened?">
            <p className="text-ink">{r.summary}</p>
          </Block>
          <Block q="Which movements and accounts deserve attention?">
            <ul className="space-y-2.5">
              {r.key_observations.map((o, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Badge tone={BASIS_TONE[o.basis]}>{BASIS[o.basis].label}</Badge>
                  <span className="min-w-0">{o.text}</span>
                  <Refs ids={o.evidence_ids} />
                </li>
              ))}
            </ul>
          </Block>
          <Block q="Why the evidence matters, and where it stops">
            <ul className="space-y-1.5 list-disc pl-5">
              {r.reasoning_and_limitations.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Block>
          <Block q="What would help verify it">
            <ul className="space-y-2">
              {r.recommended_manual_checks.map((c, i) => (
                <li key={i}>
                  {c.text} <Refs ids={c.evidence_ids} />
                </li>
              ))}
            </ul>
          </Block>
          <Block q="How complete is the evidence?">
            <p>Evidence completeness: {r.confidence_note}</p>
            {r.evidence_references.length > 0 && (
              <p className="mt-2 text-sm text-mute flex flex-wrap items-center gap-1.5">
                Records it relied on <Refs ids={r.evidence_references} />
              </p>
            )}
          </Block>
        </div>
        <footer className="px-6 py-4 bg-well border-t border-line text-xs text-mute">
          AI explanations can be wrong. Scores, amounts and findings come from the rules, the model and the ledger, not from this text.
        </footer>
      </article>
    </div>
  );
};

export default AIStage;
