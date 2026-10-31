import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { directionOf, ruleApplies, ruleMatches, tokenise } from './rule-matchers';

const token = (pattern: string) => ({ matchType: 'token' as const, pattern });
const exact = (pattern: string) => ({ matchType: 'exact' as const, pattern });

describe('tokenise', () => {
  test('splits on anything that is not a letter or digit', () => {
    assert.deepEqual(tokenise('DIS-CHEM PHARMACY*123'), ['DIS', 'CHEM', 'PHARMACY', '123']);
    assert.deepEqual(tokenise("pick 'n pay"), ['PICK', 'N', 'PAY']);
    assert.deepEqual(tokenise('  '), []);
  });
});

describe('token rules', () => {
  test('match whole words anywhere in the description', () => {
    assert.ok(ruleMatches(token('WOOLWORTHS'), 'WOOLWORTHS SANDTON'));
    assert.ok(ruleMatches(token('ENGEN'), 'MAIN ROAD ENGEN'));
    assert.ok(ruleMatches(token('BP'), 'BP CONSTANTIA'));
  });

  test('match multi-word patterns as a sequence, ignoring punctuation', () => {
    assert.ok(ruleMatches(token('PICK N PAY'), "PICK 'N PAY FAMILY"));
    assert.ok(ruleMatches(token('DIS CHEM'), 'DIS-CHEM CANAL WALK'));
    assert.ok(ruleMatches(token('APPLE COM BILL'), 'APPLE.COM/BILL'));
    assert.ok(ruleMatches(token('UBER EATS'), 'UBER *EATS'));
  });

  test('do not match the words out of order or apart', () => {
    assert.ok(!ruleMatches(token('PICK N PAY'), 'PAY N PICK'));
    assert.ok(!ruleMatches(token('DIS CHEM'), 'DIS SOMETHING CHEM'));
  });

  // The old app used substring "contains", which categorised all of these.
  test('false positives the old substring matching had', () => {
    assert.ok(!ruleMatches(token('BP'), 'BPA HOLDINGS'));
    assert.ok(!ruleMatches(token('BP'), 'SUBPLOT CAFE'));
    assert.ok(!ruleMatches(token('SHELL'), 'SHELLEY BEAUTY'));
    assert.ok(!ruleMatches(token('SPAR'), 'SPARK SCHOOLS'));
    assert.ok(!ruleMatches(token('TOTALENERGIES'), 'TOTALSPORTS'));
    assert.ok(!ruleMatches(token('APPLE COM BILL'), 'APPLEBEES'));
    assert.ok(!ruleMatches(token('MTN'), 'MTNL TRAVEL'));
  });

  test('an empty pattern never matches', () => {
    assert.ok(!ruleMatches(token(''), 'ANYTHING'));
    assert.ok(!ruleMatches(token(' - '), 'ANYTHING'));
  });
});

describe('exact rules', () => {
  test('match the whole normalised description, ignoring case and spacing', () => {
    assert.ok(ruleMatches(exact('SOME SHOP - SUBURB'), 'SOME SHOP - SUBURB'));
    assert.ok(ruleMatches(exact('some shop - suburb'), ' SOME  SHOP - SUBURB '));
  });

  test('do not match a description that only contains the pattern', () => {
    assert.ok(!ruleMatches(exact('SOME SHOP'), 'SOME SHOP - SUBURB'));
    assert.ok(!ruleMatches(exact('SOME SHOP - SUBURB'), 'SOME SHOP'));
  });

  test('an empty pattern never matches', () => {
    assert.ok(!ruleMatches(exact(''), ''));
  });
});

describe('ruleApplies', () => {
  const debit = { descriptionNormalised: 'ABSA BANK SAVINGS', amountCents: -200_000 };
  const credit = { descriptionNormalised: 'ABSA BANK SAVINGS', amountCents: 200_000 };

  test('a direction is the sign of the amount, and zero has none', () => {
    assert.equal(directionOf(-1), 'out');
    assert.equal(directionOf(1), 'in');
    assert.equal(directionOf(0), null);
  });

  test('a directed rule only applies to money moving its way', () => {
    const out = { ...exact('ABSA BANK SAVINGS'), direction: 'out' as const };
    assert.ok(ruleApplies(out, debit));
    assert.ok(!ruleApplies(out, credit));
    assert.ok(!ruleApplies(out, { ...debit, amountCents: 0 }));
  });

  test('a direction-less rule applies either way, and the description still has to match', () => {
    const either = { ...exact('ABSA BANK SAVINGS'), direction: null };
    assert.ok(ruleApplies(either, debit));
    assert.ok(ruleApplies(either, credit));
    assert.ok(!ruleApplies(either, { ...debit, descriptionNormalised: 'ABSA BANK' }));
  });
});
