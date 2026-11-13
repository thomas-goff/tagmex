// Account and counterparty labels. Every query is scoped by the userId argument.
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { accountLabels, transactions } from '@/db/schema';
import { escapeLike } from '@/features/budget/transaction-repo';
import { decimalToCents } from '@/features/transactions/money';
import type { AccountLabel, AccountLabelKind, KnownAccount } from './labels';

export interface AccountSummary extends KnownAccount {
  transactionCount: number;
  lastOccurredOn: string;
  // What the bank said was available after the account's latest transaction that carried a
  // balance (for a credit card, the credit still available). Null when no email has carried one.
  availableCents: number | null;
  availableOn: string | null;
}

export type AccountLabelRepo = ReturnType<typeof createAccountLabelRepo>;

export function createAccountLabelRepo(db: Database) {
  return {
    listLabels(userId: string): Promise<AccountLabel[]> {
      return db
        .select({ kind: accountLabels.kind, match: accountLabels.match, label: accountLabels.label, note: accountLabels.note })
        .from(accountLabels)
        .where(eq(accountLabels.userId, userId))
        .orderBy(asc(accountLabels.kind), asc(accountLabels.match));
    },

    // Every account the user's ledger has seen (excluded rows too), most recently used first.
    async listAccounts(userId: string): Promise<AccountSummary[]> {
      // The newest row with a balance: by date, then by when it was recorded (emails arrive in order).
      const latest = sql`order by ${transactions.occurredOn} desc, ${transactions.createdAt} desc`;
      const withBalance = sql`filter (where ${transactions.balanceAfter} is not null)`;
      const rows = await db
        .select({
          accountType: transactions.accountType,
          accountLast4: transactions.accountLast4,
          transactionCount: sql<number>`count(*)::int`,
          lastOccurredOn: sql<string>`max(${transactions.occurredOn})::text`,
          available: sql<string | null>`(array_agg(${transactions.balanceAfter} ${latest}) ${withBalance})[1]::text`,
          availableOn: sql<string | null>`(array_agg(${transactions.occurredOn} ${latest}) ${withBalance})[1]::text`,
        })
        .from(transactions)
        .where(eq(transactions.userId, userId))
        .groupBy(transactions.accountType, transactions.accountLast4)
        .orderBy(desc(sql`max(${transactions.occurredOn})`), asc(transactions.accountType), asc(transactions.accountLast4));
      return rows.map(({ available, ...r }) => ({ ...r, availableCents: available === null ? null : decimalToCents(available) }));
    },

    // How many of the user's transactions mention this (upper-case) text.
    async countDescriptionMatches(userId: string, text: string) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), ilike(transactions.descriptionNormalised, `%${escapeLike(text)}%`)));
      return row?.count ?? 0;
    },

    // Insert or rename. An undefined note keeps the one already there.
    async setLabel(userId: string, l: { kind: AccountLabelKind; match: string; label: string; note?: string | null }) {
      await db
        .insert(accountLabels)
        .values({ userId, kind: l.kind, match: l.match, label: l.label, note: l.note ?? null })
        .onConflictDoUpdate({
          target: [accountLabels.userId, accountLabels.kind, accountLabels.match],
          set: { label: l.label, ...(l.note === undefined ? {} : { note: l.note }), updatedAt: new Date() },
        });
    },

    // Returns false when there was no such label.
    async removeLabel(userId: string, kind: AccountLabelKind, match: string) {
      const deleted = await db
        .delete(accountLabels)
        .where(and(eq(accountLabels.userId, userId), eq(accountLabels.kind, kind), eq(accountLabels.match, match)))
        .returning({ id: accountLabels.id });
      return deleted.length > 0;
    },
  };
}
