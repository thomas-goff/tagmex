import type { BudgetLine } from '@/features/budget/types';
import type { SavingsAccount, SavingsLine } from './types';

// What the savings screen shows, worked out from what the app already knows. Pure: the page reads
// the pieces and these put them together, so the maths is testable without a database.
//
// Nothing here affects a budget or a cycle total. An account's balance is whichever figure its
// source carries, and "saved" is the sum of the balances actually known: an account whose source
// has nothing yet is counted nowhere rather than counted as zero.

export interface BankBalance {
  // accountKey(): type + last 4, e.g. "SAVE1234".
  match: string;
  availableCents: number | null;
  availableOn: string | null;
}

export interface Contribution {
  categoryId: string;
  // Everything ever moved into the category, as a positive figure.
  contributedCents: number;
}

export interface CategoryName {
  id: string;
  name: string;
  emoji: string | null;
}

export interface SavingsInput {
  accounts: readonly SavingsAccount[];
  // The budget in force now, for the amount per cycle.
  budgetLines: readonly BudgetLine[];
  banks: readonly BankBalance[];
  contributions: readonly Contribution[];
  categories: readonly CategoryName[];
}

function balanceOf(a: SavingsAccount, input: SavingsInput): { cents: number | null; on: string | null } {
  switch (a.balanceSource) {
    case 'bank': {
      const bank = a.accountMatch === null ? undefined : input.banks.find((b) => b.match === a.accountMatch);
      return { cents: bank?.availableCents ?? null, on: bank?.availableOn ?? null };
    }
    case 'manual':
      return { cents: a.manualBalanceCents, on: a.manualBalanceOn };
    default: {
      const c = a.categoryId === null ? undefined : input.contributions.find((x) => x.categoryId === a.categoryId);
      return { cents: c?.contributedCents ?? null, on: null };
    }
  }
}

export function savingsLines(input: SavingsInput): SavingsLine[] {
  return [...input.accounts]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((a) => {
      const category = a.categoryId === null ? undefined : input.categories.find((c) => c.id === a.categoryId);
      const budget = a.categoryId === null ? undefined : input.budgetLines.find((l) => l.categoryId === a.categoryId && l.isActive);
      const { cents, on } = balanceOf(a, input);
      const hasGoal = a.goalCents !== null && a.goalCents > 0 && cents !== null;
      return {
        ...a,
        categoryName: category?.name ?? null,
        categoryEmoji: category?.emoji ?? null,
        budgetedCents: budget?.allocatedCents ?? 0,
        balanceCents: cents,
        balanceOn: on,
        progressPct: hasGoal ? Math.round((cents! * 100) / a.goalCents!) : null,
        remainingCents: hasGoal ? Math.max(a.goalCents! - cents!, 0) : null,
      };
    });
}

export interface SavingsTotals {
  // Per cycle, across active accounts.
  budgetedCents: number;
  // The balances that are known.
  savedCents: number;
  // Accounts whose balance their source cannot give yet: the total is short by these.
  unknown: string[];
}

export function savingsTotals(lines: readonly SavingsLine[]): SavingsTotals {
  const active = lines.filter((l) => l.isActive);
  return {
    budgetedCents: active.reduce((sum, l) => sum + l.budgetedCents, 0),
    savedCents: active.reduce((sum, l) => sum + (l.balanceCents ?? 0), 0),
    unknown: active.filter((l) => l.balanceCents === null).map((l) => l.name),
  };
}

// How many cycles of the current budget are left before the goal is met, or null when there is no
// goal, nothing budgeted, or it is already there.
export function cyclesToGoal(line: SavingsLine) {
  if (line.remainingCents === null || line.remainingCents === 0 || line.budgetedCents <= 0) return null;
  return Math.ceil(line.remainingCents / line.budgetedCents);
}
