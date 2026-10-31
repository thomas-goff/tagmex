import type { BudgetStanding, Payday } from '@/features/budget/standing';
import type { CategoryLine, CategoryStatus } from '@/features/budget/summary';
import { categoryEmoji, UNCATEGORISED_EMOJI } from '@/features/categorisation/emoji';
import { escapeMarkdown, formatRand } from '@/features/sync/format';

// Discord embeds in Pennyworth's voice: a butler who keeps Master Goff's books. Pure functions of
// the data, so every message can be tested without Discord. Text from bank emails is escaped and
// clipped; it never pings anyone (allowed_mentions in discord.ts).

export const BOT_NAME = 'Pennyworth';
export const MASTER = 'Master Goff';

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  // ISO 8601. discord.ts stamps the posting time when it's missing.
  timestamp?: string;
}

// Message components (buttons and dropdowns), in action rows. Only sent once Discord interactions
// are set up (see discord.ts); see ./review-components for the #needs-review controls.
export interface DiscordButton {
  type: 2;
  // 1 primary, 2 secondary, 3 success, 4 danger.
  style: 1 | 2 | 3 | 4;
  label: string;
  custom_id: string;
}

export interface DiscordSelect {
  type: 3;
  custom_id: string;
  placeholder?: string;
  options: { label: string; value: string; default?: boolean }[];
}

export interface DiscordActionRow {
  type: 1;
  components: (DiscordButton | DiscordSelect)[];
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  // [] removes a message's controls when it's edited; leaving it out keeps them.
  components?: DiscordActionRow[];
}

// Discord's limits.
export const LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, total: 6000 } as const;

export const COLOURS = {
  green: 0x2ecc71,
  amber: 0xf1c40f,
  red: 0xe74c3c,
  orange: 0xe67e22,
  blue: 0x3498db,
  grey: 0x95a5a6,
} as const;

const STATUS_COLOUR: Record<CategoryStatus, number> = {
  on_track: COLOURS.green,
  warning: COLOURS.amber,
  over: COLOURS.red,
  settled: COLOURS.blue,
  pending: COLOURS.grey,
  unbudgeted: COLOURS.grey,
};

export function statusColour(status: CategoryStatus) {
  return STATUS_COLOUR[status];
}

export function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// "██████░░░░" for 60%. Over 100% stays full.
export function bar(pct: number, cells = 10) {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return '█'.repeat(filled) + '░'.repeat(cells - filled);
}

export function footer(kind: string, ...details: string[]) {
  return { text: clip(['Your faithful butler', kind, ...details].join(' · '), LIMITS.footer) };
}

// The same transaction always gets the same line, so retries and tests are stable.
export function pick<T>(options: readonly T[], seed: string): T {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = ((hash * 33) ^ seed.charCodeAt(i)) >>> 0;
  return options[hash % options.length]!;
}

function field(name: string, value: string, inline = false) {
  return { name: clip(name, LIMITS.fieldName), value: clip(value || '​', LIMITS.fieldValue), inline };
}

