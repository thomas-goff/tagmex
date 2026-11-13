import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COLOURS, systemEmbed, type DiscordActionRow, type DiscordPayload } from './embeds';
import { LAYOUT_LIMITS, layoutText, toComponents, type Container, type LayoutComponent } from './layout';

const count = (components: readonly { type: number; components?: readonly unknown[] }[]): number =>
  components.reduce((n, c) => n + 1 + (c.components ? count(c.components as { type: number }[]) : 0), 0);

const textLength = (components: readonly LayoutComponent[]) => layoutText(components).replace(/\n/g, '').length;

const row: DiscordActionRow = { type: 1, components: [{ type: 2, style: 2, label: '🗑️ Exclude', custom_id: 'review:exclude:x' }] };

describe('Components V2 layout', () => {
  test('an embed becomes a card: heading and description, a divider, fields, footer as subtext', () => {
    const [card, ...rest] = toComponents({
      embeds: [{ title: '🧾 R72.00', description: '**CORNER SHOP** · 🛒 Groceries', color: COLOURS.green, fields: [{ name: '📊 Budgets', value: 'a\nb' }], footer: { text: 'Card purchase · acc 1234 · Tue 10 Nov' } }],
    });
    assert.equal(rest.length, 0);
    assert.deepEqual(card, {
      type: 17,
      accent_color: COLOURS.green,
      components: [
        { type: 10, content: '### 🧾 R72.00\n**CORNER SHOP** · 🛒 Groceries' },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: '**📊 Budgets**\na\nb' },
        { type: 10, content: '-# Card purchase · acc 1234 · Tue 10 Nov' },
      ],
    });
  });

  test('message text goes above the cards, and a ping leads it', () => {
    const layout = toComponents({ content: 'Heads up', embeds: [systemEmbed('🔴 Sync failed', 'token expired')] }, { mention: '42' });
    assert.deepEqual(layout[0], { type: 10, content: '<@42> Heads up' });
    assert.equal(layout[1]!.type, 17);
    assert.deepEqual(toComponents({ content: 'plain' }), [{ type: 10, content: 'plain' }]);
  });

  test('controls go in the last card, or under the text when there is none', () => {
    const [card] = toComponents({ embeds: [{ title: 'T' }], components: [row] }) as [Container];
    assert.deepEqual(card.components.at(-1), row);
    assert.deepEqual(toComponents({ content: 'Shall I?', components: [row] }), [{ type: 10, content: 'Shall I?' }, row]);
    // No controls, no rows: an edit that drops them removes them.
    const [resolved] = toComponents({ embeds: [{ title: 'T' }], components: [] }) as [Container];
    assert.equal(resolved.components.some((c) => c.type === 1), false);
  });

  test('empty fields and missing colours are left out', () => {
    const [card] = toComponents({ embeds: [{ title: 'T', fields: [{ name: 'Empty', value: '​' }] }] }) as [Container];
    assert.equal('accent_color' in card, false);
    assert.deepEqual(card.components, [{ type: 10, content: '### T' }]);
  });

  test("never more text than Discord allows: long lists end in '…and N more', whole lines only", () => {
    const many = Array.from({ length: 80 }, (_, i) => `🛒 Category number ${i} \`████░░░░\` 50% · R1,000.00 left`);
    const lines = many.join('\n');
    const layout = toComponents({ embeds: [{ title: 'T', description: 'D', fields: [{ name: 'A', value: lines }, { name: 'B', value: lines }] }] });
    assert.ok(textLength(layout) <= LAYOUT_LIMITS.text);
    const text = layoutText(layout);
    assert.match(text, /^### T\nD\n\*\*A\*\*\n🛒 Category number 0/);
    assert.match(text, /…and \d+ more/);
    for (const line of text.split('\n')) assert.ok(many.includes(line) || /^(### T|D|\*\*[AB]\*\*|…and \d+ more)$/.test(line), line);
  });

  test('never more components than Discord allows, keeping the controls', () => {
    const fields = Array.from({ length: 25 }, (_, i) => ({ name: `F${i}`, value: 'v' }));
    const payload: DiscordPayload = { embeds: [{ title: 'A', fields }, { title: 'B', fields }], components: [row, row] };
    const layout = toComponents(payload);
    assert.ok(count(layout) <= LAYOUT_LIMITS.components, String(count(layout)));
    const last = layout.at(-1) as Container;
    assert.deepEqual(last.components.slice(-2), [row, row]);
  });
});
