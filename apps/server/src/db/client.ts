import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

function findMigrationsDir(explicit?: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, resolve(here, '../drizzle'), resolve(here, '../../drizzle')].filter(
    (p): p is string => Boolean(p),
  );
  const found = candidates.find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`Migrations folder not found (looked in: ${candidates.join(', ')})`);
  return found;
}

/**
 * Opens the database. `postgres://…` uses PostgreSQL via postgres.js (production).
 * `pglite:memory` or `pglite:/path` uses an embedded PGlite instance (development & tests only).
 */
export async function openDatabase(url: string, migrationsDir?: string): Promise<DatabaseHandle> {
  const migrationsFolder = findMigrationsDir(migrationsDir);

  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const target = url.slice('pglite:'.length);
    const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target);
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as Database,
      migrate: () => migrate(db, { migrationsFolder }),
      close: () => client.close(),
    };
  }

  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Database,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.end({ timeout: 5 }),
  };
}

/** Normalizes `db.execute()` results across drivers (postgres.js returns rows, PGlite returns { rows }). */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
