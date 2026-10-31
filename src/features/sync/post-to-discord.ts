import 'server-only';
import { postMessage, type DiscordChannel } from '@/features/notifications/discord';
import type { DiscordPayload } from '@/features/notifications/embeds';
import { backlogPayload, emailPayload } from './email-payload';
import { channelFor, type NotifiableEmail } from './format';

// Above this many, a channel gets one summary instead of a message per email.
const SUMMARY_THRESHOLD = 8;
// Uncategorised transactions each get their own #needs-review message, so it can be edited once
// they're sorted. Past this many in one run (a backlog) the rest are summarised.
const REVIEW_LIMIT = 15;

interface Options<T> {
  prefix?: string;
  // Send everything to one channel instead (dry runs go to #system).
  channel?: DiscordChannel;
  // After every successful post, with what it covered, so the caller records what reached Discord.
  onPosted?: (posted: T[]) => Promise<void>;
  // A #needs-review message posted for one item: its id and what was posted, to edit later.
  onReviewMessage?: (item: T, messageId: string, payload: DiscordPayload) => Promise<void>;
  // The controls under an item's #needs-review message (category dropdown, Exclude).
  reviewComponents?: (item: T) => DiscordPayload['components'];
}

export async function postToDiscord<T extends NotifiableEmail>(
  items: T[],
  { prefix = '', channel, onPosted = async () => {}, onReviewMessage, reviewComponents }: Options<T> = {},
) {
  const groups = new Map<DiscordChannel, T[]>();
  for (const item of items) {
    const target = channel ?? channelFor(item);
    groups.set(target, [...(groups.get(target) ?? []), item]);
  }

  for (const [target, group] of groups) {
    if (target === 'review' && !channel) {
      for (const item of group.slice(0, REVIEW_LIMIT)) {
        const components = reviewComponents?.(item);
        const payload = components ? { ...emailPayload(item, prefix), components } : emailPayload(item, prefix);
        const messageId = await postMessage('review', payload);
        // Marked as posted first: if remembering the message fails, it isn't posted again; it just
        // won't be ticked off later.
        await onPosted([item]);
        await onReviewMessage?.(item, messageId, payload).catch((err) => console.error('recording a #needs-review message failed', err));
      }
      const rest = group.slice(REVIEW_LIMIT);
      if (rest.length > 0) {
        await postMessage('review', backlogPayload(rest, prefix, 'Ask Claude for get_uncategorised to sort these out, sir.'));
        await onPosted(rest);
      }
    } else if (group.length > SUMMARY_THRESHOLD) {
      await postMessage(target, backlogPayload(group, prefix));
      await onPosted(group);
    } else {
      for (const item of group) {
        await postMessage(target, emailPayload(item, prefix));
        await onPosted([item]);
      }
    }
  }
}
