import { requireUser } from '@/features/auth/session';
import { budgetRepo } from '@/features/budget';
import { centsToDecimal } from '@/features/transactions/money';
import styles from '../dashboard.module.css';
import { NotificationsForm, SalaryForm } from '../forms';

// How salary opens a cycle, and what Pennyworth posts to Discord.
export default async function Settings() {
  const { userId } = await requireUser();
  const s = await budgetRepo.getSettings(userId);

  return (
    <main>
      <div className={styles.pageHead}>
        <h1>Settings</h1>
      </div>

      <h2 className={styles.sectionTitle}>Salary</h2>
      <p className={styles.subtle}>
        A credit in the Salary category opens a new cycle when it&apos;s within the tolerance of the expected amount, so a bonus or
        refund doesn&apos;t. Payday moves back to the previous business day for weekends and public holidays.
      </p>
      <div className={styles.panel} style={{ padding: 0 }}>
        <SalaryForm
          salaryDay={s.salaryDayHint}
          expectedSalary={s.expectedSalaryCents === null ? '' : centsToDecimal(s.expectedSalaryCents)}
          tolerancePct={s.salaryTolerancePct}
        />
      </div>

      <h2 className={styles.sectionTitle}>Discord</h2>
      <p className={styles.subtle}>The morning digest and the budget alerts in #budget (category at 80% and over budget, salary landed or overdue).</p>
      <div className={styles.panel} style={{ padding: 0 }}>
        <NotificationsForm digestEnabled={s.digestEnabled} digestHour={s.digestHour} alertsEnabled={s.discordAlertsEnabled} />
      </div>
    </main>
  );
}
