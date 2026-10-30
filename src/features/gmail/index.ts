import 'server-only';
import { env } from '@/env';
import { createGmailClient } from './client';

export const gmail = createGmailClient({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  refreshToken: env.GMAIL_REFRESH_TOKEN,
});

// Gmail search for bank mail received in the last `window` (e.g. '30d').
export function bankMailQuery(window: string) {
  return `from:${env.GMAIL_SENDER} newer_than:${window}`;
}

export function isBankSender(from: string) {
  return from.toLowerCase().includes(env.GMAIL_SENDER.toLowerCase());
}
