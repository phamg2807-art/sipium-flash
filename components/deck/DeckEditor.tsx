'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import type { CardAction, Flashcard } from '@/shared/types';
import { CARD_ACTIONS } from '@/shared/types';
import { api } from '@/lib/api';
import { makeCardId } from '@/lib/decks-store';
import { Button, Chip, EmptyState } from '@/components/ui/Primitives';
import { Modal } from '@/components/ui/Modal';
import { SaveBadge } from '@/components/shell/AppShell';
import { useToast } from '@/components/ui/Toast';
import { PublishDialog } from './PublishDialog';

const emptyCard = (deckId: string): Flashcard => ({
  id: makeCardId(),
  deckId,
  position: 0,
  term: '',
  definition: '',
  vietnameseMeaning: '',
  partOfSpeech: '',
  pronunciation: '',
  exampleSentences: [],
  collocations: [],
  synonyms: [],
  antonyms: [],
  relatedWords: [],
  topics: [],
  difficulty: 3,
  ieltsRelevance: 3,
  source: 'manual',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export function DeckEditor({
  deckId,
  deck,
  cards,
  status,
  onDeckChange,
  onCardsChange,
  onDelete,
}: {
  deckId: string;
  deck: { id: string; title: string; description: string; topic: string; difficulty: number; isPublic: boolean; publicSlug: string | null; tags: string[] };
  cards: Flashcard[];
  status: 'saved' | 'saving' | 'pending' | 'error' | 'offline';
  onDeckChange: (patch: Partial<{ title: string; description: string; topic: string; difficulty: number }>) => void;
  onCardsChange: (cards: Flashcard[]) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [actionCard, setActionCard] = useState<Flashcard | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ note?: string; quiz?: { prompt: string; options: string[]; answerIndex: number; explanation: string } } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useCallback(
    (id: string, patch: Partial<Flashcard>) => {
      onCardsChange(cards.map((card) => (card.id === id ? { ...card, ...patch } : card)));
    },
    [cards, onCardsChange],
  );

  const move = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= cards.length) return;
      const next = [...cards];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      onCardsChange(next.map((card, position) => ({ ...card, position })));
    },
    [cards, onCardsChange],
  );

  const addCards = useCallback(
    (terms: string[]) => {
      const cleaned = terms.map((term) => term.trim()).filter(Boolean);
      if (cleaned.length === 0) return;
      onCardsChange([
        ...cards,
        ...cleaned.map((term, index) => ({ ...emptyCard(deckId), term, position: cards.length + index })),
      ]);
      toast.push({ message: `Added ${cleaned.length} card${cleaned.length === 1 ? '' : 's'}.`, tone: 'success' });
    },
    [cards, deckId, onCardsChange, toast],
  );

  const runAction = useCallback(
    async (card: Flashcard, action: CardAction) => {
      setActionBusy(action);
      try {
        const result = await api.cardAction({ card, action, context: {} });
        update(card.id, result.card as Partial<Flashcard>);
        setActionResult({ note: result.note, quiz: result.quiz ?? undefined });
        if (action !== 'quiz') {
          toast.push({ message: `Updated “${card.term}”.`, tone: 'success' });
          setActionCard(null);
        }
      } catch (error) {
        toast.push({ message: error instanceof Error ? error.message : 'That AI action failed.', tone: 'error' });
      } finally {
        setActionBusy(null);
      }
    },
    [update, toast],
  );

  const issues = useMemo(() => {
    const problems: { id: string; message: string }[] = [];
    const seen = new Map<string, number>();
    for (const card of cards) {
      seen.set(card.term.trim().toLowerCase(), (seen.get(card.term.trim().toLowerCase()) ?? 0) + 1);
      if (!card.term.trim()) problems.push({ id: card.id, message: 'Missing word' });
      else if (!card.definition.trim()) problems.push({ id: card.id, message: `“${card.term}” has no definition` });
    }
    for (const [term, count] of seen) {
      if (count > 1 && term) problems.push({ id: `dup-${term}`, message: `“${term}” appears ${count} times` });
    }
    return problems;
  }, [cards]);

  return (
    <div className="container container--wide">
      <div className="row row--between" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="inline-input inline-input--term"
            style={{ fontSize: 24, fontWeight: 680, letterSpacing: '-0.02em', padding: '2px 6px', marginLeft: -6 }}
            value={deck.title}
            onChange={(event) => onDeckChange({ title: event.target.value })}
            aria-label="Deck title"
          />
          <input
            className="inline-input"
            style={{ width: '100%', maxWidth: 620, marginLeft: -6 }}
            placeholder="Add a short description…"
            value={deck.description}
            onChange={(event) => onDeckChange({ description: event.target.value })}
            aria-label="Deck description"
          />
        </div>
        <div className="row" style={{ flex: 'none' }}>
          <SaveBadge state={status} />
          <Link href={`/study?deck=${deckId}`} className="btn btn--primary">
            Study
          </Link>
          <Button onClick={() => setPublishOpen(true)}>{deck.isPublic ? 'Update public page' : 'Publish'}</Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="row row--wrap" style={{ marginBottom: 18 }}>
        <Chip>{cards.length} cards</Chip>
        {deck.topic ? <Chip>{deck.topic}</Chip> : null}
        {deck.isPublic ? (
          <Link href={`/d/${deck.publicSlug}`} className="chip chip--accent">
            Public
          </Link>
        ) : null}
        {issues.length > 0 ? <Chip tone="warn">{issues.length} to fix</Chip> : <Chip tone="good">Ready</Chip>}
        <span style={{ marginLeft: 'auto' }} className="row">
          <Button size="sm" onClick={() => addCards([''])}>
            Add card
          </Button>
          <Button size="sm" variant="soft" onClick={() => setShowBulk((value) => !value)}>
            Add words quickly
          </Button>
        </span>
      </div>

      {showBulk ? (
        <div className="panel" style={{ marginBottom: 18 }}>
          <label className="field__label" htmlFor="bulk-add">
            One word or phrase per line
          </label>
          <textarea
            id="bulk-add"
            className="textarea"
            style={{ minHeight: 110 }}
            placeholder={'mitigate\nexacerbate\nsubstantial'}
            value={bulk}
            onChange={(event) => setBulk(event.target.value)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                addCards(bulk.split('\n'));
                setBulk('');
              }}
            >
              Add {bulk.split('\n').filter((line) => line.trim()).length} cards
            </Button>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Then use the AI actions on each card to fill in meanings and examples.
            </span>
          </div>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="banner banner--warn" style={{ marginBottom: 16 }}>
          <div>
            <strong>Before you publish:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {issues.slice(0, 5).map((issue) => (
                <li key={issue.id}>{issue.message}</li>
              ))}
              {issues.length > 5 ? <li>…and {issues.length - 5} more</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState
          title="This deck has no cards"
          text="Add a few words, paste a list, or generate cards with AI from the Create workspace."
          action={
            <Link href="/create" className="btn btn--primary btn--sm">
              Create with AI
            </Link>
          }
        />
      ) : (
        <div>
          {cards.map((card, index) => (
            <CardRow
              key={card.id}
              card={card}
              index={index}
              total={cards.length}
              onChange={(patch) => update(card.id, patch)}
              onMove={(direction) => move(index, direction)}
              onDuplicate={() => onCardsChange([...cards.slice(0, index + 1), { ...card, id: makeCardId() }, ...cards.slice(index + 1)])}
              onDelete={() => onCardsChange(cards.filter((item) => item.id !== card.id))}
              onAction={() => {
                setActionCard(card);
                setActionResult(null);
              }}
            />
          ))}
        </div>
      )}

      <Modal
        open={Boolean(actionCard)}
        title={actionCard ? `AI actions — ${actionCard.term}` : 'AI actions'}
        onClose={() => setActionCard(null)}
        footer={
          <Button variant="ghost" onClick={() => setActionCard(null)}>
            Close
          </Button>
        }
      >
        {actionResult?.quiz ? (
          <div className="stack stack--sm">
            <p style={{ margin: 0, fontWeight: 600 }}>{actionResult.quiz.prompt}</p>
            {actionResult.quiz.options.map((option, optionIndex) => (
              <div key={option} className={`chip${optionIndex === actionResult.quiz?.answerIndex ? ' chip--good' : ''}`}>
                {option}
              </div>
            ))}
            {actionResult.quiz.explanation ? <p className="muted" style={{ margin: 0 }}>{actionResult.quiz.explanation}</p> : null}
          </div>
        ) : null}
        {actionResult?.note ? <div className="banner banner--info">{actionResult.note}</div> : null}
        <div className="grid-2">
          {CARD_ACTIONS.map((action) => (
            <Button
              key={action.id}
              variant="soft"
              size="sm"
              loading={actionBusy === action.id}
              onClick={() => actionCard && void runAction(actionCard, action.id)}
              title={action.hint}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          Each action calls a single AI tool on this card — your deck is never regenerated.
        </p>
      </Modal>

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        deck={{
          id: deckId,
          ownerKey: '',
          title: deck.title,
          description: deck.description,
          language: 'en',
          source: 'manual',
          topic: deck.topic,
          difficulty: deck.difficulty,
          tags: deck.tags,
          cardCount: cards.length,
          isPublic: deck.isPublic,
          publicSlug: deck.publicSlug,
          publishedAt: null,
          forkOf: null,
          copies: 0,
          studies: 0,
          learningMode: 'general',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
        cards={cards}
        onPublished={() => undefined}
      />

      <Modal
        open={confirmDelete}
        title="Delete this deck?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
            >
              Delete deck
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          “{deck.title}” and its {cards.length} cards will be removed from this device. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function CardRow({
  card,
  index,
  total,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  onAction,
}: {
  card: Flashcard;
  index: number;
  total: number;
  onChange: (patch: Partial<Flashcard>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAction: () => void;
}) {
  return (
    <div className="editor-row">
      <div className="stack stack--sm">
        <input
          className="inline-input inline-input--term"
          placeholder="Word or phrase"
          value={card.term}
          onChange={(event) => onChange({ term: event.target.value })}
          aria-label="Term"
        />
        <input
          className="inline-input"
          placeholder="Vietnamese meaning"
          value={card.vietnameseMeaning}
          onChange={(event) => onChange({ vietnameseMeaning: event.target.value })}
          aria-label="Vietnamese meaning"
        />
        <div className="row row--wrap" style={{ gap: 5 }}>
          {card.collocations.slice(0, 3).map((item) => (
            <Chip key={item}>{item}</Chip>
          ))}
          {card.topics.slice(0, 2).map((topic) => (
            <Chip key={topic} tone="accent">
              {topic}
            </Chip>
          ))}
          {!card.definition ? <Chip tone="warn">no definition</Chip> : null}
        </div>
      </div>

      <div className="stack stack--sm">
        <textarea
          className="inline-input"
          style={{ minHeight: 62, resize: 'vertical', lineHeight: 1.5 }}
          placeholder="English definition"
          value={card.definition}
          onChange={(event) => onChange({ definition: event.target.value })}
          aria-label="Definition"
        />
        <input
          className="inline-input"
          placeholder="Example sentence"
          value={card.exampleSentences[0] ?? ''}
          onChange={(event) =>
            onChange({
              exampleSentences: event.target.value ? [event.target.value, ...card.exampleSentences.slice(1)] : card.exampleSentences.slice(1),
            })
          }
          aria-label="Example sentence"
        />
        <div className="row row--wrap" style={{ gap: 5 }}>
          <input
            className="inline-input"
            style={{ width: 110 }}
            placeholder="IPA"
            value={card.pronunciation}
            onChange={(event) => onChange({ pronunciation: event.target.value })}
            aria-label="Pronunciation"
          />
          <input
            className="inline-input"
            style={{ width: 110 }}
            placeholder="Part of speech"
            value={card.partOfSpeech}
            onChange={(event) => onChange({ partOfSpeech: event.target.value })}
            aria-label="Part of speech"
          />
        </div>
      </div>

      <div className="stack stack--sm" style={{ flex: 'none' }}>
        <Button size="sm" variant="primary" onClick={onAction}>
          AI
        </Button>
        <div className="row" style={{ gap: 4 }}>
          <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            ↑
          </Button>
          <Button size="icon" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            ↓
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
