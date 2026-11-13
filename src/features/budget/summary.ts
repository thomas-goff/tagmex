import type { Cycle, CycleStatus } from '@/features/cycle/cycle';
import { addDays, daysInMonth, isoDate, normaliseMonth, parts } from '@/features/cycle/dates';
import type { ExpenseType } from '@/features/categorisation/types';
import type { BudgetLine, LedgerRow } from './types';

// The numbers behind "where do I stand". Definitions (repeated in the MCP tool descriptions):
//   spent (category)    = -(sum of amounts) in that expense category this cycle; refunds net off
//   remaining           = allocated - spent; negative = overspent
//   income              = sum of amounts in income categories (salary and other income)
//   saved               = what went into savings categories (is_savings). Saved, not spent: it is
//                         in neither `spent` nor `net`'s deductions
//   spent (cycle)       = the sum over expense categories that aren't savings
//   net                 = income - spent (what was kept, saved or not)
//   pending debit order = an active static (or savings) item not paid in full yet; what's still to
//                         come is allocated - paid, so a part-paid item shows its remainder
//   committed           = the sum still to come on pending debit orders
//   left                = income - spent - saved - committed: the money not yet spoken for. With no
//                         salary this cycle to measure against, the budget total stands in for
//                         income. Negative = more has gone out (or is committed) than came in
//   discretionary left  = the smaller of `left` and the unspent part of the dynamic and irregular
//                         budgets. So overspending anywhere (over a budget, in a category with no
//                         budget, a debit order that cost more) comes off it, and income beyond
//                         the budget doesn't inflate it
//   daily allowance     = max(discretionary left, 0) / max(days to salary, 1)
//   yesterday out       = money out the day before today: expense and uncategorised outflows,
//                         gross (a refund doesn't hide what went out), not transfers, income or
//                         savings
//   status              = settled: a static item paid in full, i.e. within SETTLED_PCT of its
//                         allocation (R995 of R1,000 is paid). Paying a debit order is the plan
//                         working, so it's never "over budget"; differenceCents says by how much
//                         it was off, and isWellAboveBudget flags one that cost far more.
//                         pending: a static item not paid in full yet.
//                         on_track / warning / over: dynamic and irregular items under 80%, from
//                         80%, and from 100% used. unbudgeted: nothing allocated.
//                         Savings items are settled or pending whatever their type.
// Transfers (category kind `transfer`) count as neither. Uncategorised rows count as neither too,
// and are reported separately because they make every other number less accurate.

export type CategoryStatus = 'unbudgeted' | 'settled' | 'pending' | 'on_track' | 'warning' | 'over';

// The share of a dynamic or irregular budget that counts as "warning".
export const WARNING_PCT = 80;
// A static item counts as paid from this share of its allocation: debit orders vary by a few rand.
export const SETTLED_PCT = 95;
// A settled static item that cost this much more than budgeted (in percent) is worth an alert.
export const WELL_ABOVE_PCT = 20;

export interface CategoryLine {
  categoryId: string;
  name: string;
  emoji: string | null;
  expenseType: ExpenseType;
  allocatedCents: number;
  spentCents: number;
  remainingCents: number;
  // spent / allocated, rounded; null when nothing is allocated.
  usedPct: number | null;
  status: CategoryStatus;
  // Settled items: spent - allocated (positive = paid more than budgeted). Zero otherwise.
  differenceCents: number;
  transactionCount: number;
  isActive: boolean;
  // A savings category: its "spent" is money saved.
  isSavings: boolean;
}

export interface PendingDebitOrder {
  categoryId: string;
  name: string;
  allocatedCents: number;
  // Already paid this cycle (a part payment, or one of several debit orders in the category).
  paidCents: number;
  // Still to come: allocated - paid.
  remainingCents: number;
  expectedDay: number | null;
  // The expected day's date inside this cycle, when it has one.
  expectedOn: string | null;
  // Current cycle only: the expected date has passed.
  late: boolean;
}

