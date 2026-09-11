'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button, EmptyState, Segmented } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { useDeckStore } from '@/lib/decks-store';
import type { PublicDeck } from '@/shared/types';
import { relativeTime } from '@/lib/format';

type Section = 'popular' | 'newest' | 'ielts' | 'academic' | 'beginner' | 'intermediate' | 'advanced' | 'vietnamese';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'ielts', label: 'IELTS' },
  { id: 'academic', label: 'Academic' },
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'vietnamese', label: 'Vietnamese learners' },
];

function sectionToQuery(section: Section): { sort: string; mode?: string; difficulty?: number; tag?: string } {
  switch (section) {
    case 'newest':
      return { sort: 'newest' };
    case 'ielts':
      return { sort: 'popular', mode: 'ielts' };
    case 'academic':
      return { sort: 'popular', mode: 'academic' };
    case 'beginner':
      return { sort: 'popular', difficulty: 2 };
    case 'intermediate':
      return { sort: 'popular', difficulty: 3 };
    case 'advanced':
      return { sort: 'popular', difficulty: 5 };
    case 'vietnamese':
      return { sort: 'popular', tag: 'vietnamese' };
    default:
      return { sort: 'popular' };
  }
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <ExploreContent />
    </Suspense>
  );
}

function ExploreContent() {
  const params = useSearchParams();
  const store = useDeckStore();
  const toast = useToast();

  const [section, setSection] = useState<Section>('popular');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [decks, setDecks] = useState<PublicDeck[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const filters = useMemo(() => sectionToQuery(section), [section]);

  const load = useCallback(
    (nextPage: number) => {
      setLoading(true);
      api
        .publicDecks({ ...filters, q: query, page: nextPage, pageSize: 12 })
        .then((result) => {
          setDecks((current) => (nextPage === 1 ? result.decks : [...current, ...result.decks]));
          setTotal(result.total);
          setPage(result.page);
        })
        .catch(() => {
          toast.push({ message: 'Public decks could not be loaded right now.', tone: 'error' });
        })
        .finally(() => setLoading(false));
    },
    [filters, query, toast],
  );

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, query]);

  const copy = async (deck: PublicDeck) => {
    setBusy(deck.id);
    try {
      const result = await api.copyPublicDeck(deck.id);
      store.importDeck(result.deck, result.deck.cards);
      toast.push({
        message: `Copied “${result.deck.title}” — it is yours to edit.`,
        tone: 'success',
        action: { label: 'Open', onClick: () => window.location.assign(`/decks/${result.deck.id}`) },
      });
    } catch (error) {
      toast.push({ message: error instanceof Error ? error.message : 'That deck could not be copied.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const study = async (deck: PublicDeck) => {
    setBusy(deck.id);
    try {
      const result = await api.copyPublicDeck(deck.id);
      store.importDeck(result.deck, result.deck.cards);
      window.location.assign(`/study?deck=${result.deck.id}`);
    } catch (error) {
      toast.push({ message: error instanceof Error ? error.message : 'That deck could not be opened.', tone: 'error' });
      setBusy(null);
    }
  };

  return (
    <AppShell title="Explore">
        <div className="container container--wide">
          <h1 className="page-title">Explore public decks</h1>
          <p className="page-sub" style={{ marginBottom: 20 }}>
            Decks published by other learners. Copy anything useful — a copy is fully yours to edit.
          </p>

          <div className="row row--wrap" style={{ marginBottom: 16, gap: 12 }}>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="Search decks, topics, words…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search public decks"
            />
            <span className="muted" style={{ fontSize: 12.5 }}>
              {loading ? 'Loading…' : `${total} deck${total === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="scroll-x" style={{ marginBottom: 20 }}>
            <div className="row row--wrap" style={{ gap: 7, flexWrap: 'nowrap', paddingBottom: 4 }}>
              {SECTIONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`chip chip--button${section === entry.id ? ' chip--accent' : ''}`}
                  onClick={() => setSection(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {loading && decks.length === 0 ? (
            <span className="spinner spinner--lg" aria-label="Loading" />
          ) : decks.length === 0 ? (
            <EmptyState
              title={query ? 'No public decks match that search' : 'No public decks yet'}
              text={
                query
                  ? 'Try a broader word, or switch section.'
                  : 'Publish one of your decks and it will show up here for everyone.'
              }
              action={
                query ? (
                  <Button onClick={() => setQuery('')}>Clear search</Button>
                ) : (
                  <Link href="/library" className="btn btn--primary">
                    Publish from your decks
                  </Link>
                )
              }
            />
          ) : (
            <>
              <div className="stack stack--sm">
                {decks.map((deck) => (
                  <div key={deck.id} className="panel row row--between" style={{ gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/d/${deck.publicSlug}`} style={{ fontWeight: 620, fontSize: 15.5 }}>
                        {deck.title}
                      </Link>
                      {deck.description ? (
                        <p className="muted" style={{ margin: '3px 0 8px', fontSize: 13 }}>
                          {deck.description}
                        </p>
                      ) : null}
                      <div className="thumb-strip">
                        {deck.preview.slice(0, 5).map((item) => (
                          <span key={item.term} className="chip">
                            {item.term}
                          </span>
                        ))}
                        {deck.cardCount > deck.preview.length ? (
                          <span className="chip">+{deck.cardCount - deck.preview.length}</span>
                        ) : null}
                      </div>
                      <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
                        {deck.cardCount} cards
                        {deck.topic ? ` · ${deck.topic}` : ''}
                        {deck.copies > 0 ? ` · ${deck.copies} copies` : ''}
                        {deck.studies > 0 ? ` · ${deck.studies} study sessions` : ''}
                        <span className="dot-sep" />
                        {relativeTime(deck.publishedAt ?? deck.createdAt)}
                      </span>
                    </div>
                    <div className="stack stack--sm" style={{ flex: 'none', width: 132 }}>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy === deck.id}
                        onClick={() => void study(deck)}
                      >
                        Study
                      </Button>
                      <Button size="sm" loading={busy === deck.id} onClick={() => void copy(deck)}>
                        Copy
                      </Button>
                      <Link href={`/d/${deck.publicSlug}`} className="btn btn--ghost btn--sm">
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              {decks.length < total ? (
                <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}>
                  <Button variant="soft" loading={loading} onClick={() => load(page + 1)}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
