import type { CycleSummary } from '@/features/budget/summary';
import type { Tip } from '@/features/budget/tips';
import { dayOfWeek, daysBetween, monthName, parts } from '@/features/cycle/dates';
import { escapeMarkdown, formatRand } from '@/features/sync/format';

// What the budget posts to Discord, as pure functions of the summary. Discord stays one-way: Claude
// is where you ask follow-up questions.

const DISCORD_LIMIT = 1900;
// A new cycle's "salary landed" alert is only worth sending close to the day it landed.
const SALARY_ALERT_WINDOW_DAYS = 3;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortDate(iso: string) {
  const { day, month } = parts(iso);
  return `${WEEKDAYS[dayOfWeek(iso)]} ${day} ${monthName(month).slice(0, 3)}`;
}

function clip(content: string) {
  return content.length > DISCORD_LIMIT ? `${content.slice(0, DISCORD_LIMIT - 1)}…` : content;
}

export function digestMessage(s: CycleSummary, tips: Tip[]) {
  const { cycle, status } = s;
  const lines = [`☀️ **Budget · ${shortDate(s.today)}** · ${cycle.label} cycle`];

  lines.push(
    status.salaryOverdue
      ? `⏰ Salary was due ${shortDate(cycle.end)} and hasn't arrived`
      : `💰 ${status.daysToSalary} day${status.daysToSalary === 1 ? '' : 's'} to salary (${shortDate(cycle.end)})`,
  );
  lines.push(
    `🧮 Discretionary left ${formatRand(s.discretionaryLeftCents)}${s.dailyAllowanceCents === null ? '' : ` → **${formatRand(s.dailyAllowanceCents)}/day**`} · spent ${formatRand(s.spentCents)} of ${formatRand(s.allocatedCents)} budgeted`,
  );
  if (s.pendingDebitOrders.length > 0) {
    const items = s.pendingDebitOrders
      .map((p) => `${escapeMarkdown(p.name)} ${formatRand(p.allocatedCents)}${p.expectedOn ? ` (${p.late ? 'late, ' : ''}${shortDate(p.expectedOn)})` : ''}`)
      .join(', ');
    lines.push(`📅 Debit orders to come ${formatRand(s.pendingTotalCents)}: ${items}`);
  }
  if (s.uncategorised.count > 0) {
    lines.push(`❔ ${s.uncategorised.count} uncategorised (${formatRand(-s.uncategorised.outCents)}): ask Claude to sort them out`);
  }
  for (const tip of tips.filter((t) => t.code !== 'uncategorised' && t.code !== 'salary_overdue').slice(0, 2)) {
    lines.push(`💡 ${escapeMarkdown(tip.message)}`);
  }
  return clip(lines.join('\n'));
}

export type AlertKind = 'category_threshold' | 'salary_landed' | 'salary_overdue';

export interface BudgetAlert {
  kind: AlertKind;
  dedupeKey: string;
  message: string;
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
    const lines = [
      `💰 **Salary landed** (${formatRand(salary.amountCents)} on ${shortDate(salary.occurredOn)}): the ${cycle.label} cycle has started. Next salary ${cycle.endIsProjected ? 'expected' : 'on'} ${shortDate(cycle.end)}.`,
    ];
    if (previous) lines.push(recap(previous));
    alerts.push({ kind: 'salary_landed', dedupeKey: `salary_landed:${cycle.id}`, message: clip(lines.join('\n')), alsoClaim: [] });
  }

  if (status.salaryOverdue) {
    alerts.push({
      kind: 'salary_overdue',
      dedupeKey: `salary_overdue:${cycle.id}`,
      message: `⏰ **Salary overdue**: it was expected on ${shortDate(cycle.end)} and hasn't shown up. If it has landed, make sure it's categorised as Salary.`,
      alsoClaim: [],
    });
  }

  for (const c of current.categories) {
    if (c.allocatedCents === 0 || c.usedPct === null) continue;
    const reached = THRESHOLDS.filter((t) => c.spentCents * 100 >= c.allocatedCents * t);
    const top = reached.at(-1);
    if (top === undefined) continue;
    const name = escapeMarkdown(c.name);
    alerts.push({
      kind: 'category_threshold',
      dedupeKey: thresholdKey(top, cycle.id, c.categoryId),
      message:
        top >= 100
          ? `🔴 **${name}** is over budget: ${formatRand(c.spentCents)} of ${formatRand(c.allocatedCents)} (${formatRand(-c.remainingCents)} over), ${status.daysToSalary} days to payday.`
          : `⚠️ **${name}** has used ${c.usedPct}% of its budget: ${formatRand(c.spentCents)} of ${formatRand(c.allocatedCents)}, ${formatRand(c.remainingCents)} left for ${status.daysToSalary} days.`,
      alsoClaim: reached.slice(0, -1).map((t) => thresholdKey(t, cycle.id, c.categoryId)),
    });
  }
  return alerts;
}

// One paragraph on the cycle that just closed.
export function recap(s: CycleSummary) {
  const over = s.categories
    .filter((c) => c.allocatedCents > 0 && c.remainingCents < 0)
    .sort((a, b) => a.remainingCents - b.remainingCents)
    .slice(0, 3)
    .map((c) => `${escapeMarkdown(c.name)} ${formatRand(-c.remainingCents)} over`);
  const clauses = [
    `Last cycle (${s.cycle.label}): spent ${formatRand(s.spentCents)} against ${formatRand(s.allocatedCents)} budgeted`,
    s.incomeCents > 0 ? `income ${formatRand(s.incomeCents)}, net ${formatRand(s.netCents)}` : null,
    over.length > 0 ? `biggest overspends: ${over.join(', ')}` : null,
    s.uncategorised.count > 0 ? `${s.uncategorised.count} still uncategorised` : null,
  ];
  return `📒 ${clauses.filter(Boolean).join('; ')}.`;
}

