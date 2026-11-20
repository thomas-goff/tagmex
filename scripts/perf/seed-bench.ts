// Fills the database pointed at by DATABASE_URL with a realistic two-year ledger, so a perf run
// measures something like a real user's dashboard. Local only: it writes a lot of rows.
// Usage: DATABASE_URL=... tsx scripts/perf/seed-bench.ts
import { createBudgetRepo } from '@/features/budget/repo';
import { createLedger } from '@/features/transactions/ledger';
import { accountLabels, savingsAccounts, transactions } from '@/db/schema';
import { createSavingsRepo } from '@/features/savings/repo';
import { seedSavingsAccounts } from '@/features/savings/seed';
import { accountKey } from '@/features/accounts/labels';
import { createAccountLabelRepo } from '@/features/accounts/repo';
import { OWNER_USER_ID as USER } from '@/features/users/owner';
import { openDatabase, runScript } from '../_db';

const CYCLES = 24;
const PER_CYCLE = 90;

// A fixed stream so two runs measure the same ledger.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

runScript(async () => {
  const { db, close } = openDatabase();
  const rand = rng(42);
  try {
    await createLedger(db).seedDefaults(USER);
    const repo = createBudgetRepo(db);
    const cats = await repo.listCategories(USER);
    const expense = cats.filter((c) => c.kind === 'expense');
    const salary = cats.find((c) => c.isSalary)!;

    await db
      .insert(accountLabels)
      .values([
        { userId: USER, kind: 'account' as const, match: 'CHEQ1234', label: 'Everyday' },
        { userId: USER, kind: 'account' as const, match: 'SAVE5678', label: 'Emergency' },
      ])
      .onConflictDoNothing();

    const bankAccounts = await createAccountLabelRepo(db).listAccounts(USER);
    await seedSavingsAccounts(createSavingsRepo(db), USER, cats, bankAccounts.map(accountKey));

    // 24 cycles back from this month, salary on the 25th, then PER_CYCLE spends spread over each.
    const rows: (typeof transactions.$inferInsert)[] = [];
    const start = new Date('2024-12-25T00:00:00Z');
    for (let c = 0; c < CYCLES; c++) {
      const day = new Date(start);
      day.setUTCMonth(day.getUTCMonth() + c);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      rows.push({
        userId: USER, occurredOn: iso(day), amount: '42000.00', descriptionRaw: 'SALARY ACME PAYROLL',
        descriptionNormalised: 'salary acme payroll', categoryId: salary.id, categorySource: 'manual',
        kind: 'credit', accountType: 'CHEQ', accountLast4: '1234', transactionType: 'ACB CREDIT',
        source: 'manual', sourceRef: `bench-sal-${c}`, balanceAfter: '25000.00',
      });
      for (let i = 0; i < PER_CYCLE; i++) {
        const d = new Date(day);
        d.setUTCDate(d.getUTCDate() + Math.floor(rand() * 29));
        const cat = expense[Math.floor(rand() * expense.length)]!;
        // A tenth stay uncategorised, as they do before anyone reviews them.
        const uncategorised = rand() < 0.1;
        const merchant = `MERCHANT ${Math.floor(rand() * 400)}`;
        rows.push({
          userId: USER, occurredOn: iso(d), amount: `-${(rand() * 900 + 20).toFixed(2)}`,
          descriptionRaw: merchant, descriptionNormalised: merchant.toLowerCase(),
          categoryId: uncategorised ? null : cat.id, categorySource: uncategorised ? 'none' : 'merchant_rule',
          kind: 'card_purchase', accountType: 'CHEQ', accountLast4: '1234', transactionType: 'CARD PURCHASE',
          source: 'manual', sourceRef: `bench-${c}-${i}`, balanceAfter: '24000.00',
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(transactions).values(rows.slice(i, i + 500)).onConflictDoNothing();
    }
    await repo.ensureBudgetItems(USER);
    // Give most items a budget, so the summary has real work to do.
    for (const c of expense) {
      await repo.updateBudgetItem(USER, c.id, { allocatedCents: Math.round((rand() * 500 + 50)) * 100 }, '2024-01-01');
    }
    const savings = await db.select().from(savingsAccounts);
    console.log(`Seeded ${rows.length} transactions, ${expense.length} expense categories, ${savings.length} savings accounts.`);
  } finally {
    await close();
  }
});
