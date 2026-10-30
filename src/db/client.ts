// No `server-only` here so local scripts (seed, backfill) can open their own connection. The app's
// shared instance lives in ./index.ts.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

// The database or an open transaction: both run queries the same way.
export type Database = PgDatabase<PostgresJsQueryResultHKT>;

// Transaction pooler requires prepare: false. max: 1 suits serverless.
export function createDb(url: string) {
  const client = postgres(url, { prepare: false, max: 1 });
  return { db: drizzle({ client }), close: () => client.end() };
}
