/**
 * The AI tool system.
 *
 * Every tool is a typed contract: a JSON Schema sent to the model, a zod
 * validator applied to whatever the model (or the offline engine) returns, and
 * a narrow, explicitly permitted operation. Tools never receive a database
 * handle — they operate on a `Workbench`, so the model can build content but
 * cannot read or write anything else.
 */
import { z } from 'zod';
import type { GenerationOptions, ToolCategory, ToolDescriptor } from '@shared/types';
import { defineObject, type FieldSpec } from './schema-builder';
import { Workbench, type WorkbenchCard } from './workbench';

export interface EnrichedWord {
  term: string;
  definition: string;
  vietnameseMeaning: string;
  partOfSpeech: string;
  pronunciation: string;
  exampleSentences: string[];
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  topics: string[];
  difficulty: number;
  ieltsRelevance: number;
}

export interface ImageAnalysis {
  /** What the image appears to contain. */
  kind: string;
  /** Any text that matters for learning (OCR-lite). */
  text: string;
  /** The vocabulary or items worth turning into cards. */
  items: string[];
  topics: string[];
  language: string;
  notes: string;
}

export interface QuizResult {
  questionType: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface AiHelpers {
  extractVocabulary(params: {
    text: string;
    prompt: string;
    options: GenerationOptions;
    limit: number;
  }): Promise<{ terms: string[]; notes: string }>;

  enrichWords(params: {
    terms: string[];
    options: GenerationOptions;
    source: string;
  }): Promise<EnrichedWord[]>;

  generateExample(params: { term: string; partOfSpeech: string; options: GenerationOptions }): Promise<string>;
  generateCollocations(params: { term: string; partOfSpeech: string }): Promise<string[]>;
  generateQuiz(params: { card: WorkbenchCard; options: GenerationOptions }): Promise<QuizResult | null>;
  generateReviewQuestion(params: { card: WorkbenchCard; options: GenerationOptions }): Promise<{
    question: string;
    answer: string;
  } | null>;
  classify(params: {
    items: { term: string; definition: string }[];
    options: GenerationOptions;
  }): Promise<{ term: string; difficulty: number; ieltsRelevance: number }[]>;
  analyzeImage(params: {
    imageDataUrl: string;
    intent: string;
    options: GenerationOptions;
  }): Promise<ImageAnalysis>;
}

export interface ToolContext {
  workbench: Workbench;
  helpers: AiHelpers;
  options: GenerationOptions;
  sourceText: string;
  prompt: string;
  /** Image payloads attached to this build, indexed by reference. */
  images: Map<string, string>;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  category: ToolCategory;
  /** True when the tool needs model inference to do its job. */
  intelligent: boolean;
  input: { zod: z.ZodTypeAny; jsonSchema: Record<string, unknown> };
  execute(input: I, ctx: ToolContext): Promise<O>;
}

const cardFields: Record<string, FieldSpec> = {
  term: { kind: 'string', description: 'The English word or phrase on the front of the card.', maxLength: 80 },
  definition: { kind: 'string', description: 'Short English definition. Leave empty to have it generated.', maxLength: 600, optional: true },
  vietnameseMeaning: { kind: 'string', description: 'Short, accurate Vietnamese gloss. Leave empty to have it generated.', maxLength: 300, optional: true },
  partOfSpeech: { kind: 'string', description: 'noun | verb | adjective | adverb | phrase', maxLength: 32, optional: true },
  pronunciation: { kind: 'string', description: 'IPA transcription including slashes, e.g. /mɪtɪɡeɪt/.', maxLength: 120, optional: true },
  exampleSentences: { kind: 'array', items: { kind: 'string', maxLength: 220 }, description: 'One or two natural example sentences.', maxItems: 4, optional: true },
  collocations: { kind: 'array', items: { kind: 'string', maxLength: 80 }, description: 'Two or three natural word partners.', maxItems: 5, optional: true },
  synonyms: { kind: 'array', items: { kind: 'string', maxLength: 60 }, maxItems: 5, optional: true },
  antonyms: { kind: 'array', items: { kind: 'string', maxLength: 60 }, maxItems: 5, optional: true },
  relatedWords: { kind: 'array', items: { kind: 'string', maxLength: 60 }, maxItems: 5, optional: true },
  topics: { kind: 'array', items: { kind: 'string', maxLength: 40 }, description: 'Lowercase topic tags.', maxItems: 4, optional: true },
  difficulty: { kind: 'integer', min: 1, max: 5, description: '1 = easy, 5 = hard.', optional: true },
  ieltsRelevance: { kind: 'integer', min: 1, max: 5, description: '1 = not useful for IELTS, 5 = core.', optional: true },
  source: { kind: 'string', enum: ['ai', 'manual', 'import', 'image', 'fork', 'offline'], optional: true },
};

const cardInputSpec: FieldSpec = { kind: 'object', fields: { id: { kind: 'string', optional: true }, ...cardFields } };
const cardObject = defineObject({ id: { kind: 'string', optional: true }, ...cardFields });

/* -------------------------------- deck tools ------------------------------ */

const deckPatchSpec = defineObject({
  title: { kind: 'string', maxLength: 200, optional: true },
  description: { kind: 'string', maxLength: 800, optional: true },
  topic: { kind: 'string', maxLength: 120, optional: true },
  tags: { kind: 'array', items: { kind: 'string', maxLength: 40 }, maxItems: 10, optional: true },
  difficulty: { kind: 'integer', min: 1, max: 5, optional: true },
  language: { kind: 'string', maxLength: 16, optional: true },
  learningMode: { kind: 'string', enum: ['ielts', 'academic', 'general', 'school', 'exam', 'custom'], optional: true },
});

const createDeck: ToolDefinition<z.infer<typeof deckPatchSpec.zod>, { deck: Workbench['deck'] }> = {
  name: 'create_deck',
  description: 'Create (or reset) the deck that generated cards will be added to.',
  category: 'deck',
  intelligent: false,
  input: deckPatchSpec,
  async execute(input, ctx) {
    ctx.workbench.updateDeck({
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.topic !== undefined ? { topic: input.topic } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.learningMode ? { learningMode: input.learningMode } : {}),
    });
    ctx.workbench.log('create_deck', `Deck "${ctx.workbench.deck.title}" ready`);
    return { deck: ctx.workbench.deck };
  },
};

