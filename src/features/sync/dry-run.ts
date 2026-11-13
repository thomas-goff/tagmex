import 'server-only';
import type { ParseResult } from '@/features/bank-email/types';
import { budget, budgetRepo } from '@/features/budget';
import { budgetStanding } from '@/features/budget/standing';
import { gmail } from '@/features/gmail';
import { notify } from '@/features/notifications/discord';
import { ledger } from '@/features/transactions';
import type { NotifiableEmail } from './format';
import { bankParsers } from './index';
import { postToDiscord } from './post-to-discord';

// Parses the last `limit` bank emails, previews their categories and posts them to Discord.
// Reads rules from the database but writes nothing to it, so it is safe to run repeatedly.
export async function dryRunSync(userId: string, limit: number) {
  const recorder = ledger.createRecorder();
  const items: NotifiableEmail[] = [];
  const [categories, summary] = await Promise.all([budgetRepo.listCategories(userId), budget.summary(userId)]);
  const emojiById = new Map(categories.map((c) => [c.id, c.emoji]));
  const parsers = bankParsers();
  for (const id of await gmail().listMessageIds(parsers.query('30d'), limit)) {
    const email = await gmail().getEmail(id);
    const result: ParseResult = parsers.parserFor(email.from)?.parse(email) ?? { status: 'failed', reason: `no parser for mail from "${email.from}"` };
    const preview = result.status === 'parsed' ? await recorder.preview(userId, result.transaction) : undefined;
    const categoryId = preview?.categorisation.categoryId;
    items.push({
      gmailId: id,
      subject: email.subject,
      result,
      categoryName: preview?.categoryName,
      categoryEmoji: categoryId ? (emojiById.get(categoryId) ?? null) : null,
      // The budget as it stands now, so the preview looks like the real message.
      standing: result.status === 'parsed' ? budgetStanding(summary, categoryId, result.transaction.occurredOn) : null,
    });
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
