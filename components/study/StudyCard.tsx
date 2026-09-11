'use client';

import { useState } from 'react';
import type { Flashcard } from '@/shared/types';
import type { Question } from '@/lib/questions';
import { Button } from '@/components/ui/Primitives';

/**
 * One card interaction: question → answer → progressive reveal → grading.
 * Information arrives in stages so recall happens before reading.
 */
export function StudyCard({
  card,
  question,
  revealMode,
  showPronunciation,
  revealedStage,
  onAdvanceStage,
  onReveal,
  onAnswerChoice,
  choice,
  typedValue,
  onTypedChange,
  onSubmitTyped,
  verdict,
}: {
  card: Flashcard;
  question: Question;
  revealMode: 'progressive' | 'all';
  showPronunciation: boolean;
  revealedStage: number;
  onAdvanceStage: () => void;
  onReveal: () => void;
  onAnswerChoice: (index: number) => void;
  choice: number | null;
  typedValue: string;
  onTypedChange: (value: string) => void;
  onSubmitTyped: () => void;
  verdict: { correct: boolean | null; message: string } | null;
}) {
  const [showTerm, setShowTerm] = useState(false);
  const answered = verdict !== null || choice !== null;
  const hasChoices = (question.choices?.length ?? 0) > 1;
  const isTermQuestion = question.type !== 'vi-to-en' && question.type !== 'fill-blank';

  const visibleStages = revealMode === 'all' && revealedStage > 0 ? question.stages : question.stages.slice(0, revealedStage);
  const nextStage = question.stages[revealedStage];

  return (
    <div className="study__card">
      <div style={{ flex: 1 }}>
        {isTermQuestion ? (
          <h2 className="study__term">{card.term}</h2>
        ) : (
          <>
            <p className="study__term" style={{ fontSize: 24 }}>
              {question.front}
            </p>
            {!showTerm ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ marginTop: 10, paddingLeft: 0 }}
                onClick={() => setShowTerm(true)}
              >
                Show the word
              </button>
            ) : (
              <h2 className="study__term" style={{ fontSize: 24, marginTop: 10 }}>
                {card.term}
              </h2>
            )}
          </>
        )}

        {showPronunciation && card.pronunciation ? <p className="study__pron">{card.pronunciation}</p> : null}

        <p className="study__prompt">{question.prompt}</p>

        {hasChoices && !answered ? (
          <div className="stack stack--sm" style={{ marginTop: 20 }}>
            {question.choices?.map((option, index) => (
              <button
                key={`${option}-${index}`}
                type="button"
                className="btn btn--soft"
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '12px 14px' }}
                onClick={() => onAnswerChoice(index)}
              >
                <span className="mono muted" style={{ marginRight: 10 }}>
                  {String.fromCharCode(65 + index)}
                </span>
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {question.typed && !answered ? (
          <div className="row" style={{ marginTop: 20 }}>
            <input
              className="input input--big"
              style={{ flex: 1 }}
              placeholder="Type your answer…"
              value={typedValue}
              onChange={(event) => onTypedChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && typedValue.trim()) onSubmitTyped();
              }}
              autoFocus
            />
            <Button variant="primary" onClick={onSubmitTyped} disabled={!typedValue.trim()}>
              Check
            </Button>
          </div>
        ) : null}

        {!hasChoices && !question.typed && !answered ? (
          <div className="row" style={{ marginTop: 22 }}>
            <Button variant="primary" size="lg" onClick={onReveal}>
              Reveal
            </Button>
            <span className="muted" style={{ fontSize: 12.5 }}>
              or press Space
            </span>
          </div>
        ) : null}

        {answered ? (
          <div className="reveal-line">
            <div className="study__divider" />
            <p className="eyebrow">{question.answerLabel}</p>
            <p className="study__answer" style={{ marginTop: 4 }}>
              {question.answer}
            </p>

            {visibleStages
              .filter((stage) => !(stage.kind === 'meaning' && question.type === 'recall-definition'))
              .map((stage, index) => (
                <div key={`${stage.kind}-${index}`} style={{ marginTop: 16 }}>
                  <p className="eyebrow">{stage.label}</p>
                  {stage.kind === 'vietnamese' ? (
                    <p className="study__vi" style={{ marginTop: 4 }}>
                      {stage.lines.join(' · ')}
                    </p>
                  ) : stage.kind === 'example' ? (
                    stage.lines.map((line) => (
                      <p key={line} className="study__example" style={{ marginTop: 6 }}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="study__answer" style={{ marginTop: 4, fontSize: 14.5 }}>
                      {stage.lines.join(' · ')}
                    </p>
                  )}
                </div>
              ))}

            {revealMode === 'progressive' && revealedStage < question.stages.length ? (
              <div className="row" style={{ marginTop: 18 }}>
                <Button variant="soft" onClick={onAdvanceStage}>
                  {nextStage ? `Show ${nextStage.label.toLowerCase()}` : 'Show more'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
