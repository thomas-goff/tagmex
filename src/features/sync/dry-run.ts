import 'server-only';
import { absaParser } from '@/features/bank-email/absa/parser';
import { bankMailQuery, gmail } from '@/features/gmail';
import { notify } from '@/features/notifications/discord';
import type { NotifiableEmail } from './format';
import { postToDiscord } from './post-to-discord';

// Parses the last `limit` bank emails and posts them to Discord. Writes nothing to the database,
// so it is safe to run repeatedly.
export async function dryRunSync(limit: number) {
  const items: NotifiableEmail[] = [];
  for (const id of await gmail.listMessageIds(bankMailQuery('30d'), limit)) {
    const email = await gmail.getEmail(id);
    items.push({ gmailId: id, subject: email.subject, result: absaParser.parse(email) });
  }

  const postable = items.filter((i) => i.result.status !== 'ignored');
  const counts = {
    fetched: items.length,
    parsed: items.filter((i) => i.result.status === 'parsed').length,
    ignored: items.length - postable.length,
    failed: items.filter((i) => i.result.status === 'failed').length,
  };

  await postToDiscord(postable, { prefix: '[dry run] ' });
  await notify(
    `[dry run] done · ${counts.fetched} fetched · ${counts.parsed} parsed · ${counts.ignored} ignored · ${counts.failed} failed`,
  );
  return { ...counts, items };
}
