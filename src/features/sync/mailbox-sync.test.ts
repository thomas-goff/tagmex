import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createParserRegistry } from '@/features/bank-email/registry';
import type { BankEmail, IBankEmailParser, ParsedTransaction } from '@/features/bank-email/types';
import { GmailError, type HistoryRecord } from '@/features/gmail/client';
import { createMailboxSync, MAX_MESSAGES_PER_RUN, type IngestStore, type SyncOutcome } from './mailbox-sync';

const BANK = 'notifyme@absa.co.za';

const transaction = (description: string): ParsedTransaction => ({
  amountCents: -100_00,
  occurredOn: '2026-11-03',
  transactionType: 'PURCHASE',
  descriptionRaw: description,
  description,
  accountType: 'CHEQ',
  accountLast4: '1297',
  reserved: false,
  kind: 'card_purchase',
});

// Parses by subject: "bad …" fails, "notice …" is ignored, anything else is a transaction.
const parser: IBankEmailParser = {
  parse: ({ subject }) =>
    subject.startsWith('bad') ? { status: 'failed', reason: 'unreadable' } : subject.startsWith('notice') ? { status: 'ignored', reason: 'service notice' } : { status: 'parsed', transaction: transaction(subject) },
};

interface Row {
  id: string;
  gmailMessageId: string;
  status: string;
  error: string | null;
  notified: boolean;
  stale: boolean;
}

function setup({ historyId = null as string | null, owner = 'owner' } = {}) {
  const emails = new Map<string, BankEmail>();
  const mail = (id: string, subject: string, from = `Absa <${BANK}>`) => emails.set(id, { id, from, subject, html: null, text: null, receivedAt: new Date('2026-11-03T08:00:00Z') });
  const state = {
    search: [] as string[], // newest first, as Gmail returns them
    history: null as { records: HistoryRecord[]; historyId: string } | null | 'stale',
    rows: [] as Row[],
    runs: [] as { id: string; counts?: object; error?: string | null; connectionId?: string }[],
    connection: { id: 'conn-1', userId: owner, historyId },
    cursorSaves: [] as (string | null)[],
    recorded: [] as string[],
    alreadyInLedger: new Set<string>(),
    announced: [] as SyncOutcome[][],
    queries: [] as string[],
    failRecording: null as string | null,
  };

  const store: IngestStore = {
    async startRun() {
      state.runs.push({ id: `run-${state.runs.length + 1}` });
      return state.runs.at(-1)!.id;
    },
    async finishRun(runId, counts, error) {
      Object.assign(state.runs.find((r) => r.id === runId)!, { counts: { ...counts }, error });
    },
    async setRunConnection(runId, connectionId) {
      state.runs.find((r) => r.id === runId)!.connectionId = connectionId;
    },
    connectionFor: async () => state.connection,
    alreadyIngested: async (ids) => new Set(ids.filter((id) => state.rows.some((r) => r.gmailMessageId === id))),
    async claim(_connectionId, gmailMessageId) {
      if (state.rows.some((r) => r.gmailMessageId === gmailMessageId)) return null;
      state.rows.push({ id: `row-${gmailMessageId}`, gmailMessageId, status: 'processing', error: null, notified: false, stale: false });
      return `row-${gmailMessageId}`;
    },
    async reclaim(_connectionId, { retryFailed, limit }) {
      const due = state.rows.filter((r) => (r.stale && (r.status === 'processing' || (r.status === 'parsed' && !r.notified))) || (retryFailed && r.status === 'failed')).slice(0, limit);
      due.forEach((r) => Object.assign(r, { status: 'processing', stale: false }));
      return due.map((r) => ({ id: r.id, gmailMessageId: r.gmailMessageId, notified: r.notified }));
    },
    async markProcessed(rowId, { status, error }) {
      Object.assign(state.rows.find((r) => r.id === rowId)!, { status, error });
    },
    async markNotified(rowIds) {
      state.rows.filter((r) => rowIds.includes(r.id)).forEach((r) => (r.notified = true));
    },
    async saveCursor(_connectionId, cursor) {
      state.cursorSaves.push(cursor);
      state.connection.historyId = cursor;
    },
  };

  const sync = createMailboxSync({
    mail: {
      getProfile: async () => ({ emailAddress: 'me@example.com', historyId: 'h-now' }),
      async listHistory() {
        if (state.history === 'stale') throw new GmailError('history too old', 404);
        return state.history ?? { records: [], historyId: 'h-now' };
      },
      async listMessageIds(q) {
        state.queries.push(q);
        return state.search;
      },
      async getSender(id) {
        const email = emails.get(id);
        if (!email) throw new GmailError('gone', 404);
        return email.from;
      },
      async getEmail(id) {
        const email = emails.get(id);
        if (!email) throw new GmailError('gone', 404);
        return email;
      },
    },
    parsers: createParserRegistry([{ sender: BANK, parser }]),
    store,
    createRecorder: () => ({
      async record({ gmailMessageId, transaction: t }) {
        if (state.failRecording === gmailMessageId) throw new Error('database is down');
        const created = !state.alreadyInLedger.has(gmailMessageId);
        state.alreadyInLedger.add(gmailMessageId);
        state.recorded.push(gmailMessageId);
        return { transactionId: `tx-${gmailMessageId}`, created, categoryId: null, categoryName: t.description === 'groceries' ? 'Groceries' : null };
      },
    }),
    async announce(_userId, due, onPosted) {
      state.announced.push(due);
      await onPosted(due);
    },
  });
  return { sync, state, mail };
}

