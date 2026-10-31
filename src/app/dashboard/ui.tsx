import type { CategoryLine, CategoryStatus } from '@/features/budget/summary';
import { categoryEmoji } from '@/features/categorisation/emoji';
import { formatRand } from '@/features/sync/format';
import styles from './dashboard.module.css';

export const STATUS_LABEL: Record<CategoryStatus, string> = {
  on_track: 'On track',
  warning: 'Warning',
  over: 'Over',
  settled: 'Settled',
  pending: 'Pending',
  unbudgeted: 'No budget',
};

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

export function StatusChip({ status }: { status: CategoryStatus }) {
  return <span className={cx(styles.chip, styles.toned, styles[status])}>{STATUS_LABEL[status]}</span>;
}

export function Bar({ pct, status }: { pct: number; status: CategoryStatus }) {
  return (
    <div className={styles.bar} role="img" aria-label={`${pct}% used`}>
      <div className={cx(styles.barFill, styles.toned, styles[status])} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {note && <div className={styles.statNote}>{note}</div>}
    </div>
  );
}

function cardNote(c: CategoryLine) {
  switch (c.status) {
    case 'settled':
      return c.differenceCents > 0
        ? `${formatRand(c.differenceCents)} more than budgeted`
        : c.differenceCents < 0
          ? `${formatRand(-c.differenceCents)} less than budgeted`
          : 'Paid in full';
    case 'pending':
      return c.spentCents > 0 ? `${formatRand(c.remainingCents)} still to go` : 'Not paid yet';
    case 'over':
      return `${formatRand(-c.remainingCents)} over`;
    case 'unbudgeted':
      return 'No budget set';
    default:
      return `${formatRand(c.remainingCents)} left`;
  }
}

export function CategoryCard({ c }: { c: CategoryLine }) {
  return (
    <div className={cx(styles.card, styles.toned, styles[c.status])}>
      <div className={styles.cardHead}>
        <span className={styles.cardName} title={c.name}>
          <span className={styles.emoji} aria-hidden>
            {categoryEmoji(c.emoji)}
          </span>
          {c.name}
        </span>
        <StatusChip status={c.status} />
      </div>
      <Bar pct={c.usedPct ?? (c.spentCents > 0 ? 100 : 0)} status={c.status} />
      <div className={styles.amounts}>
        <span>
          {formatRand(c.spentCents)}
          {c.allocatedCents > 0 && <span className={styles.subtle}> of {formatRand(c.allocatedCents)}</span>}
        </span>
        <span className={styles.subtle}>{cardNote(c)}</span>
      </div>
    </div>
  );
}

export function paydayLabel(daysToSalary: number | null, overdue: boolean) {
  if (overdue) return 'Overdue';
  if (daysToSalary === null) return '—';
  if (daysToSalary === 0) return 'Today';
  return `${daysToSalary} day${daysToSalary === 1 ? '' : 's'}`;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error'; children: React.ReactNode }) {
  return <div className={cx(styles.notice, kind === 'error' && styles.error)}>{children}</div>;
}
