import Link from 'next/link';
import { requireUser } from '@/features/auth/session';
import { budget } from '@/features/budget';
import { isIsoDate } from '@/features/cycle/dates';
import { categoryEmoji } from '@/features/categorisation/emoji';
import { shortDate } from '@/features/notifications/budget-messages';
import { formatRand } from '@/features/sync/format';
import styles from './dashboard.module.css';
import { CategoryCard, cx, paydayLabel, Stat } from './ui';

// The cycle at a glance: payday, what's left to spend, every budget, debit orders to come, tips.
export default async function Overview({ searchParams }: PageProps<'/dashboard'>) {
  const { userId } = await requireUser();
  const cycleParam = (await searchParams).cycle;
  const cycleRef = typeof cycleParam === 'string' && isIsoDate(cycleParam) ? cycleParam : undefined;
  const { summary: s, previous, tips } = await budget.overview(userId, cycleRef);
  const { cycle, status } = s;

  const budgeted = s.categories.filter((c) => c.isActive && (c.allocatedCents > 0 || c.spentCents !== 0));
  const flexible = budgeted.filter((c) => c.expenseType !== 'static');
  const fixed = budgeted.filter((c) => c.expenseType === 'static');
  const emojiOf = new Map(s.categories.map((c) => [c.categoryId, c.emoji]));

  return (
    <main>
      <div className={styles.pageHead}>
        <div>
          <h1>{cycle.label} cycle</h1>
          <div className={styles.subtle}>
            {shortDate(cycle.start)} to {shortDate(cycle.end)}
            {cycle.endIsProjected ? ' (projected)' : ''}
            {status.isCurrent ? '' : ' · finished'}
          </div>
        </div>
        <div className={styles.cyclePicker}>
          <Link href={`/dashboard?cycle=${previous.cycle.id}`}>← {previous.cycle.label}</Link>
          {status.isCurrent ? <span>Current</span> : <Link href={`/dashboard?cycle=${cycle.end}`}>Next →</Link>}
          {!status.isCurrent && <Link href="/dashboard">Today</Link>}
        </div>
      </div>

      <section className={styles.stats}>
        {status.isCurrent && (
          <Stat label="Payday" value={paydayLabel(status.daysToSalary, status.salaryOverdue)} note={`${status.salaryOverdue ? 'was due' : 'on'} ${shortDate(cycle.end)}`} />
        )}
        <Stat
          label="To spend per day"
          value={s.dailyAllowanceCents === null ? '—' : formatRand(s.dailyAllowanceCents)}
          note={`${formatRand(s.discretionaryLeftCents)} discretionary left`}
        />
        <Stat label="Spent" value={formatRand(s.spentCents)} note={`of ${formatRand(s.allocatedCents)} budgeted`} />
        <Stat label="Income" value={formatRand(s.incomeCents)} note={`net ${formatRand(s.netCents)}`} />
      </section>

      {s.uncategorised.count > 0 && (
        <div className={styles.notice}>
          {s.uncategorised.count} uncategorised transaction{s.uncategorised.count === 1 ? '' : 's'} ({formatRand(-s.uncategorised.outCents)} out)
          aren&apos;t in these numbers yet.{' '}
          <Link href={`/dashboard/transactions?cycle=${cycle.id}&uncategorised=1`}>Sort them out</Link>
        </div>
      )}

      <h2 className={styles.sectionTitle}>Spending</h2>
      {flexible.length > 0 ? (
        <div className={styles.cards}>
          {flexible.map((c) => (
            <CategoryCard key={c.categoryId} c={c} />
          ))}
        </div>
      ) : (
        <p className={styles.subtle}>
          No budgets set yet. <Link href="/dashboard/budget">Set them up</Link>.
        </p>
      )}

      {fixed.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Fixed costs</h2>
          <div className={styles.cards}>
            {fixed.map((c) => (
              <CategoryCard key={c.categoryId} c={c} />
            ))}
          </div>
        </>
      )}

      <div className={styles.twoCol}>
        <section>
          <h2 className={styles.sectionTitle}>Debit orders to come · {formatRand(s.pendingTotalCents)}</h2>
          <div className={styles.panel}>
            {s.pendingDebitOrders.length === 0 ? (
              <p className={styles.subtle}>All settled for this cycle.</p>
            ) : (
              <ul className={styles.list}>
                {s.pendingDebitOrders.map((p) => (
                  <li key={p.categoryId}>
                    <span>
                      <span className={styles.emoji} aria-hidden>
                        {categoryEmoji(emojiOf.get(p.categoryId))}
                      </span>
                      {p.name}
                    </span>
                    <span>
                      {formatRand(p.allocatedCents)}
                      {p.expectedOn && (
                        <span className={cx(styles.subtle, p.late && styles.late)}> · {p.late ? 'late, ' : ''}{shortDate(p.expectedOn)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <h2 className={styles.sectionTitle}>Worth knowing</h2>
          <div className={styles.panel}>
            {tips.length === 0 ? (
              <p className={styles.subtle}>Nothing to flag.</p>
            ) : (
              <ul className={styles.list}>
                {tips.slice(0, 6).map((t) => (
                  <li key={`${t.code}-${t.message}`} className={cx(styles.tip, styles[t.severity])}>
                    {t.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