const updateDeck: ToolDefinition<z.infer<typeof deckPatchSpec.zod>, { deck: Workbench['deck'] }> = {
  name: 'update_deck',
  description: 'Update the title, description, topic, tags or difficulty of the deck being built.',
  category: 'deck',
  intelligent: false,
  input: deckPatchSpec,
  async execute(input, ctx) {
    return createDeck.execute(input, ctx);
  },
};

/* -------------------------------- card tools ------------------------------ */

type CardInputShape = z.infer<typeof cardObject.zod>;

function toCardInput(raw: Record<string, unknown>): Parameters<Workbench['addCard']>[0] {
  return raw as Parameters<Workbench['addCard']>[0];
}

const createFlashcardSpec = cardObject;

const createFlashcard: ToolDefinition<CardInputShape, { card: WorkbenchCard }> = {
  name: 'create_flashcard',
  description:
    'Create one flashcard. If definition or Vietnamese meaning are missing, the enrichment engine fills them in before the card is added.',
  category: 'card',
  intelligent: true,
  input: createFlashcardSpec,
  async execute(input, ctx) {
    const raw = input as Record<string, unknown>;
    let enriched: EnrichedWord | null = null;
    const needsEnrichment = !String(raw.definition ?? '').trim();
    if (needsEnrichment) {
      const [result] = await ctx.helpers.enrichWords({
        terms: [String(raw.term ?? '')],
        options: ctx.options,
        source: ctx.sourceText,
      });
      enriched = result ?? null;
    }
    const card = ctx.workbench.addCard(
      toCardInput({
        ...raw,
        term: String(raw.term ?? enriched?.term ?? '').trim(),
        definition: String(raw.definition ?? enriched?.definition ?? ''),
        vietnameseMeaning: String(raw.vietnameseMeaning ?? enriched?.vietnameseMeaning ?? ''),
        partOfSpeech: String(raw.partOfSpeech ?? enriched?.partOfSpeech ?? ''),
        pronunciation: String(raw.pronunciation ?? enriched?.pronunciation ?? ''),
        exampleSentences: (raw.exampleSentences as string[] | undefined) ?? enriched?.exampleSentences ?? [],
        collocations: (raw.collocations as string[] | undefined) ?? enriched?.collocations ?? [],
        synonyms: (raw.synonyms as string[] | undefined) ?? enriched?.synonyms ?? [],
        antonyms: (raw.antonyms as string[] | undefined) ?? enriched?.antonyms ?? [],
        topics: (raw.topics as string[] | undefined) ?? enriched?.topics ?? [],
        difficulty: Number(raw.difficulty ?? enriched?.difficulty ?? 3),
        ieltsRelevance: Number(raw.ieltsRelevance ?? enriched?.ieltsRelevance ?? 3),
        source: (raw.source as 'ai' | undefined) ?? 'ai',
      }),
    );
    ctx.workbench.log('create_flashcard', `Created card "${card.term}"`);
    return { card };
  },
};

