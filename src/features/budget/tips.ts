import { formatRand } from '@/features/sync/format';
import { centsToDecimal } from '@/features/transactions/money';
import { isOverspent, type CycleSummary } from './summary';
import { onPaceCents } from './trend';

// Observations about the current cycle, most urgent first. Each has a stable `code` so Discord and
// Claude can render or filter them differently; `data` amounts are decimal rand strings.

export type TipSeverity = 'critical' | 'warning' | 'info';

export type TipCode =
  | 'salary_overdue'
  | 'uncategorised'
  | 'budgets_not_set'
  | 'overspent'
  | 'static_above_budget'
  | 'on_pace_to_overspend'
  | 'late_debit_orders'
  | 'unbudgeted_spending'
  | 'savings_rate'
  | 'spend_vs_last_cycle';

export interface Tip {
  code: TipCode;
  severity: TipSeverity;
  message: string;
  data: Record<string, unknown>;
}

const RANK: Record<TipSeverity, number> = { critical: 0, warning: 1, info: 2 };

// Projections are noise in the first few days of a cycle.
const MIN_DAYS_FOR_PACE = 5;
// Below this, a change from last cycle isn't worth mentioning.
const NOTABLE_CHANGE_PCT = 15;

export function deriveTips({ current, previous }: { current: CycleSummary; previous: CycleSummary | null }): Tip[] {
  const tips: Tip[] = [];
  const { status } = current;
  const rand = centsToDecimal;

  if (status.salaryOverdue) {
    tips.push({
      code: 'salary_overdue',
      severity: 'critical',
      message: `Salary was expected on ${current.cycle.end} and hasn't arrived. If it has, check it's categorised as Salary.`,
      data: { expected_on: current.cycle.end },
    });
  }

  const { count, outCents, inCents } = current.uncategorised;
  if (count > 0) {
    tips.push({
      code: 'uncategorised',
      severity: count >= 5 || outCents >= 500_00 ? 'warning' : 'info',
      message: `${count} transaction${count === 1 ? ' is' : 's are'} uncategorised (${formatRand(-outCents)} out, ${formatRand(inCents)} in), so the budget numbers leave them out.`,
      data: { count, out: rand(outCents), in: rand(inCents) },
    });
  }

  if (current.allocatedCents === 0) {
    tips.push({
      code: 'budgets_not_set',
      severity: 'info',
      message: 'No budget amounts are set yet, so remaining and discretionary figures are all R0.',
      data: {},
    });
  }

  for (const c of current.categories.filter(isOverspent)) {
    tips.push({
      code: 'overspent',
      severity: 'warning',
      message: `${c.name} is ${formatRand(-c.remainingCents)} over its ${formatRand(c.allocatedCents)} budget.`,
      data: { category_id: c.categoryId, category: c.name, over_by: rand(-c.remainingCents), allocated: rand(c.allocatedCents) },
    });
  }

  // A settled debit order that cost more than budgeted isn't overspending, but the budget is stale.
  for (const c of current.categories.filter((c) => c.status === 'settled' && c.differenceCents > 0)) {
    tips.push({
      code: 'static_above_budget',
      severity: 'info',
      message: `${c.name} is settled at ${formatRand(c.spentCents)}, ${formatRand(c.differenceCents)} more than its ${formatRand(c.allocatedCents)} budget. Update the budget if that's the new amount.`,
      data: { category_id: c.categoryId, category: c.name, paid: rand(c.spentCents), allocated: rand(c.allocatedCents), difference: rand(c.differenceCents) },
    });
  }

  if (status.isCurrent && status.daysElapsed >= MIN_DAYS_FOR_PACE) {
    for (const c of current.categories) {
      if (c.expenseType !== 'dynamic' || c.allocatedCents === 0 || c.remainingCents < 0) continue;
      const projected = onPaceCents(current, c.categoryId);
      if (projected <= c.allocatedCents) continue;
      tips.push({
        code: 'on_pace_to_overspend',
        severity: 'warning',
        message: `${c.name} is on pace for ${formatRand(projected)} against a ${formatRand(c.allocatedCents)} budget.`,
        data: { category_id: c.categoryId, category: c.name, on_pace: rand(projected), allocated: rand(c.allocatedCents) },
      });
    }
  }

  const late = current.pendingDebitOrders.filter((p) => p.late);
  if (late.length > 0) {
    tips.push({
      code: 'late_debit_orders',
      severity: 'warning',
      message: `Expected but not seen yet: ${late.map((p) => `${p.name} (due ${p.expectedOn})`).join(', ')}.`,
      data: { debit_orders: late.map((p) => ({ category: p.name, expected_on: p.expectedOn, amount: rand(p.allocatedCents) })) },
    });
  }

  const unbudgeted = current.categories.filter((c) => c.allocatedCents === 0 && c.spentCents > 0);
  if (current.allocatedCents > 0 && unbudgeted.length > 0) {
    const total = unbudgeted.reduce((sum, c) => sum + c.spentCents, 0);
    tips.push({
      code: 'unbudgeted_spending',
      severity: 'info',
      message: `${formatRand(total)} was spent in categories with no budget: ${unbudgeted.map((c) => c.name).join(', ')}.`,
      data: { total: rand(total), categories: unbudgeted.map((c) => c.name) },
    });
  }

  if (previous && previous.incomeCents > 0) {
    const savedCents = previous.incomeCents - previous.spentCents;
    const pct = Math.round((savedCents * 100) / previous.incomeCents);
    tips.push({
      code: 'savings_rate',
      severity: savedCents < 0 ? 'warning' : 'info',
      message:
        savedCents < 0
          ? `Last cycle (${previous.cycle.label}) spent ${formatRand(-savedCents)} more than came in.`
          : `Last cycle (${previous.cycle.label}) kept ${pct}% of income (${formatRand(savedCents)}).`,
      data: { cycle_id: previous.cycle.id, saved: rand(savedCents), savings_rate_pct: pct },
    });
  }

  if (previous && status.isCurrent && status.daysElapsed >= MIN_DAYS_FOR_PACE && previous.spentCents > 0) {
    const onPace = current.categories.reduce((sum, c) => sum + onPaceCents(current, c.categoryId), 0);
    const changePct = Math.round(((onPace - previous.spentCents) * 100) / previous.spentCents);
    if (Math.abs(changePct) >= NOTABLE_CHANGE_PCT) {
      tips.push({
        code: 'spend_vs_last_cycle',
        severity: 'info',
        message: `On pace to spend ${formatRand(onPace)} this cycle, ${Math.abs(changePct)}% ${changePct > 0 ? 'more' : 'less'} than last cycle's ${formatRand(previous.spentCents)}.`,
        data: { on_pace: rand(onPace), last_cycle: rand(previous.spentCents), change_pct: changePct },
      });
    }
  }

  return tips.map((tip, i) => ({ tip, i })).sort((a, b) => RANK[a.tip.severity] - RANK[b.tip.severity] || a.i - b.i).map((x) => x.tip);
}
