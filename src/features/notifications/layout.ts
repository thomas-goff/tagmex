import { fieldLines, type DiscordActionRow, type DiscordEmbed, type DiscordPayload } from './embeds';

// Discord's Components V2 layout: what every message is posted as. The builders in ./embeds still
// describe a message as text and embeds (that's what the tests, the stored #needs-review payloads
// and the dry-run previews read); this turns that into the layout just before it's sent. Each
// embed becomes a container (a card with the embed's colour as its accent edge) of text displays:
// the title as a heading over the description, a divider, each field as a bold name over its
// lines, and the footer as small grey subtext. Message text goes above the cards; buttons and
// dropdowns go inside the last card.
//
// Why: embeds render unevenly (some clients have dropped their fields), and message text can't
// show a card. Text displays are ordinary markdown, so nothing is lost.

// The message flag that switches a message to this layout. Once set it can't be unset, and the
// message can't also carry `content` or `embeds`.
export const IS_COMPONENTS_V2 = 1 << 15;

// Discord's limits for this layout: components in a message (nested ones count), and characters
// across all its text displays.
export const LAYOUT_LIMITS = { components: 40, text: 4000 } as const;

export interface TextDisplay {
  type: 10;
  content: string;
}

export interface Separator {
  type: 14;
  divider?: boolean;
  // 1 small padding, 2 large.
  spacing?: 1 | 2;
}

export interface Container {
  type: 17;
  accent_color?: number;
  components: (TextDisplay | Separator | DiscordActionRow)[];
}

export type LayoutComponent = TextDisplay | Container | DiscordActionRow;

// What ./embeds puts in a field with no value.
const EMPTY = '\u200b';

const text = (content: string): TextDisplay => ({ type: 10, content });
const DIVIDER: Separator = { type: 14, divider: true, spacing: 1 };

// Whole lines that fit in `room`, ending in "…and N more" rather than a line cut in half (which
// breaks its markdown). Empty when not even that fits.
function fit(content: string, room: number) {
  if (content.length <= room) return content;
  return room < 40 ? '' : fieldLines(content.split('\n'), room);
}

const rowSize = (row: DiscordActionRow) => 1 + row.components.length;

// The payload as Components V2. `mention` (a user id) goes first, in the message's own text, so
// it notifies; allowed_mentions (discord.ts) still decides who actually gets pinged.
export function toComponents(payload: DiscordPayload, { mention }: { mention?: string } = {}): LayoutComponent[] {
  const rows = payload.components ?? [];
  const embeds = payload.embeds ?? [];
  let textLeft: number = LAYOUT_LIMITS.text;
  let componentsLeft = LAYOUT_LIMITS.components - rows.reduce((n, r) => n + rowSize(r), 0);

  function add(into: { components: unknown[] }, content: string) {
    const fitted = fit(content, textLeft);
    if (!fitted || componentsLeft < 1) return false;
    into.components.push(text(fitted));
    textLeft -= fitted.length;
    componentsLeft--;
    return true;
  }

  const top: { components: LayoutComponent[] } = { components: [] };
  const head = [mention && `<@${mention}>`, payload.content].filter(Boolean).join(' ');
  if (head) add(top, head);

  function cardBody(card: Container, embed: DiscordEmbed) {
    add(card, [embed.title && `### ${embed.title}`, embed.description].filter(Boolean).join('\n'));
    const fields = (embed.fields ?? []).filter((f) => f.value.trim() && f.value !== EMPTY);
    if (fields.length > 0 && componentsLeft > 1) {
      card.components.push(DIVIDER);
      componentsLeft--;
    }
    for (const f of fields) {
      const name = `**${f.name}**\n`;
      const value = fit(f.value, textLeft - name.length);
      if (value) add(card, name + value);
    }
    if (embed.footer?.text) add(card, `-# ${embed.footer.text}`);
  }

  for (const embed of embeds) {
    if (componentsLeft < 2) break;
    const card: Container = { type: 17, components: [], ...(embed.color !== undefined ? { accent_color: embed.color } : {}) };
    componentsLeft--;
    cardBody(card, embed);
    top.components.push(card);
  }

  // The controls sit in the card they act on; without a card, under the text.
  const lastCard = top.components.findLast((c): c is Container => c.type === 17);
  if (lastCard) lastCard.components.push(...rows);
  else top.components.push(...rows);

  // A message needs at least one component.
  if (top.components.length === 0) top.components.push(text(EMPTY));
  return top.components;
}

// All the text of a layout, flattened (for tests).
export function layoutText(components: readonly (LayoutComponent | Separator)[]): string {
  return components
    .flatMap((c) => (c.type === 10 ? [c.content] : c.type === 17 ? [layoutText(c.components)] : []))
    .join('\n');
}
