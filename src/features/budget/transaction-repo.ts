// What the budget reads from the ledger, plus the small flags it sets on a transaction (excluded,
// a suggestion). Every query is scoped by the userId argument; amounts become integer cents here.
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { categories, categoryRules, transactions } from '@/db/schema';
import type { SalaryCredit } from '@/features/cycle/cycle';
import type { CategorySource } from '@/features/categorisation/types';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';
import type { LedgerRow } from './types';

export interface TransactionView {
  id: string;
  occurredOn: string;
  amountCents: number;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  categorySource: CategorySource;
  kind: string;
  accountType: string;
  accountLast4: string;
  reserved: boolean;
  isDeleted: boolean;
  // Set on a part of a split: the transaction it came from.
  splitOf: string | null;
}

export interface TransactionFilter {
  from?: string;
  // Exclusive.
  to?: string;
  categoryId?: string;
  uncategorisedOnly?: boolean;
  search?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  includeExcluded?: boolean;
}

// Keyset position: newest first by date, then id.
export interface TransactionCursor {
  occurredOn: string;
  id: string;
}

const live = (userId: string) => and(eq(transactions.userId, userId), eq(transactions.isDeleted, false));

export function createTransactionRepo(db: Database) {
  return {
    // Credits in salary categories, oldest first. detectSalaryStarts decides which open a cycle.
    async listSalaryCredits(userId: string): Promise<SalaryCredit[]> {
      const rows = await db
        .select({ transactionId: transactions.id, occurredOn: transactions.occurredOn, amount: transactions.amount })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(live(userId), eq(categories.isSalary, true), gt(transactions.amount, '0')))
        .orderBy(asc(transactions.occurredOn), asc(transactions.id));
      return rows.map(({ amount, ...r }) => ({ ...r, amountCents: decimalToCents(amount) }));
    },

    // The date of the ledger's first transaction: cycles before it weren't tracked. Null when empty.
    async firstTransactionDate(userId: string) {
      const [row] = await db
        .select({ first: sql<string | null>`min(${transactions.occurredOn})::text` })
        .from(transactions)
        .where(live(userId));
      return row?.first ?? null;
    },

    // Live transactions with from <= date < to.
    async listLedgerRows(userId: string, from: string, to: string): Promise<LedgerRow[]> {
      const rows = await db
        .select({
          id: transactions.id,
          occurredOn: transactions.occurredOn,
          amount: transactions.amount,
          categoryId: transactions.categoryId,
          categoryKind: categories.kind,
          categoryName: categories.name,
          categoryEmoji: categories.emoji,
          categoryIsSavings: sql<boolean>`coalesce(${categories.isSavings}, false)`,
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(live(userId), gte(transactions.occurredOn, from), lt(transactions.occurredOn, to)));
      return rows.map(({ amount, ...r }) => ({ ...r, amountCents: decimalToCents(amount) }));
    },

    async listTransactions(userId: string, filter: TransactionFilter, limit: number, after: TransactionCursor | null) {
      const conditions: (SQL | undefined)[] = [
        eq(transactions.userId, userId),
        filter.includeExcluded ? undefined : eq(transactions.isDeleted, false),
        filter.from ? gte(transactions.occurredOn, filter.from) : undefined,
        filter.to ? lt(transactions.occurredOn, filter.to) : undefined,
        filter.categoryId ? eq(transactions.categoryId, filter.categoryId) : undefined,
        filter.uncategorisedOnly ? isNull(transactions.categoryId) : undefined,
        filter.search ? ilike(transactions.descriptionNormalised, `%${escapeLike(filter.search)}%`) : undefined,
        filter.minAmountCents === undefined ? undefined : gte(transactions.amount, centsToDecimal(filter.minAmountCents)),
        filter.maxAmountCents === undefined ? undefined : lte(transactions.amount, centsToDecimal(filter.maxAmountCents)),
        after
          ? or(
              lt(transactions.occurredOn, after.occurredOn),
              and(eq(transactions.occurredOn, after.occurredOn), lt(transactions.id, after.id)),
            )
          : undefined,
      ];
      const rows = await db
        .select(transactionViewColumns)
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(...conditions))
        .orderBy(desc(transactions.occurredOn), desc(transactions.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit).map(toView);
      const last = page.at(-1);
      return { transactions: page, next: rows.length > limit && last ? { occurredOn: last.occurredOn, id: last.id } : null };
    },

    // Excluded ones too.
    async findTransaction(userId: string, id: string): Promise<TransactionView | null> {
      const [row] = await db
        .select(transactionViewColumns)
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
      return row ? toView(row) : null;
    },

    // Soft delete (exclude) or restore. Returns how many rows it found for this user.
    async setExcluded(userId: string, ids: string | string[], excluded: boolean) {
      const list = [ids].flat();
      if (list.length === 0) return 0;
      const updated = await db
        .update(transactions)
        .set({ isDeleted: excluded })
        .where(and(eq(transactions.userId, userId), inArray(transactions.id, list)))
        .returning({ id: transactions.id });
      return updated.length;
    },

    // Records a suggestion (null categoryId = looked at, not sure) on rows that are still
    // uncategorised. Returns the ids it changed.
    async setSuggestion(userId: string, ids: string[], suggestion: { categoryId: string | null; note: string | null }) {
      if (ids.length === 0) return [];
      const updated = await db
        .update(transactions)
        .set({ suggestedCategoryId: suggestion.categoryId, suggestionNote: suggestion.note, suggestedAt: new Date() })
        .where(and(live(userId), eq(transactions.categorySource, 'none'), inArray(transactions.id, ids)))
        .returning({ id: transactions.id });
      return updated.map((r) => r.id);
    },

    // Categorised descriptions to borrow suggestions from: learned rules (the user's own choices),
    // then descriptions categorised by hand.
    async listKnownDescriptions(userId: string) {
      const [learned, manual] = await Promise.all([
        db
          .select({ descriptionNormalised: categoryRules.pattern, categoryId: categoryRules.categoryId })
          .from(categoryRules)
          .where(and(eq(categoryRules.userId, userId), eq(categoryRules.origin, 'learned'))),
        db
          .selectDistinct({ descriptionNormalised: transactions.descriptionNormalised, categoryId: sql<string>`${transactions.categoryId}` })
          .from(transactions)
          .where(and(live(userId), inArray(transactions.categorySource, ['manual', 'merchant_rule', 'user_rule'])))
          .limit(1000),
      ]);
      return [...learned, ...manual];
    },
  };
}

const transactionViewColumns = {
  id: transactions.id,
  occurredOn: transactions.occurredOn,
  amount: transactions.amount,
  description: transactions.descriptionNormalised,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryEmoji: categories.emoji,
  categorySource: transactions.categorySource,
  kind: transactions.kind,
  accountType: transactions.accountType,
  accountLast4: transactions.accountLast4,
  reserved: transactions.reserved,
  isDeleted: transactions.isDeleted,
  splitOf: transactions.splitOf,
};

function toView({ amount, ...r }: { amount: string } & Omit<TransactionView, 'amountCents'>): TransactionView {
  return { ...r, amountCents: decimalToCents(amount) };
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
