import type { CallToolResult, McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AccountLabelRepo } from '@/features/accounts/repo';
import { CommandError, type CommandErrorCode, type Commands } from '@/features/commands/commands';
import type { BudgetRepo } from '@/features/budget/repo';
import { ConflictError } from '@/features/budget/repo';
import type { BudgetService } from '@/features/budget/service';
import { InvalidInputError } from '@/features/budget/service';
import type { SyncStatusRepo } from '@/features/sync/status-repo';
import { NotFoundError } from '@/features/transactions/correct-category';
import type { TransactionStore } from '@/features/transactions/ports';
import type { Principal } from './auth';

// Every tool is a thin adapter: validate input (zod), call the service layer or a shared command,
// shape the answer. The wrapper here rate-limits, audits every call, checks the answer against the
// tool's output schema, and turns failures into tool results with isError and a message saying
// what to do next, never a stack trace.

export interface AuditEntry {
  userId: string;
  tool: string;
  args: string;
  status: 'ok' | 'error' | 'rate_limited';
  error: string | null;
  durationMs: number;
  clientId: string | null;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  countSince(userId: string, since: Date): Promise<number>;
  // Successful calls of one tool, for per-tool caps.
  countOkSince(userId: string, tool: string, since: Date): Promise<number>;
}

export interface ToolDeps {
  // Every write: the same commands the dashboard and the Discord buttons run.
  commands: Commands;
  budget: Pick<BudgetService, 'summary' | 'overview' | 'trend'>;
  // Reads only.
  repo: Pick<BudgetRepo, 'listCategories' | 'ensureBudgetItems' | 'listBudgetLines' | 'listTransactions' | 'listKnownDescriptions' | 'listRules'>;
  accounts: Pick<AccountLabelRepo, 'listAccounts' | 'listLabels'>;
  uncategorised: Pick<TransactionStore, 'summariseUncategorised'>;
  sync: Pick<SyncStatusRepo, 'syncStatus'>;
  audit: AuditLog;
  // Re-parse failed bank emails (after a parser fix). Posts results to Discord like a normal sync.
  reprocessFailed(userId: string): Promise<{ fetched: number; parsed: number; ignored: number; failed: number }>;
}

export interface ToolContext {
  principal: Principal;
  deps: ToolDeps;
}

export interface ToolOutput<O extends z.ZodObject = z.ZodObject> {
  text: string;
  // The structured result, in the shape the tool's output schema declares.
  data: z.input<O>;
}

// A failure the model can act on. Its message is shown as-is.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  // The shape of `data`, advertised to clients as the tool's outputSchema.
  output: O;
  annotations: ToolAnnotations;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolOutput<O>>;
}

export function defineTool<S extends z.ZodObject, O extends z.ZodObject>(tool: ToolDefinition<S, O>) {
  return tool as unknown as ToolDefinition;
}

// A runaway loop, not abuse, is the realistic risk.
export const CALLS_PER_MINUTE = 60;
const ARGS_LIMIT = 500;

export function registerTools(server: McpServer, tools: readonly ToolDefinition[], ctx: ToolContext) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input, outputSchema: tool.output, annotations: tool.annotations },
      (async (args: unknown) => runTool(tool, args, ctx)) as never,
    );
  }
}

export async function runTool(tool: ToolDefinition, args: unknown, { principal, deps }: ToolContext): Promise<CallToolResult> {
  const started = Date.now();
  const audit = (status: AuditEntry['status'], error: string | null = null) =>
    deps.audit
      .record({
        userId: principal.userId,
        tool: tool.name,
        args: JSON.stringify(args ?? {}).slice(0, ARGS_LIMIT),
        status,
        error,
        durationMs: Date.now() - started,
        clientId: principal.clientId,
      })
      .catch((err) => console.error('MCP audit write failed', err));

  if ((await deps.audit.countSince(principal.userId, new Date(started - 60_000))) >= CALLS_PER_MINUTE) {
    await audit('rate_limited');
    return errorResult(`Rate limit: at most ${CALLS_PER_MINUTE} tool calls a minute. Wait a minute before calling again.`);
  }

  try {
    const { text, data } = await tool.run(tool.input.parse(args ?? {}), { principal, deps });
    // What goes out is what the schema describes: a mismatch is our bug, not the model's.
    const checked = tool.output.safeParse(data);
    if (!checked.success) {
      console.error(`MCP tool ${tool.name} returned data that doesn't match its output schema`, z.prettifyError(checked.error));
      await audit('error', 'output schema mismatch');
      return errorResult(INTERNAL);
    }
    await audit('ok');
    return { content: [{ type: 'text', text }], structuredContent: checked.data };
  } catch (err) {
    const message = actionableMessage(err);
    if (message === INTERNAL) console.error(`MCP tool ${tool.name} failed`, err);
    await audit('error', err instanceof Error ? err.message.slice(0, ARGS_LIMIT) : String(err));
    return errorResult(message);
  }
}

const INTERNAL = 'Something went wrong on the tagmex server. Try once more; if it fails again, tell the user.';

// Where to look next, for the model, after a shared command's error.
const COMMAND_HINTS: Partial<Record<CommandErrorCode, string>> = {
  unknown_category: ' Call list_categories, or create_category to add one.',
  archived_category: ' Unarchive it with update_category (archived: false), or pick another from list_categories.',
  unknown_transaction: ' Find ids with list_transactions or get_uncategorised.',
  unknown_rule: ' list_rules has the ids.',
  unknown_account: " list_accounts shows the user's accounts.",
  unknown_counterparty: ' Copy the text from list_transactions or get_uncategorised.',
  excluded: ' (restore_transaction)',
  already_categorised: ' Nothing to suggest; move on to the next one.',
  nothing_matches: ' Check the description with list_transactions (search) and the names with list_categories.',
  zero_salary: ' Pass expected_amount: null to accept any amount.',
  name_taken: ' To fold one category into another, use merge_categories.',
  post_limit: ' Tell the user to try later.',
  post_failed: ' Tell the user.',
};

function actionableMessage(err: unknown) {
  if (err instanceof CommandError) return `${err.message}${COMMAND_HINTS[err.code] ?? ''}`;
  if (err instanceof ToolError || err instanceof InvalidInputError || err instanceof ConflictError) return err.message;
  if (err instanceof NotFoundError) return `${err.message}. Look the id up with list_transactions or list_categories.`;
  if (err instanceof z.ZodError) return `Invalid arguments: ${z.prettifyError(err)}`;
  return INTERNAL;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
