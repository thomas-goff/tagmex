# tagmex

Next.js 16 (App Router) + Drizzle ORM + Postgres + Zod.

```bash
npm install
npm run dev
npm test        # unit tests (node:test via tsx)
```

## Env vars

| Var | |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler |
| `MIGRATION_DATABASE_URL` | Supabase session pooler (drizzle-kit only) |
| `DISCORD_WEBHOOK_URL` | |
| `CRON_SECRET` | 32+ chars, also in Supabase Vault as `cron_secret` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud "Desktop app" OAuth client |
| `GMAIL_REFRESH_TOKEN` | from `npm run gmail:auth` |
| `GMAIL_SENDER` | optional, default `notifyme@absa.co.za`; used as `from:` and matched against From |

## Gmail sync (phase 1)

1. Google Cloud: enable the Gmail API, create a **Desktop app** OAuth client, and publish the
   consent screen to **In production** (in Testing the refresh token dies after 7 days).
2. `npm run gmail:auth`, approve `gmail.readonly`, put the printed token in `.env.local` and Vercel.
3. Dry run (writes nothing):
   `curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/sync?dryRun=true&limit=10"`
4. `npm run db:migrate` creates the sync tables and schedules `gmail-sync` every 30 minutes.
5. After a parser fix: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/sync?retryFailed=true"`

## Transactions + categories (phase 2)

Every parsed email becomes one row in `transactions` (keyed on the Gmail message id, so retries
never duplicate), categorised in this order: your learned rules (exact description) → merchant
rules (whole words, so `BP` never matches `BPA`) → transfer detection (opposite amount on another
account within 3 days) → uncategorised (`category_id` null). Discord shows the category, or
❔ **Uncategorised**.

### Code map

| Where | What |
|---|---|
| `src/features/categorisation/` | Pure domain: rule matching, the categorisation steps, seed data (`defaults.ts`). No DB. |
| `src/features/transactions/ports.ts` | Storage interfaces the services depend on |
| `src/features/transactions/drizzle-stores.ts` | Their Drizzle implementation |
| `src/features/transactions/record-transaction.ts` | Parsed email → categorised ledger row (sync + backfill) |
| `src/features/transactions/correct-category.ts` | Correct a category, learn a rule, apply it to past uncategorised rows |
| `src/features/transactions/ledger.ts` | Wires services to a database (app: `index.ts`; scripts: their own connection) |

To add a merchant rule for everyone, add it to `DEFAULT_MERCHANT_RULES` and re-run `npm run db:seed`.

### Rollout (do these in order, once)

All commands are for **Git Bash**. In PowerShell `curl` is a different program, so use Git Bash.
First set these in the shell:

```bash
export APP_URL=https://<your-vercel-app>.vercel.app
export CRON_SECRET=<the CRON_SECRET from Vercel>
```

1. **Migrate** (adds tables and one nullable column, so the running phase 1 code is unaffected).
   Uses `MIGRATION_DATABASE_URL` from `.env.local`:

   ```bash
   npm run db:migrate
   ```

2. **Seed** categories and merchant rules. Uses `DATABASE_URL` from `.env.local`. Check the
   `Database:` host it prints is your Supabase project. Expect `Added 14 categories and 42 merchant
   rules`. A second run adds 0.

   ```bash
   npm run db:seed
   ```

3. **Deploy**: merge the PR so Vercel deploys. No new env vars.

4. **Check categories on recent mail** (writes nothing; posts `[dry run]` lines to Discord):

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/sync?dryRun=true&limit=10"
   ```

5. **Backfill** phase 1 history. It runs locally, so `.env.local` needs `DATABASE_URL`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN`. It never posts to Discord.
   Start with a dry run and compare a month of lines against the Absa app:

   ```bash
   npm run transactions:backfill -- --dry-run
   ```

   ```bash
   npm run transactions:backfill
   ```

   Lines marked `skipped` were parsed in phase 1 but don't parse now. That means the parser has
   regressed, so look into it rather than ignoring it. Re-running is safe.

6. **Teach it the rest** (below), then leave it for a couple of days and run the checks.

### Correcting categories

```bash
# Uncategorised, grouped by description, biggest group first
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/transactions/uncategorised"

# Category names
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/categories"

# Categorise one transaction (use a group's latestTransactionId). This learns a rule for that exact
# description and applies it to the rest of the group. Rows you or a rule already categorised are
# never changed. Response: appliedTo = how many others it fixed.
curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"category": "Groceries"}' "$APP_URL/api/transactions/<transaction-id>/category"
```

Correcting the same description again re-points its rule. These routes are interim, and phase 3's
MCP tools replace them.

### Checks (Supabase SQL editor)

```sql
-- Parsed emails still without a transaction. Expect 0 after the backfill (a message mid-sync can show briefly).
select count(*) from ingested_messages where status = 'parsed' and transaction_id is null;

-- How things were categorised.
select coalesce(c.name, 'UNCATEGORISED') as category, t.category_source, count(*)
from transactions t left join categories c on c.id = t.category_id
where not t.is_deleted group by 1, 2 order by 3 desc;

-- Duplicates. The unique (source, source_ref) constraint should make this always empty.
select source_ref, count(*) from transactions group by 1 having count(*) > 1;
```
