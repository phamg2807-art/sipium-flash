'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/format';
import { useDeckStore } from '@/lib/decks-store';
import { api } from '@/lib/api';
import type { HealthReport } from '@/shared/types';

const PRIMARY = [
  { href: '/', label: 'Home', glyph: '⌂' },
  { href: '/create', label: 'Create', glyph: '＋' },
  { href: '/study', label: 'Study', glyph: '▤' },
  { href: '/explore', label: 'Explore', glyph: '◎' },
];

const SECONDARY = [
  { href: '/library', label: 'Recent', glyph: '↺' },
  { href: '/settings', label: 'Settings', glyph: '⋯' },
];

export function Sidebar({ dueTotal }: { dueTotal: number }) {
  const pathname = usePathname();
  const item = (href: string, label: string, glyph: string, count?: number) => {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    return (
      <Link key={href} href={href} className="nav__item" aria-current={active ? 'page' : undefined}>
        <span className="nav__glyph" aria-hidden="true">
          {glyph}
        </span>
        <span>{label}</span>
        {count !== undefined && count > 0 ? <span className="nav__count">{count}</span> : null}
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand__dot" aria-hidden="true" />
        <span>
          <span className="brand__mark">Sipium Flash</span>
          <span className="brand__sub">Learn faster. Remember longer.</span>
        </span>
      </div>

      <nav className="nav" aria-label="Primary">
        {PRIMARY.map((entry) => item(entry.href, entry.label, entry.glyph, entry.href === '/study' ? dueTotal : undefined))}
        <span className="nav__label">Utilities</span>
        {SECONDARY.map((entry) => item(entry.href, entry.label, entry.glyph))}
      </nav>

      <div className="sidebar__footer">
        <SyncStatus />
      </div>
    </aside>
  );
}

function SyncStatus() {
  const store = useDeckStore();
  const [health, setHealth] = useState<HealthReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((report) => {
        if (!cancelled) setHealth(report);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store.lastSyncedAt]);

  const pending = store.decks.filter((deck) => deck.local && deck.local.sync !== 'saved').length;
  const label = !store.online
    ? 'Offline — saved on this device'
    : pending > 0
      ? `Saving ${pending} deck${pending === 1 ? '' : 's'}`
      : 'Saved';

  return (
    <>
      <div className="row" style={{ padding: '0 12px' }}>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 6,
            background: store.online ? (pending > 0 ? 'var(--warn)' : 'var(--good)') : 'var(--text-muted)',
            flex: 'none',
          }}
        />
        <span className="sidebar__meta" style={{ padding: 0 }}>
          {label}
        </span>
      </div>
      {health && !health.ai.configured ? (
        <span className="sidebar__meta" title={health.ai.detail}>
          Offline AI engine · no key configured
        </span>
      ) : null}
    </>
  );
}

export function BottomNav({ dueTotal }: { dueTotal: number }) {
  const pathname = usePathname();
  const items = [PRIMARY[0], PRIMARY[1], PRIMARY[2], PRIMARY[3], SECONDARY[0]];
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map((entry) => {
        const active = entry.href === '/' ? pathname === '/' : pathname.startsWith(entry.href);
        return (
          <Link key={entry.href} href={entry.href} className="bottom-nav__item" aria-current={active ? 'page' : undefined}>
            <span className="bottom-nav__glyph" aria-hidden="true">
              {entry.glyph}
            </span>
            <span>
              {entry.label}
              {entry.href === '/study' && dueTotal > 0 ? ` (${dueTotal})` : ''}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function TopBarInner({ title }: { title?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');

  return (
    <div className="topbar">
      {title ? <span className="topbar__title">{title}</span> : null}
      <div className="topbar__search">
        <input
          className="input input--big"
          style={{ padding: '8px 13px', fontSize: 14 }}
          placeholder="Search decks, words, topics…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim()) {
              router.push(`/explore?q=${encodeURIComponent(query.trim())}`);
            }
          }}
          aria-label="Search"
        />
      </div>
      <div className="topbar__spacer" />
      <Link href="/create" className="btn btn--primary btn--sm">
        Create with AI
      </Link>
    </div>
  );
}

export function TopBar({ title }: { title?: string }) {
  // Kept inside a Suspense boundary so pages stay statically optimisable.
  return (
    <Suspense fallback={<div className="topbar"><span className="topbar__title">{title}</span></div>}>
      <TopBarInner title={title} />
    </Suspense>
  );
}

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const store = useDeckStore();
  const toast = useToast();
  const [due, setDue] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .due()
      .then((result) => {
        if (!cancelled) setDue(result.totalDue);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store.lastSyncedAt, store.decks.length]);

  useEffect(() => {
    if (!store.online) {
      // Surfaced once per disconnection instead of nagging on every request.
      toast.push({ message: 'You are offline. Changes are saved on this device.', tone: 'info' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.online]);

  return (
    <div className="app">
      <Sidebar dueTotal={due} />
      <div className="app-shell__main">
        <TopBar title={title} />
        <div className="app-shell__content">{children}</div>
      </div>
      <BottomNav dueTotal={due} />
    </div>
  );
}

export function SaveBadge({ state }: { state: 'saved' | 'saving' | 'pending' | 'error' | 'offline' }) {
  const label =
    state === 'saved'
      ? 'Saved'
      : state === 'saving'
        ? 'Saving…'
        : state === 'offline'
          ? 'Offline — saved here'
          : state === 'error'
            ? 'Not saved — retry'
            : 'Unsaved changes';
  return (
    <span className={cx('chip', state === 'error' && 'chip--bad', state === 'offline' && 'chip--warn')} title={label}>
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 5,
          background: state === 'saved' ? 'var(--good)' : state === 'error' ? 'var(--bad)' : 'var(--warn)',
        }}
      />
      {label}
    </span>
  );
}
