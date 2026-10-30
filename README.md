# tagmex

Next.js 16 (App Router) + Drizzle ORM + Postgres + Zod.

```bash
npm install
npm run dev
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
