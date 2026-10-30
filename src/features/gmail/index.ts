import 'server-only';
import { z } from 'zod';
import { createGmailClient, type GmailClient } from './client';

// Validated on first use rather than in @/env, so the rest of the app (health, heartbeat, the
// policy pages) still builds and runs before Gmail is connected.
const schema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // From `npm run gmail:auth`. Lives in env until a second user needs per-user token storage.
  GMAIL_REFRESH_TOKEN: z.string().min(1),
  // Matched against the From header and used as `from:` in Gmail searches.
  GMAIL_SENDER: z.string().min(1).default('notifyme@absa.co.za'),
});

let config: z.infer<typeof schema> | null = null;
let client: GmailClient | null = null;

function gmailEnv() {
  return (config ??= schema.parse(process.env));
}

export function gmail() {
  const env = gmailEnv();
  return (client ??= createGmailClient({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
  }));
}

// Gmail search for bank mail received in the last `window` (e.g. '30d').
export function bankMailQuery(window: string) {
  return `from:${gmailEnv().GMAIL_SENDER} newer_than:${window}`;
}

export function isBankSender(from: string) {
  return from.toLowerCase().includes(gmailEnv().GMAIL_SENDER.toLowerCase());
}