export function categoryTag(name: string | null | undefined, emoji: string | null | undefined) {
  return name ? `${categoryEmoji(emoji)} ${escapeMarkdown(name)}` : `${UNCATEGORISED_EMOJI} Uncategorised`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function paydayText({ daysToSalary, salaryOverdue }: Payday) {
  if (salaryOverdue) return 'Salary is **overdue**';
  if (daysToSalary === null) return 'Salary date unknown';
  if (daysToSalary === 0) return 'Salary is due **today**';
  return `Salary arrives in **${plural(daysToSalary, 'day')}**`;
}

// A category's budget, as the field under a transaction or alert.
export function budgetText(c: BudgetStanding['category']) {
  switch (c.status) {
    case 'settled':
      return [
        `✅ **Settled** · ${formatRand(c.spentCents)} of ${formatRand(c.allocatedCents)}`,
        c.differenceCents > 0 ? `${formatRand(c.differenceCents)} more than budgeted` : null,
        c.differenceCents < 0 ? `${formatRand(-c.differenceCents)} less than budgeted` : null,
      ]
        .filter(Boolean)
        .join('\n');
    case 'pending':
      return `${bar(c.usedPct ?? 0)} ${c.usedPct ?? 0}% paid\n${formatRand(c.remainingCents)} still to go of ${formatRand(c.allocatedCents)}`;
    case 'unbudgeted':
      return `${formatRand(c.spentCents)} this cycle, no budget set`;
    case 'over':
      return `${bar(c.usedPct ?? 0)} ${c.usedPct}% used\n**${formatRand(-c.remainingCents)} over** a budget of ${formatRand(c.allocatedCents)}`;
    default:
      return `${bar(c.usedPct ?? 0)} ${c.usedPct}% used\n**${formatRand(c.remainingCents)}** left of ${formatRand(c.allocatedCents)}`;
  }
}

// ── Transactions ─────────────────────────────────────────────────────────────────────────────────

export interface TransactionInfo {
  // Seeds the butler's wording.
  id: string;
  amountCents: number;
  description: string;
  occurredOn: string;
  kindLabel: string;
  accountLast4: string;
  categoryName: string | null;
  categoryEmoji: string | null;
  standing: BudgetStanding | null;
}

const PURCHASE_TITLES = [`A purchase, ${MASTER}`, `An expenditure, ${MASTER}`, `Another purchase, ${MASTER}`] as const;
const PURCHASE_LINES = [
  'I took the liberty of noting your latest expenditure, sir.',
  'Duly entered in the ledger, sir.',
  'I have recorded this in the accounts, sir.',
] as const;
const DEPOSIT_TITLES = [`A deposit, ${MASTER}`, `Money in, ${MASTER}`] as const;
const DEPOSIT_LINES = ['Funds have arrived, sir. Most welcome.', 'A pleasant addition to the accounts, sir.'] as const;

function transactionFields(t: TransactionInfo) {
  return [
    field('💳 Amount', formatRand(t.amountCents < 0 ? -t.amountCents : t.amountCents), true),
    field('🏪 Merchant', escapeMarkdown(t.description), true),
    field('🏷️ Category', categoryTag(t.categoryName, t.categoryEmoji), true),
  ];
}

function transactionFooter(kind: string, t: TransactionInfo) {
  return footer(kind, `${t.kindLabel} · acc ${t.accountLast4} · ${t.occurredOn}`);
}

export function transactionEmbed(t: TransactionInfo): DiscordEmbed {
  const out = t.amountCents < 0;
  const fields = transactionFields(t);
  const { standing } = t;
  if (standing) {
    const c = standing.category;
    fields.push(field(`${categoryEmoji(c.emoji)} ${escapeMarkdown(c.name)} budget`, budgetText(c)));
    fields.push(field('📅 Payday', paydayText(standing.payday)));
  }
  return {
    title: out ? `🧾 ${pick(PURCHASE_TITLES, t.id)}` : `💰 ${pick(DEPOSIT_TITLES, t.id)}`,
    description: out ? pick(PURCHASE_LINES, t.id) : pick(DEPOSIT_LINES, t.id),
    color: standing ? statusColour(standing.category.status) : out ? COLOURS.grey : COLOURS.green,
    fields,
    footer: transactionFooter('Transaction', t),
  };
}

// #needs-review: one per uncategorised transaction, edited once it's sorted.
export function reviewEmbed(t: TransactionInfo): DiscordEmbed {
  return {
    title: `🧐 An unfamiliar transaction, ${MASTER}`,
    description: "I couldn't place this one, sir. Tell Claude where it belongs and I'll remember it next time.",
    color: COLOURS.grey,
    fields: transactionFields(t),
    footer: transactionFooter('Needs review', t),
  };
}

export const SUGGESTION_FIELD = '💡 Claude suggests';

// The review message with a suggestion: "🛒 Groceries" and why, or that Claude couldn't place it.
// Replaces an earlier suggestion; `components` are the controls rebuilt to offer it.
export function suggestedReviewPayload(
  payload: DiscordPayload,
  suggestion: { category: { name: string; emoji: string | null } | null; note: string | null },
  components: DiscordActionRow[],
): DiscordPayload {
  const guess = suggestion.category ? categoryTag(suggestion.category.name, suggestion.category.emoji) : "🤔 Not sure, sir. This one's yours.";
  const value = suggestion.note ? `${guess}\n${escapeMarkdown(suggestion.note)}` : guess;
  return {
    ...payload,
    embeds: (payload.embeds ?? []).map((embed, i) =>
      i > 0 ? embed : { ...embed, fields: [...(embed.fields ?? []).filter((f) => f.name !== SUGGESTION_FIELD), field(SUGGESTION_FIELD, value)] },
    ),
    components,
  };
}

// The review message once it's categorised (outcome "🛒 Groceries") or excluded ("🗑️ excluded"):
// the suggestion and the controls go.
export function resolvedReviewPayload(payload: DiscordPayload, outcome: string): DiscordPayload {
  return {
    ...payload,
    embeds: (payload.embeds ?? []).map((embed, i) =>
      i > 0
        ? embed
        : {
            ...embed,
            title: `✅ Sorted, ${MASTER}`,
            description: 'Filed away, sir.',
            color: COLOURS.green,
            fields: (embed.fields ?? [])
              .filter((f) => f.name !== SUGGESTION_FIELD)
              .map((f) => (f.name === '🏷️ Category' ? { ...f, value: clip(outcome, LIMITS.fieldValue) } : f)),
          },
    ),
    components: [],
  };
}

// One message for a backlog: the totals, a count per category and a line per transaction.
export function backlogEmbed(items: TransactionInfo[], failed: number, extra?: string): DiscordEmbed {
  const out = items.filter((t) => t.amountCents < 0).reduce((sum, t) => sum + t.amountCents, 0);
  const into = items.filter((t) => t.amountCents > 0).reduce((sum, t) => sum + t.amountCents, 0);

  const counts = new Map<string, { emoji: string | null; n: number }>();
  let uncategorised = 0;
  for (const t of items) {
    if (!t.categoryName) uncategorised++;
    else counts.set(t.categoryName, { emoji: t.categoryEmoji, n: (counts.get(t.categoryName)?.n ?? 0) + 1 });
  }
  const countLine = [
    ...[...counts]
      .sort(([a, x], [b, y]) => y.n - x.n || a.localeCompare(b))
      .map(([name, { emoji, n }]) => `${categoryTag(name, emoji)} ${n}`),
    ...(uncategorised ? [`${UNCATEGORISED_EMOJI} Uncategorised ${uncategorised}`] : []),
  ].join(' · ');

  const header = [
    `Out ${formatRand(-out)} · in ${formatRand(into)}${failed ? ` · ⚠️ ${failed} could not be read` : ''}`,
    countLine,
    extra,
  ]
    .filter(Boolean)
    .join('\n');
  // Room for the header, the "…and N more" line and the rest of the embed.
  const budget = LIMITS.description - header.length - 40;
  const lines: string[] = [];
  let used = 0;
  for (const [i, t] of items.entries()) {
    const line = `${t.categoryName ? categoryEmoji(t.categoryEmoji) : UNCATEGORISED_EMOJI} **${formatRand(t.amountCents)}** · ${escapeMarkdown(clip(t.description, 60))} · ${t.occurredOn}`;
    if (used + line.length + 1 > budget) {
      lines.push(`…and ${items.length - i} more`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return {
    title: `📥 ${plural(items.length, 'transaction')}, ${MASTER}`,
    description: clip(`${header}\n\n${lines.join('\n')}`, LIMITS.description),
    color: uncategorised ? COLOURS.grey : COLOURS.blue,
    footer: footer('Ledger catch-up'),
  };
}

// ── Budget ───────────────────────────────────────────────────────────────────────────────────────

export interface DigestInput {
  dateLabel: string;
  cycleLabel: string;
  payday: Payday;
  paydayDateLabel: string;
  discretionaryLeftCents: number;
  dailyAllowanceCents: number | null;
  spentCents: number;
  allocatedCents: number;
  categories: Pick<CategoryLine, 'name' | 'emoji' | 'expenseType' | 'allocatedCents' | 'spentCents' | 'remainingCents' | 'usedPct' | 'status' | 'isActive'>[];
  pending: { name: string; emoji: string | null; allocatedCents: number; dueLabel: string | null; late: boolean }[];
  pendingTotalCents: number;
  uncategorised: { count: number; outCents: number };
  tips: string[];
  yesterday: { dateLabel: string; outCents: number; count: number } | null;
}

function digestColour(d: DigestInput) {
  if (d.payday.salaryOverdue || d.categories.some((c) => c.status === 'over')) return COLOURS.red;
  if (d.categories.some((c) => c.status === 'warning') || d.pending.some((p) => p.late)) return COLOURS.amber;
  return COLOURS.green;
}

export function digestEmbed(d: DigestInput, title = `☀️ Good morning, ${MASTER}`): DiscordEmbed {
  const fields = [
    field('📅 Payday', `${paydayText(d.payday)}${d.payday.salaryOverdue ? ` (was due ${d.paydayDateLabel})` : ` (${d.paydayDateLabel})`}`, true),
    field(
      '🧮 To spend',
      `${d.dailyAllowanceCents === null ? '' : `**${formatRand(d.dailyAllowanceCents)}/day** · `}${formatRand(d.discretionaryLeftCents)} left`,
      true,
    ),
    field('💸 Spent', `${formatRand(d.spentCents)} of ${formatRand(d.allocatedCents)} budgeted`, true),
  ];
  if (d.yesterday) {
    const { dateLabel, outCents, count } = d.yesterday;
    fields.push(field(`🧾 Yesterday (${dateLabel})`, count === 0 ? 'Nothing went out, sir.' : `${formatRand(outCents)} out across ${plural(count, 'transaction')}`));
  }

  const budgets = d.categories
    .filter((c) => c.isActive && c.allocatedCents > 0 && c.status !== 'settled' && c.expenseType !== 'static')
    .map((c) => {
      const tail = c.status === 'over' ? `**${formatRand(-c.remainingCents)} over**` : `${formatRand(c.remainingCents)} left`;
      return `${categoryEmoji(c.emoji)} ${escapeMarkdown(c.name)} \`${bar(c.usedPct ?? 0, 8)}\` ${c.usedPct}% · ${tail}`;
    });
  if (budgets.length > 0) fields.push(field('📊 Budgets', budgets.join('\n')));

  const settled = d.categories.filter((c) => c.status === 'settled');
  if (settled.length > 0) fields.push(field('✅ Settled', settled.map((c) => categoryTag(c.name, c.emoji)).join(', ')));

  if (d.pending.length > 0) {
    fields.push(
      field(
        `🗓️ Debit orders to come · ${formatRand(d.pendingTotalCents)}`,
        d.pending
          .map((p) => `${categoryTag(p.name, p.emoji)} ${formatRand(p.allocatedCents)}${p.dueLabel ? ` · ${p.late ? '**late**, ' : ''}${p.dueLabel}` : ''}`)
          .join('\n'),
      ),
    );
  }
  if (d.uncategorised.count > 0) {
    fields.push(field('❔ Uncategorised', `${plural(d.uncategorised.count, 'transaction')} (${formatRand(-d.uncategorised.outCents)}) await your word, sir. Ask Claude to sort them.`));
  }
  if (d.tips.length > 0) fields.push(field('💡 A thought, sir', d.tips.map((t) => `• ${escapeMarkdown(t)}`).join('\n')));

  return {
    title,
    description: `Your accounts for ${d.dateLabel} · ${d.cycleLabel} cycle`,
    color: digestColour(d),
    fields,
    footer: footer('Daily report'),
  };
}

export function thresholdEmbed(c: BudgetStanding['category'], payday: Payday, pct: number): DiscordEmbed {
  const over = pct >= 100;
  const name = `${categoryEmoji(c.emoji)} ${escapeMarkdown(c.name)}`;
  return {
    title: over ? `🔴 ${name} is over budget, ${MASTER}` : `⚠️ ${name} is at ${c.usedPct}%, ${MASTER}`,
    description: over ? "I'm afraid we've overstepped, sir." : 'A gentle word of caution, sir.',
    color: over ? COLOURS.red : COLOURS.amber,
    fields: [field(`${name} budget`, budgetText(c)), field('📅 Payday', paydayText(payday))],
    footer: footer('Budget alert'),
  };
}

export function salaryLandedEmbed(input: { amountCents: number; landedLabel: string; cycleLabel: string; nextLabel: string; nextProjected: boolean; recap: string | null }): DiscordEmbed {
  const fields = [field('📅 Next salary', `${input.nextProjected ? 'Expected' : 'On'} ${input.nextLabel}`)];
  if (input.recap) fields.push(field('📒 Last cycle', input.recap));
  return {
    title: `💰 Payday, ${MASTER}`,
    description: `Your salary of **${formatRand(input.amountCents)}** arrived on ${input.landedLabel}, sir. The ${input.cycleLabel} cycle has begun.`,
    color: COLOURS.green,
    fields,
    footer: footer('Budget alert'),
  };
}

export function salaryOverdueEmbed(dueLabel: string): DiscordEmbed {
  return {
    title: `⏰ Salary overdue, ${MASTER}`,
    description: `It was expected on ${dueLabel} and hasn't shown up, sir. If it has landed, make sure it's categorised as Salary.`,
    color: COLOURS.red,
    footer: footer('Budget alert'),
  };
}

// A note Claude posts on the user's behalf (post_status_to_discord). The message text says it's
// from Claude.
export function claudeNoteEmbed(note: string): DiscordEmbed {
  return {
    description: clip(note, LIMITS.description),
    color: COLOURS.blue,
    footer: footer('Relayed on request'),
  };
}

// ── System ───────────────────────────────────────────────────────────────────────────────────────

export function systemEmbed(title: string, description: string, colour: number = COLOURS.red): DiscordEmbed {
  return { title: clip(title, LIMITS.title), description: clip(description, LIMITS.description), color: colour, footer: footer('System') };
}

// ── Helpers for previews, logs and tests ─────────────────────────────────────────────────────────

// All the text of a payload, flattened: dry-run previews and the MCP tool's reply show this.
export function payloadText(payload: DiscordPayload | string) {
  if (typeof payload === 'string') return payload;
  const parts = payload.content ? [payload.content] : [];
  for (const e of payload.embeds ?? []) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    for (const f of e.fields ?? []) parts.push(`${f.name}: ${f.value}`);
    if (e.footer) parts.push(e.footer.text);
  }
  return parts.join('\n');
}

// Characters that count towards Discord's 6000 per message.
export function embedLength(e: DiscordEmbed) {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}
