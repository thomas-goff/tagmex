import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { categories, categoryRules, ingestedMessages, mailboxConnections, transactions } from '@/db/schema';
import type { CategoryRule } from '@/features/categorisation/types';
import { centsToDecimal, decimalToCents } from './money';
import type { CategoryStore, IngestedMessageStore, Stores, TransactionStore, UncategorisedGroup } from './ports';

// `database` may be an open transaction, which is how UnitOfWork scopes these to one commit.
export function createDrizzleStores(database: Database): Stores {
  return {
    transactions: transactionStore(database),
    categories: categoryStore(database),
    ingestedMessages: ingestedMessageStore(database),
  };
}

const live = (userId: string) => and(eq(transactions.userId, userId), eq(transactions.isDeleted, false));
const uncategorised = eq(transactions.categorySource, 'none');

function transactionStore(db: Database): TransactionStore {
  return {
    async insertIfNew(tx) {
      const [inserted] = await db
        .insert(transactions)
        .values({
          userId: tx.userId,
          accountType: tx.accountType,
          accountLast4: tx.accountLast4,
          occurredOn: tx.occurredOn,
          amount: centsToDecimal(tx.amountCents),
          descriptionRaw: tx.descriptionRaw,
          descriptionNormalised: tx.descriptionNormalised,
          categoryId: tx.category.categoryId,
          categorySource: tx.category.source,
          ruleId: tx.category.ruleId,
          balanceAfter: tx.balanceAfterCents === null ? null : centsToDecimal(tx.balanceAfterCents),
          kind: tx.kind,
          transactionType: tx.transactionType,
          reserved: tx.reserved,
          source: tx.source,
          sourceRef: tx.sourceRef,
        })
        .onConflictDoNothing({ target: [transactions.source, transactions.sourceRef] })
        .returning({ id: transactions.id });
      if (inserted) return { id: inserted.id, created: true };

      const [existing] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.source, tx.source), eq(transactions.sourceRef, tx.sourceRef)));
      return { id: existing!.id, created: false };
    },

    async findById(userId, id) {
      const [row] = await db
        .select({
          id: transactions.id,
          occurredOn: transactions.occurredOn,
          amount: transactions.amount,
          accountLast4: transactions.accountLast4,
          descriptionNormalised: transactions.descriptionNormalised,
          categoryId: transactions.categoryId,
          categorySource: transactions.categorySource,
        })
        .from(transactions)
        .where(and(live(userId), eq(transactions.id, id)));
      return row ? { ...row, amountCents: decimalToCents(row.amount) } : null;
    },

    async findTransferCandidates(userId, near, windowDays) {
      const rows = await db
        .select({
          id: transactions.id,
          occurredOn: transactions.occurredOn,
          amount: transactions.amount,
          accountLast4: transactions.accountLast4,
        })
        .from(transactions)
        .where(
          and(
            live(userId),
            uncategorised,
            ne(transactions.accountLast4, near.accountLast4),
            eq(transactions.amount, centsToDecimal(-near.amountCents)),
            gte(transactions.occurredOn, addDays(near.occurredOn, -windowDays)),
            lte(transactions.occurredOn, addDays(near.occurredOn, windowDays)),
          ),
        )
        .orderBy(asc(transactions.occurredOn));
      return rows.map(({ amount, ...r }) => ({ ...r, amountCents: decimalToCents(amount) }));
    },

    async setCategory(userId, id, category) {
      await db
        .update(transactions)
        .set({ categoryId: category.categoryId, categorySource: category.source, ruleId: category.ruleId })
        .where(and(live(userId), eq(transactions.id, id)));
    },

    async categoriseIfUncategorised(userId, ids, category) {
      if (ids.length === 0) return 0;
      const updated = await db
        .update(transactions)
        .set({ categoryId: category.categoryId, categorySource: category.source, ruleId: category.ruleId })
        .where(and(live(userId), uncategorised, inArray(transactions.id, ids)))
        .returning({ id: transactions.id });
      return updated.length;
    },

    listUncategorised(userId) {
      return db
        .select({ id: transactions.id, descriptionNormalised: transactions.descriptionNormalised })
        .from(transactions)
        .where(and(live(userId), uncategorised));
    },

    async summariseUncategorised(userId) {
      const count = sql<number>`count(*)::int`;
      const rows = await db
        .select({
          descriptionNormalised: transactions.descriptionNormalised,
          count,
          total: sql<string>`sum(${transactions.amount})::text`,
          lastOccurredOn: sql<string>`max(${transactions.occurredOn})::text`,
          latestTransactionId: sql<string>`(array_agg(${transactions.id} order by ${transactions.occurredOn} desc))[1]`,
          accounts: sql<UncategorisedGroup['accounts']>`jsonb_agg(distinct jsonb_build_object('accountType', ${transactions.accountType}, 'accountLast4', ${transactions.accountLast4}))`,
        })
        .from(transactions)
        .where(and(live(userId), uncategorised))
        .groupBy(transactions.descriptionNormalised)
        .orderBy(desc(count), asc(transactions.descriptionNormalised));
      return rows.map(({ total, ...r }) => ({ ...r, totalCents: decimalToCents(total) }));
    },
  };
}

