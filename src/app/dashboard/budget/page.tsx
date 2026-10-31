import { requireUser } from '@/features/auth/session';
import { budgetRepo } from '@/features/budget';
import { categoryEmoji } from '@/features/categorisation/emoji';
import { formatRand } from '@/features/sync/format';
import { centsToDecimal } from '@/features/transactions/money';
import styles from '../dashboard.module.css';
import { BudgetRowForm, NewCategoryForm } from '../forms';
import { cx } from '../ui';

// Every expense category's budget per cycle, its type and emoji; plus adding a category.
export default async function Budget() {
  const { userId } = await requireUser();
  await budgetRepo.ensureBudgetItems(userId);
  const lines = await budgetRepo.listBudgetLines(userId);
  const total = lines.filter((l) => l.isActive).reduce((sum, l) => sum + l.allocatedCents, 0);

  return (
    <main>
      <div className={styles.pageHead}>
        <div>
          <h1>Budget</h1>
          <div className={styles.subtle}>
            Per cycle, salary to salary. Static items are fixed debit orders: paid in full, they show as settled.
          </div>
        </div>
        <div className={styles.statValue}>{formatRand(total)}</div>
      </div>

      <div className={styles.panel} style={{ padding: 0 }}>
        <div className={cx(styles.budgetRow, styles.budgetHead)}>
          <span>Emoji</span>
          <span>Category</span>
          <span>Per cycle</span>
          <span>Type</span>
          <span>Day</span>
          <span>Active</span>
          <span />
        </div>
        {lines.map((l) => (
          <BudgetRowForm
            key={l.categoryId}
            row={{
              categoryId: l.categoryId,
              name: l.categoryName,
              emoji: categoryEmoji(l.categoryEmoji),
              allocated: centsToDecimal(l.allocatedCents),
              expenseType: l.expenseType,
              expectedDay: l.expectedDay,
              isActive: l.isActive,
            }}
          />
        ))}
      </div>

      <h2 className={styles.sectionTitle}>New category</h2>
      <div className={styles.panel} style={{ padding: 0 }}>
        <NewCategoryForm />
      </div>
    </main>
  );
}
