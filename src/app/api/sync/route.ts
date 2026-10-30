import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { notify } from '@/features/notifications/discord';
import { dryRunSync } from '@/features/sync/dry-run';
import { syncMailbox } from '@/features/sync/sync-mailbox';
import { OWNER_USER_ID } from '@/features/users/owner';

// Batches are sized to finish well inside this; Supabase Cron's pg_net timeout is set to match.
export const maxDuration = 60;

const dryRunLimit = z.coerce.number().int().min(1).max(25).catch(10);

// GET /api/sync?dryRun=true&limit=10: parse and categorise the last N bank emails and post them,
// writing nothing.
export async function GET(req: NextRequest) {
  if (!hasCronSecret(req)) return unauthorised();
  const params = req.nextUrl.searchParams;
  if (params.get('dryRun') !== 'true') {
    return Response.json({ error: 'GET only supports ?dryRun=true; POST runs a real sync' }, { status: 400 });
  }
  return run('dry run', () => dryRunSync(OWNER_USER_ID, dryRunLimit.parse(params.get('limit') ?? undefined)));
}

// POST /api/sync (Supabase Cron, every 30 min). ?retryFailed=true also re-runs failed parses.
export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) return unauthorised();
  const retryFailed = req.nextUrl.searchParams.get('retryFailed') === 'true';
  return run('sync', () => syncMailbox(OWNER_USER_ID, { retryFailed }));
}

async function run(label: string, job: () => Promise<object>) {
  try {
    return Response.json({ ok: true, ...(await job()) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await notify(`🔴 Gmail ${label} failed: ${message.slice(0, 1800)}`).catch(() => {});
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
