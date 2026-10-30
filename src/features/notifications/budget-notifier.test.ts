import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { summariseCycle, type CycleSummary } from '@/features/budget/summary';
import type { BudgetService } from '@/features/budget/service';
import { DEFAULT_SETTINGS } from '@/features/budget/types';
import type { BudgetLine, LedgerRow } from '@/features/budget/types';
import { cycleContaining, cycleStatus, previousCycle } from '@/features/cycle/cycle';
import { budgetAlerts, digestMessage, thresholdKey } from './budget-messages';
import { createBudgetNotifier } from './budget-notifier';
import { createSystemAlerts, errorFingerprint } from './system-alerts';
import { budgetStanding } from '@/features/budget/standing';

const starts = [{ transactionId: 'sal', occurredOn: '2026-10-30', amountCents: 30_713_54 }];
const lines: BudgetLine[] = [
  { categoryId: 'g', categoryName: 'Groceries', expenseType: 'dynamic', allocatedCents: 1000_00, expectedDay: null, isActive: true, sortOrder: 0 },
  { categoryId: 'i', categoryName: 'Insurance', expenseType: 'static', allocatedCents: 900_00, expectedDay: 1, isActive: true, sortOrder: 1 },
];
const spend = (cents: number): LedgerRow[] => [
  { id: 't', occurredOn: '2026-10-31', amountCents: -cents, categoryId: 'g', categoryKind: 'expense', categoryName: 'Groceries' },
];

function summaryOn(today: string, rows: LedgerRow[]): CycleSummary {
  const cycle = cycleContaining(today, starts, 31);
  return summariseCycle({ cycle, status: cycleStatus(cycle, today, true), today, rows, lines });
}

