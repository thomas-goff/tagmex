---
name: mcp-tool
description: How to add or change a tool, prompt or the server instructions of the tagmex MCP server (src/features/mcp). Use when the user wants Claude to be able to do something new with their budget, or a tool's input, output or wording changes.
---

# Adding or changing an MCP tool

The server is `src/features/mcp/server.ts` (stateless streamable HTTP at `/api/mcp`, one fresh
`McpServer` per request bound to the caller's verified user). Tools are listed in `READ_TOOLS`
(`tools/read.ts`) and `WRITE_TOOLS` (`tools/write.ts`).

## Shape of a tool

```ts
const myTool = defineTool({
  name: 'snake_case_name',
  title: 'Short human title',
  description: [...sentences].join(' '),   // what it does, when to use it, what to show the user
  input: z.object({ ... }),                // zod; .describe() fields the model must fill well
  output: z.object({ ... }),               // the structured result; advertised as outputSchema
  annotations: { ...write, idempotentHint: true, title: '...' },  // or read-only hints
  async run(args, ctx) {
    // ctx.principal.userId, ctx.deps.commands / budget / repo / accounts / ...
    return { text: '...', data: { ... } };
  },
});
```

`tool.ts` wraps every call: rate limit (60/min), audit to `mcp_audit_log`, input parsing, checking
`data` against `output` (a mismatch is our bug and never leaves the server), and turning
`ToolError` / `CommandError` / `NotFoundError` / `InvalidInputError` / `ConflictError` into an
`isError` result whose message says what to do next.

## Rules

- **Reads** call `ctx.deps.budget` or the read-only repo picks in `ToolDeps`. If you need a new
  read, widen the `Pick<>` in `ToolDeps` and wire it in `src/features/mcp/index.ts`.
- **Writes** call a command in `src/features/commands/commands.ts`, never a store directly. If the
  command doesn't exist, add it there first (with tests in `commands.test.ts`) so the dashboard and
  Discord can use it too.
- Anything that can change many rows: return a preview when over `BULK_CONFIRM_THRESHOLD` unless
  `confirm: true`, and say so in the description.
- Amounts in: `amountInput` + `parseAmount` (rands). Amounts out: `money()` / `rand()` from
  `format.ts`, ZAR decimal strings. Negative = money out.
- Bank descriptions out: always through `untrusted()`.
- Reuse the shared notes in descriptions where they apply: `CYCLE_NOTE`, `MONEY_NOTE`,
  `UNTRUSTED_NOTE`, `ACCOUNT_NOTE`.
- The `text` is what the model reads first: lead with the answer, keep it short, and for previews
  say "Nothing was changed. Ask the user, then call again with confirm: true".
- If the tool changes what Claude should do first, update `INSTRUCTIONS` in `server.ts`.

## Tests

`src/features/mcp/mcp.test.ts` already checks every tool has a title, annotations and an output
schema, and runs every read tool against an empty and a busy `fakeWorld()`. Add a test for the
tool's behaviour (call it through `runTool` with `toolDeps(world)`), including the confirm path
for bulk writes. Then `npm test && npm run lint && npm run typecheck`.

## Prompts

`prompts.ts` holds `weekly_review`, `sort_inbox` and `plan_next_cycle`; the prompts test checks
each renders. Prompts are text that steers Claude through tools, so name the tools they should use.

## After merging

The claude.ai connector picks up new tools on its next connection; if a tool doesn't appear, the
user can disconnect and reconnect the connector. Mention the change in the README's
"Talking to it" section only if it changes what the app can do.
