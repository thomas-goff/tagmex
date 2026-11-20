// No `server-only` here so local scripts (seed, backfill) can open their own connection. The app's
// shared instance lives in ./index.ts.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { queryLogEnabled, record } from './query-log';

// The database or an open transaction: both run queries the same way.
export type Database = PgDatabase<PostgresJsQueryResultHKT>;

// How many connections one instance may open. It has to be more than 1: every page loads its data
// with Promise.all, and on a single connection those queries queue behind each other, so each one
// costs a full round trip and the concurrency is decorative. Measured against a database 10ms away
// (scripts/perf/latency-proxy.ts), going from 1 to 4 took the savings page from 224ms to 68ms.
// Connections are opened lazily and dropped after `idle_timeout`, so a quiet instance still holds
// none, which is what the transaction pooler needs.
const MAX_CONNECTIONS = 4;

// Transaction pooler requires prepare: false.
export function createDb(url: string) {
  const client = postgres(url, {
    prepare: false,
    max: MAX_CONNECTIONS,
    // Seconds. A serverless instance is frozen between requests; holding connections open past
    // that just occupies pooler slots other instances need.
    idle_timeout: 20,
    ...(queryLogEnabled() ? { debug: logQuery } : {}),
  });
  return { db: drizzle({ client }), close: () => client.end() };
}

// postgres.js calls this as each statement goes out, so there is no duration to take here: the
// count and the shape are what find a duplicate read or an N+1. Wall time is measured per block.
function logQuery(_conn: number, query: string) {
  record(query);
}
