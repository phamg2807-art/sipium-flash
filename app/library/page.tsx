'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { AppShell, SaveBadge } from '@/components/shell/AppShell';
import { Button, EmptyState, Stat } from '@/components/ui/Primitives';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useDeckStore } from '@/lib/decks-store';
import { DeckCard, DeckSkeleton } from '@/components/deck/DeckCard';
import { relativeTime } from '@/lib/format';

export default function LibraryPage() {
  const store = useDeckStore();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const decks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return store.decks;
    return store.decks.filter(
      (deck) =>
        deck.title.toLowerCase().includes(needle) ||
        deck.topic.toLowerCase().includes(needle) ||
        deck.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        (deck.local?.cards ?? []).some((card) => card.term.toLowerCase().includes(needle)),
    );
  }, [store.decks, query]);

  const totalCards = store.decks.reduce((total, deck) => total + deck.cardCount, 0);

  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <AppShell title="Recent">
        <div className="container container--wide">
          <div className="row row--between" style={{ marginBottom: 18 }}>
            <div>
              <h1 className="page-title">Your decks</h1>
              <p className="page-sub">Saved on this device and synced to the server. No account needed.</p>
            </div>
            <Link href="/create" className="btn btn--primary">
              Create with AI
            </Link>
          </div>

          <div className="panel" style={{ marginBottom: 22 }}>
            <div className="stat-row">
              <Stat value={store.decks.length} label="decks" />
              <Stat value={totalCards} label="cards" />
              <Stat value={store.decks.filter((deck) => deck.isPublic).length} label="published" />
              <div style={{ marginLeft: 'auto', minWidth: 240 }}>
                <input
                  className="input"
                  placeholder="Search your decks and words…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search your decks"
                />
              </div>
            </div>
          </div>

          {!store.ready ? (
            <div className="deck-grid">
              <DeckSkeleton />
              <DeckSkeleton />
              <DeckSkeleton />
            </div>
          ) : decks.length === 0 ? (
            <EmptyState
              title={query ? 'Nothing matches that search' : 'No decks yet'}
              text={
                query
                  ? 'Try a different word, topic or tag.'
                  : 'Create your first deck from words, text, or an image. Everything is saved locally as you work.'
              }
              action={
                query ? (
                  <Button onClick={() => setQuery('')}>Clear search</Button>
                ) : (
                  <Link href="/create" className="btn btn--primary">
                    Create with AI
                  </Link>
                )
              }
            />
          ) : (
            <div className="deck-grid">
              {decks.map((deck) => (
                <div key={deck.id} className="stack stack--sm">
                  <DeckCard
                    deck={deck}
                    preview={(deck.local?.cards ?? []).slice(0, 4).map((card) => card.term)}
                    footer={
                      <span className="row row--between" style={{ width: '100%', marginTop: 2 }}>
                        <SaveBadge state={deck.local?.sync ?? 'saved'} />
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={(event) => {
                            event.preventDefault();
                            setPendingDelete({ id: deck.id, title: deck.title });
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    }
                  />
                  <span className="muted" style={{ fontSize: 11.5, paddingLeft: 2 }}>
                    Updated {relativeTime(deck.updatedAt)}
                    {deck.isPublic ? (
                      <>
                        <span className="dot-sep" />
                        <Link href={`/d/${deck.publicSlug}`} className="chip chip--accent">
                          Public
                        </Link>
                      </>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Modal
          open={Boolean(pendingDelete)}
          title="Delete this deck?"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (pendingDelete) {
                    store.deleteDeck(pendingDelete.id);
                    toast.push({ message: `“${pendingDelete.title}” deleted.`, tone: 'info' });
                  }
                  setPendingDelete(null);
                }}
              >
                Delete deck
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            “{pendingDelete?.title}” will be removed from this device and from the server. This cannot be undone.
          </p>
        </Modal>
      </AppShell>
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
