import { after } from 'next/server';
import { env } from '@/env';
import { verifyDiscordSignature } from '@/features/notifications/discord-signature';
import { handleReviewInteraction } from '@/features/notifications/interactions';
import type { Interaction } from '@/features/notifications/review-interactions';

// Categorising after the answer can take a cold start and a few queries.
export const maxDuration = 30;

// Discord's Interactions Endpoint URL: clicks on the #needs-review dropdown and buttons. Every
// request must carry a valid signature from the application's key (DISCORD_PUBLIC_KEY); without
// that key set, the endpoint doesn't exist.
export async function POST(request: Request) {
  if (!env.DISCORD_PUBLIC_KEY) return new Response('Discord interactions are not set up', { status: 404 });

  const body = await request.text();
  const valid = await verifyDiscordSignature(
    env.DISCORD_PUBLIC_KEY,
    request.headers.get('x-signature-ed25519') ?? '',
    request.headers.get('x-signature-timestamp') ?? '',
    body,
  );
  if (!valid) return new Response('invalid request signature', { status: 401 });

  const { response, work } = handleReviewInteraction(JSON.parse(body) as Interaction);
  if (work) after(work);
  return Response.json(response);
}
