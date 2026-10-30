import { and, eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { notificationsSent } from '@/db/schema';

export interface NotificationClaims {
  // True when this call won the key; false when it was already sent (or is being sent).
  claim(userId: string, kind: string, dedupeKey: string): Promise<boolean>;
  // Gives a key back after a failed post, so the next run retries it.
  release(userId: string, dedupeKey: string): Promise<void>;
}

export function createNotificationClaims(db: Database): NotificationClaims {
  return {
    async claim(userId, kind, dedupeKey) {
      const rows = await db
        .insert(notificationsSent)
        .values({ userId, kind, dedupeKey })
        .onConflictDoNothing({ target: [notificationsSent.userId, notificationsSent.dedupeKey] })
        .returning({ id: notificationsSent.id });
      return rows.length > 0;
    },

    async release(userId, dedupeKey) {
      await db
        .delete(notificationsSent)
        .where(and(eq(notificationsSent.userId, userId), eq(notificationsSent.dedupeKey, dedupeKey)));
    },
  };
}
