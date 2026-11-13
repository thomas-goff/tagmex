import { hasCronSecret } from '@/features/auth/cron-secret';
import { pingDb } from '@/features/health/ping-db';

// Public liveness check for uptime monitors: answers without touching the database, so anyone
// hammering it can't run up database load. With the cron secret it also pings the database.
export async function GET(req: Request) {
  if (!hasCronSecret(req)) return Response.json({ ok: true });
  const dbMs = await pingDb();
  return Response.json({ ok: true, dbMs });
}
