import 'server-only';
import { notify } from '@/features/notifications/discord';
import { emailLine, summaryMessage, type NotifiableEmail } from './format';

// Above this many, a run posts one summary instead of a message per email.
const SUMMARY_THRESHOLD = 8;

// Posts each item (or one summary), calling onPosted after every successful post so the caller can
// record exactly what reached Discord.
export async function postToDiscord<T extends NotifiableEmail>(
  items: T[],
  { prefix = '', onPosted = async () => {} }: { prefix?: string; onPosted?: (posted: T[]) => Promise<void> } = {},
) {
  if (items.length > SUMMARY_THRESHOLD) {
    await notify(prefix + summaryMessage(items));
    await onPosted(items);
    return;
  }
  for (const item of items) {
    await notify(prefix + emailLine(item));
    await onPosted([item]);
  }
}
