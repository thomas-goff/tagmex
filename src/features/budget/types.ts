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
  categoryEmoji: string | null;
  // Money moved into this category is saved, not spent. False when uncategorised.
  categoryIsSavings: boolean;
}

// A budget item joined with its category.
export interface BudgetLine {
  categoryId: string;
  categoryName: string;
  categoryEmoji: string | null;
  expenseType: ExpenseType;
  // Per cycle, >= 0.
  allocatedCents: number;
  // Static items: day of the month the debit order normally runs.
  expectedDay: number | null;
  isActive: boolean;
  sortOrder: number;
  // A savings category: what goes into it counts as saved, not spent.
  isSavings: boolean;
}

// A budget item as stored: one row per category per effective date. `effectiveFrom` is the first
// cycle start the figures apply to, so a cycle reads the newest version dated on or before its
// start and a change scheduled for later sits here until that cycle comes round.
export interface BudgetLineVersion extends BudgetLine {
  effectiveFrom: string;
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

// These must stay equal to the `user_settings` column defaults in src/db/schema.ts: getSettings
// returns these when the user has no row yet rather than creating one, so the two are the same
// answer by different routes.
export const DEFAULT_SETTINGS: Settings = {
  salaryDayHint: 31,
  expectedSalaryCents: null,
  salaryTolerancePct: 20,
  timezone: 'Africa/Johannesburg',
  digestHour: 7,
  digestEnabled: true,
  discordAlertsEnabled: true,
};
