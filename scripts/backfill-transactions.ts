// Creates ledger rows for emails phase 1 parsed before transactions were stored, by re-fetching
// them from Gmail. Never posts to Discord.
// Usage: npm run transactions:backfill -- --dry-run       print what would be created, write nothing
//        npm run transactions:backfill                    create the rows
//        npm run transactions:backfill -- --limit 50      stop after 50 messages
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { absaParser } from '@/features/bank-email/absa/parser';
import { GmailError, createGmailClient } from '@/features/gmail/client';
import { formatRand } from '@/features/sync/format';
import { backfillTransactions, type BackfillItem } from '@/features/transactions/backfill';
import { createLedger } from '@/features/transactions/ledger';
import { OWNER_USER_ID } from '@/features/users/owner';
import { openDatabase, runScript } from './_db';

const { values: args } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false }, limit: { type: 'string', default: '1000' } },
});

runScript(async () => {
  const { db, close } = openDatabase();
  const env = z
    .object({
      GOOGLE_CLIENT_ID: z.string().min(1),
      GOOGLE_CLIENT_SECRET: z.string().min(1),
      GMAIL_REFRESH_TOKEN: z.string().min(1),
    })
    .parse(process.env);
  const gmail = createGmailClient({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
  });
  const ledger = createLedger(db);
  const dryRun = args['dry-run'];

  try {
    const counts = await backfillTransactions(
      {
        stores: ledger.stores,
        recorder: ledger.createRecorder(),
        parser: absaParser,
        async fetchEmail(id) {
          try {
            return await gmail.getEmail(id);
          } catch (err) {
            if (err instanceof GmailError && err.status === 404) return null;
            throw err;
          }
        },
      },
      { userId: OWNER_USER_ID, limit: Number(args.limit), dryRun, onItem: (item) => console.log(describe(item)) },
    );
    console.log(`\n${dryRun ? '[dry run] ' : ''}${JSON.stringify(counts)}`);
  } finally {
    await close();
  }
});

function describe(item: BackfillItem) {
  if (item.status === 'skipped') return `skipped  ${item.gmailMessageId}: ${item.reason}`;
  const t = item.transaction;
  const category = item.categoryName ?? 'UNCATEGORISED';
  return `${item.status.padEnd(8)} ${t.occurredOn}  ${formatRand(t.amountCents).padStart(12)}  ${t.description.padEnd(36)}  ${category}`;
}
