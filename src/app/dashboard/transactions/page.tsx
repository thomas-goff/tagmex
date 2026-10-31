import Link from 'next/link';
import { requireUser } from '@/features/auth/session';
import { budget, budgetRepo } from '@/features/budget';
import { categoryEmoji, UNCATEGORISED_EMOJI } from '@/features/categorisation/emoji';
import { addDays, isIsoDate } from '@/features/cycle/dates';
import { shortDate } from '@/features/notifications/budget-messages';
import { formatRand } from '@/features/sync/format';
import styles from '../dashboard.module.css';
import { CategoriseForm, ExcludeButton, type CategoryOption } from '../forms';
import { cx } from '../ui';

const PAGE_SIZE = 50;

function param(value: string | string[] | undefined) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

// A cycle's transactions, newest first, filterable; each one can be (re)categorised or excluded.
export default async function Transactions({ searchParams }: PageProps<'/dashboard/transactions'>) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const cycleParam = param(sp.cycle);
  const categoryId = param(sp.category);
  const search = param(sp.q);
  const uncategorisedOnly = param(sp.uncategorised) === '1';
  const showExcluded = param(sp.excluded) === '1';
  const after = param(sp.after)?.split('_');

  const [summary, categories] = await Promise.all([
    budget.summary(userId, cycleParam && isIsoDate(cycleParam) ? cycleParam : undefined),
    budgetRepo.listCategories(userId),
  ]);
  const { cycle } = summary;
  const { transactions, next } = await budgetRepo.listTransactions(
    userId,
    {
      from: cycle.start,
      // A late salary keeps the current cycle open past its projected end.
      to: summary.status.isCurrent && summary.today >= cycle.end ? undefined : cycle.end,
      categoryId: categories.some((c) => c.id === categoryId) ? categoryId : undefined,
      uncategorisedOnly,
      search,
      includeExcluded: showExcluded,
    },
    PAGE_SIZE,
    after && after.length === 2 && isIsoDate(after[0]!) ? { occurredOn: after[0]!, id: after[1]! } : null,
  );

  const options: CategoryOption[] = categories.map((c) => ({ id: c.id, name: c.name, emoji: categoryEmoji(c.emoji) }));
  const query = (extra: Record<string, string>) =>
    new URLSearchParams(
      Object.entries({ cycle: cycle.id, category: categoryId, q: search, uncategorised: uncategorisedOnly ? '1' : undefined, excluded: showExcluded ? '1' : undefined, ...extra }).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    ).toString();

  return (
    <main>
      <div className={styles.pageHead}>
        <div>
          <h1>Transactions</h1>
          <div className={styles.subtle}>
            {cycle.label} cycle · {shortDate(cycle.start)} to {shortDate(cycle.end)}
          </div>
        </div>
        <div className={styles.cyclePicker}>
          {/* Any date before a cycle's start finds the cycle before it. */}
          <Link href={`/dashboard/transactions?cycle=${addDays(cycle.start, -1)}`}>← Earlier</Link>
          {summary.status.isCurrent ? <span>Current</span> : <Link href={`/dashboard/transactions?cycle=${cycle.end}`}>Later →</Link>}
        </div>
      </div>

      <form className={styles.filters}>
        <input type="hidden" name="cycle" value={cycle.id} />
        <input name="q" placeholder="Search descriptions" defaultValue={search} aria-label="Search descriptions" />
        <select name="category" defaultValue={categoryId ?? ''} aria-label="Category">
          <option value="">All categories</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
        <label className={cx(styles.field, styles.check)}>
          <input type="checkbox" name="uncategorised" value="1" defaultChecked={uncategorisedOnly} /> Uncategorised only
        </label>
        <label className={cx(styles.field, styles.check)}>
          <input type="checkbox" name="excluded" value="1" defaultChecked={showExcluded} /> Show excluded
        </label>
        <button className={styles.button}>Filter</button>
      </form>

      {transactions.length === 0 ? (
        <p className={styles.subtle}>No transactions match.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className={styles.num}>Amount</th>
                <th>Category</th>
                <th>Account</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className={cx(t.isDeleted && styles.excluded)}>
                  <td>{shortDate(t.occurredOn)}</td>
                  <td className={styles.desc}>
                    {t.categoryId ? categoryEmoji(t.categoryEmoji) : UNCATEGORISED_EMOJI} {t.description}
                    {t.reserved && <span className={styles.subtle}> · pending</span>}
                  </td>
                  <td className={cx(styles.num, t.amountCents < 0 ? styles.out : styles.in)}>{formatRand(t.amountCents)}</td>
                  <td>
                    {t.isDeleted ? (
                      <span className={styles.subtle}>Excluded</span>
                    ) : (
                      <CategoriseForm transactionId={t.id} categories={options} currentId={t.categoryId} />
                    )}
                  </td>
                  <td className={styles.subtle}>
                    {t.accountType} …{t.accountLast4}
                  </td>
                  <td>
                    <ExcludeButton transactionId={t.id} excluded={t.isDeleted} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {next && (
        <div className={styles.pager}>
          <Link className={styles.button} href={`/dashboard/transactions?${query({ after: `${next.occurredOn}_${next.id}` })}`}>
            Older →
          </Link>
        </div>
      )}
    </main>
  );
}
