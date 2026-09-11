/**
 * Sipium Flash — shared domain types.
 *
 * These types are used by BOTH the Next.js frontend and the Replit API server,
 * so a single definition keeps the typed API layer honest.
 */

export type UUID = string;
export type ISODate = string;

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

export type CardSource = 'ai' | 'manual' | 'import' | 'image' | 'fork' | 'offline';

export type LearningMode =
  | 'ielts'
  | 'academic'
  | 'general'
  | 'school'
  | 'exam'
  | 'custom';

export type IeltsBand = '5.5' | '6.0' | '6.5' | '7.0' | '7.5' | '8.0+';

export type IeltsSkill =
  | 'writing'
  | 'speaking'
  | 'reading'
  | 'listening'
  | 'vocabulary';

/**
 * A flashcard. This is *permanent content only* — study state lives in
 * `StudyState` and never pollutes the card itself.
 */
export interface Flashcard {
  id: UUID;
  deckId: UUID;
  /** Position inside the deck (0-based, gapless). */
  position: number;

  term: string;
  definition: string;
  vietnameseMeaning: string;
  partOfSpeech: string;
  pronunciation: string;

  exampleSentences: string[];
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  relatedWords: string[];
  topics: string[];

  /** 1 (easiest) .. 5 (hardest) */
  difficulty: number;
  /** 1 (not relevant) .. 5 (core IELTS vocabulary) */
  ieltsRelevance: number;

