import type { ParseResult, ParsedTransaction, TransactionKind } from '@/features/bank-email/types';

export interface NotifiableEmail {
  gmailId: string;
  subject: string;
  result: ParseResult;
  // Parsed emails: the category name, or null when uncategorised.
  categoryName?: string | null;
  // The category's budget this cycle, e.g. "R450.00 of R4,000.00 (11%)".
  standing?: string | null;
}

// Categorised → #transactions, uncategorised → #needs-review, parse failures → #system.
export function channelFor(item: NotifiableEmail): 'transactions' | 'review' | 'system' {
  if (item.result.status !== 'parsed') return 'system';
  return item.categoryName ? 'transactions' : 'review';
}

// Discord rejects content over 2000 characters.
const DISCORD_LIMIT = 1900;

const KIND_LABEL: Record<TransactionKind, string> = {
  card_purchase: 'card',
  debit_order: 'debit order',
  payment: 'payment',
  transfer: 'transfer',
  credit: 'credit',
  reversal: 'reversal',
  fee: 'fee',
  withdrawal: 'withdrawal',
  other: 'other',
};

export function formatRand(cents: number) {
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}R${rands}.${String(abs % 100).padStart(2, '0')}`;
}

export function escapeMarkdown(s: string) {
  return s.replace(/([*_~`|\\>])/g, '\\$1');
}

export const UNCATEGORISED_LABEL = '❔ **Uncategorised**';

export function categoryLabel(name: string | null | undefined) {
  return name ? `🏷️ ${escapeMarkdown(name)}` : UNCATEGORISED_LABEL;
}

function transactionLine(t: ParsedTransaction, categoryName: string | null | undefined, standing: string | null | undefined) {
  const icon = t.amountCents < 0 ? '🔻' : '🟢';
  const category = standing ? `${categoryLabel(categoryName)} (${standing})` : categoryLabel(categoryName);
  return `${icon} **${formatRand(t.amountCents)}** · ${escapeMarkdown(t.description)} · ${category} · ${t.occurredOn} · ${KIND_LABEL[t.kind]} · acc ${t.accountLast4}`;
}

export function emailLine({ gmailId, subject, result, categoryName, standing }: NotifiableEmail) {
  switch (result.status) {
    case 'parsed':
      return transactionLine(result.transaction, categoryName, standing);
    case 'failed':
      return `⚠️ Could not parse "${escapeMarkdown(subject)}" (${gmailId}): ${result.reason}`;
    case 'ignored':
      return `· ignored "${escapeMarkdown(subject)}": ${result.reason}`;
  }
}

// "🏷️ Groceries 4 · Petrol 2 · ❔ Uncategorised 3", most frequent first, uncategorised last.
function categoryCounts(parsed: NotifiableEmail[]) {
  const counts = new Map<string, number>();
  let uncategorised = 0;
  for (const { categoryName } of parsed) {
    if (categoryName) counts.set(categoryName, (counts.get(categoryName) ?? 0) + 1);
    else uncategorised++;
  }
  const parts = [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([name, n]) => `${categoryLabel(name)} ${n}`);
  if (uncategorised) parts.push(`${UNCATEGORISED_LABEL} ${uncategorised}`);
  return parts.join(' · ');
}

// One message for a backlog instead of dozens.
export function summaryMessage(items: NotifiableEmail[]) {
  const parsed = items.filter((i) => i.result.status === 'parsed');
  const amounts = parsed.flatMap((i) => (i.result.status === 'parsed' ? [i.result.transaction.amountCents] : []));
  const out = amounts.filter((a) => a < 0).reduce((a, b) => a + b, 0);
  const into = amounts.filter((a) => a > 0).reduce((a, b) => a + b, 0);
  const failed = items.filter((i) => i.result.status === 'failed').length;

  let content = `📥 ${amounts.length} transactions · out ${formatRand(out)} · in ${formatRand(into)}`;
  if (failed) content += ` · ⚠️ ${failed} could not parse`;
  if (parsed.length) content += `\n${categoryCounts(parsed)}`;
  for (const [i, item] of items.entries()) {
    const line = `\n${emailLine(item)}`;
    const more = `\n…and ${items.length - i} more`;
    if (content.length + line.length + more.length > DISCORD_LIMIT) return content + more;
    content += line;
  }
  return content;
}
