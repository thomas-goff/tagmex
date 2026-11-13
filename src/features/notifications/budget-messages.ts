import { paydayOf } from '@/features/budget/standing';
import { isOverspent, type CycleSummary } from '@/features/budget/summary';
import type { Tip } from '@/features/budget/tips';
import { daysBetween, shortDate } from '@/features/cycle/dates';
import { escapeMarkdown, formatRand } from '@/features/sync/format';
import { debitOrdersEmbed, digestEmbed, salaryLandedEmbed, salaryOverdueEmbed, thresholdEmbed, type DiscordPayload } from './embeds';

// What the budget posts to Discord, as pure functions of the summary. Discord stays one-way: Claude
// is where you ask follow-up questions.

// A new cycle's "salary landed" alert is only worth sending close to the day it landed.
const SALARY_ALERT_WINDOW_DAYS = 3;

// Tips the digest leaves out: those with a line of their own (uncategorised, salary overdue, late
// debit orders) and those the budget lists already show (overspent, a debit order paid above budget).
const DIGEST_SKIPS_TIPS = new Set(['uncategorised', 'salary_overdue', 'late_debit_orders', 'overspent', 'static_above_budget']);

// The daily digest, as two messages: budgets, then payday and debit orders. On a cycle's first day,
// yesterday is in the previous cycle's summary. `title` replaces the first message's title. Each
// goes out as one Components V2 card (see ./layout), which shows its lists on every client.
export function digestPayloads(
  s: CycleSummary,
  tips: Tip[],
  { title, previous }: { title?: string; previous?: CycleSummary | null } = {},
): [budgets: DiscordPayload, debitOrders: DiscordPayload] {
  const yesterday = s.yesterday ?? previous?.yesterday ?? null;
  const budgets = digestEmbed(
    {
      discretionaryLeftCents: s.discretionaryLeftCents,
      dailyAllowanceCents: s.dailyAllowanceCents,
      yesterday: yesterday && { outCents: yesterday.outCents, count: yesterday.count },
      categories: s.categories,
      uncategorised: s.uncategorised,
      tips: tips
        .filter((t) => !DIGEST_SKIPS_TIPS.has(t.code))
        .slice(0, 2)
        .map((t) => t.message),
    },
    title,
  );
  const debitOrders = debitOrdersEmbed({
    payday: paydayOf(s),
    paydayDateLabel: shortDate(s.cycle.end),
    paydayProjected: s.cycle.endIsProjected,
    salary: s.cycle.salary && { amountCents: s.cycle.salary.amountCents, landedLabel: shortDate(s.cycle.salary.occurredOn) },
    categories: s.categories,
    pending: s.pendingDebitOrders.map((p) => ({
      name: p.name,
      emoji: s.categories.find((c) => c.categoryId === p.categoryId)?.emoji ?? null,
      allocatedCents: p.allocatedCents,
      dueLabel: p.expectedOn ? shortDate(p.expectedOn) : null,
      late: p.late,
    })),
    pendingTotalCents: s.pendingTotalCents,
  });
  return [{ embeds: [budgets] }, { embeds: [debitOrders] }];
}

export type AlertKind = 'category_threshold' | 'salary_landed' | 'salary_overdue';

export interface BudgetAlert {
  kind: AlertKind;
  dedupeKey: string;
  payload: DiscordPayload;
  // Keys to mark as sent with this one, e.g. jumping straight past 80% means no 80% alert later.
  alsoClaim: string[];
}

export const THRESHOLDS = [80, 100] as const;

export function thresholdKey(pct: number, cycleId: string, categoryId: string) {
  return `cat_${pct}:${cycleId}:${categoryId}`;
}

// Alerts the current state calls for. Each key fires once ever (notifications_sent), so this can be
// evaluated on every sync and every hour.
export function budgetAlerts(current: CycleSummary, previous: CycleSummary | null): BudgetAlert[] {
  if (!current.status.isCurrent) return [];
  const { cycle, status } = current;
  const alerts: BudgetAlert[] = [];

  const salary = cycle.salary;
  if (salary && daysBetween(salary.occurredOn, current.today) <= SALARY_ALERT_WINDOW_DAYS) {
    alerts.push({
      kind: 'salary_landed',
      dedupeKey: `salary_landed:${cycle.id}`,
      payload: {
        embeds: [
          salaryLandedEmbed({
            amountCents: salary.amountCents,
            landedLabel: shortDate(salary.occurredOn),
            nextLabel: shortDate(cycle.end),
            nextProjected: cycle.endIsProjected,
            recap: previous ? recap(previous) : null,
          }),
        ],
      },
      alsoClaim: [],
    });
  }

  if (status.salaryOverdue) {
    alerts.push({
      kind: 'salary_overdue',
      dedupeKey: `salary_overdue:${cycle.id}`,
      payload: { embeds: [salaryOverdueEmbed(shortDate(cycle.end))] },
      alsoClaim: [],
    });
  }

  for (const c of current.categories) {
    // A static item reaching 100% is a debit order being paid: settled, not an alert.
    if (c.allocatedCents === 0 || c.usedPct === null || c.expenseType === 'static') continue;
    const reached = THRESHOLDS.filter((t) => c.spentCents * 100 >= c.allocatedCents * t);
    const top = reached.at(-1);
    if (top === undefined) continue;
    alerts.push({
      kind: 'category_threshold',
      dedupeKey: thresholdKey(top, cycle.id, c.categoryId),
      payload: { embeds: [thresholdEmbed(c, paydayOf(current), top)] },
      alsoClaim: reached.slice(0, -1).map((t) => thresholdKey(t, cycle.id, c.categoryId)),
    });
  }
  return alerts;
}

// One paragraph on the cycle that just closed.
export function recap(s: CycleSummary) {
  const over = s.categories
    .filter(isOverspent)
    .sort((a, b) => a.remainingCents - b.remainingCents)
    .slice(0, 3)
    .map((c) => `${escapeMarkdown(c.name)} ${formatRand(-c.remainingCents)} over`);
  const clauses = [
    `${s.cycle.label}: spent ${formatRand(s.spentCents)} against ${formatRand(s.allocatedCents)} budgeted`,
    s.incomeCents > 0 ? `income ${formatRand(s.incomeCents)}, net ${formatRand(s.netCents)}` : null,
    over.length > 0 ? `biggest overspends: ${over.join(', ')}` : null,
    s.uncategorised.count > 0 ? `${s.uncategorised.count} still uncategorised` : null,
  ];
  return `${clauses.filter(Boolean).join('; ')}.`;
}
