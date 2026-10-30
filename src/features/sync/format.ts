import type { ParseResult, ParsedTransaction, TransactionKind } from '@/features/bank-email/types';

export interface NotifiableEmail {
  gmailId: string;
  subject: string;
  result: ParseResult;
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

function escapeMarkdown(s: string) {
  return s.replace(/([*_~`|\\>])/g, '\\$1');
}

function transactionLine(t: ParsedTransaction) {
  const icon = t.amountCents < 0 ? '🔻' : '🟢';
  return `${icon} **${formatRand(t.amountCents)}** · ${escapeMarkdown(t.description)} · ${t.occurredOn} · ${KIND_LABEL[t.kind]} · acc ${t.accountLast4}`;
}

export function emailLine({ gmailId, subject, result }: NotifiableEmail) {
  switch (result.status) {
    case 'parsed':
      return transactionLine(result.transaction);
    case 'failed':
      return `⚠️ Could not parse "${escapeMarkdown(subject)}" (${gmailId}): ${result.reason}`;
    case 'ignored':
      return `· ignored "${escapeMarkdown(subject)}": ${result.reason}`;
  }
}

// One message for a backlog instead of dozens.
export function summaryMessage(items: NotifiableEmail[]) {
  const amounts = items.flatMap((i) => (i.result.status === 'parsed' ? [i.result.transaction.amountCents] : []));
  const out = amounts.filter((a) => a < 0).reduce((a, b) => a + b, 0);
  const into = amounts.filter((a) => a > 0).reduce((a, b) => a + b, 0);
  const failed = items.filter((i) => i.result.status === 'failed').length;

  let content = `📥 ${amounts.length} transactions · out ${formatRand(out)} · in ${formatRand(into)}`;
  if (failed) content += ` · ⚠️ ${failed} could not parse`;
  for (const [i, item] of items.entries()) {
    const line = `\n${emailLine(item)}`;
    const more = `\n…and ${items.length - i} more`;
    if (content.length + line.length + more.length > DISCORD_LIMIT) return content + more;
    content += line;
  }
  return content;
}
