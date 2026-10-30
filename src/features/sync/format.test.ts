import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ParsedTransaction } from '@/features/bank-email/types';
import { emailLine, summaryMessage, type NotifiableEmail } from './format';

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
