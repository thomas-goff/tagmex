import 'server-only';
import { env } from '@/env';
import { BOT_NAME, type DiscordPayload } from './embeds';
import { IS_COMPONENTS_V2, toComponents } from './layout';

// Four channels, each its own webhook. Every one falls back to DISCORD_WEBHOOK_URL (#transactions)
// until its webhook is set, so nothing is lost while channels are being created.
//   transactions  each categorised transaction, with its category's budget standing
//   review        each uncategorised transaction; edited in place once it's categorised
//   budget        daily digest, threshold alerts, salary landed / overdue, cycle recap
//   system        parse failures, sync and Gmail token failures, stale sync, heartbeat
export type DiscordChannel = 'transactions' | 'review' | 'budget' | 'system';

// Plain text, or embeds (see ./embeds). Both are posted as Components V2 cards (see ./layout).
export type DiscordMessage = string | DiscordPayload;

// Each channel's own webhook, when it has one.
function ownWebhook(channel: DiscordChannel) {
  return {
    transactions: env.DISCORD_WEBHOOK_URL,
    review: env.DISCORD_REVIEW_WEBHOOK_URL,
    budget: env.DISCORD_BUDGET_WEBHOOK_URL,
    system: env.DISCORD_SYSTEM_WEBHOOK_URL,
  }[channel];
}

function webhookFor(channel: DiscordChannel, path = '', params: Record<string, string> = {}) {
  const url = new URL(ownWebhook(channel) ?? env.DISCORD_WEBHOOK_URL);
  url.pathname += path;
  // Without it, a webhook the app doesn't own ignores `components`, and a Components V2 message
  // is all components.
  url.searchParams.set('with_components', 'true');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export interface PostOptions {
  // @-mention DISCORD_PING_USER_ID (when set). Only for problems that need attention.
  ping?: boolean;
}

// Buttons and dropdowns only go out once interactions are set up (nothing could answer a click
// before that), and only through the channel's own webhook: that's the one the app owns (see the
// README), and a webhook it doesn't own refuses them.
function controls(channel: DiscordChannel, payload: DiscordPayload) {
  return env.DISCORD_PUBLIC_KEY && ownWebhook(channel) ? payload.components : undefined;
}

// The message as Components V2 cards (see ./layout). The controls are part of the layout, so
// leaving them out of an edit removes them.
function componentsBody(channel: DiscordChannel, message: DiscordMessage, mention?: string) {
  const payload = typeof message === 'string' ? { content: message } : message;
  return {
    flags: IS_COMPONENTS_V2,
    components: toComponents({ ...payload, components: controls(channel, payload) ?? [] }, { mention }),
  };
}

// A message from before Components V2, edited the way it was posted. Embeds without a time get
// the posting time, shown next to the footer.
function embedsBody(channel: DiscordChannel, payload: DiscordPayload) {
  const timestamp = new Date().toISOString();
  const components = controls(channel, payload);
  return {
    content: payload.content ?? '',
    embeds: (payload.embeds ?? []).map((e) => ({ timestamp, ...e })),
    ...(components ? { components } : {}),
  };
}

// Posts a message and returns its id, for editing it later.
export async function postMessage(channel: DiscordChannel, message: DiscordMessage, { ping = false }: PostOptions = {}) {
  const userId = ping ? env.DISCORD_PING_USER_ID : undefined;
  const res = await fetch(webhookFor(channel, '', { wait: 'true' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: BOT_NAME,
      ...(env.DISCORD_AVATAR_URL ? { avatar_url: env.DISCORD_AVATAR_URL } : {}),
      ...componentsBody(channel, message, userId),
      // Never let message text (bank descriptions, errors) mention anyone; only the explicit ping.
      allowed_mentions: { parse: [], users: userId ? [userId] : [] },
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}${await errorDetail(res)}`);
  return ((await res.json()) as { id: string }).id;
}

// Edits a message posted through the same channel's webhook. A plain string replaces only the
// text (messages from before embeds); a payload marked `layout: 'embeds'` replaces the text and
// the embeds (messages from before Components V2); any other payload replaces the cards.
export async function editMessage(channel: DiscordChannel, messageId: string, message: DiscordMessage) {
  const body =
    typeof message === 'string'
      ? { content: message }
      : message.layout === 'embeds'
        ? embedsBody(channel, message)
        : componentsBody(channel, message);
  const res = await fetch(webhookFor(channel, `/messages/${encodeURIComponent(messageId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord message edit failed: ${res.status}${await errorDetail(res)}`);
}

// Discord explains a 400 (e.g. a layout limit) in the body: worth having in the logs and #system.
async function errorDetail(res: Response) {
  const text = await res.text().catch(() => '');
  return text ? ` ${text.slice(0, 300)}` : '';
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
