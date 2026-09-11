'use client';

/**
 * Anonymous identity. There is no login anywhere in Sipium Flash: the browser
 * generates an installation key that scopes local decks and study state.
 */
const KEY = 'sipium.install-key';

function randomKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `sf-${hex}`;
}

let cached: string | null = null;

export function getInstallKey(): string {
  if (cached) return cached;
  if (typeof window === 'undefined') return 'sf-server';
  const existing = window.localStorage.getItem(KEY);
  if (existing && /^sf-[a-f0-9]{32}$/.test(existing)) {
    cached = existing;
    return cached;
  }
  const created = existing && existing.length >= 8 ? existing : randomKey();
  window.localStorage.setItem(KEY, created);
  cached = created;
  return cached;
}
