import Link from 'next/link';
import { requireUser } from '@/features/auth/session';
import { budget } from '@/features/budget';
import { isIsoDate, shortDate } from '@/features/cycle/dates';
import { formatRand } from '@/features/transactions/money';
import styles from './dashboard.module.css';
import { CategoryRow, CategoryRows, cx, paydayLabel, SectionTitle, Stat } from './ui';

// The cycle at a glance, in the order the Discord digest reads: what's over budget, what's left in
// everything else, the debit orders, savings, then the numbers behind them.
export default async function Overview({ searchParams }: PageProps<'/dashboard'>) {
  const { userId } = await requireUser();
  const cycleParam = (await searchParams).cycle;
  const cycleRef = typeof cycleParam === 'string' && isIsoDate(cycleParam) ? cycleParam : undefined;
  const { summary: s, previous, tips } = await budget.overview(userId, cycleRef);
  const { cycle, status } = s;

  // Active items, plus anything spent in this cycle even if the item has since been turned off.
  const shown = s.categories.filter((c) => c.isActive || c.spentCents !== 0);
  const savings = shown.filter((c) => c.isSavings && (c.allocatedCents > 0 || c.spentCents !== 0));
  const rest = shown.filter((c) => !c.isSavings);
  const budgeted = rest.filter((c) => c.allocatedCents > 0);
  const spending = budgeted.filter((c) => c.expenseType !== 'static');
  // Most over first: the one to do something about leads.
  const over = spending.filter((c) => c.status === 'over').sort((a, b) => a.remainingCents - b.remainingCents);
  const under = spending.filter((c) => c.status !== 'over');
  const fixed = budgeted.filter((c) => c.expenseType === 'static');
  const noBudget = rest.filter((c) => c.allocatedCents === 0 && c.spentCents !== 0).sort((a, b) => b.spentCents - a.spentCents);

  // Debit orders still to come carry a due date; it belongs on the category's own row.
  const due = new Map(s.pendingDebitOrders.map((p) => [p.categoryId, p]));
  const dueNote = (categoryId: string) => {
    const p = due.get(categoryId);
    if (!p?.expectedOn) return undefined;
    return <span className={cx(p.late && styles.late)}>{p.late ? `late · ${shortDate(p.expectedOn)}` : `due ${shortDate(p.expectedOn)}`}</span>;
  };

  const spentBudget = s.allocatedCents - savings.reduce((sum, c) => sum + c.allocatedCents, 0);

  return (
    <main>
      <div className={styles.pageHead}>
        <div>
          <div className={styles.headline}>
            <h1>{cycle.label}</h1>
            {status.isCurrent && (
              <div className={styles.payday}>
                <div className={styles.statLabel}>Payday</div>
                <div className={styles.paydayValue}>{paydayLabel(status.daysToSalary, status.salaryOverdue)}</div>
              </div>
            )}
          </div>
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

      {!s.hasFullData && <div className={styles.notice}>Tracking began part-way through this cycle, so its totals are incomplete.</div>}

      {s.uncategorised.count > 0 && (
        <Link className={cx(styles.notice, styles.noticeAction)} href={`/dashboard/transactions?cycle=${cycle.id}&uncategorised=1`}>
          <span>
            <strong>
              {s.uncategorised.count} transaction{s.uncategorised.count === 1 ? '' : 's'} ({formatRand(-s.uncategorised.outCents)})
            </strong>{' '}
            {s.uncategorised.count === 1 ? 'needs' : 'need'} a category, so {s.uncategorised.count === 1 ? "it isn't" : "they aren't"} in these
            numbers yet.
          </span>
          <span className={styles.chevron} aria-hidden>
            ›
          </span>
        </Link>
      )}

      {over.length > 0 && (
        <>
          <SectionTitle total={formatRand(over.reduce((sum, c) => sum + -c.remainingCents, 0))}>🔴 Over budget</SectionTitle>
          <CategoryRows lines={over} cycleId={cycle.id} />
        </>
      )}

      {under.length > 0 ? (
        <>
          <SectionTitle total={`${formatRand(under.reduce((sum, c) => sum + Math.max(c.remainingCents, 0), 0))} left`}>🟢 Under budget</SectionTitle>
          <CategoryRows lines={under} cycleId={cycle.id} />
        </>
      ) : (
        over.length === 0 && (
          <p className={styles.subtle}>
            No budgets set yet. <Link href="/dashboard/budget">Set them up</Link>.
          </p>
        )
      )}

      {fixed.length > 0 && (
        <>
          <SectionTitle total={s.pendingTotalCents > 0 ? `${formatRand(s.pendingTotalCents)} to come` : 'all settled'}>🗓️ Fixed costs</SectionTitle>
          <div className={styles.rows}>
            {fixed.map((c) => (
              <CategoryRow key={c.categoryId} c={c} cycleId={cycle.id} note={dueNote(c.categoryId)} />
            ))}
          </div>
        </>
      )}

      {savings.length > 0 && (
        <>
          <SectionTitle total={formatRand(s.savedCents)}>🏦 Savings</SectionTitle>
          <div className={styles.rows}>
            {savings.map((c) => (
              <CategoryRow key={c.categoryId} c={c} cycleId={cycle.id} note={dueNote(c.categoryId)} />
            ))}
          </div>
        </>
      )}

      {noBudget.length > 0 && (
        <>
          <SectionTitle total={formatRand(noBudget.reduce((sum, c) => sum + c.spentCents, 0))}>⚪ No budget set</SectionTitle>
          <CategoryRows lines={noBudget} cycleId={cycle.id} />
        </>
      )}

      <SectionTitle>The numbers</SectionTitle>
      <section className={styles.stats}>
        <Stat label="Left" value={formatRand(s.leftCents)} note="after what's spent, saved and still to pay" wide />
        <Stat
          label="To spend per day"
          value={s.dailyAllowanceCents === null ? '—' : formatRand(s.dailyAllowanceCents)}
          note={`${formatRand(s.discretionaryLeftCents)} discretionary left`}
        />
        <Stat label="Spent" value={formatRand(s.spentCents)} note={`of ${formatRand(spentBudget)} budgeted`} />
        {(s.savedCents !== 0 || savings.length > 0) && (
          <Stat label="Saved" value={formatRand(s.savedCents)} note={s.incomeCents > 0 ? `${Math.round((s.savedCents * 100) / s.incomeCents)}% of income` : undefined} />
        )}
        <Stat label="Income" value={formatRand(s.incomeCents)} note={`net ${formatRand(s.netCents)}`} />
      </section>

      {tips.length > 0 && (
        <>
          <SectionTitle>Worth knowing</SectionTitle>
          <div className={styles.panel}>
            <ul className={styles.list}>
              {tips.slice(0, 6).map((t) => (
                <li key={`${t.code}-${t.message}`}>
                  <span className={cx(styles.tip, styles[t.severity])}>{t.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
