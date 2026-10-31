import 'server-only';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { ingestedMessages, mailboxConnections, syncRuns } from '@/db/schema';
import { absaParser } from '@/features/bank-email/absa/parser';
import type { BankEmail, ParseResult } from '@/features/bank-email/types';
import { bankMailQuery, gmail, isBankSender } from '@/features/gmail';
import { GmailError } from '@/features/gmail/client';
import { budget, budgetRepo } from '@/features/budget';
import { budgetStanding } from '@/features/budget/standing';
import { reviewMessages } from '@/features/notifications/review-messages';
import { ledger } from '@/features/transactions';
import type { RecordOutcome, TransactionRecorder } from '@/features/transactions/record-transaction';
import type { NotifiableEmail } from './format';
import { postToDiscord } from './post-to-discord';

// Messages examined per run, to stay inside the route's maxDuration. The cursor resumes the rest.
const MAX_MESSAGES_PER_RUN = 40;
// At most this many of them go to recovering earlier rows, so new mail always makes progress.
const MAX_RECLAIMED_PER_RUN = 20;
// A claim older than this belongs to a run that died, and may be taken over.
const STALE_CLAIM_MINUTES = 10;
const BOOTSTRAP_WINDOW = '30d';

interface Outcome extends NotifiableEmail {
  rowId: string;
  alreadyNotified: boolean;
  // Parsed emails only: their ledger row.
  recorded?: RecordOutcome;
}

interface RunContext {
  userId: string;
  recorder: TransactionRecorder;
}

interface NewMail {
  messageIds: string[];
  // History cursor to save once these are processed. Null = bootstrap unfinished, search again next run.
  cursor: string | null;
  // History includes all mail, so senders must be checked. Search results are pre-filtered.
  checkSender: boolean;
  // False when the budget ran out and the rest waits for the next run.
  caughtUp: boolean;
}

