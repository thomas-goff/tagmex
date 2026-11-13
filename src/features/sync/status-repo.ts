// How the mailbox sync is doing: its runs and the bank emails it has seen. Scoped by userId
// through the user's mailbox connections.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { ingestedMessages, mailboxConnections, syncRuns } from '@/db/schema';

export type SyncStatusRepo = ReturnType<typeof createSyncStatusRepo>;

export function createSyncStatusRepo(db: Database) {
  return {
    async syncStatus(userId: string) {
      const connections = await db
        .select({ id: mailboxConnections.id, gmailAddress: mailboxConnections.gmailAddress, lastSyncedAt: mailboxConnections.lastSyncedAt })
        .from(mailboxConnections)
        .where(eq(mailboxConnections.userId, userId));
      const ids = connections.map((c) => c.id);
      if (ids.length === 0) return { connections, lastRun: null, lastFailedRun: null, messages: [] };

      const runColumns = {
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        fetched: syncRuns.fetched,
        parsed: syncRuns.parsed,
        ignored: syncRuns.ignored,
        failed: syncRuns.failed,
        error: syncRuns.error,
      };
      const [[lastRun], [lastFailedRun], messages] = await Promise.all([
        db.select(runColumns).from(syncRuns).where(inArray(syncRuns.mailboxConnectionId, ids)).orderBy(desc(syncRuns.startedAt)).limit(1),
        db
          .select(runColumns)
          .from(syncRuns)
          .where(and(inArray(syncRuns.mailboxConnectionId, ids), sql`${syncRuns.error} is not null`))
          .orderBy(desc(syncRuns.startedAt))
          .limit(1),
        db
          .select({ status: ingestedMessages.status, count: sql<number>`count(*)::int` })
          .from(ingestedMessages)
          .where(inArray(ingestedMessages.mailboxConnectionId, ids))
          .groupBy(ingestedMessages.status),
      ]);
      return { connections, lastRun: lastRun ?? null, lastFailedRun: lastFailedRun ?? null, messages };
    },

    // When a sync last finished without error, for the stale-sync alert.
    async lastSuccessfulSync(userId: string) {
      const [row] = await db
        .select({ at: sql<Date | null>`max(${syncRuns.finishedAt})` })
        .from(syncRuns)
        .innerJoin(mailboxConnections, eq(mailboxConnections.id, syncRuns.mailboxConnectionId))
        .where(and(eq(mailboxConnections.userId, userId), isNull(syncRuns.error), sql`${syncRuns.finishedAt} is not null`));
      return row?.at ? new Date(row.at) : null;
    },

    // Users the scheduled jobs run for: those with a mailbox.
    async listUserIds() {
      const rows = await db.selectDistinct({ userId: mailboxConnections.userId }).from(mailboxConnections);
      return rows.map((r) => r.userId);
    },
  };
}
