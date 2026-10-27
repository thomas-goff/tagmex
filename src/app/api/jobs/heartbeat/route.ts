import { env } from '@/env';
import { pingDb } from '@/features/health/ping-db';
import { notify } from '@/features/notifications/discord';

export async function POST(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const dbMs = await pingDb();
  await notify(`alive · db ${dbMs}ms`);
  return Response.json({ ok: true, dbMs });
}
