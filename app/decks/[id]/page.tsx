'use client';

import Link from 'next/link';
import { Suspense, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { DeckEditor } from '@/components/deck/DeckEditor';
import { useDeck, useDeckStore } from '@/lib/decks-store';
import { EmptyState } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';

export default function DeckPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : null;

  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <AppShell title="Deck">
        {id ? <DeckPageContent id={id} /> : <EmptyState title="Deck not found" />}
      </AppShell>
    </Suspense>
  );
}

function DeckPageContent({ id }: { id: string }) {
  const store = useDeckStore();
  const router = useRouter();
  const toast = useToast();
  const deckState = useDeck(id);

  useEffect(() => {
    store.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const deckRecord = deckState.deck;
  const cards = deckState.cards;

  if (!store.ready || (deckState.loading && !deckRecord)) {
    return (
      <div className="container">
        <span className="spinner spinner--lg" aria-label="Loading deck" />
      </div>
    );
  }

  if (!deckRecord) {
    return (
      <div className="container">
        <EmptyState
          title="That deck is not on this device"
          text="Decks are saved per browser. Copy a public deck, or create a new one to get started."
          action={
            <Link href="/create" className="btn btn--primary btn--sm">
              Create with AI
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <DeckEditor
      deckId={id}
      deck={{
        id,
        title: deckRecord.title,
        description: deckRecord.description,
        topic: deckRecord.topic,
        difficulty: deckRecord.difficulty,
        isPublic: deckRecord.isPublic,
        publicSlug: deckRecord.publicSlug,
        tags: deckRecord.tags,
      }}
      cards={cards}
      status={deckState.status}
      onDeckChange={(patch) => store.updateDeck(id, patch)}
      onCardsChange={(nextCards) => store.setCards(id, nextCards)}
      onDelete={() => {
        store.deleteDeck(id);
        toast.push({ message: 'Deck deleted.', tone: 'info' });
        router.push('/library');
      }}
    />
  );
}

export const dynamic = 'force-dynamic';
