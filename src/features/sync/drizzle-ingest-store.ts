import { eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { ingestedMessages, mailboxConnections, syncRuns } from '@/db/schema';
import type { IngestStore } from './mailbox-sync';

// The mailbox sync's bookkeeping in Postgres: sync_runs, mailbox_connections and ingested_messages.
export function createDrizzleIngestStore(db: Database): IngestStore {
  return {
    async startRun(retryFailed) {
      const [run] = await db.insert(syncRuns).values({ retryFailed }).returning({ id: syncRuns.id });
      return run!.id;
    },

    async finishRun(runId, counts, error) {
      await db
        .update(syncRuns)
        .set({ ...counts, finishedAt: new Date(), error })
        .where(eq(syncRuns.id, runId));
    },

    async setRunConnection(runId, connectionId) {
      await db.update(syncRuns).set({ mailboxConnectionId: connectionId }).where(eq(syncRuns.id, runId));
    },

    async connectionFor(userId, gmailAddress) {
      await db.insert(mailboxConnections).values({ userId, gmailAddress }).onConflictDoNothing();
      const [conn] = await db
        .select({ id: mailboxConnections.id, userId: mailboxConnections.userId, historyId: mailboxConnections.historyId })
        .from(mailboxConnections)
        .where(eq(mailboxConnections.gmailAddress, gmailAddress));
      return conn!;
    },

    async alreadyIngested(gmailIds) {
      if (gmailIds.length === 0) return new Set<string>();
      const rows = await db
        .select({ id: ingestedMessages.gmailMessageId })
        .from(ingestedMessages)
        .where(inArray(ingestedMessages.gmailMessageId, gmailIds));
      return new Set(rows.map((r) => r.id));
    },

    // The unique gmail_message_id means only one run gets a row back.
    async claim(connectionId, gmailMessageId) {
      const [row] = await db
        .insert(ingestedMessages)
        .values({ mailboxConnectionId: connectionId, gmailMessageId })
        .onConflictDoNothing({ target: ingestedMessages.gmailMessageId })
        .returning({ id: ingestedMessages.id });
      return row?.id ?? null;
    },

    // SKIP LOCKED keeps two overlapping runs from taking the same row.
    async reclaim(connectionId, { retryFailed, limit, staleMinutes }) {
      const stale = sql`now() - make_interval(mins => ${staleMinutes})`;
      const rows = await db.execute<{ id: string; gmail_message_id: string; notified_at: Date | null }>(sql`
        update ${ingestedMessages}
        set status = 'processing', claimed_at = now()
        where id in (
          select id from ${ingestedMessages}
          where mailbox_connection_id = ${connectionId}
            and (
              (status = 'processing' and claimed_at < ${stale})
              or (status = 'parsed' and notified_at is null and claimed_at < ${stale})
              or (${retryFailed} and status = 'failed')
            )
          order by claimed_at
          limit ${limit}
          for update skip locked
        )
        returning id, gmail_message_id, notified_at
      `);
      return rows.map((r) => ({ id: r.id, gmailMessageId: r.gmail_message_id, notified: r.notified_at !== null }));
    },

    async markProcessed(rowId, { status, error, receivedAt }) {
      await db.update(ingestedMessages).set({ status, error, receivedAt, processedAt: new Date() }).where(eq(ingestedMessages.id, rowId));
    },

    async markNotified(rowIds) {
      if (rowIds.length === 0) return;
      await db.update(ingestedMessages).set({ notifiedAt: new Date() }).where(inArray(ingestedMessages.id, rowIds));
    },

    async saveCursor(connectionId, historyId) {
      await db.update(mailboxConnections).set({ historyId, lastSyncedAt: new Date() }).where(eq(mailboxConnections.id, connectionId));
    },
  };
}
