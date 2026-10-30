import { pingDb } from '@/features/health/ping-db';

export async function GET() {
  const dbMs = await pingDb();
  return Response.json({ ok: true, dbMs });
}
