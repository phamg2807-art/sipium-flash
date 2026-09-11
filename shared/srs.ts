/**
 * Sipium Flash — spaced repetition scheduler.
 *
 * Deterministic, dependency-free, and shared by the client (for optimistic UI
 * and offline study) and the server (source of truth). Given the same inputs it
 * always produces the same next review — no AI, no randomness.
 *
 * The model is a documented simplification of FSRS (Free Spaced Repetition
 * Scheduler):
 *
 *   memory model     R(t, S) = (1 + F · t / S) ^ C      with F = 19/81, C = -0.5
 *   difficulty       D' = clamp(D - w · (g - 3), 1, 10)
 *   stability        S' = S · (1 + exp(gain) · (11 - D) · S^(-decay) · (exp(k · (1 - R)) - 1))
 *   interval         I  = S · (r ^ (1 / C) - 1) / F     → ≈ S at r = 0.9
 *
 * Every constant below is named so the behaviour can be tuned in one place.
 */

import type { Rating, StudyState } from './types';

export const SRS_CONSTANTS = {
  /** Forgetting-curve factor. */
  F: 19 / 81,
  /** Forgetting-curve decay exponent. */
  C: -0.5,
  /** Requested retention used to turn stability into an interval. */
  REQUESTED_RETENTION: 0.9,
  /** How strongly a rating moves item difficulty (FSRS w6). */
  DIFFICULTY_WEIGHT: 1.2298,
  /** Stability gain scalar (FSRS w8). */
  STABILITY_GAIN: 1.6474,
  /** Stability decay exponent (FSRS w9). */
  STABILITY_DECAY: 0.1367,
  /** Retrievability sensitivity (FSRS w10). */
  RETRIEVABILITY_GAIN: 1.0461,
  /** Hard-rating multiplier applied to the stability gain. */
  HARD_PENALTY: 0.6,
  /** Easy-rating multiplier applied to the stability gain. */
  EASY_BONUS: 1.25,
  /** Stability retained after a lapse ("Again"). */
  LAPSE_STABILITY_FACTOR: 0.2,
  /** Floor for stability after a lapse, in days. */
  MIN_LAPSE_STABILITY: 0.2,
  /** Minimum interval for a successful review, in days. */
  MIN_INTERVAL: 1,
  /** Interval handed back after "Again" (10 minutes, in days). */
  AGAIN_INTERVAL_DAYS: 10 / (24 * 60),
  /** Stability handed to a brand-new card, indexed by rating. */
  INITIAL_STABILITY: [0.4, 1.2, 3.0, 5.5] as [number, number, number, number],
  /** Difficulty handed to a brand-new card, indexed by rating. */
  INITIAL_DIFFICULTY: [7.5, 6.2, 5.0, 3.8] as [number, number, number, number],
};

export const RATING_INDEX: Record<Rating, number> = {
  again: 0,
  hard: 1,
  good: 2,
  easy: 3,
};

export const RATING_SCORE: Record<Rating, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Probability of recalling an item after `elapsedDays` given stability `stability`. */
export function retrievability(stability: number, elapsedDays: number): number {
  const s = Math.max(stability, 0.01);
  const t = Math.max(elapsedDays, 0);
  return Math.pow(1 + (SRS_CONSTANTS.F * t) / s, SRS_CONSTANTS.C);
}

/** Turn a stability value into an interval (days) at the requested retention. */
export function intervalFromStability(stability: number, retention = SRS_CONSTANTS.REQUESTED_RETENTION): number {
  const raw =
    (stability * (Math.pow(retention, 1 / SRS_CONSTANTS.C) - 1)) / SRS_CONSTANTS.F;
  return Math.max(raw, SRS_CONSTANTS.AGAIN_INTERVAL_DAYS);
}

export function nextDifficulty(difficulty: number, rating: Rating): number {
  const g = RATING_SCORE[rating];
  const d = difficulty - SRS_CONSTANTS.DIFFICULTY_WEIGHT * (g - 3);
  // Mean-reversion towards 5 keeps difficulty from drifting to an extreme.
  const reverted = d + (5 - d) * 0.05;
  return clamp(reverted, 1, 10);
}

