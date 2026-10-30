export interface BankEmail {
  id: string;
  from: string;
  subject: string;
  html: string | null;
  text: string | null;
  receivedAt: Date;
}

export type TransactionKind =
  | 'card_purchase'
  | 'debit_order'
  | 'payment'
  | 'transfer'
  | 'credit'
  | 'reversal'
  | 'fee'
  | 'withdrawal'
  | 'other';

export interface ParsedTransaction {
  // Integer cents. Negative = expense.
  amountCents: number;
  // The notification carries a date only (YYYY-MM-DD), no time.
  occurredOn: string;
  // The bank's transaction type, e.g. "ACB DEBIT:EXTERNAL" or "AUTHORIZATION".
  transactionType: string;
  // Merchant or reference as sent, e.g. "TELCO 0123456789 X1234567".
  descriptionRaw: string;
  description: string;
  // e.g. CHEQ, CCRD, SAVS.
  accountType: string;
  accountLast4: string;
  balanceAfterCents?: number;
  // A card hold ("Reserved") rather than a settled amount.
  reserved: boolean;
  kind: TransactionKind;
}

export type ParseResult =
  | { status: 'parsed'; transaction: ParsedTransaction }
  | { status: 'ignored'; reason: string }
  | { status: 'failed'; reason: string };

export interface IBankEmailParser {
  // Never throws: anything unexpected comes back as `failed`.
  parse(email: Pick<BankEmail, 'subject' | 'html' | 'text'>): ParseResult;
}
