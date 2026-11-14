---
name: setup
description: First-time setup of tagmex and its integrations - environment variables, Gmail OAuth, database migrate and seed, Clerk (dashboard sign-in and MCP OAuth), the app allowlist, Discord channels and the #needs-review buttons app, and connecting Claude as a custom connector. Use when setting up a new environment, adding a user, adding an env var, or when an integration needs to be (re)configured.
---

# Setting up tagmex

Do these in order. Commands are for Git Bash. Never ask the user to paste secrets into chat: they
put them in `.env.local` and Vercel themselves.

## Environment variables

`.env.example` lists them all. In Vercel, set each for Production (and Preview where noted).

| Var | |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler (the app) |
| `MIGRATION_DATABASE_URL` | Supabase session pooler: `npm run db:migrate` and production builds. In Vercel, **Production scope only** |
| `CRON_SECRET` | 32+ chars; also in Supabase Vault as `cron_secret` (the cron jobs send it) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud "Desktop app" OAuth client |
| `GMAIL_REFRESH_TOKEN` | from `npm run gmail:auth` |
| `GMAIL_SENDER` | optional, default `notifyme@absa.co.za`; used as `from:` and matched exactly against From |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk → API keys. `/api/mcp` also accepts `CLERK_PUBLISHABLE_KEY` |
| `CLERK_SKIP_AUDIENCE_CHECK` | emergency only, see Clerk below |
| `DISCORD_WEBHOOK_URL` | #transactions, and the fallback for the three below |
| `DISCORD_REVIEW_WEBHOOK_URL` | optional, #needs-review |
| `DISCORD_BUDGET_WEBHOOK_URL` | optional, #budget |
| `DISCORD_SYSTEM_WEBHOOK_URL` | optional, #system |
| `DISCORD_PING_USER_ID` | optional, @-mentioned on critical #system messages only; also the only user who can use the #needs-review controls |
| `DISCORD_AVATAR_URL` | optional, public image URL for Pennyworth's avatar |
| `DISCORD_PUBLIC_KEY` | optional, turns on the #needs-review buttons (below) |

Adding a new env var: validate it in `src/env.ts` (the Gmail and Clerk vars are read by their own
features instead), add it to `.env.example` with a comment, and to the table above.

## 1. Gmail

1. Google Cloud: enable the Gmail API, create a **Desktop app** OAuth client, and publish the
   consent screen to **In production** (in Testing the refresh token dies after 7 days).
2. `npm run gmail:auth`, approve `gmail.readonly`, put the printed token in `.env.local` and Vercel.

## 2. Database

1. `npm run db:migrate` creates every table and schedules the Supabase Cron jobs (`gmail-sync`,
   `budget-digest`, `mcp-audit-retention`). On Vercel production this also happens on every deploy.
2. `npm run db:seed` adds the default categories and merchant rules (uses `DATABASE_URL`; check the
   `Database:` host it prints). A second run adds nothing.

## 3. Clerk (free plan)

- *Configure → Restrictions*: sign-up mode **Restricted**, allowlist the user's email.
- **Register the MCP server as an OAuth resource** with URL `https://<app>/api/mcp`. Tokens then
  carry that audience and `/api/mcp` refuses others; it also turns on client registration so
  Claude can register itself. The Clerk MCP connector's `configure_mcp_server` does this and
  `check_mcp_server` verifies discovery against the deployed app. If clients still can't register,
  enable **Dynamic client registration** under OAuth settings.
- *API keys* → Vercel and `.env.local`. The dashboard signs in at `/sign-in` with the same
  instance and allowlist; someone Clerk lets in but `app_users` doesn't gets `/not-allowed`.
- Production should use a Clerk **production** instance. A response header
  `X-Clerk-Auth-Reason: dev-browser-missing` means a development instance is in use.
- Only if a client can't get a token with the right audience: `CLERK_SKIP_AUDIENCE_CHECK=true`
  (any token from the instance is then accepted). Treat it as tech debt and tell the user.

## 4. Allow the user in

The app's own allowlist, on top of Clerk's. The email must be verified in Clerk.

```bash
npm run users:allow -- --email you@example.com
```

For an additional person, give them their own `--id`.

## 5. Discord

Create #transactions, #needs-review, #budget and #system, a webhook in each, and set the
`DISCORD_*` vars. Set `DISCORD_REVIEW_WEBHOOK_URL` before going live: a message can only be edited
by the webhook that posted it, so review messages posted via the fallback never get ticked off.
Suggest channel notification levels (e.g. #system on "@mentions only").

### #needs-review buttons (optional)

Plain webhooks can't carry working buttons, so this needs a Discord application. Until
`DISCORD_PUBLIC_KEY` is set no controls are sent and `/api/discord/interactions` is a 404.

1. [Developer Portal](https://discord.com/developers/applications) → New Application. Copy
   *General Information → Public Key*.
2. *Bot* → Reset Token (only needed for step 3). *Installation* → Guild Install with the `bot`
   scope and *Manage Webhooks*; add it to the server.
3. Create the app-owned webhook (Developer Mode → right-click #needs-review → Copy Channel ID) and
   set the URL it prints as `DISCORD_REVIEW_WEBHOOK_URL`:

   ```bash
   DISCORD_BOT_TOKEN=... npm run discord:review-webhook -- --channel <channel id>
   ```

4. Set `DISCORD_PUBLIC_KEY` in Vercel and redeploy (after step 3, never before).
5. *Interactions Endpoint URL*: `https://<app>/api/discord/interactions`. Discord verifies it with
   a signed PING on save.

Review messages from the old webhook can't be edited by the new one: sort them first
(`get_uncategorised` empty).

A nightly Claude routine can call `get_uncategorised` with `unreviewed_only: true` and
`suggest_category` per group; suggestions show with an Accept button and never categorise alone.

## 6. Deploy and check

Merge to `main`, then run the checks in the `ops` skill (MCP 401, protected resource metadata,
digest dry run, sync dry run).

## 7. Connect Claude

claude.ai → Settings → Connectors → *Add custom connector*, URL `https://<app>/api/mcp`, sign in
with Clerk. It then works in the mobile app too. Try "where do I stand?". MCP Inspector also
works: `npx @modelcontextprotocol/inspector`.

Then set the budget by asking Claude ("set Groceries to R4,000 and Rent to R9,500 on the 1st").
Until then every allocation is R0.

**Connector icon**: claude.ai ignores `serverInfo.icons` and shows a Google favicon looked up on
the last two labels of the connector's hostname. On `*.vercel.app` that is Vercel's logo. To get
tagmex's icon: serve the app on a custom domain whose last two labels are its own (`tagmex.app`
works; `tagmex.co.za` would look up `co.za`), with the favicon at the root, reachable over plain
HTTP too. Point the connector at that domain, and wait for Google's favicon index to pick it up.
