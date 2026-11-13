import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Machine-to-machine auth for Supabase Cron (the sync, digest and heartbeat routes). Compared in
// constant time, over hashes so different lengths take the same path too.
export function hasCronSecret(req: Request) {
  const given = req.headers.get('authorization') ?? '';
  return timingSafeEqual(digest(given), digest(`Bearer ${env.CRON_SECRET}`));
}

export function unauthorised() {
  return new Response('Unauthorized', { status: 401 });
}
