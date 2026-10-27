import 'server-only';
import { env } from '@/env';

export async function notify(content: string) {
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
}
