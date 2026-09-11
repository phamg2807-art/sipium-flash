import { randomUUID } from 'node:crypto';
import type { CardInput } from '@shared/schema';
import type { Flashcard, LearningMode } from '@shared/types';

export type WorkbenchCard = CardInput & { id: string; needsEnrichment?: boolean };

export interface WorkbenchDeck {
  title: string;
  description: string;
  topic: string;
  tags: string[];
  language: string;
  difficulty: number;
  learningMode: LearningMode;
}

export interface ValidationIssue {
  field: string;
  message: string;
  level: 'error' | 'warning';
}

const LIMITS = {
  term: 80,
  definition: 600,
  vietnamese: 300,
  example: 220,
  collocation: 80,
  listItem: 60,
};

/**
 * The in-memory deck the AI tools build. Nothing here touches the database
 * until the build service persists the finished result.
 */
export class Workbench {
  deck: WorkbenchDeck;
  cards: WorkbenchCard[] = [];
  readonly operations: { tool: string; summary: string; at: string }[] = [];

  constructor(deck?: Partial<WorkbenchDeck>) {
    this.deck = {
      title: 'Untitled deck',
      description: '',
      topic: '',
      tags: [],
      language: 'en',
      difficulty: 3,
      learningMode: 'general',
      ...deck,
    };
  }

  log(tool: string, summary: string) {
    this.operations.push({ tool, summary, at: new Date().toISOString() });
  }

  /* -------------------------------- deck ops ------------------------------ */

  updateDeck(patch: Partial<WorkbenchDeck>) {
    this.deck = { ...this.deck, ...patch };
    return this.deck;
  }

  /* -------------------------------- card ops ------------------------------ */

  addCard(input: CardInput & { id?: string; needsEnrichment?: boolean }): WorkbenchCard {
    const card = cleanCard(input, input.id ?? randomUUID());
    this.cards.push(card);
    this.renumber();
    return card;
  }

  addCards(inputs: Array<CardInput & { id?: string; needsEnrichment?: boolean }>): WorkbenchCard[] {
    return inputs.map((input) => this.addCard(input));
  }

  findCard(id: string): WorkbenchCard | undefined {
    return this.cards.find((card) => card.id === id);
  }

  findByTerm(term: string): WorkbenchCard | undefined {
    const key = term.trim().toLowerCase();
    return this.cards.find((card) => card.term.toLowerCase() === key);
  }

  updateCard(id: string, patch: Partial<WorkbenchCard>): WorkbenchCard | null {
    const index = this.cards.findIndex((card) => card.id === id);
    if (index === -1) return null;
    const updated = cleanCard({ ...this.cards[index], ...patch }, id);
    this.cards[index] = updated;
    return updated;
  }

  deleteCard(id: string): boolean {
    const index = this.cards.findIndex((card) => card.id === id);
    if (index === -1) return false;
    this.cards.splice(index, 1);
    return true;
  }

  /** Guarantee gapless positions matching array order. */
  renumber() {
    this.cards.forEach((card, index) => {
      card.position = index;
    });
  }

  reorder(mode: 'alphabetical' | 'difficulty' | 'ielts-relevance' | 'provided' | 'grouped', topics: string[] = []) {
    switch (mode) {
      case 'alphabetical':
        this.cards.sort((a, b) => a.term.localeCompare(b.term));
        break;
      case 'difficulty':
        this.cards.sort((a, b) => a.difficulty - b.difficulty || a.term.localeCompare(b.term));
        break;
      case 'ielts-relevance':
        this.cards.sort((a, b) => b.ieltsRelevance - a.ieltsRelevance || a.term.localeCompare(b.term));
        break;
      case 'grouped': {
        const rank = (card: WorkbenchCard) => {
          const index = topics.findIndex((topic) => card.topics.includes(topic));
          return index === -1 ? topics.length : index;
        };
        this.cards.sort((a, b) => rank(a) - rank(b) || b.ieltsRelevance - a.ieltsRelevance);
        break;
      }
      case 'provided':
      default:
        break;
    }
    this.renumber();
    return this.cards.map((card) => card.id);
  }

  setOrder(ids: string[]) {
    const byId = new Map(this.cards.map((card) => [card.id, card]));
    const next: WorkbenchCard[] = [];
    for (const id of ids) {
      const card = byId.get(id);
      if (card) {
        next.push(card);
        byId.delete(id);
      }
    }
    for (const card of this.cards) if (byId.has(card.id)) next.push(card);
    this.cards = next;
    this.renumber();
    return this.cards.map((card) => card.id);
  }

