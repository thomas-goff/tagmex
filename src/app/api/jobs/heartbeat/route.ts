import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { pingDb } from '@/features/health/ping-db';
import { notify } from '@/features/notifications/discord';

export async function POST(req: Request) {
  if (!hasCronSecret(req)) return unauthorised();
  const dbMs = await pingDb();
  await notify(`alive · db ${dbMs}ms`);
  return Response.json({ ok: true, dbMs });
}
