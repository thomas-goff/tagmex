// All tables live here. Every table calls .enableRLS() with no policies.
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { TRANSACTION_KINDS } from '@/features/bank-email/types';
import {
  CATEGORY_KINDS,
  CATEGORY_SOURCES,
  EXPENSE_TYPES,
  RULE_MATCH_TYPES,
  RULE_ORIGINS,
} from '@/features/categorisation/types';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
// Rands with cents. Drizzle returns these as strings ("-123.40"), converted in @/features/transactions/money.
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

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
    // Set once a `parsed` message has its ledger row. Parsed with no link = waiting for backfill.
    transactionId: uuid('transaction_id').references((): AnyPgColumn => transactions.id),
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

export const categoryKind = pgEnum('category_kind', CATEGORY_KINDS);
export const expenseType = pgEnum('expense_type', EXPENSE_TYPES);
export const categorySource = pgEnum('category_source', CATEGORY_SOURCES);
export const ruleMatchType = pgEnum('rule_match_type', RULE_MATCH_TYPES);
export const ruleOrigin = pgEnum('rule_origin', RULE_ORIGINS);
export const transactionKind = pgEnum('transaction_kind', TRANSACTION_KINDS);
// `apple_pay` arrives in phase 4.
export const transactionSource = pgEnum('transaction_source', ['gmail']);

// Uncategorised is category_id = null, not a row. Transfer and Income are found by `kind` (one
// system category per kind), never by name, so renaming them is safe.
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),
    // Expense categories only.
    expenseType: expenseType('expense_type'),
    isSystem: boolean('is_system').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('categories_user_name_unique').on(t.userId, t.name),
    uniqueIndex('categories_user_system_kind_unique').on(t.userId, t.kind).where(sql`${t.isSystem}`),
  ],
).enableRLS();

// Patterns are upper case. Learned rules (from corrections) outrank seed rules.
export const categoryRules = pgTable(
  'category_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    matchType: ruleMatchType('match_type').notNull(),
    pattern: text('pattern').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    origin: ruleOrigin('origin').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('category_rules_user_match_pattern_unique').on(t.userId, t.matchType, t.pattern)],
).enableRLS();

// The ledger. One row per bank transaction; (source, source_ref) is the idempotency key, so a
// retried or overlapping run can never insert the same email twice. Not a hash of date/amount/
// description: two identical same-day purchases are two real transactions.
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    // e.g. CHEQ, CCRD, SAVS.
    accountType: text('account_type').notNull(),
    accountLast4: text('account_last4').notNull(),
    // The bank sends a date with no time, so this is a calendar date, not a timestamp.
    occurredOn: date('occurred_on').notNull(),
    // Negative = expense.
    amount: money('amount').notNull(),
    descriptionRaw: text('description_raw').notNull(),
    descriptionNormalised: text('description_normalised').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    categorySource: categorySource('category_source').notNull().default('none'),
    ruleId: uuid('rule_id').references(() => categoryRules.id, { onDelete: 'set null' }),
    balanceAfter: money('balance_after'),
    kind: transactionKind('kind').notNull(),
    // The bank's own type, e.g. "ACB DEBIT:EXTERNAL".
    transactionType: text('transaction_type').notNull(),
    // A card hold rather than a settled amount.
    reserved: boolean('reserved').notNull().default(false),
    source: transactionSource('source').notNull(),
    // Gmail message id for `gmail`.
    sourceRef: text('source_ref').notNull(),
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('transactions_source_ref_unique').on(t.source, t.sourceRef),
    index('transactions_user_occurred_idx').on(t.userId, t.occurredOn),
    index('transactions_user_category_idx').on(t.userId, t.categoryId),
  ],
).enableRLS();
