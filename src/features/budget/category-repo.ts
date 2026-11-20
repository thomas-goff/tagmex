// Categories, their budget items and the rules that point at them. Every query is scoped by the
// userId argument; allocations become integer cents here.
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { budgetItems, categories, categoryRules, transactions } from '@/db/schema';
import type { CategoryKind, ExpenseType, RuleDirection, RuleMatchType, RuleOrigin } from '@/features/categorisation/types';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';
import { effectiveLines, versionToExtend } from './effective';
import type { BudgetLine, BudgetLineVersion } from './types';

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
  // Every version of every budget item, oldest column order kept so callers can resolve a cycle's
  // figures in memory: summarising a run of cycles reads this once.
  async function listBudgetLineVersions(userId: string): Promise<BudgetLineVersion[]> {
    const rows = await db
      .select({
        categoryId: budgetItems.categoryId,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
        effectiveFrom: budgetItems.effectiveFrom,
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
  }

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
    // One statement: the two reads and the insert this used to make were three round trips on every
    // dashboard page load, and the usual answer is that nothing is missing. An expense category
    // with no budget item at all gets the R0 row; `not exists` means a category that already has
    // any version is left alone, and nothing is written when they all do.
    async ensureBudgetItems(userId: string) {
      const inserted = await db.execute(sql`
        insert into ${budgetItems} ("user_id", "category_id", "expense_type", "sort_order")
        select ${userId}, ${categories.id}, coalesce(${categories.expenseType}, 'dynamic'), ${categories.sortOrder}
        from ${categories}
        where ${categories.userId} = ${userId}
          and ${categories.kind} = 'expense'
          and not exists (
            select 1 from ${budgetItems}
            where ${budgetItems.userId} = ${userId} and ${budgetItems.categoryId} = ${categories.id}
          )
        on conflict do nothing
        returning ${budgetItems.id}
      `);
      return inserted.length;
    },

    // Every version of every budget item. Callers that want one cycle's figures run these through
    // effectiveLines; summarising a run of cycles reads them once and resolves each cycle in memory.
    listBudgetLineVersions,

    // The figures in force on `asOf`, which is a cycle's start date (or today, outside a cycle).
    async listBudgetLines(userId: string, asOf: string): Promise<BudgetLine[]> {
      return effectiveLines(await listBudgetLineVersions(userId), asOf);
    },

    // Writes the version effective from `effectiveFrom`, carrying forward whatever the patch leaves
    // out from the version in force then. Dating it past the current cycle's start is what "from
    // next cycle" means: the cycle being reported now keeps the figures it already had.
    // Returns the version it wrote, or null when the category has no budget item to extend. The
    // row it returns is by definition the one in force on `effectiveFrom`, so a caller that wants
    // the new figures already has them: reading them back cost a second pass over every version.
    async updateBudgetItem(
      userId: string,
      categoryId: string,
      patch: { allocatedCents?: number; expenseType?: ExpenseType; expectedDay?: number | null; isActive?: boolean },
      effectiveFrom: string,
    ): Promise<BudgetLine | null> {
      const base = versionToExtend(await listBudgetLineVersions(userId), categoryId, effectiveFrom);
      if (!base) return null;
      const merged = {
        expenseType: patch.expenseType ?? base.expenseType,
        allocatedCents: patch.allocatedCents ?? base.allocatedCents,
        expectedDay: patch.expectedDay === undefined ? base.expectedDay : patch.expectedDay,
        isActive: patch.isActive ?? base.isActive,
      };
      const written = await db
        .insert(budgetItems)
        .values({
          userId,
          categoryId,
          effectiveFrom,
          expenseType: merged.expenseType,
          allocated: centsToDecimal(merged.allocatedCents),
          expectedDay: merged.expectedDay,
          isActive: merged.isActive,
          sortOrder: base.sortOrder,
        })
        .onConflictDoUpdate({
          target: [budgetItems.userId, budgetItems.categoryId, budgetItems.effectiveFrom],
          set: {
            expenseType: merged.expenseType,
            allocated: centsToDecimal(merged.allocatedCents),
            expectedDay: merged.expectedDay,
            isActive: merged.isActive,
            updatedAt: new Date(),
          },
        })
        .returning({ id: budgetItems.id });
      return written.length > 0 ? { ...base, ...merged } : null;
    },

    // Drops a version that has not taken effect yet. The one exception to nothing being deleted:
    // a queued change is a plan, not a record, and there is nothing else to undo it with. A date
    // already in force is refused by the `after` guard the caller passes.
    async deleteScheduledBudgetItem(userId: string, categoryId: string, effectiveFrom: string, after: string) {
      if (effectiveFrom <= after) return false;
      const removed = await db
        .delete(budgetItems)
        .where(
          and(
            eq(budgetItems.userId, userId),
            eq(budgetItems.categoryId, categoryId),
            eq(budgetItems.effectiveFrom, effectiveFrom),
            gt(budgetItems.effectiveFrom, after),
          ),
        )
        .returning({ id: budgetItems.id });
      return removed.length > 0;
    },

    // Rules with the category each points at, newest first. `origin` narrows to learned or seed,
    // and `id` to one rule -- each row costs a count of the transactions it categorised, so asking
    // for one rule is much cheaper than loading every rule to pick one out.
    async listRules(userId: string, filter: { origin?: RuleOrigin; categoryId?: string; id?: string } = {}): Promise<RuleInfo[]> {
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
            filter.id ? eq(categoryRules.id, filter.id) : undefined,
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
