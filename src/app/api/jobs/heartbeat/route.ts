import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { pingDb } from '@/features/health/ping-db';
import { notify } from '@/features/notifications/discord';
import { COLOURS, MASTER, systemEmbed } from '@/features/notifications/embeds';

export async function POST(req: Request) {
  if (!hasCronSecret(req)) return unauthorised();
  const dbMs = await pingDb();
  await notify({ embeds: [systemEmbed(`💓 Still on duty, ${MASTER}`, `Database answered in ${dbMs}ms.`, COLOURS.grey)] }, 'system');
  return Response.json({ ok: true, dbMs });
}
