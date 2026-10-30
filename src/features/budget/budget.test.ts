import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cycleContaining, cycleStatus, detectSalaryStarts, type Cycle } from '@/features/cycle/cycle';
import { missingBudgetItems } from './ensure-items';
import { suggestCategory } from './suggest';
import { dateInCycle, summariseCycle } from './summary';
import { deriveTips } from './tips';
import { spendingTrend } from './trend';
import type { BudgetLine, LedgerRow } from './types';

const starts = detectSalaryStarts(
  [
    { transactionId: 's1', occurredOn: '2026-09-30', amountCents: 30_000_00 },
    { transactionId: 's2', occurredOn: '2026-10-30', amountCents: 30_713_54 },
  ],
  { salaryDayHint: 31, expectedSalaryCents: null, tolerancePct: 20 },
);
const october = cycleContaining('2026-10-15', starts, 31); // [09-30, 10-30)
const november = cycleContaining('2026-10-30', starts, 31); // [10-30, 11-30), current

let n = 0;
const row = (occurredOn: string, amountCents: number, categoryId: string | null, kind: LedgerRow['categoryKind'] = 'expense'): LedgerRow => ({
  id: `t${++n}`,
  occurredOn,
  amountCents,
  categoryId,
  categoryKind: categoryId === null ? null : kind,
  categoryName: categoryId,
});

