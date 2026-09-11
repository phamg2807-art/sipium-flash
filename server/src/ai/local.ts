/**
 * Deterministic offline engine.
 *
 * This is NOT a model. It runs when no AI provider key is configured so the
 * product still works end to end. Everything it produces is derived from the
 * curated lexicon; content it cannot produce honestly is flagged as
 * `needsEnrichment` instead of being invented. The API reports
 * `configured: false` whenever this engine is in use so the UI can say so.
 */
import type { CardInput } from '@shared/schema';
import type { Curiosity, GenerationOptions, LearningMode } from '@shared/types';
import { LEXICON, LEXICON_BY_WORD, STOPWORDS, TOPIC_KEYWORDS, type LexEntry } from './lexicon';

export const OFFLINE_NOTICE =
  'No AI provider is configured on this server, so the offline engine is building from the built-in academic vocabulary core.';

const PENDING = (term: string) =>
  `Enrichment pending — connect an AI provider to generate a definition and example for “${term}”.`;

/* ------------------------------- text utils ------------------------------- */

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).map((w) => w.replace(/^[-']+|[-']+$/g, ''));
}

export function detectTopics(text: string): string[] {
  const haystack = text.toLowerCase();
  const scored: { topic: string; score: number }[] = [];
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) score += 1;
    }
    if (score > 0) scored.push({ topic, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.topic);
}

const ACADEMIC_SUFFIXES = [
  'tion', 'sion', 'ment', 'ness', 'ity', 'ance', 'ence', 'ism', 'ist', 'ogy',
  'ate', 'ify', 'ise', 'ize', 'ous', 'ive', 'able', 'ible', 'ical', 'ial', 'ful', 'ent', 'ant',
];

function guessPartOfSpeech(word: string): string {
  if (/(ly)$/.test(word)) return 'adverb';
  if (/(ate|ify|ise|ize|ish)$/.test(word)) return 'verb';
  if (/(tion|sion|ment|ness|ity|ance|ence|ism|ogy|ics|sia)$/.test(word)) return 'noun';
  if (/(ous|ive|able|ible|ical|ial|ful|ent|ant|ic|al)$/.test(word)) return 'adjective';
  return '';
}

function academicScore(word: string): number {
  let score = 0;
  if (word.length >= 7) score += 1;
  if (word.length >= 9) score += 1;
  if (ACADEMIC_SUFFIXES.some((s) => word.endsWith(s))) score += 2;
  if (/^[A-Z]/.test(word)) score += 0.5;
  return score;
}

/* ---------------------------- vocabulary choice --------------------------- */

export interface TermPick {
  term: string;
  entry?: LexEntry;
  score: number;
}

/**
 * Choose the words actually worth learning from the source material.
 * Priority: words in the curated lexicon > academic-looking unknown words >
 * topic-bank filler so a short prompt still produces a useful deck.
 */
export function pickTerms(params: {
  text: string;
  prompt: string;
  options: Partial<GenerationOptions>;
  limit: number;
}): TermPick[] {
  const { text, prompt, options, limit } = params;
  const combined = `${prompt}\n${text}`;
  const topics = detectTopics(combined);
  const wanted = options.topic ? [options.topic.toLowerCase()] : topics;

  const seen = new Set<string>();
  const picks: TermPick[] = [];

  // 1. Lexicon words that actually appear in the material.
  for (const word of tokenize(text)) {
    if (seen.has(word) || STOPWORDS.has(word)) continue;
    const entry = LEXICON_BY_WORD.get(word);
    if (!entry) continue;
    seen.add(word);
    picks.push({ term: entry.w, entry, score: 10 + entry.i });
  }

  // 2. Academic-looking words from the material that we do not know yet.
  const unknown: TermPick[] = [];
  for (const word of tokenize(text)) {
    if (seen.has(word) || STOPWORDS.has(word)) continue;
    const score = academicScore(word);
    if (score < 2) continue;
    seen.add(word);
    unknown.push({ term: word, score });
  }
  unknown.sort((a, b) => b.score - a.score);
  picks.push(...unknown);

  // 3. Topic-bank filler from the curated core.
  const fillers = LEXICON.filter((entry) => {
    if (seen.has(entry.w)) return false;
    if (wanted.length === 0) return true;
    return entry.t.some((t) => wanted.includes(t));
  }).sort((a, b) => b.i - a.i || a.d - b.d);
  for (const entry of fillers) {
    if (picks.length >= limit) break;
    seen.add(entry.w);
    picks.push({ term: entry.w, entry, score: 5 + entry.i });
  }

  return picks.slice(0, Math.max(limit, 0));
}

