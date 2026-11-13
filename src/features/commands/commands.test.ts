import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BULK_CONFIRM_THRESHOLD, CommandError, DISCORD_POSTS_PER_HOUR } from './commands';
import { fakeWorld, TODAY } from './test-support';

const USER = 'owner';

const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (err: unknown) => err instanceof CommandError && err.code === code, `expected CommandError ${code}`);

describe('recategorise', () => {
  function setup() {
    const w = fakeWorld();
    const groceries = w.category('Groceries');
    const eatingOut = w.category('Eating Out');
    const a = w.transaction('CORNER CAFE', -80_00, { categoryId: groceries });
    const b = w.transaction('CORNER CAFE', -95_00, { categoryId: groceries, occurredOn: '2026-10-05' });
    const loose = w.transaction('CORNER CAFE', -60_00);
    const other = w.transaction('WOOLWORTHS', -400_00, { categoryId: groceries });
    return { w, groceries, eatingOut, a, b, loose, other };
  }

  test('moves everything with a description, re-points its rule, and ticks off what was uncategorised', async () => {
    const { w, eatingOut, a, b, loose, other, groceries } = setup();
    const r = await w.commands.recategorise(USER, { description: 'corner  cafe', toCategory: 'eating out', confirm: false });
    assert.deepEqual([r.status, r.status === 'done' && r.changed, r.status === 'done' && r.rulesLearned], ['done', 3, 1]);
    assert.deepEqual([a, b, loose].map((id) => w.find(id).categoryId), [eatingOut, eatingOut, eatingOut]);
    assert.equal(w.find(other).categoryId, groceries);
    assert.deepEqual(w.state.rules.map((r) => [r.pattern, r.direction, r.categoryId, r.origin]), [['CORNER CAFE', 'out', eatingOut, 'learned']]);
    assert.deepEqual(w.state.reviewed.map((x) => x.ids), [[loose]]);
  });

  test('from a category, in one cycle only, learns no rule', async () => {
    const { w, eatingOut, a, b, other } = setup();
    w.transaction('SALARY', 30_000_00, { categoryId: w.category('Salary', { kind: 'income', isSalary: true }), occurredOn: '2026-10-30' });
    const r = await w.commands.recategorise(USER, { fromCategory: 'Groceries', toCategory: 'Eating Out', cycleRef: TODAY, confirm: false });
    assert.equal(r.status === 'done' && r.changed, 2);
    assert.deepEqual([a, other].map((id) => w.find(id).categoryId), [eatingOut, eatingOut]);
    // 5 October is in the cycle before.
    assert.notEqual(w.find(b).categoryId, eatingOut);
    assert.equal(w.state.rules.length, 0);
  });

  test('a large move previews first, and changes nothing until confirmed', async () => {
    const { w, eatingOut, groceries } = setup();
    for (let i = 0; i < BULK_CONFIRM_THRESHOLD; i++) w.transaction('CORNER CAFE', -10_00, { categoryId: groceries });
    const preview = await w.commands.recategorise(USER, { description: 'CORNER CAFE', toCategory: 'Eating Out', confirm: false });
    assert.deepEqual([preview.status, preview.status === 'needs_confirmation' && preview.wouldChange], ['needs_confirmation', BULK_CONFIRM_THRESHOLD + 3]);
    assert.ok(!w.state.transactions.some((t) => t.categoryId === eatingOut));

    const done = await w.commands.recategorise(USER, { description: 'CORNER CAFE', toCategory: 'Eating Out', confirm: true });
    assert.equal(done.status === 'done' && done.changed, BULK_CONFIRM_THRESHOLD + 3);
  });

  test('says so when there is nothing to move, and never reaches another user', async () => {
    const { w } = setup();
    await rejects(w.commands.recategorise(USER, { toCategory: 'Eating Out', confirm: false }), 'nothing_to_change');
    await rejects(w.commands.recategorise(USER, { description: 'NOBODY', toCategory: 'Eating Out', confirm: false }), 'nothing_matches');
    await rejects(w.commands.recategorise(USER, { description: 'WOOLWORTHS', toCategory: 'Groceries', confirm: false }), 'nothing_matches');
    await rejects(w.commands.recategorise('other', { description: 'CORNER CAFE', toCategory: 'Eating Out', confirm: false }), 'unknown_category');
  });
});

