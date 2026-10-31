import type { Cycle, CycleStatus } from '@/features/cycle/cycle';
import { addDays, daysInMonth, isoDate, normaliseMonth, parts } from '@/features/cycle/dates';
import type { ExpenseType } from '@/features/categorisation/types';
import type { BudgetLine, LedgerRow } from './types';

// The numbers behind "where do I stand". Definitions (repeated in the MCP tool descriptions):
//   spent (category)    = -(sum of amounts) in that expense category this cycle; refunds net off
//   remaining           = allocated - spent; negative = overspent
//   income              = sum of amounts in income categories (salary and other income)
//   pending debit order = an active static item with an allocation and no money out in its
//                         category yet this cycle
//   discretionary left  = sum of max(allocated - spent, 0) over active dynamic and irregular items
//   daily allowance     = discretionary left / max(days to salary, 1)
//   net                 = income - spent
//   yesterday out       = money out the day before today: expense and uncategorised outflows,
//                         gross (a refund doesn't hide what went out), not transfers or income
//   status              = settled: a static item paid in full (spent >= allocated). Paying a debit
//                         order is the plan working, so it's never "over budget", whatever the
//                         difference; differenceCents says by how much it was off.
//                         pending: a static item not paid in full yet.
//                         on_track / warning / over: dynamic and irregular items under 80%, from
//                         80%, and from 100% used. unbudgeted: nothing allocated.
// Transfers (category kind `transfer`) count as neither. Uncategorised rows count as neither too,
// and are reported separately because they make every other number less accurate.

export type CategoryStatus = 'unbudgeted' | 'settled' | 'pending' | 'on_track' | 'warning' | 'over';

// The share of a dynamic or irregular budget that counts as "warning".
export const WARNING_PCT = 80;

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
}

export interface PendingDebitOrder {
  categoryId: string;
  name: string;
  allocatedCents: number;
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
  spentCents: number;
  netCents: number;
  // Active items only.
  allocatedCents: number;
  categories: CategoryLine[];
  pendingDebitOrders: PendingDebitOrder[];
  pendingTotalCents: number;
  discretionaryLeftCents: number;
  // Current cycle only, and not while salary is overdue.
  dailyAllowanceCents: number | null;
  uncategorised: { count: number; outCents: number; inCents: number };
  // Only when the day before today is in this cycle: on a cycle's first day it's in the last one.
  yesterday: DayOut | null;
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
}

export function summariseCycle({ cycle, status, today, rows, lines }: Input): CycleSummary {
  const spentBy = new Map<string, { cents: number; count: number; hasOutflow: boolean; name: string | null; emoji: string | null }>();
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
      const entry = spentBy.get(row.categoryId) ?? { cents: 0, count: 0, hasOutflow: false, name: row.categoryName, emoji: row.categoryEmoji };
      entry.cents += -row.amountCents;
      entry.count++;
      entry.hasOutflow ||= row.amountCents < 0;
      spentBy.set(row.categoryId, entry);
    }
  }

  const categories: CategoryLine[] = [...lines]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryName.localeCompare(b.categoryName))
    .filter((l) => l.isActive || spentBy.has(l.categoryId))
    .map((l) =>
      categoryLine(
        { categoryId: l.categoryId, name: l.categoryName, emoji: l.categoryEmoji, expenseType: l.expenseType },
        l.allocatedCents,
        l.isActive,
        spentBy.get(l.categoryId),
      ),
    );
  // Spending in a category with no budget item (ensureBudgetItems should prevent this) still counts.
  const known = new Set(lines.map((l) => l.categoryId));
  for (const [categoryId, spent] of spentBy) {
    if (!known.has(categoryId)) {
      categories.push(categoryLine({ categoryId, name: spent.name ?? 'Unknown', emoji: spent.emoji, expenseType: 'dynamic' }, 0, true, spent));
    }
  }

  const active = lines.filter((l) => l.isActive);
  const pendingDebitOrders = active
    .filter((l) => l.expenseType === 'static' && l.allocatedCents > 0 && !spentBy.get(l.categoryId)?.hasOutflow)
    .map((l) => {
      const expectedOn = l.expectedDay === null ? null : dateInCycle(cycle, l.expectedDay);
      return {
        categoryId: l.categoryId,
        name: l.categoryName,
        allocatedCents: l.allocatedCents,
        expectedDay: l.expectedDay,
        expectedOn,
        late: status.isCurrent && expectedOn !== null && expectedOn < today,
      };
    })
    .sort((a, b) => (a.expectedOn ?? '9999').localeCompare(b.expectedOn ?? '9999') || a.name.localeCompare(b.name));

  const byId = new Map(categories.map((c) => [c.categoryId, c]));
  const discretionaryLeftCents = active
    .filter((l) => l.expenseType !== 'static')
    .reduce((sum, l) => sum + Math.max(byId.get(l.categoryId)?.remainingCents ?? l.allocatedCents, 0), 0);

  const spentCents = categories.reduce((sum, c) => sum + c.spentCents, 0);
  return {
    cycle,
    status,
    today,
    incomeCents,
    spentCents,
    netCents: incomeCents - spentCents,
    allocatedCents: active.reduce((sum, l) => sum + l.allocatedCents, 0),
    categories,
    pendingDebitOrders,
    pendingTotalCents: pendingDebitOrders.reduce((sum, p) => sum + p.allocatedCents, 0),
    discretionaryLeftCents,
    // Not while salary is overdue: with no known payday, "per day" would mean everything today.
    dailyAllowanceCents:
      status.daysToSalary === null || status.salaryOverdue
        ? null
        : Math.floor(discretionaryLeftCents / Math.max(status.daysToSalary, 1)),
    uncategorised,
    yesterday: dayOut(cycle, status, rows, addDays(today, -1)),
  };
}

// A current cycle whose salary is late runs past its projected end, so its rows reach today.
function dayOut(cycle: Cycle, status: CycleStatus, rows: readonly LedgerRow[], date: string): DayOut | null {
  if (date < cycle.start || (date >= cycle.end && !status.isCurrent)) return null;
  const out = rows.filter((r) => r.occurredOn === date && r.amountCents < 0 && r.categoryKind !== 'transfer' && r.categoryKind !== 'income');
  return { date, outCents: out.reduce((sum, r) => sum - r.amountCents, 0), count: out.length };
}

function categoryLine(
  category: Pick<CategoryLine, 'categoryId' | 'name' | 'emoji' | 'expenseType'>,
  allocatedCents: number,
  isActive: boolean,
  spent: { cents: number; count: number } | undefined,
): CategoryLine {
  const spentCents = spent?.cents ?? 0;
  const status = categoryStatus(category.expenseType, allocatedCents, spentCents);
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
  if (expenseType === 'static') return spentCents >= allocatedCents ? 'settled' : 'pending';
  if (spentCents >= allocatedCents) return 'over';
  return spentCents * 100 >= allocatedCents * WARNING_PCT ? 'warning' : 'on_track';
}

// Overspent in the "over budget" sense: settled static items never are.
export function isOverspent(c: Pick<CategoryLine, 'status' | 'remainingCents'>) {
  return c.status === 'over' && c.remainingCents < 0;
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
