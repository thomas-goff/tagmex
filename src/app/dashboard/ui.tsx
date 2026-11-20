import Link from 'next/link';
import type { CategoryLine, CategoryStatus } from '@/features/budget/summary';
import { categoryEmoji } from '@/features/categorisation/emoji';
import { formatRand } from '@/features/transactions/money';
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

export function Stat({ label, value, note, wide }: { label: string; value: string; note?: string; wide?: boolean }) {
  return (
    <div className={cx(styles.stat, wide && styles.statWide)}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {note && <div className={styles.statNote}>{note}</div>}
    </div>
  );
}

export function SectionTitle({ children, total }: { children: React.ReactNode; total?: string }) {
  return (
    <h2 className={styles.sectionTitle}>
      <span>{children}</span>
      {total && <span className={styles.sectionTotal}>{total}</span>}
    </h2>
  );
}

// What the row leads with, mirroring the Discord digest: how much is left, or how far over.
function rowAmount(c: CategoryLine) {
  switch (c.status) {
    case 'over':
      return formatRand(-c.remainingCents);
    case 'settled':
    case 'unbudgeted':
      return formatRand(c.spentCents);
    default:
      return formatRand(c.remainingCents);
  }
}

function rowNote(c: CategoryLine) {
  const of = c.allocatedCents > 0 ? ` of ${formatRand(c.allocatedCents)}` : '';
  switch (c.status) {
    case 'over':
      return `over${of}`;
    case 'settled':
      return c.differenceCents > 0
        ? `paid, ${formatRand(c.differenceCents)} above`
        : c.differenceCents < 0
          ? `paid, ${formatRand(-c.differenceCents)} below`
          : 'paid in full';
    case 'pending':
      return c.spentCents > 0 ? `to go${of}` : c.isSavings ? 'not put away yet' : `not paid yet${of}`;
    case 'unbudgeted':
      return c.isSavings ? 'saved · no budget' : 'spent · no budget';
    default:
      return `left${of}`;
  }
}

// One budget, as one line: emoji, name, how far through it is, and what's left. The whole row is
// a link to that category's transactions for the cycle, so a number can always be chased down.
export function CategoryRow({ c, cycleId, note }: { c: CategoryLine; cycleId: string; note?: React.ReactNode }) {
  const pct = c.usedPct ?? (c.spentCents > 0 ? 100 : 0);
  return (
    <Link
      href={`/dashboard/transactions?cycle=${cycleId}&category=${c.categoryId}`}
      className={cx(styles.row, styles.toned, styles[c.status])}
      aria-label={`${c.name}: ${rowAmount(c)} ${rowNote(c)}`}
    >
      <span className={styles.rowEmoji} aria-hidden>
        {categoryEmoji(c.emoji)}
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowName}>{c.name}</span>
        {c.allocatedCents > 0 && <Bar pct={pct} status={c.status} />}
      </span>
      <span className={styles.rowRight}>
        <span className={styles.rowAmount}>{rowAmount(c)}</span>
        <span className={styles.rowNote}>{note ?? rowNote(c)}</span>
      </span>
    </Link>
  );
}

export function CategoryRows({ lines, cycleId }: { lines: CategoryLine[]; cycleId: string }) {
  return (
    <div className={styles.rows}>
      {lines.map((c) => (
        <CategoryRow key={c.categoryId} c={c} cycleId={cycleId} />
      ))}
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
