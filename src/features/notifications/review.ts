import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { discordMessages } from '@/db/schema';
import { UNCATEGORISED_LABEL } from '@/features/sync/format';
import type { DiscordChannel, DiscordMessage } from './discord';
import { resolvedReviewPayload, suggestedReviewPayload, type DiscordPayload } from './embeds';
import { reviewComponents, type ReviewCategory } from './review-components';

// #needs-review is an inbox: one message per uncategorised transaction, rewritten once it's
// categorised (or excluded) so what's left un-ticked is what still needs doing.

const DISCORD_LIMIT = 2000;

// discord_messages.content holds the posted payload as JSON. Rows from before embeds hold the
// plain text line, which is edited the old way.
export function resolvedReviewMessage(stored: string, outcome: string): DiscordMessage {
  const payload = parsePayload(stored);
  return payload ? resolvedReviewPayload(payload, outcome) : resolvedReviewContent(stored, outcome);
}

function parsePayload(stored: string): DiscordPayload | null {
  if (!stored.startsWith('{')) return null;
  try {
    const value = JSON.parse(stored) as DiscordPayload;
    return Array.isArray(value.embeds) ? value : null;
  } catch {
    return null;
  }
}

// Plain-text rows: "❔ **Uncategorised**" becomes the outcome, and the line gets a tick.
export function resolvedReviewContent(original: string, outcome: string) {
  const body = original.includes(UNCATEGORISED_LABEL) ? original.replace(UNCATEGORISED_LABEL, outcome) : `${original} → ${outcome}`;
  const content = `✅ ${body}`;
  return content.length > DISCORD_LIMIT ? `${content.slice(0, DISCORD_LIMIT - 1)}…` : content;
}

export interface ReviewSuggestion {
  category: ReviewCategory | null;
  note: string | null;
}

export interface ReviewMessages {
  record(userId: string, transactionId: string, messageId: string, payload: DiscordPayload): Promise<void>;
  // Edits the open review messages of these transactions to show the outcome. Never throws: a
  // stale message isn't worth failing a categorisation over.
  resolve(userId: string, transactionIds: string[], outcome: string): Promise<number>;
  // Edits the open review messages of these transactions to show a suggestion, with the controls
  // rebuilt to offer it. Never throws, like resolve.
  suggest(userId: string, transactionIds: string[], suggestion: ReviewSuggestion, categories: readonly ReviewCategory[]): Promise<number>;
}

export function createReviewMessages(
  db: Database,
  edit: (channel: DiscordChannel, messageId: string, message: DiscordMessage) => Promise<void>,
  log: Pick<Console, 'error'> = console,
): ReviewMessages {
  async function openMessages(userId: string, transactionIds: string[]) {
    return db
      .select({ id: discordMessages.id, transactionId: discordMessages.transactionId, messageId: discordMessages.messageId, content: discordMessages.content })
      .from(discordMessages)
      .where(
        and(
          eq(discordMessages.userId, userId),
          eq(discordMessages.channel, 'review'),
          inArray(discordMessages.transactionId, transactionIds),
          isNull(discordMessages.resolvedAt),
        ),
      );
  }

  return {
    async record(userId, transactionId, messageId, payload) {
      const content = JSON.stringify(payload);
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
        for (const m of await openMessages(userId, transactionIds)) {
          try {
            await edit('review', m.messageId, resolvedReviewMessage(m.content, outcome));
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

    async suggest(userId, transactionIds, suggestion, categories) {
      if (transactionIds.length === 0) return 0;
      let edited = 0;
      try {
        for (const m of await openMessages(userId, transactionIds)) {
          // Plain-text rows from before embeds have no fields to show it in.
          const payload = parsePayload(m.content);
          if (!payload) continue;
          try {
            const next = suggestedReviewPayload(payload, suggestion, reviewComponents(m.transactionId, categories, suggestion.category?.id ?? null));
            await edit('review', m.messageId, next);
            await db.update(discordMessages).set({ content: JSON.stringify(next) }).where(eq(discordMessages.id, m.id));
            edited++;
          } catch (err) {
            log.error('showing a suggestion on a #needs-review message failed', err);
          }
        }
      } catch (err) {
        log.error('showing suggestions on #needs-review failed', err);
      }
      return edited;
    },
  };
}
