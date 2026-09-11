import { Router } from 'express';
import { notFound } from '../errors';
import { rateLimit } from '../middleware/rateLimit';
import { handler, resolveOwner } from '../middleware/validate';
import { forkDeck } from '../repo/decks';
import { getPublicDeckBySlug, listPublicCounts, listPublicDecks, listPublicTopics, type PublicSort } from '../repo/public';

export const publicRouter = Router();

publicRouter.get(
  '/public/decks',
  handler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
    const topic = typeof req.query.topic === 'string' ? req.query.topic : '';
    const mode = typeof req.query.mode === 'string' ? req.query.mode : '';
    const tag = typeof req.query.tag === 'string' ? req.query.tag : '';
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'popular';
    const sort: PublicSort = sortRaw === 'newest' || sortRaw === 'most-copied' ? sortRaw : 'popular';
    const difficulty = Number(req.query.difficulty);
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 12);

    res.json(
      await listPublicDecks({
        q,
        topic,
        mode,
        tag,
        sort,
        difficulty: Number.isFinite(difficulty) && difficulty >= 1 && difficulty <= 5 ? difficulty : undefined,
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : 12,
      }),
    );
  }),
);

publicRouter.get(
  '/public/topics',
  handler(async (_req, res) => {
    res.json({ topics: await listPublicTopics(), counts: await listPublicCounts() });
  }),
);

publicRouter.get(
  '/public/decks/:slug',
  handler(async (req, res) => {
    const deck = await getPublicDeckBySlug(req.params.slug);
    if (!deck) throw notFound('That public deck is no longer available.');
    res.json({ deck });
  }),
);

publicRouter.post(
  '/public/decks/:id/copy',
  rateLimit('fork', 20),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const deck = await forkDeck(req.params.id, ownerKey);
    res.status(201).json({ deck, message: 'Copied to your decks. It is yours to edit.' });
  }),
);
