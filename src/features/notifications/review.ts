import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { discordMessages } from '@/db/schema';
import { UNCATEGORISED_LABEL } from '@/features/sync/format';
import type { DiscordChannel } from './discord';

// #needs-review is an inbox: one message per uncategorised transaction, rewritten once it's
// categorised (or excluded) so what's left un-ticked is what still needs doing.

const DISCORD_LIMIT = 2000;

// "❔ **Uncategorised**" becomes the outcome, and the line gets a tick.
export function resolvedReviewContent(original: string, outcome: string) {
  const body = original.includes(UNCATEGORISED_LABEL) ? original.replace(UNCATEGORISED_LABEL, outcome) : `${original} → ${outcome}`;
  const content = `✅ ${body}`;
  return content.length > DISCORD_LIMIT ? `${content.slice(0, DISCORD_LIMIT - 1)}…` : content;
}

export interface ReviewMessages {
  record(userId: string, transactionId: string, messageId: string, content: string): Promise<void>;
  // Edits the open review messages of these transactions to show the outcome. Never throws: a
  // stale message isn't worth failing a categorisation over.
  resolve(userId: string, transactionIds: string[], outcome: string): Promise<number>;
}

export function createReviewMessages(
  db: Database,
  edit: (channel: DiscordChannel, messageId: string, content: string) => Promise<void>,
  log: Pick<Console, 'error'> = console,
): ReviewMessages {
  return {
    async record(userId, transactionId, messageId, content) {
      await db
        .insert(discordMessages)
        .values({ userId, transactionId, channel: 'review', messageId, content })
        .onConflictDoUpdate({
          target: [discordMessages.transactionId, discordMessages.channel],
          set: { messageId, content, resolvedAt: null },
        });
    },

    async resolve(userId, transactionIds, outcome) {
      if (transactionIds.length === 0) return 0;
      let edited = 0;
      try {
        const open = await db
          .select({ id: discordMessages.id, messageId: discordMessages.messageId, content: discordMessages.content })
          .from(discordMessages)
          .where(
            and(
              eq(discordMessages.userId, userId),
              eq(discordMessages.channel, 'review'),
              inArray(discordMessages.transactionId, transactionIds),
              isNull(discordMessages.resolvedAt),
            ),
          );
        for (const m of open) {
          try {
            await edit('review', m.messageId, resolvedReviewContent(m.content, outcome));
            await db.update(discordMessages).set({ resolvedAt: new Date() }).where(eq(discordMessages.id, m.id));
            edited++;
          } catch (err) {
            log.error('editing a #needs-review message failed', err);
          }
        }
      } catch (err) {
        log.error('resolving #needs-review messages failed', err);
      }
      return edited;
    },
  };
}
