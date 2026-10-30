import type { CycleSummary } from '@/features/budget/summary';
import type { Cycle } from '@/features/cycle/cycle';
import { addDays } from '@/features/cycle/dates';
import { formatRand } from '@/features/sync/format';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';

// What tools send back to the model: amounts as decimal strings in ZAR, dates as YYYY-MM-DD in
// South African time with cycle ids, and bank text marked as untrusted.

export const CURRENCY = 'ZAR';
export const rand = formatRand;
export const money = centsToDecimal;

const DESCRIPTION_LIMIT = 80;

// Transaction descriptions come from bank emails, i.e. from outside: strip control and
// formatting characters and cap the length so they can't smuggle instructions or flood context.
export function untrusted(text: string, limit = DESCRIPTION_LIMIT) {
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

// Money from the model: 1500, 1500.5, "1500.50", "R1,500.50". Never negative.
export function parseAmount(value: number | string) {
  const text = typeof value === 'number' ? String(value) : value.replace(/^\s*R\s*/i, '').replace(/[\s,]/g, '');
  const cents = decimalToCents(text);
  if (cents < 0) throw new RangeError('amount must not be negative');
  return cents;
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

export function categoriesJson(s: CycleSummary) {
  return s.categories.map((c) => ({
    category_id: c.categoryId,
    category: c.name,
    type: c.expenseType,
    allocated: money(c.allocatedCents),
    spent: money(c.spentCents),
    remaining: money(c.remainingCents),
    used_pct: c.usedPct,
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
      amount: money(p.allocatedCents),
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