describe('categories', () => {
  test('rename, archive and savings change only what is passed', async () => {
    const w = fakeWorld();
    const id = w.category('Takeaways', { allocatedCents: 500_00 });
    w.category('Groceries');

    const renamed = await w.commands.updateCategory(USER, 'takeaways', { name: ' Eating Out ' });
    assert.equal(renamed.category.name, 'Eating Out');
    await rejects(w.commands.updateCategory(USER, id, { name: 'groceries' }), 'name_taken');
    await rejects(w.commands.updateCategory(USER, id, {}), 'nothing_to_change');

    const savings = await w.commands.updateCategory(USER, id, { savings: true });
    assert.deepEqual([savings.category.isSavings, savings.category.isArchived], [true, false]);

    await w.commands.updateCategory(USER, id, { archived: true });
    assert.equal(w.state.categories.find((c) => c.id === id)!.isArchived, true);
    // Its budget is switched off with it.
    assert.equal(w.state.budgetItems.find((b) => b.categoryId === id)!.isActive, false);
  });

  test('nothing new can be filed under an archived category, and built-in ones stay', async () => {
    const w = fakeWorld();
    const old = w.category('Old', { isArchived: true });
    const transfer = w.category('Transfer', { kind: 'transfer', isSystem: true });
    const salary = w.category('Salary', { kind: 'income', isSalary: true });
    const tx = w.transaction('SHOP', -10_00);

    await rejects(w.commands.categorise(USER, { transactionId: tx, category: old, applyToSimilar: true, confirm: false }), 'archived_category');
    await rejects(w.commands.suggest(USER, { transactionId: tx, category: 'Old', note: null, applyToSimilar: false }), 'archived_category');
    await rejects(w.commands.setBudgetItem(USER, 'Old', { allocatedCents: 1 }), 'archived_category');
    await rejects(w.commands.updateCategory(USER, transfer, { archived: true }), 'system_category');
    await rejects(w.commands.updateCategory(USER, salary, { savings: true }), 'not_expense');

    // Unarchiving brings it back.
    await w.commands.updateCategory(USER, 'Old', { archived: false });
    const done = await w.commands.categorise(USER, { transactionId: tx, category: 'Old', applyToSimilar: true, confirm: false });
    assert.equal(done.status, 'done');
  });

  test('merge previews, then moves transactions and rules and archives the source', async () => {
    const w = fakeWorld();
    const takeaways = w.category('Takeaways', { allocatedCents: 500_00 });
    const eatingOut = w.category('Eating Out', { allocatedCents: 1500_00 });
    const a = w.transaction('KFC', -90_00, { categoryId: takeaways });
    const excluded = w.transaction('KFC', -90_00, { categoryId: takeaways, isDeleted: true });
    w.state.rules.push({ id: 'rule-1', userId: USER, matchType: 'exact', pattern: 'KFC', direction: 'out', categoryId: takeaways, origin: 'learned' });

    const preview = await w.commands.mergeCategories(USER, { from: 'Takeaways', into: 'Eating Out', confirm: false });
    assert.deepEqual([preview.status, preview.transactions, preview.rules], ['needs_confirmation', 2, 1]);
    assert.equal(w.find(a).categoryId, takeaways);

    const done = await w.commands.mergeCategories(USER, { from: 'Takeaways', into: 'Eating Out', confirm: true });
    assert.deepEqual([done.status, done.transactions, done.rules, done.status === 'done' && done.droppedBudgetCents], ['done', 2, 1, 500_00]);
    assert.deepEqual([w.find(a).categoryId, w.find(excluded).categoryId, w.state.rules[0]!.categoryId], [eatingOut, eatingOut, eatingOut]);
    assert.equal(w.state.categories.find((c) => c.id === takeaways)!.isArchived, true);
    // The target's own budget is untouched.
    assert.equal(w.state.budgetItems.find((b) => b.categoryId === eatingOut)!.allocatedCents, 1500_00);
  });

  test('merge refuses what would change the meaning of the money', async () => {
    const w = fakeWorld();
    w.category('Groceries');
    w.category('Savings', { isSavings: true });
    w.category('Salary', { kind: 'income', isSalary: true });
    w.category('Income', { kind: 'income', isSystem: true });
    w.category('Transfer', { kind: 'transfer', isSystem: true });
    const merge = (from: string, into: string) => w.commands.mergeCategories(USER, { from, into, confirm: true });
    await rejects(merge('Groceries', 'Groceries'), 'cannot_merge');
    await rejects(merge('Groceries', 'Income'), 'cannot_merge');
    await rejects(merge('Groceries', 'Savings'), 'cannot_merge');
    await rejects(merge('Salary', 'Income'), 'cannot_merge');
    await rejects(merge('Transfer', 'Groceries'), 'system_category');
    assert.ok(w.state.categories.every((c) => !c.isArchived));
  });
});

