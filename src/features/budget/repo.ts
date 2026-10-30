// Budget data access. Every query is scoped by the userId argument; amounts become integer cents
// here, at the boundary, and nothing above this file sees a numeric string.
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/db/client';
import {
  budgetItems,
  categories,
  categoryRules,
  ingestedMessages,
  mailboxConnections,
  syncRuns,
  transactions,
  userSettings,
} from '@/db/schema';
import type { SalaryCredit } from '@/features/cycle/cycle';
import type { CategoryKind, CategorySource, ExpenseType } from '@/features/categorisation/types';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';
import { missingBudgetItems } from './ensure-items';
import { DEFAULT_SETTINGS, type BudgetLine, type LedgerRow, type Settings } from './types';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface CategoryInfo {
  id: string;
  name: string;
  kind: CategoryKind;
  isSystem: boolean;
  isSalary: boolean;
  hasBudgetItem: boolean;
}

export interface TransactionView {
  id: string;
  occurredOn: string;
  amountCents: number;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  categorySource: CategorySource;
  kind: string;
  accountType: string;
  accountLast4: string;
  reserved: boolean;
  isDeleted: boolean;
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

export type BudgetRepo = ReturnType<typeof createBudgetRepo>;

const live = (userId: string) => and(eq(transactions.userId, userId), eq(transactions.isDeleted, false));

export function createBudgetRepo(db: Database) {
  const settingsColumns = {
    salaryDayHint: userSettings.salaryDayHint,
    expectedSalaryAmount: userSettings.expectedSalaryAmount,
    salaryTolerancePct: userSettings.salaryTolerancePct,
    timezone: userSettings.timezone,
    digestHour: userSettings.digestHour,
    digestEnabled: userSettings.digestEnabled,
    discordAlertsEnabled: userSettings.discordAlertsEnabled,
  };

  return {
    // Creates the row with defaults on first read.
    async getSettings(userId: string): Promise<Settings> {
      await db.insert(userSettings).values({ userId }).onConflictDoNothing();
      const [row] = await db.select(settingsColumns).from(userSettings).where(eq(userSettings.userId, userId));
      if (!row) return DEFAULT_SETTINGS;
      const { expectedSalaryAmount, ...rest } = row;
      return { ...rest, expectedSalaryCents: expectedSalaryAmount === null ? null : decimalToCents(expectedSalaryAmount) };
    },

    async updateSettings(userId: string, patch: Partial<Settings>) {
      await db.insert(userSettings).values({ userId }).onConflictDoNothing();
      const { expectedSalaryCents, ...rest } = patch;
      await db
        .update(userSettings)
        .set({
          ...rest,
          ...(expectedSalaryCents === undefined
            ? {}
            : { expectedSalaryAmount: expectedSalaryCents === null ? null : centsToDecimal(expectedSalaryCents) }),
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));
    },

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
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(live(userId), gte(transactions.occurredOn, from), lt(transactions.occurredOn, to)));
      return rows.map(({ amount, ...r }) => ({ ...r, amountCents: decimalToCents(amount) }));
    },

    // Creates the R0 item any expense category is missing. Safe to call on every read.
    async ensureBudgetItems(userId: string) {
      const [expense, items] = await Promise.all([
        db
          .select({ id: categories.id, expenseType: categories.expenseType, sortOrder: categories.sortOrder })
          .from(categories)
          .where(and(eq(categories.userId, userId), eq(categories.kind, 'expense'))),
        db.select({ categoryId: budgetItems.categoryId }).from(budgetItems).where(eq(budgetItems.userId, userId)),
      ]);
      const missing = missingBudgetItems(expense, new Set(items.map((i) => i.categoryId)));
      if (missing.length === 0) return 0;
      const inserted = await db
        .insert(budgetItems)
        .values(missing.map((m) => ({ userId, ...m })))
        .onConflictDoNothing()
        .returning({ id: budgetItems.id });
      return inserted.length;
    },

    async listBudgetLines(userId: string): Promise<BudgetLine[]> {
      const rows = await db
        .select({
          categoryId: budgetItems.categoryId,
          categoryName: categories.name,
          expenseType: budgetItems.expenseType,
          allocated: budgetItems.allocated,
          expectedDay: budgetItems.expectedDay,
          isActive: budgetItems.isActive,
          sortOrder: budgetItems.sortOrder,
        })
        .from(budgetItems)
        .innerJoin(categories, eq(categories.id, budgetItems.categoryId))
        .where(and(eq(budgetItems.userId, userId), eq(categories.kind, 'expense')))
        .orderBy(asc(budgetItems.sortOrder), asc(categories.name));
      return rows.map(({ allocated, ...r }) => ({ ...r, allocatedCents: decimalToCents(allocated) }));
    },

