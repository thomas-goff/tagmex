// Composition root for the mailbox sync: Gmail, the bank parsers, Postgres, the ledger and Discord
// behind the pure run in ./mailbox-sync.
import 'server-only';
import { db } from '@/db';
import { absaParser } from '@/features/bank-email/absa/parser';
import { createParserRegistry, type ParserRegistry } from '@/features/bank-email/registry';
import { gmail, gmailSender } from '@/features/gmail';
import { ledger } from '@/features/transactions';
import { announceToDiscord } from './announce';
import { createDrizzleIngestStore } from './drizzle-ingest-store';
import { createMailboxSync, type MailboxSync } from './mailbox-sync';

let parsers: ParserRegistry | null = null;
let sync: MailboxSync | null = null;

// A second bank is one more entry here. Built on first use: the Gmail vars are validated then,
// so the app still deploys before Gmail is connected.
export function bankParsers() {
  return (parsers ??= createParserRegistry([{ sender: gmailSender(), parser: absaParser }]));
}

export const mailboxSync = {
  run(userId: string, options?: { retryFailed?: boolean }) {
    sync ??= createMailboxSync({
      mail: gmail(),
      parsers: bankParsers(),
      store: createDrizzleIngestStore(db),
      createRecorder: ledger.createRecorder,
      announce: announceToDiscord,
    });
    return sync.run(userId, options);
  },
};
