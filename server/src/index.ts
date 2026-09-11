import cors from 'cors';
import express from 'express';
import { config } from './config';
import { connectAndMigrate } from './db';
import { logger } from './logger';
import { errorMiddleware, notFoundMiddleware } from './middleware/validate';
import { createApiRouter } from './routes';

async function main() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), credentials: false }));
  app.use(
    express.json({
      limit: `${Math.ceil((config.limits.maxImageBytes * 1.5 + 2_000_000) / 1_000_000)}mb`,
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  app.get('/', (_req, res) => {
    res.json({ service: 'sipium-flash-api', ok: true, docs: '/api/health' });
  });

  app.use('/api', createApiRouter());

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  await connectAndMigrate();

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('api listening', { port: config.port, env: config.env });
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('failed to start api', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
