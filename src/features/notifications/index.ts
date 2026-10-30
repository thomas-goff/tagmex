import 'server-only';
import { db } from '@/db';
import { budget, budgetRepo } from '@/features/budget';
import { DEFAULT_SETTINGS } from '@/features/budget/types';
import { todayIn } from '@/features/cycle/dates';
import { createBudgetNotifier } from './budget-notifier';
import { createNotificationClaims } from './claims';
import { notify } from './discord';
import { createSystemAlerts } from './system-alerts';

const claims = createNotificationClaims(db);

export const budgetNotifier = createBudgetNotifier({
  budget,
  getSettings: (userId) => budgetRepo.getSettings(userId),
  claims,
  post: notify,
});

export const systemAlerts = createSystemAlerts({ claims, post: notify });

// A failed sync or dry run, reported to #system once a day per distinct error.
export function reportSyncFailure(userId: string, label: string, message: string) {
  return systemAlerts.syncFailed(userId, label, message, todayIn(DEFAULT_SETTINGS.timezone));
}

// The hourly job, for each user with a mailbox: budget alerts, the digest once it's due, and the
// stale-sync check. One user's failure doesn't stop the others.
export async function notifyAllUsers(options: Parameters<typeof budgetNotifier.run>[1]) {
  const results = [];
  for (const userId of await budgetRepo.listUserIds()) {
    try {
      const budgetResult = await budgetNotifier.run(userId, options);
      const sync = options.dryRun
        ? 'not_checked'
        : await systemAlerts.checkSyncFreshness(userId, await budgetRepo.lastSuccessfulSync(userId), new Date());
      results.push({ userId, ok: true, ...budgetResult, sync });
    } catch (err) {
      console.error(`budget notifications failed for ${userId}`, err);
      results.push({ userId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
