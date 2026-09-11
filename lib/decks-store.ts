'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardInput } from '@/shared/schema';
import type { Deck, DeckWithCards, Flashcard } from '@/shared/types';
import { api, isTransient } from './api';
import { idbAll, idbDelete, idbGet, idbPut } from './idb';
import { getInstallKey } from './session';

export type SyncState = 'saved' | 'saving' | 'pending' | 'error' | 'offline';

export interface LocalDeck {
  deck: Deck;
  cards: Flashcard[];
  updatedAt: number;
  sync: SyncState;
  /** True while the deck exists only on this device. */
  localOnly: boolean;
  error?: string;
}

export interface DeckSummary extends Deck {
  /** Present when a full copy is cached locally. */
  local?: LocalDeck;
}

/* ------------------------------- internals -------------------------------- */

const listeners = new Set<() => void>();
let records = new Map<string, LocalDeck>();
let serverDecks: Deck[] = [];
let loaded = false;
let syncing = false;
let online = true;
let lastError: string | null = null;
let lastSyncedAt = 0;

function emit() {
  for (const listener of listeners) listener();
}

function setRecord(record: LocalDeck) {
  records.set(record.deck.id, record);
  void idbPut('decks', record.deck.id, record);
  emit();
  scheduleSync();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function toNowIso(): string {
  return new Date().toISOString();
}

function makeLocalDeck(input: {
  id?: string;
  title: string;
  description?: string;
  topic?: string;
  tags?: string[];
  difficulty?: number;
  learningMode?: Deck['learningMode'];
  source?: string;
  cards?: Flashcard[];
}): LocalDeck {
  const now = toNowIso();
  const id = input.id ?? newId();
  const cards = (input.cards ?? []).map((card, index) => ({ ...card, deckId: id, position: index }));
  return {
    deck: {
      id,
      ownerKey: getInstallKey(),
      title: input.title,
      description: input.description ?? '',
      language: 'en',
      source: input.source ?? 'manual',
      topic: input.topic ?? '',
      difficulty: input.difficulty ?? 3,
      tags: input.tags ?? [],
      cardCount: cards.length,
      isPublic: false,
      publicSlug: null,
      publishedAt: null,
      forkOf: null,
      copies: 0,
      studies: 0,
      learningMode: input.learningMode ?? 'general',
      createdAt: now,
      updatedAt: now,
    },
    cards,
    updatedAt: Date.now(),
    sync: 'pending',
    localOnly: true,
  };
}

/* --------------------------------- sync ----------------------------------- */

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(delay = 700) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncNow();
  }, delay);
}

