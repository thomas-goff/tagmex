import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createBudgetService } from './service';
import { DEFAULT_SETTINGS, type BudgetLine, type LedgerRow } from './types';

const lines: BudgetLine[] = [
  { categoryId: 'g', categoryName: 'Groceries', categoryEmoji: null, expenseType: 'dynamic', allocatedCents: 4000_00, expectedDay: null, isActive: true, sortOrder: 0, isSavings: false },
];
const rows: LedgerRow[] = [
  { id: 'a', occurredOn: '2026-10-08', amountCents: -400_00, categoryId: 'g', categoryKind: 'expense', categoryName: 'Groceries', categoryEmoji: null, categoryIsSavings: false },
  { id: 's', occurredOn: '2026-10-30', amountCents: 30_000_00, categoryId: 'sal', categoryKind: 'income', categoryName: 'Salary', categoryEmoji: null, categoryIsSavings: false },
  { id: 'b', occurredOn: '2026-11-03', amountCents: -2700_00, categoryId: 'g', categoryKind: 'expense', categoryName: 'Groceries', categoryEmoji: null, categoryIsSavings: false },
];

// A ledger that starts on 8 October: part-way through the cycle before the first salary.
function service(firstTransactionOn: string | null = '2026-10-08') {
  return createBudgetService({
    now: () => new Date('2026-11-13T10:00:00Z'),
    repo: {
      getSettings: async () => DEFAULT_SETTINGS,
      listSalaryCredits: async () => [{ transactionId: 's', occurredOn: '2026-10-30', amountCents: 30_000_00 }],
      firstTransactionDate: async () => firstTransactionOn,
      ensureBudgetItems: async () => 0,
      listBudgetLines: async () => lines,
      listLedgerRows: async (_userId, from, to) => rows.filter((r) => r.occurredOn >= from && r.occurredOn < to),
    },
  });
}

describe('budget service', () => {
  test('the trend never goes back past the first transaction, and marks the cycle it began in', async () => {
    const t = await service().trend('owner', 6);
    // Six were asked for; September and earlier ended before anything was recorded.
    assert.deepEqual(t.cycles.map((c) => [c.label, c.partial, c.complete]), [['October 2026', true, true], ['November 2026', false, false]]);
    assert.equal(t.averageCompletedCents, null);
  });

  test('with full history, cycles are whole and averaged', async () => {
    const t = await service('2026-06-01').trend('owner', 2);
    assert.deepEqual(t.cycles.map((c) => c.partial), [false, false, false]);
    assert.equal(t.averageCompletedCents, 200_00);
  });

  test('an empty ledger has only the current cycle', async () => {
    assert.equal((await service(null).trend('owner', 3)).cycles.length, 1);
  });

  test('the overview compares against the last cycle only when it was tracked in full', async () => {
    const partWay = await service().overview('owner');
    assert.equal(partWay.previous.hasFullData, false);
    assert.equal(partWay.summary.hasFullData, true);
    assert.ok(!partWay.tips.some((t) => t.code === 'spend_vs_last_cycle'));

    const whole = await service('2026-06-01').overview('owner');
    assert.equal(whole.previous.hasFullData, true);
    assert.ok(whole.tips.some((t) => t.code === 'spend_vs_last_cycle'));
  });
});