export interface CycleSummary {
  cycle: Cycle;
  status: CycleStatus;
  today: string;
  incomeCents: number;
  // Savings categories excluded.
  spentCents: number;
  savedCents: number;
  netCents: number;
  // Active items only.
  allocatedCents: number;
  categories: CategoryLine[];
  pendingDebitOrders: PendingDebitOrder[];
  // What's still to come on them.
  pendingTotalCents: number;
  // income - spent - saved - pending: money not yet spoken for. May be negative.
  leftCents: number;
  // The smaller of leftCents and the unspent dynamic and irregular budgets. May be negative.
  discretionaryLeftCents: number;
  // Current cycle only, and not while salary is overdue.
  dailyAllowanceCents: number | null;
  uncategorised: { count: number; outCents: number; inCents: number };
  // Only when the day before today is in this cycle: on a cycle's first day it's in the last one.
  yesterday: DayOut | null;
  // False when the cycle began before the ledger's first transaction (tracking started part-way
  // through, or later): its totals are incomplete, so nothing is compared against it.
  hasFullData: boolean;
}

export interface DayOut {
  date: string;
  outCents: number;
  count: number;
}

interface Input {
  cycle: Cycle;
  status: CycleStatus;
  today: string;
  rows: readonly LedgerRow[];
  lines: readonly BudgetLine[];
  // Defaults to true: the service works it out from the ledger's first transaction.
  hasFullData?: boolean;
}

export function summariseCycle({ cycle, status, today, rows, lines, hasFullData = true }: Input): CycleSummary {
  const spentBy = new Map<string, { cents: number; count: number; name: string | null; emoji: string | null; isSavings: boolean }>();
  const uncategorised = { count: 0, outCents: 0, inCents: 0 };
  let incomeCents = 0;

  for (const row of rows) {
    if (row.categoryId === null || row.categoryKind === null) {
      uncategorised.count++;
      if (row.amountCents < 0) uncategorised.outCents += -row.amountCents;
      else uncategorised.inCents += row.amountCents;
    } else if (row.categoryKind === 'income') {
      incomeCents += row.amountCents;
    } else if (row.categoryKind === 'expense') {
      const entry = spentBy.get(row.categoryId) ?? { cents: 0, count: 0, name: row.categoryName, emoji: row.categoryEmoji, isSavings: row.categoryIsSavings };
      entry.cents += -row.amountCents;
      entry.count++;
      spentBy.set(row.categoryId, entry);
    }
  }

  const categories: CategoryLine[] = [...lines]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryName.localeCompare(b.categoryName))
    .filter((l) => l.isActive || spentBy.has(l.categoryId))
    .map((l) =>
      categoryLine(
        { categoryId: l.categoryId, name: l.categoryName, emoji: l.categoryEmoji, expenseType: l.expenseType, isSavings: l.isSavings },
        l.allocatedCents,
        l.isActive,
        spentBy.get(l.categoryId),
      ),
    );
  // Spending in a category with no budget item (ensureBudgetItems should prevent this) still counts.
  const known = new Set(lines.map((l) => l.categoryId));
  for (const [categoryId, spent] of spentBy) {
    if (!known.has(categoryId)) {
      categories.push(categoryLine({ categoryId, name: spent.name ?? 'Unknown', emoji: spent.emoji, expenseType: 'dynamic', isSavings: spent.isSavings }, 0, true, spent));
    }
  }

  const byId = new Map(categories.map((c) => [c.categoryId, c]));
  const active = lines.filter((l) => l.isActive);
  const pendingDebitOrders = active
    .filter((l) => byId.get(l.categoryId)?.status === 'pending')
    .map((l) => {
      const expectedOn = l.expectedDay === null ? null : dateInCycle(cycle, l.expectedDay);
      const paidCents = Math.max(byId.get(l.categoryId)?.spentCents ?? 0, 0);
      return {
        categoryId: l.categoryId,
        name: l.categoryName,
        allocatedCents: l.allocatedCents,
        paidCents,
        remainingCents: l.allocatedCents - paidCents,
        expectedDay: l.expectedDay,
        expectedOn,
        late: status.isCurrent && expectedOn !== null && expectedOn < today,
      };
    })
    .sort((a, b) => (a.expectedOn ?? '9999').localeCompare(b.expectedOn ?? '9999') || a.name.localeCompare(b.name));
  const pendingTotalCents = pendingDebitOrders.reduce((sum, p) => sum + p.remainingCents, 0);

  const allocatedCents = active.reduce((sum, l) => sum + l.allocatedCents, 0);
  const spentCents = categories.filter((c) => !c.isSavings).reduce((sum, c) => sum + c.spentCents, 0);
  const savedCents = categories.filter((c) => c.isSavings).reduce((sum, c) => sum + c.spentCents, 0);
  // A cycle no salary opened (before the first one, or projected) has no income to measure against.
  const comeIn = cycle.salary ? incomeCents : Math.max(incomeCents, allocatedCents);
  const leftCents = comeIn - spentCents - savedCents - pendingTotalCents;
  const unspentBudgetsCents = active
    .filter((l) => l.expenseType !== 'static' && !l.isSavings)
    .reduce((sum, l) => sum + Math.max(byId.get(l.categoryId)?.remainingCents ?? l.allocatedCents, 0), 0);
  const discretionaryLeftCents = Math.min(unspentBudgetsCents, leftCents);

  return {
    cycle,
    status,
    today,
    incomeCents,
    spentCents,
    savedCents,
    netCents: incomeCents - spentCents,
    allocatedCents,
    categories,
    pendingDebitOrders,
    pendingTotalCents,
    leftCents,
    discretionaryLeftCents,
    // Not while salary is overdue: with no known payday, "per day" would mean everything today.
    dailyAllowanceCents:
      status.daysToSalary === null || status.salaryOverdue
        ? null
        : Math.floor(Math.max(discretionaryLeftCents, 0) / Math.max(status.daysToSalary, 1)),
    uncategorised,
    yesterday: dayOut(cycle, status, rows, addDays(today, -1)),
    hasFullData,
  };
}

