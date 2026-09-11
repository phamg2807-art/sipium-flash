import type { Rating, StudyState, StudySessionSummary } from '@shared/types';
import { formatInterval, schedule } from '@shared/srs';
import { getDb } from '../db';
import { mapStudyState, type StudyStateRow } from './mappers';

export interface ApplyReviewInput {
  ownerKey: string;
  cardId: string;
  deckId: string;
  rating: Rating;
  questionType: string;
  responseMs: number;
  correct: boolean | null;
}

export async function getStudyStates(ownerKey: string, deckId?: string): Promise<StudyState[]> {
  const db = await getDb();
  const res = await db.query<StudyStateRow>(
    `select * from study_states where owner_key = $1 ${deckId ? 'and deck_id = $2' : ''}`,
    deckId ? [ownerKey, deckId] : [ownerKey],
  );
  return res.rows.map(mapStudyState);
}

export async function applyReview(input: ApplyReviewInput): Promise<StudyState> {
  const db = await getDb();
  const existing = await db.query<StudyStateRow>(
    `select * from study_states where owner_key = $1 and card_id = $2`,
    [input.ownerKey, input.cardId],
  );
  const current = existing.rows[0] ? mapStudyState(existing.rows[0]) : null;
  const next = schedule({ state: current, rating: input.rating });

  const averageResponseTime =
    current && current.reviewCount > 0
      ? (current.averageResponseTime * current.reviewCount + input.responseMs) /
        (current.reviewCount + 1)
      : input.responseMs;

  const res = await db.query<StudyStateRow>(
    `insert into study_states (
       card_id, owner_key, deck_id, ease, difficulty, stability, interval_days,
       last_reviewed, next_review, review_count, correct_count, incorrect_count,
       average_response_time, lapses, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, $12, $13, now())
     on conflict (card_id) do update set
       owner_key = excluded.owner_key, deck_id = excluded.deck_id, ease = excluded.ease,
       difficulty = excluded.difficulty, stability = excluded.stability,
       interval_days = excluded.interval_days, last_reviewed = excluded.last_reviewed,
       next_review = excluded.next_review, review_count = excluded.review_count,
       correct_count = excluded.correct_count, incorrect_count = excluded.incorrect_count,
       average_response_time = excluded.average_response_time, lapses = excluded.lapses,
       updated_at = now()
     returning *`,
    [
      input.cardId,
      input.ownerKey,
      input.deckId,
      next.ease,
      next.difficulty,
      next.stability,
      next.intervalDays,
      next.nextReview,
      next.reviewCount,
      next.correctCount,
      next.incorrectCount,
      averageResponseTime,
      next.lapses,
    ],
  );

  await db.query(
    `insert into review_logs (owner_key, card_id, deck_id, rating, question_type, response_ms, correct)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.ownerKey,
      input.cardId,
      input.deckId,
      input.rating,
      input.questionType.slice(0, 48),
      Math.round(input.responseMs),
      input.correct,
    ],
  );

  return mapStudyState(res.rows[0]);
}

export async function resetStudyState(ownerKey: string, cardId: string): Promise<void> {
  const db = await getDb();
  await db.query(`delete from study_states where owner_key = $1 and card_id = $2`, [ownerKey, cardId]);
}

export interface WeakCard {
  cardId: string;
  deckId: string;
  term: string;
  reviewCount: number;
  incorrectCount: number;
  lapses: number;
  stability: number;
  nextReview: string | null;
  dueIn: string;
}

/** Cards this learner keeps missing — drives "weak words" and AI contrast drills. */
export async function getWeakCards(ownerKey: string, limit = 12): Promise<WeakCard[]> {
  const db = await getDb();
  const res = await db.query(
    `select s.card_id, s.deck_id, c.term, s.review_count, s.incorrect_count, s.lapses,
            s.stability, s.next_review
     from study_states s
     join cards c on c.id = s.card_id
     where s.owner_key = $1 and s.incorrect_count > 0
     order by (s.incorrect_count::float / greatest(s.review_count, 1)) desc,
              s.lapses desc, s.stability asc
     limit $2`,
    [ownerKey, limit],
  );
  return res.rows.map((row: any) => ({
    cardId: row.card_id,
    deckId: row.deck_id,
    term: row.term,
    reviewCount: row.review_count,
    incorrectCount: row.incorrect_count,
    lapses: row.lapses,
    stability: row.stability,
    nextReview: row.next_review ? new Date(row.next_review).toISOString() : null,
    dueIn: row.next_review
      ? formatInterval((new Date(row.next_review).getTime() - Date.now()) / 86_400_000)
      : 'now',
  }));
}

export interface DueSummary {
  deckId: string;
  due: number;
  total: number;
}

export async function getDueSummary(ownerKey: string): Promise<DueSummary[]> {
  const db = await getDb();
  const res = await db.query(
    `select c.deck_id,
            count(*) filter (where s.next_review is null or s.next_review <= now())::int as due,
            count(*)::int as total
     from cards c
     join decks d on d.id = c.deck_id
     left join study_states s on s.card_id = c.id and s.owner_key = $1
     where d.owner_key = $1
     group by c.deck_id`,
    [ownerKey],
  );
  return res.rows.map((row: any) => ({ deckId: row.deck_id, due: row.due, total: row.total }));
}

export async function startSession(ownerKey: string, deckId: string): Promise<StudySessionSummary> {
  const db = await getDb();
  const res = await db.query(
    `insert into study_sessions (owner_key, deck_id) values ($1, $2) returning *`,
    [ownerKey, deckId],
  );
  return mapSession(res.rows[0]);
}

export async function endSession(
  ownerKey: string,
  sessionId: string,
  stats: { reviewed: number; remembered: number; weakTopics: string[]; weakCardIds: string[] },
): Promise<StudySessionSummary> {
  const db = await getDb();
  const res = await db.query(
    `update study_sessions set ended_at = now(), reviewed = $3, remembered = $4,
            weak_topics = $5, weak_cards = $6
     where id = $1 and owner_key = $2 returning *`,
    [sessionId, ownerKey, stats.reviewed, stats.remembered, stats.weakTopics, stats.weakCardIds],
  );
  if (!res.rows[0]) throw new Error('session not found');
  return mapSession(res.rows[0]);
}

function mapSession(row: any): StudySessionSummary {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    deckId: row.deck_id,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    reviewed: row.reviewed,
    remembered: row.remembered,
    weakTopics: row.weak_topics ?? [],
    weakCardIds: row.weak_cards ?? [],
  };
}

export interface HistoryPoint {
  day: string;
  reviews: number;
  correct: number;
}

export async function getReviewHistory(ownerKey: string, days = 14): Promise<HistoryPoint[]> {
  const db = await getDb();
  const res = await db.query(
    `select to_char(date_trunc('day', reviewed_at), 'YYYY-MM-DD') as day,
            count(*)::int as reviews,
            count(*) filter (where correct)::int as correct
     from review_logs
     where owner_key = $1 and reviewed_at > now() - ($2 || ' days')::interval
     group by 1 order by 1`,
    [ownerKey, String(Math.min(days, 90))],
  );
  return res.rows.map((row: any) => ({ day: row.day, reviews: row.reviews, correct: row.correct }));
}
