import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ParsedTransaction } from '@/features/bank-email/types';
import type { BudgetStanding } from '@/features/budget/standing';
import { COLOURS, embedLength, LIMITS, payloadText } from '@/features/notifications/embeds';
import { resolvedReviewContent, resolvedReviewMessage } from '@/features/notifications/review';
import { backlogPayload, emailPayload } from './email-payload';
import { channelFor, type NotifiableEmail } from './format';

const parsed = (description: string, amountCents: number, categoryName: string | null, categoryEmoji: string | null = null): NotifiableEmail => ({
  gmailId: description,
  subject: 'NotifyMe from Absa - Purchase',
  categoryName,
  categoryEmoji,
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

const groceries: BudgetStanding = {
  category: {
    categoryId: 'g',
    name: 'Groceries',
    emoji: '🛒',
    expenseType: 'dynamic',
    allocatedCents: 4000_00,
    spentCents: 2170_00,
    remainingCents: 1830_00,
    usedPct: 54,
    status: 'on_track',
    differenceCents: 0,
  },
  payday: { daysToSalary: 6, salaryOverdue: false },
};

describe('channels', () => {
  test('categorised → #transactions, uncategorised → #needs-review, failures → #system', () => {
    assert.equal(channelFor(parsed('WOOLWORTHS', -100, 'Groceries')), 'transactions');
    assert.equal(channelFor(parsed('SALARY', 100, 'Salary')), 'transactions');
    assert.equal(channelFor(parsed('CORNER SHOP', -100, null)), 'review');
    assert.equal(channelFor({ gmailId: 'x', subject: 's', result: { status: 'failed', reason: 'no amount' } }), 'system');
  });
});

describe('transaction message', () => {
  test('the amount as the title, then merchant and category, then the budget; payday stays in the digest', () => {
    const embed = emailPayload({ ...parsed('WOOLWORTHS', -245_50, 'Groceries', '🛒'), standing: groceries }).embeds![0]!;
    assert.equal(embed.title, '🧾 R245.50');
    assert.equal(embed.description, '**WOOLWORTHS** · 🛒 Groceries\n`█████░░░░░` 54% · R1,830.00 left of R4,000.00');
    assert.equal(embed.fields, undefined);
    assert.equal(embed.footer!.text, 'card · acc 1234 · Sun 1 Nov');
  });

  test('money in; bank text is escaped and kept out of the title', () => {
    const embed = emailPayload(parsed('PAY*ME_NOW', 500_00, 'Income')).embeds![0]!;
    assert.equal(embed.title, '💰 R500.00');
    assert.equal(embed.description, '**PAY\\*ME\\_NOW** · 🏷️ Income');
  });

  test('uncategorised goes out as a review message', () => {
    const embed = emailPayload(parsed('CORNER SHOP', -500, null)).embeds![0]!;
    assert.equal(embed.title, '🧐 R5.00');
    assert.match(embed.description!, /^\*\*CORNER SHOP\*\* · ❔ needs a category\n/);
  });

  test('a dry-run prefix goes in the message text', () => {
    assert.equal(emailPayload(parsed('WOOLWORTHS', -100, 'Groceries'), '[dry run] ').content, '[dry run]');
  });
});

describe('review messages', () => {
  test('a review embed is rebuilt with its outcome', () => {
    const stored = JSON.stringify(emailPayload(parsed('CORNER SHOP', -500, null)));
    const resolved = resolvedReviewMessage(stored, '🛒 Groceries');
    assert.ok(typeof resolved !== 'string');
    const embed = resolved.embeds![0]!;
    assert.equal(embed.title, '✅ R5.00');
    assert.equal(embed.description, '**CORNER SHOP** · 🛒 Groceries');
    assert.equal(embed.color, COLOURS.green);
  });

  test('a review embed from before the trim keeps its fields and gets the outcome in its category field', () => {
    const stored = JSON.stringify({
      embeds: [{ title: '🧐 An unfamiliar transaction, Master Goff', fields: [{ name: '💳 Amount', value: 'R5.00' }, { name: '🏷️ Category', value: '❔ Uncategorised' }] }],
    });
    const resolved = resolvedReviewMessage(stored, '🗑️ excluded');
    assert.ok(typeof resolved !== 'string');
    const embed = resolved.embeds![0]!;
    assert.match(embed.title!, /^✅ Sorted/);
    assert.deepEqual(embed.fields!.map((f) => f.value), ['R5.00', '🗑️ excluded']);
  });

  test('a plain-text row from before embeds is ticked off the old way', () => {
    const line = '🔻 **-R5.00** · CORNER SHOP · ❔ **Uncategorised** · 2026-11-01 · card · acc 1234';
    assert.equal(resolvedReviewMessage(line, '🛒 Groceries'), `✅ ${line.replace('❔ **Uncategorised**', '🛒 Groceries')}`);
    assert.equal(resolvedReviewContent('something else', '🗑️ excluded'), '✅ something else → 🗑️ excluded');
  });
});

describe('backlog message', () => {
  test('counts per category with emoji, most frequent first and uncategorised last', () => {
    const items = [
      parsed('PETROL ONE', -100, 'Petrol', '⛽'),
      parsed('SHOP ONE', -100, null),
      parsed('WOOLWORTHS', -100, 'Groceries', '🛒'),
      parsed('CHECKERS', -100, 'Groceries', '🛒'),
      parsed('SALARY', 100_00, 'Income', '💵'),
    ];
    const embed = backlogPayload(items).embeds![0]!;
    assert.equal(embed.title, '📥 5 transactions');
    const [totals, counts] = embed.description!.split('\n');
    assert.equal(totals, 'Out R4.00 · in R100.00');
    assert.equal(counts, '🛒 Groceries 2 · 💵 Income 1 · ⛽ Petrol 1 · ❔ Uncategorised 1');
  });

  test('stays inside Discord limits for a large backlog', () => {
    const items = Array.from({ length: 300 }, (_, i) => parsed(`SHOP ${i}`, -100, i % 2 ? 'Groceries' : null));
    const embed = backlogPayload(items).embeds![0]!;
    assert.ok(embed.description!.length <= LIMITS.description, `${embed.description!.length} characters`);
    assert.ok(embedLength(embed) <= LIMITS.total);
    assert.match(payloadText({ embeds: [embed] }), /…and \d+ more/);
  });
});
