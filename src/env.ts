import 'server-only';
import { z } from 'zod';

// An empty `KEY=` line in .env means "not set", not an invalid value.
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

// Gmail vars are validated separately, on first use, in @/features/gmail, and Clerk vars in
// @/features/mcp/clerk, so the app still deploys before either is connected.
const schema = z.object({
  DATABASE_URL: z.url(),
  // #transactions, and the fallback for every channel below that isn't set.
  DISCORD_WEBHOOK_URL: z.url(),
  // #needs-review, #budget and #system (see @/features/notifications/discord).
  DISCORD_REVIEW_WEBHOOK_URL: optional(z.url()),
  DISCORD_BUDGET_WEBHOOK_URL: optional(z.url()),
  DISCORD_SYSTEM_WEBHOOK_URL: optional(z.url()),
  // Your Discord user id (Developer Mode → right-click yourself → Copy User ID), @-mentioned on
  // critical #system messages only. Unset = no pings.
  DISCORD_PING_USER_ID: optional(z.string().regex(/^\d{5,25}$/, 'a numeric Discord user id')),
  // Pennyworth's avatar on every post (a public image URL). Unset = each webhook's own avatar.
  DISCORD_AVATAR_URL: optional(z.url()),
  // The Discord application's public key (Developer Portal → General Information), for checking
  // that requests to /api/discord/interactions come from Discord. Setting it turns on the
  // #needs-review dropdown and buttons, which also need DISCORD_REVIEW_WEBHOOK_URL to be a webhook
  // the application made (scripts/discord-review-webhook.ts). Only DISCORD_PING_USER_ID may use
  // them. Unset = no controls.
  DISCORD_PUBLIC_KEY: optional(z.string().regex(/^[0-9a-f]{64}$/i, 'a 64-character hex public key')),
  CRON_SECRET: z.string().min(32),
});

export const env = schema.parse(process.env);
