// Creates a #needs-review webhook owned by the Discord application, the only kind whose messages
// can carry working buttons and dropdowns. Run once; set the URL it prints as
// DISCORD_REVIEW_WEBHOOK_URL. The bot token is only needed here, never by the app.
// Usage: DISCORD_BOT_TOKEN=... npx tsx scripts/discord-review-webhook.ts --channel <#needs-review channel id>
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { channel: { type: 'string' } } });

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('Set DISCORD_BOT_TOKEN (Developer Portal → Bot → Reset Token).');
  if (!args.channel || !/^\d{5,25}$/.test(args.channel)) {
    throw new Error('Pass --channel with the #needs-review channel id (Developer Mode → right-click the channel → Copy Channel ID).');
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${args.channel}/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Pennyworth' }),
  });
  if (!res.ok) {
    throw new Error(`Discord refused (${res.status}): ${await res.text()}. The bot needs to be in the server with Manage Webhooks on that channel.`);
  }
  const webhook = (await res.json()) as { id: string; token: string; application_id: string | null };
  console.log(`Created webhook ${webhook.id} for application ${webhook.application_id}.`);
  console.log(`DISCORD_REVIEW_WEBHOOK_URL=https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
