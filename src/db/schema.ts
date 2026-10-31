// All tables live here. Every table calls .enableRLS() with no policies.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import { ACCOUNT_LABEL_KINDS } from '@/features/accounts/labels';
import { TRANSACTION_KINDS } from '@/features/bank-email/types';
import {
  CATEGORY_KINDS,
  CATEGORY_SOURCES,
  EXPENSE_TYPES,
  RULE_DIRECTIONS,
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
export const ruleDirection = pgEnum('rule_direction', RULE_DIRECTIONS);
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
    // Shown beside the name on Discord and the dashboard. Null falls back to 🏷️.
    emoji: text('emoji'),
    kind: categoryKind('kind').notNull(),
    // Expense categories only. Superseded by budget_items.expense_type: only read to seed a new item.
    expenseType: expenseType('expense_type'),
    isSystem: boolean('is_system').notNull().default(false),
    // Income categories only: a credit here can open a salary cycle (see @/features/cycle).
    isSalary: boolean('is_salary').notNull().default(false),
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
    // Null matches money in and out. Seed rules, and rules learned before directions existed, are null.
    direction: ruleDirection('direction'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  // NULLS NOT DISTINCT, so re-seeding a direction-less rule still conflicts instead of duplicating.
  (t) => [
    unique('category_rules_user_match_pattern_direction_unique')
      .on(t.userId, t.matchType, t.pattern, t.direction)
      .nullsNotDistinct(),
  ],
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
    // A suggested category for an uncategorised row (suggest_category), offered on #needs-review
    // with an Accept button, never applied by itself. suggested_at with no category means "looked
    // at, not sure". Either way the row has been looked at, so the next pass skips it.
    suggestedCategoryId: uuid('suggested_category_id').references(() => categories.id, { onDelete: 'set null' }),
    suggestionNote: text('suggestion_note'),
    suggestedAt: timestamptz('suggested_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('transactions_source_ref_unique').on(t.source, t.sourceRef),
    index('transactions_user_occurred_idx').on(t.userId, t.occurredOn),
    index('transactions_user_category_idx').on(t.userId, t.categoryId),
  ],
).enableRLS();

// Who may use the app, and how a Clerk login maps onto the user_id every other table carries.
// `id` is that user_id (the phase 1-2 owner is 'owner'), so no existing row is rewritten, and a
// Clerk instance change (dev → prod gives new Clerk ids) only means re-linking here. A Clerk user is
// linked on first sign-in by verified email; one with no row here is refused.
export const appUsers = pgTable('app_users', {
  id: text('id').primaryKey(),
  // Lower case.
  email: text('email').notNull().unique(),
  clerkUserId: text('clerk_user_id').unique(),
  displayName: text('display_name'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  linkedAt: timestamptz('linked_at'),
}).enableRLS();

// One per expense category (created at R0 on read by ensureBudgetItems). The source of truth for
// the category's expense type. `allocated` is per salary cycle.
export const budgetItems = pgTable(
  'budget_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    expenseType: expenseType('expense_type').notNull(),
    allocated: money('allocated').notNull().default('0'),
    // Static items: the day of the month the debit order normally runs.
    expectedDay: integer('expected_day'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('budget_items_user_category_unique').on(t.userId, t.categoryId),
    check('budget_items_allocated_non_negative', sql`${t.allocated} >= 0`),
    check('budget_items_expected_day_range', sql`${t.expectedDay} between 1 and 31`),
  ],
).enableRLS();

// Created with these defaults on first read.
export const userSettings = pgTable(
  'user_settings',
  {
    userId: text('user_id').primaryKey(),
    // Day of the month salary is due. Clamped to short months, then moved back to the previous
    // business day for weekends and SA public holidays.
    salaryDayHint: integer('salary_day_hint').notNull().default(31),
    // Null = any credit in a salary category counts, whatever the amount.
    expectedSalaryAmount: money('expected_salary_amount'),
    salaryTolerancePct: integer('salary_tolerance_pct').notNull().default(20),
    timezone: text('timezone').notNull().default('Africa/Johannesburg'),
    // Local hour (0-23) from which the daily digest is posted.
    digestHour: integer('digest_hour').notNull().default(7),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    discordAlertsEnabled: boolean('discord_alerts_enabled').notNull().default(true),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('user_settings_salary_day_range', sql`${t.salaryDayHint} between 1 and 31`),
    check('user_settings_tolerance_range', sql`${t.salaryTolerancePct} between 0 and 100`),
    check('user_settings_digest_hour_range', sql`${t.digestHour} between 0 and 23`),
  ],
).enableRLS();

// Claim-before-post for Discord digests and alerts: the unique key means a retried or overlapping
// run posts each one once. A claim whose post fails is deleted so the next run retries it.
export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    // e.g. digest, category_threshold, salary_landed, salary_overdue.
    kind: text('kind').notNull(),
    // e.g. digest:2026-11-02, cat_100:<cycle id>:<category id>.
    dedupeKey: text('dedupe_key').notNull(),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
  },
  (t) => [unique('notifications_sent_user_key_unique').on(t.userId, t.dedupeKey)],
).enableRLS();

// Every MCP tool call. Also the rate limiter's counter. Rows older than 90 days are deleted by cron.
export const mcpAuditLog = pgTable(
  'mcp_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    tool: text('tool').notNull(),
    // The arguments as JSON, truncated.
    args: text('args').notNull(),
    // ok, error or rate_limited.
    status: text('status').notNull(),
    error: text('error'),
    durationMs: integer('duration_ms').notNull(),
    clientId: text('client_id'),
    at: timestamptz('at').notNull().defaultNow(),
  },
  (t) => [index('mcp_audit_log_user_at_idx').on(t.userId, t.at)],
).enableRLS();

export const accountLabelKind = pgEnum('account_label_kind', ACCOUNT_LABEL_KINDS);

// The user's own names for what the bank shows as codes, for reading the ledger. An `account` row
// names one of their accounts, keyed by type + last 4 ("CHEQ1297"); a `counterparty` row names
// whoever is behind text in descriptions, keyed by that text in upper case ("ABSA BANK SABIE PAYBACK").
// Display only: categorisation never reads these.
export const accountLabels = pgTable(
  'account_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    kind: accountLabelKind('kind').notNull(),
    match: text('match').notNull(),
    label: text('label').notNull(),
    note: text('note'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('account_labels_user_kind_match_unique').on(t.userId, t.kind, t.match)],
).enableRLS();

// Discord messages that are edited later: a #needs-review post per uncategorised transaction,
// rewritten once the transaction is categorised or excluded. `content` is the original text.
export const discordMessages = pgTable(
  'discord_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    messageId: text('message_id').notNull(),
    content: text('content').notNull(),
    resolvedAt: timestamptz('resolved_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('discord_messages_transaction_channel_unique').on(t.transactionId, t.channel)],
).enableRLS();
