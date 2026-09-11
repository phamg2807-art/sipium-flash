import { Router } from 'express';
import { z } from 'zod';
import type { PublicDeck } from '@shared/types';
import { deckUpsertSchema, deckCardsPutSchema, publishSchema, ownerKeySchema } from '@shared/schema';
import { ApiError, badRequest, forbidden, notFound } from '../errors';
import { handler, parse, resolveOwner } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  bumpStudies,
  createDeck,
  deleteDeck,
  forkDeck,
  getDeck,
  getDeckWithCards,
  getPublicDeck,
  listDecks,
  publishDeck,
  replaceCards,
  unpublishDeck,
  updateDeck,
  assertOwner,
} from '../repo/decks';

export const decksRouter = Router();

const MIN_PUBLISH_CARDS = 3;

decksRouter.get(
  '/decks',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const limit = Number(req.query.limit ?? 50);
    res.json({ decks: await listDecks(ownerKey, Number.isFinite(limit) ? limit : 50) });
  }),
);

decksRouter.post(
  '/decks',
  rateLimit('decks', 60),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(deckUpsertSchema, { ...req.body, ownerKey });
    const deck = await createDeck({ ...body, source: body.source || 'manual' }, []);
    res.status(201).json({ deck });
  }),
);

decksRouter.get(
  '/decks/:id',
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.query);
    const deck = await getDeckWithCards(req.params.id);
    if (!deck) throw notFound('That deck no longer exists.');
    if (deck.ownerKey !== ownerKey && !deck.isPublic) throw forbidden('That deck is private.');
    res.json({ deck, readOnly: deck.ownerKey !== ownerKey });
  }),
);

decksRouter.patch(
  '/decks/:id',
  rateLimit('decks', 120),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const deck = await getDeck(req.params.id);
    if (!deck) throw notFound('That deck no longer exists.');
    assertOwner(deck, ownerKey);
    const patch = parse(deckUpsertSchema.partial().extend({ ownerKey: ownerKeySchema }), { ...req.body, ownerKey });
    const updated = await updateDeck(req.params.id, ownerKey, patch);
    res.json({ deck: updated });
  }),
);

decksRouter.delete(
  '/decks/:id',
  rateLimit('decks', 60),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body ?? req.query);
    const deck = await getDeck(req.params.id);
    if (!deck) throw notFound('That deck no longer exists.');
    assertOwner(deck, ownerKey);
    await deleteDeck(req.params.id, ownerKey);
    res.json({ ok: true });
  }),
);

decksRouter.put(
  '/decks/:id/cards',
  rateLimit('cards', 120),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(deckCardsPutSchema, { ...req.body, ownerKey });
    const deck = await getDeck(req.params.id);
    if (!deck) throw notFound('That deck no longer exists.');
    assertOwner(deck, ownerKey);
    if (body.cards.length > 500) throw badRequest('A deck can hold at most 500 cards.');
    const cards = await replaceCards(deck.id, body.cards);
    res.json({ cards, cardCount: cards.length });
  }),
);

decksRouter.post(
  '/decks/:id/publish',
  rateLimit('publish', 12),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(publishSchema, { ...req.body, ownerKey });
    const deck = await getDeckWithCards(req.params.id);
    if (!deck) throw notFound('That deck no longer exists.');
    assertOwner(deck, ownerKey);

    const issues = validateForPublish(deck.title, deck.cards);
    if (issues.length > 0) {
      throw new ApiError('VALIDATION', 'Fix these issues before publishing.', {
        details: { issues },
      });
    }

    const published: PublicDeck = await publishDeck(deck.id, ownerKey, body);
    res.json({
      ok: true,
      deck: published,
      slug: published.publicSlug,
      message: 'Published successfully.',
    });
  }),
);

decksRouter.post(
  '/decks/:id/unpublish',
  rateLimit('publish', 30),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body ?? {});
    const deck = await getDeck(req.params.id);
    if (!deck) throw notFound('That deck no longer exists.');
    assertOwner(deck, ownerKey);
    res.json({ deck: await unpublishDeck(deck.id, ownerKey) });
  }),
);

decksRouter.post(
  '/decks/:id/copy',
  rateLimit('fork', 30),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const deck = await forkDeck(req.params.id, ownerKey);
    res.status(201).json({ deck });
  }),
);

decksRouter.post(
  '/decks/:id/studied',
  handler(async (req, res) => {
    await bumpStudies(req.params.id);
    res.json({ ok: true });
  }),
);

export interface PublishIssue {
  level: 'error' | 'warning';
  field: string;
  message: string;
}

export function validateForPublish(
  title: string,
  cards: { id: string; term: string; definition: string; vietnameseMeaning: string }[],
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (title.trim().length < 3) {
    issues.push({ level: 'error', field: 'title', message: 'Give the deck a title of at least 3 characters.' });
  }
  if (cards.length < MIN_PUBLISH_CARDS) {
    issues.push({
      level: 'error',
      field: 'cards',
      message: `A public deck needs at least ${MIN_PUBLISH_CARDS} cards. This one has ${cards.length}.`,
    });
  }

  const seen = new Map<string, number>();
  for (const card of cards) {
    const key = card.term.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!card.term.trim()) {
      issues.push({ level: 'error', field: 'term', message: 'One card has no word on the front.' });
    }
    if (!card.definition.trim()) {
      issues.push({
        level: 'error',
        field: 'definition',
        message: `“${card.term || '(empty)'}” has no English definition.`,
      });
    }
  }
  for (const [term, count] of seen) {
    if (count > 1 && term) {
      issues.push({ level: 'error', field: 'duplicates', message: `“${term}” appears ${count} times.` });
    }
  }
  const missingVietnamese = cards.filter((card) => !card.vietnameseMeaning.trim()).length;
  if (missingVietnamese > 0 && cards.length > 0 && missingVietnamese / cards.length > 0.5) {
    issues.push({
      level: 'warning',
      field: 'vietnamese',
      message: `${missingVietnamese} cards have no Vietnamese meaning. Vietnamese learners find those harder to use.`,
    });
  }
  return issues;
}

export const publishValidationSchema = z.object({ ownerKey: ownerKeySchema });
