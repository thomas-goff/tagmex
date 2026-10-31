import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { categorise } from './categorise';
import { findTransferCounterpart } from './steps';
import {
  UNCATEGORISED,
  type CategorisableTransaction,
  type CategorisationContext,
  type CategoryRule,
  type TransferCandidate,
} from './types';

const tx = (over: Partial<CategorisableTransaction> = {}): CategorisableTransaction => ({
  descriptionNormalised: 'SOMEWHERE',
  amountCents: -10_000,
  occurredOn: '2026-11-10',
  accountLast4: '1234',
  ...over,
});

const rule = (over: Partial<CategoryRule> & Pick<CategoryRule, 'id' | 'pattern'>): CategoryRule => ({
  matchType: 'token',
  categoryId: `cat-${over.id}`,
  origin: 'seed',
  direction: null,
  ...over,
});

const candidate = (over: Partial<TransferCandidate> = {}): TransferCandidate => ({
  id: 'other-leg',
  amountCents: 10_000,
  occurredOn: '2026-11-10',
  accountLast4: '5678',
  ...over,
});

const context = (over: Partial<CategorisationContext> = {}): CategorisationContext => ({
  rules: [],
  transferCategoryId: 'cat-transfer',
  transferCandidates: [],
  ...over,
});

describe('categorise', () => {
  test('uncategorised when nothing matches', () => {
    assert.deepEqual(categorise(tx(), context()), UNCATEGORISED);
  });

  test('a user rule matches the exact normalised description', () => {
    const rules = [rule({ id: 'mine', matchType: 'exact', origin: 'learned', pattern: 'SOME SHOP - SUBURB' })];
    assert.deepEqual(categorise(tx({ descriptionNormalised: 'SOME SHOP - SUBURB' }), context({ rules })), {
      categoryId: 'cat-mine',
      source: 'user_rule',
      ruleId: 'mine',
    });
  });

  test('a merchant rule matches a whole word', () => {
    const rules = [rule({ id: 'engen', pattern: 'ENGEN' })];
    assert.deepEqual(categorise(tx({ descriptionNormalised: 'ENGEN MAIN ROAD' }), context({ rules })), {
      categoryId: 'cat-engen',
      source: 'merchant_rule',
      ruleId: 'engen',
    });
  });

  test('a merchant rule does not match part of a word', () => {
    const rules = [rule({ id: 'bp', pattern: 'BP' }), rule({ id: 'shell', pattern: 'SHELL' })];
    assert.equal(categorise(tx({ descriptionNormalised: 'BPA HOLDINGS' }), context({ rules })).source, 'none');
    assert.equal(categorise(tx({ descriptionNormalised: 'SHELLEY BEAUTY' }), context({ rules })).source, 'none');
  });

  test('a user rule outranks a merchant rule for the same description', () => {
    const rules = [
      rule({ id: 'seed', pattern: 'WOOLWORTHS' }),
      rule({ id: 'mine', matchType: 'exact', origin: 'learned', pattern: 'WOOLWORTHS CAFE' }),
    ];
    assert.equal(categorise(tx({ descriptionNormalised: 'WOOLWORTHS CAFE' }), context({ rules })).ruleId, 'mine');
  });

  test('a learned token rule outranks a seed token rule', () => {
    const rules = [
      rule({ id: 'seed', pattern: 'UBER EATS' }),
      rule({ id: 'learned', pattern: 'UBER', origin: 'learned' }),
    ];
    assert.equal(categorise(tx({ descriptionNormalised: 'UBER EATS' }), context({ rules })).ruleId, 'learned');
  });

  test('between rules of the same origin, the most specific pattern wins', () => {
    const rules = [rule({ id: 'uber', pattern: 'UBER' }), rule({ id: 'eats', pattern: 'UBER EATS' })];
    assert.equal(categorise(tx({ descriptionNormalised: 'UBER EATS' }), context({ rules })).ruleId, 'eats');
    assert.equal(categorise(tx({ descriptionNormalised: 'UBER TRIP' }), context({ rules })).ruleId, 'uber');
  });

  test('a merchant rule outranks transfer detection', () => {
    const rules = [rule({ id: 'engen', pattern: 'ENGEN' })];
    const result = categorise(
      tx({ descriptionNormalised: 'ENGEN' }),
      context({ rules, transferCandidates: [candidate()] }),
    );
    assert.equal(result.source, 'merchant_rule');
  });

  test('detects a transfer and names the other leg', () => {
    assert.deepEqual(categorise(tx(), context({ transferCandidates: [candidate()] })), {
      categoryId: 'cat-transfer',
      source: 'transfer',
      ruleId: null,
      counterpartId: 'other-leg',
    });
  });

  test('no transfer detection without a transfer category', () => {
    const result = categorise(tx(), context({ transferCategoryId: null, transferCandidates: [candidate()] }));
    assert.deepEqual(result, UNCATEGORISED);
  });

  describe('rule direction', () => {
    // Moving money into savings: both legs share the description. The cheque leg is Savings.
    const savings = rule({
      id: 'savings',
      matchType: 'exact',
      origin: 'learned',
      pattern: 'ABSA BANK SAVINGS',
      direction: 'out',
    });
    const debit = tx({ descriptionNormalised: 'ABSA BANK SAVINGS', amountCents: -200_000, accountLast4: '9876' });
    const credit = tx({ descriptionNormalised: 'ABSA BANK SAVINGS', amountCents: 200_000, accountLast4: '0152' });

    test('a money-out rule catches money out', () => {
      assert.deepEqual(categorise(debit, context({ rules: [savings] })), {
        categoryId: 'cat-savings',
        source: 'user_rule',
        ruleId: 'savings',
      });
    });

    test('a money-out rule skips the credit, which still pairs as a transfer', () => {
      const uncategorisedDebit = candidate({ id: 'cheque-leg', amountCents: -200_000, accountLast4: '9876' });
      assert.deepEqual(categorise(credit, context({ rules: [savings], transferCandidates: [uncategorisedDebit] })), {
        categoryId: 'cat-transfer',
        source: 'transfer',
        ruleId: null,
        counterpartId: 'cheque-leg',
      });
    });

    test('a money-in rule skips money out', () => {
      const income = rule({ id: 'in', matchType: 'exact', origin: 'learned', pattern: 'ABSA BANK SAVINGS', direction: 'in' });
      assert.deepEqual(categorise(debit, context({ rules: [income] })), UNCATEGORISED);
      assert.equal(categorise(credit, context({ rules: [income] })).ruleId, 'in');
    });

    test('a direction-less rule matches both ways', () => {
      const either = rule({ id: 'either', matchType: 'exact', origin: 'learned', pattern: 'ABSA BANK SAVINGS' });
      assert.equal(categorise(debit, context({ rules: [either] })).ruleId, 'either');
      assert.equal(categorise(credit, context({ rules: [either] })).ruleId, 'either');
    });

    test("a rule for the transaction's direction outranks a direction-less one", () => {
      const either = rule({ id: 'either', matchType: 'exact', origin: 'learned', pattern: 'ABSA BANK SAVINGS' });
      const rules = [either, savings];
      assert.equal(categorise(debit, context({ rules })).ruleId, 'savings');
      assert.equal(categorise(credit, context({ rules })).ruleId, 'either');
    });

    test('directed token rules respect direction too', () => {
      const refunds = rule({ id: 'refunds', pattern: 'TAKEALOT', direction: 'in' });
      assert.equal(categorise(tx({ descriptionNormalised: 'TAKEALOT JHB' }), context({ rules: [refunds] })).source, 'none');
    });
  });

  test('a step that throws is reported and skipped, never thrown', () => {
    const errors: unknown[] = [];
    const result = categorise(tx(), context(), {
      steps: [
        () => {
          throw new Error('boom');
        },
        () => ({ categoryId: 'fallback', source: 'manual', ruleId: null }),
      ],
      onError: (err) => errors.push(err),
    });
    assert.equal(result.categoryId, 'fallback');
    assert.equal(errors.length, 1);
  });
});

