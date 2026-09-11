'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Curiosity, Flashcard, QuestionType, Rating, StudyState } from '@/shared/types';
import { api } from '@/lib/api';
import { buildQuestion, chooseQuestionType, type Question } from '@/lib/questions';
import { orderQueue } from '@/lib/study-store';
import { useSettings } from '@/lib/settings';
import { Button, Chip, Stat } from '@/components/ui/Primitives';
import { EmptyState } from '@/components/ui/Primitives';
import { Modal } from '@/components/ui/Modal';
import { StudyCard } from './StudyCard';
import { QUESTION_LABELS } from '@/lib/questions';

const FEEDBACK: Record<Rating, string[]> = {
  again: ["Not quite. Let's make this one stick.", "That one slipped. It comes back soon.", 'Missed — good to know early.'],
  hard: ['Close. The distinction matters here.', 'Hard, but you got there.', 'Slow recall — this one needs another pass.'],
  good: ['Nice recall.', 'That one is sticking.', 'Good — steady progress.'],
  easy: ['Exactly.', 'Instant recall.', 'Locked in.'],
};

const GRADE_HINTS: Record<Rating, string> = {
  again: 'forgot',
  hard: 'struggled',
  good: 'got it',
  easy: 'instant',
};

export interface StudySessionProps {
  deckId: string;
  deckTitle: string;
  cards: Flashcard[];
  states: Record<string, StudyState>;
  loading: boolean;
  error: string | null;
  offline: boolean;
  onReview: (input: {
    cardId: string;
    rating: Rating;
    questionType: QuestionType;
    responseMs: number;
    correct: boolean | null;
  }) => void;
  onExit: () => void;
}

interface SessionStat {
  reviewed: number;
  remembered: number;
  weak: string[];
}

