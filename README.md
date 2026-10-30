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
| `CRON_SECRET` | 32+ chars, also in Supabase Vault as `cron_secret` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud "Desktop app" OAuth client |
| `GMAIL_REFRESH_TOKEN` | from `npm run gmail:auth` |
| `GMAIL_SENDER` | optional, default `notifyme@absa.co.za`; used as `from:` and matched against From |
| `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk → API keys. Needed for `/api/mcp` only. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (the dashboard's name) works too |
| `DISCORD_WEBHOOK_URL` | **#transactions**, and the fallback for the three below |
| `DISCORD_REVIEW_WEBHOOK_URL` | optional, **#needs-review** |
| `DISCORD_BUDGET_WEBHOOK_URL` | optional, **#budget** |
| `DISCORD_SYSTEM_WEBHOOK_URL` | optional, **#system** |
| `DISCORD_PING_USER_ID` | optional, your Discord user id: @-mentioned on critical #system messages only |

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

To add a merchant rule for everyone, add it to `DEFAULT_MERCHANT_RULES` (with a test in
`defaults.test.ts`) and re-run `npm run db:seed`. The seed adds missing rules, then runs all rules
over transactions that are still uncategorised. Categorised rows are never changed.

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
   `Database:` host it prints is your Supabase project. On a new database, expect `Added 14 categories and
   44 merchant rules`. A second run adds 0.

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

## Budget + Claude (phase 3)

Claude is the interface: it connects to the MCP server at `/api/mcp` and answers "where do I
stand?" from the ledger. Discord gets a daily digest and alerts without you asking.

### How the budget works

- **Cycles run salary to salary**, not by calendar month. A cycle starts on the day the salary
  credit lands (a credit in the `Salary` category, within ±`salary_tolerance_pct` of the expected
  amount when one is set) and its id is that date, e.g. `2026-10-30`. It's labelled by the month it
  ends in ("November 2026"). The next salary is projected from `salary_day_hint` (default 31 =
  month end), clamped to short months and moved back to the previous business day for weekends and
  SA public holidays (computed, so the list never goes stale). A late salary keeps the cycle open
  and raises "salary overdue". A second salary-like credit within 20 days is income, not a cycle.
- **Budget items**: one per expense category (created at R0 automatically), `static` (debit
  orders, with an expected day), `dynamic` or `irregular`, with an allocation per cycle.
- **Numbers** are computed on read, never stored: spent per category (refunds net off), remaining,
  pending debit orders (static items with no money out yet), discretionary left (dynamic +
  irregular), daily allowance, income and net. Transfers count as neither. Uncategorised
  transactions are left out of every number and reported alongside so you know.

### Code map

| Where | What |
|---|---|
| `src/features/cycle/` | Pure: dates in SAST, SA holidays, salary detection, cycle boundaries |
| `src/features/budget/` | Pure maths (`summary`, `trend`, `tips`), repo (cents at the boundary), `service.ts` (the one service layer) |
| `src/features/mcp/` | Clerk token check (`auth.ts`, `clerk.ts`), tool wrapper (`tool.ts`: rate limit, audit, errors), tools in `tools/read.ts` and `tools/write.ts` |
| `src/features/notifications/` | Discord channels, digest and alert messages, claim-before-post dedupe, #needs-review edits, #system alerts |
| `src/app/api/mcp/` | The MCP endpoint (stateless streamable HTTP) |
| `src/app/.well-known/` | OAuth protected resource metadata (points clients at Clerk) |
| `src/app/api/digest/` | Hourly job: alerts, the daily digest, stale-sync check |

### Discord channels

| Channel | What | Webhook |
|---|---|---|
| #transactions | Each categorised transaction, with its category's budget this cycle | `DISCORD_WEBHOOK_URL` |
| #needs-review | Each uncategorised transaction. Ticked ✅ with its category when you categorise it through Claude | `DISCORD_REVIEW_WEBHOOK_URL` |
| #budget | Daily digest from 07:00 SAST, 80% / 100% category alerts, salary landed + last cycle recap, salary overdue | `DISCORD_BUDGET_WEBHOOK_URL` |
| #system | Parse failures, sync / Gmail token failures (once a day per error, with a ping), no successful sync for 2h (ping), heartbeat, dry runs | `DISCORD_SYSTEM_WEBHOOK_URL` |

Channels without a webhook fall back to #transactions. Set `DISCORD_REVIEW_WEBHOOK_URL` before
going live: a message can only be edited through the webhook that posted it, so review messages
posted while it fell back won't get ticked off. Set notification levels per channel in
Discord (e.g. #system on "@mentions only", so only the pings reach you). Every digest and alert is
deduplicated in `notifications_sent`, so retries never repeat one.

### Rollout (once)

1. **Migrate** (already done if you're reading this after the PR): `npm run db:migrate`. It adds
   the tables, moves the `SALARY` rule and its transactions from Income to a new Salary category,
   and schedules `budget-digest` (hourly) and `mcp-audit-retention` (daily) in Supabase Cron.
2. **Clerk** (free plan):
   - *Configure → Restrictions*: sign-up mode **Restricted**, and allowlist your email.
   - **Register the MCP server as an OAuth resource**, with URL `https://<your-app>/api/mcp`.
     This turns on the audience claim, so tokens carry that URL and `/api/mcp` refuses tokens
     minted for anything else. It also turns on client registration (client ID metadata
     documents), so Claude can register itself. The Clerk MCP connector's `configure_mcp_server`
     does this; `check_mcp_server` then checks discovery against the deployed app. If clients
     still can't register, enable **Dynamic client registration** under OAuth settings.
   - *API keys*: copy the publishable and secret keys into Vercel (`CLERK_PUBLISHABLE_KEY`,
     `CLERK_SECRET_KEY`) and `.env.local`.
   - Only if a client can't get a token with the right audience: set `CLERK_SKIP_AUDIENCE_CHECK=true`
     (weaker: any token from this Clerk instance is accepted) and tell me, it's tech debt.