export async function syncMailbox(userId: string, { retryFailed = false } = {}) {
  const [run] = await db.insert(syncRuns).values({ retryFailed }).returning({ id: syncRuns.id });
  const counts = { fetched: 0, parsed: 0, ignored: 0, failed: 0 };
  const finishRun = (error: string | null) =>
    db
      .update(syncRuns)
      .set({ ...counts, finishedAt: new Date(), error })
      .where(eq(syncRuns.id, run!.id));

  try {
    const profile = await gmail().getProfile();
    const conn = await connectionFor(userId, profile.emailAddress);
    // The Gmail token is still a single env var (one mailbox), so only that mailbox's owner may
    // sync it. Anyone else would record the owner's bank mail as their own.
    if (conn.userId !== userId) throw new Error(`mailbox ${profile.emailAddress} belongs to another user`);
    await db.update(syncRuns).set({ mailboxConnectionId: conn.id }).where(eq(syncRuns.id, run!.id));
    const ctx: RunContext = { userId, recorder: ledger.createRecorder() };

    const outcomes: Outcome[] = [];
    const record = (o: Outcome) => {
      outcomes.push(o);
      counts.fetched++;
      counts[o.result.status]++;
    };

    // 1. Rows a dead run left behind, plus failed ones when asked to retry after a parser fix.
    for (const row of await reclaim(conn.id, retryFailed)) {
      record(await processMessage(ctx, row.id, row.gmail_message_id, row.notified_at !== null));
    }

    // 2. New mail since the cursor.
    const budget = MAX_MESSAGES_PER_RUN - outcomes.length;
    const newMail =
      (conn.historyId ? await fromHistory(conn.historyId, budget) : null) ??
      (await fromSearch(profile.historyId, budget));
    for (const id of newMail.messageIds) {
      if (newMail.checkSender && !isBankSender(await senderOf(id))) continue;
      const rowId = await claim(conn.id, id);
      if (rowId) record(await processMessage(ctx, rowId, id, false));
    }

    // 3. Discord. A transaction posts when this run created its ledger row, or when an earlier run
    // created it but died before posting. A failure posts once, not again on every retry.
    const due = outcomes.filter((o) =>
      o.recorded ? o.recorded.created || !o.alreadyNotified : o.result.status === 'failed' && !o.alreadyNotified,
    );
    // Categorised messages carry their category's emoji and budget this cycle. Uncategorised ones
    // go to #needs-review, remembered so they can be ticked off once categorised.
    const context = await discordContextFor(userId);
    for (const o of due) {
      if (o.recorded && o.result.status === 'parsed') {
        o.categoryEmoji = context.emoji(o.recorded.categoryId);
        o.standing = context.standing(o.recorded.categoryId, o.result.transaction.occurredOn);
      }
    }
    await postToDiscord(due, {
      onPosted: markNotified,
      onReviewMessage: async (o, messageId, payload) => {
        if (o.recorded) await reviewMessages.record(userId, o.recorded.transactionId, messageId, payload);
      },
    });

    // 4. Advance the cursor only once everything above succeeded.
    await db
      .update(mailboxConnections)
      .set({ historyId: newMail.cursor, lastSyncedAt: new Date() })
      .where(eq(mailboxConnections.id, conn.id));
    await finishRun(null);
    return { runId: run!.id, ...counts, caughtUp: newMail.caughtUp };
  } catch (err) {
    await finishRun(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// A failure here only costs the emoji and budget on Discord messages, never the sync.
async function discordContextFor(userId: string) {
  try {
    const [summary, categories] = await Promise.all([budget.summary(userId), budgetRepo.listCategories(userId)]);
    const emojiById = new Map(categories.map((c) => [c.id, c.emoji]));
    return {
      emoji: (categoryId: string | null) => (categoryId ? (emojiById.get(categoryId) ?? null) : null),
      standing: (categoryId: string | null, occurredOn: string) => budgetStanding(summary, categoryId, occurredOn),
    };
  } catch (err) {
    console.error('budget standing unavailable for Discord messages', err);
    return { emoji: () => null, standing: () => null };
  }
}

async function connectionFor(userId: string, gmailAddress: string) {
  await db.insert(mailboxConnections).values({ userId, gmailAddress }).onConflictDoNothing();
  const [conn] = await db.select().from(mailboxConnections).where(eq(mailboxConnections.gmailAddress, gmailAddress));
  return conn!;
}

async function fromHistory(startHistoryId: string, budget: number): Promise<NewMail | null> {
  let history;
  try {
    history = await gmail().listHistory(startHistoryId);
  } catch (err) {
    // Stale cursor: Gmail only keeps about a week of history. Fall back to search and re-baseline.
    if (err instanceof GmailError && err.status === 404) return null;
    throw err;
  }

  const known = await alreadyIngested(history.records.flatMap((r) => r.messageIds));
  const messageIds = new Set<string>();
  for (const [i, record] of history.records.entries()) {
    const fresh = record.messageIds.filter((id) => !known.has(id) && !messageIds.has(id));
    if (messageIds.size > 0 && messageIds.size + fresh.length > budget) {
      // Out of budget: resume after the last record taken in full.
      return { messageIds: [...messageIds], cursor: history.records[i - 1]!.id, checkSender: true, caughtUp: false };
    }
    fresh.forEach((id) => messageIds.add(id));
  }
  return { messageIds: [...messageIds], cursor: history.historyId, checkSender: true, caughtUp: true };
}

// First run, or after a stale cursor. `baselineHistoryId` is read before searching so nothing that
// arrives meanwhile is missed; it is only saved once the whole search result has been processed.
async function fromSearch(baselineHistoryId: string, budget: number): Promise<NewMail> {
  const ids = await gmail().listMessageIds(bankMailQuery(BOOTSTRAP_WINDOW));
  const known = await alreadyIngested(ids);
  const fresh = ids.filter((id) => !known.has(id)).reverse(); // oldest first
  return {
    messageIds: fresh.slice(0, budget),
    cursor: fresh.length <= budget ? baselineHistoryId : null,
    checkSender: false,
    caughtUp: fresh.length <= budget,
  };
}

async function alreadyIngested(gmailIds: string[]) {
  if (gmailIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: ingestedMessages.gmailMessageId })
    .from(ingestedMessages)
    .where(inArray(ingestedMessages.gmailMessageId, gmailIds));
  return new Set(rows.map((r) => r.id));
}

async function senderOf(gmailId: string) {
  try {
    return await gmail().getSender(gmailId);
  } catch (err) {
    if (err instanceof GmailError && err.status === 404) return ''; // deleted since it arrived
    throw err;
  }
}

// Claim-before-post: the unique gmail_message_id means only one run gets a row back.
async function claim(mailboxConnectionId: string, gmailMessageId: string) {
  const [row] = await db
    .insert(ingestedMessages)
    .values({ mailboxConnectionId, gmailMessageId })
    .onConflictDoNothing({ target: ingestedMessages.gmailMessageId })
    .returning({ id: ingestedMessages.id });
  return row?.id ?? null;
}

// Re-claims rows needing another pass: stuck mid-processing, parsed but never posted, or (when
// retrying) failed. SKIP LOCKED keeps two overlapping runs from taking the same row.
async function reclaim(mailboxConnectionId: string, retryFailed: boolean) {
  const stale = sql`now() - make_interval(mins => ${STALE_CLAIM_MINUTES})`;
  return db.execute<{ id: string; gmail_message_id: string; notified_at: Date | null }>(sql`
    update ${ingestedMessages}
    set status = 'processing', claimed_at = now()
    where id in (
      select id from ${ingestedMessages}
      where mailbox_connection_id = ${mailboxConnectionId}
        and (
          (status = 'processing' and claimed_at < ${stale})
          or (status = 'parsed' and notified_at is null and claimed_at < ${stale})
          or (${retryFailed} and status = 'failed')
        )
      order by claimed_at
      limit ${MAX_RECLAIMED_PER_RUN}
      for update skip locked
    )
    returning id, gmail_message_id, notified_at
  `);
}

async function processMessage(
  { userId, recorder }: RunContext,
  rowId: string,
  gmailId: string,
  alreadyNotified: boolean,
): Promise<Outcome> {
  let email: BankEmail | null = null;
  let result: ParseResult;
  try {
    email = await gmail().getEmail(gmailId);
    result = absaParser.parse(email);
  } catch (err) {
    if (!(err instanceof GmailError && err.status === 404)) throw err; // row stays claimed; recovered later
    result = { status: 'ignored', reason: 'message no longer exists in Gmail' };
  }

  // Ledger row before the status update: if the run dies in between, the message is reclaimed and
  // the insert finds the existing transaction instead of creating a second one.
  const recorded =
    result.status === 'parsed'
      ? await recorder.record({ userId, ingestedMessageId: rowId, gmailMessageId: gmailId, transaction: result.transaction })
      : undefined;

  await db
    .update(ingestedMessages)
    .set({
      status: result.status,
      error: result.status === 'parsed' ? null : result.reason,
      receivedAt: email?.receivedAt,
      processedAt: new Date(),
    })
    .where(eq(ingestedMessages.id, rowId));

  return {
    rowId,
    gmailId,
    subject: email?.subject ?? '',
    result,
    alreadyNotified,
    recorded,
    categoryName: recorded?.categoryName ?? null,
  };
}

async function markNotified(posted: Outcome[]) {
  await db
    .update(ingestedMessages)
    .set({ notifiedAt: new Date() })
    .where(inArray(ingestedMessages.id, posted.map((o) => o.rowId)));
}

