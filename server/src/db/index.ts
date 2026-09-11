import { config } from '../config';
import { ApiError, databaseError } from '../errors';
import { logger } from '../logger';
import { MIGRATIONS } from './migrations';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Driver extends Queryable {
  readonly name: 'postgres' | 'embedded';
  /** Run multi-statement SQL (migrations only). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* --------------------------------- pg ------------------------------------ */

async function createPostgresDriver(url: string): Promise<Driver> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg') as typeof import('pg');
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: /sslmode=require|ssl=true/.test(url) ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err: Error) => logger.error('postgres pool error', { message: err.message }));

  const wrap = async (fn: () => Promise<QueryResult<any>>): Promise<QueryResult<any>> => {
    try {
      return await fn();
    } catch (error) {
      throw databaseError('The database is unavailable right now.', error);
    }
  };

  return {
    name: 'postgres',
    exec: async (sql) => {
      try {
        await pool.query(sql);
      } catch (error) {
        throw databaseError('The database is unavailable right now.', error);
      }
    },
    query: (text, params) => wrap(() => pool.query(text, params as any[]).then((r) => ({ rows: r.rows, rowCount: r.rowCount ?? r.rows.length }))),
    async transaction(fn) {
      const client = await pool.connect().catch((error: unknown) => {
        throw databaseError('The database is unavailable right now.', error);
      });
      try {
        await client.query('begin');
        const result = await fn({
          query: (text, params) =>
            client.query(text, params as any[]).then((r) => ({ rows: r.rows, rowCount: r.rowCount ?? r.rows.length })),
        });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error instanceof ApiError ? error : databaseError('The database transaction failed.', error);
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end().catch(() => undefined);
    },
  };
}

/* ------------------------------- embedded -------------------------------- */

async function createEmbeddedDriver(dataDir: string): Promise<Driver> {
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;

  const normalise = (res: { rows: any[]; affectedRows?: number }): QueryResult<any> => ({
    rows: res.rows ?? [],
    rowCount: typeof res.affectedRows === 'number' ? res.affectedRows : (res.rows?.length ?? 0),
  });

  const wrap = async (fn: () => Promise<QueryResult<any>>): Promise<QueryResult<any>> => {
    try {
      return await fn();
    } catch (error) {
      throw databaseError('The database is unavailable right now.', error);
    }
  };

  return {
    name: 'embedded',
    exec: async (sql) => {
      try {
        await db.exec(sql);
      } catch (error) {
        throw databaseError('The database is unavailable right now.', error);
      }
    },
    query: (text, params) =>
      wrap(() => db.query(text, params as any[]).then(normalise as any)),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      try {
        let result: T | undefined;
        await db.transaction(async (tx) => {
          result = await fn({
            query: (text, params) => tx.query(text, params as any[]).then(normalise as any),
          });
        });
        return result as T;
      } catch (error) {
        throw error instanceof ApiError ? error : databaseError('The database transaction failed.', error);
      }
    },
    async close() {
      await db.close().catch(() => undefined);
    },
  };
}

/* --------------------------------- api ----------------------------------- */

let driver: Driver | null = null;
let migrationPromise: Promise<Driver> | null = null;

export async function connectAndMigrate(): Promise<Driver> {
  if (driver) return driver;
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const created = config.database.url
      ? await createPostgresDriver(config.database.url)
      : await createEmbeddedDriver(config.database.embeddedDir);

    await created.query(`create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )`);

    const applied = await created.query<{ id: string }>(`select id from schema_migrations`);
    const set = new Set(applied.rows.map((r) => r.id));

    for (const migration of MIGRATIONS) {
      if (set.has(migration.id)) continue;
      await created.exec(migration.sql);
      await created.query(`insert into schema_migrations (id) values ($1) on conflict do nothing`, [
        migration.id,
      ]);
      logger.info('migration applied', { id: migration.id });
    }

    driver = created;
    logger.info('database ready', { driver: created.name });
    return created;
  })();

  try {
    return await migrationPromise;
  } catch (error) {
    migrationPromise = null;
    throw error;
  }
}

export async function getDb(): Promise<Driver> {
  if (!driver) return connectAndMigrate();
  return driver;
}

export async function dbHealth(): Promise<{ ok: boolean; driver: 'postgres' | 'embedded'; latencyMs: number; detail?: string }> {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.query(`select 1 as ok`);
    return { ok: true, driver: db.name, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      driver: config.database.url ? ('postgres' as const) : ('embedded' as const),
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
