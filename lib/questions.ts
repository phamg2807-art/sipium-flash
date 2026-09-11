import type { Flashcard, QuestionType, StudyState } from '@/shared/types';
import { seededRandom } from './format';

export interface RevealStage {
  label: string;
  kind: 'meaning' | 'vietnamese' | 'example' | 'collocation' | 'extra';
  lines: string[];
}

export interface Question {
  type: QuestionType;
  /** Short instruction shown under the word. */
  prompt: string;
  /** The thing being asked about (usually the term). */
  front: string;
  /** Primary answer, revealed first. */
  answer: string;
  answerLabel: string;
  /** Progressive reveal after the answer. */
  stages: RevealStage[];
  choices?: string[];
  correctIndex?: number;
  /** Free-text check for typed answers. */
  accepts?: (input: string) => boolean;
  typed?: boolean;
}

export interface QuestionContext {
  card: Flashcard;
  state?: StudyState;
  /** Other cards in the deck, used for plausible distractors. */
  pool: Flashcard[];
  mix: 'balanced' | 'recall' | 'recognition';
  includeVietnamese: boolean;
  showPronunciation: boolean;
  /** Changes as the session progresses so a card rarely repeats a question. */
  variant: number;
}

const has = (value: string | string[] | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : Boolean(value && value.trim());

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looseMatch(input: string, target: string): boolean {
  const a = normalise(input);
  const b = normalise(target);
  if (!a || !b) return false;
  if (a === b) return true;
  const aWords = new Set(a.split(' '));
  const bWords = b.split(' ');
  const overlap = bWords.filter((word) => word.length > 2 && aWords.has(word)).length;
  return overlap >= Math.max(1, Math.ceil(bWords.length * 0.5));
}

/** Which question types this card can actually support. */
function supportedTypes(ctx: QuestionContext): QuestionType[] {
  const { card, mix, includeVietnamese } = ctx;
  const types: QuestionType[] = [];

  if (mix !== 'recognition') types.push('recall-definition');
  if (mix !== 'recall') types.push('multiple-choice');
  if (includeVietnamese && has(card.vietnameseMeaning)) {
    types.push('en-to-vi', 'vi-to-en');
  }
  if (has(card.exampleSentences)) {
    types.push('fill-blank', 'context-recognition');
    if (mix !== 'recognition') types.push('sentence-creation');
  }
  if (has(card.collocations)) types.push('collocation');
  if (has(card.synonyms)) types.push('synonym');
  if (has(card.antonyms)) types.push('antonym');
  if (mix === 'balanced') types.push('choose-usage');

  return types.length > 0 ? types : (['recall-definition'] as QuestionType[]);
}

export function chooseQuestionType(ctx: QuestionContext): QuestionType {
  const types = supportedTypes(ctx);
  const seed = `${ctx.card.id}:${ctx.variant}:${ctx.state?.reviewCount ?? 0}`;
  const roll = seededRandom(seed);
  return types[Math.floor(roll * types.length) % types.length];
}

function shuffle<T>(items: T[], seed: string): T[] {
  return [...items]
    .map((item, index) => ({ item, weight: seededRandom(`${seed}:${index}`) }))
    .sort((a, b) => a.weight - b.weight)
    .map((entry) => entry.item);
}

function distractors(pool: Flashcard[], card: Flashcard, pick: (card: Flashcard) => string, count = 3): string[] {
  const out: string[] = [];
  for (const other of shuffle(
    pool.filter((item) => item.id !== card.id),
    card.id,
  )) {
    const value = pick(other);
    if (value && !out.includes(value) && value !== pick(card)) out.push(value);
    if (out.length >= count) break;
  }
  return out;
}

/** Build the full question, including the progressive reveal stages. */
export function buildQuestion(ctx: QuestionContext, type: QuestionType = chooseQuestionType(ctx)): Question {
  const { card, pool, includeVietnamese } = ctx;
  const term = card.term;
  const example = card.exampleSentences[0] ?? '';
  const collocation = card.collocations[0] ?? '';

  const stages: RevealStage[] = [];
  if (card.definition) stages.push({ label: 'Meaning', kind: 'meaning', lines: [card.definition] });
  if (includeVietnamese && card.vietnameseMeaning) {
    stages.push({ label: 'Tiếng Việt', kind: 'vietnamese', lines: [card.vietnameseMeaning] });
  }
  if (example) stages.push({ label: 'Example', kind: 'example', lines: [example] });
  if (collocation) stages.push({ label: 'Collocation', kind: 'collocation', lines: card.collocations.slice(0, 3) });

  const base: Omit<Question, 'type' | 'prompt' | 'front' | 'answer' | 'answerLabel'> = { stages };

  switch (type) {
    case 'en-to-vi':
      return {
        ...base,
        type,
        prompt: 'What does this mean in Vietnamese?',
        front: term,
        answer: card.vietnameseMeaning || card.definition,
        answerLabel: 'Tiếng Việt',
      };

    case 'vi-to-en': {
      const front = card.vietnameseMeaning || card.definition;
      return {
        ...base,
        type,
        prompt: 'Which English word is this?',
        front,
        answer: term,
        answerLabel: 'English',
        typed: true,
        accepts: (input) => normalise(input) === normalise(term),
        choices: shuffle([term, ...distractors(pool, card, (c) => c.term)], `${card.id}:vi2en`),
        correctIndex: 0,
      };
    }

    case 'fill-blank': {
      const blanked = example
        ? example.replace(new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'), '______')
        : `______ — ${card.definition}`;
      return {
        ...base,
        type,
        prompt: 'Fill the gap.',
        front: blanked,
        answer: term,
        answerLabel: 'Word',
        typed: true,
        accepts: (input) => normalise(input) === normalise(term),
      };
    }

    case 'multiple-choice': {
      const answer = includeVietnamese && card.vietnameseMeaning ? card.vietnameseMeaning : card.definition;
      const options = shuffle(
        [answer, ...distractors(pool, card, (c) => (includeVietnamese && c.vietnameseMeaning ? c.vietnameseMeaning : c.definition))],
        `${card.id}:mc`,
      ).slice(0, 4);
      return {
        ...base,
        type,
        prompt: 'Choose the correct meaning.',
        front: term,
        answer,
        answerLabel: 'Meaning',
        choices: options,
        correctIndex: options.indexOf(answer),
      };
    }

    case 'choose-usage': {
      const answer = example || `It is used to talk about ${card.definition.toLowerCase()}`;
      const wrong = pool
        .filter((item) => item.id !== card.id && item.exampleSentences[0])
        .slice(0, 3)
        .map((item) => item.exampleSentences[0]);
      const options = shuffle([answer, ...wrong], `${card.id}:usage`).slice(0, 4);
      return {
        ...base,
        type,
        prompt: 'Which sentence uses this word correctly?',
        front: term,
        answer,
        answerLabel: 'Correct sentence',
        choices: options,
        correctIndex: options.indexOf(answer),
      };
    }

    case 'collocation': {
      const answer = collocation || `${term} ___`;
      const options = shuffle([answer, ...distractors(pool, card, (c) => c.collocations[0] ?? '')], `${card.id}:col`).slice(0, 4);
      return {
        ...base,
        type,
        prompt: 'Which is a natural collocation?',
        front: term,
        answer,
        answerLabel: 'Collocation',
        choices: options,
        correctIndex: options.indexOf(answer),
      };
    }

    case 'synonym': {
      const answer = card.synonyms[0] ?? card.definition;
      const options = shuffle([answer, ...distractors(pool, card, (c) => c.antonyms[0] ?? c.synonyms[0] ?? '')], `${card.id}:syn`).slice(0, 4);
      return {
        ...base,
        type,
        prompt: 'Which word means nearly the same?',
        front: term,
        answer,
        answerLabel: 'Synonym',
        choices: options,
        correctIndex: options.indexOf(answer),
      };
    }

    case 'antonym': {
      const answer = card.antonyms[0] ?? card.definition;
      const options = shuffle([answer, ...distractors(pool, card, (c) => c.synonyms[0] ?? c.antonyms[0] ?? '')], `${card.id}:ant`).slice(0, 4);
      return {
        ...base,
        type,
        prompt: 'Which word means the opposite?',
        front: term,
        answer,
        answerLabel: 'Antonym',
        choices: options,
        correctIndex: options.indexOf(answer),
      };
    }

    case 'context-recognition': {
      const blanked = example
        ? example.replace(new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'), '______')
        : card.definition;
      const options = shuffle([term, ...distractors(pool, card, (c) => c.term)], `${card.id}:ctx`).slice(0, 4);
      return {
        ...base,
        type,
        prompt: 'Which word fits here?',
        front: blanked,
        answer: term,
        answerLabel: 'Word',
        choices: options,
        correctIndex: options.indexOf(term),
      };
    }

    case 'sentence-creation':
      return {
        ...base,
        type,
        prompt: 'Say or write a sentence using this word.',
        front: term,
        answer: example || `Example: “${term}” — ${card.definition}`,
        answerLabel: 'Model answer',
        typed: true,
        accepts: (input) => input.trim().length > 8 && looseMatch(input, term),
      };

    case 'error-correction': {
      const wrong = example.replace(new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'), `${term}s`);
      return {
        ...base,
        type,
        prompt: 'Something is wrong. What should it be?',
        front: wrong || `${term}s — ${card.definition}`,
        answer: term,
        answerLabel: 'Correct form',
        typed: true,
        accepts: (input) => normalise(input) === normalise(term),
      };
    }

    case 'recall-definition':
    default:
      return {
        ...base,
        type: 'recall-definition',
        prompt: `Can you explain this ${card.partOfSpeech || 'word'}?`,
        front: term,
        answer: card.definition,
        answerLabel: 'Meaning',
      };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const QUESTION_LABELS: Record<QuestionType, string> = {
  'recall-definition': 'Recall',
  'en-to-vi': 'English → Vietnamese',
  'vi-to-en': 'Vietnamese → English',
  'fill-blank': 'Gap fill',
  'multiple-choice': 'Multiple choice',
  'choose-usage': 'Correct usage',
  collocation: 'Collocation',
  synonym: 'Synonym',
  antonym: 'Antonym',
  'sentence-creation': 'Make a sentence',
  'error-correction': 'Fix the mistake',
  'context-recognition': 'Which word fits',
};