describe('rules', () => {
  test('a learned rule can be forgotten; what it categorised stays; built-in rules stay', async () => {
    const w = fakeWorld();
    const groceries = w.category('Groceries');
    w.state.rules.push(
      { id: '00000000-0000-4000-8000-00000000aaaa', userId: USER, matchType: 'exact', pattern: 'CORNER CAFE', direction: 'out', categoryId: groceries, origin: 'learned' },
      { id: '00000000-0000-4000-8000-00000000bbbb', userId: USER, matchType: 'token', pattern: 'SPAR', direction: null, categoryId: groceries, origin: 'seed' },
    );
    const tx = w.transaction('CORNER CAFE', -80_00, { categoryId: groceries, categorySource: 'user_rule', ruleId: '00000000-0000-4000-8000-00000000aaaa' });

    await rejects(w.commands.deleteRule(USER, '00000000-0000-4000-8000-00000000bbbb'), 'seed_rule');
    await rejects(w.commands.deleteRule('other', '00000000-0000-4000-8000-00000000aaaa'), 'unknown_rule');
    const deleted = await w.commands.deleteRule(USER, '00000000-0000-4000-8000-00000000aaaa');
    assert.deepEqual([deleted.pattern, deleted.transactionCount], ['CORNER CAFE', 1]);
    assert.deepEqual(w.state.rules.map((r) => r.pattern), ['SPAR']);
    assert.deepEqual([w.find(tx).categoryId, w.find(tx).ruleId], [groceries, null]);
  });
});

describe('transactions added by hand', () => {
  test('cash goes on the cash account, today, with the category given', async () => {
    const w = fakeWorld();
    const transport = w.category('Transport');
    const tx = await w.commands.addTransaction(USER, { amountCents: 20_00, direction: 'out', description: ' car   guard ', category: 'transport' });
    assert.deepEqual(
      [tx.amountCents, tx.description, tx.occurredOn, tx.accountType, tx.accountLast4, tx.categoryId, tx.categorySource, tx.kind],
      [-20_00, 'CAR GUARD', TODAY, 'CASH', '0000', transport, 'manual', 'payment'],
    );
    assert.equal(w.find(tx.id).source, 'manual');
    // It counts like any other.
    assert.equal((await w.budget.summary(USER)).spentCents, 20_00);
  });

  test('money in, a past date and one of the user\'s own accounts; uncategorised when no category is given', async () => {
    const w = fakeWorld();
    w.transaction('SHOP', -10_00);
    const tx = await w.commands.addTransaction(USER, { amountCents: 500_00, direction: 'in', description: 'Sold the bike', occurredOn: '2026-11-01', account: '…1297' });
    assert.deepEqual([tx.amountCents, tx.occurredOn, tx.accountType, tx.categoryId, tx.kind], [500_00, '2026-11-01', 'CHEQ', null, 'credit']);
  });

  test('refuses the future, nonsense dates, R0, and accounts that are not the user\'s', async () => {
    const w = fakeWorld();
    const add = (over: object) => w.commands.addTransaction(USER, { amountCents: 10_00, direction: 'out', description: 'Thing', ...over });
    await rejects(add({ occurredOn: '2026-11-14' }), 'bad_date');
    await rejects(add({ occurredOn: '14/11/2026' }), 'bad_date');
    await rejects(add({ amountCents: 0 }), 'bad_amount');
    await rejects(add({ account: 'CHEQ 9999' }), 'unknown_account');
    await rejects(add({ category: 'Nope' }), 'unknown_category');
    assert.equal(w.state.transactions.length, 0);
  });
});