3. **Allow yourself in** (the app's own allowlist, on top of Clerk's): the email must be one you
   verify in Clerk. Already done for the owner; for someone else, give them their own `--id`.

   ```bash
   npm run users:allow -- --email you@example.com
   ```

4. **Discord**: create the four channels, a webhook in each, and set the `DISCORD_*` vars in Vercel.
5. **Deploy**: merge the PR.
6. **Check** (writes nothing):

   ```bash
   curl -i -X POST "$APP_URL/api/mcp"      # expect 401 with WWW-Authenticate: Bearer … resource_metadata=…
   curl "$APP_URL/.well-known/oauth-protected-resource/api/mcp"   # authorization_servers = your Clerk URL
   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/digest?dryRun=true"   # the digest and alerts as they'd post
   ```

7. **Connect Claude**: claude.ai → Settings → Connectors → *Add custom connector*, URL
   `https://<your-app>/api/mcp`. Sign in with Clerk when asked. It then shows up in the Claude
   mobile app too. Try "where do I stand?", "what debit orders haven't gone off?" and "help me
   categorise what's uncategorised". (MCP Inspector also works: `npx @modelcontextprotocol/inspector`.)
8. **Set the budget** by asking Claude, e.g. "set Groceries to R4,000 and Rent to R9,500 on the
   1st". Until then every allocation is R0, so remaining and the daily allowance read R0.

If you ever move to a new Clerk instance (e.g. development → production keys), Clerk user ids
change: run `npm run users:allow -- --email you@example.com --unlink` and sign in again.

### MCP tools

Read: `get_budget_overview` (start here), `list_transactions`, `get_uncategorised`,
`list_categories`, `list_accounts`, `get_budget_items`, `get_pending_debit_orders`,
`get_spending_trend`, `get_tips`, `get_sync_status`. Write: `categorise_transaction` (learns a rule;
over 25 similar rows needs `confirm: true`), `create_category`, `set_budget_item`,
`set_salary_config`, `set_notification_settings`, `exclude_transaction` / `restore_transaction`
(soft delete), `set_account_label` (names an account such as `CHEQ …1297`, or the counterparty
behind description text; shown next to transactions, display only), `post_status_to_discord`
(the digest-style budget status and/or a note from Claude, to #budget; at most 5 posts an hour),
`reprocess_failed_messages`. No hard deletes, no SQL, every query scoped to the signed-in user.
Every call is written to `mcp_audit_log` (kept 90 days) and limited to 60 a minute.

### Checks (Supabase SQL editor)

```sql
-- What Claude has been doing.
select at, tool, status, error, args from mcp_audit_log order by at desc limit 50;

-- Digests and alerts sent. Each key appears once.
select sent_at, kind, dedupe_key from notifications_sent order by sent_at desc limit 50;

-- Salary credits, newest first. Each should open a cycle.
select t.occurred_on, t.amount from transactions t join categories c on c.id = t.category_id
where c.is_salary and t.amount > 0 and not t.is_deleted order by 1 desc;
```
