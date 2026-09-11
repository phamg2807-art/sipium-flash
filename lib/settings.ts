'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GenerationOptions, IeltsBand, IeltsSkill, LearningMode } from '@/shared/types';

export type Theme = 'light' | 'dark' | 'system';
export type UiLanguage = 'vi' | 'en';

export interface Settings {
  theme: Theme;
  language: UiLanguage;
  study: {
    dailyGoal: number;
    reveal: 'progressive' | 'all';
    questionMix: 'balanced' | 'recall' | 'recognition';
    showPronunciation: boolean;
    curiosity: 'often' | 'sometimes' | 'off';
  };
  ai: {
    mode: LearningMode;
    cardCount: number;
    difficulty: number;
    band: IeltsBand | '';
    skill: IeltsSkill | '';
    includeVietnamese: boolean;
    includeExamples: boolean;
    includeCollocations: boolean;
    includePronunciation: boolean;
    includeSynonyms: boolean;
    englishOnly: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  language: 'vi',
  study: {
    dailyGoal: 20,
    reveal: 'progressive',
    questionMix: 'balanced',
    showPronunciation: true,
    curiosity: 'sometimes',
  },
  ai: {
    mode: 'general',
    cardCount: 20,
    difficulty: 3,
    band: '7.0',
    skill: '',
    includeVietnamese: true,
    includeExamples: true,
    includeCollocations: true,
    includePronunciation: true,
    includeSynonyms: true,
    englishOnly: false,
  },
};

const KEY = 'sipium.settings';

function read(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      study: { ...DEFAULT_SETTINGS.study, ...(parsed.study ?? {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(parsed.ai ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<(settings: Settings) => void>();

function emit() {
  for (const listener of listeners) listener(current);
}

export function getSettings(): Settings {
  if (!hydrated && typeof window !== 'undefined') {
    current = read();
    hydrated = true;
  }
  return current;
}

export function updateSettings(patch: Partial<Settings> | ((prev: Settings) => Settings)) {
  const next = typeof patch === 'function' ? patch(getSettings()) : { ...getSettings(), ...patch };
  current = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    applyTheme(next.theme);
  }
  emit();
}

export function useSettings(): [Settings, (patch: Partial<Settings> | ((prev: Settings) => Settings)) => void] {
  const [settings, setSettings] = useState<Settings>(() => getSettings());

  useEffect(() => {
    setSettings(getSettings());
    const listener = (next: Settings) => setSettings(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback((patch: Partial<Settings> | ((prev: Settings) => Settings)) => {
    updateSettings(patch);
  }, []);

  return [settings, update];
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const resolved =
    theme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** Settings → generation defaults used by the Create workspace. */
export function settingsToGenerationOptions(settings: Settings, overrides: Partial<GenerationOptions> = {}): GenerationOptions {
  return {
    mode: settings.ai.mode,
    cardCount: settings.ai.cardCount,
    difficulty: settings.ai.difficulty,
    includeVietnamese: settings.ai.includeVietnamese,
    englishOnly: settings.ai.englishOnly,
    includeExamples: settings.ai.includeExamples,
    includeCollocations: settings.ai.includeCollocations,
    includePronunciation: settings.ai.includePronunciation,
    includeSynonyms: settings.ai.includeSynonyms,
    band: settings.ai.band,
    skill: settings.ai.skill,
    topic: '',
    customInstruction: '',
    ...overrides,
  };
}