export function nextStability(
  stability: number,
  difficulty: number,
  rating: Rating,
  retrievabilityValue: number,
): number {
  const g = RATING_SCORE[rating];
  if (g === 1) {
    return Math.max(
      stability * SRS_CONSTANTS.LAPSE_STABILITY_FACTOR,
      SRS_CONSTANTS.MIN_LAPSE_STABILITY,
    );
  }
  const hardPenalty = g === 2 ? SRS_CONSTANTS.HARD_PENALTY : 1;
  const easyBonus = g === 4 ? SRS_CONSTANTS.EASY_BONUS : 1;
  const growth =
    Math.exp(SRS_CONSTANTS.STABILITY_GAIN) *
    (11 - difficulty) *
    Math.pow(Math.max(stability, 0.1), -SRS_CONSTANTS.STABILITY_DECAY) *
    (Math.exp(SRS_CONSTANTS.RETRIEVABILITY_GAIN * (1 - retrievabilityValue)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(stability * (1 + growth), SRS_CONSTANTS.MIN_LAPSE_STABILITY);
}

export interface ScheduleInput {
  /** Existing study state, or null/undefined for a card seen for the first time. */
  state?: StudyState | null;
  rating: Rating;
  /** Wall-clock time of the review (defaults to now). */
  now?: Date;
}

export interface ScheduleResult {
  ease: number;
  difficulty: number;
  stability: number;
  intervalDays: number;
  nextReview: string;
  reviewCount: number;
  correctCount: number;
  incorrectCount: number;
  lapses: number;
  retrievability: number;
}

/**
 * Apply a review to a study state and return the resulting scheduling values.
 * Pure: never mutates the input state.
 */
export function schedule(input: ScheduleInput): ScheduleResult {
  const now = input.now ?? new Date();
  const { rating } = input;
  const state = input.state ?? null;

  const isNew = !state || state.reviewCount === 0;
  const g = RATING_SCORE[rating];

  let difficulty: number;
  let stability: number;

  if (isNew) {
    difficulty = SRS_CONSTANTS.INITIAL_DIFFICULTY[RATING_INDEX[rating]];
    stability = SRS_CONSTANTS.INITIAL_STABILITY[RATING_INDEX[rating]];
  } else {
    const elapsedDays = state.lastReviewed
      ? Math.max((now.getTime() - new Date(state.lastReviewed).getTime()) / 86_400_000, 0)
      : 0;
    const r = retrievability(state.stability, elapsedDays);
    difficulty = nextDifficulty(state.difficulty, rating);
    stability = g === 1 ? nextStability(state.stability, difficulty, rating, r) : nextStability(state.stability, difficulty, rating, r);
  }

  let intervalDays = intervalFromStability(stability);
  if (g === 1) {
    intervalDays = SRS_CONSTANTS.AGAIN_INTERVAL_DAYS;
  } else {
    intervalDays = Math.max(intervalDays, SRS_CONSTANTS.MIN_INTERVAL);
    if (rating === 'hard') {
      intervalDays = Math.max(intervalDays * 0.7, SRS_CONSTANTS.MIN_INTERVAL);
    }
  }

  const nextReview = new Date(now.getTime() + intervalDays * 86_400_000);
  const correct = g >= 2;
  const ease = clamp(
    state && state.reviewCount > 0
      ? state.ease + (0.1 - (4 - g) * 0.08 - (g === 1 ? 0.2 : 0))
      : 2.5,
    1.3,
    2.9,
  );

  return {
    ease: Number(ease.toFixed(4)),
    difficulty: Number(difficulty.toFixed(4)),
    stability: Number(stability.toFixed(4)),
    intervalDays: Number(intervalDays.toFixed(6)),
    nextReview: nextReview.toISOString(),
    reviewCount: (state?.reviewCount ?? 0) + 1,
    correctCount: (state?.correctCount ?? 0) + (correct ? 1 : 0),
    incorrectCount: (state?.incorrectCount ?? 0) + (correct ? 0 : 1),
    lapses: (state?.lapses ?? 0) + (g === 1 ? 1 : 0),
    retrievability: Number(retrievability(stability, intervalDays).toFixed(4)),
  };
}

/** Human-readable interval, e.g. "10m", "3d", "2.4mo". */
export function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** True when a card is due for review right now. */
export function isDue(state: StudyState | null | undefined, now: Date = new Date()): boolean {
  if (!state) return true;
  if (!state.nextReview) return true;
  return new Date(state.nextReview).getTime() <= now.getTime();
}

/** Sort key for a study queue: due first, then least-retrievable. */
export function queueScore(state: StudyState | null | undefined, now: Date = new Date()): number {
  if (!state || !state.nextReview) return Number.NEGATIVE_INFINITY;
  const elapsedDays = (now.getTime() - new Date(state.nextReview).getTime()) / 86_400_000;
  return elapsedDays;
}

export function createEmptyStudyState(
  cardId: string,
  deckId: string,
  ownerKey: string,
): StudyState {
  const now = new Date().toISOString();
  return {
    cardId,
    deckId,
    ownerKey,
    ease: 2.5,
    difficulty: 5,
    stability: 0,
    intervalDays: 0,
    lastReviewed: null,
    nextReview: null,
    reviewCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    averageResponseTime: 0,
    lapses: 0,
    updatedAt: now,
  };
}