const statuses = (rows: Row[]) => rows.map((r) => [r.gmailMessageId, r.status, r.notified]);

describe('mailbox sync', () => {
  test('first run: searches for bank mail, records oldest first, announces, then saves the cursor', async () => {
    const { sync, state, mail } = setup();
    mail('m1', 'groceries');
    mail('m2', 'bad email');
    mail('m3', 'notice of maintenance');
    state.search = ['m3', 'm2', 'm1'];

    const result = await sync.run('owner');
    assert.deepEqual({ ...result, runId: undefined }, { runId: undefined, fetched: 3, parsed: 1, ignored: 1, failed: 1, caughtUp: true });
    assert.deepEqual(state.queries, [`from:${BANK} newer_than:30d`]);
    assert.deepEqual(statuses(state.rows), [['m1', 'parsed', true], ['m2', 'failed', true], ['m3', 'ignored', false]]);
    assert.deepEqual(state.recorded, ['m1']);
    // The transaction and the failure are announced; the ignored notice isn't.
    assert.deepEqual(state.announced.map((due) => due.map((o) => [o.gmailId, o.categoryName])), [[['m1', 'Groceries'], ['m2', null]]]);
    assert.deepEqual(state.cursorSaves, ['h-now']);
    assert.deepEqual(state.runs, [{ id: 'run-1', connectionId: 'conn-1', counts: { fetched: 3, parsed: 1, ignored: 1, failed: 1 }, error: null }]);
  });

  test('later runs follow history: other senders and mail already seen are skipped', async () => {
    const { sync, state, mail } = setup({ historyId: 'h-1' });
    mail('m1', 'groceries');
    mail('m2', 'hello', 'A friend <friend@example.com>');
    mail('m3', 'petrol');
    state.rows.push({ id: 'row-m1', gmailMessageId: 'm1', status: 'parsed', error: null, notified: true, stale: false });
    // m4 was deleted before the sync got to it.
    state.history = { records: [{ id: 'h-2', messageIds: ['m1', 'm2'] }, { id: 'h-3', messageIds: ['m3', 'm4'] }], historyId: 'h-9' };

    const result = await sync.run('owner');
    assert.deepEqual([result.fetched, result.parsed, result.caughtUp], [1, 1, true]);
    assert.deepEqual(state.recorded, ['m3']);
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.cursorSaves, ['h-9']);
  });

  test('a stale history cursor falls back to search and re-baselines', async () => {
    const { sync, state, mail } = setup({ historyId: 'h-ancient' });
    mail('m1', 'groceries');
    state.history = 'stale';
    state.search = ['m1'];
    await sync.run('owner');
    assert.deepEqual([state.recorded, state.cursorSaves], [['m1'], ['h-now']]);
  });

  test('more mail than one run takes: the cursor stops where it got to', async () => {
    const backlog = Array.from({ length: MAX_MESSAGES_PER_RUN + 5 }, (_, i) => `m${String(i).padStart(2, '0')}`);

    const searching = setup();
    backlog.forEach((id) => searching.mail(id, 'groceries'));
    searching.state.search = [...backlog].reverse();
    const first = await searching.sync.run('owner');
    assert.deepEqual([first.fetched, first.caughtUp], [MAX_MESSAGES_PER_RUN, false]);
    // Bootstrap unfinished: no cursor yet, so the next run searches again and takes the rest.
    assert.deepEqual(searching.state.cursorSaves, [null]);
    const second = await searching.sync.run('owner');
    assert.deepEqual([second.fetched, second.caughtUp, searching.state.cursorSaves], [5, true, [null, 'h-now']]);

    const following = setup({ historyId: 'h-0' });
    backlog.forEach((id) => following.mail(id, 'groceries'));
    following.state.history = { records: backlog.map((id, i) => ({ id: `h-${i + 1}`, messageIds: [id] })), historyId: 'h-end' };
    const run = await following.sync.run('owner');
    assert.deepEqual([run.fetched, run.caughtUp], [MAX_MESSAGES_PER_RUN, false]);
    // Resume after the last record taken in full.
    assert.deepEqual(following.state.cursorSaves, [`h-${MAX_MESSAGES_PER_RUN}`]);
  });

  test('rows a dead run left behind are finished, and nothing is announced twice', async () => {
    const { sync, state, mail } = setup({ historyId: 'h-1' });
    mail('stuck', 'groceries');
    mail('unannounced', 'petrol');
    mail('announced', 'rent');
    state.rows.push(
      // Died before parsing.
      { id: 'row-stuck', gmailMessageId: 'stuck', status: 'processing', error: null, notified: false, stale: true },
      // Recorded, but died before announcing.
      { id: 'row-unannounced', gmailMessageId: 'unannounced', status: 'parsed', error: null, notified: false, stale: true },
      { id: 'row-announced', gmailMessageId: 'announced', status: 'parsed', error: null, notified: true, stale: false },
    );
    state.alreadyInLedger.add('unannounced');

    await sync.run('owner');
    assert.deepEqual(state.announced[0]!.map((o) => o.gmailId), ['stuck', 'unannounced']);
    assert.deepEqual(statuses(state.rows), [['stuck', 'parsed', true], ['unannounced', 'parsed', true], ['announced', 'parsed', true]]);
  });

  test('failed emails are retried only when asked, and a failure already announced stays quiet', async () => {
    const { sync, state, mail } = setup({ historyId: 'h-1' });
    mail('fixed', 'groceries');
    mail('still-bad', 'bad email');
    state.rows.push(
      { id: 'row-fixed', gmailMessageId: 'fixed', status: 'failed', error: 'unreadable', notified: true, stale: false },
      { id: 'row-still-bad', gmailMessageId: 'still-bad', status: 'failed', error: 'unreadable', notified: true, stale: false },
    );

    assert.equal((await sync.run('owner')).fetched, 0);
    const retried = await sync.run('owner', { retryFailed: true });
    assert.deepEqual([retried.parsed, retried.failed], [1, 1]);
    assert.deepEqual(state.announced.at(-1)!.map((o) => o.gmailId), ['fixed']);
    assert.deepEqual(state.rows.map((r) => [r.gmailMessageId, r.status, r.error]), [['fixed', 'parsed', null], ['still-bad', 'failed', 'unreadable']]);
  });

  test('mail from a sender with no parser is a visible failure; a deleted message is ignored', async () => {
    const { sync, state, mail } = setup();
    mail('m1', 'groceries', 'Other Bank <alerts@otherbank.example>');
    state.search = ['gone', 'm1'];
    const result = await sync.run('owner');
    assert.deepEqual([result.failed, result.ignored], [1, 1]);
    assert.match(state.rows.find((r) => r.gmailMessageId === 'm1')!.error!, /no parser for mail from "Other Bank <alerts@otherbank\.example>"/);
    assert.equal(state.rows.find((r) => r.gmailMessageId === 'gone')!.error, 'message no longer exists in Gmail');
  });

  test('a failure part-way records the error, keeps the cursor, and leaves the row to be reclaimed', async () => {
    const { sync, state, mail } = setup({ historyId: 'h-1' });
    mail('m1', 'groceries');
    mail('m2', 'petrol');
    state.history = { records: [{ id: 'h-2', messageIds: ['m1', 'm2'] }], historyId: 'h-9' };
    state.failRecording = 'm2';

    await assert.rejects(sync.run('owner'), /database is down/);
    assert.deepEqual(state.cursorSaves, []);
    assert.equal(state.runs[0]!.error, 'database is down');
    assert.deepEqual(statuses(state.rows), [['m1', 'parsed', false], ['m2', 'processing', false]]);
    assert.deepEqual(state.announced, []);
  });

  test('only the mailbox\'s owner may sync it', async () => {
    const { sync, state } = setup({ owner: 'someone-else' });
    await assert.rejects(sync.run('owner'), /belongs to another user/);
    assert.match(state.runs[0]!.error!, /belongs to another user/);
  });
});
