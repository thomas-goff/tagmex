// All tables live here. Every table calls .enableRLS() with no policies.
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// One row per connected Gmail account. The refresh token stays in env until a second user connects.
export const mailboxConnections = pgTable('mailbox_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  gmailAddress: text('gmail_address').notNull().unique(),
  // Gmail history cursor. Null until the first full bootstrap finishes.
  historyId: text('history_id'),
  lastSyncedAt: timestamptz('last_synced_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
}).enableRLS();

// `processing` is a claim: a run inserts it before fetching, so overlapping runs never double-post.
export const ingestStatus = pgEnum('ingest_status', ['processing', 'parsed', 'ignored', 'failed']);

// Ledger of bank emails seen. IDs and status only, never bodies: re-fetch by message id to reprocess.
export const ingestedMessages = pgTable(
  'ingested_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxConnectionId: uuid('mailbox_connection_id')
      .notNull()
      .references(() => mailboxConnections.id),
    gmailMessageId: text('gmail_message_id').notNull().unique(),
    status: ingestStatus('status').notNull().default('processing'),
    // Failure reason, or why the email was ignored.
    error: text('error'),
    receivedAt: timestamptz('received_at'),
    claimedAt: timestamptz('claimed_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
    notifiedAt: timestamptz('notified_at'),
  },
  (t) => [index('ingested_messages_status_idx').on(t.mailboxConnectionId, t.status)],
).enableRLS();

export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Null when the run failed before reaching Gmail (e.g. a dead refresh token).
  mailboxConnectionId: uuid('mailbox_connection_id').references(() => mailboxConnections.id),
  retryFailed: boolean('retry_failed').notNull().default(false),
  startedAt: timestamptz('started_at').notNull().defaultNow(),
  finishedAt: timestamptz('finished_at'),
  fetched: integer('fetched').notNull().default(0),
  parsed: integer('parsed').notNull().default(0),
  ignored: integer('ignored').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  error: text('error'),
}).enableRLS();
