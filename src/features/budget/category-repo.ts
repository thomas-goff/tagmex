// Categories, their budget items and the rules that point at them. Every query is scoped by the
// userId argument; allocations become integer cents here.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { budgetItems, categories, categoryRules, transactions } from '@/db/schema';
import type { CategoryKind, ExpenseType, RuleDirection, RuleMatchType, RuleOrigin } from '@/features/categorisation/types';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';
import { missingBudgetItems } from './ensure-items';
import type { BudgetLine } from './types';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface CategoryInfo {
  id: string;
  name: string;
  emoji: string | null;
  kind: CategoryKind;
  isSystem: boolean;
  isSalary: boolean;
  // Expense categories only: money moved here is saved, not spent.
  isSavings: boolean;
  // Hidden from pickers; nothing new can be filed under it.
  isArchived: boolean;
  hasBudgetItem: boolean;
}

export interface RuleInfo {
  id: string;
  matchType: RuleMatchType;
  pattern: string;
  direction: RuleDirection | null;
  origin: RuleOrigin;
  categoryId: string;
  categoryName: string;
  // Live transactions this rule categorised.
  transactionCount: number;
  updatedAt: Date;
}

export interface MergeResult {
  transactions: number;
  rules: number;
}

// Postgres unique_violation, as postgres.js reports it (drizzle wraps it as the cause).
function isUniqueViolation(err: unknown) {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(err) === '23505' || code((err as { cause?: unknown } | null)?.cause) === '23505';
}

export function createCategoryRepo(db: Database) {
  return {
    // Archived ones included: callers that offer a choice filter them out.
    async listCategories(userId: string): Promise<CategoryInfo[]> {
      return db
        .select({
          id: categories.id,
          name: categories.name,
          emoji: categories.emoji,
          kind: categories.kind,
          isSystem: categories.isSystem,
          isSalary: categories.isSalary,
          isSavings: categories.isSavings,
          isArchived: categories.isArchived,
          hasBudgetItem: sql<boolean>`${budgetItems.id} is not null`,
        })
        .from(categories)
        .leftJoin(budgetItems, eq(budgetItems.categoryId, categories.id))
        .where(eq(categories.userId, userId))
        .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name));
    },

    async createCategory(
      userId: string,
      c: { name: string; kind: 'expense' | 'income'; expenseType: ExpenseType | null; emoji?: string | null; isSavings?: boolean },
    ) {
      const [{ next } = { next: 0 }] = await db
        .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int + 1` })
        .from(categories)
        .where(eq(categories.userId, userId));
      const [row] = await db
        .insert(categories)
        .values({
          userId,
          name: c.name,
          emoji: c.emoji ?? null,
          kind: c.kind,
          expenseType: c.kind === 'expense' ? c.expenseType : null,
          isSavings: c.kind === 'expense' && (c.isSavings ?? false),
          sortOrder: next,
        })
        .onConflictDoNothing()
        .returning({ id: categories.id });
      if (!row) throw new ConflictError(`a category called "${c.name}" already exists`);
      return row.id;
    },

    // Null clears it (back to 🏷️). Returns false when the category doesn't exist for this user.
    async setCategoryEmoji(userId: string, categoryId: string, emoji: string | null) {
      const updated = await db
        .update(categories)
        .set({ emoji })
        .where(and(eq(categories.userId, userId), eq(categories.id, categoryId)))
        .returning({ id: categories.id });
      return updated.length > 0;
    },

    // Rename, archive or flag as savings: only what's passed changes. Returns false when the
    // category doesn't exist for this user.
    async updateCategory(userId: string, categoryId: string, patch: { name?: string; isArchived?: boolean; isSavings?: boolean }) {
      try {
        const updated = await db
          .update(categories)
          .set(patch)
          .where(and(eq(categories.userId, userId), eq(categories.id, categoryId)))
          .returning({ id: categories.id });
        return updated.length > 0;
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError(`a category called "${patch.name}" already exists`);
        throw err;
      }
    },

    // Moves everything filed under `fromId` (transactions, excluded ones too, suggestions and
    // rules) to `intoId`, then archives `fromId` and switches its budget item off. One commit.
    async mergeCategory(userId: string, fromId: string, intoId: string): Promise<MergeResult> {
      return db.transaction(async (tx) => {
        const moved = await tx
          .update(transactions)
          .set({ categoryId: intoId })
          .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, fromId)))
          .returning({ id: transactions.id });
        await tx
          .update(transactions)
          .set({ suggestedCategoryId: intoId })
          .where(and(eq(transactions.userId, userId), eq(transactions.suggestedCategoryId, fromId)));
        const rules = await tx
          .update(categoryRules)
          .set({ categoryId: intoId, updatedAt: new Date() })
          .where(and(eq(categoryRules.userId, userId), eq(categoryRules.categoryId, fromId)))
          .returning({ id: categoryRules.id });
        await tx
          .update(budgetItems)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(budgetItems.userId, userId), eq(budgetItems.categoryId, fromId)));
        await tx
          .update(categories)
          .set({ isArchived: true })
          .where(and(eq(categories.userId, userId), eq(categories.id, fromId)));
        return { transactions: moved.length, rules: rules.length };
      });
    },

    // How many transactions (excluded ones too) and rules point at a category.
    async categoryUsage(userId: string, categoryId: string): Promise<MergeResult> {
      const [[t], [r]] = await Promise.all([
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(transactions)
          .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, categoryId))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(categoryRules)
          .where(and(eq(categoryRules.userId, userId), eq(categoryRules.categoryId, categoryId))),
      ]);
      return { transactions: t?.n ?? 0, rules: r?.n ?? 0 };
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
          categoryEmoji: categories.emoji,
          expenseType: budgetItems.expenseType,
          allocated: budgetItems.allocated,
          expectedDay: budgetItems.expectedDay,
          isActive: budgetItems.isActive,
          sortOrder: budgetItems.sortOrder,
          isSavings: categories.isSavings,
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

    // Rules with the category each points at, newest first. `origin` narrows to learned or seed.
    async listRules(userId: string, filter: { origin?: RuleOrigin; categoryId?: string } = {}): Promise<RuleInfo[]> {
      return db
        .select({
          id: categoryRules.id,
          matchType: categoryRules.matchType,
          pattern: categoryRules.pattern,
          direction: categoryRules.direction,
          origin: categoryRules.origin,
          categoryId: categoryRules.categoryId,
          categoryName: categories.name,
          transactionCount: sql<number>`(select count(*)::int from ${transactions} t where t.rule_id = ${categoryRules.id} and not t.is_deleted)`,
          updatedAt: categoryRules.updatedAt,
        })
        .from(categoryRules)
        .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
        .where(
          and(
            eq(categoryRules.userId, userId),
            filter.origin ? eq(categoryRules.origin, filter.origin) : undefined,
            filter.categoryId ? eq(categoryRules.categoryId, filter.categoryId) : undefined,
          ),
        )
        .orderBy(desc(categoryRules.updatedAt), asc(categoryRules.pattern));
    },

    // Removes a rule. Transactions it categorised keep their category (rule_id goes null).
    // Returns false when the rule doesn't exist for this user.
    async deleteRule(userId: string, ruleId: string) {
      const deleted = await db
        .delete(categoryRules)
        .where(and(eq(categoryRules.userId, userId), eq(categoryRules.id, ruleId)))
        .returning({ id: categoryRules.id });
      return deleted.length > 0;
    },
  };
}
