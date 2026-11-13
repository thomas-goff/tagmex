import type { BudgetStanding, Payday } from '@/features/budget/standing';
import type { CategoryLine, CategoryStatus } from '@/features/budget/summary';
import { categoryEmoji, UNCATEGORISED_EMOJI } from '@/features/categorisation/emoji';
import { shortDate } from '@/features/cycle/dates';
import { escapeMarkdown, formatRand } from '@/features/sync/format';

// Discord messages from Pennyworth, a butler who keeps Master Goff's books, described as embeds:
// discord.ts posts each embed as a Components V2 card (see ./layout). Short on purpose: the
// numbers lead, the butler only shows in a greeting or two. Pure functions of the data, so every
// message can be tested without Discord. Text from bank emails is escaped and clipped; it never
// pings anyone (allowed_mentions in discord.ts). Footers only where they add something (a
// transaction's account and date): Discord shows the posting time anyway.

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
  // The controls. When editing a Components V2 message they're part of the layout, so [] and
  // leaving them out both remove them; on an 'embeds' message, leaving them out keeps them.
  components?: DiscordActionRow[];
  // How the message is on Discord. 'components' (the default): Components V2 cards, built from
  // the embeds by ./layout. 'embeds': a message posted before that, which can only be edited as
  // embeds (#needs-review rows stored before the switch).
  layout?: 'components' | 'embeds';
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

function field(name: string, value: string, inline = false) {
  return { name: clip(name, LIMITS.fieldName), value: clip(value || '​', LIMITS.fieldValue), inline };
}

export function categoryTag(name: string | null | undefined, emoji: string | null | undefined) {
  return name ? `${categoryEmoji(emoji)} ${escapeMarkdown(name)}` : `${UNCATEGORISED_EMOJI} Uncategorised`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "Payday in 6 days". Null when the date isn't known (and salary isn't overdue either).
export function paydayText({ daysToSalary, salaryOverdue }: Payday) {
  if (salaryOverdue) return 'Salary is **overdue**';
  if (daysToSalary === null) return null;
  if (daysToSalary === 0) return 'Payday is **today**';
  return `Payday in ${plural(daysToSalary, 'day')}`;
}

// A category's budget in one line, under a transaction or in an alert.
export function budgetText(c: BudgetStanding['category']) {
  switch (c.status) {
    case 'settled': {
      const diff =
        c.differenceCents > 0
          ? ` (${formatRand(c.differenceCents)} above budget)`
          : c.differenceCents < 0
            ? ` (${formatRand(-c.differenceCents)} below budget)`
            : '';
      return `✅ Paid ${formatRand(c.spentCents)}${diff}`;
    }
    case 'pending':
      return `${formatRand(c.spentCents)} of ${formatRand(c.allocatedCents)} paid · ${formatRand(c.remainingCents)} to go`;
    case 'unbudgeted':
      return `${formatRand(c.spentCents)} this cycle · no budget set`;
    case 'over':
      return `\`${bar(c.usedPct ?? 0)}\` ${c.usedPct}% · **${formatRand(-c.remainingCents)} over** a ${formatRand(c.allocatedCents)} budget`;
    default:
      return `\`${bar(c.usedPct ?? 0)}\` ${c.usedPct}% · ${formatRand(c.remainingCents)} left of ${formatRand(c.allocatedCents)}`;
  }
}

// ── Transactions ─────────────────────────────────────────────────────────────────────────────────