  groups(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const card of this.cards) {
      const topic = card.topics[0] ?? 'general';
      out[topic] = out[topic] ?? [];
      out[topic].push(card.term);
    }
    return out;
  }

  /* ------------------------------- duplicates ----------------------------- */

  findDuplicates(): { keep: string; remove: string; term: string }[] {
    const seen = new Map<string, WorkbenchCard>();
    const duplicates: { keep: string; remove: string; term: string }[] = [];
    for (const card of this.cards) {
      const key = card.term.trim().toLowerCase();
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, card);
        continue;
      }
      // Keep whichever card is richer.
      const keep = score(card) > score(existing) ? card : existing;
      const remove = keep === card ? existing : card;
      duplicates.push({ keep: keep.id, remove: remove.id, term: keep.term });
      if (keep === card) seen.set(key, card);
    }
    return duplicates;
  }

  removeDuplicates(): number {
    const duplicates = this.findDuplicates();
    const removals = new Set(duplicates.map((d) => d.remove));
    this.cards = this.cards.filter((card) => !removals.has(card.id));
    this.renumber();
    return removals.size;
  }

  /* ------------------------------- validation ----------------------------- */

  validate(card: WorkbenchCard, options: { requireVietnamese?: boolean } = {}): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const term = card.term.trim();
    if (!term) issues.push({ field: 'term', message: 'Missing term', level: 'error' });
    if (term.length > LIMITS.term) issues.push({ field: 'term', message: 'Term is too long', level: 'error' });
    if (!card.definition.trim()) {
      issues.push({ field: 'definition', message: 'Missing English definition', level: 'error' });
    } else if (card.definition.trim().toLowerCase() === term.toLowerCase()) {
      issues.push({ field: 'definition', message: 'Definition repeats the term', level: 'error' });
    }
    if (options.requireVietnamese && !card.vietnameseMeaning.trim() && !card.needsEnrichment) {
      issues.push({ field: 'vietnameseMeaning', message: 'Missing Vietnamese meaning', level: 'warning' });
    }
    if (card.exampleSentences.length === 0) {
      issues.push({ field: 'exampleSentences', message: 'No example sentence', level: 'warning' });
    }
    if (card.collocations.length === 0) {
      issues.push({ field: 'collocations', message: 'No collocations', level: 'warning' });
    }
    if (card.difficulty < 1 || card.difficulty > 5) {
      issues.push({ field: 'difficulty', message: 'Difficulty out of range', level: 'error' });
    }
    return issues;
  }

  toFlashcards(deckId: string): Flashcard[] {
    this.renumber();
    const now = new Date().toISOString();
    return this.cards.map((card) => ({
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
      createdAt: now,
      updatedAt: now,
    }));
  }
}

function cleanCard(input: Partial<WorkbenchCard>, id: string): WorkbenchCard {
  return {
    id,
    position: typeof input.position === 'number' ? input.position : 0,
    term: String(input.term ?? '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.term),
    definition: String(input.definition ?? '').trim().slice(0, LIMITS.definition),
    vietnameseMeaning: String(input.vietnameseMeaning ?? '').trim().slice(0, LIMITS.vietnamese),
    partOfSpeech: String(input.partOfSpeech ?? '').trim().slice(0, 32),
    pronunciation: String(input.pronunciation ?? '').trim().slice(0, 120),
    exampleSentences: cleanList(input.exampleSentences, 6, LIMITS.example),
    collocations: cleanList(input.collocations, 8, LIMITS.collocation),
    synonyms: cleanList(input.synonyms, 8, LIMITS.listItem),
    antonyms: cleanList(input.antonyms, 8, LIMITS.listItem),
    relatedWords: cleanList(input.relatedWords, 8, LIMITS.listItem),
    topics: cleanList(input.topics, 6, 40).map((t) => t.toLowerCase()),
    difficulty: clampScore(input.difficulty, 3),
    ieltsRelevance: clampScore(input.ieltsRelevance, 3),
    source: input.source ?? 'ai',
    needsEnrichment: input.needsEnrichment,
  };
}

function cleanList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function clampScore(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function score(card: WorkbenchCard): number {
  return (
    (card.definition ? 2 : 0) +
    (card.vietnameseMeaning ? 2 : 0) +
    card.exampleSentences.length +
    card.collocations.length +
    (card.pronunciation ? 1 : 0)
  );
}
