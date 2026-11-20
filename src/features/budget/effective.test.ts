import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUDGET_EPOCH, effectiveLines, scheduledChanges, versionToExtend } from './effective';
import type { BudgetLineVersion } from './types';

const version = (categoryId: string, effectiveFrom: string, allocatedCents: number, over: Partial<BudgetLineVersion> = {}): BudgetLineVersion => ({
  categoryId,
  categoryName: categoryId,
  categoryEmoji: null,
  effectiveFrom,
  expenseType: 'dynamic',
  allocatedCents,
  expectedDay: null,
  isActive: true,
  sortOrder: 0,
  isSavings: false,
  ...over,
});

// October's cycle started on the 30th of September, November's on the 30th of October.
const OCT = '2026-09-30';
const NOV = '2026-10-30';
const DEC = '2026-11-30';

describe('effective budget lines', () => {
  test('a cycle reads the newest version dated on or before its start', () => {
    const versions = [version('tfsa', BUDGET_EPOCH, 0), version('tfsa', NOV, 3_000_00), version('tfsa', DEC, 4_000_00)];

    assert.equal(effectiveLines(versions, OCT)[0]!.allocatedCents, 0);
    assert.equal(effectiveLines(versions, NOV)[0]!.allocatedCents, 3_000_00);
    assert.equal(effectiveLines(versions, DEC)[0]!.allocatedCents, 4_000_00);
  });

  test('a change dated past a cycle leaves it alone, however many are queued', () => {
    const versions = [version('ra', BUDGET_EPOCH, 500_00), version('ra', DEC, 1_000_00)];

    assert.equal(effectiveLines(versions, NOV)[0]!.allocatedCents, 500_00);
    assert.deepEqual(
      scheduledChanges(versions, NOV).map((v) => [v.categoryId, v.effectiveFrom, v.allocatedCents]),
      [['ra', DEC, 1_000_00]],
    );
    assert.deepEqual(scheduledChanges(versions, DEC), []);
  });

  test('a category with nothing in force yet is left out rather than counted at zero', () => {
    const versions = [version('new', DEC, 2_000_00)];

    assert.deepEqual(effectiveLines(versions, NOV), []);
    assert.equal(effectiveLines(versions, DEC).length, 1);
  });

  test('lines come back in the order the budget is shown in', () => {
    const versions = [
      version('b', BUDGET_EPOCH, 1, { categoryName: 'Bills', sortOrder: 2 }),
      version('a', BUDGET_EPOCH, 1, { categoryName: 'Airtime', sortOrder: 2 }),
      version('f', BUDGET_EPOCH, 1, { categoryName: 'Fuel', sortOrder: 1 }),
    ];

    assert.deepEqual(
      effectiveLines(versions, NOV).map((l) => l.categoryName),
      ['Fuel', 'Airtime', 'Bills'],
    );
  });

  test('a new version is built on the one in force then, not the newest of all', () => {
    const versions = [version('tfsa', BUDGET_EPOCH, 0, { expectedDay: 1 }), version('tfsa', DEC, 4_000_00, { expectedDay: 25 })];

    assert.equal(versionToExtend(versions, 'tfsa', NOV)!.expectedDay, 1);
    assert.equal(versionToExtend(versions, 'tfsa', DEC)!.expectedDay, 25);
    // Nothing in force yet: the earliest later version stands in, so its type and day carry over.
    assert.equal(versionToExtend([version('new', DEC, 1)], 'new', NOV)!.effectiveFrom, DEC);
    assert.equal(versionToExtend(versions, 'missing', NOV), undefined);
  });
});
