import 'server-only';
import { budget, budgetRepo } from '@/features/budget';
import { budgetStanding } from '@/features/budget/standing';
import { reviewComponents } from '@/features/notifications/review-components';
import { reviewMessages } from '@/features/notifications/review-messages';
import type { SyncOutcome } from './mailbox-sync';
import { postToDiscord } from './post-to-discord';

// What a sync run tells Discord. Categorised transactions carry their category's emoji and budget
// this cycle. Uncategorised ones go to #needs-review, remembered so they can be ticked off once
// they're sorted.
export async function announceToDiscord(userId: string, due: SyncOutcome[], onPosted: (posted: SyncOutcome[]) => Promise<void>) {
  const context = await discordContextFor(userId);
  for (const o of due) {
    if (o.recorded && o.result.status === 'parsed') {
      o.categoryEmoji = context.emoji(o.recorded.categoryId);
      o.standing = context.standing(o.recorded.categoryId, o.result.transaction.occurredOn);
    }
  }
  await postToDiscord(due, {
    onPosted,
    onReviewMessage: async (o, messageId, payload) => {
      if (o.recorded) await reviewMessages.record(userId, o.recorded.transactionId, messageId, payload);
    },
    reviewComponents: (o) => (o.recorded ? reviewComponents(o.recorded.transactionId, context.pickable) : undefined),
  });
}

// A failure here only costs the emoji and budget on Discord messages, never the sync.
async function discordContextFor(userId: string) {
  try {
    const [summary, categories] = await Promise.all([budget.summary(userId), budgetRepo.listCategories(userId)]);
    const emojiById = new Map(categories.map((c) => [c.id, c.emoji]));
    return {
      // Archived categories aren't offered.
      pickable: categories.filter((c) => !c.isArchived),
      emoji: (categoryId: string | null) => (categoryId ? (emojiById.get(categoryId) ?? null) : null),
      standing: (categoryId: string | null, occurredOn: string) => budgetStanding(summary, categoryId, occurredOn),
    };
  } catch (err) {
    console.error('budget standing unavailable for Discord messages', err);
    return { pickable: [], emoji: () => null, standing: () => null };
  }
}
