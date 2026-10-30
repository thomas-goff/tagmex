import 'server-only';
import { env } from '@/env';

// Machine-to-machine auth for Supabase Cron and the interim admin routes, until Clerk (phase 3).
export function hasCronSecret(req: Request) {
  return req.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
}

export function unauthorised() {
  return new Response('Unauthorized', { status: 401 });
}
