import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BudgetStanding } from '@/features/budget/standing';
import { parseEmoji } from '@/features/categorisation/emoji';
import { bar, budgetText, COLOURS, paydayText, thresholdEmbed, transactionEmbed, type TransactionInfo } from './embeds';

const category = (over: Partial<BudgetStanding['category']>): BudgetStanding['category'] => ({
  categoryId: 'c',
  name: 'Rent / Bond',
  emoji: '🏠',
  expenseType: 'static',
  allocatedCents: 5000_00,
  spentCents: 5000_00,
  remainingCents: 0,
  usedPct: 100,
  status: 'settled',
  differenceCents: 0,
  ...over,
});

const tx = (standing: BudgetStanding | null): TransactionInfo => ({
  id: 'gmail-1',
  amountCents: -5000_00,
  description: 'ABSA BOND',
  occurredOn: '2026-11-01',
  kindLabel: 'debit order',
  accountLast4: '1234',
  categoryName: 'Rent / Bond',
  categoryEmoji: '🏠',
  standing,
});

describe('budget bar and wording', () => {
  test('ten cells, clamped', () => {
    assert.equal(bar(0), '░░░░░░░░░░');
    assert.equal(bar(54), '█████░░░░░');
    assert.equal(bar(250), '██████████');
    assert.equal(bar(-10), '░░░░░░░░░░');
  });

  test('payday', () => {
    assert.equal(paydayText({ daysToSalary: 6, salaryOverdue: false }), 'Payday in 6 days');
    assert.equal(paydayText({ daysToSalary: 1, salaryOverdue: false }), 'Payday in 1 day');
    assert.equal(paydayText({ daysToSalary: 0, salaryOverdue: false }), 'Payday is **today**');
    assert.equal(paydayText({ daysToSalary: null, salaryOverdue: true }), 'Salary is **overdue**');
    assert.equal(paydayText({ daysToSalary: null, salaryOverdue: false }), null);
  });

  test('a settled static item says so, with any difference, and is never "over"', () => {
    assert.equal(budgetText(category({})), '✅ Paid R5,000.00');
    assert.equal(
      budgetText(category({ spentCents: 5020_00, remainingCents: -20_00, usedPct: 100, differenceCents: 20_00 })),
      '✅ Paid R5,020.00 (R20.00 above budget)',
    );
    assert.equal(budgetText(category({ spentCents: 4980_00, differenceCents: -20_00 })), '✅ Paid R4,980.00 (R20.00 below budget)');
    assert.doesNotMatch(budgetText(category({ spentCents: 5020_00, differenceCents: 20_00 })), /over/);
  });

  test('pending, over and unbudgeted', () => {
    assert.equal(
      budgetText(category({ status: 'pending', spentCents: 1000_00, remainingCents: 4000_00, usedPct: 20 })),
      'R1,000.00 of R5,000.00 paid · R4,000.00 to go',
    );
    assert.equal(
      budgetText(category({ expenseType: 'dynamic', status: 'over', spentCents: 5200_00, remainingCents: -200_00, usedPct: 104 })),
      '`██████████` 104% · **R200.00 over** a R5,000.00 budget',
    );
    assert.equal(
      budgetText(category({ expenseType: 'dynamic', status: 'on_track', spentCents: 2000_00, remainingCents: 3000_00, usedPct: 40 })),
      '`████░░░░░░` 40% · R3,000.00 left of R5,000.00',
    );
    assert.equal(budgetText(category({ status: 'unbudgeted', allocatedCents: 0, usedPct: null })), 'R5,000.00 this cycle · no budget set');
  });
});

describe('transaction embed', () => {
  test('a settled debit order is blue, not red', () => {
    const embed = transactionEmbed(tx({ category: category({}), payday: { daysToSalary: 29, salaryOverdue: false } }));
    assert.equal(embed.color, COLOURS.blue);
    assert.equal(embed.title, '🧾 R5,000.00');
    assert.equal(embed.description, '**ABSA BOND** · 🏠 Rent / Bond\n✅ Paid R5,000.00');
  });

  test('no standing (an old or unbudgeted transaction): just merchant and category', () => {
    const embed = transactionEmbed(tx(null));
    assert.equal(embed.description, '**ABSA BOND** · 🏠 Rent / Bond');
    assert.equal(embed.fields, undefined);
    assert.equal(embed.footer!.text, 'debit order · acc 1234 · Sun 1 Nov');
  });

  test('over-budget alert', () => {
    const embed = thresholdEmbed(
      category({ name: 'Groceries', emoji: '🛒', expenseType: 'dynamic', status: 'over', spentCents: 4200_00, allocatedCents: 4000_00, remainingCents: -200_00, usedPct: 105 }),
      { daysToSalary: 6, salaryOverdue: false },
      100,
    );
    assert.equal(embed.title, '🔴 🛒 Groceries is over budget');
    assert.equal(embed.description, '`██████████` 105% · **R200.00 over** a R4,000.00 budget\nPayday in 6 days');
    assert.equal(embed.color, COLOURS.red);
  });
});

describe('category emoji', () => {
  test('accepts one emoji, including sequences; rejects text', () => {
    assert.equal(parseEmoji(' 🛒 '), '🛒');
    assert.equal(parseEmoji('🛡️'), '🛡️');
    assert.equal(parseEmoji('👨‍👩‍👧'), '👨‍👩‍👧');
    assert.equal(parseEmoji('🇿🇦'), '🇿🇦');
    assert.equal(parseEmoji('food'), null);
    assert.equal(parseEmoji('123'), null);
    assert.equal(parseEmoji(''), null);
    assert.equal(parseEmoji('🛒🛒🛒🛒🛒🛒🛒🛒🛒'), null);
  });
});
