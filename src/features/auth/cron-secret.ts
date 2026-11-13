import 'server-only';
import { env } from '@/env';

// Machine-to-machine auth for Supabase Cron (the sync, digest and heartbeat routes).
export function hasCronSecret(req: Request) {
  return req.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
}

export function unauthorised() {
  return new Response('Unauthorized', { status: 401 });
}
