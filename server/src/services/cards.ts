/**
 * Per-card AI actions in the deck editor. Each action performs one focused
 * operation instead of regenerating the whole deck.
 */
import { z } from 'zod';
import type { CardActionInput, CardInput } from '@shared/schema';
import type { CardAction } from '@shared/types';
import { completeJson, isConfigured } from '../ai/gateway';
import { enrichTerm, makeCollocations, makeExample, makeQuiz, relatedWords } from '../ai/local';
import type { QuizResult } from '../ai/tools';
import { logger } from '../logger';

const patchSchema = z.object({
  term: z.string().max(80).optional(),
  definition: z.string().max(600).optional(),
  vietnameseMeaning: z.string().max(400).optional(),
  partOfSpeech: z.string().max(32).optional(),
  pronunciation: z.string().max(120).optional(),
  exampleSentences: z.array(z.string().max(220)).max(4).optional(),
  collocations: z.array(z.string().max(80)).max(6).optional(),
  synonyms: z.array(z.string().max(60)).max(6).optional(),
  antonyms: z.array(z.string().max(60)).max(6).optional(),
  relatedWords: z.array(z.string().max(60)).max(6).optional(),
  topics: z.array(z.string().max(40)).max(4).optional(),
  difficulty: z.number().min(1).max(5).optional(),
  ieltsRelevance: z.number().min(1).max(5).optional(),
  note: z.string().max(300).optional(),
});

const ACTIONS: Record<CardAction, { task: string; hint: Record<string, unknown> }> = {
  improve: {
    task: 'Improve this flashcard. Sharpen the definition so it is accurate and easy to recall, and write a better natural example sentence. Keep the same word and sense.',
    hint: { definition: 'To make something harmful less severe.', exampleSentences: ['Planting trees can mitigate urban heat.'] },
  },
  explain: {
    task: 'Explain this word so a Vietnamese learner really understands it. Give a clear English definition and a Vietnamese explanation with a short note on when to use it.',
    hint: { definition: 'To make a bad situation less severe.', vietnameseMeaning: 'làm giảm bớt, làm dịu đi', note: 'Formal; common in academic writing about problems and solutions.' },
  },
  'add-example': {
    task: 'Add one more natural, modern example sentence that shows a DIFFERENT context from any existing example. Keep it under 20 words.',
    hint: { exampleSentences: ['Insurance can mitigate the financial impact of a flood.'] },
  },
  'add-collocations': {
    task: 'Add three collocations that English speakers really use with this word. Do not invent unnatural pairings.',
    hint: { collocations: ['mitigate the impact', 'mitigate risk', 'mitigate climate change'] },
  },
  simplify: {
    task: 'Rewrite this card in simpler English. Keep the meaning exact but use common words, a short definition and a simple example.',
    hint: { definition: 'To make a problem less bad.', exampleSentences: ['Trees can make city heat less of a problem.'] },
  },
  'ielts-focus': {
    task: 'Make this card useful for IELTS writing and speaking at Band 7+. Keep the register formal, add a collocation an examiner would reward, and set ieltsRelevance honestly (5 = core, 1 = not useful).',
    hint: { definition: 'To reduce the severity of something undesirable.', collocations: ['mitigate the effects of'], ieltsRelevance: 5, note: 'Strong in Task 2 problem/solution essays.' },
  },
  vietnamese: {
    task: 'Add a short, accurate Vietnamese explanation, including the most common Vietnamese translation and a note on usage. Answer in the vietnameseMeaning and note fields.',
    hint: { vietnameseMeaning: 'làm giảm bớt (tác hại); thường dùng trong văn bản trang trọng', note: 'Dùng với "impact", "effects", "risk".' },
  },
  quiz: {
    task: 'Write one multiple-choice question that tests understanding of this word, with one correct option and three plausible distractors.',
    hint: { note: 'Practice: "Tree planting can ______ the effects of urban heat."' },
  },
  'related-words': {
    task: 'List up to five genuinely related words: synonyms, antonyms and words from the same topic a learner should know next.',
    hint: { relatedWords: ['alleviate', 'exacerbate', 'reduce', 'aggravate'] },
  },
  pronunciation: {
    task: 'Give the IPA transcription with slashes and note the stressed syllable.',
    hint: { pronunciation: '/ˈmɪtɪɡeɪt/', note: 'Stress on the first syllable: MI-ti-gate.' },
  },
};

export interface CardActionResult {
  card: CardInput;
  note?: string;
  quiz?: QuizResult | null;
}

