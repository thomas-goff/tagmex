// Where a savings account's balance comes from. Pure data, shared by the schema and the maths.
export const SAVINGS_BALANCE_SOURCES = ['bank', 'manual', 'contributions'] as const;
export type SavingsBalanceSource = (typeof SAVINGS_BALANCE_SOURCES)[number];

export const BALANCE_SOURCE_LABEL: Record<SavingsBalanceSource, string> = {
  bank: 'from the bank',
  manual: 'entered by hand',
  contributions: 'everything paid in',
};

// A savings account as stored.
export interface SavingsAccount {
  id: string;
  name: string;
  purpose: string | null;
  categoryId: string | null;
  accountMatch: string | null;
  balanceSource: SavingsBalanceSource;
  manualBalanceCents: number | null;
  manualBalanceOn: string | null;
  goalCents: number | null;
  note: string | null;
  sortOrder: number;
  isActive: boolean;
}

// What the screen shows: the account with its balance worked out and its budget attached.
export interface SavingsLine extends SavingsAccount {
  categoryName: string | null;
  categoryEmoji: string | null;
  // Per cycle, from the linked category's budget. Zero when nothing points here.
  budgetedCents: number;
  // Null when the chosen source has nothing to give (no email yet, no figure typed in).
  balanceCents: number | null;
  // The date the balance is as at, when the source carries one.
  balanceOn: string | null;
  // balance / goal as a percentage, capped for the bar; null without a goal or a balance.
  progressPct: number | null;
  // What is still to go, floored at zero; null without a goal or a balance.
  remainingCents: number | null;
}
