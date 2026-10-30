import 'server-only';
import { z } from 'zod';

// Gmail vars are validated separately, on first use, in @/features/gmail.
const schema = z.object({
  DATABASE_URL: z.url(),
  DISCORD_WEBHOOK_URL: z.url(),
  CRON_SECRET: z.string().min(32),
});

export const env = schema.parse(process.env);
