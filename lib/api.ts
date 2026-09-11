/**
 * Typed client for the Replit API. Every call goes through the Next.js proxy at
 * `/api/*` — the browser never talks to the backend directly, and no provider
 * credentials ever reach the client.
 */
import type { CardActionInput, CardInput } from '@/shared/schema';
import type {
  BuildEvent,
  CardAction,
  Curiosity,
  Deck,
  DeckWithCards,
  Flashcard,
  GenerationOptions,
  HealthReport,
  PlanDocument,
  PublicDeck,
  QuestionType,
  Rating,
  SourceMaterial,
  StudyState,
  ToolDescriptor,
} from '@/shared/types';

export class ApiClientError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  details?: unknown;

  constructor(message: string, code: string, status: number, retryable: boolean, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** True when the failure is environmental (backend down, timeout, offline). */
export function isTransient(error: unknown): boolean {
  if (isApiError(error)) return error.retryable || error.status >= 500;
  return error instanceof TypeError;
}

import { getInstallKey } from './session';

let ownerKeyProvider: () => string = () => (typeof window === 'undefined' ? '' : getInstallKey());

export function configureApi(getOwnerKey: () => string) {
  ownerKeyProvider = getOwnerKey;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-sipium-key', ownerKeyProvider());
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, cache: 'no-store' });
  } catch (error) {
    throw new ApiClientError(
      'Cannot reach the server. Your work is saved on this device.',
      'NETWORK',
      0,
      true,
      error,
    );
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const errorBody = (payload as { error?: { message?: string; code?: string; retryable?: boolean; details?: unknown } } | null)
      ?.error;
    throw new ApiClientError(
      errorBody?.message ?? `Request failed (${response.status})`,
      errorBody?.code ?? 'INTERNAL',
      response.status,
      errorBody?.retryable ?? response.status >= 500,
      errorBody?.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const body = (value: unknown) => JSON.stringify(value);

/* --------------------------------- health --------------------------------- */

export const api = {
  health: () => request<HealthReport>('/health'),
  tools: () => request<{ tools: ToolDescriptor[] }>('/ai/tools'),

  /* ----------------------------------- AI ---------------------------------- */

  plan: (input: { prompt: string; source: SourceMaterial; options: GenerationOptions }) =>
    request<{ plan: PlanDocument }>('/ai/plan', { method: 'POST', body: body(input) }).then((r) => r.plan),

  build: async (
    input: { plan: PlanDocument; source: SourceMaterial; options: GenerationOptions; deckId?: string; title?: string },
    onEvent: (event: BuildEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ deck: DeckWithCards; stats: { cardsCreated: number; duplicatesRemoved: number; rejected: number; elapsedMs: number } }> => {
    const response = await fetch('/api/ai/build', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-sipium-key': ownerKeyProvider(),
      },
      body: body(input),
      signal,
      cache: 'no-store',
    });

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      const errorBody = (payload as { error?: { message?: string; code?: string; retryable?: boolean } } | null)?.error;
      throw new ApiClientError(
        errorBody?.message ?? 'The build could not start.',
        errorBody?.code ?? 'INTERNAL',
        response.status,
        errorBody?.retryable ?? true,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { deck: DeckWithCards; stats: { cardsCreated: number; duplicatesRemoved: number; rejected: number; elapsedMs: number } } | null = null;
    let failure: ApiClientError | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let event: BuildEvent;
        try {
          event = JSON.parse(line.slice(6)) as BuildEvent;
        } catch {
          continue;
        }
        if (event.type === 'done') {
          result = { deck: event.deck, stats: event.stats };
        } else if (event.type === 'error') {
          failure = new ApiClientError(event.message, event.code, 502, event.retryable);
        }
        onEvent(event);
      }
    }

    if (failure) throw failure;
    if (!result) throw new ApiClientError('The build ended without a deck.', 'INTERNAL', 502, true);
    return result;
  },

  analyzeImage: (input: { image: SourceMaterial['images'][number]; intent: string; options: Partial<GenerationOptions> }) =>
    request<{ analysis: { kind: string; text: string; items: string[]; topics: string[]; notes: string }; bytes: number }>(
      '/ai/image',
      { method: 'POST', body: body(input) },
    ),

  cardAction: (input: { card: CardInput; action: CardAction; context?: { band?: string; topic?: string } }) =>
    request<{ card: CardInput; note?: string; quiz?: { questionType: string; prompt: string; options: string[]; answerIndex: number; explanation: string } | null }>(
      '/ai/card-action',
      { method: 'POST', body: body(input as unknown as CardActionInput) },
    ),

  curiosity: (input: { card: CardInput; contrastWith?: string }) =>
    request<{ curiosity: Curiosity | null }>('/ai/curiosity', { method: 'POST', body: body(input) }).then(
      (r) => r.curiosity,
    ),

  /* --------------------------------- decks --------------------------------- */

  listDecks: (limit = 50) => request<{ decks: Deck[] }>(`/decks?limit=${limit}`).then((r) => r.decks),

  createDeck: (input: {
    title: string;
    description?: string;
    topic?: string;
    tags?: string[];
    difficulty?: number;
    learningMode?: string;
    source?: string;
  }) => request<{ deck: Deck }>('/decks', { method: 'POST', body: body(input) }).then((r) => r.deck),

  getDeck: (id: string) =>
    request<{ deck: DeckWithCards; readOnly: boolean }>(`/decks/${id}`),

  updateDeck: (id: string, patch: Partial<Pick<Deck, 'title' | 'description' | 'topic' | 'tags' | 'difficulty' | 'learningMode'>>) =>
    request<{ deck: Deck }>(`/decks/${id}`, { method: 'PATCH', body: body(patch) }).then((r) => r.deck),

  deleteDeck: (id: string) => request<{ ok: true }>(`/decks/${id}`, { method: 'DELETE' }),

  putCards: (id: string, cards: CardInput[]) =>
    request<{ cards: Flashcard[]; cardCount: number }>(`/decks/${id}/cards`, {
      method: 'PUT',
      body: body({ cards }),
    }),

  publish: (
    id: string,
    input: { title: string; description: string; topic: string; difficulty: number; tags: string[]; language: string },
  ) =>
    request<{ ok: true; deck: PublicDeck; slug: string | null; message: string }>(
      `/decks/${id}/publish`,
      { method: 'POST', body: body(input) },
    ),

  unpublish: (id: string) => request<{ deck: Deck }>(`/decks/${id}/unpublish`, { method: 'POST' }),

  forkDeck: (id: string) => request<{ deck: DeckWithCards }>(`/decks/${id}/copy`, { method: 'POST' }).then((r) => r.deck),

  markStudied: (id: string) => request<{ ok: true }>(`/decks/${id}/studied`, { method: 'POST' }),

  /* --------------------------------- public -------------------------------- */

  publicDecks: (query: {
    q?: string;
    topic?: string;
    mode?: string;
    sort?: string;
    difficulty?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '' && value !== 'all') params.set(key, String(value));
    }
    return request<{ decks: PublicDeck[]; page: number; pageSize: number; total: number; hasMore: boolean }>(
      `/public/decks?${params.toString()}`,
    );
  },

  publicTopics: () =>
    request<{ topics: { topic: string; count: number }[]; counts: Record<string, number> }>('/public/topics'),

  publicDeckBySlug: (slug: string) => request<{ deck: PublicDeck }>(`/public/decks/${slug}`).then((r) => r.deck),

  copyPublicDeck: (id: string) =>
    request<{ deck: DeckWithCards; message: string }>(`/public/decks/${id}/copy`, { method: 'POST' }),

  /* --------------------------------- study --------------------------------- */

  studyQueue: (deckId: string) =>
    request<{ deck: DeckWithCards; states: StudyState[]; dueCount: number; newCount: number }>(
      `/study/queue?deckId=${deckId}`,
    ),

  review: (input: {
    cardId: string;
    deckId: string;
    rating: Rating;
    questionType: QuestionType;
    responseMs: number;
    correct: boolean | null;
  }) => request<{ state: StudyState }>('/study/review', { method: 'POST', body: body(input) }),

  due: () =>
    request<{
      decks: {
        deckId: string;
        title: string;
        topic: string;
        cardCount: number;
        difficulty: number;
        updatedAt: string;
        isPublic: boolean;
        publicSlug: string | null;
        learningMode: string;
        due: number;
      }[];
      totalDue: number;
      totalCards: number;
    }>('/study/due'),

  weak: (limit = 12) =>
    request<{
      cards: {
        cardId: string;
        deckId: string;
        term: string;
        reviewCount: number;
        incorrectCount: number;
        lapses: number;
        stability: number;
        nextReview: string | null;
        dueIn: string;
      }[];
    }>(`/study/weak?limit=${limit}`).then((r) => r.cards),

  history: (days = 14) => request<{ history: { day: string; reviews: number; correct: number }[] }>(`/study/history?days=${days}`).then((r) => r.history),

  states: (deckId?: string) =>
    request<{ states: StudyState[] }>(`/study/states${deckId ? `?deckId=${deckId}` : ''}`).then((r) => r.states),

  startSession: (deckId: string) =>
    request<{ session: { id: string; startedAt: string } }>('/study/session', {
      method: 'POST',
      body: body({ deckId }),
    }).then((r) => r.session),

  endSession: (
    id: string,
    stats: { reviewed: number; remembered: number; weakTopics: string[]; weakCardIds: string[] },
  ) => request<{ session: unknown }>(`/study/session/${id}`, { method: 'PATCH', body: body(stats) }),
};
