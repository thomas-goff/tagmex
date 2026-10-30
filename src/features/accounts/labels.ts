// Names for the user's own bank accounts ("CHEQ …1297" → "Main cheque") and for counterparties
// that appear in descriptions ("ABSA BANK SABIE PAYBACK" → "Dad's estate"). Pure: the repo loads
// the rows, this matches them.

export const ACCOUNT_LABEL_KINDS = ['account', 'counterparty'] as const;
export type AccountLabelKind = (typeof ACCOUNT_LABEL_KINDS)[number];

export interface AccountLabel {
  kind: AccountLabelKind;
  // `account`: type + last 4, e.g. CHEQ1297. `counterparty`: upper-case description text.
  match: string;
  label: string;
  note: string | null;
}

export interface KnownAccount {
  accountType: string;
  accountLast4: string;
}

// Shorter counterparty text would match half the ledger.
export const MIN_COUNTERPARTY_LENGTH = 4;

export function accountKey(a: KnownAccount) {
  return `${a.accountType}${a.accountLast4}`.toUpperCase();
}

// How accounts are shown everywhere: the bank's type and the last 4 digits.
export function maskedAccount(a: KnownAccount) {
  return `${a.accountType} …${a.accountLast4}`;
}

// Same shape as normalised descriptions, so a substring test is enough.
export function counterpartyKey(text: string) {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

export type AccountRef = { ok: true; account: KnownAccount } | { ok: false; reason: string };

// What a person or model calls an account: "CHEQ …1297", "CHEQ1297", "cheq 1297", "…1297" or
// "1297". Resolved against the accounts in the user's own ledger, so only those can be labelled.
export function resolveAccount(ref: string, known: readonly KnownAccount[]): AccountRef {
  const parsed = /^([A-Za-z]+)?[\s.…*-]*(\d{4})$/.exec(ref.trim());
  if (!parsed) return { ok: false, reason: `"${ref}" doesn't look like an account: use the type and last 4 digits, e.g. "CHEQ …1297"` };
  const [, type, last4] = parsed;
  const matches = known.filter((a) => a.accountLast4 === last4 && (!type || a.accountType.toUpperCase() === type.toUpperCase()));
  if (matches.length === 1) return { ok: true, account: matches[0]! };
  if (matches.length === 0) return { ok: false, reason: `No account ${type ? `${type.toUpperCase()} ` : ''}…${last4} in the ledger` };
  return { ok: false, reason: `More than one account ends in ${last4} (${matches.map(maskedAccount).join(', ')}): include the type` };
}

export interface Labeller {
  account(a: KnownAccount): AccountLabel | null;
  // The longest counterparty text found in the description, so "SABIE PAYBACK" beats "PAYBACK".
  counterparty(description: string): AccountLabel | null;
}

export function createLabeller(labels: readonly AccountLabel[]): Labeller {
  const accounts = new Map(labels.filter((l) => l.kind === 'account').map((l) => [l.match, l]));
  const counterparties = labels.filter((l) => l.kind === 'counterparty').sort((a, b) => b.match.length - a.match.length);
  return {
    account: (a) => accounts.get(accountKey(a)) ?? null,
    counterparty(description) {
      const text = counterpartyKey(description);
      return counterparties.find((l) => text.includes(l.match)) ?? null;
    },
  };
}
