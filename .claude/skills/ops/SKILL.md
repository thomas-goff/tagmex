---
name: ops
description: Checking and fixing the running tagmex app - sync dry runs, re-processing failed bank emails after a parser fix, backfilling transactions, re-seeding merchant rules, digest dry runs, health and MCP checks, and SQL queries for the Supabase SQL editor. Use when something looks wrong in production, after a parser or categorisation change, or when the user asks how the app is doing.
---

# Operating tagmex

Production: `https://tagmex-seven.vercel.app`. Commands are for **Git Bash** (PowerShell's `curl`
is a different program). Ask the user to set these in their shell; never print or ask for the
secret's value in chat:

```bash
export APP_URL=https://tagmex-seven.vercel.app
export CRON_SECRET=<the CRON_SECRET from Vercel>
```

If the tagmex MCP connector is available in this session, prefer it for read-only questions
(`get_sync_status`, `get_budget_overview`, `get_uncategorised`) over curl or SQL.

## Scheduled jobs (Supabase Cron)

| Job | Calls | When |
|---|---|---|
| `gmail-sync` | `/api/sync` | every 30 minutes |
| `budget-digest` | `/api/digest` (alerts, daily digest from 07:00 SAST, stale-sync check) | hourly |
| `mcp-audit-retention` | deletes `mcp_audit_log` rows older than 90 days | daily |

## Checks that write nothing

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/sync?dryRun=true&limit=10"   # parse + categorise recent mail, posts [dry run] to #system
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/digest?dryRun=true"          # the digest and alerts as they'd post
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/health"                      # with the secret it also pings the database
curl -i -X POST "$APP_URL/api/mcp"                                                      # expect 401 with WWW-Authenticate … resource_metadata=…
curl "$APP_URL/.well-known/oauth-protected-resource/api/mcp"                            # authorization_servers = the Clerk URL
```

## Fixes

- **After a parser fix**, re-parse failed emails (or ask Claude to run `reprocess_failed_messages`):

  ```bash
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/sync?retryFailed=true"
  ```

- **New built-in merchant rule**: add it to `DEFAULT_MERCHANT_RULES` in
  `src/features/categorisation/defaults.ts` with a test in `defaults.test.ts`, merge, then
  `npm run db:seed` (uses `DATABASE_URL` from `.env.local`; check the `Database:` host it prints).
  The seed adds missing rules and runs all rules over still-uncategorised transactions. Categorised
  rows are never changed.
- **Backfill** history from Gmail (runs locally; needs `DATABASE_URL` and the Gmail vars in
  `.env.local`; never posts to Discord; safe to re-run). Dry run first:

  ```bash
  npm run transactions:backfill -- --dry-run
  ```

  Lines marked `skipped` parsed once but don't now: the parser has regressed, investigate.
- **Gmail token dead** (#system says so): run `npm run gmail:auth`, put the new
  `GMAIL_REFRESH_TOKEN` in `.env.local` and Vercel, redeploy. If it keeps dying after 7 days, the
  Google consent screen is still in Testing.
- **Moved to a new Clerk instance** (user ids change):
  `npm run users:allow -- --email <their email> --unlink`, then sign in again.

## SQL checks (Supabase SQL editor, read-only)

```sql
-- Parsed emails without a transaction. Expect 0 (one mid-sync can show briefly).
select count(*) from ingested_messages where status = 'parsed' and transaction_id is null;

-- How things were categorised.
select coalesce(c.name, 'UNCATEGORISED') as category, t.category_source, count(*)
from transactions t left join categories c on c.id = t.category_id
where not t.is_deleted group by 1, 2 order by 3 desc;

-- Duplicates. The unique (source, source_ref) constraint keeps this empty.
select source_ref, count(*) from transactions group by 1 having count(*) > 1;

-- What Claude has been doing.
select at, tool, status, error, args from mcp_audit_log order by at desc limit 50;

-- Digests and alerts sent. Each key appears once.
select sent_at, kind, dedupe_key from notifications_sent order by sent_at desc limit 50;

-- Salary credits, newest first. Each should open a cycle.
select t.occurred_on, t.amount from transactions t join categories c on c.id = t.category_id
where c.is_salary and t.amount > 0 and not t.is_deleted order by 1 desc;
```

## Correcting categories

Claude (`categorise_transaction`), the #needs-review dropdown and the dashboard's Transactions page
all run the same command: set the category, learn a rule for that exact description and
direction, apply it to other uncategorised rows. Already-filed rows only move with
`recategorise_transactions`. Only change data when the user asks or agrees.
