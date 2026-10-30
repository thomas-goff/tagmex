import 'server-only';
import { env } from '@/env';

// Four channels, each its own webhook. Every one falls back to DISCORD_WEBHOOK_URL (#transactions)
// until its webhook is set, so nothing is lost while channels are being created.
//   transactions  each categorised transaction, with its category's budget standing
//   review        each uncategorised transaction; edited in place once it's categorised
//   budget        daily digest, threshold alerts, salary landed / overdue, cycle recap
//   system        parse failures, sync and Gmail token failures, stale sync, heartbeat
export type DiscordChannel = 'transactions' | 'review' | 'budget' | 'system';

function webhookFor(channel: DiscordChannel) {
  const url = {
    transactions: env.DISCORD_WEBHOOK_URL,
    review: env.DISCORD_REVIEW_WEBHOOK_URL,
    budget: env.DISCORD_BUDGET_WEBHOOK_URL,
    system: env.DISCORD_SYSTEM_WEBHOOK_URL,
  }[channel];
  return url ?? env.DISCORD_WEBHOOK_URL;
}

export interface PostOptions {
  // @-mention DISCORD_PING_USER_ID (when set). Only for problems that need attention.
  ping?: boolean;
}

// Posts a message and returns its id, for editing it later.
export async function postMessage(channel: DiscordChannel, content: string, { ping = false }: PostOptions = {}) {
  const userId = ping ? env.DISCORD_PING_USER_ID : undefined;
  const url = new URL(webhookFor(channel));
  url.searchParams.set('wait', 'true');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: userId ? `<@${userId}> ${content}` : content,
      // Never let message text (bank descriptions, errors) mention anyone; only the explicit ping.
      allowed_mentions: { parse: [], users: userId ? [userId] : [] },
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

// Edits a message posted through the same channel's webhook.
export async function editMessage(channel: DiscordChannel, messageId: string, content: string) {
  const url = new URL(webhookFor(channel));
  url.pathname += `/messages/${encodeURIComponent(messageId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord message edit failed: ${res.status}`);
}

export async function notify(content: string, channel: DiscordChannel = 'transactions', options?: PostOptions) {
  await postMessage(channel, content, options);
}
