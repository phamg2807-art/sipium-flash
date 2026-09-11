/**
 * The curiosity layer: short, selective asides that give a learner a reason to
 * keep going. Never shown on every card — the study UI chooses when to ask.
 */
import { z } from 'zod';
import type { CardInput } from '@shared/schema';
import type { Curiosity, CuriosityKind } from '@shared/types';
import { completeJson, isConfigured } from '../ai/gateway';
import { makeCuriosity } from '../ai/local';

const schema = z.object({
  kind: z
    .enum([
      'did-you-know',
      'word-connection',
      'common-mistake',
      'ielts-tip',
      'interesting-usage',
      'word-origin',
      'contrast',
    ])
    .default('did-you-know'),
  title: z.string().max(80),
  body: z.string().max(400),
  compareWith: z.string().max(80).optional(),
});

const KINDS: CuriosityKind[] = [
  'did-you-know',
  'word-connection',
  'common-mistake',
  'ielts-tip',
  'interesting-usage',
  'word-origin',
  'contrast',
];

export async function generateCuriosity(
  card: CardInput,
  options: { contrastWith?: string; recentKinds?: CuriosityKind[] } = {},
): Promise<Curiosity | null> {
  if (!isConfigured()) return makeCuriosity(card);

  const avoid = options.recentKinds ?? [];
  const preferred = KINDS.filter((kind) => !avoid.includes(kind));
  const kind = preferred[Math.floor(preferred.length / 2)] ?? 'did-you-know';
  const wantsContrast = Boolean(options.contrastWith) || kind === 'contrast' || kind === 'common-mistake';

  try {
    const result = await completeJson<z.infer<typeof schema>>({
      task: [
        `Write ONE short curiosity note about this word for a Vietnamese learner. Preferred angle: ${kind}.`,
        wantsContrast
          ? options.contrastWith
            ? `Contrast it specifically with "${options.contrastWith}" — explain the difference in usage, not just meaning.`
            : 'Point out a word it is commonly confused with and explain the difference in usage.'
          : '',
        'Rules: 1–2 sentences, genuinely useful, no trivia for its own sake, no exclamation marks.',
        'It must help the learner use the word correctly.',
      ]
        .filter(Boolean)
        .join(' '),
      userPayload: [
        `TERM: ${card.term}`,
        `DEFINITION: ${card.definition}`,
        `VIETNAMESE: ${card.vietnameseMeaning}`,
        `EXAMPLE: ${card.exampleSentences[0] ?? ''}`,
        `SYNONYMS: ${card.synonyms.join(', ')}`,
        `ANTONYMS: ${card.antonyms.join(', ')}`,
        `TOPICS: ${card.topics.join(', ')}`,
      ].join('\n'),
      schema,
      shapeHint: {
        kind: 'contrast',
        title: "Don't confuse with \"alleviate\"",
        body: '"Mitigate" is used for reducing the severity of something bad; "alleviate" is used more for pain or suffering.',
        compareWith: 'alleviate',
      },
      maxTokens: 500,
    });

    return {
      kind: result.value.kind,
      title: result.value.title,
      body: result.value.body,
      compareWith: result.value.compareWith ?? options.contrastWith,
    };
  } catch {
    return makeCuriosity(card);
  }
}
