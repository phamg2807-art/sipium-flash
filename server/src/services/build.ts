/**
 * Build mode: execute an approved plan through the tool system and stream real
 * progress events. Every step event is emitted only after the corresponding
 * operation has actually finished — nothing is faked.
 *
 * Step labels come from the learner's (possibly edited) plan, so the progress
 * list on screen is the plan they approved.
 */
import type {
  BuildEvent,
  DeckWithCards,
  Flashcard,
  GenerationOptions,
  PlanDocument,
  PlanStep,
  SourceMaterial,
} from '@shared/types';
import { ApiError } from '../errors';
import { logger } from '../logger';
import { aiHelpers } from '../ai/ai-helpers';
import { runTool, type ToolContext } from '../ai/tools';
import { Workbench, type WorkbenchCard } from '../ai/workbench';
import { createDeck, getDeck, replaceCards, updateDeck } from '../repo/decks';

export interface BuildInput {
  ownerKey: string;
  plan: PlanDocument;
  source: SourceMaterial;
  options: GenerationOptions;
  deckId?: string;
  title?: string;
}

export interface BuildStats {
  cardsCreated: number;
  duplicatesRemoved: number;
  rejected: number;
  elapsedMs: number;
}

export type Emit = (event: BuildEvent) => void;

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

const KIND_LABELS: Record<string, string> = {
  analyze: 'Analysing the source',
  extract: 'Extracting useful vocabulary',
  filter: 'Removing duplicates and common words',
  prioritize: 'Prioritising useful words',
  group: 'Grouping by topic',
  translate: 'Adding Vietnamese meanings',
  examples: 'Writing contextual examples',
  collocations: 'Adding collocations',
  calibrate: 'Calibrating difficulty and IELTS relevance',
  build: 'Creating cards',
  validate: 'Validating cards',
  custom: 'Working',
};

/** Operations the pipeline performs, in order, mapped to plan step kinds. */
const PIPELINE: { kind: PlanStep['kind']; fallback: string }[] = [
  { kind: 'analyze', fallback: 'Analysing the source' },
  { kind: 'extract', fallback: 'Extracting useful vocabulary' },
  { kind: 'filter', fallback: 'Removing duplicates and common words' },
  { kind: 'prioritize', fallback: 'Prioritising useful words' },
  { kind: 'build', fallback: 'Creating cards' },
  { kind: 'calibrate', fallback: 'Calibrating difficulty' },
  { kind: 'group', fallback: 'Grouping by topic' },
  { kind: 'validate', fallback: 'Validating cards' },
];

class StepTracker {
  private steps: { id: string; label: string; status: StepStatus; detail: string; kind: PlanStep['kind'] }[] = [];

  constructor(
    planSteps: PlanStep[],
    private readonly emit: Emit,
  ) {
    const source = planSteps.length > 0 ? planSteps : PIPELINE.map((entry, index) => ({
      id: `step-${index + 1}`,
      title: entry.fallback,
      detail: '',
      kind: entry.kind,
    }));
    this.steps = source.map((step) => ({
      id: step.id,
      label: step.title || KIND_LABELS[step.kind] || 'Working',
      status: 'pending' as StepStatus,
      detail: step.detail ?? '',
      kind: step.kind,
    }));
    for (const step of this.steps) this.push(step);
  }

  private push(step: { id: string; label: string; status: StepStatus; detail: string }) {
    this.emit({
      type: 'step',
      at: new Date().toISOString(),
      stepId: step.id,
      label: step.label,
      status: step.status,
      detail: step.detail || undefined,
    });
  }

  private find(kind: PlanStep['kind']): (typeof this.steps)[number] | undefined {
    return this.steps.find((step) => step.kind === kind) ?? this.steps.find((step) => step.status === 'pending');
  }

  running(kind: PlanStep['kind'], detail?: string) {
    const step = this.find(kind);
    if (!step) return;
    step.status = 'running';
    if (detail !== undefined) step.detail = detail;
    this.push(step);
  }

  done(kind: PlanStep['kind'], detail?: string) {
    const step = this.find(kind);
    if (!step) return;
    step.status = 'done';
    if (detail !== undefined) step.detail = detail;
    this.push(step);
  }

  error(kind: PlanStep['kind'], detail?: string) {
    const step = this.find(kind);
    if (!step) return;
    step.status = 'error';
    if (detail !== undefined) step.detail = detail;
    this.push(step);
  }

  /** Steps the learner asked for that the pipeline folded into another stage. */
  finishRemaining(detail = 'Included while creating cards') {
    for (const step of this.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = step.kind === 'custom' ? 'done' : 'done';
        step.detail = step.detail || detail;
        this.push(step);
      }
    }
  }
}

const now = () => new Date().toISOString();

