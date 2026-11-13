import type { IBankEmailParser } from './types';

// Which parser reads which bank's notification emails, keyed by the address they come from.
// Adding a bank is one entry here (in the composition root): the sync never names a parser.

export interface BankSender {
  // The address the bank's notifications come from, e.g. notifyme@absa.co.za.
  sender: string;
  parser: IBankEmailParser;
}

export type ParserRegistry = ReturnType<typeof createParserRegistry>;

export function createParserRegistry(banks: readonly BankSender[]) {
  if (banks.length === 0) throw new Error('at least one bank sender is needed');
  const entries = banks.map((b) => ({ ...b, sender: b.sender.trim().toLowerCase() }));

  return {
    senders: entries.map((e) => e.sender),

    // The parser for a From header ("Absa <notifyme@absa.co.za>"), or null when it isn't a bank's.
    parserFor(from: string): IBankEmailParser | null {
      const header = from.toLowerCase();
      return entries.find((e) => header.includes(e.sender))?.parser ?? null;
    },

    // Gmail search for mail from any of the banks received in the last `window` (e.g. '30d').
    query(window: string) {
      const from = entries.length === 1 ? entries[0]!.sender : `(${entries.map((e) => e.sender).join(' OR ')})`;
      return `from:${from} newer_than:${window}`;
    },
  };
}
