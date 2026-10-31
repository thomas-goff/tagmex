import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CategoryRule, CategorySource } from '@/features/categorisation/types';
import { applyRulesToUncategorised } from './apply-rules';
import type { CategoryAssignment, Stores } from './ports';

interface Row {
  id: string;
  descriptionNormalised: string;
  amountCents: number;
  categorySource: CategorySource;
  categoryId: string | null;
  ruleId?: string | null;
}

function fakeStores(rows: Row[], rules: CategoryRule[]) {
  return {
    categories: { listRules: async () => rules },
    transactions: {
      listUncategorised: async () => rows.filter((r) => r.categorySource === 'none'),
      async categoriseIfUncategorised(_userId: string, ids: string[], c: CategoryAssignment) {
        const hits = rows.filter((r) => ids.includes(r.id) && r.categorySource === 'none');
        hits.forEach((r) => Object.assign(r, { categoryId: c.categoryId, categorySource: c.source, ruleId: c.ruleId }));
        return hits.length;
      },
    },
  } as unknown as Stores;
}

const rule = (id: string, pattern: string, over: Partial<CategoryRule> = {}): CategoryRule => ({
  id,
  pattern,
  matchType: 'token',
  categoryId: `cat-${id}`,
  origin: 'seed',
  direction: null,
  ...over,
});

const row = (
  id: string,
  descriptionNormalised: string,
  categorySource: CategorySource = 'none',
  amountCents = -100,
): Row => ({
  id,
  descriptionNormalised,
  amountCents,
  categorySource,
  categoryId: categorySource === 'none' ? null : 'cat-earlier',
});

describe('applyRulesToUncategorised', () => {
  test('categorises uncategorised rows that a rule now matches', async () => {
    const rows = [row('t1', 'GOOGLE ONE LONDON'), row('t2', 'GOOGLE ONE LONDON'), row('t3', 'CORNER SHOP')];
    const count = await applyRulesToUncategorised(fakeStores(rows, [rule('one', 'GOOGLE ONE')]), 'owner');

    assert.equal(count, 2);
    assert.deepEqual(
      rows.map((r) => [r.id, r.categorySource, r.ruleId ?? null]),
      [
        ['t1', 'merchant_rule', 'one'],
        ['t2', 'merchant_rule', 'one'],
        ['t3', 'none', null],
      ],
    );
  });

  test('uses the same priority as categorise: learned exact, then the most specific token rule', async () => {
    const rows = [row('t1', 'UBER EATS'), row('t2', 'UBER TRIP')];
    const rules = [
      rule('uber', 'UBER'),
      rule('eats', 'UBER EATS'),
      rule('mine', 'UBER TRIP', { matchType: 'exact', origin: 'learned' }),
    ];
    await applyRulesToUncategorised(fakeStores(rows, rules), 'owner');
    assert.deepEqual(
      rows.map((r) => [r.id, r.categorySource, r.ruleId]),
      [
        ['t1', 'merchant_rule', 'eats'],
        ['t2', 'user_rule', 'mine'],
      ],
    );
  });

  test("skips rows moving money the other way from a rule's direction", async () => {
    const rows = [row('out', 'ABSA BANK SAVINGS', 'none', -200_000), row('in', 'ABSA BANK SAVINGS', 'none', 200_000)];
    const rules = [rule('savings', 'ABSA BANK SAVINGS', { matchType: 'exact', origin: 'learned', direction: 'out' })];
    const count = await applyRulesToUncategorised(fakeStores(rows, rules), 'owner');
    assert.equal(count, 1);
    assert.deepEqual(
      rows.map((r) => [r.id, r.categorySource]),
      [
        ['out', 'user_rule'],
        ['in', 'none'],
      ],
    );
  });

  test('never touches rows that are already categorised', async () => {
    const rows = [row('t1', 'GOOGLE ONE LONDON', 'manual')];
    const count = await applyRulesToUncategorised(fakeStores(rows, [rule('one', 'GOOGLE ONE')]), 'owner');
    assert.equal(count, 0);
    assert.equal(rows[0]!.categoryId, 'cat-earlier');
  });
});