const createFlashcardsSpec = defineObject({
  cards: { kind: 'array', items: cardInputSpec, maxItems: 40, description: 'The cards to create.' },
});

const createFlashcards: ToolDefinition<{ cards: Record<string, unknown>[] }, { cards: WorkbenchCard[] }> = {
  name: 'create_flashcards',
  description: 'Create several flashcards at once. Cards missing a definition are enriched automatically.',
  category: 'card',
  intelligent: true,
  input: createFlashcardsSpec,
  async execute(input, ctx) {
    const pending: Record<string, unknown>[] = [];
    const ready: Record<string, unknown>[] = [];
    for (const raw of input.cards) {
      if (String(raw.definition ?? '').trim()) ready.push(raw);
      else pending.push(raw);
    }

    const enriched = pending.length
      ? await ctx.helpers.enrichWords({
          terms: pending.map((raw) => String(raw.term ?? '')).filter(Boolean),
          options: ctx.options,
          source: ctx.sourceText,
        })
      : [];
    const byTerm = new Map(enriched.map((item) => [item.term.toLowerCase(), item]));

    const merged = [...ready, ...pending].map((raw) => {
      const extra = byTerm.get(String(raw.term ?? '').toLowerCase());
      return {
        ...raw,
        definition: String(raw.definition ?? extra?.definition ?? ''),
        vietnameseMeaning: String(raw.vietnameseMeaning ?? extra?.vietnameseMeaning ?? ''),
        partOfSpeech: String(raw.partOfSpeech ?? extra?.partOfSpeech ?? ''),
        pronunciation: String(raw.pronunciation ?? extra?.pronunciation ?? ''),
        exampleSentences: (raw.exampleSentences as string[] | undefined) ?? extra?.exampleSentences ?? [],
        collocations: (raw.collocations as string[] | undefined) ?? extra?.collocations ?? [],
        synonyms: (raw.synonyms as string[] | undefined) ?? extra?.synonyms ?? [],
        antonyms: (raw.antonyms as string[] | undefined) ?? extra?.antonyms ?? [],
        topics: (raw.topics as string[] | undefined) ?? extra?.topics ?? [],
        difficulty: Number(raw.difficulty ?? extra?.difficulty ?? 3),
        ieltsRelevance: Number(raw.ieltsRelevance ?? extra?.ieltsRelevance ?? 3),
        source: (raw.source as 'ai' | undefined) ?? 'ai',
      };
    });

    const cards = ctx.workbench.addCards(merged.map((raw) => toCardInput(raw)));
    ctx.workbench.log('create_flashcards', `Created ${cards.length} cards`);
    return { cards };
  },
};

const updateFlashcardSpec = defineObject({
  id: { kind: 'string', description: 'The card id returned by a create tool.' },
  patch: { kind: 'object', fields: cardFields },
});

const updateFlashcard: ToolDefinition<{ id: string; patch: Record<string, unknown> }, { card: WorkbenchCard | null }> = {
  name: 'update_flashcard',
  description: 'Change fields on an existing card in the deck being built.',
  category: 'card',
  intelligent: false,
  input: updateFlashcardSpec,
  async execute(input, ctx) {
    const card = ctx.workbench.updateCard(input.id, input.patch as Partial<WorkbenchCard>);
    ctx.workbench.log('update_flashcard', card ? `Updated "${card.term}"` : 'Card not found');
    return { card };
  },
};

const deleteFlashcard: ToolDefinition<{ id: string }, { deleted: boolean }> = {
  name: 'delete_flashcard',
  description: 'Remove a card from the deck being built.',
  category: 'card',
  intelligent: false,
  input: defineObject({ id: { kind: 'string' } }),
  async execute(input, ctx) {
    const deleted = ctx.workbench.deleteCard(input.id);
    ctx.workbench.log('delete_flashcard', deleted ? 'Removed one card' : 'Card not found');
    return { deleted };
  },
};

