import { Router } from 'express';
import { aiRouter } from './ai';
import { decksRouter } from './decks';
import { healthRouter } from './health';
import { publicRouter } from './public';
import { studyRouter } from './study';

export function createApiRouter(): Router {
  const router = Router();
  router.use(healthRouter);
  router.use(aiRouter);
  router.use(decksRouter);
  router.use(studyRouter);
  router.use(publicRouter);
  return router;
}
