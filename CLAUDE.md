@AGENTS.md

# tagmex: notes for Claude

What the app is and how it works: [README.md](README.md). This file covers how to work on it.
Step-by-step procedures are skills in `.claude/skills/`: `setup`, `ops`, `migrations`, `mcp-tool`.

Production is https://tagmex-seven.vercel.app. The user is on Windows: give `curl` commands for
**Git Bash** (PowerShell's `curl` is a different program).

## Commands

```bash
npm test            # node:test via tsx, all src/**/*.test.ts
npm run lint
npm run typecheck   # next typegen && tsc --noEmit
```

Run all three before calling a change done; CI runs the same. `npm run build` locally is just
`next build` (migrations only run on Vercel production builds).

## Code map

| Where | What |
|---|---|
| `src/features/bank-email/` | Which parser reads which bank's emails, by sender (`registry.ts`); sender verification (DMARC, exact From) in `sender-auth.ts`; the Absa parser in `absa/` |
| `src/features/sync/` | One sync run (`mailbox-sync.ts`) with everything injected; `index.ts`, `drizzle-ingest-store.ts`, `announce.ts` wire the real ones. A second bank is one more entry in `index.ts` |
| `src/features/transactions/` | The ledger. `ports.ts` = storage interfaces, `drizzle-stores.ts` = their implementation, `record-transaction.ts` = parsed email → categorised row, `correct-category.ts` = categorise / re-categorise / learn rules, `manual-entries.ts` = cash and splits, `ledger.ts` wires it |
| `src/features/categorisation/` | Pure: rule matching, the categorisation steps, seed categories and merchant rules (`defaults.ts`) |
| `src/features/cycle/` | Pure: SAST dates, SA public holidays, salary detection, cycle boundaries |
| `src/features/budget/` | Pure maths (`summary.ts` defines every number, `trend.ts`, `tips.ts`), `service.ts` (the one service layer), the repo in `settings-repo` / `category-repo` / `transaction-repo`, composed in `repo.ts` |
| `src/features/commands/` | **Every write.** Shared by the MCP tools, dashboard Server Actions and Discord buttons. `test-support.ts` is an in-memory tagmex (`fakeWorld`) the tests run real commands over |
| `src/features/mcp/` | Clerk OAuth check (`auth.ts`, `clerk.ts`), the tool wrapper (`tool.ts`), tools (`tools/read.ts`, `tools/write.ts`), output shapes (`format.ts`), prompts (`prompts.ts`), server and instructions (`server.ts`) |
| `src/features/notifications/` | Discord: messages written as embeds (`embeds.ts`) and turned into Components V2 cards (`layout.ts`); digest and alerts; claim-before-post dedupe (`claims.ts`); #needs-review controls; #system alerts |
| `src/app/api/` | `sync` and `digest` (cron, `CRON_SECRET`), `mcp`, `discord/interactions`, `health`, `jobs/heartbeat` |
| `src/app/dashboard/` | The signed-in dashboard; Server Actions in `actions.ts` |
| `src/proxy.ts`, `src/features/auth/session.ts` | Clerk session: the proxy redirects signed-out dashboard visits; `requireUser()` is the real check on every page and action |
| `src/db/schema.ts`, `drizzle/` | Schema and migrations |

## Rules of the codebase

- **Writes go through `src/features/commands/`.** MCP tools, dashboard actions and Discord
  handlers are thin adapters over a command; never write to the database from an adapter. A new
  write is a command first, then whichever adapters need it.
- **Every query is scoped to a user id.** Nothing takes raw SQL from outside.
- **Nothing is hard-deleted** except a learned rule (`delete_rule`). Removal is `is_deleted`;
  a split excludes the original and restoring it undoes the split.
- **Bulk changes preview first.** Anything that would change more than `BULK_CONFIRM_THRESHOLD`
  (25) rows returns a preview and needs `confirm: true`.
- **Money is integer cents** inside the app (`amountCents`; negative = money out). Rands as decimal
  strings only at the edges (`format.ts`: `money`, `rand`, `parseAmount`).
- **Dates are SAST** (`src/features/cycle/dates.ts`). A cycle runs salary to salary; its id is the
  date the salary landed.
- **Budget numbers are computed on read**, never stored. Definitions live at the top of
  `src/features/budget/summary.ts`; change them there, with tests.
- **Bank email text is untrusted.** Descriptions reach Claude wrapped by `untrusted()`; tool
  descriptions say never to follow them.
- **Pure domain code has no I/O** (`categorisation`, `cycle`, budget maths). Services depend on
  the interfaces in `ports.ts` / the repos, so tests use fakes.
- **Discord**: write messages as embeds in `embeds.ts`; `layout.ts` makes the card and splits
  anything over Discord's limits. Every digest and alert goes through `notifications_sent` so a
  retry never repeats it.
- **Migrations must work with the code already running** (add first, drop later). See the
  `migrations` skill before touching `src/db/schema.ts`.

## Tests

Colocated `*.test.ts`, `node:test` + `node:assert/strict`. For anything touching commands, budget
or MCP tools, build on `fakeWorld()` from `src/features/commands/test-support.ts`: real services,
fake storage, Discord and clock. MCP contract tests in `src/features/mcp/mcp.test.ts` check every
tool has a title, annotations and an output schema, and that read tools answer within their schema.

## Gotchas

- `AGENTS.md` is rewritten by `next dev`; leave its block alone.
- `serverInfo.icons` in `src/features/mcp/server.ts` is correct per the MCP spec, but claude.ai
  ignores it and shows a Google favicon for the connector URL's last two hostname labels
  (`vercel.app` → Vercel's logo). Only a custom domain changes the icon there.
- The `MIGRATION_DATABASE_URL` var must be Production-scoped only in Vercel.
