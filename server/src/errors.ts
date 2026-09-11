/**
 * One error type for the whole API. `publicMessage` is safe to show a user,
 * `code` drives UI behaviour (retry, offline banner, rate limit, ...).
 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'AI_MALFORMED_RESPONSE'
  | 'DATABASE_ERROR'
  | 'NOT_CONFIGURED'
  | 'INTERNAL';

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  AI_MALFORMED_RESPONSE: 502,
  DATABASE_ERROR: 503,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly publicMessage: string;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    publicMessage: string,
    options: { details?: unknown; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(publicMessage);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = publicMessage;
    this.details = options.details;
    this.retryable =
      options.retryable ??
      ['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'AI_MALFORMED_RESPONSE', 'DATABASE_ERROR', 'RATE_LIMITED'].includes(
        code,
      );
    if (options.cause) {
      (this as unknown as { cause?: unknown }).cause = options.cause;
    }
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError('BAD_REQUEST', message, { details });
export const notFound = (message = 'Not found') => new ApiError('NOT_FOUND', message);
export const forbidden = (message = 'Not allowed') => new ApiError('FORBIDDEN', message);
export const tooLarge = (message = 'That request is too large.') =>
  new ApiError('PAYLOAD_TOO_LARGE', message);
export const rateLimited = (message = 'Too many requests. Give it a moment and try again.') =>
  new ApiError('RATE_LIMITED', message);
export const notConfigured = (message: string) => new ApiError('NOT_CONFIGURED', message);
export const databaseError = (message = 'The database is unavailable right now.', cause?: unknown) =>
  new ApiError('DATABASE_ERROR', message, { cause });
export const upstreamTimeout = (message: string) => new ApiError('UPSTREAM_TIMEOUT', message);
export const upstreamError = (message: string, cause?: unknown) =>
  new ApiError('UPSTREAM_ERROR', message, { cause });

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError('INTERNAL', 'Something went wrong on our side.', {
    details: { message },
    cause: error,
  });
}
