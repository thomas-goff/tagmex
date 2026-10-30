import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { accountKey, counterpartyKey, createLabeller, resolveAccount, type AccountLabel } from './labels';

const cheque = { accountType: 'CHEQ', accountLast4: '1297' };
const card = { accountType: 'CCRD', accountLast4: '9026' };
const savings = { accountType: 'SAVS', accountLast4: '9026' };

describe('resolveAccount', () => {
  test('accepts the shapes people and models write', () => {
    for (const ref of ['CHEQ …1297', 'CHEQ1297', 'cheq 1297', 'CHEQ ...1297', '…1297', '1297', '****1297']) {
      assert.deepEqual(resolveAccount(ref, [cheque, card]), { ok: true, account: cheque }, ref);
    }
  });

  test('only accounts in the ledger resolve', () => {
    const missing = resolveAccount('CHEQ 0000', [cheque]);
    assert.equal(missing.ok, false);
    assert.equal(resolveAccount('SAVS 1297', [cheque]).ok, false);
    assert.equal(resolveAccount('my savings', [cheque]).ok, false);
  });

  test('last 4 alone must be unambiguous', () => {
    const both = resolveAccount('9026', [card, savings]);
    assert.equal(both.ok, false);
    assert.match(!both.ok ? both.reason : '', /CCRD …9026, SAVS …9026/);
    assert.deepEqual(resolveAccount('SAVS9026', [card, savings]), { ok: true, account: savings });
  });
});

describe('createLabeller', () => {
  const labels: AccountLabel[] = [
    { kind: 'account', match: accountKey(cheque), label: 'Main cheque', note: null },
    { kind: 'counterparty', match: 'PAYBACK', label: 'Some payback', note: null },
    { kind: 'counterparty', match: counterpartyKey(' absa bank  sabie payback '), label: "Dad's estate", note: 'Borrowed from it' },
  ];
  const labeller = createLabeller(labels);

  test('accounts by type and last 4', () => {
    assert.equal(labeller.account(cheque)?.label, 'Main cheque');
    assert.equal(labeller.account(card), null);
    // Same digits, different account.
    assert.equal(labeller.account({ accountType: 'SAVS', accountLast4: '1297' }), null);
  });

  test('counterparties by text in the description, longest match first', () => {
    assert.equal(labeller.counterparty('ABSA BANK SABIE PAYBACK')?.label, "Dad's estate");
    assert.equal(labeller.counterparty('absa bank sabie payback ref')?.note, 'Borrowed from it');
    assert.equal(labeller.counterparty('LOAN PAYBACK')?.label, 'Some payback');
    assert.equal(labeller.counterparty('WOOLWORTHS'), null);
  });
});