describe('findTransferCounterpart', () => {
  test('matches the opposite amount on another account within 3 days', () => {
    assert.equal(findTransferCounterpart(tx(), [candidate({ occurredOn: '2026-11-13' })])?.id, 'other-leg');
    assert.equal(findTransferCounterpart(tx(), [candidate({ occurredOn: '2026-11-07' })])?.id, 'other-leg');
  });

  test('works for the incoming leg too', () => {
    const incoming = tx({ amountCents: 10_000 });
    assert.equal(findTransferCounterpart(incoming, [candidate({ amountCents: -10_000 })])?.id, 'other-leg');
  });

  test('ignores the same account', () => {
    assert.equal(findTransferCounterpart(tx(), [candidate({ accountLast4: '1234' })]), null);
  });

  test('ignores the same sign or a different amount', () => {
    assert.equal(findTransferCounterpart(tx(), [candidate({ amountCents: -10_000 })]), null);
    assert.equal(findTransferCounterpart(tx(), [candidate({ amountCents: 10_001 })]), null);
  });

  test('ignores anything more than 3 days away', () => {
    assert.equal(findTransferCounterpart(tx(), [candidate({ occurredOn: '2026-11-14' })]), null);
    assert.equal(findTransferCounterpart(tx(), [candidate({ occurredOn: '2026-11-06' })]), null);
  });

  test('counts days across a month boundary', () => {
    const endOfMonth = tx({ occurredOn: '2026-10-31' });
    assert.equal(findTransferCounterpart(endOfMonth, [candidate({ occurredOn: '2026-11-02' })])?.id, 'other-leg');
  });

  test('picks the closest date when several match', () => {
    const candidates = [
      candidate({ id: 'far', occurredOn: '2026-11-12' }),
      candidate({ id: 'near', occurredOn: '2026-11-11' }),
    ];
    assert.equal(findTransferCounterpart(tx(), candidates)?.id, 'near');
  });

  test('never matches a zero amount', () => {
    assert.equal(findTransferCounterpart(tx({ amountCents: 0 }), [candidate({ amountCents: 0 })]), null);
  });
});
