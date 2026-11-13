import { z } from 'zod';
import { maskedAccount, type AccountLabel, type KnownAccount, type Labeller } from '@/features/accounts/labels';
import type { TransactionView } from '@/features/budget/repo';
import type { Tip } from '@/features/budget/tips';
import type { CycleSummary } from '@/features/budget/summary';
import type { Cycle } from '@/features/cycle/cycle';
import { cleanText } from '@/features/text/clean';
import { addDays } from '@/features/cycle/dates';
import { centsToDecimal, formatRand, parseAmount } from '@/features/transactions/money';

// What tools send back to the model: amounts as decimal strings in ZAR, dates as YYYY-MM-DD in
// South African time with cycle ids, and bank text marked as untrusted.

export const CURRENCY = 'ZAR' as const;
export const rand = formatRand;
export const money = centsToDecimal;
export { parseAmount };

const DESCRIPTION_LIMIT = 80;

// Transaction descriptions come from bank emails, i.e. from outside: cleaned and capped before a
// model sees them.
export function untrusted(text: string, limit = DESCRIPTION_LIMIT) {
  return cleanText(text, limit);
}

// A transaction's account, with the user's name for it.
export function accountJson(labels: Labeller, a: KnownAccount) {
  return { account: maskedAccount(a), account_label: labels.account(a)?.label ?? null };
}

export function counterpartyJson(label: AccountLabel | null) {
  return label && { label: label.label, note: label.note, matched_text: label.match };
}

export function cycleJson(c: Cycle, isCurrent: boolean) {
  return {
    cycle_id: c.id,
    label: c.label,
    start: c.start,
    // Inclusive last day, for people; `next_salary_on` is the exclusive end.
    last_day: addDays(c.end, -1),
    next_salary_on: c.end,
    next_salary_is_projected: c.endIsProjected,
    salary_received_on: c.salary?.occurredOn ?? null,
    is_current: isCurrent,
  };
}

// ── Output schemas ──────────────────────────────────────────────────────────────────────────────
// What each tool's structured result looks like, advertised to clients (outputSchema) and checked
// before a result leaves the server. Shared shapes live here; each tool composes its own.

const amount = z.string().describe('ZAR, a decimal string such as "1500.00"');
const day = z.string().describe('YYYY-MM-DD');

export const cycleSchema = z.object({
  cycle_id: day,
  label: z.string(),
  start: day,
  last_day: day,
  next_salary_on: day,
  next_salary_is_projected: z.boolean(),
  salary_received_on: day.nullable(),
  is_current: z.boolean(),
});

export const categoryLineSchema = z.object({
  category_id: z.string(),
  category: z.string(),
  emoji: z.string().nullable(),
  type: z.enum(['static', 'dynamic', 'irregular']),
  savings: z.boolean(),
  allocated: amount,
  spent: amount,
  remaining: amount,
  used_pct: z.number().nullable(),
  status: z.enum(['unbudgeted', 'settled', 'pending', 'on_track', 'warning', 'over']),
  difference: amount.nullable(),
  transactions: z.number(),
  active: z.boolean(),
});

export const pendingSchema = z.object({
  total: amount,
  items: z.array(
    z.object({
      category_id: z.string(),
      category: z.string(),
      amount: amount.describe('Still to come'),
      allocated: amount,
      paid: amount,
      expected_day: z.number().nullable(),
      expected_on: day.nullable(),
      late: z.boolean(),
    }),
  ),
});

export const tipSchema = z.object({
  code: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const counterpartySchema = z.object({ label: z.string(), note: z.string().nullable(), matched_text: z.string() }).nullable();

export const transactionSchema = z.object({
  transaction_id: z.string(),
  date: day,
  amount,
  description: z.string(),
  category_id: z.string().nullable(),
  category: z.string().nullable(),
  categorised_by: z.enum(['user_rule', 'merchant_rule', 'transfer', 'manual', 'none']),
  bank_type: z.string(),
  account: z.string(),
  account_label: z.string().nullable(),
  counterparty: counterpartySchema,
  card_hold: z.boolean(),
  excluded: z.boolean(),
  split_of: z.string().nullable().describe('Set on a part of a split: the transaction it came from'),
});

export const currencySchema = z.literal('ZAR');

export function tipsJson(tips: readonly Tip[]) {
  return tips.map((t) => ({ code: t.code, severity: t.severity, message: t.message, data: t.data }));
}

export function transactionJson(t: TransactionView, labels: Labeller) {
  return {
    transaction_id: t.id,
    date: t.occurredOn,
    amount: money(t.amountCents),
    description: untrusted(t.description),
    category_id: t.categoryId,
    category: t.categoryName,
    categorised_by: t.categorySource,
    bank_type: t.kind,
    ...accountJson(labels, t),
    counterparty: counterpartyJson(labels.counterparty(t.description)),
    card_hold: t.reserved,
    excluded: t.isDeleted,
    split_of: t.splitOf,
  };
}

export function categoriesJson(s: CycleSummary) {
  return s.categories.map((c) => ({
    category_id: c.categoryId,
    category: c.name,
    emoji: c.emoji,
    type: c.expenseType,
    savings: c.isSavings,
    allocated: money(c.allocatedCents),
    spent: money(c.spentCents),
    remaining: money(c.remainingCents),
    used_pct: c.usedPct,
    status: c.status,
    difference: c.status === 'settled' ? money(c.differenceCents) : null,
    transactions: c.transactionCount,
    active: c.isActive,
  }));
}

export function pendingJson(s: CycleSummary) {
  return {
    total: money(s.pendingTotalCents),
    items: s.pendingDebitOrders.map((p) => ({
      category_id: p.categoryId,
      category: p.name,
      amount: money(p.remainingCents),
      allocated: money(p.allocatedCents),
      paid: money(p.paidCents),
      expected_day: p.expectedDay,
      expected_on: p.expectedOn,
      late: p.late,
    })),
  };
}

// Base64url JSON, opaque to the model.
export function encodeCursor(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