const line = (categoryId: string, expenseType: BudgetLine['expenseType'], allocatedCents: number, over: Partial<BudgetLine> = {}): BudgetLine => ({
  categoryId,
  categoryName: categoryId,
  expenseType,
  allocatedCents,
  expectedDay: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

const lines = [
  line('Groceries', 'dynamic', 4000_00),
  line('Utilities', 'static', 2600_00, { expectedDay: 26 }),
  line('Insurance', 'static', 900_00, { expectedDay: 1 }),
  line('Rent', 'static', 0, { expectedDay: 1 }), // no allocation: never "pending"
  line('Clothing', 'irregular', 1000_00),
];

function summarise(cycle: Cycle, today: string, rows: LedgerRow[], isCurrent = cycle.id === november.id) {
  return summariseCycle({ cycle, status: cycleStatus(cycle, today, isCurrent), today, rows, lines });
}

describe('cycle summary', () => {
  const rows = [
    row('2026-10-30', 30_713_54, 'Salary', 'income'),
    row('2026-10-31', -500_00, 'Groceries'),
    row('2026-11-02', 50_00, 'Groceries'), // refund
    row('2026-10-31', -6000_00, 'Transfer', 'transfer'),
    row('2026-11-01', -1758_86, 'Utilities'),
    row('2026-11-01', 1758_86, 'Utilities'), // the debit order bounced
    row('2026-11-01', -828_99, 'Utilities'),
    row('2026-11-01', -72_00, null),
    row('2026-11-01', 510_00, null),
    row('2026-11-01', -1200_00, 'Clothing', 'expense'),
  ];
  const s = summarise(november, '2026-11-05', rows);

  test('spend per category nets refunds; transfers and uncategorised are left out', () => {
    const by = Object.fromEntries(s.categories.map((c) => [c.categoryId, [c.spentCents, c.remainingCents, c.usedPct]]));
    assert.deepEqual(by.Groceries, [450_00, 3550_00, 11]);
    assert.deepEqual(by.Utilities, [828_99, 1771_01, 32]);
    assert.deepEqual(by.Clothing, [1200_00, -200_00, 120]);
    assert.equal(s.spentCents, 450_00 + 828_99 + 1200_00);
    assert.equal(s.incomeCents, 30_713_54);
    assert.equal(s.netCents, 30_713_54 - s.spentCents);
    assert.deepEqual(s.uncategorised, { count: 2, outCents: 72_00, inCents: 510_00 });
  });

  test('pending debit orders: allocated static items with no money out yet', () => {
    assert.deepEqual(
      s.pendingDebitOrders.map((p) => [p.name, p.expectedOn, p.late]),
      [['Insurance', '2026-11-01', true]],
    );
    assert.equal(s.pendingTotalCents, 900_00);
  });

  test('discretionary left ignores static items and overspending; allowance per day to payday', () => {
    // Groceries 3550 + Clothing max(-200, 0).
    assert.equal(s.discretionaryLeftCents, 3550_00);
    assert.equal(s.status.daysToSalary, 25);
    assert.equal(s.dailyAllowanceCents, 142_00);
  });

  test('an empty cycle has nothing spent and everything left', () => {
    const empty = summarise(november, '2026-10-30', []);
    assert.equal(empty.spentCents, 0);
    assert.equal(empty.discretionaryLeftCents, 5000_00);
    assert.equal(empty.pendingDebitOrders.length, 2);
    assert.equal(empty.dailyAllowanceCents, Math.floor(5000_00 / 31));
  });

  test('a past cycle has no allowance and nothing is late', () => {
    const past = summarise(october, '2026-11-05', [], false);
    assert.equal(past.dailyAllowanceCents, null);
    assert.ok(past.pendingDebitOrders.every((p) => !p.late));
  });

  test('payday with no salary yet: allowance divides by one day, not zero', () => {
    const payday = summarise(november, '2026-11-30', []);
    assert.equal(payday.status.daysToSalary, 0);
    assert.equal(payday.dailyAllowanceCents, 5000_00);
  });

  test('expected day inside the cycle, clamped to the month', () => {
    assert.equal(dateInCycle(november, 26), '2026-11-26');
    assert.equal(dateInCycle(november, 31), '2026-10-31');
    assert.equal(dateInCycle({ start: '2027-01-29', end: '2027-02-26' }, 31), '2027-01-31');
    // 28 Jan is before the start and 28 Feb after the end: this cycle has no 28th.
    assert.equal(dateInCycle({ start: '2027-01-29', end: '2027-02-26' }, 28), null);
  });
});

describe('trend and tips', () => {
  const previous = summarise(october, '2026-11-10', [row('2026-10-01', 30_000_00, 'Salary', 'income'), row('2026-10-05', -2000_00, 'Groceries')], false);
  const current = summarise(november, '2026-11-09', [row('2026-11-01', -1500_00, 'Groceries'), row('2026-11-02', -72_00, null)]);

  test('on pace: dynamic extrapolates, pending static adds its allocation, irregular stays put', () => {
    const t = spendingTrend([previous, current]);
    const groceries = t.categories.find((c) => c.categoryId === 'Groceries')!;
    // 1500 over 11 of 31 days.
    assert.equal(groceries.onPaceCents, Math.round((1500_00 * 31) / 11));
    assert.deepEqual(groceries.spentCents, [2000_00, 1500_00]);
    assert.equal(groceries.averageCents, 2000_00);
    assert.equal(t.categories.find((c) => c.categoryId === 'Utilities')!.onPaceCents, 2600_00);
    assert.equal(t.categories.find((c) => c.categoryId === 'Clothing')!.onPaceCents, 0);
    assert.deepEqual(t.cycles.map((c) => [c.id, c.complete]), [['2026-09-30', true], ['2026-10-30', false]]);
  });

  test('tips are ordered by severity and carry stable codes', () => {
    const tips = deriveTips({ current, previous });
    const codes = tips.map((t) => t.code);
    assert.ok(codes.includes('on_pace_to_overspend'));
    assert.ok(codes.includes('late_debit_orders'));
    assert.ok(codes.includes('uncategorised'));
    assert.ok(codes.includes('savings_rate'));
    assert.deepEqual(
      tips.map((t) => t.severity),
      [...tips.map((t) => t.severity)].sort((a, b) => ['critical', 'warning', 'info'].indexOf(a) - ['critical', 'warning', 'info'].indexOf(b)),
    );
    const savings = tips.find((t) => t.code === 'savings_rate')!;
    assert.equal(savings.data.saved, '28000.00');
  });

  test('salary overdue is the first tip, and there is no daily allowance', () => {
    const late = summarise(november, '2026-12-02', []);
    assert.equal(late.dailyAllowanceCents, null);
    assert.equal(deriveTips({ current: late, previous: null })[0]!.code, 'salary_overdue');
  });

  test('no budgets set', () => {
    const bare = summariseCycle({ cycle: november, status: cycleStatus(november, '2026-11-01', true), today: '2026-11-01', rows: [], lines: [] });
    assert.deepEqual(deriveTips({ current: bare, previous: null }).map((t) => t.code), ['budgets_not_set']);
  });
});

describe('budget items', () => {
  test('missing items are created from the category type, and a second run adds none', () => {
    const categories = [
      { id: 'a', expenseType: 'static' as const, sortOrder: 2 },
      { id: 'b', expenseType: null, sortOrder: 5 },
    ];
    const first = missingBudgetItems(categories, new Set());
    assert.deepEqual(first, [
      { categoryId: 'a', expenseType: 'static', sortOrder: 2 },
      { categoryId: 'b', expenseType: 'dynamic', sortOrder: 5 },
    ]);
    assert.deepEqual(missingBudgetItems(categories, new Set(first.map((i) => i.categoryId))), []);
  });
});

describe('category suggestions', () => {
  const known = [
    { descriptionNormalised: 'CORNER SHOP - SUBURB', categoryId: 'groceries' },
    { descriptionNormalised: 'BP O REILLY MERRY BENONI', categoryId: 'petrol' },
    { descriptionNormalised: 'MACAU CUISINE NORTHMEA', categoryId: 'eating-out' },
  ];

  test('borrows from the description sharing the most leading words', () => {
    assert.deepEqual(suggestCategory('CORNER SHOP - ELSEWHERE', known), {
      categoryId: 'groceries',
      basedOn: 'CORNER SHOP - SUBURB',
      sharedWords: 2,
    });
    assert.equal(suggestCategory('MACAU CUISINE ROSEBANK', known)?.categoryId, 'eating-out');
  });

  test('one short shared word is not enough', () => {
    assert.equal(suggestCategory('BP SOMEWHERE ELSE', known), null);
    assert.equal(suggestCategory('NOTHING ALIKE', known), null);
  });
});
