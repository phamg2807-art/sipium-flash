import type { Deck, DeckWithCards, Flashcard, LearningMode, PublicDeck } from '@shared/types';
import { getDb, type Queryable } from '../db';
import { ApiError, notFound } from '../errors';
import { mapCard, mapDeck, normaliseCardInput, slugify, type CardRow, type DeckRow } from './mappers';

/** Column list used with the `decks d` alias, including a live card count. */
const DECK_SELECT = `
  d.id, d.owner_key, d.title, d.description, d.language, d.source, d.topic,
  d.difficulty, d.tags, d.is_public, d.public_slug, d.published_at, d.fork_of,
  d.copies, d.studies, d.learning_mode, d.created_at, d.updated_at,
  (select count(*)::int from cards c where c.deck_id = d.id) as card_count
`;

export interface CreateDeckInput {
  ownerKey: string;
  title: string;
  description?: string;
  language?: string;
  source?: string;
  topic?: string;
  difficulty?: number;
  tags?: string[];
  learningMode?: LearningMode;
  forkOf?: string | null;
}

export async function createDeck(
  input: CreateDeckInput,
  cards: Flashcard[] = [],
  tx?: Queryable,
): Promise<DeckWithCards> {
  const db = tx ?? (await getDb());
  const res = await db.query<{ id: string }>(
    `insert into decks (owner_key, title, description, language, source, topic, difficulty, tags, learning_mode, fork_of)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      input.ownerKey,
      input.title.slice(0, 200),
      (input.description ?? '').slice(0, 2000),
      (input.language || 'en').slice(0, 16),
      (input.source || 'manual').slice(0, 32),
      (input.topic || '').slice(0, 120),
      Math.min(5, Math.max(1, Math.round(input.difficulty ?? 3))),
      (input.tags ?? []).slice(0, 20),
      input.learningMode || 'general',
      input.forkOf ?? null,
    ],
  );
  const id = res.rows[0].id;
  const inserted = await replaceCards(id, cards, db);
  const deck = await getDeck(id, undefined, db);
  if (!deck) throw notFound('The deck could not be created.');
  return { ...deck, cards: inserted, cardCount: inserted.length };
}

export async function getDeck(id: string, ownerKey?: string, tx?: Queryable): Promise<Deck | null> {
  const db = tx ?? (await getDb());
  const res = await db.query<DeckRow>(
    `select ${DECK_SELECT} from decks d where d.id = $1 ${ownerKey ? 'and d.owner_key = $2' : ''}`,
    ownerKey ? [id, ownerKey] : [id],
  );
  return res.rows[0] ? mapDeck(res.rows[0]) : null;
}

export async function getDeckWithCards(id: string, ownerKey?: string): Promise<DeckWithCards | null> {
  const deck = await getDeck(id, ownerKey);
  if (!deck) return null;
  const cards = await listCards(id);
  return { ...deck, cards, cardCount: cards.length };
}

export async function requireDeck(id: string, ownerKey?: string): Promise<Deck> {
  const deck = await getDeck(id, ownerKey);
  if (!deck) throw notFound('That deck no longer exists.');
  return deck;
}

export interface UpdateDeckInput {
  title?: string;
  description?: string;
  language?: string;
  topic?: string;
  difficulty?: number;
  tags?: string[];
  learningMode?: LearningMode;
}

export async function updateDeck(id: string, ownerKey: string, patch: UpdateDeckInput): Promise<Deck> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `update decks set
       title = coalesce($3, title),
       description = coalesce($4, description),
       language = coalesce($5, language),
       topic = coalesce($6, topic),
       difficulty = coalesce($7, difficulty),
       tags = coalesce($8, tags),
       learning_mode = coalesce($9, learning_mode),
       updated_at = now()
     where id = $1 and owner_key = $2
     returning id`,
    [
      id,
      ownerKey,
      patch.title?.slice(0, 200) ?? null,
      patch.description?.slice(0, 2000) ?? null,
      patch.language?.slice(0, 16) ?? null,
      patch.topic?.slice(0, 120) ?? null,
      patch.difficulty !== undefined ? Math.min(5, Math.max(1, Math.round(patch.difficulty))) : null,
      patch.tags ? patch.tags.slice(0, 20) : null,
      patch.learningMode ?? null,
    ],
  );
  if (!res.rows[0]) throw notFound('That deck no longer exists.');
  return (await getDeck(id, ownerKey)) as Deck;
}

export async function deleteDeck(id: string, ownerKey: string): Promise<void> {
  const db = await getDb();
  const res = await db.query(`delete from decks where id = $1 and owner_key = $2`, [id, ownerKey]);
  if (res.rowCount === 0) throw notFound('That deck no longer exists.');
}

export async function listDecks(ownerKey: string, limit = 50): Promise<Deck[]> {
  const db = await getDb();
  const res = await db.query<DeckRow>(
    `select ${DECK_SELECT} from decks d where d.owner_key = $1 order by d.updated_at desc limit $2`,
    [ownerKey, Math.min(limit, 200)],
  );
  return res.rows.map(mapDeck);
}

export async function listRecentDecks(ownerKey: string, limit = 12): Promise<Deck[]> {
  return listDecks(ownerKey, limit);
}

export async function bumpStudies(id: string): Promise<void> {
  const db = await getDb();
  await db.query(`update decks set studies = studies + 1, updated_at = updated_at where id = $1`, [id]);
}

export async function publishDeck(
  id: string,
  ownerKey: string,
  input: { title: string; description: string; topic: string; difficulty: number; tags: string[]; language: string },
): Promise<PublicDeck> {
  const db = await getDb();
  const base = slugify(input.title);
  let slug = `${base}-${id.slice(0, 6)}`;
  const existing = await db.query<{ id: string }>(`select id from decks where public_slug = $1`, [slug]);
  if (existing.rows[0] && existing.rows[0].id !== id) {
    slug = `${base}-${id.slice(0, 10)}`;
  }

  const res = await db.query<{ id: string }>(
    `update decks set
       title = $3, description = $4, topic = $5, difficulty = $6, tags = $7, language = $8,
       is_public = true, public_slug = $9, published_at = coalesce(published_at, now()), updated_at = now()
     where id = $1 and owner_key = $2
     returning id`,
    [
      id,
      ownerKey,
      input.title.slice(0, 200),
      input.description.slice(0, 2000),
      input.topic.slice(0, 120),
      Math.min(5, Math.max(1, Math.round(input.difficulty))),
      input.tags.slice(0, 20),
      input.language.slice(0, 16),
      slug,
    ],
  );
  if (!res.rows[0]) throw notFound('That deck no longer exists.');
  return getPublicDeck(id);
}

export async function unpublishDeck(id: string, ownerKey: string): Promise<Deck> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `update decks set is_public = false, updated_at = now() where id = $1 and owner_key = $2 returning id`,
    [id, ownerKey],
  );
  if (!res.rows[0]) throw notFound('That deck no longer exists.');
  return (await getDeck(id, ownerKey)) as Deck;
}

export async function getPublicDeck(id: string): Promise<PublicDeck> {
  const db = await getDb();
  const res = await db.query<DeckRow>(`select ${DECK_SELECT} from decks d where d.id = $1`, [id]);
  if (!res.rows[0]) throw notFound('That deck no longer exists.');
  const deck = mapDeck(res.rows[0]);
  const preview = await db.query<CardRow>(
    `select * from cards where deck_id = $1 order by position limit 6`,
    [id],
  );
  return {
    ...deck,
    preview: preview.rows.map((r) => ({
      term: r.term,
      vietnameseMeaning: r.vietnamese_meaning,
      definition: r.definition,
    })),
  };
}

/** Copy a public deck into a brand new editable deck owned by `ownerKey`. */
export async function forkDeck(sourceId: string, ownerKey: string): Promise<DeckWithCards> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const source = await tx.query<DeckRow>(
      `select ${DECK_SELECT} from decks d where d.id = $1 and d.is_public = true`,
      [sourceId],
    );
    if (!source.rows[0]) throw notFound('That public deck is no longer available.');
    const src = mapDeck(source.rows[0]);

    const created = await tx.query<{ id: string }>(
      `insert into decks (owner_key, title, description, language, source, topic, difficulty, tags, learning_mode, fork_of)
       values ($1, $2, $3, $4, 'fork', $5, $6, $7, $8, $9) returning id`,
      [
        ownerKey,
        `${src.title} (copy)`.slice(0, 200),
        src.description,
        src.language,
        src.topic,
        src.difficulty,
        src.tags,
        src.learningMode,
        src.id,
      ],
    );
    const deckId = created.rows[0].id;

    const sourceCards = await tx.query<CardRow>(
      `select * from cards where deck_id = $1 order by position`,
      [sourceId],
    );
    const cards = sourceCards.rows.map((row) => ({
      ...normaliseCardInput(mapCard(row)),
      id: undefined,
      source: 'fork' as const,
    }));
    const inserted = await replaceCards(deckId, cards as unknown as Flashcard[], tx);
    await tx.query(`update decks set copies = copies + 1 where id = $1`, [sourceId]);

    const deck = await getDeck(deckId, undefined, tx);
    if (!deck) throw notFound('The copied deck could not be created.');
    return { ...deck, cards: inserted, cardCount: inserted.length };
  });
}

export async function listCards(deckId: string, tx?: Queryable): Promise<Flashcard[]> {
  const db = tx ?? (await getDb());
  const res = await db.query<CardRow>(
    `select * from cards where deck_id = $1 order by position, created_at`,
    [deckId],
  );
  return res.rows.map(mapCard);
}

/** Full replace of a deck's cards (used by the editor, AI builder and imports). */
export async function replaceCards(
  deckId: string,
  cards: Array<Partial<Flashcard>>,
  tx?: Queryable,
): Promise<Flashcard[]> {
  const run = async (q: Queryable): Promise<Flashcard[]> => {
    const existing = await q.query<{ id: string }>(`select id from cards where deck_id = $1`, [deckId]);
    const keep = new Set<string>();
    const inserted: Flashcard[] = [];
    let index = 0;

    for (const raw of cards) {
      const card = normaliseCardInput(raw);
      if (!card.term) continue;
      if (card.id) keep.add(card.id);
      const res = await q.query<CardRow>(
        `insert into cards (
           id, deck_id, position, term, definition, vietnamese_meaning, part_of_speech, pronunciation,
           example_sentences, collocations, synonyms, antonyms, related_words, topics,
           difficulty, ielts_relevance, source
         ) values (
           coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
         )
         on conflict (id) do update set
           deck_id = excluded.deck_id, position = excluded.position, term = excluded.term,
           definition = excluded.definition, vietnamese_meaning = excluded.vietnamese_meaning,
           part_of_speech = excluded.part_of_speech, pronunciation = excluded.pronunciation,
           example_sentences = excluded.example_sentences, collocations = excluded.collocations,
           synonyms = excluded.synonyms, antonyms = excluded.antonyms, related_words = excluded.related_words,
           topics = excluded.topics, difficulty = excluded.difficulty,
           ielts_relevance = excluded.ielts_relevance, source = excluded.source, updated_at = now()
         returning *`,
        [
          card.id ?? null,
          deckId,
          index,
          card.term,
          card.definition,
          card.vietnameseMeaning,
          card.partOfSpeech,
          card.pronunciation,
          card.exampleSentences,
          card.collocations,
          card.synonyms,
          card.antonyms,
          card.relatedWords,
          card.topics,
          card.difficulty,
          card.ieltsRelevance,
          card.source,
        ],
      );
      if (res.rows[0]) inserted.push(mapCard(res.rows[0]));
      index += 1;
    }

    const stale = existing.rows.map((r) => r.id).filter((id) => !keep.has(id));
    if (stale.length > 0) {
      await q.query(`delete from cards where deck_id = $1 and id = any($2::uuid[])`, [deckId, stale]);
    }
    await q.query(`update decks set updated_at = now() where id = $1`, [deckId]);
    return inserted;
  };

  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run);
}

export function assertOwner(deck: Deck, ownerKey: string): void {
  if (deck.ownerKey !== ownerKey) {
    throw new ApiError('FORBIDDEN', 'This deck belongs to another browser. Copy it to edit it.');
  }
}
