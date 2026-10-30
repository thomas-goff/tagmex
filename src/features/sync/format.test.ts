import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ParsedTransaction } from '@/features/bank-email/types';
import { resolvedReviewContent } from '@/features/notifications/review';
import { channelFor, emailLine, summaryMessage, type NotifiableEmail } from './format';

const parsed = (description: string, amountCents: number, categoryName: string | null): NotifiableEmail => ({
  gmailId: description,
  subject: 'NotifyMe from Absa - Purchase',
  categoryName,
  result: {
    status: 'parsed',
    transaction: {
      amountCents,
      occurredOn: '2026-11-01',
      transactionType: 'AUTHORIZATION',
      descriptionRaw: description,
      description,
      accountType: 'CHEQ',
      accountLast4: '1234',
      reserved: false,
      kind: 'card_purchase',
    } satisfies ParsedTransaction,
  },
});

describe('emailLine', () => {
  test('shows the category', () => {
    assert.equal(
      emailLine(parsed('WOOLWORTHS', -12345, 'Groceries')),
      '🔻 **-R123.45** · WOOLWORTHS · 🏷️ Groceries · 2026-11-01 · card · acc 1234',
    );
  });

  test('marks an uncategorised transaction', () => {
    assert.match(emailLine(parsed('CORNER SHOP', -500, null)), / · ❔ \*\*Uncategorised\*\* · /);
  });
});

describe('channels and standing', () => {
  test('categorised → #transactions, uncategorised → #needs-review, failures → #system', () => {
    assert.equal(channelFor(parsed('WOOLWORTHS', -100, 'Groceries')), 'transactions');
    assert.equal(channelFor(parsed('SALARY', 100, 'Salary')), 'transactions');
    assert.equal(channelFor(parsed('CORNER SHOP', -100, null)), 'review');
    assert.equal(channelFor({ gmailId: 'x', subject: 's', result: { status: 'failed', reason: 'no amount' } }), 'system');
  });

  test('the category budget rides along on the line', () => {
    assert.equal(
      emailLine({ ...parsed('WOOLWORTHS', -12345, 'Groceries'), standing: 'R450.00 of R4,000.00, 11%' }),
      '🔻 **-R123.45** · WOOLWORTHS · 🏷️ Groceries (R450.00 of R4,000.00, 11%) · 2026-11-01 · card · acc 1234',
    );
  });

  test('a review message is ticked off with its new category', () => {
    const line = emailLine(parsed('CORNER SHOP', -500, null));
    assert.equal(resolvedReviewContent(line, '🏷️ Groceries'), `✅ ${line.replace('❔ **Uncategorised**', '🏷️ Groceries')}`);
    assert.equal(resolvedReviewContent('something else', '🗑️ excluded'), '✅ something else → 🗑️ excluded');
  });
});

describe('summaryMessage', () => {
  test('counts per category, most frequent first and uncategorised last', () => {
    const items = [
      parsed('PETROL ONE', -100, 'Petrol'),
      parsed('SHOP ONE', -100, null),
      parsed('WOOLWORTHS', -100, 'Groceries'),
      parsed('CHECKERS', -100, 'Groceries'),
      parsed('SALARY', 100_00, 'Income'),
    ];
    const [header, counts] = summaryMessage(items).split('\n');
    assert.equal(header, '📥 5 transactions · out -R4.00 · in R100.00');
    assert.equal(counts, '🏷️ Groceries 2 · 🏷️ Income 1 · 🏷️ Petrol 1 · ❔ **Uncategorised** 1');
  });

  test('stays under the Discord limit for a large backlog', () => {
    const items = Array.from({ length: 200 }, (_, i) => parsed(`SHOP ${i}`, -100, i % 2 ? 'Groceries' : null));
    const message = summaryMessage(items);
    assert.ok(message.length <= 2000, `${message.length} characters`);
    assert.match(message, /…and \d+ more$/);
  });
});
