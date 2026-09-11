/**
 * Implementations behind the intelligent tools.
 *
 * When a model is configured these call xKiro → MiniMax M3 server-side and
 * validate the response. When no key is present they fall back to the
 * deterministic offline engine, which is reported to the client as
 * `configured: false`.
 */
import { z } from 'zod';
import type { GenerationOptions } from '@shared/types';
import { completeJson, completeJsonWithImage, getProvider, isConfigured } from '../ai/gateway';
import { OFFLINE_NOTICE } from '../ai/local';
import {
  enrichTerm,
  makeCollocations,
  makeExample,
  makeQuiz,
  pickTerms,
  tokenize,
} from '../ai/local';
import type { AiHelpers, EnrichedWord, ImageAnalysis, QuizResult } from '../ai/tools';
import type { WorkbenchCard } from '../ai/workbench';
import { logger } from '../logger';

const enrichedWordSchema = z.object({
  words: z
    .array(
      z.object({
        term: z.string().min(1).max(80),
        definition: z.string().max(600),
        vietnameseMeaning: z.string().max(300),
        partOfSpeech: z.string().max(32).default(''),
        pronunciation: z.string().max(120).default(''),
        exampleSentences: z.array(z.string().max(220)).max(4).default([]),
        collocations: z.array(z.string().max(80)).max(5).default([]),
        synonyms: z.array(z.string().max(60)).max(5).default([]),
        antonyms: z.array(z.string().max(60)).max(5).default([]),
        topics: z.array(z.string().max(40)).max(4).default([]),
        difficulty: z.number().min(1).max(5).default(3),
        ieltsRelevance: z.number().min(1).max(5).default(3),
      }),
    )
    .min(1)
    .max(40),
});

const vocabularySchema = z.object({
  terms: z.array(z.string().min(2).max(80)).max(80),
  notes: z.string().max(600).default(''),
});

const exampleSchema = z.object({ example: z.string().min(5).max(300) });
const collocationSchema = z.object({ collocations: z.array(z.string().min(2).max(80)).max(6) });
const quizSchema = z.object({
  questionType: z.string().max(40).default('multiple-choice'),
  prompt: z.string().min(4).max(400),
  options: z.array(z.string().min(1).max(200)).min(2).max(5),
  answerIndex: z.number().min(0).max(4),
  explanation: z.string().max(400).default(''),
});
const reviewQuestionSchema = z.object({
  question: z.string().min(4).max(400),
  answer: z.string().min(1).max(400),
});
const classifySchema = z.object({
  items: z
    .array(
      z.object({
        term: z.string().min(1).max(80),
        difficulty: z.number().min(1).max(5),
        ieltsRelevance: z.number().min(1).max(5),
      }),
    )
    .max(100),
});
const imageSchema = z.object({
  kind: z.string().max(120).default('unknown'),
  text: z.string().max(12000).default(''),
  items: z.array(z.string().min(1).max(120)).max(80).default([]),
  topics: z.array(z.string().max(40)).max(8).default([]),
  language: z.string().max(16).default('en'),
  notes: z.string().max(600).default(''),
});

function describeOptions(options: GenerationOptions): string {
  const parts: string[] = [];
  parts.push(`Learning mode: ${options.mode}`);
  if (options.mode === 'ielts') {
    parts.push(`Target IELTS band: ${options.band || '7.0'}`);
    if (options.skill) parts.push(`Skill focus: ${options.skill}`);
  }
  if (options.topic) parts.push(`Topic: ${options.topic}`);
  parts.push(
    options.englishOnly
      ? 'English-only definitions. Do NOT include Vietnamese.'
      : 'Include a short, accurate Vietnamese gloss for each word.',
  );
  if (!options.includeExamples) parts.push('Do not include example sentences.');
  if (!options.includeCollocations) parts.push('Do not include collocations.');
  if (options.includePronunciation) parts.push('Include IPA pronunciation with slashes, e.g. /ˈmɪtɪɡeɪt/.');
  if (options.includeSynonyms) parts.push('Include up to two synonyms and one antonym where they genuinely exist.');
  if (options.customInstruction) parts.push(`Extra instruction: ${options.customInstruction}`);
  parts.push('Difficulty: 1 = easy, 5 = hard. ieltsRelevance: 1 = not useful for IELTS, 5 = core IELTS vocabulary.');
  parts.push(
    'Quality rules: prefer words a learner will actually use; avoid obscure or archaic vocabulary; avoid invented collocations; keep examples natural and modern.',
  );
  return parts.join('\n');
}

