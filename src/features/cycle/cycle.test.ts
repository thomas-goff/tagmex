import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cycleContaining,
  cycleStatus,
  detectSalaryStarts,
  nextProjectedSalary,
  previousCycle,
  projectedSalaryDate,
  withinTolerance,
  type SalaryConfig,
  type SalaryCredit,
} from './cycle';
import { addDays, daysBetween, hourIn, todayIn } from './dates';
import { easterSunday, isBusinessDay, onOrBeforeBusinessDay, saPublicHolidays } from './holidays';

const anyAmount: SalaryConfig = { salaryDayHint: 31, expectedSalaryCents: null, tolerancePct: 20 };
const credit = (occurredOn: string, amountCents = 30_713_54, id = occurredOn): SalaryCredit => ({
  transactionId: id,
  occurredOn,
  amountCents,
});

describe('dates', () => {
  test('today is the SAST date, not the UTC one', () => {
    // 22:30 UTC on 31 Oct is 00:30 on 1 Nov in Johannesburg (UTC+2, no DST).
    assert.equal(todayIn('Africa/Johannesburg', new Date('2026-10-31T22:30:00Z')), '2026-11-01');
    assert.equal(todayIn('Africa/Johannesburg', new Date('2026-10-31T21:59:00Z')), '2026-10-31');
    assert.equal(hourIn('Africa/Johannesburg', new Date('2026-10-31T05:00:00Z')), 7);
  });

  test('day arithmetic across month and year ends', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
    assert.equal(daysBetween('2026-10-30', '2026-11-30'), 31);
  });
});

