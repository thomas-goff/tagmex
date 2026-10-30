import { load } from 'cheerio';
import type { IBankEmailParser, ParseResult, TransactionKind } from '../types';
import { normaliseDescription } from './normalise-description';

// Absa NotifyMe emails (notifyme@absa.co.za) are plain text with one "Key : Value" per line:
//
//   Account : CHEQ1234                      Account : CCRD5678
//   Date : 01/11/2026                       Date : 01/11/2026
//   Transaction: Purchase                   Transaction : AUTHORIZATION
//   Merchant : SOME RESTAURANT              Reference : SOME SHOP - SUBURB
//   Reserved : R100.00                      Amount : R50.00
//   Available : R900.00                     Total Available Balance: R450.00
//
// Cheque accounts sign their amounts ("-R1,000.00") except card holds ("Reserved"). Credit card
// amounts are never signed, so the direction comes from the subject ("NotifyMe - Purchase").
const FIELD = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.+?)\s*$/gm;
const ACCOUNT = /^([A-Z]+)(\d{4})$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MONEY = /^(-)?\s*R\s?(-)?\s*([\d,]+)\.(\d{2})$/;

// Subject category → direction of an unsigned amount.
const MONEY_IN = new Set(['deposit', 'returned transaction']);
const MONEY_OUT = new Set(['purchase', 'transfer', 'payment', 'scheduled transaction', 'withdrawal']);

export const absaParser: IBankEmailParser = {
  parse(email) {
    try {
      return parseFields(subjectCategory(email.subject), readFields(email));
    } catch (err) {
      return { status: 'failed', reason: `parser error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// "NotifyMe from Absa       - Purchase" → "purchase"
function subjectCategory(subject: string) {
  return (subject.split(' - ').pop() ?? '').trim().toLowerCase();
}

function readFields({ text, html }: { text: string | null; html: string | null }) {
  const body = text ?? (html ? htmlToText(html) : '');
  const fields = new Map<string, string>();
  for (const [, key, value] of body.matchAll(FIELD)) {
    const k = key!.toLowerCase();
    if (!fields.has(k)) fields.set(k, value!);
  }
  return fields;
}

function htmlToText(html: string) {
  const $ = load(html);
  $('head, script, style').remove();
  $('p, div, td, tr, li, br, table').after('\n');
  return $.root().text().replace(/ /g, ' ');
}

function parseFields(category: string, f: Map<string, string>): ParseResult {
  const account = f.get('account');
  if (!account) return { status: 'ignored', reason: 'no transaction details (service notice or marketing)' };

  const amountField = f.has('amount') ? 'amount' : f.has('reserved') ? 'reserved' : null;
  const missing = [
    !f.get('date') && 'Date',
    !f.get('transaction') && 'Transaction',
    !amountField && 'Amount/Reserved',
    !(f.get('reference') ?? f.get('merchant')) && 'Reference/Merchant',
  ].filter(Boolean);
  if (missing.length) return { status: 'failed', reason: `missing ${missing.join(', ')}` };

  const acc = ACCOUNT.exec(account);
  if (!acc) return { status: 'failed', reason: `unrecognised account "${account}"` };

  const date = DATE.exec(f.get('date')!);
  if (!date || Number(date[2]) < 1 || Number(date[2]) > 12 || Number(date[1]) < 1 || Number(date[1]) > 31) {
    return { status: 'failed', reason: `unrecognised date "${f.get('date')}"` };
  }

  const money = parseMoney(f.get(amountField!)!);
  if (!money) return { status: 'failed', reason: `unrecognised amount "${f.get(amountField!)}"` };

  // Explicit sign wins. A hold is always money out. Otherwise the subject decides.
  const reserved = amountField === 'reserved';
  let amountCents: number;
  if (money.negative || reserved) amountCents = -money.cents;
  else if (acc[1] !== 'CCRD' || MONEY_IN.has(category)) amountCents = money.cents;
  else if (MONEY_OUT.has(category)) amountCents = -money.cents;
  else return { status: 'failed', reason: `unsigned credit card amount with unknown direction ("${category}")` };

  const balance = f.get('available') ?? f.get('total available balance');
  const balanceMoney = balance ? parseMoney(balance) : null;
  // "SETTLEMENT CENTRE - ACB DEBIT:EXTERNAL" → "ACB DEBIT:EXTERNAL" (the prefix is the branch)
  const transactionType = f.get('transaction')!.split(' - ').pop()!.trim();
  const descriptionRaw = (f.get('merchant') ?? f.get('reference'))!;

  return {
    status: 'parsed',
    transaction: {
      amountCents,
      occurredOn: `${date[3]}-${date[2]}-${date[1]}`,
      transactionType,
      descriptionRaw,
      description: normaliseDescription(descriptionRaw),
      accountType: acc[1]!,
      accountLast4: acc[2]!,
      ...(balanceMoney && { balanceAfterCents: balanceMoney.negative ? -balanceMoney.cents : balanceMoney.cents }),
      reserved,
      kind: classify(transactionType, category, amountCents, reserved),
    },
  };
}

function parseMoney(s: string) {
  const m = MONEY.exec(s.trim());
  if (!m) return null;
  return { negative: Boolean(m[1] || m[2]), cents: Number(m[3]!.replace(/,/g, '')) * 100 + Number(m[4]) };
}

function classify(type: string, category: string, amountCents: number, reserved: boolean): TransactionKind {
  const t = type.toUpperCase();
  if (/\bFEES?\b|\bCHARGE/.test(t)) return 'fee';
  if (/UNPAID|REVERS|RETURN/.test(t) || category === 'returned transaction') return 'reversal';
  if (/TRANSF|RELATED ACCOUNT/.test(t)) return 'transfer';
  if (/ACB DEBIT|DEBIT ORDER/.test(t) || category === 'scheduled transaction') return 'debit_order';
  if (reserved || /AUTHORI[SZ]ATION|PURCHASE/.test(t) || category === 'purchase') return 'card_purchase';
  if (/\bATM\b|WITHDRAWAL/.test(t)) return 'withdrawal';
  if (/PAYMENT/.test(t) && amountCents < 0) return 'payment';
  if (amountCents > 0) return 'credit';
  return 'other';
}
