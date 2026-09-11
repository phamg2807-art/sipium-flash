import { Router } from 'express';
import type { BuildEvent, GenerationOptions } from '@shared/types';
import {
  analyzeImageSchema,
  buildRequestSchema,
  cardActionSchema,
  curiositySchema,
  planRequestSchema,
} from '@shared/schema';
import { config } from '../config';
import { toApiError } from '../errors';
import { rateLimit } from '../middleware/rateLimit';
import { handler, parse, resolveOwner } from '../middleware/validate';
import { describeTools } from '../ai/tools';
import { createPlan, parsePlanOutline } from '../services/plan';
import { runBuild } from '../services/build';
import { runCardAction } from '../services/cards';
import { generateCuriosity } from '../services/curiosity';
import { analyzeImage } from '../services/image';

export const aiRouter = Router();

aiRouter.get(
  '/ai/tools',
  handler(async (_req, res) => {
    res.json({ tools: describeTools() });
  }),
);

aiRouter.post(
  '/ai/plan',
  rateLimit('ai', config.limits.aiPerMinute),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(planRequestSchema, { ...req.body, ownerKey });
    const plan = await createPlan({ prompt: body.prompt, source: body.source, options: body.options as never });
    res.json({ plan });
  }),
);

aiRouter.post(
  '/ai/plan/revise',
  rateLimit('ai', config.limits.aiPerMinute),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(planRequestSchema, { ...req.body, ownerKey });
    const plan = await createPlan({ prompt: body.prompt, source: body.source, options: body.options as never });
    const revised = parsePlanOutline({ ...plan, ...(req.body as { plan?: object }).plan, outline: (req.body as { plan?: { outline?: string } }).plan?.outline ?? plan.outline });
    res.json({ plan: revised });
  }),
);

/** Build mode. Streams real tool/plan events; falls back to a single JSON response. */
aiRouter.post(
  '/ai/build',
  rateLimit('ai', config.limits.aiPerMinute),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(buildRequestSchema, { ...req.body, ownerKey });

    if (req.accepts('text/event-stream') && req.headers.accept?.includes('text/event-stream')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const send = (event: BuildEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        await runBuild({ ...body, options: body.options as GenerationOptions }, send);
      } catch (error) {
        const apiError = toApiError(error);
        send({
          type: 'error',
          at: new Date().toISOString(),
          message: apiError.publicMessage,
          code: apiError.code,
          retryable: apiError.retryable,
        });
      } finally {
        res.end();
      }
      return;
    }

    const { deck, stats } = await runBuild({ ...body, options: body.options as GenerationOptions }, () => undefined);
    res.status(201).json({ deck, stats });
  }),
);

aiRouter.post(
  '/ai/image',
  rateLimit('ai', config.limits.aiPerMinute),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(analyzeImageSchema, { ...req.body, ownerKey });
    const result = await analyzeImage({ image: body.image, intent: body.intent, options: body.options });
    res.json({ analysis: result.analysis, bytes: result.bytes });
  }),
);

aiRouter.post(
  '/ai/card-action',
  rateLimit('ai', config.limits.aiPerMinute * 2),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(cardActionSchema, { ...req.body, ownerKey });
    const result = await runCardAction(body);
    res.json(result);
  }),
);

aiRouter.post(
  '/ai/curiosity',
  rateLimit('ai', config.limits.aiPerMinute * 2),
  handler(async (req, res) => {
    const ownerKey = resolveOwner(req, req.body);
    const body = parse(curiositySchema, { ...req.body, ownerKey });
    const curiosity = await generateCuriosity(body.card, { contrastWith: body.contrastWith });
    res.json({ curiosity });
  }),
);