function categoryStore(db: Database): CategoryStore {
  const ruleColumns = {
    id: categoryRules.id,
    matchType: categoryRules.matchType,
    pattern: categoryRules.pattern,
    categoryId: categoryRules.categoryId,
    origin: categoryRules.origin,
  };

  return {
    listCategories(userId) {
      return db
        .select({ id: categories.id, name: categories.name, kind: categories.kind, isSystem: categories.isSystem })
        .from(categories)
        .where(eq(categories.userId, userId))
        .orderBy(asc(categories.sortOrder), asc(categories.name));
    },

    listRules(userId) {
      return db.select(ruleColumns).from(categoryRules).where(eq(categoryRules.userId, userId));
    },

    async upsertRule(userId, rule) {
      const [row] = await db
        .insert(categoryRules)
        .values({ userId, ...rule })
        .onConflictDoUpdate({
          target: [categoryRules.userId, categoryRules.matchType, categoryRules.pattern],
          set: { categoryId: rule.categoryId, origin: rule.origin, updatedAt: new Date() },
        })
        .returning(ruleColumns);
      return row! satisfies CategoryRule;
    },

    async insertCategoriesIfMissing(userId, seeds) {
      if (seeds.length === 0) return 0;
      // No conflict target: a seed that clashes on name, or on the one-system-category-per-kind
      // index (say Transfer was renamed), is skipped either way.
      const rows = await db
        .insert(categories)
        .values(seeds.map((s) => ({ userId, ...s })))
        .onConflictDoNothing()
        .returning({ id: categories.id });
      return rows.length;
    },

    async insertRulesIfMissing(userId, rules) {
      if (rules.length === 0) return 0;
      const rows = await db
        .insert(categoryRules)
        .values(rules.map((r) => ({ userId, ...r })))
        .onConflictDoNothing()
        .returning({ id: categoryRules.id });
      return rows.length;
    },
  };
}

function ingestedMessageStore(db: Database): IngestedMessageStore {
  return {
    async linkTransaction(ingestedMessageId, transactionId) {
      await db.update(ingestedMessages).set({ transactionId }).where(eq(ingestedMessages.id, ingestedMessageId));
    },

    listParsedWithoutTransaction(userId, { afterId, limit }) {
      return db
        .select({ id: ingestedMessages.id, gmailMessageId: ingestedMessages.gmailMessageId })
        .from(ingestedMessages)
        .innerJoin(mailboxConnections, eq(mailboxConnections.id, ingestedMessages.mailboxConnectionId))
        .where(
          and(
            eq(mailboxConnections.userId, userId),
            eq(ingestedMessages.status, 'parsed'),
            isNull(ingestedMessages.transactionId),
            afterId ? gt(ingestedMessages.id, afterId) : undefined,
          ),
        )
        .orderBy(asc(ingestedMessages.id))
        .limit(limit);
    },
  };
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
