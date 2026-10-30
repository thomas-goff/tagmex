import type { CategoryKind, ExpenseType } from '@/features/categorisation/types';

// Plain data the budget maths runs on. Amounts are integer cents; negative = money out.

// A transaction in a cycle, with its category's kind (null = uncategorised).
export interface LedgerRow {
  id: string;
  occurredOn: string;
  amountCents: number;
  categoryId: string | null;
  categoryKind: CategoryKind | null;
  categoryName: string | null;
}

// A budget item joined with its category.
export interface BudgetLine {
  categoryId: string;
  categoryName: string;
  expenseType: ExpenseType;
  // Per cycle, >= 0.
  allocatedCents: number;
  // Static items: day of the month the debit order normally runs.
  expectedDay: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface Settings {
  salaryDayHint: number;
  expectedSalaryCents: number | null;
  salaryTolerancePct: number;
  timezone: string;
  digestHour: number;
  digestEnabled: boolean;
  discordAlertsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  salaryDayHint: 31,
  expectedSalaryCents: null,
  salaryTolerancePct: 20,
  timezone: 'Africa/Johannesburg',
  digestHour: 7,
  digestEnabled: true,
  discordAlertsEnabled: true,
};