export interface TransactionInfo {
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

// Title: the amount. Description: the merchant (bank text, so it stays out of the title, where
// markdown escaping can show), then what the message is about. Footer: where the money moved.
function transactionTitle(icon: string, t: TransactionInfo) {
  return `${icon} ${formatRand(Math.abs(t.amountCents))}`;
}

const merchant = (t: TransactionInfo) => `**${escapeMarkdown(clip(t.description, 200))}**`;

function transactionFooter(t: TransactionInfo) {
  return { text: `${t.kindLabel} · acc ${t.accountLast4} · ${shortDate(t.occurredOn)}` };
}

export function transactionEmbed(t: TransactionInfo): DiscordEmbed {
  const out = t.amountCents < 0;
  const { standing } = t;
  const lines = [`${merchant(t)} · ${categoryTag(t.categoryName, t.categoryEmoji)}`];
  if (standing) lines.push(budgetText(standing.category));
  return {
    title: transactionTitle(out ? '🧾' : '💰', t),
    description: lines.join('\n'),
    color: standing ? statusColour(standing.category.status) : out ? COLOURS.grey : COLOURS.green,
    footer: transactionFooter(t),
  };
}

const REVIEW_ICON = '🧐';

// #needs-review: one per uncategorised transaction, edited once it's sorted.
export function reviewEmbed(t: TransactionInfo): DiscordEmbed {
  return {
    title: transactionTitle(REVIEW_ICON, t),
    description: `${merchant(t)} · ${UNCATEGORISED_EMOJI} needs a category\nPick one or tell Claude, and I'll remember it next time.`,
    color: COLOURS.grey,
    footer: transactionFooter(t),
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
  const guess = suggestion.category ? categoryTag(suggestion.category.name, suggestion.category.emoji) : "🤔 Not sure. This one's yours.";
  const value = suggestion.note ? `${guess}\n${escapeMarkdown(suggestion.note)}` : guess;
  return {
    ...payload,
    embeds: (payload.embeds ?? []).map((embed, i) =>
      i > 0 ? embed : { ...embed, fields: [...(embed.fields ?? []).filter((f) => f.name !== SUGGESTION_FIELD), field(SUGGESTION_FIELD, value)] },
    ),
    components,
  };
}

// Review messages posted before the messages were trimmed keep the category in a field.
const LEGACY_CATEGORY_FIELD = '🏷️ Category';

function resolvedEmbed(embed: DiscordEmbed, outcome: string): DiscordEmbed {
  const fields = (embed.fields ?? []).filter((f) => f.name !== SUGGESTION_FIELD);
  if (fields.some((f) => f.name === LEGACY_CATEGORY_FIELD)) {
    return {
      ...embed,
      title: `✅ Sorted, ${MASTER}`,
      description: 'Filed away.',
      color: COLOURS.green,
      fields: fields.map((f) => (f.name === LEGACY_CATEGORY_FIELD ? { ...f, value: clip(outcome, LIMITS.fieldValue) } : f)),
    };
  }
  // "🧐 R72.00" / "**CORNER SHOP** · ❔ needs a category\n…" → "✅ R72.00" / "**CORNER SHOP** · 🛒 Groceries".
  const merchantLine = (embed.description ?? '').split('\n')[0]!.split(' · ')[0]!;
  return {
    ...embed,
    title: embed.title?.startsWith(`${REVIEW_ICON} `) ? `✅ ${embed.title.slice(REVIEW_ICON.length + 1)}` : embed.title,
    description: clip(merchantLine ? `${merchantLine} · ${outcome}` : outcome, LIMITS.description),
    color: COLOURS.green,
    fields,
  };
}

// The review message once it's categorised (outcome "🛒 Groceries") or excluded ("🗑️ excluded"):
// the suggestion and the controls go.
export function resolvedReviewPayload(payload: DiscordPayload, outcome: string): DiscordPayload {
  return {
    ...payload,
    embeds: (payload.embeds ?? []).map((embed, i) => (i > 0 ? embed : resolvedEmbed(embed, outcome))),
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
    title: `📥 ${plural(items.length, 'transaction')}`,
    description: clip(`${header}\n\n${lines.join('\n')}`, LIMITS.description),
    color: uncategorised ? COLOURS.grey : COLOURS.blue,
  };
}

// ── Budget ───────────────────────────────────────────────────────────────────────────────────────

// The daily digest is two messages: the spending budgets, then payday and debit orders.

type DigestCategory = Pick<
  CategoryLine,
  'name' | 'emoji' | 'expenseType' | 'allocatedCents' | 'spentCents' | 'remainingCents' | 'usedPct' | 'status' | 'isActive' | 'differenceCents'
>;

export interface DigestInput {
  discretionaryLeftCents: number;
  dailyAllowanceCents: number | null;
  categories: DigestCategory[];
  uncategorised: { count: number; outCents: number };
  tips: string[];
  yesterday: { outCents: number; count: number } | null;
}

export interface DebitOrdersInput {
  payday: Payday;
  paydayDateLabel: string;
  paydayProjected: boolean;
  salary: { amountCents: number; landedLabel: string } | null;
  categories: DigestCategory[];
  pending: { name: string; emoji: string | null; allocatedCents: number; dueLabel: string | null; late: boolean }[];
  pendingTotalCents: number;
}

// Lines joined into one field value. Whole lines only: a line cut in half breaks its markdown, so
// what doesn't fit becomes "…and N more".
export function fieldLines(lines: string[], limit: number = LIMITS.fieldValue) {
  const out: string[] = [];
  let used = 0;
  for (const [i, line] of lines.entries()) {
    const sep = out.length > 0 ? 1 : 0;
    // Room for the "…and N more" that would follow this line.
    const more = i < lines.length - 1 ? `\n…and ${lines.length - i - 1} more`.length : 0;
    if (used + sep + line.length + more > limit) {
      out.push(`…and ${lines.length - i} more`);
      break;
    }
    out.push(line);
    used += sep + line.length;
  }
  return out.join('\n');
}

function digestColour(d: DigestInput) {
  if (d.categories.some((c) => c.status === 'over')) return COLOURS.red;
  if (d.categories.some((c) => c.status === 'warning')) return COLOURS.amber;
  return COLOURS.green;
}

// Message one: what's left to spend, then each spending budget.
//   **R89.28 a day** until payday · R2,500.00 left to spend
//   Yesterday: R250.00 out (2 transactions)
//   ❔ 1 transaction (R72.00) needs a category
export function digestEmbed(d: DigestInput, title = `☀️ Good morning, ${MASTER}`): DiscordEmbed {
  const left = `${formatRand(d.discretionaryLeftCents)} left to spend`;
  const lines = [d.dailyAllowanceCents === null ? `**${left}**` : `**${formatRand(d.dailyAllowanceCents)} a day** until payday · ${left}`];
  if (d.yesterday) {
    const { outCents, count } = d.yesterday;
    lines.push(count === 0 ? 'Yesterday: nothing out' : `Yesterday: ${formatRand(outCents)} out (${plural(count, 'transaction')})`);
  }
  if (d.uncategorised.count > 0) {
    lines.push(`${UNCATEGORISED_EMOJI} ${plural(d.uncategorised.count, 'transaction')} (${formatRand(Math.abs(d.uncategorised.outCents))}) ${d.uncategorised.count === 1 ? 'needs' : 'need'} a category`);
  }

  const fields = [];
  const budgets = d.categories
    .filter((c) => c.isActive && c.allocatedCents > 0 && c.expenseType !== 'static')
    .map((c) => {
      const tail = c.status === 'over' ? `**${formatRand(-c.remainingCents)} over**` : `${formatRand(c.remainingCents)} left`;
      return `${categoryEmoji(c.emoji)} ${escapeMarkdown(c.name)} \`${bar(c.usedPct ?? 0, 8)}\` ${c.usedPct}% · ${tail}`;
    });
  if (budgets.length > 0) fields.push(field('📊 Budgets', fieldLines(budgets)));
  if (d.tips.length > 0) fields.push(field('💡 Worth knowing', fieldLines(d.tips.map((t) => `• ${escapeMarkdown(t)}`))));

  return { title, description: lines.join('\n'), color: digestColour(d), fields };
}

// Message two: when the next salary comes, then the debit orders still to come and those paid.
//   Next payday **Mon 30 Nov**, in 28 days (estimated)
//   Last salary R30,713.54 on Fri 30 Oct
export function debitOrdersEmbed(d: DebitOrdersInput, title = '🗓️ Payday & debit orders'): DiscordEmbed {
  const { payday, paydayDateLabel: date } = d;
  const estimated = d.paydayProjected ? ' (estimated)' : '';
  const next = payday.salaryOverdue
    ? `Salary **overdue**: it was due ${date}`
    : payday.daysToSalary === 0
      ? `Payday is **today**, ${date}`
      : payday.daysToSalary === null
        ? `Next payday **${date}**${estimated}`
        : `Next payday **${date}**, in ${plural(payday.daysToSalary, 'day')}${estimated}`;
  const lines = [next, d.salary ? `Last salary ${formatRand(d.salary.amountCents)} on ${d.salary.landedLabel}` : 'No salary seen this cycle yet'];

  const fields = [];
  const fixed = d.categories.filter((c) => c.isActive && c.expenseType === 'static' && c.allocatedCents > 0);
  if (d.pending.length > 0) {
    fields.push(
      field(
        `🗓️ Still to come · ${formatRand(d.pendingTotalCents)}`,
        fieldLines(
          d.pending.map((p) => {
            const due = p.dueLabel ? (p.late ? ` · **late** (due ${p.dueLabel})` : ` · due ${p.dueLabel}`) : '';
            return `${categoryTag(p.name, p.emoji)} ${formatRand(p.allocatedCents)}${due}`;
          }),
        ),
      ),
    );
  } else if (fixed.length > 0) {
    fields.push(field('🗓️ Still to come', 'Nothing left this cycle.'));
  }

  const paid = fixed.filter((c) => c.spentCents > 0);
  if (paid.length > 0) {
    const paidCents = paid.reduce((sum, c) => sum + c.spentCents, 0);
    fields.push(
      field(
        `✅ Paid · ${formatRand(paidCents)}`,
        fieldLines(
          paid.map((c) => {
            const amount = c.status === 'settled' ? formatRand(c.spentCents) : `${formatRand(c.spentCents)} of ${formatRand(c.allocatedCents)}`;
            const diff =
              c.status === 'settled' && c.differenceCents
                ? ` (${formatRand(Math.abs(c.differenceCents))} ${c.differenceCents > 0 ? 'above' : 'below'} budget)`
                : '';
            return `${categoryTag(c.name, c.emoji)} ${amount}${diff}`;
          }),
        ),
      ),
    );
  }

  return {
    title,
    description: lines.join('\n'),
    color: payday.salaryOverdue ? COLOURS.red : d.pending.some((p) => p.late) ? COLOURS.amber : COLOURS.blue,
    fields,
  };
}

export function thresholdEmbed(c: BudgetStanding['category'], payday: Payday, pct: number): DiscordEmbed {
  const over = pct >= 100;
  const name = `${categoryEmoji(c.emoji)} ${escapeMarkdown(c.name)}`;
  return {
    title: over ? `🔴 ${name} is over budget` : `⚠️ ${name} is at ${c.usedPct}%`,
    description: [budgetText(c), paydayText(payday)].filter(Boolean).join('\n'),
    color: over ? COLOURS.red : COLOURS.amber,
  };
}

export function salaryLandedEmbed(input: { amountCents: number; landedLabel: string; nextLabel: string; nextProjected: boolean; recap: string | null }): DiscordEmbed {
  return {
    title: `💰 Payday, ${MASTER}`,
    description: `**${formatRand(input.amountCents)}** landed ${input.landedLabel}. Next payday ${input.nextLabel}${input.nextProjected ? ' (estimated)' : ''}.`,
    color: COLOURS.green,
    fields: input.recap ? [field('📒 Last cycle', input.recap)] : [],
  };
}

export function salaryOverdueEmbed(dueLabel: string): DiscordEmbed {
  return {
    title: '⏰ Salary overdue',
    description: `It was due ${dueLabel} and hasn't shown up. If it has landed, check it's categorised as Salary.`,
    color: COLOURS.red,
  };
}

// ── System ───────────────────────────────────────────────────────────────────────────────────────

export function systemEmbed(title: string, description: string, colour: number = COLOURS.red): DiscordEmbed {
  return { title: clip(title, LIMITS.title), description: clip(description, LIMITS.description), color: colour };
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
