import { Router } from 'express';
import type { Flashcard, StudyState } from '@shared/types';
import { reviewSchema, ownerKeySchema, uuidSchema } from '@shared/schema';
import { isDue, queueScore } from '@shared/srs';
import { badRequest, notFound } from '../errors';
import { rateLimit } from '../middleware/rateLimit';
import { handler, parse, resolveOwner } from '../middleware/validate';
import { getDeck, getDeckWithCards, listDecks } from '../repo/decks';
import {
  applyReview,
  endSession,
  getDueSummary,
  getReviewHistory,
  getStudyStates,
  getWeakCards,
  resetStudyState,
  startSession,
} from '../repo/study';

export const studyRouter = Router();

/** Everything the study screen needs for one deck, ordered by the scheduler. */
studyRouter.get(
  '/study/queue',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const deckId = String(req.query.deckId ?? '');
    if (!uuidSchema.safeParse(deckId).success) throw badRequest('Pick a deck to study.');

    const deck = await getDeckWithCards(deckId);
    if (!deck) throw notFound('That deck no longer exists.');
    if (deck.ownerKey !== ownerKey && !deck.isPublic) throw notFound('That deck no longer exists.');

    const states = await getStudyStates(ownerKey, deckId);
    const byCard = new Map(states.map((state) => [state.cardId, state]));
    const now = new Date();

    const cards: Flashcard[] = [...deck.cards].sort((a, b) => {
      const sa = byCard.get(a.id);
      const sb = byCard.get(b.id);
      const dueA = isDue(sa, now);
      const dueB = isDue(sb, now);
      if (dueA !== dueB) return dueA ? -1 : 1;
      return queueScore(sa, now) - queueScore(sb, now);
    });

    const due = cards.filter((card) => isDue(byCard.get(card.id), now));
    res.json({
      deck: { ...deck, cards },
      states,
      dueCount: due.length,
      newCount: cards.filter((card) => !byCard.has(card.id)).length,
    });
  }),
);

studyRouter.post(
  '/study/review',
  rateLimit('review', 600),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(reviewSchema, { ...req.body, ownerKey });
    const deck = await getDeck(body.deckId);
    if (!deck) throw notFound('That deck no longer exists.');
    const state = await applyReview({ ...body, ownerKey });
    res.json({ state });
  }),
);

studyRouter.delete(
  '/study/state/:cardId',
  rateLimit('review', 200),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    await resetStudyState(ownerKey, req.params.cardId);
    res.json({ ok: true });
  }),
);

/** Due counts for every deck the browser owns — powers the home dashboard. */
studyRouter.get(
  '/study/due',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const [decks, summary] = await Promise.all([listDecks(ownerKey, 50), getDueSummary(ownerKey)]);
    const byDeck = new Map(summary.map((row) => [row.deckId, row]));
    const items = decks.map((deck) => ({
      deckId: deck.id,
      title: deck.title,
      topic: deck.topic,
      cardCount: deck.cardCount,
      difficulty: deck.difficulty,
      updatedAt: deck.updatedAt,
      isPublic: deck.isPublic,
      publicSlug: deck.publicSlug,
      learningMode: deck.learningMode,
      due: byDeck.get(deck.id)?.due ?? Math.min(deck.cardCount, 0),
    }));
    res.json({
      decks: items,
      totalDue: items.reduce((total, item) => total + item.due, 0),
      totalCards: items.reduce((total, item) => total + item.cardCount, 0),
    });
  }),
);

studyRouter.get(
  '/study/weak',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const limit = Math.min(Number(req.query.limit ?? 12) || 12, 30);
    res.json({ cards: await getWeakCards(ownerKey, limit) });
  }),
);

studyRouter.get(
  '/study/history',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const days = Math.min(Number(req.query.days ?? 14) || 14, 90);
    res.json({ history: await getReviewHistory(ownerKey, days) });
  }),
);

studyRouter.get(
  '/study/states',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const deckId = req.query.deckId ? String(req.query.deckId) : undefined;
    const states: StudyState[] = await getStudyStates(ownerKey, deckId);
    res.json({ states });
  }),
);

studyRouter.post(
  '/study/session',
  rateLimit('review', 200),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(ownerKeySchema, ownerKey);
    const deckId = String((req.body as { deckId?: string })?.deckId ?? '');
    if (!uuidSchema.safeParse(deckId).success) throw badRequest('Pick a deck first.');
    res.status(201).json({ session: await startSession(body, deckId) });
  }),
);

studyRouter.patch(
  '/study/session/:id',
  rateLimit('review', 200),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = req.body as { reviewed?: number; remembered?: number; weakTopics?: string[]; weakCardIds?: string[] };
    const session = await endSession(ownerKey, req.params.id, {
      reviewed: Number(body.reviewed ?? 0),
      remembered: Number(body.remembered ?? 0),
      weakTopics: Array.isArray(body.weakTopics) ? body.weakTopics.slice(0, 20) : [],
      weakCardIds: Array.isArray(body.weakCardIds) ? body.weakCardIds.slice(0, 100) : [],
    });
    res.json({ session });
  }),
);
