import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolvedReviewPayload, suggestedReviewPayload, SUGGESTION_FIELD, type DiscordButton, type DiscordSelect } from './embeds';
import { confirmComponents, parseReviewAction, reviewComponents, type ReviewCategory } from './review-components';

const TX = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const categories: ReviewCategory[] = [
  { id: id(1), name: 'Groceries', emoji: '🛒' },
  { id: id(2), name: 'Eating Out', emoji: '🍔' },
  { id: id(3), name: 'Mystery', emoji: null },
];

const select = (rows: ReturnType<typeof reviewComponents>) => rows[0]!.components[0] as DiscordSelect;
const buttons = (rows: ReturnType<typeof reviewComponents>) => rows.at(-1)!.components as DiscordButton[];

describe('#needs-review controls', () => {
  test('without a suggestion: every category in the dropdown, and Exclude', () => {
    const rows = reviewComponents(TX, categories);
    assert.deepEqual(
      select(rows).options.map((o) => o.label),
      ['🛒 Groceries', '🍔 Eating Out', '🏷️ Mystery'],
    );
    assert.equal(select(rows).options.some((o) => o.default), false);
    assert.deepEqual(buttons(rows).map((b) => b.label), ['🗑️ Exclude']);
  });

  test('a suggestion is preselected and gets an Accept button', () => {
    const rows = reviewComponents(TX, categories, id(2));
    assert.deepEqual(select(rows).options.find((o) => o.default)?.value, id(2));
    const [accept, exclude] = buttons(rows);
    assert.equal(accept!.label, 'Accept 🍔 Eating Out');
    assert.deepEqual(parseReviewAction(accept!.custom_id), { kind: 'categorise', transactionId: TX, categoryId: id(2) });
    assert.deepEqual(parseReviewAction(exclude!.custom_id), { kind: 'exclude', transactionId: TX });
  });

  test('more categories than Discord allows: 25 options, the suggestion always among them, in order', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: id(i + 1), name: `C${i + 1}`, emoji: null }));
    const rows = reviewComponents(TX, many, id(30));
    const values = select(rows).options.map((o) => o.value);
    assert.equal(values.length, 25);
    assert.equal(values.at(-1), id(30));
    assert.equal(values[0], id(1));
  });

  test('no categories: no dropdown (Discord needs at least one option)', () => {
    const rows = reviewComponents(TX, []);
    assert.equal(rows.length, 1);
    assert.deepEqual(buttons(rows).map((b) => b.label), ['🗑️ Exclude']);
  });

  test('a dropdown pick reads the selected value; anything else is refused', () => {
    const pick = select(reviewComponents(TX, categories)).custom_id;
    assert.deepEqual(parseReviewAction(pick, [id(1)]), { kind: 'categorise', transactionId: TX, categoryId: id(1) });
    assert.equal(parseReviewAction(pick, []), null);
    assert.equal(parseReviewAction(pick, ['not-a-uuid']), null);
    assert.equal(parseReviewAction(`review:accept:${TX}`), null);
    assert.equal(parseReviewAction(`review:delete:${TX}`), null);
    assert.equal(parseReviewAction(`other:exclude:${TX}`), null);
    assert.equal(parseReviewAction('review:exclude:../../x'), null);
  });

  test('the confirm button', () => {
    const [button] = confirmComponents(TX, categories[0]!, 30)[0]!.components as DiscordButton[];
    assert.equal(button!.label, 'Yes, file all 30 as 🛒 Groceries');
    assert.deepEqual(parseReviewAction(button!.custom_id), { kind: 'confirm', transactionId: TX, categoryId: id(1) });
  });
});

describe('review message with a suggestion', () => {
  const posted = { embeds: [{ title: 'An unfamiliar transaction', fields: [{ name: '🏷️ Category', value: '❔ Uncategorised' }] }] };

  test('shows the suggestion once, replacing an earlier one, and carries the new controls', () => {
    const first = suggestedReviewPayload(posted, { category: { name: 'Groceries', emoji: '🛒' }, note: 'A supermarket' }, reviewComponents(TX, categories, id(1)));
    const second = suggestedReviewPayload(first, { category: null, note: null }, reviewComponents(TX, categories));
    const fields = second.embeds![0]!.fields!.filter((f) => f.name === SUGGESTION_FIELD);
    assert.equal(fields.length, 1);
    assert.match(fields[0]!.value, /Not sure/);
    assert.match(first.embeds![0]!.fields!.at(-1)!.value, /🛒 Groceries\nA supermarket/);
    assert.equal(second.components!.length, 2);
  });

  test('once sorted, the suggestion and the controls go', () => {
    const suggested = suggestedReviewPayload(posted, { category: { name: 'Groceries', emoji: '🛒' }, note: null }, reviewComponents(TX, categories, id(1)));
    const resolved = resolvedReviewPayload(suggested, '🛒 Groceries');
    assert.deepEqual(resolved.components, []);
    assert.deepEqual(resolved.embeds![0]!.fields, [{ name: '🏷️ Category', value: '🛒 Groceries' }]);
  });
});
