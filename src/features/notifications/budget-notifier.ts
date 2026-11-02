import type { BudgetService } from '@/features/budget/service';
import type { Settings } from '@/features/budget/types';
import { hourIn } from '@/features/cycle/dates';
import { budgetAlerts, digestPayloads } from './budget-messages';
import type { NotificationClaims } from './claims';
import type { DiscordChannel, DiscordMessage } from './discord';
import { payloadText, type DiscordPayload } from './embeds';

// Posts the daily digest and budget alerts. Claim before post: a key is inserted first and the
// message only goes out if this run inserted it, so retries and overlapping runs never duplicate.
// A failed post gives its claim back for the next run, and never throws into the caller (the sync).
// The digest is two messages under one claim: if the first fails nothing went out and the claim
// goes back; if a later one fails the first is already up, so the claim stays (no duplicate) and
// the status is 'partial'.

export type NotificationStatus = 'sent' | 'already_sent' | 'failed' | 'partial' | 'disabled' | 'not_due' | 'preview';

export interface NotifierDeps {
  budget: Pick<BudgetService, 'overview'>;
  getSettings(userId: string): Promise<Settings>;
  claims: NotificationClaims;
  post(message: DiscordMessage, channel: DiscordChannel): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, 'error'>;
}

export interface NotifyOptions {
  // Consider the daily digest (the hourly job); the sync only checks alerts.
  digest: boolean;
  // Post the digest even before digest_hour (still once a day).
  force?: boolean;
  // Build the messages and report them, claiming and posting nothing.
  dryRun?: boolean;
}

export function createBudgetNotifier({ budget, getSettings, claims, post, now = () => new Date(), log = console }: NotifierDeps) {
  async function send(userId: string, kind: string, key: string, messages: DiscordMessage[], channel: DiscordChannel, alsoClaim: string[] = []) {
    if (!(await claims.claim(userId, kind, key))) return 'already_sent' as const;
    for (const [i, message] of messages.entries()) {
      try {
        await post(message, channel);
      } catch (err) {
        if (i > 0) {
          log.error(`Discord ${kind} post ${i + 1} of ${messages.length} failed; the rest are not retried`, err);
          return 'partial' as const;
        }
        log.error(`Discord ${kind} post failed; will retry next run`, err);
        await claims.release(userId, key).catch((e) => log.error('releasing notification claim failed', e));
        return 'failed' as const;
      }
    }
    for (const extra of alsoClaim) await claims.claim(userId, kind, extra);
    return 'sent' as const;
  }

  return {
    async run(userId: string, { digest, force = false, dryRun = false }: NotifyOptions) {
      const [settings, { summary, previous, tips }] = await Promise.all([getSettings(userId), budget.overview(userId)]);
      const result: {
        today: string;
        digest: { status: NotificationStatus; message?: string } | null;
        alerts: { key: string; kind: string; status: NotificationStatus; message?: string }[];
      } = { today: summary.today, digest: null, alerts: [] };

      for (const alert of budgetAlerts(summary, previous)) {
        const status: NotificationStatus = !settings.discordAlertsEnabled
          ? 'disabled'
          : dryRun
            ? 'preview'
            : await send(userId, alert.kind, alert.dedupeKey, [alert.payload], 'budget', alert.alsoClaim);
        result.alerts.push({ key: alert.dedupeKey, kind: alert.kind, status, ...(dryRun ? { message: payloadText(alert.payload) } : {}) });
      }

      if (digest) {
        const payloads: DiscordPayload[] = digestPayloads(summary, tips, { previous });
        const due = force || hourIn(settings.timezone, now()) >= settings.digestHour;
        const status: NotificationStatus = !settings.digestEnabled
          ? 'disabled'
          : dryRun
            ? 'preview'
            : !due
              ? 'not_due'
              : await send(userId, 'digest', `digest:${summary.today}`, payloads, 'budget');
        result.digest = { status, ...(dryRun ? { message: payloads.map(payloadText).join('\n\n') } : {}) };
      }
      return result;
    },
  };
}