export async function syncNow(): Promise<void> {
  if (syncing || typeof window === 'undefined') return;
  syncing = true;
  try {
    const dirty = [...records.values()].filter((record) => record.sync === 'pending' || record.sync === 'error');
    for (const record of dirty) {
      // Optimistic UI: mark as saving only while a request is actually in flight.
      records.set(record.deck.id, { ...record, sync: 'saving' });
      emit();
      try {
        if (record.localOnly) {
          const created = await api.createDeck({
            title: record.deck.title,
            description: record.deck.description,
            topic: record.deck.topic,
            tags: record.deck.tags,
            difficulty: record.deck.difficulty,
            learningMode: record.deck.learningMode,
            source: record.deck.source,
          });
          const cards = await api.putCards(created.id, record.cards as CardInput[]);
          const next: LocalDeck = {
            ...record,
            deck: { ...created, cardCount: cards.cards.length },
            cards: cards.cards,
            sync: 'saved',
            localOnly: false,
            error: undefined,
            updatedAt: Date.now(),
          };
          records.delete(record.deck.id);
          records.set(created.id, next);
          await idbPut('decks', created.id, next);
          if (created.id !== record.deck.id) await idbDelete('decks', record.deck.id);
          emit();
        } else {
          await api.updateDeck(record.deck.id, {
            title: record.deck.title,
            description: record.deck.description,
            topic: record.deck.topic,
            tags: record.deck.tags,
            difficulty: record.deck.difficulty,
            learningMode: record.deck.learningMode,
          });
          const cards = await api.putCards(record.deck.id, record.cards as CardInput[]);
          const next: LocalDeck = {
            ...record,
            deck: { ...record.deck, cardCount: cards.cards.length, updatedAt: toNowIso() },
            cards: cards.cards,
            sync: 'saved',
            error: undefined,
            updatedAt: Date.now(),
          };
          records.set(record.deck.id, next);
          await idbPut('decks', record.deck.id, next);
          emit();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        const failed: LocalDeck = {
          ...record,
          sync: isTransient(error) ? 'offline' : 'error',
          error: message,
        };
        records.set(record.deck.id, failed);
        await idbPut('decks', record.deck.id, failed);
        lastError = message;
        online = !isTransient(error);
        emit();
        break;
      }
    }

    try {
      serverDecks = await api.listDecks(50);
      online = true;
      lastSyncedAt = Date.now();
      lastError = null;
    } catch (error) {
      online = false;
    }
    emit();
  } finally {
    syncing = false;
  }
}

/* ------------------------------- hydration -------------------------------- */

export async function hydrate(): Promise<void> {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;

  const stored = await idbAll<LocalDeck>('decks');
  for (const entry of stored) {
    if (entry?.value?.deck?.id) records.set(entry.value.deck.id, entry.value);
  }
  emit();

  try {
    serverDecks = await api.listDecks(50);
    online = true;
    lastSyncedAt = Date.now();
  } catch {
    online = false;
  }
  emit();

  // Push anything left over from a previous session.
  if ([...records.values()].some((record) => record.sync !== 'saved')) scheduleSync(400);
}

/* --------------------------------- hooks ---------------------------------- */

export interface DeckStoreValue {
  /** Merged view: local copies where available, server metadata otherwise. */
  decks: DeckSummary[];
  ready: boolean;
  online: boolean;
  syncing: boolean;
  lastError: string | null;
  lastSyncedAt: number;
  refresh: () => void;
  createDeck: (input: Parameters<typeof makeLocalDeck>[0]) => LocalDeck;
  updateDeck: (id: string, patch: Partial<Deck>) => void;
  setCards: (id: string, cards: Flashcard[]) => void;
  addCards: (id: string, cards: Flashcard[]) => void;
  deleteDeck: (id: string) => void;
  getLocal: (id: string) => LocalDeck | undefined;
  importDeck: (deck: Deck, cards: Flashcard[]) => LocalDeck;
}

export function useDeckStore(): DeckStoreValue {
  const [tick, force] = useState(0);

  useEffect(() => {
    const listener = () => force((value) => value + 1);
    listeners.add(listener);
    void hydrate();
    const onOnline = () => {
      online = true;
      scheduleSync(200);
    };
    const onOffline = () => {
      online = false;
      emit();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const decks = useMemo<DeckSummary[]>(() => {
    const byId = new Map<string, DeckSummary>();
    for (const deck of serverDecks) byId.set(deck.id, { ...deck });
    for (const record of records.values()) {
      const existing = byId.get(record.deck.id);
      byId.set(record.deck.id, {
        ...(existing ?? {}),
        ...record.deck,
        cardCount: record.cards.length || record.deck.cardCount,
        local: record,
      });
    }
    return [...byId.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDecks, records, tick]);

  const createDeck = useCallback((input: Parameters<typeof makeLocalDeck>[0]) => {
    const record = makeLocalDeck(input);
    setRecord(record);
    return record;
  }, []);

  const importDeck = useCallback((deck: Deck, cards: Flashcard[]) => {
    const record: LocalDeck = {
      deck,
      cards: cards.map((card, index) => ({ ...card, deckId: deck.id, position: index })),
      updatedAt: Date.now(),
      sync: 'saved',
      localOnly: false,
    };
    records.set(deck.id, record);
    void idbPut('decks', deck.id, record);
    emit();
    return record;
  }, []);

  const updateDeck = useCallback((id: string, patch: Partial<Deck>) => {
    const existing = records.get(id);
    if (!existing) {
      const server = serverDecks.find((deck) => deck.id === id);
      if (!server) return;
      const record: LocalDeck = {
        deck: { ...server, ...patch },
        cards: [],
        updatedAt: Date.now(),
        sync: 'pending',
        localOnly: false,
      };
      setRecord(record);
      return;
    }
    setRecord({
      ...existing,
      deck: { ...existing.deck, ...patch },
      updatedAt: Date.now(),
      sync: 'pending',
    });
  }, []);

  const setCards = useCallback((id: string, cards: Flashcard[]) => {
    const existing = records.get(id);
    const ordered = cards.map((card, index) => ({ ...card, deckId: id, position: index }));
    if (!existing) {
      const server = serverDecks.find((deck) => deck.id === id);
      if (!server) return;
      setRecord({
        deck: { ...server, cardCount: ordered.length },
        cards: ordered,
        updatedAt: Date.now(),
        sync: 'pending',
        localOnly: false,
      });
      return;
    }
    setRecord({
      ...existing,
      deck: { ...existing.deck, cardCount: ordered.length },
      cards: ordered,
      updatedAt: Date.now(),
      sync: 'pending',
    });
  }, []);

  const addCards = useCallback((id: string, cards: Flashcard[]) => {
    const existing = records.get(id);
    if (!existing) {
      setCards(id, cards);
      return;
    }
    setCards(id, [...existing.cards, ...cards]);
  }, [setCards]);

  const deleteDeck = useCallback((id: string) => {
    records.delete(id);
    void idbDelete('decks', id);
    serverDecks = serverDecks.filter((deck) => deck.id !== id);
    emit();
    if (typeof window !== 'undefined' && navigator.onLine) {
      void api.deleteDeck(id).catch(() => undefined);
    }
  }, []);

  const refresh = useCallback(() => {
    loaded = false;
    void hydrate();
    scheduleSync(0);
  }, []);

  const getLocal = useCallback((id: string) => records.get(id), []);

  return {
    decks,
    ready: loaded,
    online,
    syncing,
    lastError,
    lastSyncedAt,
    refresh,
    createDeck,
    updateDeck,
    setCards,
    addCards,
    deleteDeck,
    getLocal,
    importDeck,
  };
}

/** One deck, with a full local copy fetched from the server when needed. */
export function useDeck(id: string | null): {
  deck: Deck | null;
  cards: Flashcard[];
  loading: boolean;
  error: string | null;
  setCards: (cards: Flashcard[]) => void;
  updateDeck: (patch: Partial<Deck>) => void;
  reload: () => void;
  status: SyncState;
} {
  const store = useDeckStore();
  const [remote, setRemote] = useState<DeckWithCards | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const local = store.getLocal(id);
    if (local && local.cards.length > 0) {
      setRemote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getDeck(id)
      .then((result) => {
        if (cancelled) return;
        setRemote(result.deck);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load this deck.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);

  const local = id ? store.getLocal(id) : undefined;
  const deck = local?.deck ?? remote ?? store.decks.find((item) => item.id === id) ?? null;
  const cards = local?.cards ?? remote?.cards ?? [];

  return {
    deck: deck ? ({ ...deck, cardCount: cards.length || deck.cardCount } as Deck) : null,
    cards,
    loading: loading && !local,
    error,
    setCards: (next: Flashcard[]) => id && store.setCards(id, next),
    updateDeck: (patch: Partial<Deck>) => id && store.updateDeck(id, patch),
    reload: () => setVersion((value) => value + 1),
    status: local?.sync ?? 'saved',
  };
}

export function deckToCardsInput(cards: Flashcard[]): CardInput[] {
  return cards.map((card) => ({
    id: card.id,
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
  }));
}

export function makeCardId(): string {
  return newId();
}
