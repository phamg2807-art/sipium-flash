import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { ApiError, toApiError } from '../errors';
import { logger } from '../logger';

/** Wrap an async handler so rejections reach the error middleware. */
export function handler(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError('VALIDATION', 'That request does not look right.', {
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/**
 * Anonymous identity. There is no login anywhere in this product: the browser
 * generates an installation key, and the server falls back to one derived from
 * the request so the API still works for direct calls.
 */
export function resolveOwner(req: Request, body?: unknown): string {
  const fromBody = (body as { ownerKey?: unknown } | undefined)?.ownerKey;
  const fromHeader = req.header('x-sipium-key');
  const candidate =
    typeof fromBody === 'string' && fromBody.length >= 8
      ? fromBody
      : typeof fromHeader === 'string' && fromHeader.length >= 8
        ? fromHeader
        : '';
  const clean = candidate.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  return clean.length >= 8 ? clean : `anon-${stableHash(clientFingerprint(req))}`;
}

function clientFingerprint(req: Request): string {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || 'local';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function errorMiddleware(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(error);
    return;
  }
  const apiError = toApiError(error);
  if (apiError.code === 'INTERNAL') {
    logger.error('unhandled route error', {
      path: req.originalUrl,
      method: req.method,
      message: apiError.publicMessage,
      details: apiError.details,
    });
  } else {
    logger.warn('request rejected', {
      path: req.originalUrl,
      code: apiError.code,
      message: apiError.publicMessage,
    });
  }
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.publicMessage,
      retryable: apiError.retryable,
      ...(apiError.details && process.env.NODE_ENV !== 'production' ? { details: apiError.details } : {}),
    },
  });
}

export function notFoundMiddleware(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.', retryable: false } });
}
