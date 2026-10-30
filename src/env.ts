import 'server-only';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.url(),
  DISCORD_WEBHOOK_URL: z.url(),
  CRON_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // From `npm run gmail:auth`. Lives in env until a second user needs per-user token storage.
  GMAIL_REFRESH_TOKEN: z.string().min(1),
  // Matched against the From header and used as `from:` in Gmail searches.
  GMAIL_SENDER: z.string().min(1).default('notifyme@absa.co.za'),
});

export const env = schema.parse(process.env);
