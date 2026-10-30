// Calendar dates as 'YYYY-MM-DD' strings. Transactions carry a date with no time (the bank sends
// none), so all cycle maths is on dates; the only time zone question is what "today" is, answered
// once by todayIn. Arithmetic runs in UTC, where every day has 24 hours.

const DAY_MS = 86_400_000;

function toUtc(iso: string) {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fromUtc(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number) {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

// Whole days from a to b: positive when b is later.
export function daysBetween(a: string, b: string) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

// 0 = Sunday … 6 = Saturday.
export function dayOfWeek(iso: string) {
  return new Date(toUtc(iso)).getUTCDay();
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}

// `month` may run past 12 or below 1; it carries into the year.
export function normaliseMonth(year: number, month: number) {
  const index = year * 12 + (month - 1);
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

// The calendar date in `timeZone` at instant `now`. 23:30 UTC is already tomorrow in Johannesburg.
export function todayIn(timeZone: string, now: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(now);
}

// The hour (0-23) in `timeZone` at instant `now`.
export function hourIn(timeZone: string, now: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  return Number(fmt.format(now));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthName(month: number) {
  return MONTHS[month - 1]!;
}