export async function runCardAction(input: CardActionInput): Promise<CardActionResult> {
  const { action, card, context } = input;
  const spec = ACTIONS[action];

  if (action === 'quiz') {
    const quiz = await aiQuiz(card);
    return { card, quiz };
  }

  if (!isConfigured()) {
    return { card: offlineAction(action, card), note: offlineNote(action) };
  }

  try {
    const result = await completeJson({
      task: [
        spec.task,
        'Return ONLY the fields you are changing. Leave other fields out entirely.',
        'Never invent facts. If you cannot improve something, return an empty object.',
      ].join(' '),
      userPayload: [
        `CURRENT CARD: ${JSON.stringify({
          term: card.term,
          definition: card.definition,
          vietnameseMeaning: card.vietnameseMeaning,
          partOfSpeech: card.partOfSpeech,
          pronunciation: card.pronunciation,
          exampleSentences: card.exampleSentences,
          collocations: card.collocations,
          synonyms: card.synonyms,
          antonyms: card.antonyms,
          relatedWords: card.relatedWords,
          topics: card.topics,
          difficulty: card.difficulty,
          ieltsRelevance: card.ieltsRelevance,
        })}`,
        context.band ? `TARGET IELTS BAND: ${context.band}` : '',
        context.topic ? `TOPIC: ${context.topic}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      schema: patchSchema,
      shapeHint: spec.hint,
      maxTokens: 900,
    });

    return { card: mergePatch(card, result.value), note: result.value.note };
  } catch (error) {
    logger.warn('card action fell back to offline', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return { card: offlineAction(action, card), note: offlineNote(action) };
  }
}

async function aiQuiz(card: CardInput): Promise<QuizResult | null> {
  const local = makeQuiz(card);
  if (!isConfigured()) return local;
  try {
    const result = await completeJson({
      task: 'Write one multiple-choice question that tests real understanding of this word. One correct option, three plausible distractors learned from common mistakes.',
      userPayload: `TERM: ${card.term}\nDEFINITION: ${card.definition}\nVIETNAMESE: ${card.vietnameseMeaning}\nEXAMPLE: ${card.exampleSentences[0] ?? ''}`,
      schema: z.object({
        questionType: z.string().max(40).default('multiple-choice'),
        prompt: z.string().min(4).max(400),
        options: z.array(z.string().min(1).max(200)).min(2).max(5),
        answerIndex: z.number().min(0).max(4),
        explanation: z.string().max(400).default(''),
      }),
      shapeHint: {
        questionType: 'multiple-choice',
        prompt: 'What does "mitigate" mean?',
        options: ['làm giảm bớt', 'làm trầm trọng thêm', 'xây dựng', 'bắt đầu'],
        answerIndex: 0,
        explanation: '"Mitigate" means to make something bad less severe.',
      },
      maxTokens: 700,
    });
    return {
      ...result.value,
      answerIndex: Math.min(Math.max(result.value.answerIndex, 0), result.value.options.length - 1),
    };
  } catch {
    return local;
  }
}

function mergePatch(card: CardInput, patch: z.infer<typeof patchSchema>): CardInput {
  const list = (existing: string[], incoming?: string[], max = 6) => {
    if (!incoming) return existing;
    const out = [...existing];
    for (const item of incoming) {
      const value = item.trim();
      if (value && !out.includes(value)) out.push(value);
    }
    return out.slice(0, max);
  };

  return {
    ...card,
    term: patch.term?.trim() || card.term,
    definition: patch.definition?.trim() || card.definition,
    vietnameseMeaning: patch.vietnameseMeaning?.trim() || card.vietnameseMeaning,
    partOfSpeech: patch.partOfSpeech?.trim() || card.partOfSpeech,
    pronunciation: patch.pronunciation?.trim() || card.pronunciation,
    exampleSentences: list(card.exampleSentences, patch.exampleSentences, 4),
    collocations: list(card.collocations, patch.collocations, 6),
    synonyms: list(card.synonyms, patch.synonyms, 6),
    antonyms: list(card.antonyms, patch.antonyms, 6),
    relatedWords: list(card.relatedWords, patch.relatedWords, 6),
    topics: patch.topics?.length ? list([], patch.topics, 4) : card.topics,
    difficulty: patch.difficulty ? Math.round(patch.difficulty) : card.difficulty,
    ieltsRelevance: patch.ieltsRelevance ? Math.round(patch.ieltsRelevance) : card.ieltsRelevance,
  };
}

function offlineAction(action: CardAction, card: CardInput): CardInput {
  const local = enrichTerm(card.term);
  switch (action) {
    case 'add-example':
      return { ...card, exampleSentences: [...card.exampleSentences, makeExample(card.term, card.partOfSpeech)].slice(0, 4) };
    case 'add-collocations':
      return { ...card, collocations: [...new Set([...card.collocations, ...makeCollocations(card.term)])].slice(0, 6) };
    case 'related-words':
      return { ...card, relatedWords: relatedWords(card.term, 5) };
    case 'pronunciation':
      return { ...card, pronunciation: local.pronunciation || card.pronunciation };
    case 'vietnamese':
      return { ...card, vietnameseMeaning: local.vietnameseMeaning || card.vietnameseMeaning };
    case 'ielts-focus':
      return { ...card, ieltsRelevance: Math.max(card.ieltsRelevance, local.ieltsRelevance) };
    default:
      return card.definition
        ? card
        : { ...card, definition: local.definition, vietnameseMeaning: card.vietnameseMeaning || local.vietnameseMeaning };
  }
}

function offlineNote(action: CardAction): string {
  return `Offline engine applied a built-in ${action.replace(/-/g, ' ')} — connect an AI provider for model-generated results.`;
}