const emptyEnriched = (term: string): EnrichedWord => ({
  term,
  definition: '',
  vietnameseMeaning: '',
  partOfSpeech: '',
  pronunciation: '',
  exampleSentences: [],
  collocations: [],
  synonyms: [],
  antonyms: [],
  topics: [],
  difficulty: 3,
  ieltsRelevance: 3,
});

export const aiHelpers: AiHelpers = {
  async extractVocabulary({ text, prompt, options, limit }) {
    if (!isConfigured()) {
      const picks = pickTerms({ text, prompt, options, limit });
      return {
        terms: picks.map((pick) => pick.term).slice(0, limit),
        notes: OFFLINE_NOTICE,
      };
    }
    try {
      const result = await completeJson({
        task: [
          'Choose the vocabulary from the MATERIAL that is genuinely worth learning for this learner.',
          `Keep at most ${limit} words.`,
          'Rules: skip common words (the, make, good...), skip duplicates, skip proper nouns and numbers,',
          'skip trivia, and prioritise academic or topic-relevant words a learner will meet again.',
          'If the material is thin, propose the most useful words for the stated goal instead.',
          '',
          describeOptions(options),
        ].join(' '),
        userPayload: `LEARNER REQUEST: ${prompt}\n\nMATERIAL:\n${text.slice(0, 20_000)}`,
        schema: vocabularySchema,
        shapeHint: { terms: ['mitigate', 'substantial'], notes: 'why these words' },
      });
      const terms = dedupeTerms(result.value.terms).slice(0, limit);
      return { terms, notes: result.value.notes || '' };
    } catch (error) {
      logger.warn('extract_vocabulary fell back to offline engine', {
        error: error instanceof Error ? error.message : String(error),
      });
      const picks = pickTerms({ text, prompt, options, limit });
      return { terms: picks.map((pick) => pick.term).slice(0, limit), notes: OFFLINE_NOTICE };
    }
  },

  async enrichWords({ terms, options, source }) {
    const wanted = dedupeTerms(terms);
    if (wanted.length === 0) return [];

    if (!isConfigured()) {
      return wanted.map((term) => {
        const local = enrichTerm(term);
        return { ...emptyEnriched(term), ...stripFlag(local) };
      });
    }

    const out: EnrichedWord[] = [];
    const batches = chunk(wanted, 10);
    for (const batch of batches) {
      try {
        const result = await completeJson({
          task: [
            'Write a dictionary entry for each word, exactly as requested.',
            'Return one object per input word, in the same order, using the words exactly as given.',
            '',
            describeOptions(options),
          ].join(' '),
          userPayload: `WORDS: ${JSON.stringify(batch)}\n\nCONTEXT (may help you choose the right sense):\n${source.slice(0, 4000)}`,
          schema: enrichedWordSchema,
          shapeHint: {
            words: [
              {
                term: 'mitigate',
                definition: 'To make something harmful less severe.',
                vietnameseMeaning: 'làm giảm bớt',
                partOfSpeech: 'verb',
                pronunciation: '/ˈmɪtɪɡeɪt/',
                exampleSentences: ['Planting trees can mitigate urban heat.'],
                collocations: ['mitigate the impact', 'mitigate risk'],
                synonyms: ['alleviate', 'reduce'],
                antonyms: ['exacerbate'],
                topics: ['environment'],
                difficulty: 4,
                ieltsRelevance: 5,
              },
            ],
          },
        });
        const byTerm = new Map(result.value.words.map((word) => [word.term.toLowerCase(), word]));
        for (const term of batch) {
          const found = byTerm.get(term.toLowerCase());
          if (found) {
            out.push({
              term,
              definition: found.definition,
              vietnameseMeaning: options.englishOnly ? '' : found.vietnameseMeaning,
              partOfSpeech: found.partOfSpeech,
              pronunciation: options.includePronunciation ? found.pronunciation : '',
              exampleSentences: options.includeExamples ? found.exampleSentences : [],
              collocations: options.includeCollocations ? found.collocations : [],
              synonyms: options.includeSynonyms ? found.synonyms : [],
              antonyms: options.includeSynonyms ? found.antonyms : [],
              topics: found.topics,
              difficulty: found.difficulty,
              ieltsRelevance: found.ieltsRelevance,
            });
          } else {
            out.push({ ...emptyEnriched(term), ...stripFlag(enrichTerm(term)) });
          }
        }
      } catch (error) {
        logger.warn('enrich_words fell back to offline engine', {
          error: error instanceof Error ? error.message : String(error),
        });
        for (const term of batch) out.push({ ...emptyEnriched(term), ...stripFlag(enrichTerm(term)) });
      }
    }
    return out;
  },

  async generateExample({ term, partOfSpeech, options }) {
    if (!isConfigured()) return makeExample(term, partOfSpeech);
    try {
      const result = await completeJson({
        task: 'Write ONE natural, modern English sentence that shows the word in a useful context. Keep it under 20 words.',
        userPayload: `WORD: ${term}\nPART OF SPEECH: ${partOfSpeech || 'unknown'}\nMODE: ${options.mode}`,
        schema: exampleSchema,
        shapeHint: { example: 'Cities can mitigate extreme heat by planting more trees.' },
      });
      return result.value.example;
    } catch {
      return makeExample(term, partOfSpeech);
    }
  },

  async generateCollocations({ term, partOfSpeech }) {
    if (!isConfigured()) return makeCollocations(term);
    try {
      const result = await completeJson({
        task: 'Return three collocations that native speakers actually use with this word. Never invent unnatural pairings.',
        userPayload: `WORD: ${term}\nPART OF SPEECH: ${partOfSpeech || 'unknown'}`,
        schema: collocationSchema,
        shapeHint: { collocations: ['mitigate the impact', 'mitigate risk', 'mitigate climate change'] },
      });
      return result.value.collocations;
    } catch {
      return makeCollocations(term);
    }
  },

  async generateQuiz({ card, options }: { card: WorkbenchCard; options: GenerationOptions }) {
    if (!isConfigured()) return makeQuiz(card);
    try {
      const result = await completeJson({
        task: [
          'Write one multiple-choice question that tests real understanding of this word.',
          'Exactly one correct option and three plausible distractors. Distractors should be the kind of answer a learner might confuse it with.',
          options.includeVietnamese && !options.englishOnly
            ? 'Options may be Vietnamese glosses.'
            : 'Options must be English definitions.',
        ].join(' '),
        userPayload: `TERM: ${card.term}\nDEFINITION: ${card.definition}\nVIETNAMESE: ${card.vietnameseMeaning}`,
        schema: quizSchema,
        shapeHint: {
          questionType: 'multiple-choice',
          prompt: 'What does "mitigate" mean?',
          options: ['làm giảm bớt', 'làm trầm trọng thêm', 'xây dựng', 'bắt đầu'],
          answerIndex: 0,
          explanation: '"Mitigate" means to make something bad less severe.',
        },
        maxTokens: 900,
      });
      const quiz: QuizResult = {
        ...result.value,
        answerIndex: Math.min(Math.max(result.value.answerIndex, 0), result.value.options.length - 1),
      };
      return quiz;
    } catch {
      return makeQuiz(card);
    }
  },

  async generateReviewQuestion({ card, options }) {
    if (!isConfigured()) {
      return card.exampleSentences[0]
        ? {
            question: `Complete the sentence: "${blankOut(card.exampleSentences[0], card.term)}"`,
            answer: card.term,
          }
        : null;
    }
    try {
      const result = await completeJson({
        task: 'Write ONE short review question for this word that is NOT simply "what does it mean?" — for example a gap-fill, a usage choice, or a context question. Include the answer.',
        userPayload: `TERM: ${card.term}\nDEFINITION: ${card.definition}\nVIETNAMESE: ${card.vietnameseMeaning}\nEXAMPLE: ${card.exampleSentences[0] ?? ''}\nMODE: ${options.mode}`,
        schema: reviewQuestionSchema,
        shapeHint: {
          question: 'Complete the sentence: "Tree planting can ______ the effects of urban heat."',
          answer: 'mitigate',
        },
        maxTokens: 600,
      });
      return result.value;
    } catch {
      return card.exampleSentences[0]
        ? {
            question: `Complete the sentence: "${blankOut(card.exampleSentences[0], card.term)}"`,
            answer: card.term,
          }
        : null;
    }
  },

  async classify({ items, options }) {
    if (!isConfigured()) {
      return items.map((item) => {
        const local = enrichTerm(item.term);
        return {
          term: item.term,
          difficulty: local.difficulty ?? 3,
          ieltsRelevance: local.ieltsRelevance ?? 3,
        };
      });
    }
    try {
      const result = await completeJson({
        task: [
          'For each word, estimate difficulty (1-5) for a Vietnamese learner and IELTS relevance (1-5).',
          'Relevance 5 = a word that genuinely improves IELTS writing or speaking; 1 = a word that is common, obscure, or showy without benefit.',
          '',
          describeOptions(options),
        ].join(' '),
        userPayload: JSON.stringify(items),
        schema: classifySchema,
        shapeHint: { items: [{ term: 'mitigate', difficulty: 4, ieltsRelevance: 5 }] },
        maxTokens: 1500,
      });
      const byTerm = new Map(result.value.items.map((item) => [item.term.toLowerCase(), item]));
      return items.map((item) => {
        const found = byTerm.get(item.term.toLowerCase());
        return found
          ? {
              term: item.term,
              difficulty: Math.round(found.difficulty),
              ieltsRelevance: Math.round(found.ieltsRelevance),
            }
          : { term: item.term, difficulty: 3, ieltsRelevance: 3 };
      });
    } catch {
      return items.map((item) => {
        const local = enrichTerm(item.term);
        return { term: item.term, difficulty: local.difficulty ?? 3, ieltsRelevance: local.ieltsRelevance ?? 3 };
      });
    }
  },

  async analyzeImage({ imageDataUrl, intent, options }) {
    if (!isConfigured()) {
      throw new Error('Image analysis needs an AI provider configured on the server.');
    }
    const provider = getProvider();
    if (!provider?.vision) {
      throw new Error(`The configured provider (${provider?.label ?? 'none'}) cannot read images.`);
    }
    const result = await completeJsonWithImage({
      task: [
        'Look at this image and decide what in it is worth learning for an English learner.',
        'Identify the kind of material (textbook page, vocabulary list, handwritten notes, screenshot, worksheet, article, sign, diagram).',
        'Extract only the useful text, then list the vocabulary or items worth turning into flashcards.',
        'Do NOT turn every word into a card: skip articles, prepositions and obvious words, keep useful and academic ones.',
        '',
        describeOptions(options),
      ].join(' '),
      imageDataUrl,
      schema: imageSchema,
      shapeHint: {
        kind: 'vocabulary list',
        text: 'mitigate — alleviate — exacerbate — substantial',
        items: ['mitigate', 'alleviate', 'exacerbate', 'substantial'],
        topics: ['environment'],
        language: 'en',
        notes: intent || 'Four academic verbs from a vocabulary list.',
      },
      timeoutMs: 90_000,
    });
    const analysis: ImageAnalysis = {
      kind: result.value.kind,
      text: result.value.text,
      items: dedupeTerms(result.value.items),
      topics: result.value.topics,
      language: result.value.language,
      notes: result.value.notes,
    };
    return analysis;
  },
};

/* --------------------------------- helpers -------------------------------- */

function stripFlag(local: ReturnType<typeof enrichTerm>): EnrichedWord {
  const { needsEnrichment: _ignored, ...rest } = local;
  return rest as EnrichedWord;
}

function dedupeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = String(raw ?? '').trim();
    if (term.length < 2 || term.length > 80) continue;
    if (!/[a-z]/i.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function blankOut(sentence: string, term: string): string {
  const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return sentence.replace(pattern, '______');
}

export function countWords(text: string): number {
  return tokenize(text).length;
}
