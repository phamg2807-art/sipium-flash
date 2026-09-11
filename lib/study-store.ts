'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Flashcard, QuestionType, Rating, StudyState } from '@/shared/types';
import { isDue, queueScore, schedule } from '@/shared/srs';
import { api, isTransient } from './api';
import { idbAll, idbDelete, idbGet, idbPut } from './idb';

export interface PendingReview {
  id: string;
  cardId: string;
  deckId: string;
  rating: Rating;
  questionType: QuestionType;
  responseMs: number;
  correct: boolean | null;
  createdAt: number;
}

interface CacheEntry {
  deckId: string;
  cards: Flashcard[];
  states: StudyState[];
  cachedAt: number;
}

export interface StudyStore {
  cards: Flashcard[];
  states: Record<string, StudyState>;
  dueCount: number;
  newCount: number;
  loading: boolean;
  error: string | null;
  offline: boolean;
  pendingCount: number;
  submitReview: (input: {
    cardId: string;
    rating: Rating;
    questionType: QuestionType;
    responseMs: number;
    correct: boolean | null;
  }) => void;
  reload: () => void;
}

/** Reviews are applied locally first, then pushed; failures go to an outbox. */
export function useStudy(deckId: string | null): StudyStore {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [states, setStates] = useState<Record<string, StudyState>>({});
  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [version, setVersion] = useState(0);
  const deckRef = useRef(deckId);
  deckRef.current = deckId;

  const flushOutbox = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    const pending = await idbAll<PendingReview>('outbox');
    if (pending.length === 0) {
      setPendingCount(0);
      return;
    }
    for (const entry of pending) {
      try {
        await api.review({
          cardId: entry.value.cardId,
          deckId: entry.value.deckId,
          rating: entry.value.rating,
          questionType: entry.value.questionType,
          responseMs: entry.value.responseMs,
          correct: entry.value.correct,
        });
        await idbDelete('outbox', entry.key);
      } catch (error) {
        if (!isTransient(error)) await idbDelete('outbox', entry.key);
        break;
      }
    }
    const remaining = await idbAll<PendingReview>('outbox');
    setPendingCount(remaining.length);
  }, []);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      // Show the cached queue immediately, then refresh from the server.
      const cached = await idbGet<CacheEntry>('meta', `queue:${deckId}`);
      if (cached && !cancelled) {
        setCards(cached.cards);
        setStates(Object.fromEntries(cached.states.map((state) => [state.cardId, state])));
        setLoading(false);
      }

      try {
        const result = await api.studyQueue(deckId);
        if (cancelled) return;
        const stateMap = Object.fromEntries(result.states.map((state) => [state.cardId, state]));
        setCards(result.deck.cards);
        setStates(stateMap);
        setDueCount(result.dueCount);
        setNewCount(result.newCount);
        setError(null);
        setOffline(false);
        await idbPut<CacheEntry>('meta', `queue:${deckId}`, {
          deckId,
          cards: result.deck.cards,
          states: result.states,
          cachedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        if (!cached) setError(err instanceof Error ? err.message : 'Could not load this deck.');
        setOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }

      await flushOutbox();
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId, version, flushOutbox]);

  const submitReview = useCallback(
    (input: { cardId: string; rating: Rating; questionType: QuestionType; responseMs: number; correct: boolean | null }) => {
      const id = deckRef.current;
      if (!id) return;

      // 1. Apply locally with the shared deterministic scheduler.
      setStates((current) => {
        const existing = current[input.cardId] ?? null;
        const next = schedule({ state: existing, rating: input.rating });
        const previousAverage = existing?.averageResponseTime ?? 0;
        const count = existing?.reviewCount ?? 0;
        const updated: StudyState = {
          cardId: input.cardId,
          deckId: id,
          ownerKey: existing?.ownerKey ?? '',
          ease: next.ease,
          difficulty: next.difficulty,
          stability: next.stability,
          intervalDays: next.intervalDays,
          lastReviewed: new Date().toISOString(),
          nextReview: next.nextReview,
          reviewCount: next.reviewCount,
          correctCount: next.correctCount,
          incorrectCount: next.incorrectCount,
          averageResponseTime:
            count > 0 ? (previousAverage * count + input.responseMs) / (count + 1) : input.responseMs,
          lapses: next.lapses,
          updatedAt: new Date().toISOString(),
        };
        const merged = { ...current, [input.cardId]: updated };
        void idbGet<CacheEntry>('meta', `queue:${id}`).then((cached) => {
          if (cached) {
            void idbPut<CacheEntry>('meta', `queue:${id}`, {
              ...cached,
              states: Object.values(merged),
            });
          }
        });
        return merged;
      });

      // 2. Push to the server; queue for later if that fails.
      void (async () => {
        try {
          await api.review({ ...input, deckId: id });
          setOffline(false);
          await flushOutbox();
        } catch (error) {
          if (isTransient(error)) {
            const entry: PendingReview = {
              id: `${input.cardId}-${Date.now()}`,
              ...input,
              deckId: id,
              createdAt: Date.now(),
            };
            await idbPut('outbox', entry.id, entry);
            const remaining = await idbAll<PendingReview>('outbox');
            setPendingCount(remaining.length);
            setOffline(true);
          }
        }
      })();
    },
    [flushOutbox],
  );

  return {
    cards,
    states,
    dueCount,
    newCount,
    loading,
    error,
    offline,
    pendingCount,
    submitReview,
    reload: () => setVersion((value) => value + 1),
  };
}

/** Cards ordered by the scheduler: due first, then least-retrievable. */
export function orderQueue(cards: Flashcard[], states: Record<string, StudyState>): Flashcard[] {
  const now = new Date();
  return [...cards].sort((a, b) => {
    const sa = states[a.id];
    const sb = states[b.id];
    const dueA = isDue(sa, now);
    const dueB = isDue(sb, now);
    if (dueA !== dueB) return dueA ? -1 : 1;
    return queueScore(sa, now) - queueScore(sb, now);
  });
}
