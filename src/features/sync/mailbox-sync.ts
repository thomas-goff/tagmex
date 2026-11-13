import type { BankEmail, ParseResult } from '@/features/bank-email/types';
import type { ParserRegistry } from '@/features/bank-email/registry';
import { fromAddress, senderAuthFailure } from '@/features/bank-email/sender-auth';
import { GmailError, type GmailClient } from '@/features/gmail/client';
import type { RecordOutcome, TransactionRecorder } from '@/features/transactions/record-transaction';
import type { NotifiableEmail } from './format';

// One run of the mailbox sync: recover what an earlier run left behind, fetch new bank mail, parse
// and record each message, announce what's due, then advance the cursor. Everything it touches is
// injected (the mailbox, the parsers, its own bookkeeping, the ledger, the announcements), so the
// order and the recovery rules can be tested without Gmail, Postgres or Discord.

// Messages examined per run, to stay inside the route's maxDuration. The cursor resumes the rest.
export const MAX_MESSAGES_PER_RUN = 40;
// At most this many of them go to recovering earlier rows, so new mail always makes progress.
export const MAX_RECLAIMED_PER_RUN = 20;
// A claim older than this belongs to a run that died, and may be taken over.
export const STALE_CLAIM_MINUTES = 10;
const BOOTSTRAP_WINDOW = '30d';

export interface SyncOutcome extends NotifiableEmail {
  rowId: string;
  alreadyNotified: boolean;
  // Parsed emails only: their ledger row.
  recorded?: RecordOutcome;
}

export interface SyncCounts {
  fetched: number;
  parsed: number;
  ignored: number;
  failed: number;
}

export interface MailboxConnection {
  id: string;
  userId: string;
  // Gmail history cursor. Null until the first full bootstrap finishes.
  historyId: string | null;
}

// The sync's own bookkeeping: runs, the mailbox cursor, and the ledger of emails seen.
export interface IngestStore {
  startRun(retryFailed: boolean): Promise<string>;
  finishRun(runId: string, counts: SyncCounts, error: string | null): Promise<void>;
  setRunConnection(runId: string, connectionId: string): Promise<void>;
  // The connection for a mailbox, created for this user when it's new.
  connectionFor(userId: string, gmailAddress: string): Promise<MailboxConnection>;
  alreadyIngested(gmailIds: string[]): Promise<Set<string>>;
  // Claim-before-process: only one run gets a row id back for a message; the rest get null.
  claim(connectionId: string, gmailMessageId: string): Promise<string | null>;
  // Re-claims rows needing another pass: stuck mid-processing, parsed but never announced, or
  // (when retrying) failed. Two overlapping runs never take the same row.
  reclaim(connectionId: string, options: { retryFailed: boolean; limit: number; staleMinutes: number }): Promise<{ id: string; gmailMessageId: string; notified: boolean }[]>;
  markProcessed(rowId: string, result: { status: ParseResult['status']; error: string | null; receivedAt: Date | undefined }): Promise<void>;
  markNotified(rowIds: string[]): Promise<void>;
  saveCursor(connectionId: string, historyId: string | null): Promise<void>;
}

