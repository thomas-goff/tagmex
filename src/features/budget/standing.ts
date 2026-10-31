import type { CategoryLine, CycleSummary } from './summary';

// A transaction's category budget this cycle, plus payday, for its Discord message. Null for
// transactions from before the current cycle, and for categories with no budget line (income,
// transfers).
export interface BudgetStanding {
  category: Pick<
    CategoryLine,
    'categoryId' | 'name' | 'emoji' | 'expenseType' | 'allocatedCents' | 'spentCents' | 'remainingCents' | 'usedPct' | 'status' | 'differenceCents'
  >;
  payday: Payday;
}

export interface Payday {
  // Null when salary is overdue (or the cycle isn't current).
  daysToSalary: number | null;
  salaryOverdue: boolean;
}

export function paydayOf(summary: CycleSummary): Payday {
  return {
    daysToSalary: summary.status.isCurrent && !summary.status.salaryOverdue ? summary.status.daysToSalary : null,
    salaryOverdue: summary.status.salaryOverdue,
  };
}

export function budgetStanding(summary: CycleSummary, categoryId: string | null | undefined, occurredOn: string): BudgetStanding | null {
  if (!categoryId || occurredOn < summary.cycle.start) return null;
  const line = summary.categories.find((c) => c.categoryId === categoryId);
  if (!line) return null;
  const { categoryId: id, name, emoji, expenseType, allocatedCents, spentCents, remainingCents, usedPct, status, differenceCents } = line;
  return {
    category: { categoryId: id, name, emoji, expenseType, allocatedCents, spentCents, remainingCents, usedPct, status, differenceCents },
    payday: paydayOf(summary),
  };
}
