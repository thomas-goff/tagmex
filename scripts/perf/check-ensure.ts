import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { createDb } from '@/db/client';
import { createBudgetRepo } from '@/features/budget/repo';
import { budgetItems, categories } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { runScript } from '../_db';

runScript(async () => {
  const { db, close } = createDb(process.env.DATABASE_URL!);
  const repo = createBudgetRepo(db);
  const U = 'owner';
  const count = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(budgetItems).where(eq(budgetItems.userId, U)))[0]!.n;
  const expenseCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(categories).where(and(eq(categories.userId, U), eq(categories.kind, 'expense'))))[0]!.n;

  console.log('expense categories:', await expenseCount(), 'budget_items rows:', await count());
  console.log('ensure (nothing missing) ->', await repo.ensureBudgetItems(U), 'expected 0');

  // Remove every version of one category's item, as a category created outside the budget would be.
  const [victim] = await db.select({ id: categories.id, name: categories.name }).from(categories)
    .where(and(eq(categories.userId, U), eq(categories.kind, 'expense'))).limit(1);
  await db.delete(budgetItems).where(and(eq(budgetItems.userId, U), eq(budgetItems.categoryId, victim!.id)));
  console.log(`deleted all budget items for "${victim!.name}"; rows now`, await count());
  console.log('ensure (one missing) ->', await repo.ensureBudgetItems(U), 'expected 1');
  const [row] = await db.select().from(budgetItems).where(and(eq(budgetItems.userId, U), eq(budgetItems.categoryId, victim!.id)));
  console.log('recreated:', { effectiveFrom: row!.effectiveFrom, expenseType: row!.expenseType, allocated: row!.allocated, sortOrder: row!.sortOrder, isActive: row!.isActive });
  console.log('ensure again ->', await repo.ensureBudgetItems(U), 'expected 0');

  // A category with only a future-dated version must NOT get a second R0 row.
  const [other] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, U), eq(categories.kind, 'expense'))).limit(1);
  console.log('rows before future-version check', await count());
  await repo.updateBudgetItem(U, other!.id, { allocatedCents: 123 }, '2030-01-01');
  console.log('ensure after adding a 2030 version ->', await repo.ensureBudgetItems(U), 'expected 0');
  await db.delete(budgetItems).where(and(eq(budgetItems.userId, U), eq(budgetItems.categoryId, other!.id), eq(budgetItems.effectiveFrom, '2030-01-01')));
  await close();
});