  source: CardSource;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type NewFlashcard = Omit<
  Flashcard,
  'id' | 'deckId' | 'position' | 'createdAt' | 'updatedAt'
> &
  Partial<Pick<Flashcard, 'id' | 'deckId' | 'position'>>;

export interface Deck {
  id: UUID;
  ownerKey: string;
  title: string;
  description: string;
  language: string;
  /** 'ai' | 'manual' | 'import' | 'fork' */
  source: string;
  topic: string;
  difficulty: number;
  tags: string[];
  cardCount: number;
  isPublic: boolean;
  publicSlug: string | null;
  publishedAt: ISODate | null;
  forkOf: UUID | null;
  copies: number;
  studies: number;
  learningMode: LearningMode;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface DeckWithCards extends Deck {
  cards: Flashcard[];
}

export interface PublicDeck extends Deck {
  /** Denormalised so the Explore page never needs a join for a card preview. */
  preview: Pick<Flashcard, 'term' | 'vietnameseMeaning' | 'definition'>[];
}

/* -------------------------------------------------------------------------- */
/* Study / SRS                                                                 */
/* -------------------------------------------------------------------------- */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

/**
 * Study state is stored completely separately from card content.
 */
export interface StudyState {
  cardId: UUID;
  deckId: UUID;
  ownerKey: string;
  ease: number;
  difficulty: number;
  stability: number;
  intervalDays: number;
  lastReviewed: ISODate | null;
  nextReview: ISODate | null;
  reviewCount: number;
  correctCount: number;
  incorrectCount: number;
  averageResponseTime: number;
  lapses: number;
  updatedAt: ISODate;
}

export interface ReviewLog {
  id: string;
  ownerKey: string;
  cardId: UUID;
  deckId: UUID;
  rating: Rating;
  questionType: QuestionType;
  responseMs: number;
  correct: boolean | null;
  reviewedAt: ISODate;
}

export type QuestionType =
  | 'recall-definition'
  | 'en-to-vi'
  | 'vi-to-en'
  | 'fill-blank'
  | 'multiple-choice'
  | 'choose-usage'
  | 'collocation'
  | 'synonym'
  | 'antonym'
  | 'sentence-creation'
  | 'error-correction'
  | 'context-recognition';

export const QUESTION_TYPES: QuestionType[] = [
  'recall-definition',
  'en-to-vi',
  'vi-to-en',
  'fill-blank',
  'multiple-choice',
  'choose-usage',
  'collocation',
  'synonym',
  'antonym',
  'sentence-creation',
  'error-correction',
  'context-recognition',
];

export interface StudySessionSummary {
  id: string;
  ownerKey: string;
  deckId: UUID;
  startedAt: ISODate;
  endedAt: ISODate | null;
  reviewed: number;
  remembered: number;
  weakTopics: string[];
  weakCardIds: UUID[];
}

/* -------------------------------------------------------------------------- */
/* AI: plan                                                                    */
/* -------------------------------------------------------------------------- */

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  /** Server-side operation this step maps onto, used for progress reporting. */
  kind:
    | 'analyze'
    | 'extract'
    | 'filter'
    | 'prioritize'
    | 'group'
    | 'translate'
    | 'examples'
    | 'collocations'
    | 'calibrate'
    | 'build'
    | 'validate'
    | 'custom';
}

export interface GenerationOptions {
  mode: LearningMode;
  cardCount: number;
  difficulty: number;
  includeVietnamese: boolean;
  englishOnly: boolean;
  includeExamples: boolean;
  includeCollocations: boolean;
  includePronunciation: boolean;
  includeSynonyms: boolean;
  band: IeltsBand | '';
  skill: IeltsSkill | '';
  topic: string;
  customInstruction: string;
}

export interface PlanDocument {
  id: string;
  title: string;
  summary: string;
  steps: PlanStep[];
  estimates: {
    cards: number;
    topicGroups: string[];
    difficulty: string;
    focus: string;
  };
  /** The plan as editable text (what the user can rewrite before building). */
  outline: string;
  /** True when the plan came from the offline engine rather than a real model. */
  offline: boolean;
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* AI: source material                                                         */
/* -------------------------------------------------------------------------- */

export interface ImagePayload {
  /** data: URL or plain base64 without the prefix. */
  data: string;
  mimeType: string;
  name?: string;
}

export interface SourceMaterial {
  text: string;
  images: ImagePayload[];
}

/* -------------------------------------------------------------------------- */
/* AI: build events (streamed to the client over SSE)                          */
/* -------------------------------------------------------------------------- */

export type BuildStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface BuildEventBase {
  at: ISODate;
}

export interface BuildStepEvent extends BuildEventBase {
  type: 'step';
  stepId: string;
  label: string;
  status: BuildStepStatus;
  detail?: string;
}

export interface BuildToolEvent extends BuildEventBase {
  type: 'tool';
  tool: string;
  status: 'running' | 'done' | 'error';
  summary: string;
}

export interface BuildCardEvent extends BuildEventBase {
  type: 'card';
  index: number;
  total: number;
  card: Flashcard;
}

export interface BuildDeckEvent extends BuildEventBase {
  type: 'deck';
  deck: DeckWithCards;
}

export interface BuildMessageEvent extends BuildEventBase {
  type: 'warn' | 'info';
  message: string;
  code?: string;
}

export interface BuildDoneEvent extends BuildEventBase {
  type: 'done';
  deck: DeckWithCards;
  stats: {
    cardsCreated: number;
    duplicatesRemoved: number;
    rejected: number;
    elapsedMs: number;
  };
}

export interface BuildErrorEvent extends BuildEventBase {
  type: 'error';
  message: string;
  code: string;
  retryable: boolean;
}

export type BuildEvent =
  | BuildStepEvent
  | BuildToolEvent
  | BuildCardEvent
  | BuildDeckEvent
  | BuildMessageEvent
  | BuildDoneEvent
  | BuildErrorEvent;

/* -------------------------------------------------------------------------- */
/* AI: tools                                                                   */
/* -------------------------------------------------------------------------- */

export type ToolCategory =
  | 'deck'
  | 'card'
  | 'enrichment'
  | 'analysis'
  | 'quality'
  | 'quiz';

export interface ToolDescriptor {
  name: string;
  description: string;
  category: ToolCategory;
  /** JSON Schema (draft-07-ish) sent to the model. */
  inputSchema: Record<string, unknown>;
  /** Whether executing this tool requires model inference. */
  intelligent: boolean;
}

/* -------------------------------------------------------------------------- */
/* AI: card actions                                                            */
/* -------------------------------------------------------------------------- */

export type CardAction =
  | 'improve'
  | 'explain'
  | 'add-example'
  | 'add-collocations'
  | 'simplify'
  | 'ielts-focus'
  | 'vietnamese'
  | 'quiz'
  | 'related-words'
  | 'pronunciation';

export const CARD_ACTIONS: { id: CardAction; label: string; hint: string }[] = [
  { id: 'improve', label: 'Improve', hint: 'Sharpen the definition and example' },
  { id: 'explain', label: 'Explain', hint: 'Add a plain-English + Vietnamese explanation' },
  { id: 'add-example', label: 'Add example', hint: 'Write a natural example sentence' },
  { id: 'add-collocations', label: 'Collocations', hint: 'Add 3 useful word partners' },
  { id: 'simplify', label: 'Simplify', hint: 'Rewrite in simpler English' },
  { id: 'ielts-focus', label: 'IELTS focus', hint: 'Make it useful for Band 7+ writing' },
  { id: 'vietnamese', label: 'Vietnamese', hint: 'Add a Vietnamese explanation' },
  { id: 'quiz', label: 'Quiz', hint: 'Generate a practice question' },
  { id: 'related-words', label: 'Related words', hint: 'Find related vocabulary' },
  { id: 'pronunciation', label: 'Pronunciation', hint: 'Add IPA + stress pattern' },
];

/* -------------------------------------------------------------------------- */
/* Curiosity layer                                                             */
/* -------------------------------------------------------------------------- */

export type CuriosityKind =
  | 'did-you-know'
  | 'word-connection'
  | 'common-mistake'
  | 'ielts-tip'
  | 'interesting-usage'
  | 'word-origin'
  | 'contrast';

export interface Curiosity {
  kind: CuriosityKind;
  title: string;
  body: string;
  /** Optional follow-up: compare with another word. */
  compareWith?: string;
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export interface HealthReport {
  ok: boolean;
  service: string;
  version: string;
  time: ISODate;
  database: {
    ok: boolean;
    driver: 'postgres' | 'embedded';
    latencyMs: number;
    detail?: string;
  };
  ai: {
    ok: boolean;
    /** 'xkiro' | 'minimax' | 'offline' */
    provider: string;
    model: string;
    /** False when no provider key is configured (offline engine in use). */
    configured: boolean;
    vision: boolean;
    detail?: string;
  };
  env: {
    replitApiUrl: boolean;
    databaseUrl: boolean;
  };
  uptimeSeconds: number;
}
