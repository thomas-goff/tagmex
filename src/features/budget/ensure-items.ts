import type { ExpenseType } from '@/features/categorisation/types';

export interface ExpenseCategory {
  id: string;
  // The category's seeded type, used once to create its budget item. Null → dynamic.
  expenseType: ExpenseType | null;
  sortOrder: number;
}

export interface NewBudgetItem {
  categoryId: string;
  expenseType: ExpenseType;
  sortOrder: number;
}

// The R0 items expense categories are missing. Run on every read (ensureBudgetItems), so a category
// created through MCP or a correction never leaves a gap, with no trigger or sync job to drift.
export function missingBudgetItems(categories: readonly ExpenseCategory[], existing: ReadonlySet<string>): NewBudgetItem[] {
  return categories
    .filter((c) => !existing.has(c.id))
    .map((c) => ({ categoryId: c.id, expenseType: c.expenseType ?? 'dynamic', sortOrder: c.sortOrder }));
}
