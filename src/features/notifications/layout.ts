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

// The text displays a card is made of. toComponents and measure both use these, so a payload that
// measures as fitting is shown in full.
const headerText = (e: DiscordEmbed) => [e.title && `### ${e.title}`, e.description].filter(Boolean).join('\n');
const shownFields = (e: DiscordEmbed) => (e.fields ?? []).filter((f) => f.value.trim() && f.value !== EMPTY);
const fieldName = (name: string) => `**${name}**\n`;
const footerText = (e: DiscordEmbed) => (e.footer?.text ? `-# ${e.footer.text}` : '');

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

  // A backstop: messages built with splitToFit never need it.
  function cardBody(card: Container, embed: DiscordEmbed) {
    add(card, headerText(embed));
    const fields = shownFields(embed);
    if (fields.length > 0 && componentsLeft > 1) {
      card.components.push(DIVIDER);
      componentsLeft--;
    }
    for (const f of fields) {
      const name = fieldName(f.name);
      const value = fit(f.value, textLeft - name.length);
      if (value) add(card, name + value);
    }
    add(card, footerText(embed));
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

// ── Splitting ────────────────────────────────────────────────────────────────────────────────────

// What a payload costs as a message: characters across its text displays, and components.
export function measure(payload: DiscordPayload) {
  let text = payload.content?.length ?? 0;
  let components = payload.content ? 1 : 0;
  for (const e of payload.embeds ?? []) {
    const parts = [headerText(e), ...shownFields(e).map((f) => fieldName(f.name) + f.value), footerText(e)].filter(Boolean);
    text += parts.reduce((n, p) => n + p.length, 0);
    components += 1 + parts.length + (shownFields(e).length > 0 ? 1 : 0);
  }
  components += (payload.components ?? []).reduce((n, r) => n + rowSize(r), 0);
  return { text, components };
}

// Room kept for the @-mention a #system message can lead with.
const MENTION_ROOM = 40;

export function fits(payload: DiscordPayload) {
  const { text, components } = measure(payload);
  return text + MENTION_ROOM <= LAYOUT_LIMITS.text && components <= LAYOUT_LIMITS.components;
}

const CONTINUED = ' (continued)';

// The payload as one message if it fits Discord's limits, or as several that each do. Fields are
// never cut: one that doesn't fit after the others goes whole into the next message, in a card of
// the same colour titled "… (continued)", and only a field too long for a message of its own is
// split between its lines. The controls go on the last message (they're small; toComponents
// still keeps a message within the component limit if they tip it over).
export function splitToFit(payload: DiscordPayload): DiscordPayload[] {
  if (fits(payload)) return [payload];

  const messages: DiscordPayload[] = [];
  let current: DiscordPayload = payload.content ? { content: payload.content, embeds: [] } : { embeds: [] };
  const cards = () => current.embeds!;
  const card = () => cards().at(-1)!;
  const tryWith = (next: DiscordEmbed) => fits({ ...current, embeds: [...cards().slice(0, -1), next] });

  function newMessage(continuation: DiscordEmbed) {
    messages.push(current);
    current = { embeds: [continuation] };
  }

  for (const embed of payload.embeds ?? []) {
    const continuation: DiscordEmbed = {
      ...(embed.title ? { title: `${embed.title}${CONTINUED}` } : {}),
      ...(embed.color !== undefined ? { color: embed.color } : {}),
      ...(embed.footer ? { footer: embed.footer } : {}),
      fields: [],
    };
    const first: DiscordEmbed = { ...embed, fields: [] };
    if (fits({ ...current, embeds: [...cards(), first] }) || cards().length === 0) cards().push(first);
    else newMessage(first);

    for (const field of shownFields(embed)) {
      const withField = (e: DiscordEmbed, f: typeof field) => ({ ...e, fields: [...(e.fields ?? []), f] });
      if (tryWith(withField(card(), field))) {
        cards()[cards().length - 1] = withField(card(), field);
        continue;
      }
      if (fits({ embeds: [withField(continuation, field)] })) {
        newMessage(withField(continuation, field));
        continue;
      }
      // Too long for any one message: line by line, each part under the field's name.
      let lines: string[] = [];
      let name = field.name;
      for (const line of field.value.split('\n')) {
        const part = { name, value: [...lines, line].join('\n') };
        if (tryWith(withField(card(), part))) {
          lines.push(line);
          continue;
        }
        if (lines.length > 0) {
          cards()[cards().length - 1] = withField(card(), { name, value: lines.join('\n') });
          name = `${field.name}${CONTINUED}`;
        }
        newMessage({ ...continuation, fields: [] });
        lines = [line];
      }
      if (lines.length > 0) cards()[cards().length - 1] = withField(card(), { name, value: lines.join('\n') });
    }
  }
  messages.push({ ...current, ...(payload.components ? { components: payload.components } : {}) });
  return messages;
}
