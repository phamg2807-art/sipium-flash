/**
 * Shared request schemas. Used by the API (validation) and by the typed client
 * (so the frontend can build payloads that the server will accept).
 */
import { z } from 'zod';

export const ownerKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid installation key');

export const uuidSchema = z.string().uuid();

export const learningModeSchema = z.enum([
  'ielts',
  'academic',
  'general',
  'school',
  'exam',
  'custom',
]);

export const ieltsBandSchema = z.enum(['5.5', '6.0', '6.5', '7.0', '7.5', '8.0+']);
export const ieltsSkillSchema = z.enum([
  'writing',
  'speaking',
  'reading',
  'listening',
  'vocabulary',
]);

export const generationOptionsSchema = z.object({
  mode: learningModeSchema.default('general'),
  cardCount: z.number().int().min(1).max(80).default(20),
  difficulty: z.number().int().min(1).max(5).default(3),
  includeVietnamese: z.boolean().default(true),
  englishOnly: z.boolean().default(false),
  includeExamples: z.boolean().default(true),
  includeCollocations: z.boolean().default(true),
  includePronunciation: z.boolean().default(true),
  includeSynonyms: z.boolean().default(true),
  band: z.union([ieltsBandSchema, z.literal('')]).default(''),
  skill: z.union([ieltsSkillSchema, z.literal('')]).default(''),
  topic: z.string().max(120).default(''),
  customInstruction: z.string().max(2000).default(''),
});

export const imagePayloadSchema = z.object({
  data: z.string().min(16).max(12_000_000),
  mimeType: z
    .string()
    .max(64)
    .refine(
      (v) => /^image\/(png|jpeg|jpg|webp|gif|bmp)$/i.test(v),
      'Unsupported image type',
    ),
  name: z.string().max(200).optional(),
});

export const sourceMaterialSchema = z.object({
  text: z.string().max(60_000).default(''),
  images: z.array(imagePayloadSchema).max(6).default([]),
});

export const planStepSchema = z.object({
  id: z.string().max(64).default(''),
  title: z.string().max(200),
  detail: z.string().max(600).default(''),
  kind: z
    .enum([
      'analyze',
      'extract',
      'filter',
      'prioritize',
      'group',
      'translate',
      'examples',
      'collocations',
      'calibrate',
      'build',
      'validate',
      'custom',
    ])
    .default('custom'),
});

export const planDocumentSchema = z.object({
  id: z.string().max(64).default(''),
  title: z.string().max(200).default('Study plan'),
  summary: z.string().max(1200).default(''),
  steps: z.array(planStepSchema).max(30).default([]),
  estimates: z
    .object({
      cards: z.number().int().min(1).max(80).default(20),
      topicGroups: z.array(z.string().max(80)).max(30).default([]),
      difficulty: z.string().max(80).default('Intermediate'),
      focus: z.string().max(200).default(''),
    })
    .default({ cards: 20, topicGroups: [], difficulty: 'Intermediate', focus: '' }),
  outline: z.string().max(8000).default(''),
  offline: z.boolean().default(false),
  warnings: z.array(z.string().max(300)).max(10).default([]),
});

export const planRequestSchema = z.object({
  ownerKey: ownerKeySchema,
  prompt: z.string().max(8000).default(''),
  source: sourceMaterialSchema,
  options: generationOptionsSchema.partial().default({}),
});

export const buildRequestSchema = z.object({
  ownerKey: ownerKeySchema,
  plan: planDocumentSchema,
  source: sourceMaterialSchema,
  options: generationOptionsSchema.partial().default({}),
  /** Optional: build into an existing local deck. */
  deckId: uuidSchema.optional(),
  /** Optional: server-side deck id (deck was already persisted). */
  serverDeckId: uuidSchema.optional(),
  title: z.string().max(200).optional(),
});

export const deckUpsertSchema = z.object({
  ownerKey: ownerKeySchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  language: z.string().min(2).max(16).default('en'),
  source: z.string().max(32).default('manual'),
  topic: z.string().max(120).default(''),
  difficulty: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().max(40)).max(20).default([]),
  learningMode: learningModeSchema.default('general'),
  forkOf: uuidSchema.nullable().optional(),
});

export const cardInputSchema = z.object({
  id: uuidSchema.optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  term: z.string().min(1).max(200),
  definition: z.string().max(2000).default(''),
  vietnameseMeaning: z.string().max(2000).default(''),
  partOfSpeech: z.string().max(64).default(''),
  pronunciation: z.string().max(200).default(''),
  exampleSentences: z.array(z.string().max(600)).max(10).default([]),
  collocations: z.array(z.string().max(200)).max(20).default([]),
  synonyms: z.array(z.string().max(120)).max(20).default([]),
  antonyms: z.array(z.string().max(120)).max(20).default([]),
  relatedWords: z.array(z.string().max(120)).max(20).default([]),
  topics: z.array(z.string().max(80)).max(20).default([]),
  difficulty: z.number().int().min(1).max(5).default(3),
  ieltsRelevance: z.number().int().min(1).max(5).default(3),
  source: z.enum(['ai', 'manual', 'import', 'image', 'fork', 'offline']).default('manual'),
});

export const deckCardsPutSchema = z.object({
  ownerKey: ownerKeySchema,
  cards: z.array(cardInputSchema).max(500),
});

export const publishSchema = z.object({
  ownerKey: ownerKeySchema,
  title: z.string().min(3).max(200),
  description: z.string().max(2000).default(''),
  topic: z.string().max(120).default(''),
  difficulty: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().max(40)).max(20).default([]),
  language: z.string().min(2).max(16).default('en'),
});

export const reviewSchema = z.object({
  ownerKey: ownerKeySchema,
  cardId: uuidSchema,
  deckId: uuidSchema,
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  questionType: z.string().max(48).default('recall-definition'),
  responseMs: z.number().min(0).max(600_000).default(0),
  correct: z.boolean().nullable().default(null),
});

export const cardActionSchema = z.object({
  ownerKey: ownerKeySchema,
  action: z.enum([
    'improve',
    'explain',
    'add-example',
    'add-collocations',
    'simplify',
    'ielts-focus',
    'vietnamese',
    'quiz',
    'related-words',
    'pronunciation',
  ]),
  card: cardInputSchema,
  context: z
    .object({
      band: z.union([ieltsBandSchema, z.literal('')]).default(''),
      topic: z.string().max(120).default(''),
    })
    .default({ band: '', topic: '' }),
});

export const analyzeImageSchema = z.object({
  ownerKey: ownerKeySchema,
  image: imagePayloadSchema,
  intent: z.string().max(1000).default(''),
  options: generationOptionsSchema.partial().default({}),
});

export const curiositySchema = z.object({
  ownerKey: ownerKeySchema,
  card: cardInputSchema,
  contrastWith: z.string().max(120).optional(),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;
export type BuildRequest = z.infer<typeof buildRequestSchema>;
export type DeckUpsert = z.infer<typeof deckUpsertSchema>;
export type CardInput = z.infer<typeof cardInputSchema>;
export type PublishInput = z.infer<typeof publishSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type CardActionInput = z.infer<typeof cardActionSchema>;
export type AnalyzeImageInput = z.infer<typeof analyzeImageSchema>;
