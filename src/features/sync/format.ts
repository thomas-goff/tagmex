import type { ParseResult, TransactionKind } from '@/features/bank-email/types';
import type { BudgetStanding } from '@/features/budget/standing';

export interface NotifiableEmail {
  gmailId: string;
  subject: string;
  result: ParseResult;
  // Parsed emails: the category name, or null when uncategorised.
  categoryName?: string | null;
  categoryEmoji?: string | null;
  // The category's budget this cycle and days to payday, for its Discord message.
  standing?: BudgetStanding | null;
}

// Categorised → #transactions, uncategorised → #needs-review, parse failures → #system.
export function channelFor(item: NotifiableEmail): 'transactions' | 'review' | 'system' {
  if (item.result.status !== 'parsed') return 'system';
  return item.categoryName ? 'transactions' : 'review';
}

export const KIND_LABEL: Record<TransactionKind, string> = {
  card_purchase: 'card',
  debit_order: 'debit order',
  payment: 'payment',
  transfer: 'transfer',
  credit: 'credit',
  reversal: 'reversal',
  fee: 'fee',
  withdrawal: 'withdrawal',
  other: 'other',
};

export function formatRand(cents: number) {
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}R${rands}.${String(abs % 100).padStart(2, '0')}`;
}

export function escapeMarkdown(s: string) {
  return s.replace(/([*_~`|\\>])/g, '\\$1');
}

// How uncategorised looked in the plain-text messages posted before embeds. #needs-review rows
// from then are still ticked off by replacing it (see @/features/notifications/review).
export const UNCATEGORISED_LABEL = '❔ **Uncategorised**';
