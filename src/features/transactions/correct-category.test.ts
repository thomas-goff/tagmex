import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Category, CategoryRule, CategorySource } from '@/features/categorisation/types';
import { NotFoundError, createCategoryCorrector } from './correct-category';
import type { CategoryAssignment, Stores, StoredTransaction } from './ports';

const USER = 'owner';

function row(id: string, descriptionNormalised: string, categorySource: CategorySource = 'none'): StoredTransaction {
  return {
    id,
    descriptionNormalised,
    categorySource,
    categoryId: categorySource === 'none' ? null : 'cat-earlier',
    occurredOn: '2026-11-01',
    amountCents: -100,
    accountLast4: '1234',
  };
}

// Just enough of the stores for the corrector, held in memory.
function fakeStores(rows: StoredTransaction[], categories: Category[]) {
  const rules: CategoryRule[] = [];
  const assign = (r: StoredTransaction, c: CategoryAssignment) =>
    Object.assign(r, { categoryId: c.categoryId, categorySource: c.source });

  const stores = {
    transactions: {
      async findById(_userId: string, id: string) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async setCategory(_userId: string, id: string, c: CategoryAssignment) {
        assign(rows.find((r) => r.id === id)!, c);
      },
      async listUncategorised() {
        return rows.filter((r) => r.categorySource === 'none');
      },
      async categoriseIfUncategorised(_userId: string, ids: string[], c: CategoryAssignment) {
        const hits = rows.filter((r) => ids.includes(r.id) && r.categorySource === 'none');
        hits.forEach((r) => assign(r, c));
        return hits.length;
      },
    },
    categories: {
      async listCategories() {
        return categories;
      },
      async upsertRule(_userId: string, rule: Omit<CategoryRule, 'id'>) {
        const existing = rules.find((r) => r.matchType === rule.matchType && r.pattern === rule.pattern);
        if (existing) return Object.assign(existing, rule);
        const created = { id: `rule-${rules.length + 1}`, ...rule };
        rules.push(created);
        return created;
      },
    },
  } as unknown as Stores;

  return { stores, rules, unitOfWork: <T>(work: (s: Stores) => Promise<T>) => work(stores) };
}

const groceries: Category = { id: 'cat-groceries', name: 'Groceries', kind: 'expense', isSystem: false };

describe('correct category', () => {
  test('sets the category by hand and learns an exact rule for the description', async () => {
    const rows = [row('t1', 'CORNER SHOP - SUBURB')];
    const { stores, unitOfWork, rules } = fakeStores(rows, [groceries]);
    const result = await createCategoryCorrector({ stores, unitOfWork }).correct({
      userId: USER,
      transactionId: 't1',
      categoryId: 'cat-groceries',
    });

    assert.equal(rows[0]!.categorySource, 'manual');
    assert.equal(rows[0]!.categoryId, 'cat-groceries');
    assert.deepEqual(rules, [
      { id: 'rule-1', matchType: 'exact', pattern: 'CORNER SHOP - SUBURB', categoryId: 'cat-groceries', origin: 'learned' },
    ]);
    assert.equal(result.ruleId, 'rule-1');
  });

  test('applies the rule to matching uncategorised transactions only', async () => {
    const rows = [
      row('t1', 'CORNER SHOP - SUBURB'),
      row('t2', 'CORNER SHOP - SUBURB'),
      row('t3', 'CORNER SHOP - SUBURB', 'manual'),
      row('t4', 'CORNER SHOP - SUBURB', 'merchant_rule'),
      row('t5', 'CORNER SHOP - ELSEWHERE'),
    ];
    const { stores, unitOfWork } = fakeStores(rows, [groceries]);
    const result = await createCategoryCorrector({ stores, unitOfWork }).correct({
      userId: USER,
      transactionId: 't1',
      categoryId: 'cat-groceries',
    });

    assert.equal(result.appliedTo, 1);
    assert.deepEqual(
      rows.map((r) => [r.id, r.categorySource, r.categoryId]),
      [
        ['t1', 'manual', 'cat-groceries'],
        ['t2', 'user_rule', 'cat-groceries'],
        ['t3', 'manual', 'cat-earlier'],
        ['t4', 'merchant_rule', 'cat-earlier'],
        ['t5', 'none', null],
      ],
    );
  });

  test('correcting again re-points the same learned rule', async () => {
    const other: Category = { id: 'cat-other', name: 'Eating Out', kind: 'expense', isSystem: false };
    const rows = [row('t1', 'CORNER SHOP')];
    const { stores, unitOfWork, rules } = fakeStores(rows, [groceries, other]);
    const corrector = createCategoryCorrector({ stores, unitOfWork });
    await corrector.correct({ userId: USER, transactionId: 't1', categoryId: 'cat-groceries' });
    await corrector.correct({ userId: USER, transactionId: 't1', categoryId: 'cat-other' });

    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.categoryId, 'cat-other');
    assert.equal(rows[0]!.categoryId, 'cat-other');
  });

  test('rejects an unknown transaction or category', async () => {
    const { stores, unitOfWork } = fakeStores([row('t1', 'CORNER SHOP')], [groceries]);
    const corrector = createCategoryCorrector({ stores, unitOfWork });
    await assert.rejects(
      corrector.correct({ userId: USER, transactionId: 'nope', categoryId: 'cat-groceries' }),
      NotFoundError,
    );
    await assert.rejects(corrector.correct({ userId: USER, transactionId: 't1', categoryId: 'nope' }), NotFoundError);
  });
});
