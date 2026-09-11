'use client';

import type { BuildEvent, Flashcard } from '@/shared/types';

export interface BuildStepView {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
}

export interface BuildToolView {
  id: string;
  tool: string;
  status: 'running' | 'done' | 'error';
  summary: string;
}

export interface BuildState {
  steps: BuildStepView[];
  tools: BuildToolView[];
  cards: Flashcard[];
  messages: string[];
  finished: boolean;
}

export const emptyBuildState = (): BuildState => ({ steps: [], tools: [], cards: [], messages: [], finished: false });

export function applyBuildEvent(state: BuildState, event: BuildEvent): BuildState {
  switch (event.type) {
    case 'step': {
      const steps = [...state.steps];
      const index = steps.findIndex((step) => step.id === event.stepId);
      const next = { id: event.stepId, label: event.label, status: event.status, detail: event.detail };
      if (index === -1) steps.push(next);
      else steps[index] = { ...steps[index], ...next };
      return { ...state, steps };
    }
    case 'tool': {
      const tools = [...state.tools];
      const index = tools.findIndex((tool) => tool.id === `${event.tool}:${event.status === 'running' ? 'r' : 'd'}:${event.summary}`);
      const entry: BuildToolView = { id: `${event.tool}:${event.status}:${tools.length}`, tool: event.tool, status: event.status, summary: event.summary };
      if (index === -1) tools.push(entry);
      else tools[index] = entry;
      return { ...state, tools: tools.slice(-40) };
    }
    case 'card':
      return { ...state, cards: [...state.cards, event.card] };
    case 'warn':
      return { ...state, messages: [...state.messages, event.message] };
    case 'done':
      return { ...state, finished: true };
    default:
      return state;
  }
}

export function BuildProgress({ state, cardTarget }: { state: BuildState; cardTarget: number }) {
  const done = state.steps.filter((step) => step.status === 'done').length;
  const total = Math.max(state.steps.length, 1);
  const percent = Math.round((done / total) * 100);

  return (
    <div className="panel panel--pad-lg">
      <div className="row row--between" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">Building your deck</p>
          <h3 className="section__title" style={{ marginTop: 4 }}>
            {state.cards.length} of {cardTarget} cards created
          </h3>
        </div>
        {!state.finished ? <span className="spinner spinner--lg" aria-label="Working" /> : null}
      </div>

      <div className="study__progress" style={{ marginBottom: 16 }}>
        <div className="study__progress-fill" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>

      <div className="build-steps">
        {state.steps.map((step) => (
          <div key={step.id} className={`build-step build-step--${step.status}`}>
            <span className="build-step__mark" aria-hidden="true">
              {step.status === 'done' ? '✓' : step.status === 'error' ? '!' : '•'}
            </span>
            <span>{step.label}</span>
            {step.detail ? <span className="build-step__detail">{step.detail}</span> : null}
          </div>
        ))}
      </div>

      {state.messages.length > 0 ? (
        <div className="stack stack--sm" style={{ marginTop: 14 }}>
          {state.messages.map((message) => (
            <div key={message} className="banner banner--warn">
              {message}
            </div>
          ))}
        </div>
      ) : null}

      {state.cards.length > 0 ? (
        <div className="thumb-strip" style={{ marginTop: 16 }}>
          {state.cards.slice(-12).map((card) => (
            <span key={card.id} className="chip chip--accent">
              {card.term}
            </span>
          ))}
          {state.cards.length > 12 ? <span className="chip">+{state.cards.length - 12} more</span> : null}
        </div>
      ) : null}

      {state.tools.length > 0 ? (
        <details style={{ marginTop: 16 }}>
          <summary className="muted" style={{ fontSize: 12.5, cursor: 'pointer' }}>
            Tool activity ({state.tools.length})
          </summary>
          <div className="stack stack--sm" style={{ marginTop: 8 }}>
            {state.tools.slice(-8).map((tool) => (
              <div key={tool.id} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                <code className="mono muted">{tool.tool}</code>
                <span className="muted">{tool.summary}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
