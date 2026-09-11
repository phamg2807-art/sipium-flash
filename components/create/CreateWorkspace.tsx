'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DeckWithCards,
  GenerationOptions,
  IeltsBand,
  IeltsSkill,
  ImagePayload,
  LearningMode,
  PlanDocument,
  SourceMaterial,
} from '@/shared/types';
import { api } from '@/lib/api';
import { useDeckStore } from '@/lib/decks-store';
import { compressToPayload, imagesFromClipboard, isImagePayloadSupported } from '@/lib/image';
import { parseOutline } from '@/lib/plan';
import { DEFAULT_SETTINGS, settingsToGenerationOptions, useSettings } from '@/lib/settings';
import { idbDelete, idbGet, idbPut } from '@/lib/idb';
import { Button, Chip, Field, Segmented } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { ImageInput } from './ImageInput';
import { BuildProgress, applyBuildEvent, emptyBuildState, type BuildState } from './BuildProgress';

const MODES: { value: LearningMode; label: string }[] = [
  { value: 'ielts', label: 'IELTS' },
  { value: 'academic', label: 'Academic English' },
  { value: 'general', label: 'General English' },
  { value: 'school', label: 'School' },
  { value: 'exam', label: 'Exam prep' },
  { value: 'custom', label: 'Custom' },
];

const BANDS: IeltsBand[] = ['5.5', '6.0', '6.5', '7.0', '7.5', '8.0+'];
const SKILLS: { value: IeltsSkill; label: string }[] = [
  { value: 'writing', label: 'Writing' },
  { value: 'speaking', label: 'Speaking' },
  { value: 'reading', label: 'Reading' },
  { value: 'listening', label: 'Listening' },
  { value: 'vocabulary', label: 'General vocabulary' },
];

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

interface Draft {
  prompt: string;
  text: string;
  images: ImagePayload[];
  options: GenerationOptions;
  plan: PlanDocument | null;
  savedAt: number;
}

const DRAFT_KEY = 'create';

