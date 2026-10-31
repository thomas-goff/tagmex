import { paydayOf } from '@/features/budget/standing';
import { isOverspent, type CycleSummary } from '@/features/budget/summary';
import type { Tip } from '@/features/budget/tips';
import { dayOfWeek, daysBetween, monthName, parts } from '@/features/cycle/dates';
import { escapeMarkdown, formatRand } from '@/features/sync/format';
import { digestEmbed, salaryLandedEmbed, salaryOverdueEmbed, thresholdEmbed, type DiscordPayload } from './embeds';

// What the budget posts to Discord, as pure functions of the summary. Discord stays one-way: Claude
// is where you ask follow-up questions.

// A new cycle's "salary landed" alert is only worth sending close to the day it landed.
const SALARY_ALERT_WINDOW_DAYS = 3;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shortDate(iso: string) {
  const { day, month } = parts(iso);
  return `${WEEKDAYS[dayOfWeek(iso)]} ${day} ${monthName(month).slice(0, 3)}`;
}

export function digestPayload(s: CycleSummary, tips: Tip[], title?: string): DiscordPayload {
  return {
    embeds: [
      digestEmbed(
        {
          dateLabel: shortDate(s.today),
          cycleLabel: s.cycle.label,
          payday: paydayOf(s),
          paydayDateLabel: shortDate(s.cycle.end),
          discretionaryLeftCents: s.discretionaryLeftCents,
          dailyAllowanceCents: s.dailyAllowanceCents,
          spentCents: s.spentCents,
          allocatedCents: s.allocatedCents,
          categories: s.categories,
          pending: s.pendingDebitOrders.map((p) => ({
            name: p.name,
            emoji: s.categories.find((c) => c.categoryId === p.categoryId)?.emoji ?? null,
            allocatedCents: p.allocatedCents,
            dueLabel: p.expectedOn ? shortDate(p.expectedOn) : null,
            late: p.late,
          })),
          pendingTotalCents: s.pendingTotalCents,
          uncategorised: s.uncategorised,
          // The uncategorised and overdue tips have their own fields.
          tips: tips
            .filter((t) => t.code !== 'uncategorised' && t.code !== 'salary_overdue')
            .slice(0, 2)
            .map((t) => t.message),
        },
        title,
      ),
    ],
  };
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
            cycleLabel: cycle.label,
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
