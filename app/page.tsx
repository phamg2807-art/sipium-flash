'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { DeckCard, DeckSkeleton } from '@/components/deck/DeckCard';
import { Button, EmptyState, Stat } from '@/components/ui/Primitives';
import { api } from '@/lib/api';
import { useDeckStore } from '@/lib/decks-store';
import { relativeTime } from '@/lib/format';
import type { PublicDeck } from '@/shared/types';
import { compressToPayload, imagesFromClipboard } from '@/lib/image';
import { idbPut } from '@/lib/idb';
import { useToast } from '@/components/ui/Toast';

const EXAMPLES = [
  'Make IELTS vocabulary from this article',
  'Turn these 30 words into flashcards',
  'Create Band 7 vocabulary for environment',
  'Cho tôi 30 từ vựng IELTS chủ đề môi trường',
  'Analyze this image and teach me the useful English',
];

interface DueDeck {
  deckId: string;
  title: string;
  topic: string;
  cardCount: number;
  difficulty: number;
  updatedAt: string;
  due: number;
  learningMode: string;
}

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const store = useDeckStore();
  const [prompt, setPrompt] = useState('');
  const [due, setDue] = useState<DueDeck[]>([]);
  const [weak, setWeak] = useState<{ cardId: string; deckId: string; term: string; incorrectCount: number }[]>([]);
  const [popular, setPopular] = useState<PublicDeck[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.due().catch(() => ({ decks: [], totalDue: 0, totalCards: 0 })),
      api.weak(8).catch(() => []),
      api.publicDecks({ sort: 'popular', pageSize: 4 }).catch(() => ({ decks: [] })),
    ]).then(([dueResult, weakResult, publicResult]) => {
      if (cancelled) return;
      setDue(dueResult.decks);
      setWeak(weakResult);
      setPopular(publicResult.decks ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [store.lastSyncedAt]);

  const recent = useMemo(() => store.decks.slice(0, 4), [store.decks]);
  const totalDue = due.reduce((total, item) => total + item.due, 0);

  const startCreating = () => {
    if (!prompt.trim()) {
      router.push('/create');
      return;
    }
    sessionStorage.setItem('sipium.create-draft', JSON.stringify({ prompt, at: Date.now() }));
    router.push('/create');
  };

  return (
    <AppShell>
      <div className="container">
        <section className="hero">
          <h1 className="hero__brand">
            Sipium Flash
          </h1>
          <p className="hero__tag">Learn faster. Remember longer.</p>

          <div className="composer">
            <label className="field__label" htmlFor="home-prompt">
              What do you want to learn?
            </label>
            <textarea
              id="home-prompt"
              className="textarea textarea--hero"
              placeholder="Paste an article, a list of words, an IELTS prompt, or describe what you need…"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) startCreating();
              }}
              onPaste={(event) => {
                const files = imagesFromClipboard(event.clipboardData?.items ?? null);
                if (files.length === 0) return;
                event.preventDefault();
                void (async () => {
                  try {
                    const payloads = await Promise.all(files.slice(0, 6).map((file) => compressToPayload(file, file.name)));
                    await idbPut('drafts', 'create', {
                      prompt,
                      text: '',
                      images: payloads,
                      options: null,
                      plan: null,
                      savedAt: Date.now(),
                    });
                    toast.push({ message: `Added ${payloads.length} image — opening the workspace.`, tone: 'success' });
                    router.push('/create');
                  } catch {
                    toast.push({ message: 'That image could not be read.', tone: 'error' });
                  }
                })();
              }}
            />
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="chip chip--button" onClick={() => setPrompt(example)}>
                  {example}
                </button>
              ))}
            </div>
            <div className="composer__row">
              <Button variant="primary" size="lg" onClick={startCreating}>
                Create with AI
              </Button>
              <Link href="/create" className="btn btn--soft btn--lg">
                Open workspace
              </Link>
              <span className="muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
                Text, word lists, images — anything you are studying.
              </span>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Continue studying</h2>
            <span className="section__sub">{totalDue > 0 ? `${totalDue} cards due` : 'Nothing due right now'}</span>
            {due.length > 0 ? (
              <Link href="/study" className="section__action">
                Study
              </Link>
            ) : null}
          </div>
          {loading ? (
            <div className="deck-grid">
              <DeckSkeleton />
              <DeckSkeleton />
            </div>
          ) : due.length === 0 ? (
            <EmptyState
              compact
              title="No reviews due yet"
              text="Create a deck from something you are learning, then come back here — Sipium Flash will tell you when to review."
              action={
                <Link href="/create" className="btn btn--primary btn--sm">
                  Create your first deck
                </Link>
              }
            />
          ) : (
            <div className="deck-grid">
              {due.slice(0, 4).map((item) => (
                <DeckCard
                  key={item.deckId}
                  href={`/study?deck=${item.deckId}`}
                  deck={{
                    id: item.deckId,
                    ownerKey: '',
                    title: item.title,
                    description: '',
                    language: 'en',
                    source: 'ai',
                    topic: item.topic,
                    difficulty: item.difficulty,
                    tags: [],
                    cardCount: item.cardCount,
                    isPublic: false,
                    publicSlug: null,
                    publishedAt: null,
                    forkOf: null,
                    copies: 0,
                    studies: 0,
                    learningMode: 'general',
                    createdAt: item.updatedAt,
                    updatedAt: item.updatedAt,
                  }}
                  due={item.due}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Recently created</h2>
            <Link href="/library" className="section__action">
              All decks
            </Link>
          </div>
          {!store.ready ? (
            <div className="deck-grid">
              <DeckSkeleton />
              <DeckSkeleton />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              compact
              title="No decks yet"
              text="Create your first deck from words, text, or an image. It is saved on this device and synced automatically."
              action={
                <Link href="/create" className="btn btn--primary btn--sm">
                  Create with AI
                </Link>
              }
            />
          ) : (
            <div className="deck-grid">
              {recent.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  preview={(deck.local?.cards ?? []).slice(0, 4).map((card) => card.term)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Popular public decks</h2>
            <Link href="/explore" className="section__action">
              Explore
            </Link>
          </div>
          {loading ? (
            <div className="deck-grid">
              <DeckSkeleton />
              <DeckSkeleton />
            </div>
          ) : popular.length === 0 ? (
            <EmptyState
              compact
              title="Nothing published yet"
              text="Public decks appear here as soon as learners publish them. Publish one of yours to get the community started."
              action={
                <Link href="/library" className="btn btn--soft btn--sm">
                  Go to your decks
                </Link>
              }
            />
          ) : (
            <div className="deck-grid">
              {popular.map((deck) => (
                <DeckCard
                  key={deck.id}
                  href={`/d/${deck.publicSlug}`}
                  deck={deck}
                  preview={deck.preview.map((item) => item.term)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Weak words</h2>
            <span className="section__sub">Words you have missed more than once</span>
          </div>
          {loading ? (
            <div className="skeleton" style={{ width: 260 }} />
          ) : weak.length === 0 ? (
            <EmptyState
              compact
              title="No weak words yet"
              text="Once you review a few cards, the words you keep missing will show up here with a focused practice set."
            />
          ) : (
            <div className="panel">
              <div className="thumb-strip" style={{ marginBottom: 14 }}>
                {weak.map((item) => (
                  <Link key={item.cardId} href={`/study?deck=${item.deckId}`} className="chip chip--button chip--warn">
                    {item.term} · {item.incorrectCount}×
                  </Link>
                ))}
              </div>
              <div className="stat-row">
                <Stat value={weak.length} label="words to fix" />
                <Stat value={totalDue} label="cards due" />
                <Stat value={store.decks.length} label="your decks" />
              </div>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
