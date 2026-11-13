import { accountLabelRepo } from '@/features/accounts';
import { accountKey, createLabeller, maskedAccount } from '@/features/accounts/labels';
import { requireUser } from '@/features/auth/session';
import { budgetRepo } from '@/features/budget';
import { shortDate } from '@/features/cycle/dates';
import { centsToDecimal, formatRand } from '@/features/transactions/money';
import styles from '../dashboard.module.css';
import { AccountLabelForm, NotificationsForm, SalaryForm } from '../forms';

// How salary opens a cycle, what Pennyworth posts to Discord, and what the accounts are called.
export default async function Settings() {
  const { userId } = await requireUser();
  const [s, accounts, labels] = await Promise.all([
    budgetRepo.getSettings(userId),
    accountLabelRepo.listAccounts(userId),
    accountLabelRepo.listLabels(userId).then(createLabeller),
  ]);

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

      <h2 className={styles.sectionTitle}>Accounts</h2>
      <p className={styles.subtle}>
        Names for the accounts the bank shows as a type and four digits, with the balance from each one&apos;s latest bank email (for a
        credit card, the credit still available). Names show next to transactions; they never change a category or a total.
      </p>
      <div className={styles.panel} style={{ padding: 0 }}>
        {accounts.length === 0 ? (
          <p className={styles.subtle} style={{ padding: 12 }}>
            No accounts yet: nothing has synced.
          </p>
        ) : (
          accounts.map((a) => (
            <AccountLabelForm
              key={accountKey(a)}
              row={{
                key: accountKey(a),
                shown: maskedAccount(a),
                label: labels.account(a)?.label ?? '',
                note: labels.account(a)?.note ?? '',
                available: a.availableCents === null ? null : `${formatRand(a.availableCents)}${a.availableOn ? ` on ${shortDate(a.availableOn)}` : ''}`,
              }}
            />
          ))
        )}
      </div>

      <h2 className={styles.sectionTitle}>Discord</h2>
      <p className={styles.subtle}>The morning digest and the budget alerts in #budget (category at 80% and over budget, salary landed or overdue).</p>
      <div className={styles.panel} style={{ padding: 0 }}>
        <NotificationsForm digestEnabled={s.digestEnabled} digestHour={s.digestHour} alertsEnabled={s.discordAlertsEnabled} />
      </div>
    </main>
  );
}
