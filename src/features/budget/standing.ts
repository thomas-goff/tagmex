import { formatRand } from '@/features/sync/format';
import type { CycleSummary } from './summary';

// A transaction's category budget this cycle, for its Discord line: "R450.00 of R4,000.00, 11%".
// Null for transactions from before the current cycle, and for non-expense categories.
export function budgetStanding(summary: CycleSummary, categoryId: string | null | undefined, occurredOn: string) {
  if (!categoryId || occurredOn < summary.cycle.start) return null;
  const line = summary.categories.find((c) => c.categoryId === categoryId);
  if (!line) return null;
  if (line.allocatedCents === 0) return `${formatRand(line.spentCents)} this cycle`;
  return `${formatRand(line.spentCents)} of ${formatRand(line.allocatedCents)}, ${line.usedPct}%${line.remainingCents < 0 ? ' ⚠️' : ''}`;
}
