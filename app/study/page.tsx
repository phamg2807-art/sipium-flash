'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { StudySession } from '@/components/study/StudySession';
import { Button, EmptyState, Stat } from '@/components/ui/Primitives';
import { api } from '@/lib/api';
import { useDeck } from '@/lib/decks-store';
import { useStudy } from '@/lib/study-store';
import { relativeTime } from '@/lib/format';

interface DueDeck {
  deckId: string;
  title: string;
  topic: string;
  cardCount: number;
  difficulty: number;
  updatedAt: string;
  due: number;
}

function DeckPicker() {
  const [decks, setDecks] = useState<DueDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [weak, setWeak] = useState<{ cardId: string; deckId: string; term: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.due().catch(() => ({ decks: [], totalDue: 0, totalCards: 0 })), api.weak(10).catch(() => [])]).then(
      ([dueResult, weakResult]) => {
        if (cancelled) return;
        setDecks(dueResult.decks);
        setWeak(weakResult);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const totalDue = decks.reduce((total, item) => total + item.due, 0);
  const totalCards = decks.reduce((total, item) => total + item.cardCount, 0);

  return (
    <div className="container container--wide">
      <h1 className="page-title">Study</h1>
      <p className="page-sub" style={{ marginBottom: 20 }}>
        The scheduler decides what to show you. Review the due cards, then keep going if you want.
      </p>

      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="stat-row">
          <Stat value={totalDue} label="cards due" />
          <Stat value={totalCards} label="cards total" />
          <Stat value={weak.length} label="weak words" />
        </div>
      </div>

      {loading ? (
        <span className="spinner spinner--lg" aria-label="Loading" />
      ) : decks.length === 0 ? (
        <EmptyState
          title="Nothing to study yet"
          text="Create a deck first — from an article, a word list, or a photo of your notes. Then come back and Sipium Flash will schedule your reviews."
          action={
            <Link href="/create" className="btn btn--primary">
              Create with AI
            </Link>
          }
        />
      ) : (
        <div className="stack stack--sm">
          {decks.map((deck) => (
            <Link key={deck.deckId} href={`/study?deck=${deck.deckId}`} className="panel row row--between" style={{ gap: 16 }}>
              <span>
                <span style={{ fontWeight: 620, fontSize: 15 }}>{deck.title}</span>
                <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                  {deck.cardCount} cards{deck.topic ? ` · ${deck.topic}` : ''} · updated {relativeTime(deck.updatedAt)}
                </span>
              </span>
              <span className="row">
                {deck.due > 0 ? <span className="chip chip--accent">{deck.due} due</span> : <span className="chip">up to date</span>}
                <span className="chip">Study →</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {weak.length > 0 ? (
        <div className="section" style={{ marginTop: 30 }}>
          <div className="section__head">
            <h2 className="section__title">Weak words</h2>
            <span className="section__sub">Words you have missed more than once</span>
          </div>
          <div className="thumb-strip">
            {weak.map((item) => (
              <Link key={item.cardId} href={`/study?deck=${item.deckId}`} className="chip chip--button chip--warn">
                {item.term}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StudyDeck({ deckId, onExit }: { deckId: string; onExit: () => void }) {
  const deck = useDeck(deckId);
  const study = useStudy(deckId);
  const cards = useMemo(() => (deck.cards.length > 0 ? deck.cards : study.cards), [deck.cards, study.cards]);

  if (deck.loading && cards.length === 0) {
    return (
      <div className="container">
        <span className="spinner spinner--lg" aria-label="Loading deck" />
      </div>
    );
  }

  if (!deck.deck) {
    return (
      <div className="container">
        <EmptyState
          title="That deck is no longer available"
          text={deck.error ?? 'It may have been deleted on this device.'}
          action={
            <Link href="/study" className="btn btn--soft btn--sm">
              Choose another deck
            </Link>
          }
        />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="container">
        <EmptyState
          title="This deck has no cards"
          text="Open the deck editor to add a few cards, or generate them with AI."
          action={
            <Link href={`/decks/${deckId}`} className="btn btn--primary btn--sm">
              Open editor
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <StudySession
      deckId={deckId}
      deckTitle={deck.deck.title}
      cards={cards}
      states={study.states}
      loading={study.loading}
      error={study.error}
      offline={study.offline}
      onReview={study.submitReview}
      onExit={onExit}
    />
  );
}

export default function StudyPage() {
  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <StudyContent />
    </Suspense>
  );
}

function StudyContent() {
  const params = useSearchParams();
  const deckId = params.get('deck');

  return (
    <AppShell title="Study">
      {deckId ? <ExitAwareStudy deckId={deckId} /> : <DeckPicker />}
    </AppShell>
  );
}

function ExitAwareStudy({ deckId }: { deckId: string }) {
  return (
    <StudyDeck
      deckId={deckId}
      onExit={() => {
        if (typeof window !== 'undefined') window.history.pushState({}, '', '/study');
        window.location.href = '/study';
      }}
    />
  );
}

export const dynamic = 'force-dynamic';
