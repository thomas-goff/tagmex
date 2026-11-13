import { randomUUID } from 'node:crypto';
import type { ParsedTransaction } from '@/features/bank-email/types';
import type { Categorisation } from '@/features/categorisation/types';
import { NotFoundError } from './correct-category';
import type { CategoryAssignment, FullTransaction, Stores, UnitOfWork } from './ports';

// Ledger rows that didn't come from a bank email: transactions added by hand (cash, or something
// the bank never emailed) and the parts of a split. Both are `manual` rows; a part also points at
// the transaction it was split from, which is excluded while its parts stand, so the money counts
// once. Undoing a split excludes the parts and restores the original: nothing is ever deleted.

// Where a transaction added by hand lives unless an account is named.
export const CASH_ACCOUNT = { accountType: 'CASH', accountLast4: '0000' } as const;

export interface ManualInput {
  userId: string;
  occurredOn: string;
  // Signed: negative = money out.
  amountCents: number;
  description: string;
  account?: { accountType: string; accountLast4: string };
  // Null or omitted: the user's rules decide, as for a bank email.
  categoryId?: string | null;
}

export interface SplitPart {
  // Unsigned: the part's share. Parts take the original's sign.
  amountCents: number;
  categoryId: string;
}

interface Deps {
  stores: Pick<Stores, 'transactions'>;
  unitOfWork: UnitOfWork;
  // What the user's rules make of a transaction (the recorder's preview).
  categorise(userId: string, tx: ParsedTransaction): Promise<Categorisation>;
  newRef?: () => string;
}

export type ManualEntries = ReturnType<typeof createManualEntries>;

// Upper case with single spaces, like the bank descriptions the rules were learned from.
export function normaliseManualDescription(text: string) {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

export function createManualEntries({ stores, unitOfWork, categorise, newRef = randomUUID }: Deps) {
  return {
    async add(input: ManualInput) {
      const account = input.account ?? CASH_ACCOUNT;
      const description = normaliseManualDescription(input.description);
      const parsed: ParsedTransaction = {
        amountCents: input.amountCents,
        occurredOn: input.occurredOn,
        transactionType: 'MANUAL',
        descriptionRaw: input.description.trim(),
        description,
        accountType: account.accountType,
        accountLast4: account.accountLast4,
        reserved: false,
        kind: input.amountCents < 0 ? 'payment' : 'credit',
      };
      const category: CategoryAssignment = input.categoryId
        ? { categoryId: input.categoryId, source: 'manual', ruleId: null }
        : pick(await categorise(input.userId, parsed));
      const { id } = await stores.transactions.insertIfNew({
        userId: input.userId,
        accountType: parsed.accountType,
        accountLast4: parsed.accountLast4,
        occurredOn: parsed.occurredOn,
        amountCents: parsed.amountCents,
        descriptionRaw: parsed.descriptionRaw,
        descriptionNormalised: parsed.description,
        balanceAfterCents: null,
        kind: parsed.kind,
        transactionType: parsed.transactionType,
        reserved: false,
        source: 'manual',
        sourceRef: `manual:${newRef()}`,
        category,
      });
      return { id, description, account, categoryId: category.categoryId };
    },

    // Replaces a transaction with parts that add up to it, each in its own category. Splitting
    // again replaces the earlier parts. The caller has checked the parts add up.
    async split(userId: string, transactionId: string, parts: readonly SplitPart[]) {
      const original = await stores.transactions.findFull(userId, transactionId);
      if (!original) throw new NotFoundError(`transaction ${transactionId}`);
      const sign = original.amountCents < 0 ? -1 : 1;
      return unitOfWork(async (s) => {
        const earlier = await s.transactions.listSplitParts(userId, original.id);
        await s.transactions.setExcluded(userId, earlier.map((p) => p.id), true);
        const partIds: string[] = [];
        for (const part of parts) {
          const { id } = await s.transactions.insertIfNew(partOf(userId, original, sign * part.amountCents, part.categoryId, `split:${original.id}:${newRef()}`));
          partIds.push(id);
        }
        await s.transactions.setExcluded(userId, [original.id], true);
        return { original, partIds, replaced: earlier.length };
      });
    },

    // Undoes a split: the parts are excluded and the original counts again. Returns how many parts
    // there were (0 = it wasn't split, and nothing changed).
    async unsplit(userId: string, transactionId: string) {
      return unitOfWork(async (s) => {
        const parts = await s.transactions.listSplitParts(userId, transactionId);
        if (parts.length === 0) return 0;
        await s.transactions.setExcluded(userId, parts.map((p) => p.id), true);
        await s.transactions.setExcluded(userId, [transactionId], false);
        return parts.length;
      });
    },
  };
}

function pick({ categoryId, source, ruleId }: Categorisation): CategoryAssignment {
  return { categoryId, source, ruleId };
}

function partOf(userId: string, original: FullTransaction, amountCents: number, categoryId: string, sourceRef: string) {
  return {
    userId,
    accountType: original.accountType,
    accountLast4: original.accountLast4,
    occurredOn: original.occurredOn,
    amountCents,
    descriptionRaw: original.descriptionRaw,
    descriptionNormalised: original.descriptionNormalised,
    // The bank's balance belongs to the original.
    balanceAfterCents: null,
    kind: original.kind,
    transactionType: original.transactionType,
    reserved: original.reserved,
    source: 'manual' as const,
    sourceRef,
    category: { categoryId, source: 'manual' as const, ruleId: null },
    splitOf: original.id,
  };
}
