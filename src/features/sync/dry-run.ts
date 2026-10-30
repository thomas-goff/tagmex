import 'server-only';
import { absaParser } from '@/features/bank-email/absa/parser';
import { bankMailQuery, gmail } from '@/features/gmail';
import { notify } from '@/features/notifications/discord';
import { ledger } from '@/features/transactions';
import type { NotifiableEmail } from './format';
import { postToDiscord } from './post-to-discord';

// Parses the last `limit` bank emails, previews their categories and posts them to Discord.
// Reads rules from the database but writes nothing to it, so it is safe to run repeatedly.
export async function dryRunSync(userId: string, limit: number) {
  const recorder = ledger.createRecorder();
  const items: NotifiableEmail[] = [];
  for (const id of await gmail().listMessageIds(bankMailQuery('30d'), limit)) {
    const email = await gmail().getEmail(id);
    const result = absaParser.parse(email);
    const categoryName =
      result.status === 'parsed' ? (await recorder.preview(userId, result.transaction)).categoryName : undefined;
    items.push({ gmailId: id, subject: email.subject, result, categoryName });
  }

  const postable = items.filter((i) => i.result.status !== 'ignored');
  const counts = {
    fetched: items.length,
    parsed: items.filter((i) => i.result.status === 'parsed').length,
    ignored: items.length - postable.length,
    failed: items.filter((i) => i.result.status === 'failed').length,
  };

  await postToDiscord(postable, { prefix: '[dry run] ', channel: 'system' });
  await notify(
    `[dry run] done · ${counts.fetched} fetched · ${counts.parsed} parsed · ${counts.ignored} ignored · ${counts.failed} failed`,
    'system',
  );
  return { ...counts, items };
}