const addCardsToDeck: ToolDefinition<{ cards: Record<string, unknown>[] }, { added: number }> = {
  name: 'add_cards_to_deck',
  description: 'Append already-built cards to the deck.',
  category: 'card',
  intelligent: false,
  input: createFlashcardsSpec,
  async execute(input, ctx) {
    const cards = ctx.workbench.addCards(input.cards.map((raw) => toCardInput(raw)));
    ctx.workbench.log('add_cards_to_deck', `Added ${cards.length} cards`);
    return { added: cards.length };
  },
};

/* ------------------------------ analysis tools ---------------------------- */

const analyzeImageSpec = defineObject({
  imageRef: { kind: 'string', description: 'Reference of an image provided with the request, e.g. "image:0".' },
  intent: { kind: 'string', maxLength: 500, description: 'What the learner wants from this image.', optional: true },
});

const analyzeImage: ToolDefinition<{ imageRef: string; intent?: string }, { analysis: ImageAnalysis }> = {
  name: 'analyze_image',
  description:
    'Look at an uploaded or pasted image and report the learning material it contains: useful text, the vocabulary or items worth learning, and the topic. It does not transcribe everything.',
  category: 'analysis',
  intelligent: true,
  input: analyzeImageSpec,
  async execute(input, ctx) {
    const dataUrl = ctx.images.get(input.imageRef);
    if (!dataUrl) throw new Error(`Unknown image reference "${input.imageRef}"`);
    const analysis = await ctx.helpers.analyzeImage({
      imageDataUrl: dataUrl,
      intent: input.intent ?? ctx.prompt,
      options: ctx.options,
    });
    ctx.workbench.log('analyze_image', `Analysed image (${analysis.items.length} items found)`);
    return { analysis };
  },
};

const extractVocabularySpec = defineObject({
  limit: { kind: 'integer', min: 1, max: 80, description: 'How many words to keep.' },
  sourceText: { kind: 'string', maxLength: 40000, description: 'Optional override of the source text.', optional: true },
});

const extractVocabulary: ToolDefinition<{ limit: number; sourceText?: string }, { terms: string[]; notes: string }> = {
  name: 'extract_vocabulary',
  description:
    'Read the source material and choose the vocabulary worth learning. Skips common words, duplicates and trivia; prioritises academic and topic-relevant words.',
  category: 'analysis',
  intelligent: true,
  input: extractVocabularySpec,
  async execute(input, ctx) {
    const result = await ctx.helpers.extractVocabulary({
      text: input.sourceText ?? ctx.sourceText,
      prompt: ctx.prompt,
      options: ctx.options,
      limit: input.limit,
    });
    ctx.workbench.log('extract_vocabulary', `Extracted ${result.terms.length} candidate words`);
    return result;
  },
};

/* ----------------------------- enrichment tools --------------------------- */

const enrichWord: ToolDefinition<{ word: string; context?: string }, { word: EnrichedWord | null }> = {
  name: 'enrich_word',
  description: 'Produce a full dictionary entry for one word: meaning, Vietnamese gloss, example, collocations, difficulty.',
  category: 'enrichment',
  intelligent: true,
  input: defineObject({
    word: { kind: 'string', maxLength: 80 },
    context: { kind: 'string', maxLength: 2000, optional: true },
  }),
  async execute(input, ctx) {
    const [word] = await ctx.helpers.enrichWords({
      terms: [input.word],
      options: ctx.options,
      source: input.context ?? ctx.sourceText,
    });
    ctx.workbench.log('enrich_word', `Enriched "${input.word}"`);
    return { word: word ?? null };
  },
};

const generateExample: ToolDefinition<{ term: string; partOfSpeech?: string }, { example: string }> = {
  name: 'generate_example',
  description: 'Write one natural, modern example sentence for a word.',
  category: 'enrichment',
  intelligent: true,
  input: defineObject({
    term: { kind: 'string', maxLength: 80 },
    partOfSpeech: { kind: 'string', maxLength: 32, optional: true },
  }),
  async execute(input, ctx) {
    const example = await ctx.helpers.generateExample({
      term: input.term,
      partOfSpeech: input.partOfSpeech ?? '',
      options: ctx.options,
    });
    ctx.workbench.log('generate_example', `Example for "${input.term}"`);
    return { example };
  },
};