// A current cycle whose salary is late runs past its projected end, so its rows reach today.
function dayOut(cycle: Cycle, status: CycleStatus, rows: readonly LedgerRow[], date: string): DayOut | null {
  if (date < cycle.start || (date >= cycle.end && !status.isCurrent)) return null;
  const out = rows.filter(
    (r) => r.occurredOn === date && r.amountCents < 0 && r.categoryKind !== 'transfer' && r.categoryKind !== 'income' && !r.categoryIsSavings,
  );
  return { date, outCents: out.reduce((sum, r) => sum - r.amountCents, 0), count: out.length };
}

function categoryLine(
  category: Pick<CategoryLine, 'categoryId' | 'name' | 'emoji' | 'expenseType' | 'isSavings'>,
  allocatedCents: number,
  isActive: boolean,
  spent: { cents: number; count: number } | undefined,
): CategoryLine {
  const spentCents = spent?.cents ?? 0;
  // Savings is a commitment like a debit order, whatever type it was given.
  const status = categoryStatus(category.isSavings ? 'static' : category.expenseType, allocatedCents, spentCents);
  return {
    ...category,
    allocatedCents,
    spentCents,
    remainingCents: allocatedCents - spentCents,
    usedPct: allocatedCents > 0 ? Math.round((spentCents * 100) / allocatedCents) : null,
    status,
    differenceCents: status === 'settled' ? spentCents - allocatedCents : 0,
    transactionCount: spent?.count ?? 0,
    isActive,
  };
}

export function categoryStatus(expenseType: ExpenseType, allocatedCents: number, spentCents: number): CategoryStatus {
  if (allocatedCents <= 0) return 'unbudgeted';
  if (expenseType === 'static') return spentCents * 100 >= allocatedCents * SETTLED_PCT ? 'settled' : 'pending';
  if (spentCents >= allocatedCents) return 'over';
  return spentCents * 100 >= allocatedCents * WARNING_PCT ? 'warning' : 'on_track';
}

// Overspent in the "over budget" sense: settled static items never are.
export function isOverspent(c: Pick<CategoryLine, 'status' | 'remainingCents'>) {
  return c.status === 'over' && c.remainingCents < 0;
}

// A settled debit order that cost far more than budgeted: not overspending, but worth saying so.
export function isWellAboveBudget(c: Pick<CategoryLine, 'status' | 'differenceCents' | 'allocatedCents' | 'isSavings'>) {
  return c.status === 'settled' && !c.isSavings && c.differenceCents * 100 >= c.allocatedCents * WELL_ABOVE_PCT;
}

// The first date in [start, end) whose day of the month is `day` (clamped to short months).
export function dateInCycle({ start, end }: Pick<Cycle, 'start' | 'end'>, day: number) {
  const { year, month } = parts(start);
  for (let offset = 0; offset < 3; offset++) {
    const m = normaliseMonth(year, month + offset);
    const date = isoDate(m.year, m.month, Math.min(day, daysInMonth(m.year, m.month)));
    if (date >= end) return null;
    if (date >= start) return date;
  }
  return null;
}
