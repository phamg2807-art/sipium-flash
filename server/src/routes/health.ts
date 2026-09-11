import { Router } from 'express';
import type { HealthReport } from '@shared/types';
import { config } from '../config';
import { describeAi, getProvider } from '../ai/gateway';
import { dbHealth } from '../db';
import { handler } from '../middleware/validate';

const startedAt = Date.now();

export const healthRouter = Router();

healthRouter.get(
  '/health',
  handler(async (_req, res) => {
    const [database, ai] = await Promise.all([dbHealth(), describeAi()]);
    const provider = getProvider();
    const upstream = provider?.configured ? await provider.health() : { ok: false, detail: 'no provider configured' };

    const report: HealthReport = {
      ok: database.ok,
      service: 'sipium-flash-api',
      version: '0.1.0',
      time: new Date().toISOString(),
      database,
      ai: {
        ok: ai.ok && (upstream.ok || !ai.configured),
        provider: ai.provider,
        model: ai.model,
        configured: ai.configured,
        vision: ai.vision,
        detail: ai.configured ? (upstream.ok ? `Connected to ${provider?.label}.` : upstream.detail) : ai.detail,
      },
      env: {
        replitApiUrl: Boolean(process.env.REPLIT_API_URL),
        databaseUrl: Boolean(config.database.url),
      },
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    res.status(report.ok ? 200 : 503).json(report);
  }),
);
