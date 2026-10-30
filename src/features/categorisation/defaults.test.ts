import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { categorise } from './categorise';
import { DEFAULT_CATEGORIES, DEFAULT_MERCHANT_RULES } from './defaults';
import { tokenise } from './rule-matchers';
import type { CategoryRule } from './types';

// The seeds as the categoriser will see them, with the category name standing in for its id.
const seededRules: CategoryRule[] = DEFAULT_MERCHANT_RULES.map((r, i) => ({
  id: String(i),
  matchType: 'token',
  pattern: r.pattern,
  categoryId: r.category,
  origin: 'seed',
}));

const categoryOf = (descriptionNormalised: string) =>
  categorise(
    { descriptionNormalised, amountCents: -100, occurredOn: '2026-11-01', accountLast4: '1234' },
    { rules: seededRules, transferCategoryId: null, transferCandidates: [] },
  ).categoryId;

describe('default seeds', () => {
  test('every pattern is upper case and has words to match', () => {
    for (const { pattern } of DEFAULT_MERCHANT_RULES) {
      assert.equal(pattern, pattern.toUpperCase());
      assert.ok(tokenise(pattern).length > 0, pattern);
    }
  });

  test('no pattern is seeded twice', () => {
    const patterns = DEFAULT_MERCHANT_RULES.map((r) => tokenise(r.pattern).join(' '));
    assert.equal(new Set(patterns).size, patterns.length);
  });

  test('exactly one system category per kind, so lookups by kind are unambiguous', () => {
    const systemKinds = DEFAULT_CATEGORIES.filter((c) => c.isSystem).map((c) => c.kind);
    assert.deepEqual([...systemKinds].sort(), ['income', 'transfer']);
  });

  test('only expense categories have an expense type', () => {
    for (const c of DEFAULT_CATEGORIES) assert.equal(c.expenseType === null, c.kind !== 'expense', c.name);
  });

  test('categorise common merchants', () => {
    assert.equal(categoryOf('WOOLWORTHS SANDTON'), 'Groceries');
    assert.equal(categoryOf("PICK 'N PAY FAMILY"), 'Groceries');
    assert.equal(categoryOf('BP CONSTANTIA'), 'Petrol');
    assert.equal(categoryOf('UBER *EATS'), 'Eating Out');
    assert.equal(categoryOf('UBER *TRIP'), 'Transport');
    assert.equal(categoryOf('APPLE.COM/BILL'), 'Subscriptions');
    assert.equal(categoryOf('GOOGLE YOUTUBEPREMIUM LONDON'), 'Subscriptions');
    assert.equal(categoryOf('GOOGLE ONE LONDON'), 'Subscriptions');
    assert.equal(categoryOf('DIS-CHEM CANAL WALK'), 'Medical');
    assert.equal(categoryOf('SALARY'), 'Income');
  });

  test('leave look-alikes uncategorised', () => {
    for (const d of ['BPA HOLDINGS', 'SHELLEY BEAUTY', 'SPARK SCHOOLS', 'TOTALSPORTS', 'APPLE STORE', 'BOLTON HARDWARE', 'GOOGLE CLOUD', 'ONE GOOGLE']) {
      assert.equal(categoryOf(d), null, d);
    }
  });
});