const generateCollocations: ToolDefinition<{ term: string; partOfSpeech?: string }, { collocations: string[] }> = {
  name: 'generate_collocations',
  description: 'Return three natural collocations for a word (only ones real English speakers use).',
  category: 'enrichment',
  intelligent: true,
  input: defineObject({
    term: { kind: 'string', maxLength: 80 },
    partOfSpeech: { kind: 'string', maxLength: 32, optional: true },
  }),
  async execute(input, ctx) {
    const collocations = await ctx.helpers.generateCollocations({
      term: input.term,
      partOfSpeech: input.partOfSpeech ?? '',
    });
    ctx.workbench.log('generate_collocations', `${collocations.length} collocations for "${input.term}"`);
    return { collocations };
  },
};

const generateQuiz: ToolDefinition<{ cardId: string }, { quiz: QuizResult | null }> = {
  name: 'generate_quiz',
  description: 'Write a multiple-choice practice question for a card in the deck.',
  category: 'quiz',
  intelligent: true,
  input: defineObject({ cardId: { kind: 'string' } }),
  async execute(input, ctx) {
    const card = ctx.workbench.findCard(input.cardId);
    if (!card) return { quiz: null };
    const quiz = await ctx.helpers.generateQuiz({ card, options: ctx.options });
    ctx.workbench.log('generate_quiz', quiz ? `Quiz for "${card.term}"` : 'No quiz generated');
    return { quiz };
  },
};

const generateReviewQuestion: ToolDefinition<{ cardId: string }, { question: { question: string; answer: string } | null }> = {
  name: 'generate_review_question',
  description: 'Write a short review question for a card, different from the default "what does this mean?".',
  category: 'quiz',
  intelligent: true,
  input: defineObject({ cardId: { kind: 'string' } }),
  async execute(input, ctx) {
    const card = ctx.workbench.findCard(input.cardId);
    if (!card) return { question: null };
    const question = await ctx.helpers.generateReviewQuestion({ card, options: ctx.options });
    ctx.workbench.log('generate_review_question', question ? `Review question for "${card.term}"` : 'No question');
    return { question };
  },
};

/* ------------------------------- quality tools ---------------------------- */

const validateFlashcard: ToolDefinition<
  { cardId: string },
  { ok: boolean; issues: { field: string; message: string; level: string }[] }
> = {
  name: 'validate_flashcard',
  description: 'Check a card for missing fields, duplicated definitions and out-of-range values.',
  category: 'quality',
  intelligent: false,
  input: defineObject({ cardId: { kind: 'string' } }),
  async execute(input, ctx) {
    const card = ctx.workbench.findCard(input.cardId);
    if (!card) return { ok: false, issues: [{ field: 'id', message: 'Card not found', level: 'error' }] };
    const issues = ctx.workbench.validate(card, {
      requireVietnamese: ctx.options.includeVietnamese && !ctx.options.englishOnly,
    });
    ctx.workbench.log('validate_flashcard', `Validated "${card.term}" (${issues.length} issues)`);
    return { ok: !issues.some((issue) => issue.level === 'error'), issues };
  },
};

const findDuplicates: ToolDefinition<Record<string, never>, { duplicates: { keep: string; remove: string; term: string }[] }> = {
  name: 'find_duplicates',
  description: 'Find cards that repeat the same term within the deck.',
  category: 'quality',
  intelligent: false,
  input: defineObject({}),
  async execute(_input, ctx) {
    const duplicates = ctx.workbench.findDuplicates();
    ctx.workbench.log('find_duplicates', `${duplicates.length} duplicates`);
    return { duplicates };
  },
};

