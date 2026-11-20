import { requireUser } from '@/features/auth/session';
import { budget, budgetRepo } from '@/features/budget';
import { effectiveLines, scheduledChanges } from '@/features/budget/effective';
import { categoryEmoji } from '@/features/categorisation/emoji';
import { shortDate } from '@/features/cycle/dates';
import { centsToDecimal, formatRand } from '@/features/transactions/money';
import styles from '../dashboard.module.css';
import { BudgetRowForm, NewCategoryForm } from '../forms';
import { cx } from '../ui';

// Every expense category's budget per cycle, its type and emoji; plus adding a category. A change
// can start in the cycle being reported now or in the next one, so correcting a figure and
// planning a new split are different things.
export default async function Budget() {
  const { userId } = await requireUser();
  await budgetRepo.ensureBudgetItems(userId);
  const [{ current }, versions] = await Promise.all([budget.context(userId), budgetRepo.listBudgetLineVersions(userId)]);
  const lines = effectiveLines(versions, current.start);
  const queued = new Map(scheduledChanges(versions, current.start).map((v) => [v.categoryId, v]));
  const total = lines.filter((l) => l.isActive).reduce((sum, l) => sum + l.allocatedCents, 0);

  return (
    <main>
      <div className={styles.pageHead}>
        <div>
          <h1>Budget</h1>
          <div className={styles.subtle}>
            Per cycle, salary to salary. Static items are fixed debit orders: paid in full, they show as settled. Savings is money
            put away: it counts as saved, not spent.
          </div>
        </div>
        <div className={styles.statValue}>{formatRand(total)}</div>
      </div>

      <div className={styles.notice}>
        {current.label} cycle, {shortDate(current.start)} to {shortDate(current.end)}. A change saved for <strong>this cycle</strong> counts
        against what has already gone out in it; one saved for <strong>next cycle</strong> leaves these numbers alone. Cycles already
        finished keep the budget they were reported with either way.
      </div>

      <div className={styles.panel} style={{ padding: 0 }}>
        <div className={cx(styles.budgetRow, styles.budgetHead)}>
          <span className={styles.budgetEmoji}>Emoji</span>
          <span className={styles.budgetName}>Category</span>
          <span className={styles.budgetAlloc}>Per cycle</span>
          <span className={styles.budgetType}>Type</span>
          <span className={styles.budgetDay}>Day</span>
          <span className={styles.budgetFlags}>Savings / active</span>
          <span className={styles.budgetFrom}>Apply from</span>
          <span className={styles.budgetSave} />
        </div>
        {lines.map((l) => {
          const next = queued.get(l.categoryId);
          return (
            <BudgetRowForm
              key={l.categoryId}
              row={{
                categoryId: l.categoryId,
                name: l.categoryName,
                emoji: categoryEmoji(l.categoryEmoji),
                allocated: centsToDecimal(l.allocatedCents),
                expenseType: l.expenseType,
                expectedDay: l.expectedDay,
                isSavings: l.isSavings,
                isActive: l.isActive,
                scheduled: next
                  ? { effectiveFrom: next.effectiveFrom, label: 'next cycle', allocated: formatRand(next.allocatedCents) }
                  : null,
              }}
            />
          );
        })}
      </div>

      <h2 className={styles.sectionTitle}>New category</h2>
      <div className={styles.panel} style={{ padding: 0 }}>
        <NewCategoryForm />
      </div>
    </main>
  );
}
