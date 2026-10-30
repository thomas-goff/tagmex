import type { ExpenseType } from '@/features/categorisation/types';
import type { CycleSummary } from './summary';

// Spending across cycles, from their summaries (oldest first, current last).
//
// "On pace" projects the current cycle to its end, per category by type: dynamic spending scales
// with the days elapsed; a static item adds its allocation while its debit order is still pending;
// irregular spending is one-off, so it isn't extrapolated.

export interface CategoryTrend {
  categoryId: string;
  name: string;
  expenseType: ExpenseType;
  // One per cycle, same order as `cycles`.
  spentCents: number[];
  // Average over completed cycles; null when there are none.
  averageCents: number | null;
  // Current cycle only.
  onPaceCents: number | null;
  allocatedCents: number;
}

export interface SpendingTrend {
  cycles: { id: string; label: string; start: string; end: string; complete: boolean; spentCents: number; incomeCents: number }[];
  categories: CategoryTrend[];
  // Current cycle's total projected to its end; null when the last summary isn't the current cycle.
  onPaceTotalCents: number | null;
  averageCompletedCents: number | null;
}

export function onPaceCents(summary: CycleSummary, categoryId: string) {
  const line = summary.categories.find((c) => c.categoryId === categoryId);
  if (!line) return 0;
  const { daysElapsed, daysTotal } = summary.status;
  if (line.expenseType === 'dynamic') return Math.round((line.spentCents * daysTotal) / Math.max(daysElapsed, 1));
  if (line.expenseType === 'static') {
    const pending = summary.pendingDebitOrders.some((p) => p.categoryId === categoryId);
    return line.spentCents + (pending ? line.allocatedCents : 0);
  }
  return line.spentCents;
}

export function spendingTrend(summaries: readonly CycleSummary[]): SpendingTrend {
  const current = summaries.at(-1)?.status.isCurrent ? summaries.at(-1)! : null;
  const completed = summaries.filter((s) => !s.status.isCurrent);

  const meta = new Map<string, { name: string; expenseType: ExpenseType; allocatedCents: number }>();
  for (const s of summaries) {
    for (const c of s.categories) meta.set(c.categoryId, { name: c.name, expenseType: c.expenseType, allocatedCents: c.allocatedCents });
  }

  const categories: CategoryTrend[] = [...meta].map(([categoryId, m]) => {
    const spentIn = (s: CycleSummary) => s.categories.find((c) => c.categoryId === categoryId)?.spentCents ?? 0;
    return {
      categoryId,
      ...m,
      spentCents: summaries.map(spentIn),
      averageCents: average(completed.map(spentIn)),
      onPaceCents: current ? onPaceCents(current, categoryId) : null,
    };
  });
  categories.sort((a, b) => (b.onPaceCents ?? b.averageCents ?? 0) - (a.onPaceCents ?? a.averageCents ?? 0));

  return {
    cycles: summaries.map((s) => ({
      id: s.cycle.id,
      label: s.cycle.label,
      start: s.cycle.start,
      end: s.cycle.end,
      complete: !s.status.isCurrent,
      spentCents: s.spentCents,
      incomeCents: s.incomeCents,
    })),
    categories,
    onPaceTotalCents: current ? categories.reduce((sum, c) => sum + (c.onPaceCents ?? 0), 0) : null,
    averageCompletedCents: average(completed.map((s) => s.spentCents)),
  };
}

function average(values: number[]) {
  return values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