export function StudySession({
  deckId,
  deckTitle,
  cards,
  states,
  loading,
  error,
  offline,
  onReview,
  onExit,
}: StudySessionProps) {
  const [settings] = useSettings();
  const [started, setStarted] = useState(false);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [variant, setVariant] = useState(0);

  const [question, setQuestion] = useState<Question | null>(null);
  const [revealedStage, setRevealedStage] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<{ correct: boolean | null; message: string } | null>(null);
  const [curiosity, setCuriosity] = useState<Curiosity | null>(null);
  const [explore, setExplore] = useState<Curiosity | null>(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [stats, setStats] = useState<SessionStat>({ reviewed: 0, remembered: 0, weak: [] });
  const [finished, setFinished] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  const ordered = useMemo(() => orderQueue(cards, states), [cards, states]);
  const dueNow = useMemo(() => {
    const now = Date.now();
    return ordered.filter((card) => {
      const state = states[card.id];
      return !state?.nextReview || new Date(state.nextReview).getTime() <= now;
    });
  }, [ordered, states]);

  const start = useCallback(
    (onlyDue: boolean) => {
      const list = onlyDue && dueNow.length > 0 ? dueNow : ordered;
      setQueue(list.slice(0, Math.max(settings.study.dailyGoal, list.length)));
      setIndex(0);
      setVariant(0);
      setStats({ reviewed: 0, remembered: 0, weak: [] });
      setFinished(false);
      setStarted(true);
      startedAt.current = Date.now();
    },
    [dueNow, ordered, settings.study.dailyGoal],
  );

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    api
      .startSession(deckId)
      .then((session) => {
        if (!cancelled) setSessionId(session.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const card = queue[index] ?? null;

  useEffect(() => {
    if (!card) {
      setQuestion(null);
      return;
    }
    const built = buildQuestion({
      card,
      state: states[card.id],
      pool: cards,
      mix: settings.study.questionMix,
      includeVietnamese: true,
      showPronunciation: settings.study.showPronunciation,
      variant,
    });
    setQuestion(built);
    setRevealedStage(0);
    setChoice(null);
    setTyped('');
    setVerdict(null);
    setCuriosity(null);
    startedAt.current = Date.now();
  }, [card, cards, states, settings.study.questionMix, settings.study.showPronunciation, variant]);

  const curiosityEvery = settings.study.curiosity === 'often' ? 3 : settings.study.curiosity === 'sometimes' ? 5 : 0;

  const grade = useCallback(
    (rating: Rating, correct: boolean | null) => {
      if (!card || !question) return;
      onReview({
        cardId: card.id,
        rating,
        questionType: question.type,
        responseMs: Date.now() - startedAt.current,
        correct,
      });

      const messages = FEEDBACK[rating];
      setVerdict({
        correct,
        message: messages[Math.floor(Math.random() * messages.length)] ?? messages[0],
      });
      setStats((current) => ({
        reviewed: current.reviewed + 1,
        remembered: current.remembered + (rating === 'good' || rating === 'easy' ? 1 : 0),
        weak: rating === 'again' || rating === 'hard' ? [...current.weak.filter((id) => id !== card.id), card.id] : current.weak,
      }));

      if (curiosityEvery > 0 && (index + 1) % curiosityEvery === 0) {
        void api
          .curiosity({ card })
          .then((result) => setCuriosity(result))
          .catch(() => undefined);
      }
    },
    [card, question, onReview, curiosityEvery, index],
  );

  const next = useCallback(() => {
    setCuriosity(null);
    setVerdict(null);
    setChoice(null);
    setTyped('');
    setRevealedStage(0);
    if (index + 1 >= queue.length) {
      setFinished(true);
      if (deckId && sessionId) {
        const weakTopics = Array.from(
          new Set(
            stats.weak
              .map((id) => cards.find((item) => item.id === id)?.topics[0])
              .filter((topic): topic is string => Boolean(topic)),
          ),
        );
        void api.endSession(sessionId, {
          reviewed: stats.reviewed,
          remembered: stats.remembered,
          weakTopics,
          weakCardIds: stats.weak,
        }).catch(() => undefined);
      }
      return;
    }
    setIndex((value) => value + 1);
    setVariant((value) => value + 1);
  }, [index, queue.length, stats, cards, deckId, sessionId]);

  const reveal = useCallback(() => {
    setRevealedStage((value) => (value === 0 ? 1 : value));
  }, []);

  const advanceStage = useCallback(() => {
    setRevealedStage((value) => value + 1);
  }, []);

  const answerChoice = useCallback(
    (selected: number) => {
      if (!question) return;
      setChoice(selected);
      const correct = question.correctIndex === selected;
      setRevealedStage(question.stages.length);
      grade(correct ? 'good' : 'again', correct);
    },
    [question, grade],
  );

  const submitTyped = useCallback(() => {
    if (!question || !typed.trim()) return;
    const correct = question.accepts ? question.accepts(typed) : false;
    setRevealedStage(question.stages.length);
    setTyped(typed);
    grade(correct ? 'good' : 'again', correct);
  }, [question, typed, grade]);

  /* ------------------------------ keyboard -------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!started || finished) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (event.key !== 'Escape') return;
      }
      if (event.key === 'Escape') {
        onExit();
        return;
      }
      if (verdict) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          next();
        }
        return;
      }
      if (['1', '2', '3', '4'].includes(event.key) && revealedStage > 0) {
        event.preventDefault();
        const ratings: Rating[] = ['again', 'hard', 'good', 'easy'];
        const rating = ratings[Number(event.key) - 1];
        if (rating) grade(rating, rating !== 'again');
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (revealedStage === 0) reveal();
        else if (revealedStage < (question?.stages.length ?? 0)) advanceStage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, finished, verdict, next, reveal, advanceStage, revealedStage, question, onExit, grade]);

  /* -------------------------------- render -------------------------------- */

  if (loading && cards.length === 0) {
    return (
      <div className="container">
        <span className="spinner spinner--lg" aria-label="Loading deck" />
      </div>
    );
  }

  if (error && cards.length === 0) {
    return (
      <div className="container">
        <EmptyState
          title="This deck could not be loaded"
          text={error}
          action={
            <Link href="/study" className="btn btn--soft btn--sm">
              Back to study
            </Link>
          }
        />
      </div>
    );
  }

  if (!started) {
    return (
      <div className="container container--narrow">
        <div className="panel panel--pad-lg" style={{ textAlign: 'center' }}>
          <p className="eyebrow">Start</p>
          <h1 className="page-title" style={{ fontSize: 25 }}>
            {dueNow.length > 0 ? `${dueNow.length} words need attention` : `${cards.length} cards in this deck`}
          </h1>
          <p className="page-sub" style={{ margin: '0 auto 22px' }}>
            {deckTitle}
            {dueNow.length > 0
              ? ' · these are the ones the scheduler says to review now.'
              : ' · nothing is due, so you can run the whole deck.'}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" size="lg" onClick={() => start(dueNow.length > 0)}>
              {dueNow.length > 0 ? `Review ${Math.min(dueNow.length, settings.study.dailyGoal)} cards` : 'Study all cards'}
            </Button>
            {dueNow.length > 0 && cards.length > dueNow.length ? (
              <Button variant="ghost" size="lg" onClick={() => start(false)}>
                Study all {cards.length}
              </Button>
            ) : null}
          </div>
          {offline ? (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
              Offline mode — reviews are saved on this device and synced later.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (finished) {
    const weakCards = stats.weak
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is Flashcard => Boolean(card));
    const weakTopic = weakCards[0]?.topics[0] ?? 'collocations';
    return (
      <div className="container container--narrow">
        <div className="panel panel--pad-lg">
          <p className="eyebrow">Session complete</p>
          <h1 className="page-title" style={{ fontSize: 25 }}>
            {stats.reviewed} reviewed
          </h1>
          <p className="page-sub">
            {stats.remembered} remembered · {stats.reviewed - stats.remembered} need another pass
          </p>
          <div className="divider" />
          <div className="stat-row" style={{ marginBottom: 20 }}>
            <Stat value={stats.reviewed} label="reviewed" />
            <Stat value={stats.remembered} label="remembered" />
            <Stat value={stats.reviewed - stats.remembered} label="to review again" />
          </div>
          {weakCards.length > 0 ? (
            <>
              <p style={{ margin: '0 0 10px' }}>
                Your weakest area this session was <strong>{weakTopic}</strong>.
              </p>
              <div className="thumb-strip" style={{ marginBottom: 20 }}>
                {weakCards.map((item) => (
                  <Chip key={item.id} tone="warn">
                    {item.term}
                  </Chip>
                ))}
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  setQueue(weakCards);
                  setIndex(0);
                  setVariant((value) => value + 1);
                  setStats({ reviewed: 0, remembered: 0, weak: [] });
                  setFinished(false);
                }}
              >
                Review weak words
              </Button>
            </>
          ) : (
            <p>Nothing to repeat — every card came back. Come back when the scheduler says so.</p>
          )}
          <div className="divider" />
          <div className="row row--wrap">
            <Link href="/study" className="btn btn--soft">
              Another deck
            </Link>
            <Link href={`/decks/${deckId}`} className="btn btn--ghost">
              Open deck
            </Link>
            <Link href="/" className="btn btn--ghost">
              Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!card || !question) {
    return (
      <div className="container">
        <span className="spinner spinner--lg" />
      </div>
    );
  }

  return (
    <div className="study">
      <div className="study__bar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
          ← Exit
        </button>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {deckTitle}
        </span>
        <Chip>{QUESTION_LABELS[question.type]}</Chip>
        <div className="study__progress">
          <div className="study__progress-fill" style={{ width: `${((index + 1) / Math.max(queue.length, 1)) * 100}%` }} />
        </div>
        <span className="muted" style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
          {index + 1}/{queue.length}
        </span>
      </div>

      <div className="study__stage">
        <StudyCard
          card={card}
          question={question}
          revealMode={settings.study.reveal}
          showPronunciation={settings.study.showPronunciation}
          revealedStage={revealedStage}
          onAdvanceStage={advanceStage}
          onReveal={reveal}
          onAnswerChoice={answerChoice}
          choice={choice}
          typedValue={typed}
          onTypedChange={setTyped}
          onSubmitTyped={submitTyped}
          verdict={verdict}
        />
      </div>

      <div className="study__grades" style={{ flexDirection: 'column' }}>
        {verdict ? (
          <>
            <p className="study__feedback" style={{ color: verdict.correct === false ? 'var(--bad)' : 'var(--good)' }}>
              {verdict.message}
            </p>
            {curiosity ? (
              <div className="curiosity" style={{ width: '100%', maxWidth: 680 }}>
                <p className="curiosity__title">{curiosity.title}</p>
                <p className="curiosity__body">{curiosity.body}</p>
                {curiosity.compareWith ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ marginTop: 8, paddingLeft: 0 }}
                    onClick={() => {
                      setExploreLoading(true);
                      void api
                        .curiosity({ card, contrastWith: curiosity.compareWith })
                        .then((result) => setExplore(result))
                        .catch(() => undefined)
                        .finally(() => setExploreLoading(false));
                    }}
                  >
                    Explore the difference with “{curiosity.compareWith}” →
                  </button>
                ) : null}
              </div>
            ) : null}
            <div style={{ width: '100%' }}>
              <div className="study__grades" style={{ padding: '10px 0 0' }}>
                <button type="button" className="btn btn--primary" onClick={next}>
                  Next →
                </button>
              </div>
            </div>
          </>
        ) : revealedStage > 0 ? (
          <>
            <p className="study__feedback muted" style={{ fontWeight: 500, fontSize: 13 }}>
              How well did that come back?
            </p>
            <div className="study__grades" style={{ padding: '10px 0 0', width: '100%' }}>
              {(['again', 'hard', 'good', 'easy'] as Rating[]).map((rating, gradeIndex) => (
                <button
                  key={rating}
                  type="button"
                  className={`grade grade--${rating}`}
                  onClick={() => grade(rating, rating !== 'again')}
                >
                  <span style={{ textTransform: 'capitalize' }}>{rating}</span>
                  <span className="grade__hint">{GRADE_HINTS[rating]}</span>
                  <span className="grade__key">{gradeIndex + 1}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="study__feedback muted" style={{ fontWeight: 500, fontSize: 13 }}>
            Think it through, then reveal.
          </p>
        )}
      </div>

      <Modal
        open={Boolean(explore)}
        title="Explore the difference"
        onClose={() => setExplore(null)}
        footer={
          <Button variant="primary" onClick={() => setExplore(null)}>
            Got it
          </Button>
        }
      >
        {exploreLoading ? <span className="spinner" /> : null}
        {explore ? (
          <div className="stack stack--sm">
            <p className="eyebrow">{explore.title}</p>
            <p style={{ margin: 0, lineHeight: 1.65 }}>{explore.body}</p>
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Modal>
    </div>
  );
}

export { chooseQuestionType };