    async updateBudgetItem(
      userId: string,
      categoryId: string,
      patch: { allocatedCents?: number; expenseType?: ExpenseType; expectedDay?: number | null; isActive?: boolean },
    ) {
      const { allocatedCents, ...rest } = patch;
      const updated = await db
        .update(budgetItems)
        .set({
          ...rest,
          ...(allocatedCents === undefined ? {} : { allocated: centsToDecimal(allocatedCents) }),
          updatedAt: new Date(),
        })
        .where(and(eq(budgetItems.userId, userId), eq(budgetItems.categoryId, categoryId)))
        .returning({ id: budgetItems.id });
      return updated.length > 0;
    },

    async listCategories(userId: string): Promise<CategoryInfo[]> {
      return db
        .select({
          id: categories.id,
          name: categories.name,
          kind: categories.kind,
          isSystem: categories.isSystem,
          isSalary: categories.isSalary,
          hasBudgetItem: sql<boolean>`${budgetItems.id} is not null`,
        })
        .from(categories)
        .leftJoin(budgetItems, eq(budgetItems.categoryId, categories.id))
        .where(eq(categories.userId, userId))
        .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name));
    },

    async createCategory(userId: string, c: { name: string; kind: 'expense' | 'income'; expenseType: ExpenseType | null }) {
      const [{ next } = { next: 0 }] = await db
        .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int + 1` })
        .from(categories)
        .where(eq(categories.userId, userId));
      const [row] = await db
        .insert(categories)
        .values({ userId, name: c.name, kind: c.kind, expenseType: c.kind === 'expense' ? c.expenseType : null, sortOrder: next })
        .onConflictDoNothing()
        .returning({ id: categories.id });
      if (!row) throw new ConflictError(`a category called "${c.name}" already exists`);
      return row.id;
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

    async findTransaction(userId: string, id: string): Promise<TransactionView | null> {
      const [row] = await db
        .select(transactionViewColumns)
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
      return row ? toView(row) : null;
    },

    // Soft delete (exclude) or restore. Returns false when the row doesn't exist for this user.
    async setExcluded(userId: string, id: string, excluded: boolean) {
      const updated = await db
        .update(transactions)
        .set({ isDeleted: excluded })
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
        .returning({ id: transactions.id });
      return updated.length > 0;
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

    async syncStatus(userId: string) {
      const connections = await db
        .select({ id: mailboxConnections.id, gmailAddress: mailboxConnections.gmailAddress, lastSyncedAt: mailboxConnections.lastSyncedAt })
        .from(mailboxConnections)
        .where(eq(mailboxConnections.userId, userId));
      const ids = connections.map((c) => c.id);
      if (ids.length === 0) return { connections, lastRun: null, lastFailedRun: null, messages: [] };

      const runColumns = {
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        fetched: syncRuns.fetched,
        parsed: syncRuns.parsed,
        ignored: syncRuns.ignored,
        failed: syncRuns.failed,
        error: syncRuns.error,
      };
      const [[lastRun], [lastFailedRun], messages] = await Promise.all([
        db.select(runColumns).from(syncRuns).where(inArray(syncRuns.mailboxConnectionId, ids)).orderBy(desc(syncRuns.startedAt)).limit(1),
        db
          .select(runColumns)
          .from(syncRuns)
          .where(and(inArray(syncRuns.mailboxConnectionId, ids), sql`${syncRuns.error} is not null`))
          .orderBy(desc(syncRuns.startedAt))
          .limit(1),
        db
          .select({ status: ingestedMessages.status, count: sql<number>`count(*)::int` })
          .from(ingestedMessages)
          .where(inArray(ingestedMessages.mailboxConnectionId, ids))
          .groupBy(ingestedMessages.status),
      ]);
      return { connections, lastRun: lastRun ?? null, lastFailedRun: lastFailedRun ?? null, messages };
    },

    // When a sync last finished without error, for the stale-sync alert.
    async lastSuccessfulSync(userId: string) {
      const [row] = await db
        .select({ at: sql<Date | null>`max(${syncRuns.finishedAt})` })
        .from(syncRuns)
        .innerJoin(mailboxConnections, eq(mailboxConnections.id, syncRuns.mailboxConnectionId))
        .where(and(eq(mailboxConnections.userId, userId), isNull(syncRuns.error), sql`${syncRuns.finishedAt} is not null`));
      return row?.at ? new Date(row.at) : null;
    },

    // Users the scheduled jobs run for.
    async listUserIds() {
      const rows = await db.selectDistinct({ userId: mailboxConnections.userId }).from(mailboxConnections);
      return rows.map((r) => r.userId);
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
  categorySource: transactions.categorySource,
  kind: transactions.kind,
  accountType: transactions.accountType,
  accountLast4: transactions.accountLast4,
  reserved: transactions.reserved,
  isDeleted: transactions.isDeleted,
};

function toView({ amount, ...r }: { amount: string } & Omit<TransactionView, 'amountCents'>): TransactionView {
  return { ...r, amountCents: decimalToCents(amount) };
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

