import 'server-only';
import { env } from '@/env';
import { BOT_NAME, type DiscordPayload } from './embeds';

// Four channels, each its own webhook. Every one falls back to DISCORD_WEBHOOK_URL (#transactions)
// until its webhook is set, so nothing is lost while channels are being created.
//   transactions  each categorised transaction, with its category's budget standing
//   review        each uncategorised transaction; edited in place once it's categorised
//   budget        daily digest, threshold alerts, salary landed / overdue, cycle recap
//   system        parse failures, sync and Gmail token failures, stale sync, heartbeat
export type DiscordChannel = 'transactions' | 'review' | 'budget' | 'system';

// Plain text, or embeds (see ./embeds).
export type DiscordMessage = string | DiscordPayload;

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

// Embeds without a time get the posting time, shown next to the footer. Components only go out
// once interactions are set up: nothing could answer a click before that.
function body(message: DiscordMessage) {
  const payload = typeof message === 'string' ? { content: message } : message;
  const timestamp = new Date().toISOString();
  return {
    content: payload.content ?? '',
    embeds: (payload.embeds ?? []).map((e) => ({ timestamp, ...e })),
    ...(env.DISCORD_PUBLIC_KEY && payload.components ? { components: payload.components } : {}),
  };
}

// Posts a message and returns its id, for editing it later.
export async function postMessage(channel: DiscordChannel, message: DiscordMessage, { ping = false }: PostOptions = {}) {
  const userId = ping ? env.DISCORD_PING_USER_ID : undefined;
  const { content, ...rest } = body(message);
  const url = new URL(webhookFor(channel));
  url.searchParams.set('wait', 'true');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: BOT_NAME,
      ...(env.DISCORD_AVATAR_URL ? { avatar_url: env.DISCORD_AVATAR_URL } : {}),
      // A mention inside an embed never notifies, so the ping goes in the message text.
      content: userId ? `<@${userId}> ${content}`.trim() : content,
      ...rest,
      // Never let message text (bank descriptions, errors) mention anyone; only the explicit ping.
      allowed_mentions: { parse: [], users: userId ? [userId] : [] },
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

// Edits a message posted through the same channel's webhook. A plain string replaces only the
// text (messages from before embeds); a payload replaces the text and the embeds.
export async function editMessage(channel: DiscordChannel, messageId: string, message: DiscordMessage) {
  const url = new URL(webhookFor(channel));
  url.pathname += `/messages/${encodeURIComponent(messageId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(typeof message === 'string' ? { content: message } : body(message)),
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) throw new Error(`Discord message edit failed: ${res.status}`);
}

// Replies to a button or dropdown click, through the interaction's own token (valid 15 minutes).
// Follow-ups are ephemeral: only whoever clicked sees them.
const INTERACTIONS_API = 'https://discord.com/api/v10/webhooks';

export interface InteractionReply {
  content: string;
  components?: DiscordPayload['components'];
}

export async function followUpInteraction(applicationId: string, token: string, reply: InteractionReply) {
  await interactionRequest('POST', `${applicationId}/${token}`, { ...reply, flags: 64 });
}

// Edits the message the clicked control was on (used for the ephemeral "file all N?" reply).
export async function editInteractionMessage(applicationId: string, token: string, reply: InteractionReply) {
  await interactionRequest('PATCH', `${applicationId}/${token}/messages/@original`, reply);
}

async function interactionRequest(method: string, path: string, body: object) {
  const res = await fetch(`${INTERACTIONS_API}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord interaction reply failed: ${res.status}`);
}

export async function notify(message: DiscordMessage, channel: DiscordChannel = 'transactions', options?: PostOptions) {
  await postMessage(channel, message, options);
}