describe('splitting a transaction', () => {
  function setup() {
    const w = fakeWorld();
    const groceries = w.category('Groceries', { allocatedCents: 4000_00 });
    const clothing = w.category('Clothing', { expenseType: 'irregular' });
    const tx = w.transaction('WOOLWORTHS', -1000_00, { categoryId: groceries });
    return { w, groceries, clothing, tx };
  }

  test('the parts take the original\'s place in every total', async () => {
    const { w, groceries, clothing, tx } = setup();
    const result = await w.commands.splitTransaction(USER, { transactionId: tx, parts: [{ amountCents: 700_00, category: 'Groceries' }, { amountCents: 300_00, category: 'Clothing' }] });
    assert.deepEqual(result.parts.map((p) => [p.amountCents, p.category.id]), [[-700_00, groceries], [-300_00, clothing]]);
    assert.equal(w.find(tx).isDeleted, true);
    const parts = result.parts.map((p) => w.find(p.id));
    assert.ok(parts.every((p) => p.splitOf === tx && p.source === 'manual' && p.descriptionNormalised === 'WOOLWORTHS' && p.occurredOn === '2026-11-03' && p.accountLast4 === '1297'));

    const summary = await w.budget.summary(USER);
    assert.equal(summary.spentCents, 1000_00);
    assert.deepEqual(summary.categories.map((c) => [c.name, c.spentCents]), [['Groceries', 700_00], ['Clothing', 300_00]]);
    assert.deepEqual(w.state.reviewed.at(-1)!.outcome, { kind: 'split', parts: 2 });
  });

  test('the parts must add up, and be at least two', async () => {
    const { w, tx } = setup();
    const split = (parts: { amountCents: number; category: string }[]) => w.commands.splitTransaction(USER, { transactionId: tx, parts });
    await assert.rejects(split([{ amountCents: 700_00, category: 'Groceries' }, { amountCents: 200_00, category: 'Clothing' }]), /R900\.00 but the transaction is R1,000\.00: R100\.00 short/);
    await rejects(split([{ amountCents: 1000_00, category: 'Groceries' }]), 'bad_split');
    await rejects(split([{ amountCents: 1000_00, category: 'Groceries' }, { amountCents: 0, category: 'Clothing' }]), 'bad_split');
    await rejects(split([{ amountCents: 500_00, category: 'Groceries' }, { amountCents: 500_00, category: 'Nope' }]), 'unknown_category');
    assert.equal(w.find(tx).isDeleted, false);
    assert.equal(w.state.transactions.length, 1);
  });

  test('splitting again replaces the parts; restoring the original undoes the split', async () => {
    const { w, tx } = setup();
    const first = await w.commands.splitTransaction(USER, { transactionId: tx, parts: [{ amountCents: 700_00, category: 'Groceries' }, { amountCents: 300_00, category: 'Clothing' }] });
    const second = await w.commands.splitTransaction(USER, { transactionId: tx, parts: [{ amountCents: 400_00, category: 'Groceries' }, { amountCents: 600_00, category: 'Clothing' }] });
    assert.ok(first.parts.every((p) => w.find(p.id).isDeleted));
    assert.equal((await w.budget.summary(USER)).spentCents, 1000_00);

    // A part can't be split, and an undone part can't be brought back on top of its original.
    await rejects(w.commands.splitTransaction(USER, { transactionId: second.parts[0]!.id, parts: [{ amountCents: 200_00, category: 'Groceries' }, { amountCents: 200_00, category: 'Clothing' }] }), 'split_part');
    const restored = await w.commands.restore(USER, tx);
    assert.equal(restored.unsplitParts, 2);
    assert.equal(w.find(tx).isDeleted, false);
    assert.ok(second.parts.every((p) => w.find(p.id).isDeleted));
    assert.equal((await w.budget.summary(USER)).spentCents, 1000_00);
    await rejects(w.commands.restore(USER, second.parts[0]!.id), 'split_part');
  });

  test('excluding a split transaction takes its parts out too; an excluded one can\'t be split', async () => {
    const { w, tx } = setup();
    const { parts } = await w.commands.splitTransaction(USER, { transactionId: tx, parts: [{ amountCents: 700_00, category: 'Groceries' }, { amountCents: 300_00, category: 'Clothing' }] });
    await w.commands.exclude(USER, tx);
    assert.ok(parts.every((p) => w.find(p.id).isDeleted));
    assert.equal((await w.budget.summary(USER)).spentCents, 0);
    await rejects(w.commands.splitTransaction(USER, { transactionId: tx, parts: [{ amountCents: 500_00, category: 'Groceries' }, { amountCents: 500_00, category: 'Clothing' }] }), 'excluded');
  });
});