/* -------------------------------- enrichment ------------------------------ */

export function enrichTerm(term: string): CardInput & { needsEnrichment: boolean } {
  const key = term.trim().toLowerCase();
  const entry = LEXICON_BY_WORD.get(key);
  if (entry) {
    return {
      term: entry.w,
      definition: entry.def,
      vietnameseMeaning: entry.vi,
      partOfSpeech: entry.pos,
      pronunciation: entry.ipa,
      exampleSentences: [entry.ex],
      collocations: entry.col.slice(0, 3),
      synonyms: entry.syn.filter((s) => s !== '—'),
      antonyms: entry.ant.filter((s) => s !== '—'),
      relatedWords: [],
      topics: entry.t,
      difficulty: entry.d,
      ieltsRelevance: entry.i,
      source: 'offline',
      needsEnrichment: false,
    };
  }

  const pos = guessPartOfSpeech(key);
  return {
    term: key,
    definition: PENDING(term),
    vietnameseMeaning: '',
    partOfSpeech: pos,
    pronunciation: '',
    exampleSentences: [],
    collocations: [],
    synonyms: [],
    antonyms: [],
    relatedWords: [],
    topics: detectTopics(term),
    difficulty: 3,
    ieltsRelevance: 2,
    source: 'offline',
    needsEnrichment: true,
  };
}

export function relatedWords(term: string, count = 4): string[] {
  const entry = LEXICON_BY_WORD.get(term.toLowerCase());
  const out = new Set<string>();
  if (entry) {
    entry.syn.forEach((w) => w !== '—' && out.add(w));
    entry.ant.forEach((w) => w !== '—' && out.add(w));
    const topic = entry.t[0];
    if (topic) {
      for (const other of LEXICON) {
        if (out.size >= count) break;
        if (other.w !== entry.w && other.t.includes(topic) && other.i >= 4) out.add(other.w);
      }
    }
  }
  return [...out].slice(0, count);
}

export function makeExample(term: string, pos: string): string {
  const entry = LEXICON_BY_WORD.get(term.toLowerCase());
  if (entry) return entry.ex;
  if (pos === 'verb') return `Many researchers ${term} the results before publishing them.`;
  if (pos === 'adjective') return `The ${term} effects were visible within a year.`;
  if (pos === 'adverb') return `The policy was, ${term}, applied unevenly across regions.`;
  return `The report discusses ${term} in the context of higher education.`;
}

export function makeCollocations(term: string): string[] {
  const entry = LEXICON_BY_WORD.get(term.toLowerCase());
  if (entry) return entry.col;
  return [`${term} of`, `the ${term} of`, `${term} in practice`];
}

/* ---------------------------------- quiz ---------------------------------- */

export interface Quiz {
  questionType: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export function makeQuiz(card: { term: string; definition: string; vietnameseMeaning: string }): Quiz | null {
  const entry = LEXICON_BY_WORD.get(card.term.toLowerCase());
  const correct = card.vietnameseMeaning || entry?.vi || card.definition;
  if (!correct) return null;
  const distractors = LEXICON.filter((e) => e.w !== card.term && e.vi && e.pos === (entry?.pos ?? ''))
    .slice(0, 12)
    .map((e) => e.vi);
  // Keep the correct answer in the pool before shuffling, never after.
  const options = shuffleUnique([correct, ...distractors].slice(0, 4));
  if (options.length < 2) return null;
  return {
    questionType: 'multiple-choice',
    prompt: `What does “${card.term}” mean?`,
    options,
    answerIndex: options.indexOf(correct),
    explanation: entry ? entry.ex : card.definition,
  };
}

function shuffleUnique<T>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (!out.includes(item)) out.push(item);
  }
  // Deterministic shuffle (no Math.random) so results are reproducible.
  return out
    .map((value, index) => ({ value, weight: ((index + 7) * 31) % 97 }))
    .sort((a, b) => a.weight - b.weight)
    .map((x) => x.value);
}

/* ------------------------------- curiosity -------------------------------- */

