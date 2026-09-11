'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Deck, Flashcard } from '@/shared/types';
import { api } from '@/lib/api';
import { Button, Field, Segmented } from '@/components/ui/Primitives';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

const TOPICS = [
  'Environment',
  'Education',
  'Technology',
  'Health',
  'Government',
  'Society',
  'Work',
  'Crime',
  'Economy',
  'Globalisation',
];

export interface PublishIssue {
  level: string;
  field: string;
  message: string;
}

export function PublishDialog({
  open,
  onClose,
  deck,
  cards,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  deck: Deck;
  cards: Flashcard[];
  onPublished: (slug: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(deck.title);
  const [description, setDescription] = useState(deck.description);
  const [topic, setTopic] = useState(deck.topic);
  const [difficulty, setDifficulty] = useState(String(deck.difficulty));
  const [tags, setTags] = useState<string[]>(deck.tags);
  const [language, setLanguage] = useState(deck.language || 'en');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<PublishIssue[]>([]);
  const [published, setPublished] = useState<{ slug: string; title: string } | null>(null);

  const addTag = (tag: string) => {
    const value = tag.trim().toLowerCase();
    if (!value || tags.includes(value) || tags.length >= 12) return;
    setTags((current) => [...current, value]);
  };

  const submit = async () => {
    setBusy(true);
    setIssues([]);
    try {
      const result = await api.publish(deck.id, {
        title,
        description,
        topic,
        difficulty: Number(difficulty),
        tags,
        language,
      });
      setPublished({ slug: result.slug ?? '', title: result.deck.title });
      onPublished(result.slug ?? '');
      toast.push({ message: 'Published successfully.', tone: 'success' });
    } catch (error) {
      const details = (error as { details?: { issues?: PublishIssue[] } }).details;
      if (details?.issues?.length) {
        setIssues(details.issues);
      }
      toast.push({
        message: error instanceof Error ? error.message : 'Publishing failed.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  if (published) {
    return (
      <Modal
        open={open}
        title="Published successfully."
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Link href={`/d/${published.slug}`} className="btn btn--soft">
              View public deck
            </Link>
            <Link href={`/study?deck=${deck.id}`} className="btn btn--primary">
              Study deck
            </Link>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          “{published.title}” is now public with {cards.length} cards. Anyone can find it in Explore and copy it into
          their own collection.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="Publish deck"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Publish
          </Button>
        </>
      }
    >
      {issues.length > 0 ? (
        <div className="banner banner--error">
          <div>
            <strong>Fix these before publishing:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="banner banner--info">
          Publishing makes this deck visible to everyone. You can unpublish at any time from this deck.
        </div>
      )}

      <Field label="Title" htmlFor="publish-title">
        <input id="publish-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
      </Field>

      <Field label="Description" htmlFor="publish-description" hint="What will someone learn from this deck?">
        <textarea
          id="publish-description"
          className="textarea"
          style={{ minHeight: 76 }}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="grid-2">
        <Field label="Topic" htmlFor="publish-topic">
          <select id="publish-topic" className="select" value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="">No topic</option>
            {TOPICS.map((entry) => (
              <option key={entry} value={entry.toLowerCase()}>
                {entry}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language" htmlFor="publish-language">
          <select id="publish-language" className="select" value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="en">English</option>
            <option value="vi">Vietnamese</option>
            <option value="en-vi">English + Vietnamese</option>
          </select>
        </Field>
      </div>

      <Field label="Difficulty">
        <Segmented
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { value: '1', label: 'Beginner' },
            { value: '2', label: 'Elementary' },
            { value: '3', label: 'Intermediate' },
            { value: '4', label: 'Upper' },
            { value: '5', label: 'Advanced' },
          ]}
        />
      </Field>

      <Field label="Tags" hint="Press Enter to add. Decks for Vietnamese learners usually include “vietnamese”.">
        <input
          className="input"
          placeholder="ielts, environment, band-7"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTag(event.currentTarget.value);
              event.currentTarget.value = '';
            }
          }}
        />
      </Field>
      {tags.length > 0 ? (
        <div className="thumb-strip">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip chip--button"
              onClick={() => setTags((current) => current.filter((item) => item !== tag))}
            >
              {tag} ✕
            </button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
