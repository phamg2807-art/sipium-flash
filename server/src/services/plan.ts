import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GenerationOptions, PlanDocument, PlanStep, SourceMaterial } from '@shared/types';
import { completeJson, isConfigured } from '../ai/gateway';
import { makePlan, OFFLINE_NOTICE } from '../ai/local';
import { logger } from '../logger';

const planSchema = z.object({
  title: z.string().min(3).max(200),
  summary: z.string().max(1200),
  steps: z
    .array(
      z.object({
        title: z.string().min(2).max(140),
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
      }),
    )
    .min(3)
    .max(14),
  estimates: z.object({
    cards: z.number().min(1).max(80),
    topicGroups: z.array(z.string().max(60)).max(12),
    difficulty: z.string().max(60),
    focus: z.string().max(200),
  }),
});

export interface PlanInput {
  prompt: string;
  source: SourceMaterial;
  options: GenerationOptions;
}

export async function createPlan(input: PlanInput): Promise<PlanDocument> {
  const { prompt, source, options } = input;
  const text = source.text ?? '';
  const hasImages = (source.images?.length ?? 0) > 0;

  let local = makePlan({ prompt, text, hasImages, options, limit: options.cardCount });

  if (isConfigured()) {
    try {
      const result = await completeJson({
        task: [
          'Write a short, concrete plan for building this flashcard deck.',
          'The plan is shown to the learner and can be edited before anything is built, so be specific about what will be created.',
          'Between 5 and 12 steps, in the order they will run.',
          'Do not create cards yet — planning only.',
        ].join(' '),
        userPayload: [
          `LEARNER REQUEST: ${prompt || '(no extra instruction)'}`,
          `MODE: ${options.mode}${options.band ? ` · band ${options.band}` : ''}${options.skill ? ` · ${options.skill}` : ''}`,
          `TOPIC: ${options.topic || '(auto)'}`,
          `TARGET CARD COUNT: ${options.cardCount}`,
          `VIETNAMESE GLOSS: ${options.includeVietnamese && !options.englishOnly ? 'yes' : 'no'}`,
          `EXAMPLES: ${options.includeExamples ? 'yes' : 'no'} · COLLOCATIONS: ${options.includeCollocations ? 'yes' : 'no'} · IPA: ${options.includePronunciation ? 'yes' : 'no'}`,
          hasImages ? `IMAGES: ${source.images.length} attached` : '',
          '',
          'MATERIAL:',
          text.slice(0, 12_000) || '(none — generate from the topic and goal)',
        ].join('\n'),
        schema: planSchema,
        shapeHint: {
          title: 'Environment vocabulary — 25 cards',
          summary: 'Extract academic vocabulary, group it by theme and enrich each card for Band 7 writing.',
          steps: [
            { title: 'Extract academically useful vocabulary', detail: 'Ignore function words and trivia.', kind: 'extract' },
            { title: 'Remove duplicates and common words', detail: '', kind: 'filter' },
            { title: 'Group vocabulary by topic', detail: 'Emissions / policy / solutions', kind: 'group' },
            { title: 'Add Vietnamese meanings', detail: '', kind: 'translate' },
            { title: 'Build 25 cards', detail: '', kind: 'build' },
            { title: 'Validate generated cards', detail: '', kind: 'validate' },
          ],
          estimates: { cards: 25, topicGroups: ['emissions', 'policy'], difficulty: 'Intermediate', focus: 'IELTS writing' },
        },
        maxTokens: 1600,
      });

      const value = result.value;
      local = {
        title: value.title,
        summary: value.summary,
        steps: value.steps.map((step) => ({ title: step.title, detail: step.detail, kind: step.kind })),
        topicGroups: value.estimates.topicGroups,
        difficulty: value.estimates.difficulty,
        focus: value.estimates.focus,
      };
      return finalise({ ...local, limit: Math.min(value.estimates.cards, 80), offline: false, warnings: [] });
    } catch (error) {
      logger.warn('plan fell back to offline engine', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return finalise({
    ...local,
    limit: options.cardCount,
    offline: true,
    warnings: isConfigured() ? [] : [OFFLINE_NOTICE],
  });
}

interface PlanDraft {
  title: string;
  summary: string;
  steps: { title: string; detail: string; kind: string }[];
  topicGroups: string[];
  difficulty: string;
  focus: string;
  limit: number;
  offline: boolean;
  warnings: string[];
}

function finalise(draft: PlanDraft): PlanDocument {
  const steps: PlanStep[] = draft.steps.map((step, index) => ({
    id: `step-${index + 1}`,
    title: step.title,
    detail: step.detail,
    kind: (step.kind as PlanStep['kind']) || 'custom',
  }));

  const outline = steps.map((step, index) => `${index + 1}. ${step.title}${step.detail ? ` — ${step.detail}` : ''}`).join('\n');

  return {
    id: randomUUID(),
    title: draft.title,
    summary: draft.summary,
    steps,
    estimates: {
      cards: draft.limit,
      topicGroups: draft.topicGroups,
      difficulty: draft.difficulty,
      focus: draft.focus,
    },
    outline,
    offline: draft.offline,
    warnings: draft.warnings,
  };
}

/**
 * Rebuild a plan object after the learner edits the outline text.
 * Unrecognised lines keep their text and are treated as custom steps.
 */
export function parsePlanOutline(plan: PlanDocument): PlanDocument {
  const lines = (plan.outline || '')
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]?\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return plan;

  const steps: PlanStep[] = lines.slice(0, 14).map((line, index) => {
    const [title, ...rest] = line.split('—');
    const detail = rest.join('—').trim();
    const known = plan.steps.find(
      (step) => step.title.toLowerCase() === title.trim().toLowerCase(),
    );
    return {
      id: `step-${index + 1}`,
      title: title.trim().slice(0, 200) || `Step ${index + 1}`,
      detail: detail.slice(0, 600),
      kind: known?.kind ?? inferKind(title),
    };
  });

  return { ...plan, steps };
}

function inferKind(title: string): PlanStep['kind'] {
  const value = title.toLowerCase();
  if (value.includes('analy')) return 'analyze';
  if (value.includes('extract') || value.includes('vocabulary')) return 'extract';
  if (value.includes('duplicate') || value.includes('common') || value.includes('remov')) return 'filter';
  if (value.includes('prioritis') || value.includes('prioritiz') || value.includes('rank')) return 'prioritize';
  if (value.includes('group') || value.includes('topic')) return 'group';
  if (value.includes('vietnamese') || value.includes('translat')) return 'translate';
  if (value.includes('example')) return 'examples';
  if (value.includes('collocation')) return 'collocations';
  if (value.includes('difficulty') || value.includes('calibrat') || value.includes('relevance')) return 'calibrate';
  if (value.includes('build') || value.includes('card')) return 'build';
  if (value.includes('valid') || value.includes('check')) return 'validate';
  return 'custom';
}