const classifyDifficulty: ToolDefinition<{ cardIds?: string[] }, { updated: number }> = {
  name: 'classify_difficulty',
  description: 'Estimate how hard each card is for a Vietnamese learner, from 1 (easy) to 5 (hard).',
  category: 'quality',
  intelligent: true,
  input: defineObject({
    cardIds: { kind: 'array', items: { kind: 'string' }, maxItems: 100, optional: true },
  }),
  async execute(input, ctx) {
    const targets = input.cardIds
      ? ctx.workbench.cards.filter((card) => input.cardIds?.includes(card.id))
      : ctx.workbench.cards;
    const classified = await ctx.helpers.classify({
      items: targets.map((card) => ({ term: card.term, definition: card.definition })),
      options: ctx.options,
    });
    let updated = 0;
    for (const item of classified) {
      const card = ctx.workbench.findByTerm(item.term);
      if (!card) continue;
      ctx.workbench.updateCard(card.id, {
        difficulty: item.difficulty,
        ieltsRelevance: item.ieltsRelevance,
      });
      updated += 1;
    }
    ctx.workbench.log('classify_difficulty', `Calibrated ${updated} cards`);
    return { updated };
  },
};

const classifyIeltsRelevance: ToolDefinition<{ cardIds?: string[] }, { updated: number }> = {
  name: 'classify_ielts_relevance',
  description: 'Score how useful each word is for IELTS writing and speaking, from 1 to 5.',
  category: 'quality',
  intelligent: true,
  input: defineObject({
    cardIds: { kind: 'array', items: { kind: 'string' }, maxItems: 100, optional: true },
  }),
  async execute(input, ctx) {
    return classifyDifficulty.execute(input, ctx);
  },
};

/* ---------------------------- organisation tools -------------------------- */

const groupCards: ToolDefinition<{ by?: string }, { groups: Record<string, string[]> }> = {
  name: 'group_cards',
  description: 'Group the cards in the deck by topic.',
  category: 'card',
  intelligent: false,
  input: defineObject({ by: { kind: 'string', enum: ['topic'], optional: true } }),
  async execute(_input, ctx) {
    const groups = ctx.workbench.groups();
    ctx.workbench.log('group_cards', `${Object.keys(groups).length} topic groups`);
    return { groups };
  },
};

const reorderCards: ToolDefinition<
  { mode: 'alphabetical' | 'difficulty' | 'ielts-relevance' | 'provided' | 'grouped'; topics?: string[] },
  { order: string[] }
> = {
  name: 'reorder_cards',
  description: 'Reorder the cards in the deck: easiest first, most IELTS-relevant first, alphabetical, or grouped by topic.',
  category: 'card',
  intelligent: false,
  input: defineObject({
    mode: { kind: 'string', enum: ['alphabetical', 'difficulty', 'ielts-relevance', 'provided', 'grouped'] },
    topics: { kind: 'array', items: { kind: 'string', maxLength: 40 }, maxItems: 20, optional: true },
  }),
  async execute(input, ctx) {
    const order = ctx.workbench.reorder(input.mode, input.topics ?? []);
    ctx.workbench.log('reorder_cards', `Reordered ${order.length} cards (${input.mode})`);
    return { order };
  },
};

/* -------------------------------- registry -------------------------------- */

export const TOOLS: ToolDefinition<any, any>[] = [
  createDeck,
  updateDeck,
  createFlashcard,
  createFlashcards,
  updateFlashcard,
  deleteFlashcard,
  addCardsToDeck,
  analyzeImage,
  extractVocabulary,
  enrichWord,
  generateExample,
  generateCollocations,
  generateQuiz,
  generateReviewQuestion,
  validateFlashcard,
  findDuplicates,
  classifyDifficulty,
  classifyIeltsRelevance,
  groupCards,
  reorderCards,
];

export const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition<any, any> | undefined {
  return TOOL_MAP.get(name);
}

export function describeTools(): ToolDescriptor[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    category: tool.category,
    inputSchema: {
      type: 'object',
      properties: tool.input.jsonSchema.properties ?? {},
      required: tool.input.jsonSchema.required ?? [],
    },
    intelligent: tool.intelligent,
  }));
}

export interface ToolRunResult<O> {
  ok: boolean;
  name: string;
  output?: O;
  error?: string;
}

/** Validate input, run the tool, and never let a tool failure escape. */
export async function runTool<O = unknown>(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolRunResult<O>> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, name, error: `Unknown tool "${name}"` };
  }
  const parsed = tool.input.zod.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return { ok: false, name, error: `Invalid arguments for ${name}: ${detail}` };
  }
  try {
    const output = (await tool.execute(parsed.data, ctx)) as O;
    return { ok: true, name, output };
  } catch (error) {
    return { ok: false, name, error: error instanceof Error ? error.message : String(error) };
  }
}
