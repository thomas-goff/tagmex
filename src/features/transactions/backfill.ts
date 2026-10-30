import type { BankEmail, IBankEmailParser, ParsedTransaction } from '@/features/bank-email/types';
import type { Stores } from './ports';
import type { TransactionRecorder } from './record-transaction';

export type BackfillItem =
  | { gmailMessageId: string; status: 'created' | 'existing' | 'preview'; transaction: ParsedTransaction; categoryName: string | null }
  | { gmailMessageId: string; status: 'skipped'; reason: string };

interface Deps {
  stores: Pick<Stores, 'ingestedMessages'>;
  recorder: Pick<TransactionRecorder, 'record' | 'preview'>;
  // Null when the message no longer exists.
  fetchEmail: (gmailMessageId: string) => Promise<BankEmail | null>;
  parser: IBankEmailParser;
}

interface Options {
  userId: string;
  // Stop after this many messages.
  limit: number;
  // Parse and categorise, but write nothing.
  dryRun: boolean;
  onItem?: (item: BackfillItem) => void;
}

const PAGE_SIZE = 25;

// Gives every message phase 1 parsed a ledger row, by re-fetching it from Gmail (phase 1 stored
// no bodies). Never posts to Discord: these transactions were announced when they arrived.
export async function backfillTransactions(
  { stores, recorder, fetchEmail, parser }: Deps,
  { userId, limit, dryRun, onItem = () => {} }: Options,
) {
  const counts = { examined: 0, created: 0, existing: 0, preview: 0, skipped: 0 };
  let afterId: string | null = null;

  while (counts.examined < limit) {
    const page = await stores.ingestedMessages.listParsedWithoutTransaction(userId, {
      afterId,
      limit: Math.min(PAGE_SIZE, limit - counts.examined),
    });
    if (page.length === 0) break;

    for (const message of page) {
      const item = await backfillOne(message);
      counts.examined++;
      counts[item.status]++;
      onItem(item);
    }
    afterId = page.at(-1)!.id;
  }
  return counts;

  async function backfillOne({ id, gmailMessageId }: { id: string; gmailMessageId: string }): Promise<BackfillItem> {
    const email = await fetchEmail(gmailMessageId);
    if (!email) return { gmailMessageId, status: 'skipped', reason: 'no longer in Gmail' };
    const result = parser.parse(email);
    // Parsed in phase 1 but not now: a parser regression worth looking at, not something to guess.
    if (result.status !== 'parsed') return { gmailMessageId, status: 'skipped', reason: `now ${result.status}: ${result.reason}` };

    const transaction = result.transaction;
    if (dryRun) {
      const { categoryName } = await recorder.preview(userId, transaction);
      return { gmailMessageId, status: 'preview', transaction, categoryName };
    }
    const outcome = await recorder.record({ userId, ingestedMessageId: id, gmailMessageId, transaction });
    return { gmailMessageId, status: outcome.created ? 'created' : 'existing', transaction, categoryName: outcome.categoryName };
  }
}
