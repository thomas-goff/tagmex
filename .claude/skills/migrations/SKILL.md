---
name: migrations
description: How to change the tagmex database schema and ship it safely. Use before editing src/db/schema.ts, adding a file under drizzle/, writing a data migration or Supabase Cron job, or when a Vercel production build fails at the migration step.
---

# Database migrations

Schema lives in `src/db/schema.ts`; migrations in `drizzle/` (SQL plus `drizzle/meta/`).

## Making one

- Schema change: edit `src/db/schema.ts`, then `npm run db:generate`.
- Hand-written SQL (data moves, Supabase Cron jobs, functions): `npm run db:custom -- <name>`, then
  fill in the generated empty file.
- Always generate on top of the latest `main`. Commit the SQL and the `drizzle/meta` changes
  together.

## How it ships

Merging to `main` deploys. `npm run build` (Vercel's build command, pinned in `vercel.json`) is
`next build` then `npm run db:migrate:deploy` (`scripts/migrate-on-deploy.ts`):

| Build | Database |
|---|---|
| Production (`VERCEL_ENV=production`) | After `next build` succeeds, applies pending migrations to `MIGRATION_DATABASE_URL`, then checks every entry in `drizzle/meta/_journal.json` is recorded. Any failure, or the URL missing, fails the build, so the previous deploy keeps serving. |
| Preview | Nothing. Never connects (warns if `MIGRATION_DATABASE_URL` is set for Preview). |
| Local `npm run build` | Nothing (`VERCEL_ENV` unset). |

The build log says `Migrations: applied …`, `Migrations: up to date` or `Migrations: skipped`.

`npm run db:migrate` applies migrations by hand using `MIGRATION_DATABASE_URL` from `.env.local`
(e.g. to migrate before merging); the build then finds nothing to do.

## Rules

- **Must work with the code already running.** The old deployment serves traffic while the new
  one builds, and Instant Rollback doesn't undo migrations. Add tables and nullable columns (or
  columns with defaults) first; drop or rename in a later PR once nothing reads the old shape.
- **A failed deploy can still have migrated.** Migrations run after `next build`, so a compile
  error never touches the database, but a later Vercel failure leaves the migration applied. Fine
  if it is additive: redeploy and the build finds nothing to do.
- **Out-of-order migrations fail the deploy.** drizzle only applies migrations newer than the
  latest applied. If this branch's migration was generated before another landed on `main`, the
  build fails and names it: delete it and run `npm run db:generate` again on top of `main`.
- **Locks**: concurrent production builds queue on a Postgres advisory lock, and DDL that waits
  more than 10s for a lock fails the build instead of stalling production queries. Keep migrations
  quick; backfill big tables in batches.
- **Seed data** (categories, merchant rules) is not a migration: it is `npm run db:seed`
  (`scripts/seed.ts`, from `src/features/categorisation/defaults.ts`), which only adds what's
  missing.

## Checklist

1. Generated on top of current `main`, SQL reviewed by eye.
2. Additive, or the code that stopped reading the old shape is already in production.
3. Schema types updated and `npm run typecheck` passes; repos and fakes in
   `src/features/commands/test-support.ts` updated if the shape they model changed.
4. Remind the user that merging applies it to production.
