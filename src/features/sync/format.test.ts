import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ParsedTransaction } from '@/features/bank-email/types';
import type { BudgetStanding } from '@/features/budget/standing';
import { embedLength, LIMITS, payloadText } from '@/features/notifications/embeds';
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
  test('amount, merchant and category inline, then the budget bar and payday', () => {
    const embed = emailPayload({ ...parsed('WOOLWORTHS', -245_50, 'Groceries', '🛒'), standing: groceries }).embeds![0]!;
    assert.match(embed.title!, /Master Goff$/);
    assert.deepEqual(
      embed.fields!.map((f) => [f.name, f.value, f.inline]),
      [
        ['💳 Amount', 'R245.50', true],
        ['🏪 Merchant', 'WOOLWORTHS', true],
        ['🏷️ Category', '🛒 Groceries', true],
        ['🛒 Groceries budget', '█████░░░░░ 54% used\n**R1,830.00** left of R4,000.00', false],
        ['📅 Payday', 'Salary arrives in **6 days**', false],
      ],
    );
    assert.match(embed.footer!.text, /card · acc 1234 · 2026-11-01/);
  });

  test('the same transaction always gets the same wording', () => {
    const a = emailPayload(parsed('WOOLWORTHS', -100, 'Groceries')).embeds![0]!;
    const b = emailPayload(parsed('WOOLWORTHS', -100, 'Groceries')).embeds![0]!;
    assert.deepEqual([a.title, a.description], [b.title, b.description]);
  });

  test('money in is a deposit; bank text is escaped', () => {
    const embed = emailPayload(parsed('PAY*ME_NOW', 500_00, 'Income')).embeds![0]!;
    assert.match(embed.title!, /deposit|Money in/);
    assert.equal(embed.fields![1]!.value, 'PAY\\*ME\\_NOW');
    assert.equal(embed.fields![2]!.value, '🏷️ Income');
  });

  test('uncategorised goes out as a review message', () => {
    const embed = emailPayload(parsed('CORNER SHOP', -500, null)).embeds![0]!;
    assert.match(embed.title!, /unfamiliar/);
    assert.equal(embed.fields![2]!.value, '❔ Uncategorised');
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
    assert.match(embed.title!, /^✅ Sorted/);
    assert.equal(embed.fields!.find((f) => f.name === '🏷️ Category')!.value, '🛒 Groceries');
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
    assert.equal(embed.title, '📥 5 transactions, Master Goff');
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
