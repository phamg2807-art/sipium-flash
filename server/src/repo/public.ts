import type { PublicDeck } from '@shared/types';
import { getDb } from '../db';
import { mapDeck, type CardRow, type DeckRow } from './mappers';

const PUBLIC_SELECT = `
  d.id, d.owner_key, d.title, d.description, d.language, d.source, d.topic,
  d.difficulty, d.tags, d.is_public, d.public_slug, d.published_at, d.fork_of,
  d.copies, d.studies, d.learning_mode, d.created_at, d.updated_at,
  (select count(*)::int from cards c where c.deck_id = d.id) as card_count
`;

export type PublicSort = 'popular' | 'newest' | 'most-copied';

export interface PublicQuery {
  q?: string;
  topic?: string;
  difficulty?: number;
  mode?: string;
  tag?: string;
  sort?: PublicSort;
  page?: number;
  pageSize?: number;
}

export interface PublicResult {
  decks: PublicDeck[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export async function listPublicDecks(query: PublicQuery): Promise<PublicResult> {
  const db = await getDb();
  const pageSize = Math.min(Math.max(query.pageSize ?? 12, 1), 48);
  const page = Math.max(query.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['d.is_public = true'];
  const params: unknown[] = [];
  let i = 1;

  const push = (value: unknown) => {
    params.push(value);
    return `$${i++}`;
  };

  if (query.q && query.q.trim()) {
    const p = push(query.q.trim());
    conditions.push(`d.search_tsv @@ plainto_tsquery('english', ${p})`);
  }
  if (query.topic && query.topic !== 'all') {
    const p = push(query.topic);
    conditions.push(`lower(d.topic) = lower(${p})`);
  }
  if (query.mode && query.mode !== 'all') {
    const p = push(query.mode);
    conditions.push(`d.learning_mode = ${p}`);
  }
  if (query.tag) {
    const p = push(query.tag);
    conditions.push(`d.tags && array[${p}]::text[]`);
  }
  if (query.difficulty && query.difficulty >= 1 && query.difficulty <= 5) {
    const p = push(query.difficulty);
    conditions.push(`d.difficulty = ${p}`);
  }

  const where = conditions.join(' and ');
  const order =
    query.sort === 'newest'
      ? 'd.published_at desc nulls last, d.created_at desc'
      : query.sort === 'most-copied'
        ? 'd.copies desc, d.published_at desc'
        : 'd.studies desc, d.copies desc, d.published_at desc nulls last';

  const countRes = await db.query<{ total: number }>(
    `select count(*)::int as total from decks d where ${where}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  const pageParam = push(pageSize);
  const offsetParam = push(offset);
  const res = await db.query<DeckRow>(
    `select ${PUBLIC_SELECT} from decks d where ${where} order by ${order} limit ${pageParam} offset ${offsetParam}`,
    params,
  );
  const decks = res.rows.map(mapDeck);

  const withPreview: PublicDeck[] = [];
  if (decks.length > 0) {
    const previewRes = await db.query<CardRow & { deck_id: string }>(
      `select c.* from cards c
       where c.deck_id = any($1::uuid[]) and c.position < 6
       order by c.deck_id, c.position`,
      [decks.map((d) => d.id)],
    );
    const byDeck = new Map<string, PublicDeck['preview']>();
    for (const row of previewRes.rows) {
      const list = byDeck.get(row.deck_id) ?? [];
      if (list.length < 5) {
        list.push({ term: row.term, vietnameseMeaning: row.vietnamese_meaning, definition: row.definition });
      }
      byDeck.set(row.deck_id, list);
    }
    for (const deck of decks) withPreview.push({ ...deck, preview: byDeck.get(deck.id) ?? [] });
  }

  return { decks: withPreview, page, pageSize, total, hasMore: offset + decks.length < total };
}

export async function getPublicDeckBySlug(slug: string): Promise<PublicDeck | null> {
  const db = await getDb();
  const res = await db.query<DeckRow>(
    `select ${PUBLIC_SELECT} from decks d where d.public_slug = $1 and d.is_public = true`,
    [slug],
  );
  if (!res.rows[0]) return null;
  const deck = mapDeck(res.rows[0]);
  const preview = await db.query<CardRow>(`select * from cards where deck_id = $1 order by position limit 5`, [
    deck.id,
  ]);
  return {
    ...deck,
    preview: preview.rows.map((r) => ({
      term: r.term,
      vietnameseMeaning: r.vietnamese_meaning,
      definition: r.definition,
    })),
  };
}

export async function listPublicTopics(): Promise<{ topic: string; count: number }[]> {
  const db = await getDb();
  const res = await db.query(
    `select d.topic, count(*)::int as count
     from decks d
     where d.is_public = true and d.topic <> ''
     group by d.topic order by count desc, d.topic asc limit 24`,
  );
  return res.rows.map((row: any) => ({ topic: row.topic, count: row.count }));
}

export async function listPublicCounts() {
  const db = await getDb();
  const res = await db.query(
    `select
       count(*)::int as total,
       count(*) filter (where d.learning_mode = 'ielts')::int as ielts,
       count(*) filter (where d.learning_mode = 'academic')::int as academic,
       count(*) filter (where d.difficulty <= 2)::int as beginner,
       count(*) filter (where d.difficulty = 3)::int as intermediate,
       count(*) filter (where d.difficulty >= 4)::int as advanced,
       count(*) filter (where d.language = 'vi' or d.tags && array['vietnamese','tiếng việt']::text[])::int as vietnamese
     from decks d where d.is_public = true`,
  );
  return res.rows[0] as Record<string, number>;
}
