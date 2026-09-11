import type { CardInput } from '@shared/schema';
import type { Deck, Flashcard, StudyState } from '@shared/types';

export interface DeckRow {
  id: string;
  owner_key: string;
  title: string;
  description: string;
  language: string;
  source: string;
  topic: string;
  difficulty: number;
  tags: string[];
  is_public: boolean;
  public_slug: string | null;
  published_at: string | null;
  fork_of: string | null;
  copies: number;
  studies: number;
  learning_mode: string;
  card_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CardRow {
  id: string;
  deck_id: string;
  position: number;
  term: string;
  definition: string;
  vietnamese_meaning: string;
  part_of_speech: string;
  pronunciation: string;
  example_sentences: string[];
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  related_words: string[];
  topics: string[];
  difficulty: number;
  ielts_relevance: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface StudyStateRow {
  card_id: string;
  owner_key: string;
  deck_id: string;
  ease: number;
  difficulty: number;
  stability: number;
  interval_days: number;
  last_reviewed: string | null;
  next_review: string | null;
  review_count: number;
  correct_count: number;
  incorrect_count: number;
  average_response_time: number;
  lapses: number;
  updated_at: string;
}

const iso = (value: unknown): string => {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const arr = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export function mapDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    title: row.title,
    description: row.description,
    language: row.language,
    source: row.source,
    topic: row.topic,
    difficulty: row.difficulty,
    tags: arr(row.tags),
    isPublic: Boolean(row.is_public),
    publicSlug: row.public_slug,
    publishedAt: row.published_at ? iso(row.published_at) : null,
    forkOf: row.fork_of,
    copies: row.copies,
    studies: row.studies,
    cardCount: Number(row.card_count ?? 0),
    learningMode: (row.learning_mode as Deck['learningMode']) || 'general',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapCard(row: CardRow): Flashcard {
  return {
    id: row.id,
    deckId: row.deck_id,
    position: row.position,
    term: row.term,
    definition: row.definition,
    vietnameseMeaning: row.vietnamese_meaning,
    partOfSpeech: row.part_of_speech,
    pronunciation: row.pronunciation,
    exampleSentences: arr(row.example_sentences),
    collocations: arr(row.collocations),
    synonyms: arr(row.synonyms),
    antonyms: arr(row.antonyms),
    relatedWords: arr(row.related_words),
    topics: arr(row.topics),
    difficulty: row.difficulty,
    ieltsRelevance: row.ielts_relevance,
    source: (row.source as Flashcard['source']) || 'manual',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapStudyState(row: StudyStateRow): StudyState {
  return {
    cardId: row.card_id,
    ownerKey: row.owner_key,
    deckId: row.deck_id,
    ease: row.ease,
    difficulty: row.difficulty,
    stability: row.stability,
    intervalDays: row.interval_days,
    lastReviewed: row.last_reviewed ? iso(row.last_reviewed) : null,
    nextReview: row.next_review ? iso(row.next_review) : null,
    reviewCount: row.review_count,
    correctCount: row.correct_count,
    incorrectCount: row.incorrect_count,
    averageResponseTime: row.average_response_time,
    lapses: row.lapses,
    updatedAt: iso(row.updated_at),
  };
}

/** Normalise a card coming from the client or from an AI tool. */
export function normaliseCardInput(input: Partial<CardInput>): CardInput {
  const term = String(input.term ?? '').trim().slice(0, 200);
  const clamp = (v: unknown, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : fallback;
  };
  const list = (v: unknown, max: number, len: number) =>
    Array.isArray(v)
      ? v
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim().slice(0, len))
          .slice(0, max)
      : [];

  return {
    id: input.id,
    position: typeof input.position === 'number' ? input.position : undefined,
    term,
    definition: String(input.definition ?? '').trim().slice(0, 2000),
    vietnameseMeaning: String(input.vietnameseMeaning ?? '').trim().slice(0, 2000),
    partOfSpeech: String(input.partOfSpeech ?? '').trim().slice(0, 64),
    pronunciation: String(input.pronunciation ?? '').trim().slice(0, 200),
    exampleSentences: list(input.exampleSentences, 10, 600),
    collocations: list(input.collocations, 20, 200),
    synonyms: list(input.synonyms, 20, 120),
    antonyms: list(input.antonyms, 20, 120),
    relatedWords: list(input.relatedWords, 20, 120),
    topics: list(input.topics, 20, 80),
    difficulty: clamp(input.difficulty, 3),
    ieltsRelevance: clamp(input.ieltsRelevance, 3),
    source: (input.source as CardInput['source']) || 'manual',
  };
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'deck';
}
