import { accountLabelRepo } from '@/features/accounts';
import { accountKey, maskedAccount } from '@/features/accounts/labels';
import { requireUser } from '@/features/auth/session';
import { budget, budgetRepo } from '@/features/budget';
import { effectiveLines } from '@/features/budget/effective';
import { categoryEmoji } from '@/features/categorisation/emoji';
import { shortDate } from '@/features/cycle/dates';
import { savingsRepo } from '@/features/savings';
import { cyclesToGoal, savingsLines, savingsTotals } from '@/features/savings/summary';
import { BALANCE_SOURCE_LABEL } from '@/features/savings/types';
import { centsToDecimal, formatRand } from '@/features/transactions/money';
import styles from '../dashboard.module.css';
import { NewSavingsAccountForm, SavingsAccountForm, type SavingsAccountOptions } from '../forms';
import { Bar, cx, SectionTitle, Stat } from '../ui';

// Where the money that isn't spent actually sits: a card per pot with what it is for, what goes
// in each cycle, what is in it and how far that is towards its goal. The budget decides what
// moves; this says where it lands. Nothing here changes a cycle's totals.
export default async function Savings() {
  const { userId } = await requireUser();
  await budgetRepo.ensureBudgetItems(userId);
  const [{ current }, versions, categories, accounts, bankAccounts] = await Promise.all([
    budget.context(userId),
    budgetRepo.listBudgetLineVersions(userId),
    budgetRepo.listCategories(userId),
    savingsRepo.listSavingsAccounts(userId),
    accountLabelRepo.listAccounts(userId),
  ]);
  const linked = accounts.map((a) => a.categoryId).filter((id): id is string => id !== null);
  const contributions = await savingsRepo.contributionsByCategory(userId, [...new Set(linked)]);

  const lines = savingsLines({
    accounts,
    budgetLines: effectiveLines(versions, current.start),
    banks: bankAccounts.map((a) => ({ match: accountKey(a), availableCents: a.availableCents, availableOn: a.availableOn })),
    contributions,
    categories: categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })),
  });
  const totals = savingsTotals(lines);

  // Only savings categories are offered: a pot is funded by money that counts as saved.
  const options: SavingsAccountOptions = {
    categories: categories.filter((c) => c.isSavings && !c.isArchived).map((c) => ({ id: c.id, name: c.name, emoji: categoryEmoji(c.emoji) })),
    accounts: bankAccounts.map((a) => ({ key: accountKey(a), shown: maskedAccount(a) })),
  };

  return (
    <main>
      <div className={styles.pageHead}>
        <div>
          <h1>Savings</h1>
          <div className={styles.subtle}>
            What goes away each cycle and where it sits. {current.label} cycle.
          </div>
        </div>
      </div>

      <section className={styles.stats}>
        <Stat label="Total saved" value={formatRand(totals.savedCents)} note={totals.unknown.length > 0 ? `${totals.unknown.join(', ')} not counted yet` : 'across every pot'} wide />
        <Stat label="Going in per cycle" value={formatRand(totals.budgetedCents)} note="from the savings budgets" />
        <Stat
          label="Pots"
          value={String(lines.filter((l) => l.isActive).length)}
          note={lines.some((l) => l.goalCents !== null) ? `${lines.filter((l) => l.remainingCents === 0).length} at their goal` : 'no goals set'}
        />
      </section>

      {lines.length === 0 ? (
        <p className={styles.subtle}>No savings accounts yet. Add the first one below.</p>
      ) : (
        <>
          <SectionTitle>Accounts</SectionTitle>
          <div className={styles.savingsList}>
            {lines.map((l) => {
              const cycles = cyclesToGoal(l);
              // Any progress towards a goal is progress: only reaching it changes the colour.
              const status = l.remainingCents === 0 ? 'settled' : 'on_track';
              return (
                <article key={l.id} className={cx(styles.savingsCard, !l.isActive && styles.excluded)}>
                  <div className={styles.savingsHead}>
                    <span className={styles.savingsName}>
                      <span className={styles.emoji} aria-hidden>
                        {categoryEmoji(l.categoryEmoji)}
                      </span>
                      {l.name}
                    </span>
                    <span className={styles.savingsBalance}>{l.balanceCents === null ? '—' : formatRand(l.balanceCents)}</span>
                  </div>
                  <div className={styles.savingsSub}>
                    <span>{l.purpose ?? l.categoryName ?? 'No category linked'}</span>
                    <span>{l.goalCents === null ? 'no goal' : `of ${formatRand(l.goalCents)}`}</span>
                  </div>

                  {l.progressPct !== null && <Bar pct={l.progressPct} status={status} />}

                  <div className={styles.savingsFacts}>
                    {l.progressPct !== null && <span>{l.progressPct}%</span>}
                    {l.remainingCents !== null && l.remainingCents > 0 && <span>{formatRand(l.remainingCents)} to go</span>}
                    <span>{l.budgetedCents > 0 ? `${formatRand(l.budgetedCents)} per cycle` : 'nothing budgeted'}</span>
                    {cycles !== null && <span>~{cycles} cycle{cycles === 1 ? '' : 's'} at that rate</span>}
                  </div>

                  <div className={styles.savingsSource}>
                    {l.balanceCents === null ? 'No balance yet' : `Balance ${BALANCE_SOURCE_LABEL[l.balanceSource]}`}
                    {l.balanceOn && ` · ${shortDate(l.balanceOn)}`}
                    {!l.isActive && ' · archived'}
                  </div>

                  {l.note && <p className={styles.savingsNote}>{l.note}</p>}

                  <details className={styles.savingsEdit}>
                    <summary>Edit</summary>
                    <SavingsAccountForm
                      row={{
                        id: l.id,
                        name: l.name,
                        purpose: l.purpose ?? '',
                        categoryId: l.categoryId ?? '',
                        accountMatch: l.accountMatch ?? '',
                        balanceSource: l.balanceSource,
                        manualBalance: l.manualBalanceCents === null ? '' : centsToDecimal(l.manualBalanceCents),
                        manualBalanceOn: l.manualBalanceOn ?? '',
                        goal: l.goalCents === null ? '' : centsToDecimal(l.goalCents),
                        note: l.note ?? '',
                        isActive: l.isActive,
                      }}
                      options={options}
                    />
                  </details>
                </article>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle>New savings account</SectionTitle>
      <div className={styles.panel} style={{ padding: 0 }}>
        <NewSavingsAccountForm options={options} />
      </div>
    </main>
  );
}
