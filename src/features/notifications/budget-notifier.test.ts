import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { summariseCycle, type CycleSummary } from '@/features/budget/summary';
import type { BudgetService } from '@/features/budget/service';
import { DEFAULT_SETTINGS } from '@/features/budget/types';
import type { BudgetLine, LedgerRow } from '@/features/budget/types';
import { cycleContaining, cycleStatus, previousCycle } from '@/features/cycle/cycle';
import { budgetAlerts, digestPayload, thresholdKey } from './budget-messages';
import { embedLength, payloadText } from './embeds';
import { createBudgetNotifier } from './budget-notifier';
import { createSystemAlerts, errorFingerprint } from './system-alerts';
import { budgetStanding } from '@/features/budget/standing';

const starts = [{ transactionId: 'sal', occurredOn: '2026-10-30', amountCents: 30_713_54 }];
const lines: BudgetLine[] = [
  { categoryId: 'g', categoryName: 'Groceries', categoryEmoji: '🛒', expenseType: 'dynamic', allocatedCents: 1000_00, expectedDay: null, isActive: true, sortOrder: 0 },
  { categoryId: 'i', categoryName: 'Insurance', categoryEmoji: '🛡️', expenseType: 'static', allocatedCents: 900_00, expectedDay: 1, isActive: true, sortOrder: 1 },
];
const spend = (cents: number): LedgerRow[] => [
  { id: 't', occurredOn: '2026-10-31', amountCents: -cents, categoryId: 'g', categoryKind: 'expense', categoryName: 'Groceries', categoryEmoji: '🛒' },
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
    async post(message, channel) {
      if (failPosts-- > 0) throw new Error('Discord 500');
      posts.push({ content: payloadText(message), channel });
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
    assert.ok(result.digest?.message?.includes('Good morning, Master Goff'));
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
        posts.push({ content: payloadText(content), ping: options?.ping });
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

  test('when the database is down, the failure is still posted (without dedupe)', async () => {
    const posts: string[] = [];
    const alerts = createSystemAlerts({
      claims: {
        claim: async () => {
          throw new Error('connection refused');
        },
        release: async () => {},
      },
      post: async (content) => void posts.push(payloadText(content)),
      log: { error: () => {} },
    });
    assert.equal(await alerts.syncFailed('owner', 'sync', 'connection refused', '2026-11-01'), 'sent_without_dedupe');
    assert.equal(posts.length, 1);
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
    const standing = budgetStanding(s, 'g', '2026-10-31')!;
    assert.deepEqual(
      [standing.category.emoji, standing.category.spentCents, standing.category.usedPct, standing.category.status],
      ['🛒', 850_00, 85, 'warning'],
    );
    assert.deepEqual(standing.payday, { daysToSalary: 20, salaryOverdue: false });
    assert.equal(budgetStanding(s, 'g', '2026-10-29'), null);
    assert.equal(budgetStanding(s, null, '2026-11-01'), null);
    assert.equal(budgetStanding(summaryOn('2026-11-10', spend(1200_00)), 'g', '2026-11-01')!.category.status, 'over');
  });

  test('payday is unknown while salary is overdue', () => {
    assert.deepEqual(budgetStanding(summaryOn('2026-12-02', spend(10_00)), 'g', '2026-11-01')!.payday, { daysToSalary: null, salaryOverdue: true });
  });
});

describe('settled static items', () => {
  const insurance = (cents: number): LedgerRow[] => [
    { id: 'ins', occurredOn: '2026-11-01', amountCents: -cents, categoryId: 'i', categoryKind: 'expense', categoryName: 'Insurance', categoryEmoji: '🛡️' },
  ];

  test('a debit order paid at more than its budget gives no threshold alert', () => {
    const s = summaryOn('2026-11-10', insurance(920_00));
    assert.equal(s.categories.find((c) => c.categoryId === 'i')!.status, 'settled');
    assert.deepEqual(budgetAlerts(s, null), []);
  });

  test('a dynamic item over budget still alerts', () => {
    const s = summaryOn('2026-11-10', spend(1200_00));
    assert.deepEqual(budgetAlerts(s, null).map((a) => a.dedupeKey), [thresholdKey(100, '2026-10-30', 'g')]);
  });
});

describe('budget messages', () => {
  test('salary landed: alert with last cycle recap, only near the salary date', () => {
    const fresh = summaryOn('2026-10-31', []);
    const alerts = budgetAlerts(fresh, fresh);
    assert.deepEqual(alerts.map((a) => a.dedupeKey), ['salary_landed:2026-10-30']);
    assert.match(payloadText(alerts[0]!.payload), /R30,713\.54/);
    assert.match(payloadText(alerts[0]!.payload), /Last cycle/);
    assert.equal(budgetAlerts(summaryOn('2026-11-10', []), null).length, 0);
  });

  test('salary overdue alert once payday passes', () => {
    const late = summaryOn('2026-12-02', []);
    assert.ok(budgetAlerts(late, null).some((a) => a.dedupeKey === 'salary_overdue:2026-10-30'));
  });

  test('digest has days to salary, allowance, debit orders and uncategorised', () => {
    const s = summaryOn('2026-11-10', [
      ...spend(200_00),
      { id: 'u', occurredOn: '2026-11-02', amountCents: -72_00, categoryId: null, categoryKind: null, categoryName: null, categoryEmoji: null },
    ]);
    const payload = digestPayload(s, []);
    const text = payloadText(payload);
    assert.match(text, /Salary arrives in \*\*20 days\*\* \(Mon 30 Nov\)/);
    assert.match(text, /\*\*R40\.00\/day\*\* · R800\.00 left/);
    assert.match(text, /🛒 Groceries `██░░░░░░` 20% · R800\.00 left/);
    assert.match(text, /🛡️ Insurance R900\.00 · \*\*late\*\*, Sun 1 Nov/);
    assert.match(text, /1 transaction \(-R72\.00\)/);
    assert.ok(embedLength(payload.embeds![0]!) < 6000);
  });

  test('digest lists settled debit orders apart from the budgets', () => {
    const s = summaryOn('2026-11-10', [
      { id: 'ins', occurredOn: '2026-11-01', amountCents: -900_00, categoryId: 'i', categoryKind: 'expense', categoryName: 'Insurance', categoryEmoji: '🛡️' },
    ]);
    const text = payloadText(digestPayload(s, []));
    assert.match(text, /✅ Settled: 🛡️ Insurance/);
    assert.doesNotMatch(text, /Debit orders to come/);
  });
});
