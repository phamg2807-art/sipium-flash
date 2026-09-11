'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button, EmptyState, Stat } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { useDeckStore } from '@/lib/decks-store';
import type { PublicDeck } from '@/shared/types';
import { difficultyLabel, relativeTime } from '@/lib/format';

export default function PublicDeckPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : null;

  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <AppShell title="Public deck">
        {slug ? <PublicDeckContent slug={slug} /> : <EmptyState title="Deck not found" />}
      </AppShell>
    </Suspense>
  );
}

function PublicDeckContent({ slug }: { slug: string }) {
  const store = useDeckStore();
  const toast = useToast();
  const [deck, setDeck] = useState<PublicDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .publicDeckBySlug(slug)
      .then((result) => {
        if (!cancelled) setDeck(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'That deck could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="container">
        <span className="spinner spinner--lg" aria-label="Loading deck" />
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="container">
        <EmptyState
          title="That deck is no longer available"
          text={error ?? 'It may have been unpublished.'}
          action={
            <Link href="/explore" className="btn btn--soft btn--sm">
              Browse public decks
            </Link>
          }
        />
      </div>
    );
  }

  const copy = async (thenStudy: boolean) => {
    setBusy(true);
    try {
      const result = await api.copyPublicDeck(deck.id);
      store.importDeck(result.deck, result.deck.cards);
      toast.push({ message: `Copied “${result.deck.title}”. It is yours to edit.`, tone: 'success' });
      if (thenStudy) window.location.assign(`/study?deck=${result.deck.id}`);
      else window.location.assign(`/decks/${result.deck.id}`);
    } catch (err) {
      toast.push({ message: err instanceof Error ? err.message : 'That deck could not be copied.', tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <div className="container container--narrow">
      <p className="eyebrow">Public deck</p>
      <h1 className="page-title">{deck.title}</h1>
      {deck.description ? <p className="page-sub">{deck.description}</p> : null}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="stat-row">
          <Stat value={deck.cardCount} label="cards" />
          <Stat value={difficultyLabel(deck.difficulty)} label="level" />
          <Stat value={deck.copies} label="copies" />
          <Stat value={deck.studies} label="study sessions" />
        </div>
        <div className="divider" />
        <div className="row row--wrap">
          {deck.topic ? <span className="chip chip--accent">{deck.topic}</span> : null}
          {deck.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
          <span className="muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
            Published {relativeTime(deck.publishedAt)}
          </span>
        </div>
      </div>

      <div className="section" style={{ marginTop: 26 }}>
        <div className="section__head">
          <h2 className="section__title">Inside this deck</h2>
        </div>
        <div className="stack stack--sm">
          {deck.preview.map((item) => (
            <div key={item.term} className="panel row row--between" style={{ padding: '13px 16px' }}>
              <span style={{ fontWeight: 600 }}>{item.term}</span>
              <span className="muted" style={{ fontSize: 13.5, textAlign: 'right' }}>
                {item.vietnameseMeaning || item.definition}
              </span>
            </div>
          ))}
          {deck.cardCount > deck.preview.length ? (
            <p className="muted" style={{ fontSize: 13 }}>
              + {deck.cardCount - deck.preview.length} more cards
            </p>
          ) : null}
        </div>
      </div>

      <div className="row row--wrap">
        <Button variant="primary" size="lg" loading={busy} onClick={() => void copy(true)}>
          Study this deck
        </Button>
        <Button size="lg" loading={busy} onClick={() => void copy(false)}>
          Copy and edit
        </Button>
        <Link href="/explore" className="btn btn--ghost btn--lg">
          Back to Explore
        </Link>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
