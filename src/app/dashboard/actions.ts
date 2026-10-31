'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/features/auth/session';
import { ConflictError } from '@/features/budget/repo';
import { InvalidInputError } from '@/features/budget/service';
import { parseEmoji } from '@/features/categorisation/emoji';
import { EXPENSE_TYPES } from '@/features/categorisation/types';
import { commands } from '@/features/commands';
import { CommandError } from '@/features/commands/commands';
import { parseAmount } from '@/features/mcp/format';
import { NotFoundError } from '@/features/transactions/correct-category';

// The dashboard's writes. Each action is a public POST endpoint, so each one checks the session
// itself (requireUser) and runs as that user only; ids from the form are looked up within the
// user's own rows by the commands. The rules are the MCP tools' rules: same commands underneath.

export type ActionState = {
  ok: boolean;
  message: string;
  // Categorising would also change this many similar transactions: ask before doing it.
  confirm?: { wouldAlsoChange: number };
} | null;

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === '1', z.boolean());
const optionalText = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined), z.string().optional());

const amount = (field: string) =>
  z.string().transform((value, ctx) => {
    try {
      return parseAmount(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${field} must be an amount in rands, e.g. 1500 or 1500.50` });
      return z.NEVER;
    }
  });

const emoji = z.string().transform((value, ctx) => {
  if (value.trim() === '') return null;
  return parseEmoji(value) ?? (ctx.addIssue({ code: 'custom', message: 'Emoji must be a single emoji, e.g. 🛒' }), z.NEVER);
});

function fail(err: unknown): ActionState {
  if (err instanceof z.ZodError) return { ok: false, message: err.issues.map((i) => i.message).join('; ') };
  if (err instanceof CommandError || err instanceof ConflictError || err instanceof InvalidInputError || err instanceof NotFoundError) {
    return { ok: false, message: err.message };
  }
  console.error('dashboard action failed', err);
  return { ok: false, message: 'Something went wrong. Try again.' };
}

function done(message: string): ActionState {
  revalidatePath('/dashboard', 'layout');
  return { ok: true, message };
}

const categoriseInput = z.object({
  transactionId: z.uuid(),
  categoryId: z.string().min(1, 'Pick a category'),
  confirm: checkbox,
});

export async function categoriseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await requireUser();
  try {
    const input = categoriseInput.parse(Object.fromEntries(form));
    const result = await commands.categorise(userId, {
      transactionId: input.transactionId,
      category: input.categoryId,
      applyToSimilar: true,
      confirm: input.confirm,
    });
    if (result.status === 'needs_confirmation') {
      return {
        ok: false,
        message: `This also categorises ${result.wouldAlsoChange} other transactions with the same description as ${result.category.name}.`,
        confirm: { wouldAlsoChange: result.wouldAlsoChange },
      };
    }
    return done(`${result.category.name}${result.appliedTo ? `, plus ${result.appliedTo} similar` : ''}`);
  } catch (err) {
    return fail(err);
  }
}

const transactionInput = z.object({ transactionId: z.uuid(), excluded: checkbox });

// Excludes (soft-deletes) or restores, whichever the form asks for.
export async function setExcludedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await requireUser();
  try {
    const { transactionId, excluded } = transactionInput.parse(Object.fromEntries(form));
    await (excluded ? commands.exclude(userId, transactionId) : commands.restore(userId, transactionId));
    return done(excluded ? 'Excluded' : 'Restored');
  } catch (err) {
    return fail(err);
  }
}

const budgetItemInput = z.object({
  categoryId: z.uuid(),
  allocated: amount('Budget'),
  expenseType: z.enum(EXPENSE_TYPES),
  expectedDay: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined),
    z.number({ error: 'Day must be a number' }).int().min(1, 'Day must be 1-31').max(31, 'Day must be 1-31').optional(),
  ),
  active: checkbox,
  emoji,
});

export async function saveBudgetItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await requireUser();
  try {
    const input = budgetItemInput.parse(Object.fromEntries(form));
    await commands.setCategoryEmoji(userId, input.categoryId, input.emoji);
    const line = await commands.setBudgetItem(userId, input.categoryId, {
      allocatedCents: input.allocated,
      expenseType: input.expenseType,
      expectedDay: input.expenseType === 'static' ? (input.expectedDay ?? null) : null,
      isActive: input.active,
    });
    return done(`Saved ${line.categoryName}`);
  } catch (err) {
    return fail(err);
  }
}

const newCategoryInput = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(40, 'Names are at most 40 characters'),
  kind: z.enum(['expense', 'income']),
  expenseType: z.enum(EXPENSE_TYPES),
  allocated: optionalText.pipe(amount('Budget').optional()),
  emoji,
});

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await requireUser();
  try {
    const input = newCategoryInput.parse(Object.fromEntries(form));
    await commands.createCategory(userId, {
      name: input.name,
      kind: input.kind,
      expenseType: input.expenseType,
      allocatedCents: input.kind === 'expense' ? input.allocated : undefined,
      emoji: input.emoji,
    });
    return done(`Created ${input.name}`);
  } catch (err) {
    return fail(err);
  }
}

const salaryInput = z.object({
  salaryDay: z.coerce.number().int().min(1, 'Salary day must be 1-31').max(31, 'Salary day must be 1-31'),
  expectedSalary: optionalText.pipe(amount('Expected salary').optional()),
  tolerancePct: z.coerce.number().int().min(0, 'Tolerance must be 0-100').max(100, 'Tolerance must be 0-100'),
});

export async function saveSalaryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await requireUser();
  try {
    const input = salaryInput.parse(Object.fromEntries(form));
    const { cycle } = await commands.setSalaryConfig(userId, {
      salaryDayHint: input.salaryDay,
      expectedSalaryCents: input.expectedSalary ?? null,
      salaryTolerancePct: input.tolerancePct,
    });
    return done(`Saved. Current cycle: ${cycle.label}, next salary ${cycle.end}${cycle.endIsProjected ? ' (projected)' : ''}.`);
  } catch (err) {
    if (err instanceof CommandError && err.code === 'zero_salary') return { ok: false, message: `${err.message} Leave it empty to accept any amount.` };
    return fail(err);
  }
}

const notificationsInput = z.object({
  digestEnabled: checkbox,
  digestHour: z.coerce.number().int().min(0, 'Hour must be 0-23').max(23, 'Hour must be 0-23'),
  alertsEnabled: checkbox,
});

export async function saveNotificationsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await requireUser();
  try {
    const input = notificationsInput.parse(Object.fromEntries(form));
    await commands.setNotificationSettings(userId, {
      digestEnabled: input.digestEnabled,
      digestHour: input.digestHour,
      discordAlertsEnabled: input.alertsEnabled,
    });
    return done('Saved');
  } catch (err) {
    return fail(err);
  }
}