describe('account labels', () => {
  test('names an account in the user\'s own ledger; renaming keeps the note; null removes', async () => {
    const w = fakeWorld();
    w.transaction('SHOP', -10_00);
    w.transaction('SHOP', -10_00, { userId: 'other', accountLast4: '5555' });

    const set = await w.commands.setAccountLabel(USER, { account: 'cheq 1297', label: 'Main cheque', note: 'Salary lands here' });
    assert.deepEqual([set.kind, set.account, set.label, set.note], ['account', 'CHEQ …1297', 'Main cheque', 'Salary lands here']);
    const renamed = await w.commands.setAccountLabel(USER, { account: '1297', label: 'Everyday' });
    assert.deepEqual([renamed.label, renamed.note], ['Everyday', 'Salary lands here']);

    await rejects(w.commands.setAccountLabel(USER, { account: 'CHEQ 5555', label: 'Mine now' }), 'unknown_account');
    await rejects(w.commands.setAccountLabel(USER, { label: 'x' }), 'one_target');
    await rejects(w.commands.setAccountLabel(USER, { account: '1297', counterparty: 'SHOP', label: 'x' }), 'one_target');

    const removed = await w.commands.setAccountLabel(USER, { account: '1297', label: null });
    assert.equal(removed.removed, true);
    assert.deepEqual(w.state.labels, []);
  });

  test('a counterparty is named by text that really appears in descriptions', async () => {
    const w = fakeWorld();
    w.transaction('ABSA BANK SABIE PAYBACK', -3000_00);
    const set = await w.commands.setAccountLabel(USER, { counterparty: 'sabie payback', label: "Dad's estate" });
    assert.deepEqual([set.kind, set.counterparty, set.shown], ['counterparty', 'SABIE PAYBACK', '"SABIE PAYBACK" (1 transaction)']);
    await rejects(w.commands.setAccountLabel(USER, { counterparty: 'NOBODY PAYS', label: 'x' }), 'unknown_counterparty');
    await rejects(w.commands.setAccountLabel(USER, { counterparty: 'ab', label: 'x' }), 'unknown_counterparty');
  });
});

describe('posting a status', () => {
  test('a note alone, and the hourly cap counts what reached Discord', async () => {
    const w = fakeWorld();
    const posted = await w.commands.postStatus(USER, { note: 'Rent is paid.', includeBudget: false });
    assert.deepEqual(posted.messageIds, ['msg_1']);
    assert.match(w.state.posts[0]!.text, /^🤖 \*\*From Claude\*\*\nRent is paid\.$/);
    await rejects(w.commands.postStatus(USER, { note: '', includeBudget: false }), 'nothing_to_post');

    for (let i = 1; i < DISCORD_POSTS_PER_HOUR; i++) await w.commands.postStatus(USER, { note: `again ${i}`, includeBudget: false });
    await rejects(w.commands.postStatus(USER, { note: 'one too many', includeBudget: false }), 'post_limit');
    assert.equal(w.state.posts.length, DISCORD_POSTS_PER_HOUR);
    // Another user's posts don't count against this one.
    assert.equal((await w.commands.postStatus('other', { note: 'hello', includeBudget: false })).messageIds.length, 1);
  });

  test('a failing webhook posts nothing and doesn\'t use up the cap', async () => {
    const w = fakeWorld();
    w.discord.down();
    await rejects(w.commands.postStatus(USER, { note: 'hello', includeBudget: true }), 'post_failed');
    assert.equal(w.state.statusPosts.length, 0);
    w.discord.down(false);
    const posted = await w.commands.postStatus(USER, { note: 'hello', includeBudget: true });
    // Budgets with the note, then payday and debit orders.
    assert.equal(posted.messageIds.length, 2);
    assert.match(w.state.posts[0]!.text, /📊 Budget status/);
  });
});
