import path from 'node:path';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT ?? process.env.API_PORT, 8787),
  isProduction: (process.env.NODE_ENV || 'development') === 'production',

  /** Where the Next.js frontend should reach us. */
  selfUrl: process.env.API_PUBLIC_URL || `http://127.0.0.1:${num(process.env.API_PORT, 8787)}`,

  /** Shared secret required on internal calls (optional in dev). */
  internalKey: process.env.REPLIT_API_KEY || '',

  database: {
    url: process.env.DATABASE_URL || '',
    /** Embedded PostgreSQL data directory, used when DATABASE_URL is absent. */
    embeddedDir: process.env.PGLITE_DATA_DIR || path.join(process.cwd(), '.pgdata'),
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'auto') as 'auto' | 'xkiro' | 'minimax',
    allowOfflineFallback: bool(process.env.AI_ALLOW_OFFLINE_FALLBACK, true),
    requestTimeoutMs: num(process.env.AI_TIMEOUT_MS, 120_000),
    xkiro: {
      apiKey: process.env.XKIRO_API_KEY || '',
      baseUrl: (process.env.XKIRO_BASE_URL || 'https://api.xkiro.com/v1').replace(/\/+$/, ''),
      model: process.env.XKIRO_MODEL || 'minimax-m3',
    },
    minimax: {
      apiKey: process.env.MINIMAX_API_KEY || '',
      baseUrl: (process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1').replace(/\/+$/, ''),
      model: process.env.MINIMAX_MODEL || 'MiniMax-M3',
    },
    visionModel: process.env.AI_VISION_MODEL || '',
  },

  limits: {
    aiPerMinute: num(process.env.AI_RATE_LIMIT_PER_MIN, 12),
    publishPerMinute: num(process.env.PUBLISH_RATE_LIMIT_PER_MIN, 6),
    readPerMinute: num(process.env.READ_RATE_LIMIT_PER_MIN, 240),
    maxImageBytes: num(process.env.MAX_IMAGE_BYTES, 8_000_000),
    maxBodyBytes: num(process.env.MAX_BODY_BYTES, 2_000_000),
    maxCardsPerDeck: 500,
  },

  corsOrigin: process.env.CORS_ORIGIN || '*',
};

export type AppConfig = typeof config;
