import { addDays, daysBetween, daysInMonth, isoDate, monthName, normaliseMonth, parts } from './dates';
import { onOrBeforeBusinessDay } from './holidays';

// The budget runs from one salary to the next, not by calendar month.
//
// A cycle is [start, end): `start` is the date the salary credit landed and `end` the date the next
// one did (or, for the current cycle, is projected to). A cycle's id is its start date, which never
// changes once the salary has landed. Its label is the calendar month it ends in ("November 2026"
// starts late October) and is for display only, never a key.
//
// Before the first salary in the ledger (a new user, or history from before phase 1) cycles fall
// back to projected salary dates, so every date belongs to exactly one cycle.

// A salary-like credit this soon after a cycle opened is a bonus or back-pay: income, not a new cycle.
export const MIN_CYCLE_DAYS = 20;

export interface SalaryConfig {
  // Day of the month salary is due, 1-31.
  salaryDayHint: number;
  // Null = any credit in a salary category counts.
  expectedSalaryCents: number | null;
  // How far from expectedSalaryCents a credit may be, in percent.
  tolerancePct: number;
}

// A credit in a salary category. The caller picks these out of the ledger.
export interface SalaryCredit {
  transactionId: string;
  occurredOn: string;
  amountCents: number;
}

export interface Cycle {
  id: string;
  start: string;
  // Exclusive.
  end: string;
  // True until the next salary actually lands.
  endIsProjected: boolean;
  // The credit that opened the cycle; null for a cycle from projected dates.
  salary: SalaryCredit | null;
  label: string;
}

export function withinTolerance(amountCents: number, { expectedSalaryCents, tolerancePct }: SalaryConfig) {
  if (amountCents <= 0) return false;
  if (expectedSalaryCents === null) return true;
  return Math.abs(amountCents - expectedSalaryCents) * 100 <= expectedSalaryCents * tolerancePct;
}

// The credits that open a cycle, oldest first: within tolerance, and at least MIN_CYCLE_DAYS after
// the previous one. So of two salary-like credits in one cycle only the first opens it.
export function detectSalaryStarts(credits: readonly SalaryCredit[], config: SalaryConfig) {
  const sorted = [...credits].sort(
    (a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId),
  );
  const starts: SalaryCredit[] = [];
  for (const credit of sorted) {
    if (!withinTolerance(credit.amountCents, config)) continue;
    const previous = starts.at(-1);
    if (previous && daysBetween(previous.occurredOn, credit.occurredOn) < MIN_CYCLE_DAYS) continue;
    starts.push(credit);
  }
  return starts;
}

// Payday in a given month: the hint day, clamped to the month's length (31 → 30 Nov, 28 Feb), then
// moved back to the previous business day for weekends and public holidays.
export function projectedSalaryDate(year: number, month: number, salaryDayHint: number) {
  return onOrBeforeBusinessDay(isoDate(year, month, Math.min(salaryDayHint, daysInMonth(year, month))));
}

// The first projected payday at least MIN_CYCLE_DAYS after `start`. Counting from the real start
// rather than the month means an early payment (Fri 30 Oct for the 31st) still projects to the next
// month, and a December salary paid on 31 Dec for 1 Jan projects to 1 Feb.
export function nextProjectedSalary(start: string, salaryDayHint: number) {
  const { year, month } = parts(start);
  for (let offset = 0; ; offset++) {
    const m = normaliseMonth(year, month + offset);
    const candidate = projectedSalaryDate(m.year, m.month, salaryDayHint);
    if (daysBetween(start, candidate) >= MIN_CYCLE_DAYS) return candidate;
  }
}

// The last projected payday on or before `date`.
export function previousProjectedSalary(date: string, salaryDayHint: number) {
  const { year, month } = parts(date);
  for (let offset = 0; ; offset--) {
    const m = normaliseMonth(year, month + offset);
    const candidate = projectedSalaryDate(m.year, m.month, salaryDayHint);
    if (candidate <= date) return candidate;
  }
}

export function cycleLabel(end: string) {
  const { year, month } = parts(addDays(end, -1));
  return `${monthName(month)} ${year}`;
}

function cycle(start: string, end: string, endIsProjected: boolean, salary: SalaryCredit | null): Cycle {
  return { id: start, start, end, endIsProjected, salary, label: cycleLabel(end) };
}

// The cycle `date` falls in. `starts` comes from detectSalaryStarts. When the next salary is late,
// the current cycle simply stays open past its projected end.
export function cycleContaining(date: string, starts: readonly SalaryCredit[], salaryDayHint: number): Cycle {
  let index = -1;
  for (let i = 0; i < starts.length && starts[i]!.occurredOn <= date; i++) index = i;

  if (index === -1) {
    const start = previousProjectedSalary(date, salaryDayHint);
    const projectedEnd = nextProjectedSalary(start, salaryDayHint);
    const first = starts[0]?.occurredOn;
    return first && first <= projectedEnd ? cycle(start, first, false, null) : cycle(start, projectedEnd, true, null);
  }

  const salary = starts[index]!;
  const next = starts[index + 1];
  return next
    ? cycle(salary.occurredOn, next.occurredOn, false, salary)
    : cycle(salary.occurredOn, nextProjectedSalary(salary.occurredOn, salaryDayHint), true, salary);
}

// The cycle before this one.
export function previousCycle(c: Cycle, starts: readonly SalaryCredit[], salaryDayHint: number) {
  return cycleContaining(addDays(c.start, -1), starts, salaryDayHint);
}

export interface CycleStatus {
  isCurrent: boolean;
  // Current cycle only: days until the (projected) next salary; 0 on payday and once it's overdue.
  daysToSalary: number | null;
  // Days of the cycle so far, today included; the whole cycle once it's over.
  daysElapsed: number;
  daysTotal: number;
  // The current cycle has passed its projected end with no salary.
  salaryOverdue: boolean;
}

export function cycleStatus(c: Cycle, today: string, isCurrent: boolean): CycleStatus {
  const daysTotal = Math.max(daysBetween(c.start, c.end), 1);
  if (!isCurrent) return { isCurrent, daysToSalary: null, daysElapsed: daysTotal, daysTotal, salaryOverdue: false };
  return {
    isCurrent,
    daysToSalary: Math.max(daysBetween(today, c.end), 0),
    daysElapsed: Math.min(Math.max(daysBetween(c.start, today) + 1, 1), daysTotal),
    daysTotal,
    // Not on payday itself: the salary email may simply not have arrived yet.
    salaryOverdue: c.endIsProjected && c.salary !== null && today > c.end,
  };
}