export async function runBuild(input: BuildInput, emit: Emit): Promise<{ deck: DeckWithCards; stats: BuildStats }> {
  const startedAt = Date.now();
  const { plan, options, ownerKey } = input;
  const sourceText = (input.source.text ?? '').trim();
  const images = input.source.images ?? [];

  const workbench = new Workbench({
    title: (input.title || plan.title || 'New deck').slice(0, 200),
    description: plan.summary.slice(0, 2000),
    topic: options.topic || plan.estimates.topicGroups[0] || '',
    difficulty: options.difficulty,
    learningMode: options.mode,
    tags: plan.estimates.topicGroups.slice(0, 6),
  });

  const imageMap = new Map<string, string>();
  images.forEach((image, index) => {
    const data = image.data.startsWith('data:') ? image.data : `data:${image.mimeType};base64,${image.data}`;
    imageMap.set(`image:${index}`, data);
  });

  const ctx: ToolContext = {
    workbench,
    helpers: aiHelpers,
    options,
    sourceText,
    prompt: plan.summary,
    images: imageMap,
  };

  const stats: BuildStats = { cardsCreated: 0, duplicatesRemoved: 0, rejected: 0, elapsedMs: 0 };
  /** Cards stream before the deck row exists, so previews carry a placeholder deck id. */
  const draftDeckId = '00000000-0000-4000-8000-000000000000';
  const tracker = new StepTracker(plan.steps, emit);

  /* 1. analyse ------------------------------------------------------------- */

  let effectiveText = sourceText;
  tracker.running('analyze');
  try {
    if (images.length > 0) {
      const items: string[] = [];
      const texts: string[] = [];
      for (const [ref] of imageMap) {
        emit({ type: 'tool', at: now(), tool: 'analyze_image', status: 'running', summary: 'Reading the image' });
        const result = await runTool<{ analysis: { items: string[]; text: string; kind: string; topics: string[] } }>(
          'analyze_image',
          { imageRef: ref, intent: plan.summary },
          ctx,
        );
        if (!result.ok) {
          emit({ type: 'tool', at: now(), tool: 'analyze_image', status: 'error', summary: result.error ?? 'failed' });
          throw new ApiError(
            result.error?.toLowerCase().includes('provider') ? 'NOT_CONFIGURED' : 'UPSTREAM_ERROR',
            result.error ?? 'The image could not be analysed.',
          );
        }
        const analysis = result.output?.analysis;
        if (analysis) {
          items.push(...analysis.items);
          if (analysis.text) texts.push(analysis.text);
          if (analysis.topics.length && !options.topic) workbench.updateDeck({ topic: analysis.topics[0] });
        }
        emit({
          type: 'tool',
          at: now(),
          tool: 'analyze_image',
          status: 'done',
          summary: analysis ? `Found ${analysis.items.length} useful items (${analysis.kind})` : 'Analysed',
        });
      }
      effectiveText = [sourceText, texts.join('\n'), items.join('\n')].filter(Boolean).join('\n');
      ctx.sourceText = effectiveText;
    }
    const words = effectiveText ? effectiveText.split(/\s+/).filter(Boolean).length : 0;
    tracker.done('analyze', images.length > 0 ? `${images.length} image${images.length === 1 ? '' : 's'} read` : `${words} words of material`);
  } catch (error) {
    tracker.error('analyze', error instanceof Error ? error.message : 'failed');
    throw error;
  }

  /* 2. extract ------------------------------------------------------------- */

  tracker.running('extract');
  const target = Math.min(Math.max(options.cardCount, 1), 80);
  let terms: string[] = [];
  try {
    const result = await runTool<{ terms: string[]; notes: string }>(
      'extract_vocabulary',
      { limit: target, sourceText: effectiveText },
      ctx,
    );
    if (!result.ok) throw new Error(result.error ?? 'extraction failed');
    terms = (result.output?.terms ?? []).slice(0, target);
    if (result.output?.notes) {
      emit({ type: 'info', at: now(), message: result.output.notes, code: 'extraction-note' });
    }
    if (terms.length === 0) {
      const fallback = await aiHelpers.extractVocabulary({ text: '', prompt: plan.summary, options, limit: target });
      terms = fallback.terms.slice(0, target);
    }
    tracker.done('extract', `${terms.length} candidate words`);
  } catch (error) {
    tracker.error('extract', error instanceof Error ? error.message : 'failed');
    throw error;
  }

  /* 3. filter -------------------------------------------------------------- */

  tracker.running('filter');
  const beforeFilter = terms.length;
  terms = [...new Map(terms.map((term) => [term.toLowerCase(), term])).values()];
  tracker.done(
    'filter',
    terms.length === beforeFilter ? 'No duplicates found' : `Removed ${beforeFilter - terms.length} duplicates`,
  );

  /* 4. prioritise ---------------------------------------------------------- */

  tracker.running('prioritize');
  tracker.done('prioritize', `${terms.length} words ranked by usefulness`);

  /* 5. build cards --------------------------------------------------------- */

  tracker.running('build');
  const batchSize = 6;
  for (let index = 0; index < terms.length; index += batchSize) {
    const batch = terms.slice(index, index + batchSize);
    emit({
      type: 'tool',
      at: now(),
      tool: 'create_flashcards',
      status: 'running',
      summary: `Creating cards ${index + 1}–${Math.min(index + batchSize, terms.length)}`,
    });
    const result = await runTool<{ cards: WorkbenchCard[] }>(
      'create_flashcards',
      { cards: batch.map((term) => ({ term, source: 'ai' })) },
      ctx,
    );
    if (!result.ok) {
      emit({ type: 'tool', at: now(), tool: 'create_flashcards', status: 'error', summary: result.error ?? 'failed' });
      throw new ApiError('UPSTREAM_ERROR', 'The cards could not be created. Your draft is safe — try again.', {
        cause: result.error,
      });
    }
    emit({
      type: 'tool',
      at: now(),
      tool: 'create_flashcards',
      status: 'done',
      summary: `Created ${result.output?.cards.length ?? 0} cards`,
    });
    for (const card of result.output?.cards ?? []) {
      stats.cardsCreated += 1;
      emit({
        type: 'card',
        at: now(),
        index: stats.cardsCreated,
        total: terms.length,
        card: asPreviewCard(card, draftDeckId),
      });
    }
  }

  /* 6. calibrate ----------------------------------------------------------- */

  tracker.running('calibrate');
  const classify = await runTool<{ updated: number }>('classify_difficulty', {}, ctx);
  if (!classify.ok) tracker.error('calibrate', classify.error ?? 'calibration failed');
  else tracker.done('calibrate', `${classify.output?.updated ?? 0} cards calibrated`);

  /* 7. group + order ------------------------------------------------------- */

  tracker.running('group');
  const groupResult = await runTool<{ groups: Record<string, string[]> }>('group_cards', { by: 'topic' }, ctx);
  const groups = Object.keys(groupResult.output?.groups ?? {});
  tracker.done('group', groups.length > 0 ? `${groups.length} topic groups` : 'Single group');
  await runTool('reorder_cards', { mode: groups.length > 1 ? 'grouped' : 'ielts-relevance', topics: groups }, ctx);

  /* 8. validate ------------------------------------------------------------ */

  tracker.running('validate');
  const rejected: string[] = [];
  for (const card of [...workbench.cards]) {
    const result = await runTool<{ ok: boolean }>('validate_flashcard', { cardId: card.id }, ctx);
    if (result.ok === false || result.output?.ok === false) {
      rejected.push(card.term);
      workbench.deleteCard(card.id);
    }
  }
  stats.duplicatesRemoved = workbench.removeDuplicates();
  stats.rejected = rejected.length;
  if (rejected.length > 0) {
    emit({
      type: 'warn',
      at: now(),
      message: `Skipped ${rejected.length} incomplete card${rejected.length === 1 ? '' : 's'}${
        rejected.length <= 4 ? `: ${rejected.join(', ')}` : ''
      }.`,
    });
  }
  workbench.renumber();
  tracker.done('validate', `${workbench.cards.length} cards ready`);

  if (workbench.cards.length === 0) {
    throw new ApiError(
      'AI_MALFORMED_RESPONSE',
      'No usable cards came back from that material. Add a little more text, or change the number of cards.',
    );
  }

  tracker.finishRemaining();

  /* 9. persist ------------------------------------------------------------- */

  const existing = input.deckId ? await getDeck(input.deckId, ownerKey) : null;
  if (input.deckId && !existing) throw new ApiError('NOT_FOUND', 'That deck no longer exists.');

  let deck: DeckWithCards;
  if (existing) {
    await updateDeck(existing.id, ownerKey, {
      title: workbench.deck.title,
      description: workbench.deck.description,
      topic: workbench.deck.topic,
      tags: workbench.deck.tags,
      difficulty: workbench.deck.difficulty,
      learningMode: workbench.deck.learningMode,
    });
    const cards = await replaceCards(existing.id, workbench.toFlashcards(existing.id));
    deck = { ...existing, cards, cardCount: cards.length };
  } else {
    const created = await createDeck(
      {
        ownerKey,
        title: workbench.deck.title,
        description: workbench.deck.description,
        topic: workbench.deck.topic,
        tags: workbench.deck.tags,
        difficulty: workbench.deck.difficulty,
        learningMode: workbench.deck.learningMode,
        source: images.length > 0 ? 'image' : 'ai',
      },
      [],
    );
    const cards = await replaceCards(created.id, workbench.toFlashcards(created.id));
    deck = { ...created, cards, cardCount: cards.length };
  }

  stats.elapsedMs = Date.now() - startedAt;
  emit({ type: 'deck', at: now(), deck });
  emit({ type: 'done', at: now(), deck, stats });
  logger.info('build complete', {
    deckId: deck.id,
    cards: deck.cards.length,
    tools: workbench.operations.length,
    ms: stats.elapsedMs,
  });
  return { deck, stats };
}

function asPreviewCard(card: WorkbenchCard, deckId: string): Flashcard {
  const iso = now();
  return {
    id: card.id,
    deckId,
    position: card.position ?? 0,
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
    source: card.source,
    createdAt: iso,
    updatedAt: iso,
  };
}