describe('SA public holidays', () => {
  test('2026, including Easter and a Sunday holiday moving to Monday', () => {
    assert.equal(easterSunday(2026), '2026-04-05');
    assert.deepEqual([...saPublicHolidays(2026)].sort(), [
      '2026-01-01',
      '2026-03-21',
      '2026-04-03', // Good Friday
      '2026-04-06', // Family Day
      '2026-04-27',
      '2026-05-01',
      '2026-06-16',
      '2026-08-09',
      '2026-08-10', // Women's Day is a Sunday
      '2026-09-24',
      '2026-12-16',
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  test('2027 Easter falls in March, and 21 March and 26 December are Sundays', () => {
    const days = saPublicHolidays(2027);
    for (const d of ['2027-03-22', '2027-03-26', '2027-03-29', '2027-12-27']) assert.ok(days.has(d), d);
  });

  test('payday rolls back over weekends and holidays', () => {
    assert.equal(isBusinessDay('2026-10-30'), true); // Friday
    assert.equal(onOrBeforeBusinessDay('2026-10-31'), '2026-10-30'); // Sat → Fri
    assert.equal(onOrBeforeBusinessDay('2026-04-06'), '2026-04-02'); // Family Day → Good Friday → Thu
    assert.equal(onOrBeforeBusinessDay('2026-12-26'), '2026-12-24'); // Sat, Christmas Fri → Thu
  });
});

describe('salary projection', () => {
  test('day 31 clamps to short months', () => {
    assert.equal(projectedSalaryDate(2026, 11, 31), '2026-11-30'); // Mon
    assert.equal(projectedSalaryDate(2027, 2, 31), '2027-02-26'); // 28th is a Sunday → Fri 26th
    assert.equal(projectedSalaryDate(2028, 2, 31), '2028-02-29'); // leap year, Tue
  });

  test('a salary paid early still projects to the next month', () => {
    assert.equal(nextProjectedSalary('2026-10-30', 31), '2026-11-30');
  });

  test('across the year boundary', () => {
    assert.equal(nextProjectedSalary('2026-12-31', 31), '2027-01-29'); // 31 Jan 2027 is a Sunday
    // Payday the 1st: 1 Jan is a holiday, so January's salary lands on 31 Dec; next is 1 Feb.
    assert.equal(projectedSalaryDate(2027, 1, 1), '2026-12-31');
    assert.equal(nextProjectedSalary('2026-12-31', 1), '2027-02-01');
  });
});

describe('salary detection', () => {
  test('a second salary-like credit in the same cycle is income, not a new cycle', () => {
    const starts = detectSalaryStarts(
      [credit('2026-10-30'), credit('2026-11-10', 5_000_00, 'bonus'), credit('2026-11-30')],
      anyAmount,
    );
    assert.deepEqual(starts.map((s) => s.occurredOn), ['2026-10-30', '2026-11-30']);
  });

  test('the expected amount and tolerance filter out unusual credits', () => {
    const config = { ...anyAmount, expectedSalaryCents: 30_000_00, tolerancePct: 20 };
    assert.equal(withinTolerance(24_000_00, config), true);
    assert.equal(withinTolerance(23_999_99, config), false);
    assert.equal(withinTolerance(36_000_00, config), true);
    assert.equal(withinTolerance(-30_000_00, anyAmount), false);
    const starts = detectSalaryStarts([credit('2026-10-15', 3_000_00, 'refund'), credit('2026-10-30')], config);
    assert.deepEqual(starts.map((s) => s.transactionId), ['2026-10-30']);
  });
});

describe('cycles', () => {
  const starts = detectSalaryStarts([credit('2026-09-30'), credit('2026-10-30')], anyAmount);

  test('a cycle runs from one actual salary to the next, labelled by the month it ends in', () => {
    const c = cycleContaining('2026-10-15', starts, 31);
    assert.deepEqual(
      { id: c.id, end: c.end, projected: c.endIsProjected, label: c.label },
      { id: '2026-09-30', end: '2026-10-30', projected: false, label: 'October 2026' },
    );
  });

  test('the salary date itself opens the new cycle; the current one ends at the projection', () => {
    const c = cycleContaining('2026-10-30', starts, 31);
    assert.deepEqual(
      { id: c.id, end: c.end, projected: c.endIsProjected, label: c.label, salary: c.salary?.transactionId },
      { id: '2026-10-30', end: '2026-11-30', projected: true, label: 'November 2026', salary: '2026-10-30' },
    );
  });

  test('a salary paid early (Friday before a weekend) starts the cycle that day', () => {
    // Nov projected for Mon 30th but paid Fri 27th: October's cycle ends on the real date.
    const early = detectSalaryStarts([credit('2026-10-30'), credit('2026-11-27')], anyAmount);
    assert.equal(cycleContaining('2026-11-27', early, 31).id, '2026-11-27');
    assert.equal(cycleContaining('2026-11-26', early, 31).end, '2026-11-27');
  });

  test('a cycle spanning the new year', () => {
    const s = detectSalaryStarts([credit('2026-12-24'), credit('2027-01-29')], anyAmount);
    const c = cycleContaining('2027-01-01', s, 31);
    assert.deepEqual([c.id, c.end, c.label], ['2026-12-24', '2027-01-29', 'January 2027']);
  });

  test('before any salary: projected boundaries, ending at the first real salary', () => {
    const c = cycleContaining('2026-10-22', starts.slice(1), 31);
    assert.deepEqual([c.id, c.end, c.endIsProjected, c.salary], ['2026-09-30', '2026-10-30', false, null]);
    const none = cycleContaining('2026-10-22', [], 31);
    assert.deepEqual([none.id, none.end, none.endIsProjected], ['2026-09-30', '2026-10-30', true]);
  });

  test('previous cycle walks back without gaps', () => {
    const c = cycleContaining('2026-11-05', starts, 31);
    const prev = previousCycle(c, starts, 31);
    const prevPrev = previousCycle(prev, starts, 31);
    assert.deepEqual([prev.id, prev.end], ['2026-09-30', '2026-10-30']);
    assert.deepEqual([prevPrev.id, prevPrev.end], ['2026-08-31', '2026-09-30']);
  });

  test('status: days to salary, and overdue once payday passes with no salary', () => {
    const c = cycleContaining('2026-10-31', starts, 31);
    assert.deepEqual(cycleStatus(c, '2026-10-31', true), {
      isCurrent: true,
      daysToSalary: 30,
      daysElapsed: 2,
      daysTotal: 31,
      salaryOverdue: false,
    });
    assert.equal(cycleStatus(c, '2026-11-30', true).salaryOverdue, false); // payday itself
    const late = cycleContaining('2026-12-02', starts, 31);
    assert.equal(late.id, '2026-10-30'); // stays open
    assert.deepEqual(
      [cycleStatus(late, '2026-12-02', true).salaryOverdue, cycleStatus(late, '2026-12-02', true).daysToSalary],
      [true, 0],
    );
    assert.equal(cycleStatus(c, '2026-12-02', false).daysToSalary, null);
  });
});
