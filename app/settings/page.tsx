'use client';

import { Suspense, useEffect, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Button, Field, Segmented } from '@/components/ui/Primitives';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { applyTheme, useSettings, type Settings, type Theme } from '@/lib/settings';
import { api } from '@/lib/api';
import { idbAll, idbClear, idbPut } from '@/lib/idb';
import type { HealthReport, IeltsBand, IeltsSkill, LearningMode } from '@/shared/types';

const COPY = {
  en: {
    appearance: 'Appearance',
    language: 'Language',
    study: 'Study preferences',
    ai: 'AI generation defaults',
    data: 'Local data',
    about: 'About',
  },
  vi: {
    appearance: 'Giao diện',
    language: 'Ngôn ngữ',
    study: 'Tuỳ chọn học tập',
    ai: 'Mặc định khi tạo bằng AI',
    data: 'Dữ liệu trên thiết bị',
    about: 'Thông tin',
  },
};

export default function SettingsPage() {
  const [settings, update] = useSettings();
  const toast = useToast();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [confirm, setConfirm] = useState<null | 'drafts' | 'all'>(null);
  const copy = COPY[settings.language];

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const setStudy = (patch: Partial<Settings['study']>) => update({ study: { ...settings.study, ...patch } });
  const setAi = (patch: Partial<Settings['ai']>) => update({ ai: { ...settings.ai, ...patch } });

  const exportData = async () => {
    const decks = await idbAll('decks');
    const drafts = await idbAll('drafts');
    const payload = {
      app: 'sipium-flash',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      decks: decks.map((entry) => entry.value),
      drafts: drafts.map((entry) => entry.value),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sipium-flash-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.push({ message: 'Local data exported.', tone: 'success' });
  };

  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        decks?: { key: string; value: unknown }[];
        settings?: Partial<Settings>;
      };
      for (const entry of parsed.decks ?? []) {
        await idbPut('decks', entry.key, entry.value);
      }
      if (parsed.settings) update(parsed.settings);
      toast.push({ message: 'Import complete. Reloading your library…', tone: 'success' });
      setTimeout(() => window.location.assign('/library'), 900);
    } catch {
      toast.push({ message: 'That file could not be read as a Sipium Flash export.', tone: 'error' });
    }
  };

  const clear = async (scope: 'drafts' | 'all') => {
    if (scope === 'drafts') {
      await idbClear('drafts');
      toast.push({ message: 'Local drafts cleared.', tone: 'info' });
    } else {
      await idbClear('decks');
      await idbClear('drafts');
      await idbClear('outbox');
      await idbClear('meta');
      toast.push({ message: 'All local data cleared from this device.', tone: 'info' });
    }
    setConfirm(null);
  };

  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <AppShell title="Settings">
        <div className="container container--narrow">
          <h1 className="page-title">Settings</h1>
          <p className="page-sub" style={{ marginBottom: 26 }}>
            No account, no login. Everything here is stored on this device.
          </p>

          <section className="section">
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {copy.appearance}
            </h2>
            <div className="panel stack">
              <Field label="Theme">
                <Segmented<Theme>
                  value={settings.theme}
                  onChange={(theme) => update({ theme })}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'system', label: 'System' },
                  ]}
                />
              </Field>
            </div>
          </section>

          <section className="section">
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {copy.language}
            </h2>
            <div className="panel stack">
              <Field label="Interface labels" hint="Structural labels only — study content follows the explanation setting.">
                <Segmented
                  value={settings.language}
                  onChange={(language) => update({ language: language as Settings['language'] })}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'vi', label: 'Tiếng Việt' },
                  ]}
                />
              </Field>
              <Field label="Explanations" hint="Vietnamese glosses help recall; English-only is better immersion.">
                <Segmented
                  value={settings.ai.englishOnly ? 'en' : 'vi'}
                  onChange={(value) => setAi({ englishOnly: value === 'en', includeVietnamese: value === 'vi' })}
                  options={[
                    { value: 'vi', label: 'English + Vietnamese' },
                    { value: 'en', label: 'English only' },
                  ]}
                />
              </Field>
            </div>
          </section>

          <section className="section">
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {copy.study}
            </h2>
            <div className="panel stack">
              <Field label={`Daily goal — ${settings.study.dailyGoal} cards`}>
                <input
                  type="range"
                  min={5}
                  max={80}
                  value={settings.study.dailyGoal}
                  onChange={(event) => setStudy({ dailyGoal: Number(event.target.value) })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label="Reveal style" hint="Progressive shows meaning, then example, then collocations.">
                <Segmented
                  value={settings.study.reveal}
                  onChange={(reveal) => setStudy({ reveal: reveal as Settings['study']['reveal'] })}
                  options={[
                    { value: 'progressive', label: 'Progressive' },
                    { value: 'all', label: 'All at once' },
                  ]}
                />
              </Field>
              <Field label="Question mix">
                <Segmented
                  value={settings.study.questionMix}
                  onChange={(questionMix) => setStudy({ questionMix: questionMix as Settings['study']['questionMix'] })}
                  options={[
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'recall', label: 'More recall' },
                    { value: 'recognition', label: 'More recognition' },
                  ]}
                />
              </Field>
              <Field label="Curiosity notes">
                <Segmented
                  value={settings.study.curiosity}
                  onChange={(curiosity) => setStudy({ curiosity: curiosity as Settings['study']['curiosity'] })}
                  options={[
                    { value: 'often', label: 'Often' },
                    { value: 'sometimes', label: 'Sometimes' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              </Field>
              <label className="row" style={{ gap: 9 }}>
                <input
                  type="checkbox"
                  checked={settings.study.showPronunciation}
                  onChange={(event) => setStudy({ showPronunciation: event.target.checked })}
                />
                <span style={{ fontSize: 14 }}>Show pronunciation on study cards</span>
              </label>
            </div>
          </section>

          <section className="section">
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {copy.ai}
            </h2>
            <div className="panel stack">
              <div className="grid-2">
                <Field label="Default focus">
                  <select
                    className="select"
                    value={settings.ai.mode}
                    onChange={(event) => setAi({ mode: event.target.value as LearningMode })}
                  >
                    <option value="general">General English</option>
                    <option value="ielts">IELTS</option>
                    <option value="academic">Academic English</option>
                    <option value="school">School</option>
                    <option value="exam">Exam preparation</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <Field label={`Cards per deck — ${settings.ai.cardCount}`}>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={settings.ai.cardCount}
                    onChange={(event) => setAi({ cardCount: Number(event.target.value) })}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="IELTS band">
                  <select
                    className="select"
                    value={settings.ai.band}
                    onChange={(event) => setAi({ band: event.target.value as IeltsBand | '' })}
                  >
                    <option value="">Any</option>
                    {(['5.5', '6.0', '6.5', '7.0', '7.5', '8.0+'] as IeltsBand[]).map((band) => (
                      <option key={band} value={band}>
                        {band}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Skill focus">
                  <select
                    className="select"
                    value={settings.ai.skill}
                    onChange={(event) => setAi({ skill: event.target.value as IeltsSkill | '' })}
                  >
                    <option value="">General</option>
                    <option value="writing">Writing</option>
                    <option value="speaking">Speaking</option>
                    <option value="reading">Reading</option>
                    <option value="listening">Listening</option>
                    <option value="vocabulary">Vocabulary</option>
                  </select>
                </Field>
              </div>
              <div className="row row--wrap">
                {(
                  [
                    { key: 'includeExamples', label: 'Examples' },
                    { key: 'includeCollocations', label: 'Collocations' },
                    { key: 'includePronunciation', label: 'Pronunciation' },
                    { key: 'includeSynonyms', label: 'Synonyms & antonyms' },
                  ] as const
                ).map((item) => (
                  <label key={item.key} className="row" style={{ gap: 7 }}>
                    <input
                      type="checkbox"
                      checked={settings.ai[item.key]}
                      onChange={(event) => setAi({ [item.key]: event.target.checked } as Partial<Settings['ai']>)}
                    />
                    <span style={{ fontSize: 13.5 }}>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {copy.data}
            </h2>
            <div className="panel stack">
              <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                Your decks and drafts live in this browser. Export them before clearing data or switching devices.
              </p>
              <div className="row row--wrap">
                <Button variant="soft" onClick={() => void exportData()}>
                  Export local data
                </Button>
                <label className="btn btn--soft">
                  Import local data
                  <input
                    type="file"
                    accept="application/json"
                    className="visually-hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importData(file);
                      event.target.value = '';
                    }}
                  />
                </label>
                <Button variant="ghost" onClick={() => setConfirm('drafts')}>
                  Clear local drafts
                </Button>
                <Button variant="danger" onClick={() => setConfirm('all')}>
                  Clear all local data
                </Button>
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {copy.about}
            </h2>
            <div className="panel stack stack--sm">
              <div className="row row--between">
                <span className="muted">Version</span>
                <span>0.1.0</span>
              </div>
              <div className="row row--between">
                <span className="muted">Database</span>
                <span>
                  {health ? `${health.database.driver === 'postgres' ? 'PostgreSQL' : 'Embedded PostgreSQL'} · ${
                    health.database.ok ? 'connected' : 'unavailable'
                  }` : 'checking…'}
                </span>
              </div>
              <div className="row row--between">
                <span className="muted">AI provider</span>
                <span>
                  {health
                    ? `${health.ai.provider} · ${health.ai.model}${health.ai.configured ? '' : ' · not configured'}`
                    : 'checking…'}
                </span>
              </div>
              <div className="row row--between">
                <span className="muted">Image understanding</span>
                <span>{health ? (health.ai.vision && health.ai.configured ? 'available' : 'needs an AI key') : 'checking…'}</span>
              </div>
              {health && !health.ai.configured ? (
                <div className="banner banner--warn">{health.ai.detail}</div>
              ) : null}
              <div className="divider" />
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                Sipium Flash runs without accounts. Creation runs server-side: the browser talks to the API, and the API
                talks to the model. Provider keys never reach your device.
              </p>
            </div>
          </section>
        </div>

        <Modal
          open={confirm !== null}
          title={confirm === 'all' ? 'Clear all local data?' : 'Clear local drafts?'}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => confirm && void clear(confirm)}>
                {confirm === 'all' ? 'Delete everything' : 'Delete drafts'}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {confirm === 'all'
              ? 'Every deck, draft and pending review on this device will be removed. Published decks stay public. Export first if you are unsure.'
              : 'Unfinished decks in the Create workspace will be removed. Saved decks are not affected.'}
          </p>
        </Modal>
      </AppShell>
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
