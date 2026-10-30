import type { NotificationClaims } from './claims';
import type { DiscordChannel, PostOptions } from './discord';

// #system problems worth a ping: the sync failing (usually an expired Gmail token) and the sync
// going quiet. Both are deduplicated, so a broken token is one message a day, not one per run.

// The sync runs every 30 minutes: this is four missed runs.
export const STALE_SYNC_HOURS = 2;

export interface SystemAlertDeps {
  claims: NotificationClaims;
  post(content: string, channel: DiscordChannel, options?: PostOptions): Promise<unknown>;
  log?: Pick<Console, 'error'>;
}

// The same failure with different numbers in it (ids, timestamps, counts) is the same failure.
export function errorFingerprint(message: string) {
  const normalised = message.toLowerCase().replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, '#').slice(0, 160);
  let hash = 5381;
  for (let i = 0; i < normalised.length; i++) hash = ((hash * 33) ^ normalised.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function createSystemAlerts({ claims, post, log = console }: SystemAlertDeps) {
  async function once(userId: string, kind: string, key: string, content: string) {
    if (!(await claims.claim(userId, kind, key))) return 'already_sent' as const;
    try {
      await post(content, 'system', { ping: true });
      return 'sent' as const;
    } catch (err) {
      log.error(`Discord ${kind} post failed`, err);
      await claims.release(userId, key).catch(() => {});
      return 'failed' as const;
    }
  }

  return {
    // Once a day per distinct error.
    syncFailed(userId: string, label: string, message: string, today: string) {
      return once(
        userId,
        'sync_failed',
        `sync_failed:${today}:${errorFingerprint(message)}`,
        `🔴 **Gmail ${label} failed**: ${message.slice(0, 1700)}\nRuns every 30 min; this is posted once a day per error. get_sync_status in Claude shows the latest.`,
      );
    },

    // Once per quiet spell: keyed on the last success, so the next success re-arms it.
    async checkSyncFreshness(userId: string, lastSuccessAt: Date | null, now: Date) {
      if (!lastSuccessAt) return 'no_successful_sync' as const;
      const hours = (now.getTime() - lastSuccessAt.getTime()) / 3_600_000;
      if (hours < STALE_SYNC_HOURS) return 'fresh' as const;
      return once(
        userId,
        'stale_sync',
        `stale_sync:${lastSuccessAt.toISOString()}`,
        `🟠 **No successful bank sync for ${Math.floor(hours)} hours** (last at ${lastSuccessAt.toISOString().slice(0, 16).replace('T', ' ')} UTC). Check the gmail-sync cron job in Supabase and the Vercel logs; budget numbers may be stale.`,
      );
    },
  };
}
