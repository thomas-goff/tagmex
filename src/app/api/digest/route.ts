import type { NextRequest } from 'next/server';
import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { notifyAllUsers } from '@/features/notifications';

export const maxDuration = 30;

// POST /api/digest (Supabase Cron, hourly at :05): budget alerts, plus the daily digest once each
// user's digest_hour has come. ?force=true posts the digest before that hour (still once a day).
export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) return unauthorised();
  const force = req.nextUrl.searchParams.get('force') === 'true';
  const users = await notifyAllUsers({ digest: true, force });
  return Response.json({ ok: users.every((u) => u.ok), users }, { status: users.every((u) => u.ok) ? 200 : 500 });
}

// GET /api/digest?dryRun=true: the digest and any due alerts as they would be posted. Writes and
// posts nothing.
export async function GET(req: NextRequest) {
  if (!hasCronSecret(req)) return unauthorised();
  if (req.nextUrl.searchParams.get('dryRun') !== 'true') {
    return Response.json({ error: 'GET only supports ?dryRun=true; POST posts the digest' }, { status: 400 });
  }
  return Response.json({ ok: true, users: await notifyAllUsers({ digest: true, dryRun: true }) });
}