export function makeCuriosity(card: {
  term: string;
  definition: string;
  synonyms: string[];
  antonyms: string[];
  topics: string[];
}): Curiosity | null {
  const entry = LEXICON_BY_WORD.get(card.term.toLowerCase());
  if (!entry) return null;
  const contrast = LEXICON.find(
    (e) => e.w !== entry.w && e.t.includes(entry.t[0] ?? '') && (entry.ant.includes(e.w) || entry.syn.includes(e.w)),
  );

  if (contrast) {
    const isAntonym = entry.ant.includes(contrast.w);
    return {
      kind: isAntonym ? 'contrast' : 'common-mistake',
      title: isAntonym ? `Contrast: ${contrast.w}` : `Don't confuse with "${contrast.w}"`,
      body: isAntonym
        ? `“${entry.w}” (${entry.vi}) and “${contrast.w}” (${contrast.vi}) point in opposite directions. Choose carefully in writing.`
        : `“${entry.w}” and “${contrast.w}” are close in meaning, but they are not always interchangeable: “${entry.w}” ${entry.def.toLowerCase()}`,
      compareWith: contrast.w,
    };
  }

  if (entry.col[0]) {
    return {
      kind: 'ielts-tip',
      title: 'IELTS tip',
      body: `Use “${entry.w}” with “${entry.col[0]}” — examiners reward natural collocations over rare words.`,
    };
  }

  return {
    kind: 'interesting-usage',
    title: 'Interesting usage',
    body: entry.ex,
  };
}

/* --------------------------------- plans ---------------------------------- */

export function makePlan(params: {
  prompt: string;
  text: string;
  hasImages: boolean;
  options: Partial<GenerationOptions>;
  limit: number;
}): {
  title: string;
  summary: string;
  steps: { title: string; detail: string; kind: string }[];
  topicGroups: string[];
  difficulty: string;
  focus: string;
} {
  const { prompt, text, hasImages, options, limit } = params;
  const topics = detectTopics(`${prompt}\n${text}`);
  const topicGroups = topics.length > 0 ? topics.slice(0, 3) : ['general academic'];
  const mode: LearningMode = options.mode ?? 'general';
  const focusParts: string[] = [];
  focusParts.push(mode === 'ielts' ? `IELTS ${options.band ? `band ${options.band} ` : ''}${options.skill || 'vocabulary'}` : mode);
  if (topicGroups[0] && topicGroups[0] !== 'general academic') focusParts.push(topicGroups[0]);
  if (options.englishOnly) focusParts.push('English-only definitions');
  else focusParts.push('Vietnamese meanings');

  const steps = [
    hasImages
      ? { title: 'Analyse the image', detail: 'Find the learning material in the image and ignore decoration.', kind: 'analyze' }
      : { title: 'Analyse the source', detail: 'Read the material and decide what is worth learning.', kind: 'analyze' },
    { title: 'Extract useful vocabulary', detail: 'Keep academic and topic-relevant items, skip obvious words.', kind: 'extract' },
    { title: 'Remove common words and duplicates', detail: 'Drop stopwords and near-duplicate entries.', kind: 'filter' },
    {
      title: mode === 'ielts' ? 'Prioritise IELTS-relevant terms' : 'Prioritise high-utility terms',
      detail: mode === 'ielts' ? 'Rank by usefulness for writing and speaking tasks.' : 'Rank by everyday academic usefulness.',
      kind: 'prioritize',
    },
    { title: 'Group vocabulary by topic', detail: `Groups: ${topicGroups.join(', ')}.`, kind: 'group' },
    options.englishOnly
      ? null
      : { title: 'Add Vietnamese meanings', detail: 'Short, accurate glosses for Vietnamese learners.', kind: 'translate' },
    options.includeExamples === false
      ? null
      : { title: 'Add contextual examples', detail: 'One natural sentence per card.', kind: 'examples' },
    options.includeCollocations === false
      ? null
      : { title: 'Add collocations', detail: 'Two to three natural word partners per card.', kind: 'collocations' },
    { title: 'Estimate difficulty and IELTS relevance', detail: 'Calibrate 1–5 for both scales.', kind: 'calibrate' },
    { title: `Build about ${limit} cards`, detail: 'Create the deck through the flashcard tools.', kind: 'build' },
    { title: 'Validate the generated cards', detail: 'Check required fields, duplicates and formatting.', kind: 'validate' },
  ].filter(Boolean) as { title: string; detail: string; kind: string }[];

  const difficultyLabel =
    (options.difficulty ?? 3) <= 2 ? 'Beginner-friendly' : (options.difficulty ?? 3) >= 4 ? 'Advanced' : 'Intermediate';

  return {
    title:
      topicGroups[0] && topicGroups[0] !== 'general academic'
        ? `${capitalise(topicGroups[0])} vocabulary — ${limit} cards`
        : `Study set — ${limit} cards`,
    summary: `Turn this material into about ${limit} useful cards for ${focusParts[0]}. Trivial words are dropped, the rest are grouped by topic and enriched with meanings, examples and collocations.`,
    steps,
    topicGroups,
    difficulty: difficultyLabel,
    focus: focusParts.join(' · '),
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
