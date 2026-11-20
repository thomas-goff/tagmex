// Counts the queries and wall time each dashboard page's data loading costs, against whatever
// DATABASE_URL points at (seed it with scripts/perf/seed-bench.ts first). Pages are reproduced by
// calling exactly what the Server Component awaits, so the numbers are the page's real DB work.
// Usage: TAGMEX_QUERY_LOG=1 DATABASE_URL=... tsx scripts/perf/bench.ts
import { loadEnvConfig } from '@next/env';
import { byShape, measureQueries, waves } from '@/db/query-log';
import { OWNER_USER_ID as USER } from '@/features/users/owner';
import { runScript } from '../_db';

loadEnvConfig(process.cwd());

runScript(async () => {
  const { createDb } = await import('@/db/client');
  const { createBudgetRepo } = await import('@/features/budget/repo');
  const { createBudgetService } = await import('@/features/budget/service');
  const { createSavingsRepo } = await import('@/features/savings/repo');
  const { createAccountLabelRepo } = await import('@/features/accounts/repo');
  const { effectiveLines } = await import('@/features/budget/effective');
  const { savingsLines } = await import('@/features/savings/summary');
  const { accountKey } = await import('@/features/accounts/labels');

  // The same wiring src/features/budget/index.ts does, minus `server-only` so this runs under tsx.
  const { db, close } = createDb(process.env.DATABASE_URL!);
  const budgetRepo = createBudgetRepo(db);
  const budget = createBudgetService({ repo: budgetRepo });
  const savingsRepo = createSavingsRepo(db);
  const accountLabelRepo = createAccountLabelRepo(db);

  // Each case reproduces one page's awaits, in the order and concurrency the page uses.
  const cases: Record<string, () => Promise<unknown>> = {
    // src/app/dashboard/page.tsx
    'overview (/dashboard)': () => budget.overview(USER),

    // src/app/dashboard/transactions/page.tsx
    'transactions': async () => {
      const [summary] = await Promise.all([budget.summary(USER), budgetRepo.listCategories(USER)]);
      return budgetRepo.listTransactions(
        USER,
        { from: summary.cycle.start, to: summary.status.isCurrent && summary.today >= summary.cycle.end ? undefined : summary.cycle.end },
        50,
        null,
      );
    },

    // src/app/dashboard/budget/page.tsx
    'budget': async () => {
      await budgetRepo.ensureBudgetItems(USER);
      const [{ current }, versions] = await Promise.all([budget.context(USER), budgetRepo.listBudgetLineVersions(USER)]);
      return effectiveLines(versions, current.start);
    },

    // src/app/dashboard/savings/page.tsx
    'savings': async () => {
      await budgetRepo.ensureBudgetItems(USER);
      const [{ current }, versions, categories, accounts, bankAccounts] = await Promise.all([
        budget.context(USER),
        budgetRepo.listBudgetLineVersions(USER),
        budgetRepo.listCategories(USER),
        savingsRepo.listSavingsAccounts(USER),
        accountLabelRepo.listAccounts(USER),
      ]);
      const linked = accounts.map((a) => a.categoryId).filter((id): id is string => id !== null);
      const contributions = await savingsRepo.contributionsByCategory(USER, [...new Set(linked)]);
      return savingsLines({
        accounts,
        budgetLines: effectiveLines(versions, current.start),
        banks: bankAccounts.map((a) => ({ match: accountKey(a), availableCents: a.availableCents, availableOn: a.availableOn })),
        contributions,
        categories: categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })),
      });
    },

    // MCP get_spending_trend / the trend chart.
    'trend (6 cycles)': () => budget.trend(USER, 6),
  };

  for (const [name, run] of Object.entries(cases)) {
    // Warm once so the numbers are steady state, not first-connection.
    await run();
    const { queries, ms } = await measureQueries(run);
    const shapes = byShape(queries);
    const dupes = shapes.filter(([, n]) => n > 1);
    console.log(`\n${name}`);
    console.log(`  ${queries.length} queries in ${waves(queries)} waves, ${ms.toFixed(0)}ms`);
    for (const [sql, n] of shapes) console.log(`    ${n}x  ${sql.slice(0, 170)}`);
    if (dupes.length > 0) console.log(`  ${dupes.reduce((t, [, n]) => t + n - 1, 0)} redundant`);
  }
  await close();
});
