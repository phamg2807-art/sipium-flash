import type { NextFunction, Request, Response } from 'express';
import { rateLimited } from '../errors';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

/** Simple in-process token bucket. Good enough for a single API instance. */
export function rateLimit(bucket: string, perMinute: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${bucket}:${clientKey(req)}`;
    const now = Date.now();
    const state = buckets.get(key) ?? { tokens: perMinute, updatedAt: now };
    const refill = ((now - state.updatedAt) / WINDOW_MS) * perMinute;
    state.tokens = Math.min(perMinute, state.tokens + refill);
    state.updatedAt = now;

    if (state.tokens < 1) {
      buckets.set(key, state);
      next(rateLimited());
      return;
    }
    state.tokens -= 1;
    buckets.set(key, state);
    next();
  };
}

function clientKey(req: Request): string {
  const owner = req.header('x-sipium-key');
  if (owner && owner.length >= 8) return owner.slice(0, 64);
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return forwarded || req.ip || 'unknown';
}

setInterval(() => {
  const cutoff = Date.now() - 10 * WINDOW_MS;
  for (const [key, value] of buckets) {
    if (value.updatedAt < cutoff) buckets.delete(key);
  }
}, WINDOW_MS).unref?.();