function harness(over: { today?: string; rows?: LedgerRow[]; hourUtc?: number; failPosts?: number } = {}) {
  const today = over.today ?? '2026-11-10';
  const summary = summaryOn(today, over.rows ?? []);
  const prior = previousCycle(summary.cycle, starts, 31);
  const previous = summariseCycle({ cycle: prior, status: cycleStatus(prior, today, false), today, rows: [], lines });
  const claimed = new Set<string>();
  const posts: { content: string; channel: string }[] = [];
  let failPosts = over.failPosts ?? 0;
  const notifier = createBudgetNotifier({
    budget: { overview: async () => ({ summary, previous, tips: [] }) } as unknown as Pick<BudgetService, 'overview'>,
    getSettings: async () => DEFAULT_SETTINGS,
    claims: {
      async claim(_u, _k, key) {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      async release(_u, key) {
        claimed.delete(key);
      },
    },
    async post(content, channel) {
      if (failPosts-- > 0) throw new Error('Discord 500');
      posts.push({ content, channel });
    },
    // 07:30 SAST by default, past the 07:00 digest hour.
    now: () => new Date(`${today}T${String(over.hourUtc ?? 5).padStart(2, '0')}:30:00Z`),
    log: { error: () => {} },
  });
  return { notifier, posts, claimed, summary };
}

describe('budget notifier', () => {
  test('running twice posts the digest once', async () => {
    const { notifier, posts } = harness();
    const first = await notifier.run('owner', { digest: true });
    const second = await notifier.run('owner', { digest: true });
    assert.equal(first.digest?.status, 'sent');
    assert.equal(second.digest?.status, 'already_sent');
    assert.deepEqual(posts.map((p) => p.channel), ['budget']);
  });

  test('before digest_hour the digest waits; force sends it', async () => {
    const { notifier, posts } = harness({ hourUtc: 3 }); // 05:30 SAST
    assert.equal((await notifier.run('owner', { digest: true })).digest?.status, 'not_due');
    assert.equal((await notifier.run('owner', { digest: true, force: true })).digest?.status, 'sent');
    assert.equal(posts.length, 1);
  });

  test('a failed post gives its claim back, so the next run retries it', async () => {
    const { notifier, posts } = harness({ failPosts: 1 });
    assert.equal((await notifier.run('owner', { digest: true })).digest?.status, 'failed');
    assert.equal((await notifier.run('owner', { digest: true })).digest?.status, 'sent');
    assert.equal(posts.length, 1);
  });

  test('crossing a threshold alerts exactly once; jumping past 80% skips the 80% alert', async () => {
    const at85 = harness({ rows: spend(850_00) });
    await at85.notifier.run('owner', { digest: false });
    await at85.notifier.run('owner', { digest: false });
    assert.deepEqual(at85.posts.map((p) => p.content.includes('85%')), [true]);

    const at120 = harness({ rows: spend(1200_00) });
    const result = await at120.notifier.run('owner', { digest: false });
    assert.deepEqual(result.alerts.map((a) => [a.key, a.status]), [[thresholdKey(100, '2026-10-30', 'g'), 'sent']]);
    assert.ok(at120.claimed.has(thresholdKey(80, '2026-10-30', 'g')));
    assert.match(at120.posts[0]!.content, /over budget/);
  });

  test('dry run claims and posts nothing', async () => {
    const { notifier, posts, claimed } = harness({ rows: spend(1200_00) });
    const result = await notifier.run('owner', { digest: true, dryRun: true });
    assert.equal(result.digest?.status, 'preview');
    assert.ok(result.digest?.message?.includes('Budget'));
    assert.equal(posts.length + claimed.size, 0);
  });
});

describe('system alerts', () => {
  function system() {
    const claimed = new Set<string>();
    const posts: { content: string; ping?: boolean }[] = [];
    const alerts = createSystemAlerts({
      claims: {
        async claim(_u, _k, key) {
          return claimed.has(key) ? false : (claimed.add(key), true);
        },
        async release(_u, key) {
          claimed.delete(key);
        },
      },
      async post(content, channel, options) {
        assert.equal(channel, 'system');
        posts.push({ content, ping: options?.ping });
      },
    });
    return { alerts, posts };
  }

  test('a failing sync pings once a day per error, whatever ids or counts it mentions', async () => {
    const { alerts, posts } = system();
    assert.equal(await alerts.syncFailed('owner', 'sync', 'token refresh failed: 400 invalid_grant (req 123)', '2026-11-01'), 'sent');
    assert.equal(await alerts.syncFailed('owner', 'sync', 'token refresh failed: 400 invalid_grant (req 456)', '2026-11-01'), 'already_sent');
    assert.equal(await alerts.syncFailed('owner', 'sync', 'database unreachable', '2026-11-01'), 'sent');
    assert.equal(await alerts.syncFailed('owner', 'sync', 'database unreachable', '2026-11-02'), 'sent');
    assert.equal(posts.length, 3);
    assert.ok(posts.every((p) => p.ping));
  });

  test('stale sync: once per quiet spell, re-armed by the next success', async () => {
    const { alerts, posts } = system();
    const last = new Date('2026-11-01T08:00:00Z');
    assert.equal(await alerts.checkSyncFreshness('owner', last, new Date('2026-11-01T09:30:00Z')), 'fresh');
    assert.equal(await alerts.checkSyncFreshness('owner', last, new Date('2026-11-01T10:05:00Z')), 'sent');
    assert.equal(await alerts.checkSyncFreshness('owner', last, new Date('2026-11-01T11:05:00Z')), 'already_sent');
    assert.equal(await alerts.checkSyncFreshness('owner', new Date('2026-11-01T12:00:00Z'), new Date('2026-11-01T14:30:00Z')), 'sent');
    assert.equal(posts.length, 2);
    assert.equal(errorFingerprint('req 1 failed'), errorFingerprint('req 22 failed'));
  });
});

describe('budget standing on transaction lines', () => {
  test('spent of allocated this cycle; nothing for older transactions', () => {
    const s = summaryOn('2026-11-10', spend(850_00));
    assert.equal(budgetStanding(s, 'g', '2026-10-31'), 'R850.00 of R1,000.00, 85%');
    assert.equal(budgetStanding(s, 'g', '2026-10-29'), null);
    assert.equal(budgetStanding(s, null, '2026-11-01'), null);
    assert.equal(budgetStanding(summaryOn('2026-11-10', spend(1200_00)), 'g', '2026-11-01'), 'R1,200.00 of R1,000.00, 120% ⚠️');
  });
});

describe('budget messages', () => {
  test('salary landed: alert with last cycle recap, only near the salary date', () => {
    const fresh = summaryOn('2026-10-31', []);
    const alerts = budgetAlerts(fresh, fresh);
    assert.deepEqual(alerts.map((a) => a.dedupeKey), ['salary_landed:2026-10-30']);
    assert.match(alerts[0]!.message, /R30,713\.54/);
    assert.match(alerts[0]!.message, /Last cycle/);
    assert.equal(budgetAlerts(summaryOn('2026-11-10', []), null).length, 0);
  });

  test('salary overdue alert once payday passes', () => {
    const late = summaryOn('2026-12-02', []);
    assert.ok(budgetAlerts(late, null).some((a) => a.dedupeKey === 'salary_overdue:2026-10-30'));
  });

  test('digest has days to salary, allowance, debit orders and uncategorised', () => {
    const s = summaryOn('2026-11-10', [
      ...spend(200_00),
      { id: 'u', occurredOn: '2026-11-02', amountCents: -72_00, categoryId: null, categoryKind: null, categoryName: null },
    ]);
    const text = digestMessage(s, []);
    assert.match(text, /20 days to salary \(Mon 30 Nov\)/);
    assert.match(text, /R800\.00 → \*\*R40\.00\/day\*\*/);
    assert.match(text, /Insurance R900\.00 \(late, Sun 1 Nov\)/);
    assert.match(text, /1 uncategorised/);
    assert.ok(text.length < 1900);
  });
});
