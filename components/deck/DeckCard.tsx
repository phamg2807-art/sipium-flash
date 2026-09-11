'use client';

import Link from 'next/link';
import type { Deck, PublicDeck } from '@/shared/types';
import { difficultyLabel, relativeTime } from '@/lib/format';

export function DeckCard({
  deck,
  preview,
  due,
  href,
  footer,
}: {
  deck: Deck | PublicDeck;
  preview?: string[];
  due?: number;
  href?: string;
  footer?: React.ReactNode;
}) {
  const target = href ?? `/decks/${deck.id}`;
  return (
    <Link href={target} className="deck-card">
      <span className="deck-card__title">{deck.title}</span>
      {deck.description ? <span className="deck-card__desc">{deck.description}</span> : null}
      {preview && preview.length > 0 ? (
        <span className="deck-card__terms">
          {preview.slice(0, 4).map((term) => (
            <span key={term} className="chip">
              {term}
            </span>
          ))}
        </span>
      ) : null}
      <span className="deck-card__foot">
        <span>{deck.cardCount} cards</span>
        {due !== undefined && due > 0 ? <span className="chip chip--accent">{due} due</span> : null}
        {deck.topic ? <span className="chip">{deck.topic}</span> : null}
        <span className="chip">{difficultyLabel(deck.difficulty)}</span>
        <span style={{ marginLeft: 'auto' }}>{relativeTime(deck.updatedAt)}</span>
      </span>
      {footer}
    </Link>
  );
}

export function DeckSkeleton() {
  return (
    <div className="deck-card" style={{ cursor: 'default', gap: 12 }}>
      <span className="skeleton" style={{ width: '70%', height: 15 }} />
      <span className="skeleton" style={{ width: '92%', height: 12 }} />
      <span className="skeleton" style={{ width: '48%', height: 12 }} />
    </div>
  );
}
