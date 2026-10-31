import {
  backlogEmbed,
  reviewEmbed,
  systemEmbed,
  transactionEmbed,
  COLOURS,
  type DiscordPayload,
  type TransactionInfo,
} from '@/features/notifications/embeds';
import type { ParsedTransaction } from '@/features/bank-email/types';
import { escapeMarkdown, KIND_LABEL, type NotifiableEmail } from './format';

// What each bank email posts to Discord. `prefix` (e.g. "[dry run]") goes in the message text.

function info(item: NotifiableEmail, t: ParsedTransaction): TransactionInfo {
  return {
    id: item.gmailId,
    amountCents: t.amountCents,
    description: t.description,
    occurredOn: t.occurredOn,
    kindLabel: KIND_LABEL[t.kind],
    accountLast4: t.accountLast4,
    categoryName: item.categoryName ?? null,
    categoryEmoji: item.categoryEmoji ?? null,
    standing: item.standing ?? null,
  };
}

const withPrefix = (prefix: string, payload: DiscordPayload): DiscordPayload => (prefix ? { content: prefix.trim(), ...payload } : payload);

export function emailPayload(item: NotifiableEmail, prefix = ''): DiscordPayload {
  const { result } = item;
  switch (result.status) {
    case 'parsed': {
      const t = info(item, result.transaction);
      return withPrefix(prefix, { embeds: [item.categoryName ? transactionEmbed(t) : reviewEmbed(t)] });
    }
    case 'failed':
      return withPrefix(prefix, {
        embeds: [systemEmbed(`⚠️ I couldn't read a bank email, Master Goff`, `"${escapeMarkdown(item.subject)}" (${item.gmailId}): ${result.reason}`)],
      });
    case 'ignored':
      return withPrefix(prefix, {
        embeds: [systemEmbed('· Ignored a bank email', `"${escapeMarkdown(item.subject)}": ${result.reason}`, COLOURS.grey)],
      });
  }
}

// One message for many emails.
export function backlogPayload(items: NotifiableEmail[], prefix = '', extra?: string): DiscordPayload {
  const parsed = items.flatMap((i) => (i.result.status === 'parsed' ? [info(i, i.result.transaction)] : []));
  const failed = items.filter((i) => i.result.status === 'failed').length;
  return withPrefix(prefix, { embeds: [backlogEmbed(parsed, failed, extra)] });
}
