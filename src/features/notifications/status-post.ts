import { and, count, eq, gte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { notificationsSent } from '@/db/schema';
import type { BudgetService } from '@/features/budget/service';
import { digestPayloads } from './budget-messages';
import type { DiscordChannel } from './discord';
import { payloadText, type DiscordPayload } from './embeds';

// A budget status and/or a note posted to #budget on request (Claude's post_status_to_discord),
// marked as from Claude. Each post is remembered in notifications_sent, which is what the hourly
// cap counts.

export const FROM_CLAUDE = '🤖 **From Claude**';
const KIND = 'status_post';

export interface StatusPostResult {
  // Ids of the messages Discord accepted, in order. Fewer than `total` means it failed part-way.
  messageIds: string[];
  total: number;
  // The text of everything that was meant to go out.
  content: string;
}

export interface StatusPoster {
  // How many status posts went out since `since`.
  recentPosts(userId: string, since: Date): Promise<number>;
  // Never throws for a failing webhook: the result says how far it got.
  post(userId: string, input: { note: string; includeBudget: boolean }): Promise<StatusPostResult>;
}

export interface StatusPostLog {
  countSince(userId: string, since: Date): Promise<number>;
  record(userId: string, at: Date): Promise<void>;
}

export function createStatusPostLog(db: Database): StatusPostLog {
  return {
    async countSince(userId, since) {
      const [row] = await db
        .select({ n: count() })
        .from(notificationsSent)
        .where(and(eq(notificationsSent.userId, userId), eq(notificationsSent.kind, KIND), gte(notificationsSent.sentAt, since)));
      return row?.n ?? 0;
    },
    async record(userId, at) {
      await db.insert(notificationsSent).values({ userId, kind: KIND, dedupeKey: `${KIND}:${at.toISOString()}:${crypto.randomUUID()}`, sentAt: at });
    },
  };
}

interface Deps {
  budget: Pick<BudgetService, 'overview'>;
  // Posts to a channel's webhook and returns the message id.
  post(channel: DiscordChannel, payload: DiscordPayload): Promise<string>;
  log: StatusPostLog;
  now?: () => Date;
  logger?: Pick<Console, 'error'>;
}

export function createStatusPoster({ budget, post, log, now = () => new Date(), logger = console }: Deps): StatusPoster {
  return {
    recentPosts: (userId, since) => log.countSince(userId, since),

    async post(userId, { note, includeBudget }) {
      // The note above the budgets; salary and debit orders after. More messages when a card is
      // too big for one.
      const head = note ? `${FROM_CLAUDE}\n${note}` : FROM_CLAUDE;
      let payloads: DiscordPayload[];
      if (includeBudget) {
        const { summary, previous } = await budget.overview(userId);
        payloads = digestPayloads(summary, { title: '📊 Budget status', previous, content: head });
      } else {
        payloads = [{ content: head }];
      }

      const messageIds: string[] = [];
      for (const payload of payloads) {
        try {
          messageIds.push(await post('budget', payload));
        } catch (err) {
          logger.error('posting a status to Discord failed', err);
          break;
        }
      }
      // Anything that reached the channel counts against the cap.
      if (messageIds.length > 0) await log.record(userId, now()).catch((err) => logger.error('recording a status post failed', err));
      return { messageIds, total: payloads.length, content: payloads.map(payloadText).join('\n\n') };
    },
  };
}