export function CreateWorkspace({ initialPrompt = '' }: { initialPrompt?: string }) {
  const router = useRouter();
  const toast = useToast();
  const store = useDeckStore();
  const [settings] = useSettings();

  const [stage, setStage] = useState<'compose' | 'plan' | 'building' | 'done'>('compose');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImagePayload[]>([]);
  const [options, setOptions] = useState<GenerationOptions>(() =>
    settingsToGenerationOptions(DEFAULT_SETTINGS),
  );
  const [showOptions, setShowOptions] = useState(false);

  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanDocument | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [outline, setOutline] = useState('');

  const [build, setBuild] = useState<BuildState>(emptyBuildState);
  const [result, setResult] = useState<DeckWithCards | null>(null);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ------------------------------ draft restore ---------------------------- */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('sipium.create-draft');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { prompt?: string };
        if (parsed.prompt && !initialPrompt) setPrompt(parsed.prompt);
      } catch {
        /* ignore */
      }
      sessionStorage.removeItem('sipium.create-draft');
    }

    void idbGet<Draft>('drafts', DRAFT_KEY).then((draft) => {
      if (!draft) return;
      setPrompt(draft.prompt ?? '');
      setText(draft.text ?? '');
      setImages(draft.images ?? []);
      setOptions({ ...options, ...draft.options });
      if (draft.plan) {
        setPlan(draft.plan);
        setOutline(draft.plan.outline);
        setStage('plan');
      }
      setRestored(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOptions((current) => ({ ...current, ...settingsToGenerationOptions(settings) }));
  }, [settings]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!prompt && !text && images.length === 0 && !plan) return;
      void idbPut<Draft>('drafts', DRAFT_KEY, {
        prompt,
        text,
        images,
        options,
        plan,
        savedAt: Date.now(),
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [prompt, text, images, options, plan]);

  const clearDraft = useCallback(async () => {
    await idbDelete('drafts', DRAFT_KEY);
    setPrompt('');
    setText('');
    setImages([]);
    setPlan(null);
    setOutline('');
    setResult(null);
    setBuild(emptyBuildState());
    setStage('compose');
    setRestored(false);
  }, []);

  /* --------------------------------- actions ------------------------------ */

  const source: SourceMaterial = useMemo(() => ({ text, images }), [text, images]);
  const hasMaterial = Boolean(prompt.trim() || text.trim() || images.length > 0);

  const runPlan = useCallback(async () => {
    if (!hasMaterial) {
      toast.push({ message: 'Add some text, a few words, or an image first.', tone: 'error' });
      return;
    }
    setPlanning(true);
    setError(null);
    try {
      const created = await api.plan({ prompt, source, options });
      setPlan(created);
      setOutline(created.outline);
      setStage('plan');
      if (!created.offline && created.warnings.length > 0) {
        toast.push({ message: created.warnings[0], tone: 'info' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The plan could not be created.';
      setError(message);
      toast.push({ message, tone: 'error', action: { label: 'Retry', onClick: () => void runPlan() } });
    } finally {
      setPlanning(false);
    }
  }, [hasMaterial, prompt, source, options, toast]);

  const runBuild = useCallback(
    async (planToBuild?: PlanDocument | null) => {
      const base = planToBuild ?? plan;
      const built = base ? parseOutline({ ...base, outline }) : null;
      if (!hasMaterial) {
        toast.push({ message: 'Add some material first.', tone: 'error' });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setStage('building');
      setError(null);
      setBuild(emptyBuildState());

      try {
        const { deck, stats } = await api.build(
          {
            plan:
              built ??
              ({
                id: 'quick',
                title: 'Quick build',
                summary: prompt || 'Build a deck from this material.',
                steps: [],
                estimates: { cards: options.cardCount, topicGroups: [], difficulty: '', focus: '' },
                outline: '',
                offline: false,
                warnings: [],
              } satisfies PlanDocument),
            source,
            options,
          },
          (event) => setBuild((current) => applyBuildEvent(current, event)),
          controller.signal,
        );
        store.importDeck(deck, deck.cards);
        setResult(deck);
        setStage('done');
        await idbDelete('drafts', DRAFT_KEY);
        toast.push({
          message: `Deck ready — ${stats.cardsCreated} cards${
            stats.duplicatesRemoved ? `, ${stats.duplicatesRemoved} duplicates removed` : ''
          }.`,
          tone: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The build failed.';
        setError(message);
        setStage(plan ? 'plan' : 'compose');
        toast.push({
          message,
          tone: 'error',
          action: { label: 'Try again', onClick: () => void runBuild(base) },
        });
      } finally {
        abortRef.current = null;
      }
    },
    [plan, outline, hasMaterial, prompt, source, options, store, toast],
  );

  const updateOptions = (patch: Partial<GenerationOptions>) => setOptions((current) => ({ ...current, ...patch }));

  /* ---------------------------------- UI ---------------------------------- */

  if (stage === 'building') {
    return (
      <div className="container container--narrow">
        <BuildProgress state={build} cardTarget={plan?.estimates.cards ?? options.cardCount} />
        <div className="row" style={{ marginTop: 16 }}>
          <Button
            variant="ghost"
            onClick={() => {
              abortRef.current?.abort();
              setStage(plan ? 'plan' : 'compose');
              toast.push({ message: 'Build stopped. Your material is still here.', tone: 'info' });
            }}
          >
            Stop
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'done' && result) {
    return (
      <div className="container container--narrow">
        <div className="panel panel--pad-lg">
          <p className="eyebrow">Deck ready</p>
          <h1 className="page-title" style={{ fontSize: 24 }}>
            {result.title}
          </h1>
          <p className="page-sub" style={{ marginBottom: 18 }}>
            {result.description || `${result.cards.length} cards ready to study.`}
          </p>
          <div className="stat-row" style={{ marginBottom: 20 }}>
            <div className="stat">
              <span className="stat__value">{result.cards.length}</span>
              <span className="stat__label">cards</span>
            </div>
            <div className="stat">
              <span className="stat__value">{result.topic || 'General'}</span>
              <span className="stat__label">topic</span>
            </div>
            <div className="stat">
              <span className="stat__value">{new Set(result.cards.map((card) => card.topics[0])).size}</span>
              <span className="stat__label">groups</span>
            </div>
          </div>
          <div className="thumb-strip" style={{ marginBottom: 22 }}>
            {result.cards.slice(0, 14).map((card) => (
              <span key={card.id} className="chip">
                {card.term}
              </span>
            ))}
            {result.cards.length > 14 ? <span className="chip">+{result.cards.length - 14}</span> : null}
          </div>
          <div className="row row--wrap">
            <Link href={`/study?deck=${result.id}`} className="btn btn--primary btn--lg">
              Study deck
            </Link>
            <Link href={`/decks/${result.id}`} className="btn btn--soft btn--lg">
              Open editor
            </Link>
            <Button variant="ghost" size="lg" onClick={() => void clearDraft()}>
              Create another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container container--narrow">
      <h1 className="page-title">Create flashcards</h1>
      <p className="page-sub" style={{ marginBottom: 22 }}>
        Throw in anything you are learning — an article, a word list, a screenshot of your notes. Sipium Flash plans the
        deck first, then builds it card by card.
      </p>

      {restored ? (
        <div className="banner banner--info" style={{ marginBottom: 16 }}>
          <span>Draft restored from this device.</span>
          <button type="button" className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={() => void clearDraft()}>
            Discard
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="banner banner--error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {stage === 'plan' && plan ? (
        <PlanView
          plan={plan}
          outline={outline}
          editing={editingPlan}
          offline={plan.offline}
          onToggleEdit={() => setEditingPlan((value) => !value)}
          onOutlineChange={setOutline}
          onBack={() => setStage('compose')}
          onBuild={() => void runBuild(plan)}
          onReplan={() => void runPlan()}
          replanning={planning}
        />
      ) : (
        <div className="stack stack--lg">
          <div className="panel panel--pad-lg">
            <Field label="Material" htmlFor="create-material">
              <textarea
                id="create-material"
                className="textarea textarea--hero"
                placeholder="Paste text, words, notes, or an article…"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onPaste={(event) => {
                  const files = imagesFromClipboard(event.clipboardData?.items ?? null);
                  if (files.length === 0) return;
                  event.preventDefault();
                  void (async () => {
                    const payloads = await Promise.all(
                      files.slice(0, 6 - images.length).map((file) => compressToPayload(file, file.name)),
                    );
                    setImages((current) => [...current, ...payloads].slice(0, 6));
                    toast.push({ message: `Added ${payloads.length} image${payloads.length === 1 ? '' : 's'}.`, tone: 'success' });
                  })();
                }}
              />
            </Field>

            <div style={{ marginTop: 14 }}>
              <ImageInput images={images} onChange={setImages} />
            </div>

            <div style={{ marginTop: 18 }}>
              <Field label="What are you trying to learn?" hint="Describe the goal in English or Vietnamese.">
                <input
                  className="input input--big"
                  placeholder="e.g. Band 7 vocabulary for environment essays"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </Field>
            </div>

            <div style={{ marginTop: 18 }}>
              <span className="field__label" style={{ display: 'block', marginBottom: 8 }}>
                Focus
              </span>
              <div className="row row--wrap">
                {MODES.map((mode) => (
                  <Chip
                    key={mode.value}
                    tone={options.mode === mode.value ? 'accent' : undefined}
                    onClick={() => updateOptions({ mode: mode.value })}
                  >
                    {mode.label}
                  </Chip>
                ))}
              </div>
            </div>

            {options.mode === 'ielts' ? (
              <div className="grid-2" style={{ marginTop: 18 }}>
                <Field label="Target band">
                  <select
                    className="select"
                    value={options.band}
                    onChange={(event) => updateOptions({ band: event.target.value as IeltsBand })}
                  >
                    <option value="">Any</option>
                    {BANDS.map((band) => (
                      <option key={band} value={band}>
                        {band}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Skill">
                  <select
                    className="select"
                    value={options.skill}
                    onChange={(event) => updateOptions({ skill: event.target.value as IeltsSkill })}
                  >
                    <option value="">General</option>
                    {SKILLS.map((skill) => (
                      <option key={skill.value} value={skill.value}>
                        {skill.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}

            <div className="row row--wrap" style={{ marginTop: 18 }}>
              <Button variant="ghost" size="sm" onClick={() => setShowOptions((value) => !value)}>
                {showOptions ? 'Hide options' : 'More options'}
              </Button>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {options.cardCount} cards · {options.includeVietnamese ? 'Vietnamese + English' : 'English only'}
              </span>
            </div>

            {showOptions ? (
              <div className="stack" style={{ marginTop: 14 }}>
                <div className="grid-2">
                  <Field label={`Number of cards — ${options.cardCount}`}>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      value={options.cardCount}
                      onChange={(event) => updateOptions({ cardCount: Number(event.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </Field>
                  <Field label="Topic (optional)">
                    <select
                      className="select"
                      value={options.topic}
                      onChange={(event) => updateOptions({ topic: event.target.value })}
                    >
                      <option value="">Auto-detect</option>
                      {TOPICS.map((topic) => (
                        <option key={topic} value={topic.toLowerCase()}>
                          {topic}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="row row--wrap">
                  <Chip tone={options.includeVietnamese ? 'accent' : undefined} onClick={() => updateOptions({ includeVietnamese: !options.includeVietnamese })}>
                    Vietnamese explanations
                  </Chip>
                  <Chip tone={options.englishOnly ? 'accent' : undefined} onClick={() => updateOptions({ englishOnly: !options.englishOnly })}>
                    English only
                  </Chip>
                  <Chip tone={options.includeExamples ? 'accent' : undefined} onClick={() => updateOptions({ includeExamples: !options.includeExamples })}>
                    Include examples
                  </Chip>
                  <Chip tone={options.includeCollocations ? 'accent' : undefined} onClick={() => updateOptions({ includeCollocations: !options.includeCollocations })}>
                    Include collocations
                  </Chip>
                  <Chip tone={options.includePronunciation ? 'accent' : undefined} onClick={() => updateOptions({ includePronunciation: !options.includePronunciation })}>
                    Include pronunciation
                  </Chip>
                  <Chip tone={options.includeSynonyms ? 'accent' : undefined} onClick={() => updateOptions({ includeSynonyms: !options.includeSynonyms })}>
                    Include synonyms
                  </Chip>
                </div>
                <Field label="Difficulty">
                  <Segmented
                    value={String(options.difficulty)}
                    onChange={(value) => updateOptions({ difficulty: Number(value) })}
                    options={[
                      { value: '1', label: 'Easy' },
                      { value: '3', label: 'Balanced' },
                      { value: '5', label: 'Hard' },
                    ]}
                  />
                </Field>
                <Field label="Extra instruction for the AI (optional)">
                  <input
                    className="input"
                    placeholder="e.g. focus on verbs used in Task 2 conclusions"
                    value={options.customInstruction}
                    onChange={(event) => updateOptions({ customInstruction: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}

            <div className="divider" />

            <div className="row row--wrap">
              <Button variant="primary" size="lg" loading={planning} onClick={() => void runPlan()} disabled={!hasMaterial}>
                Plan with AI
              </Button>
              <Button variant="soft" size="lg" onClick={() => void runBuild(null)} disabled={!hasMaterial}>
                Build now
              </Button>
              <span className="muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
                Plan first to review and edit what the AI intends to build.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanView({
  plan,
  outline,
  editing,
  offline,
  onToggleEdit,
  onOutlineChange,
  onBack,
  onBuild,
  onReplan,
  replanning,
}: {
  plan: PlanDocument;
  outline: string;
  editing: boolean;
  offline: boolean;
  onToggleEdit: () => void;
  onOutlineChange: (value: string) => void;
  onBack: () => void;
  onBuild: () => void;
  onReplan: () => void;
  replanning: boolean;
}) {
  return (
    <div className="stack">
      <div className="panel panel--pad-lg">
        <p className="eyebrow">Plan</p>
        <h2 className="page-title" style={{ fontSize: 22 }}>
          {plan.title}
        </h2>
        <p className="page-sub">{plan.summary}</p>

        <div className="row row--wrap" style={{ marginTop: 16 }}>
          <Chip tone="accent">{plan.estimates.cards} cards</Chip>
          {plan.estimates.topicGroups.map((group) => (
            <Chip key={group}>{group}</Chip>
          ))}
          <Chip>{plan.estimates.difficulty}</Chip>
          {plan.estimates.focus ? <Chip>{plan.estimates.focus}</Chip> : null}
        </div>

        {offline ? (
          <div className="banner banner--warn" style={{ marginTop: 16 }}>
            No AI provider is configured on this server, so this plan came from the built-in offline engine. It still
            produces real, curated vocabulary — but model-generated plans need a key.
          </div>
        ) : null}

        <div className="divider" />

        {editing ? (
          <Field label="Edit the plan" hint="One step per line. The build follows this list.">
            <textarea className="textarea" style={{ minHeight: 200 }} value={outline} onChange={(event) => onOutlineChange(event.target.value)} />
          </Field>
        ) : (
          <ol className="stack stack--sm" style={{ margin: 0, paddingLeft: 20 }}>
            {(outline || plan.outline)
              .split('\n')
              .filter(Boolean)
              .map((line, index) => (
                <li key={index} style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                  {line.replace(/^\s*\d+[.)]?\s*/, '')}
                </li>
              ))}
          </ol>
        )}

        <div className="divider" />

        <div className="row row--wrap">
          <Button variant="primary" size="lg" onClick={onBuild}>
            Build this plan
          </Button>
          <Button variant={editing ? 'soft' : 'ghost'} size="lg" onClick={onToggleEdit}>
            {editing ? 'Done editing' : 'Edit plan'}
          </Button>
          <Button variant="ghost" size="lg" loading={replanning} onClick={onReplan}>
            Re-plan
          </Button>
          <Button variant="ghost" size="lg" onClick={onBack}>
            Change material
          </Button>
        </div>
      </div>
    </div>
  );
}

export const CREATE_DYNAMIC = 'force-dynamic';
