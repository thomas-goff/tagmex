// Composition root for /api/discord/interactions: the real database, commands and Discord API
// behind the pure click handler.
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { discordMessages } from '@/db/schema';
import { env } from '@/env';
import { commands } from '@/features/commands';
import { editInteractionMessage, followUpInteraction } from './discord';
import { handleInteraction, type Interaction } from './review-interactions';

export function handleReviewInteraction(interaction: Interaction) {
  return handleInteraction(interaction, {
    ownerDiscordId: env.DISCORD_PING_USER_ID,
    async reviewOwner(transactionId) {
      const [row] = await db
        .select({ userId: discordMessages.userId })
        .from(discordMessages)
        .where(and(eq(discordMessages.transactionId, transactionId), eq(discordMessages.channel, 'review')));
      return row?.userId ?? null;
    },
    commands,
    followUp: followUpInteraction,
    editOriginal: editInteractionMessage,
  });
}
