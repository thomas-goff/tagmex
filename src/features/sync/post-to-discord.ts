import 'server-only';
import { postMessage, type DiscordChannel } from '@/features/notifications/discord';
import { channelFor, emailLine, summaryMessage, type NotifiableEmail } from './format';

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
  // A #needs-review message posted for one item: its id, to edit later.
  onReviewMessage?: (item: T, messageId: string, content: string) => Promise<void>;
}

export async function postToDiscord<T extends NotifiableEmail>(
  items: T[],
  { prefix = '', channel, onPosted = async () => {}, onReviewMessage }: Options<T> = {},
) {
  const groups = new Map<DiscordChannel, T[]>();
  for (const item of items) {
    const target = channel ?? channelFor(item);
    groups.set(target, [...(groups.get(target) ?? []), item]);
  }

  for (const [target, group] of groups) {
    if (target === 'review' && !channel) {
      for (const item of group.slice(0, REVIEW_LIMIT)) {
        const content = prefix + emailLine(item);
        const messageId = await postMessage('review', content);
        await onReviewMessage?.(item, messageId, content);
        await onPosted([item]);
      }
      const rest = group.slice(REVIEW_LIMIT);
      if (rest.length > 0) {
        await postMessage('review', `${prefix}${summaryMessage(rest)}\nAsk Claude for get_uncategorised to sort these out.`);
        await onPosted(rest);
      }
    } else if (group.length > SUMMARY_THRESHOLD) {
      await postMessage(target, prefix + summaryMessage(group));
      await onPosted(group);
    } else {
      for (const item of group) {
        await postMessage(target, prefix + emailLine(item));
        await onPosted([item]);
      }
    }
  }
}