export interface MailboxSyncDeps {
  mail: Pick<GmailClient, 'getProfile' | 'listHistory' | 'listMessageIds' | 'getSender' | 'getEmail'>;
  parsers: ParserRegistry;
  store: IngestStore;
  // One per run (it caches the user's rules).
  createRecorder(): Pick<TransactionRecorder, 'record'>;
  // Tells the user about what's due (Discord), calling onPosted with what went out so a retry
  // never announces it twice.
  announce(userId: string, due: SyncOutcome[], onPosted: (posted: SyncOutcome[]) => Promise<void>): Promise<void>;
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

export type MailboxSync = ReturnType<typeof createMailboxSync>;

export function createMailboxSync({ mail, parsers, store, createRecorder, announce }: MailboxSyncDeps) {
  async function run(userId: string, { retryFailed = false } = {}) {
    const runId = await store.startRun(retryFailed);
    const counts: SyncCounts = { fetched: 0, parsed: 0, ignored: 0, failed: 0 };

    try {
      const profile = await mail.getProfile();
      const conn = await store.connectionFor(userId, profile.emailAddress);
      // The Gmail token is still a single env var (one mailbox), so only that mailbox's owner may
      // sync it. Anyone else would record the owner's bank mail as their own.
      if (conn.userId !== userId) throw new Error(`mailbox ${profile.emailAddress} belongs to another user`);
      await store.setRunConnection(runId, conn.id);
      const recorder = createRecorder();

      const outcomes: SyncOutcome[] = [];
      const record = (o: SyncOutcome) => {
        outcomes.push(o);
        counts.fetched++;
        counts[o.result.status]++;
      };

      // 1. Rows a dead run left behind, plus failed ones when asked to retry after a parser fix.
      const reclaimed = await store.reclaim(conn.id, { retryFailed, limit: MAX_RECLAIMED_PER_RUN, staleMinutes: STALE_CLAIM_MINUTES });
      for (const row of reclaimed) record(await processMessage(userId, recorder, row.id, row.gmailMessageId, row.notified));

      // 2. New mail since the cursor.
      const budget = MAX_MESSAGES_PER_RUN - outcomes.length;
      const newMail = (conn.historyId ? await fromHistory(conn.historyId, budget) : null) ?? (await fromSearch(profile.historyId, budget));
      for (const id of newMail.messageIds) {
        if (newMail.checkSender && !parsers.parserFor(await senderOf(id))) continue;
        const rowId = await store.claim(conn.id, id);
        if (rowId) record(await processMessage(userId, recorder, rowId, id, false));
      }

      // 3. Announcements. A transaction is due when this run created its ledger row, or when an
      // earlier run created it but died before announcing it. A failure is due once, not again on
      // every retry.
      const due = outcomes.filter((o) => (o.recorded ? o.recorded.created || !o.alreadyNotified : o.result.status === 'failed' && !o.alreadyNotified));
      await announce(userId, due, (posted) => store.markNotified(posted.map((o) => o.rowId)));

      // 4. Advance the cursor only once everything above succeeded.
      await store.saveCursor(conn.id, newMail.cursor);
      await store.finishRun(runId, counts, null);
      return { runId, ...counts, caughtUp: newMail.caughtUp };
    } catch (err) {
      await store.finishRun(runId, counts, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function fromHistory(startHistoryId: string, budget: number): Promise<NewMail | null> {
    let history;
    try {
      history = await mail.listHistory(startHistoryId);
    } catch (err) {
      // Stale cursor: Gmail only keeps about a week of history. Fall back to search and re-baseline.
      if (err instanceof GmailError && err.status === 404) return null;
      throw err;
    }

    const known = await store.alreadyIngested(history.records.flatMap((r) => r.messageIds));
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

  // First run, or after a stale cursor. `baselineHistoryId` is read before searching so nothing
  // that arrives meanwhile is missed; it is only saved once the whole search result has been processed.
  async function fromSearch(baselineHistoryId: string, budget: number): Promise<NewMail> {
    const ids = await mail.listMessageIds(parsers.query(BOOTSTRAP_WINDOW));
    const known = await store.alreadyIngested(ids);
    const fresh = ids.filter((id) => !known.has(id)).reverse(); // oldest first
    return {
      messageIds: fresh.slice(0, budget),
      cursor: fresh.length <= budget ? baselineHistoryId : null,
      checkSender: false,
      caughtUp: fresh.length <= budget,
    };
  }

  async function senderOf(gmailId: string) {
    try {
      return await mail.getSender(gmailId);
    } catch (err) {
      if (err instanceof GmailError && err.status === 404) return ''; // deleted since it arrived
      throw err;
    }
  }

  async function processMessage(
    userId: string,
    recorder: Pick<TransactionRecorder, 'record'>,
    rowId: string,
    gmailId: string,
    alreadyNotified: boolean,
  ): Promise<SyncOutcome> {
    let email: BankEmail | null = null;
    let result: ParseResult;
    try {
      email = await mail.getEmail(gmailId);
      const parser = parsers.parserFor(email.from);
      // A From header is easy to forge: only mail Gmail saw pass DMARC for the bank's domain counts.
      const forged = parser ? senderAuthFailure(email.authenticationResults, fromAddress(email.from)!) : null;
      // Failed, not ignored: it shows in #system, and a retry picks it up once a parser is registered.
      result = !parser
        ? { status: 'failed', reason: `no parser for mail from "${email.from}"` }
        : forged
          ? { status: 'failed', reason: `sender not verified, not recorded: ${forged}` }
          : parser.parse(email);
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

    await store.markProcessed(rowId, { status: result.status, error: result.status === 'parsed' ? null : result.reason, receivedAt: email?.receivedAt });

    return { rowId, gmailId, subject: email?.subject ?? '', result, alreadyNotified, recorded, categoryName: recorded?.categoryName ?? null };
  }

  return { run };
}
