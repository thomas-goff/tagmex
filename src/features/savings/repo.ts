import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { savingsAccounts, transactions } from '@/db/schema';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';
import type { Contribution } from './summary';
import type { SavingsAccount, SavingsBalanceSource } from './types';

// Savings accounts and what has been paid into them. Every query is scoped by the userId argument.

export type SavingsRepo = ReturnType<typeof createSavingsRepo>;

export interface SavingsAccountPatch {
  name?: string;
  purpose?: string | null;
  categoryId?: string | null;
  accountMatch?: string | null;
  balanceSource?: SavingsBalanceSource;
  manualBalanceCents?: number | null;
  manualBalanceOn?: string | null;
  goalCents?: number | null;
  note?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

const toCents = (v: string | null) => (v === null ? null : decimalToCents(v));
const toMoney = (v: number | null | undefined) => (v === null || v === undefined ? null : centsToDecimal(v));

function columns(patch: SavingsAccountPatch) {
  const { manualBalanceCents, goalCents, ...rest } = patch;
  return {
    ...rest,
    ...(manualBalanceCents === undefined ? {} : { manualBalance: toMoney(manualBalanceCents) }),
    ...(goalCents === undefined ? {} : { goal: toMoney(goalCents) }),
  };
}

export function createSavingsRepo(db: Database) {
  return {
    async listSavingsAccounts(userId: string): Promise<SavingsAccount[]> {
      const rows = await db
        .select()
        .from(savingsAccounts)
        .where(eq(savingsAccounts.userId, userId))
        .orderBy(asc(savingsAccounts.sortOrder), asc(savingsAccounts.name));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        purpose: r.purpose,
        categoryId: r.categoryId,
        accountMatch: r.accountMatch,
        balanceSource: r.balanceSource,
        manualBalanceCents: toCents(r.manualBalance),
        manualBalanceOn: r.manualBalanceOn,
        goalCents: toCents(r.goal),
        note: r.note,
        sortOrder: r.sortOrder,
        isActive: r.isActive,
      }));
    },

    async createSavingsAccount(userId: string, input: SavingsAccountPatch & { name: string }) {
      const [row] = await db
        .insert(savingsAccounts)
        .values({ userId, ...columns(input), name: input.name })
        .returning({ id: savingsAccounts.id });
      return row!.id;
    },

    async updateSavingsAccount(userId: string, id: string, patch: SavingsAccountPatch) {
      const updated = await db
        .update(savingsAccounts)
        .set({ ...columns(patch), updatedAt: new Date() })
        .where(and(eq(savingsAccounts.userId, userId), eq(savingsAccounts.id, id)))
        .returning({ id: savingsAccounts.id });
      return updated.length > 0;
    },

    // Everything ever moved into each of these categories, as a positive figure. Money into a
    // savings category is a debit on the account it came from, so the sum is negated; a withdrawal
    // categorised back nets off, which is what "what is in there" means.
    async contributionsByCategory(userId: string, categoryIds: readonly string[]): Promise<Contribution[]> {
      if (categoryIds.length === 0) return [];
      const rows = await db
        .select({
          categoryId: transactions.categoryId,
          total: sql<string>`coalesce(sum(-${transactions.amount}), 0)::text`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.isDeleted, false),
            inArray(transactions.categoryId, [...categoryIds]),
          ),
        )
        .groupBy(transactions.categoryId);
      return rows.filter((r) => r.categoryId !== null).map((r) => ({ categoryId: r.categoryId!, contributedCents: decimalToCents(r.total) }));
    },
  };
}
