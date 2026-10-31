// Runs the drizzle/ migrations at the end of a Vercel production build, so a deploy whose code needs
// a new table fails instead of going live without it. Preview and local builds skip it and never
// open a database connection.
// Usage: runs from `npm run build` (after `next build` succeeds). To migrate by hand, `npm run db:migrate`.
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from '@/db/client';
import journal from '../drizzle/meta/_journal.json';
import { runScript } from './_db';

// Same folder and bookkeeping table (drizzle.__drizzle_migrations) as `drizzle-kit migrate`.
const MIGRATIONS_FOLDER = './drizzle';

// Any fixed number. Two production builds at once queue on it instead of racing: drizzle's migrator
// reads the last applied migration before it opens its transaction.
const MIGRATION_LOCK_ID = 7281640031;

runScript(async () => {
  const env = process.env.VERCEL_ENV;
  if (env !== 'production') {
    console.log(`Migrations: skipped, VERCEL_ENV is ${env ?? 'unset'} (only production builds migrate).`);
    if (env && process.env.MIGRATION_DATABASE_URL) {
      console.warn(`Migrations: MIGRATION_DATABASE_URL is set for ${env}. Scope it to Production only in Vercel.`);
    }
    return;
  }

  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error('MIGRATION_DATABASE_URL is not set for Production in Vercel. Not deploying unmigrated code.');
  }
  // The host only, never credentials.
  console.log(`Migrations: database ${new URL(url).host}`);

  // max: 1, so the lock and the migrator share one session (MIGRATION_DATABASE_URL is the session
  // pooler). Notices are the migrator's "already exists, skipping" on every run.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle({ client });
  try {
    // Covers the advisory lock and DDL waiting behind the live app: fail the deploy rather than hang
    // the build or stall production queries queued behind an ALTER.
    await db.execute(sql`set lock_timeout = '10s'`);
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`);

    const before = await appliedMigrations(db);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await appliedMigrations(db);

    const applied = journal.entries.filter((e) => after.has(e.when) && !before.has(e.when));
    if (applied.length) console.log(`Migrations: applied ${applied.map((e) => e.tag).join(', ')}`);

    // drizzle only applies migrations newer than the latest one applied, so a migration generated on
    // a branch before another one landed is skipped silently. Catch it here instead of in production.
    const missing = journal.entries.filter((e) => !after.has(e.when));
    if (missing.length) {
      throw new Error(
        `Not applied: ${missing.map((e) => e.tag).join(', ')}. Each is older than the latest applied ` +
          'migration, so drizzle skips it. Delete it and run `npm run db:generate` again on top of main.',
      );
    }
    if (!applied.length) console.log('Migrations: up to date');
  } finally {
    await client.end(); // ends the session, which releases the advisory lock
  }
});

// The journal `when` of every migration the database has recorded.
async function appliedMigrations(db: Database): Promise<Set<number>> {
  const [table] = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!table?.exists) return new Set();
  const rows = await db.execute<{ created_at: string }>(sql`select created_at from drizzle.__drizzle_migrations`);
  return new Set(rows.map((r) => Number(r.created_at)));
}
