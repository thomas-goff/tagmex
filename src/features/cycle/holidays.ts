import { addDays, dayOfWeek, isoDate } from './dates';

// South African public holidays, computed from the Public Holidays Act rather than kept as a yearly
// list, so it never goes stale: the fixed dates, Good Friday and Family Day (from Easter), and the
// rule that a holiday falling on a Sunday makes the Monday a holiday too.

const FIXED: readonly [month: number, day: number][] = [
  [1, 1], // New Year's Day
  [3, 21], // Human Rights Day
  [4, 27], // Freedom Day
  [5, 1], // Workers' Day
  [6, 16], // Youth Day
  [8, 9], // National Women's Day
  [9, 24], // Heritage Day
  [12, 16], // Day of Reconciliation
  [12, 25], // Christmas Day
  [12, 26], // Day of Goodwill
];

// One-off days the President declares (elections, special occasions). Add them as they're gazetted.
export const DECLARED_HOLIDAYS: readonly string[] = [
  '2024-05-29', // general election
];

// Gregorian Easter Sunday (Anonymous / Meeus algorithm).
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

const cache = new Map<number, Set<string>>();

export function saPublicHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const days = new Set<string>();
  for (const [m, d] of FIXED) {
    const date = isoDate(year, m, d);
    days.add(date);
    if (dayOfWeek(date) === 0) days.add(addDays(date, 1));
  }
  const easter = easterSunday(year);
  days.add(addDays(easter, -2)); // Good Friday
  days.add(addDays(easter, 1)); // Family Day
  for (const date of DECLARED_HOLIDAYS) if (date.startsWith(`${year}-`)) days.add(date);

  cache.set(year, days);
  return days;
}

export function isBusinessDay(iso: string) {
  const dow = dayOfWeek(iso);
  return dow !== 0 && dow !== 6 && !saPublicHolidays(Number(iso.slice(0, 4))).has(iso);
}

// The date itself when it's a business day, otherwise the last business day before it. Employers
// pay early, never late, when payday falls on a weekend or holiday.
export function onOrBeforeBusinessDay(iso: string) {
  let date = iso;
  while (!isBusinessDay(date)) date = addDays(date, -1);
  return date;
}
